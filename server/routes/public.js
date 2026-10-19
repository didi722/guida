import crypto from 'node:crypto';
import express from 'express';
import { loadAvailabilityContext, nextAvailableDates, nextDepartures, slotsForDay } from '../availability.js';
import { BookingError, activeOptionCount, cancellationState, getBookingByRef, slotStillOpen } from '../bookings.js';
import { maxActiveOptions, optionWindow } from '../optionPolicy.js';
import { onlinePaymentsOpen } from '../opening.js';
import { hourlyQuote, previewPricing } from '../pricing.js';
import { getPackage } from '../packages.js';
import { readSlot } from '../slotParams.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from '../auth.js';
import { sendContactMessage, sendInviteEmail, sendPartnerPasswordReset, sendPartnerRegistered, icsFor } from '../emails.js';
import { createInvite, inviteLink, inviteOffer } from '../invites.js';
import { isDate, isTime, localToInstant, nowRome } from '../time.js';
import { cleanText, isEmail, safeEqual } from '../util.js';
import { loginPartner, logoutPartner, send, sendPdf, tooMany } from '../http.js';
import { invoiceOfBooking } from '../partner.js';
import { applePass, googleSaveUrl, walletOptions } from '../wallet.js';
import { renderVoucherPdf } from '../pdf.js';
import { forgotPage, loginPage, registerPage, resetPage } from '../views/b2b.js';
import { bookPage, bookingPage, checkoutPage, slotGonePage } from '../views/booking.js';
import { hourlyPage } from '../views/hourly.js';
import { extraHourOptions, hourOptions, minHours, openTo } from '../rates.js';
import { b2bLandingPage, blogPage, contactPage, homePage, minBookableDate, postPage, staticPage, toursPage, tourPage } from '../views/site.js';
import { LANGS, LANG_META, normLang, pick } from '../langs.js';
import { featuredQuotes, feedbackStats } from '../reviews.js';

const clampInt = (v, min, max, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : d;
};
const voucherLang = (req) => (LANGS.includes(String(req.query.vl)) ? String(req.query.vl) : req.lang); // il voucher si scarica nella lingua scelta (?vl=), non solo in quella del sito
const channelOf = (acct) => (acct?.status === 'approved' ? 'b2b' : 'b2c');
const safeNext = (n) => (typeof n === 'string' && /^\/[a-z]{2}\/[^/]/.test(n) && !n.startsWith('//') ? n : '');

