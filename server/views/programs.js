import { html, raw } from '../html.js';
import { BUDGETS, GROUP_TYPES, INTERESTS, programDays, proposalExpired } from '../programs.js';
import { fmtDate } from '../time.js';
import { formatMoney } from '../util.js';
import { page } from './layout.js';
import { phoneField } from './fields.js';
import { breadcrumbs, whoOf } from './components.js';

export function programsPage(ctx, { values = {}, error = '' } = {}) {
  const { t, lang, acct } = ctx;
  const isB2b = acct?.status === 'approved';
  const who = whoOf(ctx) ?? {};
  const v = (k, d = '') => values[k] ?? d;
  const picked = new Set([].concat(values.interests ?? []));
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('pg.title')]])}
  <h1>${t('pg.title')}</h1><p class="lead">${t('pg.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap">
  <h2 class="h-sub">${t('pg.ideas.title')}</h2>
  <div class="grid grid-2 ideas">${[1, 2, 3, 4].map((n) => html`<div class="benefit"><h3>${t(`pg.idea.${n}.t`)}</h3><p>${t(`pg.idea.${n}.p`)}</p></div>`)}</div>
</div></section>
<section class="section section-alt"><div class="wrap narrow">
  <h2>${t('pg.form.title')}</h2><p class="lead">${t('pg.form.lead')}</p>
  <form class="card pad form" method="post" action="/${lang}/programs">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <div class="form-grid">
      <label class="field"><span class="label">${t('f.name')}</span><input name="name" required maxlength="120" autocomplete="name" value="${v('name', isB2b ? who.name : '')}"></label>
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="email" value="${v('email', isB2b ? who.email : '')}"></label>
      ${phoneField(ctx, { value: v('phone', isB2b ? (acct.phone ?? '') : ''), cc: v('phone_cc'), defaultCc: isB2b ? acct.country : '', label: html`${t('f.phone')} <em>${t('f.optional')}</em>` })}
      ${isB2b
        ? html`<label class="field"><span class="label">${t('pg.f.company')}</span><input name="company" maxlength="160" value="${v('company', acct.company)}"></label>
        <label class="field"><span class="label">${t('f.clientRef')} <em>${t('f.optional')}</em></span><input name="clientRef" maxlength="120" value="${v('clientRef')}"></label>`
        : ''}
    </div>
    <h3>${t('pg.f.when')}</h3>
    <div class="form-grid">
      <label class="field"><span class="label">${t('pg.f.from')}</span><input type="date" name="dateFrom" value="${v('dateFrom')}"></label>
      <label class="field"><span class="label">${t('pg.f.to')}</span><input type="date" name="dateTo" value="${v('dateTo')}"></label>
    </div>
    <label class="check"><input type="checkbox" name="flexibleDates" value="1" ${values.flexibleDates ? raw('checked') : ''}> ${t('pg.f.flexible')}</label>
    <div class="form-grid">
      <label class="field"><span class="label">${t('pg.f.participants')}</span><select name="participants" required>${Array.from({ length: 80 }, (_, n) => n + 1).map((n) => html`<option value="${n}" ${String(n) === String(v('participants', '2')) ? raw('selected') : ''}>${n}</option>`)}</select></label>
      <label class="field"><span class="label">${t('pg.f.group')}</span><select name="groupType"><option value="">—</option>${GROUP_TYPES.map((g) => html`<option value="${g}" ${(values.groupType ?? (isB2b ? 'agency' : '')) === g ? raw('selected') : ''}>${t(`pg.group.${g}`)}</option>`)}</select></label>
    </div>
    <fieldset class="check-grid"><legend class="label">${t('pg.f.interests')}</legend>
      ${INTERESTS.map((k) => html`<label class="check"><input type="checkbox" name="interests" value="${k}" ${picked.has(k) ? raw('checked') : ''}> ${t(`pg.int.${k}`)}</label>`)}
    </fieldset>
    <div class="form-grid">
      <label class="field"><span class="label">${t('pg.f.accommodation')} <em>${t('f.optional')}</em></span><input name="accommodation" maxlength="200" value="${v('accommodation')}"></label>
      <label class="field"><span class="label">${t('pg.f.budget')} <em>${t('f.optional')}</em></span><select name="budget"><option value="">—</option>${BUDGETS.map((b) => html`<option value="${b}" ${values.budget === b ? raw('selected') : ''}>${t(`pg.budget.${b}`)}</option>`)}</select></label>
      <label class="field"><span class="label">${t('pg.f.languages')} <em>${t('f.optional')}</em></span><input name="languages" maxlength="120" value="${v('languages')}"></label>
      <label class="field"><span class="label">${t('pg.f.mobility')} <em>${t('f.optional')}</em></span><input name="mobility" maxlength="300" value="${v('mobility')}"></label>
    </div>
    <label class="field"><span class="label">${t('pg.f.message')} <em>${t('f.optional')}</em></span><textarea name="message" rows="5" maxlength="3000" placeholder="${t('pg.f.messageHint')}">${v('message')}</textarea></label>
    <label class="check consent"><input type="checkbox" name="consent" value="1" required> <span>${t('f.consent')} <a href="/${lang}/terms" target="_blank">${t('footer.terms')}</a> · <a href="/${lang}/privacy" target="_blank">${t('footer.privacy')}</a></span></label>
    <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-gold btn-block btn-lg" type="submit">${t('pg.send')}</button>
  </form>
</div></section>`;
  return page(ctx, { title: t('pg.title'), description: t('pg.lead'), path: `/${lang}/programs`, body, activeNav: 'programs' });
}

export function programStatusPage(ctx, p, { flash = '', error = '' } = {}) {
  const { t, lang, app } = ctx;
  const { db } = app;
  const q = `?t=${p.token}`;
  const base = `/${lang}/programs/${p.ref}`;
  const days = programDays(db, p.id);
  const expired = p.status === 'quoted' && proposalExpired(p);
  const tone = { new: 'wait', quoted: 'ok', accepted: 'wait', confirmed: 'ok', declined: 'err', closed: 'err' }[p.status];
  const interests = p.interests ? JSON.parse(p.interests) : [];
  const online = app.payments.live || app.payments.demo;
  const showProposal = ['quoted', 'accepted', 'confirmed'].includes(p.status) && days.length;
  const balance = (p.total_cents ?? 0) - p.deposit_cents;

  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  <div class="status status-${tone}"><span class="status-dot" aria-hidden="true"></span><div><h1>${t(`pg.status.${p.status}`)}</h1><p class="lead">${t(`pg.status.${p.status}.text`)}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad">
    <p class="ref-line"><span class="muted">${t('pg.ref')}</span> <strong class="ref">${p.ref}</strong></p>
    <h2>${t('pg.request')}</h2>
    <dl class="summary-list">
      <div><dt>${t('pg.dates')}</dt><dd>${p.date_from ? `${fmtDate(p.date_from, lang, 'short')}${p.date_to ? ' → ' + fmtDate(p.date_to, lang, 'short') : ''}` : t('pg.datesTbd')}${p.flexible_dates ? ` (${t('pg.datesFlexible')})` : ''}</dd></div>
      <div><dt>${t('s.guests')}</dt><dd>${p.participants}${p.group_type ? ` · ${t(`pg.group.${p.group_type}`)}` : ''}</dd></div>
      ${interests.length ? html`<div><dt>${t('pg.f.interests')}</dt><dd>${interests.map((k) => t(`pg.int.${k}`)).join(', ')}</dd></div>` : ''}
      ${p.message ? html`<div><dt>${t('pg.f.message')}</dt><dd>${p.message}</dd></div>` : ''}
    </dl>
  </div>

  ${showProposal
    ? html`<div class="card pad spaced-card">
    <h2>${p.proposal_title ?? t('pg.proposal')}</h2>
    ${p.proposal_intro ? html`<p>${p.proposal_intro}</p>` : ''}
    <h3>${t('pg.days')}</h3>
    <div class="itinerary">${days.map((d) => html`<div class="itin-day"><div class="itin-when"><strong>${fmtDate(d.date, lang, 'weekday')}</strong><small>${d.start_time}–${d.end_time}</small></div><div class="itin-what"><strong>${d.title}</strong>${d.description ? html`<p>${d.description}</p>` : ''}</div><div class="itin-price">${d.price_cents ? formatMoney(d.price_cents, lang, p.currency) : ''}</div></div>`)}</div>
    <dl class="summary-list">
      <div class="summary-total"><dt>${t('pg.total')}</dt><dd>${formatMoney(p.total_cents, lang, p.currency)}</dd></div>
      ${p.deposit_cents ? html`<div><dt>${t('pg.deposit', { percent: p.deposit_percent })}</dt><dd>${formatMoney(p.deposit_cents, lang, p.currency)}${p.deposit_status === 'paid' ? html` <span class="chip chip-ok">${t('pg.depositPaid')}</span>` : ''}</dd></div><div><dt>${t('pg.balance')}</dt><dd>${formatMoney(balance, lang, p.currency)}</dd></div>` : ''}
    </dl>
    ${p.proposal_notes ? html`<div class="info-box"><h3>${t('pg.notes')}</h3><p class="pre">${p.proposal_notes}</p></div>` : ''}
    ${p.status === 'quoted' ? html`<p class="${expired ? 'field-error' : 'muted'}">${expired ? t('pg.expired') : t('pg.validUntil', { date: fmtDate(p.valid_until, lang, 'date') })}</p>` : ''}
    <p class="btn-row"><a class="btn btn-outline btn-sm" href="${base}/proposal.pdf${q}">${t('pg.download')}</a></p>

    ${p.status === 'quoted' && !expired
      ? html`<div class="btn-row">
      <form method="post" action="${base}/accept" data-confirm="${t('pg.acceptConfirm')}"><input type="hidden" name="t" value="${p.token}"><button class="btn btn-gold btn-lg" type="submit">${t('pg.accept')}</button></form>
      <form method="post" action="${base}/decline" data-confirm="${t('pg.declineConfirm')}"><input type="hidden" name="t" value="${p.token}"><button class="btn btn-link-danger" type="submit">${t('pg.decline')}</button></form>
    </div>`
      : ''}
    ${p.status === 'accepted' && p.deposit_status === 'pending'
      ? online
        ? html`<p class="btn-row"><a class="btn btn-gold btn-lg" href="/pay/resume/${p.ref}${q}&lang=${lang}">${t('pg.payDeposit')} · ${formatMoney(p.deposit_cents, lang, p.currency)}</a></p>`
        : html`<p class="muted">${t('pg.depositManual')}</p>`
      : ''}
  </div>`
    : ''}

  ${['new', 'quoted'].includes(p.status)
    ? html`<div class="card pad spaced-card"><h2>${t('pg.changes')}</h2><p class="muted">${t('pg.changesHint')}</p>
    <form method="post" action="${base}/message" class="form"><input type="hidden" name="t" value="${p.token}"><label class="field"><textarea name="message" rows="3" maxlength="2000" required></textarea></label><button class="btn btn-outline" type="submit">${t('pg.sendMessage')}</button></form></div>`
    : ''}
</div></section>`;
  return page(ctx, { title: `${t('pg.ref')} ${p.ref}`, path: `/${lang}/programs/${p.ref}`, body, noindex: true, activeNav: 'programs' });
}

