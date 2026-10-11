import express from 'express';
import { loadAvailabilityContext, nextAvailableDates, slotsForDay } from '../availability.js';
import { BookingError, cancellationState, getBookingByRef, slotStillOpen } from '../bookings.js';
import { previewPricing } from '../pricing.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { sendContactMessage, sendPartnerRegistered, icsFor } from '../emails.js';
import { isDate, isTime } from '../time.js';
import { cleanText, isEmail, safeEqual } from '../util.js';
import { loginPartner, logoutPartner, send, sendPdf, tooMany } from '../http.js';
import { renderVoucherPdf } from '../pdf.js';
import { accountPage, loginPage, registerPage } from '../views/b2b.js';
import { bookPage, bookingPage, checkoutPage, slotGonePage } from '../views/booking.js';
import { b2bLandingPage, blogPage, contactPage, homePage, minBookableDate, postPage, staticPage, toursPage, tourPage } from '../views/site.js';

const clampInt = (v, min, max, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : d;
};
const channelOf = (acct) => (acct?.status === 'approved' ? 'b2b' : 'b2c');
const safeNext = (n) => (typeof n === 'string' && /^\/[a-z]{2}\/[^/]/.test(n) && !n.startsWith('//') ? n : '');

export function publicRouter(app) {
  const r = express.Router();
  const { cfg, db, content, services } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ip = (req) => req.ip ?? 'ip';

  // pagine con dati personali: mai in cache del browser o di proxy
  r.use(['/booking', '/book/checkout', '/b2b/account', '/b2b/login', '/b2b/register'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.get('/', (req, res) => send(res, homePage(res.locals.ctx)));
  r.get('/tours', (req, res) => send(res, toursPage(res.locals.ctx)));
  r.get('/tours/:slug', (req, res, next) => {
    const tour = content.tour(req.params.slug);
    if (!tour?.active) return next();
    send(res, tourPage(res.locals.ctx, tour));
  });
  r.get('/blog', (req, res) => send(res, blogPage(res.locals.ctx)));
  r.get('/blog/:slug', (req, res, next) => {
    const post = content.post(req.params.slug);
    if (!post?.i18n[req.lang]) return next();
    send(res, postPage(res.locals.ctx, post));
  });
  r.get('/b2b', (req, res) => send(res, b2bLandingPage(res.locals.ctx)));

  // pagine di testo (content/pages/*.md)
  const pageVars = (ctx) => ({
    name: cfg.site.name,
    legalName: cfg.site.legalName,
    email: cfg.site.email,
    phone: cfg.site.phone,
    vat: cfg.site.vatNumber || '[P.IVA — da inserire]',
    address: cfg.site.address || '[indirizzo — da inserire]',
    giftMonths: String(cfg.gift.validityMonths),
    payMethods: cfg.policy.allowPayOnSite ? ctx.t('legal.payBoth') : ctx.t('legal.payCard'),
    license: cfg.site.guideLicense || (ctx.lang === 'it' ? '[n. abilitazione — da inserire]' : '[licence no. — to be added]'),
    b2cHours: ctx.t(cfg.policy.b2cFreeCancelHours >= 48 && cfg.policy.b2cFreeCancelHours % 24 === 0 ? 'time.days' : 'time.hours', { n: cfg.policy.b2cFreeCancelHours >= 48 && cfg.policy.b2cFreeCancelHours % 24 === 0 ? cfg.policy.b2cFreeCancelHours / 24 : cfg.policy.b2cFreeCancelHours }),
    b2bHours: ctx.t(cfg.policy.b2bFreeCancelHours >= 48 && cfg.policy.b2bFreeCancelHours % 24 === 0 ? 'time.days' : 'time.hours', { n: cfg.policy.b2bFreeCancelHours >= 48 && cfg.policy.b2bFreeCancelHours % 24 === 0 ? cfg.policy.b2bFreeCancelHours / 24 : cfg.policy.b2bFreeCancelHours }),
  });
  for (const name of ['about', 'privacy', 'terms', 'cookies']) {
    r.get(`/${name}`, (req, res, next) => {
      const pg = content.page(name, req.lang);
      if (!pg) return next();
      send(res, staticPage(res.locals.ctx, name, pg, pageVars(res.locals.ctx), { activeNav: name === 'about' ? 'about' : '' }));
    });
  }

  // ───── contatti ─────
  r.get('/contact', (req, res) => send(res, contactPage(res.locals.ctx)));
  r.post('/contact', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (b.website) return send(res, contactPage(ctx, { sent: true })); // honeypot: i bot credono di aver inviato
    if (!app.limits.contact(ip(req))) return tooMany(res);
    const values = { name: cleanText(b.name, 120), email: cleanText(b.email, 200), message: cleanText(b.message, 3000) };
    if (values.name.length < 2 || !isEmail(values.email) || values.message.length < 5) return send(res, contactPage(ctx, { error: t('err.fields'), values }), 400);
    await sendContactMessage(app, { ...values, lang: req.lang });
    send(res, contactPage(ctx, { sent: true }));
  });

  // ───── prenota: prima la data ─────
  r.get('/book', (req, res) => {
    const ctx = res.locals.ctx;
    const channel = channelOf(req.acct);
    const pax = clampInt(req.query.pax, 1, 25, 2);
    const tourSlug = content.tour(String(req.query.tour ?? ''))?.active ? String(req.query.tour) : '';
    const minDate = minBookableDate(app, channel);
    const date = isDate(req.query.date) ? req.query.date : null;
    let results = [];
    let suggestions = [];
    if (date) {
      const nowMs = Date.now();
      const list = tourSlug ? [content.tour(tourSlug)] : content.tours;
      const actx = loadAvailabilityContext(db, cfg, date, date, nowMs);
      results = list.map((tour) => ({ tour, slots: slotsForDay(actx, cfg, tour, date, { pax, channel, nowMs }) })).filter((x) => x.slots.length);
      if (!results.length) suggestions = nextAvailableDates(db, cfg, list, date < minDate ? minDate : date, { pax, channel, nowMs });
    }
    send(res, bookPage(ctx, { date, pax, tourSlug, minDate, results, suggestions, channel }));
  });

  // ───── checkout ─────
  function readSlotParams(src) {
    const tour = content.tour(String(src.tour ?? ''));
    const pax = Number.parseInt(src.pax, 10);
    if (!tour?.active || !Number.isInteger(pax) || pax < 1 || pax > tour.maxParticipants || !isDate(src.date) || !isTime(src.time)) return null;
    return { tour, pax, date: src.date, time: src.time };
  }

  r.get('/book/checkout', async (req, res) => {
    const ctx = res.locals.ctx;
    const channel = channelOf(req.acct);
    const p = readSlotParams(req.query);
    if (!p) return send(res, slotGonePage(ctx, { tour: content.tour(String(req.query.tour ?? '')), date: null, pax: 2 }), 400);
    await app.calendars.ensureFresh(); // riallinea il calendario personale prima di mostrare/confermare lo slot
    const slot = slotStillOpen(app, p.tour, p.date, p.time, p.pax, channel);
    if (!slot) return send(res, slotGonePage(ctx, p), 409);
    // link promozionali: /book/checkout?...&promo=CODICE (o &gift=CODICE)
    const values = { promo: cleanText(req.query.promo, 40), gift: cleanText(req.query.gift, 120) };
    if ((values.promo || values.gift) && !app.limits.codes(ip(req))) return tooMany(res);
    send(res, checkoutPage(ctx, { ...p, slot, channel, values, pricing: pricingFor(req, p, values, channel) }));
  });

  const pricingFor = (req, p, values, channel) =>
    previewPricing(app, { tour: p.tour, pax: p.pax, channel, account: channel === 'b2b' ? req.acct : null, date: p.date, email: values.email ?? '', promoCode: values.promo, giftCodes: values.gift });

  r.post('/book/checkout', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (b.website) return res.status(400).end();
    if (!app.limits.booking(ip(req))) return tooMany(res);
    const channel = channelOf(req.acct);
    const p = readSlotParams(b);
    if (!p) return send(res, slotGonePage(ctx, { tour: content.tour(String(b.tour ?? '')), date: null, pax: 2 }), 400);
    if (!b.apply) await app.calendars.ensureFresh(); // riallinea il calendario personale prima di prenotare
    const values = { name: cleanText(b.name, 120), email: cleanText(b.email, 200), phone: cleanText(b.phone, 40), lang: b.lang === 'en' ? 'en' : 'it', notes: cleanText(b.notes, 1000), clientRef: cleanText(b.clientRef, 120), paymentMethod: b.paymentMethod, invoice: b.invoice ? '1' : '', billing: cleanText(b.billing, 500), promo: channel === 'b2b' ? '' : cleanText(b.promo, 40), gift: channel === 'b2b' ? '' : cleanText(b.gift, 120) };
    if ((values.promo || values.gift) && !app.limits.codes(ip(req))) return tooMany(res);
    const rerender = (error, status = 400) => {
      const slot = slotStillOpen(app, p.tour, p.date, p.time, p.pax, channel);
      return slot ? send(res, checkoutPage(ctx, { ...p, slot, channel, values, error, pricing: pricingFor(req, p, values, channel) }), status) : send(res, slotGonePage(ctx, p), 409);
    };
    if (b.apply) return rerender('', 200); // "Applica": mostra il nuovo totale senza prenotare
    if (!b.consent) return rerender(t('err.consent'));
    try {
      const billing = channel === 'b2b' ? { company: req.acct.company, vat: req.acct.vat, sdi: req.acct.sdi_code, pec: req.acct.pec, address: req.acct.address } : values.invoice ? { text: values.billing } : null;
      const { redirect } = await services.book({ tourSlug: p.tour.slug, date: p.date, time: p.time, pax: p.pax, channel, account: channel === 'b2b' ? req.acct : null, ...values, promoCode: values.promo, giftCodes: values.gift, billing }, req.lang);
      res.redirect(303, redirect);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      if (e.code === 'unavailable') return send(res, slotGonePage(ctx, p), 409);
      if (e.code === 'promo' || e.code === 'gift') return rerender('');
      return rerender(e.code === 'payment' ? t('err.payment') : t('err.fields'));
    }
  });

  // ───── la mia prenotazione (link con token) ─────
  function loadBooking(req) {
    const b = getBookingByRef(db, req.params.ref);
    const token = String(req.query.t ?? req.body?.t ?? '');
    return b && token && safeEqual(token, b.token) ? b : null;
  }

  r.get('/booking/:ref', async (req, res, next) => {
    let b = loadBooking(req);
    if (!b) return next();
    if (req.query.paid && b.status === 'held') b = await services.syncStripe(b);
    send(res, bookingPage(res.locals.ctx, b, { flash: req.query.flash ? String(req.query.flash) : '' }));
  });
  r.get('/booking/:ref/calendar.ics', (req, res, next) => {
    const b = loadBooking(req);
    if (!b || b.status !== 'confirmed') return next();
    res.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="${b.ref}.ics"`).send(icsFor(app, b, req.lang));
  });
  r.get('/booking/:ref/voucher.pdf', async (req, res, next) => {
    const b = loadBooking(req);
    if (!b || b.status !== 'confirmed') return next();
    sendPdf(res, await renderVoucherPdf(app, b, { lang: req.lang }), `voucher-${b.ref}.pdf`);
  });
  r.post('/booking/:ref/cancel', form, async (req, res, next) => {
    const b = loadBooking(req);
    if (!b) return next();
    const back = (flash) => res.redirect(303, `/${req.lang}/booking/${b.ref}?t=${b.token}&flash=${flash}`);
    if (b.status !== 'confirmed' || !cancellationState(b).free) return back('cancel-error');
    await services.cancel(b.id, { by: 'customer' });
    back('cancelled');
  });

  // ───── area partner B2B ─────
  r.get('/b2b/login', (req, res) => {
    if (req.acct) return res.redirect(`/${req.lang}/b2b/account`);
    send(res, loginPage(res.locals.ctx, { next: safeNext(req.query.next) }));
  });
  r.post('/b2b/login', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const email = cleanText(req.body.email, 200).toLowerCase();
    if (!app.limits.login(`${ip(req)}|${email}`)) return tooMany(res);
    const acct = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
    const ok = acct && (await verifyPassword(String(req.body.password ?? ''), acct.password_hash));
    if (!ok) return send(res, loginPage(ctx, { error: ctx.t('b2b.loginError'), email }), 401);
    loginPartner(res, cfg, acct.id);
    res.redirect(303, safeNext(req.body.next) || `/${req.lang}/b2b/account`);
  });
  r.post('/b2b/logout', form, (req, res) => {
    logoutPartner(res, cfg);
    res.redirect(303, `/${req.lang}/b2b`);
  });
  r.get('/b2b/register', (req, res) => send(res, registerPage(res.locals.ctx)));
  r.post('/b2b/register', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (b.website2) return send(res, registerPage(ctx, { done: true }));
    if (!app.limits.register(ip(req))) return tooMany(res);
    const v = {
      company: cleanText(b.company, 160), vat: cleanText(b.vat, 40), country: cleanText(b.country, 8) || 'IT', website: cleanText(b.website, 200), sdi_code: cleanText(b.sdi_code, 10).toUpperCase(), pec: cleanText(b.pec, 200),
      address: cleanText(b.address, 250), contact_name: cleanText(b.contact_name, 120), phone: cleanText(b.phone, 40), email: cleanText(b.email, 200).toLowerCase(), message: cleanText(b.message, 1000),
    };
    const fail = (error) => send(res, registerPage(ctx, { error, values: v }), 400);
    if (!v.company || !v.vat || !v.contact_name || !v.phone) return fail(t('err.fields'));
    if (!isEmail(v.email)) return fail(t('err.email'));
    if (String(b.password ?? '').length < 10) return fail(t('err.password'));
    if (v.country === 'IT' && !/^[A-Z0-9]{7}$/.test(v.sdi_code) && !isEmail(v.pec)) return fail(t('err.sdi'));
    if (v.website && !/^https?:\/\/\S+$/i.test(v.website)) return fail(t('err.fields'));
    if (!b.consent) return fail(t('err.consent'));
    if (db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(v.email)) return fail(t('err.exists'));
    const info = db
      .prepare(`INSERT INTO accounts(email, password_hash, company, vat, sdi_code, pec, country, address, contact_name, phone, website, message, lang, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(v.email, await hashPassword(String(b.password)), v.company, v.vat, v.sdi_code || null, v.pec || null, v.country, v.address || null, v.contact_name, v.phone, v.website || null, v.message || null, req.lang, new Date().toISOString());
    const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(info.lastInsertRowid));
    await sendPartnerRegistered(app, acct);
    loginPartner(res, cfg, acct.id);
    send(res, registerPage(ctx, { done: true }));
  });
  r.get('/b2b/account', (req, res) => {
    if (!req.acct) return res.redirect(`/${req.lang}/b2b/login?next=${encodeURIComponent(`/${req.lang}/b2b/account`)}`);
    const bookings = db.prepare(`SELECT * FROM bookings WHERE account_id = ? ORDER BY date DESC, start_time DESC LIMIT 200`).all(req.acct.id);
    send(res, accountPage(res.locals.ctx, { acct: req.acct, bookings }));
  });

  return r;
}


