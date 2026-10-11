import { html, raw } from '../html.js';
import { ART_KEYS } from '../art.js';
import { LANGS, LANG_META } from '../langs.js';
import { fmtDate } from '../time.js';
import { adminLayout } from './admin.js';
import { uploadControl } from './admin-media.js';

const ART_LABEL = { dome: 'Cupole e campanile', bridge: 'Ponte', ghetto: 'Case del Ghetto', arsenal: 'Arsenale', eastwest: 'Oriente e Occidente', islands: 'Isole della laguna', walk: 'Passeggiata', piles: 'Pali e fondamenta', bacaro: 'Bacaro' };
const PAGE_INFO = {
  about: ['Chi sono', 'La tua presentazione.'],
  privacy: ['Privacy', 'Informativa sul trattamento dei dati: fai rivedere il testo dal tuo consulente.'],
  terms: ['Condizioni di prenotazione', 'Prezzi, pagamenti, cancellazioni, buoni regalo: fai rivedere il testo dal tuo consulente.'],
  cookies: ['Cookie', 'Informativa sui cookie.'],
};
export const PAGE_VARS = ['name', 'legalName', 'email', 'phone', 'vat', 'address', 'license', 'giftMonths', 'payMethods', 'b2cHours', 'b2bHours'];

export function postToValues(raw = {}, slug = '') {
  const v = { slug, date: raw.date ?? '', published: raw.published === false ? '' : '1', art: raw.art ?? 'dome', image: raw.image ?? '', tours: raw.tours ?? [] };
  for (const l of LANGS) {
    v[`title_${l}`] = raw[l]?.title ?? '';
    v[`summary_${l}`] = raw[l]?.summary ?? '';
    v[`tags_${l}`] = (raw[l]?.tags ?? []).join(', ');
    v[`body_${l}`] = raw[l]?.body ?? '';
  }
  return v;
}

