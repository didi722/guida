import { html, raw } from '../html.js';
import { cancellationState } from '../bookings.js';
import { dayOfWeek, fmtDate, fmtMonth, monthDates } from '../time.js';
import { formatMoney } from '../util.js';

const NAV = [
  ['/admin', 'Agenda'],
  ['/admin/bookings', 'Prenotazioni'],
  ['/admin/programs', 'Programmi'],
  ['/admin/availability', 'Disponibilità'],
  ['/admin/partners', 'Partner B2B'],
  ['/admin/discounts', 'Sconti e buoni'],
  ['/admin/feedback', 'Feedback'],
];

const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const STATUS_IT = { confirmed: 'Confermata', held: 'In attesa di pagamento', cancelled: 'Annullata', expired: 'Scaduta' };
export const PAY_IT = { card: 'Carta', onsite: 'Sul posto', invoice: 'Fattura', giftcard: 'Buono regalo', free: 'Gratuita' };
export const PAYSTATUS_IT = { unpaid: 'Da incassare', paid: 'Pagata', refunded: 'Rimborsata', refund_failed: 'Rimborso fallito' };
const chipFor = (s) => ({ confirmed: 'chip-ok', held: 'chip-warn', cancelled: 'chip-err', expired: 'chip-err' }[s] ?? '');

