// Modifiche dell'agenzia (persone, data, ore) e richieste di proroga delle opzioni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createBooking, getBooking, confirmOption } from '../server/bookings.js';
import { ChangeError, changeHistory, changeRules, changeSlots, currentParams, denyExtension, evaluateChange, modifyBooking, movedTiers, pendingExtension, requestExtension } from '../server/changes.js';
import { createConfig, ROOT } from '../server/config.js';
import { createContentStore } from '../server/contentStore.js';
import { createContext } from '../server/context.js';
import { openDb } from '../server/db.js';
import { createDrafts } from '../server/invoices.js';
import { createPackage, packageBookings, resolveLine } from '../server/packages.js';
import { localToInstant } from '../server/time.js';
import { addAccount, NOW } from './helpers.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const GUIDE = 'guida@example.com';

/** Il sito vero (servizi a ore compresi), con un'agenzia approvata che paga a fattura. */
function setup(acctOver = {}) {
  const dir = path.join(ROOT, 'data', 'test-changes-' + crypto.randomBytes(3).toString('hex'));
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, demoPayments: true, mail: { notifyTo: GUIDE } });
  const db = openDb(':memory:');
  const app = createContext({ cfg, db, content: createContentStore({ db, root: ROOT }) });
  const acct = addAccount(db, { email: 'dmc@example.com', lang: 'it', ...acctOver });
  return { app, acct, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const SHARED = 'cannaregio-ghetto-agenzie'; // visita condivisa: 10:00 e 15:00, fino a 10 persone
const HOURLY = 'guida-a-ore-agenzie'; // servizio a ore, a scelta
const book = (app, acct, over = {}) =>
  createBooking(app, { tourSlug: SHARED, date: '2027-03-10', time: '10:00', pax: 4, channel: 'b2b', account: acct, name: 'Anna', email: acct.email, lang: 'it', clientRef: 'Gruppo Rossi', paymentMethod: 'invoice', ...over }, NOW);
const option = (app, acct, over = {}) => book(app, acct, { option: true, paymentMethod: undefined, ...over });

test('chi può cambiare cosa: opzione libera, prenotazione a fattura libera nel periodo gratuito e solo in aumento dopo; il resto si chiede alla guida', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const o = option(app, acct);
  assert.deepEqual(changeRules(app, o, NOW), { allowed: true, mode: 'free' });
  const b = book(app, acct, { date: '2027-03-20' });
  const r = changeRules(app, b, NOW);
  assert.ok(r.allowed && r.mode === 'free' && r.until > NOW, 'nel periodo gratuito si cambia tutto');
  const eve = localToInstant('2027-03-19', '10:00'); // meno di un giorno al servizio: il periodo gratuito è finito
  assert.deepEqual(changeRules(app, b, eve), { allowed: true, mode: 'increase' });
  assert.deepEqual(changeRules(app, b, localToInstant('2027-03-20', '10:00')), { allowed: false, reason: 'started' });

  // pagata (carta o bonifico già incassato), già in una fattura, prezzo concordato, in attesa di pagamento, di un privato
  const card = addAccount(app.db, { email: 'carta@example.com', allow_invoice: 0 });
  const paid = createBooking(app, { tourSlug: SHARED, date: '2027-03-12', time: '10:00', pax: 2, channel: 'b2b', account: card, name: 'Carla', email: card.email, lang: 'it', paymentMethod: 'card' }, NOW);
  assert.deepEqual(changeRules(app, paid, NOW), { allowed: false, reason: 'held' });
  app.db.prepare(`UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?`).run(paid.id);
  assert.deepEqual(changeRules(app, getBooking(app.db, paid.id), NOW), { allowed: false, reason: 'card' });
  const bank = book(app, acct, { date: '2027-03-22' });
  app.db.prepare(`UPDATE bookings SET payment_status = 'paid' WHERE id = ?`).run(bank.id);
  assert.deepEqual(changeRules(app, getBooking(app.db, bank.id), NOW), { allowed: false, reason: 'paid' });
  const invoiced = book(app, acct, { date: '2027-03-24' });
  createDrafts(app, [`booking:${invoiced.id}`], NOW);
  assert.deepEqual(changeRules(app, invoiced, NOW), { allowed: false, reason: 'invoiced' });
  const custom = createBooking(app, { tourSlug: SHARED, date: '2027-03-26', time: '10:00', pax: 3, channel: 'b2b', account: acct, name: 'Anna', email: acct.email, lang: 'it', manual: { totalCents: 25000, paid: false } }, NOW);
  assert.equal(custom.custom_price, 1);
  assert.deepEqual(changeRules(app, custom, NOW), { allowed: false, reason: 'custom' });
  const priv = createBooking(app, { tourSlug: 'cannaregio-ghetto', date: '2027-03-28', time: '10:00', pax: 2, channel: 'b2c', name: 'Mario', email: 'm@example.com', lang: 'it', paymentMethod: 'card' }, NOW);
  assert.deepEqual(changeRules(app, priv, NOW), { allowed: false, reason: 'channel' });
});

