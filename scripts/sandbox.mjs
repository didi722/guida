// Istanza di PROVA con dati d'esempio, separata dai dati veri.
//
//   npm run sandbox             avvia il sito di prova su http://localhost:3200 (la prima volta crea i dati d'esempio)
//   npm run sandbox -- --reset  cancella la prova e ricomincia da zero
//
// Usa la cartella data-sandbox/ (mai data/), pagamenti simulati, email non spedite (le leggi in /admin/mail),
// password admin «admin» e dati fiscali finti: non tocca nulla di quello che usi per il sito vero.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.SANDBOX_DIR ? path.resolve(process.env.SANDBOX_DIR) : path.join(ROOT, 'data-sandbox'); // le due variabili servono ai test
const PORT = process.env.SANDBOX_PORT || '3200';

if (process.env.NODE_ENV === 'production') {
  console.error('Questo script è solo per le prove: non si usa con NODE_ENV=production.');
  process.exit(1);
}
if (process.argv.includes('--reset')) fs.rmSync(DIR, { recursive: true, force: true });
const fresh = !fs.existsSync(path.join(DIR, 'guida.sqlite'));

// Le variabili già presenti nell'ambiente hanno la precedenza sul file .env: così la prova ignora le impostazioni vere.
Object.assign(process.env, {
  NODE_ENV: 'development', DATA_DIR: DIR, PORT, BASE_URL: `http://localhost:${PORT}`, ADMIN_PASSWORD: 'admin',
  CONTACT_EMAIL: 'info@example.com', NOTIFY_EMAIL: 'guida@example.com',
  STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', PEC_SMTP_HOST: '', PEC_SMTP_USER: '', PEC_SMTP_PASS: '',
  // dati fiscali finti, solo perché si possano provare le fatture
  VAT_NUMBER: 'IT12345678903', FISCAL_CODE: 'RSSMRA80A01H501U', INVOICE_FIRST_NAME: 'Mario', INVOICE_LAST_NAME: 'Rossi',
  INVOICE_ADDRESS: 'Calle del Test 1', INVOICE_ZIP: '30100', INVOICE_CITY: 'Venezia', INVOICE_PROVINCE: 'VE', INVOICE_IBAN: 'IT60X0542811101000000123456',
  GUIDE_LICENSE: 'n. 0000 (prova)', LEGAL_ADDRESS: 'Calle del Test 1, Venezia',
});

const { createApp } = await import('../server/app.js');
const { hashPassword } = await import('../server/auth.js');
const { createBooking, confirmPaid } = await import('../server/bookings.js');
const { createAdminGift } = await import('../server/gifts.js');
const { createProgramRequest, saveProposal } = await import('../server/programs.js');
const { addDays, nowRome } = await import('../server/time.js');

const { app, server } = createApp();

