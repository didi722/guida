import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../server/bookings.js';
import { fold, renderGiftCardPdf, renderProposalPdf, renderVoucherPdf } from '../server/pdf.js';
import { createProgramRequest, markQuoted, saveProposal } from '../server/programs.js';
import { formatGiftCode } from '../server/pricing.js';
import { HAS_PDFTOTEXT, NOW, addAccount, addGift, addPromo, base, isPdf, makeApp, pdfPages, pdfText } from './helpers.js';

// pdftotext separa le lettere dei titoletti spaziati ("S C O N T O"): si confronta senza spazi e senza maiuscole
const squash = (x) => x.replace(/\s+/g, '').toLowerCase();
const has = (text, ...needles) => needles.forEach((n) => assert.ok(squash(text).includes(squash(n)), `nel PDF manca «${n}»\n${text}`));
const hasNot = (text, ...needles) => needles.forEach((n) => assert.ok(!squash(text).includes(squash(n)), `nel PDF non dovrebbe esserci «${n}»`));

const needText = { skip: HAS_PDFTOTEXT ? false : 'pdftotext (poppler) non installato: i controlli sul testo dei PDF vengono saltati' };

function appWithRealTour(over = {}) {
  const app = makeApp({ site: { vatNumber: 'IT01234567890', guideLicense: 'Guida turistica abilitata n. 1234', address: 'Calle del Test 1, Venezia', phone: '+39 333 1234567' }, ...over });
  const tour = app.content.tour('shared');
  tour.i18n.it = { ...tour.i18n.it, title: 'Cannaregio e il Ghetto', subtitle: 'La Venezia delle comunità', meetingPoint: 'Ponte delle Guglie, Cannaregio', meetingUrl: 'https://maps.example/guglie', includes: ['Guida abilitata', 'Gruppo di massimo 10 persone'], excludes: ['Ingressi ai musei'], notes: 'Chiediamo un abbigliamento rispettoso.' };
  tour.i18n.en = { ...tour.i18n.en, title: 'Cannaregio and the Ghetto', meetingPoint: 'Ponte delle Guglie, Cannaregio', includes: ['Licensed guide'], excludes: ['Museum tickets'] };
  return app;
}

test('fold: adatta i testi ai glifi del font senza perdere il senso', () => {
  assert.equal(fold('Łukasz Dvořák'), 'Lukasz Dvorák', 'ł e ř si semplificano, á è nel font');
  assert.equal(fold('Perché sì: è già così'), 'Perché sì: è già così', 'le lettere accentate italiane restano');
  assert.equal(fold('10 € – 20 € · «ok» “q” ’ −5'), '10 € – 20 € · «ok» “q” ’ −5');
  assert.equal(fold('a 🎉 b'), 'a  b', 'le emoji si scartano');
  assert.equal(fold('Иван'), '????', 'alfabeti non latini: segnaposto visibile');
  assert.equal(fold('  caffè → tè  '), 'caffè - tè');
  assert.equal(fold('riga1\r\nriga2'), 'riga1\nriga2');
  assert.equal(fold(null), '');
  assert.equal(fold(undefined), '');
});

test('voucher B2C: una pagina con codice, data, punto d’incontro, conti e link di gestione', needText, async () => {
  const app = appWithRealTour();
  addPromo(app.db, { code: 'ESTATE10', kind: 'percent', value: 10 });
  const gift = addGift(app.db, { initial_cents: 5000 });
  const b = createBooking(app, base({ date: '2027-01-12', pax: 3, phone: '+39 333 0000000', notes: 'Un bambino di 8 anni 🙂', promoCode: 'ESTATE10', giftCodes: gift.code, paymentMethod: 'onsite' }), NOW);
  const pdf = await renderVoucherPdf(app, b, { nowMs: NOW });
  assert.ok(isPdf(pdf));
  assert.equal(pdfPages(pdf), 1);
  const text = pdfText(pdf);
  has(text, b.ref, 'Cannaregio e il Ghetto', 'martedì 12 gennaio 2027', '09:30 – 12:00', 'Ponte delle Guglie', 'Mario Rossi', 'mario@example.com', 'Un bambino di 8 anni', '105 €', 'ESTATE10', '−10,50 €', '−50 €', '44,50 €', 'da pagare il giorno del servizio', 'Guida abilitata', 'Ingressi ai musei', 'abbigliamento rispettoso', 'Mostra questo voucher', 'Guida turistica abilitata n. 1234', 'P.IVA IT01234567890', 'Puoi annullare gratuitamente fino a 10 gen 2027, 09:30');
  has(text, `/it/booking/${b.ref}?t=${b.token}`);

  const en = pdfText(await renderVoucherPdf(app, b, { lang: 'en', nowMs: NOW }));
  has(en, 'Booking voucher', 'Tuesday, 12 January 2027', 'Booked by', 'You can cancel for free until 10 Jan 2027, 09:30', 'Licensed guide');
});

