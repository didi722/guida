// Area agenzie › Dati di fatturazione: il titolare controlla e completa i dati con cui prepariamo le fatture (indirizzo, CAP, città, provincia, codice fiscale, SDI/PEC).
// La ragione sociale e la partita IVA non si cambiano da qui (vanno verificate): se sono cambiate si scrive alla guida.
import express from 'express';
import { billingProblem, readBilling } from '../billing.js';
import { send } from '../http.js';
import { billingPage } from '../views/billing.js';
import { needPartner } from './guards.js';

export function billingRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '8kb' });

  r.use('/b2b/billing', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** Solo il titolare (chi ha registrato l'agenzia) cambia i dati dell'azienda: un collaboratore torna alla sua pagina. */
  const needOwner = (req, res, next) => (req.actor?.owner ? next() : res.redirect(303, `/${req.lang}/b2b/account`));

  r.get('/b2b/billing', needPartner, needOwner, (req, res) => {
    send(res, billingPage(res.locals.ctx, { acct: req.acct, flash: req.query.ok === 'saved' ? res.locals.ctx.t('billing.saved') : '' }));
  });

  r.post('/b2b/billing', needPartner, needOwner, form, (req, res) => {
    const { t } = res.locals.ctx;
    const v = readBilling(req.body);
    if (v.country !== 'IT') Object.assign(v, { tax_code: '', province: '', sdi_code: '' });
    const problem = billingProblem(v);
    if (problem) return send(res, billingPage(res.locals.ctx, { acct: { ...req.acct, ...v }, error: t(`err.${problem}`) }), 400);
    db.prepare('UPDATE accounts SET country = ?, tax_code = ?, address = ?, zip = ?, city = ?, province = ?, sdi_code = ?, pec = ? WHERE id = ?')
      .run(v.country, v.tax_code || null, v.address, v.zip, v.city, v.province || null, v.sdi_code || null, v.pec || null, req.acct.id);
    res.redirect(303, `/${req.lang}/b2b/billing?ok=saved`);
  });

  return r;
}
