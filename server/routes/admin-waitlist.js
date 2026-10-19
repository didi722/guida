// Pannello › Agenda › Lista d'attesa: le agenzie che aspettano una data occupata, e chi la tiene.
import express from 'express';
import { send } from '../http.js';
import { nowRome } from '../time.js';
import { advantageEnd, allActive, blockersOf, exclusiveNow, notifiedCount, queueOf, recoveredCount } from '../waitlist.js';
import { waitlistAdminPage } from '../views/admin-waitlist.js';

export function adminWaitlistRouter(app) {
  const r = express.Router();
  const { db } = app;
  r.get('/waitlist', (req, res) => {
    const nowMs = Date.now();
    const rows = allActive(db, nowRome(nowMs).date).map((e) => {
      const exclusive = exclusiveNow(app.cfg, e, nowMs);
      const { ahead, behind } = exclusive ? queueOf(db, app.cfg, e, nowMs) : { ahead: [], behind: [] };
      const until = exclusive && e.status === 'notified' && behind.length && Date.parse(e.notified_at) + app.cfg.waitlist.priorityHours * 3_600_000 > nowMs ? advantageEnd(app.cfg, e) : null;
      return { ...e, blockers: blockersOf(db, e, nowMs), queue: { exclusive, ahead: ahead.map((r) => r.acct_company), behind: behind.length, until } };
    });
    const since = new Date(nowMs - 90 * 86_400_000).toISOString();
    send(res, waitlistAdminPage({ app, req }, { rows, notified: notifiedCount(db, since), recovered: recoveredCount(db, since) }));
  });
  return r;
}
