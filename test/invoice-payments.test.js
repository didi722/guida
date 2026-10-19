// Pagamento delle fatture ai partner: scadenza, IBAN e causale, incasso, pagamento con carta, solleciti automatici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmPaid, createBooking, getBooking } from '../server/bookings.js';
import { dueDateOf, ensurePayRef, groupIban, invoiceDue, markInvoicePaid, openPartsCents, overdueInvoices, payInstructions, payState, remindersDue, unmarkInvoicePaid } from '../server/invoicePayments.js';
import { createDrafts, getInvoice, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { createPackage, payableLines, resolveLine } from '../server/packages.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const IBAN = 'IT60X0542811101000000123456';
const GUIDE = 'guida@example.com';
const LATER = localToInstant('2027-01-20', '10:00'); // le prenotazioni del 12 gennaio sono state svolte
const at = (date, time = '10:00') => localToInstant(date, time);

function appFor(invoice = {}, over = {}) {
  return makeApp({
    mail: { notifyTo: GUIDE },
    site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { iban: IBAN, bank: 'Banca di Prova', seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } }, ...invoice },
    ...over,
  });
}
const company = (over = {}) => ({ kind: 'company', name: 'Lagoon DMC', country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: 'dmc@example.com', lang: 'it', ...over });
/** Un'agenzia con una prenotazione a fattura già svolta, e la sua fattura emessa il 20 gennaio (scade a 30 giorni: il 19 febbraio). */
function invoiced(app, acctOver = {}, bookingOver = {}) {
  const acct = addAccount(app.db, { email: 'dmc@example.com', company: 'Lagoon DMC', vat: '01234567897', sdi_code: 'ABC1234', country: 'IT', lang: 'it', ...acctOver });
  const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', date: '2027-01-12', time: '09:30', pax: 3, name: 'Anna', email: acct.email, clientRef: 'Gruppo Rossi', ...bookingOver }), NOW);
  const [draft] = createDrafts(app, [`booking:${b.id}`], LATER);
  const d = invoiceDetail(app, draft.id);
  saveDraft(app, draft.id, { buyer: company(), lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } }, LATER);
  const inv = issueInvoice(app, draft.id, LATER);
  return { acct, b, inv };
}

test('una fattura a bonifico: quanto resta, entro quando (30 giorni), stato aperto → scaduto', (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const { inv } = invoiced(app);
  assert.equal(inv.status, 'issued');
  assert.equal(dueDateOf(inv), '2027-02-19', '30 giorni dalla data della fattura (20 gennaio)');
  assert.equal(invoiceDue(inv), inv.payable_cents);
  assert.ok(invoiceDue(inv) > 0);
  assert.equal(openPartsCents(inv), invoiceDue(inv));
  assert.deepEqual({ ...payState(inv, '2027-02-10') }, { state: 'open', dueCents: inv.payable_cents, dueDate: '2027-02-19', days: 9 });
  assert.deepEqual({ ...payState(inv, '2027-02-19') }, { state: 'open', dueCents: inv.payable_cents, dueDate: '2027-02-19', days: 0 }, 'il giorno della scadenza non è ancora scaduta');
  assert.deepEqual({ ...payState(inv, '2027-02-25') }, { state: 'overdue', dueCents: inv.payable_cents, dueDate: '2027-02-19', days: 6 });
  assert.equal(payState({ ...inv, credited: 1 }, '2027-02-25').state, 'credited');
  assert.equal(payState({ ...inv, paid_at: '2027-02-01T10:00:00.000Z' }, '2027-02-25').state, 'paid');
  assert.equal(invoiceDue({ ...inv, doc_type: 'TD04' }), 0, 'una nota di credito non si paga');
});

