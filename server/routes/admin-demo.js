// Commerciale › Demo: il collegamento riservato all'area agenzie di prova. (La demo vera è in demo.js.)
import express from 'express';
import { demoLink } from '../demo.js';
import { LANGS } from '../langs.js';
import { demoPage } from '../views/admin-demo.js';
import { send } from '../http.js';

export function adminDemoRouter(app) {
  const r = express.Router();

  r.get('/leads/demo', (req, res, next) => {
    if (!app.demo) return next();
    const flash = String(req.query.ok ?? '') === 'key' ? 'Nuovo collegamento creato: quello di prima non funziona più.' : '';
    const origin = `${req.protocol}://${req.get('host')}`; // l'indirizzo con cui stai guardando il pannello: è quello che l'agenzia deve poter aprire
    send(res, demoPage({ app, req }, { link: demoLink(app, '', origin), linkFor: (l) => demoLink(app, LANGS.includes(l) ? l : '', origin), status: app.demo.status(), flash }));
  });

  r.post('/leads/demo/key', (req, res, next) => {
    if (!app.demo) return next();
    app.demo.rotateKey();
    res.redirect(303, '/admin/leads/demo?ok=key');
  });

  return r;
}