async function seed() {
  const { db } = app;
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const today = nowRome(now).date;
  const d = (n) => addDays(today, n);
  const earlier = now - 14 * 86400_000; // «due settimane fa»: serve a creare prenotazioni già svolte
  const pw = await hashPassword('prova-prova-1');

  const addAccount = (a) => {
    const row = { country: 'IT', lang: 'it', allow_invoice: 1, discount_percent: 0, ...a, password_hash: pw, created_at: iso };
    const cols = Object.keys(row);
    const id = Number(db.prepare(`INSERT INTO accounts(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  };
  const lagoon = addAccount({ email: 'giulia@lagoon-dmc.example', company: 'Lagoon DMC', vat: '01234567897', sdi_code: 'ABC1234', address: 'Fondamenta Test 1, Venezia', contact_name: 'Giulia Bianchi', phone: '+39 041 000001', status: 'approved', approved_at: iso, discount_percent: 15, cancel_hours: 168, admin_notes: 'Partner di prova: sconto 15% e cancellazione gratuita fino a 7 giorni prima.' });
  const bluesail = addAccount({ email: 'luca@bluesail.example', company: 'Blue Sail Tours', vat: '09876543210', sdi_code: 'XYZ9876', contact_name: 'Luca Neri', phone: '+39 041 000002', status: 'approved', approved_at: iso, allow_invoice: 0, admin_notes: 'Partner di prova: condizioni standard, solo carta.' });
  addAccount({ email: 'marco@rialto-travel.example', company: 'Rialto Travel', vat: '01111111111', sdi_code: 'RLT0001', contact_name: 'Marco Verdi', phone: '+39 041 000003', status: 'pending', message: 'Siamo un tour operator di Milano e vorremmo riservare guide per i nostri gruppi.' });

  const tries = [];
  const book = (label, input, { paid = false, at = now } = {}) => {
    try {
      const b = createBooking(app, input, at);
      if (paid) confirmPaid(app, b.id, `pi_prova_${b.ref}`, at);
      tries.push(`✓ ${label}`);
      return b;
    } catch (err) {
      tries.push(`✗ ${label}: ${err.message}`);
      return null;
    }
  };
  // clienti privati
  book('Anna Verdi: Cannaregio fra 6 giorni, pagata con carta', { tourSlug: 'cannaregio-ghetto', date: d(6), time: '10:00', pax: 2, name: 'Anna Verdi', email: 'anna.verdi@example.com', lang: 'it', paymentMethod: 'card' }, { paid: true });
  book('John Smith: Cannaregio fra 9 giorni, pagata con carta (in inglese)', { tourSlug: 'cannaregio-ghetto', date: d(9), time: '15:00', pax: 4, name: 'John Smith', email: 'john.smith@example.com', lang: 'en', paymentMethod: 'card' }, { paid: true });
  book('Carmen Ruiz: San Marco fra 2 giorni (in spagnolo)', { tourSlug: 'san-marco-rialto', date: d(2), time: '14:30', pax: 3, name: 'Carmen Ruiz', email: 'carmen.ruiz@example.com', lang: 'es', paymentMethod: 'card' }, { paid: true });
  // partner
  book('Lagoon DMC: passeggiata privata fra 12 giorni, a fattura (sconto 15%, rimborsabile fino a 7 giorni prima)', { tourSlug: 'passeggiata-privata-2h', date: d(12), time: '10:00', pax: 8, channel: 'b2b', account: lagoon, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Rossi' });
  book('Lagoon DMC: San Marco fra 4 giorni, a fattura (già dentro i 7 giorni: non rimborsabile)', { tourSlug: 'san-marco-rialto', date: d(4), time: '14:30', pax: 6, channel: 'b2b', account: lagoon, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Bianchi' });
  book('Blue Sail Tours: San Marco fra 8 giorni, pagata con carta', { tourSlug: 'san-marco-rialto', date: d(8), time: '09:30', pax: 2, channel: 'b2b', account: bluesail, name: 'Luca Neri', email: bluesail.email, lang: 'en', paymentMethod: 'card' }, { paid: true });
  // già svolte (finiscono in «Da fatturare» e fanno partire la richiesta di recensione)
  book('Laura Bianchi: San Marco di 6 giorni fa, pagata con carta', { tourSlug: 'san-marco-rialto', date: d(-6), time: '09:30', pax: 2, name: 'Laura Bianchi', email: 'laura.bianchi@example.com', lang: 'it', paymentMethod: 'card' }, { paid: true, at: earlier });
  book('Lagoon DMC: passeggiata di 5 giorni fa, a fattura (da incassare e da fatturare)', { tourSlug: 'passeggiata-privata-2h', date: d(-5), time: '10:00', pax: 5, channel: 'b2b', account: lagoon, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Verdi' }, { at: earlier });

  // buono regalo e codice sconto
  let giftCode = '—';
  try {
    giftCode = createAdminGift(app, { amountCents: 10000, buyerName: 'Mario Rossi', buyerEmail: 'mario.rossi@example.com', lang: 'it' }, now).code;
    tries.push('✓ Buono regalo da 100 €');
  } catch (err) {
    tries.push(`✗ Buono regalo: ${err.message}`);
  }
  db.prepare(`INSERT INTO promo_codes(code, kind, value, active, note, created_at) VALUES('PROVA10', 'percent', 10, 1, 'Codice di prova: 10%', ?)`).run(iso);
  tries.push('✓ Codice sconto PROVA10 (10%)');

  // programma di più giorni con proposta già inviata
  try {
    const p = createProgramRequest(app, { name: 'Giulia Bianchi', email: lagoon.email, company: 'Lagoon DMC', channel: 'b2b', account: lagoon, participants: 8, dateFrom: d(30), dateTo: d(32), interests: ['art', 'food'], lang: 'it', message: 'Tre giorni a Venezia per un gruppo di clienti.' }, now);
    saveProposal(app, p.id, {
      title: 'Venezia in tre giorni', intro: 'Ecco la proposta per il vostro gruppo.', notes: 'Incluso: guida abilitata. Esclusi: ingressi, trasporti e pasti.', depositPercent: 30, validUntil: d(10), holdDates: true,
      days: [
        { date: d(30), start: '09:30', end: '13:00', title: 'San Marco e Rialto', priceCents: 15000 },
        { date: d(31), start: '10:00', end: '16:00', title: 'Isole della laguna', description: 'Murano, Burano, Torcello', priceCents: 30000 },
        { date: d(32), start: '09:30', end: '12:30', title: 'Cannaregio e il Ghetto', priceCents: 12000 },
      ],
    }, { nowMs: now });
    await app.programs.send(p.id, now);
    tries.push('✓ Programma «Venezia in tre giorni» con proposta inviata a Lagoon DMC');
  } catch (err) {
    tries.push(`✗ Programma: ${err.message}`);
  }

  console.log('\nDati d\'esempio creati:\n  ' + tries.join('\n  '));
  return giftCode;
}

const giftCode = fresh ? await seed() : null;

server.listen(Number(PORT), () => {
  console.log(`
═══════════════ SITO DI PROVA ═══════════════
Sito         http://localhost:${PORT}
Pannello     http://localhost:${PORT}/admin        password: admin
Email        http://localhost:${PORT}/admin/mail   (le email non partono: le leggi qui)
Pagamenti    simulati (nessuna carta vera)
Partner      giulia@lagoon-dmc.example  (approvato, sconto 15%, rimborso fino a 7 giorni prima, paga a fattura)
             luca@bluesail.example      (approvato, condizioni standard, solo carta)
             password di entrambi: prova-prova-1      (Rialto Travel è "da approvare")
Codici       sconto PROVA10${giftCode ? `   ·   buono regalo ${giftCode}` : ''}
Dati         ${path.relative(ROOT, DIR) || DIR}/   (npm run sandbox -- --reset per ricominciare)
Ctrl+C per fermare.
`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
