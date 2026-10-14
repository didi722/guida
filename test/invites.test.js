import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingError, cancelBooking, createBooking } from '../server/bookings.js';
import { sendInviteEmail } from '../server/emails.js';
import { createInvite, inviteLink, inviteOffer, invitesOf } from '../server/invites.js';
import { previewPricing } from '../server/pricing.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const DAY = '2027-01-12';
const book = (app, over = {}) => createBooking(app, base({ date: DAY, ...over }), NOW);

test('invita un amico: codice univoco, una sola volta, solo per quella partenza; non vale per chi lo manda', () => {
  const app = makeApp();
  try {
    const b = book(app, { email: 'anna@example.com', name: 'Anna', tourLang: 'en' });
    const offer = inviteOffer(app, b, NOW);
    assert.equal(offer.ok, true);
    assert.deepEqual([offer.percent, offer.remaining], [10, 3]);

    const { invite, link } = createInvite(app, b, { email: 'luca@example.com', nowMs: NOW });
    assert.match(invite.code, /^AMICO-[A-HJKMNP-Z2-9]{6}$/);
    assert.equal(invite.friend_email, 'luca@example.com');
    assert.equal(link, inviteLink(app, b, invite.code));
    assert.match(link, /\/it\/book\/checkout\?tour=shared&date=2027-01-12&time=09%3A30&pax=1&promo=AMICO-[A-Z0-9]{6}&tl=en$/, 'stessa partenza, un posto, codice e lingua del tour');
    const another = createInvite(app, b, { nowMs: NOW }).invite;
    assert.notEqual(another.code, invite.code, 'ogni invito ha un codice suo');

    // l'amico paga il 10% in meno, sulla stessa partenza
    const tour = app.content.tour('shared');
    const preview = (code, email) => previewPricing(app, { tour, pax: 1, channel: 'b2c', date: DAY, time: '09:30', email, promoCode: code, nowMs: NOW });
    assert.equal(preview(invite.code, 'luca@example.com').discountCents, 350);
    assert.equal(preview(invite.code, 'anna@example.com').errors.promo, 'own_invite', 'non vale per chi ha mandato l’invito');
    const friend = book(app, { email: 'luca@example.com', name: 'Luca', pax: 1, promoCode: invite.code });
    assert.deepEqual([friend.discount_cents, friend.total_cents, friend.tour_lang], [350, 3150, 'en'], 'sconto e stessa lingua del gruppo');
    // una volta sola
    assert.equal(preview(invite.code, 'altro@example.com').errors.promo, 'exhausted');
    assert.deepEqual(invitesOf(app.db, b.id, NOW).map((i) => i.used), [true, false]);
    // vale solo per quel tour e quel giorno
    const other = previewPricing(app, { tour: app.content.tour('private'), pax: 1, channel: 'b2c', date: DAY, time: '10:00', email: 'x@example.com', promoCode: another.code, nowMs: NOW });
    assert.equal(other.errors.promo, 'tour');
    const otherDay = previewPricing(app, { tour, pax: 1, channel: 'b2c', date: '2027-01-13', time: '09:30', email: 'x@example.com', promoCode: another.code, nowMs: NOW });
    assert.equal(otherDay.errors.promo, 'service_window');
  } finally {
    app.cleanup();
  }
});

