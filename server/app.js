import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createConfig, ROOT } from './config.js';
import { createContentStore } from './contentStore.js';
import { MEDIA_NAME, MIME_BY_EXT } from './media.js';
import { openDb } from './db.js';
import { createContext } from './context.js';
import { LANGS } from './i18n.js';
import { openTo } from './rates.js';
import { langMiddleware, makeCtx, preferredLang, sameOrigin, securityHeaders, send, sessionMiddleware } from './http.js';
import { brandIcon } from './png.js';
import { partnerRouter } from './routes/partner.js';
import { publicRouter } from './routes/public.js';
import { featuresRouter } from './routes/features.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';
import { page } from './views/layout.js';
import { html } from './html.js';

/** Quanto può durare l'invio di una richiesta: serve al caricamento di una copia di sicurezza da una linea lenta (il limite predefinito di Node è 5 minuti). */
export const REQUEST_TIMEOUT_MS = 30 * 60_000;

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
  const content = overrides.content ?? createContentStore({ db, root: ROOT });
  const app = createContext({ cfg, db, content, mail: overrides.mail, payments: overrides.payments, pec: overrides.pec, fetchImpl: overrides.fetchImpl, assetVersion: assetVersion() });

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
  // immagini caricate dal pannello: il nome è l'impronta del contenuto, quindi si possono tenere in cache per sempre
  server.get('/media/:name', (req, res, next) => {
    const name = String(req.params.name);
    if (!MEDIA_NAME.test(name) || !fs.existsSync(app.media.file(name))) return next();
    res.type(MIME_BY_EXT[name.split('.').pop()]).set({ 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).sendFile(app.media.file(name));
  });
  // logo quadrato per i pass del wallet (Google lo scarica da qui): disegnato dal codice, nessun file binario nel repository
  server.get('/wallet/logo.png', (req, res) => res.type('png').set('Cache-Control', 'public, max-age=86400').send(brandIcon(192)));
  server.get('/robots.txt', (req, res) =>
    res.type('text/plain').send(app.payments.demo ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /pay/\nDisallow: /*/booking/\nDisallow: /*/book/checkout\nSitemap: ${cfg.baseUrl}/sitemap.xml\n`),
  );
  server.get('/sitemap.xml', (req, res) => {
    const all = ['/', '/tours', '/book', '/gift', '/programs', '/b2b', '/blog', '/about', '/contact', '/privacy', '/terms', '/cookies', ...content.tours.filter((x) => openTo(app.rates.get(), x, 'b2c')).map((x) => `/tours/${x.slug}`), '/hourly'].map((p) => ({ p, langs: LANGS }));
    // un articolo compare solo nelle lingue in cui è tradotto
    const posts = content.posts.map((post) => ({ p: `/blog/${post.slug}`, langs: LANGS.filter((l) => post.i18n[l]) }));
    const url = (lang, p) => `${cfg.baseUrl}/${lang}${p === '/' ? '/' : p}`;
    const body = [...all, ...posts]
      .flatMap(({ p, langs }) => langs.map((l) => `<url><loc>${url(l, p)}</loc>${langs.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${url(a, p)}"/>`).join('')}</url>`))
      .join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`);
  });

  server.use(apiRouter(app));
  server.use('/admin', adminRouter(app));
  const pub = publicRouter(app);
  const partner = partnerRouter(app);
  const features = featuresRouter(app);
  for (const lang of LANGS) server.use(`/${lang}`, langMiddleware(app, lang), pub, partner, features);

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
