import { createApp } from './app.js';

const { app, server } = createApp();
const { cfg } = app;

server.listen(cfg.port, () => {
  console.log(`Sito avviato su ${cfg.baseUrl} (porta ${cfg.port})`);
  if (!cfg.isProd) console.log(`Admin: ${cfg.baseUrl}/admin  (password: ${cfg.admin.password || 'non impostata'})`);
  else console.log(cfg.admin.password ? `Admin: attivo su ${cfg.baseUrl}/admin (password di ${cfg.admin.password.length} caratteri)` : 'Admin: DISATTIVATO, manca la variabile ADMIN_PASSWORD.');
  if (cfg.isProd && /^https?:\/\/localhost\b/.test(cfg.baseUrl)) console.warn('ATTENZIONE: BASE_URL non è impostata (vale ' + cfg.baseUrl + '): i link nelle email e nei pagamenti punteranno lì. Imposta BASE_URL con l’indirizzo pubblico, es. https://www.tuodominio.it.');
  if (cfg.isProd && cfg.baseUrl.startsWith('http://') && !/localhost/.test(cfg.baseUrl)) console.warn('ATTENZIONE: BASE_URL usa http://: in produzione serve https:// (cookie di accesso, pagamenti, email).');
  if (!app.mail.live) console.log('Email: SMTP non configurato → i messaggi vengono salvati in data/outbox/');
  if (app.payments.demo) console.log('Pagamenti: modalità DEMO (nessuna carta reale). Imposta STRIPE_SECRET_KEY per i pagamenti veri.');
  if (!app.payments.live && !app.payments.demo) console.log('Pagamenti con carta DISATTIVATI (manca STRIPE_SECRET_KEY).');
  if (cfg.isProd && !cfg.stripe.webhookSecret && app.payments.live) console.warn('ATTENZIONE: manca STRIPE_WEBHOOK_SECRET, le conferme di pagamento dipenderanno solo dal ritorno del cliente.');
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
