// Area agenzie › Team: il titolare invita e toglie i collaboratori. E la pagina in cui un collaboratore sceglie la sua password.
import { html } from '../html.js';
import { LANGS, LANG_META } from '../langs.js';
import { MAX_MEMBERS } from '../team.js';
import { fmtDate, nowRome } from '../time.js';
import { breadcrumbs, homeCrumb } from './components.js';
import { page } from './layout.js';

/** active: ha scelto la password · invited: invito aperto · expired: invito scaduto (si rinvia). */
export const memberState = (m, nowMs = Date.now()) => (m.activated_at ? 'active' : Date.parse(m.token_expires_at) <= nowMs ? 'expired' : 'invited');
const CHIP = { active: 'chip-ok', invited: 'chip-warn', expired: 'chip-err' };

/**
 * @param {object} o
 * @param {object} o.acct l'agenzia (il titolare è chi ha registrato l'account)
 * @param {object[]} o.members i collaboratori (righe di account_users)
 * @param {object} [o.values] ciò che si era scritto nel modulo (se c'è un errore)
 */
export function teamPage(ctx, { acct, members, values = {}, flash = '', error = '' }) {
  const { t, lang, u, app } = ctx;
  const nowMs = Date.now();
  const day = (iso) => fmtDate(nowRome(Date.parse(iso)).date, lang, 'short');
  const v = (k, d = '') => values[k] ?? d;
  const full = members.length >= MAX_MEMBERS;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('team.title')]])}
  <h1>${t('team.title')}</h1><p class="lead">${t('team.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  <div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr><th>${t('f.name')}</th><th>${t('b2b.state')}</th><th><span class="sr-only">${t('partner.col.actions')}</span></th></tr></thead><tbody>
    <tr><td data-label="${t('f.name')}"><strong>${acct.contact_name}</strong> <span class="chip">${t('team.owner')}</span><small class="muted">${acct.email}</small></td>
      <td data-label="${t('b2b.state')}"><span class="chip chip-ok">${t('team.status.active')}</span></td><td class="pb-actions"></td></tr>
    ${members.map((m) => {
      const state = memberState(m, nowMs);
      return html`<tr><td data-label="${t('f.name')}"><strong>${m.name}</strong> <span class="chip">${t('team.member')}</span><small class="muted">${m.email}</small></td>
        <td data-label="${t('b2b.state')}">${state === 'active'
          ? html`<span class="chip ${CHIP[state]}">${t('team.status.active')}</span><small class="muted">${m.last_login_at ? t('team.lastLogin', { date: day(m.last_login_at) }) : t('team.neverLogin')}</small>`
          : html`<span class="chip ${CHIP[state]}">${t(`team.status.${state}`)}</span><small class="muted">${t(`team.status.${state}Note`)}</small>`}</td>
        <td class="pb-actions"><div class="pb-actions-in">
          ${state === 'active' ? '' : html`<form method="post" action="${u(`/b2b/team/${m.id}/resend`)}"><button class="btn btn-outline btn-sm" type="submit">${t('team.resend')}</button></form>`}
          <form method="post" action="${u(`/b2b/team/${m.id}/remove`)}" data-confirm="${t('team.removeAsk', { name: m.name })}"><button class="btn btn-link-danger btn-sm" type="submit">${t('team.remove')}</button></form>
        </div></td></tr>`;
    })}
  </tbody></table></div>
  ${members.length ? '' : html`<p class="muted spaced">${t('team.empty')}</p>`}
  ${full
    ? html`<p class="muted spaced">${t('team.err.limit', { n: MAX_MEMBERS })}</p>`
    : html`<form class="card pad form spaced" method="post" action="${u('/b2b/team')}">
    <h2 class="h-sub">${t('team.add.title')}</h2>
    <div class="form-grid">
      <label class="field"><span class="label">${t('f.name')}</span><input name="name" required maxlength="120" autocomplete="off" value="${v('name')}"></label>
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="off" value="${v('email')}"><small class="muted">${t('team.add.emailNote')}</small></label>
    </div>
    <label class="field"><span class="label">${t('team.add.lang')}</span><select name="lang">${LANGS.map((l) => html`<option value="${l}" ${(v('lang') || lang) === l ? 'selected' : ''}>${LANG_META[l].name}</option>`)}</select></label>
    <div class="btn-row"><button class="btn btn-gold" type="submit">${t('team.add.submit')}</button></div>
  </form>`}
</div></section>`;
  return page(ctx, { title: t('team.title'), path: `/${lang}/b2b/team`, body, noindex: true, activeNav: 'b2b-account', area: 'partner' });
}

/** Il collaboratore invitato sceglie la password (il collegamento dell'email porta qui). */
export function joinPage(ctx, { token, user, account, error = '' }) {
  const { t, lang, u } = ctx;
  const body = html`
<section class="page-head"><div class="wrap narrow"><h1>${t('join.title')}</h1><p class="lead">${t('join.lead', { company: account.company })}</p></div></section>
<section class="section tight"><div class="wrap narrow"><div class="card pad">
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  <form method="post" action="${u(`/b2b/join/${token}`)}" class="form">
    <label class="field"><span class="label">${t('f.name')}</span><input value="${user.name}" readonly></label>
    <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" value="${user.email}" readonly autocomplete="username"></label>
    <label class="field"><span class="label">${t('b2b.reset.new')}</span><input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
    <label class="field"><span class="label">${t('b2b.reset.repeat')}</span><input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
    <input class="hp" type="text" name="website2" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-gold btn-block btn-lg" type="submit">${t('join.submit')}</button>
  </form>
</div></div></section>`;
  return page(ctx, { title: t('join.title'), path: `/${lang}/b2b/join/${token}`, body, noindex: true, activeNav: 'b2b' });
}

/** Un invito che non si può usare: non c'è (o è stato tolto), è scaduto oppure la password è già stata scelta. */
export function joinStatePage(ctx, { state }) {
  const { t, lang, u } = ctx;
  const key = state === 'used' ? 'used' : state === 'expired' ? 'expired' : 'invalid';
  const body = html`<section class="page-head"><div class="wrap narrow center"><div class="status ${key === 'used' ? 'status-ok' : 'status-warn'}"><span class="status-dot"></span><div><h1>${t(`join.${key}.title`)}</h1><p class="lead">${t(`join.${key}.text`)}</p></div></div>
    <p class="btn-row center">${key === 'used' ? html`<a class="btn btn-gold" href="${u('/b2b/login')}">${t('b2b.login')}</a>` : html`<a class="btn btn-gold" href="${u('/contact')}">${t('nav.contact')}</a>`}<a class="btn btn-outline" href="${u('/')}">${t('nav.home')}</a></p></div></section>`;
  return page(ctx, { title: t(`join.${key}.title`), path: `/${lang}/b2b/join`, body, noindex: true, activeNav: 'b2b' });
}
