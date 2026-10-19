// Estratto conto: la pagina dell'agenzia (area riservata) e il corpo che il pannello riusa per la scheda di un partner.
// Il corpo mostra riepilogo, movimenti, fatture ancora da pagare e servizi del mese.
import { html, raw } from '../html.js';
import { isPayable, payInstructions } from '../invoicePayments.js';
import { pick } from '../langs.js';
import { monthTitle, movementLabel, serviceStateText } from '../statementText.js';
import { addMonths, fmtDate, fmtMonth } from '../time.js';
import { formatMoney } from '../util.js';
import { breadcrumbs, homeCrumb } from './components.js';
import { page } from './layout.js';

/**
 * Riepilogo, movimenti, da pagare e servizi.
 * @param {object} o
 * @param {Function} o.t · @param {string} o.lang
 * @param {ReturnType<import('../statement.js').statementOf>} o.st
 * @param {(inv: object) => string} [o.invoiceHref] dove si apre il PDF di una fattura o nota di credito (vuoto = nessun collegamento)
 * @param {(s: object) => string} [o.serviceHref] dove si apre la scheda di un servizio
 * @param {(o: object) => any} [o.payCell] il pulsante «come pagare» di una riga da pagare (solo per l'agenzia)
 * @param {object|null} [o.how] come pagare con un bonifico (solo per l'agenzia)
 */
