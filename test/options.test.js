// Opzioni delle agenzie: la data resta trattenuta senza pagare fino a una scadenza (più il tour è lontano, più dura), poi si libera da sola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OPTION_TIERS, firmTiers, maxActiveOptions, normalizeOptionTiers, optionWindow, reminderAt } from '../server/optionPolicy.js';
import { BookingError, activeOptionCount, cancelBooking, cancellationState, confirmOption, confirmPaid, createBooking, expireBooking, expireHolds, expireOptions, extendOption, getBooking, optionsDueForReminder, paymentOptions, releaseOption } from '../server/bookings.js';
import { daySlots } from '../server/availability.js';
import { freeHoursOf } from '../server/policy.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OPTIONS = { enabled: true, tiers: DEFAULT_OPTION_TIERS, minReleaseHours: 48, maxActive: 5, reminderHours: 24 };
const startAt = (days) => NOW + days * DAY;

test('durata dell’opzione: dipende da quanto manca al tour, mai oltre il limite prima del servizio', () => {
  const w = (days, account = null, options = OPTIONS) => optionWindow({ options, account, startMs: startAt(days), nowMs: NOW });
  assert.equal(w(90).days, 14, 'oltre 60 giorni: 14');
  assert.equal(w(60).days, 14);
  assert.equal(w(45).days, 10, 'da 30 giorni: 10');
  assert.equal(w(20).days, 5, 'da 14 giorni: 5');
  assert.equal(w(8).days, 3, 'da 7 giorni: 3');
  assert.equal(w(3.5).days, 1, 'da 3 giorni: 1');
  assert.deepEqual(w(2), { ok: false, reason: 'tooClose' }, 'sotto l’ultima riga: si prenota direttamente');
  assert.equal(w(45).expiresMs, NOW + 10 * DAY);
  // la scadenza lascia sempre almeno 48 ore prima del servizio
  const near = w(3.5);
  assert.ok(near.expiresMs <= startAt(3.5) - 48 * HOUR, 'almeno 48 ore prima');
  assert.equal(near.capped, false, 'un giorno di opzione basta a stare dentro il margine');
  assert.ok(w(3.2, null, { ...OPTIONS, minReleaseHours: 72 }).capped, 'con un margine più largo (72 ore) la scadenza si accorcia');
  // il margine si cambia dalle impostazioni
  assert.equal(w(8, null, { ...OPTIONS, minReleaseHours: 144 }).capped, true, 'tour fra 8 giorni, margine di 6: l’opzione di 3 giorni diventa di 2');
  assert.deepEqual(w(5, null, { ...OPTIONS, minReleaseHours: 120 }), { ok: false, reason: 'tooClose' }, 'con 120 ore di margine un tour fra 5 giorni non si opziona');
  // spente per tutto il sito, o per un solo partner
  assert.deepEqual(w(45, null, { ...OPTIONS, enabled: false }), { ok: false, reason: 'disabled' });
  assert.deepEqual(w(45, { options_enabled: 0 }), { ok: false, reason: 'disabled' });
  // durata fissa del partner: vale al posto della tabella e anche per i tour vicini, sempre con il limite prima del servizio
  assert.equal(w(45, { options_enabled: 1, option_days: 4 }).days, 4);
  assert.equal(w(5, { options_enabled: 1, option_days: 4 }).capped, true);
  const close = w(2.5, { options_enabled: 1, option_days: 4 });
  assert.ok(close.ok && close.capped && close.expiresMs === startAt(2.5) - 48 * HOUR, 'con durata fissa si può opzionare anche un tour vicino: scade 48 ore prima');
  assert.equal(w(2.02, { options_enabled: 1, option_days: 4 }).ok, false, 'ma non se mancano meno di 49 ore: non c’è più nulla da trattenere');
  // tabella personalizzata, in qualunque ordine
  assert.deepEqual(normalizeOptionTiers([{ fromDays: 5, days: 2 }, { fromDays: 30, days: 9 }, { fromDays: -1, days: 1 }, { fromDays: 'x', days: 1 }]), [{ fromDays: 30, days: 9 }, { fromDays: 5, days: 2 }]);
  assert.equal(optionWindow({ options: { ...OPTIONS, tiers: [{ fromDays: 5, days: 2 }, { fromDays: 30, days: 9 }] }, startMs: startAt(33), nowMs: NOW }).days, 9);
  // limite di opzioni aperte: del sito, o del partner (0 = nessun limite)
  assert.equal(maxActiveOptions(OPTIONS, {}), 5);
  assert.equal(maxActiveOptions(OPTIONS, { option_max: 2 }), 2);
  assert.equal(maxActiveOptions(OPTIONS, { option_max: 0 }), 0);
  assert.equal(maxActiveOptions({ ...OPTIONS, maxActive: 0 }, {}), 0);
});

