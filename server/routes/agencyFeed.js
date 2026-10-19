// Calendario in abbonamento dell'agenzia: l'indirizzo privato (senza accesso, come per ogni app calendario) e il pulsante per cambiarlo.
import express from 'express';
import { accountByIcsKey, agencyFeed, rotateIcsKey } from '../agencyFeed.js';
import { tooMany } from '../http.js';
import { needPartner } from './guards.js';

export function agencyFeedRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '5kb' });

  r.get('/b2b/calendar.ics', (req, res) => {
    if (!app.limits.api(`feed|${req.ip}`)) return tooMany(res);
    const account = accountByIcsKey(app.db, String(req.query.k ?? ''));
    if (!account) return res.status(404).type('text/plain').send('Not found');
    res.type('text/calendar; charset=utf-8').set({ 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' }).send(agencyFeed(app, account));
  });

  r.post('/b2b/calendar/rotate', needPartner, form, (req, res) => {
    rotateIcsKey(app.db, req.acct.id);
    res.redirect(303, `/${req.lang}/b2b/bookings?flash=feed#calendario-telefono`);
  });

  return r;
}
