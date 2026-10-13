import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots, monthAvailability } from '../server/availability.js';
import { BookingError, cancelBooking, confirmPaid, createBooking } from '../server/bookings.js';
import { addAccount, base, makeApp, NOW, tour } from './helpers.js';
import { toMin } from '../server/time.js';

const DAY = '2027-01-12'; // martedì
const slotsOf = (app, slug, over = {}, channel = 'b2c') => daySlots(app.db, app.cfg, app.content.tour(slug), DAY, { pax: 1, channel, nowMs: NOW, ...over });
// i tour di prova sono condivisi fra i test (stessa lista): quelli aggiunti qui si tolgono a fine prova
const addTour = (app, t) => (app.content.tours.push(t), t);
const dropTour = (app, t) => t && app.content.tours.splice(app.content.tours.indexOf(t), 1);
const times = (list) => list.map((s) => s.time);

test('tour condiviso: la lingua del primo che prenota vincola la partenza, finché la prenotazione c’è', () => {
  const app = makeApp();
  try {
    const first = createBooking(app, base({ date: DAY, lang: 'it', tourLang: 'en', email: 'a@example.com' }), NOW);
    assert.equal(first.tour_lang, 'en', 'lingua del tour ≠ lingua della conferma');
    assert.equal(first.lang, 'it');
    // la partenza è marcata con la lingua; l'altra partenza è libera
    const s = slotsOf(app, 'shared');
    assert.deepEqual(s.map((x) => [x.time, x.lang]), [['09:30', 'en'], ['14:30', null]]);
    // chi la cerca in italiano non la vede più; in inglese sì
    assert.deepEqual(times(slotsOf(app, 'shared', { tourLang: 'it' })), ['14:30']);
    assert.deepEqual(times(slotsOf(app, 'shared', { tourLang: 'en' })), ['09:30', '14:30']);
    assert.equal(monthAvailability(app.db, app.cfg, app.content.tour('shared'), '2027-01', { pax: 1, nowMs: NOW, tourLang: 'it' })[DAY], 1);
    assert.equal(monthAvailability(app.db, app.cfg, app.content.tour('shared'), '2027-01', { pax: 1, nowMs: NOW, tourLang: 'en' })[DAY], 2);
    // prenotare in un'altra lingua non si può (nemmeno con la richiesta già in mano)
    assert.throws(() => createBooking(app, base({ date: DAY, tourLang: 'it', email: 'b@example.com' }), NOW), (e) => e instanceof BookingError && e.code === 'language' && e.message === 'en');
    // senza dire la lingua si entra nel gruppo che c'è; in inglese pure
    const second = createBooking(app, base({ date: DAY, lang: 'es', email: 'c@example.com' }), NOW);
    assert.equal(second.tour_lang, 'en', 'senza scelta vale la lingua del gruppo, non quella della conferma');
    assert.equal(createBooking(app, base({ date: DAY, tourLang: 'en', email: 'd@example.com' }), NOW).tour_lang, 'en');
    // una lingua che il tour non offre
    assert.throws(() => createBooking(app, base({ date: DAY, time: '14:30', tourLang: 'ja', email: 'e@example.com' }), NOW), (e) => e.code === 'invalid');
    // l'altra partenza si può prenotare in italiano, poi resta italiana
    assert.equal(createBooking(app, base({ date: DAY, time: '14:30', tourLang: 'it', email: 'f@example.com' }), NOW).tour_lang, 'it');
    assert.equal(slotsOf(app, 'shared').find((x) => x.time === '14:30').lang, 'it');
  } finally {
    app.cleanup();
  }
});

test('tour condiviso: se tutti annullano la lingua si libera; senza scelta si usa la lingua della conferma se il tour la offre', () => {
  const app = makeApp();
  try {
    const a = createBooking(app, base({ date: DAY, lang: 'es', email: 'a@example.com' }), NOW);
    assert.equal(a.tour_lang, 'es', 'nessuna scelta: la lingua della conferma, se il tour la offre');
    assert.throws(() => createBooking(app, base({ date: DAY, tourLang: 'en', email: 'b@example.com' }), NOW), (e) => e.code === 'language');
    cancelBooking(app, a.id, { by: 'admin', refund: 'none' }, NOW);
    assert.equal(slotsOf(app, 'shared')[0].lang, null, 'nessun vincolo: la partenza è di nuovo libera');
    assert.equal(createBooking(app, base({ date: DAY, tourLang: 'en', email: 'b@example.com' }), NOW).tour_lang, 'en');
    // una lingua della conferma che il tour non offre: si ripiega sulla prima offerta
    assert.equal(createBooking(app, base({ date: DAY, time: '14:30', lang: 'ja', email: 'c@example.com' }), NOW).tour_lang, 'it');
  } finally {
    app.cleanup();
  }
});

test('tour condiviso: anche chi non ha ancora pagato (slot trattenuto) vincola la lingua; il pagamento tardivo non scavalca', () => {
  const app = makeApp();
  try {
    const held = createBooking(app, base({ date: DAY, tourLang: 'en', paymentMethod: 'card', email: 'a@example.com' }), NOW);
    assert.equal(held.status, 'held');
    assert.throws(() => createBooking(app, base({ date: DAY, tourLang: 'it', email: 'b@example.com' }), NOW), (e) => e.code === 'language');
    assert.equal(confirmPaid(app, held.id, 'pi_1', NOW).outcome, 'confirmed');
  } finally {
    app.cleanup();
  }
});

