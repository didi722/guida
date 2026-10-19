import { html, raw } from '../html.js';
import { addDays, fmtDate, nowRome } from '../time.js';
import { adminLayout } from './admin.js';

const CHIP = { err: ['chip-err', 'Urgente'], warn: ['chip-warn', 'Da fare'], info: ['', 'In arrivo'] };
const eur = (cents) => `${(cents / 100).toLocaleString('it-IT', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** «Da fare»: le cose che aspettano la guida, per sezione, con il collegamento alla pagina giusta. */
export function todoPage(ctx, { todo, now }) {
  const lead = todo.count
    ? html`<div class="notice notice-info" role="note"><strong>${plural(todo.count, 'cosa da fare', 'cose da fare')}.</strong> Aggiornato alle ${now}.</div>`
    : html`<div class="card pad empty-state"><p><strong>Tutto a posto.</strong> Non c’è nulla che aspetti te: restano solo le cose in arrivo, qui sotto. Aggiornato alle ${now}.</p></div>`;
  const body = html`
${lead}
${todo.sections.map((s) => html`<section class="todo-section"><h2 class="h-sub spaced">${s.title}</h2>
  <div class="card">${s.items.map((i) => html`<a class="todo-item" href="${i.href}"><span class="chip ${CHIP[i.tone][0]}">${CHIP[i.tone][1]}</span><span class="todo-main"><strong>${i.text}</strong>${i.meta ? html`<small class="muted">${i.meta}</small>` : ''}</span><span class="todo-go" aria-hidden="true">→</span></a>`)}</div></section>`)}
<p class="small muted spaced">Il numero accanto a «Da fare» conta le voci urgenti e da fare; le voci «in arrivo» non lo aumentano.</p>`;
  return adminLayout(ctx, { title: 'Da fare', active: '/admin/todo', body });
}

/** Una riga «etichetta / valore» della scheda. */
const row = (label, value) => (value ? html`<div><dt>${label}</dt><dd>${value}</dd></div>` : '');

/** La scheda operativa di un giorno: i servizi in ordine d'orario con tutto ciò che serve per farli. */
export function dayPage(ctx, { sheet, flash = '' }) {
  const { date, totals: t } = sheet;
  const today = nowRome().date;
  const item = (s) => html`<article class="card pad day-item ${s.confirmed ? '' : 'is-option'}">
    <header class="day-head"><span class="day-time"><strong>${s.start}</strong><small>${s.end}</small></span>
      <h3>${s.title}</h3>
      ${s.confirmed ? '' : html`<span class="chip chip-warn">Opzione</span>`}${s.collectCents ? html`<span class="chip chip-err">Da incassare ${eur(s.collectCents)}</span>` : ''}</header>
    <dl class="summary-list">
      ${row('Persone', [plural(s.people, 'persona', 'persone'), s.tourLang, s.service].filter(Boolean).join(' · '))}
      ${s.meeting ? html`<div><dt>Incontro</dt><dd>${s.meeting}${s.meetingUrl ? html` · <a href="${s.meetingUrl}" target="_blank" rel="noopener">mappa</a>` : ''}</dd></div>` : ''}
      ${row('Tema', s.theme)}
      ${s.b2b ? html`${row('Agenzia', [s.agency, s.agencyContact].filter(Boolean).join(' · '))}${row('Cliente', [s.clientRef, s.name, s.phone].filter(Boolean).join(' · '))}` : row('Cliente', [s.name, s.phone, s.email].filter(Boolean).join(' · '))}
      ${row('Note del cliente', s.notes)}
      ${s.adminNotes ? html`<div class="day-note"><dt>Le tue note</dt><dd>${s.adminNotes}</dd></div>` : ''}
      ${row('Pagamento', s.pay)}
    </dl>
    <p class="small"><a href="/admin/bookings/${s.id}">Apri la prenotazione ${s.ref}</a></p>
  </article>`;
  const body = html`
<form class="day-tools" method="get" action="/admin/day">
  <a class="btn btn-sm btn-outline" href="/admin/day?date=${addDays(date, -1)}" aria-label="Giorno prima">←</a>
  <input type="date" name="date" value="${date}" data-autosubmit aria-label="Giorno">
  <a class="btn btn-sm btn-outline" href="/admin/day?date=${addDays(date, 1)}" aria-label="Giorno dopo">→</a>
  <a class="btn btn-sm btn-outline" href="/admin/day?date=${today}">Oggi</a><a class="btn btn-sm btn-outline" href="/admin/day?date=${addDays(today, 1)}">Domani</a>
  <button class="btn btn-sm btn-outline" type="button" data-print>Stampa</button>
  <a class="btn btn-sm btn-outline" href="/admin/day.pdf?date=${date}" target="_blank" rel="noopener">PDF</a>
  <button class="btn btn-sm btn-outline" type="submit" formmethod="post" formaction="/admin/day/send">Invia a me</button>
</form>
<h2 class="h-sub day-title">${fmtDate(date, 'it')}${date === today ? html` <span class="chip chip-accent">Oggi</span>` : ''}</h2>
<div class="grid grid-3 kpis">
  <div class="card pad kpi"><span class="muted">Servizi</span><strong>${t.services}</strong>${t.options ? html`<small>+ ${plural(t.options, 'opzione aperta', 'opzioni aperte')}</small>` : html`<small>confermati</small>`}</div>
  <div class="card pad kpi"><span class="muted">Persone</span><strong>${t.people}</strong><small>nei servizi confermati</small></div>
  <div class="card pad kpi"><span class="muted">Da incassare sul posto</span><strong>${eur(t.collectCents)}</strong><small>${t.collectCents ? 'pagamenti il giorno del servizio' : 'niente da incassare'}</small></div>
</div>
${sheet.services.length || sheet.programs.length || sheet.blocks.length
  ? html`${sheet.programs.map((p) => html`<article class="card pad day-item"><header class="day-head"><span class="day-time"><strong>${p.start}</strong><small>${p.end}</small></span><h3>${p.title}</h3><span class="chip">Programma</span></header><dl class="summary-list">${row('Per', [p.who, plural(p.people, 'persona', 'persone')].filter(Boolean).join(' · '))}</dl><p class="small"><a href="/admin/programs/${p.id}">Apri il programma ${p.ref}</a></p></article>`)}
    ${sheet.services.map(item)}
    ${sheet.blocks.map((b) => html`<article class="card pad day-item"><header class="day-head"><span class="day-time"><strong>${b.start}</strong><small>${b.end}</small></span><h3>${b.title}</h3><span class="chip">Fuori dal sito</span></header>${b.details ? html`<dl class="summary-list">${row('Note', b.details)}</dl>` : ''}</article>`)}`
  : html`<p class="card pad muted">Nessun servizio in questo giorno.</p>`}`;
  return adminLayout(ctx, { title: 'Scheda del giorno', active: '/admin/day', body, flash, scripts: raw('<script src="/js/admin-day.js" defer></script>') });
}
