import { html, raw } from '../html.js';
import { ART_KEYS } from '../art.js';
import { LANGS, LANG_META } from '../langs.js';
import { formatMoney } from '../util.js';
import { adminLayout } from './admin.js';
import { uploadControl } from './admin-media.js';
import { mdEditor } from './md-editor.js';

export const TEXT_FIELDS = ['title', 'subtitle', 'summary', 'meetingPoint', 'meetingUrl', 'description', 'highlights', 'includes', 'excludes', 'notes'];
export const LIST_FIELDS = ['highlights', 'includes', 'excludes'];
const ART_LABEL = { dome: 'Cupole e campanile', bridge: 'Ponte', ghetto: 'Case del Ghetto', arsenal: 'Arsenale', eastwest: 'Oriente e Occidente', islands: 'Isole della laguna', walk: 'Passeggiata', piles: 'Pali e fondamenta', bacaro: 'Bacaro' };
const DAYS = [[1, 'Lun'], [2, 'Mar'], [3, 'Mer'], [4, 'Gio'], [5, 'Ven'], [6, 'Sab'], [0, 'Dom']];
const euroText = (n) => (n == null || n === '' ? '' : String(Number(n).toFixed(2)).replace(/\.00$/, '').replace('.', ','));

/** Dalla definizione salvata ai valori del modulo (stringhe). */
export function defToValues(def = {}, slug = '') {
  const dur = Number(def.duration) || 0;
  const v = {
    slug,
    active: def.active === false ? '' : '1',
    featured: def.featured ? '1' : '',
    order: String(def.order ?? 100),
    model: def.model ?? 'person',
    flexible: def.flexible ? '1' : '',
    times: (def.times ?? []).join(', '),
    wd: (Array.isArray(def.weekdays) && def.weekdays.length ? def.weekdays : [0, 1, 2, 3, 4, 5, 6]).map(String),
    durH: dur ? String(Math.floor(dur / 60)) : '',
    durM: dur ? String(dur % 60) : '',
    maxParticipants: def.maxParticipants != null ? String(def.maxParticipants) : '',
    price: euroText(def.price),
    b2bPrice: euroText(def.b2bPrice),
    cancelHours: def.cancelHours != null ? String(def.cancelHours) : '',
    payOnSite: def.payOnSite === false ? '' : '1',
    langs: Array.isArray(def.languages) && def.languages.length ? def.languages : [...LANGS],
    art: def.art ?? 'dome',
    image: def.image ?? '',
  };
  for (const l of LANGS) for (const f of TEXT_FIELDS) v[`${f}_${l}`] = LIST_FIELDS.includes(f) ? (def[l]?.[f] ?? []).join('\n') : (def[l]?.[f] ?? '');
  return v;
}

const kindLabel = (t) => (t.model === 'person' ? 'Partenze fisse · a persona' : t.flexible ? 'Servizio privato · a gruppo, orario libero' : 'Servizio privato · a gruppo');

