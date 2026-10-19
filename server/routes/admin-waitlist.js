// Pannello › Agenda › Lista d'attesa: le agenzie che aspettano una data occupata, e chi la tiene.
import express from 'express';
import { send } from '../http.js';
import { nowRome } from '../time.js';
import { allActive, blockersOf, notifiedCount, recoveredCount } from '../waitlist.js';
import { waitlistAdminPage } from '../views/admin-waitlist.js';

export function adminWaitlistRouter(app) {
  const r = express.Router();
  const { db } = app;
  r.get('/waitlist', (req, res) => {
    const nowMs = Date.now();
    const rows = allActive(db, nowRome(nowMs).date).map((e) => ({ ...e, blockers: blockersOf(db, e, nowMs) }));
    const since = new Date(nowMs - 90 * 86_400_000).toISOString();
    send(res, waitlistAdminPage({ app, req }, { rows, notified: notifiedCount(db, since), recovered: recoveredCount(db, since) }));
  });
  return r;
}