test('cambiare le persone ricalcola il prezzo, tiene traccia e non tocca il resto; i dati impossibili si rifiutano con un motivo', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const b = book(app, acct); // 4 persone
  const unit = b.total_cents / 4;
  const r = modifyBooking(app, b.id, { pax: 6 }, { by: 'customer' }, NOW);
  assert.equal(r.after.participants, 6);
  assert.equal(r.after.total_cents, unit * 6, 'prezzo a persona ricalcolato');
  assert.equal(r.deltaCents, unit * 2);
  assert.equal(r.dateChanged, false);
  assert.deepEqual([r.after.date, r.after.start_time, r.after.end_time, r.after.status, r.after.payment_status], [b.date, b.start_time, b.end_time, 'confirmed', 'unpaid']);
  assert.equal(r.after.cancel_policy_json, b.cancel_policy_json, 'le regole di annullo restano quelle');
  assert.ok(r.after.modified_at);
  const h = changeHistory(app.db, b.id);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].before.pax, h[0].after.pax, h[0].by], [4, 6, 'customer']);
  assert.equal(currentParams(app, r.after).pax, 6);

  const err = (input) => { try { modifyBooking(app, b.id, input, {}, NOW); } catch (e) { return e; } return null; };
  assert.equal(err({ pax: 6 })?.code, 'nochange');
  assert.equal(err({ pax: 11 })?.code, 'invalid', 'più del massimo della visita');
  assert.equal(err({ pax: 0 })?.code, 'invalid');
  assert.equal(err({ date: '2026-01-01', time: '10:00' })?.code, 'invalid', 'nel passato');
  assert.equal(err({ time: '11:11' })?.code, 'unavailable', 'un orario che la visita non ha');
  assert.ok(err({ pax: 9 }) === null, 'fino al massimo si può');
  assert.equal(getBooking(app.db, b.id).total_cents, unit * 9);
});

test('spostare data e orario: servono posti liberi, i promemoria ripartono e le scadenze di annullo non si allungano', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const b = book(app, acct, { date: '2027-03-10' });
  app.db.prepare(`UPDATE bookings SET reminder_status = 'sent', reminder_sent_at = ?, penalty_reminded_at = ? WHERE id = ?`).run('x', 'y', b.id);
  // un altro gruppo riempie la partenza delle 15:00 del giorno dopo
  book(app, acct, { date: '2027-03-11', time: '15:00', pax: 8, clientRef: 'Altri' });
  assert.equal((() => { try { modifyBooking(app, b.id, { date: '2027-03-11', time: '15:00' }, {}, NOW); } catch (e) { return e.code; } return null; })(), 'unavailable', '4 persone non ci stanno più (8 + 4 > 10)');
  const moved = modifyBooking(app, b.id, { date: '2027-03-11', time: '10:00' }, {}, NOW);
  assert.deepEqual([moved.after.date, moved.after.start_time, moved.after.end_time], ['2027-03-11', '10:00', '12:30']);
  assert.equal(moved.dateChanged, true);
  assert.equal(moved.after.reminder_status, null, 'il promemoria della sera prima ripartirà per la nuova data');
  assert.equal(moved.after.penalty_reminded_at, null);
  // le scadenze di annullo restano quelle di prima: spostare di un giorno più avanti non regala un giorno di cancellazione gratuita
  assert.equal(moved.after.free_cancel_until, b.free_cancel_until);
  const tiers = JSON.parse(moved.after.cancel_policy_json);
  const was = JSON.parse(b.cancel_policy_json);
  assert.deepEqual(tiers.map((x) => x.hours), was.map((x) => x.hours + 24), 'più «ore prima», così la scadenza assoluta non si muove');
  assert.deepEqual(tiers.map((x) => x.refund), was.map((x) => x.refund));
  // spostare prima non allunga nulla: valgono le stesse «ore prima» della nuova data
  const earlier = modifyBooking(app, b.id, { date: '2027-03-09', time: '10:00' }, {}, NOW);
  assert.deepEqual(JSON.parse(earlier.after.cancel_policy_json).map((x) => x.hours), was.map((x) => x.hours), 'si riparte dalla politica di quando si è prenotato');
  assert.ok(Date.parse(earlier.after.free_cancel_until) < Date.parse(moved.after.free_cancel_until));
  assert.deepEqual(movedTiers(b, localToInstant('2027-03-10', '10:00')).map((x) => x.hours), was.map((x) => x.hours), 'senza spostamenti nulla cambia');
});

