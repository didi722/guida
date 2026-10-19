import { html } from '../html.js';
import { fmtDate, fmtInstant, nowRome } from '../time.js';
import { adminLayout } from './admin.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Cosa occupa la data adesso, in una riga: opzione (con scadenza), pagamento in corso o prenotazione confermata. */
const blocker = (b) => {
  const who = b.company ? ` · ${b.company}` : '';
  const text = b.status === 'option' ? `Opzione, scade il ${fmtInstant(Date.parse(b.option_expires_at), 'it')}` : b.status === 'held' ? 'Pagamento in corso' : 'Confermata';
  return html`<a href="/admin/bookings/${b.id}">${b.start_time} ${b.ref}</a> <small class="muted">${text}${who}</small>`;
};

/** Il posto in coda, sotto lo stato: chi ha davanti (per nome), o fino a quando dura il vantaggio di chi è stata avvisata per prima. */
function queueNote(q, status) {
  if (!q?.exclusive) return '';
  if (status === 'notified') return q.until ? html`<br><small class="muted">vantaggio fino al ${fmtInstant(q.until, 'it')} (${plural(q.behind, 'agenzia aspetta', 'agenzie aspettano')})</small>` : '';
  return html`<br><small class="muted">${q.ahead.length ? `dopo ${q.ahead.join(', ')}` : q.behind ? 'prima in lista' : ''}</small>`;
}

