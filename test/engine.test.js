import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots, monthAvailability } from '../server/availability.js';
import { BookingError, cancelBooking, cancellationState, confirmPaid, createBooking, expireHolds, paymentOptions, priceFor } from '../server/bookings.js';
import { setSetting } from '../server/db.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const times = (slots) => slots.map((s) => s.time);

test('tour a partenze fisse: rispetta gli orari di lavoro e il preavviso', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  // martedì 5 gennaio: alle 09:30 mancano meno di 24h (adesso è lunedì 10:00) → solo 14:30
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-05', { nowMs: NOW })), ['14:30']);
  // mercoledì 6: entrambi
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-06', { nowMs: NOW })), ['09:30', '14:30']);
  // il passato non è prenotabile
  assert.deepEqual(daySlots(app.db, app.cfg, shared, '2027-01-03', { nowMs: NOW }), []);
  // oltre l'orizzonte massimo no
  assert.deepEqual(daySlots(app.db, app.cfg, shared, '2028-06-01', { nowMs: NOW }), []);
});

test('giorni chiusi, orario settimanale e override', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  setSetting(app.db, 'weekly', { ...app.cfg.defaultWeekly, 3: { open: false, from: '08:30', to: '19:30' } }); // mercoledì chiuso
  assert.deepEqual(daySlots(app.db, app.cfg, shared, '2027-01-06', { nowMs: NOW }), []);
  // giovedì 7 aperto, ma con orario ridotto: 14:30 + 150' = 17:00 > 16:30 → nessuna partenza pomeridiana
  app.db.prepare("INSERT INTO day_overrides(date, closed, from_time, to_time) VALUES('2027-01-07', 0, '08:30', '16:30')").run();
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-07', { nowMs: NOW })), ['09:30']);
  // venerdì 8 chiuso con override
  app.db.prepare("INSERT INTO day_overrides(date, closed) VALUES('2027-01-08', 1)").run();
  assert.deepEqual(daySlots(app.db, app.cfg, shared, '2027-01-08', { nowMs: NOW }), []);
});

test('tour condiviso: stessa partenza somma i partecipanti fino alla capienza', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  createBooking(app, base({ pax: 8 }), NOW);
  const slots = daySlots(app.db, app.cfg, shared, '2027-01-12', { nowMs: NOW, pax: 2 });
  const s = slots.find((x) => x.time === '09:30');
  assert.equal(s.left, 2);
  assert.equal(s.joined, true);
  // in 3 non c'è più posto su quella partenza, ma il pomeriggio sì
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-12', { nowMs: NOW, pax: 3 })), ['14:30']);
  // una seconda prenotazione sulla stessa partenza funziona
  const b2 = createBooking(app, base({ pax: 2, email: 'b@example.com' }), NOW);
  assert.equal(b2.start_time, '09:30');
  assert.throws(() => createBooking(app, base({ pax: 1 }), NOW), (e) => e instanceof BookingError && e.code === 'unavailable');
});

test('una sola guida: un servizio privato blocca tutto ciò che si sovrappone (pausa inclusa)', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const priv = app.content.tour('private'); // 2h, inizio libero
  const shared = app.content.tour('shared');
  createBooking(app, base({ tourSlug: 'private', time: '10:00', pax: 4 }), NOW); // 10:00-12:00 (+30' di pausa)
  const free = times(daySlots(app.db, app.cfg, priv, '2027-01-12', { nowMs: NOW }));
  assert.ok(!free.includes('10:00') && !free.includes('09:30') && !free.includes('08:30') && !free.includes('12:00'));
  assert.ok(free.includes('12:30'), 'dopo la pausa si può ripartire');
  assert.ok(free.includes('07:30') === false);
  // il tour condiviso delle 09:30 si sovrappone → non disponibile; quello delle 14:30 sì
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-12', { nowMs: NOW })), ['14:30']);
});

test('blocchi esterni tolgono disponibilità', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  app.db.prepare("INSERT INTO blocks(date, start_time, end_time, note, created_at) VALUES('2027-01-12','14:00','16:00','agenzia X','x')").run();
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-12', { nowMs: NOW })), ['09:30']);
});