test('dopo il periodo gratuito si può solo aumentare, sullo stesso orario (anche dentro il preavviso)', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const b = book(app, acct, { date: '2027-03-20', pax: 4 });
  const eve = localToInstant('2027-03-19', '10:00');
  const input = (o) => evaluateChange(app, b, o, eve);
  assert.equal(input({ pax: 3 }).error, 'reduceLocked');
  assert.equal(input({ time: '15:00' }).error, 'moveLocked');
  assert.equal(input({ date: '2027-03-21' }).error, 'moveLocked');
  const up = input({ pax: 6 });
  assert.ok(up.ok, 'più persone sullo stesso orario: sì, anche se manca meno del preavviso minimo');
  assert.equal(up.deltaCents, (b.total_cents / 4) * 2);
  const done = modifyBooking(app, b.id, { pax: 6 }, {}, eve);
  assert.equal(done.after.participants, 6);
  assert.equal(done.after.cancel_policy_json, b.cancel_policy_json, 'le scadenze non cambiano');
  // la lista degli orari ha solo quello di adesso
  const slots = changeSlots(app, getBooking(app.db, b.id), { pax: 7 }, eve);
  assert.deepEqual(slots.map((s) => [s.time, s.current]), [['10:00', true]]);
});

test('servizi a ore: cambiare le ore ricalcola prezzo e fine; nel periodo gratuito anche in meno, dopo solo in più', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const b = createBooking(app, { tourSlug: HOURLY, date: '2027-03-09', time: '10:00', pax: 5, hours: 4, channel: 'b2b', account: acct, name: 'Anna', email: acct.email, lang: 'it', paymentMethod: 'invoice' }, NOW);
  assert.equal(currentParams(app, b).hours, 4);
  const more = modifyBooking(app, b.id, { hours: 6 }, {}, NOW);
  assert.equal(more.after.end_time, '16:00');
  assert.equal(JSON.parse(more.after.service_json).hours, 6);
  assert.ok(more.after.total_cents > b.total_cents, 'più ore, più prezzo');
  const less = modifyBooking(app, b.id, { hours: 2 }, {}, NOW);
  assert.equal(less.after.end_time, '12:00');
  assert.ok(less.after.total_cents < b.total_cents, 'nel periodo gratuito si può anche ridurre');
  assert.equal((() => { try { modifyBooking(app, b.id, { hours: 3.7 }, {}, NOW); } catch (e) { return e.code; } return null; })(), 'invalid', 'solo mezze ore');
  // dopo il periodo gratuito: si può allungare, non accorciare
  const late = localToInstant('2027-03-08', '10:00');
  assert.equal(evaluateChange(app, getBooking(app.db, b.id), { hours: 1 }, late).error, 'invalid', 'meno del minimo del servizio: non valido');
  assert.ok(evaluateChange(app, getBooking(app.db, b.id), { hours: 3 }, late).ok, 'più ore: sì');
  assert.equal(evaluateChange(app, getBooking(app.db, b.id), { hours: 3 }, late).to.end, '13:00');
});

test('opzione: cambiare liberamente, ma spostare la data non allunga mai la scadenza (e un pacchetto scade tutto insieme)', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const o = option(app, acct, { date: '2027-03-10' }); // 65 giorni: 14 giorni di opzione
  assert.equal(Date.parse(o.option_expires_at), NOW + 14 * DAY);
  const later = modifyBooking(app, o.id, { date: '2027-05-10' }, {}, NOW);
  assert.equal(later.after.option_expires_at, o.option_expires_at, 'più lontano: la scadenza resta');
  const closer = modifyBooking(app, o.id, { date: '2027-01-20', time: '10:00' }, {}, NOW); // 16 giorni: 5 giorni di opzione
  assert.equal(Date.parse(closer.after.option_expires_at), NOW + 5 * DAY, 'più vicino: la scadenza si accorcia');
  assert.equal(closer.after.status, 'option');
  assert.equal((() => { try { modifyBooking(app, o.id, { date: '2027-01-06', time: '10:00' }, {}, NOW); } catch (e) { return [e.code, e.reason]; } return null; })()?.[0], 'option', 'troppo vicino per un’opzione');
  assert.equal(modifyBooking(app, o.id, { pax: 2 }, {}, NOW).after.total_cents, (o.total_cents / 4) * 2);

  // in un pacchetto: spostare una data accorcia la scadenza di tutte
  const pkg = createPackage(app, acct, [resolveLine(app, { tour: SHARED, date: '2027-03-12', time: '10:00', pax: '3' }), resolveLine(app, { tour: SHARED, date: '2027-03-14', time: '15:00', pax: '3' })], { name: 'Anna', email: acct.email, lang: 'it', option: true }, NOW);
  assert.equal(new Set(pkg.bookings.map((x) => x.option_expires_at)).size, 1);
  modifyBooking(app, pkg.bookings[0].id, { date: '2027-01-22' }, {}, NOW);
  const after = packageBookings(app.db, pkg.group.id);
  assert.equal(new Set(after.map((x) => x.option_expires_at)).size, 1, 'sempre una scadenza sola');
  assert.ok(Date.parse(after[0].option_expires_at) < Date.parse(pkg.bookings[0].option_expires_at), 'e più vicina');
  // confermata l'opzione (a fattura) si cambia come ogni altra prenotazione
  const conf = confirmOption(app, o.id, { method: 'invoice' }, NOW + DAY);
  assert.equal(conf.outcome, 'confirmed');
  assert.equal(changeRules(app, conf.booking, NOW + DAY).mode, 'free');
});

