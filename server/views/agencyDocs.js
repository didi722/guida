// Area agenzie › Logo e documenti, e il riquadro «Documenti per il tuo cliente» nella scheda di una pratica o di un pacchetto.
import { html, raw } from '../html.js';
import { MARKUP_MAX, ROUNDS, getLogo, readProfile } from '../agencyDocs.js';
import { LANGS, LANG_META, normLang } from '../langs.js';
import { nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { breadcrumbs, homeCrumb } from './components.js';
import { page } from './layout.js';

const FLASH = new Set(['saved', 'logo', 'logoRemoved']);

/** La pagina del profilo dei documenti: logo, nome, recapiti, nota dei preventivi e ricarico predefinito. */
export function documentsPage(ctx, { acct, profile, hasLogo, flash = '', error = '' }) {
  const { t, lang, u, app } = ctx;
  const logo = hasLogo ? getLogo(app.db, acct.id) : null;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('docs.title')]])}
  <h1>${t('docs.title')}</h1><p class="lead">${t('docs.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${FLASH.has(flash) ? html`<div class="notice notice-ok" role="status">${t(`docs.flash.${flash}`)}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  <div class="card pad" data-logo-upload data-url="${u('/b2b/documents/logo')}" data-done="${u('/b2b/documents')}?flash=logo" data-working="${t('docs.logoWorking')}" data-error="${t('docs.logoFailed')}">
    <h2 class="h-sub">${t('docs.logo')}</h2>
    ${logo ? html`<p><img class="doc-logo" src="${u('/b2b/documents/logo')}?v=${Date.parse(logo.updated_at)}" alt="${acct.company}" width="${Math.min(logo.width, 220)}"></p>` : html`<p class="muted">${t('docs.logoNone')}</p>`}
    <p class="small muted">${t('docs.logoHint')}</p>
    <div class="btn-row">
      <label class="btn btn-outline" for="logo-file">${logo ? t('docs.logoChange') : t('docs.logoPick')}</label>
      <input id="logo-file" class="sr-only" type="file" accept="image/png,image/jpeg">
      ${logo ? html`<button class="btn btn-link-danger" type="submit" form="logo-remove">${t('docs.logoRemove')}</button>` : ''}
      <span class="small muted" data-logo-status role="status"></span>
    </div>
  </div>
  ${logo ? html`<form id="logo-remove" method="post" action="${u('/b2b/documents/logo/remove')}"></form>` : ''}
  <form class="card pad form spaced" method="post" action="${u('/b2b/documents')}">
    <label class="field"><span class="label">${t('docs.name')}</span><input name="name" maxlength="80" value="${profile.name}" placeholder="${acct.company}"><small class="muted">${t('docs.nameHint')}</small></label>
    <label class="field"><span class="label">${t('docs.contact')}</span><input name="contact" maxlength="160" value="${profile.contact}"><small class="muted">${t('docs.contactHint')}</small></label>
    <label class="field"><span class="label">${t('docs.footer')}</span><textarea name="footer" rows="3" maxlength="400">${profile.footer}</textarea><small class="muted">${t('docs.footerHint')}</small></label>
    <div class="form-grid">
      <label class="field"><span class="label">${t('docs.markup')}</span><input type="number" name="markup" min="0" max="${MARKUP_MAX}" step="0.5" value="${profile.markup}" inputmode="decimal"><small class="muted">${t('docs.markupHint')}</small></label>
      <label class="field"><span class="label">${t('docs.round')}</span><select name="round">${ROUNDS.map((r) => html`<option value="${r}" ${r === profile.round ? raw('selected') : ''}>${t(`docs.round.${r}`)}</option>`)}</select></label>
    </div>
    <label class="check"><input type="checkbox" name="logoOnVoucher" value="1" ${profile.logoOnVoucher ? raw('checked') : ''}> ${t('docs.logoOnVoucher')}</label>
    <div class="btn-row"><button class="btn btn-gold" type="submit">${t('docs.save')}</button></div>
  </form>
</div></section>`;
  return page(ctx, { title: t('docs.title'), path: `/${lang}/b2b/documents`, body, noindex: true, activeNav: 'b2b-account', area: 'partner', scripts: html`<script src="/js/agency-logo.js?v=${app.assetVersion}" defer></script>` });
}

/**
 * Il riquadro «Documenti per il tuo cliente»: il preventivo PDF (prezzi per il cliente, con il ricarico) e il rimando alle impostazioni.
 * @param {{ref: string, bookings: object[]}} o `ref`: codice della pratica (VE-…) o del pacchetto (PT-…); `bookings`: i servizi inclusi
 */
export function documentsBox(ctx, { ref, bookings }) {
  const { t, lang, u, app, acct } = ctx;
  const lines = bookings.filter((b) => b.status === 'option' || b.status === 'confirmed');
  if (!lines.length) return '';
  const profile = readProfile(acct);
  const hasLogo = !!getLogo(app.db, acct.id);
  const net = lines.reduce((s, b) => s + b.total_cents, 0);
  const expiries = lines.filter((b) => b.status === 'option' && b.option_expires_at).map((b) => Date.parse(b.option_expires_at));
  const until = expiries.length ? nowRome(Math.min(...expiries)).date : ''; // un'opzione tiene la data fino alla scadenza: è la validità naturale del preventivo
  const first = lines[0];
  return html`<div class="card pad docs-box" id="documenti">
  <h2>${t('docs.box.title')}</h2>
  <p class="small muted">${t('docs.box.lead')}</p>
  ${hasLogo ? '' : html`<p class="small muted">${t('docs.q.noLogo')} <a href="${u('/b2b/documents')}">${t('docs.q.settings')}</a></p>`}
  <form class="form" method="get" action="${u('/b2b/quote.pdf')}" target="_blank">
    <h3>${t('docs.q.title')}</h3>
    <input type="hidden" name="ref" value="${ref}">
    <p class="small">${t('docs.q.yourRate', { amount: formatMoney(net, lang, first.currency) })}</p>
    <div class="form-grid">
      <label class="field"><span class="label">${t('docs.q.client')}</span><input name="client" maxlength="120" value="${first.client_ref || first.name}"></label>
      <label class="field"><span class="label">${t('docs.q.markup')}</span><input type="number" name="markup" min="0" max="${MARKUP_MAX}" step="0.5" value="${profile.markup}" inputmode="decimal"></label>
      <label class="field"><span class="label">${t('docs.q.round')}</span><select name="round">${ROUNDS.map((r) => html`<option value="${r}" ${r === profile.round ? raw('selected') : ''}>${t(`docs.round.${r}`)}</option>`)}</select></label>
      <label class="field"><span class="label">${t('docs.q.until')}</span><input type="date" name="until" value="${until}"></label>
      <label class="field"><span class="label">${t('docs.q.lang')}</span><select name="lang">${LANGS.map((l) => html`<option value="${l}" ${l === normLang(acct.lang) ? raw('selected') : ''}>${LANG_META[l].name}</option>`)}</select></label>
    </div>
    <label class="field"><span class="label">${t('docs.q.note')}</span><textarea name="note" rows="2" maxlength="800"></textarea></label>
    <div class="btn-row"><button class="btn btn-gold" type="submit">${t('docs.q.download')}</button><a class="small" href="${u('/b2b/documents')}">${t('docs.q.settings')}</a></div>
  </form>
</div>`;
}
