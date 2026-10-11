import { html } from '../html.js';
import { LANGS, LANG_META } from '../langs.js';
import { adminLayout } from './admin.js';

export const SECTION_LABEL = {
  home: 'Home', nav: 'Menu', footer: 'Piè di pagina', site: 'Titolo e descrizione del sito', cta: 'Inviti all’azione',
  tours: 'Elenco tour', tour: 'Scheda del tour', how: 'Come funziona', why: 'Perché scegliermi', trust: 'Rassicurazioni', faq: 'Domande frequenti', quick: 'Ricerca veloce',
  book: 'Prenota', booking: 'La tua prenotazione', checkout: 'Conferma e pagamento', pay: 'Metodi di pagamento', s: 'Riepiloghi', f: 'Campi dei moduli', w: 'Calendario', time: 'Tempi', price: 'Prezzi', promo: 'Codici sconto',
  b2b: 'Area partner', gift: 'Buoni regalo', pg: 'Programmi di più giorni', contact: 'Contatti', about: 'Chi sono', blog: 'Blog', fb: 'Feedback dopo il tour', policy: 'Regole di annullo',
  err: 'Messaggi d’errore', legal: 'Testi per le pagine legali', demo: 'Modalità di prova', a11y: 'Accessibilità', lang: 'Nomi delle lingue', inv: 'Fatture (copia di cortesia)', pdf: 'Documenti PDF', voucher: 'Voucher',
};
export const sectionOf = (key) => key.split('.')[0];
export const labelOf = (section) => SECTION_LABEL[section] ?? section;

export function textsPage(ctx, { sections, current, q, rows, overridden, flash = '', error = '', values = {} }) {
  const base = '/admin/texts';
  const body = html`
<p class="muted">Qui cambi i testi dell’interfaccia del sito (menu, home, domande frequenti, pulsanti, messaggi…) nelle tre lingue. I testi lunghi di tour, articoli e pagine si modificano nelle loro sezioni. Mantieni le parti tra graffe (per esempio <code>{amount}</code>): il sito le sostituisce con i dati veri. Per tornare al testo originale cancella il contenuto e salva.</p>
<form method="get" action="${base}" class="inline-form search-inline"><input type="search" name="q" value="${q}" placeholder="Cerca una parola…" aria-label="Cerca nei testi"> <button class="btn btn-outline btn-sm" type="submit">Cerca</button></form>
<div class="tabs texts-tabs">${sections.map((s) => html`<a href="${base}?section=${s.name}" ${!q && s.name === current ? html`aria-current="page"` : ''}>${s.label} <small>${s.n}</small></a>`)}</div>
${q ? html`<h2 class="h-sub">Risultati per «${q}»</h2>` : ''}
${rows.length
  ? html`<form method="post" action="${base}" class="form text-table">
    <input type="hidden" name="section" value="${current}"><input type="hidden" name="q" value="${q}">
    <input type="hidden" name="keys" value="${rows.map((r) => r.key).join(' ')}">
    ${rows.map((r) => html`<div class="card pad text-row">
      <p class="small"><code>${r.key}</code>${overridden.has(r.key) ? html` <span class="chip chip-accent">modificato</span>` : ''}</p>
      <div class="grid grid-3">${LANGS.map((l, i) => html`<label class="field"><span class="label">${LANG_META[l].name}</span><textarea name="t__${r.key}__${l}" rows="${Math.min(8, Math.max(2, Math.ceil((values[`t__${r.key}__${l}`] ?? r.values[i] ?? '').length / 60)))}">${values[`t__${r.key}__${l}`] ?? r.values[i]}</textarea></label>`)}</div>
    </div>`)}
    <div class="btn-row sticky-actions"><button class="btn btn-gold" type="submit">Salva i testi di questa pagina</button></div>
  </form>`
  : html`<p class="muted">Nessun testo trovato.</p>`}`;
  return adminLayout(ctx, { title: 'Testi del sito', active: '/admin/texts', body, flash, error });
}
