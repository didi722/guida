import { html, raw } from '../html.js';
import { bookingDue, cancellationState } from '../bookings.js';
import { makeT } from '../i18n.js';
import { bookingPeople, bookingPeopleShort, partyCompact, partyOfBooking } from '../party.js';
import { splitAmounts } from '../policy.js';
import { isSimplePolicy, tierSentences } from '../policyText.js';
import { dayOfWeek, fmtDate, fmtMonth, monthDates, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { LANG_META, langName, normLang } from '../langs.js';
import { parseServiceRecord, serviceNote } from '../rates.js';
import { todoBadge } from '../todo.js';
import { quoteLines } from './hourly.js';
import { meetingOf, themeText } from '../choices.js';

// Il menu in alto ha poche voci (i gruppi); dentro ogni gruppo una riga di schede porta alle singole pagine.
export const ADMIN_GROUPS = [
  { label: 'Agenda', items: [['/admin', 'Agenda'], ['/admin/todo', 'Da fare'], ['/admin/day', 'Scheda del giorno'], ['/admin/bookings', 'Prenotazioni'], ['/admin/programs', 'Programmi'], ['/admin/availability', 'Disponibilità'], ['/admin/waitlist', 'Lista d’attesa']] },
  { label: 'Clienti', items: [['/admin/partners', 'Partner'], ['/admin/discounts', 'Sconti'], ['/admin/feedback', 'Feedback']] },
  { label: 'Conti', items: [['/admin/invoices', 'Fatture'], ['/admin/stats', 'Statistiche']] },
  { label: 'Sito', items: [['/admin/tours', 'Tour B2C'], ['/admin/tours-b2b', 'Tour B2B'], ['/admin/prices', 'Listino'], ['/admin/rates', 'Tariffe a ore'], ['/admin/blog', 'Blog'], ['/admin/pages', 'Pagine'], ['/admin/texts', 'Testi'], ['/admin/media', 'Immagini'], ['/admin/periods', 'Periodi'], ['/admin/settings', 'Impostazioni']] },
  { label: 'Aiuto', items: [['/admin/guide', 'Guida'], ['/admin/backup', 'Backup'], ['/admin/security', 'Sicurezza'], ['/admin/mail', 'Email']] },
];

const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const STATUS_IT = { confirmed: 'Confermata', held: 'In attesa di pagamento', option: 'Opzione', cancelled: 'Annullata', expired: 'Scaduta' };
export const PAY_IT = { card: 'Carta', onsite: 'Sul posto', invoice: 'Fattura', giftcard: 'Buono regalo', free: 'Gratuita' };
export const PAYSTATUS_IT = { unpaid: 'Da incassare', paid: 'Pagata', refunded: 'Rimborsata', refund_failed: 'Rimborso fallito' };
const chipFor = (s) => ({ confirmed: 'chip-ok', held: 'chip-warn', option: 'chip-warn', cancelled: 'chip-err', expired: 'chip-err' }[s] ?? '');
/** Stato in parole per le liste: un'opzione scaduta non è una prenotazione «scaduta» (non si è pagato nulla), è un'opzione terminata. */
export const statusLabel = (b) => (b.status === 'expired' && b.option_expires_at ? 'Opzione terminata' : STATUS_IT[b.status]);
const untilIt = (iso) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function adminLayout(ctx, { title, active, body, flash = '', error = '', scripts = '', styles = [] }) {
  const { app } = ctx;
  const group = ADMIN_GROUPS.find((g) => g.items.some(([href]) => href === active));
  return html`<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · Admin</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/style.css?v=${app.assetVersion}">${styles.map((href) => html`<link rel="stylesheet" href="${href}?v=${app.assetVersion}">`)}<script src="/js/theme.js"></script>
</head><body class="admin">
<header class="admin-bar"><div class="admin-bar-inner">
  <a class="brand" href="/admin"><span class="brand-name">${app.cfg.site.name}</span><span class="brand-sub">Pannello</span></a>
  <nav class="admin-nav" aria-label="Admin">${ADMIN_GROUPS.map((g) => html`<a href="${g.items[0][0]}" ${g === group ? raw('aria-current="page"') : ''}>${g.label}</a>`)}</nav>
  <form method="post" action="/admin/logout"><button class="tool" type="submit" title="Esci">Esci</button></form>
</div></header>
<main class="wrap admin-main">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${group && group.items.length > 1 ? html`<nav class="tabs admin-subnav" aria-label="${group.label}">${group.items.map(([href, label]) => html`<a href="${href}" ${active === href ? raw('aria-current="page"') : ''}>${label}${href === '/admin/todo' && todoBadge(app) ? html` <span class="tab-n">${todoBadge(app)}</span>` : ''}</a>`)}</nav>` : ''}
  <h1>${title}</h1>
  ${body}
</main>
<script src="/js/main.js?v=${app.assetVersion}" defer></script>
<script src="/js/datepicker.js?v=${app.assetVersion}" defer></script>
<script src="/js/combo.js?v=${app.assetVersion}" defer></script>
<script src="/js/party.js?v=${app.assetVersion}" defer></script>
<script src="/js/keep-scroll.js?v=${app.assetVersion}" data-links defer></script>
${raw(scripts)}
</body></html>`;
}

/** Riga «Fattura» nelle schede di prenotazioni, buoni e programmi. */
export function invoiceRow(invoice, { warn = false } = {}) {
  if (!invoice) return html`<div><dt>Fattura</dt><dd class="muted">non ancora fatturata · <a href="/admin/invoices">Fatture</a></dd></div>`;
  return html`<div><dt>Fattura</dt><dd><a href="/admin/invoices/${invoice.id}">${invoice.number ? `n. ${invoice.number}` : 'bozza'}</a>${warn && invoice.number ? html`<br><small class="field-error">Se la annulli, stornala con una nota di credito.</small>` : ''}</dd></div>`;
}

export function adminLoginPage(ctx, { error = '' } = {}) {
  return html`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Accesso · Admin</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/style.css?v=${ctx.app.assetVersion}"><script src="/js/theme.js"></script></head>
<body class="admin"><main class="wrap narrow admin-login">
  <h1>${ctx.app.cfg.site.name}</h1><p class="muted">Pannello di gestione</p>
  <div class="card pad">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <form method="post" action="/admin/login" class="form">
      <label class="field"><span class="label">Password</span><input type="password" name="password" required autofocus autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" data-password></label>
      <label class="check"><input type="checkbox" data-show-password> Mostra la password</label>
      <button class="btn btn-gold btn-block" type="submit">Entra</button>
    </form>
  </div>
</main><script src="/js/admin-login.js?v=${ctx.app.assetVersion}" defer></script></body></html>`;
}

function bookingRow(ctx, b) {
  const tour = ctx.app.content.tour(b.tour_slug);
  return html`<a class="agenda-item" href="/admin/bookings/${b.id}">
    <span class="agenda-time"><strong>${b.start_time}</strong><small>${b.end_time}</small></span>
    <span class="agenda-main"><strong>${tour?.i18n.it.title ?? b.tour_slug}</strong>
      <small>${bookingPeopleShort(b)}${b.tour_lang ? ` · ${b.tour_lang.toUpperCase()}` : ''} · ${b.name}${b.client_ref ? ' · ' + b.client_ref : ''}${b.channel === 'b2b' ? ' · B2B' : ''}</small></span>
    <span class="agenda-state"><span class="chip ${chipFor(b.status)}">${statusLabel(b)}</span><small>${b.status === 'option' ? `fino al ${untilIt(b.option_expires_at)}` : `${PAY_IT[b.payment_method]} · ${PAYSTATUS_IT[b.payment_status]}`}</small></span>
  </a>`;
}

function programRow(d) {
  return html`<a class="agenda-item agenda-program" href="/admin/programs/${d.pid}">
    <span class="agenda-time"><strong>${d.start_time}</strong><small>${d.end_time}</small></span>
    <span class="agenda-main"><strong>${d.title}</strong><small>Programma ${d.ref} · ${d.name} · ${d.participants} pers.</small></span>
    <span class="agenda-state"><span class="chip ${d.status === 'confirmed' ? 'chip-ok' : 'chip-warn'}">${d.status === 'confirmed' ? 'Programma' : 'Manca l’acconto'}</span>${d.conflicts.length ? html`<small class="field-error">⚠ si sovrappone a un altro impegno</small>` : ''}</span>
  </a>`;
}

const allDay = (b) => b.start_time === '00:00' && b.end_time >= '23:59';
/** Un impegno fuori dal sito (tour privato preso per email o di persona, altra agenzia): toglie le ore dalle disponibilità. */
function blockRow(b) {
  const label = b.title || b.note || 'Impegno';
  return html`<div class="agenda-item agenda-private">
    <span class="agenda-time">${allDay(b) ? html`<strong>Tutto</strong><small>il giorno</small>` : html`<strong>${b.start_time}</strong><small>${b.end_time}</small>`}</span>
    <span class="agenda-main"><strong>${label}</strong><small>${b.blockKind === 'private' ? 'Tour privato fuori dal sito' : 'Impegno esterno'}${b.details ? ' · ' + b.details : ''}</small></span>
    <span class="agenda-state"><span class="chip">Non prenotabile</span>
      <form method="post" action="/admin/agenda/block/${b.id}/delete" class="inline-form" data-confirm="Togliere questo impegno dall’agenda? Quelle ore torneranno prenotabili."><input type="hidden" name="d" value="${b.date}"><button class="btn btn-outline btn-sm" type="submit">Elimina</button></form>
      ${b.series ? html`<form method="post" action="/admin/agenda/block/${b.id}/delete" class="inline-form" data-confirm="Togliere dall’agenda tutti i giorni di questo impegno?"><input type="hidden" name="all" value="1"><input type="hidden" name="d" value="${b.date}"><button class="btn btn-outline btn-sm" type="submit">Elimina tutti i giorni</button></form>` : ''}</span>
  </div>`;
}
const agendaRow = (ctx, b) => (b.kind === 'program' ? programRow(b) : b.kind === 'block' ? blockRow(b) : bookingRow(ctx, b));

function calendarWarning(problems) {
  return problems?.length
    ? html`<div class="notice notice-err" role="alert"><strong>Calendario non aggiornato.</strong> ${problems.map((p) => `«${p.name}»`).join(', ')}: l’ultima lettura riuscita è troppo vecchia, quindi le disponibilità potrebbero non tenere conto dei tuoi impegni. <a href="/admin/availability">Controlla</a></div>`
    : '';
}

const SHORT = (title, n = 15) => (title.length > n ? `${title.slice(0, n - 1).trimEnd()}…` : title);
const EV_CLASS = { confirmed: 'ev-ok', held: 'ev-wait', option: 'ev-opt' };

/** Il calendario del mese dell'agenda: ogni giorno con i suoi servizi in miniatura; toccando un giorno se ne vede il dettaglio sotto. */
function agendaCalendar(ctx, cal, today) {
  const { month, prev, next, cells, selected, selectedItems } = cal;
  const href = (m, d = '') => `/admin?v=cal&m=${m}${d ? `&d=${d}` : ''}`;
  const title = (b) => (b.kind === 'program' ? b.title : b.kind === 'block' ? b.title || b.note || 'Impegno' : ctx.app.content.tour(b.tour_slug)?.i18n.it.title ?? b.tour_slug);
  return html`
<div class="acal-head"><a class="btn btn-sm btn-outline" href="${href(prev)}" aria-label="Mese precedente">←</a><strong class="acal-title">${fmtMonth(month, 'it')}</strong><a class="btn btn-sm btn-outline" href="${href(next)}" aria-label="Mese successivo">→</a>
  ${month !== today.slice(0, 7) || selected !== today ? html`<a class="btn btn-sm btn-outline" href="${href(today.slice(0, 7), today)}">Oggi</a>` : html`<span class="btn btn-sm btn-outline is-ghost" aria-hidden="true">Oggi</span>`}</div>
<div class="acal" role="grid" aria-label="Agenda di ${fmtMonth(month, 'it')}">
  ${['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((d) => html`<span class="acal-dow">${d}</span>`)}
  ${cells.map((c) => html`<a class="acal-cell ${c.inMonth ? '' : 'is-other'} ${c.date === today ? 'is-today' : ''} ${c.date === selected ? 'is-selected' : ''} ${c.closed ? 'is-closed' : ''} ${c.items.length ? 'has-items' : ''}" href="${href(month, c.date)}#giorno" aria-label="${fmtDate(c.date, 'it', 'weekday')}${c.closed ? ', chiuso' : ''}: ${c.items.length ? `${c.items.length} ${c.items.length === 1 ? 'servizio' : 'servizi'}` : 'libero'}">
    <span class="acal-n">${Number(c.date.slice(8))}</span>
    <span class="acal-evs">${c.items.slice(0, 3).map((b) => html`<span class="acal-ev ${b.kind === 'program' ? 'ev-prog' : b.kind === 'block' ? 'ev-priv' : EV_CLASS[b.status] ?? 'ev-ok'}" title="${allDay(b) ? '' : b.start_time + ' '}${title(b)}">${allDay(b) ? '' : b.start_time + ' '}${SHORT(title(b))}</span>`)}${c.items.length > 3 ? html`<span class="acal-more">+${c.items.length - 3}</span>` : ''}</span>
    ${c.items.length ? html`<span class="acal-count" aria-hidden="true">${c.items.length}</span>` : ''}
    ${c.closed ? html`<span class="acal-closed">chiuso</span>` : ''}
  </a>`)}
</div>
<p class="small muted acal-legend"><span class="legend ev-ok"></span> confermata · <span class="legend ev-opt"></span> opzione (data trattenuta) · <span class="legend ev-wait"></span> in attesa di pagamento · <span class="legend ev-prog"></span> programma di più giorni · <span class="legend ev-priv"></span> impegno fuori dal sito · tocca un giorno per vederlo qui sotto.</p>
<section class="agenda-day" id="giorno"><h3>${fmtDate(selected, 'it')}${selected === today ? html` <span class="chip chip-accent">Oggi</span>` : ''}${cells.find((c) => c.date === selected)?.closed ? html` <span class="chip chip-warn">chiuso</span>` : ''}</h3>
  ${selectedItems.length ? html`<div class="card">${selectedItems.map((b) => agendaRow(ctx, b))}</div>` : html`<p class="muted">Nessun servizio in questo giorno.</p>`}</section>`;
}

export function dashboardPage(ctx, { today, view = 'cal', days = [], calendar = null, pendingPartners, held, options = { n: 0, next: null, requests: 0 }, programs, invoicesDue = 0, invoicesOverdue = 0, waiting = 0, feedUrl, flash, problems, preOpening = null }) {
  const selectedDay = calendar?.selected ?? today;
  const body = html`
${calendarWarning(problems)}
${preOpening ? html`<div class="notice notice-info" role="note"><strong>Pre-apertura:</strong> fino al ${fmtDate(preOpening, 'it', 'date')} il sito accetta prenotazioni (solo per date da quel giorno in poi) senza incassare online: i privati pagano il giorno del servizio, le agenzie a fattura. <a href="/admin/settings?s=rules#rules">Cambia la data</a></div>` : ''}
${options.requests ? html`<div class="notice notice-info" role="note"><strong>${options.requests} ${options.requests === 1 ? 'richiesta di proroga' : 'richieste di proroga'} da decidere.</strong> <a href="/admin/bookings?f=options">Apri le opzioni</a></div>` : ''}
${waiting ? html`<div class="notice notice-info" role="note"><strong>${waiting === 1 ? '1 agenzia aspetta' : `${waiting} agenzie aspettano`} una data libera.</strong> <a href="/admin/waitlist">Apri la lista d’attesa</a></div>` : ''}
${invoicesOverdue ? html`<div class="notice notice-err" role="alert"><strong>${invoicesOverdue === 1 ? '1 fattura scaduta e non incassata' : `${invoicesOverdue} fatture scadute e non incassate`}.</strong> <a href="/admin/invoices?tab=issued">Apri le fatture</a></div>` : ''}
${invoicesDue ? html`<div class="notice notice-err" role="alert"><strong>${invoicesDue} ${invoicesDue === 1 ? 'voce' : 'voci'} da fatturare oltre i 12 giorni.</strong> <a href="/admin/invoices">Apri le fatture</a></div>` : ''}
<div class="grid grid-4 kpis">
  <div class="card pad kpi"><span class="muted">Oggi</span><strong>${(view === 'list' ? days.find((d) => d.date === today)?.items.length : calendar?.todayCount) ?? 0}</strong><small>servizi</small></div>
  <div class="card pad kpi"><span class="muted">Programmi da preparare</span><strong>${programs.todo}</strong><small>${programs.waiting} in attesa del cliente</small><a href="/admin/programs">Apri</a></div>
  <div class="card pad kpi"><span class="muted">Partner da approvare</span><strong>${pendingPartners}</strong><a href="/admin/partners">Apri</a></div>
  <div class="card pad kpi"><span class="muted">Opzioni aperte</span><strong>${options.n}</strong><small>${options.next ? `la prima scade il ${untilIt(options.next)}` : 'date trattenute dalle agenzie'}</small>${options.n ? html`<a href="/admin/bookings?f=options">Apri</a>` : ''}</div>
  <div class="card pad kpi"><span class="muted">Pagamenti in corso</span><strong>${held}</strong><small>slot trattenuti</small></div>
</div>
<div class="agenda-head spaced"><h2 class="h-sub">Agenda</h2>
  <nav class="tabs view-tabs" aria-label="Come vedere l’agenda"><a href="/admin?v=cal" ${view === 'cal' ? raw('aria-current="page"') : ''}>Calendario</a><a href="/admin?v=list" ${view === 'list' ? raw('aria-current="page"') : ''}>Elenco, 14 giorni</a></nav></div>
${view === 'cal' && calendar
  ? agendaCalendar(ctx, calendar, today)
  : days.filter((d) => d.items.length).length
    ? days.filter((d) => d.items.length).map((d) => html`<section class="agenda-day"><h3>${fmtDate(d.date, 'it')}${d.date === today ? html` <span class="chip chip-accent">Oggi</span>` : ''}</h3><div class="card">${d.items.map((b) => agendaRow(ctx, b))}</div></section>`)
    : html`<p class="muted">Nessuna prenotazione nei prossimi 14 giorni.</p>`}
<h2 class="h-sub spaced" id="privato">Un tour preso fuori dal sito?</h2>
<p class="card pad"><strong>Lo ha preso un’agenzia?</strong> <a class="btn btn-outline btn-sm" href="/admin/agenda/agency?date=${selectedDay}">Registra una prenotazione di un’agenzia</a> <span class="muted small">con il prezzo concordato: compare nell’agenda e nell’area dell’agenzia, come se l’avesse fatta online.</span></p>
<form class="card pad form" method="post" action="/admin/agenda/private">
  <p class="muted">Un cliente che ti ha scritto, una prenotazione di persona, un’altra agenzia: scrivila qui e quelle ore (o quei giorni) spariscono dalle disponibilità del sito, così nessuno le prenota per sbaglio.</p>
  <label class="field"><span class="label">Cosa è</span><input name="title" required maxlength="120" placeholder="es. Tour privato, famiglia Rossi"></label>
  <div class="form-grid">
    <label class="field"><span class="label">Dal giorno</span><input type="date" name="from" required value="${selectedDay}"></label>
    <label class="field"><span class="label">Al giorno <em>(se dura più giorni)</em></span><input type="date" name="to"></label>
  </div>
  <label class="check"><input type="checkbox" name="allDay" value="1" data-allday checked> Tutto il giorno</label>
  <div class="form-grid" data-times hidden>
    <label class="field"><span class="label">Dalle</span><input type="time" name="start" value="09:00"></label>
    <label class="field"><span class="label">Alle</span><input type="time" name="end" value="13:00"></label>
  </div>
  <label class="field"><span class="label">Note <em>(facoltativo)</em></span><textarea name="details" rows="2" maxlength="600" placeholder="contatto, punto d’incontro, prezzo concordato…"></textarea></label>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Aggiungi all’agenda</button></div>
</form>
<h2 class="h-sub spaced">Calendario sul telefono</h2>
<div class="card pad"><p>Aggiungi questo indirizzo come <strong>calendario in abbonamento</strong> (Google Calendar, Apple Calendar, Outlook) per vedere le prenotazioni confermate (e le opzioni) insieme ai tuoi impegni. L'indirizzo è privato: non condividerlo.</p>
<p><input class="copy-field" readonly value="${feedUrl}" data-select-all></p></div>`;
  return adminLayout(ctx, { title: 'Agenda', active: '/admin', body, flash, scripts: `<script src="/js/admin-agenda.js?v=${ctx.app.assetVersion}" defer></script>` });
}

export function bookingsPage(ctx, { items, filter, q }) {
  const tabs = [['upcoming', 'Prossime'], ['options', 'Opzioni'], ['past', 'Passate'], ['cancelled', 'Annullate'], ['all', 'Tutte']];
  const body = html`
<div class="tabs">${tabs.map(([k, l]) => html`<a href="/admin/bookings?f=${k}" ${filter === k ? raw('aria-current="page"') : ''}>${l}</a>`)}
  <form class="search-inline" method="get" action="/admin/bookings"><input type="hidden" name="f" value="${filter}"><input type="search" name="q" value="${q}" placeholder="Cerca nome, email, codice…"><button class="btn btn-sm btn-outline" type="submit">Cerca</button></form></div>
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Servizio</th><th>Cliente</th><th class="num">Pers.</th><th>Stato</th><th class="num">Totale</th></tr></thead><tbody>
    ${items.map((b) => html`<tr><td><a href="/admin/bookings/${b.id}">${fmtDate(b.date, 'it', 'short')}</a><br><small class="muted">${b.start_time}–${b.end_time}</small></td>
      <td>${ctx.app.content.tour(b.tour_slug)?.i18n.it.title ?? b.tour_slug}<br><small class="muted">${b.ref}${b.channel === 'b2b' ? ' · B2B' : ''}${b.group_ref ? ` · pacchetto ${b.group_ref}` : ''}</small></td>
      <td>${b.name}<br><small class="muted">${b.client_ref ?? b.email}</small></td><td class="num">${partyCompact(partyOfBooking(b))}</td>
      <td><span class="chip ${chipFor(b.status)}">${statusLabel(b)}</span><br><small class="muted">${b.status === 'option' ? `fino al ${untilIt(b.option_expires_at)}` : `${PAY_IT[b.payment_method]} · ${PAYSTATUS_IT[b.payment_status]}`}</small></td>
      <td class="num">${formatMoney(b.total_cents, 'it', b.currency)}</td></tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessuna prenotazione.</p>`}`;
  return adminLayout(ctx, { title: 'Prenotazioni', active: '/admin/bookings', body });
}

/** Cosa succede annullando adesso secondo la politica della prenotazione. */
function cancelPreview(b, st) {
  if (b.status !== 'confirmed') return 'Secondo la politica (nulla da pagare: era in attesa di pagamento)';
  const due = bookingDue(b);
  const paid = b.payment_status === 'paid';
  const { refundCents, retainedCents } = splitAmounts({ paidCents: paid ? due : 0, dueCents: due }, st.percent);
  if (paid) return `Secondo la politica: oggi ${st.percent}% → rimborso ${formatMoney(refundCents, 'it', b.currency)}${retainedCents ? `, trattenuti ${formatMoney(retainedCents, 'it', b.currency)}` : ''}`;
  return `Secondo la politica: oggi ${st.percent}% → ${retainedCents ? `penale ${formatMoney(retainedCents, 'it', b.currency)} da fatturare` : 'nessuna penale'}`;
}

/** La composizione registrata in una riga dello storico delle modifiche (le più vecchie non hanno bambini né infanti). */
const snapParty = (s) => ({ adults: s.pax - (s.children ?? 0) - (s.infants ?? 0), children: s.children ?? 0, infants: s.infants ?? 0 });

/** Una modifica in una riga: solo ciò che è cambiato (persone, data, orario, prezzo). */
function changeSummary(before, after, currency) {
  const parts = [];
  if (before.pax !== after.pax || (before.children ?? 0) !== (after.children ?? 0) || (before.infants ?? 0) !== (after.infants ?? 0)) parts.push(`persone ${partyCompact(snapParty(before))} → ${partyCompact(snapParty(after))}`);
  if (before.date !== after.date) parts.push(`data ${fmtDate(before.date, 'it', 'short')} → ${fmtDate(after.date, 'it', 'short')}`);
  if (before.time !== after.time || before.end !== after.end) parts.push(`orario ${before.time}–${before.end} → ${after.time}–${after.end}`);
  if (before.totalCents !== after.totalCents) parts.push(`prezzo ${formatMoney(before.totalCents, 'it', currency)} → ${formatMoney(after.totalCents, 'it', currency)}${after.custom ? ' (concordato)' : ''}`);
  return parts.join('; ') || 'nessun dato cambiato';
}

export function bookingDetailPage(ctx, b, account, flash = '', invoice = null, pkg = null, extension = null, history = []) {
  const tour = ctx.app.content.tour(b.tour_slug);
  const st = cancellationState(b);
  const live = b.status === 'confirmed' || b.status === 'held' || b.status === 'option';
  const service = parseServiceRecord(b.service_json);
  const today = nowRome().date;
  const wa = b.phone ? b.phone.replace(/[^\d]/g, '') : '';
  const body = html`
<p><a href="/admin/bookings">← Tutte le prenotazioni</a></p>
<div class="grid grid-2 admin-detail">
  <div class="card pad">
    <p class="ref-line"><span class="chip ${chipFor(b.status)}">${statusLabel(b)}</span> <strong class="ref">${b.ref}</strong> <span class="muted">${b.channel === 'b2b' ? 'B2B' : 'Privato'}</span></p>
    <h2>${tour?.i18n.it.title ?? b.tour_slug}</h2>
    <dl class="summary-list">
      <div><dt>Data</dt><dd>${fmtDate(b.date, 'it')}</dd></div>
      <div><dt>Orario</dt><dd>${b.start_time}–${b.end_time}</dd></div>
      <div><dt>Persone</dt><dd>${bookingPeople(b, 'it')}</dd></div>
      ${tour?.meetingChoice ? html`<div><dt>Punto d’incontro</dt><dd>${meetingOf(tour, b, 'it').text}${b.pickup ? '' : html` <span class="muted">(standard: il cliente non ha indicato nulla)</span>`}</dd></div>` : ''}
      ${themeText(b, 'it') ? html`<div><dt>Scelta del cliente</dt><dd>${themeText(b, 'it')}</dd></div>` : ''}
      ${b.tour_lang && LANG_META[b.tour_lang] ? html`<div><dt>Lingua del tour</dt><dd>${LANG_META[b.tour_lang].name}</dd></div>` : ''}
      ${service ? html`<div><dt>Servizio a ore</dt><dd>${serviceNote(service)}</dd></div>${quoteLines(makeT('it'), 'it', service, { total: false })}` : ''}
      ${b.status === 'option' ? html`<div><dt>Opzione</dt><dd>data trattenuta fino al <strong>${untilIt(b.option_expires_at)}</strong>${Date.parse(b.option_expires_at) - Date.now() < 48 * 3600_000 ? html` <span class="chip chip-warn">scade a breve</span>` : ''}<br><small class="muted">L’agenzia non ha pagato nulla: se non conferma entro la scadenza, la data si libera da sola.</small></dd></div>`
        : b.status === 'expired' && b.option_expires_at ? html`<div><dt>Opzione</dt><dd>terminata${b.cancelled_at ? ` il ${untilIt(b.cancelled_at)}` : ''}${b.cancel_reason ? ` · ${b.cancel_reason}` : ''}<br><small class="muted">Scadenza prevista: ${untilIt(b.option_expires_at)}. Nessun costo.</small></dd></div>`
        : b.option_expires_at ? html`<div><dt>Opzione</dt><dd>confermata dall’agenzia (scadenza prevista: ${untilIt(b.option_expires_at)})</dd></div>` : ''}
      ${pkg ? html`<div><dt>Pacchetto</dt><dd><a href="/${normLang(pkg.group.lang)}/packages/${pkg.group.ref}?t=${pkg.group.token}"><strong>${pkg.group.ref}</strong></a> · ${pkg.bookings.length} servizi · ${formatMoney(pkg.bookings.filter((x) => ['confirmed', 'held', 'option'].includes(x.status)).reduce((a, x) => a + bookingDue(x), 0), 'it', pkg.group.currency)}
        <ul class="plain">${pkg.bookings.map((x) => html`<li>${x.id === b.id ? html`<strong>questo</strong>` : html`<a href="/admin/bookings/${x.id}">${x.ref}</a>`} · ${fmtDate(x.date, 'it', 'short')} ${x.start_time} · <span class="chip ${chipFor(x.status)}">${statusLabel(x)}</span>${x.payment_status === 'unpaid' && x.status === 'confirmed' ? html` · da incassare` : ''}</li>`)}</ul></dd></div>` : ''}
      <div><dt>Pagina del cliente</dt><dd><a href="/${normLang(b.lang)}/booking/${b.ref}?t=${b.token}">Apri come la vede il cliente</a> <small class="muted">(da qui si prova anche l’annullo)</small></dd></div>
      ${b.discount_cents ? html`<div><dt>Sconto</dt><dd>${b.promo_code} · −${formatMoney(b.discount_cents, 'it', b.currency)} (listino ${formatMoney(b.list_cents, 'it', b.currency)})</dd></div>` : ''}
      ${b.gift_cents ? html`<div><dt>Buono regalo</dt><dd>−${formatMoney(b.gift_cents, 'it', b.currency)}</dd></div>` : ''}
      <div><dt>${b.discount_cents || b.gift_cents ? 'Da pagare' : 'Totale'}</dt><dd>${formatMoney(b.total_cents - b.gift_cents, 'it', b.currency)} · ${PAY_IT[b.payment_method]} · <strong>${PAYSTATUS_IT[b.payment_status]}</strong>${b.refund_cents ? ` (rimborsati ${formatMoney(b.refund_cents, 'it', b.currency)})` : ''}</dd></div>
      ${isSimplePolicy(st.tiers)
        ? html`<div><dt>Cancellazione gratuita fino a</dt><dd>${new Date(b.free_cancel_until).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'medium', timeStyle: 'short' })} ${st.free ? html`<span class="chip chip-ok">ancora valida</span>` : html`<span class="chip chip-warn">scaduta</span>`}</dd></div>`
        : html`<div><dt>Politica di annullo</dt><dd><ul class="plain tier-list">${tierSentences(makeT('it'), 'it', st.tiers, st.startsAt).map((x) => html`<li>${x}</li>`)}</ul>${b.status === 'confirmed' ? html`<span class="chip ${st.percent === 100 ? 'chip-ok' : 'chip-warn'}">oggi: rimborso ${st.percent}%</span>` : ''}</dd></div>`}
      ${b.channel === 'b2c' && b.status === 'confirmed' && b.date >= today ? html`<div><dt>Promemoria al cliente</dt><dd>${b.reminder_status === 'sent' ? `inviato il ${new Date(b.reminder_sent_at).toLocaleDateString('it-IT')}` : b.reminder_status === 'skipped' ? 'non verrà inviato' : ctx.app.cfg.reminders.enabled ? `parte la sera prima, alle ${String(ctx.app.cfg.reminders.sendHour).padStart(2, '0')}:00` : 'disattivato (vedi Sito › Impostazioni)'}
        ${!b.reminder_status ? html`<form method="post" action="/admin/bookings/${b.id}/reminder" class="inline-form"><button class="btn btn-sm btn-outline" type="submit" name="action" value="send">Invia ora</button> <button class="btn btn-sm btn-outline" type="submit" name="action" value="skip">Non inviare</button></form>` : ''}</dd></div>` : ''}
      ${b.channel === 'b2c' && b.status === 'confirmed' ? html`<div><dt>Richiesta recensione</dt><dd>${b.review_status === 'sent' ? `inviata il ${new Date(b.review_sent_at).toLocaleDateString('it-IT')}` : b.review_status === 'skipped' ? 'non verrà inviata' : 'parte il giorno dopo il tour'}
        ${!b.review_status ? html`<form method="post" action="/admin/bookings/${b.id}/review" class="inline-form"><button class="btn btn-sm btn-outline" type="submit" name="action" value="send">Invia ora</button> <button class="btn btn-sm btn-outline" type="submit" name="action" value="skip">Non inviare</button></form>` : ''}</dd></div>` : ''}
      ${b.status === 'cancelled' ? html`<div><dt>Annullata</dt><dd>${b.cancelled_by ?? ''}${b.cancel_reason ? ' · ' + b.cancel_reason : ''}</dd></div>
      ${b.cancel_percent != null ? html`<div><dt>Esito dell'annullo</dt><dd>rimborso ${b.cancel_percent}%${b.refund_cents ? ` · rimborsati ${formatMoney(b.refund_cents, 'it', b.currency)}` : ''}${b.retained_cents ? html` · <strong>penale ${formatMoney(b.retained_cents, 'it', b.currency)}</strong> ${b.payment_status === 'unpaid' ? 'da fatturare' : 'trattenuta'}` : ''}</dd></div>` : ''}` : ''}
      ${b.status === 'confirmed' || invoice ? invoiceRow(invoice, { warn: true }) : ''}
    </dl>
    ${b.refund_pending_cents > 0 ? html`<div class="notice notice-err" role="alert"><p><strong>Rimborso da fare: ${formatMoney(b.refund_pending_cents, 'it', b.currency)}.</strong> La modifica ha abbassato il prezzo, ma il rimborso sulla carta non è partito: fallo da Stripe e poi segnalo qui.</p>
      <form method="post" action="/admin/bookings/${b.id}/refund-done" class="inline-form" data-confirm="Hai già rimborsato ${formatMoney(b.refund_pending_cents, 'it', b.currency)} da Stripe?"><button class="btn btn-outline btn-sm" type="submit">Fatto, l’ho rimborsato</button></form></div>` : ''}
    ${(b.status === 'confirmed' || b.status === 'option') && !invoice ? html`<p class="btn-row"><a class="btn btn-outline btn-sm" href="/admin/bookings/${b.id}/edit">Modifica persone, data, ore o prezzo</a></p>` : ''}
    ${b.status === 'confirmed' ? html`<p class="btn-row"><a class="btn btn-outline btn-sm" href="/admin/bookings/${b.id}/voucher.pdf" target="_blank" rel="noopener">Voucher PDF</a> ${['it', 'en', 'es', 'ja'].map((l) => html`<a class="chip chip-link" href="/admin/bookings/${b.id}/voucher.pdf?vl=${l}" target="_blank" rel="noopener">${l.toUpperCase()}</a>`)}</p>` : ''}
  </div>
  <div class="card pad">
    <h2>Cliente</h2>
    <dl class="summary-list">
      <div><dt>Nome</dt><dd>${b.name}</dd></div>
      <div><dt>Email</dt><dd><a href="mailto:${b.email}">${b.email}</a></dd></div>
      ${b.phone ? html`<div><dt>Telefono</dt><dd><a href="tel:${b.phone}">${b.phone}</a>${wa ? html` · <a href="https://wa.me/${wa}" rel="noopener">WhatsApp</a>` : ''}</dd></div>` : ''}
      <div><dt>Lingua</dt><dd>${langName(b.lang)}</dd></div>
      ${account ? html`<div><dt>Partner</dt><dd><a href="/admin/partners/${account.id}">${account.company}</a></dd></div>` : ''}
      ${b.client_ref ? html`<div><dt>Rif. pratica</dt><dd>${b.client_ref}</dd></div>` : ''}
      ${b.booked_by_name ? html`<div><dt>Prenotata da</dt><dd>${b.booked_by_name}</dd></div>` : ''}
      ${b.notes ? html`<div><dt>Note del cliente</dt><dd>${b.notes}</dd></div>` : ''}
      ${b.billing_json ? html`<div><dt>Dati fattura</dt><dd>${Object.values(JSON.parse(b.billing_json)).join(' · ')}</dd></div>` : ''}
    </dl>
  </div>
</div>

${history.length ? html`<div class="card pad"><h2>Storico modifiche</h2>
  <ul class="plain">${history.map((h) => html`<li><strong>${new Date(h.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'medium', timeStyle: 'short' })}</strong> · ${h.by === 'admin' ? 'dalla guida' : 'dall’agenzia'}: ${changeSummary(h.before, h.after, b.currency)}${h.note ? html` <small class="muted">— «${h.note}»</small>` : ''}</li>`)}</ul></div>` : ''}

<div class="grid grid-2 admin-detail">
  <form class="card pad form" method="post" action="/admin/bookings/${b.id}/notes">
    <h2>Note interne</h2>
    <label class="field"><textarea name="admin_notes" rows="4" maxlength="2000">${b.admin_notes ?? ''}</textarea></label>
    <button class="btn btn-outline" type="submit">Salva note</button>
    ${b.status === 'confirmed' && b.payment_status === 'unpaid' ? html`<button class="btn btn-gold" type="submit" formaction="/admin/bookings/${b.id}/paid">Segna come incassata</button>` : ''}
    ${pkg && pkg.bookings.filter((x) => x.status === 'confirmed' && x.payment_status === 'unpaid').length > 1 ? html`<button class="btn btn-gold" type="submit" formaction="/admin/bookings/${b.id}/paid" name="all" value="1">Segna incassato tutto il pacchetto</button>` : ''}
  </form>
  ${b.status === 'option'
    ? html`<div class="card pad">
    <h2>Opzione</h2>
    ${extension ? html`<div class="notice notice-info ext-request" role="note"><p><strong>Richiesta di proroga:</strong> l’agenzia chiede <strong>${extension.days} ${extension.days === 1 ? 'giorno' : 'giorni'}</strong> in più${extension.note ? html` — «${extension.note}»` : ''}. <small class="muted">(chiesta il ${untilIt(extension.created_at)})</small></p>
      <form class="form inline-form" method="post" action="/admin/bookings/${b.id}/extension/${extension.id}/approve"><label class="field"><span class="label">Concedi</span><select name="days">${[1, 2, 3, 5, 7, 10, 14].map((d) => html`<option value="${d}" ${d === extension.days ? raw('selected') : ''}>${d} ${d === 1 ? 'giorno' : 'giorni'}</option>`)}</select></label>
        <button class="btn btn-gold" type="submit">Approva e avvisa l’agenzia</button></form>
      <form class="inline-form" method="post" action="/admin/bookings/${b.id}/extension/${extension.id}/deny" data-confirm="Non concedere la proroga? L’agenzia riceve un’email."><button class="btn btn-outline" type="submit">Non concedere</button></form></div>` : ''}
    <form class="form inline-form" method="post" action="/admin/bookings/${b.id}/option/extend"><h3>Prolunga la scadenza</h3>
      <label class="field"><span class="label">Di quanti giorni</span><select name="days">${[1, 2, 3, 5, 7, 10, 14].map((d) => html`<option value="${d}">${d} ${d === 1 ? 'giorno' : 'giorni'}</option>`)}</select></label>
      ${pkg ? html`<p class="small muted">Fa parte del pacchetto ${pkg.group.ref}: la proroga vale per tutti i suoi servizi in opzione.</p>` : ''}
      <button class="btn btn-outline" type="submit">Prolunga e avvisa l’agenzia</button></form>
    <form class="form" method="post" action="/admin/bookings/${b.id}/cancel" data-confirm="Rilasciare la data e avvisare l’agenzia?"><h3>Rilascia la data</h3>
      <label class="field"><span class="label">Motivo <em>(facoltativo)</em></span><input name="reason" maxlength="300"></label>
      <button class="btn btn-danger" type="submit">Rilascia e avvisa l’agenzia</button></form>
  </div>`
    : live
    ? html`<form class="card pad form" method="post" action="/admin/bookings/${b.id}/cancel" data-confirm="Annullare la prenotazione e avvisare il cliente?">
    <h2>Annulla prenotazione</h2>
    <label class="field"><span class="label">Rimborso e penale</span><select name="refund">
      <option value="auto">${cancelPreview(b, st)}</option>
      <option value="full">${b.payment_status === 'paid' ? 'Rimborsa tutto (nessuna penale)' : 'Nessuna penale'}</option>
      <option value="none">${b.payment_status === 'paid' ? 'Nessun rimborso (si trattiene tutto)' : 'Penale totale (da fatturare)'}</option></select></label>
    <label class="field"><span class="label">Motivo <em>(facoltativo)</em></span><input name="reason" maxlength="300"></label>
    <button class="btn btn-danger" type="submit">Annulla e avvisa il cliente</button>
  </form>`
    : ''}
</div>`;
  return adminLayout(ctx, { title: 'Prenotazione', active: '/admin/bookings', body, flash });
}