test('voucher B2B: niente prezzi, niente recapiti di chi ha prenotato, niente link di gestione', needText, async () => {
  const app = appWithRealTour();
  const acct = addAccount(app.db, { company: 'Venice DMC' });
  const b = createBooking(app, base({ date: '2027-01-13', time: '14:30', pax: 8, channel: 'b2b', account: acct, paymentMethod: 'invoice', clientRef: 'PRATICA 42 – Gruppo Smith', name: 'Anna Verdi' }), NOW);
  const pdf = await renderVoucherPdf(app, b, { nowMs: NOW });
  assert.equal(pdfPages(pdf), 1);
  const text = pdfText(pdf);
  has(text, b.ref, 'Venice DMC', 'PRATICA 42 – Gruppo Smith', 'Anna Verdi', 'Nessun pagamento da effettuare sul posto', '14:30 – 17:00');
  hasNot(text, '€', 'mario@example.com', 'booking/VE-', 'annullare', 'cancel');
});

test('buono regalo: importo, codice a gruppi di quattro, destinatario con nome non latino, messaggio senza emoji, scadenza senza giorno della settimana', needText, async () => {
  const app = appWithRealTour();
  const card = addGift(app.db, { initial_cents: 5000, buyer_name: 'Anna Verdi', recipient_name: 'Łukasz Kowalski', message: 'Buon compleanno! 🎉 Una passeggiata insieme.' });
  const pdf = await renderGiftCardPdf(app, card, 'it');
  assert.equal(pdfPages(pdf), 1);
  const text = pdfText(pdf);
  has(text, 'Buono regalo', '50 €', 'Per Lukasz Kowalski', 'Da parte di Anna Verdi', '«Buon compleanno! Una passeggiata insieme.»', 'Valido fino al 31 dicembre 2028', 'Come si usa', 'rimborsabile né convertibile in denaro', formatGiftCode(card.code));
  assert.ok(!/Valido fino al (lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)/i.test(text), 'scadenza senza giorno della settimana');

  const en = pdfText(await renderGiftCardPdf(app, { ...card, balance_cents: 3000 }, 'en'));
  has(en, 'Gift card', 'Valid until 31 December 2028', 'From Anna Verdi', 'Balance: €30');
});

test('proposta: titolo, giornate, totali, validità e link; molte giornate scorrono su più pagine con intestazione e numeri di pagina', needText, async () => {
  const app = appWithRealTour();
  const p = createProgramRequest(app, { name: 'Giulia Bianchi', email: 'giulia@example.com', company: 'Famiglia Bianchi', participants: 4, dateFrom: '2027-02-10', dateTo: '2027-02-12', lang: 'it' }, NOW);
  const days = [
    { date: '2027-02-10', start: '09:30', end: '13:00', title: 'San Marco, Rialto e i sestieri', description: 'Il cuore della città.', priceCents: 18000 },
    { date: '2027-02-11', start: '10:00', end: '16:00', title: 'Isole della laguna', priceCents: 42000 },
    { date: '2027-02-12', start: '09:30', end: '12:30', title: 'Cannaregio e il Ghetto', priceCents: 15050 },
  ];
  saveProposal(app, p.id, { title: 'Venezia in tre giorni', intro: 'Ecco la proposta.', notes: 'Incluso: guida abilitata.', depositPercent: 30, validUntil: '2027-01-20', holdDates: true, days }, { nowMs: NOW });
  markQuoted(app, p.id, NOW);
  const row = app.db.prepare('SELECT * FROM programs WHERE id = ?').get(p.id);
  const pdf = await renderProposalPdf(app, row, 'it');
  assert.equal(pdfPages(pdf), 1);
  const text = pdfText(pdf);
  has(text, 'Venezia in tre giorni', 'Preparata per Giulia Bianchi, Famiglia Bianchi', 'Ecco la proposta', 'San Marco, Rialto e i sestieri', 'Il cuore della città', '180 €', '150,50 €', '750,50 €', 'Acconto per confermare (30%)', '225,15 €', '525,35 €', 'Proposta valida fino al 20 gennaio 2027', 'Incluso: guida abilitata', p.ref, `/it/programs/${p.ref}?t=${p.token}`);

  // molte righe: più pagine, intestazione compatta e "Pagina n di N"
  const many = Array.from({ length: 38 }, (_, i) => ({ date: '2027-03-01', start: '09:00', end: '10:00', title: `Visita numero ${i + 1}`, description: 'Una descrizione abbastanza lunga da occupare più di una riga nella tabella del programma, per verificare l’impaginazione.', priceCents: 1000 }));
  const q = createProgramRequest(app, { name: 'Marco', email: 'm@example.com', participants: 2, lang: 'en' }, NOW);
  saveProposal(app, q.id, { title: 'Long programme', depositPercent: 0, validUntil: '2027-01-20', days: many }, { nowMs: NOW });
  const big = await renderProposalPdf(app, app.db.prepare('SELECT * FROM programs WHERE id = ?').get(q.id), 'en');
  assert.ok(pdfPages(big) >= 3, `pagine: ${pdfPages(big)}`);
  const bigText = pdfText(big);
  assert.match(bigText, /Page 1 of \d+/);
  assert.match(bigText, /Page 2 of \d+/);
  has(bigText, 'Visita numero 38');
  assert.equal((bigText.match(/Davide Tomio/g) ?? []).length >= pdfPages(big), true, 'intestazione su ogni pagina');
});

