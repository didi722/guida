// Pannello › Conti › Fatture › Incassi dalla banca: si carica l'estratto conto (CSV), si vedono i bonifici riconosciuti e si segnano le fatture incassate.
import { html, raw } from '../html.js';
import { fmtDate } from '../time.js';
import { formatMoney } from '../util.js';
import { adminLayout } from './admin.js';
import { tabs } from './admin-invoices.js';

const eur = (c) => formatMoney(c, 'it');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// i gruppi dell'elenco, nell'ordine in cui si guardano: prima ciò che è sicuro
const GROUPS = [
  ['sure', 'Da segnare come incassate', 'Il bonifico cita il numero della fattura e l’importo coincide con ciò che restava da pagare. Sono già spuntate: controlla e conferma.', 'chip-ok'],
  ['likely', 'Probabili', 'Manca il numero di fattura, ma l’importo coincide con una sola fattura e nel testo c’è il nome dell’agenzia. Spunta tu quelle giuste.', 'chip-warn'],
  ['check', 'Da controllare', 'Il bonifico cita una fattura, ma l’importo è diverso (acconto, differenza, commissioni). Segnala come incassata solo se è saldata.', 'chip-warn'],
  ['guess', 'Solo l’importo', 'Nessun numero di fattura né nome: coincide soltanto l’importo con una fattura. Controlla l’ordinante prima di spuntare.', ''],
  ['ambiguous', 'Più fatture con lo stesso importo', 'Scegli a quale fattura appartiene il bonifico.', 'chip-warn'],
  ['paid', 'Già incassate', 'La fattura citata risulta già segnata come incassata: non serve fare nulla.', ''],
];

function candidateCell(row) {
  if (row.status === 'none') return html`<span class="muted">nessuna fattura riconosciuta</span>`;
  return html`${row.candidates.map((c) => {
    const value = `${c.id}:${row.date}`;
    const input = row.status === 'paid' ? '' : row.status === 'ambiguous'
      ? html`<input type="radio" name="pay_${row.line}" value="${value}" aria-label="Fattura ${c.number}"> `
      : html`<input type="checkbox" name="pay" value="${value}" data-cents="${c.dueCents}" ${row.selected.includes(c.id) ? raw('checked') : ''} aria-label="Fattura ${c.number}"> `;
    return html`<div class="bank-inv"><label>${input}<a href="/admin/invoices/${c.id}" target="_blank" rel="noopener"><strong>${c.number}</strong></a> · ${c.company || '—'}</label> <small class="muted">${c.open ? `da incassare ${eur(c.dueCents)}${c.dueDate ? `, scadenza ${fmtDate(c.dueDate, 'it', 'short')}` : ''}` : 'incassata'}</small></div>`;
  })}`;
}

function reviewBox(review) {
  const { statement, match } = review;
  const c = match.counts;
  const rows = (status) => match.rows.filter((r) => r.status === status);
  const table = (list) => html`<div class="card table-wrap"><table class="table"><thead><tr><th>Data</th><th>Accredito</th><th class="num">Importo</th><th>Fattura</th></tr></thead><tbody>
    ${list.map((r) => html`<tr><td>${fmtDate(r.bankDate, 'it', 'short')}${r.bankDate !== r.date ? html`<br><small class="muted">(segnata oggi)</small>` : ''}<br><small class="muted">riga ${r.line}</small></td>
      <td>${r.text || '—'}${r.note ? html`<br><small class="muted">${r.note}</small>` : ''}</td><td class="num">${eur(r.cents)}</td><td>${candidateCell(r)}</td></tr>`)}
  </tbody></table></div>`;
  const none = rows('none');
  return html`
<div class="notice notice-info" role="status">
  <p><strong>Letti ${plural(statement.rows.length, 'movimento', 'movimenti')}</strong>: ${plural(c.credits, 'accredito', 'accrediti')} e ${plural(c.debits, 'uscita ignorata', 'uscite ignorate')}${statement.skipped ? `; ${plural(statement.skipped, 'riga senza data o importo saltata', 'righe senza data o importo saltate')}` : ''}.
  Colonne riconosciute: data «${statement.columns.date}», importo «${statement.columns.amount}», descrizione «${statement.columns.text.join(' + ')}».</p>
</div>
${c.credits === 0 ? html`<p class="card pad muted">Nell’estratto non ci sono accrediti.</p>` : ''}
<form method="post" action="/admin/invoices/bank/apply" class="bank-apply">
  ${GROUPS.map(([status, title, hint, chip]) => {
    const list = rows(status);
    return list.length ? html`<h2 class="h-sub spaced">${title} <span class="chip ${chip}">${list.length}</span></h2><p class="muted small">${hint}</p>${table(list)}` : '';
  })}
  ${none.length ? html`<details class="spaced"><summary>Accrediti senza fattura (${none.length})</summary><p class="muted small">Non cito nessuna fattura e l’importo non coincide: possono essere pagamenti carta (Stripe), rimborsi, buoni regalo o altro.</p>${table(none)}</details>` : ''}
  ${match.rows.some((r) => ['sure', 'likely', 'check', 'guess', 'ambiguous'].includes(r.status))
    ? html`<div class="card pad form spaced">
      <label class="check"><input type="checkbox" name="notify" value="1" checked> Avvisa le agenzie che il pagamento è arrivato <em>(email con la ricevuta, come quando segni un incasso a mano)</em></label>
      <p class="btn-row"><button class="btn btn-gold" type="submit">Segna come incassate le fatture selezionate</button> <span class="muted" data-bank-count></span></p>
    </div>`
    : ''}
</form>`;
}

/**
 * @param {object} o
 * @param {string} [o.csv] il testo incollato, se si torna al modulo dopo un errore
 * @param {{statement: object, match: object}|null} [o.review] gli accrediti letti e abbinati
 */
export function bankPage(ctx, { counts, csv = '', review = null, flash = '', error = '' }) {
  const body = html`
${tabs('bank', counts)}
<p class="muted">Scarica dalla tua banca l’<strong>estratto conto in CSV</strong> e caricalo qui: cerco i bonifici che citano il <strong>numero di una fattura</strong> («Fattura 12/2027», la causale che chiediamo alle agenzie) e ti propongo di segnarle come incassate. <strong>Nulla cambia finché non confermi.</strong> Il file non viene conservato.</p>
<form method="post" action="/admin/invoices/bank" class="card pad form" data-bank-form>
  <label class="field"><span class="label">File dell’estratto conto <em>(CSV; si legge qui, nel tuo browser)</em></span><input type="file" accept=".csv,.txt,text/csv,text/plain" data-bank-file></label>
  <label class="field"><span class="label">…oppure incolla il contenuto</span><textarea name="csv" rows="${review ? 3 : 7}" spellcheck="false" data-bank-text placeholder="Data;Descrizione;Importo&#10;20/01/2027;Bonifico LAGOON DMC Fattura 12/2027;1.234,56">${csv}</textarea></label>
  <p class="small muted" data-bank-status role="status"></p>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Controlla i bonifici</button></div>
</form>
${review ? reviewBox(review) : ''}`;
  return adminLayout(ctx, { title: 'Incassi dalla banca', active: '/admin/invoices', body, flash, error, scripts: `<script src="/js/admin-bank.js?v=${ctx.app.assetVersion}" defer></script>` });
}
