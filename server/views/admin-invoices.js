import { html, raw } from '../html.js';
import { STATUS_LABEL, sdiNext } from '../invoices.js';
import { payState } from '../invoicePayments.js';
import { fmtDate, nowRome } from '../time.js';
import { adminLayout } from './admin.js';
import { normLang } from '../langs.js';
import { langOptions } from './components.js';

const eur = (cents) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const euroInput = (cents) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
const COUNTRIES = ['IT', 'DE', 'FR', 'ES', 'GB', 'US', 'NL', 'AT', 'CH', 'BE', 'PT', 'PL', 'CZ', 'SE', 'DK', 'NO', 'IE', 'JP', 'CN', 'KR', 'AU', 'CA', 'BR', 'IN', 'AE'];

const STATUS_CHIP = { draft: 'chip-warn', issued: 'chip-accent', sent: 'chip-accent', delivered: 'chip-ok', rejected: 'chip-err', undelivered: 'chip-warn' };
export const invoiceChip = (inv) => html`<span class="chip ${STATUS_CHIP[inv.status] ?? ''}">${STATUS_LABEL[inv.status] ?? inv.status}</span>${inv.credited ? html` <span class="chip chip-err">Stornata</span>` : ''}`;
const kindLabel = (inv) => (inv.doc_type === 'TD04' ? 'Nota di credito' : 'Fattura');
const PAID_VIA = { card: 'carta', bank: 'bonifico', other: 'altro' };
/** L'incasso di una fattura in una parola (elenco): pagata, scaduta (da quanti giorni), da pagare entro, saldata. */
const payChip = (inv) => {
  const st = payState(inv);
  if (st.state === 'paid') return html`<br><span class="chip chip-ok">Incassata</span>`;
  if (st.state === 'overdue') return html`<br><span class="chip chip-err">Scaduta da ${st.days} ${st.days === 1 ? 'giorno' : 'giorni'}</span>`;
  if (st.state === 'open') return html`<br><span class="chip chip-warn">Da incassare${st.dueDate ? ` · entro il ${fmtDate(st.dueDate, 'it', 'short')}` : ''}</span>`;
  return '';
};
/** Scheda «Incasso e solleciti» di una fattura emessa: lo stato, segnare il bonifico arrivato, il sollecito e il link di pagamento per l'agenzia. */
const payCard = (inv, pay) => {
  const st = pay.st;
  const today = nowRome().date;
  return html`<div class="card pad pay-card">
    <h2>Incasso e solleciti</h2>
    ${st.state === 'paid'
      ? html`<p><span class="chip chip-ok">Incassata</span> il ${fmtDate(nowRome(Date.parse(inv.paid_at)).date, 'it', 'date')} (${PAID_VIA[inv.paid_method] ?? 'altro'}).</p>
        ${inv.paid_method === 'card' ? html`<p class="muted small">Pagata online con carta: per restituire il denaro serve un rimborso da Stripe (e una nota di credito).</p>` : html`<form method="post" action="/admin/invoices/${inv.id}/unpaid" data-confirm="Annullare l’incasso? La fattura e le sue prenotazioni tornano da incassare."><button class="btn btn-outline btn-sm" type="submit">Annulla l’incasso registrato</button></form>`}`
      : st.state === 'settled'
        ? html`<p class="muted">Nulla da incassare: la fattura è già saldata (per esempio pagata online al momento della prenotazione).</p>`
        : html`<p>${st.state === 'overdue' ? html`<span class="chip chip-err">Scaduta da ${st.days} ${st.days === 1 ? 'giorno' : 'giorni'}</span>` : html`<span class="chip chip-warn">Da incassare</span>`} ${eur(st.dueCents)}${st.dueDate ? ` · scadenza ${fmtDate(st.dueDate, 'it', 'date')}` : ''}</p>
        <form method="post" action="/admin/invoices/${inv.id}/paid" class="form">
          <div class="form-grid">
            <label class="field"><span class="label">Arrivato il</span><input type="date" name="date" value="${today}" max="${today}"></label>
            <label class="field"><span class="label">Come</span><select name="method"><option value="bank">Bonifico</option><option value="other">Altro</option></select></label>
          </div>
          <button class="btn btn-gold btn-sm" type="submit">Segna come incassata</button>
          <span class="muted small">le prenotazioni della fattura risultano pagate e l’agenzia riceve la ricevuta</span>
        </form>`}
    ${st.state === 'open' || st.state === 'overdue'
      ? html`<form method="post" action="/admin/invoices/${inv.id}/remind" class="form" data-confirm="Mandare ora un sollecito all’agenzia?"><h3>Sollecito</h3>
        <p class="muted small">${inv.overdue_reminders ? `Inviati ${inv.overdue_reminders} ${inv.overdue_reminders === 1 ? 'sollecito' : 'solleciti'} (l’ultimo il ${fmtDate(nowRome(Date.parse(inv.overdue_reminded_at)).date, 'it', 'short')}).` : 'Nessun sollecito inviato.'} I solleciti partono da soli dopo la scadenza (si regolano in <a href="/admin/settings#invoice">Impostazioni › Fatturazione</a>).</p>
        <button class="btn btn-outline btn-sm" type="submit">Invia ora un sollecito</button></form>`
      : ''}
    <h3>Link di pagamento per l’agenzia</h3>
    <p class="muted small">Apre la pagina con importo, scadenza, IBAN, causale e pagamento con carta. Lo trovi già nelle email di sollecito e nella copia di cortesia.</p>
    <p><input class="copy-field" readonly value="${pay.url}" data-select-all></p>
  </div>`;
};
const buyerName = (b) => (b.kind === 'person' ? `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim() : b.name) || '—';
const SOURCE_LINK = { booking: (id) => `/admin/bookings/${id}`, gift: (id) => `/admin/discounts/gifts/${id}`, program: (id) => `/admin/programs/${id}` };
const PAY_LABEL = { MP08: 'Carta', MP05: 'Bonifico', MP01: 'Contanti' };

export function tabs(active, counts) {
  const items = [['queue', `Da fatturare${counts.queue ? ` (${counts.queue})` : ''}`], ['drafts', `Bozze${counts.drafts ? ` (${counts.drafts})` : ''}`], ['issued', 'Emesse'], ['bank', 'Incassi dalla banca'], ['settings', 'Impostazioni']];
  return html`<div class="tabs">${items.map(([k, l]) => html`<a href="${k === 'bank' ? '/admin/invoices/bank' : `/admin/invoices?tab=${k}`}" ${active === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</div>`;
}

const problemsBox = (problems, intro) =>
  problems.length
    ? html`<div class="notice notice-err" role="alert"><strong>${intro}</strong><ul class="plain problems">${problems.map((p) => html`<li>${p}</li>`)}</ul><p><a href="/admin/settings#invoice">Completa i dati fiscali →</a></p></div>`
    : '';

/** Le voci raggruppate per cliente (con la scadenza più vicina in cima). */
function queueGroups(queue) {
  const groups = new Map();
  for (const item of queue) {
    const g = groups.get(item.buyerKey) ?? { key: item.buyerKey, title: item.customer, channel: item.channel, type: item.type, items: [] };
    g.items.push(item);
    groups.set(item.buyerKey, g);
  }
  const earliest = (g) => g.items.reduce((m, i) => (i.dueBy < m ? i.dueBy : m), '9999-12-31');
  return [...groups.values()].sort((a, b) => earliest(a).localeCompare(earliest(b)));
}

const queueTable = (queue) => html`<div class="card table-wrap"><table class="table queue-table"><thead><tr><th></th><th>Voce</th><th class="num">Importo</th><th>Entro il</th></tr></thead><tbody>
  ${queueGroups(queue).map((g) => html`<tr class="group-row"><th colspan="4"><label class="check"><input type="checkbox" data-select-group="${g.key}"> <strong>${g.title}</strong> <span class="muted">· ${g.items.length} ${g.items.length === 1 ? 'voce' : 'voci'} · ${eur(g.items.reduce((a, i) => a + i.amountCents, 0))}${g.channel === 'b2b' ? ' · partner B2B' : ''}</span></label></th></tr>
    ${g.items.map((i) => html`<tr class="${i.overdue ? 'row-overdue' : ''}">
      <td><input type="checkbox" name="src" value="${i.key}" data-group="${g.key}" data-cents="${i.amountCents}" aria-label="Seleziona ${i.ref}"></td>
      <td><a href="${SOURCE_LINK[i.type](i.id)}">${i.label}</a><br><small class="muted">${i.ref}${i.package ? ` · pacchetto ${i.package}` : ''}${i.hint ? ` · il cliente ha scritto: «${i.hint}»` : ''}</small><br>${i.channel === 'b2c' && i.invoiceRequested ? html`<span class="chip chip-accent">Ha chiesto la fattura</span> ` : ''}${i.payments.filter((p) => p.method).map((p) => html`<span class="chip ${p.paid ? 'chip-ok' : 'chip-warn'}">${PAY_LABEL[p.method]} · ${p.paid ? 'incassato' : 'da incassare'}</span> `)}${i.payments.some((p) => !p.method) ? html`<span class="chip">Buono regalo</span>` : ''}</td>
      <td class="num">${eur(i.amountCents)}</td>
      <td class="${i.overdue ? 'field-error' : ''}">${fmtDate(i.dueBy, 'it', 'short')}${i.overdue ? html`<br><small>scaduto</small>` : ''}</td>
    </tr>`)}`)}
  </tbody></table></div>`;

export function invoicesPage(ctx, { tab, queue, optional = [], drafts, issued, year, years, counts, problems, settings, pec, flash, error }) {
  let body;
  if (tab === 'queue') {
    body = html`
${problemsBox(problems, 'Prima di emettere completa i dati fiscali (vedi la scheda Impostazioni):')}
<p class="muted">Servizi pagati o già svolti delle agenzie, dei privati che hanno chiesto la fattura, buoni regalo e programmi conclusi che non sono ancora in una fattura. La data «entro il» è il termine consigliato di <strong>12 giorni</strong> dall’incasso o dal servizio. Scegli le voci e prepara la fattura: potrai rivedere ogni dato prima di emetterla. I privati che non l’hanno chiesta non compaiono qui: li trovi in fondo, nel riquadro «Privati senza richiesta di fattura».</p>
${queue.length || optional.length
  ? html`<form method="post" action="/admin/invoices/draft" class="queue-form">
  ${queue.length ? queueTable(queue) : html`<p class="muted">Niente da fatturare: tutte le voci da fatturare sono già in una fattura.</p>`}
  ${optional.length
    ? html`<details class="optional-queue"><summary>Privati senza richiesta di fattura (${optional.length})</summary>
      <p class="muted">Al momento di prenotare non hanno chiesto la fattura, quindi non serve emetterla. Se uno te la chiede dopo, spunta la sua voce qui sotto e prepara la fattura come le altre.</p>
      ${queueTable(optional)}</details>`
    : ''}
  <p class="btn-row"><button class="btn btn-gold" type="submit">Prepara la fattura con le voci scelte</button> <span class="muted" data-selected-total></span></p>
</form>`
  : html`<p class="muted">Niente da fatturare: tutte le voci da fatturare sono già in una fattura.</p>`}
<form method="post" action="/admin/invoices/manual" class="inline-form"><button class="btn btn-outline" type="submit">Nuova fattura a mano</button><span class="muted">per un servizio reso di persona o non registrato sul sito</span></form>`;
  } else if (tab === 'drafts') {
    body = html`${drafts.length
      ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Bozza</th><th>Cliente</th><th class="num">Totale</th><th>Voci</th></tr></thead><tbody>
      ${drafts.map((d) => html`<tr><td><a href="/admin/invoices/${d.id}"><strong>${kindLabel(d)} in bozza</strong></a><br><small class="muted">creata il ${when(d.created_at)}</small></td><td>${buyerName(JSON.parse(d.buyer_json))}</td><td class="num">${eur(d.total_cents)}</td><td>${d.lines} ${d.lines === 1 ? 'riga' : 'righe'}</td></tr>`)}
      </tbody></table></div>`
      : html`<p class="muted">Nessuna bozza.</p>`}`;
  } else if (tab === 'issued') {
    body = html`
<div class="tabs year-tabs">${years.map((y) => html`<a href="/admin/invoices?tab=issued&year=${y}" ${y === year ? raw('aria-current="page"') : ''}>${y}</a>`)}<a class="btn btn-outline btn-sm" href="/admin/invoices/export.csv?year=${year}">Registro CSV ${year}</a></div>
${issued.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Numero</th><th>Cliente</th><th class="num">Totale</th><th>Stato</th><th></th></tr></thead><tbody>
  ${issued.map((i) => html`<tr>
    <td><a href="/admin/invoices/${i.id}"><strong>${i.number}</strong></a><br><small class="muted">${kindLabel(i)} · ${fmtDate(i.issue_date, 'it', 'short')}</small></td>
    <td>${buyerName(JSON.parse(i.buyer_json))}</td>
    <td class="num">${i.doc_type === 'TD04' ? '−' : ''}${eur(i.total_cents)}</td>
    <td>${invoiceChip(i)}${i.doc_type === 'TD01' ? payChip(i) : ''}</td>
    <td class="actions"><a class="btn btn-sm btn-outline" href="/admin/invoices/${i.id}/xml">XML</a> <a class="btn btn-sm btn-outline" href="/admin/invoices/${i.id}/pdf" target="_blank" rel="noopener">PDF</a></td>
  </tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessuna fattura emessa nel ${year}.</p>`}`;
  } else {
    const s = settings;
    const ok = (v) => (v ? html`<span class="ok-text">✓</span>` : html`<span class="field-error">manca</span>`);
    const regimes = { RF19: 'Regime forfettario', RF01: 'Regime ordinario', RF02: 'Contribuenti minimi' };
    body = html`
${problemsBox(problems, 'Mancano o non tornano questi dati: finché non li sistemi non puoi emettere fatture.')}
<div class="card pad">
  <h2>Dati fiscali in uso</h2>
  <p class="muted">Si modificano da <a href="/admin/settings#invoice">Sito › Impostazioni › Fatturazione elettronica</a>. <strong>Fatti confermare ogni voce dal commercialista</strong> prima di emettere la prima fattura.</p>
  <dl class="summary-list">
    <div><dt>Partita IVA</dt><dd>${ok(s.seller.vatNumber)} ${s.seller.vatNumber}</dd></div>
    <div><dt>Codice fiscale</dt><dd>${ok(s.seller.fiscalCode)} ${s.seller.fiscalCode}</dd></div>
    <div><dt>Intestazione</dt><dd>${s.seller.name || `${s.seller.firstName} ${s.seller.lastName}`.trim() || html`<span class="field-error">manca</span>`}</dd></div>
    <div><dt>Indirizzo</dt><dd>${s.seller.address.street ? `${s.seller.address.street}, ${s.seller.address.zip} ${s.seller.address.city} (${s.seller.address.province})` : html`<span class="field-error">manca</span>`}</dd></div>
    <div><dt>Regime fiscale</dt><dd>${s.seller.regime} · ${regimes[s.seller.regime] ?? 'altro regime'}</dd></div>
    <div><dt>IVA</dt><dd>${s.vatBp ? `${s.vatBp / 100}%` : `nessuna — natura ${s.nature}`}</dd></div>
    <div><dt>Prezzi del sito comprensivi di IVA</dt><dd>${s.vatBp ? `privati: ${s.vatIncluded.b2c ? 'sì' : 'no'} · partner: ${s.vatIncluded.b2b ? 'sì' : 'no'}` : 'non conta (nessuna IVA)'}</dd></div>
    <div><dt>Bollo virtuale 2 €</dt><dd>${s.bollo === 'never' ? 'mai' : 'automatico sulle operazioni senza IVA oltre 77,47 €'}</dd></div>
    <div><dt>Rivalsa INPS / ritenuta d’acconto</dt><dd>${s.contributionPercent ? `rivalsa ${s.contributionPercent}%` : 'nessuna rivalsa'} · ${s.withholdingPercent ? `ritenuta ${s.withholdingPercent}% alle imprese italiane` : 'nessuna ritenuta'}</dd></div>
    <div><dt>Buoni regalo</dt><dd>${s.giftInvoiceAt === 'sale' ? 'considerati monouso: fattura alla vendita del buono' : 'considerati multiuso: fattura all’utilizzo'}</dd></div>
    <div><dt>Conto per i bonifici</dt><dd>${s.iban ? `${s.iban}${s.bank ? ` · ${s.bank}` : ''}` : 'non indicato (le fatture a bonifico non riportano l’IBAN)'}</dd></div>
    <div><dt>Scadenza fatture ai partner</dt><dd>${s.b2bDueDays} giorni</dd></div>
    <div><dt>Trasmissione a SdI</dt><dd>${pec ? html`<span class="ok-text">✓</span> via PEC a ${s.sdiAddress}` : 'manuale: scarichi l’XML e lo carichi su «Fatture e Corrispettivi» (Agenzia delle Entrate); per l’invio da qui servono PEC_SMTP_HOST, PEC_SMTP_USER e PEC_SMTP_PASS'}</dd></div>
  </dl>
</div>
<div class="card pad">
  <h2>Cose da sapere</h2>
  <ul class="plain info-list">
    <li>La fattura elettronica è il file <strong>XML</strong>: la <em>copia PDF</em> serve solo al cliente. Il file va trasmesso al Sistema di Interscambio (SdI) entro <strong>12 giorni</strong> dall’operazione.</li>
    <li>I numeri sono progressivi per anno (<code>1/2027</code>, <code>2/2027</code>…), senza buchi e in ordine di data. Una fattura emessa non si modifica: se c’è un errore si emette una <strong>nota di credito</strong>.</li>
    <li>Gli esiti di SdI (consegnata, scartata…) arrivano alla casella da cui hai trasmesso: qui li registri a mano. Una fattura scartata si corregge e si riemette con lo stesso numero.</li>
    <li>Il sito non controlla la correttezza fiscale delle scelte (regime, natura, bollo, ritenuta, trattamento dei buoni regalo): sono decisioni del commercialista.</li>
  </ul>
</div>`;
  }
  return adminLayout(ctx, { title: 'Fatture', active: '/admin/invoices', body: html`${tabs(tab, counts)}${body}`, flash, error, scripts: `<script src="/js/admin-invoices.js?v=${ctx.app.assetVersion}" defer></script>` });
}

// ───────────── dettaglio / modifica ─────────────
function totalsBox(c, { credit = false } = {}) {
  const rows = [
    ['Imponibile', c.servicesCents],
    c.contributionCents ? [`Rivalsa INPS ${c.contribution?.percent ?? ''}%`, c.contributionCents] : null,
    c.vatCents ? ['IVA', c.vatCents] : null,
    c.bolloCharged ? ['Bollo addebitato', c.bolloCents] : null,
    c.roundingCents ? ['Arrotondamento', c.roundingCents] : null,
  ].filter(Boolean);
  return html`<table class="totals"><tbody>
    ${rows.map(([l, v]) => html`<tr><td>${l}</td><td class="num">${eur(v)}</td></tr>`)}
    <tr class="grand"><td>Totale documento</td><td class="num">${credit ? '−' : ''}${eur(c.totalCents)}</td></tr>
    ${c.withholdingCents ? html`<tr><td>Ritenuta d’acconto</td><td class="num">−${eur(c.withholdingCents)}</td></tr><tr class="grand"><td>Netto a pagare</td><td class="num">${eur(c.payableCents)}</td></tr>` : ''}
    ${c.bolloCents && !c.bolloCharged ? html`<tr class="muted"><td colspan="2">Bollo virtuale ${eur(c.bolloCents)} a tuo carico, indicato in fattura</td></tr>` : ''}
  </tbody></table>`;
}

function buyerFields(b) {
  const v = (k) => b[k] ?? '';
  return html`
  <div class="kind-switch" role="radiogroup" aria-label="Tipo di intestatario">
    <label class="check"><input type="radio" name="b_kind" value="company" ${b.kind !== 'person' ? raw('checked') : ''}> Azienda / partita IVA</label>
    <label class="check"><input type="radio" name="b_kind" value="person" ${b.kind === 'person' ? raw('checked') : ''}> Persona fisica</label>
  </div>
  <div class="form-grid">
    <label class="field" data-kind="company"><span class="label">Denominazione</span><input name="b_name" maxlength="120" value="${v('name')}"></label>
    <label class="field" data-kind="person"><span class="label">Nome</span><input name="b_firstName" maxlength="60" value="${v('firstName')}"></label>
    <label class="field" data-kind="person"><span class="label">Cognome</span><input name="b_lastName" maxlength="60" value="${v('lastName')}"></label>
    <label class="field"><span class="label">Paese <em>(2 lettere)</em></span><input name="b_country" maxlength="2" list="inv-countries" value="${v('country')}" required class="upper"><datalist id="inv-countries">${COUNTRIES.map((c) => html`<option value="${c}"></option>`)}</datalist></label>
    <label class="field"><span class="label">Partita IVA / ID fiscale estero <em>(senza prefisso paese)</em></span><input name="b_vat" maxlength="30" value="${v('vat')}"></label>
    <label class="field"><span class="label">Codice fiscale</span><input name="b_taxCode" maxlength="20" value="${v('taxCode')}" class="upper"></label>
    <label class="field"><span class="label">Indirizzo <em>(via e numero)</em></span><input name="b_address" maxlength="120" value="${v('address')}"></label>
    <label class="field"><span class="label">CAP <em>(estero: lascia vuoto)</em></span><input name="b_zip" maxlength="10" value="${v('zip')}" inputmode="numeric"></label>
    <label class="field"><span class="label">Comune / città</span><input name="b_city" maxlength="80" value="${v('city')}"></label>
    <label class="field"><span class="label">Provincia <em>(solo Italia)</em></span><input name="b_province" maxlength="3" value="${v('province')}" class="upper"></label>
    <label class="field"><span class="label">Codice destinatario SdI <em>(7 caratteri)</em></span><input name="b_sdiCode" maxlength="7" value="${v('sdiCode')}" class="upper"></label>
    <label class="field"><span class="label">PEC del cliente <em>(se non ha il codice)</em></span><input name="b_pec" maxlength="200" value="${v('pec')}"></label>
    <label class="field"><span class="label">Email per la copia di cortesia</span><input type="email" name="b_email" maxlength="200" value="${v('email')}"></label>
    <label class="field"><span class="label">Lingua della copia</span><select name="b_lang">${langOptions(normLang(b.lang))}</select></label>
  </div>`;
}

function lineRow(l, i) {
  return html`<div class="iline">
    <input type="hidden" name="l_key" value="${l.key ?? ''}">
    <input name="l_desc" maxlength="400" placeholder="Descrizione" value="${l.description}" aria-label="Descrizione della riga ${i + 1}">
    <input class="iline-amount" name="l_amount" inputmode="decimal" placeholder="Importo €" value="${l.amount}" aria-label="Importo della riga ${i + 1}">
    ${l.link ? html`<a class="iline-src" href="${l.link}" title="Apri la voce collegata">↗</a>` : ''}
  </div>`;
}

export function invoiceDetailPage(ctx, d, { flash = '', error = '', problems = [], form = null, canDiscard = false, creditNotes = [], pecConfigured = false, settings, pay = null }) {
  const { inv, lines, buyer, options, payments, related } = d;
  const editable = ['draft', 'rejected'].includes(inv.status);
  const credit = inv.doc_type === 'TD04';
  const heading = inv.number ? `${kindLabel(inv)} ${inv.number}` : `${kindLabel(inv)} in bozza`;
  const vatMode = settings.vatBp > 0;

  let main;
  if (editable) {
    const fb = form?.buyer ?? buyer;
    const rows = (form?.lines ?? lines.map((l) => ({ key: l.source_type ? `${l.source_type}:${l.source_id}` : '', description: l.description, amount: euroInput(l.amount_cents), link: l.source_type ? SOURCE_LINK[l.source_type](l.source_id) : null })));
    const o = form?.options ?? options;
    const c = d.calc;
    main = html`
<form method="post" action="/admin/invoices/${inv.id}/save" class="form inv-form" id="invoice-form">
  <div class="card pad">
    <h2>Intestatario</h2>
    ${options.hint ? html`<p class="info-box">Dati indicati dal cliente: <em>${options.hint}</em></p>` : ''}
    ${buyerFields(fb)}
  </div>
  <div class="card pad">
    <h2>Righe</h2>
    <p class="muted">${vatMode && options.vatIncluded ? 'Gli importi comprendono l’IVA: il sito ricava imponibile e imposta.' : vatMode ? 'Gli importi sono al netto dell’IVA.' : 'Importi senza IVA.'} Le righe lasciate vuote vengono ignorate; togliendo la descrizione e l’importo a una riga collegata la voce torna tra quelle da fatturare.</p>
    <div class="ilines" data-ilines>${rows.map((l, i) => lineRow(l, i))}${lineRow({ key: '', description: '', amount: '' }, rows.length)}</div>
    <p class="btn-row"><button class="btn btn-outline btn-sm" type="button" data-add-line hidden>+ Aggiungi una riga</button></p>
  </div>
  <div class="card pad">
    <h2>Documento</h2>
    <div class="form-grid">
      <label class="field"><span class="label">Data della fattura ${inv.status === 'rejected' ? html`<em>(non modificabile: riemissione)</em>` : ''}</span><input type="date" name="issue_date" value="${form?.issueDate ?? inv.issue_date}" ${inv.status === 'rejected' ? raw('readonly') : ''} required></label>
      <label class="field"><span class="label">Scadenza del pagamento <em>(bonifico)</em></span><input type="date" name="opt_due" value="${o.dueDate ?? ''}"></label>
      ${credit ? '' : html`<label class="field"><span class="label">Rivalsa INPS (%) <em>0 = nessuna</em></span><input name="opt_contribution" inputmode="decimal" value="${o.contributionPercent || ''}" placeholder="0"></label>
      <label class="field"><span class="label">Ritenuta d’acconto (%) <em>0 = nessuna</em></span><input name="opt_withholding" inputmode="decimal" value="${o.withholdingPercent || ''}" placeholder="0"></label>`}
    </div>
    ${credit || vatMode ? '' : html`<label class="check"><input type="checkbox" name="opt_bollo" value="1" ${o.bolloCharged ? raw('checked') : ''}> Addebita il bollo da 2 € al cliente (se è dovuto) invece di assorbirlo</label>`}
    <label class="field"><span class="label">Note aggiuntive <em>(compaiono come causale)</em></span><textarea name="opt_notes" rows="2" maxlength="600">${o.notes ?? ''}</textarea></label>
    ${related ? html`<p class="muted">Nota di credito che storna la fattura <a href="/admin/invoices/${related.id}">${related.number}</a>.</p>` : ''}
    ${inv.status === 'rejected' ? html`<div class="notice notice-err"><strong>Scartata da SdI.</strong> ${inv.sdi_note ?? ''} Correggi i dati e riemetti: numero e data restano gli stessi.</div>` : ''}
  </div>
  <div class="card pad">
    <h2>Totali</h2>
    ${c ? totalsBox(c, { credit }) : html`<p class="muted">Salva la bozza per vedere i totali.</p>`}
    ${c && d.payments.length ? html`<p class="muted small">Pagamento: ${d.payments.map((p) => `${PAY_LABEL[p.method]} ${eur(p.cents)} ${p.paid ? '(già pagato)' : p.dueDate ? `(entro il ${fmtDate(p.dueDate, 'it', 'short')})` : ''}`).join(' · ')}</p>` : ''}
    ${problems.length ? html`<div class="notice notice-err" role="alert"><strong>Prima di emettere:</strong><ul class="plain problems">${problems.map((p) => html`<li>${p}</li>`)}</ul></div>` : ''}
    <div class="btn-row">
      <button class="btn btn-outline" type="submit" name="action" value="save">Salva bozza</button>
      <button class="btn btn-gold" type="submit" name="action" value="issue" data-confirm-submit="${inv.status === 'rejected' ? 'Riemettere la fattura con lo stesso numero?' : 'Emettere la fattura? Si assegna il numero progressivo e non potrai più modificarla.'}">${inv.status === 'rejected' ? 'Correggi e riemetti' : 'Emetti la fattura'}</button>
    </div>
  </div>
</form>
${inv.status === 'draft' ? html`<form method="post" action="/admin/invoices/${inv.id}/delete" class="inline-form" data-confirm="Eliminare questa bozza? Le voci collegate tornano da fatturare."><button class="btn btn-sm btn-outline" type="submit">Elimina la bozza</button></form>` : ''}`;
  } else {
    const stored = { servicesCents: lines.reduce((a, l) => a + l.net_cents, 0), contributionCents: inv.contribution_cents, contribution: inv.contribution_cents ? { percent: options.contributionPercent } : null, vatCents: inv.vat_cents, bolloCharged: !!inv.bollo_charged, bolloCents: inv.bollo_cents, roundingCents: inv.rounding_cents, totalCents: inv.total_cents, withholdingCents: inv.withholding_cents, payableCents: inv.payable_cents };
    main = html`
<div class="grid grid-2 admin-detail">
  <div class="card pad">
    <p class="ref-line">${invoiceChip(inv)} <strong class="ref">${inv.number}</strong></p>
    <dl class="summary-list">
      <div><dt>Data</dt><dd>${fmtDate(inv.issue_date, 'it')}</dd></div>
      <div><dt>Intestatario</dt><dd><strong>${buyerName(buyer)}</strong><br>${buyer.address}, ${buyer.zip} ${buyer.city}${buyer.province ? ` (${buyer.province})` : ''} · ${buyer.country}<br>${buyer.vat ? `P.IVA/ID ${buyer.vat}` : ''}${buyer.vat && buyer.taxCode ? ' · ' : ''}${buyer.taxCode ? `C.F. ${buyer.taxCode}` : ''}${buyer.sdiCode ? html`<br>Codice SdI ${buyer.sdiCode}` : ''}${buyer.pec ? html`<br>PEC ${buyer.pec}` : ''}</dd></div>
      ${related ? html`<div><dt>Storna</dt><dd><a href="/admin/invoices/${related.id}">Fattura ${related.number}</a></dd></div>` : ''}
      ${creditNotes.length ? html`<div><dt>Note di credito</dt><dd>${creditNotes.map((n) => html`<a href="/admin/invoices/${n.id}">${n.number ?? 'bozza'}</a> (${eur(n.total_cents)}) `)}</dd></div>` : ''}
      <div><dt>File XML</dt><dd><code>${inv.file_name}</code></dd></div>
      ${inv.sent_at ? html`<div><dt>Trasmessa a SdI</dt><dd>${when(inv.sent_at)}</dd></div>` : ''}
      ${inv.emailed_at ? html`<div><dt>Copia al cliente</dt><dd>${when(inv.emailed_at)}</dd></div>` : ''}
      ${inv.sdi_note ? html`<div><dt>Nota sull’esito</dt><dd>${inv.sdi_note}</dd></div>` : ''}
    </dl>
    <p class="btn-row"><a class="btn btn-gold btn-sm" href="/admin/invoices/${inv.id}/xml">Scarica l’XML</a> <a class="btn btn-outline btn-sm" href="/admin/invoices/${inv.id}/pdf" target="_blank" rel="noopener">Copia PDF</a></p>
  </div>
  <div class="card pad">
    <h2>Righe e totali</h2>
    <div class="itinerary">${lines.map((l) => html`<div class="itin-day"><div class="itin-what span-2"><strong>${l.description}</strong>${l.source_type ? html` <a href="${SOURCE_LINK[l.source_type](l.source_id)}" title="Voce collegata">↗</a>` : ''}</div><div class="itin-price">${eur(l.net_cents)}</div></div>`)}</div>
    ${totalsBox(stored, { credit })}
    ${payments.length ? html`<p class="muted small">Pagamento: ${payments.map((p) => `${PAY_LABEL[p.method]} ${eur(p.cents)} ${p.paid ? '(già pagato)' : p.dueDate ? `(entro il ${fmtDate(p.dueDate, 'it', 'short')})` : ''}`).join(' · ')}</p>` : ''}
    ${d.causali.length ? html`<p class="muted small">${d.causali.join(' ')}</p>` : ''}
  </div>
</div>

${pay ? payCard(inv, pay) : ''}
<div class="grid grid-2 admin-detail">
  <div class="card pad">
    <h2>Invio</h2>
    ${['issued', 'undelivered'].includes(inv.status)
      ? pecConfigured
        ? html`<form method="post" action="/admin/invoices/${inv.id}/sdi" class="form" data-confirm="Trasmettere ora la fattura a SdI dalla tua PEC?"><button class="btn btn-gold btn-sm" type="submit">${inv.sent_at ? 'Ritrasmetti a SdI via PEC (mancata consegna)' : 'Invia a SdI via PEC'}</button></form>`
        : html`<p class="muted">Per inviarla da qui imposta la PEC (vedi <a href="/admin/invoices?tab=settings">Impostazioni</a>). Altrimenti scarica l’XML e caricalo su <strong>Fatture e Corrispettivi</strong> dell’Agenzia delle Entrate, poi segna la fattura come inviata.</p>`
      : ''}
    ${sdiNext(inv.status).length
      ? html`<form method="post" action="/admin/invoices/${inv.id}/status" class="form">
      <div class="form-grid">
        <label class="field"><span class="label">Esito comunicato da SdI</span><select name="status">${[inv.status, ...sdiNext(inv.status)].map((v) => html`<option value="${v}" ${inv.status === v ? raw('selected') : ''}>${STATUS_LABEL[v]}</option>`)}</select></label>
        <label class="field"><span class="label">Nota <em>(es. codice dell’errore)</em></span><input name="note" maxlength="500" value="${inv.sdi_note ?? ''}"></label>
      </div>
      <button class="btn btn-outline btn-sm" type="submit">Registra l’esito</button>
    </form>`
      : html`<p class="muted">Esito definitivo: ${STATUS_LABEL[inv.status]}. Per correggere la fattura serve una nota di credito.</p>`}
  </div>
  <div class="card pad">
    <h2>Copia al cliente</h2>
    <form method="post" action="/admin/invoices/${inv.id}/email" class="form">
      <label class="field"><span class="label">Invia a</span><input type="email" name="to" required maxlength="200" value="${buyer.email ?? ''}"></label>
      <label class="check"><input type="checkbox" name="xml" value="1"> Allega anche il file XML</label>
      <button class="btn btn-outline btn-sm" type="submit">Invia la copia di cortesia</button>
    </form>
    ${inv.doc_type === 'TD01' && ['issued', 'sent', 'delivered', 'undelivered'].includes(inv.status) && !inv.credited
      ? html`<form method="post" action="/admin/invoices/${inv.id}/credit-note" class="form" data-confirm="Preparare una nota di credito per questa fattura?"><h3>Errori o storni</h3><p class="muted small">Una fattura emessa non si modifica: la si storna con una nota di credito (anche parziale) e, se serve, si rifà la fattura giusta.</p><button class="btn btn-outline btn-sm" type="submit">Prepara una nota di credito</button></form>`
      : ''}
    ${canDiscard ? html`<form method="post" action="/admin/invoices/${inv.id}/discard" class="form" data-confirm="Annullare l’emissione e riportare la fattura in bozza? Il numero torna disponibile."><h3>Emessa per errore?</h3><p class="muted small">È l’ultima dell’anno e non è mai partita: puoi riportarla in bozza e il numero si libera, senza lasciare buchi.</p><button class="btn btn-outline btn-sm" type="submit">Riporta in bozza</button></form>` : ''}
  </div>
</div>`;
  }
  return adminLayout(ctx, { title: heading, active: '/admin/invoices', body: html`<p><a href="/admin/invoices?tab=${editable ? 'drafts' : 'issued'}">← ${editable ? 'Bozze' : 'Fatture emesse'}</a></p>${main}`, flash, error, scripts: `<script src="/js/admin-invoices.js?v=${ctx.app.assetVersion}" defer></script>` });
}
