import { html } from '../html.js';
import { adminLayout } from './admin.js';

const when = (iso) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** Pulsante «Carica una foto»: lo gestisce public/js/admin-media.js (ridimensiona nel browser e invia). */
export const uploadControl = (label = 'Carica una foto') => html`<label class="btn btn-gold btn-sm upload-btn">${label}<input type="file" accept="image/*" multiple hidden data-upload-input></label> <span class="muted small" data-upload-status role="status"></span>`;

export function mediaPage(ctx, { items, used, slots = [], flash = '', error = '' }) {
  const thumb = (name) => {
    const m = items.find((i) => i.name === name);
    return `/media/${m?.small_name ?? name}`;
  };
  const body = html`
<div class="card pad" data-upload>
  <p class="muted">Carica foto da telefono o computer: vengono ridimensionate (massimo 1600 px) e ottimizzate automaticamente, e i dati di posizione delle foto non vengono conservati. Poi le scegli come copertina di un tour o di un articolo, oppure per le pagine principali del sito (qui sotto).</p>
  <p>${uploadControl()}</p>
</div>
${slots.length ? html`<section class="card pad">
  <h2>Immagini del sito</h2>
  <p class="muted">Le foto delle pagine principali. Finché non ne scegli una, il sito mostra un’illustrazione. Per sceglierla, usa «Usa qui» sulla foto che vuoi, nella libreria qui sotto.</p>
  <div class="img-slots">${slots.map((sl) => html`<div class="img-slot">
    <div class="img-slot-thumb">${sl.name ? html`<img src="${thumb(sl.name)}" alt="">` : html`<span class="muted small">Illustrazione</span>`}</div>
    <div class="img-slot-body"><strong>${sl.label}</strong><p class="muted small">${sl.hint}</p>
      ${sl.name ? html`<form method="post" action="/admin/media/slots"><input type="hidden" name="slot" value="${sl.key}"><input type="hidden" name="clear" value="1"><button class="btn btn-outline btn-sm" type="submit">Togli la foto</button></form>` : ''}</div>
  </div>`)}</div>
</section>` : ''}
${items.length
  ? html`<div class="media-grid">${items.map((m) => html`<figure class="card media-item"><img src="/media/${m.small_name ?? m.name}" alt="" loading="lazy" width="320" height="200">
    <figcaption><span class="small muted">${m.width && m.height ? `${m.width}×${m.height} · ` : ''}${kb(m.bytes)} · ${when(m.created_at)}</span>
    ${slots.length ? html`<form method="post" action="/admin/media/slots" class="img-slot-form"><input type="hidden" name="name" value="${m.name}"><select name="slot" aria-label="Dove usare questa foto">${slots.map((sl) => html`<option value="${sl.key}">${sl.label}</option>`)}</select><button class="btn btn-outline btn-sm" type="submit">Usa qui</button></form>` : ''}
    ${used.has(m.name) ? html`<span class="chip chip-ok">in uso</span>` : html`<form method="post" action="/admin/media/${m.id}/delete" data-confirm="Eliminare questa immagine?"><button class="btn btn-outline btn-sm" type="submit">Elimina</button></form>`}</figcaption></figure>`)}</div>`
  : html`<p class="muted">Nessuna immagine caricata: finché non ne aggiungi, il sito usa le illustrazioni.</p>`}`;
  return adminLayout(ctx, { title: 'Immagini', active: '/admin/media', body, flash, error, scripts: `<script src="/js/admin-media.js?v=${ctx.app.assetVersion}" defer></script>` });
}
