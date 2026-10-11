import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../server/bookings.js';
import { loadAvailabilityContext, slotsForDay } from '../server/availability.js';
import { ProgramError, acceptProgram, createProgramRequest, dayConflicts, declineProgram, getProgram, markDepositPaid, markQuoted, programDays, saveProposal, setProgramStatus } from '../server/programs.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const request = (app, over = {}) =>
  createProgramRequest(app, { name: 'Giulia Bianchi', email: 'Giulia@Example.com', participants: 4, dateFrom: '2027-02-10', dateTo: '2027-02-12', interests: ['art', 'food', 'nope'], lang: 'en', ...over }, NOW);

const DAYS = [
  { date: '2027-02-10', start: '09:30', end: '13:00', title: 'San Marco e Rialto', priceCents: 15000 },
  { date: '2027-02-11', start: '10:00', end: '16:00', title: 'Isole della laguna', description: 'Murano, Burano, Torcello', priceCents: 30000 },
  { date: '2027-02-12', start: '09:30', end: '12:30', title: 'Cannaregio e il Ghetto', priceCents: 12000 },
];
const proposal = (over = {}) => ({ title: 'Venezia in tre giorni', intro: 'Ecco la proposta', notes: 'Incluso: guida', depositPercent: 30, validUntil: '2027-01-20', holdDates: true, totalCents: null, days: DAYS, ...over });
const save = (app, id, over, opts = {}) => saveProposal(app, id, proposal(over), { nowMs: NOW, ...opts });
const times = (app, date, nowMs = NOW) => {
  const ctx = loadAvailabilityContext(app.db, app.cfg, date, date, nowMs);
  return slotsForDay(ctx, app.cfg, app.content.tour('shared'), date, { pax: 1, nowMs }).map((s) => s.time);
};

test('richiesta di programma: validazione e normalizzazione', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const p = request(app);
  assert.match(p.ref, /^PR-/);
  assert.equal(p.status, 'new');
  assert.equal(p.email, 'giulia@example.com');
  assert.deepEqual(JSON.parse(p.interests), ['art', 'food'], 'temi sconosciuti scartati');
  assert.ok(p.token.length >= 20);

  const bad = [{ name: 'A' }, { email: 'non-una-email' }, { participants: 0 }, { participants: 200 }, { dateFrom: '2027-01-01' }, { dateTo: '2027-02-09' }, { dateTo: '2027-06-30' }, { dateFrom: '31/01/2027' }];
  for (const over of bad) assert.throws(() => request(app, over), ProgramError, JSON.stringify(over));

  const flexible = request(app, { dateFrom: '', dateTo: '', flexibleDates: true });
  assert.equal(flexible.date_from, null);
  assert.equal(flexible.flexible_dates, 1);

  const acct = addAccount(app.db);
  assert.equal(request(app, { channel: 'b2b', account: acct, company: 'Test DMC' }).account_id, acct.id);
  assert.equal(request(app, { channel: 'b2c', account: acct }).account_id, null, 'un privato non è collegato a un partner');
});

test('proposta: totale = somma delle giornate, acconto, controlli prima dell’invio, righe sostituite', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const p = request(app);

  const saved = save(app, p.id);
  assert.equal(saved.total_cents, 57000);
  assert.equal(saved.deposit_cents, 17100);
  assert.equal(programDays(app.db, p.id).length, 3);
  assert.equal(save(app, p.id, { totalCents: 50000, depositPercent: 20 }).deposit_cents, 10000, 'totale concordato diverso dalla somma');
  assert.equal(save(app, p.id, { days: DAYS.slice(0, 2) }).total_cents, 45000);
  assert.equal(programDays(app.db, p.id).length, 2, 'salvare di nuovo sostituisce le righe');

  const rowError = (over) => assert.throws(() => save(app, p.id, { days: [{ ...DAYS[0], ...over }] }), (e) => e instanceof ProgramError && e.code === 'rows' && e.detail === 0, JSON.stringify(over));
  rowError({ date: '2027-02-30' });
  rowError({ start: '13:00', end: '09:30' });
  rowError({ title: ' ' });
  rowError({ priceCents: -5 });
  rowError({ priceCents: 1.5 });
  assert.throws(() => save(app, p.id, { depositPercent: 120 }), { code: 'deposit' });
  assert.throws(() => save(app, p.id, { validUntil: 'domani' }), { code: 'validity' });

  // bozza incompleta: ok; per l'invio servono righe, totale positivo e validità futura
  assert.doesNotThrow(() => save(app, p.id, { days: [], validUntil: null }));
  assert.throws(() => save(app, p.id, { days: [] }, { strict: true }), { code: 'rows' });
  assert.throws(() => save(app, p.id, { days: [{ ...DAYS[0], priceCents: 0 }] }, { strict: true }), { code: 'total' });
  assert.throws(() => save(app, p.id, { validUntil: null }, { strict: true }), { code: 'validity' });
  assert.throws(() => save(app, p.id, { validUntil: '2027-01-03' }, { strict: true }), { code: 'validity' });
  assert.throws(() => markQuoted(app, p.id, NOW), { code: 'state' }, 'bozza senza righe non si può segnare come inviata');
  save(app, p.id, {}, { strict: true });
  assert.equal(markQuoted(app, p.id, NOW).status, 'quoted');
});