export function availabilityPage(ctx, { weekly, month, overrides, blocks, bookingsByDate, today, flash, error = '', calendars = [], external = [], problems = [] }) {
  const dates = monthDates(month);
  const first = dayOfWeek(dates[0]);
  const offset = (first + 6) % 7; // lunedì = 0
  const prev = month.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => (m === '01' ? `${+y - 1}-12` : `${y}-${String(+m - 1).padStart(2, '0')}`));
  const next = month.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => (m === '12' ? `${+y + 1}-01` : `${y}-${String(+m + 1).padStart(2, '0')}`));
  const ovMap = new Map(overrides.map((o) => [o.date, o]));
  const extMap = new Map();
  for (const e of external) extMap.set(e.date, [...(extMap.get(e.date) ?? []), `${e.start_time}–${e.end_time.replace('24:00', '24')} ${e.title ?? ''}`.trim()]);

  const body = html`
<div class="card pad">
  <h2>Orari di lavoro abituali</h2>
  <p class="muted">I clienti possono prenotare solo dentro queste fasce. Un servizio deve finire entro l'orario di chiusura.</p>
  <form method="post" action="/admin/availability/weekly" class="form weekly-form">
    ${WEEK_ORDER.map((d) => html`<div class="weekly-row"><label class="check"><input type="checkbox" name="open_${d}" value="1" ${weekly[d]?.open ? raw('checked') : ''}> <strong>${WEEKDAYS[d]}</strong></label>
      <input type="time" name="from_${d}" value="${weekly[d]?.from ?? '08:30'}" aria-label="Dalle"> <span>–</span> <input type="time" name="to_${d}" value="${weekly[d]?.to ?? '19:30'}" aria-label="Alle"></div>`)}
    <button class="btn btn-gold" type="submit">Salva orari</button>
  </form>
</div>

<div class="card pad">
  <h2>Giorni di chiusura e orari speciali</h2>
  <div class="cal-admin-head"><a class="btn btn-sm btn-outline" href="/admin/availability?m=${prev}">←</a><strong>${fmtMonth(month, 'it')}</strong><a class="btn btn-sm btn-outline" href="/admin/availability?m=${next}">→</a></div>
  <div class="cal-admin" role="grid">
    ${['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d) => html`<span class="cal-dow">${d}</span>`)}
    ${Array.from({ length: offset }, () => html`<span></span>`)}
    ${dates.map((d) => {
      const o = ovMap.get(d);
      const n = bookingsByDate.get(d) ?? 0;
      const wk = weekly[dayOfWeek(d)]?.open;
      const cls = o ? (o.closed ? 'is-closed' : 'is-custom') : wk ? '' : 'is-off';
      const ext = extMap.get(d);
      return html`<form method="post" action="/admin/availability/day" class="cal-admin-cell ${cls} ${d === today ? 'is-today' : ''} ${ext ? 'has-ext' : ''}">
        <input type="hidden" name="date" value="${d}"><input type="hidden" name="m" value="${month}"><input type="hidden" name="action" value="${o ? 'open' : 'close'}">
        <button type="submit" title="${ext ? 'Dal calendario: ' + ext.slice(0, 6).join(' · ') : (o ? 'Riapri' : 'Chiudi') + ' ' + d}"><span>${Number(d.slice(8))}</span>${n ? html`<small>${n}</small>` : ''}</button></form>`;
    })}
  </div>
  <p class="small muted"><span class="legend l-closed"></span> chiuso · <span class="legend l-off"></span> giorno non lavorativo abituale · <span class="legend l-custom"></span> orario speciale · <span class="legend l-ext"></span> impegni dal calendario collegato · il numero indica le prenotazioni. Tocca un giorno per chiuderlo o riaprirlo.</p>
  <form method="post" action="/admin/availability/custom" class="form inline-form">
    <h3>Orario speciale per un giorno</h3>
    <input type="date" name="date" required> <input type="time" name="from" value="09:00" required> <span>–</span> <input type="time" name="to" value="14:00" required>
    <input type="hidden" name="m" value="${month}"><button class="btn btn-outline" type="submit">Imposta</button>
  </form>
  ${overrides.length ? html`<h3>Prossime eccezioni</h3><ul class="plain">${overrides.map((o) => html`<li>${fmtDate(o.date, 'it', 'weekday')} — ${o.closed ? 'chiuso' : `${o.from_time}–${o.to_time}`}</li>`)}</ul>` : ''}
</div>

<div class="card pad">
  <h2>Calendari collegati (Google Calendar e simili)</h2>
  <p class="muted">Collega il tuo calendario personale: gli impegni segnati come <strong>«Occupato»</strong> bloccano da soli le disponibilità sul sito, così non ti prenoti sopra. Gli eventi segnati «Libero» e quelli annullati vengono ignorati. Il sito rilegge il calendario ogni ${ctx.app.cfg.calendar.syncMinutes} minuti e, prima di confermare una prenotazione, si riallinea.</p>
  ${calendarWarning(problems)}
  ${calendars.length
    ? html`<ul class="plain cal-sources">${calendars.map((c) => html`<li>
      <div><strong>${c.name}</strong> ${c.enabled ? '' : html`<span class="chip chip-warn">disattivato</span>`}<br><small class="muted">${c.masked}</small><br>
        ${c.last_ok_at ? html`<small>Ultimo aggiornamento: ${new Date(c.last_ok_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })} · ${c.event_count} eventi letti</small>` : html`<small class="muted">Mai sincronizzato</small>`}
        ${c.last_error ? html`<br><small class="field-error">${c.last_error}</small>` : ''}</div>
      <div class="actions">
        <form method="post" action="/admin/availability/calendars/${c.id}/sync"><input type="hidden" name="m" value="${month}"><button class="btn btn-sm btn-outline" type="submit">Sincronizza ora</button></form>
        <form method="post" action="/admin/availability/calendars/${c.id}/toggle"><input type="hidden" name="m" value="${month}"><button class="btn btn-sm btn-outline" type="submit">${c.enabled ? 'Disattiva' : 'Attiva'}</button></form>
        <form method="post" action="/admin/availability/calendars/${c.id}/delete" data-confirm="Scollegare questo calendario?"><input type="hidden" name="m" value="${month}"><button class="btn btn-sm btn-outline" type="submit">Scollega</button></form>
      </div></li>`)}</ul>`
    : html`<p class="muted">Nessun calendario collegato.</p>`}
  <form method="post" action="/admin/availability/calendars" class="form inline-form">
    <h3>Collega un calendario</h3>
    <input name="name" placeholder="Nome (es. Personale)" maxlength="80" required>
    <input name="url" type="url" placeholder="Indirizzo segreto iCal (https://calendar.google.com/…/basic.ics)" required class="grow">
    <input type="hidden" name="m" value="${month}"><button class="btn btn-gold" type="submit">Collega</button>
  </form>
  <details class="how-to"><summary>Come trovo l’indirizzo su Google Calendar?</summary>
    <ol><li>Apri Google Calendar dal computer → ⚙ <em>Impostazioni</em>.</li>
    <li>A sinistra, sotto «Impostazioni per i miei calendari», clicca il tuo calendario personale.</li>
    <li>Scorri fino a <em>«Integra calendario»</em> e copia <strong>«Indirizzo segreto in formato iCal»</strong>.</li>
    <li>Incollalo qui sopra. Tienilo riservato: chi lo possiede può leggere il tuo calendario (puoi rigenerarlo da Google).</li></ol>
    <p class="small muted">Funziona anche con Apple iCloud (calendario pubblico/webcal), Outlook, Posteo, Nextcloud…</p>
  </details>
</div>

<div class="card pad">
  <h2>Impegni esterni (blocchi orari)</h2>
  <p class="muted">Per quando lavori con altre agenzie o hai un impegno: quella fascia sparisce dalle disponibilità.</p>
  <form method="post" action="/admin/availability/block" class="form inline-form">
    <input type="date" name="date" required> <input type="time" name="from" value="09:00" required> <span>–</span> <input type="time" name="to" value="13:00" required>
    <input name="note" placeholder="Nota (es. Agenzia X)" maxlength="120"><input type="hidden" name="m" value="${month}"><button class="btn btn-gold" type="submit">Aggiungi</button>
  </form>
  ${blocks.length
    ? html`<ul class="plain block-list">${blocks.map((bl) => html`<li><span>${fmtDate(bl.date, 'it', 'weekday')} · ${bl.start_time}–${bl.end_time}${bl.note ? ' · ' + bl.note : ''}</span><form method="post" action="/admin/availability/block/${bl.id}/delete"><input type="hidden" name="m" value="${month}"><button class="btn btn-sm btn-outline" type="submit">Elimina</button></form></li>`)}</ul>`
    : html`<p class="muted">Nessun blocco.</p>`}
</div>`;
  return adminLayout(ctx, { title: 'Disponibilità', active: '/admin/availability', body, flash, error });
}
