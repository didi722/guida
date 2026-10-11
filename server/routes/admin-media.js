// Libreria immagini: caricamento (il browser invia la foto già ridimensionata) ed eliminazione.
import express from 'express';
import { MediaError } from '../media.js';
import { send } from '../http.js';
import { mediaPage } from '../views/admin-media.js';

export function adminMediaRouter(app) {
  const r = express.Router();
  const json = express.json({ limit: '12mb' });
  const form = express.urlencoded({ extended: false, limit: '10kb' });
  const ctxOf = (req) => ({ app, req });
  const FLASH = { deleted: 'Immagine eliminata.' };
  const ERR = { used: 'L’immagine è usata da un tour o da un articolo: toglila da lì prima di eliminarla.', missing: 'Immagine non trovata.' };

  r.get('/media', (req, res) => {
    send(res, mediaPage(ctxOf(req), { items: app.media.list(), used: app.content.usedImages?.() ?? new Set(), flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '' }));
  });

  r.post('/media', json, (req, res) => {
    try {
      const row = app.media.save(req.body ?? {});
      res.json({ ok: true, name: row.name, small: row.small_name });
    } catch (err) {
      if (!(err instanceof MediaError)) throw err;
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  r.post('/media/:id/delete', form, (req, res) => {
    const row = app.db.prepare('SELECT * FROM media WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.redirect(303, '/admin/media?err=missing');
    if (app.content.usedImages?.().has(row.name)) return res.redirect(303, '/admin/media?err=used');
    app.media.remove(row.name);
    res.redirect(303, '/admin/media?ok=deleted');
  });

  // errori del corpo JSON (troppo grande, non valido): risposta leggibile da chi carica la foto
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'Immagine troppo pesante: riduci la foto.' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'Richiesta non valida.' });
    next(err);
  });

  return r;
}
