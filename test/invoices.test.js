import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmPaid, createBooking } from '../server/bookings.js';
import { InvoiceError, configProblems, createCreditNote, createDrafts, createManualDraft, deleteDraft, discardIssued, getInvoice, invoiceDetail, invoiceLines, invoiceQueue, invoicesCsv, issueInvoice, optionsOf, saveDraft, setSdiStatus } from '../server/invoices.js';
import { createProgramRequest, markDepositPaid, markQuoted, saveProposal } from '../server/programs.js';
import { localToInstant } from '../server/time.js';
import { HAS_PDFTOTEXT, addAccount, addGift, base, isPdf, makeApp, NOW, pdfText } from './helpers.js';
import { renderInvoicePdf } from '../server/pdf-invoice.js';
import { validateInvoiceXml } from './xsd.js';

const SELLER_CF = 'RSSMRA80A01H501U';
const LATER = localToInstant('2027-01-20', '10:00'); // le prenotazioni del 12-13 gennaio sono state svolte

function appFor(invoice = {}, over = {}) {
  return makeApp({
    site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { seller: { fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } }, ...invoice },
    ...over,
  });
}
const person = (over = {}) => ({ kind: 'person', firstName: 'Matteo', lastName: 'Moretti', country: 'IT', taxCode: 'MRTMTT91D08F205J', address: 'Via Roma 1', zip: '20100', city: 'Milano', province: 'MI', ...over });
/** Salva la bozza così com'è, ma con l'intestatario completo. */
function fill(app, id, buyer = person(), extra = {}) {
  const d = invoiceDetail(app, id);
  const lines = d.lines.map((l) => ({ key: l.source_type ? `${l.source_type}:${l.source_id}` : undefined, description: l.description, amountCents: l.amount_cents }));
  return saveDraft(app, id, { buyer, lines, issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: d.options.contributionPercent, withholdingPercent: d.options.withholdingPercent, notes: d.options.notes, dueDate: d.options.dueDate }, ...extra }, NOW);
}
const paidCard = (app, over = {}) => {
  const b = createBooking(app, base({ paymentMethod: 'card', ...over }), NOW);
  confirmPaid(app, b.id, 'pi_test', NOW);
  return app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id);
};
const keys = (queue) => queue.map((x) => x.key);

test('dati fiscali: finché mancano i dati del cedente non si può emettere', () => {
  const app = makeApp();
  const problems = configProblems(app.cfg);
  assert.ok(problems.length >= 5, problems.join('\n'));
  assert.deepEqual(configProblems(appFor().cfg), []);
  assert.match(configProblems(appFor({ vatBp: 2200, nature: '', seller: { regime: 'RF19', fiscalCode: SELLER_CF, firstName: 'M', lastName: 'R', address: { street: 'v', zip: '30100', city: 'V', province: 'VE' } } }).cfg).join(' '), /forfettario.*non prevede IVA/);
});

test('coda: prenotazioni pagate o già svolte, buoni venduti, programmi conclusi; non ciò che è annullato, in attesa o ancora da svolgere e da pagare', () => {
  const app = appFor();
  const paid = paidCard(app, { date: '2027-02-10', time: '09:30' }); // pagata online, servizio futuro
  const onsiteFuture = createBooking(app, base({ date: '2027-02-11', time: '09:30' }), NOW); // da pagare sul posto, futura
  const onsitePast = createBooking(app, base({ date: '2027-01-12', time: '09:30', email: 'b@example.com' }), NOW);
  const cancelled = createBooking(app, base({ date: '2027-01-13', time: '09:30', email: 'c@example.com' }), NOW);
  app.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(cancelled.id);
  createBooking(app, base({ date: '2027-01-13', time: '14:30', paymentMethod: 'card', email: 'held@example.com' }), NOW); // in attesa di pagamento
  const gift = addGift(app.db, { initial_cents: 5000, source: 'web', buyer_name: 'Anna Verdi', buyer_email: 'anna@example.com' });
  const draftGift = addGift(app.db, { initial_cents: 3000, status: 'pending' });

  const q = invoiceQueue(app, LATER);
  assert.deepEqual(keys(q).sort(), [`booking:${paid.id}`, `booking:${onsitePast.id}`, `gift:${gift.id}`].sort());
  assert.ok(!keys(q).includes(`gift:${draftGift.id}`), 'un buono non ancora pagato non si fattura');
  assert.ok(!keys(q).includes(`booking:${onsiteFuture.id}`));

  const item = q.find((x) => x.key === `booking:${paid.id}`);
  assert.equal(item.amountCents, 7000);
  assert.equal(item.dueBy, '2027-01-16', 'pagata il 4 gennaio: 12 giorni da lì (prima del servizio)');
  assert.equal(item.overdue, true, 'oltre i 12 giorni a LATER');
  assert.deepEqual(item.payments, [{ method: 'MP08', cents: 7000, paid: true }]);
  const past = q.find((x) => x.key === `booking:${onsitePast.id}`);
  assert.equal(past.dueBy, '2027-01-24');
  assert.equal(past.overdue, false);
  assert.match(past.description, /Tour di prova – 12 gen 2027 ore 09:30 – 2 persone/);
  assert.equal(q.find((x) => x.type === 'gift').amountCents, 5000);
});