test('promemoria di scadenza: parte 24 ore prima, ma non per le opzioni brevissime', () => {
  assert.equal(reminderAt({ createdMs: NOW, expiresMs: NOW + 10 * DAY, reminderHours: 24 }), NOW + 9 * DAY);
  assert.equal(reminderAt({ createdMs: NOW, expiresMs: NOW + 2 * DAY, reminderHours: 24 }), NOW + DAY, '2 giorni: sì');
  assert.equal(reminderAt({ createdMs: NOW, expiresMs: NOW + DAY, reminderHours: 24 }), null, 'un giorno: sarebbe subito');
  assert.equal(reminderAt({ createdMs: NOW, expiresMs: NOW + 10 * DAY, reminderHours: 0 }), null, '0 = nessun promemoria');
});

/** Un'agenzia approvata con le condizioni del sito, e un'app di prova. */
function setup(over = {}, cfgOver = {}) {
  const app = makeApp(cfgOver);
  const acct = addAccount(app.db, over);
  return { app, acct };
}
const optionInput = (acct, over = {}) => base({ channel: 'b2b', account: acct, option: true, email: acct.email, name: 'Anna', clientRef: 'Gruppo Rossi', date: '2027-02-20', time: '09:30', ...over });

test('opzione: la data resta trattenuta senza pagare e blocca lo slot per gli altri; non conta come venduto', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const b = createBooking(app, optionInput(acct, { tourSlug: 'private', time: '10:00', pax: 5 }), NOW);
  assert.equal(b.status, 'option');
  assert.equal(b.payment_status, 'unpaid');
  assert.equal(b.confirmed_at, null);
  assert.equal(b.hold_expires_at, null);
  assert.equal(b.payment_method, 'invoice', 'come pagherà si sceglie alla conferma');
  assert.equal(Date.parse(b.option_expires_at), NOW + 10 * DAY, '47 giorni al tour: 10 giorni di opzione');
  // lo slot (servizio privato) non è più libero per nessuno, finché l'opzione è aperta
  const free = () => daySlots(app.db, app.cfg, app.content.tour('private'), '2027-02-20', { pax: 2, channel: 'b2c', nowMs: NOW }).map((s) => s.time);
  assert.ok(!free().includes('10:00'));
  assert.throws(() => createBooking(app, base({ tourSlug: 'private', date: '2027-02-20', time: '10:00', pax: 2, paymentMethod: 'onsite' }), NOW), (e) => e.code === 'unavailable');
  // scaduta, lo slot torna libero
  const later = NOW + 10 * DAY + 1000;
  assert.ok(daySlots(app.db, app.cfg, app.content.tour('private'), '2027-02-20', { pax: 2, channel: 'b2c', nowMs: later }).some((s) => s.time === '10:00'), 'dopo la scadenza (anche prima che il lavoro periodico la chiuda) lo slot è libero');
  assert.equal(activeOptionCount(app.db, acct.id, NOW), 1);
  assert.equal(activeOptionCount(app.db, acct.id, later), 0);
});

