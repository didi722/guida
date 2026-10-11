// Richiesta di recensione dopo il tour e feedback privato.
//
// La richiesta parte una sola volta, il giorno dopo il servizio, solo per i clienti privati con
// prenotazione confermata. Il link alla recensione pubblica è mostrato a TUTTI allo stesso modo:
// le regole di Google vietano di sollecitare solo i clienti soddisfatti ("review gating").
import { sendReviewRequest } from './emails.js';
import { addDays, localToInstant, nowRome } from './time.js';
import { cleanText } from './util.js';

const RETRY_MS = 30 * 60_000;

/** Istante in cui parte la richiesta: giorno dopo il servizio, alle `sendHour` (ora di Venezia). */
export function reviewDueAt(cfg, booking) {
  return localToInstant(addDays(booking.date, 1), `${String(cfg.reviews.sendHour).padStart(2, '0')}:00`);
}

export function getFeedback(db, bookingId) {
  return db.prepare('SELECT * FROM feedback WHERE booking_id = ?').get(bookingId);
}

/** Salva (o aggiorna) il feedback di un cliente. @returns {{ok: boolean, reason?: string}} */
export function saveFeedback(db, booking, { rating, comment, mayPublish }, nowMs = Date.now()) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return { ok: false, reason: 'rating' };
  if (booking.status !== 'confirmed' || booking.channel !== 'b2c') return { ok: false, reason: 'booking' };
  if (booking.date > nowRome(nowMs).date) return { ok: false, reason: 'early' }; // il tour non c'è ancora stato
  db.prepare(
    `INSERT INTO feedback(booking_id, rating, comment, may_publish, created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(booking_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, may_publish = excluded.may_publish`,
  ).run(booking.id, r, cleanText(comment, 1500) || null, mayPublish ? 1 : 0, new Date(nowMs).toISOString());
  return { ok: true };
}

export function feedbackStats(db) {
  const row = db.prepare('SELECT COUNT(*) n, AVG(rating) avg FROM feedback').get();
  return { count: row.n, average: row.n ? Math.round(row.avg * 10) / 10 : null };
}

export function createReviewServices(app) {
  const { db, cfg } = app;

  const svc = {
    /** Prenotazioni a cui va inviata ora la richiesta. */
    due(nowMs = Date.now()) {
      const today = nowRome(nowMs).date;
      return db
        .prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND channel = 'b2c' AND review_status IS NULL AND date < ? ORDER BY date, start_time`)
        .all(today)
        .filter((b) => reviewDueAt(cfg, b) <= nowMs);
    },

    /** Invia la richiesta a una prenotazione (una sola volta). @returns {Promise<boolean>} */
    async send(booking, nowMs = Date.now()) {
      const claimed = db.prepare(`UPDATE bookings SET review_status = 'sent', review_sent_at = ?, review_attempt_at = ? WHERE id = ? AND review_status IS NULL`).run(new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), booking.id).changes;
      if (claimed !== 1) return false;
      const ok = await sendReviewRequest(app, db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id));
      if (!ok) db.prepare(`UPDATE bookings SET review_status = NULL, review_sent_at = NULL WHERE id = ?`).run(booking.id); // riprova più tardi
      return ok;
    },

    skip(bookingId) {
      return db.prepare(`UPDATE bookings SET review_status = 'skipped' WHERE id = ? AND review_status IS NULL`).run(bookingId).changes === 1;
    },

    /** Lavoro periodico: invia le richieste dovute, scarta quelle troppo vecchie. */
    async sweep(nowMs = Date.now()) {
      if (!cfg.reviews.enabled) return 0;
      let sent = 0;
      for (const b of svc.due(nowMs)) {
        if (nowMs - reviewDueAt(cfg, b) > cfg.reviews.catchUpDays * 86400_000) {
          svc.skip(b.id);
          continue;
        }
        if (b.review_attempt_at && nowMs - Date.parse(b.review_attempt_at) < RETRY_MS) continue;
        if (await svc.send(b, nowMs)) sent++;
      }
      return sent;
    },
  };
  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
