import { esc, html, jsonLd, raw } from '../html.js';
import { LANGS, LANG_META } from '../langs.js';

const ICON = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  insta: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".8" fill="currentColor"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.5z"/><path d="M9 8.5c.3 2.6 2.4 5 5.5 6l1.3-1.3-2-1-1 .7c-.8-.4-1.5-1.1-1.9-1.9l.7-1-1-2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
};
export const icon = (name) => raw(ICON[name] ?? '');

/** Percorso dell'altra lingua per lo stesso contenuto. */
function swapLang(path, from, to) {
  return path.replace(new RegExp(`^/${from}(?=/|$)`), `/${to}`);
}

const NAV = [
  ['tours', 'nav.tours'],
  ['programs', 'nav.programs'],
  ['book', 'nav.book'],
  ['b2b', 'nav.b2b'],
  ['blog', 'nav.blog'],
  ['about', 'nav.about'],
];

export function page(ctx, { title, description = '', path, body, bodyClass = '', ld = null, noindex = false, article = false, ogImage = null, activeNav = '', scripts = '' }) {
  const { app, lang, t } = ctx;
  const { cfg } = app;
  const others = LANGS.filter((l) => l !== lang);
  const canonical = `${cfg.baseUrl}${path}`;
  const fullTitle = title ? `${title} · ${cfg.site.name}` : `${cfg.site.name} — ${t('site.title')}`;
  const desc = description || t('site.description');
  const u = (p) => `/${lang}${p}`;
  const umami = cfg.analytics.umamiId ? raw(`<script defer src="${esc(cfg.analytics.umamiSrc)}" data-website-id="${esc(cfg.analytics.umamiId)}"></script>`) : '';

  return html`<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${fullTitle}</title>
  <meta name="description" content="${desc}">
  ${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
  <meta name="theme-color" content="#d6bb51">
  <link rel="canonical" href="${canonical}">
  ${noindex ? '' : [...LANGS.map((l) => html`<link rel="alternate" hreflang="${l}" href="${cfg.baseUrl}${swapLang(path, lang, l)}">`), html`<link rel="alternate" hreflang="x-default" href="${cfg.baseUrl}${swapLang(path, lang, cfg.defaultLang)}">`]}
  <meta property="og:site_name" content="${cfg.site.name}">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="${article ? 'article' : 'website'}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:locale" content="${LANG_META[lang].og}">
  ${others.map((l) => html`<meta property="og:locale:alternate" content="${LANG_META[l].og}">`)}
  ${ogImage ? html`<meta property="og:image" content="${ogImage}">` : ''}
  <link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/josefin-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/style.css?v=${app.assetVersion}">
  <script src="/js/theme.js"></script>
  ${ld ? html`<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}
  ${umami}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">${t('a11y.skip')}</a>

<header class="site-header" id="site-header">
  <div class="header-inner">
    <a class="brand" href="${u('/')}" aria-label="${cfg.site.name} — ${t('nav.home')}">
      <span class="brand-name">${cfg.site.name}</span>
      <span class="brand-sub">${cfg.site.tagline[lang]}</span>
    </a>
    <nav class="main-nav" aria-label="${t('a11y.mainNav')}">
      ${NAV.filter(([k]) => k !== 'book').map(([k, label]) => html`<a href="${u('/' + k)}" ${activeNav === k ? raw('aria-current="page"') : ''}>${t(label)}</a>`)}
    </nav>
    <div class="header-tools">
      <a class="btn btn-sm btn-dark header-cta" href="${u('/book')}">${t('nav.book')}</a>
      <details class="lang-menu">
        <summary class="tool lang-switch" aria-label="${LANG_META[lang].name}" title="${LANG_META[lang].name}">${LANG_META[lang].short}</summary>
        <ul class="lang-list">${LANGS.map((l) => html`<li><a href="${swapLang(path, lang, l)}" hreflang="${l}" lang="${l}" ${l === lang ? raw('aria-current="true"') : ''}>${LANG_META[l].name}</a></li>`)}</ul>
      </details>
      <button class="tool theme-toggle" type="button" aria-label="${t('a11y.theme')}"><span class="i-sun">${icon('sun')}</span><span class="i-moon">${icon('moon')}</span></button>
      <button class="hamburger" type="button" aria-label="${t('a11y.menu')}" aria-expanded="false" aria-controls="side-menu"><span></span><span></span><span></span></button>
    </div>
  </div>
  ${article ? raw('<div class="progress" aria-hidden="true"><div class="progress-bar" id="progress-bar"></div></div>') : ''}