export function toursPage(ctx, { tours, upcoming, flash = '', error = '' }) {
  const body = html`
<p class="btn-row"><a class="btn btn-gold" href="/admin/tours/new">Nuovo tour</a></p>
${ctx.app.content.problems?.length ? html`<div class="notice notice-err" role="alert"><strong>Alcuni contenuti hanno problemi e non compaiono nel sito:</strong><ul class="plain">${ctx.app.content.problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
${tours.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Tour</th><th class="num">Pubblico</th><th class="num">Partner</th><th>Stato</th><th></th></tr></thead><tbody>
    ${tours.map((t) => html`<tr><td><a href="/admin/tours/${t.slug}"><strong>${t.i18n.it.title}</strong></a><br><small class="muted">${kindLabel(t)} · ${Math.floor(t.durationMin / 60)}h${String(t.durationMin % 60).padStart(2, '0')} · max ${t.maxParticipants}${upcoming[t.slug] ? ` · ${upcoming[t.slug]} prenotazion${upcoming[t.slug] === 1 ? 'e' : 'i'} future` : ''}</small>
      <br>${LANGS.filter((l) => t.i18n[l].fallback).map((l) => html`<span class="chip chip-warn" title="Il sito mostra il testo di un'altra lingua">manca ${LANG_META[l].short}</span> `)}</td>
      <td class="num">${formatMoney(t.priceCents, 'it')}</td><td class="num">${formatMoney(t.b2bPriceCents, 'it')}</td>
      <td><span class="chip ${t.active ? 'chip-ok' : 'chip-warn'}">${t.active ? 'visibile' : 'nascosto'}</span></td>
      <td class="actions"><a class="btn btn-outline btn-sm" href="/admin/tours/${t.slug}">Modifica</a>
        <form method="post" action="/admin/tours/${t.slug}/toggle" class="inline-form"><button class="btn btn-outline btn-sm" type="submit">${t.active ? 'Nascondi' : 'Mostra'}</button></form></td></tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessun tour: creane uno.</p>`}`;
  return adminLayout(ctx, { title: 'Tour e servizi', active: '/admin/tours', body, flash, error });
}

const field = (label, name, value, { type = 'text', hint = '', rows = 0, attrs = '', placeholder = '' } = {}) => html`<label class="field"><span class="label">${label}${hint ? html` <em>${hint}</em>` : ''}</span>${rows
  ? html`<textarea name="${name}" rows="${rows}" ${raw(attrs)}>${value ?? ''}</textarea>`
  : html`<input type="${type}" name="${name}" value="${value ?? ''}" placeholder="${placeholder}" ${raw(attrs)}>`}</label>`;

export function tourFormPage(ctx, { v, isNew, media, error = '', flash = '', problems = [], tour = null }) {
  const has = (l) => TEXT_FIELDS.some((f) => v[`${f}_${l}`]);
  const body = html`
<p><a href="/admin/tours">← Tutti i tour</a>${tour ? html` · <a href="/it/tours/${tour.slug}" target="_blank" rel="noopener">Vedi sul sito</a> · <a href="/admin/tours/new?from=${tour.slug}">Duplica</a>` : ''}</p>
<form method="post" action="${isNew ? '/admin/tours' : `/admin/tours/${v.slug}`}" class="form tour-form">
  ${problems.length ? html`<div class="notice notice-err" role="alert"><ul class="plain">${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}

  <div class="card pad">
    <h2>Informazioni generali</h2>
    <div class="form-grid">
      ${isNew
        ? field('Indirizzo web (slug)', 'slug', v.slug, { hint: 'es. cannaregio-ghetto: non si può cambiare dopo', attrs: 'required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="60" autocapitalize="off"' })
        : html`<div class="field"><span class="label">Indirizzo web</span><code>/tours/${v.slug}</code></div>`}
      ${field('Ordine nell’elenco', 'order', v.order, { type: 'number', hint: 'più basso = più in alto', attrs: 'min="0" max="9999"' })}
    </div>
    <div class="form-grid">
      <label class="check"><input type="checkbox" name="active" value="1" ${v.active ? raw('checked') : ''}> Visibile sul sito e prenotabile</label>
      <label class="check"><input type="checkbox" name="featured" value="1" ${v.featured ? raw('checked') : ''}> In evidenza (in home)</label>
    </div>
    <fieldset class="field"><legend class="label">Tipo di servizio</legend>
      <label class="check"><input type="radio" name="model" value="person" ${v.model === 'person' ? raw('checked') : ''}> <strong>Partenze fisse, prezzo a persona</strong> (tour in piccoli gruppi con orari stabiliti)</label>
      <label class="check"><input type="radio" name="model" value="group" ${v.model === 'group' ? raw('checked') : ''}> <strong>Servizio privato, prezzo a gruppo</strong> (il cliente sceglie l’orario)</label>
      <label class="check"><input type="checkbox" name="flexible" value="1" ${v.flexible ? raw('checked') : ''}> Orario libero (nessuna partenza fissa: il cliente sceglie quando iniziare)</label>
    </fieldset>
    ${field('Orari di partenza', 'times', v.times, { hint: 'solo per le partenze fisse; separati da virgola, es. 09:30, 14:30', attrs: 'inputmode="text" autocomplete="off"' })}
    <fieldset class="field"><legend class="label">Giorni in cui si svolge</legend><div class="check-row">${DAYS.map(([d, l]) => html`<label class="check"><input type="checkbox" name="wd" value="${d}" ${v.wd.includes(String(d)) ? raw('checked') : ''}> ${l}</label>`)}</div></fieldset>
    <div class="form-grid">
      <div class="field"><span class="label">Durata</span><div class="inline-fields"><input type="number" name="durH" value="${v.durH}" min="0" max="24" aria-label="ore" class="tier-num" required> <span>ore</span> <input type="number" name="durM" value="${v.durM}" min="0" max="59" step="5" aria-label="minuti" class="tier-num"> <span>minuti</span></div></div>
      ${field('Persone al massimo', 'maxParticipants', v.maxParticipants, { type: 'number', attrs: 'min="1" max="200" required' })}
    </div>
  </div>

  <div class="card pad">
    <h2>Prezzi e regole</h2>
    <div class="form-grid">
      ${field(v.model === 'person' ? 'Prezzo al pubblico (€ a persona)' : 'Prezzo al pubblico (€ a gruppo)', 'price', v.price, { hint: 'es. 35 oppure 35,50', attrs: 'inputmode="decimal" required' })}
      ${field('Tariffa partner B2B (€)', 'b2bPrice', v.b2bPrice, { hint: 'vuoto = uguale al pubblico', attrs: 'inputmode="decimal"' })}
    </div>
    <div class="form-grid">
      ${field('Cancellazione gratuita (ore prima)', 'cancelHours', v.cancelHours, { type: 'number', hint: 'vuoto = regola generale del sito (privati)', attrs: 'min="0" max="2000"' })}
      <label class="check"><input type="checkbox" name="payOnSite" value="1" ${v.payOnSite ? raw('checked') : ''}> Si può pagare sul posto (se il sito lo consente)</label>
    </div>
    <fieldset class="field"><legend class="label">Lingue in cui offri questo servizio</legend><div class="check-row">${LANGS.map((l) => html`<label class="check"><input type="checkbox" name="langs" value="${l}" ${v.langs.includes(l) ? raw('checked') : ''}> ${LANG_META[l].name}</label>`)}</div></fieldset>
    <p class="muted small">I prezzi dedicati ai singoli partner si impostano nella scheda del partner.</p>
  </div>

  <div class="card pad">
    <h2>Immagine di copertina</h2>
    <div data-upload data-media-picker data-field="image">
      <div class="media-picker">
        <label class="media-choice"><input type="radio" name="image" value="" ${v.image ? '' : raw('checked')}><span class="media-none">Nessuna foto: illustrazione</span></label>
        ${media.map((m) => html`<label class="media-choice"><input type="radio" name="image" value="${m.name}" ${v.image === m.name ? raw('checked') : ''}><img src="/media/${m.small_name ?? m.name}" alt="" loading="lazy"></label>`)}
      </div>
      <p>${uploadControl('Carica una nuova foto')}</p>
    </div>
    <label class="field"><span class="label">Illustrazione (si usa se non c’è una foto)</span><select name="art">${ART_KEYS.map((k) => html`<option value="${k}" ${v.art === k ? raw('selected') : ''}>${ART_LABEL[k] ?? k}</option>`)}</select></label>
  </div>

  ${LANGS.map((l) => html`<details class="card pad lang-block" ${l === 'it' || has(l) || error ? raw('open') : ''}>
    <summary><h2>Testi · ${LANG_META[l].name}${l === 'it' ? '' : html` <small class="muted">(se vuoti, il sito mostra l’${l === 'es' ? 'inglese' : 'italiano'})</small>`}</h2></summary>
    ${field('Titolo', `title_${l}`, v[`title_${l}`], { attrs: l === 'it' ? 'required maxlength="120"' : 'maxlength="120"' })}
    ${field('Sottotitolo', `subtitle_${l}`, v[`subtitle_${l}`], { attrs: 'maxlength="160"' })}
    ${field('Riassunto', `summary_${l}`, v[`summary_${l}`], { hint: 'una o due frasi: compare negli elenchi e nei risultati di Google', rows: 3, attrs: l === 'it' ? 'required maxlength="400"' : 'maxlength="400"' })}
    ${field('Punto d’incontro', `meetingPoint_${l}`, v[`meetingPoint_${l}`], { attrs: 'maxlength="200"' })}
    ${field('Link alla mappa', `meetingUrl_${l}`, v[`meetingUrl_${l}`], { type: 'url', hint: 'indirizzo Google Maps (facoltativo)', attrs: 'maxlength="400"' })}
    ${mdEditor(`description_${l}`, v[`description_${l}`], { rows: 10, label: 'Descrizione', media })}
    ${field('Punti salienti', `highlights_${l}`, v[`highlights_${l}`], { hint: 'uno per riga', rows: 4 })}
    ${field('Incluso', `includes_${l}`, v[`includes_${l}`], { hint: 'uno per riga', rows: 4 })}
    ${field('Non incluso', `excludes_${l}`, v[`excludes_${l}`], { hint: 'uno per riga', rows: 3 })}
    ${field('Note utili', `notes_${l}`, v[`notes_${l}`], { rows: 3 })}
  </details>`)}

  <div class="btn-row sticky-actions"><button class="btn btn-gold" type="submit">${isNew ? 'Crea il tour' : 'Salva le modifiche'}</button> <a class="btn btn-outline" href="/admin/tours">Annulla</a></div>
</form>
${tour && !isNew ? html`<form method="post" action="/admin/tours/${tour.slug}/delete" class="form" data-confirm="Eliminare definitivamente questo tour?"><h2 class="h-sub spaced">Eliminare</h2><p class="muted small">Un tour con prenotazioni non si può eliminare (nascondilo: resta nello storico).</p><button class="btn btn-danger btn-sm" type="submit">Elimina il tour</button></form>` : ''}`;
  return adminLayout(ctx, { title: isNew ? 'Nuovo tour' : v.title_it || v.slug, active: '/admin/tours', body, flash, error, scripts: `<script src="/js/admin-media.js?v=${ctx.app.assetVersion}" defer></script><script src="/js/admin-content.js?v=${ctx.app.assetVersion}" defer></script>` });
}

export function pricesPage(ctx, { tours, values = {}, flash = '', error = '' }) {
  const body = html`
<p class="muted">Tutti i prezzi in un colpo d’occhio. Scrivi il nuovo importo e salva: vale per le <strong>nuove</strong> prenotazioni (quelle già fatte non cambiano). I prezzi dedicati ai singoli partner stanno nella loro scheda.</p>
<form method="post" action="/admin/prices" class="card pad form">
  <div class="table-wrap"><table class="table price-table"><thead><tr><th>Tour</th><th class="num">Pubblico (€)</th><th class="num">Partner B2B (€)</th><th>Stato</th></tr></thead><tbody>
    ${tours.map((t) => html`<tr><td><strong>${t.i18n.it.title}</strong><br><small class="muted">${t.model === 'person' ? 'a persona' : 'a gruppo'}</small></td>
      <td class="num"><input class="price-input" name="price_${t.slug}" inputmode="decimal" value="${values[`price_${t.slug}`] ?? euroText(t.priceCents / 100)}" required aria-label="Prezzo al pubblico per ${t.i18n.it.title}"></td>
      <td class="num"><input class="price-input" name="b2b_${t.slug}" inputmode="decimal" value="${values[`b2b_${t.slug}`] ?? euroText(t.b2bPriceCents / 100)}" required aria-label="Tariffa partner per ${t.i18n.it.title}"></td>
      <td><span class="chip ${t.active ? 'chip-ok' : 'chip-warn'}">${t.active ? 'visibile' : 'nascosto'}</span></td></tr>`)}
  </tbody></table></div>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva i prezzi</button></div>
</form>`;
  return adminLayout(ctx, { title: 'Listino prezzi', active: '/admin/prices', body, flash, error });
}
