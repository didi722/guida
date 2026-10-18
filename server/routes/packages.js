// Pacchetti delle agenzie: il carrello («Aggiungi al pacchetto» dal pagamento), la prenotazione di tutti i servizi insieme e la pagina del pacchetto
// (dal link dell'email, con il codice segreto, oppure dall'area dell'agenzia).
import express from 'express';
import { paymentOptions } from '../bookings.js';
import { icsForPackage } from '../emails.js';
import { send, tooMany } from '../http.js';
import { LANGS, normLang } from '../langs.js';
import { PackageError, cartAdd, cartClear, cartRemove, cartSummary, getPackageByRef, packageBookings, MAX_PACKAGE_LINES } from '../packages.js';
import { cleanText, isEmail, safeEqual } from '../util.js';
import { packageCartPage, packagePage } from '../views/packages.js';

const safeNext = (n) => (typeof n === 'string' && /^\/[a-z]{2}\/[^/]/.test(n) && !n.startsWith('//') ? n : '');

export function packagesRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ip = (req) => req.ip ?? 'ip';

  // dati personali: mai in cache del browser o di proxy
  r.use(['/b2b/package', '/b2b/packages', '/packages'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const toLogin = (req, res) => res.redirect(`/${req.lang}/b2b/login?next=${encodeURIComponent(req.originalUrl)}`);
  /** Serve un account approvato (come per il resto dell'area agenzie). */
  const needPartner = (req, res, next) => {
    if (!req.acct) return toLogin(req, res);
    if (req.acct.status !== 'approved') return res.redirect(303, `/${req.lang}/b2b/account`);
    next();
  };

  const errorText = (t, e) => {
    if (e.code === 'full') return t('pkg.err.full', { n: MAX_PACKAGE_LINES });
    if (e.code === 'option') return t(`option.err.${['tooClose', 'limit'].includes(e.message) ? e.message : 'disabled'}`);
    if (e.code === 'language') return t('pkg.err.language');
    if (e.code === 'payment') return t('err.payment');
    return t(['unavailable', 'theme', 'overlap', 'duplicate', 'invalid'].includes(e.code) ? `pkg.err.${e.code}` : 'err.fields');
  };

  // ───── il pacchetto in preparazione ─────
  r.get('/b2b/package', needPartner, (req, res) => {
    send(res, packageCartPage(res.locals.ctx, { acct: req.acct, summary: cartSummary(app, req.acct), flash: String(req.query.flash ?? '') }));
  });

  // «Aggiungi al pacchetto» dal riepilogo prima di prenotare (stessi campi del modulo di prenotazione)
  r.post('/b2b/package/add', needPartner, form, (req, res) => {
    const ctx = res.locals.ctx;
    if (!app.limits.booking(ip(req))) return tooMany(res);
    try {
      cartAdd(app, req.acct, req.body);
    } catch (e) {
      if (!(e instanceof PackageError)) throw e;
      return send(res, packageCartPage(ctx, { acct: req.acct, summary: cartSummary(app, req.acct), error: errorText(ctx.t, e) }), e.code === 'unavailable' ? 409 : 400);
    }
    res.redirect(303, `/${req.lang}/b2b/package?flash=added`);
  });

  r.post('/b2b/package/remove/:id', needPartner, form, (req, res) => {
    cartRemove(db, req.acct.id, req.params.id);
    res.redirect(303, `/${req.lang}/b2b/package?flash=removed`);
  });

  // prenota (o opziona) tutti i servizi insieme
  r.post('/b2b/package', needPartner, form, async (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    const b = req.body;
    if (!app.limits.booking(ip(req))) return tooMany(res);
    const values = { name: cleanText(b.name, 120), email: cleanText(b.email, 200).toLowerCase(), phone: cleanText(b.phone, 40), lang: LANGS.includes(String(b.lang)) ? String(b.lang) : req.lang, clientRef: cleanText(b.clientRef, 120), notes: cleanText(b.notes, 1000), paymentMethod: String(b.paymentMethod ?? '') };
    const summary = cartSummary(app, req.acct);
    if (!summary.lines.length) return res.redirect(303, `/${req.lang}/b2b/package`);
    const rerender = (error, status = 400) => send(res, packageCartPage(ctx, { acct: req.acct, summary: cartSummary(app, req.acct), values, error }), status);
    if (!b.consent) return rerender(t('err.consent'));
    if (values.name.length < 2 || !isEmail(values.email)) return rerender(t('err.fields'));
    if (!summary.allOk) return rerender(t('pkg.err.stale'), 409);
    const wantsOption = b.action === 'option';
    const methods = paymentOptions(app, summary.lines[0].p.tour, 'b2b', req.acct);
    const method = methods.includes(values.paymentMethod) ? values.paymentMethod : methods[0];
    if (!wantsOption && !method) return rerender(t('err.payment'));
    try {
      const { redirect } = await app.packages.book(req.acct, summary.lines.map((l) => l.p), { ...values, option: wantsOption, paymentMethod: wantsOption ? undefined : method }, req.lang);
      cartClear(db, req.acct.id);
      res.redirect(303, redirect);
    } catch (e) {
      if (!(e instanceof PackageError)) throw e;
      rerender(errorText(t, e), e.code === 'unavailable' || e.code === 'language' ? 409 : 400);
    }
  });

  // ───── il pacchetto prenotato ─────
  /** Il pacchetto indicato nell'URL, con il codice segreto del link. */
  const byToken = (req) => {
    const g = getPackageByRef(db, req.params.ref);
    const token = String(req.query.t ?? req.body?.t ?? '');
    return g && token && safeEqual(token, g.token) ? g : null;
  };
  /** Il pacchetto di questa agenzia (per chi è entrato nell'area riservata). */
  const own = (req) => {
    const g = getPackageByRef(db, req.params.ref);
    return g && g.account_id === req.acct.id ? g : null;
  };
  const isOwner = (req, g) => !!req.acct && req.acct.status === 'approved' && g.account_id === req.acct.id;

  const showPage = (req, res, g, owner) => send(res, packagePage(res.locals.ctx, g, packageBookings(db, g.id), { flash: String(req.query.flash ?? ''), owner }));

  r.get('/b2b/packages/:ref', needPartner, async (req, res, next) => {
    let g = own(req);
    if (!g) return next();
    if (req.query.paid) {
      await app.payables.sync(g.ref); // tornata da Stripe prima del webhook
      g = own(req);
    }
    showPage(req, res, g, true);
  });
  r.get('/packages/:ref', async (req, res, next) => {
    let g = byToken(req);
    if (!g) return next();
    if (req.query.paid) {
      await app.payables.sync(g.ref);
      g = byToken(req);
    }
    showPage(req, res, g, isOwner(req, g));
  });
  r.get('/packages/:ref/calendar.ics', (req, res, next) => {
    const g = byToken(req);
    if (!g) return next();
    const bookings = packageBookings(db, g.id);
    if (!bookings.some((b) => b.status === 'confirmed')) return next();
    res.type('text/calendar; charset=utf-8').set('Content-Disposition', `attachment; filename="${g.ref}.ics"`).send(icsForPackage(app, g, bookings, normLang(req.lang)));
  });

  const back = (req, g, flash) => {
    const next = safeNext(req.body?.next);
    return next ? `${next}${next.includes('?') ? '&' : '?'}flash=${flash}` : `/${req.lang}/packages/${g.ref}?t=${g.token}&flash=${flash}`;
  };
  const optionLines = (g) => packageBookings(db, g.id).filter((b) => b.status === 'option');

  r.post('/packages/:ref/confirm', form, async (req, res, next) => {
    const g = byToken(req);
    if (!g) return next();
    if (!optionLines(g).length) {
      const bookings = packageBookings(db, g.id);
      if (bookings.some((b) => b.status === 'held')) return res.redirect(303, `/pay/resume/${g.ref}?t=${g.token}&lang=${req.lang}`); // sta già pagando con la carta
      return res.redirect(303, back(req, g, bookings.some((b) => b.status === 'confirmed') ? 'confirmed' : 'error')); // secondo clic: è già confermato
    }
    const result = await app.packages.confirm(g.id, req.lang, { method: String(req.body.method ?? '') });
    if (result.redirect) return res.redirect(303, result.redirect);
    res.redirect(303, back(req, g, { confirmed: 'confirmed', expired: 'expired' }[result.outcome] ?? 'error'));
  });
  r.post('/packages/:ref/release', form, async (req, res, next) => {
    const g = byToken(req);
    if (!g) return next();
    if (!optionLines(g).length) return res.redirect(303, back(req, g, 'released')); // secondo clic: è già rilasciato
    await app.packages.release(g.id, { by: 'customer' });
    res.redirect(303, back(req, g, 'released'));
  });
  r.post('/packages/:ref/cancel', form, async (req, res, next) => {
    const g = byToken(req);
    if (!g) return next();
    const { cancelled, kept } = await app.packages.cancel(g.id, { by: 'customer' });
    res.redirect(303, back(req, g, !cancelled ? 'cancel-error' : kept ? 'cancelPartial' : 'cancelled'));
  });

  return r;
}
