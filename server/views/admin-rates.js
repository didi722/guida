// Sito › Tariffe a ore: il modulo con tutte le cifre (scaglioni, ora extra, supplementi, giorni festivi).
import { html, raw } from '../html.js';
import { BRACKETS, SERVICES, extraFieldName, priceFieldName } from '../rates.js';
import { adminLayout } from './admin.js';

const SERVICE_LABEL = { guide: 'Servizio guida', assistant: 'Assistente in loco', leader: 'Tour leader', meetgreet: 'Meet & greet' };
const SERVICE_HINT = {
  guide: 'Il pubblico vede solo questo servizio. Le tariffe sono per l’intero gruppo.',
  assistant: 'Solo per le agenzie. Lascia vuota la colonna «Pubblico» per non offrirlo ai privati.',
  leader: 'Solo per le agenzie. Parte da 4 ore.',
  meetgreet: 'Solo per le agenzie. La prima ora è compresa nel prezzo base.',
};
const BRACKET_LABEL = { 1: 'Fino a 1 ora', 2: '2 ore', 4: 'Mezza giornata (4 ore)', 8: 'Giornata intera (8 ore)' };
const euro = (cents) => (cents == null ? '' : String((cents / 100).toFixed(2)).replace(/\.00$/, '').replace('.', ','));

