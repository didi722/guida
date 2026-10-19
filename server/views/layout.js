import { esc, html, jsonLd, raw } from '../html.js';
import { LANGS, LANG_META } from '../langs.js';
import { cartCount } from '../packages.js';
import { mediaUrl } from './components.js';

const ICON = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  insta: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".8" fill="currentColor"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.5z"/><path d="M9 8.5c.3 2.6 2.4 5 5.5 6l1.3-1.3-2-1-1 .7c-.8-.4-1.5-1.1-1.9-1.9l.7-1-1-2z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M16 13h2.5"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9"/><path d="M16 8l4 4-4 4M20 12H9"/></svg>',
  package: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/></svg>',
};
export const icon = (name) => raw(ICON[name] ?? '');

/** Percorso dell'altra lingua per lo stesso contenuto. */
/** Le bandiere dei moduli sono disegni di Twemoji (CC BY 4.0): la licenza chiede di citarli. */
const flagsCredit = (t) => html`<span class="footer-credit">${t('footer.flags')} <a href="https://twemoji.twitter.com" rel="noopener">Twemoji</a> · <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a></span>`;

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

/** La barra dell'area agenzie: poche voci, tutte per lavorare (niente blog, tour, programmi). «Nuova prenotazione» è il pulsante in evidenza. */
const PARTNER_NAV = [
  ['b2b-account', '/b2b/account', 'partner.nav.home'],
  ['b2b-bookings', '/b2b/bookings', 'partner.nav.bookings'],
  ['b2b-rates', '/b2b/rates', 'partner.nav.rates'],
  ['b2b-invoices', '/b2b/invoices', 'partner.nav.invoices'],
];

