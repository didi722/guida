// Pannello › Sito › Periodi: intervalli di date del servizio con regole particolari (opzioni più brevi o spente, preavviso).
import { html, raw } from '../html.js';
import { nowRome } from '../time.js';
import { MODES, MODE_LABEL, rulesText, showRange, spanDays } from '../periods.js';
import { tierInputOf } from '../policy.js';
import { adminLayout } from './admin.js';
import { presetButtons, tierRowsHtml } from './policyRows.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const HOURS = (n) => plural(n, 'ora', 'ore');

/** Com'è il sito senza periodi: serve a confrontare ciò che si sta scrivendo. */
function siteRules(cfg) {
  const { options, policy } = cfg;
  const tiers = options.tiers.map((t) => `fra almeno ${plural(t.fromDays, 'giorno', 'giorni')}: opzione di ${plural(t.days, 'giorno', 'giorni')}`);
  return html`<ul class="plain info-list">
    <li><strong>Opzioni</strong>: ${options.enabled ? html`${tiers.length ? tiers.join(' · ') : 'nessuna riga'}; scadono sempre almeno ${HOURS(options.minReleaseHours)} prima del servizio` : 'spente per tutto il sito'}</li>
    <li><strong>Preavviso minimo</strong>: privati ${HOURS(policy.b2cMinNoticeHours)}, agenzie ${HOURS(policy.b2bMinNoticeHours)}</li>
    <li><strong>Annullo gratuito</strong>: privati fino a ${HOURS(policy.b2cFreeCancelHours)} prima (alcuni tour hanno un termine loro), agenzie fino a ${HOURS(policy.b2bFreeCancelHours)} prima (salvo le condizioni proprie di un partner)</li>
  </ul>`;
}

/** I valori da mettere nel modulo: quelli appena scritti (se c'è un errore) o quelli del periodo. */
const valuesOf = (p) => ({
  name: p?.name ?? '',
  from: p?.from ?? '',
  to: p?.to ?? '',
  mode: p?.optionsMode ?? 'normal',
  maxDays: p?.optionMaxDays ?? '',
  releaseHours: p?.optionReleaseHours ?? '',
  noticeB2c: p?.noticeB2cHours ?? '',
  noticeB2b: p?.noticeB2bHours ?? '',
  cancelB2c: tierInputOf(p?.cancelB2c),
  cancelB2b: tierInputOf(p?.cancelB2b),
  cancelPartners: !!p?.cancelPartners,
});

function periodForm(cfg, { action, values, errors = {}, submit, extra = '' }) {
  const v = values;
  const err = (k) => (errors[k] ? html`<span class="field-error" role="alert">${errors[k]}</span>` : '');
  return html`<form method="post" action="${action}" class="form period-form">
  <label class="field"><span class="label">Nome <em>(lo vedi tu e, nelle loro condizioni, le agenzie)</em></span><input name="name" maxlength="60" required value="${v.name}" placeholder="Carnevale, Alta stagione, Natale…" autocomplete="off">${err('name')}</label>
  <div class="form-grid">
    <label class="field"><span class="label">Dal <em>(primo giorno del servizio)</em></span><input type="date" name="from" required value="${v.from}">${err('from')}</label>
    <label class="field"><span class="label">Al <em>(ultimo giorno)</em></span><input type="date" name="to" required value="${v.to}">${err('to')}</label>
  </div>
  <fieldset class="field period-options">
    <legend class="label">Opzioni delle agenzie, per i servizi di questo periodo</legend>
    ${MODES.map((m) => html`<label class="check"><input type="radio" name="mode" value="${m}" ${v.mode === m ? raw('checked') : ''}> <span><strong>${MODE_LABEL[m]}</strong> <small class="muted">${{ normal: 'valgono le regole del sito', short: 'durano meno: scrivi sotto di quanto', off: 'le agenzie prenotano direttamente, senza trattenere la data' }[m]}</small></span></label>`)}
    ${err('mode')}
    <div class="form-grid period-short">
      <label class="field"><span class="label">Durata massima <em>(solo per «Più brevi»)</em></span><span class="input-unit"><input name="maxDays" inputmode="numeric" value="${v.maxDays}" placeholder="es. 3" autocomplete="off"><span class="unit">giorni</span></span>${err('maxDays')}</label>
      <label class="field"><span class="label">Scade almeno <em>(prima del servizio)</em></span><span class="input-unit"><input name="releaseHours" inputmode="numeric" value="${v.releaseHours}" placeholder="es. 72" autocomplete="off"><span class="unit">ore</span></span><small class="muted">il sito, di base, lascia ${HOURS(cfg.options.minReleaseHours)}: qui vale il maggiore dei due</small>${err('releaseHours')}</label>
    </div>
  </fieldset>
  <fieldset class="field period-notice">
    <legend class="label">Preavviso minimo per prenotare, per i servizi di questo periodo <em>(vuoto = come il sito)</em></legend>
    <div class="form-grid">
      <label class="field"><span class="label">Privati</span><span class="input-unit"><input name="noticeB2c" inputmode="numeric" value="${v.noticeB2c}" placeholder="${cfg.policy.b2cMinNoticeHours}" autocomplete="off"><span class="unit">ore</span></span>${err('noticeB2c')}</label>
      <label class="field"><span class="label">Agenzie</span><span class="input-unit"><input name="noticeB2b" inputmode="numeric" value="${v.noticeB2b}" placeholder="${cfg.policy.b2bMinNoticeHours}" autocomplete="off"><span class="unit">ore</span></span>${err('noticeB2b')}</label>
    </div>
  </fieldset>
  <fieldset class="field period-cancel">
    <legend class="label">Condizioni di annullo, per i servizi di questo periodo <em>(righe vuote = come il solito)</em></legend>
    <p class="small muted">Come sempre: più ci si avvicina al servizio, meno si rimborsa; dopo l’ultimo scaglione non si rimborsa nulla. Chi paga a fattura riceve una penale pari alla parte non rimborsata.</p>
    <h3>Privati</h3>
    ${tierRowsHtml(v.cancelB2c, 'c_')}
    <p class="small muted">Modelli: ${presetButtons('c_', 'Svuota (come il sito)')}</p>
    ${err('cancelB2c')}
    <h3>Agenzie</h3>
    ${tierRowsHtml(v.cancelB2b, 'a_')}
    <p class="small muted">Modelli: ${presetButtons('a_', 'Svuota (come il sito)')}</p>
    ${err('cancelB2b')}
    <label class="check"><input type="checkbox" name="cancelPartners" value="1" ${v.cancelPartners ? raw('checked') : ''}> <span>Valgono anche per le agenzie che hanno condizioni di annullo proprie <small class="muted">(di solito le tengono, anche in questo periodo)</small></span></label>
    <small class="muted">Le condizioni valgono per le prenotazioni <strong>nuove</strong> dei servizi di queste date: quelle già fatte e chi sposta la data mantengono le condizioni accettate.</small>
  </fieldset>
  <div class="btn-row"><button class="btn btn-gold" type="submit">${submit}</button>${extra}</div>
</form>`;
}

