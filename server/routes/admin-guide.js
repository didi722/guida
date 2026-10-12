// Guida d'uso del sito (docs/GUIDA.md), dentro il pannello.
import express from 'express';
import { renderGuide } from '../guide.js';
import { send } from '../http.js';
import { guidePage } from '../views/admin-guide.js';

export function adminGuideRouter(app) {
  const r = express.Router();
  r.get('/guide', (req, res) => send(res, guidePage({ app, req }, { html: renderGuide() })));
  return r;
}
