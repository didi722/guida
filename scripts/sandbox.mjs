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

const { REQUEST_TIMEOUT_MS, createApp } = await import('../server/app.js');
const { hashPassword } = await import('../server/auth.js');
const { cancelBooking, confirmPaid, createBooking, getBooking, markRefund } = await import('../server/bookings.js');
const { saveFeedback, setFeatured } = await import('../server/reviews.js');
const { createAdminGift } = await import('../server/gifts.js');
const { createProgramRequest, saveProposal } = await import('../server/programs.js');
const { addDays, localToInstant, nowRome } = await import('../server/time.js');

const { app, server } = createApp();

/** Prenotazioni d'esempio dei 5 mesi scorsi (sempre le stesse: generatore pseudo-casuale con seme fisso). */
function seedHistory({ lagoon, bluesail, d, now }) {
  const { db } = app;
  let state = 20260711;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pickWeighted = (items) => {
    let x = rnd() * items.reduce((t, i) => t + i.w, 0);
    return items.find((i) => (x -= i.w) < 0) ?? items.at(-1);
  };
  const TOURS = [
    { slug: 'san-marco-rialto', w: 5, times: ['09:30', '14:30'], pax: [1, 6] },
    { slug: 'cannaregio-ghetto', w: 3, times: ['10:00', '15:00'], pax: [1, 6] },
    { slug: 'guida-a-ore', w: 3, times: ['09:30', '10:00', '14:00', '15:30'], pax: [2, 12], hours: [2, 2, 3, 4, 4, 6, 8] },
    { slug: 'venezia-oriente-occidente', w: 1, times: ['09:30', '14:00'], pax: [4, 12] },
    { slug: 'isole-murano-burano-torcello', w: 1, times: ['09:00'], pax: [4, 10] },
    // servizi riservate alle agenzie
    { slug: 'meet-and-greet', w: 1, times: ['10:00', '16:00'], pax: [2, 20], hours: [1, 1, 2], partnerOnly: true },
    { slug: 'assistente-a-ore', w: 1, times: ['09:00', '14:00'], pax: [10, 25], hours: [2, 4, 4, 8], partnerOnly: true },
  ];
  const NAMES = ['Sofia Conti', 'Mark Thompson', 'Elena Pastore', 'Hans Becker', 'Lucía Fernández', 'Paolo Gentile', 'Emma Wilson', 'Marco De Luca', 'Chiara Longo', 'David Miller', 'Marta Ruiz', 'Giorgio Neri', 'Claire Dubois', 'Anna Costa'];
  const LANGS = [{ w: 5, v: 'it' }, { w: 4, v: 'en' }, { w: 2, v: 'es' }].map((x) => ({ ...x }));
  let created = 0;
  let cancelled = 0;
  const done = []; // prenotazioni private svolte e non annullate: a molte, il cliente ha lasciato un feedback
  for (let i = 0; i < 70; i++) {
    const tour = pickWeighted(TOURS);
    const date = d(-between(8, 150));
    const lead = between(2, 24);
    const at = localToInstant(addDays(date, -lead), '12:00');
    const partner = rnd() < 0.3 || tour.partnerOnly ? (rnd() < 0.7 ? lagoon : bluesail) : null;
    const lang = pickWeighted(LANGS).v;
    const name = partner ? partner.contact_name : NAMES[i % NAMES.length];
    const input = {
      tourSlug: tour.slug, date, time: tour.times[between(0, tour.times.length - 1)], pax: between(...tour.pax), name,
      ...(tour.hours ? { hours: tour.hours[between(0, tour.hours.length - 1)], earpieces: rnd() < 0.4 } : {}),
      email: partner ? partner.email : `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, lang,
      ...(partner ? { channel: 'b2b', account: partner, paymentMethod: partner === lagoon ? 'invoice' : 'card', clientRef: `Gruppo ${between(1, 40)}` } : { paymentMethod: 'card' }),
    };
    let b;
    try {
      b = createBooking(app, input, at);
    } catch {
      continue; // orario già occupato: pazienza, ne bastano molte altre
    }
    created += 1;
    if (!partner) done.push({ id: b.id, lang, date });
    if (input.paymentMethod === 'card') confirmPaid(app, b.id, `pi_storico_${b.ref}`, at);
    else if (rnd() < 0.6) db.prepare("UPDATE bookings SET payment_status = 'paid' WHERE id = ?").run(b.id); // a fattura: una parte già incassata
    if (rnd() < 0.12) {
      const when = localToInstant(addDays(date, -between(0, 9)), '10:00');
      const r = cancelBooking(app, b.id, { by: 'customer', refund: rnd() < 0.7 ? 'auto' : 'none' }, when);
      if (!r.already) {
        cancelled += 1;
        if (r.refundCents > 0) markRefund(db, b.id, { ok: true, cents: r.refundCents });
      }
    }
  }
  // feedback d'esempio (testi inventati, solo per la prova): alcuni citabili, tre già mostrati sul sito
  const COMMENTS = {
    it: ['Davide racconta Venezia come nessun altro: storie, non elenchi. Consigliatissimo!', 'Gruppo piccolo, ritmo giusto e tante curiosità. Ci siamo sentiti ospiti, non turisti.', 'Una passeggiata che ci ha fatto vedere la città con occhi nuovi.', 'Preparato e disponibile, ha adattato il percorso ai bambini.'],
    en: ['A wonderful, thoughtful tour. We learned so much about the history behind the buildings.', 'Small group, relaxed pace and fascinating stories. Highly recommended.', 'Our guide made Venice come alive. The best part of our trip.'],
    es: ['Una visita fantástica: historias, no listas de fechas. Muy recomendable.', 'Grupo pequeño y un ritmo muy agradable. Aprendimos muchísimo.'],
  };
  let featured = 0;
  const alive = done.filter((x) => db.prepare("SELECT status FROM bookings WHERE id = ?").get(x.id)?.status === 'confirmed').sort((a, b) => b.date.localeCompare(a.date));
  for (const x of alive.slice(0, 22)) {
    const rating = rnd() < 0.62 ? 5 : rnd() < 0.7 ? 4 : rnd() < 0.6 ? 3 : 2;
    const pool = COMMENTS[x.lang] ?? COMMENTS.it;
    const comment = rnd() < 0.8 ? pool[between(0, pool.length - 1)] : '';
    const mayPublish = rnd() < 0.6;
    const r = saveFeedback(db, getBooking(db, x.id), { rating, comment, mayPublish }, now);
    if (r.ok && featured < 3 && rating >= 4 && comment && mayPublish) {
      setFeatured(db, db.prepare('SELECT id FROM feedback WHERE booking_id = ?').get(x.id).id, true);
      featured += 1;
    }
  }
  return { created, cancelled, feedback: alive.slice(0, 22).length, featured };
}

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
  const lagoon = addAccount({ email: 'giulia@lagoon-dmc.example', company: 'Lagoon DMC', vat: '01234567897', sdi_code: 'ABC1234', address: 'Fondamenta Test 1, Venezia', contact_name: 'Giulia Bianchi', phone: '+39 041 000001', status: 'approved', approved_at: iso, discount_percent: 15, prices_json: JSON.stringify({ 'cannaregio-ghetto': 2250 }), cancel_policy_json: JSON.stringify([{ hours: 168, refund: 100 }, { hours: 72, refund: 50 }]), admin_notes: 'Partner di prova: sconto 15%, Cannaregio a 22,50 €, rimborso totale fino a 7 giorni prima e 50% fino a 3 giorni prima.' });
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
  book('Lagoon DMC: guida a ore (4 ore, auricolari) fra 12 giorni, a fattura (sconto 15%, rimborso totale fino a 7 giorni prima)', { tourSlug: 'guida-a-ore', hours: 4, earpieces: true, date: d(12), time: '10:00', pax: 12, channel: 'b2b', account: lagoon, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Rossi' });
  book('Lagoon DMC: San Marco fra 4 giorni, a fattura (dentro i 7 giorni: rimborso 50%, penale 50% se annulla)', { tourSlug: 'san-marco-rialto', date: d(4), time: '14:30', pax: 6, channel: 'b2b', account: lagoon, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Bianchi' });
  book('Blue Sail Tours: San Marco fra 8 giorni, pagata con carta', { tourSlug: 'san-marco-rialto', date: d(8), time: '09:30', pax: 2, channel: 'b2b', account: bluesail, name: 'Luca Neri', email: bluesail.email, lang: 'en', paymentMethod: 'card' }, { paid: true });
  book('Blue Sail Tours: meet & greet fra 5 giorni, a carta', { tourSlug: 'meet-and-greet', hours: 1, date: d(5), time: '10:00', pax: 14, channel: 'b2b', account: bluesail, name: 'Luca Neri', email: bluesail.email, lang: 'en', paymentMethod: 'card', clientRef: 'Arrivo gruppo Miller' }, { paid: true });
  // opzioni: date trattenute senza pagare (la durata dipende da quanto manca al tour; se non si confermano, si liberano da sole)
  book('Lagoon DMC: opzione su Cannaregio fra 40 giorni (10 giorni di opzione, in attesa del cliente finale)', { tourSlug: 'cannaregio-ghetto', date: d(40), time: '10:00', pax: 8, channel: 'b2b', account: lagoon, option: true, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', clientRef: 'Gruppo Conti (preventivo inviato)' });
  book('Blue Sail Tours: opzione sulla guida a ore fra 8 giorni (3 giorni di opzione: scade presto)', { tourSlug: 'guida-a-ore', hours: 4, date: d(8), time: '14:00', pax: 10, channel: 'b2b', account: bluesail, option: true, name: 'Luca Neri', email: bluesail.email, lang: 'en', clientRef: 'Miller group (quote sent)' });
  // già svolte (finiscono in «Da fatturare» e fanno partire la richiesta di recensione)
  book('Laura Bianchi: San Marco di 6 giorni fa, pagata con carta', { tourSlug: 'san-marco-rialto', date: d(-6), time: '09:30', pax: 2, name: 'Laura Bianchi', email: 'laura.bianchi@example.com', lang: 'it', paymentMethod: 'card' }, { paid: true, at: earlier });
  book('Lagoon DMC: guida di 3 ore di 5 giorni fa, a fattura (da incassare e da fatturare)', { tourSlug: 'guida-a-ore', hours: 3, date: d(-5), time: '10:00', pax: 5, channel: 'b2b', account: lagoon, name: 'Giulia Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Verdi' }, { at: earlier });

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

  // storico dei mesi scorsi: serve a dare qualcosa da guardare alle statistiche (andamento, prodotti, partner, annulli)
  const history = seedHistory({ lagoon, bluesail, d, now });
  tries.push(`✓ Storico: ${history.created} prenotazioni dei mesi scorsi (${history.cancelled} annullate), ${history.feedback} feedback (${history.featured} già sul sito), per le statistiche`);

  console.log('\nDati d\'esempio creati:\n  ' + tries.join('\n  '));
  return giftCode;
}

const giftCode = fresh ? await seed() : null;

const http = server.listen(Number(PORT), () => {
  console.log(`
═══════════════ SITO DI PROVA ═══════════════
Sito         http://localhost:${PORT}
Pannello     http://localhost:${PORT}/admin        password: admin
Email        http://localhost:${PORT}/admin/mail   (le email non partono: le leggi qui)
Pagamenti    simulati (nessuna carta vera)
Partner      giulia@lagoon-dmc.example  (approvato: sconto 15%, un prezzo dedicato, annullo a scaglioni, paga a fattura)
             luca@bluesail.example      (approvato, condizioni standard, solo carta)
             password di entrambi: prova-prova-1      (Rialto Travel è "da approvare")
Codici       sconto PROVA10${giftCode ? `   ·   buono regalo ${giftCode}` : ''}
Dati         ${path.relative(ROOT, DIR) || DIR}/   (npm run sandbox -- --reset per ricominciare)
Ctrl+C per fermare.
`);
});
http.requestTimeout = REQUEST_TIMEOUT_MS;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
