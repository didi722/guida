import { html } from '../html.js';
import { fmtDate } from '../time.js';
import { adminLayout } from './admin.js';

/** Lo stato delle recensioni di Google nella home, con il pulsante per rileggerle. */
function googleBox(ctx) {
  const g = ctx.app.googleReviews;
  const place = String(ctx.app.cfg.reviews.google?.placeId ?? '').trim();
  const key = !!ctx.app.cfg.reviews.google?.apiKey;
  if (!g.enabled) {
    return html`<div class="card pad"><h2 class="h-sub">Recensioni di Google nella home</h2>
    <p class="muted">Non collegate. Servono il <strong>codice del profilo</strong> (Place ID, in <a href="/admin/settings#extras">Impostazioni › Buoni regalo, programmi e recensioni</a>)${place ? html` — c’è —` : ''} e la chiave <code>GOOGLE_PLACES_API_KEY</code> sul server${key ? html` — c’è —` : ''}: vedi la guida. Finché non sono collegate, la home mostra solo i commenti dei clienti del sito.</p></div>`;
  }
  const at = g.lastFetch();
  return html`<div class="card pad"><h2 class="h-sub">Recensioni di Google nella home</h2>
    <p class="muted"><strong>Collegate.</strong> ${at ? html`Ultima lettura: ${new Date(at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'medium', timeStyle: 'short' })}.` : 'Non è ancora stata fatta una lettura valida.'} Il sito le rilegge da solo una volta al giorno (Google ne restituisce al massimo cinque) e le mostra accanto ai commenti dei clienti.${g.lastError ? html` <span class="chip chip-warn">${g.lastError}</span>` : ''}</p>
    <form method="post" action="/admin/feedback/google/refresh"><button class="btn btn-outline btn-sm" type="submit">Aggiorna adesso</button></form></div>`;
}

export function feedbackAdminPage(ctx, { items, stats, flash }) {
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const body = html`
<div class="grid grid-3 kpis">
  <div class="card pad kpi"><span class="muted">Valutazione media</span><strong>${stats.average != null ? stats.average.toLocaleString('it-IT') : '—'}</strong><small>su 5</small></div>
  <div class="card pad kpi"><span class="muted">Feedback ricevuti</span><strong>${stats.count}</strong><small>privati</small></div>
  <div class="card pad kpi"><span class="muted">Richieste inviate</span><strong>${stats.requested}</strong><small>email di recensione</small></div>
</div>
<p class="muted">${ctx.app.translate.enabled
  ? html`<strong>Traduzione automatica attiva</strong> (${ctx.app.translate.label}): i commenti mostrati sul sito vengono tradotti nella lingua di chi guarda, con il pulsante «Vedi originale»${ctx.app.translate.lastError ? html` — <span class="chip chip-warn">ultimo errore: ${ctx.app.translate.lastError}</span>` : ''}.`
  : html`<strong>Traduzione automatica non attiva</strong>: i commenti restano nella lingua del cliente. Per attivarla serve una chiave di DeepL o di Google Traduttore (<code>TRANSLATE_PROVIDER</code> e <code>TRANSLATE_API_KEY</code>, vedi la guida).`}</p>
${googleBox(ctx)}
<p class="muted">Le recensioni pubbliche (Google, Tripadvisor) si gestiscono e si rispondono sulle piattaforme: qui compaiono solo i feedback lasciati dalla pagina privata. Un commento si può <strong>mostrare sul sito</strong> (in home e nella pagina del suo tour) solo se il cliente ha dato il permesso: compare con il solo nome di battesimo, così com'è scritto.</p>
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Voto</th><th>Commento</th><th>Tour</th><th>Cliente</th><th>Sul sito</th></tr></thead><tbody>
  ${items.map((f) => html`<tr><td class="stars-cell" title="${f.rating}/5">${stars(f.rating)}</td><td>${f.comment ?? html`<span class="muted">—</span>`}${f.may_publish ? html`<br><small class="chip chip-ok">citabile sul sito</small>` : ''}</td>
    <td>${ctx.app.content.tour(f.tour_slug)?.i18n.it.title ?? f.tour_slug}<br><small class="muted">${fmtDate(f.date, 'it', 'short')}</small></td>
    <td><a href="/admin/bookings/${f.booking_id}">${f.name}</a><br><small class="muted">${f.email}</small></td>
    <td>${f.may_publish && f.comment?.trim()
      ? html`<form method="post" action="/admin/feedback/${f.id}/featured">${f.featured ? html`<span class="chip chip-ok">sul sito</span> <button class="btn btn-sm btn-outline" type="submit" name="on" value="0">Togli</button>` : html`<button class="btn btn-sm btn-outline" type="submit" name="on" value="1">Mostra sul sito</button>`}</form>`
      : html`<small class="muted">${f.may_publish ? 'nessun commento' : 'il cliente non ha dato il permesso'}</small>`}</td></tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Ancora nessun feedback.</p>`}`;
  return adminLayout(ctx, { title: 'Feedback', active: '/admin/feedback', body, flash });
}
