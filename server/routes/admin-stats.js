// Statistiche e KPI (segnaposto: la pagina vera la scrive chi implementa il compito «Statistiche»).
import express from 'express';
import { send } from '../http.js';
import { adminLayout } from '../views/admin.js';
import { html } from '../html.js';

export function adminStatsRouter(app) {
  const r = express.Router();
  r.get('/stats', (req, res) => send(res, adminLayout({ app, req }, { title: 'Statistiche', active: '/admin/stats', body: html`<p class="muted">In arrivo.</p>` })));
  return r;
}