test('elenco degli orari: ogni orario con il suo prezzo e la differenza; quello attuale è segnato', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const b = book(app, acct, { date: '2027-03-10', pax: 4 });
  const slots = changeSlots(app, b, { pax: 5, date: '2027-03-10' }, NOW);
  assert.deepEqual(slots.map((s) => [s.time, s.current]), [['10:00', true], ['15:00', false]]);
  assert.equal(slots[0].totalCents, (b.total_cents / 4) * 5);
  assert.equal(slots[0].deltaCents, b.total_cents / 4);
  assert.ok(slots.every((s) => s.ok));
  // un giorno senza posto per tante persone non offre quell'orario
  book(app, acct, { date: '2027-03-12', time: '15:00', pax: 8 });
  assert.deepEqual(changeSlots(app, b, { pax: 4, date: '2027-03-12' }, NOW).map((s) => s.time), ['10:00']);
  assert.deepEqual(changeSlots(app, b, { pax: 11 }, NOW), [], 'più del massimo: nessun orario');
  assert.deepEqual(changeSlots(app, createBooking(app, { tourSlug: 'cannaregio-ghetto', date: '2027-03-30', time: '10:00', pax: 2, channel: 'b2c', name: 'Mario', email: 'm@example.com', lang: 'it', paymentMethod: 'card' }, NOW), {}, NOW), []);
});

test('modifica con email: all’agenzia il riepilogo (con voucher e calendario nuovi) e alla guida l’avviso', async (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const b = book(app, acct);
  await app.changes.modify(b.id, { pax: 6, time: '15:00' }, { by: 'customer' }, NOW);
  const mail = app.mail.sent.find((m) => m.to === acct.email && /Prenotazione modificata/.test(m.subject));
  assert.ok(mail, 'l’agenzia riceve l’email');
  assert.match(mail.text, /Prima: 4 partecipanti/);
  assert.match(mail.text, /Ora: 6 partecipanti/);
  assert.deepEqual(mail.attachments.map((a) => a.filename.split('.').pop()).sort(), ['ics', 'pdf']);
  const guide = app.mail.sent.find((m) => m.to === GUIDE && /Prenotazione modificata/.test(m.subject));
  assert.match(guide.text, /Prima: 4 pers\./);
  assert.match(guide.text, /Ora:\s+6 pers\./);
  // un'opzione: email senza voucher
  const o = option(app, acct, { date: '2027-04-10' });
  await app.changes.modify(o.id, { pax: 3 }, { by: 'customer' }, NOW);
  const om = app.mail.sent.find((m) => m.to === acct.email && /Opzione modificata/.test(m.subject));
  assert.ok(om && om.attachments.length === 0);
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /Opzione modificata/.test(m.subject)));
  await assert.rejects(() => app.changes.modify(b.id, { pax: 6, time: '15:00' }, {}, NOW), (e) => e instanceof ChangeError && e.code === 'nochange');
});

