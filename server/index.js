import { createApp } from './app.js';

const { app, server } = createApp();
const { cfg } = app;

server.listen(cfg.port, () => {
  console.log(`Sito avviato su ${cfg.baseUrl} (porta ${cfg.port})`);
  if (!cfg.isProd) console.log(`Admin: ${cfg.baseUrl}/admin  (password: ${cfg.admin.password || 'non impostata'})`);
  if (!app.mail.live) console.log('Email: SMTP non configurato → i messaggi vengono salvati in data/outbox/');
  if (app.payments.demo) console.log('Pagamenti: modalità DEMO (nessuna carta reale). Imposta STRIPE_SECRET_KEY per i pagamenti veri.');
  if (!app.payments.live && !app.payments.demo) console.log('Pagamenti con carta DISATTIVATI (manca STRIPE_SECRET_KEY).');
  if (cfg.isProd && !cfg.stripe.webhookSecret && app.payments.live) console.warn('ATTENZIONE: manca STRIPE_WEBHOOK_SECRET, le conferme di pagamento dipenderanno solo dal ritorno del cliente.');
});

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
