import express from 'express';
import { daySlots, monthAvailability } from '../availability.js';
import { getBookingByRef, priceFor } from '../bookings.js';
import { isDate, isMonth, nowRome } from '../time.js';
import { safeEqual } from '../util.js';
import { limits, makeCtx, noStore, send, tooMany } from '../http.js';
import { demoPayPage } from '../views/booking.js';
import { isLang } from '../i18n.js';

const channelOf = (acct) => (acct?.status === 'approved' ? 'b2b' : 'b2c');

export function apiRouter(app) {
  const r = express.Router();
  const { cfg, db, content, services, payments } = app;
  const form = express.urlencoded({ extended: false, limit: '10kb' });

  // ───── disponibilità (usata dal calendario nella pagina del tour) ─────
  function parse(req) {
    const tour = content.tour(String(req.query.tour ?? ''));
    const pax = Number.parseInt(req.query.pax, 10);
    if (!tour?.active || !Number.isInteger(pax) || pax < 1 || pax > tour.maxParticipants) return null;
    return { tour, pax };
  }

  r.get('/api/availability', noStore, (req, res) => {
    if (!limits.api(req.ip)) return tooMany(res);
    const p = parse(req);
    const month = String(req.query.month ?? '');
    if (!p || !isMonth(month)) return res.status(400).json({ error: 'bad request' });
    const today = nowRome().date;
    if (month < today.slice(0, 7) || month > `${Number(today.slice(0, 4)) + 2}-12`) return res.json({ month, days: {} });
    res.json({ month, days: monthAvailability(db, cfg, p.tour, month, { pax: p.pax, channel: channelOf(req.acct), nowMs: Date.now() }) });
  });

  r.get('/api/slots', noStore, (req, res) => {
    if (!limits.api(req.ip)) return tooMany(res);
    const p = parse(req);
    const date = String(req.query.date ?? '');
    if (!p || !isDate(date)) return res.status(400).json({ error: 'bad request' });
    const channel = channelOf(req.acct);
    const slots = daySlots(db, cfg, p.tour, date, { pax: p.pax, channel, nowMs: Date.now() }).map((s) => ({ ...s, totalCents: priceFor(p.tour, p.pax, channel, req.acct) }));
    res.json({ date, slots });
  });

  // ───── webhook Stripe (corpo grezzo per verificare la firma) ─────
  r.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    let event;
    try {
      event = payments.verifyWebhook(req.body, req.get('stripe-signature'));
    } catch (err) {
      console.warn('[webhook] rifiutato:', err.message);
      return res.status(400).json({ error: 'invalid signature' });
    }
    try {
      const obj = event.data?.object ?? {};
      const ref = obj.client_reference_id ?? obj.metadata?.ref;
      const b = ref ? getBookingByRef(db, ref) : null;
      if (b) {
        if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && obj.payment_status === 'paid') {
          if (obj.amount_total === b.total_cents) await services.handlePaid(b.id, typeof obj.payment_intent === 'string' ? obj.payment_intent : (obj.payment_intent?.id ?? null));
          else console.error(`[webhook] importo non corrispondente per ${b.ref}: ${obj.amount_total} ≠ ${b.total_cents}`);
        } else if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) && obj.id === b.stripe_session_id && b.status === 'held') {
          db.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'held'`).run(b.id);
        }
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[webhook] errore di elaborazione:', err);
      res.status(500).json({ error: 'processing error' });
    }
  });

  // ───── pagamento: ripresa e demo ─────
  const langOf = (req) => (isLang(String(req.query.lang ?? req.body?.lang)) ? String(req.query.lang ?? req.body?.lang) : 'it');
  function byToken(req) {
    const b = getBookingByRef(db, req.params.ref);
    const token = String(req.query.t ?? req.body?.t ?? '');
    return b && token && safeEqual(token, b.token) ? b : null;
  }

  r.get('/pay/resume/:ref', async (req, res, next) => {
    const b = byToken(req);
    const lang = langOf(req);
    if (!b) return next();
    const back = `/${lang}/booking/${b.ref}?t=${b.token}`;
    if (b.status !== 'held' || Date.parse(b.hold_expires_at) <= Date.now()) return res.redirect(303, back);
    try {
      res.redirect(303, await services.startCheckout(b, lang, Date.now(), Date.now()));
    } catch (err) {
      console.error('[resume] errore Stripe:', err.message);
      res.redirect(303, back);
    }
  });

  r.get('/pay/demo/:ref', (req, res, next) => {
    const b = byToken(req);
    if (!b || !payments.demo || b.status !== 'held') return next();
    send(res, demoPayPage(makeCtx(app, req, langOf(req)), b));
  });
  r.post('/pay/demo/:ref/complete', form, async (req, res, next) => {
    const b = byToken(req);
    if (!b || !payments.demo) return next();
    const lang = langOf(req);
    await services.handlePaid(b.id, `demo_pi_${b.ref}`);
    res.redirect(303, `/${lang}/booking/${b.ref}?t=${b.token}&paid=1`);
  });

  return r;
}