test('come pagare: intestatario, IBAN a gruppi, banca, causale con il numero e importo', (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const { inv } = invoiced(app);
  const p = payInstructions(app, inv);
  assert.equal(p.iban, 'IT60 X054 2811 1010 0000 0123 456');
  assert.equal(groupIban(IBAN), p.iban);
  assert.deepEqual([p.beneficiary, p.bank, p.reference, p.amountCents, p.dueDate], ['Mario Rossi', 'Banca di Prova', `Fattura ${inv.number}`, inv.payable_cents, '2027-02-19']);
  // senza IBAN impostato non si inventa nulla
  const noIban = appFor({ iban: '' });
  t.after(noIban.cleanup);
  assert.equal(payInstructions(noIban, invoiced(noIban).inv).iban, '');
  // il riferimento per pagare con carta si crea una volta sola
  const a = ensurePayRef(app.db, inv);
  assert.match(a.pay_ref, /^IN-[A-Z0-9]{6}$/);
  assert.ok(a.pay_token);
  assert.equal(ensurePayRef(app.db, a).pay_ref, a.pay_ref);
});

test('incasso: segna fattura e prenotazioni come pagate, ricevuta all’agenzia; si può annullare (non se pagata con carta)', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const { b, inv } = invoiced(app);
  assert.equal(getBooking(app.db, b.id).payment_status, 'unpaid');
  const res = await app.invoices.markPaid(inv.id, { date: '2027-02-05', method: 'bank' }, LATER);
  assert.equal(res.already, false);
  const paid = getInvoice(app.db, inv.id);
  assert.deepEqual([paid.paid_method, paid.paid_at.slice(0, 10)], ['bank', '2027-02-05']);
  assert.equal(getBooking(app.db, b.id).payment_status, 'paid');
  assert.equal(invoiceDue(paid), 0);
  assert.equal(payState(paid, '2027-03-01').state, 'paid');
  const receipt = app.mail.sent.find((m) => m.to === 'dmc@example.com' && /Pagamento ricevuto/.test(m.subject));
  assert.ok(receipt, 'ricevuta all’agenzia');
  assert.equal(app.mail.sent.filter((m) => m.to === GUIDE).length, 0, 'la guida lo ha fatto lei: nessun avviso');
  assert.equal((await app.invoices.markPaid(inv.id, {}, LATER)).already, true, 'due volte non cambia nulla');
  // errore: tolgo l'incasso e la prenotazione torna da incassare
  app.invoices.unmarkPaid(inv.id, LATER);
  assert.equal(getInvoice(app.db, inv.id).paid_at, null);
  assert.equal(getBooking(app.db, b.id).payment_status, 'unpaid');
  // una fattura non emessa non si incassa
  const draft = createDrafts(app, [`booking:${createBooking(app, base({ channel: 'b2b', account: addAccount(app.db, { email: 'altra@example.com' }), paymentMethod: 'invoice', date: '2027-01-13', time: '09:30', name: 'Anna', email: 'altra@example.com' }), NOW).id}`], LATER)[0];
  await assert.rejects(() => app.invoices.markPaid(draft.id, {}, LATER), (e) => e.code === 'state');
  // un pagamento con carta non si toglie da qui
  markInvoicePaid(app, inv.id, { method: 'card', paymentIntent: 'pi_1' }, LATER);
  assert.throws(() => app.invoices.unmarkPaid(inv.id, LATER), (e) => e.code === 'state');
  assert.equal(getBooking(app.db, b.id).payment_method, 'card');
  assert.equal(getBooking(app.db, b.id).stripe_payment_intent, 'pi_1');
  void unmarkInvoicePaid;
});

