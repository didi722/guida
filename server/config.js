import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    /* nessun .env: si usano le variabili d'ambiente */
  }
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

/**
 * Tutta la configurazione arriva da variabili d'ambiente (vedi .env.example).
 * `overrides` serve ai test.
 */
export function createConfig(overrides = {}) {
  if (!overrides.__skipDotEnv) loadDotEnv();
  const e = process.env;
  const isProd = e.NODE_ENV === 'production';
  const dataDir = path.resolve(overrides.dataDir ?? e.DATA_DIR ?? path.join(ROOT, 'data'));
  fs.mkdirSync(dataDir, { recursive: true });

  let sessionSecret = e.SESSION_SECRET;
  if (!sessionSecret) {
    if (isProd) throw new Error('SESSION_SECRET è obbligatoria in produzione (almeno 32 caratteri casuali).');
    // in sviluppo: segreto generato una volta e salvato in data/
    const f = path.join(dataDir, '.session-secret');
    if (fs.existsSync(f)) sessionSecret = fs.readFileSync(f, 'utf8');
    else {
      sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(f, sessionSecret, { mode: 0o600 });
    }
  }

  const stripeKey = e.STRIPE_SECRET_KEY || '';
  const cfg = {
    isProd,
    port: num(e.PORT, 3000),
    baseUrl: (e.BASE_URL || `http://localhost:${num(e.PORT, 3000)}`).replace(/\/$/, ''),
    trustProxy: bool(e.TRUST_PROXY, isProd),
    dataDir,
    dbFile: path.join(dataDir, 'guida.sqlite'),
    sessionSecret,

    site: {
      name: e.SITE_NAME || 'Davide Tomio',
      tagline: { it: 'Guida turistica · Venezia', en: 'Tour guide · Venice' },
      email: e.CONTACT_EMAIL || 'info@example.com',
      phone: e.CONTACT_PHONE || '',
      whatsapp: e.CONTACT_WHATSAPP || '', // solo cifre con prefisso, es. 393331234567
      instagram: e.INSTAGRAM_URL ?? 'https://instagram.com/davide.tomio',
      // dati d'impresa mostrati nel footer e nelle email: compilali quando apri la P.IVA
      legalName: e.LEGAL_NAME || 'Davide Tomio',
      vatNumber: e.VAT_NUMBER || '',
      guideLicense: e.GUIDE_LICENSE || '',
      address: e.LEGAL_ADDRESS || '',
    },

    languages: ['it', 'en'],
    defaultLang: 'it',

    admin: { password: overrides.adminPassword ?? e.ADMIN_PASSWORD ?? (isProd ? '' : 'admin') },

    stripe: { secretKey: stripeKey, webhookSecret: e.STRIPE_WEBHOOK_SECRET || '' },
    // Pagamento simulato: solo se NON c'è Stripe e non siamo in produzione (o lo si abilita a mano).
    demoPayments: !stripeKey && (!isProd || bool(e.ALLOW_DEMO_PAYMENTS, false)),

    mail: {
      host: e.SMTP_HOST || '',
      port: num(e.SMTP_PORT, 587),
      user: e.SMTP_USER || '',
      pass: e.SMTP_PASS || '',
      secure: bool(e.SMTP_SECURE, false),
      from: e.MAIL_FROM || `Davide Tomio <${e.CONTACT_EMAIL || 'info@example.com'}>`,
      notifyTo: e.NOTIFY_EMAIL || e.CONTACT_EMAIL || '',
    },

    analytics: { umamiId: e.UMAMI_WEBSITE_ID || '', umamiSrc: e.UMAMI_SRC || 'https://cloud.umami.is/script.js' },

    policy: {
      // Cancellazione gratuita fino a N ore prima dell'inizio del servizio
      b2cFreeCancelHours: num(e.B2C_FREE_CANCEL_HOURS, 48),
      b2bFreeCancelHours: num(e.B2B_FREE_CANCEL_HOURS, 72),
      // Preavviso minimo per prenotare
      b2cMinNoticeHours: num(e.B2C_MIN_NOTICE_HOURS, 24),
      b2bMinNoticeHours: num(e.B2B_MIN_NOTICE_HOURS, 12),
      maxAdvanceDays: num(e.MAX_ADVANCE_DAYS, 365),
      bufferMin: num(e.BUFFER_MIN, 30), // pausa tra un servizio e il successivo
      slotStepMin: num(e.SLOT_STEP_MIN, 30), // passo orari per i servizi a inizio libero
      holdMinutes: num(e.HOLD_MINUTES, 35), // blocco dello slot durante il pagamento
      allowPayOnSite: bool(e.ALLOW_PAY_ON_SITE, true),
      currency: 'EUR',
    },

    // Orari di lavoro predefiniti (modificabili dal pannello admin)
    defaultWeekly: Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { open: true, from: '08:30', to: '19:30' }]),
    ),
  };

  return deepMerge(cfg, overrides);
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (k === '__skipDotEnv') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}
