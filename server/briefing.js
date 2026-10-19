// Scheda del giorno dopo, per la guida: la sera (all'ora scelta nelle impostazioni) arriva un'email con i servizi di domani
// e il PDF da stampare o tenere sul telefono. Parte una sola volta per giorno, e solo se domani c'è almeno un servizio.
import { getSetting, setSetting } from './db.js';
import { sendDayBriefing } from './emails.js';
import { daySheet } from './daySheet.js';
import { renderDaySheetPdf } from './pdf-day.js';
import { addDays, nowRome } from './time.js';

const LAST_KEY = 'briefing.last'; // l'ultimo giorno di cui è stata mandata (o saltata) la scheda
const RETRY_MS = 30 * 60_000;

export function createBriefingServices(app) {
  const { db, cfg } = app;
  let failedAt = 0;

  const svc = {
    /** Il giorno di cui va mandata la scheda adesso (domani), oppure null. */
    due(nowMs = Date.now()) {
      const b = cfg.reminders.briefing;
      if (!b?.enabled || !cfg.mail.notifyTo) return null;
      const now = nowRome(nowMs);
      if (Number(now.time.slice(0, 2)) < b.hour) return null;
      const date = addDays(now.date, 1);
      return getSetting(db, LAST_KEY, null) === date ? null : date;
    },

    /** Prepara la scheda del giorno e la manda alla guida. @returns {Promise<boolean>} false se non c'è nulla da mandare o l'email non è partita */
    async send(date, nowMs = Date.now()) {
      const sheet = daySheet(app, date, nowMs);
      if (!sheet.services.length) return false;
      let attachments = [];
      try {
        attachments = [{ filename: `scheda-${date}.pdf`, content: await renderDaySheetPdf(app, sheet), contentType: 'application/pdf' }];
      } catch (err) {
        console.error('[scheda del giorno] PDF non generato, l’email parte senza allegato:', err.message);
      }
      return (await sendDayBriefing(app, sheet, { attachments })) !== false;
    },

    /** Lavoro periodico: la sera prima manda la scheda di domani (una volta sola). @returns {Promise<boolean>} */
    async sweep(nowMs = Date.now()) {
      const date = svc.due(nowMs);
      if (!date) return false;
      if (failedAt && nowMs - failedAt < RETRY_MS) return false;
      if (!daySheet(app, date, nowMs).services.length) {
        setSetting(db, LAST_KEY, date); // niente servizi domani: niente email, e non si ricontrolla ogni minuto
        return false;
      }
      if (await svc.send(date, nowMs)) {
        setSetting(db, LAST_KEY, date);
        failedAt = 0;
        return true;
      }
      failedAt = nowMs; // riprova fra mezz'ora
      return false;
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