test('opzione: solo agenzie approvate, rispettando le regole (spente, troppo vicina, limite)', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  assert.throws(() => createBooking(app, base({ option: true, paymentMethod: 'onsite' }), NOW), (e) => e instanceof BookingError && e.code === 'option', 'i privati non opzionano');
  assert.throws(() => createBooking(app, optionInput({ ...acct, status: 'pending' }), NOW), (e) => e.code === 'account');
  assert.throws(() => createBooking(app, optionInput(acct, { date: '2027-01-06', time: '09:30' }), NOW), (e) => e.code === 'option' && e.message === 'tooClose', 'fra 2 giorni: si prenota direttamente');
  // fuori dal limite: 2 opzioni aperte al massimo per questa agenzia
  app.db.prepare('UPDATE accounts SET option_max = 2 WHERE id = ?').run(acct.id);
  const a = app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id);
  createBooking(app, optionInput(a, { date: '2027-02-20', time: '09:30' }), NOW);
  createBooking(app, optionInput(a, { date: '2027-02-21', time: '09:30' }), NOW);
  assert.throws(() => createBooking(app, optionInput(a, { date: '2027-02-22', time: '09:30' }), NOW), (e) => e.code === 'option' && e.message === 'limit');
  // una prenotazione diretta resta possibile (il limite riguarda solo le opzioni)
  assert.equal(createBooking(app, base({ channel: 'b2b', account: a, date: '2027-02-22', time: '09:30', paymentMethod: 'invoice' }), NOW).status, 'confirmed');
  // opzioni spente per il partner
  app.db.prepare('UPDATE accounts SET options_enabled = 0 WHERE id = ?').run(acct.id);
  assert.throws(() => createBooking(app, optionInput(app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id), { date: '2027-02-23' }), NOW), (e) => e.message === 'disabled');
});

test('opzione scaduta: si libera da sola, senza costi né annulli; opzione rilasciata o annullata dalla guida idem', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const o1 = createBooking(app, optionInput(acct, { date: '2027-02-20' }), NOW);
  const o2 = createBooking(app, optionInput(acct, { date: '2027-02-21' }), NOW);
  const o3 = createBooking(app, optionInput(acct, { date: '2027-02-22' }), NOW);
  assert.deepEqual(expireOptions(app.db, NOW + 9 * DAY), [], 'non ancora scadute');
  assert.equal(releaseOption(app, o2.id, { by: 'customer' }, NOW + DAY).status, 'expired', 'rilasciata dall’agenzia');
  const cancelled = cancelBooking(app, o3.id, { by: 'admin', reason: 'doppione' }, NOW + DAY);
  assert.equal(cancelled.option, true);
  assert.deepEqual([cancelled.refundCents, cancelled.retainedCents], [0, 0], 'nessuna penale');
  assert.equal(getBooking(app.db, o3.id).status, 'expired', 'non è un annullo: non gonfia i tassi di annullo');
  assert.equal(getBooking(app.db, o3.id).cancel_reason, 'doppione');
  const lapsed = expireOptions(app.db, NOW + 10 * DAY + 1);
  assert.deepEqual(lapsed.map((x) => x.id), [o1.id]);
  assert.equal(lapsed[0].status, 'expired');
  assert.equal(lapsed[0].cancelled_by, 'system');
  assert.match(lapsed[0].cancel_reason, /scaduta/);
  assert.equal(lapsed[0].option_expires_at, o1.option_expires_at, 'si conserva: si capisce che era un’opzione');
  assert.equal(releaseOption(app, o1.id, { by: 'customer' }), null, 'già chiusa');
  // l'avviso delle prenotazioni non conta le opzioni chiuse
  assert.equal(activeOptionCount(app.db, acct.id, NOW + 11 * DAY), 0);
});

