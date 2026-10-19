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
<p class="muted">Un’agenzia che trova una data occupata (da un’opzione di un altro operatore, o da una prenotazione) può chiedere di essere <strong>avvisata se si libera</strong>. Ogni minuto il sito controlla: appena la data torna prenotabile per il suo gruppo, l’agenzia riceve un’email. Nessuno la tiene da parte: la ottiene chi prenota per primo. Qui vedi chi aspetta e <strong>chi tiene la data</strong>: se ti serve, puoi sentire chi ha l’opzione.</p>
${rows.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Servizio</th><th>Agenzia</th><th>Stato</th><th>Adesso la occupano</th></tr></thead><tbody>
  ${rows.map((e) => html`<tr>
    <td><strong>${fmtDate(e.date, 'it', 'short')}</strong><br><small class="muted">${e.time ? `ore ${e.time}` : 'qualsiasi orario'}</small></td>
    <td>${title(e)}<br><small class="muted">${plural(e.pax, 'persona', 'persone')}${e.tour_lang ? ` · in ${e.tour_lang}` : ''}${e.hours != null && app.content.tour(e.tour_slug)?.chooseHours ? ` · ${e.hours} ore` : ''}</small></td>
    <td><a href="/admin/partners/${e.account_id}">${e.acct_company}</a><br><small class="muted">${e.acct_email}</small></td>
    <td>${e.status === 'notified' ? html`<span class="chip chip-ok">Avvisata</span><br><small class="muted">il ${fmtDate(nowRome(Date.parse(e.notified_at)).date, 'it', 'short')}</small>` : html`<span class="chip chip-warn">In attesa</span>`}</td>
    <td>${e.blockers.length ? e.blockers.slice(0, 4).map((b) => html`<div>${blocker(b)}</div>`) : html`<small class="muted">${e.status === 'notified' ? 'libera' : 'nulla di tuo: gli altri servizi del giorno non lasciano posto'}</small>`}</td>
  </tr>`)}
  </tbody></table></div>`
  : html`<p class="card pad muted">Nessuna agenzia sta aspettando una data.</p>`}`;
  return adminLayout(ctx, { title: 'Lista d’attesa', active: '/admin/waitlist', body });
}
