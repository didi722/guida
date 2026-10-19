// Sito › Periodi: regole particolari per intervalli di date del servizio (alta stagione, Carnevale…).
import express from 'express';
import { send } from '../http.js';
import { getPeriod, listPeriods } from '../periods.js';
import { tierInput } from '../policy.js';
import { periodEditPage, periodsPage } from '../views/admin-periods.js';

const FLASH = { created: 'Periodo aggiunto: le sue regole valgono da subito per i servizi di quelle date.', saved: 'Periodo salvato.', deleted: 'Periodo eliminato: per quelle date tornano le regole del sito.' };

/** Il modulo come arriva (testo; le righe dell'annullo come sono state scritte). */
const readPeriod = (b) => ({
  name: b.name, from: b.from, to: b.to, mode: b.mode, maxDays: b.maxDays, releaseHours: b.releaseHours, noticeB2c: b.noticeB2c, noticeB2b: b.noticeB2b,
  cancelB2c: tierInput(b, 'c_'), cancelB2b: tierInput(b, 'a_'), cancelPartners: b.cancelPartners === '1',
});

export function adminPeriodsRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  const ctxOf = (req) => ({ app, req });
  const flashOf = (req) => FLASH[String(req.query.ok ?? '')] ?? '';
  const one = (req) => {
    const id = Number(req.params.id);
    return Number.isInteger(id) ? getPeriod(app.db, id) : null;
  };

  r.get('/periods', (req, res) => send(res, periodsPage(ctxOf(req), { periods: listPeriods(app.db), flash: flashOf(req) })));

  r.post('/periods', form, (req, res) => {
    const input = readPeriod(req.body);
    const out = app.periods.save(input);
    if (out.ok) return res.redirect(303, '/admin/periods?ok=created');
    return send(res, periodsPage(ctxOf(req), { periods: listPeriods(app.db), values: input, errors: out.errors }), 400);
  });

  r.get('/periods/:id', (req, res, next) => {
    const period = one(req);
    if (!period) return next();
    send(res, periodEditPage(ctxOf(req), { period, flash: flashOf(req) }));
  });

  r.post('/periods/:id', form, (req, res, next) => {
    const period = one(req);
    if (!period) return next();
    const input = readPeriod(req.body);
    const out = app.periods.save(input, period.id);
    if (out.ok) return res.redirect(303, `/admin/periods/${period.id}?ok=saved`);
    return send(res, periodEditPage(ctxOf(req), { period, values: input, errors: out.errors }), 400);
  });

  r.post('/periods/:id/delete', form, (req, res, next) => {
    const period = one(req);
    if (!period) return next();
    app.periods.remove(period.id);
    res.redirect(303, '/admin/periods?ok=deleted');
  });

  return r;
}
