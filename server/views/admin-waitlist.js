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

export function waitlistAdminPage(ctx, { rows, notified, recovered }) {
  const { app } = ctx;
  const title = (e) => app.content.tour(e.tour_slug)?.i18n.it.title ?? e.tour_slug;
  const waiting = rows.filter((e) => e.status === 'waiting').length;
  const body = html`
<div class="grid grid-3 kpis">
  <div class="card pad kpi"><span class="muted">In attesa</span><strong>${waiting}</strong><small>agenzie che aspettano una data</small></div>
  <div class="card pad kpi"><span class="muted">Avvisi inviati</span><strong>${notified}</strong><small>ultimi 90 giorni</small></div>
  <div class="card pad kpi"><span class="muted">Date recuperate</span><strong>${recovered}</strong><small>prenotate dopo l’avviso, ultimi 90 giorni</small></div>
</div>
<p class="muted">Un’agenzia che trova una data occupata (da un’opzione di un altro operatore, o da una prenotazione) può chiedere di essere <strong>avvisata se si libera</strong>. Ogni minuto il sito controlla: appena la data torna prenotabile per il suo gruppo, l’agenzia riceve un’email. Nessuno la tiene da parte: la ottiene chi prenota per primo. ${app.cfg.waitlist.priorityHours ? html`Se in lista sono in più d’una, vengono avvisate <strong>nell’ordine di iscrizione</strong>: la prima ha <strong>${app.cfg.waitlist.priorityHours} ore di vantaggio</strong>, poi tocca alla successiva (se il servizio è fra meno di ${app.cfg.waitlist.openBelowHours} ore, o se il posto basta per più agenzie, partono insieme). Si cambia in <a href="/admin/settings?s=waitlist#waitlist">Impostazioni</a>.` : html`Gli avvisi partono a tutte le agenzie insieme (il vantaggio per chi è prima in lista è spento: <a href="/admin/settings?s=waitlist#waitlist">Impostazioni</a>).`} Qui vedi chi aspetta e <strong>chi tiene la data</strong>: se ti serve, puoi sentire chi ha l’opzione.</p>
${rows.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Servizio</th><th>Agenzia</th><th>Stato</th><th>Adesso la occupano</th></tr></thead><tbody>
  ${rows.map((e) => html`<tr>
    <td><strong>${fmtDate(e.date, 'it', 'short')}</strong><br><small class="muted">${e.time ? `ore ${e.time}` : 'qualsiasi orario'}</small></td>
    <td>${title(e)}<br><small class="muted">${plural(e.pax, 'persona', 'persone')}${e.tour_lang ? ` · in ${e.tour_lang}` : ''}${e.hours != null && app.content.tour(e.tour_slug)?.chooseHours ? ` · ${e.hours} ore` : ''}</small></td>
    <td><a href="/admin/partners/${e.account_id}">${e.acct_company}</a><br><small class="muted">${e.acct_email}</small></td>
    <td>${e.status === 'notified' ? html`<span class="chip chip-ok">Avvisata</span><br><small class="muted">il ${fmtDate(nowRome(Date.parse(e.notified_at)).date, 'it', 'short')}</small>` : html`<span class="chip chip-warn">In attesa</span>`}${queueNote(e.queue, e.status)}</td>
    <td>${e.blockers.length ? e.blockers.slice(0, 4).map((b) => html`<div>${blocker(b)}</div>`) : html`<small class="muted">${e.status === 'notified' ? 'libera' : 'nulla di tuo: gli altri servizi del giorno non lasciano posto'}</small>`}</td>
  </tr>`)}
  </tbody></table></div>`
  : html`<p class="card pad muted">Nessuna agenzia sta aspettando una data.</p>`}`;
  return adminLayout(ctx, { title: 'Lista d’attesa', active: '/admin/waitlist', body });
}
