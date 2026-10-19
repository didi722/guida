// Estratto conto: invio per email (il mese scorso, a tutte le agenzie, nei primi giorni del mese; o a una sola, quando lo chiede la guida)
// e scelta dell'agenzia se riceverlo. I conti stanno in statement.js, il PDF in pdf-statement.js.
import { sendStatementEmail } from './emails.js';
import { renderStatementPdf } from './pdf-statement.js';
import { statementOf } from './statement.js';
import { addMonths, nowRome } from './time.js';

const RETRY_MS = 30 * 60_000;
const BATCH = 20; // email per giro (il lavoro periodico passa ogni minuto): così non si bombarda il server di posta
const HOUR = 9; // ora di Venezia

export function createStatementServices(app) {
  const { db, cfg } = app;
  const retryAfter = new Map(); // agenzia → quando riprovare dopo un invio non riuscito
  const record = db.prepare(`INSERT INTO statement_sends(account_id, month, status, sent_at) VALUES(?, ?, ?, ?) ON CONFLICT(account_id, month) DO UPDATE SET status = excluded.status, sent_at = excluded.sent_at`);

  const svc = {
    /** Il mese di cui vanno mandati gli estratti conto adesso (il mese scorso, dal giorno scelto alle 9), oppure null. */
    dueMonth(nowMs = Date.now()) {
      const s = cfg.statements;
      if (!s?.enabled) return null;
      const now = nowRome(nowMs);
      if (Number(now.date.slice(8, 10)) < s.day || Number(now.time.slice(0, 2)) < HOUR) return null;
      return addMonths(`${now.date.slice(0, 7)}-01`, -1).slice(0, 7);
    },

    /** Le agenzie approvate che lo vogliono e a cui il mese non è ancora stato mandato (né saltato). */
    pending(month) {
      return db
        .prepare(`SELECT * FROM accounts a WHERE a.status = 'approved' AND a.statement_email = 1 AND NOT EXISTS (SELECT 1 FROM statement_sends s WHERE s.account_id = a.id AND s.month = ?) ORDER BY a.id`)
        .all(month);
    },

    /** Il PDF dell'estratto conto di un'agenzia, nella sua lingua (o in quella indicata). */
    pdf(account, st, lang) {
      return renderStatementPdf(app, st, { account, lang });
    },

    /**
     * Manda l'estratto conto di un mese a un'agenzia. Se il PDF non si genera l'email parte lo stesso, senza allegato.
     * @returns {Promise<boolean>} false se l'email non è partita
     */
    async send(account, month, nowMs = Date.now()) {
      const st = statementOf(app, account.id, month, nowMs);
      let attachments = [];
      try {
        attachments = [{ filename: `estratto-conto-${month}.pdf`, content: await svc.pdf(account, st), contentType: 'application/pdf' }];
      } catch (err) {
        console.error('[estratto conto] PDF non generato, l’email parte senza allegato:', err.message);
      }
      const ok = (await sendStatementEmail(app, account, st, { attachments })) !== false;
      if (ok) record.run(account.id, month, 'sent', new Date(nowMs).toISOString());
      return ok;
    },

    /** Lavoro periodico: a inizio mese manda il mese scorso a chi ha qualcosa da leggere. @returns {Promise<number>} quante email sono partite */
    async sweep(nowMs = Date.now()) {
      const month = svc.dueMonth(nowMs);
      if (!month) return 0;
      let sent = 0;
      for (const account of svc.pending(month).slice(0, BATCH)) {
        if ((retryAfter.get(account.id) ?? 0) > nowMs) continue;
        if (!statementOf(app, account.id, month, nowMs).hasActivity) {
          record.run(account.id, month, 'skipped', new Date(nowMs).toISOString()); // niente da dire: niente email, e non si ricontrolla ogni minuto
          continue;
        }
        if (await svc.send(account, month, nowMs)) {
          retryAfter.delete(account.id);
          sent++;
        } else retryAfter.set(account.id, nowMs + RETRY_MS);
      }
      return sent;
    },

    /** L'agenzia sceglie se riceverlo ogni mese. */
    setPreference(accountId, on) {
      db.prepare('UPDATE accounts SET statement_email = ? WHERE id = ?').run(on ? 1 : 0, accountId);
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
