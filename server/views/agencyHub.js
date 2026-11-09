// Area agenzie › La tua agenzia: team, logo e documenti, dati di fatturazione, in un posto solo (ogni voce porta alla sua pagina).
import { html } from '../html.js';
import { billingGaps } from '../billing.js';
import { gapWords } from './billing.js';
import { breadcrumbs, homeCrumb, whoOf } from './components.js';
import { page } from './layout.js';

/** team: quanti collaboratori ha l'agenzia. Team e dati di fatturazione sono del titolare; il logo e i documenti di tutti. */
export function agencyHubPage(ctx, { acct, team = 0 }) {
  const { t, lang, u } = ctx;
  const owner = whoOf(ctx).owner;
  const gaps = owner ? billingGaps(acct) : [];
  const card = (href, title, text, extra = '') => html`<article class="card pad home-card"><h2>${title}</h2><p>${text}</p>${extra}<a class="btn btn-outline" href="${href}">${t('partner.act.open')}</a></article>`;
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('home.agency')]])}
  <div class="account-head"><div><h1>${t('home.agency')}</h1><p class="lead">${t('agency.lead')}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap">
  <div class="home-actions">
    ${owner ? card(u('/b2b/billing'), t('billing.title'), t('agency.billing.text'), gaps.length ? html`<p class="notice notice-info" role="note">${t('billing.missing', { list: gapWords(t, acct) })}</p>` : html`<p class="small muted">${t('agency.billing.ok')}</p>`) : ''}
    ${owner ? card(u('/b2b/team'), t('team.title'), t('agency.team.text'), html`<p class="small muted">${t('agency.team.count', { n: team })}</p>`) : ''}
    ${card(u('/b2b/documents'), t('docs.title'), t('agency.docs.text'))}
  </div>
</div></section>`;
  return page(ctx, { title: t('home.agency'), path: `/${lang}/b2b/agency`, body, noindex: true, activeNav: 'b2b-account', area: 'partner' });
}
