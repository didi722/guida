// Pannello › Agenda › Lista d'attesa: le agenzie che aspettano una data occupata, e chi la tiene. La guida può cambiare l'ordine di chi aspetta
// lo stesso servizio nello stesso giorno (trascinando le righe): di partenza vale l'ordine di arrivo.
import express from 'express';
import { send } from '../http.js';
import { isDate, nowRome } from '../time.js';
import { advantageEnd, allActive, blockersOf, exclusiveNow, notifiedCount, queueOf, recoveredCount, reorderQueue, resetQueue } from '../waitlist.js';
import { waitlistAdminPage } from '../views/admin-waitlist.js';

export function adminWaitlistRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '2kb' });

  /** Il gruppo («servizio|giorno») come arriva dalla pagina: solo un servizio che esiste e una data vera. */
  const groupOf = (raw) => {
    const [tour, date] = String(raw ?? '').split('|');
    return app.content.tour(tour) && isDate(date) ? { tour, date } : null;
  };

  r.get('/waitlist', (req, res) => {
    const nowMs = Date.now();
    const rows = allActive(db, nowRome(nowMs).date).map((e) => {
      const exclusive = exclusiveNow(app.cfg, e, nowMs);
      const { ahead, behind } = exclusive ? queueOf(db, app.cfg, e, nowMs) : { ahead: [], behind: [] };
      const until = exclusive && e.status === 'notified' && behind.length && Date.parse(e.notified_at) + app.cfg.waitlist.priorityHours * 3_600_000 > nowMs ? advantageEnd(app.cfg, e) : null;
      return { ...e, blockers: blockersOf(db, e, nowMs), queue: { exclusive, ahead: ahead.map((x) => x.acct_company), behind: behind.length, until } };
    });
    // un gruppo per servizio e giorno, in ordine di data; dentro, prima chi è già stato avvisato, poi chi aspetta nell'ordine della coda
    const groups = [];
    for (const e of rows) {
      const key = `${e.tour_slug}|${e.date}`;
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, tour: e.tour_slug, date: e.date, notified: [], waiting: [], manual: false }));
      (e.status === 'notified' ? g.notified : g.waiting).push(e);
      if (e.position != null) g.manual = true;
    }
    const since = new Date(nowMs - 90 * 86_400_000).toISOString();
    send(res, waitlistAdminPage({ app, req }, { groups, rows, notified: notifiedCount(db, since), recovered: recoveredCount(db, since), flash: req.query.ok === 'reset' ? 'Ordine di arrivo ripristinato.' : '' }));
  });

  // la nuova sequenza di un gruppo (la manda lo script quando si trascina o si usano le frecce)
  r.post('/waitlist/order', express.json({ limit: '4kb' }), (req, res) => {
    const g = groupOf(req.body?.group);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
    if (!g || !ids || !ids.every(Number.isInteger)) return res.status(400).json({ ok: false, error: 'invalid' });
    if (!reorderQueue(db, g.tour, g.date, ids)) return res.status(409).json({ ok: false, error: 'changed' }); // la lista è cambiata nel frattempo: si ricarica la pagina
    app.todoCache = null;
    res.json({ ok: true });
  });

  // riporta un gruppo all'ordine di arrivo
  r.post('/waitlist/reset', form, (req, res, next) => {
    const g = groupOf(req.body?.group);
    if (!g) return next();
    resetQueue(db, g.tour, g.date);
    res.redirect(303, '/admin/waitlist?ok=reset');
  });

  return r;
}
