// Assembla i moduli dell'applicazione (usato dal server e dai test, così non si disallineano).
import { createCalendars } from './calendars.js';
import { createChangeServices } from './changeServices.js';
import { createGiftServices } from './giftServices.js';
import { createLimits } from './http.js';
import { createInvoiceServices } from './invoiceServices.js';
import path from 'node:path';
import { createMailer } from './mail.js';
import { createMedia } from './media.js';
import { createPackageServices } from './packageServices.js';
import { createPecMailer } from './pec.js';
import { createSettings } from './settings.js';
import { createSiteImages } from './siteImages.js';
import { createProgramServices } from './programs.js';
import { createReminderServices } from './reminders.js';
import { createRestoreServices } from './restore.js';
import { createRates } from './rates.js';
import { createReviewServices } from './reviews.js';
import { createPayables } from './payables.js';
import { createPayments } from './payments.js';
import { createServices } from './services.js';
import { createTranslator } from './translate.js';

export function createContext({ cfg, db, content, mail, payments, pec, fetchImpl, assetVersion = '0' }) {
  const app = { cfg, db, content, assetVersion, jobs: [], limits: createLimits() };
  app.settings = createSettings({ cfg, db }); // prima di ogni altro modulo: applica alla configurazione i valori scelti dal pannello
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
  app.media = createMedia({ db, dir: path.join(cfg.dataDir, 'media') });
  app.siteImages = createSiteImages({ db, media: app.media });
  app.mail = mail ?? createMailer(cfg);
  app.payments = payments ?? createPayments(cfg);
  app.payables = createPayables(app);
  app.services = createServices(app);
  app.packages = createPackageServices(app);
  app.changes = createChangeServices(app);
  app.gifts = createGiftServices(app);
  app.reviews = createReviewServices(app);
  app.translate = createTranslator(app, fetchImpl);
  app.reminders = createReminderServices(app);
  app.calendars = createCalendars(app, fetchImpl);
  app.programs = createProgramServices(app);
  app.pec = pec ?? createPecMailer(cfg);
  app.invoices = createInvoiceServices(app);
  app.rates = createRates(app);
  app.restore = createRestoreServices(app);
  return app;
}