test('lo slot in attesa di pagamento è bloccato finché la hold non scade', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  const b = createBooking(app, base({ paymentMethod: 'card', pax: 10 }), NOW);
  assert.equal(b.status, 'held');
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-12', { nowMs: NOW + 10 * 60_000 })), ['14:30']);
  // dopo la scadenza torna libero anche senza job di pulizia
  const later = NOW + 40 * 60_000;
  assert.deepEqual(times(daySlots(app.db, app.cfg, shared, '2027-01-12', { nowMs: later })), ['09:30', '14:30']);
  assert.equal(expireHolds(app.db, later), 1);
});

test('prezzi: a persona, a gruppo, tariffa B2B e sconto partner', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  const priv = app.content.tour('private');
  assert.equal(priceFor(shared, 3, 'b2c'), 10500);
  assert.equal(priceFor(priv, 7, 'b2c'), 15000);
  assert.equal(priceFor(shared, 3, 'b2b'), 8400);
  assert.equal(priceFor(priv, 7, 'b2b', { discount_percent: 10 }), 10800);
});

test('metodi di pagamento: fattura solo ai partner approvati, in sede solo B2C', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = addAccount(app.db);
  assert.throws(() => createBooking(app, base({ paymentMethod: 'invoice' }), NOW), (e) => e.code === 'payment');
  assert.throws(() => createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'onsite' }), NOW), (e) => e.code === 'payment');
  const ok = createBooking(app, base({ tourSlug: 'half-day', time: '09:00', channel: 'b2b', account: acct, paymentMethod: 'invoice', pax: 20, clientRef: 'PRATICA 123' }), NOW);
  assert.equal(ok.status, 'confirmed');
  assert.equal(ok.total_cents, 19000);
  assert.equal(ok.client_ref, 'PRATICA 123');
  const pending = addAccount(app.db, { email: 'p@example.com', status: 'pending' });
  assert.throws(() => createBooking(app, base({ channel: 'b2b', account: pending, paymentMethod: 'invoice' }), NOW), (e) => e.code === 'account');
});

test('validazione input', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  for (const bad of [{ pax: 0 }, { pax: 11 }, { pax: 1.5 }, { email: 'nope' }, { name: ' ' }, { date: '2027-02-30' }, { time: '25:00' }, { tourSlug: 'xx' }]) {
    assert.throws(() => createBooking(app, base(bad), NOW), (e) => e instanceof BookingError, JSON.stringify(bad));
  }
  assert.throws(() => createBooking(app, base({ time: '11:00' }), NOW), (e) => e.code === 'unavailable'); // non è una partenza
});

test('politica di cancellazione: B2C 48h, B2B 72h, override per partner', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { cancel_hours: 168 });
  const c = createBooking(app, base({ date: '2027-01-12' }), NOW);
  assert.equal(c.free_cancel_until, new Date(Date.parse('2027-01-12T08:30:00Z') - 48 * 3600_000).toISOString());
  const b = createBooking(app, base({ tourSlug: 'private', time: '15:00', date: '2027-01-12', channel: 'b2b', account: acct, paymentMethod: 'invoice' }), NOW);
  assert.equal(b.free_cancel_until, new Date(Date.parse('2027-01-12T14:00:00Z') - 168 * 3600_000).toISOString());
  const half = createBooking(app, base({ tourSlug: 'half-day', time: '09:00', date: '2027-01-14' }), NOW);
  assert.equal(half.free_cancel_until, new Date(Date.parse('2027-01-14T08:00:00Z') - 72 * 3600_000).toISOString(), 'override per tour');
});

