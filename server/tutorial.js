// Il giro dell'area agenzie al primo accesso, e la pagina «Guida e FAQ» dove si rivede: chi l'ha visto o saltato non lo rivede da solo.
// Il titolare ha il suo stato nell'account, ogni collaboratore nel suo (ognuno ha il suo primo accesso).
import { tx } from './db.js';

/** I passi del giro (i testi sono `tut.<n>.title` e `tut.<n>.text`). */
export const TUTORIAL_STEPS = [1, 2, 3, 4, 5];

/** Le domande frequenti, per gruppo: [chiave del titolo, numeri delle domande (`faq.<n>.q` e `faq.<n>.a`)]. */
export const FAQ_GROUPS = [
  ['faq.g1', [1, 2, 3]],
  ['faq.g2', [4, 5, 6, 7]],
  ['faq.g3', [8, 9]],
  ['faq.g4', [10, 11, 12]],
  ['faq.g5', [13, 14]],
];

/** Questa persona (il titolare o un collaboratore) deve ancora vedere il giro? */
export function tutorialDue(db, acct, actor = null) {
  if (acct?.status !== 'approved') return false;
  if (actor?.userId) {
    const row = db.prepare('SELECT tutorial_done_at FROM account_users WHERE id = ? AND account_id = ?').get(actor.userId, acct.id);
    return !!row && !row.tutorial_done_at;
  }
  return !acct.tutorial_done_at;
}

/** Il giro è visto (o saltato): non compare più da solo. Si può ripetere quando si vuole dalla pagina «Guida e FAQ». */
export function markTutorialDone(db, acct, actor = null, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  tx(db, () => {
    if (actor?.userId) db.prepare('UPDATE account_users SET tutorial_done_at = COALESCE(tutorial_done_at, ?) WHERE id = ? AND account_id = ?').run(now, actor.userId, acct.id);
    else db.prepare('UPDATE accounts SET tutorial_done_at = COALESCE(tutorial_done_at, ?) WHERE id = ?').run(now, acct.id);
  });
}
