// Area agenzie › Dati di fatturazione.
import { html } from '../html.js';
import { billingGaps } from '../billing.js';
import { breadcrumbs, homeCrumb } from './components.js';
import { billingFields } from './fields.js';
import { page } from './layout.js';

/** Le parole di ciò che manca nei dati di fatturazione, nella lingua della pagina («indirizzo, CAP e provincia»). */
export function gapWords(t, acct) {
  return billingGaps(acct).map((k) => t(`billing.gap.${k}`)).join(', ');
}

export function billingPage(ctx, { acct, flash = '', error = '' }) {
  const { t, lang, u } = ctx;
  const gaps = gapWords(t, acct);
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('billing.title')]])}
  <h1>${t('billing.title')}</h1><p class="lead">${t('billing.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${!error && !flash && gaps ? html`<div class="notice notice-info" role="note">${t('billing.missing', { list: gaps })}</div>` : ''}
  <form method="post" action="${u('/b2b/billing')}" class="card pad form">
    <dl class="summary-list">
      <div><dt>${t('b2b.reg.companyName')}</dt><dd>${acct.company}</dd></div>
      <div><dt>${t('b2b.reg.vat')}</dt><dd>${acct.vat ?? '—'}</dd></div>
    </dl>
    <p class="muted small form-note">${t('billing.fixed')}</p>
    ${billingFields(ctx, acct)}
    <button class="btn btn-gold btn-block btn-lg" type="submit">${t('billing.save')}</button>
  </form>
</div></section>`;
  return page(ctx, { title: t('billing.title'), path: `/${lang}/b2b/billing`, body, noindex: true, activeNav: 'b2b-account', area: 'partner', scripts: html`<script src="/js/b2b-register.js?v=${ctx.app.assetVersion}" defer></script>` });
}
