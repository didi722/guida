import { html } from '../html.js';
import { adminLayout } from './admin.js';

const when = (iso) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Pulsante «Carica una foto»: lo gestisce public/js/admin-media.js (ridimensiona nel browser e invia). */
export const uploadControl = (label = 'Carica una foto') => html`<label class="btn btn-gold btn-sm upload-btn">${label}<input type="file" accept="image/*" multiple hidden data-upload-input></label> <span class="muted small" data-upload-status role="status"></span>`;

export function mediaPage(ctx, { items, used, flash = '', error = '' }) {
  const body = html`
<div class="card pad" data-upload>
  <p class="muted">Carica foto da telefono o computer: vengono ridimensionate (massimo 1600 px) e ottimizzate automaticamente, e i dati di posizione delle foto non vengono conservati. Poi le scegli come copertina di un tour o di un articolo.</p>
  <p>${uploadControl()}</p>
</div>
${items.length
  ? html`<div class="media-grid">${items.map((m) => html`<figure class="card media-item"><img src="/media/${m.small_name ?? m.name}" alt="" loading="lazy" width="320" height="200">
    <figcaption><span class="small muted">${m.width && m.height ? `${m.width}×${m.height} · ` : ''}${kb(m.bytes)} · ${when(m.created_at)}</span>
    ${used.has(m.name) ? html`<span class="chip chip-ok">in uso</span>` : html`<form method="post" action="/admin/media/${m.id}/delete" data-confirm="Eliminare questa immagine?"><button class="btn btn-outline btn-sm" type="submit">Elimina</button></form>`}</figcaption></figure>`)}</div>`
  : html`<p class="muted">Nessuna immagine caricata: finché non ne aggiungi, il sito usa le illustrazioni.</p>`}`;
  return adminLayout(ctx, { title: 'Immagini', active: '/admin/media', body, flash, error, scripts: `<script src="/js/admin-media.js?v=${ctx.app.assetVersion}" defer></script>` });
}