test('le giornate bloccano gli orari prenotabili: sempre se accettato, per le proposte solo con date trattenute e ancora valide', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const p = request(app);
  assert.deepEqual(times(app, '2027-02-11'), ['09:30', '14:30']);

  save(app, p.id, { holdDates: false });
  assert.deepEqual(times(app, '2027-02-11'), ['09:30', '14:30'], 'bozza: non blocca nulla');
  markQuoted(app, p.id, NOW);
  assert.deepEqual(times(app, '2027-02-11'), ['09:30', '14:30'], 'proposta senza date trattenute: non blocca');

  save(app, p.id, { holdDates: true });
  assert.deepEqual(times(app, '2027-02-10'), ['14:30'], '09:30–13:00 occupa solo la partenza delle 9:30');
  assert.deepEqual(times(app, '2027-02-11'), [], '10:00–16:00 occupa entrambe');
  assert.deepEqual(times(app, '2027-02-11', localToInstant('2027-01-21', '10:00')), ['09:30', '14:30'], 'proposta scaduta: le date si liberano da sole');

  save(app, p.id, { holdDates: false });
  assert.deepEqual(times(app, '2027-02-11'), ['09:30', '14:30']);
  assert.equal(acceptProgram(app, p.id, {}, NOW).outcome, 'accepted');
  assert.deepEqual(times(app, '2027-02-11'), [], 'accettato: blocca anche senza "trattieni"');
  assert.deepEqual(times(app, '2027-02-11', localToInstant('2027-03-01', '10:00')), [], 'e non scade');

  setProgramStatus(app.db, p.id, 'closed', NOW);
  assert.deepEqual(times(app, '2027-02-11'), ['09:30', '14:30'], 'chiuso: libero');
  // un cliente non riesce a prenotare sopra un programma accettato
  setProgramStatus(app.db, p.id, 'quoted', NOW);
  acceptProgram(app, p.id, {}, NOW);
  assert.throws(() => createBooking(app, base({ date: '2027-02-11', time: '09:30' }), NOW), { code: 'unavailable' });
});

test('accettazione: conflitti con prenotazioni e impegni, scadenza, forzatura, acconto o conferma immediata', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  createBooking(app, base({ date: '2027-02-11', time: '14:30' }), NOW); // prenotata prima della proposta
  app.db.prepare(`INSERT INTO blocks(date, start_time, end_time, note, created_at) VALUES('2027-02-12', '12:00', '13:00', 'dentista', ?)`).run(new Date(NOW).toISOString());

  const p = request(app);
  assert.equal(acceptProgram(app, p.id, {}, NOW).outcome, 'state', 'senza proposta inviata non si accetta');
  save(app, p.id);
  markQuoted(app, p.id, NOW);

  const conflicts = programDays(app.db, p.id).map((d) => dayConflicts(app, d, { ignoreProgramId: p.id, nowMs: NOW }));
  assert.deepEqual(conflicts[0], []);
  assert.match(conflicts[1][0], /prenotazione 14:30/);
  assert.match(conflicts[2][0], /impegno già in calendario 12:00–13:00/);

  const refused = acceptProgram(app, p.id, {}, NOW);
  assert.equal(refused.outcome, 'conflict');
  assert.equal(refused.conflicts.length, 2);
  assert.equal(getProgram(app.db, p.id).status, 'quoted');
  assert.equal(acceptProgram(app, p.id, {}, localToInstant('2027-01-21', '10:00')).outcome, 'expired');

  const forced = acceptProgram(app, p.id, { override: true }, NOW);
  assert.equal(forced.outcome, 'accepted');
  assert.equal(forced.program.deposit_status, 'pending');
  assert.equal(acceptProgram(app, p.id, {}, NOW).outcome, 'state', 'già accettato');

  // senza acconto: confermato subito
  const free = request(app, { email: 'altro@example.com', dateFrom: '2027-03-10', dateTo: '2027-03-11' });
  save(app, free.id, { depositPercent: 0, days: [{ date: '2027-03-10', start: '09:30', end: '12:30', title: 'Giornata', priceCents: 20000 }] });
  markQuoted(app, free.id, NOW);
  const done = acceptProgram(app, free.id, {}, NOW);
  assert.equal(done.outcome, 'confirmed');
  assert.equal(done.program.deposit_status, 'none');
  assert.throws(() => save(app, free.id), { code: 'locked' }, 'dopo l’accettazione la proposta non si modifica');
});