test('confermare un’opzione: a fattura subito confermata; solo carta passa dal pagamento e, se non si paga, resta opzione', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const inv = createBooking(app, optionInput(acct, { date: '2027-02-20' }), NOW);
  const r = confirmOption(app, inv.id, {}, NOW + 2 * DAY);
  assert.equal(r.outcome, 'confirmed');
  assert.equal(r.booking.status, 'confirmed');
  assert.equal(r.booking.payment_method, 'invoice');
  assert.equal(r.booking.confirmed_at, new Date(NOW + 2 * DAY).toISOString());
  assert.equal(confirmOption(app, inv.id, {}, NOW + 3 * DAY).outcome, 'state', 'una volta sola');

  // partner che non può pagare a fattura: conferma → carta
  const cardOnly = addAccount(app.db, { email: 'solo-carta@example.com', allow_invoice: 0 });
  const o = createBooking(app, optionInput(cardOnly, { date: '2027-02-21', email: cardOnly.email }), NOW);
  assert.equal(o.payment_method, 'card');
  const c = confirmOption(app, o.id, {}, NOW + DAY);
  assert.equal(c.outcome, 'pay');
  assert.equal(c.booking.status, 'held');
  assert.equal(Date.parse(c.booking.hold_expires_at), NOW + DAY + app.cfg.policy.holdMinutes * 60_000);
  // il pagamento non arriva: lo slot torna opzione (la sua scadenza non è passata)
  assert.equal(expireHolds(app.db, NOW + DAY + 40 * 60_000), 1);
  const back = getBooking(app.db, o.id);
  assert.equal(back.status, 'option');
  assert.equal(back.hold_expires_at, null);
  // e se invece si paga, è confermata
  const again = confirmOption(app, o.id, {}, NOW + 2 * DAY);
  assert.equal(again.outcome, 'pay');
  assert.equal(confirmPaid(app, o.id, 'pi_1', NOW + 2 * DAY + 5 * 60_000).outcome, 'confirmed');
  assert.equal(getBooking(app.db, o.id).payment_status, 'paid');
  // opzione scaduta nel frattempo
  const late = createBooking(app, optionInput(acct, { date: '2027-02-24' }), NOW);
  const res = confirmOption(app, late.id, {}, NOW + 11 * DAY);
  assert.equal(res.outcome, 'expired');
  assert.equal(res.booking.status, 'expired');
  // la carta in sospeso scaduta DOPO la scadenza dell'opzione chiude davvero la prenotazione
  const lastMinute = createBooking(app, optionInput(cardOnly, { date: '2027-02-25', email: cardOnly.email }), NOW);
  confirmOption(app, lastMinute.id, {}, NOW + 9 * DAY + 23 * HOUR + 50 * 60_000);
  expireBooking(app.db, lastMinute.id, NOW + 10 * DAY + 1);
  assert.equal(getBooking(app.db, lastMinute.id).status, 'expired');
});

test('prolungare un’opzione e promemoria: una sola volta, riparte dopo la proroga', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const o = createBooking(app, optionInput(acct, { date: '2027-02-20' }), NOW); // scade fra 10 giorni
  assert.equal(optionsDueForReminder(app, NOW + 8 * DAY).length, 0, 'ancora presto');
  assert.deepEqual(optionsDueForReminder(app, NOW + 9 * DAY + HOUR).map((x) => x.id), [o.id], 'a 24 ore dalla scadenza');
  const ext = extendOption(app, o.id, 5, NOW + 9 * DAY + HOUR);
  assert.equal(Date.parse(ext.option_expires_at), NOW + 15 * DAY);
  assert.equal(ext.option_reminded_at, null);
  assert.equal(optionsDueForReminder(app, NOW + 9 * DAY + HOUR).length, 0, 'dopo la proroga il promemoria slitta');
  // mai oltre un'ora prima del servizio
  const far = extendOption(app, o.id, 90, NOW + 9 * DAY);
  assert.equal(Date.parse(far.option_expires_at), localToInstant('2027-02-20', '09:30') - HOUR);
  assert.throws(() => extendOption(app, o.id, 0, NOW), (e) => e.code === 'invalid', 'giorni non validi');
});