test('pagamento con carta: stessa strada dei pacchetti (riferimento IN-), fattura e prenotazioni pagate, email e avviso alla guida; il doppio pagamento si rimborsa', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const { b, inv } = invoiced(app);
  const pay = ensurePayRef(app.db, inv);
  const found = app.payables.lookup(pay.pay_ref);
  assert.equal(found.kind, 'invoice');
  assert.equal(found.handler.dueCents(found.row), inv.payable_cents);
  assert.ok(found.handler.isOpen(found.row), 'si può pagare con carta (pagamenti demo attivi)');
  const url = await found.handler.startCheckout(found.row, 'it', LATER, 0);
  assert.match(url, new RegExp(`/pay/demo/${pay.pay_ref}\\?t=${pay.pay_token}`));
  assert.equal(found.handler.statusUrl(found.row, 'it'), `/it/invoices/${pay.pay_ref}?t=${pay.pay_token}`);

  await found.handler.onPaid(found.row, 'pi_card_1', LATER + 1000);
  const paid = getInvoice(app.db, inv.id);
  assert.deepEqual([paid.paid_method, paid.stripe_payment_intent], ['card', 'pi_card_1']);
  const booking = getBooking(app.db, b.id);
  assert.deepEqual([booking.payment_status, booking.payment_method, booking.stripe_payment_intent], ['paid', 'card', 'pi_card_1']);
  assert.ok(app.mail.sent.some((m) => m.to === 'dmc@example.com' && /Pagamento ricevuto/.test(m.subject)));
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /Fattura pagata con carta/.test(m.subject)));
  assert.equal(found.handler.isOpen(app.payables.lookup(pay.pay_ref).row), false, 'non si paga due volte');
  const mails = app.mail.sent.length;
  await found.handler.onPaid(app.payables.lookup(pay.pay_ref).row, 'pi_card_1', LATER + 2000);
  assert.equal(app.mail.sent.length, mails, 'la stessa notifica due volte non riscrive');
  const refunds = [];
  app.payments.refund = async (r) => (refunds.push(r), { id: 'r' });
  await found.handler.onPaid(app.payables.lookup(pay.pay_ref).row, 'pi_card_2', LATER + 3000);
  assert.deepEqual(refunds.map((r) => [r.paymentIntent, r.cents, r.ref]), [['pi_card_2', inv.payable_cents, `${pay.pay_ref}-dup`]], 'il secondo pagamento si rimborsa per intero');
});

test('solleciti: il primo il giorno dopo la scadenza, poi ogni 7 giorni, al massimo 3; mai se pagata; con IBAN, causale e link nella mail', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const { inv } = invoiced(app);
  const due = (date, time = '10:00') => remindersDue(app, at(date, time)).map((x) => x.inv.id);
  assert.deepEqual(due('2027-02-19'), [], 'il giorno della scadenza non è ancora scaduta');
  assert.deepEqual(due('2027-02-20'), [inv.id], 'il giorno dopo: primo sollecito');
  assert.equal(overdueInvoices(app.db, '2027-02-20').length, 1);
  assert.equal(await app.invoices.sweepOverdue(at('2027-02-20')), 1);
  const first = app.mail.sent.find((m) => m.to === 'dmc@example.com' && /Promemoria di pagamento/.test(m.subject));
  assert.match(first.subject, new RegExp(`fattura ${inv.number} scaduta il 19 febbraio 2027`));
  assert.match(first.text, /IBAN: IT60 X054 2811 1010 0000 0123 456/);
  assert.match(first.text, new RegExp(`Causale: Fattura ${inv.number}`));
  assert.match(first.text, /Scadenza: 19 febbraio 2027/);
  assert.match(first.text, /\/it\/invoices\/IN-[A-Z0-9]{6}\?t=/);
  assert.deepEqual(first.attachments.map((a) => a.filename.split('.').pop()), ['pdf'], 'la fattura in allegato');
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /sollecito inviato/.test(m.subject)));
  const row = getInvoice(app.db, inv.id);
  assert.equal(row.overdue_reminders, 1);
  assert.deepEqual(due('2027-02-21'), [], 'non ogni giorno');
  assert.deepEqual(due('2027-02-26'), [], '6 giorni dopo: ancora no');
  assert.deepEqual(due('2027-02-27'), [inv.id], '7 giorni dopo: secondo sollecito');
  assert.equal(await app.invoices.sweepOverdue(at('2027-02-27')), 1);
  assert.equal(await app.invoices.sweepOverdue(at('2027-02-27', '10:05')), 0, 'una sola volta');
  assert.equal(await app.invoices.sweepOverdue(at('2027-03-06')), 1);
  assert.deepEqual(due('2027-03-20'), [], 'dopo il terzo non ce ne sono altri');
  assert.equal(getInvoice(app.db, inv.id).overdue_reminders, 3);
  // il lavoro periodico fa lo stesso (con gli interruttori del pannello)
  const app2 = appFor();
  t.after(app2.cleanup);
  const { inv: inv2 } = invoiced(app2);
  await app2.runJobs(at('2027-02-20'));
  assert.equal(getInvoice(app2.db, inv2.id).overdue_reminders, 1);
  app2.cfg.reminders.overdue.enabled = false;
  assert.deepEqual(remindersDue(app2, at('2027-03-30')), [], 'spenti dal pannello');
  // pagata: nessun sollecito
  const app3 = appFor();
  t.after(app3.cleanup);
  const { inv: inv3 } = invoiced(app3);
  markInvoicePaid(app3, inv3.id, { method: 'bank' }, at('2027-02-10'));
  assert.deepEqual(remindersDue(app3, at('2027-02-25')), []);
  assert.equal(await app3.invoices.remind(inv3.id, at('2027-02-25'), { manual: true }), false);
});