test('due programmi non possono occupare la stessa fascia', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const a = request(app);
  save(app, a.id);
  markQuoted(app, a.id, NOW);
  assert.equal(acceptProgram(app, a.id, {}, NOW).outcome, 'accepted');

  const b = request(app, { email: 'b@example.com' });
  save(app, b.id, { days: [{ date: '2027-02-11', start: '15:00', end: '17:00', title: 'Sovrapposto', priceCents: 10000 }] });
  markQuoted(app, b.id, NOW);
  const res = acceptProgram(app, b.id, {}, NOW);
  assert.equal(res.outcome, 'conflict');
  assert.match(res.conflicts[0], /2027-02-11/);
  // il programma non confligge con sé stesso
  assert.deepEqual(dayConflicts(app, programDays(app.db, a.id)[1], { ignoreProgramId: a.id, nowMs: NOW }), []);
});

test('acconto: idempotente; se il programma è stato chiuso nel frattempo non lo conferma', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const p = request(app);
  save(app, p.id);
  markQuoted(app, p.id, NOW);
  acceptProgram(app, p.id, {}, NOW);

  const paid = markDepositPaid(app.db, p.id, 'pi_1', NOW);
  assert.equal(paid.outcome, 'paid');
  assert.equal(paid.program.status, 'confirmed');
  assert.equal(paid.program.deposit_status, 'paid');
  assert.equal(markDepositPaid(app.db, p.id, 'pi_2', NOW).outcome, 'already');
  assert.equal(getProgram(app.db, p.id).stripe_payment_intent, 'pi_1');

  const q = request(app, { email: 'q@example.com', dateFrom: '2027-04-10', dateTo: '2027-04-10' });
  save(app, q.id, { days: [{ date: '2027-04-10', start: '09:00', end: '12:00', title: 'Giornata', priceCents: 10000 }] });
  markQuoted(app, q.id, NOW);
  assert.ok(declineProgram(app.db, q.id, 'troppo caro', NOW));
  assert.equal(declineProgram(app.db, q.id, 'ancora', NOW), false, 'già rifiutato');
  assert.equal(markDepositPaid(app.db, q.id, 'pi_late', NOW).outcome, 'closed');
  const after = getProgram(app.db, q.id);
  assert.equal(after.status, 'declined');
  assert.equal(after.deposit_status, 'none');
  assert.match(after.admin_notes, /troppo caro/);
});