test('coda: la parte pagata con buono regalo non si fattura di nuovo (buono monouso), oppure sì (buono multiuso)', () => {
  const sale = appFor();
  const g = addGift(sale.db, { initial_cents: 5000 });
  const b = createBooking(sale, base({ date: '2027-01-12', time: '09:30', pax: 3, giftCodes: g.code, paymentMethod: 'onsite' }), NOW); // 105 € − 50 € buono
  const item = invoiceQueue(sale, LATER).find((x) => x.key === `booking:${b.id}`);
  assert.equal(item.amountCents, 5500);

  const redeem = appFor({ giftInvoiceAt: 'redemption' });
  const g2 = addGift(redeem.db, { initial_cents: 5000 });
  const b2 = createBooking(redeem, base({ date: '2027-01-12', time: '09:30', pax: 3, giftCodes: g2.code, paymentMethod: 'onsite' }), NOW);
  const q = invoiceQueue(redeem, LATER);
  const full = q.find((x) => x.key === `booking:${b2.id}`);
  assert.equal(full.amountCents, 10500, 'multiuso: la fattura è per l’intero importo');
  assert.deepEqual(full.payments, [{ method: 'MP01', cents: 5500, paid: false }, { method: null, cents: 5000, paid: true }]);
  assert.ok(!q.some((x) => x.type === 'gift'), 'multiuso: i buoni non si fatturano alla vendita');

  const fully = appFor();
  const g3 = addGift(fully.db, { initial_cents: 20000 });
  createBooking(fully, base({ date: '2027-01-12', time: '09:30', pax: 3, giftCodes: g3.code }), NOW);
  assert.ok(!invoiceQueue(fully, LATER).some((x) => x.type === 'booking'), 'pagata tutta col buono: nulla da fatturare');
});

test('bozza da una prenotazione di un privato: intestatario, riga, importi; poi emissione numerata con XML valido', async () => {
  const app = appFor();
  const b = paidCard(app, { date: '2027-01-12', time: '09:30', name: 'Matteo Moretti', pax: 3 });
  const [draft] = createDrafts(app, [`booking:${b.id}`], LATER);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.total_cents, 10500);
  assert.equal(draft.bollo_cents, 200);
  const d = invoiceDetail(app, draft.id);
  assert.equal(d.buyer.kind, 'person');
  assert.equal(d.buyer.firstName, 'Matteo');
  assert.equal(d.buyer.lastName, 'Moretti');
  assert.equal(d.buyer.country, 'IT');
  assert.equal(d.options.bolloCharged, false, 'già pagata col prezzo pieno: il bollo lo assorbi tu');
  assert.ok(d.problems.some((p) => /codice fiscale/.test(p)), 'manca il codice fiscale');
  assert.throws(() => issueInvoice(app, draft.id, LATER), (e) => e instanceof InvoiceError && e.code === 'buyer' && e.problems.some((p) => /codice fiscale/.test(p)));

  fill(app, draft.id);
  const inv = issueInvoice(app, draft.id, LATER);
  assert.equal(inv.status, 'issued');
  assert.equal(inv.number, '1/2027');
  assert.equal(inv.year, 2027);
  assert.equal(inv.issue_date, '2027-01-20');
  assert.match(inv.file_name, /^IT12345678903_[0-9A-Z]{5}\.xml$/);
  const r = await validateInvoiceXml(inv.xml);
  assert.ok(r.valid, r.errors.join('\n'));
  assert.match(inv.xml, /<Numero>1\/2027<\/Numero>/);
  assert.match(inv.xml, /<ImportoTotaleDocumento>105\.00<\/ImportoTotaleDocumento>/);
  assert.match(inv.xml, /<ModalitaPagamento>MP08<\/ModalitaPagamento>/);
  assert.match(inv.xml, /Regime forfettario/);
  assert.throws(() => issueInvoice(app, draft.id, LATER), { code: 'state' }, 'non si emette due volte');
  assert.throws(() => saveDraft(app, draft.id, { buyer: person(), lines: [] }), { code: 'state' }, 'una fattura emessa non si modifica');

  // la voce non è più in coda
  assert.ok(!keys(invoiceQueue(app, LATER)).includes(`booking:${b.id}`));
  assert.throws(() => createDrafts(app, [`booking:${b.id}`], LATER), { code: 'source' });
});

test('numerazione: progressiva senza buchi per anno, in ordine di data; niente date future', async () => {
  const app = appFor();
  const make = (date, nowMs) => {
    const d = createManualDraft(app, nowMs);
    saveDraft(app, d.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: date, options: { bolloCharged: true } }, nowMs);
    return d.id;
  };
  const a = issueInvoice(app, make('2027-01-20', LATER), LATER);
  const b = issueInvoice(app, make('2027-01-21', LATER + 86400_000), LATER + 86400_000);
  assert.deepEqual([a.number, b.number], ['1/2027', '2/2027']);
  assert.throws(() => issueInvoice(app, make('2027-01-19', LATER + 86400_000), LATER + 86400_000), (e) => e.code === 'date' && /ordine di data/.test(e.message));
  assert.throws(() => issueInvoice(app, make('2027-02-01', LATER + 86400_000), LATER + 86400_000), { code: 'date' }, 'data futura');
  const next = issueInvoice(app, make('2027-01-21', LATER + 86400_000), LATER + 86400_000);
  assert.equal(next.number, '3/2027', 'i tentativi falliti non consumano numeri');
  // nuovo anno: si riparte da 1
  const jan28 = localToInstant('2028-01-10', '10:00');
  const y = issueInvoice(app, make('2028-01-10', jan28), jan28);
  assert.equal(y.number, '1/2028');
  assert.equal((await validateInvoiceXml(y.xml)).valid, true);
  assert.notEqual(a.file_name, b.file_name, 'ogni file ha un progressivo diverso');
});

