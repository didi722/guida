// Modifica autonoma di persone, data e ore di una prenotazione, e richiesta di proroga di un'opzione.
import { html, raw } from '../html.js';
import { REQUEST_DAYS, changeRules, currentParams, hourChoices } from '../changes.js';
import { bookingPeople, partyParams, readPartyOr } from '../party.js';
import { parseServiceRecord } from '../rates.js';
import { fmtDate, fmtInstant, localToInstant } from '../time.js';
import { formatMoney } from '../util.js';
import { partyField } from './fields.js';
import { page } from './layout.js';
import { breadcrumbs, hoursLabel, homeCrumb } from './components.js';

/** Perché una prenotazione non si cambia da sola: la parola da mostrare (la chiave è `chg.locked.<motivo>`). */
const LOCKED = ['status', 'held', 'started', 'custom', 'card', 'paid', 'invoiced'];
export const lockedKey = (reason) => `chg.locked.${LOCKED.includes(reason) ? reason : 'status'}`;

const signed = (cents, lang, cur) => (cents === 0 ? '' : ` (${cents > 0 ? '+' : '−'}${formatMoney(Math.abs(cents), lang, cur)})`);

/**
 * La pagina «Cambia persone, data o ore».
 * form: i valori scelti ({adults, children, infants, date, hours, extra}); slots: gli orari del giorno scelto con il prezzo (vedi changeSlots);
 * rules: vedi changeRules; error: chiave del messaggio (chg.err.*).
 */
export function changePage(ctx, b, { rules, form, slots, error = '', errorReason = '' }) {
  const { t, lang, u, app } = ctx;
  const tour = app.content.tour(b.tour_slug);
  const ti = tour.i18n[lang];
  const cur = currentParams(app, b);
  const service = parseServiceRecord(b.service_json);
  const hc = hourChoices(app, b);
  const base = u(`/b2b/bookings/${b.ref}`);
  const money = (c) => formatMoney(c, lang, b.currency);
  const paxMax = tour.maxParticipants;
  const values = { party: readPartyOr(form, cur.party, { max: paxMax }), date: form.date ?? cur.date, hours: form.hours ?? cur.hours, extra: form.extra ?? cur.extra };
  const moveOk = rules.allowed && rules.mode === 'free';
  const ruleText = !rules.allowed ? '' : rules.mode === 'free' ? (b.status === 'option' ? t('chg.rule.option') : t('chg.rule.free', { until: fmtInstant(rules.until, lang) })) : t('chg.rule.increase');

  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('partner.nav.bookings'), u('/b2b/bookings')], [b.ref, base], [t('chg.title')]])}
  <h1>${t('chg.title')}</h1><p class="lead">${ti.title} · ${b.ref}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${error ? html`<div class="notice notice-err" role="alert">${t(`chg.err.${error === 'option' && errorReason === 'period' ? 'optionPeriod' : error}`, { reason: errorReason })}</div>` : ''}
  <div class="card pad">
    <h2>${t('chg.now')}</h2>
    <dl class="summary-list">
      <div><dt>${t('s.date')}</dt><dd>${fmtDate(b.date, lang)}</dd></div>
      <div><dt>${t('s.time')}</dt><dd>${b.start_time}–${b.end_time}${service ? html` <span class="muted">(${hoursLabel(t, lang, service.hours)})</span>` : ''}</dd></div>
      <div><dt>${t('s.guests')}</dt><dd>${bookingPeople(b, lang)}</dd></div>
      <div class="summary-total"><dt>${t('s.total')}</dt><dd>${money(b.total_cents)}</dd></div>
    </dl>
    ${rules.allowed ? html`<p class="policy-box ${rules.mode === 'free' ? 'ok' : 'warn'}">${ruleText}</p>` : html`<p class="policy-box warn">${t(lockedKey(rules.reason))}</p>`}
  </div>
  ${rules.allowed
    ? html`
  <form class="card pad form spaced" method="get" action="${base}/change" id="change-form">
    <h2>${t('chg.what')}</h2>
    <div class="form-grid">
      ${partyField(ctx, { party: values.party, max: paxMax, priced: tour.model === 'person' && tour.pricing !== 'hourly', label: t('s.guests'), autosubmit: true, id: 'ch-party' })}
      ${moveOk ? html`<label class="field"><span class="label">${t('s.date')}</span><input type="date" name="date" value="${values.date}" min="${b.date < values.date ? b.date : values.date}" required data-autosubmit></label>` : html`<input type="hidden" name="date" value="${b.date}">`}
      ${hc.kind === 'hours' ? html`<label class="field"><span class="label">${t('hourly.f.hours')}</span><select name="hours" data-autosubmit>${hc.values.map((h) => html`<option value="${h}" ${h === Number(values.hours) ? raw('selected') : ''}>${hoursLabel(t, lang, h)}</option>`)}</select></label>` : ''}
      ${hc.kind === 'extra' && hc.values.length ? html`<label class="field"><span class="label">${t('hourly.f.extra')}</span><select name="extra" data-autosubmit>${hc.values.map((h) => html`<option value="${h}" ${h === Number(values.extra) ? raw('selected') : ''}>${h === 0 ? t('hourly.extra.none') : `+ ${hoursLabel(t, lang, h)}`}</option>`)}</select></label>` : ''}
    </div>
    <noscript><button class="btn btn-outline" type="submit">${t('chg.show')}</button></noscript>
  </form>
  ${slots.length
    ? html`<form class="card pad form spaced" method="post" action="${base}/change" data-confirm="${t('chg.confirmAsk')}">
    ${Object.entries(partyParams(values.party)).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}<input type="hidden" name="date" value="${moveOk ? values.date : b.date}">
    ${hc.kind === 'hours' ? html`<input type="hidden" name="hours" value="${values.hours}">` : ''}${hc.kind === 'extra' ? html`<input type="hidden" name="extra" value="${values.extra}">` : ''}
    <h2>${t('chg.pickTime')}</h2>
    <label class="field"><span class="label">${t('s.time')}</span><select name="time">${slots.map((s) => html`<option value="${s.time}" ${s.current ? raw('selected') : ''}>${s.time}–${s.end} · ${money(s.totalCents)}${signed(s.deltaCents, lang, b.currency)}${s.current ? ` · ${t('chg.current')}` : ''}${s.percent != null && s.percent < 100 && b.status === 'confirmed' ? ` · ${t('chg.notFree', { percent: s.percent })}` : ''}</option>`)}</select></label>
    <button class="btn btn-gold" type="submit">${t('chg.confirm')}</button>
  </form>`
    : html`<div class="card pad spaced"><p class="muted">${t('chg.noSlots')}</p></div>`}`
    : html`<p class="small muted">${t('booking.contactForChanges')} <a href="mailto:${app.cfg.site.email}">${app.cfg.site.email}</a>${app.cfg.site.whatsapp ? html` · <a href="https://wa.me/${app.cfg.site.whatsapp}">WhatsApp</a>` : ''}</p>`}
