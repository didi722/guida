// Copia di sicurezza scaricabile dal pannello e ripristino da una copia.
import express from 'express';
import { backupEntries, backupFileName, lastBackup, markBackup, mediaStats, writeZip } from '../backup.js';
import { send } from '../http.js';
import { MODES, RESTORE_WORD, RestoreError } from '../restore.js';
import { backupPage, restorePreviewPage } from '../views/admin-backup.js';

const FLASH = {
  restored: 'Ripristino completato. Il sito è già aggiornato. Se non è come lo volevi, qui sotto trovi la copia di sicurezza automatica per tornare indietro.',
  cancelled: 'Fatto: non ho cambiato nulla.',
};
const ERR = {
  expired: 'Il file caricato non c’è più (dopo un’ora si cancella): caricalo di nuovo.',
  snapshot: 'Copia di sicurezza non trovata.',
  busy: 'C’è già un’operazione in corso: riprova tra un minuto.',
  failed: 'Non sono riuscito a preparare il ripristino. Non ho cambiato nulla.',
};

export function adminBackupRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '1kb' });
  const ctxOf = (req) => ({ app, req });

  const showBackup = (req, res, { flash = '', error = '', status = 200 } = {}) => {
    const dbBytes = Number(app.db.prepare('PRAGMA page_count').get().page_count) * Number(app.db.prepare('PRAGMA page_size').get().page_size);
    send(res, backupPage(ctxOf(req), { last: lastBackup(app.db), media: mediaStats(app.cfg), dbBytes, snapshots: app.restore.snapshots(), lastRestore: app.restore.lastRestore(), flash, error }), status);
  };

  r.get('/backup', (req, res) => showBackup(req, res, { flash: FLASH[String(req.query.ok ?? '')] ?? '', error: ERR[String(req.query.err ?? '')] ?? '' }));

  /** Manda lo zip al browser. Un errore a metà strada interrompe la connessione (così il file incompleto non sembra buono). */
  async function sendZip(res, next, entries, fileName, nowMs, done = () => {}) {
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' });
    try {
      await writeZip(res, entries, new Date(nowMs));
      done();
      res.end();
    } catch (err) {
      console.error('[backup] errore:', err);
      if (res.headersSent) res.destroy(err);
      else next(err);
    }
  }

  r.post('/backup/download', form, (req, res, next) => {
    const nowMs = Date.now();
    return sendZip(res, next, backupEntries(app, nowMs), backupFileName(nowMs), nowMs, () => markBackup(app.db, nowMs));
  });

  // ── ripristino ──
  // Lo zip arriva come corpo grezzo della richiesta (il browser lo manda con XMLHttpRequest): non si tiene in memoria.
  r.post('/backup/restore/upload', async (req, res) => {
    try {
      const { token } = await app.restore.stageUpload(req);
      res.json({ ok: true, url: `/admin/backup/restore/${token}` });
    } catch (err) {
      if (!(err instanceof RestoreError)) {
        console.error('[ripristino] errore:', err);
        return res.status(500).json({ ok: false, error: 'Errore imprevisto nel controllare il file. Non ho cambiato nulla.' });
      }
      if (err.status === 413) res.set('Connection', 'close');
      res.status(err.status).json({ ok: false, error: err.message });
    }
  });

  const preview = (req, res, error = '', status = 200) => {
    let data;
    try {
      data = app.restore.preview(req.params.token);
    } catch (err) {
      // il file messo da parte non si legge più (disco, altro processo): si butta via e si riparte
      console.error('[ripristino] anteprima non riuscita:', err);
      app.restore.discard(req.params.token);
      return showBackup(req, res, { error: error || 'Il file caricato non si legge più: caricalo di nuovo. Non ho cambiato nulla.', status: 500 });
    }
    if (!data) return res.redirect(303, '/admin/backup?err=expired');
    return send(res, restorePreviewPage(ctxOf(req), { token: req.params.token, data, error }), status);
  };

  r.get('/backup/restore/:token', (req, res) => preview(req, res));

  r.post('/backup/restore/:token', form, (req, res) => {
    const mode = String(req.body.mode ?? '');
    if (!MODES[mode]) return preview(req, res, 'Scegli cosa ripristinare: solo i contenuti, oppure tutto.', 400);
    if (String(req.body.confirm ?? '').trim().toUpperCase() !== RESTORE_WORD) return preview(req, res, `Per confermare scrivi ${RESTORE_WORD} nella casella. Non ho cambiato nulla.`, 400);
    try {
      app.restore.apply(req.params.token, mode);
    } catch (err) {
      if (!(err instanceof RestoreError)) throw err;
      if (err.status === 404) return res.redirect(303, '/admin/backup?err=expired');
      return preview(req, res, err.message, err.status);
    }
    res.redirect(303, '/admin/backup?ok=restored');
  });

  r.post('/backup/restore/:token/cancel', form, (req, res) => {
    app.restore.discard(req.params.token);
    res.redirect(303, '/admin/backup?ok=cancelled');
  });

  // ── copie di sicurezza automatiche (fatte prima di ogni ripristino) ──
  r.post('/backup/snapshots/:id/download', form, (req, res, next) => {
    const snapshot = app.restore.snapshotInfo(req.params.id);
    if (!snapshot) return res.redirect(303, '/admin/backup?err=snapshot');
    const takenMs = Date.parse(snapshot.at) || Date.now();
    return sendZip(res, next, backupEntries(app, takenMs, snapshot), backupFileName(takenMs, 'guida-prima-del-ripristino'), takenMs);
  });

  r.post('/backup/snapshots/:id/stage', form, async (req, res) => {
    try {
      const { token } = await app.restore.stageSnapshot(req.params.id);
      res.redirect(303, `/admin/backup/restore/${token}`);
    } catch (err) {
      if (!(err instanceof RestoreError)) throw err;
      res.redirect(303, `/admin/backup?err=${{ 404: 'snapshot', 409: 'busy' }[err.status] ?? 'failed'}`);
    }
  });

  return r;
}