test('servizi: l’agenzia riceve l’opzione, il promemoria e la scadenza; la guida sa tutto; la conferma manda voucher e riepilogo', async (t) => {
  const { app, acct } = setup({ email: 'dmc@example.com', lang: 'it' }, { mail: { notifyTo: 'guida@example.com' } });
  t.after(app.cleanup);
  const { redirect, booking } = await app.services.book(optionInput(acct, { date: '2027-02-20', lang: 'en', email: 'dmc@example.com' }), 'en', NOW);
  assert.match(redirect, new RegExp(`/en/booking/${booking.ref}\\?t=${booking.token}&new=1`));
  const created = app.mail.sent.find((m) => m.to === 'dmc@example.com' && /Option placed/.test(m.subject));
  assert.ok(created, 'email all’agenzia, in inglese');
  assert.match(created.text, /held for you until/);
  assert.match(created.text, new RegExp(`/en/booking/${booking.ref}\\?t=`));
  assert.ok(!/paid online|by invoice/.test(created.text), 'non dice come si paga: non è ancora deciso');
  assert.ok(app.mail.sent.some((m) => m.to === 'guida@example.com' && /Nuova opzione/.test(m.subject)), 'la guida è avvisata');

  // promemoria (una volta sola) e scadenza
  await app.services.sweepOptions(NOW + 9 * DAY + HOUR);
  await app.services.sweepOptions(NOW + 9 * DAY + 2 * HOUR);
  assert.equal(app.mail.sent.filter((m) => /Reminder: option/.test(m.subject)).length, 1);
  await app.services.sweepOptions(NOW + 10 * DAY + 5 * 60_000);
  assert.ok(app.mail.sent.some((m) => m.to === 'dmc@example.com' && /Option expired/.test(m.subject)));
  assert.ok(app.mail.sent.some((m) => m.to === 'guida@example.com' && /Opzione scaduta/.test(m.subject)));
  assert.equal(getBooking(app.db, booking.id).status, 'expired');
  await app.services.sweepOptions(NOW + 11 * DAY);
  assert.equal(app.mail.sent.filter((m) => /Option expired/.test(m.subject)).length, 1, 'una sola email di scadenza');

  // un'altra opzione: confermata → riepilogo e voucher come una prenotazione normale
  const o = (await app.services.book(optionInput(acct, { date: '2027-03-02', lang: 'it', email: 'dmc@example.com' }), 'it', NOW)).booking;
  const res = await app.services.confirmOption(o.id, 'it', {}, NOW + DAY);
  assert.equal(res.outcome, 'confirmed');
  const confirmed = app.mail.sent.find((m) => /Prenotazione confermata/.test(m.subject) && m.subject.includes(o.ref));
  assert.ok(confirmed, 'conferma con riepilogo');
  assert.ok(confirmed.attachments?.some((a) => /voucher/.test(a.filename)), 'e voucher');
  // rilascio da parte della guida: l'agenzia lo sa; da parte dell'agenzia: lo sa la guida
  const o2 = (await app.services.book(optionInput(acct, { date: '2027-03-03', lang: 'it', email: 'dmc@example.com' }), 'it', NOW)).booking;
  await app.services.cancel(o2.id, { by: 'admin' }, NOW + DAY);
  assert.ok(app.mail.sent.some((m) => m.to === 'dmc@example.com' && /Opzione rilasciata/.test(m.subject)));
  const o3 = (await app.services.book(optionInput(acct, { date: '2027-03-04', lang: 'it', email: 'dmc@example.com' }), 'it', NOW)).booking;
  await app.services.releaseOption(o3.id, { by: 'customer' }, NOW + DAY);
  assert.ok(app.mail.sent.some((m) => m.to === 'guida@example.com' && /rilasciata dall’agenzia/.test(m.subject)));
});

