// Pagamento delle fatture ai partner: la pagina di una fattura (dal link, con il codice segreto, o dall'area dell'agenzia) e il suo PDF.
// Il pagamento con carta passa da /pay/resume/IN-… (come per prenotazioni e pacchetti).
import express from 'express';
import { send, sendPdf } from '../http.js';
import { getInvoiceByPayRef, isPayable } from '../invoicePayments.js';
import { renderInvoicePdf } from '../pdf-invoice.js';
import { safeEqual } from '../util.js';
import { invoicePayPage } from '../views/invoicePay.js';
import { needPartner } from './guards.js';

export function invoicePayRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '10kb' });

  r.use('/invoices', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** La fattura indicata nell'URL, con il codice segreto del link (solo fatture emesse). */
  const byToken = (req) => {
    const inv = getInvoiceByPayRef(db, req.params.ref);
    const token = String(req.query.t ?? '');
    return inv && token && inv.pay_token && safeEqual(token, inv.pay_token) && inv.number ? inv : null;
  };

  r.get('/invoices/:ref', async (req, res, next) => {
    let inv = byToken(req);
    if (!inv) return next();
    if (req.query.paid && isPayable(inv)) {
      await app.payables.sync(inv.pay_ref); // tornata da Stripe prima del webhook
      inv = byToken(req);
    }
    const owner = !!req.acct && req.acct.status === 'approved' && inv.account_id === req.acct.id;
    send(res, invoicePayPage(res.locals.ctx, inv, { canCard: app.invoices.canPayByCard(inv), owner, flash: String(req.query.paid ? 'paid' : req.query.canceled ? 'canceled' : '') }));
  });

  r.get('/invoices/:ref/pdf', async (req, res, next) => {
    const inv = byToken(req);
    if (!inv) return next();
    sendPdf(res, await renderInvoicePdf(app, inv), `${inv.doc_type === 'TD04' ? 'nota-di-credito' : 'fattura'}-${String(inv.number).replace('/', '-')}.pdf`);
  });

  // «Paga tutto lo scaduto»: un solo pagamento con carta per le fatture scadute dell'agenzia (si apre subito la pagina della carta)
  r.post('/b2b/invoices/pay-all', needPartner, form, (req, res) => {
    const batch = app.invoices.payOverdue(req.acct.id);
    if (!batch) return res.redirect(303, `/${req.lang}/b2b/invoices?flash=nothing`);
    res.redirect(303, `/pay/resume/${batch.ref}?t=${batch.token}&lang=${req.lang}`);
  });

  return r;
}
