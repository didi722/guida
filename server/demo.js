// Demo per le agenzie: una copia «finta» dell'area agenzie da mostrare nelle videochiamate commerciali, sullo stesso indirizzo del sito.
//
// Com'è fatta (e perché non può sporcare nulla di vero):
//  - è una SECONDA applicazione, con il suo database in memoria: nessuna prenotazione, fattura, email o statistica della demo tocca i dati veri,
//    e a ogni riavvio (o a «Ricomincia») riparte da capo con dati d'esempio nuovi;
//  - del sito vero copia solo il catalogo (tour, tariffe, testi, immagini, orari di lavoro e regole): le agenzie vedono i tuoi prezzi veri;
//    tutto il resto (agenzie, prenotazioni, fatture, contatti, email…) NON si copia mai (vedi DEMO_COPIED_TABLES e il test che li classifica tutti);
//  - non spedisce email (le tiene in memoria), non usa Stripe (pagamenti simulati), non scrive su PEC, non esce in rete, non ha pannello admin;
//  - le fatture hanno dati fiscali finti e la dicitura «documento dimostrativo»; il segreto delle sessioni è diverso da quello del sito vero,
//    quindi un accesso della demo non vale sul sito vero (e viceversa);
//  - ci si entra solo con un collegamento riservato (/demo?k=…, lo trovi in Commerciale › Demo): un cookie firmato manda al sito di prova le richieste
//    di quel browser finché non si preme «Esci» (o passano 8 ore).
import crypto from 'node:crypto';
import { clearCookie, parseCookies, setCookie, signToken, verifyToken } from './auth.js';
import { seedDemoData } from './demoData.js';
import { getSetting, openDb, setSetting, tx } from './db.js';
import { loginPartner, logoutPartner, preferredLang, sameOrigin } from './http.js';
import { LANGS } from './langs.js';
import { createPayments } from './payments.js';
import { nowRome } from './time.js';
import { safeEqual } from './util.js';

const KEY_SETTING = 'demo_key';
const FLAG = 'gd'; // cookie che manda le richieste alla demo
const FLAG_TTL_MS = 8 * 3600_000;
const IDLE_MS = 3 * 3600_000; // dopo tre ore senza richieste la demo si libera dalla memoria (e riparte da capo alla prossima volta)

/** Le tabelle del catalogo che si copiano nella demo (righe intere). */
export const DEMO_COPIED_TABLES = ['content_tours', 'content_posts', 'content_pages', 'content_texts', 'media', 'periods'];
/** Le impostazioni che si copiano: tariffe, immagini, orari di lavoro e i segni che il contenuto è già stato importato. (`config_overrides` si copia ripulita, vedi sotto.) */
export const DEMO_COPIED_SETTINGS = ['rate_card', 'site_images', 'weekly', 'content_seeded', 'content_hourly_seeded', 'content_terms_invite', 'content_langs_filled'];
/** Tutte le altre tabelle: dati di persone, di clienti o dell'attività. Non si copiano mai. (Il test controlla che ogni tabella del database sia in uno dei due elenchi.) */
export const DEMO_SKIPPED_TABLES = [
  'settings', 'day_overrides', 'blocks', 'accounts', 'bookings', 'promo_codes', 'gift_cards', 'gift_card_ledger', 'feedback', 'feedback_translations', 'calendar_sources', 'external_busy',
  'programs', 'program_days', 'invoices', 'invoice_lines', 'invoice_batches', 'invites', 'booking_groups', 'cart_items', 'booking_changes', 'extension_requests', 'waitlist', 'account_logos',
  'statement_sends', 'partner_invites', 'account_users', 'quotes', 'leads', 'lead_contacts', 'lead_activities', 'lead_appointments', 'lead_emails', 'email_optouts', 'google_reviews',
];
/** Le scelte del pannello (`config_overrides`) che NON passano alla demo: dati fiscali, posta, copie di sicurezza, solleciti e tutto ciò che riguarda persone vere. */
const OVERRIDES_DENIED = ['invoice.seller.name', 'invoice.seller.firstName', 'invoice.seller.lastName', 'invoice.seller.fiscalCode', 'invoice.seller.address', 'invoice.iban', 'invoice.bank', 'invoice.startDate', 'invoice.notes', 'site.vatNumber', 'site.hideFromSearch', 'policy.paymentsFrom', 'mail.', 'backup.', 'reminders.', 'statements.', 'reviews.'];

