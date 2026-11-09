// Approvare un'agenzia: a mano dal pannello (admin-partners), con un clic dal collegamento dell'email che la guida riceve a ogni richiesta,
// oppure da sola quando la partita IVA risulta valida su VIES (se la guida l'ha lasciato acceso in Impostazioni › Nuove agenzie).
// Chi entra da solo o con il clic parte con la carta e senza sconto: pagamento a fattura e sconto li decide la guida.
import { signToken, verifyToken } from './auth.js';
import { notifyGuideAutoApproved, sendPartnerApproved } from './emails.js';

const LINK_DAYS = 30;
const MAX_DISCOUNT = 60; // come nel pannello

/** Il collegamento «Approva con un clic» per l'email alla guida: firmato, vale 30 giorni e solo per questa agenzia. */
export const approveLink = (app, account) => `${app.cfg.baseUrl}/it/b2b/approve/${signToken(app.cfg.sessionSecret, { k: 'approve', id: account.id, exp: Date.now() + LINK_DAYS * 86_400_000 })}`;

/** L'agenzia a cui punta un collegamento di approvazione (null se non è valido, è scaduto o l'agenzia non c'è più). */
export function readApproveToken(app, token) {
  const p = verifyToken(app.cfg.sessionSecret, token);
  return p?.k === 'approve' ? (app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(p.id)) ?? null) : null;
}

export function createApprovals(app) {
  const { db } = app;
  const get = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  const svc = {
    /**
     * Approva un'agenzia ancora in attesa e le scrive. Senza altre indicazioni: pagamento con carta, nessuno sconto.
     * @returns {Promise<boolean>} false se non era più in attesa (già approvata, rifiutata, sospesa)
     */
    async approve(accountId, { invoice = false, discount = 0, nowMs = Date.now() } = {}) {
      const percent = Math.min(MAX_DISCOUNT, Math.max(0, Number(String(discount ?? '').replace(',', '.')) || 0));
      const changed = db.prepare("UPDATE accounts SET status = 'approved', approved_at = ?, allow_invoice = ?, discount_percent = ? WHERE id = ? AND status = 'pending'").run(new Date(nowMs).toISOString(), invoice ? 1 : 0, percent, accountId).changes;
      if (!changed) return false;
      await sendPartnerApproved(app, get(accountId));
      return true;
    },

    /**
     * Approva da sola un'agenzia in attesa la cui partita IVA risulta valida su VIES, a meno che il nome scritto sia diverso da quello del registro
     * (lo guarda la guida). Un'agenzia già approvata e poi rimessa in attesa non rientra da sola.
     * @returns {Promise<boolean>}
     */
    async autoApprove(accountId, nowMs = Date.now()) {
      const a = get(accountId);
      if (!a || a.status !== 'pending' || a.approved_at || a.vat_status !== 'valid' || app.vat.summary(a).sameName === false) return false;
      if (!(await svc.approve(accountId, { nowMs }))) return false;
      await notifyGuideAutoApproved(app, get(accountId));
      return true;
    },

    /** Lavoro periodico (ogni minuto, dopo il controllo su VIES): le agenzie in attesa con la partita IVA valida. @returns {Promise<number>} quante ne ha approvate */
    async sweep(nowMs = Date.now()) {
      if (!app.cfg.partners?.autoApprove) return 0;
      let n = 0;
      for (const r of db.prepare("SELECT id FROM accounts WHERE status = 'pending' AND approved_at IS NULL AND vat_status = 'valid' ORDER BY id LIMIT 5").all()) if (await svc.autoApprove(r.id, nowMs)) n++;
      return n;
    },
  };
  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
