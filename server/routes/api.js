import express from 'express';
import { daySlots, monthAvailability } from '../availability.js';
import { priceFor } from '../bookings.js';
import { isDate, isMonth, nowRome } from '../time.js';
import { safeEqual } from '../util.js';
import { makeCtx, noStore, send, tooMany } from '../http.js';
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
    if (!app.limits.api(req.ip)) return tooMany(res);
    const p = parse(req);
    const month = String(req.query.month ?? '');
    if (!p || !isMonth(month)) return res.status(400).json({ error: 'bad request' });
    const today = nowRome().date;
    if (month < today.slice(0, 7) || month > `${Number(today.slice(0, 4)) + 2}-12`) return res.json({ month, days: {} });
    res.json({ month, days: monthAvailability(db, cfg, p.tour, month, { pax: p.pax, channel: channelOf(req.acct), nowMs: Date.now() }) });
  });

  r.get('/api/slots', noStore, (req, res) => {
    if (!app.limits.api(req.ip)) return tooMany(res);
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
      const found = app.payables.lookup(obj.client_reference_id ?? obj.metadata?.ref);
      if (found) {
        const { handler, row } = found;
        if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && obj.payment_status === 'paid') {
          if (obj.amount_total === handler.dueCents(row)) await handler.onPaid(row, typeof obj.payment_intent === 'string' ? obj.payment_intent : (obj.payment_intent?.id ?? null), Date.now());
          else console.error(`[webhook] importo non corrispondente per ${row.ref}: ${obj.amount_total} ≠ ${handler.dueCents(row)}`);
        } else if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) && obj.id === row.stripe_session_id) {
          handler.onExpired(row);
        }
      }
      res.json({ received: true });
    } catch (err) {
      console.error('[webhook] errore di elaborazione:', err);
      res.status(500).json({ error: 'processing error' });
    }
  });

  // ───── pagamento: ripresa e demo (valgono per prenotazioni, gift card e acconti) ─────
  const langOf = (req) => (isLang(String(req.query.lang ?? req.body?.lang)) ? String(req.query.lang ?? req.body?.lang) : 'it');
  function byToken(req) {
    const found = app.payables.lookup(req.params.ref);
    const token = String(req.query.t ?? req.body?.t ?? '');
    return found && token && safeEqual(token, found.row.token) ? found : null;
  }

  r.get('/pay/resume/:ref', async (req, res, next) => {
    const found = byToken(req);
    const lang = langOf(req);
    if (!found) return next();
    const { handler, row } = found;
    const back = handler.statusUrl(row, lang);
    if (!handler.isOpen(row)) return res.redirect(303, back);
    try {
      res.redirect(303, await handler.startCheckout(row, lang, Date.now(), Date.now()));
    } catch (err) {
      console.error('[resume] errore Stripe:', err.message);
      res.redirect(303, back);
    }
  });

  r.get('/pay/demo/:ref', (req, res, next) => {
    const found = byToken(req);
    if (!found || !payments.demo || !found.handler.isOpen(found.row)) return next();
    const lang = langOf(req);
    const { handler, row } = found;
    send(res, demoPayPage(makeCtx(app, req, lang), { ref: row.ref, token: row.token, amountCents: handler.dueCents(row), currency: row.currency ?? 'EUR', title: handler.title(row, lang), cancelUrl: `${handler.statusUrl(row, lang)}&canceled=1` }));
  });
  r.post('/pay/demo/:ref/complete', form, async (req, res, next) => {
    const found = byToken(req);
    if (!found || !payments.demo) return next();
    const { handler, row } = found;
    await handler.onPaid(row, `demo_pi_${row.ref}`, Date.now());
    res.redirect(303, `${handler.statusUrl(row, langOf(req))}&paid=1`);
  });

  return r;
}


