// Copia di sicurezza scaricabile dal pannello.
import express from 'express';
import { backupEntries, backupFileName, lastBackup, markBackup, mediaStats, writeZip } from '../backup.js';
import { send } from '../http.js';
import { backupPage } from '../views/admin-backup.js';

export function adminBackupRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '1kb' });

  r.get('/backup', (req, res) => {
    const dbBytes = Number(app.db.prepare('PRAGMA page_count').get().page_count) * Number(app.db.prepare('PRAGMA page_size').get().page_size);
    send(res, backupPage({ app, req }, { last: lastBackup(app.db), media: mediaStats(app.cfg), dbBytes }));
  });

  r.post('/backup/download', form, async (req, res, next) => {
    const nowMs = Date.now();
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${backupFileName(nowMs)}"`, 'Cache-Control': 'no-store' });
    try {
      await writeZip(res, backupEntries(app, nowMs), new Date(nowMs));
      markBackup(app.db, nowMs);
      res.end();
    } catch (err) {
      console.error('[backup] errore:', err);
      if (res.headersSent) res.destroy(err);
      else next(err);
    }
  });

  return r;
}
