import { html } from '../html.js';

/**
 * Campo di testo in markdown per i contenuti del sito: barra di formattazione (grassetto, corsivo, titolo, elenco,
 * link), inserimento di una foto della libreria e anteprima. Lo script è public/js/admin-content.js.
 */
export function mdEditor(name, value, { rows = 16, label = 'Testo', media = [] } = {}) {
  return html`<div data-md>
  <label class="field"><span class="label">${label}</span>
    <div class="md-toolbar" role="toolbar" aria-label="Formattazione del testo" data-md-toolbar>
      <button class="btn btn-outline btn-sm" type="button" data-md-act="bold">Grassetto</button>
      <button class="btn btn-outline btn-sm" type="button" data-md-act="italic">Corsivo</button>
      <button class="btn btn-outline btn-sm" type="button" data-md-act="heading">Titolo</button>
      <button class="btn btn-outline btn-sm" type="button" data-md-act="list">Elenco</button>
      <button class="btn btn-outline btn-sm" type="button" data-md-act="link">Link</button>
      <button class="btn btn-outline btn-sm" type="button" data-md-act="photos" aria-expanded="false">Foto</button>
    </div>
    <div class="md-photos" data-md-photos hidden>
      ${media.length
        ? html`<p class="muted small">Tocca una foto per inserirla nel testo, poi sostituisci «Descrizione della foto» con una frase che la descriva (serve a chi non la vede). <a href="/admin/media" target="_blank" rel="noopener">Carica nuove foto</a></p>
          <div class="media-picker">${media.map((m) => html`<button class="media-choice" type="button" data-md-photo="/media/${m.name}" aria-label="Inserisci questa foto"><img src="/media/${m.small_name ?? m.name}" alt="" loading="lazy"></button>`)}</div>`
        : html`<p class="muted small">Non hai ancora caricato foto: vai in <a href="/admin/media" target="_blank" rel="noopener">Sito › Immagini</a>, caricale e poi tornano qui.</p>`}
    </div>
    <textarea name="${name}" rows="${rows}" data-md-source>${value}</textarea>
  </label>
  <p><button class="btn btn-outline btn-sm" type="button" data-md-toggle>Anteprima</button></p>
  <div class="md-preview prose" data-md-preview hidden></div>
</div>`;
}
