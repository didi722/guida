// Promemoria la sera prima del tour: orario, punto d'incontro e come contattarti.
//
// Parte una sola volta, solo per i clienti privati con prenotazione confermata. Se la prenotazione è stata fatta meno
// di 24 ore prima dell'inizio non serve (la conferma è appena arrivata) e non si manda nulla.
import { sendReminder } from './emails.js';
import { addDays, localToInstant, nowRome } from './time.js';

const RETRY_MS = 30 * 60_000;

/** Istante in cui parte il promemoria: il giorno prima del servizio, alle `sendHour` (ora di Venezia). */
export function reminderDueAt(cfg, booking) {
  return localToInstant(addDays(booking.date, -1), `${String(cfg.reminders.sendHour).padStart(2, '0')}:00`);
}

/** Serve solo se la prenotazione esisteva già da almeno 24 ore prima dell'inizio. */
export const needsReminder = (booking) => Date.parse(booking.created_at) <= localToInstant(booking.date, booking.start_time) - 24 * 3600_000;

export function createReminderServices(app) {
  const { db, cfg } = app;

  const svc = {
    /** Prenotazioni di domani a cui va inviato ora il promemoria. */
    due(nowMs = Date.now()) {
      const tomorrow = addDays(nowRome(nowMs).date, 1);
      return db
        .prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND channel = 'b2c' AND reminder_status IS NULL AND date = ? ORDER BY start_time`)
        .all(tomorrow)
        .filter((b) => reminderDueAt(cfg, b) <= nowMs);
    },

    /** Invia il promemoria a una prenotazione (una sola volta). @returns {Promise<boolean>} */
    async send(booking, nowMs = Date.now()) {
      const iso = new Date(nowMs).toISOString();
      const claimed = db.prepare(`UPDATE bookings SET reminder_status = 'sent', reminder_sent_at = ?, reminder_attempt_at = ? WHERE id = ? AND reminder_status IS NULL`).run(iso, iso, booking.id).changes;
      if (claimed !== 1) return false;
      const ok = await sendReminder(app, db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id));
      if (!ok) db.prepare(`UPDATE bookings SET reminder_status = NULL, reminder_sent_at = NULL WHERE id = ?`).run(booking.id); // riprova più tardi
      return ok;
    },

    skip(bookingId) {
      return db.prepare(`UPDATE bookings SET reminder_status = 'skipped' WHERE id = ? AND reminder_status IS NULL`).run(bookingId).changes === 1;
    },

    /** Lavoro periodico: invia i promemoria dovuti. */
    async sweep(nowMs = Date.now()) {
      if (!cfg.reminders.enabled) return 0;
      let sent = 0;
      for (const b of svc.due(nowMs)) {
        if (!needsReminder(b)) {
          svc.skip(b.id);
          continue;
        }
        if (b.reminder_attempt_at && nowMs - Date.parse(b.reminder_attempt_at) < RETRY_MS) continue;
        if (await svc.send(b, nowMs)) sent++;
      }
      return sent;
    },
  };
  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