export function publicRouter(app) {
  const r = express.Router();
  const { cfg, db, content, services } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ip = (req) => req.ip ?? 'ip';

  // pagine con dati personali: mai in cache del browser o di proxy
  r.use(['/booking', '/book/checkout', '/b2b/account', '/b2b/login', '/b2b/register', '/b2b/forgot', '/b2b/reset'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // tour che si prenotano con data e persone (i servizi a ore hanno la loro pagina, quelli per agenzie solo i partner)
  const visible = (channel) => {
    const rates = app.rates.get();
    return content.tours.filter((x) => openTo(rates, x, channel));
  };
  const selectable = (channel) => visible(channel).filter((x) => x.pricing !== 'hourly');
  const hourlyProducts = (channel) => visible(channel).filter((x) => x.pricing === 'hourly');

  r.get('/', (req, res) => {
    send(res, homePage(res.locals.ctx, { quotes: featuredQuotes(db, { limit: 3, lang: req.lang }), reviewStats: feedbackStats(db) }));
  });
  r.get('/tours', (req, res) => send(res, toursPage(res.locals.ctx, { kind: ['private', 'group'].includes(req.query.kind) ? req.query.kind : null })));
  r.get('/tours/:slug', (req, res, next) => {
    const tour = content.tour(req.params.slug);
    if (!tour?.active || !openTo(app.rates.get(), tour, channelOf(req.acct))) return next();
    send(res, tourPage(res.locals.ctx, tour, { quotes: featuredQuotes(db, { tourSlug: tour.slug, limit: 3, lang: req.lang }), reviewStats: feedbackStats(db) }));
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
    vat: cfg.site.vatNumber || pick({ it: '[P.IVA — da inserire]', en: '[VAT no. — to be added]', es: '[N.º de IVA — por añadir]', ja: '[VAT番号 — 追記予定]' }, ctx.lang),
    address: cfg.site.address || pick({ it: '[indirizzo — da inserire]', en: '[address — to be added]', es: '[dirección — por añadir]', ja: '[住所 — 追記予定]' }, ctx.lang),
    giftMonths: String(cfg.gift.validityMonths),
    payMethods: cfg.policy.allowPayOnSite ? ctx.t('legal.payBoth') : ctx.t('legal.payCard'),
    license: cfg.site.guideLicense || pick({ it: '[n. abilitazione — da inserire]', en: '[licence no. — to be added]', es: '[n.º de habilitación — por añadir]', ja: '[ガイド資格番号 — 追記予定]' }, ctx.lang),
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
  /**
   * Spunte della ricerca per le agenzie: «tour privati» (guida a ore, itinerari privati) e «tour condivisi» (partenze a persona).
   * Se non si è scelto nulla, solo i privati; se si invia il modulo senza nessuna spunta, tutto.
   */
  const readKinds = (q, channel) => {
    if (channel !== 'b2b') return { private: true, shared: true, shown: false };
    return { private: true, shared: true, shown: false }; // le agenzie vedono tutto: tour privati, condivisi e servizi a ore
  };
  const isShared = (x) => x.model === 'person';
  const isPrivateTour = (x) => x.model === 'group' && (x.pricing !== 'hourly' || x.service === 'guide'); // assistente, tour leader e meet & greet sono servizi, non tour
  /** I tour che compaiono nella ricerca: i privati e/o i condivisi per le agenzie; per i privati cittadini i tour a prezzo fisso. */
  const searchable = (channel, kinds) => (channel === 'b2b' ? visible(channel) : selectable(channel));
  /** Ore con cui si cerca la disponibilità di un servizio a ore: la durata fissa del tour, o il minimo del servizio. */
  const searchHours = (tour) => (tour.chooseHours ? minHours(tour.service) : tour.durationMin / 60);

  r.get('/book', (req, res) => {
    const ctx = res.locals.ctx;
    const channel = channelOf(req.acct);
    const asked = content.tour(String(req.query.tour ?? ''));
    // standard di prenotazione per i privati: si sceglie il tour e da lì calendario, persone, orari e prezzo (la ricerca per data resta per le agenzie)
    if (channel !== 'b2b' && !isDate(req.query.date)) return res.redirect(302, asked?.active && openTo(app.rates.get(), asked, channel) ? `/${req.lang}/tours/${asked.slug}` : `/${req.lang}/tours`);
    if (asked?.pricing === 'hourly' && channel !== 'b2b') return res.redirect(302, `/${req.lang}/hourly?product=${asked.slug}`);
    const kinds = readKinds(req.query, channel);
    const pax = clampInt(req.query.pax, 1, 25, 2);
    const list0 = searchable(channel, kinds);
    const tourSlug = asked?.active && (channel === 'b2b' ? visible(channel).includes(asked) : list0.includes(asked)) ? asked.slug : '';
    const minDate = minBookableDate(app, channel);
    const date = isDate(req.query.date) ? req.query.date : null;
    let results = [];
    let suggestions = [];
    if (date) {
      const nowMs = Date.now();
      const list = tourSlug ? [content.tour(tourSlug)] : list0;
      const actx = loadAvailabilityContext(db, cfg, date, date, nowMs);
      results = list
        .map((tour) => {
          if (tour.pricing !== 'hourly') return { tour, slots: slotsForDay(actx, cfg, tour, date, { pax, channel, nowMs }) };
          // servizio a ore: orari liberi per la durata minima, e il prezzo «da»
          const hours = searchHours(tour);
          const quote = hourlyQuote(app, tour, { pax, channel, account: req.acct, date, time: null, hours });
          return { tour, hours, quote, slots: quote.ok ? slotsForDay(actx, cfg, tour, date, { pax, channel, nowMs, durationMin: Math.round(hours * 60) }) : [] };
        })
        .filter((x) => x.slots.length);
      if (!results.length) suggestions = nextAvailableDates(db, cfg, list, date < minDate ? minDate : date, { pax, channel, nowMs });
    }
    // senza una data in mente: le prossime partenze, prenotabili con un tocco
    const departures = date ? [] : nextDepartures(db, cfg, tourSlug ? [content.tour(tourSlug)] : list0.filter(isShared), nowRome(Date.now()).date, { pax: 1, channel, nowMs: Date.now(), limit: 6 });
    send(res, bookPage(ctx, { date, pax, tourSlug, minDate, results, suggestions, departures, channel, kinds, tours: channel === 'b2b' ? visible(channel) : selectable(channel), hourly: hourlyProducts(channel).length > 0 }));
  });

  // ───── servizi a ore: preventivo e orari liberi ─────
  r.get('/hourly', (req, res) => {
    const ctx = res.locals.ctx;
    const channel = channelOf(req.acct);
    const products = hourlyProducts(channel);
    if (channel !== 'b2b' && !isDate(req.query.date)) { // i privati scelgono dal tour (come per /book); con una data resta la pagina di sempre, per i link già in giro
      const slug = String(req.query.product ?? '');
      return res.redirect(302, products.some((x) => x.slug === slug) ? `/${req.lang}/tours/${slug}` : `/${req.lang}/tours?kind=private`);
    }
    const product = products.find((x) => x.slug === String(req.query.product ?? '')) ?? products[0] ?? null;
    if (!product) return send(res, hourlyPage(ctx, { products: [], product: null, channel, values: {}, quote: null, slots: [], minDate: '' }));
    const minDate = minBookableDate(app, channel);
    const date = isDate(req.query.date) && req.query.date >= minDate ? req.query.date : null;
    const pax = clampInt(req.query.pax, 1, product.maxParticipants, 2);
    const asked = Number(req.query.hours);
    const extraOptions = extraHourOptions(product, channel);
    const extra = extraOptions.includes(Number(req.query.extra)) ? Number(req.query.extra) : 0;
    const hours = product.chooseHours ? (hourOptions(product.service).includes(asked) ? asked : Math.max(product.durationMin / 60, hourOptions(product.service)[0])) : product.durationMin / 60 + extra;
    const earpieces = req.query.earpieces === '1';
    const account = channel === 'b2b' ? req.acct : null;
    const quote = hourlyQuote(app, product, { pax, channel, account, date, time: null, hours, earpieces });
    let slots = [];
    if (date && quote.ok) {
      const nowMs = Date.now();
      const actx = loadAvailabilityContext(db, cfg, date, date, nowMs);
      slots = slotsForDay(actx, cfg, product, date, { pax, channel, nowMs, durationMin: Math.round(hours * 60) })
        .map((s) => ({ ...s, quote: hourlyQuote(app, product, { pax, channel, account, date, time: s.time, hours, earpieces }) }))
        .filter((s) => s.quote.ok);
    }
    send(res, hourlyPage(ctx, { products, product, channel, values: { date, hours, pax, earpieces, extra }, extraOptions, quote, slots, minDate }));
  });

  // ───── checkout ─────
  const readSlotParams = (src, channel) => readSlot(app, src, channel);
  const openSlot = (p, channel) => slotStillOpen(app, p.tour, p.date, p.time, p.pax, channel, Date.now(), p.durationMin);

  r.get('/book/checkout', async (req, res) => {
    const ctx = res.locals.ctx;
    const channel = channelOf(req.acct);
    const p = readSlotParams(req.query, channel);
    if (!p) return send(res, slotGonePage(ctx, { tour: content.tour(String(req.query.tour ?? '')), date: null, pax: 2 }), 400);
    await app.calendars.ensureFresh(); // riallinea il calendario personale prima di mostrare/confermare lo slot
    const slot = openSlot(p, channel);
    if (!slot) return send(res, slotGonePage(ctx, p), 409);
    // link promozionali: /book/checkout?...&promo=CODICE (o &gift=CODICE)
    const values = { promo: cleanText(req.query.promo, 40), gift: cleanText(req.query.gift, 120), tourLang: p.tour.languages.includes(String(req.query.tl)) ? String(req.query.tl) : '' };
    if ((values.promo || values.gift) && !app.limits.codes(ip(req))) return tooMany(res);
    send(res, checkoutPage(ctx, { ...p, slot, channel, values, pricing: pricingFor(req, p, values, channel), option: optionPreview(req, p, channel) }));
  });

  /** L'agenzia può opzionare questo servizio? Fino a quando? (null per i privati o se le opzioni sono spente) */
  const optionPreview = (req, p, channel) => {
    if (channel !== 'b2b' || !req.acct) return null;
    const w = optionWindow({ options: cfg.options, account: req.acct, startMs: localToInstant(p.date, p.time), nowMs: Date.now() });
    if (!w.ok) return w.reason === 'disabled' ? null : { ok: false, reason: w.reason };
    const limit = maxActiveOptions(cfg.options, req.acct);
    if (limit > 0 && activeOptionCount(db, req.acct.id) >= limit) return { ok: false, reason: 'limit', limit };
    return { ok: true, expiresMs: w.expiresMs, days: w.days, period: w.period };
  };

  const pricingFor = (req, p, values, channel) =>
    previewPricing(app, { tour: p.tour, pax: p.pax, channel, account: channel === 'b2b' ? req.acct : null, date: p.date, time: p.time, hours: p.hours, earpieces: p.earpieces, email: values.email ?? '', promoCode: values.promo, giftCodes: values.gift });

  r.post('/book/checkout', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (b.website) return res.status(400).end();
    if (!app.limits.booking(ip(req))) return tooMany(res);
    const channel = channelOf(req.acct);
    const p = readSlotParams(b, channel);
    if (!p) return send(res, slotGonePage(ctx, { tour: content.tour(String(b.tour ?? '')), date: null, pax: 2 }), 400);
    if (!b.apply) await app.calendars.ensureFresh(); // riallinea il calendario personale prima di prenotare
    const values = { name: cleanText(b.name, 120), email: cleanText(b.email, 200), phone: cleanText(b.phone, 40), lang: normLang(b.lang), tourLang: p.tour.languages.includes(String(b.tourLang)) ? String(b.tourLang) : '', theme: String(b.theme ?? ''), pickup: cleanText(b.pickup, 200), themeNote: cleanText(b.themeNote, 500), notes: cleanText(b.notes, 1000), clientRef: cleanText(b.clientRef, 120), paymentMethod: b.paymentMethod, invoice: b.invoice ? '1' : '', billing: cleanText(b.billing, 500), promo: channel === 'b2b' ? '' : cleanText(b.promo, 40), gift: channel === 'b2b' ? '' : cleanText(b.gift, 120) };
    if ((values.promo || values.gift) && !app.limits.codes(ip(req))) return tooMany(res);
    const rerender = (error, status = 400) => {
      const slot = openSlot(p, channel);
      return slot ? send(res, checkoutPage(ctx, { ...p, slot, channel, values, error, pricing: pricingFor(req, p, values, channel), option: optionPreview(req, p, channel) }), status) : send(res, slotGonePage(ctx, p), 409);
    };
    if (b.apply) return rerender('', 200); // "Applica": mostra il nuovo totale senza prenotare
    if (!b.consent) return rerender(t('err.consent'));
    const wantsOption = b.action === 'option' && channel === 'b2b'; // «Opziona»: la data resta trattenuta senza pagare
    try {
      const billing = channel === 'b2b' ? { company: req.acct.company, vat: req.acct.vat, sdi: req.acct.sdi_code, pec: req.acct.pec, address: req.acct.address } : values.invoice ? { text: values.billing } : null;
      const { redirect } = await services.book({ tourSlug: p.tour.slug, date: p.date, time: p.time, pax: p.pax, hours: p.hours, earpieces: p.earpieces, channel, account: channel === 'b2b' ? req.acct : null, ...values, promoCode: values.promo, giftCodes: values.gift, billing, option: wantsOption }, req.lang);
      res.redirect(303, redirect);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      if (e.code === 'unavailable') return send(res, slotGonePage(ctx, p), 409);
      if (e.code === 'promo' || e.code === 'gift') return rerender('');
      if (e.code === 'language') return rerender(t('err.tourLang', { lang: LANG_META[e.message]?.name ?? e.message }), 409);
      if (e.code === 'option') return rerender(t(`option.err.${['tooClose', 'limit', 'period'].includes(e.message) ? e.message : 'disabled'}`));
      return rerender(e.code === 'payment' ? t('err.payment') : e.message === 'theme' ? t('err.theme') : t('err.fields'));
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
    if (req.query.paid && (b.status === 'held' || services.payableLater(b))) b = await services.syncStripe(b);
    // l'agenzia che ha fatto la prenotazione (se è entrata) la vede dentro la sua area, con fattura e modifica del nominativo
    const owner = !!req.acct && b.account_id === req.acct.id && req.acct.status === 'approved';
    send(res, bookingPage(res.locals.ctx, b, { flash: req.query.flash ? String(req.query.flash) : '', payLater: services.payableLater(b), owner, invoice: owner ? invoiceOfBooking(db, b.id) : null, invite: inviteOffer(app, b), group: b.group_id ? getPackage(db, b.group_id) : null }));
  });
  r.get('/booking/:ref/calendar.ics', (req, res, next) => {
    const b = loadBooking(req);
    if (!b || b.status !== 'confirmed') return next();
    res.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="${b.ref}.ics"`).send(icsFor(app, b, req.lang));
  });
  r.get('/booking/:ref/voucher.pdf', async (req, res, next) => {
    const b = loadBooking(req);
    if (!b || b.status !== 'confirmed') return next();
    sendPdf(res, await renderVoucherPdf(app, b, { lang: voucherLang(req) }), `voucher-${b.ref}${req.query.vl ? `-${voucherLang(req)}` : ''}.pdf`);
  });
  // «Aggiungi al wallet» (solo clienti privati con prenotazione confermata): il link di Google Wallet e il file .pkpass di Apple
  r.get('/booking/:ref/wallet/google', (req, res, next) => {
    const b = loadBooking(req);
    if (!b || !walletOptions(app, b).google) return next();
    res.redirect(302, googleSaveUrl(app, b, req.lang));
  });
  r.get('/booking/:ref/wallet/apple.pkpass', async (req, res, next) => {
    const b = loadBooking(req);
    if (!b || !walletOptions(app, b).apple) return next();
    const file = await applePass(app, b, req.lang);
    res.set({ 'Content-Type': 'application/vnd.apple.pkpass', 'Content-Disposition': `attachment; filename="${b.ref}.pkpass"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(file);
  });
  // «Invita un amico»: un codice sconto tutto suo per questa partenza (e, se c'è l'email, l'invito lo spediamo noi)
  r.post('/booking/:ref/invite', form, async (req, res, next) => {
    const b = loadBooking(req);
    if (!b) return next();
    const to = (flash) => res.redirect(303, `/${req.lang}/booking/${b.ref}?t=${b.token}&flash=${flash}`); // il riquadro è subito sotto l’avviso: niente salto
    if (!app.limits.codes(ip(req))) return tooMany(res);
    try {
      const email = cleanText(req.body.email, 200); // (facoltativa: il modulo di base non la chiede più)
      const { invite } = createInvite(app, b, { email });
      if (invite.friend_email) await sendInviteEmail(app, b, invite, inviteLink(app, b, invite.code, normLang(b.tour_lang ?? b.lang)));
      return to(invite.friend_email ? 'inviteSent' : 'inviteMade');
    } catch (e) {
      if (e.reason) return to('invite-error');
      throw e;
    }
  });
  // un invito già creato: lo si manda per email all'amico
  r.post('/booking/:ref/invite/:id/email', form, async (req, res, next) => {
    const b = loadBooking(req);
    if (!b) return next();
    const to = (flash) => res.redirect(303, `/${req.lang}/booking/${b.ref}?t=${b.token}&flash=${flash}`); // il riquadro è subito sotto l’avviso: niente salto
    if (!app.limits.codes(ip(req))) return tooMany(res);
    const email = cleanText(req.body.email, 200).toLowerCase();
    const invite = db.prepare('SELECT * FROM invites WHERE id = ? AND booking_id = ?').get(Number(req.params.id), b.id);
    if (!invite || !isEmail(email) || !inviteOffer(app, b).invites?.some((i) => i.id === invite.id && !i.used)) return to('invite-error');
    db.prepare('UPDATE invites SET friend_email = ? WHERE id = ?').run(email, invite.id);
    await sendInviteEmail(app, b, { ...invite, friend_email: email }, inviteLink(app, b, invite.code, normLang(b.tour_lang ?? b.lang)));
    return to('inviteSent');
  });
  r.post('/booking/:ref/cancel', form, async (req, res, next) => {
    const b = loadBooking(req);
    if (!b) return next();
    const back = (flash) => res.redirect(303, `/${req.lang}/booking/${b.ref}?t=${b.token}&flash=${flash}`);
    if (b.status !== 'confirmed' || cancellationState(b).percent <= 0) return back('cancel-error'); // senza rimborso si scrive alla guida
    await services.cancel(b.id, { by: 'customer' });
    back('cancelled');
  });

  // ───── opzioni: l'agenzia conferma o rilascia (con il link della prenotazione, anche dal suo account) ─────
  const optionBack = (req, b, flash) => {
    const next = safeNext(req.body?.next);
    if (next) return `${next}${next.includes('?') ? '&' : '?'}flash=${flash}`;
    return `/${req.lang}/booking/${b.ref}?t=${b.token}&flash=${flash}`;
  };
  r.post('/booking/:ref/option/confirm', form, async (req, res, next) => {
    const b = loadBooking(req);
    if (b && b.status === 'confirmed' && b.option_expires_at) return res.redirect(303, optionBack(req, b, 'option-confirmed')); // secondo clic (o invio doppio): è già confermata
    if (b && b.status === 'held' && b.option_expires_at) return res.redirect(303, `/pay/resume/${b.ref}?t=${b.token}&lang=${req.lang}`); // sta già pagando con la carta: si riprende da lì
    if (!b || b.status !== 'option') return next();
    if (b.group_id) return res.redirect(303, `/${req.lang}/packages/${getPackage(db, b.group_id).ref}?t=${getPackage(db, b.group_id).token}`); // le date di un pacchetto si confermano insieme, dalla sua pagina
    const result = await services.confirmOption(b.id, req.lang, { method: String(req.body.method ?? '') });
    if (result.redirect) return res.redirect(303, result.redirect);
    res.redirect(303, optionBack(req, b, { confirmed: 'option-confirmed', expired: 'option-expired' }[result.outcome] ?? 'option-error'));
  });
  r.post('/booking/:ref/option/release', form, async (req, res, next) => {
    const b = loadBooking(req);
    if (b && b.status === 'expired' && b.option_expires_at && b.cancelled_by === 'customer') return res.redirect(303, optionBack(req, b, 'option-released')); // secondo clic: è già rilasciata
    if (!b || b.status !== 'option') return next();
    await services.releaseOption(b.id, { by: 'customer' });
    res.redirect(303, optionBack(req, b, 'option-released'));
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
  // password dimenticata: un collegamento firmato per email (vale un'ora e smette di valere appena la password cambia)
  const resetFingerprint = (acct) => crypto.createHash('sha256').update(acct.password_hash).digest('hex').slice(0, 24);
  const resetAccount = (token) => {
    const p = verifyToken(cfg.sessionSecret, token);
    if (p?.k !== 'pwreset') return null;
    const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(p.id));
    return acct && p.f === resetFingerprint(acct) ? acct : null;
  };
  r.get('/b2b/forgot', (req, res) => send(res, forgotPage(res.locals.ctx)));
  r.post('/b2b/forgot', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const email = cleanText(req.body.email, 200).toLowerCase();
    if (!app.limits.forgot(`${ip(req)}|${email}`)) return tooMany(res);
    const acct = isEmail(email) ? db.prepare("SELECT * FROM accounts WHERE email = ? AND status IN ('approved', 'pending')").get(email) : null;
    if (acct) {
      const token = signToken(cfg.sessionSecret, { k: 'pwreset', id: acct.id, f: resetFingerprint(acct), exp: Date.now() + 3600_000 });
      try {
        await sendPartnerPasswordReset(app, acct, `${cfg.baseUrl}/${normLang(acct.lang)}/b2b/reset/${token}`);
      } catch (e) {
        console.error('[b2b] email di nuova password non inviata:', e.message);
      }
    }
    send(res, forgotPage(ctx, { sent: true })); // stessa risposta se l'email non esiste: non si rivela chi è registrato
  });
  r.get('/b2b/reset/:token', (req, res) => send(res, resetAccount(req.params.token) ? resetPage(res.locals.ctx, { token: req.params.token }) : resetPage(res.locals.ctx, { invalid: true }), resetAccount(req.params.token) ? 200 : 400));
  r.post('/b2b/reset/:token', form, async (req, res) => {
    const ctx = res.locals.ctx;
    const acct = resetAccount(req.params.token);
    if (!acct) return send(res, resetPage(ctx, { invalid: true }), 400);
    const pw = String(req.body.password ?? '');
    if (pw.length < 10) return send(res, resetPage(ctx, { token: req.params.token, error: ctx.t('err.password') }), 400);
    if (pw !== String(req.body.password2 ?? '')) return send(res, resetPage(ctx, { token: req.params.token, error: ctx.t('b2b.reset.mismatch') }), 400);
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), acct.id);
    loginPartner(res, cfg, acct.id);
    res.redirect(303, `/${req.lang}/b2b/account`);
  });
  r.post('/b2b/logout', form, (req, res) => {
    logoutPartner(res, cfg);
    res.redirect(303, `/${req.lang}/`); // si esce dall'area riservata e si torna alla pagina di tutti
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
  return r;
}


