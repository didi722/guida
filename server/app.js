import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createConfig, ROOT } from './config.js';
import { loadContent } from './content.js';
import { openDb } from './db.js';
import { createContext } from './context.js';
import { LANGS } from './i18n.js';
import { langMiddleware, makeCtx, preferredLang, sameOrigin, securityHeaders, send, sessionMiddleware } from './http.js';
import { publicRouter } from './routes/public.js';
import { featuresRouter } from './routes/features.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';
import { page } from './views/layout.js';
import { html } from './html.js';

/** Versione degli asset (ultima modifica di css e js): serve a far scaricare di nuovo i file cambiati. */
function assetVersion() {
  let v = 0;
  for (const dir of ['css', 'js']) {
    try {
      for (const f of fs.readdirSync(path.join(ROOT, 'public', dir))) v = Math.max(v, Math.floor(fs.statSync(path.join(ROOT, 'public', dir, f)).mtimeMs));
    } catch {
      /* cartella assente */
    }
  }
  return v.toString(36);
}

/** Crea l'applicazione. `overrides` serve ai test (cfg, content, mail, payments). */
export function createApp(overrides = {}) {
  const cfg = overrides.cfg ?? createConfig();
  const db = overrides.db ?? openDb(cfg.dbFile);
  const content = overrides.content ?? loadContent(ROOT);
  const app = createContext({ cfg, db, content, mail: overrides.mail, payments: overrides.payments, fetchImpl: overrides.fetchImpl, assetVersion: assetVersion() });

  const server = express();
  server.disable('x-powered-by');
  server.set('trust proxy', cfg.trustProxy);
  server.use(securityHeaders(app));

  const day = 24 * 3600 * 1000;
  // Font Josefin Sans serviti dal pacchetto npm (nessun file binario nel repository, nessuna richiesta a Google)
  server.use('/fonts', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'josefin-sans', 'files'), { maxAge: '365d', immutable: true }));
  server.use(express.static(path.join(ROOT, 'public'), { maxAge: cfg.isProd ? 7 * day : 0 }));

  server.use(sameOrigin);
  server.use(sessionMiddleware(app));

  server.get('/', (req, res) => res.redirect(302, `/${preferredLang(req)}/`));
  server.get('/robots.txt', (req, res) =>
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /pay/\nDisallow: /*/booking/\nDisallow: /*/book/checkout\nSitemap: ${cfg.baseUrl}/sitemap.xml\n`),
  );
  server.get('/sitemap.xml', (req, res) => {
    const paths = ['/', '/tours', '/book', '/gift', '/programs', '/b2b', '/blog', '/about', '/contact', '/privacy', '/terms', '/cookies', ...content.tours.map((x) => `/tours/${x.slug}`), ...content.postsFor('it').map((p) => `/blog/${p.slug}`)];
    const url = (lang, p) => `${cfg.baseUrl}/${lang}${p === '/' ? '/' : p}`;
    const body = paths
      .flatMap((p) => LANGS.map((l) => `<url><loc>${url(l, p)}</loc>${LANGS.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${url(a, p)}"/>`).join('')}</url>`))
      .join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`);
  });

  server.use(apiRouter(app));
  server.use('/admin', adminRouter(app));
  const pub = publicRouter(app);
  const features = featuresRouter(app);
  for (const lang of LANGS) server.use(`/${lang}`, langMiddleware(app, lang), pub, features);

  // 404 (nella lingua dell'URL se possibile)
  server.use((req, res) => {
    const lang = LANGS.includes(req.path.split('/')[1]) ? req.path.split('/')[1] : preferredLang(req);
    const ctx = makeCtx(app, req, lang);
    const body = html`<section class="page-head"><div class="wrap narrow center"><p class="eyebrow">404</p><h1>${ctx.t('err.404.title')}</h1><p class="lead">${ctx.t('err.404.text')}</p><p class="btn-row center"><a class="btn btn-gold" href="/${lang}/">${ctx.t('nav.home')}</a> <a class="btn btn-outline" href="/${lang}/tours">${ctx.t('nav.tours')}</a></p></div></section>`;
    send(res, page(ctx, { title: '404', path: req.path, body, noindex: true }), 404);
  });

  // eslint-disable-next-line no-unused-vars
  server.use((err, req, res, next) => {
    console.error('[errore]', err);
    if (res.headersSent) return;
    res.status(500).type('text/plain').send('Errore interno / Internal error');
  });

  // libera gli slot dei pagamenti non completati
  const timer = setInterval(() => app.runJobs(), 60_000);
  timer.unref();
  app.close = () => clearInterval(timer);
  return { app, server };
}