export function statementBlocks({ t, lang, st, invoiceHref = () => '', serviceHref = () => '', payCell = null, how = null }) {
  const money = (c) => formatMoney(c, lang);
  const signed = (c) => (c > 0 ? `+ ${money(c)}` : c < 0 ? `− ${money(-c)}` : money(0));
  const linked = (href, label) => (href ? html`<a href="${href}" target="_blank" rel="noopener">${label}</a>` : label);
  return html`
  ${st.overdueCents ? html`<div class="notice notice-err" role="alert">${t(payCell ? 'partner.inv.overdue' : 'stmt.overdueNotice', { n: st.open.filter((o) => o.daysLate).length, amount: money(st.overdueCents) })}</div>` : ''}

  <div class="card pad">
    <dl class="summary-list">
      <div><dt>${t('stmt.opening')} · ${fmtDate(st.from, lang, 'short')}</dt><dd>${money(st.opening)}</dd></div>
      <div><dt>${t('stmt.invoiced')}</dt><dd>${signed(st.invoiced)}</dd></div>
      <div><dt>${t('stmt.credited')}</dt><dd>${signed(-st.credited)}</dd></div>
      <div><dt>${t('stmt.paid')}</dt><dd>${signed(-st.paid)}</dd></div>
      <div class="summary-total"><dt>${t('stmt.balanceAt', { date: fmtDate(st.asOf, lang, 'short') })}</dt><dd>${money(st.closing)}${st.closing < 0 ? html` <small class="muted">(${t('stmt.credit')})</small>` : ''}</dd></div>
    </dl>
    ${st.unbilled.count ? html`<p class="small muted">${t('stmt.unbilled', { count: st.unbilled.count, amount: money(st.unbilled.cents), date: fmtDate(st.today, lang, 'short') })}</p>` : ''}
  </div>

  <h2 class="h-sub spaced">${t('stmt.moves')}</h2>
  ${st.movements.length
    ? html`<div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr><th>${t('s.date')}</th><th>${t('stmt.col.doc')}</th><th>${t('stmt.col.detail')}</th><th class="num">${t('stmt.col.amount')}</th><th class="num">${t('stmt.col.balance')}</th></tr></thead><tbody>
      ${st.movements.map((m) => {
        const [doc, detail] = movementLabel(t, lang, m);
        return html`<tr>
          <td data-label="${t('s.date')}">${fmtDate(m.date, lang, 'short')}</td>
          <td data-label="${t('stmt.col.doc')}">${linked(m.kind === 'payment' ? '' : invoiceHref(m.invoice), doc)}</td>
          <td data-label="${t('stmt.col.detail')}">${detail}</td>
          <td class="num" data-label="${t('stmt.col.amount')}">${signed(m.cents)}</td>
          <td class="num" data-label="${t('stmt.col.balance')}">${money(m.balance)}</td></tr>`;
      })}
    </tbody></table></div>`
    : html`<div class="card pad"><p class="muted">${t('stmt.noMoves')}</p></div>`}

  <h2 class="h-sub spaced">${t('stmt.open', { date: fmtDate(st.asOf, lang, 'short') })}</h2>
  ${st.open.length || st.creditCents
    ? html`<div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr><th>${t('stmt.col.doc')}</th><th>${t('invpay.dueBy')}</th><th>${t('stmt.col.late')}</th><th class="num">${t('stmt.col.amount')}</th>${payCell ? html`<th><span class="sr-only">${t('partner.inv.payment')}</span></th>` : ''}</tr></thead><tbody>
      ${st.open.map((o) => html`<tr>
        <td data-label="${t('stmt.col.doc')}">${linked(invoiceHref(o.invoice), t('stmt.doc.invoice', { number: o.invoice.number }))} <small class="muted">${fmtDate(o.invoice.issue_date, lang, 'short')}</small></td>
        <td data-label="${t('invpay.dueBy')}">${o.dueDate ? fmtDate(o.dueDate, lang, 'short') : t('stmt.noDue')}</td>
        <td data-label="${t('stmt.col.late')}">${o.daysLate ? html`<span class="chip chip-err">${t('stmt.late', { days: o.daysLate })}</span>` : '—'}</td>
        <td class="num" data-label="${t('stmt.col.amount')}">${money(o.cents)}</td>
        ${payCell ? html`<td class="pb-actions"><div class="pb-actions-in">${payCell(o)}</div></td>` : ''}</tr>`)}
      ${st.creditCents ? html`<tr class="stmt-note"><td data-label="${t('stmt.col.doc')}" colspan="3">${t('stmt.creditLine')}</td><td class="num" data-label="${t('stmt.col.amount')}">− ${money(st.creditCents)}</td>${payCell ? html`<td></td>` : ''}</tr>` : ''}
    </tbody></table></div>
    ${how?.iban && st.open.length ? html`<div class="card pad spaced"><h3 class="h-sub">${t('invpay.how')}</h3>
      <p class="small">${t('invpay.beneficiary')}: <strong>${how.beneficiary}</strong> · ${t('invpay.iban')}: <strong>${how.iban}</strong>${how.bank ? html` · ${t('invpay.bank')}: ${how.bank}` : ''}</p>
      <p class="small muted">${t('stmt.payHint', { number: st.open[0].invoice.number })}</p></div>` : ''}`
    : html`<div class="card pad"><p class="muted">${t('stmt.openNone')}</p></div>`}

  <h2 class="h-sub spaced">${t('stmt.services')}</h2>
  ${st.services.length
    ? html`<div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr><th>${t('s.date')}</th><th>${t('s.service')}</th><th class="num">${t('s.guests')}</th><th class="num">${t('s.total')}</th><th>${t('b2b.state')}</th></tr></thead><tbody>
      ${st.services.map((s) => {
        const title = pick(s.i18n ?? {}, lang)?.title ?? s.slug;
        const href = serviceHref(s);
        return html`<tr>
        <td data-label="${t('s.date')}">${fmtDate(s.date, lang, 'short')} <small class="muted">${s.start}</small></td>
        <td data-label="${t('s.service')}">${href ? html`<a href="${href}">${title}</a>` : title}${s.clientRef ? html` <small class="muted">· ${s.clientRef}</small>` : ''}</td>
        <td class="num" data-label="${t('s.guests')}">${s.people}</td>
        <td class="num" data-label="${t('s.total')}">${money(s.cents)}</td>
        <td data-label="${t('b2b.state')}"><span class="chip ${s.state === 'toInvoice' || s.state === 'penalty' ? 'chip-warn' : s.state === 'invoiced' && s.paid ? 'chip-ok' : ''}">${serviceStateText(t, s)}</span></td></tr>`;
      })}
    </tbody></table></div>`
    : html`<div class="card pad"><p class="muted">${t('stmt.servicesNone')}</p></div>`}`;
}

