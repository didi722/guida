import { html } from '../html.js';

/**
 * Campo di testo in markdown per i contenuti del sito: barra di formattazione (grassetto, corsivo, titolo, elenco,
 * link), inserimento di una foto della libreria e anteprima dal vivo. Lo script è public/js/admin-content.js.
 * L'etichetta riguarda solo il campo (for/id): se avvolgesse anche i pulsanti, toccare la scritta premerebbe «Grassetto».
 */
export function mdEditor(name, value, { rows = 16, label = 'Testo', media = [] } = {}) {
  const id = `md-${name}`;
  return html`<div data-md class="md-editor field">
  <label class="label" for="${id}">${label}</label>
  <div class="md-toolbar" role="toolbar" aria-label="Formattazione del testo" data-md-toolbar>
    <button class="btn btn-outline btn-sm" type="button" data-md-act="bold" title="Grassetto (Ctrl+B)"><strong>Grassetto</strong></button>
    <button class="btn btn-outline btn-sm" type="button" data-md-act="italic" title="Corsivo (Ctrl+I)"><em>Corsivo</em></button>
    <button class="btn btn-outline btn-sm" type="button" data-md-act="heading">Titolo</button>
    <button class="btn btn-outline btn-sm" type="button" data-md-act="list">Elenco</button>
    <button class="btn btn-outline btn-sm" type="button" data-md-act="link">Link</button>
    <button class="btn btn-outline btn-sm" type="button" data-md-act="photos" aria-expanded="false">Foto</button>
  </div>
  <p class="muted small md-hint">Seleziona le parole e tocca il pulsante (toccalo ancora per toglierlo). Nel testo il grassetto si vede come <code>**così**</code> e il corsivo come <code>*così*</code>: con <strong>Anteprima</strong> vedi come verrà sul sito.</p>
  <div class="md-photos" data-md-photos hidden>
    ${media.length
      ? html`<p class="muted small">Tocca una foto per inserirla nel testo, poi sostituisci «Descrizione della foto» con una frase che la descriva (serve a chi non la vede). <a href="/admin/media" target="_blank" rel="noopener">Carica nuove foto</a></p>
        <div class="media-picker">${media.map((m) => html`<button class="media-choice" type="button" data-md-photo="/media/${m.name}" aria-label="Inserisci questa foto"><img src="/media/${m.small_name ?? m.name}" alt="" loading="lazy"></button>`)}</div>`
      : html`<p class="muted small">Non hai ancora caricato foto: vai in <a href="/admin/media" target="_blank" rel="noopener">Sito › Immagini</a>, caricale e poi tornano qui.</p>`}
  </div>
  <div class="md-panes" data-md-panes>
    <textarea id="${id}" name="${name}" rows="${rows}" data-md-source>${value}</textarea>
    <div class="md-preview prose" data-md-preview hidden aria-live="polite"></div>
  </div>
  <p><button class="btn btn-outline btn-sm" type="button" data-md-toggle aria-pressed="false">Anteprima</button></p>
</div>`;
}