test('invita un amico: un massimo per prenotazione, mai più dei posti liberi; non per i tour privati, le agenzie, le prenotazioni non confermate', () => {
  const app = makeApp();
  try {
    const b = book(app, { email: 'anna@example.com', pax: 2 });
    for (let i = 0; i < 3; i++) createInvite(app, b, { nowMs: NOW });
    assert.deepEqual([inviteOffer(app, b, NOW).ok, inviteOffer(app, b, NOW).reason], [false, 'max']);
    assert.throws(() => createInvite(app, b, { nowMs: NOW }), (e) => e.reason === 'max');

    // posti: 10 in tutto, 8 presi → un solo posto libero, un solo invito
    const full = book(app, { time: '14:30', pax: 9, email: 'gruppo@example.com' });
    assert.equal(inviteOffer(app, full, NOW).remaining, 1);
    createInvite(app, full, { nowMs: NOW });
    assert.deepEqual([inviteOffer(app, full, NOW).ok, inviteOffer(app, full, NOW).reason], [false, 'full'], 'l’invito non ancora usato tiene occupato l’ultimo posto');
    assert.throws(() => createInvite(app, full, { email: 'non-una-email', nowMs: NOW }), (e) => e.reason === 'full');

    // un'email sbagliata non crea nulla
    const c = book(app, { date: '2027-01-13', email: 'c@example.com' });
    assert.throws(() => createInvite(app, c, { email: 'boh', nowMs: NOW }), (e) => e.reason === 'email');
    assert.equal(invitesOf(app.db, c.id).length, 0);

    // privato a gruppo, partner, annullata, già iniziata
    const priv = book(app, { tourSlug: 'private', date: '2027-01-14', time: '10:00', email: 'p@example.com' });
    assert.equal(inviteOffer(app, priv, NOW).reason, 'ineligible');
    const acct = addAccount(app.db);
    const agency = createBooking(app, base({ date: '2027-01-15', time: '09:30', tourSlug: 'shared-agenzie', channel: 'b2b', account: acct, paymentMethod: 'invoice' }), NOW);
    assert.equal(inviteOffer(app, agency, NOW).reason, 'ineligible');
    cancelBooking(app, c.id, { by: 'admin', refund: 'none' }, NOW);
    assert.equal(inviteOffer(app, app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(c.id), NOW).reason, 'ineligible');
    assert.equal(inviteOffer(app, b, Date.parse('2027-01-12T09:00:00Z')).reason, 'started');
    // spento dalle impostazioni
    app.cfg.invite.enabled = false;
    assert.equal(inviteOffer(app, b, NOW).reason, 'off');
  } finally {
    app.cleanup();
  }
});

test('invita un amico: l’email all’amico ha codice, sconto e collegamento, nella lingua del tour', async () => {
  const app = makeApp();
  try {
    const b = book(app, { email: 'anna@example.com', name: 'Anna', lang: 'it', tourLang: 'es' });
    const { invite, link } = createInvite(app, b, { email: 'luca@example.com', nowMs: NOW });
    assert.equal(await sendInviteEmail(app, b, invite, link, NOW), true);
    const mail = app.mail.sent.at(-1);
    assert.equal(mail.to, 'luca@example.com');
    assert.match(mail.subject, /Anna te invita/);
    assert.match(mail.text, new RegExp(`${invite.code}`));
    assert.match(mail.text, /10% de descuento/);
    assert.ok(mail.text.includes(link));
    assert.ok(mail.html.includes(`href="${link.replace(/&/g, '&amp;')}"`) || mail.html.includes(link));
    assert.ok(app.db.prepare('SELECT sent_at FROM invites WHERE id = ?').get(invite.id).sent_at);
    // senza email non si manda nulla
    const { invite: noMail, link: l2 } = createInvite(app, b, { nowMs: NOW });
    const n = app.mail.sent.length;
    assert.equal(await sendInviteEmail(app, b, noMail, l2, NOW), false);
    assert.equal(app.mail.sent.length, n);
  } finally {
    app.cleanup();
  }
});

test('invita un amico: ogni tour condiviso ha il suo interruttore e il suo sconto', () => {
  const app = makeApp();
  const t = app.content.tour('shared');
  try {
    const b = book(app, { email: 'anna@example.com' });
    t.invitePercent = 25;
    assert.equal(inviteOffer(app, b, NOW).percent, 25, 'sconto del tour');
    const { invite } = createInvite(app, b, { nowMs: NOW });
    assert.equal(invitesOf(app.db, b.id, NOW)[0].percent, 25);
    const preview = previewPricing(app, { tour: t, pax: 1, channel: 'b2c', date: DAY, time: '09:30', email: 'luca@example.com', promoCode: invite.code, nowMs: NOW });
    assert.equal(preview.discountCents, 875, '25% di 35 €');
    t.inviteEnabled = false;
    assert.equal(inviteOffer(app, b, NOW).reason, 'off', 'spento su questo tour');
    t.inviteEnabled = null;
    t.invitePercent = null;
    assert.equal(inviteOffer(app, b, NOW).percent, 10, 'senza valore proprio, quello generale');
  } finally {
    t.inviteEnabled = undefined;
    t.invitePercent = undefined;
    app.cleanup();
  }
});
