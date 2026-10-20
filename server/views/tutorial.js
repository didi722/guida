// Il giro dell'area agenzie: la finestra che lo apre (public/js/tutorial.js; il giro vero è public/js/tour.js) e la pagina «Guida e FAQ» dove si rivede.
// Senza JavaScript non c'è il giro: restano il riquadro sulla prima pagina e la pagina «Guida e FAQ», con gli stessi passi scritti per intero.
import { html, raw } from '../html.js';
import { FAQ_GROUPS, TUTORIAL_STEPS } from '../tutorial.js';
import { breadcrumbs, homeCrumb } from './components.js';
import { page } from './layout.js';

const svg = (inner) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`);
const ICONS = {
  1: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>'),
  2: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>'),
  3: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
  4: svg('<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>'),
  5: svg('<path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8H18M8.5 12.5h7M8.5 16h5"/>'),
};

/**
 * La finestra che apre il giro: i cinque passi in breve e «Inizia il giro» (poi si clicca sul sito vero, vedi public/js/tour.js).
 * `auto`: si apre da sola (la prima volta); `mark`: se la si chiude senza iniziare (Salta, Esc) si ricorda che il giro è stato visto.
 */
export function tutorialDialog(ctx, { auto = false, mark = false } = {}) {
  const { t, acct } = ctx;
  return html`<dialog class="tutorial" id="tutorial" aria-labelledby="tut-title" ${auto ? raw('data-auto') : ''} ${mark ? raw('data-mark') : ''}>
  <div class="tut-card">
    <div class="tut-top"><p class="tut-title" id="tut-title">${t('tut.title')}</p><button class="tut-skip" type="button" data-tut-skip>${t('tut.skip')}</button></div>
    <h2 class="tut-welcome">${t('tut.1.title', { company: acct.company })}</h2>
    <p>${t('tut.intro')}</p>
    <ol class="tut-list">${TUTORIAL_STEPS.slice(1).map((n) => html`<li><span class="tut-icon">${ICONS[n]}</span><span>${t(`tut.${n}.title`)}</span></li>`)}</ol>
    <div class="tut-foot"><button class="btn btn-gold" type="button" autofocus data-tut-go>${t('tut.start')}</button></div>
  </div>
</dialog>`;
}

/** Il riquadro sulla prima pagina, per chi non ha ancora visto il giro (con JavaScript lo sostituisce la finestra, che si apre da sola). */
export function tutorialBanner(ctx) {
  const { t, u } = ctx;
  return html`<div class="notice notice-info tut-banner" role="note" data-tut-banner>
    <span>${t('tut.banner')}</span>
    <span class="tut-banner-actions"><a class="btn btn-gold btn-sm" href="${u('/b2b/help')}#giro" data-tour-start data-tour-mark>${t('tut.banner.start')}</a>
    <form method="post" action="${u('/b2b/tutorial/done')}"><button class="btn btn-outline btn-sm" type="submit">${t('tut.banner.skip')}</button></form></span>
  </div>`;
}

/** «Guida e FAQ»: i passi del giro scritti per intero (anche senza JavaScript), il pulsante per rivederlo e le domande frequenti. */
export function helpPage(ctx, { due = false }) {
  const { t, lang, u, app, acct } = ctx;
  const body = html`
<section class="page-head partner-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('partner.nav.help')]])}
  <div class="account-head"><div><p class="eyebrow">${acct.company}</p><h1>${t('help.title')}</h1><p class="lead">${t('help.lead', { email: app.cfg.site.email })}</p></div>
    <div class="btn-row"><button class="btn btn-outline btn-lg" type="button" data-tour-start ${due ? raw('data-tour-mark') : ''}>${t('tut.replay')}</button></div></div>
</div></section>
<section class="section tight" id="giro"><div class="wrap narrow">
  <h2 class="h-sub">${t('help.steps')}</h2>
  <ol class="help-steps">${TUTORIAL_STEPS.map((n) => html`<li><span class="tut-icon">${ICONS[n]}</span><div><h3>${t(`tut.${n}.title`, { company: acct.company })}</h3><p>${t(`tut.${n}.text`)}</p></div></li>`)}</ol>
  <h2 class="h-sub spaced" id="faq">${t('help.faq')}</h2>
  ${FAQ_GROUPS.map(([group, ids]) => html`<h3 class="faq-group">${t(group)}</h3>
    ${ids.map((n) => html`<details class="faq"><summary>${t(`faq.${n}.q`)}</summary><p>${t(`faq.${n}.a`)}</p></details>`)}`)}
</div></section>`;
  return page(ctx, { title: t('partner.nav.help'), path: `/${lang}/b2b/help`, body, noindex: true, activeNav: 'b2b-help', area: 'partner' });
}