function periodRow(p, today) {
  const past = p.to < today;
  const now = p.from <= today && today <= p.to;
  return html`<tr class="${past ? 'is-past' : ''}"><td><strong>${p.name}</strong> ${now ? html`<span class="chip chip-ok">In corso</span>` : ''}<br><small class="muted">${showRange(p)} · ${plural(spanDays(p.from, p.to), 'giorno', 'giorni')}</small></td>
    <td>${rulesText(p) || html`<span class="muted">nessuna regola</span>`}</td>
    <td class="actions"><a class="btn btn-sm btn-outline" href="/admin/periods/${p.id}">Modifica</a></td></tr>`;
}

export function periodsPage(ctx, { periods, values = null, errors = {}, flash = '', error = '' }) {
  const { cfg } = ctx.app;
  const today = nowRome().date;
  const upcoming = periods.filter((p) => p.to >= today);
  const past = periods.filter((p) => p.to < today).reverse();
  const table = (list) => html`<div class="card table-wrap"><table class="table"><thead><tr><th>Periodo</th><th>Cosa cambia</th><th></th></tr></thead><tbody>${list.map((p) => periodRow(p, today))}</tbody></table></div>`;
  const body = html`
<p class="muted">Un <strong>periodo</strong> è un intervallo di date del <strong>servizio</strong> (non del giorno in cui si prenota) con regole diverse dal solito: per esempio in alta stagione le opzioni delle agenzie durano meno, o non ci sono, serve più preavviso, o l’annullo gratuito dura meno. Fuori dai periodi valgono le regole di <a href="/admin/settings?s=options#options">Impostazioni</a>. Un giorno può stare in un solo periodo.</p>
<div class="card pad"><h2>Le regole di base del sito</h2>${siteRules(cfg)}</div>
${upcoming.length ? html`<h2 class="h-sub">Periodi in corso e in arrivo <span class="chip">${upcoming.length}</span></h2>${table(upcoming)}` : html`<div class="card pad muted">Nessun periodo: oggi ovunque valgono le regole del sito.</div>`}
<div class="card pad" id="nuovo">
  <h2>Nuovo periodo</h2>
  ${periodForm(cfg, { action: '/admin/periods', values: values ?? valuesOf(null), errors, submit: 'Aggiungi il periodo' })}
</div>
${past.length ? html`<details class="spaced"><summary>Periodi passati (${past.length})</summary>${table(past)}</details>` : ''}
<p class="muted small">Le opzioni e le prenotazioni già fatte non cambiano: le regole valgono per le prenotazioni nuove e per chi sposta la data. Le <strong>durate fisse</strong> concordate con un partner valgono fuori dai periodi; dentro, il limite del periodo vale per tutti.</p>`;
  return adminLayout(ctx, { title: 'Periodi', active: '/admin/periods', body, flash, error, scripts: `<script src="/js/admin-partner.js?v=${ctx.app.assetVersion}" defer></script>` });
}

export function periodEditPage(ctx, { period, values = null, errors = {}, flash = '', error = '' }) {
  const { cfg } = ctx.app;
  const body = html`
<p class="muted"><a href="/admin/periods">← Tutti i periodi</a></p>
<div class="card pad">
  <h2>${period.name} <small class="muted">${showRange(period)}</small></h2>
  ${periodForm(cfg, {
    action: `/admin/periods/${period.id}`,
    values: values ?? valuesOf(period),
    errors,
    submit: 'Salva le modifiche',
    extra: html` <button class="btn btn-link-danger" type="submit" form="delete-period">Elimina il periodo</button>`,
  })}
  <form id="delete-period" method="post" action="/admin/periods/${period.id}/delete" data-confirm="Eliminare il periodo «${period.name}»? Per quelle date tornano le regole del sito."></form>
</div>
<div class="card pad"><h2>Le regole di base del sito</h2>${siteRules(cfg)}</div>`;
  return adminLayout(ctx, { title: 'Modifica periodo', active: '/admin/periods', body, flash, error, scripts: `<script src="/js/admin-partner.js?v=${ctx.app.assetVersion}" defer></script>` });
}
