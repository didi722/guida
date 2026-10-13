import { html, raw } from '../html.js';
import { adminLayout } from './admin.js';

const YES_NO = (v) => (v ? 'sì' : 'no');
const INPUT_TYPE = { email: 'email', phone: 'tel', url: 'url', date: 'date' };
const NUMERIC = new Set(['int', 'eur', 'pct']);

/** Un campo del modulo, con etichetta, suggerimento, errore e (se diverso) il valore predefinito. */
function fieldHtml(f) {
  const err = f.error ? html`<span class="field-error" role="alert">${f.error}</span>` : '';
  const dflt = f.changed ? html`<small class="muted">Predefinito: ${f.type === 'bool' ? YES_NO(f.base) : f.type === 'select' ? (f.options.find(([v]) => v === f.base)?.[1] ?? f.base) : f.base || '(vuoto)'}</small>` : '';
  if (f.type === 'bool') {
    return html`<div class="field"><label class="check"><input type="checkbox" name="${f.key}" value="1" ${f.value ? raw('checked') : ''}> <span><strong>${f.label}</strong>${f.hint ? html`<br><small class="muted">${f.hint}</small>` : ''}</span></label>${err}${dflt}</div>`;
  }
  const label = html`<span class="label">${f.label}${f.hint ? html` <em>${f.hint}</em>` : ''}</span>`;
  if (f.type === 'tiers') {
    // la tabella «se il tour è fra almeno N giorni, l'opzione dura D giorni»: righe con due numeri, qualche riga vuota per aggiungerne
    const rows = Array.from({ length: 5 }, (_, i) => f.value[i] ?? { from: '', days: '' });
    const summary = f.base.length ? f.base.map((r) => `da ${r.from} giorni: ${r.days}`).join(' · ') : '(nessuna riga)';
    return html`<fieldset class="field field-wide tiers-field"><legend class="label">${f.label}${f.hint ? html` <em>${f.hint}</em>` : ''}</legend>
      <div class="tier-rows">${rows.map((r, i) => html`<div class="tier-row"><span class="muted">Se il tour è fra almeno</span>
        <input name="${f.key}.${i}.from" inputmode="numeric" value="${r.from}" aria-label="Giorni che mancano al tour, riga ${i + 1}" class="tier-num" autocomplete="off">
        <span class="muted">giorni, l’opzione dura</span>
        <input name="${f.key}.${i}.days" inputmode="numeric" value="${r.days}" aria-label="Durata dell’opzione in giorni, riga ${i + 1}" class="tier-num" autocomplete="off"><span>giorni</span></div>`)}</div>
      <p class="small muted">Lascia vuote le righe che non servono. Esempio: «da 30 giorni: 10» vuol dire che per un tour che inizia fra 30 giorni o più l’opzione dura 10 giorni.</p>
      ${err}${f.changed ? html`<small class="muted">Predefinito: ${summary}</small>` : ''}</fieldset>`;
  }
  if (f.type === 'select') {
    return html`<label class="field">${label}<select name="${f.key}">${f.options.map(([v, l]) => html`<option value="${v}" ${v === f.value ? raw('selected') : ''}>${l}</option>`)}</select>${err}${dflt}</label>`;
  }
  if (f.type === 'textarea') {
    return html`<label class="field field-wide">${label}<textarea name="${f.key}" rows="3" maxlength="${f.max ?? 1000}">${f.value}</textarea>${err}${dflt}</label>`;
  }
  const attrs = f.type === 'int' ? 'inputmode="numeric"' : NUMERIC.has(f.type) ? 'inputmode="decimal"' : f.type === 'digits' ? 'inputmode="numeric"' : '';
  const input = html`<input type="${INPUT_TYPE[f.type] ?? 'text'}" name="${f.key}" value="${f.value}" ${f.max && !NUMERIC.has(f.type) ? raw(`maxlength="${f.max}"`) : ''} ${f.required ? raw('required') : ''} ${raw(attrs)} autocomplete="off" ${f.type === 'upper' || f.type === 'vat' || f.type === 'iban' ? raw('autocapitalize="characters" spellcheck="false"') : ''}>`;
  return html`<label class="field">${label}${f.unit ? html`<span class="input-unit">${input}<span class="unit">${f.unit}</span></span>` : input}${err}${dflt}</label>`;
}

function fieldsHtml(fields) {
  const out = [];
  let group = null;
  for (const f of fields) {
    if (f.group && f.group !== group) {
      group = f.group;
      out.push(html`<h3 class="settings-group">${group}</h3>`);
    }
    out.push(fieldHtml(f));
  }
  return html`<div class="form-grid settings-grid">${out}</div>`;
}

export function settingsPage(ctx, { sections, open = '', problems = [], flash = '', error = '' }) {
  const body = html`
<p class="muted">Qui cambi i dati dell’attività e le regole di prenotazione, senza toccare il codice. Ogni sezione si salva da sola e le modifiche sono subito attive. I campi che non tocchi restano come sono; il valore «predefinito» è quello della configurazione del server, a cui puoi sempre tornare.</p>
${sections.map((s) => html`<details class="card pad settings-section" id="${s.id}" ${open === s.id || s.fields.some((f) => f.error) ? raw('open') : ''}>
  <summary><h2>${s.title}${s.changed ? html` <span class="chip chip-accent">modificata</span>` : ''}</h2></summary>
  ${s.intro ? html`<p class="muted">${s.intro}</p>` : ''}
  ${s.id === 'invoice' && problems.length ? html`<div class="notice notice-err" role="alert"><strong>Per poter emettere fatture mancano o non tornano:</strong><ul class="plain problems">${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
  <form method="post" action="/admin/settings/${s.id}" class="form">
    ${fieldsHtml(s.fields)}
    <div class="btn-row"><button class="btn btn-gold" type="submit">Salva questa sezione</button></div>
  </form>
  ${s.changed ? html`<form method="post" action="/admin/settings/${s.id}/reset" data-confirm="Tornare ai valori predefiniti di questa sezione?" class="inline-form"><button class="btn btn-outline btn-sm" type="submit">Ripristina i valori predefiniti</button></form>` : ''}
</details>`)}
<div class="card pad">
  <h2>Cosa non si cambia da qui</h2>
  <p class="muted">Per sicurezza restano nella configurazione del server (variabili d’ambiente dell’hosting): password del pannello, chiavi di Stripe, posta in uscita (SMTP), PEC per SdI, indirizzo del sito. Come si cambiano è spiegato nella guida.</p>
</div>`;
  return adminLayout(ctx, { title: 'Impostazioni', active: '/admin/settings', body, flash, error, scripts: `<script src="/js/admin-settings.js?v=${ctx.app.assetVersion}" defer></script>` });
}