test('le email allegano i PDF: voucher (anche B2B), buono regalo e proposta', async () => {
  const app = appWithRealTour({ mail: { notifyTo: 'guida@example.com' } });
  const acct = addAccount(app.db);
  const pdfsOf = (m) => m.attachments.filter((a) => a.contentType === 'application/pdf');

  await app.services.book(base({ date: '2027-01-12' }), 'it', NOW);
  await app.services.book(base({ date: '2027-01-13', time: '14:30', channel: 'b2b', account: acct, paymentMethod: 'invoice', email: 'dmc@example.com', pax: 5 }), 'it', NOW);
  for (const to of ['mario@example.com', 'dmc@example.com']) {
    const m = app.mail.sent.find((x) => x.to === to && /confermata/i.test(x.subject));
    const [pdf] = pdfsOf(m);
    assert.match(pdf.filename, /^voucher-VE-\w+\.pdf$/, to);
    assert.ok(isPdf(pdf.content));
    assert.ok(m.attachments.some((a) => /\.ics$/.test(a.filename)));
  }

  const p = createProgramRequest(app, { name: 'Giulia', email: 'giulia@example.com', participants: 4, lang: 'it' }, NOW);
  saveProposal(app, p.id, { title: 'Venezia', depositPercent: 30, validUntil: '2027-01-20', days: [{ date: '2027-02-10', start: '09:30', end: '13:00', title: 'Giornata', priceCents: 18000 }] }, { nowMs: NOW });
  await app.programs.send(p.id, NOW);
  const proposal = app.mail.sent.find((m) => m.to === 'giulia@example.com' && /La tua proposta/.test(m.subject));
  assert.equal(pdfsOf(proposal)[0].filename, `proposta-${p.ref}.pdf`);
  assert.ok(isPdf(pdfsOf(proposal)[0].content));
});

test('se il PDF non si riesce a generare la mail parte lo stesso, senza allegato, e l’errore viene registrato', async (t) => {
  const app = appWithRealTour();
  const acct = addAccount(app.db);
  const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', date: '2027-01-13', time: '14:30', pax: 5 }), NOW);
  const prepare = app.db.prepare.bind(app.db);
  t.mock.method(app.db, 'prepare', (sql) => {
    if (/FROM accounts/.test(sql)) throw new Error('db rotto'); // solo il voucher B2B legge la tabella dei partner
    return prepare(sql);
  });
  const errors = [];
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
  const { sendBookingConfirmed } = await import('../server/emails.js');
  await sendBookingConfirmed(app, b, NOW);
  const m = app.mail.sent.at(-1);
  assert.match(m.subject, /confermata/i);
  assert.deepEqual(m.attachments.map((a) => a.filename.replace(/VE-\w+/, 'REF')), ['REF.ics']);
  assert.ok(errors.some((e) => /\[pdf\] voucher non generato: db rotto/.test(e)), errors.join('\n'));
});
