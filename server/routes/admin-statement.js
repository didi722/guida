// Pannello › Partner › Estratto conto: la scheda del mese, il PDF, il CSV e l'invio per email all'agenzia.
import express from 'express';
import { send, sendPdf } from '../http.js';
import { makeT } from '../i18n.js';
import { renderStatementPdf } from '../pdf-statement.js';
import { normMonth, statementCsv, statementOf, statementRange, statementXlsx } from '../statement.js';
import { XLSX_TYPE } from '../xlsx.js';
import { movementLabel } from '../statementText.js';
import { nowRome } from '../time.js';
import { adminStatementPage } from '../views/admin-statement.js';

const FLASH = { sent: 'Estratto conto inviato.' };
const ERR = { mail: 'L’email non è partita: controlla le impostazioni di posta e riprova.' };

export function adminStatementRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '5kb' });
  const account = (req) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(req.params.id));
  const monthOf = (req) => normMonth(req.query.month ?? req.body?.month, nowRome().date);

  r.use('/partners/:id/statement', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  r.get('/partners/:id/statement', (req, res, next) => {
    const a = account(req);
    if (!a) return next();
    const month = monthOf(req);
    const sent = db.prepare('SELECT status, sent_at FROM statement_sends WHERE account_id = ? AND month = ?').get(a.id, month) ?? null;
    send(res, adminStatementPage({ app, req }, a, { st: statementOf(app, a.id, month), range: statementRange(db, a.id), sent, autoSend: !!app.cfg.statements.enabled, flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '' }));
  });

  r.get('/partners/:id/statement.pdf', async (req, res, next) => {
    const a = account(req);
    if (!a) return next();
    const month = monthOf(req);
    sendPdf(res, await renderStatementPdf(app, statementOf(app, a.id, month), { account: a }), `estratto-conto-${month}.pdf`);
  });

  const registry = (t) => ({
    head: [t('s.date'), t('stmt.col.doc'), t('stmt.col.detail'), t('invpay.dueBy'), t('stmt.col.amount'), t('stmt.col.balance')],
    opening: t('stmt.opening'),
    closing: t('stmt.closing'),
    label: (m) => movementLabel(t, 'it', m),
  });

  r.get('/partners/:id/statement.csv', (req, res, next) => {
    const a = account(req);
    if (!a) return next();
    const t = makeT('it');
    const month = monthOf(req);
    const csv = statementCsv(statementOf(app, a.id, month), registry(t));
    res.type('text/csv; charset=utf-8').set({ 'Content-Disposition': `attachment; filename="estratto-conto-${month}.csv"` }).send(csv);
  });

  // lo stesso per il foglio di calcolo, con date e importi veri e colonne larghe quanto serve (nel CSV le date si possono vedere come «####»)
  r.get('/partners/:id/statement.xlsx', async (req, res, next) => {
    const a = account(req);
    if (!a) return next();
    const t = makeT('it');
    const month = monthOf(req);
    const file = await statementXlsx(statementOf(app, a.id, month), { ...registry(t), sheet: `${t('stmt.title')} ${month}` });
    res.type(XLSX_TYPE).set({ 'Content-Disposition': `attachment; filename="estratto-conto-${month}.xlsx"`, 'X-Content-Type-Options': 'nosniff' }).send(file);
  });

  r.post('/partners/:id/statement/send', form, async (req, res, next) => {
    const a = account(req);
    if (!a) return next();
    const month = monthOf(req);
    const ok = await app.statements.send(a, month);
    res.redirect(303, `/admin/partners/${a.id}/statement?month=${month}&${ok ? 'ok=sent' : 'err=mail'}`);
  });

  return r;
}