export function ratesPage(ctx, { rates, values = null, errors = {}, custom = false, flash = '', error = '' }) {
  /** Il valore da mostrare in un campo: ciò che è stato scritto (dopo un errore) oppure la cifra in uso. */
  const val = (name, fallback) => (values && name in values ? values[name] : fallback);
  const err = (name) => (errors[name] ? html`<small class="field-error">${errors[name]}</small>` : '');
  const priceInput = (service, channel, i, cents) => {
    const name = i === 'extra' ? extraFieldName(service, channel) : priceFieldName(service, channel, i);
    return html`<input class="price-input" name="${name}" inputmode="decimal" autocomplete="off" value="${val(name, euro(cents))}" aria-label="${SERVICE_LABEL[service]}, ${channel === 'b2b' ? 'agenzie' : 'pubblico'}, ${i === 'extra' ? 'ogni ora in più' : BRACKET_LABEL[BRACKETS[service][i]]}">${err(name)}`;
  };
  const s = rates.surcharges;
  const d = rates.days;

  const body = html`
<p class="muted">Qui scrivi le tue <strong>tariffe a ore</strong>: valgono per le <strong>nuove</strong> prenotazioni (quelle già fatte conservano il loro conto). Gli importi sono <strong>per l’intero gruppo</strong>, in euro. Il sito calcola da solo festivi, notturno e auricolari dalla data e dall’orario scelti dal cliente.</p>
${custom ? '' : html`<div class="notice notice-ok" role="note">Stai usando le <strong>cifre iniziali</strong>, un punto di partenza pensato guardando le tariffe di altre guide e associazioni di Venezia: controllale e adattale a te, con il tuo commercialista.</div>`}
<form method="post" action="/admin/rates" class="form rates-form">
  ${SERVICES.map((service) => {
    const pub = rates.services[service]?.public;
    const b2b = rates.services[service]?.b2b;
    return html`<div class="card pad">
      <h2>${SERVICE_LABEL[service]}</h2>
      <p class="muted small">${SERVICE_HINT[service]}</p>
      <div class="table-wrap"><table class="table price-table"><thead><tr><th>Quanto dura</th><th class="num">Pubblico (€)</th><th class="num">Agenzie (€)</th></tr></thead><tbody>
        ${BRACKETS[service].map((h, i) => html`<tr><td>${BRACKET_LABEL[h]}</td><td class="num">${priceInput(service, 'public', i, pub?.prices[i])}</td><td class="num">${priceInput(service, 'b2b', i, b2b?.prices[i])}</td></tr>`)}
        <tr><td>Ogni ora in più</td><td class="num">${priceInput(service, 'public', 'extra', pub?.extra)}</td><td class="num">${priceInput(service, 'b2b', 'extra', b2b?.extra)}</td></tr>
      </tbody></table></div>
      <p class="muted small">Tra uno scaglione e l’altro il prezzo cresce con l’ora in più, senza mai superare lo scaglione successivo (esempio: 3 ore = 2 ore + 1 ora in più).</p>
    </div>`;
  })}

  <div class="card pad">
    <h2>Supplementi</h2>
    <p class="muted small">Si sommano al prezzo base. Il superfestivo sostituisce il festivo. Il notturno si calcola sulle sole ore che cadono nella fascia.</p>
    <div class="form-grid">
      <label class="field"><span class="label">Festivo (+ %)</span><input type="text" name="festivoPct" inputmode="decimal" value="${val('festivoPct', s.festivoPct)}">${err('festivoPct')}</label>
      <label class="field"><span class="label">Superfestivo (+ %)</span><input type="text" name="superFestivoPct" inputmode="decimal" value="${val('superFestivoPct', s.superFestivoPct)}">${err('superFestivoPct')}</label>
      <label class="field"><span class="label">Notturno (+ %)</span><input type="text" name="nightPct" inputmode="decimal" value="${val('nightPct', s.nightPct)}">${err('nightPct')}</label>
      <div class="field"><span class="label">Fascia notturna</span><div class="inline-fields"><span>dalle</span><input type="time" name="nightFrom" value="${val('nightFrom', s.nightFrom)}" required> <span>alle</span><input type="time" name="nightTo" value="${val('nightTo', s.nightTo)}" required></div>${err('nightFrom')}${err('nightTo')}</div>
      <label class="field"><span class="label">Auricolari (€ a persona)</span><input class="price-input" name="earpieceCents" inputmode="decimal" value="${val('earpieceCents', euro(s.earpieceCents))}">${err('earpieceCents')}</label>
      <label class="field"><span class="label">Auricolari: da quante persone</span><input type="number" name="earpieceFromPax" min="1" max="100" value="${val('earpieceFromPax', s.earpieceFromPax)}">${err('earpieceFromPax')}</label>
    </div>
    <p class="muted small">Per offrire servizi serali o all’alba allarga gli orari in <a href="/admin/availability">Agenda › Disponibilità</a>: oggi il cliente può scegliere solo orari dentro il tuo orario di lavoro.</p>
  </div>

  <div class="card pad">
    <h2>Quali giorni sono festivi</h2>
    <label class="check"><input type="checkbox" name="sundays" value="1" ${(values ? values.sundays : d.sundays) ? raw('checked') : ''}> Le domeniche sono festive</label>
    <label class="field"><span class="label">Altri giorni festivi <em>— giorno e mese, separati da spazio: 25-04 01-05; più «pasquetta»</em></span><textarea name="holidays" rows="2">${val('holidays', d.holidays)}</textarea>${err('holidays')}</label>
    <label class="field"><span class="label">Giorni superfestivi <em>— per esempio 25-12 01-01; più «pasqua»</em></span><textarea name="superHolidays" rows="2">${val('superHolidays', d.superHolidays)}</textarea>${err('superHolidays')}</label>
  </div>

  <div class="card pad">
    <h2>Chi vede le tariffe</h2>
    <label class="check"><input type="checkbox" name="showB2bPublic" value="1" ${(values ? values.showB2bPublic : rates.showB2bPublic) ? raw('checked') : ''}> Mostra le <strong>tariffe per le agenzie</strong> a tutti, nella pagina «Per agenzie» (altrimenti le vedono solo i partner approvati)</label>
    <p class="muted small">Il pubblico vede sempre e solo le tariffe della colonna «Pubblico» del servizio guida.</p>
  </div>

  <div class="btn-row sticky-actions"><button class="btn btn-gold" type="submit">Salva le tariffe</button> <a class="btn btn-outline" href="/it/hourly" target="_blank" rel="noopener">Prova il calcolatore</a></div>
</form>
${custom
  ? html`<form method="post" action="/admin/rates/reset" class="form" data-confirm="Tornare alle cifre iniziali? Le tue tariffe andranno perse."><h2 class="h-sub spaced">Ricominciare</h2><p class="muted small">Riporta tutte le cifre a quelle iniziali.</p><button class="btn btn-outline btn-sm" type="submit">Ripristina le tariffe iniziali</button></form>`
  : ''}`;
  return adminLayout(ctx, { title: 'Tariffe a ore', active: '/admin/rates', body, flash, error });
}
