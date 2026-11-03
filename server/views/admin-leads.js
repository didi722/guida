// Pannello › Commerciale: la coda di lavoro («Oggi»), l'elenco dei contatti, la scheda di un contatto con referenti, registro, appuntamenti e collegamento al profilo B2B.
import { html, raw } from '../html.js';
import { countryName } from '../countries.js';
import { LANG_META } from '../langs.js';
import { ACTIVITY_LABEL, APPT_LABEL, KIND_LABEL, MANUAL_ACTIVITIES, PRIORITY_LABEL, SORT_LABEL, STATUS_LABEL, STATUSES, waDigits } from '../leads.js';
import { TEMPLATE_LABEL } from '../leadMail.js';
import { addDays, fmtDate, nowRome } from '../time.js';
import { adminLayout } from './admin.js';
import { countryField, phoneField, ADMIN_CTX } from './fields.js';

// ───────────── pezzi comuni ─────────────
const day = (d) => (d ? fmtDate(d, 'it', 'short') : '');
const when = (iso) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const diffDays = (to, from) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** Quanto manca a un richiamo, in parole: «scaduto da 3 giorni», «oggi», «domani», «tra 5 giorni». */
export function dueLabel(on, today) {
  const n = diffDays(on, today);
  if (n < 0) return `scaduto da ${plural(-n, 'giorno', 'giorni')}`;
  if (n === 0) return 'oggi';
  if (n === 1) return 'domani';
  return `tra ${n} giorni`;
}

const CHIP = { new: '', contacted: 'chip-warn', talking: 'chip-accent', invited: 'chip-warn', client: 'chip-ok', lost: 'chip-done' };
export const statusChip = (s) => html`<span class="chip ${CHIP[s] ?? ''}">${STATUS_LABEL[s] ?? s}</span>`;
export const priorityChip = (p) => (p === 1 ? html`<span class="chip chip-err" title="Priorità alta">Alta</span>` : p === 3 ? html`<span class="chip chip-done" title="Priorità bassa">Bassa</span>` : '');