</header>

<nav class="side-menu" id="side-menu" aria-label="${t('a11y.menu')}" hidden>
  ${NAV.map(([k, label]) => html`<a href="${u('/' + k)}" ${activeNav === k ? raw('aria-current="page"') : ''}>${t(label)}</a>`)}
  <a href="${u('/gift')}" ${activeNav === 'gift' ? raw('aria-current="page"') : ''}>${t('nav.gift')}</a>
  <a href="${u('/contact')}">${t('nav.contact')}</a>
  <a class="side-sub" href="${ctx.acct ? u('/b2b/account') : u('/b2b/login')}">${ctx.acct ? t('nav.myAccount') : t('nav.partnerLogin')}</a>
  <div class="side-langs">${others.map((l) => html`<a class="side-sub" href="${swapLang(path, lang, l)}" hreflang="${l}" lang="${l}">${LANG_META[l].name}</a>`)}</div>
</nav>
<div class="scrim" id="scrim" hidden></div>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="footer-brand">${cfg.site.name}</p>
      <p class="muted">${cfg.site.tagline[lang]}</p>
      ${cfg.site.guideLicense ? html`<p class="muted small">${t('footer.license')}: ${cfg.site.guideLicense}</p>` : ''}
      ${cfg.site.vatNumber ? html`<p class="muted small">${cfg.site.legalName} · ${t('footer.vat')} ${cfg.site.vatNumber}${cfg.site.address ? html` · ${cfg.site.address}` : ''}</p>` : ''}
    </div>
    <div>
      <p class="footer-title">${t('footer.explore')}</p>
      <ul class="plain">
        <li><a href="${u('/tours')}">${t('nav.tours')}</a></li>
        <li><a href="${u('/programs')}">${t('nav.programs')}</a></li>
        <li><a href="${u('/book')}">${t('nav.book')}</a></li>
        <li><a href="${u('/b2b')}">${t('nav.b2b')}</a></li>
        <li><a href="${u('/gift')}">${t('nav.gift')}</a></li>
        <li><a href="${u('/blog')}">${t('nav.blog')}</a></li>
        <li><a href="${u('/about')}">${t('nav.about')}</a></li>
      </ul>
    </div>
    <div>
      <p class="footer-title">${t('footer.contact')}</p>
      <ul class="plain contact-list">
        <li><a href="mailto:${cfg.site.email}">${icon('mail')} ${cfg.site.email}</a></li>
        ${cfg.site.whatsapp ? html`<li><a href="https://wa.me/${cfg.site.whatsapp}" rel="noopener">${icon('whatsapp')} WhatsApp</a></li>` : ''}
        ${cfg.site.phone ? html`<li><a href="tel:${cfg.site.phone.replace(/\s+/g, '')}">${icon('phone')} ${cfg.site.phone}</a></li>` : ''}
        ${cfg.site.instagram ? html`<li><a href="${cfg.site.instagram}" rel="noopener" target="_blank">${icon('insta')} Instagram</a></li>` : ''}
      </ul>
    </div>
  </div>
  <div class="wrap footer-bottom">
    <span>&copy; ${new Date().getFullYear()} ${cfg.site.legalName}</span>
    <span class="footer-links"><a href="${u('/privacy')}">${t('footer.privacy')}</a> · <a href="${u('/terms')}">${t('footer.terms')}</a> · <a href="${u('/cookies')}">${t('footer.cookies')}</a></span>
  </div>
</footer>
<script src="/js/main.js?v=${app.assetVersion}" defer></script>
${scripts}
</body>
</html>`;
}