test('proroga dell’opzione: l’agenzia chiede, la guida concede (giorni suoi) o rifiuta; una richiesta aperta alla volta', async (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const o = option(app, acct, { date: '2027-03-10' });
  assert.equal(pendingExtension(app.db, o), null);
  const err = (b, input) => { try { requestExtension(app, b, input, NOW); } catch (e) { return e; } return null; };
  assert.equal(err(o, { days: 0 })?.code, 'invalid');
  assert.equal(err(o, { days: 30 })?.code, 'invalid');
  assert.equal(err(book(app, acct, { date: '2027-03-18' }), { days: 3 })?.code, 'extension', 'solo le opzioni');
  const req = await app.changes.requestExtension(o.id, { days: 3, note: 'Il cliente aspetta il budget' }, NOW + DAY);
  assert.deepEqual([req.status, req.days, req.note, req.group_id], ['pending', 3, 'Il cliente aspetta il budget', null]);
  assert.equal(err(o, { days: 2 })?.message, 'already pending');
  assert.equal(pendingExtension(app.db, o).id, req.id);
  const note = app.mail.sent.find((m) => m.to === GUIDE && /Richiesta di proroga/.test(m.subject));
  assert.match(note.text, /Chiede 3 giorni/);
  assert.match(note.text, /Il cliente aspetta il budget/);
  assert.match(note.text, new RegExp(`/admin/bookings/${o.id}`));

  // la guida concede 5 giorni (non i 3 chiesti): l'opzione si prolunga, la richiesta si chiude, l'agenzia lo sa
  assert.equal(await app.changes.approveExtension(req.id, 5, NOW + 2 * DAY), true);
  const ext = getBooking(app.db, o.id);
  assert.equal(Date.parse(ext.option_expires_at), Date.parse(o.option_expires_at) + 5 * DAY);
  assert.equal(pendingExtension(app.db, o), null);
  assert.deepEqual({ ...app.db.prepare('SELECT status, granted_days FROM extension_requests WHERE id = ?').get(req.id) }, { status: 'approved', granted_days: 5 });
  assert.ok(app.mail.sent.some((m) => m.to === acct.email && /Opzione prorogata/.test(m.subject)));
  assert.equal(await app.changes.approveExtension(req.id, 5), false, 'una richiesta già decisa non si decide di nuovo');

  // rifiuto: l'agenzia riceve l'email e la scadenza resta; si può chiedere di nuovo
  const again = await app.changes.requestExtension(o.id, { days: 2 }, NOW + 3 * DAY);
  assert.equal(await app.changes.denyExtension(again.id, NOW + 3 * DAY), true);
  assert.equal(getBooking(app.db, o.id).option_expires_at, ext.option_expires_at);
  const denied = app.mail.sent.find((m) => m.to === acct.email && /Proroga non concessa/.test(m.subject));
  assert.match(denied.text, /non posso prolungare/);
  assert.equal(denyExtension(app.db, again.id), null);
  assert.ok(await app.changes.requestExtension(o.id, { days: 1 }, NOW + 4 * DAY), 'dopo un rifiuto si può richiedere');

  // se la guida prolunga di sua iniziativa la richiesta aperta si chiude da sola
  await app.services.extendOption(o.id, 2, NOW + 5 * DAY);
  assert.equal(pendingExtension(app.db, o), null);
  // un'opzione scaduta non si può prolungare né chiedere
  assert.throws(() => requestExtension(app, getBooking(app.db, o.id), { days: 2 }, Date.parse(getBooking(app.db, o.id).option_expires_at) + 1000), (e) => e.code === 'extension');
});

test('proroga di un pacchetto: una sola richiesta, vale per tutte le date, e si chiude quando la guida prolunga', async (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const pkg = createPackage(app, acct, [resolveLine(app, { tour: SHARED, date: '2027-03-12', time: '10:00', pax: '3' }), resolveLine(app, { tour: SHARED, date: '2027-03-14', time: '15:00', pax: '3' })], { name: 'Anna', email: acct.email, lang: 'it', option: true }, NOW);
  const [a, b] = pkg.bookings;
  const req = await app.changes.requestExtension(a.id, { days: 2 }, NOW + DAY);
  assert.equal(req.group_id, pkg.group.id);
  assert.equal(pendingExtension(app.db, b).id, req.id, 'è del pacchetto: la vedono tutte le sue date');
  assert.throws(() => requestExtension(app, b, { days: 1 }, NOW + DAY), (e) => e.message === 'already pending');
  assert.equal(await app.changes.approveExtension(req.id, 3, NOW + 2 * DAY), true);
  const after = packageBookings(app.db, pkg.group.id);
  assert.equal(new Set(after.map((x) => x.option_expires_at)).size, 1);
  assert.equal(Date.parse(after[0].option_expires_at), Date.parse(a.option_expires_at) + 3 * DAY);
  assert.equal(pendingExtension(app.db, a), null);
  assert.equal(app.mail.sent.filter((m) => /Opzione prorogata sul pacchetto/.test(m.subject)).length, 1, 'un solo avviso');
});
