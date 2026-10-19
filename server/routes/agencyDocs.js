// Area agenzie: logo e documenti per il cliente finale (nome, logo, recapiti, ricarico) e preventivo PDF.
import express from 'express';
import { DocsError, MARKUP_MAX, getLogo, parseLogo, parseMarkup, parseRound, readProfile, removeLogo, saveProfile, setLogo } from '../agencyDocs.js';
import { getBookingByRef } from '../bookings.js';
import { send, sendPdf, tooMany } from '../http.js';
import { LANGS, normLang } from '../langs.js';
import { getPackageByRef, packageBookings } from '../packages.js';
import { renderQuotePdf } from '../pdf-quote.js';
import { isDate } from '../time.js';
import { cleanText } from '../util.js';
import { documentsPage } from '../views/agencyDocs.js';
import { needPartner } from './guards.js';

export function agencyDocsRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const json = express.json({ limit: '1mb' });
  const ip = (req) => req.ip ?? 'ip';

  r.use(['/b2b/documents', '/b2b/quote.pdf'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const show = (req, res, { profile = readProfile(req.acct), error = '', status = 200 } = {}) =>
    send(res, documentsPage(res.locals.ctx, { acct: req.acct, profile, hasLogo: !!getLogo(db, req.acct.id), flash: String(req.query.flash ?? ''), error }), status);

  r.get('/b2b/documents', needPartner, (req, res) => show(req, res));

  r.post('/b2b/documents', needPartner, form, (req, res) => {
    try {
      saveProfile(db, req.acct.id, req.body);
    } catch (e) {
      if (!(e instanceof DocsError)) throw e;
      const b = req.body ?? {};
      const typed = { name: cleanText(b.name, 80), contact: cleanText(b.contact, 160), footer: cleanText(b.footer, 400), markup: b.markup, round: parseRound(b.round) ?? 5, logoOnVoucher: !!b.logoOnVoucher };
      return show(req, res, { profile: typed, error: res.locals.ctx.t('docs.err.markup', { max: MARKUP_MAX }), status: 400 });
    }
    res.redirect(303, `/${req.lang}/b2b/documents?flash=saved`);
  });

  // il logo arriva dal browser già ridimensionato (PNG), come testo «data:image/png;base64,…»
  r.post('/b2b/documents/logo', needPartner, json, async (req, res) => {
    if (!app.limits.docs(ip(req))) return res.status(429).json({ ok: false, error: 'Too many requests' });
    try {
      setLogo(db, req.acct.id, await parseLogo(req.body?.logo));
    } catch (e) {
      if (!(e instanceof DocsError)) throw e;
      return res.status(400).json({ ok: false, error: res.locals.ctx.t('docs.logoFailed') });
    }
    res.json({ ok: true });
  });

  r.post('/b2b/documents/logo/remove', needPartner, form, (req, res) => {
    removeLogo(db, req.acct.id);
    res.redirect(303, `/${req.lang}/b2b/documents?flash=logoRemoved`);
  });

  r.get('/b2b/documents/logo', needPartner, (req, res, next) => {
    const logo = getLogo(db, req.acct.id);
    if (!logo) return next();
    res.status(200).set({ 'Content-Type': logo.mime, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(logo.data));
  });

  /** Preventivo PDF di una pratica (VE-…) o di un pacchetto (PT-…) dell'agenzia: prezzi per il suo cliente, con il suo ricarico. */
  r.get('/b2b/quote.pdf', needPartner, async (req, res, next) => {
    if (!app.limits.docs(ip(req))) return tooMany(res);
    const ref = String(req.query.ref ?? '');
    let bookings;
    if (ref.startsWith('PT-')) {
      const g = getPackageByRef(db, ref);
      if (!g || g.account_id !== req.acct.id) return next();
      bookings = packageBookings(db, g.id);
    } else {
      const b = getBookingByRef(db, ref);
      if (!b || b.account_id !== req.acct.id) return next();
      bookings = [b];
    }
    bookings = bookings.filter((b) => b.status === 'option' || b.status === 'confirmed');
    if (!bookings.length) return next();
    const profile = readProfile(req.acct);
    const lang = LANGS.includes(String(req.query.lang)) ? String(req.query.lang) : normLang(req.acct.lang);
    const pdf = await renderQuotePdf(app, {
      account: req.acct,
      bookings,
      markup: parseMarkup(req.query.markup) ?? profile.markup,
      round: parseRound(req.query.round) ?? profile.round,
      client: cleanText(req.query.client, 120),
      until: isDate(req.query.until) ? String(req.query.until) : '',
      note: cleanText(req.query.note, 800),
      lang,
    });
    sendPdf(res, pdf, `preventivo-${ref}.pdf`);
  });

  // errori del corpo JSON del logo (troppo grande, non valido): risposta leggibile da chi carica
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large' || err?.type === 'entity.parse.failed') return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ ok: false, error: res.locals.ctx?.t('docs.logoFailed') ?? 'Invalid' });
    next(err);
  });

  return r;
}
