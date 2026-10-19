// Lista d'attesa delle agenzie: collega regole, database ed email, e ogni minuto controlla se qualche data si è liberata.
import { loadAvailabilityContext, slotsForDay } from './availability.js';
import { notifyGuideWaitlist, sendWaitlistFree } from './emails.js';
import { openTo } from './rates.js';
import { nowRome } from './time.js';
import { advantageRunning, blockersOf, exclusiveNow, expireEntries, joinWaitlist, queuedBefore, rearmEntry, removeEntry, rivalsOf, settleBooked, waitingEntries } from './waitlist.js';

const RETRY_MS = 15 * 60_000;
const HOUR = 3_600_000;

export function createWaitlistServices(app) {
  const { db, cfg, content } = app;
  const retryAfter = new Map(); // avviso → quando riprovare se l'email non è partita

  const svc = {
    /** L'agenzia chiede di essere avvisata: se la data si libera riceve un'email. La guida sa che qualcuno aspetta (e chi tiene la data). */
    async join(account, input, nowMs = Date.now()) {
      const entry = joinWaitlist(app, account, input, nowMs);
      try {
        await notifyGuideWaitlist(app, entry, account, blockersOf(db, entry, nowMs));
      } catch (err) {
        console.error('[lista d’attesa] avviso alla guida non inviato:', err.message); // l'avviso dell'agenzia resta valido
      }
      return entry;
    },

    remove: (account, id) => removeEntry(db, account.id, id),
    rearm: (account, id, nowMs = Date.now()) => rearmEntry(db, account.id, id, nowRome(nowMs).date, nowMs),

    /**
     * Ogni minuto: chiude gli avvisi con la data passata o già prenotata dall'agenzia, e manda l'email a chi aspetta una data tornata libera.
     * Gli avvisi partono nell'ordine di iscrizione: l'agenzia arrivata prima ha qualche ora di vantaggio (Impostazioni › Lista d'attesa delle agenzie),
     * poi tocca alla successiva; se il posto basta per più agenzie, o il servizio è vicino, partono insieme. Nessuno tiene la data da parte: la prende chi prenota per primo.
     * @returns {Promise<number>} quante email sono partite
     */
    async sweep(nowMs = Date.now()) {
      const today = nowRome(nowMs).date;
      expireEntries(db, today);
      settleBooked(db, nowMs);
      const rates = app.rates.get();
      const byDate = new Map();
      for (const e of waitingEntries(db, today)) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
      let sent = 0;
      for (const [date, rows] of byDate) {
        const ctx = loadAvailabilityContext(db, cfg, date, date, nowMs);
        /** Il posto basta anche per le agenzie indicate? Solo per i servizi a posti: un servizio privato lo prende una sola agenzia. */
        const fitsWith = (tour, e, others) =>
          tour.model === 'person' &&
          slotsForDay(ctx, cfg, tour, date, { pax: e.pax + others.reduce((n, o) => n + o.pax, 0), channel: 'b2b', nowMs, tourLang: e.tour_lang, durationMin: e.hours != null ? Math.round(e.hours * 60) : null }).some((s) => !e.time || s.time === e.time);
        for (const e of rows) {
          if (retryAfter.get(e.id) > nowMs) continue;
          const tour = content.tour(e.tour_slug);
          if (!tour?.active || !openTo(rates, tour, 'b2b')) continue;
          const slots = slotsForDay(ctx, cfg, tour, date, { pax: e.pax, channel: 'b2b', nowMs, tourLang: e.tour_lang, durationMin: e.hours != null ? Math.round(e.hours * 60) : null }).filter((s) => !e.time || s.time === e.time);
          if (!slots.length) continue;
          // l'ordine di iscrizione: se un'agenzia arrivata prima ha il vantaggio in corso e il posto non basta per tutte e due, si aspetta il proprio turno
          const exclusive = exclusiveNow(cfg, e, nowMs);
          const holders = exclusive ? rivalsOf(db, e).filter((r) => queuedBefore(r, e) && advantageRunning(cfg, r, nowMs)) : [];
          if (holders.length && !fitsWith(tour, e, holders)) continue;
          // l'avviso si «prenota» prima di scrivere: due giri insieme non mandano due email
          const claimed = db.prepare(`UPDATE waitlist SET status = 'notified', notified_at = ?, notified_time = ? WHERE id = ? AND status = 'waiting'`).run(new Date(nowMs).toISOString(), slots[0].time, e.id).changes;
          if (claimed !== 1) continue;
          // se qualcuna aspetta il suo turno dietro a questa, l'email dice che ha un vantaggio e fino a quando
          const queued = exclusive ? rivalsOf(db, e).filter((r) => queuedBefore(e, r) && r.status === 'waiting' && !fitsWith(tour, r, [...holders, e])) : [];
          let ok = false;
          try {
            ok = (await sendWaitlistFree(app, e, slots, { advantageUntilMs: queued.length ? nowMs + cfg.waitlist.priorityHours * HOUR : null })) !== false;
          } catch (err) {
            console.error('[lista d’attesa] invio non riuscito:', err.message);
          }
          if (ok) {
            retryAfter.delete(e.id);
            sent++;
          } else {
            db.prepare(`UPDATE waitlist SET status = 'waiting', notified_at = NULL, notified_time = NULL WHERE id = ?`).run(e.id); // riprova fra un po'
            retryAfter.set(e.id, nowMs + RETRY_MS);
          }
        }
      }
      return sent;
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