test('flusso completo con email: richiesta → proposta → accettazione → acconto → conferma con calendario', async (t) => {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' } });
  t.after(app.cleanup);
  const p = await app.programs.submit({ name: 'Giulia', email: 'giulia@example.com', participants: 4, dateFrom: '2027-02-10', dateTo: '2027-02-12', lang: 'it', message: 'Siamo appassionati di arte' }, NOW);
  const mails = (re) => app.mail.sent.filter((m) => re.test(m.subject));
  assert.equal(mails(/Richiesta ricevuta/).at(-1).to, 'giulia@example.com');
  assert.equal(mails(/Nuova richiesta di programma/).at(-1).to, 'guida@example.com');
  assert.match(mails(/Nuova richiesta di programma/).at(-1).text, /Siamo appassionati di arte/);
  assert.match(mails(/Nuova richiesta di programma/).at(-1).text, new RegExp(`/admin/programs/${p.id}`));

  save(app, p.id);
  const sent = await app.programs.send(p.id, NOW);
  assert.equal(sent.program.status, 'quoted');
  assert.equal(sent.mailed, true);
  const proposalMail = mails(/La tua proposta/).at(-1);
  assert.match(proposalMail.text, /San Marco e Rialto/);
  assert.match(proposalMail.text, /570\s*€/);
  assert.match(proposalMail.text, new RegExp(`/it/programs/${p.ref}\\?t=${p.token}`));

  const res = await app.programs.accept(p.id, 'it', NOW);
  assert.equal(res.outcome, 'accepted');
  assert.match(res.redirect, new RegExp(`/pay/demo/${p.ref}`), 'pagamento demo dell’acconto');
  assert.equal(mails(/Proposta accettata/).filter((m) => m.to === 'giulia@example.com').length, 1);
  assert.equal(mails(/Proposta accettata/).filter((m) => m.to === 'guida@example.com').length, 1, 'la guida è avvisata');

  // pagamento tramite il meccanismo generico
  const found = app.payables.lookup(p.ref);
  assert.equal(found.kind, 'program');
  assert.equal(found.handler.dueCents(found.row), 17100);
  assert.equal(found.handler.isOpen(found.row), true);
  await found.handler.onPaid(found.row, 'pi_demo', NOW);
  await found.handler.onPaid(app.payables.lookup(p.ref).row, 'pi_demo', NOW); // webhook doppio
  assert.equal(getProgram(app.db, p.id).status, 'confirmed');
  assert.equal(mails(/Programma confermato/).length, 1, 'una sola email di conferma');
  const ics = mails(/Programma confermato/)[0].attachments.find((a) => /\.ics$/.test(a.filename));
  assert.equal((ics.content.match(/BEGIN:VEVENT/g) ?? []).length, 3);
  assert.match(ics.content, /DTSTART:20270211T090000Z/, "10:00 a Venezia = 09:00 UTC in inverno");
  assert.equal(app.payables.lookup(p.ref).handler.isOpen(app.payables.lookup(p.ref).row), false);
  assert.equal(mails(/Acconto incassato/).length, 1, 'la guida è avvisata');
});

test('annullo del programma: rimborso dell’acconto, date libere; rimborso fallito segnalato; pagamento tardivo dopo il rifiuto rimborsato', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const refunds = [];
  let failNext = false;
  app.payments.refund = async (args) => {
    if (failNext) throw new Error('Stripe 500');
    refunds.push(args);
    return {};
  };
  const confirmed = async (email, date) => {
    const p = request(app, { email, dateFrom: date, dateTo: date });
    save(app, p.id, { days: [{ date, start: '09:30', end: '12:30', title: 'Giornata', priceCents: 20000 }] });
    await app.programs.send(p.id, NOW);
    await app.programs.accept(p.id, 'it', NOW);
    await app.programs.handleDepositPaid(p.id, `pi_${email}`, NOW);
    return getProgram(app.db, p.id);
  };

  const a = await confirmed('a@example.com', '2027-02-20');
  assert.equal(a.status, 'confirmed');
  assert.deepEqual(times(app, '2027-02-20'), ['14:30']);
  const out = await app.programs.cancel(a.id, { refundDeposit: true }, NOW);
  assert.equal(out.outcome, 'closed');
  assert.equal(out.refundedCents, 6000);
  assert.deepEqual(refunds, [{ paymentIntent: 'pi_a@example.com', cents: 6000, ref: a.ref }]);
  assert.equal(getProgram(app.db, a.id).deposit_status, 'refunded');
  assert.deepEqual(times(app, '2027-02-20'), ['09:30', '14:30'], 'date di nuovo libere');
  assert.equal((await app.programs.cancel(a.id, {}, NOW)).outcome, 'state', 'non si annulla due volte');

  const b = await confirmed('b@example.com', '2027-02-21');
  failNext = true;
  const bad = await app.programs.cancel(b.id, { refundDeposit: true }, NOW);
  assert.equal(bad.outcome, 'refund_failed');
  const row = getProgram(app.db, b.id);
  assert.equal(row.status, 'closed');
  assert.equal(row.deposit_status, 'paid', 'l’acconto risulta ancora da restituire');
  assert.match(row.admin_notes, /RIMBORSO ACCONTO NON RIUSCITO/);
  failNext = false;

  const c = request(app, { email: 'c@example.com', dateFrom: '2027-02-22', dateTo: '2027-02-22' });
  save(app, c.id, { days: [{ date: '2027-02-22', start: '09:30', end: '12:30', title: 'Giornata', priceCents: 20000 }] });
  await app.programs.send(c.id, NOW);
  await app.programs.accept(c.id, 'it', NOW, { checkout: false });
  await app.programs.cancel(c.id, {}, NOW); // la guida annulla mentre il cliente sta pagando
  const late = await app.programs.handleDepositPaid(c.id, 'pi_late', NOW);
  assert.equal(late.outcome, 'closed');
  assert.deepEqual(refunds.at(-1), { paymentIntent: 'pi_late', cents: 6000, ref: c.ref });
});