test('tour privati e partner: nessun vincolo di lingua tra tour diversi; i tour B2B hanno il loro gruppo', () => {
  const app = makeApp();
  try {
    const acct = addAccount(app.db);
    // il B2B è un altro prodotto: stessa fascia = sovrapposizione, quindi il privato (agenzie) a un altro orario ha la sua lingua
    const b2b = createBooking(app, base({ tourSlug: 'shared-agenzie', date: DAY, time: '14:30', tourLang: 'es', channel: 'b2b', account: acct, paymentMethod: 'invoice' }), NOW);
    assert.equal(b2b.tour_lang, 'es');
    assert.throws(() => createBooking(app, base({ tourSlug: 'shared-agenzie', date: DAY, time: '14:30', tourLang: 'it', channel: 'b2b', account: acct, paymentMethod: 'invoice', email: 'x@example.com' }), NOW), (e) => e.code === 'language');
    // un tour privato (a gruppo) non ha la partenza condivisa: la lingua è solo un'informazione per la guida
    const priv = createBooking(app, base({ tourSlug: 'private', date: DAY, time: '10:00', tourLang: 'en', email: 'p@example.com' }), NOW);
    assert.equal(priv.tour_lang, 'en');
    assert.equal(slotsOf(app, 'private').every((s) => s.lang === null), true);
  } finally {
    app.cleanup();
  }
});

test('sovrapposizioni: anche una sola persona su un tour condiviso occupa la sua fascia e fa slittare gli orari degli altri tour', () => {
  const app = makeApp();
  let extra;
  try {
    // un secondo tour a partenze fisse che si sovrappone alla mattina del primo, e uno che parte dopo
    extra = addTour(app, tour({ slug: 'shared2', order: 2, times: ['10:00', '16:00'], durationMin: 120 }));
    const buf = app.cfg.policy.bufferMin;
    const before = {
      shared2: times(slotsOf(app, 'shared2')),
      private: times(slotsOf(app, 'private')),
      half: times(slotsOf(app, 'half-day')),
    };
    assert.deepEqual(before.shared2, ['10:00', '16:00']);
    assert.ok(before.private.includes('09:00') && before.private.includes('10:00'));

    // una persona sola prenota il tour condiviso delle 09:30 (150 minuti)
    createBooking(app, base({ date: DAY, pax: 1, email: 'solo@example.com' }), NOW);
    const busyUntil = toMin('09:30') + 150 + buf;

    // l'altro tour a orari fissi perde la partenza che si sovrapporrebbe, ma non quella dopo
    assert.deepEqual(times(slotsOf(app, 'shared2')), ['16:00']);
    // i tour a orario libero iniziano solo dopo la fine (più la pausa) e mai durante
    const priv = slotsOf(app, 'private');
    assert.ok(priv.length > 0);
    for (const s of priv) assert.ok(toMin(s.time) >= busyUntil || toMin(s.end) + buf <= toMin('09:30'), `${s.time}–${s.end} si sovrappone`);
    assert.ok(!times(priv).includes('10:00') && !times(priv).includes('09:00'));
    assert.equal(times(priv)[0], priv.find((s) => toMin(s.time) >= busyUntil).time, 'il primo orario libero è subito dopo la pausa');
    const half = slotsOf(app, 'half-day');
    for (const s of half) assert.ok(toMin(s.time) >= busyUntil || toMin(s.end) + buf <= toMin('09:30'), `${s.time}–${s.end} si sovrappone`);
    // lo stesso tour, stessa partenza: si può ancora entrare (posti condivisi), l'altra partenza resta libera
    assert.deepEqual(times(slotsOf(app, 'shared')), ['09:30', '14:30']);
    // una persona in più sul gruppo non sposta nulla
    createBooking(app, base({ date: DAY, pax: 1, email: 'due@example.com' }), NOW);
    assert.deepEqual(times(slotsOf(app, 'shared2')), ['16:00']);
    // e dopo l'annullo di entrambe tutto torna com'era
    for (const b of app.db.prepare("SELECT id FROM bookings").all()) cancelBooking(app, b.id, { by: 'admin', refund: 'none' }, NOW);
    assert.deepEqual({ shared2: times(slotsOf(app, 'shared2')), private: times(slotsOf(app, 'private')), half: times(slotsOf(app, 'half-day')) }, before);
  } finally {
    dropTour(app, extra);
    app.cleanup();
  }
});

test('sovrapposizioni: due tour condivisi diversi non possono partire nella stessa fascia, nemmeno a orari diversi che si toccano', () => {
  const app = makeApp();
  let extra;
  try {
    extra = addTour(app, tour({ slug: 'shared2', order: 2, times: ['09:30', '11:00', '12:30'], durationMin: 90 }));
    createBooking(app, base({ tourSlug: 'shared2', date: DAY, time: '11:00', pax: 1, email: 'a@example.com' }), NOW); // 11:00–12:30 (+ pausa)
    const left = times(slotsOf(app, 'shared'));
    assert.deepEqual(left, ['14:30'], 'la partenza delle 09:30 (150 min) si sovrappone alle 11:00');
    assert.ok(!times(slotsOf(app, 'shared2')).includes('12:30') || app.cfg.policy.bufferMin === 0, 'la pausa fra un servizio e l’altro conta');
    assert.ok(times(slotsOf(app, 'shared2')).includes('11:00'), 'ma sulla stessa partenza ci si può unire');
  } finally {
    dropTour(app, extra);
    app.cleanup();
  }
});
