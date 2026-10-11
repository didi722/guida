// Assembla i moduli dell'applicazione (usato dal server e dai test, così non si disallineano).
import { createGiftServices } from './giftServices.js';
import { createLimits } from './http.js';
import { createMailer } from './mail.js';
import { createPayables } from './payables.js';
import { createPayments } from './payments.js';
import { createServices } from './services.js';

export function createContext({ cfg, db, content, mail, payments, assetVersion = '0' }) {
  const app = { cfg, db, content, assetVersion, jobs: [], limits: createLimits() };
  /** Lavori periodici (ogni minuto): ogni modulo aggiunge i suoi a `app.jobs`. */
  app.runJobs = async (nowMs = Date.now()) => {
    for (const job of app.jobs) {
      try {
        await job(nowMs);
      } catch (err) {
        console.error('[job] errore:', err);
      }
    }
  };
  app.mail = mail ?? createMailer(cfg);
  app.payments = payments ?? createPayments(cfg);
  app.payables = createPayables(app);
  app.services = createServices(app);
  app.gifts = createGiftServices(app);
  return app;
}