test('pre-apertura: prima della data degli incassi si prenota solo per date da quel giorno, senza pagare online', async (t) => {
  const { app, acct } = setup({}, { policy: { paymentsFrom: '2027-03-01', allowPayOnSite: false } });
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  // privati: solo il pagamento il giorno del servizio, anche se «pagamento sul posto» è spento nelle regole e nel tour
  assert.deepEqual(paymentOptions(app, { ...shared, payOnSite: false }, 'b2c', null, NOW), ['onsite']);
  // agenzie: fattura (mai la carta); le agenzie solo carta non hanno nulla, ma possono opzionare
  assert.deepEqual(paymentOptions(app, shared, 'b2b', acct, NOW), ['invoice']);
  assert.deepEqual(paymentOptions(app, shared, 'b2b', { ...acct, allow_invoice: 0 }, NOW), []);
  // dopo la data: come sempre
  const after = localToInstant('2027-03-01', '09:00');
  assert.deepEqual(paymentOptions(app, shared, 'b2c', null, after), ['card'], 'dopo l’apertura: la carta (il pagamento sul posto resta spento nelle regole)');
  // le date prima dell'apertura non si prenotano
  const slotsOn = (date) => daySlots(app.db, app.cfg, shared, date, { pax: 2, channel: 'b2c', nowMs: NOW }).map((s) => s.time);
  assert.deepEqual(slotsOn('2027-02-26'), []);
  assert.ok(slotsOn('2027-03-02').length > 0);
  // e si prenota senza pagare: confermata, da pagare il giorno del servizio
  assert.throws(() => createBooking(app, base({ date: '2027-02-26', paymentMethod: 'onsite' }), NOW), (e) => e.code === 'unavailable');
  assert.throws(() => createBooking(app, base({ date: '2027-03-02', paymentMethod: 'card' }), NOW), (e) => e.code === 'payment', 'la carta non c’è');
  const b = createBooking(app, base({ date: '2027-03-02', paymentMethod: 'onsite' }), NOW);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.payment_status, 'unpaid');
  // buoni regalo e acconti non si pagano online finché non si incassa
  assert.equal(app.gifts.available, false);
  assert.equal(app.programs.depositsOnline, false);
});

test('chi ha prenotato prima dell’apertura può pagare online dopo, dalla pagina della prenotazione', async (t) => {
  const { app } = setup({}, { policy: { paymentsFrom: '2027-03-01', allowPayOnSite: false } });
  t.after(app.cleanup);
  const b = createBooking(app, base({ date: '2027-03-10', paymentMethod: 'onsite' }), NOW);
  // il pulsante «Paga ora online» c'è solo da quando si incassa, e finché il servizio non è iniziato
  assert.equal(app.services.payableLater(b, NOW), false, 'prima del 1 marzo: nessun pagamento online');
  assert.equal(app.services.payableLater(b, localToInstant('2027-03-02', '10:00')), true);
  assert.equal(app.services.payableLater(b, localToInstant('2027-03-10', '10:00')), false, 'servizio già iniziato');
  assert.equal(app.services.payableLater({ ...b, payment_method: 'invoice' }, localToInstant('2027-03-02', '10:00')), false, 'solo chi doveva pagare di persona');
  const found = app.payables.lookup(b.ref);
  assert.equal(found.handler.dueCents(found.row), b.total_cents);
  const r = confirmPaid(app, b.id, 'pi_later', NOW);
  assert.equal(r.outcome, 'paid_later');
  const paid = getBooking(app.db, b.id);
  assert.equal(paid.payment_status, 'paid');
  assert.equal(paid.payment_method, 'card');
  assert.equal(paid.stripe_payment_intent, 'pi_later');
  assert.equal(paid.status, 'confirmed');
  assert.equal(confirmPaid(app, b.id, 'pi_other', NOW).outcome, 'already', 'un secondo pagamento non cambia nulla (poi si rimborsa)');
});

const FIRM = { ...OPTIONS, firmEnabled: true, firmFromDays: 21, firmGraceHours: 48, firmRefundPercent: 50 };

