// Pannello › Prenotazione › Modifica: persone, data, orario, ore e prezzo, con l'anteprima di ciò che cambia (e di ciò che succede ai soldi).
import { html, raw } from '../html.js';
import { hourChoices } from '../changes.js';
import { fmtDate, fmtInstant } from '../time.js';
import { formatMoney } from '../util.js';
import { hoursLabel } from './components.js';
import { adminLayout } from './admin.js';
import { makeT } from '../i18n.js';

const t = makeT('it');

export const EDIT_ERRORS = {
  status: 'Questa prenotazione non si può più modificare: è annullata, scaduta o in attesa di pagamento.',
  invoiced: 'È già in una fattura (anche solo in bozza): per cambiarla elimina la bozza, oppure emetti una nota di credito.',
  invalid: 'Dati non validi: controlla persone, data, orario e ore.',
  past: 'La nuova data è già passata.',
  started: 'Il servizio è già iniziato: puoi correggere persone, ore e prezzo, ma non spostarlo.',
  unavailable: 'Non c’è posto per questo gruppo in quella data e a quell’ora. Se sai già che va bene, spunta «Non controllare la disponibilità».',
  option: 'L’opzione non può stare su quella data (è troppo vicina per le regole delle opzioni): confermala prima, oppure scegli un’altra data.',
  price: 'Il prezzo non è valido: scrivi un importo in euro, per esempio 350 o 350,50.',
  promo: 'Ha un codice sconto, che non si ricalcola da solo: scegli «Prezzo concordato» e scrivi tu il nuovo importo.',
  gift: 'Una parte è stata pagata con un buono regalo: il prezzo non si può cambiare (puoi spostare data e orario).',
  card: 'È già pagata con carta e il nuovo prezzo sarebbe più alto: la differenza non si può incassare da qui. Lascia il prezzo com’è (o abbassalo) e incassa la differenza a parte.',
  paid: 'È già stata incassata: il prezzo non si può cambiare da qui.',
  nochange: 'Non hai cambiato nulla.',
};

