// Funzioni aggiuntive pubbliche: buoni regalo, programmi di più giorni, feedback.
import express from 'express';
import { GiftError, getGiftByRef } from '../gifts.js';
import { cleanText, safeEqual } from '../util.js';
import { send, tooMany } from '../http.js';
import { giftPage, giftStatusPage } from '../views/gift.js';
import { addDays, nowRome } from '../time.js';
import { getBookingByRef } from '../bookings.js';
import { getFeedback, saveFeedback } from '../reviews.js';
import { notifyGuideFeedback } from '../emails.js';
import { feedbackPage } from '../views/feedback.js';

export function featuresRouter(app) {
  const r = express.Router();
  const { cfg, db } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ip = (req) => req.ip ?? 'ip';

  r.use(['/gift/', '/programs/', '/feedback/'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // ───── buoni regalo ─────
  r.get('/gift', (req, res) => send(res, giftPage(res.locals.ctx, { unavailable: !app.gifts.available, values: { deliverOn: addDays(nowRome().date, 0) } })));

  r.post('/gift', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (b.website) return res.status(400).end();
    if (!app.limits.booking(ip(req))) return tooMany(res);
    const values = {
      amount: cleanText(b.amount, 10),
      custom: cleanText(b.custom, 8),
      buyerName: cleanText(b.buyerName, 120),
      buyerEmail: cleanText(b.buyerEmail, 200),
      delivery: b.delivery === 'recipient' ? 'recipient' : 'me',
      recipientName: cleanText(b.recipientName, 120),
      recipientEmail: cleanText(b.recipientEmail, 200),
      deliverOn: cleanText(b.deliverOn, 10),
      message: cleanText(b.message, 400),
    };
    const fail = (error) => send(res, giftPage(ctx, { values, error, unavailable: !app.gifts.available }), 400);
    if (!app.gifts.available) return fail(t('gift.unavailable'));
    if (!b.consent) return fail(t('err.consent'));
    const euros = values.amount === 'custom' ? Number(values.custom.replace(',', '.')) : Number(values.amount) / 100;
    const money = (c) => new Intl.NumberFormat(req.lang === 'it' ? 'it-IT' : 'en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(c / 100);
    try {
      const { redirect } = await app.gifts.buy({ amountCents: Math.round(euros * 100), ...values, lang: req.lang }, req.lang);
      res.redirect(303, redirect);
    } catch (e) {
      if (!(e instanceof GiftError)) throw e;
      const msg = { amount: t('gift.err.amount', { min: money(cfg.gift.minCents), max: money(cfg.gift.maxCents) }), buyer: t('gift.err.buyer'), recipient: t('gift.err.recipient'), date: t('gift.err.date'), payment: t('gift.err.payment') }[e.code];
      return fail(msg ?? t('err.fields'));
    }
  });

  function loadGift(req) {
    const card = getGiftByRef(db, req.params.ref);
    const token = String(req.query.t ?? '');
    return card && token && safeEqual(token, card.token) ? card : null;
  }

  r.get('/gift/:ref', async (req, res, next) => {
    let card = loadGift(req);
    if (!card) return next();
    if (req.query.paid && card.status === 'pending') card = (await app.payables.sync(card.ref)) ?? card;
    send(res, giftStatusPage(res.locals.ctx, card));
  });

  // ───── feedback dopo il tour ─────
  function loadFeedbackBooking(req) {
    const b = getBookingByRef(db, req.params.ref);
    const token = String(req.query.t ?? req.body?.t ?? '');
    return b && b.channel === 'b2c' && b.status === 'confirmed' && token && safeEqual(token, b.token) ? b : null;
  }
  r.get('/feedback/:ref', (req, res, next) => {
    const b = loadFeedbackBooking(req);
    if (!b) return next();
    const { t } = res.locals.ctx;
    send(res, feedbackPage(res.locals.ctx, b, { existing: getFeedback(db, b.id), error: b.date > nowRome().date ? t('fb.early') : '' }));
  });
  r.post('/feedback/:ref', form, async (req, res, next) => {
    const b = loadFeedbackBooking(req);
    if (!b) return next();
    const ctx = res.locals.ctx;
    if (!app.limits.contact(ip(req))) return tooMany(res);
    const result = saveFeedback(db, b, { rating: req.body.rating, comment: req.body.comment, mayPublish: !!req.body.may_publish });
    if (!result.ok) return send(res, feedbackPage(ctx, b, { existing: getFeedback(db, b.id), error: ctx.t(`fb.err.${result.reason}`) }), 400);
    await notifyGuideFeedback(app, b, getFeedback(db, b.id));
    send(res, feedbackPage(ctx, b, { done: true }));
  });

  return r;
}