export function waitlistAdminPage(ctx, { groups, rows, notified, recovered, flash = '' }) {
  const { app } = ctx;
  const title = (slug) => app.content.tour(slug)?.i18n.it.title ?? slug;
  const waiting = rows.filter((e) => e.status === 'waiting').length;
  const grip = html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>`;
  /** La riga di un'agenzia; `rank` = il numero in coda (solo per chi aspetta e si può spostare), `movable` = ha la maniglia. */
  const row = (e, { rank = null, movable = false } = {}) => html`<tr data-id="${e.id}">
    <td class="drag-cell">${movable
      ? html`<button class="drag-handle" type="button" aria-label="Sposta «${e.acct_company}»: trascinala, oppure usa le frecce su e giù della tastiera" title="Trascina per cambiare l’ordine">${grip}</button><span class="move-btns"><button type="button" data-move="-1" aria-label="Fai passare ${e.acct_company} prima" title="Prima">▲</button><button type="button" data-move="1" aria-label="Fai passare ${e.acct_company} dopo" title="Dopo">▼</button></span>`
      : ''}</td>
    <td class="num">${rank != null ? html`<strong data-rank>${rank}</strong>` : html`<span class="muted">—</span>`}</td>
    <td><a href="/admin/partners/${e.account_id}">${e.acct_company}</a><br><small class="muted">${e.acct_email}</small></td>
    <td>${e.time ? `ore ${e.time}` : 'qualsiasi orario'}<br><small class="muted">${plural(e.pax, 'persona', 'persone')}${e.tour_lang ? ` · in ${e.tour_lang}` : ''}${e.hours != null && app.content.tour(e.tour_slug)?.chooseHours ? ` · ${e.hours} ore` : ''}</small></td>
    <td>${e.status === 'notified' ? html`<span class="chip chip-ok">Avvisata</span><br><small class="muted">il ${fmtDate(nowRome(Date.parse(e.notified_at)).date, 'it', 'short')}</small>` : html`<span class="chip chip-warn">In attesa</span>`}${queueNote(e.queue, e.status)}</td>
    <td>${e.blockers.length ? e.blockers.slice(0, 4).map((b) => html`<div>${blocker(b)}</div>`) : html`<small class="muted">${e.status === 'notified' ? 'libera' : 'nulla di tuo: gli altri servizi del giorno non lasciano posto'}</small>`}</td>
  </tr>`;
  const head = html`<thead><tr><th class="drag-col"><span class="sr-only">Ordine</span></th><th class="num">N°</th><th>Agenzia</th><th>Richiesta</th><th>Stato</th><th>Adesso la occupano</th></tr></thead>`;
  const group = (g) => {
    const movable = g.waiting.length > 1;
    return html`<section class="wl-group" data-sortable-wrap>
    <h2 class="h-sub">${fmtDate(g.date, 'it', 'weekday')} · ${title(g.tour)} <span class="chip">${plural(g.notified.length + g.waiting.length, 'agenzia', 'agenzie')}</span>${g.manual ? html` <span class="chip chip-accent" title="L’ordine di arrivo è stato cambiato da te">ordine deciso da te</span>` : ''}</h2>
    <div class="card table-wrap"><table class="table waitlist-table">${head}
      ${g.notified.length ? html`<tbody>${g.notified.map((e) => row(e))}</tbody>` : ''}
      <tbody ${movable ? html`data-sortable data-order-url="/admin/waitlist/order" data-key-attr="data-id" data-field="ids" data-payload="${JSON.stringify({ group: g.key })}" data-saved="Ordine salvato: gli avvisi seguiranno questa coda."` : ''}>${g.waiting.map((e, i) => row(e, { rank: i + 1, movable }))}</tbody>
    </table></div>
    ${movable || g.manual ? html`<div class="wl-foot">${movable ? html`<p class="small muted">Trascina un’agenzia sopra un’altra (o usa ▲ ▼) per farla avanzare: nessuna riceve un avviso per questo, cambia solo chi viene avvisata per prima quando la data si libera.</p>` : ''}${g.manual ? html`<form class="inline-form" method="post" action="/admin/waitlist/reset"><input type="hidden" name="group" value="${g.key}"><button class="btn btn-link-danger" type="submit">Riporta all’ordine di arrivo</button></form>` : ''}</div>` : ''}
  </section>`;
  };
  const body = html`
<div class="grid grid-3 kpis">
  <div class="card pad kpi"><span class="muted">In attesa</span><strong>${waiting}</strong><small>agenzie che aspettano una data</small></div>
  <div class="card pad kpi"><span class="muted">Avvisi inviati</span><strong>${notified}</strong><small>ultimi 90 giorni</small></div>
  <div class="card pad kpi"><span class="muted">Date recuperate</span><strong>${recovered}</strong><small>prenotate dopo l’avviso, ultimi 90 giorni</small></div>
</div>
${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
<p class="order-status" data-order-status role="status" aria-live="polite" hidden></p>
<p class="muted">Un’agenzia che trova una data occupata (da un’opzione di un altro operatore, o da una prenotazione) può chiedere di essere <strong>avvisata se si libera</strong>. Ogni minuto il sito controlla: appena la data torna prenotabile per il suo gruppo, l’agenzia riceve un’email. Nessuno la tiene da parte: la ottiene chi prenota per primo. ${app.cfg.waitlist.priorityHours ? html`Se in lista sono in più d’una, vengono avvisate <strong>nell’ordine di iscrizione</strong> (che puoi cambiare qui sotto, per esempio per fare un favore a un’agenzia con cui hai un rapporto particolare): la prima ha <strong>${app.cfg.waitlist.priorityHours} ore di vantaggio</strong>, poi tocca alla successiva (se il servizio è fra meno di ${app.cfg.waitlist.openBelowHours} ore, o se il posto basta per più agenzie, partono insieme). Si cambia in <a href="/admin/settings?s=waitlist#waitlist">Impostazioni</a>.` : html`Gli avvisi partono a tutte le agenzie insieme (il vantaggio per chi è prima in lista è spento: <a href="/admin/settings?s=waitlist#waitlist">Impostazioni</a>).`} Qui vedi chi aspetta e <strong>chi tiene la data</strong>: se ti serve, puoi sentire chi ha l’opzione.</p>
${groups.length ? groups.map(group) : html`<p class="card pad muted">Nessuna agenzia sta aspettando una data.</p>`}`;
  return adminLayout(ctx, { title: 'Lista d’attesa', active: '/admin/waitlist', body, flash: '', scripts: `<script src="/js/admin-sortable.js?v=${app.assetVersion}" defer></script>` });
}
