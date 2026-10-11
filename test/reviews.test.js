import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelBooking, createBooking } from '../server/bookings.js';
import { feedbackStats, getFeedback, reviewDueAt, saveFeedback } from '../server/reviews.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const at = (date, hhmm) => localToInstant(date, hhmm);
const reviewMails = (app) => app.mail.sent.filter((m) => /Com’è andata|How was it/.test(m.subject));

test('richiesta di recensione: parte il giorno dopo il tour alle 10:00, una sola volta', async (t) => {
  const app = makeApp({ reviews: { googleUrl: 'https://g.page/r/ABC/review', tripadvisorUrl: 'https://tripadvisor.example/review' } });
  t.after(app.cleanup);
  const b = createBooking(app, base({ date: '2027-01-12' }), NOW);
  assert.equal(reviewDueAt(app.cfg, b), at('2027-01-13', '10:00'));

  assert.equal(await app.reviews.sweep(at('2027-01-12', '23:00')), 0, 'il giorno stesso no');
  assert.equal(await app.reviews.sweep(at('2027-01-13', '09:59')), 0);
  assert.equal(await app.reviews.sweep(at('2027-01-13', '10:00')), 1);
  assert.equal(await app.reviews.sweep(at('2027-01-13', '10:01')), 0, 'una sola volta');
  assert.equal(await app.reviews.sweep(at('2027-01-14', '12:00')), 0);

  const [mail] = reviewMails(app);
  assert.equal(mail.to, 'mario@example.com');
  assert.match(mail.text, /https:\/\/g\.page\/r\/ABC\/review/);
  assert.match(mail.text, /tripadvisor\.example/);
  assert.match(mail.text, new RegExp(`/it/feedback/${b.ref}\\?t=${b.token}`));
  assert.equal(app.db.prepare('SELECT review_status FROM bookings WHERE id = ?').get(b.id).review_status, 'sent');
});

test('recensione: solo clienti privati con prenotazione confermata; i link pubblici ci sono sempre (nessun gating)', async (t) => {
  const app = makeApp({ reviews: { googleUrl: '', tripadvisorUrl: '' } });
  t.after(app.cleanup);
  const acct = addAccount(app.db);
  createBooking(app, base({ date: '2027-01-11', channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', time: '16:00', pax: 5 }), NOW);
  const cancelled = createBooking(app, base({ date: '2027-01-12', time: '14:30', email: 'c@example.com' }), NOW);
  cancelBooking(app, cancelled.id, { by: 'admin' }, NOW);
  createBooking(app, base({ date: '2027-01-12', time: '09:30', paymentMethod: 'card', email: 'held@example.com' }), NOW); // mai pagata
  const ok = createBooking(app, base({ date: '2027-01-13', email: 'ok@example.com', lang: 'en' }), NOW);

  assert.equal(await app.reviews.sweep(at('2027-01-14', '10:00')), 1);
  const [mail] = reviewMails(app);
  assert.equal(mail.to, 'ok@example.com');
  assert.match(mail.subject, /How was it/);
  assert.match(mail.text, new RegExp(`/en/feedback/${ok.ref}`), 'senza URL pubblici resta il feedback privato');
  assert.equal(app.db.prepare(`SELECT COUNT(*) n FROM bookings WHERE review_status IS NOT NULL`).get().n, 1);
});

test('recensione: dopo un\'interruzione non si inviano richieste vecchie; un invio fallito si ritenta dopo 30 minuti; admin può saltare', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const old = createBooking(app, base({ date: '2027-01-12' }), NOW);
  assert.equal(await app.reviews.sweep(at('2027-01-25', '10:00')), 0, 'più di 7 giorni: scartata');
  assert.equal(app.db.prepare('SELECT review_status FROM bookings WHERE id = ?').get(old.id).review_status, 'skipped');

  const flaky = createBooking(app, base({ date: '2027-01-20', email: 'f@example.com' }), NOW);
  const realSend = app.mail.send;
  let fail = true;
  app.mail.send = async (m) => (fail ? false : realSend(m));
  assert.equal(await app.reviews.sweep(at('2027-01-21', '10:00')), 0);
  assert.equal(app.db.prepare('SELECT review_status FROM bookings WHERE id = ?').get(flaky.id).review_status, null, 'resta da inviare');
  fail = false;
  assert.equal(await app.reviews.sweep(at('2027-01-21', '10:10')), 0, 'troppo presto per riprovare');
  assert.equal(await app.reviews.sweep(at('2027-01-21', '10:31')), 1);

  const skipped = createBooking(app, base({ date: '2027-01-22', email: 's@example.com' }), NOW);
  assert.equal(app.reviews.skip(skipped.id), true);
  assert.equal(await app.reviews.sweep(at('2027-01-23', '10:00')), 0);
});

test('recensioni disattivabili da configurazione', async (t) => {
  const app = makeApp({ reviews: { enabled: false } });
  t.after(app.cleanup);
  createBooking(app, base({ date: '2027-01-12' }), NOW);
  assert.equal(await app.reviews.sweep(at('2027-01-13', '11:00')), 0);
});

test('feedback privato: voto 1-5, solo dopo il tour, aggiornabile, statistiche', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const b = createBooking(app, base({ date: '2027-01-12' }), NOW);
  const after = at('2027-01-13', '12:00');
  assert.equal(saveFeedback(app.db, b, { rating: 5 }, at('2027-01-11', '12:00')).reason, 'early');
  for (const bad of [0, 6, 2.5, 'x', undefined]) assert.equal(saveFeedback(app.db, b, { rating: bad }, after).reason, 'rating');
  assert.equal(saveFeedback(app.db, b, { rating: '4', comment: ' Bellissimo ', mayPublish: true }, after).ok, true);
  assert.equal(saveFeedback(app.db, b, { rating: 5, comment: 'Ancora meglio' }, after).ok, true);
  const fb = getFeedback(app.db, b.id);
  assert.deepEqual([fb.rating, fb.comment, fb.may_publish], [5, 'Ancora meglio', 0]);
  assert.deepEqual(feedbackStats(app.db), { count: 1, average: 5 });
  const b2 = createBooking(app, base({ date: '2027-01-14', email: 'b@example.com' }), NOW);
  saveFeedback(app.db, b2, { rating: 4 }, at('2027-01-15', '12:00'));
  assert.deepEqual(feedbackStats(app.db), { count: 2, average: 4.5 });
  const acct = addAccount(app.db);
  const b2b = createBooking(app, base({ date: '2027-01-14', channel: 'b2b', account: acct, paymentMethod: 'invoice', tourSlug: 'private', time: '16:00' }), NOW);
  assert.equal(saveFeedback(app.db, b2b, { rating: 5 }, at('2027-01-15', '12:00')).reason, 'booking');
});