test('sollecito a mano: anche prima della scadenza (promemoria gentile); non se non c’è un’email o è già pagata', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const { inv } = invoiced(app);
  assert.equal(await app.invoices.remind(inv.id, at('2027-02-01')), false, 'in automatico non prima della scadenza');
  assert.equal(await app.invoices.remind(inv.id, at('2027-02-01'), { manual: true }), true);
  assert.match(app.mail.sent.find((m) => /Promemoria di pagamento/.test(m.subject)).text, /Fattura/);
  assert.equal(getInvoice(app.db, inv.id).overdue_reminders, 1);
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /Promemoria prima della scadenza/.test(m.text)));
  // senza email né dell'intestatario né dell'account: nulla da mandare
  const app2 = appFor();
  t.after(app2.cleanup);
  const { inv: x } = invoiced(app2);
  app2.db.prepare(`UPDATE invoices SET buyer_json = json_remove(buyer_json, '$.email') WHERE id = ?`).run(x.id);
  app2.db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run('', x.account_id);
  assert.equal(await app2.invoices.remind(x.id, at('2027-03-01')), false);
});

test('un’agenzia può anticipare con la carta una prenotazione a fattura, finché non è in una fattura', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { email: 'dmc@example.com' });
  const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', date: '2027-03-10', time: '09:30', name: 'Anna', email: acct.email }), NOW);
  assert.equal(app.services.payableLater(b, NOW), true);
  const found = app.payables.lookup(b.ref);
  assert.ok(found.handler.isOpen(found.row), 'dal link /pay/resume');
  // fatto: la prenotazione diventa «pagata con carta» e la fattura la troverà già saldata
  await found.handler.onPaid(found.row, 'pi_early', NOW + 1000);
  const paid = getBooking(app.db, b.id);
  assert.deepEqual([paid.status, paid.payment_status, paid.payment_method], ['confirmed', 'paid', 'card']);
  assert.equal(app.services.payableLater(paid, NOW), false);
  // già in una bozza di fattura: si paga la fattura, non la singola prenotazione
  const b2 = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', date: '2027-03-11', time: '09:30', name: 'Anna', email: acct.email }), NOW);
  createDrafts(app, [`booking:${b2.id}`], LATER);
  assert.equal(app.services.payableLater(b2, NOW), false);
  // un privato che paga in loco resta come prima (pagabile in anticipo, non dopo il servizio)
  const priv = createBooking(app, base({ date: '2027-03-12', time: '09:30', paymentMethod: 'onsite', email: 'p@example.com' }), NOW);
  assert.equal(app.services.payableLater(priv, NOW), true);
  assert.equal(app.services.payableLater(priv, localToInstant('2027-03-13', '10:00')), false);
  void confirmPaid;
});