test('partner B2B: più prenotazioni nella stessa fattura, bonifico a 30 giorni, bollo addebitato, intestatario dall’account', async () => {
  const app = appFor();
  const acct = addAccount(app.db, { company: 'Venice DMC S.r.l.', vat: 'IT00743110157', country: 'IT', sdi_code: 'abcdefg', address: 'Fondamenta Nuove 10' });
  const mk = (date, time, ref) => createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', date, time, pax: 5, clientRef: ref, name: 'Anna' }), NOW);
  const b1 = mk('2027-01-12', '16:00', 'PRATICA 42');
  const b2 = mk('2027-01-13', '16:00', 'PRATICA 43');
  const other = addAccount(app.db, { email: 'altro@example.com', company: 'Altra Agenzia' });
  const b3 = createBooking(app, base({ channel: 'b2b', account: other, paymentMethod: 'invoice', tourSlug: 'private', date: '2027-01-14', time: '16:00', pax: 4 }), NOW);

  const drafts = createDrafts(app, [`booking:${b1.id}`, `booking:${b2.id}`, `booking:${b3.id}`], LATER);
  assert.equal(drafts.length, 2, 'una fattura per partner');
  const mine = drafts.find((d) => d.account_id === acct.id);
  const detail = invoiceDetail(app, mine.id);
  assert.equal(detail.lines.length, 2);
  assert.match(detail.lines[0].description, /PRATICA 42/);
  assert.equal(mine.total_cents, 2 * 12000 + 200, 'due servizi da 120 € (tariffa B2B) più il bollo addebitato');
  assert.equal(detail.options.bolloCharged, true);
  assert.equal(detail.options.dueDate, '2027-02-19', '30 giorni dalla data della fattura');
  assert.equal(detail.buyer.vat, '00743110157', 'IT tolto dalla partita IVA');
  assert.equal(detail.buyer.sdiCode, 'ABCDEFG');
  assert.deepEqual(detail.payments.map((p) => [p.method, p.cents, p.paid]), [['MP05', 24200, false]]);

  assert.throws(() => issueInvoice(app, mine.id, LATER), { code: 'buyer' }, 'mancano CAP, comune, provincia');
  saveDraft(app, mine.id, { buyer: { ...detail.buyer, zip: '30121', city: 'Venezia', province: 've' }, lines: detail.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: '2027-01-20', options: { bolloCharged: true, dueDate: '2027-02-19' } }, LATER);
  const inv = issueInvoice(app, mine.id, LATER);
  const r = await validateInvoiceXml(inv.xml);
  assert.ok(r.valid, r.errors.join('\n'));
  assert.match(inv.xml, /<CodiceDestinatario>ABCDEFG<\/CodiceDestinatario>/);
  assert.match(inv.xml, /<DataScadenzaPagamento>2027-02-19<\/DataScadenzaPagamento>/);
  assert.match(inv.xml, /<ImportoTotaleDocumento>242\.00<\/ImportoTotaleDocumento>/);
  // i dati strutturati restano sull'account per la fattura successiva
  const saved = JSON.parse(app.db.prepare('SELECT billing_json FROM accounts WHERE id = ?').get(acct.id).billing_json);
  assert.deepEqual([saved.zip, saved.city, saved.province], ['30121', 'Venezia', 'VE']);
  const b4 = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', date: '2027-01-15', time: '16:00', pax: 5 }), NOW);
  const [next] = createDrafts(app, [`booking:${b4.id}`], LATER);
  assert.equal(invoiceDetail(app, next.id).buyer.city, 'Venezia');
  assert.deepEqual(invoiceDetail(app, next.id).problems, [], 'la seconda fattura nasce già completa');
});

test('partner B2B: la partita IVA salvata con il prefisso del paese (come la scrive la registrazione) va in fattura senza prefisso', () => {
  const app = appFor();
  const cases = [
    ['it@example.com', 'IT', 'IT12345678903', '12345678903'],
    ['de@example.com', 'DE', 'DE123456789', '123456789'],
    ['gr@example.com', 'GR', 'EL123456789', '123456789'],
    ['es@example.com', 'ES', 'ESB12345678', 'B12345678'],
    ['ch@example.com', 'CH', 'CHE-123.456.789 MWST', 'CHE-123.456.789MWST'],
  ];
  cases.forEach(([email, country, vat], i) => {
    const acct = addAccount(app.db, { email, company: `Agenzia ${country}`, vat, country });
    const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', date: `2027-01-${12 + i}`, time: '16:00', pax: 5 }), NOW);
    const [draft] = createDrafts(app, [`booking:${b.id}`], LATER);
    const buyer = invoiceDetail(app, draft.id).buyer;
    assert.deepEqual([buyer.country, buyer.vat], [country, cases[i][3]], vat);
  });
});

test('rimuovere una riga da una bozza libera la voce; eliminare la bozza libera tutto', () => {
  const app = appFor();
  const a = paidCard(app, { date: '2027-01-12', time: '09:30' });
  const b = paidCard(app, { date: '2027-01-13', time: '09:30' });
  const [draft] = createDrafts(app, [`booking:${a.id}`, `booking:${b.id}`], LATER);
  assert.equal(invoiceLines(app.db, draft.id).length, 2);
  assert.deepEqual(keys(invoiceQueue(app, LATER)), []);
  const d = invoiceDetail(app, draft.id);
  saveDraft(app, draft.id, { buyer: d.buyer, lines: [{ key: `booking:${a.id}`, description: 'Solo il primo', amountCents: 7000 }, { description: 'Extra a mano', amountCents: 1500 }], issueDate: d.inv.issue_date, options: {} }, LATER);
  assert.deepEqual(keys(invoiceQueue(app, LATER)), [`booking:${b.id}`], 'la seconda voce è di nuovo in coda');
  assert.equal(getInvoice(app.db, draft.id).total_cents, 8500);
  assert.throws(() => saveDraft(app, draft.id, { buyer: d.buyer, lines: [{ description: '', amountCents: 100 }] }), { code: 'lines' });
  assert.throws(() => saveDraft(app, draft.id, { buyer: d.buyer, lines: [{ description: 'x1', amountCents: 0 }] }), { code: 'amount' });
  deleteDraft(app, draft.id);
  assert.deepEqual(keys(invoiceQueue(app, LATER)).sort(), [`booking:${a.id}`, `booking:${b.id}`].sort());
});

