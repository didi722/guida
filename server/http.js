import { clearCookie, parseCookies, rateLimiter, setCookie, signToken, verifyToken } from './auth.js';
import { isLang, makeT } from './i18n.js';

export const send = (res, view, status = 200) => res.status(status).type('html').send(String(view));

const WEEK = 7 * 24 * 3600;

export const limits = {
  booking: rateLimiter({ windowMs: 10 * 60_000, max: 12 }),
  contact: rateLimiter({ windowMs: 60 * 60_000, max: 6 }),
  login: rateLimiter({ windowMs: 10 * 60_000, max: 10 }),
  register: rateLimiter({ windowMs: 60 * 60_000, max: 6 }),
  api: rateLimiter({ windowMs: 60_000, max: 150 }),
};

export function tooMany(res) {
  return res.status(429).type('text/plain').send('Too many requests / Troppe richieste. Riprova tra poco.');
}

/** Carica sessione B2B e admin dai cookie. */
export function sessionMiddleware(app) {
  const { cfg, db } = app;
  return (req, res, next) => {
    const c = parseCookies(req.headers.cookie);
    const gs = verifyToken(cfg.sessionSecret, c.gs);
    req.acct = null;
    if (gs?.k === 'b2b') req.acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(gs.id) ?? null;
    const ga = verifyToken(cfg.sessionSecret, c.ga);
    req.isAdmin = ga?.k === 'admin';
    next();
  };
}

export const loginPartner = (res, cfg, id) => setCookie(res, cfg, 'gs', signToken(cfg.sessionSecret, { k: 'b2b', id, exp: Date.now() + WEEK * 1000 }), { maxAgeSec: WEEK });
export const logoutPartner = (res, cfg) => clearCookie(res, cfg, 'gs');
export const loginAdmin = (res, cfg) => setCookie(res, cfg, 'ga', signToken(cfg.sessionSecret, { k: 'admin', exp: Date.now() + WEEK * 1000 }), { maxAgeSec: WEEK });
export const logoutAdmin = (res, cfg) => clearCookie(res, cfg, 'ga');

/** Contesto di rendering per le pagine pubbliche. */
export function makeCtx(app, req, lang) {
  return { app, req, lang, t: makeT(lang), u: (p) => `/${lang}${p}`, acct: req.acct, scripts: '' };
}

export function langMiddleware(app, lang) {
  return (req, res, next) => {
    req.lang = lang;
    res.locals.ctx = makeCtx(app, req, lang);
    next();
  };
}

export function preferredLang(req) {
  const h = String(req.get('accept-language') ?? '');
  for (const part of h.split(',')) {
    const l = part.trim().slice(0, 2).toLowerCase();
    if (isLang(l)) return l;
  }
  return 'en';
}

/** Blocca POST provenienti da altri siti (oltre al SameSite=Lax sui cookie). */
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).type('text/plain').send('Forbidden');
    } catch {
      return res.status(403).type('text/plain').send('Forbidden');
    }
  } else if (site && !['same-origin', 'none'].includes(site)) {
    return res.status(403).type('text/plain').send('Forbidden');
  }
  next();
}

export function securityHeaders(app) {
  const { cfg } = app;
  let umami = '';
  try {
    if (cfg.analytics.umamiId) umami = new URL(cfg.analytics.umamiSrc).origin;
  } catch {
    /* ignore */
  }
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${umami}`.trim(),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${umami}`.trim(),
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self)',
      ...(cfg.baseUrl.startsWith('https://') ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
    });
    next();
  };
}

export const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};