const tel = (p) => String(p).replace(/[^\d+]/g, '');
/** I modi per mettersi in contatto con un indirizzo e un telefono: collegamenti che aprono la posta, il telefono, WhatsApp. */
export function reach({ email, phone }) {
  return html`${email ? html`<a href="mailto:${email}">${email}</a>` : ''}${email && phone ? ' · ' : ''}${phone ? html`<a href="tel:${tel(phone)}">${phone}</a>${waDigits(phone) ? html` · <a href="https://wa.me/${waDigits(phone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''}` : ''}`;
}
const webLink = (url) => (url ? html`<a href="${url}" target="_blank" rel="noopener noreferrer">${url.replace(/^https?:\/\/(www\.)?/, '')}</a>` : '');
const placeLink = (place) => (/^https?:\/\//.test(place ?? '') ? html`<a href="${place}" target="_blank" rel="noopener noreferrer">${place.replace(/^https?:\/\//, '').slice(0, 48)}</a>` : place ?? '');

const BACK = (back) => (back ? html`<input type="hidden" name="back" value="${back}">` : '');
/** Un pulsante «rimanda di N giorni» o «fatto», piccolo, in un modulo suo. */
const snoozeBtn = (id, days, label, back) => html`<form method="post" action="/admin/leads/${id}/snooze">${BACK(back)}<input type="hidden" name="days" value="${days}"><button class="btn btn-sm btn-outline" type="submit">${label}</button></form>`;
const doneBtn = (id, back) => html`<form method="post" action="/admin/leads/${id}/next">${BACK(back)}<input type="hidden" name="on" value=""><button class="btn btn-sm btn-outline" type="submit">Fatto</button></form>`;

const apptRow = (a, { today, back = '' } = {}) => html`<div class="agenda-item lead-appt ${a.status === 'done' ? 'is-done' : ''}">
  <span class="agenda-time"><strong>${a.start_time === '00:00' && a.end_time === '23:59' ? 'Tutto' : a.start_time}</strong><small>${a.start_time === '00:00' && a.end_time === '23:59' ? 'il giorno' : a.end_time}</small></span>
  <span class="agenda-main"><strong><a href="/admin/leads/${a.lead_id}">${APPT_LABEL[a.kind]} · ${a.company}</a></strong>
    <small>${day(a.date)}${a.date === today ? ' (oggi)' : ''}${a.contact_name ? ` · ${a.contact_name}` : ''}${a.place ? html` · ${placeLink(a.place)}` : ''}${a.notes ? ` · ${a.notes}` : ''}</small></span>
  <span class="agenda-state">${a.status === 'done' ? html`<span class="chip chip-done">Fatto</span>` : a.blocks ? html`<span class="chip">Ore non prenotabili</span>` : html`<span class="chip chip-done">Non toglie ore</span>`}
    ${a.status === 'planned' ? html`<span class="lead-appt-actions"><a class="btn btn-sm btn-outline" href="/admin/leads/appointment?edit=${a.id}">Modifica</a>${doneForm(a, back)}</span>` : ''}</span>
</div>`;

/** «Com'è andata?»: chiude un appuntamento e scrive il seguito. */
const doneForm = (a, back = '') => html`<details class="lead-more"><summary class="btn btn-sm btn-gold">Fatto</summary>
  <form class="form lead-pop" method="post" action="/admin/leads/appointments/${a.id}/done">${BACK(back)}
    <label class="field"><span class="label">Com’è andata?</span><textarea name="outcome" rows="3" maxlength="2000" placeholder="Cosa vi siete detti, cosa serve fare…"></textarea></label>
    <div class="form-grid"><label class="field"><span class="label">Ricontattare il <em>(facoltativo)</em></span><input type="date" name="nextOn"></label>
      <label class="field"><span class="label">Per fare cosa</span><input name="nextAction" maxlength="160" placeholder="es. Mandare il listino"></label></div>
    <div class="btn-row"><button class="btn btn-gold" type="submit">Salva</button></div>
  </form></details>
  <form method="post" action="/admin/leads/appointments/${a.id}/cancel" data-confirm="Annullare questo appuntamento? Se toglieva ore dalle disponibilità, tornano prenotabili.">${BACK(back)}<button class="btn btn-sm btn-link-danger" type="submit">Annulla</button></form>`;

// ───────────── Oggi ─────────────
/**
 * La coda di lavoro: appuntamenti, richiami scaduti e di oggi, email in coda, i prossimi da contattare per la prima volta.
 * @param {object} o { today, counts, due, appointments, toClose, queue, toContact, registered }
 */
export function todayPage(ctx, { today, counts, due, appointments, toClose, queue, toContact, registered, flash = '' }) {
  const overdue = due.filter((l) => l.next_action_on < today);
  const dueToday = due.filter((l) => l.next_action_on === today);
  const soon = due.filter((l) => l.next_action_on > today);
  const week = appointments.filter((a) => a.date <= addDays(today, 7));
  const dueRow = (l) => html`<div class="due-row">
    <div class="due-main"><span class="due-name"><strong><a href="/admin/leads/${l.id}">${l.company}</a></strong> ${statusChip(l.status)} ${priorityChip(l.priority)}</span>
      <small class="muted">${[l.contact_name, l.country && countryName(l.country, 'it')].filter(Boolean).join(' · ')}</small>
      <small class="${l.next_action_on < today ? 'field-error' : 'muted'}">${l.next_action ?? 'Ricontattare'} · ${dueLabel(l.next_action_on, today)}${l.next_action_on !== today ? ` (${day(l.next_action_on)})` : ''}</small>
      <small>${reach({ email: l.contact_email ?? l.email, phone: l.contact_phone ?? l.phone })}</small></div>
    <div class="due-actions"><a class="btn btn-sm btn-gold" href="/admin/leads/${l.id}#registra">Registra</a>${l.email_ok && (l.contact_email || l.email) ? html`<a class="btn btn-sm btn-outline" href="/admin/leads/${l.id}/mail">Scrivi</a>` : ''}
      ${snoozeBtn(l.id, 3, '+3 giorni', 'today')}${snoozeBtn(l.id, 7, '+1 settimana', 'today')}${snoozeBtn(l.id, 30, '+1 mese', 'today')}${doneBtn(l.id, 'today')}</div>
  </div>`;
  const group = (title, rows, tone = '') => (rows.length ? html`<h3 class="due-title ${tone}">${title} <span class="chip">${rows.length}</span></h3><div class="card due-list">${rows.map(dueRow)}</div>` : '');
  const body = html`
<div class="kpis">
  <a class="kpi ${counts.due ? 'kpi-warn' : ''}" href="/admin/leads?due=today"><span class="kpi-l">Da richiamare</span><strong class="kpi-n">${counts.due}</strong><span class="kpi-s">${counts.overdue ? `${counts.overdue} scaduti` : 'oggi e scaduti'}</span></a>
  <a class="kpi" href="#appuntamenti"><span class="kpi-l">Appuntamenti</span><strong class="kpi-n">${week.length}</strong><span class="kpi-s">nei prossimi 7 giorni</span></a>
  <a class="kpi" href="/admin/leads/mail"><span class="kpi-l">Email in coda</span><strong class="kpi-n">${queue.count}</strong><span class="kpi-s">${queue.paused ? 'invio in pausa' : queue.count ? 'partono da sole' : 'nessuna'}</span></a>
  <a class="kpi" href="/admin/leads?status=new"><span class="kpi-l">Da contattare</span><strong class="kpi-n">${counts.by.new}</strong><span class="kpi-s">${plural(counts.by.client, 'cliente', 'clienti')} · ${counts.total} in tutto</span></a>
</div>
<div class="btn-row lead-actions"><a class="btn btn-gold" href="/admin/leads/new">Aggiungi un contatto</a><a class="btn btn-outline" href="/admin/leads/import">Importa un elenco</a><a class="btn btn-outline" href="/admin/leads/appointment">Fissa un appuntamento</a></div>
${counts.total === 0
  ? html`<div class="card pad empty-state"><h2>Si comincia da qui</h2><ol class="info-list"><li><strong>Aggiungi le agenzie</strong> che hai trovato: una alla volta, oppure incollando un elenco da un foglio di calcolo (<a href="/admin/leads/import">Importa</a>).</li><li><strong>Controlla i modelli</strong> delle email di presentazione in quattro lingue (<a href="/admin/leads/templates">Modelli</a>) e adattali al tuo modo di scrivere.</li><li><strong>Scrivi</strong> a un contatto, oppure metti in coda la presentazione per più agenzie: parte da sola, poche al giorno, e il sollecito se non rispondono.</li><li>Ogni telefonata e ogni risposta si <strong>registra</strong> con la data del prossimo richiamo: qui, in <em>Oggi</em>, trovi sempre chi ricontattare.</li></ol>${registered ? html`<form method="post" action="/admin/leads/registered" class="inline-form"><button class="btn btn-outline" type="submit">Porta qui le ${registered} agenzie già registrate sul sito</button></form>` : ''}</div>`
  : html`${registered ? html`<div class="notice notice-info" role="note"><strong>${plural(registered, 'agenzia registrata sul sito non è', 'agenzie registrate sul sito non sono')}</strong> ancora tra i contatti. <form class="inline-form" method="post" action="/admin/leads/registered"><button class="btn btn-sm btn-outline" type="submit">Aggiungile</button></form></div>` : ''}
<section id="appuntamenti"><h2 class="h-sub spaced">Appuntamenti</h2>
${toClose.length ? html`<div class="notice notice-info" role="note"><strong>${plural(toClose.length, 'appuntamento passato', 'appuntamenti passati')} da chiudere:</strong> com’è andata?</div><div class="card">${toClose.map((a) => apptRow(a, { today, back: 'today' }))}</div>` : ''}
${week.length ? html`<div class="card">${week.map((a) => apptRow(a, { today, back: 'today' }))}</div>` : html`<p class="muted">Nessun appuntamento nei prossimi 7 giorni. <a href="/admin/leads/appointment">Fissa una visita o una videochiamata</a>: compare anche nell’agenda.</p>`}</section>
<section><h2 class="h-sub spaced">Da richiamare</h2>
${due.length ? html`${group('Scaduti', overdue, 'is-late')}${group('Oggi', dueToday)}${group('Nei prossimi giorni', soon)}` : html`<p class="muted">Nessun richiamo in programma. Quando registri una telefonata o un’email, scegli <em>«Ricontattare tra…»</em>: il contatto torna qui nel giorno giusto.</p>`}</section>
${toContact.length ? html`<section><h2 class="h-sub spaced">Da contattare per primi</h2><div class="card">${toContact.map((l) => html`<div class="due-row"><div class="due-main"><span class="due-name"><strong><a href="/admin/leads/${l.id}">${l.company}</a></strong> ${priorityChip(l.priority)}</span><small class="muted">${[l.contact_name, l.city, l.country && countryName(l.country, 'it'), l.source && `fonte: ${l.source}`].filter(Boolean).join(' · ')}</small><small>${reach({ email: l.contact_email ?? l.email, phone: l.contact_phone ?? l.phone })}</small></div>
    <div class="due-actions">${l.contact_email || l.email ? html`<a class="btn btn-sm btn-gold" href="/admin/leads/${l.id}/mail">Scrivi la presentazione</a>` : html`<a class="btn btn-sm btn-outline" href="/admin/leads/${l.id}">Aggiungi un indirizzo</a>`}<a class="btn btn-sm btn-outline" href="/admin/leads/${l.id}#registra">Registra</a></div></div>`)}</div>
  <p class="small muted"><a href="/admin/leads?status=new">Vedi tutti i ${counts.by.new} da contattare</a></p></section>` : ''}`}`;
  return adminLayout(ctx, { title: 'Commerciale', active: '/admin/leads/today', body, flash });
}

// ───────────── elenco dei contatti ─────────────
const qs = (f, over = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...over })) if (v !== '' && v != null && !(k === 'page' && Number(v) <= 1)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export function leadsPage(ctx, { rows, total, filters, counts, countries, sources, page, pageSize, today, flash = '', error = '' }) {
  const f = filters;
  const tabs = [['', 'Tutti', counts.total], ...STATUSES.map((s) => [s, STATUS_LABEL[s], counts.by[s]])];
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const bulkId = 'bulk-form';
  const body = html`
<div class="tabs-bar"><nav class="tabs" aria-label="Stato">${tabs.map(([k, l, n]) => html`<a class="tab" href="/admin/leads${qs(f, { status: k, page: '' })}" ${(f.status ?? '') === k ? raw('aria-current="page"') : ''}>${l} <span class="tab-n">${n}</span></a>`)}</nav>
  <span class="tabs-export"><a class="btn btn-sm btn-gold" href="/admin/leads/new">Aggiungi</a> <a class="btn btn-sm btn-outline" href="/admin/leads/import">Importa</a> <a class="btn btn-sm btn-outline" href="/admin/leads/export.csv">Esporta CSV</a></span></div>
<form class="card lead-filters" method="get" action="/admin/leads">
  ${f.status ? html`<input type="hidden" name="status" value="${f.status}">` : ''}
  <div class="lead-search"><label class="field"><span class="label">Cerca</span><input type="search" name="q" value="${f.q ?? ''}" placeholder="Agenzia, referente, città, email, telefono, note…"></label><button class="btn btn-gold" type="submit">Cerca</button></div>
  <details class="lead-more" ${[f.kind, f.country, f.priority, f.due, f.source, f.email, f.sort].some(Boolean) ? raw('open') : ''}><summary>Filtri e ordine</summary>
    <div class="form-grid">
      <label class="field"><span class="label">Tipo</span><select name="kind"><option value="">Tutti</option>${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${f.kind === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label class="field"><span class="label">Paese</span><select name="country"><option value="">Tutti</option>${countries.map((c) => html`<option value="${c.country}" ${f.country === c.country ? raw('selected') : ''}>${countryName(c.country, 'it')} (${c.n})</option>`)}</select></label>
      <label class="field"><span class="label">Priorità</span><select name="priority"><option value="">Tutte</option>${Object.entries(PRIORITY_LABEL).map(([k, l]) => html`<option value="${k}" ${String(f.priority) === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label class="field"><span class="label">Richiamo</span><select name="due"><option value="">Qualsiasi</option>${[['overdue', 'Scaduto'], ['today', 'Oggi o scaduto'], ['week', 'Entro 7 giorni'], ['none', 'Nessun richiamo']].map(([k, l]) => html`<option value="${k}" ${f.due === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label class="field"><span class="label">Fonte</span><select name="source"><option value="">Tutte</option>${sources.map((s) => html`<option value="${s.source}" ${f.source === s.source ? raw('selected') : ''}>${s.source} (${s.n})</option>`)}</select></label>
      <label class="field"><span class="label">Email</span><select name="email"><option value="">Qualsiasi</option><option value="none" ${f.email === 'none' ? raw('selected') : ''}>Senza indirizzo</option><option value="blocked" ${f.email === 'blocked' ? raw('selected') : ''}>Non vogliono email</option></select></label>
      <label class="field"><span class="label">Ordina per</span><select name="sort">${Object.entries(SORT_LABEL).map(([k, l]) => html`<option value="${k}" ${(f.sort ?? 'next') === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
    </div>
    <div class="btn-row"><button class="btn btn-sm btn-gold" type="submit">Applica</button><a class="btn btn-sm btn-outline" href="/admin/leads">Azzera tutto</a></div></details>
</form>
${rows.length
  ? html`<form id="${bulkId}" method="post" action="/admin/leads/bulk"><input type="hidden" name="return" value="${qs(f, { page: page > 1 ? page : '' })}">
  <div class="card lead-bulk"><label class="check"><input type="checkbox" data-check-all="#${bulkId}"> Seleziona tutti quelli in questa pagina</label>
    <div class="lead-bulk-actions"><button class="btn btn-sm btn-gold" type="submit" name="action" value="presentation">Scrivi la presentazione ai selezionati</button>
      <select name="status" aria-label="Cambia stato"><option value="">Cambia stato…</option>${STATUSES.map((s) => html`<option value="${s}">${STATUS_LABEL[s]}</option>`)}</select><button class="btn btn-sm btn-outline" type="submit" name="action" value="set-status">Applica</button>
      <select name="priority" aria-label="Cambia priorità"><option value="">Priorità…</option>${Object.entries(PRIORITY_LABEL).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select><button class="btn btn-sm btn-outline" type="submit" name="action" value="set-priority">Applica</button>
      <button class="btn btn-sm btn-link-danger" type="submit" name="action" value="delete" data-confirm-click="Cancellare i contatti selezionati, con i loro referenti e il registro? Non si può tornare indietro.">Cancella</button></div></div>
  <div class="card table-wrap"><table class="table lead-table"><thead><tr><th>Agenzia</th><th>Referente</th><th>Stato</th><th>Prossima azione</th><th>Ultimo contatto</th></tr></thead><tbody>
  ${rows.map((l) => html`<tr class="${l.next_action_on && l.next_action_on < today && l.status !== 'lost' ? 'row-overdue' : ''}">
    <td><div class="lead-first"><input type="checkbox" name="ids" value="${l.id}" aria-label="Seleziona ${l.company}"><div><a href="/admin/leads/${l.id}">${l.company}</a><br><small class="muted">${[KIND_LABEL[l.kind], l.city, l.country && countryName(l.country, 'it'), l.source].filter(Boolean).join(' · ')}</small></div></div></td>
    <td>${l.contact_name ?? html`<span class="muted">—</span>`}<br><small>${reach({ email: l.contact_email ?? l.email, phone: l.contact_phone ?? l.phone })}</small></td>
    <td>${statusChip(l.status)} ${priorityChip(l.priority)}${l.account_status === 'approved' ? html` <span class="chip chip-ok" title="Ha un profilo B2B approvato">B2B</span>` : l.account_status === 'pending' ? html` <span class="chip chip-warn" title="Ha chiesto l’accesso B2B">B2B da approvare</span>` : ''}${l.email_ok ? '' : html` <span class="chip chip-err" title="Ha chiesto di non ricevere email">No email</span>`}</td>
    <td>${l.next_action_on ? html`<strong class="${l.next_action_on < today ? 'field-error' : ''}">${day(l.next_action_on)}</strong><br><small class="muted">${l.next_action ?? ''} · ${dueLabel(l.next_action_on, today)}</small>` : html`<span class="muted">—</span>`}${l.next_appointment ? html`<br><small>📅 ${day(l.next_appointment)}</small>` : ''}</td>
    <td>${l.last_contact_on ? day(l.last_contact_on) : html`<span class="muted">mai</span>`}</td></tr>`)}
  </tbody></table></div></form>
  <p class="small muted">${total === 1 ? '1 contatto' : `${total} contatti`}${pages > 1 ? ` · pagina ${page} di ${pages}` : ''}</p>
  ${pages > 1 ? html`<div class="btn-row">${page > 1 ? html`<a class="btn btn-sm btn-outline" href="/admin/leads${qs(f, { page: page - 1 })}">← Prima</a>` : ''}${page < pages ? html`<a class="btn btn-sm btn-outline" href="/admin/leads${qs(f, { page: page + 1 })}">Dopo →</a>` : ''}</div>` : ''}`
  : html`<div class="card pad muted">${counts.total ? 'Nessun contatto con questi filtri.' : html`Nessun contatto ancora. <a href="/admin/leads/new">Aggiungine uno</a> oppure <a href="/admin/leads/import">importa un elenco</a>.`}</div>`}`;
  return adminLayout(ctx, { title: 'Contatti', active: '/admin/leads', body, flash, error, scripts: `<script src="/js/admin-leads.js?v=${ctx.app.assetVersion}" defer></script>` });
}

// ───────────── modulo di un contatto ─────────────
const sel = (cond) => (cond ? raw('selected') : '');

/** I campi di un contatto: gli stessi per «Aggiungi» e per «Modifica i dati». */
function leadFields(v = {}, { withContact = false } = {}) {
  const country = v.country ?? 'IT';
  return html`<div class="form-grid">
    <label class="field span-2"><span class="label">Agenzia o tour operator</span><input name="company" required maxlength="160" value="${v.company ?? ''}" autocomplete="off" placeholder="es. Lagoon Travel S.r.l."></label>
    <label class="field"><span class="label">Tipo</span><select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${sel((v.kind ?? 'agency') === k)}>${l}</option>`)}</select></label>
    ${countryField(ADMIN_CTX, { name: 'country', value: country, required: false, label: 'Paese' })}
    <label class="field"><span class="label">Città</span><input name="city" maxlength="80" value="${v.city ?? ''}" autocomplete="off"></label>
    <label class="field"><span class="label">Sito web</span><input name="website" maxlength="300" value="${v.website ?? ''}" placeholder="www.agenzia.it" inputmode="url" autocomplete="off"></label>
    <label class="field"><span class="label">Email dell’agenzia <em>(info@…)</em></span><input type="email" name="email" maxlength="254" value="${v.email ?? ''}" autocomplete="off"></label>
    ${phoneField(ADMIN_CTX, { name: 'phone', value: v.phone ?? '', cc: v.phone_cc ?? '', defaultCc: country || 'IT', label: 'Telefono dell’agenzia', autocomplete: 'off' })}
  </div>
  ${withContact
    ? html`<h3 class="lead-sub-h">Referente <em class="muted">(la persona con cui parli, se la conosci)</em></h3>
  <div class="form-grid">
    <label class="field"><span class="label">Nome e cognome</span><input name="contact_name" maxlength="120" value="${v.contact_name ?? ''}" autocomplete="off"></label>
    <label class="field"><span class="label">Ruolo</span><input name="contact_role" maxlength="80" value="${v.contact_role ?? ''}" placeholder="es. Responsabile booking" autocomplete="off"></label>
    <label class="field"><span class="label">Email del referente</span><input type="email" name="contact_email" maxlength="254" value="${v.contact_email ?? ''}" autocomplete="off"></label>
    ${phoneField(ADMIN_CTX, { name: 'contact_phone', value: v.contact_phone ?? '', cc: v.contact_phone_cc ?? '', defaultCc: country || 'IT', label: 'Telefono del referente', autocomplete: 'off' })}
  </div>`
    : ''}
  <div class="form-grid">
    <label class="field"><span class="label">Fonte <em>(dove l’hai trovata)</em></span><input name="source" maxlength="120" value="${v.source ?? ''}" list="lead-sources" placeholder="es. Fiera BIT, Google, LinkedIn" autocomplete="off"></label>
    <label class="field"><span class="label">Priorità</span><select name="priority">${Object.entries(PRIORITY_LABEL).map(([k, l]) => html`<option value="${k}" ${sel(String(v.priority ?? 2) === k)}>${l}</option>`)}</select></label>
    <label class="field"><span class="label">Lingua delle email</span><select name="lang"><option value="">Automatica (dal paese e dal sito)</option>${Object.entries(LANG_META).map(([k, m]) => html`<option value="${k}" ${sel(v.lang === k)}>${m.name}</option>`)}</select></label>
    ${withContact ? html`<label class="field"><span class="label">Ricontattare il <em>(facoltativo)</em></span><input type="date" name="nextActionOn" value="${v.nextActionOn ?? ''}"></label>` : ''}
  </div>
  <label class="field"><span class="label">Note</span><textarea name="notes" rows="3" maxlength="2000" placeholder="Cosa fa, che mercati serve, cosa ti interessa ricordare…">${v.notes ?? ''}</textarea></label>`;
}
const sourceList = (sources) => html`<datalist id="lead-sources">${sources.map((s) => html`<option value="${s.source}">`)}</datalist>`;

export function newLeadPage(ctx, { values = {}, sources = [], duplicates = [], error = '' }) {
  const body = html`
<p class="back-link"><a href="/admin/leads">← Tutti i contatti</a></p>
${duplicates.length
  ? html`<div class="notice notice-info" role="note"><strong>Forse c’è già:</strong> ${duplicates.map((d, i) => html`${i ? ', ' : ' '}<a href="/admin/leads/${d.id}">${d.company}</a> <small>(${d.why})</small>`)}.
    Aprila per non registrarla due volte, oppure <button class="btn btn-sm btn-outline" type="submit" form="new-lead" name="force" value="1">crea comunque un contatto nuovo</button>.</div>`
  : ''}
<form id="new-lead" class="card pad form" method="post" action="/admin/leads/new">
  <h2>Nuovo contatto</h2>
  ${leadFields(values, { withContact: true })}
  <div class="btn-row"><button class="btn btn-gold" type="submit">Aggiungi</button><a class="btn btn-outline" href="/admin/leads">Annulla</a></div>
</form>${sourceList(sources)}`;
  return adminLayout(ctx, { title: 'Nuovo contatto', active: '/admin/leads', body, error });
}

// ───────────── scheda di un contatto ─────────────
const LOG_HELP = { call: 'Hai parlato con qualcuno', no_answer: 'Chiamata senza risposta', reply: 'Ha risposto (email o messaggio)', message: 'Messaggio inviato (WhatsApp, LinkedIn…)', meeting: 'Incontro o visita fatta', video: 'Videochiamata fatta', note: 'Solo una nota' };
const AGAIN = [['', 'Nessun richiamo'], ['3', 'Tra 3 giorni'], ['7', 'Tra una settimana'], ['14', 'Tra due settimane'], ['30', 'Tra un mese'], ['90', 'Tra tre mesi']];
const EMAIL_STATE = { queued: ['chip-warn', 'In coda'], sent: ['chip-ok', 'Inviata'], failed: ['chip-err', 'Non partita'], cancelled: ['chip-done', 'Annullata'], skipped: ['chip-done', 'Saltata'] };

/**
 * @param {object} o lead, contacts, timeline, appointments, emails, account, stats, today, sources, flash, error, fresh ({ kind: 'invite'|'profile', url, sent })
 */
export function leadPage(ctx, { lead: l, contacts, timeline, appointments, emails, account, stats, today, sources = [], flash = '', error = '', fresh = null, values = null }) {
  const canMail = l.email_ok && (l.email || contacts.some((c) => c.email));
  const planned = appointments.filter((a) => a.status === 'planned');
  const past = appointments.filter((a) => a.status !== 'planned');
  const edit = values ?? l;
  const body = html`
<p class="back-link"><a href="/admin/leads">← Tutti i contatti</a></p>
<div class="lead-head"><div><p class="lead-chips">${statusChip(l.status)} ${priorityChip(l.priority)}${l.account_id ? html` <a class="chip chip-ok" href="/admin/partners/${l.account_id}">Profilo B2B</a>` : ''}</p>
  <p class="lead-sub muted">${[KIND_LABEL[l.kind], l.city, l.country && countryName(l.country, 'it'), l.source && `fonte: ${l.source}`].filter(Boolean).join(' · ')}</p></div>
  <div class="btn-row">${canMail ? html`<a class="btn btn-gold" href="/admin/leads/${l.id}/mail">Scrivi un’email</a>` : ''}<a class="btn btn-outline" href="/admin/leads/appointment?lead=${l.id}">Fissa un appuntamento</a></div></div>
${l.email_ok ? '' : html`<div class="notice notice-err" role="alert"><strong>Non scrivere a questo contatto.</strong> Ha chiesto di non ricevere email${l.optout_at ? ` (il ${day(l.optout_at.slice(0, 10))})` : ''}: nessuna email parte, né subito né dalla coda.
  <form class="inline-form" method="post" action="/admin/leads/${l.id}/allow-email" data-confirm="Riabilitare le email per questo contatto? Fallo solo se è stata l’agenzia a chiedertelo."><button class="btn btn-sm btn-outline" type="submit">Riabilita le email</button></form></div>`}
${fresh ? html`<div class="notice ${fresh.sent ? 'notice-ok' : 'notice-err'}" role="status">
  <p>${fresh.kind === 'invite'
    ? (fresh.sent ? html`Invito mandato: l’agenzia riceve un <strong>collegamento personale</strong> e, registrandosi, ha l’account già approvato.` : html`<strong>L’email non è partita</strong> (controlla la posta in <em>Aiuto › Email</em>): puoi mandare tu il collegamento.`)
    : (fresh.sent ? html`Profilo creato e approvato. Ho mandato all’agenzia l’email per <strong>scegliere la password</strong>.` : html`Profilo creato e approvato. <strong>Manda tu all’agenzia</strong> il collegamento per scegliere la password.`)}</p>
  <p class="small"><strong>Collegamento personale</strong> <em class="muted">(si vede solo adesso${fresh.kind === 'invite' ? ': poi, da Clienti › Partner › Inviti, se ne crea uno nuovo' : `: vale 7 giorni e una volta sola; ricrearlo: «Password dimenticata?» dell’agenzia`})</em></p>
  <p class="copy-line"><input class="copy-field" id="fresh-link" readonly data-select-all value="${fresh.url}" aria-label="Collegamento personale"><button class="btn btn-outline btn-sm" type="button" data-copy="#fresh-link" data-copied="Copiato">Copia</button></p></div>` : ''}
<div class="lead-grid">
  <div class="lead-stack">
    <section class="card pad lead-card" id="prossima"><h2>Prossima azione</h2>
      <form class="form" method="post" action="/admin/leads/${l.id}/next">
        <div class="form-grid"><label class="field"><span class="label">Quando</span><input type="date" name="on" value="${l.next_action_on ?? ''}"></label>
          <label class="field span-2"><span class="label">Cosa fare</span><input name="text" maxlength="160" value="${l.next_action ?? ''}" placeholder="es. Richiamare Anna per il listino"></label></div>
        <div class="btn-row"><button class="btn btn-gold btn-sm" type="submit">Salva</button></div></form>
      <div class="btn-row lead-quick">${[[3, '+3 giorni'], [7, '+1 settimana'], [14, '+2 settimane'], [30, '+1 mese']].map(([d, t]) => snoozeBtn(l.id, d, t, ''))}${l.next_action_on ? doneBtn(l.id, '') : ''}</div>
      ${l.next_action_on ? html`<p class="small ${l.next_action_on < today ? 'field-error' : 'muted'}">${l.next_action ?? 'Ricontattare'}: ${dueLabel(l.next_action_on, today)} (${day(l.next_action_on)})</p>` : html`<p class="small muted">Nessun richiamo fissato.</p>`}</section>
    <section class="card pad lead-card" id="registra"><h2>Registra</h2>
      <p class="muted small">Una telefonata, una risposta, un incontro: finisce nel registro e il contatto avanza di stato da solo.</p>
      <form class="form" method="post" action="/admin/leads/${l.id}/log">
        <div class="form-grid">
          <label class="field"><span class="label">Cosa è successo</span><select name="kind">${MANUAL_ACTIVITIES.map((k) => html`<option value="${k}">${LOG_HELP[k]}</option>`)}</select></label>
          <label class="field"><span class="label">Con chi</span><select name="contactId"><option value="">—</option>${contacts.map((c) => html`<option value="${c.id}">${c.name}${c.role ? ` (${c.role})` : ''}</option>`)}</select></label>
        </div>
        <label class="field"><span class="label">Cosa vi siete detti</span><textarea name="body" rows="3" maxlength="4000" placeholder="Interessata a Murano e Burano, richiamare dopo la fiera…"></textarea></label>
        <div class="form-grid">
          <label class="field"><span class="label">Ricontattare</span><select name="again">${AGAIN.map(([v, t]) => html`<option value="${v}">${t}</option>`)}<option value="date">Scelgo una data…</option></select></label>
          <label class="field"><span class="label">Oppure il giorno</span><input type="date" name="againDate"></label>
          <label class="field span-2"><span class="label">Per fare cosa <em>(facoltativo)</em></span><input name="againText" maxlength="160" placeholder="es. Mandare il listino"></label>
          <label class="field"><span class="label">È successo il <em>(se non oggi)</em></span><input type="date" name="when" max="${today}"></label>
        </div>
        <div class="btn-row"><button class="btn btn-gold" type="submit">Salva nel registro</button></div></form></section>
  </div>
  <div class="lead-stack">
    <section class="card pad lead-card"><h2>Dati</h2>
      <dl class="summary-list">
        <div><dt>Sito</dt><dd>${l.website ? webLink(l.website) : html`<span class="muted">—</span>`}</dd></div>
        <div><dt>Email</dt><dd>${l.email ? html`<a href="mailto:${l.email}">${l.email}</a>` : html`<span class="muted">—</span>`}</dd></div>
        <div><dt>Telefono</dt><dd>${l.phone ? reach({ phone: l.phone }) : html`<span class="muted">—</span>`}</dd></div>
        <div><dt>Lingua delle email</dt><dd>${LANG_META[l.lang]?.name ?? l.lang}</dd></div>
        <div><dt>Ultimo contatto</dt><dd>${l.last_contact_on ? day(l.last_contact_on) : 'mai'}</dd></div>
        ${l.notes ? html`<div><dt>Note</dt><dd class="pre">${l.notes}</dd></div>` : ''}
      </dl>
      <details class="lead-more"${values ? raw(' open') : ''}><summary class="btn btn-sm btn-outline">Modifica i dati</summary>
        <form class="form lead-pop" method="post" action="/admin/leads/${l.id}">${leadFields(edit)}
          <div class="btn-row"><button class="btn btn-gold" type="submit">Salva</button></div></form></details>
      <div class="lead-status"><form class="inline-form" method="post" action="/admin/leads/${l.id}/status"><label class="label" for="st">Stato</label>
        <select name="status" id="st">${STATUSES.map((s) => html`<option value="${s}" ${sel(l.status === s)}>${STATUS_LABEL[s]}</option>`)}</select><button class="btn btn-sm btn-outline" type="submit">Cambia</button></form></div></section>
    <section class="card pad lead-card" id="referenti"><h2>Referenti</h2>
      ${contacts.length ? html`<ul class="lead-people">${contacts.map((c) => html`<li><div class="lead-person"><strong>${c.name}</strong>${c.is_main ? html` <span class="chip">Principale</span>` : ''}${c.role ? html` <small class="muted">${c.role}</small>` : ''}
        <small>${reach({ email: c.email, phone: c.phone })}</small>${c.lang ? html`<small class="muted">scrivigli in ${LANG_META[c.lang]?.name}</small>` : ''}${c.notes ? html`<small class="muted">${c.notes}</small>` : ''}</div>
        <div class="lead-person-actions">${c.email && l.email_ok ? html`<a class="btn btn-sm btn-outline" href="/admin/leads/${l.id}/mail?to=c${c.id}">Scrivi</a>` : ''}
          <details class="lead-more"><summary class="btn btn-sm btn-outline">Modifica</summary><form class="form lead-pop" method="post" action="/admin/leads/${l.id}/contacts/${c.id}">${contactFields(c)}<div class="btn-row"><button class="btn btn-gold btn-sm" type="submit">Salva</button></div></form></details>
          ${c.is_main ? '' : html`<form method="post" action="/admin/leads/${l.id}/contacts/${c.id}/main"><button class="btn btn-sm btn-outline" type="submit">Rendi principale</button></form>`}
          <form method="post" action="/admin/leads/${l.id}/contacts/${c.id}/delete" data-confirm="Togliere ${c.name} dai referenti?"><button class="btn btn-sm btn-link-danger" type="submit">Togli</button></form></div></li>`)}</ul>` : html`<p class="muted">Nessun referente. Aggiungi chi hai sentito o chi ti hanno indicato.</p>`}
      <details class="lead-more"><summary class="btn btn-sm btn-gold">Aggiungi un referente</summary><form class="form lead-pop" method="post" action="/admin/leads/${l.id}/contacts">${contactFields({ lang: '' }, l.country)}<label class="check"><input type="checkbox" name="main" value="1"> È il referente principale</label><div class="btn-row"><button class="btn btn-gold btn-sm" type="submit">Aggiungi</button></div></form></details></section>
    <section class="card pad lead-card" id="b2b"><h2>Profilo B2B sul sito</h2>
      ${account
        ? html`<p><span class="chip ${account.status === 'approved' ? 'chip-ok' : account.status === 'pending' ? 'chip-warn' : 'chip-err'}">${{ approved: 'Approvato', pending: 'Da approvare', rejected: 'Rifiutato', suspended: 'Sospeso' }[account.status] ?? account.status}</span> <a href="/admin/partners/${account.id}"><strong>${account.company}</strong></a></p>
          <p class="small muted">${stats.bookings ? `${plural(stats.bookings, 'prenotazione confermata', 'prenotazioni confermate')}, l’ultima per il ${day(stats.lastDate)}.` : 'Nessuna prenotazione ancora.'} Sconti, listino e condizioni si decidono nella <a href="/admin/partners/${account.id}">scheda del partner</a>.</p>`
        : html`<p class="muted small">Questa agenzia non ha ancora un profilo nell’area B2B. Due modi per portarla dentro:</p>
          <form class="form lead-b2b" method="post" action="/admin/leads/${l.id}/invite"><h3>Invitala</h3>
            <p class="small muted">Le arriva un collegamento personale: compila i suoi dati e l’account è già approvato (vale 14 giorni).</p>
            <label class="field"><span class="label">A chi</span><select name="contactId">${contactOptions(contacts, l)}</select></label>
            <label class="field"><span class="label">Un messaggio per lei <em>(facoltativo)</em></span><textarea name="note" rows="2" maxlength="600" placeholder="Come ci siamo detti al telefono…"></textarea></label>
            <div class="btn-row"><button class="btn btn-gold btn-sm" type="submit" ${l.email_ok && (l.email || contacts.some((c) => c.email)) ? '' : raw('disabled')}>Invia l’invito</button></div></form>
          <form class="form lead-b2b" method="post" action="/admin/leads/${l.id}/profile" data-confirm="Creare subito il profilo B2B di ${l.company}? L’account nasce approvato."><h3>Oppure crea il profilo adesso</h3>
            <p class="small muted">Utile se ti ha detto di sì a voce: il profilo è approvato e pronto, e puoi già registrarle prenotazioni. L’agenzia sceglie la password da un collegamento e completa lei i dati di fatturazione.</p>
            <label class="field"><span class="label">Intestato a</span><select name="contactId">${contactOptions(contacts, l)}</select></label>
            <label class="check"><input type="checkbox" name="sendMail" value="1" checked> Manda subito all’agenzia l’email per scegliere la password</label>
            <div class="btn-row"><button class="btn btn-outline btn-sm" type="submit" ${l.email || contacts.some((c) => c.email) ? '' : raw('disabled')}>Crea il profilo</button></div></form>`}</section>
  </div>
</div>
<section class="card pad lead-card"><div class="lead-card-head"><h2>Appuntamenti</h2><a class="btn btn-sm btn-gold" href="/admin/leads/appointment?lead=${l.id}">Fissa un appuntamento</a></div>
  ${planned.length ? html`<div class="lead-appts">${planned.map((a) => apptRow(a, { today }))}</div>` : html`<p class="muted">Nessun appuntamento fissato. Una visita in azienda o una videochiamata compare anche nell’<a href="/admin">agenda</a>.</p>`}
  ${past.length ? html`<details class="lead-more"><summary>Passati (${past.length})</summary><div class="lead-appts">${past.map((a) => apptRow(a, { today }))}</div></details>` : ''}</section>
<section class="card pad lead-card"><div class="lead-card-head"><h2>Email</h2>${canMail ? html`<a class="btn btn-sm btn-outline" href="/admin/leads/${l.id}/mail">Scrivi</a>` : ''}</div>
  ${emails.length ? html`<ul class="plain lead-emails">${emails.map((e) => {
    const [chip, label] = EMAIL_STATE[e.status] ?? ['', e.status];
    return html`<li><span class="chip ${chip}">${label}</span> <strong>${e.subject}</strong> <small class="muted">${TEMPLATE_LABEL[e.template] ?? e.template} · a ${e.to_email} · ${e.status === 'queued' ? `parte dal ${when(e.send_after)}` : when(e.sent_at ?? e.created_at)}${e.note ? ` · ${e.note}` : ''}</small>
      ${e.status === 'queued' ? html`<form class="inline-form" method="post" action="/admin/leads/mail/${e.id}/cancel"><input type="hidden" name="back" value="${l.id}"><button class="btn btn-sm btn-link-danger" type="submit">Annulla</button></form>` : ''}</li>`;
  })}</ul>` : html`<p class="muted">Nessuna email scritta da qui.</p>`}</section>
<section class="card pad lead-card"><h2>Registro</h2>
  ${timeline.length ? html`<ul class="timeline lead-timeline">${timeline.map((a) => html`<li class="tl-${a.kind}"><div><strong>${a.title || ACTIVITY_LABEL[a.kind]}</strong> <small class="muted">${ACTIVITY_LABEL[a.kind]}${a.contact_name ? ` · ${a.contact_name}` : ''} · ${when(a.at)}</small></div>${a.body ? html`<p class="pre small">${a.body}</p>` : ''}</li>`)}</ul>` : html`<p class="muted">Ancora nulla.</p>`}</section>
<div class="lead-danger">
  ${l.email_ok ? html`<form method="post" action="/admin/leads/${l.id}/optout" data-confirm="Segnare che questo contatto non vuole più email? Le email in coda si annullano."><button class="btn btn-sm btn-link-danger" type="submit">Non scrivere più a questo contatto</button></form>` : ''}
  <form method="post" action="/admin/leads/${l.id}/delete" data-confirm="Cancellare ${l.company} con i suoi referenti, appuntamenti e registro? Non si può tornare indietro."><button class="btn btn-sm btn-link-danger" type="submit">Cancella il contatto</button></form></div>
${sourceList(sources)}`;
  return adminLayout(ctx, { title: l.company, active: '/admin/leads', body, flash, error });
}

const contactOptions = (contacts, lead) =>
  html`${contacts.filter((c) => c.email).map((c) => html`<option value="${c.id}">${c.name} — ${c.email}</option>`)}${lead.email ? html`<option value="">${lead.company} — ${lead.email}</option>` : ''}`;

/** I campi di un referente (aggiunta e modifica). `country` è il paese del contatto, per il prefisso del telefono. */
function contactFields(c = {}, country = 'IT') {
  return html`<div class="form-grid">
    <label class="field"><span class="label">Nome e cognome</span><input name="name" required maxlength="120" value="${c.name ?? ''}" autocomplete="off"></label>
    <label class="field"><span class="label">Ruolo</span><input name="role" maxlength="80" value="${c.role ?? ''}" placeholder="es. Responsabile booking" autocomplete="off"></label>
    <label class="field"><span class="label">Email</span><input type="email" name="email" maxlength="254" value="${c.email ?? ''}" autocomplete="off"></label>
    ${phoneField(ADMIN_CTX, { name: 'phone', value: c.phone ?? '', defaultCc: country || 'IT', label: 'Telefono', autocomplete: 'off' })}
    <label class="field"><span class="label">Lingua delle email</span><select name="lang"><option value="">Come l’agenzia</option>${Object.entries(LANG_META).map(([k, m]) => html`<option value="${k}" ${sel(c.lang === k)}>${m.name}</option>`)}</select></label>
    <label class="field"><span class="label">Note</span><input name="notes" maxlength="600" value="${c.notes ?? ''}" placeholder="es. parla solo inglese, c’è il lunedì"></label>
  </div>`;
}

// ───────────── fissare un appuntamento ─────────────
export function appointmentPage(ctx, { leads, contacts = [], values = {}, editing = null, today, error = '' }) {
  const v = values;
  const kind = v.kind ?? 'visit';
  const body = html`
<p class="back-link"><a href="${v.lead ? `/admin/leads/${v.lead}` : '/admin/leads/today'}">← Indietro</a></p>
<form class="card pad form" method="post" action="${editing ? `/admin/leads/appointments/${editing}` : '/admin/leads/appointment'}">
  <h2>${editing ? 'Modifica l’appuntamento' : 'Fissa un appuntamento'}</h2>
  <p class="muted">Una visita in azienda, una videochiamata, una telefonata: compare nell’<a href="/admin">agenda</a> e, se vuoi, quelle ore non sono più prenotabili dal sito.</p>
  ${editing ? html`<input type="hidden" name="lead" value="${v.lead}">` : html`<label class="field"><span class="label">Con quale agenzia</span><select name="lead" required><option value="" ${v.lead ? '' : raw('selected')} disabled>Scegli…</option>${leads.map((l) => html`<option value="${l.id}" ${sel(String(v.lead) === String(l.id))}>${l.company}${l.city ? ` — ${l.city}` : ''}</option>`)}</select></label>`}
  <div class="form-grid">
    <label class="field"><span class="label">Che cos’è</span><select name="kind">${Object.entries(APPT_LABEL).map(([k, l]) => html`<option value="${k}" ${sel(kind === k)}>${l}</option>`)}</select></label>
    ${contacts.length ? html`<label class="field"><span class="label">Con chi</span><select name="contactId"><option value="">—</option>${contacts.map((c) => html`<option value="${c.id}" ${sel(String(v.contactId) === String(c.id))}>${c.name}</option>`)}</select></label>` : ''}
    <label class="field"><span class="label">Giorno</span><input type="date" name="date" required value="${v.date ?? today}"></label>
  </div>
  <label class="check"><input type="checkbox" name="allDay" value="1" data-allday ${v.allDay ? raw('checked') : ''}> Tutto il giorno <em class="muted">(per esempio una trasferta)</em></label>
  <div class="form-grid" data-times><label class="field"><span class="label">Dalle</span><input type="time" name="start" value="${v.start ?? '10:00'}"></label><label class="field"><span class="label">Alle</span><input type="time" name="end" value="${v.end ?? '11:00'}"></label></div>
  <label class="field"><span class="label">Dove <em>(indirizzo o collegamento della videochiamata)</em></span><input name="place" maxlength="300" value="${v.place ?? ''}" placeholder="Via … , Padova — oppure https://meet.google.com/…"></label>
  <label class="field"><span class="label">Note <em>(facoltativo)</em></span><textarea name="notes" rows="2" maxlength="1000">${v.notes ?? ''}</textarea></label>
  <label class="check"><input type="checkbox" name="blocks" value="1" ${v.blocks === undefined ? (['visit', 'video', 'other'].includes(kind) ? raw('checked') : '') : v.blocks ? raw('checked') : ''}> <span>Togli queste ore dalle disponibilità del sito <em class="muted">(i clienti non potranno prenotare in quella fascia; una visita o una videochiamata di solito sì, una telefonata breve no)</em></span></label>
  <div class="btn-row"><button class="btn btn-gold" type="submit">${editing ? 'Salva' : 'Fissa'}</button><a class="btn btn-outline" href="${v.lead ? `/admin/leads/${v.lead}` : '/admin/leads/today'}">Annulla</a></div>
</form>`;
  return adminLayout(ctx, { title: editing ? 'Modifica appuntamento' : 'Nuovo appuntamento', active: '/admin/leads/today', body, error, scripts: `<script src="/js/admin-agenda.js?v=${ctx.app.assetVersion}" defer></script>` });
}
