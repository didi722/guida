// Tariffe a ore modificabili dal pannello (Sito › Tariffe a ore).
import express from 'express';
import { parseRatesForm } from '../rates.js';
import { send } from '../http.js';
import { ratesPage } from '../views/admin-rates.js';

const FLASH = { saved: 'Tariffe salvate: valgono per le nuove prenotazioni.', reset: 'Tariffe riportate alle cifre iniziali.' };

export function adminRatesRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ctxOf = (req) => ({ app, req });

  r.get('/rates', (req, res) => send(res, ratesPage(ctxOf(req), { rates: app.rates.get(), custom: app.rates.isCustom(), flash: FLASH[String(req.query.ok ?? '')] ?? '' })));

  r.post('/rates', form, (req, res) => {
    const result = parseRatesForm(req.body, app.rates.get());
    if (!result.ok) {
      const rates = app.rates.get();
      return send(res, ratesPage(ctxOf(req), { rates, values: req.body, errors: result.errors, custom: app.rates.isCustom(), error: 'Alcune cifre non sono valide: le trovi segnate qui sotto. Non ho salvato nulla.' }), 400);
    }
    app.rates.save(result.rates);
    res.redirect(303, '/admin/rates?ok=saved');
  });

  r.post('/rates/reset', form, (req, res) => {
    app.rates.reset();
    res.redirect(303, '/admin/rates?ok=reset');
  });

  return r;
}