/** Il mese in alto: frecce per cambiarlo, PDF e CSV. `base`: il percorso della pagina (senza query). */
export function statementBar({ t, lang, st, range, base }) {
  const prev = addMonths(`${st.month}-01`, -1).slice(0, 7);
  const next = addMonths(`${st.month}-01`, 1).slice(0, 7);
  return html`<div class="stmt-bar">
    <div class="stmt-nav">
      ${st.month > range.first ? html`<a class="btn btn-outline btn-sm" href="${base}?month=${prev}" rel="prev">${t('stmt.prev')}</a>` : ''}
      <h2 class="stmt-month">${monthTitle(fmtMonth(st.month, lang), lang)}</h2>
      ${st.month < range.last ? html`<a class="btn btn-outline btn-sm" href="${base}?month=${next}" rel="next">${t('stmt.next')}</a>` : ''}
      ${st.month !== range.last ? html`<a class="btn btn-outline btn-sm" href="${base}">${t('stmt.current')}</a>` : ''}
    </div>
    <div class="btn-row"><a class="btn btn-gold btn-sm" href="${base}.pdf?month=${st.month}" target="_blank" rel="noopener">${t('stmt.pdf')}</a><a class="btn btn-outline btn-sm" href="${base}.csv?month=${st.month}">${t('stmt.csv')}</a></div>
  </div>`;
}

/**
 * La pagina dell'agenzia.
 * @param {{first: string, last: string}} o.range il primo e l'ultimo mese che si possono vedere
 * @param {boolean} o.mailable la guida manda gli estratti conto per email (se no, la scelta non ha senso)
 */
export function statementPage(ctx, { acct, st, range, mailable = false, flash = '' }) {
  const { t, lang, u, app } = ctx;
  const base = u('/b2b/statement');
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('partner.nav.invoices'), u('/b2b/invoices')], [t('stmt.title')]])}
  <h1>${t('stmt.title')}</h1><p class="lead">${t('stmt.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap">
  ${flash === 'saved' ? html`<div class="notice notice-ok" role="status">${t('stmt.flash.saved')}</div>` : ''}
  ${statementBar({ t, lang, st, range, base })}
  ${statementBlocks({
    t,
    lang,
    st,
    invoiceHref: (inv) => u(`/b2b/invoices/${inv.id}/pdf`),
    serviceHref: (s) => u(`/b2b/bookings/${s.ref}`),
    how: st.open.length ? payInstructions(app, st.open[0].invoice) : null,
    payCell: (o) => (o.invoice.pay_ref && isPayable(o.invoice) ? html`<a class="btn ${o.daysLate ? 'btn-gold' : 'btn-outline'} btn-sm" href="/${lang}/invoices/${o.invoice.pay_ref}?t=${o.invoice.pay_token}">${t('partner.inv.howToPay')}</a>` : ''),
  })}
  ${mailable
    ? html`<form class="card pad form spaced" method="post" action="${base}/email">
        <label class="check"><input type="checkbox" name="on" value="1" ${acct.statement_email ? raw('checked') : ''}> ${t('stmt.mailOn')}</label>
        <p class="small muted">${t('stmt.mailHint')}</p>
        <input type="hidden" name="month" value="${st.month}">
        <div class="btn-row"><button class="btn btn-outline btn-sm" type="submit">${t('stmt.save')}</button></div>
      </form>`
    : ''}
</div></section>`;
  return page(ctx, { title: t('stmt.title'), path: `/${lang}/b2b/statement`, body, noindex: true, activeNav: 'b2b-invoices', area: 'partner' });
}
