import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LANGS } from './langs.js';
import { DEFAULT_OPTION_TIERS } from './optionPolicy.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {
    /* nessun .env: si usano le variabili d'ambiente */
  }
}

/** Segreto da variabile d'ambiente: toglie spazi, a capo e virgolette attorno (capita quando si incolla nel pannello dell'hosting). */
const secret = (v) => {
  const s = String(v ?? '').trim();
  return s.length > 1 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) ? s.slice(1, -1).trim() : s;
};
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
      tagline: { it: 'Guida turistica · Venezia', en: 'Tour guide · Venice', es: 'Guía turístico · Venecia', ja: 'ガイド · ヴェネツィア' },
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

    languages: LANGS,
    defaultLang: 'it',

    // vuota in produzione = pannello disattivato; in sviluppo, se manca o è vuota (come dopo `cp .env.example .env`), vale «admin»
    admin: { password: overrides.adminPassword ?? (secret(e.ADMIN_PASSWORD) || (isProd ? '' : 'admin')) },

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
      allowPayOnSite: bool(e.ALLOW_PAY_ON_SITE, false), // pagamento il giorno del servizio: disattivato di default
      paymentsFrom: /^\d{4}-\d{2}-\d{2}$/.test(e.PAYMENTS_FROM || '') ? e.PAYMENTS_FROM : '', // «pre-apertura»: prima di questa data si prenota senza incassare online (vedi opening.js)
      currency: 'EUR',
    },

    // Opzioni delle agenzie: la data resta trattenuta senza pagare fino a una scadenza, poi si libera da sola (vedi optionPolicy.js)
    options: {
      enabled: bool(e.OPTIONS_ENABLED, true),
      tiers: DEFAULT_OPTION_TIERS.map((t) => ({ ...t })), // «se il tour è fra almeno N giorni, l'opzione dura D giorni»
      minReleaseHours: num(e.OPTION_MIN_RELEASE_HOURS, 48), // l'opzione scade almeno così tante ore prima del servizio
      maxActive: num(e.OPTION_MAX_ACTIVE, 5), // opzioni aperte insieme per partner (0 = nessun limite)
      reminderHours: num(e.OPTION_REMINDER_HOURS, 24), // promemoria all'agenzia così tante ore prima della scadenza
      // prenotazione ferma per una data lontana: la cancellazione gratuita dura poco, così conviene opzionare (vedi firmTiers in optionPolicy.js)
      firmEnabled: bool(e.FIRM_BOOKING_RULE, true),
      firmFromDays: num(e.FIRM_FROM_DAYS, 21), // vale se il servizio è fra più di tanti giorni
      firmGraceHours: num(e.FIRM_GRACE_HOURS, 48), // cancellazione gratuita solo per tante ore dalla prenotazione
      firmRefundPercent: num(e.FIRM_REFUND_PERCENT, 50), // poi si rimborsa questa percentuale fino al normale termine gratuito
    },

    calendar: {
      syncMinutes: num(e.CALENDAR_SYNC_MINUTES, 10), // ogni quanto si rilegge il calendario personale
      freshSeconds: num(e.CALENDAR_FRESH_SECONDS, 120), // prima di confermare una prenotazione si riallinea se i dati sono più vecchi di così
      staleWarnMinutes: 60, // avviso nell'admin se la sincronizzazione non riesce da oltre un'ora
    },

    reminders: {
      enabled: bool(e.REMINDERS_ENABLED, true), // la sera prima del tour (clienti privati e agenzie) e, alle agenzie, prima che finisca la cancellazione gratuita: orario, punto d'incontro, come contattarti
      sendHour: num(e.REMINDER_SEND_HOUR, 18), // ora di Venezia
      penaltyHours: num(e.PENALTY_REMINDER_HOURS, 24), // alle agenzie: così tante ore prima che la cancellazione gratuita finisca
      // scheda del giorno dopo per la guida (email con i servizi di domani e il PDF), la sera all'ora indicata (Venezia)
      briefing: { enabled: bool(e.BRIEFING_ENABLED, true), hour: num(e.BRIEFING_HOUR, 18) },
      // solleciti delle fatture scadute e non pagate (alle agenzie): il primo dopo qualche giorno dalla scadenza, poi a intervalli, fino a un massimo
      overdue: {
        enabled: bool(e.OVERDUE_REMINDERS_ENABLED, true),
        firstAfterDays: num(e.OVERDUE_FIRST_AFTER_DAYS, 1),
        everyDays: num(e.OVERDUE_EVERY_DAYS, 7),
        max: num(e.OVERDUE_MAX_REMINDERS, 3),
      },
    },

    // estratto conto mensile alle agenzie (email con il PDF, i primi giorni del mese): disattivato finché non lo accendi dal pannello
    statements: { enabled: bool(e.STATEMENTS_ENABLED, false), day: num(e.STATEMENTS_DAY, 3) },

    // lista d'attesa delle agenzie: chi è prima in lista è avvisata per prima e ha qualche ora di vantaggio, poi tocca alla successiva (0 = avvisi a tutte insieme)
    waitlist: {
      priorityHours: num(e.WAITLIST_PRIORITY_HOURS, 24),
      openBelowHours: num(e.WAITLIST_OPEN_BELOW_HOURS, 72), // con il servizio più vicino di così non si aspetta il proprio turno: l'avviso parte a tutte
    },

    // «Invita un amico» (tour condivisi): ogni invito è un codice sconto univoco, valido una volta sola per quella partenza
    invite: {
      enabled: bool(e.INVITE_ENABLED, true),
      percent: num(e.INVITE_PERCENT, 10), // sconto per l'amico
      maxPerBooking: num(e.INVITE_MAX_PER_BOOKING, 3), // inviti per ogni prenotazione
    },

    reviews: {
      enabled: bool(e.REVIEWS_ENABLED, true),
      googleUrl: e.REVIEW_URL || '', // link «scrivi una recensione» del profilo Google Business
      tripadvisorUrl: e.REVIEW_URL_TRIPADVISOR || '',
      readUrl: e.REVIEWS_PAGE_URL || '', // pagina con tutte le recensioni (profilo Google o Tripadvisor): link accanto ai commenti sul sito
      sendHour: num(e.REVIEW_SEND_HOUR, 10), // la richiesta parte il giorno dopo il tour a quest'ora (ora di Venezia)
      catchUpDays: 7, // dopo un'interruzione non si inviano richieste più vecchie di così
    },

    // Traduzione automatica dei commenti in evidenza nella lingua di chi guarda il sito (con «Vedi originale»): spenta finché non c'è una chiave
    translate: {
      provider: ['deepl', 'google'].includes(String(e.TRANSLATE_PROVIDER || '').toLowerCase()) ? String(e.TRANSLATE_PROVIDER).toLowerCase() : '',
      apiKey: secret(e.TRANSLATE_API_KEY),
    },

    // «Aggiungi al wallet» del telefono dalla pagina della prenotazione (clienti privati): ogni piattaforma si accende quando ha tutti i dati (vedi wallet.js)
    wallet: {
      google: {
        issuerId: e.GOOGLE_WALLET_ISSUER_ID || '', // numero dell'«issuer» nella Google Pay & Wallet Console
        keyFile: e.GOOGLE_WALLET_KEY_FILE || '', // il file JSON del service account (contiene indirizzo e chiave)
        serviceAccount: e.GOOGLE_WALLET_SERVICE_ACCOUNT || '', // in alternativa al file: indirizzo del service account
        privateKey: secret(e.GOOGLE_WALLET_PRIVATE_KEY), // e chiave privata (PEM, con \n al posto degli a capo)
      },
      apple: {
        passTypeId: e.APPLE_WALLET_PASS_TYPE_ID || '', // es. pass.it.tuodominio.prenotazione
        teamId: e.APPLE_WALLET_TEAM_ID || '',
        certFile: e.APPLE_WALLET_CERT_FILE || '', // certificato del Pass Type ID (PEM)
        keyFile: e.APPLE_WALLET_KEY_FILE || '', // la sua chiave privata (PEM)
        wwdrFile: e.APPLE_WALLET_WWDR_FILE || '', // certificato intermedio Apple «WWDR» (PEM o .cer)
        keyPassphrase: secret(e.APPLE_WALLET_KEY_PASSPHRASE),
        certPem: secret(e.APPLE_WALLET_CERT), // in alternativa ai file: il contenuto PEM nelle variabili
        keyPem: secret(e.APPLE_WALLET_KEY),
        wwdrPem: secret(e.APPLE_WALLET_WWDR),
      },
    },

    program: {
      depositPercent: num(e.PROGRAM_DEPOSIT_PERCENT, 30), // acconto proposto nei preventivi dei programmi di più giorni
      validityDays: num(e.PROGRAM_VALIDITY_DAYS, 7), // validità predefinita di una proposta
    },

    // Fatturazione elettronica (FatturaPA). I dati fiscali vanno concordati con il commercialista.
    invoice: {
      seller: {
        name: e.INVOICE_NAME || '', // denominazione, se emetti come società; altrimenti nome e cognome
        firstName: e.INVOICE_FIRST_NAME || '',
        lastName: e.INVOICE_LAST_NAME || '',
        fiscalCode: (e.FISCAL_CODE || '').toUpperCase(),
        regime: e.INVOICE_REGIME || 'RF19', // RF19 forfettario, RF01 ordinario, RF02 minimi…
        address: { street: e.INVOICE_ADDRESS || '', zip: e.INVOICE_ZIP || '', city: e.INVOICE_CITY || '', province: (e.INVOICE_PROVINCE || '').toUpperCase() },
      },
      vatBp: Math.round(num(e.INVOICE_VAT_RATE, (e.INVOICE_REGIME || 'RF19') === 'RF19' ? 0 : 22) * 100),
      nature: e.INVOICE_NATURE ?? ((e.INVOICE_REGIME || 'RF19') === 'RF19' || num(e.INVOICE_VAT_RATE, 22) === 0 ? 'N2.2' : ''),
      vatIncluded: { b2c: bool(e.INVOICE_PRICES_INCLUDE_VAT_B2C, true), b2b: bool(e.INVOICE_PRICES_INCLUDE_VAT_B2B, false) }, // i prezzi pubblici comprendono l'IVA? (conta solo con IVA > 0)
      bollo: e.INVOICE_BOLLO === 'never' ? 'never' : 'auto',
      contributionPercent: num(e.INVOICE_CONTRIBUTION_PERCENT, 0), // rivalsa INPS (TC22) proposta nelle fatture a imprese
      withholdingPercent: num(e.INVOICE_WITHHOLDING_PERCENT, 0), // ritenuta d'acconto proposta nelle fatture a imprese italiane
      withholdingCause: e.INVOICE_WITHHOLDING_CAUSE || 'A',
      notes: e.INVOICE_NOTES ?? ((e.INVOICE_REGIME || 'RF19') === 'RF19' ? 'Operazione effettuata ai sensi dell’art. 1, commi da 54 a 89, della Legge n. 190/2014 – Regime forfettario. | Operazione non soggetta a ritenuta d’acconto ai sensi dell’art. 1, comma 67, della Legge n. 190/2014.' : ''), // causali, separate da |
      legalReference: e.INVOICE_LEGAL_REFERENCE ?? ((e.INVOICE_REGIME || 'RF19') === 'RF19' ? 'Regime forfettario - art. 1, commi 54-89, L. 190/2014' : 'Operazione non soggetta a IVA'),
      iban: (e.INVOICE_IBAN || '').replace(/\s+/g, '').toUpperCase(),
      bank: e.INVOICE_BANK || '',
      b2bDueDays: num(e.INVOICE_B2B_DUE_DAYS, 30), // scadenza di pagamento delle fatture ai partner
      giftInvoiceAt: e.INVOICE_GIFT_AT === 'redemption' ? 'redemption' : 'sale', // buono monouso: fattura alla vendita; multiuso: all'utilizzo
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(e.INVOICE_START_DATE || '') ? e.INVOICE_START_DATE : '', // prima data fatturabile (es. 2027-01-01, apertura P.IVA): prima di questa non si fattura nulla
      sdiAddress: e.SDI_PEC_ADDRESS || 'sdi01@pec.fatturapa.it',
      pec: { host: e.PEC_SMTP_HOST || '', port: num(e.PEC_SMTP_PORT, 465), user: e.PEC_SMTP_USER || '', pass: e.PEC_SMTP_PASS || '', secure: bool(e.PEC_SMTP_SECURE, true), from: e.PEC_FROM || e.PEC_SMTP_USER || '' },
    },

    gift: {
      validityMonths: num(e.GIFT_VALIDITY_MONTHS, 24), // validità dei buoni regalo
      minCents: num(e.GIFT_MIN_EUR, 20) * 100,
      maxCents: num(e.GIFT_MAX_EUR, 1000) * 100,
      presets: [5000, 10000, 15000, 20000],
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
