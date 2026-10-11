// Funzioni aggiuntive pubbliche: buoni regalo, programmi di più giorni, feedback.
import express from 'express';
import { GiftError, getGiftByRef } from '../gifts.js';
import { cleanText, safeEqual } from '../util.js';
import { send, sendPdf, tooMany } from '../http.js';
import { renderGiftCardPdf, renderProposalPdf } from '../pdf.js';
import { giftPage, giftStatusPage } from '../views/gift.js';
import { addDays, nowRome } from '../time.js';
import { getBookingByRef } from '../bookings.js';
import { getFeedback, saveFeedback } from '../reviews.js';
import { notifyGuideFeedback } from '../emails.js';
import { feedbackPage } from '../views/feedback.js';
import { ProgramError, declineProgram, getProgramByRef, validateProgramInput } from '../programs.js';
import { notifyGuideProgram } from '../emails.js';
import { programStatusPage, programsPage } from '../views/programs.js';

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
  r.get('/gift/:ref/card.pdf', async (req, res, next) => {
    const card = loadGift(req);
    if (!card || card.status !== 'active') return next();
    sendPdf(res, await renderGiftCardPdf(app, card, req.lang), `buono-regalo-${card.ref}.pdf`);
  });

  // ───── programmi di più giorni ─────
  r.get('/programs', (req, res) => send(res, programsPage(res.locals.ctx)));

  r.post('/programs', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (b.website) return res.status(400).end();
    const isB2b = req.acct?.status === 'approved';
    const values = {
      name: cleanText(b.name, 120), email: cleanText(b.email, 200), phone: cleanText(b.phone, 40), company: cleanText(b.company, 160), clientRef: cleanText(b.clientRef, 120),
      dateFrom: cleanText(b.dateFrom, 10), dateTo: cleanText(b.dateTo, 10), flexibleDates: b.flexibleDates ? '1' : '', participants: cleanText(b.participants, 3),
      groupType: cleanText(b.groupType, 20), interests: [].concat(b.interests ?? []).map((x) => cleanText(x, 20)), accommodation: cleanText(b.accommodation, 200), mobility: cleanText(b.mobility, 300),
      budget: cleanText(b.budget, 20), languages: cleanText(b.languages, 120), message: cleanText(b.message, 3000),
    };
    const fail = (error) => send(res, programsPage(ctx, { values, error }), 400);
    const problem = (e) => (e.code === 'dates' ? t('pg.err.dates') : t('pg.err.fields'));
    if (!b.consent) return fail(t('err.consent'));
    try {
      validateProgramInput(values); // gli errori di compilazione non contano nel limite di richieste
    } catch (e) {
      if (!(e instanceof ProgramError)) throw e;
      return fail(problem(e));
    }
    if (!app.limits.contact(ip(req))) return tooMany(res);
    try {
      const p = await app.programs.submit({ ...values, lang: req.lang, channel: isB2b ? 'b2b' : 'b2c', account: isB2b ? req.acct : null, flexibleDates: !!values.flexibleDates });
      res.redirect(303, `/${req.lang}/programs/${p.ref}?t=${p.token}&flash=received`);
    } catch (e) {
      if (!(e instanceof ProgramError)) throw e;
      return fail(problem(e));
    }
  });

  function loadProgram(req) {
    const p = getProgramByRef(db, req.params.ref);
    const token = String(req.query.t ?? req.body?.t ?? '');
    return p && token && safeEqual(token, p.token) ? p : null;
  }
  const pgBack = (req, p, flash) => `/${req.lang}/programs/${p.ref}?t=${p.token}&flash=${flash}`;

  r.get('/programs/:ref', async (req, res, next) => {
    let p = loadProgram(req);
    if (!p) return next();
    if (req.query.paid && p.deposit_status === 'pending') p = (await app.payables.sync(p.ref)) ?? p;
    const { t } = res.locals.ctx;
    const flashKey = String(req.query.flash ?? '');
    const flash = flashKey === 'received' ? t('pg.received.text') : ['accepted', 'declined', 'message'].includes(flashKey) ? t(`pg.flash.${flashKey}`) : '';
    const error = ['expired', 'conflict', 'error'].includes(flashKey) ? t(`pg.flash.${flashKey}`) : '';
    send(res, programStatusPage(res.locals.ctx, p, { flash, error }));
  });

  r.get('/programs/:ref/proposal.pdf', async (req, res, next) => {
    const p = loadProgram(req);
    if (!p || !p.proposal_sent_at) return next();
    sendPdf(res, await renderProposalPdf(app, p, req.lang), `proposta-${p.ref}.pdf`);
  });

  r.post('/programs/:ref/accept', form, async (req, res, next) => {
    const p = loadProgram(req);
    if (!p) return next();
    const result = await app.programs.accept(p.id, req.lang);
    if (result.redirect) return res.redirect(303, result.redirect);
    const flash = { accepted: 'accepted', confirmed: 'accepted', expired: 'expired', conflict: 'conflict', state: 'error' }[result.outcome];
    res.redirect(303, pgBack(req, p, flash));
  });
  r.post('/programs/:ref/decline', form, async (req, res, next) => {
    const p = loadProgram(req);
    if (!p) return next();
    if (declineProgram(db, p.id, null)) await notifyGuideProgram(app, getProgramByRef(db, p.ref), 'declined');
    res.redirect(303, pgBack(req, p, 'declined'));
  });
  r.post('/programs/:ref/message', form, async (req, res, next) => {
    const p = loadProgram(req);
    if (!p) return next();
    if (!app.limits.contact(ip(req))) return tooMany(res);
    const text = cleanText(req.body.message, 2000);
    if (text) await notifyGuideProgram(app, p, 'message', text);
    res.redirect(303, pgBack(req, p, text ? 'message' : 'error'));
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