test('nota di credito: bozza collegata, numerazione condivisa, storno totale libera le voci, parziale no', async () => {
  const app = appFor();
  const b = paidCard(app, { date: '2027-01-12', time: '09:30', pax: 4 }); // 140 €
  const [draft] = createDrafts(app, [`booking:${b.id}`], LATER);
  fill(app, draft.id);
  const inv = issueInvoice(app, draft.id, LATER);
  assert.throws(() => createCreditNote(app, draft.id + 99), { code: 'notfound' });

  const credit = createCreditNote(app, inv.id, LATER);
  assert.equal(credit.doc_type, 'TD04');
  assert.equal(credit.related_id, inv.id);
  assert.equal(credit.total_cents, 14000);
  assert.equal(credit.bollo_cents, 0, 'niente bollo sulla nota di credito');
  assert.throws(() => createCreditNote(app, inv.id, LATER), { code: 'state' }, 'una sola bozza alla volta');

  // storno parziale di 40 €
  const dPartial = invoiceDetail(app, credit.id);
  saveDraft(app, credit.id, { buyer: dPartial.buyer, lines: [{ description: 'Storno parziale', amountCents: 4000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const partial = issueInvoice(app, credit.id, LATER);
  assert.equal(partial.number, '2/2027');
  const x = await validateInvoiceXml(partial.xml);
  assert.ok(x.valid, x.errors.join('\n'));
  assert.match(partial.xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(partial.xml, /<IdDocumento>1\/2027<\/IdDocumento>/);
  assert.match(partial.xml, /Nota di credito relativa alla fattura n\. 1\/2027 del 20 gennaio 2027/);
  assert.equal(getInvoice(app.db, inv.id).credited, 0);
  assert.ok(!keys(invoiceQueue(app, LATER)).includes(`booking:${b.id}`), 'storno parziale: la prenotazione resta fatturata');

  // il resto: 100 €
  const credit2 = createCreditNote(app, inv.id, LATER);
  saveDraft(app, credit2.id, { buyer: dPartial.buyer, lines: [{ description: 'Storno del resto', amountCents: 10000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const second = issueInvoice(app, credit2.id, LATER);
  assert.equal(second.number, '3/2027');
  assert.equal(getInvoice(app.db, inv.id).credited, 1, 'stornata per intero');
  assert.ok(keys(invoiceQueue(app, LATER)).includes(`booking:${b.id}`), 'ora la prenotazione si può fatturare di nuovo');
  assert.throws(() => createCreditNote(app, inv.id, LATER), { code: 'state' }, 'già stornata');
  assert.throws(() => createCreditNote(app, second.id, LATER), { code: 'state' }, 'non si storna una nota di credito');
  // e si può rifare la fattura giusta
  const [again] = createDrafts(app, [`booking:${b.id}`], LATER);
  assert.equal(again.total_cents, 14000);
});

test('annullare l’ultima fattura mai inviata libera il numero; non le altre né quelle già partite', () => {
  const app = appFor();
  const make = (date) => {
    const d = createManualDraft(app, LATER);
    saveDraft(app, d.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: date, options: {} }, LATER);
    return issueInvoice(app, d.id, LATER);
  };
  const a = make('2027-01-20');
  const b = make('2027-01-20');
  assert.throws(() => discardIssued(app, a.id), { code: 'state' }, 'non è l’ultima');
  const back = discardIssued(app, b.id);
  assert.equal(back.status, 'draft');
  assert.equal(back.number, null);
  assert.equal(back.xml, null);
  const again = issueInvoice(app, b.id, LATER);
  assert.equal(again.number, '2/2027', 'stesso numero, nessun buco');
  app.db.prepare(`UPDATE invoices SET emailed_at = ? WHERE id = ?`).run(new Date(LATER).toISOString(), b.id);
  assert.throws(() => discardIssued(app, b.id), { code: 'state' }, 'già mandata al cliente');
});

test('esito di SdI: se la fattura è scartata si corregge e si riemette con lo stesso numero e la stessa data', async () => {
  const app = appFor();
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: '2027-01-18', options: {} }, LATER);
  const inv = issueInvoice(app, d.id, LATER);
  assert.throws(() => setSdiStatus(app, createManualDraft(app, LATER).id, 'sent'), { code: 'state' }, 'una bozza non ha esiti');
  assert.throws(() => setSdiStatus(app, inv.id, 'boh'), { code: 'state' });
  const sent = setSdiStatus(app, inv.id, 'sent', '', LATER);
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sent_at);
  const rejected = setSdiStatus(app, inv.id, 'rejected', '00305: IdFiscaleIVA non valido', LATER);
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.sdi_note, /00305/);

  // correzione: modifica dell'intestatario, data bloccata
  saveDraft(app, inv.id, { buyer: person({ city: 'Torino', province: 'TO', zip: '10100' }), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: '2027-02-28', options: {} }, LATER);
  const fixed = issueInvoice(app, inv.id, LATER);
  assert.equal(fixed.status, 'issued');
  assert.equal(fixed.number, '1/2027');
  assert.equal(fixed.issue_date, '2027-01-18', 'la data resta quella originale');
  assert.match(fixed.xml, /<Comune>Torino<\/Comune>/);
  assert.notEqual(fixed.file_name, inv.file_name, 'nuovo progressivo di invio');
  assert.equal(optionsOf(fixed).attempt, 1);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 2, 'nessuna nuova fattura (l’altra è la bozza del test)');
  assert.equal((await validateInvoiceXml(fixed.xml)).valid, true);
});

test('programma con acconto già versato: pagamenti separati (carta e bonifico sul saldo)', async () => {
  const app = appFor();
  const p = createProgramRequest(app, { name: 'Giulia Bianchi', email: 'giulia@example.com', company: 'Famiglia Bianchi', participants: 4, dateFrom: '2027-01-10', dateTo: '2027-01-12', lang: 'it' }, NOW);
  saveProposal(app, p.id, { title: 'Venezia in tre giorni', depositPercent: 30, validUntil: '2027-01-20', days: [{ date: '2027-01-10', start: '09:30', end: '13:00', title: 'Giorno 1', priceCents: 30000 }, { date: '2027-01-12', start: '09:30', end: '13:00', title: 'Giorno 3', priceCents: 20000 }] }, { nowMs: NOW });
  markQuoted(app, p.id, NOW);
  app.db.prepare(`UPDATE programs SET status = 'accepted', deposit_status = 'pending' WHERE id = ?`).run(p.id);
  markDepositPaid(app.db, p.id, 'pi_dep', NOW);

  const q = invoiceQueue(app, LATER);
  const item = q.find((x) => x.type === 'program');
  assert.equal(item.amountCents, 50000);
  assert.deepEqual(item.payments, [{ method: 'MP08', cents: 15000, paid: true }, { method: 'MP05', cents: 35000, paid: false }]);
  assert.match(item.description, /Programma «Venezia in tre giorni» dal 10 gen 2027 al 12 gen 2027 – 2 giornate/);
  assert.equal(invoiceQueue(app, localToInstant('2027-01-11', '10:00')).some((x) => x.type === 'program'), false, 'non è ancora concluso');

  const [draft] = createDrafts(app, [item.key], LATER);
  fill(app, draft.id, { kind: 'company', name: 'Famiglia Bianchi S.r.l.', country: 'IT', vat: '00743110157', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', sdiCode: '', pec: 'bianchi@pec.example.it' });
  const inv = issueInvoice(app, draft.id, LATER);
  const r = await validateInvoiceXml(inv.xml);
  assert.ok(r.valid, r.errors.join('\n'));
  assert.match(inv.xml, /<ModalitaPagamento>MP08<\/ModalitaPagamento>\s*<ImportoPagamento>150\.00<\/ImportoPagamento>/);
  assert.match(inv.xml, /<ModalitaPagamento>MP05<\/ModalitaPagamento>\s*<DataScadenzaPagamento>2027-02-19<\/DataScadenzaPagamento>\s*<ImportoPagamento>352\.00<\/ImportoPagamento>/, '350 € di saldo più il bollo addebitato');
  assert.match(inv.xml, /<PECDestinatario>bianchi@pec\.example\.it<\/PECDestinatario>/);
});

test('regime ordinario con IVA 22%: prezzi ai privati con IVA inclusa (arrotondamento), ai partner al netto con rivalsa e ritenuta', async () => {
  const app = appFor({ seller: { regime: 'RF01', fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } }, vatBp: 2200, nature: '', notes: '', contributionPercent: 4, withholdingPercent: 20, iban: 'IT60X0542811101000000123456', bank: 'Banca di Prova' });
  assert.deepEqual(configProblems(app.cfg), []);
  const b = paidCard(app, { date: '2027-01-12', time: '09:30', pax: 3, name: 'Matteo Moretti' }); // 105 € IVA inclusa
  const [d1] = createDrafts(app, [`booking:${b.id}`], LATER);
  assert.equal(d1.total_cents, 10500);
  assert.equal(d1.rounding_cents, -1);
  assert.equal(d1.vat_cents, 1894);
  assert.equal(d1.bollo_cents, 0);
  fill(app, d1.id);
  const i1 = issueInvoice(app, d1.id, LATER);
  const r1 = await validateInvoiceXml(i1.xml);
  assert.ok(r1.valid, r1.errors.join('\n'));
  assert.match(i1.xml, /<RegimeFiscale>RF01<\/RegimeFiscale>/);
  assert.match(i1.xml, /<Arrotondamento>-0\.01<\/Arrotondamento>/);

  const acct = addAccount(app.db, { company: 'Venice DMC S.r.l.', vat: '00743110157', country: 'IT', sdi_code: 'ABCDEFG', address: 'Fondamenta Nuove 10' });
  const b2 = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', date: '2027-01-13', time: '16:00', pax: 5 }), NOW);
  const [d2] = createDrafts(app, [`booking:${b2.id}`], LATER);
  assert.equal(optionsOf(d2).vatIncluded, false, 'ai partner i prezzi sono al netto');
  assert.equal(optionsOf(d2).contributionPercent, 4);
  assert.equal(optionsOf(d2).withholdingPercent, 20);
  // 120 € + rivalsa 4% (4,80) = 124,80; IVA 22% = 27,46; totale 152,26; ritenuta 20% su 120 = 24 → da pagare 128,26
  assert.equal(d2.contribution_cents, 480);
  assert.equal(d2.vat_cents, 2746);
  assert.equal(d2.total_cents, 15226);
  assert.equal(d2.withholding_cents, 2400);
  assert.equal(d2.payable_cents, 12826);
  saveDraft(app, d2.id, { buyer: { ...invoiceDetail(app, d2.id).buyer, zip: '30121', city: 'Venezia', province: 'VE' }, lines: [{ key: `booking:${b2.id}`, description: invoiceLines(app.db, d2.id)[0].description, amountCents: 12000 }], issueDate: '2027-01-20', options: { contributionPercent: 4, withholdingPercent: 20, bolloCharged: true, dueDate: '2027-02-19' } }, LATER);
  const i2 = issueInvoice(app, d2.id, LATER);
  const r2 = await validateInvoiceXml(i2.xml);
  assert.ok(r2.valid, r2.errors.join('\n'));
  assert.match(i2.xml, /<ImportoPagamento>128\.26<\/ImportoPagamento>\s*<IstitutoFinanziario>Banca di Prova<\/IstitutoFinanziario>\s*<IBAN>IT60X0542811101000000123456<\/IBAN>/);
  assert.equal(i2.number, '2/2027');
});

test('registro CSV delle fatture emesse', () => {
  const app = appFor();
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: person({ firstName: 'Matteo', lastName: 'Moretti; "il" grande' }), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: '2027-01-20', options: { bolloCharged: true } }, LATER);
  issueInvoice(app, d.id, LATER);
  createManualDraft(app, LATER); // una bozza non compare nel registro
  const csv = invoicesCsv(app, 2027);
  const rows = csv.replace(String.fromCharCode(0xfeff), '').trim().split('\r\n');
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^Numero;Data;Tipo;Cliente/);
  assert.match(rows[1], /^1\/2027;2027-01-20;Fattura;"Matteo Moretti; ""il"" grande";IT;;MRTMTT91D08F205J;102,00;0,00;2,00;0,00;0,00;102,00;102,00;Emessa;;IT12345678903_/);
  assert.equal(invoicesCsv(app, 2026).trim().split('\r\n').length, 1, 'anno senza fatture: solo l’intestazione');
});

// ───── copia di cortesia, email al cliente, invio a SdI ─────
const squash = (x) => x.replace(/\s+/g, '').toLowerCase();
const has = (text, ...needles) => needles.forEach((n) => assert.ok(squash(text).includes(squash(n)), `nel PDF manca «${n}»\n${text}`));
const needText = { skip: HAS_PDFTOTEXT ? false : 'pdftotext (poppler) non installato' };

/** Fattura a un partner con bollo addebitato e bonifico, già emessa. */
function issuedForPartner(app) {
  const acct = addAccount(app.db, { company: 'Venice DMC S.r.l.', vat: 'IT00743110157', country: 'IT', sdi_code: 'ABCDEFG', address: 'Fondamenta Nuove 10' });
  const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', date: '2027-01-12', time: '16:00', pax: 5, clientRef: 'PRATICA 42', email: 'dmc@example.com' }), NOW);
  const [d] = createDrafts(app, [`booking:${b.id}`], LATER);
  const det = invoiceDetail(app, d.id);
  saveDraft(app, d.id, { buyer: { ...det.buyer, zip: '30121', city: 'Venezia', province: 'VE' }, lines: det.lines.map((l) => ({ key: `booking:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: '2027-01-20', options: { bolloCharged: true, dueDate: '2027-02-19' } }, LATER);
  return issueInvoice(app, d.id, LATER);
}

test('copia di cortesia PDF: intestazione, parti, righe con bollo, totali, pagamento con IBAN, causali', needText, async () => {
  const app = appFor({ iban: 'IT60X0542811101000000123456', bank: 'Banca di Prova' });
  const inv = issuedForPartner(app);
  const pdf = await renderInvoicePdf(app, inv);
  assert.ok(isPdf(pdf));
  const text = pdfText(pdf);
  has(text, 'Fattura', 'n. 1/2027 del 20 gennaio 2027', 'Cedente / prestatore', 'Mario Rossi', 'P.IVA IT12345678903', 'C.F. RSSMRA80A01H501U', 'Regime forfettario (RF19)', 'Venice DMC S.r.l.', 'P.IVA IT00743110157', 'Codice destinatario: ABCDEFG', 'rif. PRATICA 42', '120,00 €', 'N2.2', 'Imposta di bollo assolta in modo virtuale', '122,00 €', 'Bonifico – entro il 19 febbraio 2027: 122,00 €', 'IBAN: IT60X0542811101000000123456 · Banca di Prova', 'Legge n. 190/2014', 'Copia di cortesia priva di valore fiscale');

  // nota di credito
  const credit = issueInvoice(app, createCreditNote(app, inv.id, LATER).id, LATER);
  const ct = pdfText(await renderInvoicePdf(app, credit));
  has(ct, 'Nota di credito', 'n. 2/2027', 'Storna la fattura n. 1/2027 del 20 gennaio 2027', 'Storno: Tour di prova');

  // cliente estero: documento in inglese, nome traslitterato
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: { kind: 'person', firstName: 'Łukasz', lastName: 'Kowalski', country: 'PL', address: 'ul. Długa 5/7', zip: '31-001', city: 'Kraków', lang: 'en' }, lines: [{ description: 'Tour per due', amountCents: 9000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const en = pdfText(await renderInvoicePdf(app, issueInvoice(app, d.id, LATER)));
  has(en, 'Invoice', 'no. 3/2027 of 20 January 2027', 'Supplier', 'Customer', 'Lukasz Kowalski', 'Flat-rate regime (RF19)', 'Document total', 'Courtesy copy with no tax value');
});

test('email al cliente: PDF (e XML se richiesto), solo dopo l’emissione, registra l’invio', async () => {
  const app = appFor();
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: person({ lang: 'it' }), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: '2027-01-20', options: {} }, LATER);
  await assert.rejects(() => app.invoices.emailCopy(d.id, 'matteo@example.com', {}, LATER), { code: 'state' }, 'una bozza non si manda');
  const inv = issueInvoice(app, d.id, LATER);
  await assert.rejects(() => app.invoices.emailCopy(inv.id, 'non-una-mail', {}, LATER), { code: 'buyer' });

  const updated = await app.invoices.emailCopy(inv.id, 'matteo@example.com', {}, LATER);
  assert.equal(updated.emailed_at, new Date(LATER).toISOString());
  const m = app.mail.sent.at(-1);
  assert.equal(m.to, 'matteo@example.com');
  assert.match(m.subject, /^Fattura 1\/2027 — /);
  assert.match(m.text, /copia di cortesia della fattura 1\/2027 del 20 gennaio 2027, di 100\s€/);
  assert.deepEqual(m.attachments.map((a) => a.filename), ['fattura-1-2027.pdf']);
  assert.ok(isPdf(m.attachments[0].content));

  await app.invoices.emailCopy(inv.id, 'matteo@example.com', { includeXml: true }, LATER);
  const withXml = app.mail.sent.at(-1);
  assert.deepEqual(withXml.attachments.map((a) => a.filename), ['fattura-1-2027.pdf', inv.file_name]);
  assert.match(withXml.attachments[1].content, /^<\?xml/);
  assert.match(withXml.text, /file XML/);

  // se la mail non parte l'errore si vede e l'invio non risulta registrato
  const fresh = createManualDraft(app, LATER);
  saveDraft(app, fresh.id, { buyer: person({ lang: 'en' }), lines: [{ description: 'Service', amountCents: 10000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const inv2 = issueInvoice(app, fresh.id, LATER);
  const realSend = app.mail.send;
  app.mail.send = async () => false;
  await assert.rejects(() => app.invoices.emailCopy(inv2.id, 'x@example.com', {}, LATER), { code: 'pec' });
  assert.equal(getInvoice(app.db, inv2.id).emailed_at, null);
  app.mail.send = realSend;
  await app.invoices.emailCopy(inv2.id, 'x@example.com', {}, LATER);
  assert.match(app.mail.sent.at(-1).subject, /^Invoice 2\/2027/);
  assert.match(app.mail.sent.at(-1).text, /Hi Matteo,/);
});

test('invio a SdI via PEC: XML allegato col nome corretto, stato «inviata»; senza PEC o con errore resta tutto com’era', async () => {
  const sent = [];
  const pec = { live: true, send: async (m) => { sent.push(m); return true; } };
  const app = makeApp({ site: { vatNumber: 'IT12345678903' }, invoice: { seller: { fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } } }, { pec });
  const draft = createManualDraft(app, LATER);
  saveDraft(app, draft.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: '2027-01-20', options: {} }, LATER);
  await assert.rejects(() => app.invoices.sendToSdi(draft.id, LATER), { code: 'state' }, 'la bozza non si trasmette');
  const inv = issueInvoice(app, draft.id, LATER);
  assert.equal(app.invoices.pecConfigured, true);

  const result = await app.invoices.sendToSdi(inv.id, LATER);
  assert.equal(result.status, 'sent');
  assert.equal(result.sent_at, new Date(LATER).toISOString());
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'sdi01@pec.fatturapa.it');
  assert.equal(sent[0].subject, inv.file_name);
  assert.equal(sent[0].attachments[0].filename, inv.file_name);
  assert.equal(sent[0].attachments[0].content, inv.xml);
  assert.match(sent[0].attachments[0].contentType, /xml/);
  assert.throws(() => discardIssued(app, inv.id, LATER), { code: 'state' }, 'una fattura inviata non si annulla');

  // errore del server PEC: lo stato non cambia
  const second = createManualDraft(app, LATER);
  saveDraft(app, second.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 5000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const inv2 = issueInvoice(app, second.id, LATER);
  pec.send = async () => { throw new Error('535 autenticazione fallita'); };
  const quiet = console.error;
  console.error = () => {};
  try {
    await assert.rejects(() => app.invoices.sendToSdi(inv2.id, LATER), (e) => e.code === 'pec' && /autenticazione fallita/.test(e.message));
  } finally {
    console.error = quiet;
  }
  assert.equal(getInvoice(app.db, inv2.id).status, 'issued');

  // PEC non configurata
  const plain = appFor();
  const d2 = createManualDraft(plain, LATER);
  saveDraft(plain, d2.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 5000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const i3 = issueInvoice(plain, d2.id, LATER);
  assert.equal(plain.invoices.pecConfigured, false);
  await assert.rejects(() => plain.invoices.sendToSdi(i3.id, LATER), (e) => e.code === 'pec' && /PEC non è configurata/.test(e.message));
});

// ───────────── regressioni dalla revisione indipendente ─────────────
const issueManual = (app, date = '2027-01-20', cents = 10000, over = {}) => {
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: cents }], issueDate: date, options: { bolloCharged: true, ...over } }, LATER);
  return issueInvoice(app, d.id, LATER);
};

test('storno totale con bollo addebitato: chiude la fattura e non si può stornare più del dovuto', () => {
  const app = appFor();
  const inv = issueManual(app); // 100 € + 2 € di bollo addebitato
  assert.equal(inv.total_cents, 10200);
  const cn = createCreditNote(app, inv.id, LATER);
  assert.equal(cn.total_cents, 10000, 'il bollo non si storna');
  const done = issueInvoice(app, cn.id, LATER);
  assert.equal(getInvoice(app.db, inv.id).credited, 1, 'stornata per intero anche col bollo');
  assert.equal(done.total_cents, 10000);

  const other = issueManual(app);
  const big = createCreditNote(app, other.id, LATER);
  saveDraft(app, big.id, { buyer: person(), lines: [{ description: 'Storno', amountCents: 500000 }], issueDate: '2027-01-20', options: {} }, LATER);
  assert.throws(() => issueInvoice(app, big.id, LATER), { code: 'amount' }, 'oltre l’importo della fattura');
});

test('storno parziale: la proposta successiva è solo il residuo', () => {
  const app = appFor();
  const inv = issueManual(app);
  const first = createCreditNote(app, inv.id, LATER);
  saveDraft(app, first.id, { buyer: person(), lines: [{ description: 'Storno parziale', amountCents: 4000 }], issueDate: '2027-01-20', options: {} }, LATER);
  issueInvoice(app, first.id, LATER);
  const next = createCreditNote(app, inv.id, LATER);
  assert.equal(next.total_cents, 6000);
  issueInvoice(app, next.id, LATER);
  assert.equal(getInvoice(app.db, inv.id).credited, 1);
});

test('annullare o scartare una nota di credito totale non lascia la fattura “stornata” né fa fatturare due volte', () => {
  const app = appFor();
  const b = paidCard(app, { date: '2027-01-12', time: '09:30' });
  const [d] = createDrafts(app, [`booking:${b.id}`], LATER);
  fill(app, d.id);
  const inv = issueInvoice(app, d.id, LATER);
  const cn = issueInvoice(app, createCreditNote(app, inv.id, LATER).id, LATER);
  assert.equal(getInvoice(app.db, inv.id).credited, 1);
  assert.ok(keys(invoiceQueue(app, LATER)).includes(`booking:${b.id}`));
  assert.throws(() => discardIssued(app, inv.id), { code: 'state' }, 'ha una nota di credito collegata');
  setSdiStatus(app, cn.id, 'rejected', 'scarto', LATER);
  assert.equal(getInvoice(app.db, inv.id).credited, 0, 'la nota è scartata: la fattura è di nuovo valida');
  assert.ok(!keys(invoiceQueue(app, LATER)).includes(`booking:${b.id}`), 'e la prenotazione non si fattura una seconda volta');
  assert.throws(() => createDrafts(app, [`booking:${b.id}`], LATER), { code: 'source' });
});

test('mancata consegna: si può ancora stornare; consegnata è definitiva; da “inviata” non si torna indietro', () => {
  const app = appFor();
  const inv = issueManual(app);
  setSdiStatus(app, inv.id, 'sent', '', LATER);
  setSdiStatus(app, inv.id, 'undelivered', '', LATER);
  assert.ok(createCreditNote(app, inv.id, LATER), 'mancata consegna: si storna');
  setSdiStatus(app, inv.id, 'delivered', '', LATER);
  assert.throws(() => setSdiStatus(app, inv.id, 'rejected', '', LATER), { code: 'state' }, 'consegnata è definitiva');
  const b = issueManual(app);
  setSdiStatus(app, b.id, 'sent', '', LATER);
  assert.throws(() => setSdiStatus(app, b.id, 'issued', '', LATER), { code: 'state' });
});

test('non si fatturano prenotazioni annullate dopo la creazione della bozza', () => {
  const app = appFor();
  const b = paidCard(app, { date: '2027-01-12', time: '09:30' });
  const [d] = createDrafts(app, [`booking:${b.id}`], LATER);
  fill(app, d.id);
  app.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(b.id);
  assert.throws(() => issueInvoice(app, d.id, LATER), { code: 'source' });
  const c = createBooking(app, base({ date: '2027-01-13', time: '09:30', email: 'x@example.com' }), NOW);
  app.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(c.id);
  assert.throws(() => createDrafts(app, [`booking:${c.id}`], LATER), { code: 'source' });
});

test('acconto già pagato con ritenuta: la parte pagata con carta resta intera nei pagamenti', () => {
  const app = appFor({ vatBp: 2200, nature: '', seller: { regime: 'RF01', fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', address: { street: 'v', zip: '30100', city: 'V', province: 'VE' } } });
  const inv = createManualDraft(app, LATER);
  saveDraft(app, inv.id, { buyer: { ...person(), kind: 'company', name: 'Azienda Srl', vat: '01234567897', taxCode: '', sdiCode: 'ABC1234' }, lines: [{ description: 'Servizio', amountCents: 50000 }], issueDate: '2027-01-20', options: { withholdingPercent: 20 } }, LATER);
  const detail = invoiceDetail(app, inv.id);
  const row = app.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').get(inv.id);
  app.db.prepare('UPDATE invoice_lines SET source_payments = ? WHERE id = ?').run(JSON.stringify([{ method: 'MP08', cents: 15000, paid: true }, { method: 'MP05', cents: 35000, paid: false }]), row.id);
  const saved = saveDraft(app, inv.id, { buyer: detail.buyer, lines: [{ description: 'Servizio', amountCents: 50000 }], issueDate: '2027-01-20', options: { withholdingPercent: 20 } }, LATER);
  const pays = JSON.parse(saved.payments_json);
  assert.equal(pays.reduce((a, p) => a + p.cents, 0), saved.payable_cents);
  assert.equal(pays.find((p) => p.method === 'MP08')?.cents ?? 0, 0, 'righe manuali: nessun pagamento carta registrato');
});

test('progressivo del file: unico anche dopo un annullamento; INVOICE_START_DATE; intestatario uguale al cedente', () => {
  const app = appFor({ startDate: '2027-01-16' });
  const a = issueManual(app, '2027-01-20');
  const back = discardIssued(app, a.id);
  const again = issueInvoice(app, back.id, LATER);
  assert.notEqual(again.file_name, a.file_name, 'mai lo stesso nome file');
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: person(), lines: [{ description: 'Servizio', amountCents: 1000 }], issueDate: '2027-01-10', options: {} }, LATER);
  assert.throws(() => issueInvoice(app, d.id, LATER), { code: 'date' }, 'prima della data di avvio');
  const self = createManualDraft(app, LATER);
  saveDraft(app, self.id, { buyer: person({ taxCode: SELLER_CF }), lines: [{ description: 'Servizio', amountCents: 1000 }], issueDate: '2027-01-20', options: {} }, LATER);
  assert.throws(() => issueInvoice(app, self.id, LATER), { code: 'buyer' }, 'fattura a sé stessi');
  const old = paidCard(app, { date: '2027-01-13', time: '09:30' });
  assert.ok(!keys(invoiceQueue(app, LATER)).includes(`booking:${old.id}`), 'prima dell’avvio: fuori dalla coda');
});

test('registro CSV: formule neutralizzate, note di credito in negativo', () => {
  const app = appFor();
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer: person({ firstName: '=HYPERLINK("x")', lastName: 'Test' }), lines: [{ description: 'Servizio', amountCents: 10000 }], issueDate: '2027-01-20', options: {} }, LATER);
  const inv = issueInvoice(app, d.id, LATER);
  issueInvoice(app, createCreditNote(app, inv.id, LATER).id, LATER);
  const csv = invoicesCsv(app, 2027);
  assert.ok(csv.includes(`'=HYPERLINK`), 'apice davanti alla formula');
  assert.match(csv, /Nota di credito;.*;-100,00;/);
});

test('validazione più severa: IBAN, PEC, codice fiscale estero, Regno Unito, natura obsoleta', () => {
  assert.match(configProblems(appFor({ iban: 'IT00' }).cfg).join(' '), /IBAN/);
  assert.deepEqual(configProblems(appFor({ iban: 'IT60X0542811101000000123456' }).cfg), []);
  assert.match(configProblems(appFor({ nature: 'N4.7' }).cfg).join(' '), /natura/);
});