</div></section>`;
  return page(ctx, { title: t('chg.title'), path: `/${lang}/b2b/bookings/${b.ref}/change`, body, noindex: true, area: 'partner', activeNav: 'b2b-bookings' });
}

/**
 * «Ti serve più tempo?»: il modulo per chiedere la proroga di un'opzione (o il messaggio che la richiesta è già partita).
 * action: dove si invia · hidden: il codice segreto (e il ritorno) · pending: la richiesta aperta, se c'è · untilMs: la scadenza di adesso
 */
export function extensionBox(ctx, { action, hidden, pending, untilMs }) {
  const { t, lang } = ctx;
  if (pending) return html`<p class="small ext-pending"><span class="chip chip-warn">${t('ext.pendingChip')}</span> ${t('ext.pending', { days: pending.days, until: fmtInstant(untilMs, lang) })}</p>`;
  return html`<details class="ext-box"><summary>${t('ext.title')}</summary>
    <form method="post" action="${action}" class="form">
      ${hidden}
      <p class="small muted">${t('ext.text')}</p>
      <div class="form-grid">
        <label class="field"><span class="label">${t('ext.days')}</span><select name="days">${REQUEST_DAYS.map((d) => html`<option value="${d}">${d}</option>`)}</select></label>
        <label class="field"><span class="label">${t('ext.note')}</span><input name="note" maxlength="500" autocomplete="off"></label>
      </div>
      <button class="btn btn-outline" type="submit">${t('ext.btn')}</button>
    </form></details>`;
}

/** Nella scheda della prenotazione (area agenzia): il pulsante per cambiare persone, data od ore, o il perché non si può da soli. */
export function changeBox(ctx, b) {
  const { t, u, app } = ctx;
  if (!['option', 'confirmed'].includes(b.status) || localToInstant(b.date, b.start_time) <= Date.now()) return '';
  const rules = changeRules(app, b);
  if (!rules.allowed && rules.reason === 'channel') return '';
  return html`<div class="card pad edit-card change-card"><h2>${t('chg.boxTitle')}</h2>
    ${rules.allowed
      ? html`<p class="small muted">${rules.mode === 'free' ? t('chg.boxFree') : t('chg.boxIncrease')}</p><p class="btn-row"><a class="btn btn-outline" href="${u(`/b2b/bookings/${b.ref}/change`)}">${t('chg.btn')}</a></p>`
      : html`<p class="small muted">${t(lockedKey(rules.reason))}</p>`}
  </div>`;
}