test('prenotazione ferma per una data lontana: cancellazione gratuita breve, poi rimborso ridotto fino al termine normale', () => {
  const tiers = [{ hours: 72, refund: 100 }];
  const far = firmTiers({ options: FIRM, tiers, startMs: startAt(60), nowMs: NOW });
  assert.equal(far.applied, true);
  assert.deepEqual(far.tiers.map((t) => [t.hours, t.refund]), [[(60 * DAY - 48 * HOUR) / HOUR, 100], [72, 50]]);
  assert.equal(far.graceUntilMs, NOW + 48 * HOUR);
  assert.equal(far.normalUntilMs, startAt(60) - 72 * HOUR);
  assert.equal(far.refundPercent, 50);
  // a 0% non c'è lo scaglione intermedio: dopo i due giorni non si rimborsa più
  assert.deepEqual(firmTiers({ options: { ...FIRM, firmRefundPercent: 0 }, tiers, startMs: startAt(60), nowMs: NOW }).tiers.map((t) => t.refund), [100]);
  // con scaglioni successivi, il rimborso non risale mai
  const multi = firmTiers({ options: { ...FIRM, firmRefundPercent: 20 }, tiers: [{ hours: 72, refund: 100 }, { hours: 24, refund: 50 }], startMs: startAt(60), nowMs: NOW });
  assert.deepEqual(multi.tiers.map((t) => t.refund), [100, 50, 50]);
  // vicino, spento o senza periodo gratuito: nessuna modifica
  assert.equal(firmTiers({ options: FIRM, tiers, startMs: startAt(20), nowMs: NOW }).applied, false, 'sotto i 21 giorni');
  assert.equal(firmTiers({ options: { ...FIRM, firmEnabled: false }, tiers, startMs: startAt(60), nowMs: NOW }).applied, false);
  assert.equal(firmTiers({ options: FIRM, tiers: [{ hours: 72, refund: 50 }], startMs: startAt(60), nowMs: NOW }).applied, false, 'senza rimborso totale non c’è nulla da accorciare');
  assert.equal(firmTiers({ options: { ...FIRM, firmGraceHours: 24 * 59 }, tiers, startMs: startAt(60), nowMs: NOW }).applied, false, 'la finestra non supera il termine normale');
});

test('prenotazione ferma lontana: la prenotazione conserva gli scaglioni brevi; l’opzione conferma da quel momento; le vicine e le manuali no', () => {
  const app = makeApp();
  try {
    app.cfg.options = { ...app.cfg.options, ...FIRM };
    const acct = addAccount(app.db);
    const far = new Date(NOW + 40 * DAY).toISOString().slice(0, 10);
    const near = new Date(NOW + 10 * DAY).toISOString().slice(0, 10);
    const mk = (date, over = {}) => createBooking(app, base({ tourSlug: 'shared', date, time: '09:30', channel: 'b2b', account: acct, paymentMethod: 'invoice', ...over }), NOW);
    const b = mk(far);
    assert.equal(Date.parse(b.free_cancel_until), NOW + 48 * HOUR, 'gratis solo per 48 ore dalla prenotazione');
    assert.equal(cancellationState(b, NOW + HOUR).percent, 100);
    assert.equal(cancellationState(b, NOW + 3 * DAY).percent, 50, 'poi il rimborso scende');
    // vicina: come sempre (gratis fino a 72 ore prima, qui 5 giorni di margine)
    const n = mk(near);
    assert.equal(Date.parse(n.free_cancel_until), localToInstant(near, '09:30') - freeHoursOf(JSON.parse(n.cancel_policy_json)) * HOUR);
    assert.ok(Date.parse(n.free_cancel_until) > NOW + 48 * HOUR);
    // opzione: nessun cambio finché non si conferma; confermando, la finestra breve riparte da adesso
    const o = mk(new Date(NOW + 45 * DAY).toISOString().slice(0, 10), { option: true, paymentMethod: undefined });
    assert.equal(o.status, 'option');
    assert.ok(Date.parse(o.free_cancel_until) > NOW + 40 * DAY, 'l’opzione non è ancora un impegno');
    const later = NOW + 5 * DAY;
    const res = confirmOption(app, o.id, { method: 'invoice' }, later);
    assert.equal(res.outcome, 'confirmed');
    assert.equal(Date.parse(res.booking.free_cancel_until), later + 48 * HOUR);
    assert.equal(cancellationState(res.booking, later + 3 * DAY).percent, 50);
  } finally {
    app.cleanup();
  }
});
