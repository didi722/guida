// Area agenzie › Estratto conto: la pagina del mese, il PDF, il foglio di calcolo e la scelta di riceverlo per email.
import express from 'express';
import { send, sendPdf } from '../http.js';
import { ensurePayRef, isPayable } from '../invoicePayments.js';
import { renderStatementPdf } from '../pdf-statement.js';
import { normMonth, statementCsv, statementOf, statementRange, statementXlsx } from '../statement.js';
import { XLSX_TYPE } from '../xlsx.js';
import { movementLabel } from '../statementText.js';
import { nowRome } from '../time.js';
import { statementPage } from '../views/statement.js';
import { needPartner } from './guards.js';

export function statementRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '5kb' });

  // dati contabili: mai in cache del browser o di proxy
  r.use(['/b2b/statement', '/b2b/statement.pdf', '/b2b/statement.csv', '/b2b/statement.xlsx'], (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  const monthOf = (req) => normMonth(req.query.month ?? req.body?.month, nowRome().date);

  r.get('/b2b/statement', needPartner, (req, res) => {
    const st = statementOf(app, req.acct.id, monthOf(req));
    // chi deve ancora pagare trova il pulsante per aprire la pagina di pagamento (il suo riferimento si crea al primo bisogno)
    for (const o of st.open) if (isPayable(o.invoice) && !(o.invoice.pay_ref && o.invoice.pay_token)) o.invoice = ensurePayRef(app.db, o.invoice);
    send(res, statementPage(res.locals.ctx, { acct: req.acct, st, range: statementRange(app.db, req.acct.id), mailable: !!app.cfg.statements.enabled, flash: String(req.query.flash ?? '') }));
  });

  r.get('/b2b/statement.pdf', needPartner, async (req, res) => {
    const month = monthOf(req);
    sendPdf(res, await renderStatementPdf(app, statementOf(app, req.acct.id, month), { account: req.acct, lang: req.lang }), `estratto-conto-${month}.pdf`);
  });

  /** Le colonne e i testi del registro, nella lingua della pagina: servono al CSV e al foglio Excel. */
  const registry = (t, lang) => ({
    head: [t('s.date'), t('stmt.col.doc'), t('stmt.col.detail'), t('invpay.dueBy'), t('stmt.col.amount'), t('stmt.col.balance')],
    opening: t('stmt.opening'),
    closing: t('stmt.closing'),
    label: (m) => movementLabel(t, lang, m),
  });
  r.get('/b2b/statement.csv', needPartner, (req, res) => {
    const { t } = res.locals.ctx;
    const month = monthOf(req);
    const csv = statementCsv(statementOf(app, req.acct.id, month), registry(t, req.lang));
    res.type('text/csv; charset=utf-8').set({ 'Content-Disposition': `attachment; filename="estratto-conto-${month}.csv"` }).send(csv);
  });
  r.get('/b2b/statement.xlsx', needPartner, async (req, res) => {
    const { t } = res.locals.ctx;
    const month = monthOf(req);
    const file = await statementXlsx(statementOf(app, req.acct.id, month), { ...registry(t, req.lang), sheet: `${t('stmt.title')} ${month}` });
    res.type(XLSX_TYPE).set({ 'Content-Disposition': `attachment; filename="estratto-conto-${month}.xlsx"`, 'X-Content-Type-Options': 'nosniff' }).send(file);
  });

  r.post('/b2b/statement/email', needPartner, form, (req, res) => {
    app.statements.setPreference(req.acct.id, req.body.on === '1');
    res.redirect(303, `/${req.lang}/b2b/statement?month=${monthOf(req)}&flash=saved`);
  });

  return r;
}
