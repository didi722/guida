// Assembla i moduli dell'applicazione (usato dal server e dai test, così non si disallineano).
import { createMailer } from './mail.js';
import { createPayables } from './payables.js';
import { createPayments } from './payments.js';
import { createServices } from './services.js';

export function createContext({ cfg, db, content, mail, payments, assetVersion = '0' }) {
  const app = { cfg, db, content, assetVersion };
  app.mail = mail ?? createMailer(cfg);
  app.payments = payments ?? createPayments(cfg);
  app.payables = createPayables(app);
  app.services = createServices(app);
  return app;
}
