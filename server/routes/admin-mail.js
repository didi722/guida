// Registro delle email inviate dal sito (dall'ultimo riavvio, al massimo 200).
// Senza SMTP le email non partono: qui si vedono quelle che il sito avrebbe spedito, utile per le prove.
import express from 'express';
import { send } from '../http.js';
import { adminMailPage } from '../views/admin-mail.js';

export function adminMailRouter(app) {
  const r = express.Router();

  r.get('/mail', (req, res) => send(res, adminMailPage({ app, req }, { messages: [...app.mail.sent].reverse().slice(0, 100), live: app.mail.live })));

  r.get('/mail/:id/attachment/:n', (req, res, next) => {
    const a = app.mail.sent.find((m) => m.id === Number(req.params.id))?.attachments?.[Number(req.params.n)];
    if (!a) return next();
    const body = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content ?? ''));
    res.status(200).set({
      'Content-Type': a.contentType ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${String(a.filename ?? 'allegato').replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    }).send(body);
  });

  return r;
}
