// Assembla i moduli dell'applicazione (usato dal server e dai test, così non si disallineano).
import { createAdminSecurity } from './adminSecurity.js';
import { createAutoBackup } from './autoBackup.js';
import { createBriefingServices } from './briefing.js';
import { createCalendars } from './calendars.js';
import { createChangeServices } from './changeServices.js';
import { createGiftServices } from './giftServices.js';
import { createLimits } from './http.js';
import { createInvoiceServices } from './invoiceServices.js';
import path from 'node:path';
import { createMailer } from './mail.js';
import { createMedia } from './media.js';
import { createPackageServices } from './packageServices.js';
import { createPeriods } from './periods.js';
import { createPecMailer } from './pec.js';
import { createSettings } from './settings.js';
import { createSiteImages } from './siteImages.js';
import { createStatementServices } from './statementServices.js';
import { createProgramServices } from './programs.js';
import { createReminderServices } from './reminders.js';
import { createRestoreServices } from './restore.js';
import { createRates } from './rates.js';
import { createReviewServices } from './reviews.js';
import { createPayables } from './payables.js';
import { createPayments } from './payments.js';
import { createServices } from './services.js';
import { createTranslator } from './translate.js';
import { createVat } from './vat.js';
import { createWaitlistServices } from './waitlistServices.js';

export function createContext({ cfg, db, content, mail, payments, pec, fetchImpl, assetVersion = '0' }) {
  const app = { cfg, db, content, assetVersion, jobs: [], limits: createLimits() };
  app.settings = createSettings({ cfg, db }); // prima di ogni altro modulo: applica alla configurazione i valori scelti dal pannello
  app.adminSecurity = createAdminSecurity(app); // accesso a due passaggi e sessioni del pannello (serve già al primo accesso)
  app.periods = createPeriods(app); // periodi con regole particolari: le opzioni e il preavviso li leggono da cfg.options.periods
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
  app.briefing = createBriefingServices(app);
  app.statements = createStatementServices(app);
  app.waitlist = createWaitlistServices(app);
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
  app.autoBackup = createAutoBackup(app, { fetchImpl: fetchImpl ?? fetch }); // copia automatica fuori dal server (lavoro periodico)
  app.vat = createVat(app, { fetchImpl: fetchImpl ?? fetch }); // verifica della partita IVA delle agenzie (VIES, lavoro periodico)
  return app;
}