export function adminLayout(ctx, { title, active, body, flash = '', error = '', scripts = '' }) {
  const { app } = ctx;
  return html`<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · Admin</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/style.css?v=${app.assetVersion}"><script src="/js/theme.js"></script>
</head><body class="admin">
<header class="admin-bar"><div class="admin-bar-inner">
  <a class="brand" href="/admin"><span class="brand-name">${app.cfg.site.name}</span><span class="brand-sub">Pannello</span></a>
  <nav class="admin-nav" aria-label="Admin">${NAV.map(([href, label]) => html`<a href="${href}" ${active === href ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>
  <form method="post" action="/admin/logout"><button class="tool" type="submit" title="Esci">Esci</button></form>
</div></header>
<main class="wrap admin-main">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  <h1>${title}</h1>
  ${body}
</main>
<script src="/js/main.js?v=${app.assetVersion}" defer></script>
${raw(scripts)}
</body></html>`;
}

export function adminLoginPage(ctx, { error = '' } = {}) {
  return html`<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Accesso · Admin</title>
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/style.css?v=${ctx.app.assetVersion}"><script src="/js/theme.js"></script></head>
<body class="admin"><main class="wrap narrow admin-login">
  <h1>${ctx.app.cfg.site.name}</h1><p class="muted">Pannello di gestione</p>
  <div class="card pad">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <form method="post" action="/admin/login" class="form">
      <label class="field"><span class="label">Password</span><input type="password" name="password" required autofocus autocomplete="current-password"></label>
      <button class="btn btn-gold btn-block" type="submit">Entra</button>
    </form>
  </div>
</main></body></html>`;
}

function bookingRow(ctx, b) {
  const tour = ctx.app.content.tour(b.tour_slug);
  return html`<a class="agenda-item" href="/admin/bookings/${b.id}">
    <span class="agenda-time"><strong>${b.start_time}</strong><small>${b.end_time}</small></span>
    <span class="agenda-main"><strong>${tour?.i18n.it.title ?? b.tour_slug}</strong>
      <small>${b.participants} pers. · ${b.name}${b.client_ref ? ' · ' + b.client_ref : ''}${b.channel === 'b2b' ? ' · B2B' : ''}</small></span>
    <span class="agenda-state"><span class="chip ${chipFor(b.status)}">${STATUS_IT[b.status]}</span><small>${PAY_IT[b.payment_method]} · ${PAYSTATUS_IT[b.payment_status]}</small></span>
  </a>`;
}

function programRow(d) {
  return html`<a class="agenda-item agenda-program" href="/admin/programs/${d.pid}">
    <span class="agenda-time"><strong>${d.start_time}</strong><small>${d.end_time}</small></span>
    <span class="agenda-main"><strong>${d.title}</strong><small>Programma ${d.ref} · ${d.name} · ${d.participants} pers.</small></span>
    <span class="agenda-state"><span class="chip ${d.status === 'confirmed' ? 'chip-ok' : 'chip-warn'}">${d.status === 'confirmed' ? 'Programma' : 'Manca l’acconto'}</span>${d.conflicts.length ? html`<small class="field-error">⚠ si sovrappone a un altro impegno</small>` : ''}</span>
  </a>`;
}

function calendarWarning(problems) {
  return problems?.length
    ? html`<div class="notice notice-err" role="alert"><strong>Calendario non aggiornato.</strong> ${problems.map((p) => `«${p.name}»`).join(', ')}: l’ultima lettura riuscita è troppo vecchia, quindi le disponibilità potrebbero non tenere conto dei tuoi impegni. <a href="/admin/availability">Controlla</a></div>`
    : '';
}

export function dashboardPage(ctx, { today, days, pendingPartners, held, programs, feedUrl, flash, problems }) {
  const body = html`
${calendarWarning(problems)}
<div class="grid grid-4 kpis">
  <div class="card pad kpi"><span class="muted">Oggi</span><strong>${days.find((d) => d.date === today)?.items.length ?? 0}</strong><small>servizi</small></div>
  <div class="card pad kpi"><span class="muted">Programmi da preparare</span><strong>${programs.todo}</strong><small>${programs.waiting} in attesa del cliente</small><a href="/admin/programs">Apri</a></div>
  <div class="card pad kpi"><span class="muted">Partner da approvare</span><strong>${pendingPartners}</strong><a href="/admin/partners">Apri</a></div>
  <div class="card pad kpi"><span class="muted">Pagamenti in corso</span><strong>${held}</strong><small>slot trattenuti</small></div>
</div>
<h2 class="h-sub spaced">Prossimi 14 giorni</h2>
${days.filter((d) => d.items.length).length
  ? days.filter((d) => d.items.length).map((d) => html`<section class="agenda-day"><h3>${fmtDate(d.date, 'it')}${d.date === today ? html` <span class="chip chip-accent">Oggi</span>` : ''}</h3><div class="card">${d.items.map((b) => (b.kind === 'program' ? programRow(b) : bookingRow(ctx, b)))}</div></section>`)
  : html`<p class="muted">Nessuna prenotazione nei prossimi 14 giorni.</p>`}
<h2 class="h-sub spaced">Calendario sul telefono</h2>
<div class="card pad"><p>Aggiungi questo indirizzo come <strong>calendario in abbonamento</strong> (Google Calendar, Apple Calendar, Outlook) per vedere le prenotazioni confermate insieme ai tuoi impegni. L'indirizzo è privato: non condividerlo.</p>
<p><input class="copy-field" readonly value="${feedUrl}" data-select-all></p></div>`;
  return adminLayout(ctx, { title: 'Agenda', active: '/admin', body, flash });
}

export function bookingsPage(ctx, { items, filter, q }) {
  const tabs = [['upcoming', 'Prossime'], ['past', 'Passate'], ['cancelled', 'Annullate'], ['all', 'Tutte']];
  const body = html`
<div class="tabs">${tabs.map(([k, l]) => html`<a href="/admin/bookings?f=${k}" ${filter === k ? raw('aria-current="page"') : ''}>${l}</a>`)}
  <form class="search-inline" method="get" action="/admin/bookings"><input type="hidden" name="f" value="${filter}"><input type="search" name="q" value="${q}" placeholder="Cerca nome, email, codice…"><button class="btn btn-sm btn-outline" type="submit">Cerca</button></form></div>
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Servizio</th><th>Cliente</th><th class="num">Pers.</th><th>Stato</th><th class="num">Totale</th></tr></thead><tbody>
    ${items.map((b) => html`<tr><td><a href="/admin/bookings/${b.id}">${fmtDate(b.date, 'it', 'short')}</a><br><small class="muted">${b.start_time}–${b.end_time}</small></td>
      <td>${ctx.app.content.tour(b.tour_slug)?.i18n.it.title ?? b.tour_slug}<br><small class="muted">${b.ref}${b.channel === 'b2b' ? ' · B2B' : ''}</small></td>
      <td>${b.name}<br><small class="muted">${b.client_ref ?? b.email}</small></td><td class="num">${b.participants}</td>
      <td><span class="chip ${chipFor(b.status)}">${STATUS_IT[b.status]}</span><br><small class="muted">${PAY_IT[b.payment_method]} · ${PAYSTATUS_IT[b.payment_status]}</small></td>
      <td class="num">${formatMoney(b.total_cents, 'it', b.currency)}</td></tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessuna prenotazione.</p>`}`;
  return adminLayout(ctx, { title: 'Prenotazioni', active: '/admin/bookings', body });
}

export function bookingDetailPage(ctx, b, account, flash = '') {
  const tour = ctx.app.content.tour(b.tour_slug);
  const st = cancellationState(b);
  const live = b.status === 'confirmed' || b.status === 'held';
  const wa = b.phone ? b.phone.replace(/[^\d]/g, '') : '';
  const body = html`
<p><a href="/admin/bookings">← Tutte le prenotazioni</a></p>
<div class="grid grid-2 admin-detail">
  <div class="card pad">
    <p class="ref-line"><span class="chip ${chipFor(b.status)}">${STATUS_IT[b.status]}</span> <strong class="ref">${b.ref}</strong> <span class="muted">${b.channel === 'b2b' ? 'B2B' : 'Privato'}</span></p>
    <h2>${tour?.i18n.it.title ?? b.tour_slug}</h2>
    <dl class="summary-list">
      <div><dt>Data</dt><dd>${fmtDate(b.date, 'it')}</dd></div>
      <div><dt>Orario</dt><dd>${b.start_time}–${b.end_time}</dd></div>
      <div><dt>Persone</dt><dd>${b.participants}</dd></div>
      ${b.discount_cents ? html`<div><dt>Sconto</dt><dd>${b.promo_code} · −${formatMoney(b.discount_cents, 'it', b.currency)} (listino ${formatMoney(b.list_cents, 'it', b.currency)})</dd></div>` : ''}
      ${b.gift_cents ? html`<div><dt>Buono regalo</dt><dd>−${formatMoney(b.gift_cents, 'it', b.currency)}</dd></div>` : ''}
      <div><dt>${b.discount_cents || b.gift_cents ? 'Da pagare' : 'Totale'}</dt><dd>${formatMoney(b.total_cents - b.gift_cents, 'it', b.currency)} · ${PAY_IT[b.payment_method]} · <strong>${PAYSTATUS_IT[b.payment_status]}</strong>${b.refund_cents ? ` (rimborsati ${formatMoney(b.refund_cents, 'it', b.currency)})` : ''}</dd></div>
      <div><dt>Cancellazione gratuita fino a</dt><dd>${new Date(b.free_cancel_until).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'medium', timeStyle: 'short' })} ${st.free ? html`<span class="chip chip-ok">ancora valida</span>` : html`<span class="chip chip-warn">scaduta</span>`}</dd></div>
      ${b.channel === 'b2c' && b.status === 'confirmed' ? html`<div><dt>Richiesta recensione</dt><dd>${b.review_status === 'sent' ? `inviata il ${new Date(b.review_sent_at).toLocaleDateString('it-IT')}` : b.review_status === 'skipped' ? 'non verrà inviata' : 'parte il giorno dopo il tour'}
        ${!b.review_status ? html`<form method="post" action="/admin/bookings/${b.id}/review" class="inline-form"><button class="btn btn-sm btn-outline" type="submit" name="action" value="send">Invia ora</button> <button class="btn btn-sm btn-outline" type="submit" name="action" value="skip">Non inviare</button></form>` : ''}</dd></div>` : ''}
      ${b.status === 'cancelled' ? html`<div><dt>Annullata</dt><dd>${b.cancelled_by ?? ''}${b.cancel_reason ? ' · ' + b.cancel_reason : ''}</dd></div>` : ''}
    </dl>
  </div>
  <div class="card pad">
    <h2>Cliente</h2>
    <dl class="summary-list">
      <div><dt>Nome</dt><dd>${b.name}</dd></div>
      <div><dt>Email</dt><dd><a href="mailto:${b.email}">${b.email}</a></dd></div>
      ${b.phone ? html`<div><dt>Telefono</dt><dd><a href="tel:${b.phone}">${b.phone}</a>${wa ? html` · <a href="https://wa.me/${wa}" rel="noopener">WhatsApp</a>` : ''}</dd></div>` : ''}
      <div><dt>Lingua</dt><dd>${b.lang === 'en' ? 'English' : 'Italiano'}</dd></div>
      ${account ? html`<div><dt>Partner</dt><dd><a href="/admin/partners/${account.id}">${account.company}</a></dd></div>` : ''}
      ${b.client_ref ? html`<div><dt>Rif. pratica</dt><dd>${b.client_ref}</dd></div>` : ''}
      ${b.notes ? html`<div><dt>Note del cliente</dt><dd>${b.notes}</dd></div>` : ''}
      ${b.billing_json ? html`<div><dt>Dati fattura</dt><dd>${Object.values(JSON.parse(b.billing_json)).join(' · ')}</dd></div>` : ''}
    </dl>
  </div>
</div>

<div class="grid grid-2 admin-detail">
  <form class="card pad form" method="post" action="/admin/bookings/${b.id}/notes">
    <h2>Note interne</h2>
    <label class="field"><textarea name="admin_notes" rows="4" maxlength="2000">${b.admin_notes ?? ''}</textarea></label>
    <button class="btn btn-outline" type="submit">Salva note</button>
    ${b.status === 'confirmed' && b.payment_status === 'unpaid' ? html`<button class="btn btn-gold" type="submit" formaction="/admin/bookings/${b.id}/paid">Segna come incassata</button>` : ''}
  </form>
  ${live
    ? html`<form class="card pad form" method="post" action="/admin/bookings/${b.id}/cancel" data-confirm="Annullare la prenotazione e avvisare il cliente?">
    <h2>Annulla prenotazione</h2>
    <label class="field"><span class="label">Rimborso</span><select name="refund">
      <option value="auto">Automatico (secondo la politica)${b.payment_status === 'paid' ? '' : ' — nulla da rimborsare'}</option>
      <option value="full" ${b.payment_status === 'paid' ? '' : raw('disabled')}>Rimborsa tutto</option>
      <option value="none">Nessun rimborso</option></select></label>
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

export function partnersPage(ctx, { items, filter }) {
  const tabs = [['all', 'Tutti'], ['pending', 'Da approvare'], ['approved', 'Approvati']];
  const ST = { pending: 'Da approvare', approved: 'Approvato', rejected: 'Rifiutato', suspended: 'Sospeso' };
  const body = html`<div class="tabs">${tabs.map(([k, l]) => html`<a href="/admin/partners?f=${k}" ${filter === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</div>
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Azienda</th><th>Referente</th><th>Stato</th><th class="num">Sconto</th><th class="num">Prenotazioni</th></tr></thead><tbody>
    ${items.map((a) => html`<tr><td><a href="/admin/partners/${a.id}"><strong>${a.company}</strong></a><br><small class="muted">${a.country ?? ''} ${a.vat ?? ''}</small></td><td>${a.contact_name}<br><small class="muted">${a.email}</small></td>
      <td><span class="chip ${a.status === 'approved' ? 'chip-ok' : a.status === 'pending' ? 'chip-warn' : 'chip-err'}">${ST[a.status]}</span></td><td class="num">${a.discount_percent ? a.discount_percent + '%' : '—'}</td><td class="num">${a.bookings}</td></tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessun partner.</p>`}`;
  return adminLayout(ctx, { title: 'Partner B2B', active: '/admin/partners', body });
}

export function partnerDetailPage(ctx, a, bookings, flash = '') {
  const { cfg } = ctx.app;
  const body = html`
<p><a href="/admin/partners">← Tutti i partner</a></p>
<div class="grid grid-2 admin-detail">
  <div class="card pad"><h2>${a.company}</h2>
    <dl class="summary-list">
      <div><dt>P.IVA / VAT</dt><dd>${a.vat ?? ''} ${a.country ? '(' + a.country + ')' : ''}</dd></div>
      <div><dt>SDI / PEC</dt><dd>${a.sdi_code ?? '—'} / ${a.pec ?? '—'}</dd></div>
      ${a.address ? html`<div><dt>Indirizzo</dt><dd>${a.address}</dd></div>` : ''}
      <div><dt>Referente</dt><dd>${a.contact_name} · <a href="mailto:${a.email}">${a.email}</a>${a.phone ? html` · <a href="tel:${a.phone}">${a.phone}</a>` : ''}</dd></div>
      ${a.website ? html`<div><dt>Sito</dt><dd><a href="${a.website}" rel="noopener nofollow" target="_blank">${a.website}</a></dd></div>` : ''}
      ${a.message ? html`<div><dt>Messaggio</dt><dd>${a.message}</dd></div>` : ''}
      <div><dt>Registrato</dt><dd>${new Date(a.created_at).toLocaleDateString('it-IT')}</dd></div>
    </dl></div>
  <form class="card pad form" method="post" action="/admin/partners/${a.id}">
    <h2>Condizioni</h2>
    <label class="field"><span class="label">Stato</span><select name="status">${[['pending', 'Da approvare'], ['approved', 'Approvato'], ['rejected', 'Rifiutato'], ['suspended', 'Sospeso']].map(([v, l]) => html`<option value="${v}" ${a.status === v ? raw('selected') : ''}>${l}</option>`)}</select></label>
    <label class="field"><span class="label">Sconto extra sulla tariffa B2B (%)</span><input type="number" name="discount_percent" min="0" max="60" step="0.5" value="${a.discount_percent}"></label>
    <label class="field"><span class="label">Cancellazione gratuita fino a (ore prima) <em>— vuoto = predefinito (${cfg.policy.b2bFreeCancelHours} h)</em></span><input type="number" name="cancel_hours" min="0" max="2000" value="${a.cancel_hours ?? ''}"></label>
    <label class="check"><input type="checkbox" name="allow_invoice" value="1" ${a.allow_invoice ? raw('checked') : ''}> Può pagare a fattura / bonifico</label>
    <label class="field"><span class="label">Note interne</span><textarea name="admin_notes" rows="3" maxlength="2000">${a.admin_notes ?? ''}</textarea></label>
    <button class="btn btn-gold" type="submit">Salva${a.status === 'pending' ? ' (e approva se imposti "Approvato")' : ''}</button>
  </form>
</div>
<h2 class="h-sub spaced">Prenotazioni</h2>
${bookings.length
  ? html`<div class="card table-wrap"><table class="table"><tbody>${bookings.map((b) => html`<tr><td><a href="/admin/bookings/${b.id}">${fmtDate(b.date, 'it', 'short')} ${b.start_time}</a></td><td>${ctx.app.content.tour(b.tour_slug)?.i18n.it.title}</td><td class="num">${b.participants}</td><td><span class="chip ${chipFor(b.status)}">${STATUS_IT[b.status]}</span></td><td class="num">${formatMoney(b.total_cents, 'it', b.currency)}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">Ancora nessuna prenotazione.</p>`}`;
  return adminLayout(ctx, { title: 'Partner', active: '/admin/partners', body, flash });
}

