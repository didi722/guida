// Impostazioni dell'attività: contatti, regole di prenotazione, buoni regalo e recensioni, dati fiscali.
import express from 'express';
import { configProblems } from '../invoices.js';
import { send } from '../http.js';
import { settingsPage } from '../views/admin-settings.js';

export function adminSettingsRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '60kb' });
  const FLASH = { saved: 'Salvato: le modifiche sono già attive sul sito.', reset: 'Ripristinati i valori predefiniti.' };

  const render = (req, res, { posted = {}, errors = {}, open = '', error = '', status = 200 } = {}) =>
    send(res, settingsPage({ app, req }, { sections: app.settings.describe({ posted, errors }), open, problems: configProblems(app.cfg), flash: FLASH[String(req.query.ok ?? '')] ?? '', error }), status);

  r.get('/settings', (req, res) => render(req, res, { open: String(req.query.s ?? '') }));

  r.post('/settings/:section', form, (req, res) => {
    const id = req.params.section;
    const result = app.settings.save(id, req.body ?? {});
    if (result.unknown) return res.redirect(303, '/admin/settings');
    if (!result.ok) return render(req, res, { posted: req.body ?? {}, errors: result.errors, open: id, error: 'Controlla i campi evidenziati: non è stato salvato nulla.', status: 400 });
    res.redirect(303, `/admin/settings?ok=saved&s=${id}#${id}`);
  });

  r.post('/settings/:section/reset', form, (req, res) => {
    const id = req.params.section;
    if (!app.settings.reset(id)) return res.redirect(303, '/admin/settings');
    res.redirect(303, `/admin/settings?ok=reset&s=${id}#${id}`);
  });

  return r;
}