export function blogListPage(ctx, { posts, flash = '', error = '' }) {
  const body = html`
<p class="btn-row"><a class="btn btn-gold" href="/admin/blog/new">Nuovo articolo</a></p>
${posts.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Articolo</th><th>Data</th><th>Lingue</th><th>Stato</th><th></th></tr></thead><tbody>
    ${posts.map((p) => {
      const first = p.i18n.it ?? Object.values(p.i18n)[0];
      return html`<tr><td><a href="/admin/blog/${p.slug}"><strong>${first.title}</strong></a><br><small class="muted">/blog/${p.slug}</small></td><td>${fmtDate(p.date, 'it', 'short')}</td>
        <td>${LANGS.map((l) => html`<span class="chip ${p.i18n[l] ? 'chip-ok' : ''}">${LANG_META[l].short}</span> `)}</td>
        <td><span class="chip ${p.published ? 'chip-ok' : 'chip-warn'}">${p.published ? 'pubblicato' : 'bozza'}</span></td>
        <td class="num"><a class="btn btn-outline btn-sm" href="/admin/blog/${p.slug}">Modifica</a>${p.published ? html` <a class="btn btn-outline btn-sm" href="/it/blog/${p.slug}" target="_blank" rel="noopener">Vedi</a>` : ''}</td></tr>`;
    })}
  </tbody></table></div>`
  : html`<p class="muted">Nessun articolo: scrivi il primo.</p>`}`;
  return adminLayout(ctx, { title: 'Blog', active: '/admin/blog', body, flash, error });
}

const field = (label, name, value, { type = 'text', hint = '', rows = 0, attrs = '' } = {}) => html`<label class="field"><span class="label">${label}${hint ? html` <em>${hint}</em>` : ''}</span>${rows
  ? html`<textarea name="${name}" rows="${rows}" ${raw(attrs)}>${value ?? ''}</textarea>`
  : html`<input type="${type}" name="${name}" value="${value ?? ''}" ${raw(attrs)}>`}</label>`;

const mdBlock = (name, value, rows = 16) => html`<div data-md><label class="field"><span class="label">Testo <em>(**grassetto**, *corsivo*, «## Titolo», elenchi con «- », [testo](indirizzo))</em></span><textarea name="${name}" rows="${rows}" data-md-source>${value}</textarea></label>
  <p><button class="btn btn-outline btn-sm" type="button" data-md-toggle>Anteprima</button></p><div class="md-preview prose" data-md-preview hidden></div></div>`;

export function postFormPage(ctx, { v, isNew, media, tours, problems = [], flash = '', post = null }) {
  const has = (l) => v[`title_${l}`] || v[`body_${l}`];
  const body = html`
<p><a href="/admin/blog">← Tutti gli articoli</a>${post && post.published ? html` · <a href="/it/blog/${post.slug}" target="_blank" rel="noopener">Vedi sul sito</a>` : ''}</p>
<form method="post" action="${isNew ? '/admin/blog' : `/admin/blog/${v.slug}`}" class="form tour-form">
  ${problems.length ? html`<div class="notice notice-err" role="alert"><ul class="plain">${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
  <div class="card pad">
    <h2>Informazioni</h2>
    <div class="form-grid">
      ${isNew ? field('Indirizzo web (slug)', 'slug', v.slug, { hint: 'es. cicchetti-e-bacari; vuoto = dal titolo', attrs: 'pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="60" autocapitalize="off"' }) : html`<div class="field"><span class="label">Indirizzo web</span><code>/blog/${v.slug}</code></div>`}
      ${field('Data di pubblicazione', 'date', v.date, { type: 'date', attrs: 'required' })}
    </div>
    <label class="check"><input type="checkbox" name="published" value="1" ${v.published ? raw('checked') : ''}> Pubblicato (se lo togli diventa una bozza, invisibile sul sito)</label>
    ${tours.length ? html`<fieldset class="field"><legend class="label">Tour collegati <em>(compaiono in fondo all’articolo)</em></legend><div class="check-row">${tours.map((t) => html`<label class="check"><input type="checkbox" name="tours" value="${t.slug}" ${v.tours.includes(t.slug) ? raw('checked') : ''}> ${t.i18n.it.title}</label>`)}</div></fieldset>` : ''}
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
  ${LANGS.map((l) => html`<details class="card pad lang-block" ${l === 'it' || has(l) ? raw('open') : ''}>
    <summary><h2>Testo · ${LANG_META[l].name}${l === 'it' ? '' : html` <small class="muted">(se non lo scrivi, l’articolo non compare in questa lingua)</small>`}</h2></summary>
    ${field('Titolo', `title_${l}`, v[`title_${l}`], { attrs: 'maxlength="160"' })}
    ${field('Riassunto', `summary_${l}`, v[`summary_${l}`], { hint: 'una o due frasi: elenco articoli e Google', rows: 3, attrs: 'maxlength="400"' })}
    ${field('Etichette', `tags_${l}`, v[`tags_${l}`], { hint: 'separate da virgola' })}
    ${mdBlock(`body_${l}`, v[`body_${l}`])}
  </details>`)}
  <div class="btn-row sticky-actions"><button class="btn btn-gold" type="submit">${isNew ? 'Crea l’articolo' : 'Salva le modifiche'}</button> <a class="btn btn-outline" href="/admin/blog">Annulla</a></div>
</form>
${post && !isNew ? html`<form method="post" action="/admin/blog/${post.slug}/delete" class="form" data-confirm="Eliminare definitivamente questo articolo?"><h2 class="h-sub spaced">Eliminare</h2><button class="btn btn-danger btn-sm" type="submit">Elimina l’articolo</button></form>` : ''}`;
  return adminLayout(ctx, { title: isNew ? 'Nuovo articolo' : v.title_it || v.title_en || v.slug, active: '/admin/blog', body, flash, scripts: `<script src="/js/admin-media.js?v=${ctx.app.assetVersion}" defer></script><script src="/js/admin-content.js?v=${ctx.app.assetVersion}" defer></script>` });
}

export function pagesListPage(ctx, { flash = '', error = '' }) {
  const names = ctx.app.content.pageNames;
  const body = html`<p class="muted">Pagine fisse del sito. Si scrivono in markdown; i testi tra doppie graffe (per esempio <code>{{license}}</code>) vengono sostituiti con i dati dell’attività.</p>
<div class="card table-wrap"><table class="table"><tbody>
  ${Object.keys(PAGE_INFO).filter((n) => names.includes(n)).map((n) => html`<tr><td><a href="/admin/pages/${n}"><strong>${PAGE_INFO[n][0]}</strong></a><br><small class="muted">${PAGE_INFO[n][1]}</small></td>
    <td>${LANGS.map((l) => html`<span class="chip ${ctx.app.content.rawPage?.(n)?.[l] ? 'chip-ok' : ''}">${LANG_META[l].short}</span> `)}</td><td class="num"><a class="btn btn-outline btn-sm" href="/admin/pages/${n}">Modifica</a> <a class="btn btn-outline btn-sm" href="/it/${n}" target="_blank" rel="noopener">Vedi</a></td></tr>`)}
</tbody></table></div>`;
  return adminLayout(ctx, { title: 'Pagine', active: '/admin/pages', body, flash, error });
}

export function pageFormPage(ctx, { name, raw: data, problems = [], flash = '' }) {
  const [label, hint] = PAGE_INFO[name];
  const v = (l, k) => data?.[l]?.[k] ?? '';
  const body = html`
<p><a href="/admin/pages">← Tutte le pagine</a> · <a href="/it/${name}" target="_blank" rel="noopener">Vedi sul sito</a></p>
<form method="post" action="/admin/pages/${name}" class="form tour-form">
  ${problems.length ? html`<div class="notice notice-err" role="alert"><ul class="plain">${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
  <p class="muted">${hint} Dati sostituiti in automatico: ${PAGE_VARS.map((k) => html`<code>{{${k}}}</code> `)}</p>
  ${LANGS.map((l) => html`<details class="card pad lang-block" ${l === 'it' || v(l, 'title') || v(l, 'body') ? raw('open') : ''}>
    <summary><h2>${label} · ${LANG_META[l].name}</h2></summary>
    ${field('Titolo', `title_${l}`, v(l, 'title'), { attrs: 'maxlength="160"' })}
    ${field('Descrizione per Google', `description_${l}`, v(l, 'description'), { hint: 'una frase', attrs: 'maxlength="300"' })}
    ${mdBlock(`body_${l}`, v(l, 'body'), 22)}
  </details>`)}
  <div class="btn-row sticky-actions"><button class="btn btn-gold" type="submit">Salva la pagina</button> <a class="btn btn-outline" href="/admin/pages">Annulla</a></div>
</form>`;
  return adminLayout(ctx, { title: label, active: '/admin/pages', body, flash, scripts: `<script src="/js/admin-content.js?v=${ctx.app.assetVersion}" defer></script>` });
}