export function page(ctx, { title, description = '', path, body, bodyClass = '', ld = null, noindex = false, article = false, ogImage = null, activeNav = '', scripts = '', area = '' }) {
  const { app, lang, t } = ctx;
  const partner = area === 'partner' && ctx.acct?.status === 'approved'; // barra e piè di pagina dell'area agenzie
  const cart = partner ? cartCount(app.db, ctx.acct.id, ctx.actor?.userId ?? null) : 0; // servizi nel pacchetto in preparazione: la voce compare solo se ce ne sono
  const { cfg } = app;
  const demo = app.payments.demo; // istanza di prova (pagamenti simulati): non si indicizza e lo si dice a chiare lettere
  noindex = noindex || demo;
  const others = LANGS.filter((l) => l !== lang);
  const canonical = `${cfg.baseUrl}${path}`;
  // anteprima quando si condivide il link: la copertina della pagina, altrimenti l'immagine «Anteprima social» (o la foto della home)
  const shareImage = ogImage ?? mediaUrl(cfg, app.siteImages?.get('og') ?? app.siteImages?.get('home'));
  const fullTitle = title ? `${title} · ${cfg.site.name}` : `${cfg.site.name} — ${t('site.title')}`;
  const desc = description || t('site.description');
  const u = (p) => `/${lang}${p}`;
  // «Login agenzie» sempre visibile in alto, accanto a Prenota (su telefono resta come icona); chi ha già fatto il login vede «Area agenzia»
  const agencyLabel = ctx.acct ? t('nav.agencyArea') : t('nav.agencyLogin');
  // «Esci»: un modulo POST (non un link, così nessuna anteprima o prefetch può farti uscire) che riporta alla pagina pubblica
  const logoutForm = (cls, inner) => html`<form class="logout-form" method="post" action="${u('/b2b/logout')}"><button class="${cls}" type="submit">${inner}</button></form>`;
  const agencyLink = html`<a class="tool header-login" href="${ctx.acct ? u('/b2b/account') : u('/b2b/login')}" aria-label="${agencyLabel}" title="${agencyLabel}" ${activeNav === 'b2b-account' ? raw('aria-current="page"') : ''}><span class="login-icon">${icon('user')}</span><span class="login-label">${agencyLabel}</span></a>`;
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
  ${shareImage ? html`<meta property="og:image" content="${shareImage}"><meta name="twitter:card" content="summary_large_image">` : ''}
  <link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
  <link rel="preload" href="/fonts/josefin-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/style.css?v=${app.assetVersion}">
  <script src="/js/theme.js"></script>
  ${ld ? html`<script type="application/ld+json">${jsonLd(ld)}</script>` : ''}
  ${umami}
</head>
<body class="${[bodyClass, partner ? 'partner-area' : ''].filter(Boolean).join(' ')}">
<a class="skip" href="#main">${t('a11y.skip')}</a>

<header class="site-header" id="site-header">
  <div class="header-inner">
    <a class="brand" href="${partner ? u('/b2b/account') : u('/')}" aria-label="${cfg.site.name} — ${partner ? t('nav.agencyArea') : t('nav.home')}">
      <span class="brand-name">${cfg.site.name}</span>
      <span class="brand-sub">${partner ? t('nav.agencyArea') : cfg.site.tagline[lang]}</span>
    </a>
    <nav class="main-nav" aria-label="${t('a11y.mainNav')}">
      ${partner
        ? PARTNER_NAV.map(([k, p, label]) => html`<a href="${u(p)}" ${activeNav === k ? raw('aria-current="page"') : ''}>${t(label)}</a>`)
        : NAV.filter(([k]) => k !== 'book').map(([k, label]) => html`<a href="${u('/' + k)}" ${activeNav === k ? raw('aria-current="page"') : ''}>${t(label)}</a>`)}
    </nav>
    <div class="header-tools">
      ${cart ? html`<a class="tool header-cart" href="${u('/b2b/package')}" aria-label="${t('pkg.nav', { n: cart })}" title="${t('pkg.nav', { n: cart })}" ${activeNav === 'b2b-package' ? raw('aria-current="page"') : ''}><span class="cart-icon">${icon('package')}</span><span class="cart-count">${cart}</span></a>` : ''}
      <a class="btn btn-sm btn-dark header-cta" href="${u(partner ? '/book' : '/tours')}">${partner ? t('partner.nav.new') : t('nav.book')}</a>
      ${partner ? logoutForm('tool header-login header-logout', html`<span class="login-icon">${icon('logout')}</span><span class="login-label">${t('b2b.logout')}</span>`) : agencyLink}
      <details class="lang-menu">
        <summary class="tool lang-switch" aria-label="${LANG_META[lang].name}" title="${LANG_META[lang].name}">${LANG_META[lang].short}</summary>
        <ul class="lang-list">${LANGS.map((l) => html`<li><a href="${swapLang(path, lang, l)}" hreflang="${l}" lang="${l}" ${l === lang ? raw('aria-current="true"') : ''}>${LANG_META[l].name}</a></li>`)}</ul>
      </details>
      <button class="tool theme-toggle" type="button" aria-label="${t('a11y.theme')}"><span class="i-sun">${icon('sun')}</span><span class="i-moon">${icon('moon')}</span></button>
      <button class="hamburger" type="button" aria-label="${t('a11y.menu')}" aria-expanded="false" aria-controls="side-menu"><span></span><span></span><span></span>${cart ? html`<b class="menu-badge" aria-hidden="true">${cart}</b>` : ''}</button>
    </div>
  </div>
  ${article ? raw('<div class="progress" aria-hidden="true"><div class="progress-bar" id="progress-bar"></div></div>') : ''}
  ${demo ? html`<div class="demo-note" role="note">${t('demo.siteBanner')}</div>` : ''}
</header>

<nav class="side-menu" id="side-menu" aria-label="${t('a11y.menu')}" hidden>
  <a class="side-agency" href="${ctx.acct ? u('/b2b/account') : u('/b2b/login')}">${icon('user')}<span>${agencyLabel}</span></a>
  ${partner
    ? html`${PARTNER_NAV.map(([k, p, label]) => html`<a href="${u(p)}" ${activeNav === k ? raw('aria-current="page"') : ''}>${t(label)}</a>`)}
  ${cart ? html`<a href="${u('/b2b/package')}" ${activeNav === 'b2b-package' ? raw('aria-current="page"') : ''}>${t('pkg.nav', { n: cart })}</a>` : ''}
  <a href="${u('/book')}" ${activeNav === 'book' ? raw('aria-current="page"') : ''}>${t('partner.nav.new')}</a>
  <a href="${u('/b2b/availability')}">${t('avail.nav')}</a>
  <a href="${u('/b2b/documents')}">${t('docs.title')}</a>`
    : html`${NAV.map(([k, label]) => html`<a href="${u('/' + k)}" ${activeNav === k ? raw('aria-current="page"') : ''}>${t(label)}</a>`)}
  <a href="${u('/gift')}" ${activeNav === 'gift' ? raw('aria-current="page"') : ''}>${t('nav.gift')}</a>
  <a href="${u('/contact')}">${t('nav.contact')}</a>`}
  <div class="side-langs">${others.map((l) => html`<a class="side-sub" href="${swapLang(path, lang, l)}" hreflang="${l}" lang="${l}">${LANG_META[l].name}</a>`)}</div>
  ${ctx.acct ? logoutForm('side-logout', html`${icon('logout')}<span>${t('b2b.logout')}</span>`) : ''}
</nav>
<div class="scrim" id="scrim" hidden></div>

<main id="main">
${body}
</main>

${partner
  ? html`<footer class="site-footer partner-footer">
  <div class="wrap footer-bottom">
    <span>&copy; ${new Date().getFullYear()} ${cfg.site.legalName}</span>
    <ul class="plain partner-contact">
      <li><a href="mailto:${cfg.site.email}">${icon('mail')} ${cfg.site.email}</a></li>
      ${cfg.site.whatsapp ? html`<li><a href="https://wa.me/${cfg.site.whatsapp}" rel="noopener">${icon('whatsapp')} WhatsApp</a></li>` : ''}
      ${cfg.site.phone ? html`<li><a href="tel:${cfg.site.phone.replace(/\s+/g, '')}">${icon('phone')} ${cfg.site.phone}</a></li>` : ''}
    </ul>
    <span class="footer-links"><a href="${u('/b2b/help')}" ${activeNav === 'b2b-help' ? raw('aria-current="page"') : ''}>${t('partner.nav.help')}</a> · <a href="${u('/privacy')}">${t('footer.privacy')}</a> · <a href="${u('/terms')}">${t('footer.terms')}</a></span>
    ${flagsCredit(t)}
  </div>
</footer>`
  : html`<footer class="site-footer">
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
        <li><a href="${u('/tours')}">${t('nav.book')}</a></li>
        <li><a href="${u('/b2b')}">${t('nav.b2b')}</a></li>
        <li><a href="${u('/gift')}">${t('nav.gift')}</a></li>
        <li><a href="${u('/blog')}">${t('nav.blog')}</a></li>
        <li><a href="${u('/about')}">${t('nav.about')}</a></li>
        <li><a href="${u('/contact')}">${t('nav.contact')}</a></li>
        <li><a href="${ctx.acct ? u('/b2b/account') : u('/b2b/login')}">${agencyLabel}</a></li>
        ${ctx.acct ? html`<li>${logoutForm('linklike', t('b2b.logout'))}</li>` : ''}
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
    ${flagsCredit(t)}
  </div>
</footer>`}
<script src="/js/main.js?v=${app.assetVersion}" defer></script>
<script src="/js/datepicker.js?v=${app.assetVersion}" defer></script>
<script src="/js/combo.js?v=${app.assetVersion}" defer></script>
<script src="/js/party.js?v=${app.assetVersion}" defer></script>
<script src="/js/keep-scroll.js?v=${app.assetVersion}" ${partner ? raw('data-links') : ''} defer></script>
${scripts}
</body>
</html>`;
}