test('un pacchetto a fattura si può pagare in blocco con la carta, ma non le sue voci già in una fattura', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { email: 'dmc@example.com' });
  const pkg = createPackage(app, acct, [resolveLine(app, { tour: 'private-agenzie', date: '2027-03-10', time: '10:00', pax: '5' }), resolveLine(app, { tour: 'shared-agenzie', date: '2027-03-10', time: '14:30', pax: '3' })], { name: 'Anna', email: acct.email, lang: 'it', paymentMethod: 'invoice' }, NOW);
  assert.equal(payableLines(app.db, pkg.group.id, NOW).length, 2);
  createDrafts(app, [`booking:${pkg.bookings[0].id}`], LATER); // la prima voce entra in una fattura
  assert.deepEqual(payableLines(app.db, pkg.group.id, NOW).map((x) => x.id), [pkg.bookings[1].id]);
  const found = app.payables.lookup(pkg.group.ref);
  assert.ok(found.handler.isOpen(found.row));
  await found.handler.startCheckout(found.row, 'it', NOW, 0);
  const row = app.payables.lookup(pkg.group.ref).row;
  assert.equal(found.handler.dueCents(row), pkg.bookings[1].total_cents);
  await found.handler.onPaid(row, 'pi_pkg', NOW + 1000);
  const after = pkg.bookings.map((x) => getBooking(app.db, x.id));
  assert.deepEqual(after.map((x) => [x.payment_status, x.payment_method]), [['unpaid', 'invoice'], ['paid', 'card']]);
});

test('email: la conferma di una prenotazione a fattura dice quando e come si paga; la copia della fattura ha IBAN, causale e link', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { email: 'dmc@example.com' });
  const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', date: '2027-03-10', time: '09:30', name: 'Anna', email: acct.email }), NOW);
  await app.services.handlePaid(b.id, null, NOW); // (già confermata: nessun effetto)
  const { sendBookingConfirmed } = await import('../server/emails.js');
  await sendBookingConfirmed(app, getBooking(app.db, b.id), NOW);
  const mail = app.mail.sent.find((m) => m.to === 'dmc@example.com' && /Prenotazione confermata/.test(m.subject));
  assert.match(mail.text, /Pagamento: dopo il servizio ricevi la fattura elettronica e paghi con bonifico entro 30 giorni dalla data della fattura \(IBAN IT60 X054 2811 1010 0000 0123 456\)/);
  // un privato non ha questa riga
  const priv = createBooking(app, base({ date: '2027-03-12', time: '09:30', paymentMethod: 'onsite', email: 'p@example.com' }), NOW);
  await sendBookingConfirmed(app, priv, NOW);
  assert.ok(!app.mail.sent.find((m) => m.to === 'p@example.com').text.includes('fattura elettronica'));
  // la copia di cortesia della fattura
  const { inv } = invoiced(app, { email: 'altra@example.com' }, { date: '2027-01-13' });
  assert.ok(await app.invoices.emailCopy(inv.id, 'dmc@example.com', {}, LATER));
  const copy = app.mail.sent.filter((m) => /Fattura/.test(m.subject)).at(-1);
  assert.match(copy.text, /Come pagare/);
  assert.match(copy.text, /IBAN: IT60 X054 2811 1010 0000 0123 456/);
  assert.match(copy.text, /\/it\/invoices\/IN-/);
  // senza IBAN impostato, niente IBAN (ma c'è il link)
  const app2 = appFor({ iban: '' });
  t.after(app2.cleanup);
  const acct2 = addAccount(app2.db, { email: 'dmc@example.com' });
  const b2 = createBooking(app2, base({ channel: 'b2b', account: acct2, paymentMethod: 'invoice', date: '2027-03-10', time: '09:30', name: 'Anna', email: acct2.email }), NOW);
  await sendBookingConfirmed(app2, b2, NOW);
  assert.match(app2.mail.sent.find((m) => /Prenotazione confermata/.test(m.subject)).text, /paghi con bonifico entro 30 giorni dalla data della fattura;/);
});