/** I dati fiscali della demo: solo la forma è giusta, nessuno è di una persona vera. */
const FAKE = { vatNumber: 'IT12345678903', fiscalCode: 'RSSMRA80A01H501U', street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE', iban: 'IT60X0542811101000000123456', bank: 'Banca di prova' };
const DEMO_NOTE = 'DOCUMENTO DIMOSTRATIVO: fattura di prova, senza alcun valore fiscale.';

/** La configurazione della demo: quella del sito, ma senza chiavi, posta, PEC, copie di sicurezza e dati fiscali veri. */
export function demoConfig(real) {
  const d = structuredClone(real);
  d.isDemo = true;
  d.dbFile = ':memory:';
  d.sessionSecret = crypto.createHmac('sha256', real.sessionSecret).update('guida-demo').digest('hex'); // gli accessi della demo non valgono sul sito vero
  d.admin = { password: '' };
  d.stripe = { secretKey: '', webhookSecret: '' };
  d.demoPayments = true;
  d.mail = { ...d.mail, host: '', user: '', pass: '', notifyTo: '', sales: { host: '', port: 587, user: '', pass: '', secure: false } };
  d.analytics = { ...d.analytics, umamiId: '' };
  d.translate = { provider: '', apiKey: '' };
  d.reviews = { ...d.reviews, google: { placeId: '', apiKey: '' } }; // la demo non chiede nulla a Google
  d.wallet = {
    google: { issuerId: '', keyFile: '', serviceAccount: '', privateKey: '' },
    apple: { passTypeId: '', teamId: '', certFile: '', keyFile: '', wwdrFile: '', keyPassphrase: '', certPem: '', keyPem: '', wwdrPem: '' },
  };
  d.backup = { auto: { ...d.backup.auto, enabled: false }, dir: '', s3: { endpoint: '', bucket: '', region: 'us-east-1', accessKey: '', secretKey: '', prefix: 'guida/', pathStyle: true } };
  d.reminders = { ...d.reminders, enabled: false, briefing: { ...d.reminders.briefing, enabled: false }, overdue: { ...d.reminders.overdue, enabled: false } };
  d.statements = { ...d.statements, enabled: false };
  d.reviews = { ...d.reviews, enabled: false };
  d.policy.paymentsFrom = ''; // niente «pre-apertura»: nella demo si può prenotare e pagare (per finta) sempre
  d.site.hideFromSearch = true;
  d.site.vatNumber = FAKE.vatNumber;
  // fatture: il nome resta quello del sito, tutto il resto è finto
  const seller = d.invoice.seller;
  if (!seller.name && !(seller.firstName && seller.lastName)) {
    const parts = String(d.site.legalName || d.site.name).split(/\s+/).filter(Boolean);
    seller.firstName = parts.slice(0, -1).join(' ') || parts[0] || 'Demo';
    seller.lastName = parts.length > 1 ? parts.at(-1) : 'Demo';
  }
  seller.fiscalCode = FAKE.fiscalCode;
  seller.address = { street: FAKE.street, zip: FAKE.zip, city: FAKE.city, province: FAKE.province };
  d.invoice.iban = FAKE.iban;
  d.invoice.bank = FAKE.bank;
  d.invoice.startDate = '';
  d.invoice.notes = [DEMO_NOTE, d.invoice.notes].filter(Boolean).join(' | ');
  d.invoice.pec = { host: '', port: 465, user: '', pass: '', secure: true, from: '' };
  return d;
}

/** Copia nel database della demo il catalogo del sito vero (e nient'altro). @returns {Record<string, number>} righe copiate per tabella */
export function copyCatalog(from, to) {
  const copied = {};
  tx(to, () => {
    for (const table of DEMO_COPIED_TABLES) {
      const rows = from.prepare(`SELECT * FROM ${table}`).all();
      to.exec(`DELETE FROM ${table}`);
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        const ins = to.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`);
        for (const r of rows) ins.run(...cols.map((c) => r[c]));
      }
      copied[table] = rows.length;
    }
    for (const key of DEMO_COPIED_SETTINGS) {
      const row = from.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (row) to.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, row.value);
    }
    const overrides = getSetting(from, 'config_overrides', {}) ?? {};
    const kept = Object.fromEntries(Object.entries(overrides).filter(([k]) => !OVERRIDES_DENIED.some((p) => k === p || k.startsWith(p.endsWith('.') ? p : `${p}.`))));
    setSetting(to, 'config_overrides', kept);
  });
  return copied;
}

/** Una posta che non spedisce nulla: tiene in memoria gli ultimi messaggi (solo destinatario e oggetto). */
export function silentMailer() {
  const sent = [];
  return {
    sent,
    live: false,
    salesLive: false,
    lastError: '',
    async send({ to, subject }) {
      if (!to) return false;
      sent.push({ at: Date.now(), to, subject });
      if (sent.length > 50) sent.shift();
      return true;
    },
  };
}

/**
 * La demo di un'applicazione: crea (e ricrea) l'istanza di prova, custodisce la chiave del collegamento riservato.
 * `createApp` si passa da fuori (app.js importa questo file, non il contrario).
 */
export function createDemo(app, createApp) {
  const { db } = app;
  let current = null; // { app, server, account, report, builtAt, usedAt }
  let building = null;

  const newKey = () => crypto.randomBytes(18).toString('base64url');
  /** La chiave che c'è, senza crearla (chi bussa a /demo senza averla non deve far scrivere nel database). */
  const peekKey = () => {
    const k = getSetting(db, KEY_SETTING, null);
    return typeof k === 'string' && k.length >= 16 ? k : null;
  };
  const key = () => {
    const k = peekKey();
    if (k) return k;
    const fresh = newKey();
    setSetting(db, KEY_SETTING, fresh);
    return fresh;
  };

  function dispose() {
    const c = current;
    current = null;
    if (!c) return;
    c.app.close?.();
    // il database si chiude qualche secondo dopo: una pagina ancora in viaggio (per esempio mentre si preme «Ricomincia») finisce senza errori
    const later = setTimeout(() => {
      try {
        c.app.db.close();
      } catch {
        /* già chiuso */
      }
    }, 15_000);
    later.unref();
  }

  async function build() {
    const cfg = demoConfig(app.cfg);
    const demoDb = openDb(':memory:');
    copyCatalog(db, demoDb);
    const mail = silentMailer();
    const pec = { live: false, async send() { return false; } };
    const fetchImpl = async () => {
      throw new Error('la demo non esce in rete');
    };
    const { app: inner, server } = createApp({ cfg, db: demoDb, mail, payments: createPayments(cfg), pec, fetchImpl });
    inner.close(); // nessun lavoro periodico: la demo non manda email e non controlla nulla fuori
    const { account, report } = await seedDemoData(inner, { nowMs: Date.now() });
    const failed = report.filter((l) => l.startsWith('✗'));
    if (failed.length) console.warn(`[demo] ${failed.length} passi dei dati d'esempio non sono riusciti (la demo funziona lo stesso, con ciò che c'è):\n  ${failed.join('\n  ')}`);
    return { app: inner, server, account, report, builtAt: Date.now(), usedAt: Date.now() };
  }

  /** La demo pronta: se non c'è (o è di un altro giorno, e le date «tra 6 giorni» sarebbero sbagliate) si crea da capo. */
  async function ensure() {
    if (current && nowRome(current.builtAt).date !== nowRome().date) dispose();
    if (!current) {
      building ??= build().finally(() => {
        building = null;
      });
      current = await building;
    }
    current.usedAt = Date.now();
    return current;
  }

  const sweep = setInterval(() => {
    if (current && Date.now() - current.usedAt > IDLE_MS) dispose();
  }, 10 * 60_000);
  sweep.unref();

  return {
    key,
    peekKey,
    /** Una chiave nuova: il vecchio collegamento smette di funzionare. */
    rotateKey() {
      const fresh = newKey();
      setSetting(db, KEY_SETTING, fresh);
      return fresh;
    },
    ensure,
    /** Chi apre il collegamento dopo una pausa trova una demo nuova (date di oggi, niente avanzi della volta scorsa); se la si sta già usando, resta com'è. */
    async freshIfIdle(minutes = 10) {
      if (current && Date.now() - current.usedAt > minutes * 60_000) dispose();
      return ensure();
    },
    /** Cancella la demo in corso: alla prossima richiesta riparte da capo. */
    async reset() {
      dispose();
      return ensure();
    },
    dispose,
    /** Si ferma del tutto (alla chiusura dell'applicazione, nei test). */
    stop() {
      clearInterval(sweep);
      dispose();
    },
    status: () => (current ? { active: true, builtAt: current.builtAt, usedAt: current.usedAt } : { active: false }),
  };
}

/** Il collegamento riservato per entrare nella demo (`origin`: l'indirizzo da cui si sta guardando il pannello; se manca, quello del sito). */
export const demoLink = (app, lang = '', origin = app.cfg.baseUrl) => `${origin}/demo?k=${encodeURIComponent(app.demo.key())}${lang ? `&lang=${lang}` : ''}`;

/**
 * Collega la demo al sito: le rotte /demo, /demo/exit e /demo/reset, e lo smistamento delle richieste di chi è «dentro» alla demo.
 * Va montato per primo (prima di file statici, sessioni e pannello).
 */
export function mountDemo(server, app) {
  const { cfg, demo } = app;
  const flag = (req) => verifyToken(cfg.sessionSecret, parseCookies(req.headers.cookie)[FLAG])?.k === 'demo';
  const langOf = (req) => {
    const asked = String(req.query?.lang ?? '');
    return LANGS.includes(asked) ? asked : preferredLang(req);
  };
  const enter = async (req, res, lang) => {
    const inst = await demo.ensure();
    setCookie(res, cfg, FLAG, signToken(cfg.sessionSecret, { k: 'demo', exp: Date.now() + FLAG_TTL_MS }));
    loginPartner(res, inst.app.cfg, inst.account.id);
    res.set('Cache-Control', 'no-store').redirect(303, `/${lang}/b2b/account`);
  };

  /** «Ricomincia»: la demo riparte da capo, con dati d'esempio nuovi, e si rientra come l'agenzia. */
  const restart = async (req, res) => {
    let lang = 'it';
    try {
      const first = new URL(req.get('referer') ?? '', cfg.baseUrl).pathname.split('/')[1];
      if (LANGS.includes(first)) lang = first;
    } catch {
      /* senza indirizzo di provenienza: italiano */
    }
    await demo.reset();
    await enter(req, res, lang);
  };

  server.use(async (req, res, next) => {
    try {
      const path = req.path.replace(/\/+$/, '') || '/';
      if (path === '/demo' && req.method === 'GET') {
        const k = String(req.query.k ?? '');
        const real = demo.peekKey();
        if (!((k && real && safeEqual(k, real)) || flag(req))) return next(); // senza la chiave la pagina non esiste
        if (k && real && safeEqual(k, real)) await demo.freshIfIdle(); // dal collegamento: una demo con le date di oggi, a meno che qualcuno la stia già usando
        return await enter(req, res, langOf(req));
      }
      if (path === '/demo/exit' && req.method === 'GET') {
        clearCookie(res, cfg, FLAG);
        logoutPartner(res, cfg);
        return res.set('Cache-Control', 'no-store').redirect(303, '/');
      }
      if (!flag(req) || path === '/admin' || path.startsWith('/admin/')) return next(); // il pannello è sempre quello vero, anche da dentro la demo (che non ne ha uno)
      if (path === '/demo/reset' && req.method === 'POST') {
        return sameOrigin(req, res, () => {
          restart(req, res).catch(next);
        });
      }
      const inst = await demo.ensure();
      return inst.server(req, res, next);
    } catch (err) {
      return next(err);
    }
  });
}
