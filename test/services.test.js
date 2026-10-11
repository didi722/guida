import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPayments } from '../server/payments.js';
import { getBooking, expireHolds } from '../server/bookings.js';
import { icsFor } from '../server/emails.js';
import { base, makeApp, NOW } from './helpers.js';

test('webhook Stripe: firma valida, manomessa e scaduta', () => {
  const p = createPayments({ stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_x' }, demoPayments: false });
  const body = Buffer.from(JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }));
  const t = 1_800_000_000;
  const sig = crypto.createHmac('sha256', 'whsec_x').update(`${t}.`).update(body).digest('hex');
  assert.equal(p.verifyWebhook(body, `t=${t},v1=${sig}`, t + 10).type, 'checkout.session.completed');
  assert.equal(p.verifyWebhook(body, `t=${t},v1=deadbeef,v1=${sig}`, t + 10).type, 'checkout.session.completed');
  assert.throws(() => p.verifyWebhook(Buffer.from(body + ' '), `t=${t},v1=${sig}`, t + 10), /non valida/);
  assert.throws(() => p.verifyWebhook(body, `t=${t},v1=${sig}`, t + 1000), /scaduta/);
  assert.throws(() => p.verifyWebhook(body, '', t), /mancante/);
});

test('pagamento con carta (demo): hold → pagato → email con .ics → annullo con rimborso', async (t) => {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' } });
  t.after(app.cleanup);
  const { booking, redirect } = await app.services.book(base({ paymentMethod: 'card', pax: 3 }), 'it', NOW);
  assert.equal(booking.status, 'held');
  assert.match(redirect, /\/pay\/demo\/VE-/);
  assert.equal(app.mail.sent.length, 0, 'nessuna email prima del pagamento');

  const res = await app.services.handlePaid(booking.id, 'pi_demo', NOW + 60_000);
  assert.equal(res.outcome, 'confirmed');
  assert.equal(app.mail.sent.length, 2);
  const [toCustomer, toGuide] = app.mail.sent;
  assert.equal(toCustomer.to, 'mario@example.com');
  assert.match(toCustomer.subject, /Prenotazione confermata VE-/);
  assert.match(toCustomer.text, /Cancellazione gratuita fino a/);
  assert.equal(toCustomer.attachments[0].filename, `${booking.ref}.ics`);
  assert.equal(toGuide.to, 'guida@example.com');
  assert.match(toGuide.text, /Nuova prenotazione/);

  // il webhook può arrivare due volte: nessun doppione
  assert.equal((await app.services.handlePaid(booking.id, 'pi_demo', NOW + 90_000)).outcome, 'already');
  assert.equal(app.mail.sent.length, 2);

  const c = await app.services.cancel(booking.id, { by: 'customer' }, NOW + 120_000);
  assert.equal(c.refundCents, 10500);
  const after = getBooking(app.db, booking.id);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.payment_status, 'refunded');
  assert.match(app.mail.sent.at(-2).text, /Rimborso: .*105/);
});

test('pagamento tardivo con slot perso: rimborso completo e avviso', async (t) => {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' } });
  t.after(app.cleanup);
  const { booking } = await app.services.book(base({ tourSlug: 'private', time: '10:00', paymentMethod: 'card' }), 'it', NOW);
  const late = NOW + 3600_000;
  expireHolds(app.db, late);
  await app.services.book(base({ tourSlug: 'private', time: '10:30', email: 'other@example.com' }), 'it', late);
  const r = await app.services.handlePaid(booking.id, 'pi_late', late);
  assert.equal(r.outcome, 'conflict');
  const b = getBooking(app.db, booking.id);
  assert.equal(b.status, 'cancelled');
  assert.equal(b.payment_status, 'refunded');
  assert.ok(app.mail.sent.some((m) => /rimborso in corso/.test(m.subject) && m.to === 'mario@example.com'));
});

test('.ics: orari in UTC corretti (inverno e ora legale)', async (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { booking: winter } = await app.services.book(base({ date: '2027-01-12' }), 'it', NOW);
  assert.match(icsFor(app, winter), /DTSTART:20270112T083000Z/);
  assert.match(icsFor(app, winter), /DTEND:20270112T110000Z/);
  const { booking: summer } = await app.services.book(base({ date: '2027-07-13', email: 's@example.com' }), 'en', NOW);
  assert.match(icsFor(app, summer, 'en'), /DTSTART:20270713T073000Z/);
  assert.match(icsFor(app, summer, 'en'), /SUMMARY:Test tour/);
});