const eur = (c, cur = 'EUR') => formatMoney(c, 'it', cur);
const euroText = (c) => (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const signed = (c, cur) => (c > 0 ? `+ ${eur(c, cur)}` : c < 0 ? `− ${eur(-c, cur)}` : eur(0, cur));
const PAY_HOW = { invoice: 'a fattura', onsite: 'sul posto', card: 'con carta', giftcard: 'con buono regalo', free: 'senza pagamento' };

/** I valori di partenza del modulo: quelli della prenotazione (o quelli già scritti, se si torna da un errore o dall'anteprima). */
export function editValues(app, b, cur, over = {}) {
  const tour = app.content.tour(b.tour_slug);
  return {
    pax: String(cur.pax),
    date: cur.date,
    time: cur.time,
    hours: tour?.chooseHours && cur.hours != null ? String(cur.hours) : '',
    extra: String(cur.extra ?? 0),
    priceMode: b.custom_price ? 'custom' : 'auto',
    price: euroText(b.total_cents),
    force: '',
    keepTerms: '',
    notify: '1',
    note: '',
    ...over,
  };
}

/** Cosa succederebbe applicando la modifica: prima e dopo, differenza e conseguenze. */
function previewBox(b, p) {
  if (!p) return '';
  if (!p.ok) return html`<div class="notice notice-err" role="alert">${EDIT_ERRORS[p.error] ?? 'La modifica non è possibile.'}${p.reason ? html` <small>(${p.reason})</small>` : ''}</div>`;
  const cur = b.currency;
  const rows = [
    ['Persone', `${p.from.pax} → ${p.to.pax}`, p.from.pax !== p.to.pax],
    ['Data', `${fmtDate(p.from.date, 'it', 'short')} → ${fmtDate(p.to.date, 'it', 'short')}`, p.from.date !== p.to.date],
    ['Orario', `${p.from.time}–${p.from.end} → ${p.to.time}–${p.to.end}`, p.from.time !== p.to.time || p.from.end !== p.to.end],
    ['Totale', `${eur(p.from.totalCents, cur)} → ${eur(p.to.totalCents, cur)}${p.price.custom ? ' (prezzo concordato)' : ''}`, p.from.totalCents !== p.to.totalCents || !!p.price.custom !== !!b.custom_price],
  ];
  const lines = [];
  if (p.deltaCents && p.refundCents) lines.push(html`<strong>Pagata con carta:</strong> ${eur(p.refundCents, cur)} tornano sulla carta del cliente (rimborso automatico).`);
  else if (p.deltaCents) lines.push(html`Differenza di <strong>${signed(p.deltaCents, cur)}</strong>: ${b.payment_method === 'onsite' ? 'il cliente paga il nuovo importo il giorno del servizio' : b.payment_method === 'invoice' ? 'sarà fatturata per il nuovo importo' : 'cambia l’importo dovuto'}.`);
  if (p.dateChanged) lines.push(b.status === 'option' ? html`L’opzione resta trattenuta fino al <strong>${fmtInstant(p.expiresMs, 'it')}</strong>.` : html`Cancellazione gratuita fino al <strong>${fmtInstant(p.freeUntilMs, 'it')}</strong> (le condizioni ripartono dalla nuova data).`);
  if (p.forced) lines.push('Disponibilità non controllata: se la data è già occupata, guarda l’agenda.');
  if (p.started) lines.push('Il servizio è già iniziato: stai correggendo persone, ore o prezzo.');
  return html`<div class="notice notice-info" role="status"><p><strong>Anteprima</strong></p>
    <dl class="summary-list">${rows.map(([k, v, changed]) => html`<div><dt>${k}</dt><dd>${changed ? html`<strong>${v}</strong>` : html`<span class="muted">${v.split(' → ')[0]} (invariato)</span>`}</dd></div>`)}</dl>
    ${lines.length ? html`<ul class="plain">${lines.map((l) => html`<li>${l}</li>`)}</ul>` : ''}
  </div>`;
}

/**
 * @param {object} b la prenotazione · @param {object} o
 * @param {object} o.values valori del modulo (vedi editValues)
 * @param {object|null} o.preview esito di evaluateAdminChange, se si è chiesta l'anteprima
 */
export function bookingEditPage(ctx, b, { values: v, preview = null, error = '' }) {
  const { app } = ctx;
  const tour = app.content.tour(b.tour_slug);
  const hc = hourChoices(app, b);
  const times = tour?.flexible ? null : [...new Set([...(tour?.times ?? []), b.start_time])].sort();
  const base = `/admin/bookings/${b.id}`;
  const body = html`
<p><a href="${base}">← ${b.ref}</a></p>
<p class="muted">${tour?.i18n.it.title ?? b.tour_slug} · ${b.name}${b.client_ref ? ` · ${b.client_ref}` : ''} · ${b.channel === 'b2b' ? 'agenzia' : 'privato'} · pagamento ${PAY_HOW[b.payment_method] ?? b.payment_method}. Qui la guida decide: non valgono il preavviso minimo né i limiti delle modifiche che l’agenzia fa da sola. Prima guarda l’<strong>anteprima</strong>, poi applica.</p>
${previewBox(b, preview)}
<form class="card pad form" method="post" action="${base}/edit">
  <div class="form-grid">
    <label class="field"><span class="label">Persone</span><input type="number" name="pax" min="1" max="${tour?.maxParticipants ?? 99}" required value="${v.pax}"></label>
    <label class="field"><span class="label">Data</span><input type="date" name="date" required value="${v.date}"></label>
    ${times
      ? html`<label class="field"><span class="label">Orario</span><select name="time">${times.map((x) => html`<option value="${x}" ${x === v.time ? raw('selected') : ''}>${x}</option>`)}</select></label>`
      : html`<label class="field"><span class="label">Ora di inizio</span><input type="time" name="time" required value="${v.time}"></label>`}
    ${hc.kind === 'hours'
      ? html`<label class="field"><span class="label">Durata</span><select name="hours">${hc.values.map((h) => html`<option value="${h}" ${String(h) === String(v.hours) ? raw('selected') : ''}>${hoursLabel(t, 'it', h)}</option>`)}</select></label>`
      : hc.kind === 'extra'
        ? html`<label class="field"><span class="label">Ore in più</span><select name="extra">${hc.values.map((h) => html`<option value="${h}" ${String(h) === String(v.extra) ? raw('selected') : ''}>${h === 0 ? 'nessuna' : hoursLabel(t, 'it', h)}</option>`)}</select></label>`
        : ''}
  </div>
  <fieldset class="field">
    <legend class="label">Prezzo (adesso ${eur(b.total_cents, b.currency)}${b.custom_price ? ', concordato' : ''})</legend>
    <label class="check"><input type="radio" name="priceMode" value="auto" ${v.priceMode === 'auto' ? raw('checked') : ''}> Dal listino <em>(si ricalcola da solo se cambiano persone, ore o orario; altrimenti resta quello di adesso)</em></label>
    <label class="check price-custom"><input type="radio" name="priceMode" value="custom" ${v.priceMode === 'custom' ? raw('checked') : ''}> Prezzo concordato: <input name="price" inputmode="decimal" class="inline-input" size="8" value="${v.price}" aria-label="Prezzo concordato in euro"> €</label>
  </fieldset>
  <label class="check"><input type="checkbox" name="force" value="1" ${v.force === '1' ? raw('checked') : ''}> Non controllare la disponibilità <em>(hai già deciso tu: se la data è occupata, la sistemi dopo)</em></label>
  <label class="check"><input type="checkbox" name="keepTerms" value="1" ${v.keepTerms === '1' ? raw('checked') : ''}> Se sposti la data, mantieni le scadenze di annullo di prima <em>(di base ripartono dalla nuova data)</em></label>
  <label class="check"><input type="checkbox" name="notify" value="1" ${v.notify === '1' ? raw('checked') : ''}> Avvisa ${b.channel === 'b2b' ? 'l’agenzia' : 'il cliente'} con un’email (${b.email}) <em>con i dati nuovi${b.status === 'confirmed' ? ', il voucher e il calendario aggiornati' : ''}</em></label>
  <label class="field"><span class="label">Messaggio nell’email <em>(facoltativo)</em></span><textarea name="note" rows="2" maxlength="500" placeholder="es. Come d’accordo al telefono, spostiamo la visita al pomeriggio.">${v.note}</textarea></label>
  <div class="btn-row"><button class="btn btn-outline" type="submit" formmethod="get" formaction="${base}/edit" name="preview" value="1">Anteprima</button> <button class="btn btn-gold" type="submit">Applica la modifica</button></div>
</form>`;
  return adminLayout(ctx, { title: 'Modifica la prenotazione', active: '/admin/bookings', body, error });
}
