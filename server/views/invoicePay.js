// Pagamento delle fatture ai partner: la pagina di pagamento di una fattura (dal link, con il codice segreto) e il riquadro nella scheda di una prenotazione a fattura.
import { html } from '../html.js';
import { ensurePayRef, invoiceDue, payInstructions, payState } from '../invoicePayments.js';
import { getInvoice } from '../invoices.js';
import { fmtDate, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { page } from './layout.js';

/** Lo stato dell'incasso a parole (la chiave è `invpay.state.<stato>`), con la data. */
export function stateText(t, lang, inv, st = payState(inv)) {
  if (st.state === 'paid') return t(inv.paid_method === 'card' ? 'invpay.state.paidCard' : inv.paid_method === 'bank' ? 'invpay.state.paidBank' : 'invpay.state.paid', { date: fmtDate(nowRome(Date.parse(inv.paid_at)).date, lang, 'date') });
  if (st.state === 'overdue') return t('invpay.state.overdue', { date: fmtDate(st.dueDate, lang, 'date') });
  if (st.state === 'open') return st.dueDate ? t('invpay.state.open', { date: fmtDate(st.dueDate, lang, 'date') }) : t('invpay.state.openNoDate');
  return t(`invpay.state.${st.state}`);
}

/** Un valore da copiare con un tocco (IBAN, causale). */
const copyRow = (t, id, label, value) => html`<div class="copy-row"><span class="muted">${label}</span><span class="copy-line"><input class="copy-field" id="${id}" readonly value="${value}" data-select-all aria-label="${label}"><button type="button" class="btn btn-outline btn-sm" data-copy="#${id}" data-copied="${t('invpay.copied')}">${t('invpay.copy')}</button></span></div>`;

/** «Come pagare»: il bonifico (intestatario, IBAN, banca, causale, importo, scadenza) e, se si può, la carta. */
export function payHow(ctx, inv, { canCard }) {
  const { t, lang } = ctx;
  const p = payInstructions(ctx.app, inv);
  const money = (c) => formatMoney(c, lang, inv.currency);
  return html`<h2 class="h-sub spaced">${t('invpay.how')}</h2>
    ${p.iban
      ? html`<div class="pay-box"><h3>${t('invpay.transfer')}</h3>
        <dl class="summary-list">
          <div><dt>${t('invpay.beneficiary')}</dt><dd>${p.beneficiary}</dd></div>
          ${p.bank ? html`<div><dt>${t('invpay.bank')}</dt><dd>${p.bank}</dd></div>` : ''}
          <div><dt>${t('invpay.amount')}</dt><dd><strong>${money(p.amountCents)}</strong></dd></div>
          ${p.dueDate ? html`<div><dt>${t('invpay.dueBy')}</dt><dd>${fmtDate(p.dueDate, lang, 'date')}</dd></div>` : ''}
        </dl>
        ${copyRow(t, 'pay-iban', t('invpay.iban'), p.iban)}
        ${copyRow(t, 'pay-ref', t('invpay.reference'), p.reference)}
        <p class="small muted">${t('invpay.transferHint')}</p></div>`
      : html`<p class="muted">${t('invpay.noIban', { amount: money(p.amountCents) })}</p>`}
    ${canCard ? html`<div class="pay-box"><h3>${t('invpay.card')}</h3><p class="small muted">${t('invpay.cardHint')}</p><p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${inv.pay_ref}?t=${inv.pay_token}&lang=${lang}">${t('invpay.payCard')}</a></p></div>` : ''}`;
}

/**
 * La pagina di una fattura: quanto e quando si paga, come (bonifico con IBAN e causale, o carta) e il PDF.
 * Si apre dal link dell'email di sollecito o della copia di cortesia (basta il codice segreto), o dall'area dell'agenzia (`owner`).
 */
export function invoicePayPage(ctx, inv, { canCard = false, owner = false, flash = '' } = {}) {
  const { t, lang, u } = ctx;
  const st = payState(inv);
  const buyer = JSON.parse(inv.buyer_json);
  const money = (c) => formatMoney(c, lang, inv.currency);
  const tone = { paid: 'ok', settled: 'ok', credited: 'wait', open: 'wait', overdue: 'err' }[st.state];
  const q = `?t=${inv.pay_token}`;
  const pending = st.state === 'open' || st.state === 'overdue';
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${owner ? html`<p class="back-link"><a href="${u('/b2b/invoices')}">← ${t('partner.inv.title')}</a></p>` : ''}
  ${flash === 'paid' || flash === 'canceled' ? html`<div class="notice notice-${flash === 'paid' ? 'ok' : 'err'}" role="status">${t(`invpay.flash.${flash}`)}</div>` : ''}
  <div class="status status-${tone}"><span class="status-dot" aria-hidden="true"></span><div><h1>${t('invpay.title', { number: inv.number })}</h1><p class="lead">${stateText(t, lang, inv, st)}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad">
    <dl class="summary-list">
      <div><dt>${t('invpay.issuedTo')}</dt><dd>${buyer.name || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ')}</dd></div>
      <div><dt>${t('invpay.invoiceDate')}</dt><dd>${fmtDate(inv.issue_date, lang, 'date')}</dd></div>
      <div><dt>${t('invpay.invoiceTotal')}</dt><dd>${money(inv.total_cents)}</dd></div>
      ${pending ? html`<div class="summary-total"><dt>${t('invpay.toPay')}</dt><dd>${money(st.dueCents)}</dd></div>` : ''}
    </dl>
    ${pending ? payHow(ctx, inv, { canCard }) : ''}
    <p class="btn-row"><a class="btn btn-outline" href="/${lang}/invoices/${inv.pay_ref}/pdf${q}" target="_blank" rel="noopener">${t('invpay.pdf')}</a></p>
  </div>
</div></section>`;
  return page(ctx, { title: t('invpay.title', { number: inv.number }), path: `/${lang}/invoices/${inv.pay_ref}`, body, noindex: true, ...(owner ? { area: 'partner', activeNav: 'b2b-invoices' } : {}) });
}

/**
 * Nella scheda di una prenotazione a fattura non ancora pagata: come e quando si paga (la fattura se c'è, altrimenti le regole), con il link per pagarla.
 * `invoice`: la fattura emessa che la contiene (riga di invoiceOfBooking), se c'è.
 */
export function bookingPayBlock(ctx, b, invoice) {
  const { t, lang, app } = ctx;
  const days = Number(app.cfg.invoice.b2bDueDays) || 0;
  const inv = invoice ? getInvoice(app.db, invoice.id) : null;
  if (inv && invoiceDue(inv) > 0) {
    const pay = ensurePayRef(app.db, inv);
    const st = payState(pay);
    return html`<div class="pay-block"><h3>${t('invpay.booking.title')}</h3>
      <p>${t('invpay.booking.invoiced', { number: pay.number, amount: formatMoney(st.dueCents, lang, pay.currency) })} <strong class="${st.state === 'overdue' ? 'field-error' : ''}">${stateText(t, lang, pay, st)}</strong>.</p>
      <p class="btn-row"><a class="btn btn-outline" href="/${lang}/invoices/${pay.pay_ref}?t=${pay.pay_token}">${t('invpay.booking.how')}</a></p></div>`;
  }
  if (inv?.paid_at) return '';
  return html`<div class="pay-block"><h3>${t('invpay.booking.title')}</h3>
    <p class="small muted">${t('invpay.booking.before', { when: days > 0 ? t('invpay.within', { days }) : t('invpay.onInvoiceDate') })}</p></div>`;
}
