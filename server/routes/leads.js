// Pagine pubbliche del Commerciale: il link «non ricevere più email» che sta in fondo a ogni email di presentazione.
// Il collegamento è firmato (non c'è nulla da conservare); la pagina chiede conferma e solo il pulsante disiscrive: i programmi di posta che
// «aprono» i collegamenti per controllarli non cancellano nessuno. L'intestazione List-Unsubscribe-Post usa lo stesso indirizzo.
import express from 'express';
import { send } from '../http.js';
import { getLead, optOut } from '../leads.js';
import { leadOfToken } from '../leadMail.js';
import { unsubscribePage } from '../views/b2b.js';

export function leadsPublicRouter(app) {
  const r = express.Router();
  const { db, cfg } = app;
  const form = express.urlencoded({ extended: false, limit: '2kb' });
  const target = (token) => {
    const id = leadOfToken(cfg, token);
    return id ? getLead(db, id) : null;
  };

  r.get('/b2b/unsubscribe/:token', (req, res) => {
    const lead = target(req.params.token);
    if (!lead) return send(res, unsubscribePage(res.locals.ctx, { state: 'bad' }), 404);
    send(res, unsubscribePage(res.locals.ctx, { state: lead.email_ok ? 'ask' : 'done', token: req.params.token }));
  });

  r.post('/b2b/unsubscribe/:token', form, (req, res) => {
    const lead = target(req.params.token);
    if (!lead) return send(res, unsubscribePage(res.locals.ctx, { state: 'bad' }), 404);
    optOut(db, lead.id, { source: 'link' });
    res.set('Cache-Control', 'no-store');
    send(res, unsubscribePage(res.locals.ctx, { state: 'done' }));
  });

  return r;
}
