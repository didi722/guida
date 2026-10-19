// Estratto conto delle agenzie: saldo iniziale e finale, fatture, note di credito e incassi mese per mese, scaduto, servizi del mese, CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelBooking, confirmPaid, createBooking } from '../server/bookings.js';
import { createCreditNote, createDrafts, getInvoice, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { invoiceDue, openPartsCents } from '../server/invoicePayments.js';
import { ledger, lastDayOf, normMonth, statementCsv, statementOf, statementRange } from '../server/statement.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const LATER = localToInstant('2027-01-20', '10:00'); // le prenotazioni del 12-15 gennaio sono state svolte
const TODAY = localToInstant('2027-02-03', '10:00');
const SELLER_CF = 'RSSMRA80A01H501U';

function appFor() {
  return makeApp({ site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' }, invoice: { seller: { fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } } });
}
const buyer = (acct) => ({ kind: 'company', name: acct.company, country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: acct.email, lang: 'it' });

/** Salva la bozza con l'intestatario completo, senza cambiare altro. */
function fill(app, id, acct, lines) {
  const d = invoiceDetail(app, id);
  return saveDraft(app, id, { buyer: buyer(acct), lines: lines ?? d.lines.map((l) => ({ key: l.source_type ? `${l.source_type}:${l.source_id}` : undefined, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } }, NOW);
}

let slot = 0;
/** Una prenotazione a fattura dell'agenzia (giorno diverso a ogni chiamata, già svolta a LATER). */
function booking(app, acct, over = {}) {
  const n = slot++;
  return createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', name: 'Anna', email: acct.email, date: `2027-01-${String(5 + (n % 14)).padStart(2, '0')}`, time: n % 2 ? '14:30' : '09:30', pax: 2, clientRef: `Pratica ${n}`, ...over }), NOW);
}
/** Emette una fattura con le prenotazioni indicate; poi ne fissa la data e la scadenza (le fatture di prova nascono tutte a LATER). */
function invoice(app, acct, bookings, { date, due } = {}) {
  const [draft] = createDrafts(app, bookings.map((b) => `booking:${b.id}`), LATER);
  fill(app, draft.id, acct);
  const inv = issueInvoice(app, draft.id, LATER);
  return restyle(app, inv.id, { date, due });
}
function restyle(app, id, { date, due, paid, method = 'bank' } = {}) {
  const inv = getInvoice(app.db, id);
  if (date) app.db.prepare('UPDATE invoices SET issue_date = ? WHERE id = ?').run(date, id);
  if (due) app.db.prepare('UPDATE invoices SET payments_json = ? WHERE id = ?').run(JSON.stringify(JSON.parse(inv.payments_json).map((p) => (p.dueDate ? { ...p, dueDate: due } : p))), id);
  if (paid) app.db.prepare('UPDATE invoices SET paid_at = ?, paid_method = ? WHERE id = ?').run(new Date(localToInstant(paid, '11:00')).toISOString(), method, id);
  return getInvoice(app.db, id);
}
/** Una nota di credito (per intero, o per l'importo indicato) emessa il giorno indicato. */
function creditNote(app, acct, inv, { date, cents } = {}) {
  const draft = createCreditNote(app, inv.id, LATER);
  fill(app, draft.id, acct, cents ? [{ description: 'Storno parziale', amountCents: cents }] : undefined);
  const cn = issueInvoice(app, draft.id, LATER);
  return restyle(app, cn.id, { date });
}
const world = () => {
  const app = appFor();
  const acct = addAccount(app.db, { email: 'anna@lagoon.example', company: 'Lagoon DMC', contact_name: 'Anna Bianchi', vat: '01234567897', country: 'IT' });
  return { app, acct };
};

test('mesi: il formato, il mese in corso e il primo mese con qualcosa', () => {
  assert.equal(lastDayOf('2027-02'), '2027-02-28');
  assert.equal(lastDayOf('2028-02'), '2028-02-29');
  assert.equal(lastDayOf('2027-12'), '2027-12-31');
  assert.equal(normMonth('2027-01', '2027-02-03'), '2027-01');
  assert.equal(normMonth('2027-02', '2027-02-03'), '2027-02');
  for (const bad of ['2027-03', '2027-13', '2027-1', 'x', '', undefined, null, ['2027-01x']]) assert.equal(normMonth(bad, '2027-02-03'), '2027-02', String(bad));
  assert.equal(normMonth(['2026-12', 'x'], '2027-02-03'), '2026-12');

  const { app, acct } = world();
  assert.deepEqual(statementRange(app.db, acct.id, '2027-02-03'), { first: '2027-02', last: '2027-02' }, 'senza nulla: solo il mese in corso');
  const b = booking(app, acct);
  assert.deepEqual(statementRange(app.db, acct.id, '2027-02-03'), { first: '2027-01', last: '2027-02' }, 'dal primo servizio');
  const inv = invoice(app, acct, [b], { date: '2026-11-20' });
  assert.deepEqual(statementRange(app.db, acct.id, '2027-02-03'), { first: '2026-11', last: '2027-02' }, 'o dalla prima fattura');
  assert.equal(inv.issue_date, '2026-11-20');
  app.cleanup();
});

test('saldo: fatture, note di credito e incassi mese per mese, con saldo iniziale e finale che si concatenano', () => {
  const { app, acct } = world();
  const inv1 = invoice(app, acct, [booking(app, acct, { pax: 2 })], { date: '2026-11-20', due: '2026-12-20' });
  const inv2 = invoice(app, acct, [booking(app, acct, { pax: 3 })], { date: '2026-12-10', due: '2027-01-09' });
  const inv3 = invoice(app, acct, [booking(app, acct, { pax: 1 })], { date: '2027-01-05', due: '2027-02-04' });
  const inv4 = invoice(app, acct, [booking(app, acct, { pax: 4 })], { date: '2027-01-10', due: '2027-01-25' });
  restyle(app, inv1.id, { paid: '2026-12-28' });
  const cn = creditNote(app, acct, inv2, { date: '2027-01-15' });
  const o = Object.fromEntries([inv1, inv2, inv3, inv4].map((i, n) => [n + 1, openPartsCents(i)]));
  assert.ok(Object.values(o).every((v) => v > 0));
  assert.equal(o[1], 5600, '2 persone a 28 € (sotto i 77,47 € non c’è bollo)');

  const nov = statementOf(app, acct.id, '2026-11', TODAY);
  assert.deepEqual([nov.opening, nov.invoiced, nov.credited, nov.paid, nov.closing], [0, o[1], 0, 0, o[1]]);
  assert.deepEqual(nov.movements.map((m) => [m.kind, m.date, m.invoice.number, m.cents, m.balance]), [['invoice', '2026-11-20', inv1.number, o[1], o[1]]]);
  assert.deepEqual(nov.open.map((x) => [x.invoice.number, x.cents, x.dueDate, x.daysLate]), [[inv1.number, o[1], '2026-12-20', 0]], 'a fine novembre la scadenza è ancora lontana');
  assert.equal(nov.overdueCents, 0);

  const dec = statementOf(app, acct.id, '2026-12', TODAY);
  assert.deepEqual([dec.opening, dec.invoiced, dec.credited, dec.paid, dec.closing], [o[1], o[2], 0, o[1], o[2]]);
  assert.deepEqual(dec.movements.map((m) => [m.kind, m.date, m.cents, m.balance]), [['invoice', '2026-12-10', o[2], o[1] + o[2]], ['payment', '2026-12-28', -o[1], o[2]]]);
  assert.equal(dec.movements[1].method, 'bank');
  assert.deepEqual(dec.open.map((x) => x.invoice.number), [inv2.number], 'la fattura di novembre è stata incassata');

  const jan = statementOf(app, acct.id, '2027-01', TODAY);
  assert.equal(jan.opening, dec.closing, 'il saldo iniziale è il finale del mese prima');
  assert.deepEqual([jan.invoiced, jan.credited, jan.paid], [o[3] + o[4], o[2], 0]);
  assert.equal(jan.closing, o[3] + o[4]);
  assert.deepEqual(jan.movements.map((m) => [m.kind, m.date, m.balance]), [['invoice', '2027-01-05', o[2] + o[3]], ['invoice', '2027-01-10', o[2] + o[3] + o[4]], ['credit', '2027-01-15', o[3] + o[4]]]);
  const credit = jan.movements.find((m) => m.kind === 'credit');
  assert.equal(credit.invoice.number, cn.number);
  assert.equal(credit.related.number, inv2.number, 'la nota di credito dice quale fattura storna');
  // a fine gennaio la fattura 4 è scaduta da sei giorni (scadeva il 25), la 3 no (scade il 4 febbraio)
  assert.deepEqual(jan.open.map((x) => [x.invoice.number, x.cents, x.dueDate, x.daysLate]), [[inv4.number, o[4], '2027-01-25', 6], [inv3.number, o[3], '2027-02-04', 0]], 'prima la più urgente');
  assert.equal(jan.overdueCents, o[4]);
  assert.equal(jan.creditCents, 0);

  // il mese in corso (3 febbraio): la scadenza si misura da oggi
  const feb = statementOf(app, acct.id, '2027-02', TODAY);
  assert.equal(feb.opening, jan.closing);
  assert.deepEqual(feb.movements, []);
  assert.equal(feb.closing, jan.closing);
  assert.equal(feb.asOf, '2027-02-03');
  assert.deepEqual(feb.open.map((x) => [x.invoice.number, x.daysLate]), [[inv4.number, 9], [inv3.number, 0]]);
  assert.equal(feb.hasActivity, true, 'nessun movimento ma un saldo aperto: c’è da dire');
  // il saldo finale è sempre la somma di ciò che è aperto, meno i crediti
  for (const st of [nov, dec, jan, feb]) assert.equal(st.closing, st.open.reduce((s, x) => s + x.cents, 0) - st.creditCents);
  // prima di tutto: nulla
  const early = statementOf(app, acct.id, '2026-10', TODAY);
  assert.deepEqual([early.opening, early.closing, early.movements.length, early.open.length, early.hasActivity], [0, 0, 0, 0, false]);
  app.cleanup();
});

test('incasso: ciò che si paga con la carta non si somma due volte, e una fattura incassata dopo la fine del mese era ancora aperta', () => {
  const { app, acct } = world();
  const inv = invoice(app, acct, [booking(app, acct, { pax: 2 })], { date: '2027-01-05', due: '2027-01-20' });
  restyle(app, inv.id, { paid: '2027-02-02', method: 'card' });
  const o = openPartsCents(inv);
  const jan = statementOf(app, acct.id, '2027-01', TODAY);
  assert.deepEqual(jan.open.map((x) => [x.cents, x.daysLate]), [[o, 11]], 'a fine gennaio non era ancora pagata, e scaduta da 11 giorni');
  assert.equal(jan.closing, o);
  const feb = statementOf(app, acct.id, '2027-02', TODAY);
  assert.deepEqual([feb.opening, feb.paid, feb.closing], [o, o, 0]);
  assert.equal(feb.movements[0].method, 'card');
  assert.deepEqual(feb.open, []);
  assert.equal(feb.hasActivity, true, 'c’è un incasso nel mese');
  assert.equal(statementOf(app, acct.id, '2027-03', localToInstant('2027-03-05', '10:00')).hasActivity, false, 'tutto saldato e nessun movimento: niente da dire');
  app.cleanup();
});

test('nota di credito: storna al massimo ciò che restava da pagare (la parte già pagata con carta non è un debito)', () => {
  const { app, acct } = world();
  const paidByCard = booking(app, acct, { paymentMethod: 'card', pax: 3 });
  confirmPaid(app, paidByCard.id, 'pi_test', NOW);
  const onInvoice = booking(app, acct, { pax: 2 });
  const inv = invoice(app, acct, [paidByCard, onInvoice], { date: '2027-01-05', due: '2027-02-04' });
  const owed = openPartsCents(inv);
  assert.ok(owed < inv.total_cents && owed > 0, 'una parte della fattura era già pagata');
  creditNote(app, acct, inv, { date: '2027-01-15' });
  const jan = statementOf(app, acct.id, '2027-01', TODAY);
  assert.deepEqual(jan.movements.map((m) => [m.kind, m.cents]), [['invoice', owed], ['credit', -owed]], 'la nota di credito copre tutta la fattura ma storna solo la parte da pagare');
  assert.equal(jan.closing, 0);
  assert.deepEqual(jan.open, []);
  app.cleanup();
});

test('credito dell’agenzia: nota di credito dopo l’incasso, bonifico al netto di un storno già ricevuto, carta per l’intero', () => {
  // incassata e poi stornata: il saldo diventa negativo (la guida deve restituire o compensare)
  const a = world();
  const inv = invoice(a.app, a.acct, [booking(a.app, a.acct, { pax: 4 })], { date: '2027-01-05', due: '2027-01-20' });
  restyle(a.app, inv.id, { paid: '2027-01-12' });
  creditNote(a.app, a.acct, inv, { date: '2027-01-18', cents: 2800 });
  const o = openPartsCents(inv);
  const jan = statementOf(a.app, a.acct.id, '2027-01', TODAY);
  assert.deepEqual(jan.movements.map((m) => [m.kind, m.cents, m.balance]), [['invoice', o, o], ['payment', -o, 0], ['credit', -2800, -2800]]);
  assert.equal(jan.closing, -2800);
  assert.equal(jan.creditCents, 2800);
  assert.deepEqual(jan.open, []);
  assert.equal(jan.closing, jan.open.reduce((s, x) => s + x.cents, 0) - jan.creditCents);
  assert.equal(jan.overdueCents, 0, 'un credito non è un ritardo');
  assert.equal(jan.hasActivity, true);
  a.app.cleanup();

  // incassata e stornata per intero: l'agenzia riavrebbe la nota di credito (il bollo che ha pagato resta pagato)
  const d = world();
  const invD = invoice(d.app, d.acct, [booking(d.app, d.acct, { pax: 3 })], { date: '2027-01-05', due: '2027-01-20' });
  const oD = openPartsCents(invD);
  assert.equal(oD, 8600, '84 € più 2 € di bollo addebitato');
  restyle(d.app, invD.id, { paid: '2027-01-12' });
  const cnD = creditNote(d.app, d.acct, invD, { date: '2027-01-18' });
  assert.equal(cnD.total_cents, 8400, 'la nota di credito non riporta il bollo');
  const stD = statementOf(d.app, d.acct.id, '2027-01', TODAY);
  assert.equal(stD.closing, -8400);
  assert.equal(stD.creditCents, 8400);
  d.app.cleanup();

  // stornata per intero prima dell'incasso: non resta più nulla da pagare, nemmeno il bollo
  const e = world();
  const invE = invoice(e.app, e.acct, [booking(e.app, e.acct, { pax: 3 })], { date: '2027-01-05', due: '2027-01-20' });
  creditNote(e.app, e.acct, invE, { date: '2027-01-12' });
  const stE = statementOf(e.app, e.acct.id, '2027-01', TODAY);
  assert.deepEqual(stE.movements.map((m) => [m.kind, m.cents]), [['invoice', 8600], ['credit', -8600]]);
  assert.equal(stE.closing, 0);
  e.app.cleanup();

  // stornata prima dell'incasso: con il bonifico l'agenzia paga la differenza, il saldo torna a zero
  const b = world();
  const invB = invoice(b.app, b.acct, [booking(b.app, b.acct, { pax: 4 })], { date: '2027-01-05', due: '2027-01-30' });
  creditNote(b.app, b.acct, invB, { date: '2027-01-12', cents: 2800 });
  restyle(b.app, invB.id, { paid: '2027-01-20', method: 'bank' });
  const stB = statementOf(b.app, b.acct.id, '2027-01', TODAY);
  const oB = openPartsCents(invB);
  assert.deepEqual(stB.movements.map((m) => [m.kind, m.cents]), [['invoice', oB], ['credit', -2800], ['payment', -(oB - 2800)]]);
  assert.equal(stB.closing, 0);
  b.app.cleanup();

  // con la carta la pagina di pagamento chiede l'importo intero: il saldo resta a credito dello storno
  const c = world();
  const invC = invoice(c.app, c.acct, [booking(c.app, c.acct, { pax: 4 })], { date: '2027-01-05', due: '2027-01-30' });
  creditNote(c.app, c.acct, invC, { date: '2027-01-12', cents: 2800 });
  restyle(c.app, invC.id, { paid: '2027-01-20', method: 'card' });
  const stC = statementOf(c.app, c.acct.id, '2027-01', TODAY);
  assert.deepEqual(stC.movements.map((m) => [m.kind, m.cents]), [['invoice', oB], ['credit', -2800], ['payment', -oB]]);
  assert.equal(stC.closing, -2800);
  assert.equal(stC.creditCents, 2800);
  c.app.cleanup();
});

test('chi non conta: bozze, scartate, fatture di altri, privati; e le sole fatture dell’agenzia', () => {
  const { app, acct } = world();
  const other = addAccount(app.db, { email: 'bruno@bluesail.example', company: 'BlueSail Tours', contact_name: 'Bruno' });
  const mine = invoice(app, acct, [booking(app, acct)], { date: '2027-01-05', due: '2027-02-04' });
  invoice(app, other, [booking(app, other)], { date: '2027-01-06', due: '2027-02-05' });
  // una bozza e una scartata non sono documenti emessi
  const [draft] = createDrafts(app, [`booking:${booking(app, acct).id}`], LATER);
  assert.equal(draft.status, 'draft');
  const rejected = invoice(app, acct, [booking(app, acct)], { date: '2027-01-07', due: '2027-02-06' });
  app.db.prepare(`UPDATE invoices SET status = 'rejected' WHERE id = ?`).run(rejected.id);
  // una fattura già pagata alla prenotazione (carta): nulla da pagare, non entra nei movimenti
  const card = booking(app, acct, { paymentMethod: 'card' });
  confirmPaid(app, card.id, 'pi_x', NOW);
  const cardInv = invoice(app, acct, [card], { date: '2027-01-08' });
  assert.equal(openPartsCents(cardInv), 0);

  const st = statementOf(app, acct.id, '2027-01', TODAY);
  assert.deepEqual(st.movements.map((m) => m.invoice.number), [mine.number]);
  assert.equal(st.closing, openPartsCents(mine));
  assert.equal(invoiceDue(cardInv), 0);
  const { events } = ledger(app.db, acct.id);
  assert.equal(events.length, 1);
  app.cleanup();
});

test('servizi del mese: fatturato (con numero e incasso), pagato online, da fatturare, in programma, penale; e quanto non è ancora fatturato', () => {
  const { app, acct } = world();
  const billed = booking(app, acct, { date: '2027-01-12', time: '09:30', pax: 2 });
  const billedPaid = booking(app, acct, { date: '2027-01-13', time: '09:30', pax: 1 });
  const toBill = booking(app, acct, { date: '2027-01-14', time: '09:30', pax: 3 });
  const online = booking(app, acct, { date: '2027-01-15', time: '09:30', pax: 2, paymentMethod: 'card' });
  confirmPaid(app, online.id, 'pi_y', NOW);
  const onsite = booking(app, acct, { date: '2027-01-15', time: '14:30', pax: 2 });
  app.db.prepare(`UPDATE bookings SET payment_method = 'onsite' WHERE id = ?`).run(onsite.id); // inserita dalla guida: si paga il giorno del servizio
  const future = booking(app, acct, { date: '2027-02-20', time: '09:30', pax: 2 });
  const penalty = booking(app, acct, { date: '2027-01-18', time: '09:30', pax: 4, clientRef: 'Penale' });
  cancelBooking(app, penalty.id, { by: 'customer' }, LATER); // annullata troppo tardi: resta dovuta una penale
  app.db.prepare('UPDATE bookings SET retained_cents = 5600 WHERE id = ?').run(penalty.id);
  const gone = booking(app, acct, { date: '2027-01-19', time: '09:30', pax: 2 });
  app.db.prepare(`UPDATE bookings SET status = 'cancelled', retained_cents = 0 WHERE id = ?`).run(gone.id); // annullata senza penale: non compare
  const opt = booking(app, acct, { date: '2027-01-19', time: '14:30', pax: 2, option: true, paymentMethod: undefined });
  const inv = invoice(app, acct, [billed], { date: '2027-01-20', due: '2027-02-19' });
  const inv2 = invoice(app, acct, [billedPaid], { date: '2027-01-20', due: '2027-02-19' });
  restyle(app, inv2.id, { paid: '2027-02-01' });

  const jan = statementOf(app, acct.id, '2027-01', TODAY);
  const by = Object.fromEntries(jan.services.map((s) => [s.ref, s]));
  assert.equal(by[billed.ref].state, 'invoiced');
  assert.deepEqual([by[billed.ref].number, by[billed.ref].paid], [inv.number, false]);
  assert.deepEqual([by[billedPaid.ref].state, by[billedPaid.ref].number, by[billedPaid.ref].paid], ['invoiced', inv2.number, true]);
  assert.equal(by[toBill.ref].state, 'toInvoice');
  assert.equal(by[online.ref].state, 'card');
  assert.equal(by[onsite.ref].state, 'onsite');
  assert.equal(by[penalty.ref].state, 'penalty');
  assert.equal(by[penalty.ref].cents, 5600, 'della penale conta solo ciò che resta dovuto');
  assert.equal(by[toBill.ref].cents, 8400);
  assert.ok(!by[gone.ref] && !by[opt.ref] && !by[future.ref], 'né annullate senza penale, né opzioni, né altri mesi');
  assert.deepEqual(jan.services.map((s) => s.date), [...jan.services.map((s) => s.date)].sort(), 'in ordine di data');
  assert.equal(jan.services.find((s) => s.ref === billed.ref).i18n.it.title, 'Tour di prova', 'titolo del tour in ogni lingua');

  // da fatturare: il servizio svolto e la penale (non le prenotazioni già in fattura, né pagate online o sul posto)
  assert.deepEqual(jan.unbilled, { count: 2, cents: 8400 + 5600 });
  // le date future entrano nel loro mese come «in programma» e non nel conto del da fatturare
  const feb = statementOf(app, acct.id, '2027-02', TODAY);
  assert.deepEqual(feb.services.map((s) => [s.ref, s.state]), [[future.ref, 'upcoming']]);
  assert.deepEqual(feb.unbilled, { count: 2, cents: 14000 });
  app.cleanup();
});

test('CSV: saldo iniziale, movimenti con segno e saldo progressivo, saldo finale; testi liberi senza formule', () => {
  const { app, acct } = world();
  const inv = invoice(app, acct, [booking(app, acct, { pax: 2 })], { date: '2027-01-05', due: '2027-02-04' });
  restyle(app, inv.id, { paid: '2027-01-20' });
  const st = statementOf(app, acct.id, '2027-01', TODAY);
  const csv = statementCsv(st, {
    head: ['Data', 'Documento', 'Dettaglio', 'Scadenza', 'Importo', 'Saldo'],
    opening: 'Saldo iniziale',
    closing: 'Saldo finale',
    label: (m) => [m.kind === 'invoice' ? `Fattura ${m.invoice.number}` : `=Incasso ${m.invoice.number}`, m.kind === 'payment' ? 'bonifico; "grazie"' : ''],
  });
  assert.ok(csv.startsWith('﻿Data;Documento;Dettaglio;Scadenza;Importo;Saldo\r\n'), 'UTF-8 con BOM');
  assert.ok(csv.endsWith('\r\n'));
  assert.deepEqual(csv.slice(1).trimEnd().split('\r\n'), [
    'Data;Documento;Dettaglio;Scadenza;Importo;Saldo',
    '2027-01-01;Saldo iniziale;;;;0,00',
    `2027-01-05;Fattura ${inv.number};;2027-02-04;56,00;56,00`,
    `2027-01-20;'=Incasso ${inv.number};"bonifico; ""grazie""";;-56,00;0,00`,
    '2027-01-31;Saldo finale;;;;0,00',
  ]);
  app.cleanup();
});
