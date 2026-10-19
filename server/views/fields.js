// Campi di modulo comuni: il paese (elenco in ordine alfabetico con ricerca) e il telefono (prefisso del paese con bandiera e ricerca, più il numero).
// Senza JavaScript restano due normali campi del browser (un menù e una casella); con public/js/combo.js il menù diventa un elenco con ricerca.
import { html, raw } from '../html.js';
import { LANG_COUNTRY, countries, dialOf, isCountry, isMainOfDial, splitPhone } from '../countries.js';
import { makeT } from '../i18n.js';

/** Il pannello è in italiano: i suoi moduli usano lo stesso campo del sito con le frasi italiane. */
export const ADMIN_CTX = { t: makeT('it'), lang: 'it' };

/** Le righe di un menù di paesi: nome (e prefisso, per il telefono) e, per la ricerca, tutto ciò che si può digitare. */
const optionOf = (c, { dial = false, selected = '' } = {}) =>
  html`<option value="${c.code}" data-flag="${c.flag}" data-name="${c.name}" data-s="${c.search}" ${dial ? html`data-dial="${c.dial}" ${isMainOfDial(c.code) ? raw('data-main') : ''}` : ''} ${c.code === selected ? raw('selected') : ''}>${c.flag} ${c.name}${dial ? ` (+${c.dial})` : ''}</option>`;

/**
 * Menù del paese. `label` è il testo dell'etichetta (può contenere <em>), `lang` la lingua dei nomi (di default quella della pagina).
 * Il valore inviato è la sigla ISO di due lettere (IT, DE…).
 */
export function countryField(ctx, { name = 'country', value = 'IT', label, required = true, lang = ctx.lang, span2 = false } = {}) {
  const selected = isCountry(value) ? String(value).toUpperCase() : '';
  const id = `f-${name}`;
  return html`<div class="field combo-field ${span2 ? 'span-2' : ''}"><label class="label" for="${id}">${label ?? ctx.t('f.country')}</label>
    <select name="${name}" id="${id}" class="combo-select" data-combo="country" data-search-label="${ctx.t('combo.search')}" data-none-label="${ctx.t('combo.none')}" ${required ? raw('required') : ''}>
      ${selected ? '' : html`<option value="" disabled selected>${ctx.t('combo.choose')}</option>`}
      ${countries(lang).map((c) => optionOf(c, { selected }))}
    </select></div>`;
}

/**
 * Telefono: prefisso internazionale (obbligatorio) e numero. Il numero salvato è «+39 3331234567».
 * `value` è il numero come salvato (o come l'ha scritto chi ha sbagliato), `cc` il paese scelto nel modulo,
 * `defaultCc` il paese di partenza se non c'è altro (di solito quello dell'agenzia, o della lingua della pagina; per l'inglese nessuno).
 */
export function phoneField(ctx, { name = 'phone', value = '', cc = '', defaultCc = '', label, required = false, lang = ctx.lang, autocomplete = 'tel', placeholder } = {}) {
  const fallback = [cc, defaultCc, LANG_COUNTRY[ctx.lang] ?? ''].map((x) => String(x ?? '').toUpperCase()).find((x) => isCountry(x) && dialOf(x)) ?? '';
  const parts = splitPhone(value, isCountry(cc) && dialOf(cc) ? String(cc).toUpperCase() : fallback);
  const id = `f-${name}`;
  return html`<div class="field phone-field"><label class="label" for="${id}">${label ?? ctx.t('f.phone')}</label>
    <div class="phone-row">
      <select name="${name}_cc" id="${id}-cc" class="combo-select" data-combo="phone" aria-label="${ctx.t('f.phonePrefix')}" data-search-label="${ctx.t('combo.search')}" data-none-label="${ctx.t('combo.none')}" ${required ? raw('required') : ''}>
        ${parts.cc ? '' : html`<option value="" disabled selected>${ctx.t('f.phonePrefix')}</option>`}
        ${countries(lang).map((c) => optionOf(c, { dial: true, selected: parts.cc }))}
      </select>
      <input type="tel" name="${name}" id="${id}" inputmode="tel" maxlength="40" autocomplete="${autocomplete}" placeholder="${placeholder ?? ctx.t('f.phoneEx')}" value="${parts.national}" ${required ? raw('required') : ''}>
    </div></div>`;
}

/**
 * I dati di fatturazione di un'azienda: paese, codice fiscale, indirizzo, CAP, città, provincia, SDI e PEC (codice fiscale, provincia, SDI e PEC solo per l'Italia:
 * public/js/b2b-register.js li nasconde per gli altri paesi). `lead` sono i campi che stanno prima (ragione sociale e partita IVA, nella registrazione).
 */
export function billingFields(ctx, v = {}, { lead = '' } = {}) {
  const { t } = ctx;
  const val = (k, d = '') => v[k] ?? d;
  return html`<div class="form-grid">${lead}
      ${countryField(ctx, { name: 'country', value: val('country', 'IT'), label: t('b2b.reg.country') })}
      <label class="field" data-it><span class="label">${t('b2b.reg.taxCode')} <em>${t('b2b.reg.taxCodeHint')}</em></span><input name="tax_code" maxlength="30" autocomplete="off" value="${val('tax_code')}"></label>
      <label class="field span-2"><span class="label">${t('b2b.reg.street')}</span><input name="address" required maxlength="120" autocomplete="address-line1" value="${val('address')}"></label>
    </div>
    <div class="form-grid form-grid-3">
      <label class="field"><span class="label">${t('b2b.reg.zip')}</span><input name="zip" required maxlength="12" autocomplete="postal-code" value="${val('zip')}"></label>
      <label class="field"><span class="label">${t('b2b.reg.city')}</span><input name="city" required maxlength="80" autocomplete="address-level2" value="${val('city')}"></label>
      <label class="field" data-it><span class="label">${t('b2b.reg.province')}</span><input name="province" maxlength="3" autocomplete="address-level1" placeholder="${t('b2b.reg.provinceHint')}" value="${val('province')}"></label>
    </div>
    <div class="form-grid">
      <label class="field" data-it><span class="label">${t('b2b.reg.sdi')} <em>${t('b2b.reg.sdiHint')}</em></span><input name="sdi_code" maxlength="10" value="${val('sdi_code')}"></label>
      <label class="field" data-it><span class="label">${t('b2b.reg.pec')} <em>${t('b2b.reg.pecHint')}</em></span><input type="email" name="pec" maxlength="200" value="${val('pec')}"></label>
    </div>`;
}
