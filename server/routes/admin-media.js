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
  const FLASH = { deleted: 'Immagine eliminata.', slot: 'Fatto: la modifica è già visibile sul sito.' };
  const ERR = { used: 'L’immagine è in uso (tour, articolo o pagina del sito): toglila da lì prima di eliminarla.', missing: 'Immagine non trovata.', slot: 'Posizione non valida.' };
  const usedNames = () => new Set([...(app.content.usedImages?.() ?? []), ...app.siteImages.used()]);

  r.get('/media', (req, res) => {
    send(res, mediaPage(ctxOf(req), { items: app.media.list(), used: usedNames(), slots: app.siteImages.slots.map((sl) => ({ ...sl, name: app.siteImages.get(sl.key) })), flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '' }));
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

  // sceglie (o toglie) la foto di una pagina del sito: home, chi sono, agenzie, buono regalo, anteprima social
  r.post('/media/slots', form, (req, res) => {
    try {
      app.siteImages.set(String(req.body.slot ?? ''), req.body.clear ? null : String(req.body.name ?? ''));
    } catch (err) {
      if (!(err instanceof MediaError)) throw err;
      return res.redirect(303, `/admin/media?err=${/Posizione/.test(err.message) ? 'slot' : 'missing'}`);
    }
    res.redirect(303, '/admin/media?ok=slot');
  });

  r.post('/media/:id/delete', form, (req, res) => {
    const row = app.db.prepare('SELECT * FROM media WHERE id = ?').get(Number(req.params.id));
    if (!row) return res.redirect(303, '/admin/media?err=missing');
    if (usedNames().has(row.name)) return res.redirect(303, '/admin/media?err=used');
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