test('annullamento: rimborso automatico solo entro il termine', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const mk = (date) => {
    const held = createBooking(app, base({ paymentMethod: 'card', date, pax: 2 }), NOW);
    return confirmPaid(app, held.id, 'pi_1', NOW).booking;
  };
  const early = mk('2027-01-20');
  assert.equal(cancellationState(early, NOW).free, true);
  const r1 = cancelBooking(app, early.id, { by: 'customer' }, NOW);
  assert.equal(r1.refundCents, 7000);
  assert.equal(r1.booking.status, 'cancelled');

  // 2027-01-06 09:30 è a ~47.5h da NOW → fuori dai 48h
  const late = mk('2027-01-06');
  assert.equal(cancellationState(late, NOW).free, false);
  assert.equal(cancelBooking(app, late.id, { by: 'customer' }, NOW).refundCents, 0);

  const late2 = mk('2027-01-07');
  assert.equal(cancelBooking(app, late2.id, { by: 'admin', refund: 'none' }, NOW).refundCents, 0);
  const late3 = createBooking(app, base({ paymentMethod: 'card', date: '2027-01-13' }), NOW);
  confirmPaid(app, late3.id, 'pi_3', NOW);
  assert.equal(cancelBooking(app, late3.id, { by: 'admin', refund: 'full' }, NOW).refundCents, 7000);

  // lo slot si libera
  const shared = app.content.tour('shared');
  assert.ok(times(daySlots(app.db, app.cfg, shared, '2027-01-20', { nowMs: NOW })).includes('09:30'));
  // annullare due volte non fa danni
  assert.equal(cancelBooking(app, early.id, { by: 'customer' }, NOW).already, true);
});

test('pagamento in ritardo: riprende lo slot scaduto se libero, altrimenti conflitto', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const held = createBooking(app, base({ tourSlug: 'private', time: '10:00', paymentMethod: 'card' }), NOW);
  const late = NOW + 60 * 60_000;
  expireHolds(app.db, late);
  assert.equal(confirmPaid(app, held.id, 'pi_a', late).outcome, 'confirmed');

  const held2 = createBooking(app, base({ tourSlug: 'private', time: '15:00', paymentMethod: 'card' }), NOW);
  expireHolds(app.db, late);
  createBooking(app, base({ tourSlug: 'private', time: '15:30', paymentMethod: 'onsite', email: 'x@example.com' }), late); // qualcun altro lo prende
  const res = confirmPaid(app, held2.id, 'pi_b', late);
  assert.equal(res.outcome, 'conflict');
  assert.equal(confirmPaid(app, held.id, 'pi_a', late).outcome, 'already');
});

test('disponibilità mensile per il calendario', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  const days = monthAvailability(app.db, app.cfg, shared, '2027-01', { nowMs: NOW });
  assert.equal(days['2027-01-03'], undefined, 'passato');
  assert.equal(days['2027-01-05'], 1);
  assert.equal(days['2027-01-12'], 2);
  createBooking(app, base({ pax: 10 }), NOW);
  createBooking(app, base({ pax: 10, time: '14:30', email: 'z@example.com' }), NOW);
  assert.equal(monthAvailability(app.db, app.cfg, shared, '2027-01', { nowMs: NOW })['2027-01-12'], undefined);
});

test('pagamento in sede: disattivato di default, senza metodi la prenotazione non parte', (t) => {
  const app = makeApp({ policy: { allowPayOnSite: false } });
  t.after(app.cleanup);
  const shared = app.content.tour('shared');
  assert.deepEqual(paymentOptions(app, shared, 'b2c'), ['card'], 'solo carta (demo attiva)');
  assert.throws(() => createBooking(app, base({ paymentMethod: 'onsite' }), NOW), (e) => e.code === 'payment');

  const noCard = makeApp({ policy: { allowPayOnSite: false }, demoPayments: false });
  t.after(noCard.cleanup);
  assert.deepEqual(paymentOptions(noCard, noCard.content.tour('shared'), 'b2c'), []);
  assert.throws(() => createBooking(noCard, base({ paymentMethod: 'card' }), NOW), (e) => e.code === 'payment');
  // il flag per tour disattiva comunque il pagamento in sede
  const on = makeApp({ policy: { allowPayOnSite: true } });
  t.after(on.cleanup);
  assert.deepEqual(paymentOptions(on, { ...on.content.tour('shared'), payOnSite: false }, 'b2c'), ['card']);
  assert.deepEqual(paymentOptions(on, on.content.tour('shared'), 'b2c'), ['card', 'onsite']);
});
