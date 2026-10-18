import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { createConfig, ROOT } from '../server/config.js';
import { buildContent, readContentFiles, splitRawTours } from '../server/content.js';
import { openDb } from '../server/db.js';
import { localToInstant } from '../server/time.js';
import { createContext } from '../server/context.js';
import { ledgerAdd } from '../server/pricing.js';
import { newGiftCode, newRef } from '../server/util.js';

process.env.GUIDA_QUIET = '1';
process.env.FIRM_BOOKING_RULE ??= 'false'; // i test partono senza la regola «data lontana» (c'è un test apposta che la accende)

export const tour = (over = {}) => ({
  slug: 'shared',
  active: true,
  order: 1,
  model: 'person',
  flexible: false,
  times: ['09:30', '14:30'],
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  durationMin: 150,
  maxParticipants: 10,
  audience: 'b2c',
  priceCents: 3500,
  cancelHours: null,
  payOnSite: true,
  art: 'dome',
  languages: ['it', 'en', 'es'],
  i18n: { it: { title: 'Tour di prova', meetingPoint: 'Piazza' }, en: { title: 'Test tour', meetingPoint: 'The square' }, es: { title: 'Tour de prueba', meetingPoint: 'La plaza' } },
  ...over,
});

// Ogni tour è B2C (prezzo dei privati) oppure B2B (tariffa agenzie): per ciascuno dei tre tour c'è la sua versione per le agenzie, «<indirizzo>-agenzie».
export const FIXTURE_TOURS = [
  tour(),
  tour({ slug: 'private', model: 'group', flexible: true, times: [], durationMin: 120, maxParticipants: 20, priceCents: 15000 }),
  tour({ slug: 'half-day', model: 'group', flexible: true, times: [], durationMin: 240, maxParticipants: 25, priceCents: 24000, cancelHours: 72 }),
  tour({ slug: 'shared-agenzie', audience: 'b2b', order: 11, priceCents: 2800 }),
  tour({ slug: 'private-agenzie', audience: 'b2b', order: 12, model: 'group', flexible: true, times: [], durationMin: 120, maxParticipants: 20, priceCents: 12000 }),
  tour({ slug: 'half-day-agenzie', audience: 'b2b', order: 13, model: 'group', flexible: true, times: [], durationMin: 240, maxParticipants: 25, priceCents: 19000, cancelHours: 72 }),
];

// "Adesso" di riferimento nei test: lunedì 4 gennaio 2027, 10:00 a Venezia
export const NOW = localToInstant('2027-01-04', '10:00');

export function makeApp(overrides = {}, { fetchImpl, pec } = {}) {
  const dir = path.join(ROOT, 'data', 'test-' + crypto.randomBytes(4).toString('hex'));
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, demoPayments: true, policy: { allowPayOnSite: true }, ...overrides });
  const db = openDb(':memory:');
  const tours = FIXTURE_TOURS;
  const content = { tours, tour: (s) => tours.find((t) => t.slug === s), postsFor: () => [], post: () => null, page: () => null };
  const app = createContext({ cfg, db, content, fetchImpl, pec });
  app.cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return app;
}

export function addAccount(db, over = {}) {
  const row = {
    email: 'dmc@example.com',
    password_hash: 'x',
    company: 'Test DMC',
    contact_name: 'Anna',
    status: 'approved',
    discount_percent: 0,
    allow_invoice: 1,
    created_at: new Date(NOW).toISOString(),
    ...over,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO accounts(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
  return db.prepare('SELECT * FROM accounts WHERE email = ?').get(row.email);
}

/** Una prenotazione di prova. Ai partner (`channel: 'b2b'`) servono i tour B2B: se non si dice altro, si usa la versione «-agenzie» del tour. */
export const base = (over = {}) => {
  const b = {
    tourSlug: 'shared',
    date: '2027-01-12',
    time: '09:30',
    pax: 2,
    channel: 'b2c',
    name: 'Mario Rossi',
    email: 'mario@example.com',
    lang: 'it',
    paymentMethod: 'onsite',
    ...over,
  };
  if (b.channel === 'b2b' && !b.tourSlug.endsWith('-agenzie') && FIXTURE_TOURS.some((t) => t.slug === `${b.tourSlug}-agenzie`)) b.tourSlug += '-agenzie';
  return b;
};

export function addPromo(db, over = {}) {
  const row = { code: 'ESTATE10', kind: 'percent', value: 10, active: 1, created_at: new Date(NOW).toISOString(), ...over };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO promo_codes(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
  return db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(row.code);
}

export function addGift(db, over = {}) {
  const initial = over.initial_cents ?? 10000;
  const row = {
    ref: newRef('GC'),
    token: 'tok',
    code: newGiftCode(),
    status: 'active',
    initial_cents: initial,
    balance_cents: 0,
    created_at: new Date(NOW).toISOString(),
    activated_at: new Date(NOW).toISOString(),
    expires_at: '2028-12-31',
    ...over,
  };
  row.balance_cents = 0;
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO gift_cards(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
  const card = db.prepare('SELECT * FROM gift_cards WHERE code = ?').get(row.code);
  ledgerAdd(db, card.id, initial, 'issue', { nowMs: NOW });
  return db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(card.id);
}

export const giftBalance = (db, id) => db.prepare('SELECT balance_cents FROM gift_cards WHERE id = ?').get(id).balance_cents;
export const ledgerSum = (db, id) => db.prepare('SELECT COALESCE(SUM(delta_cents),0) s FROM gift_card_ledger WHERE gift_card_id = ?').get(id).s;

// ───── PDF ─────
export const isPdf = (buf) => Buffer.from(buf).subarray(0, 5).toString('latin1') === '%PDF-';
export const pdfPages = (buf) => (Buffer.from(buf).toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;
/** I contenuti dei PDF sono compressi e con font incorporato: per leggerli serve pdftotext (poppler). Se manca, i test sul testo vengono saltati. */
export const HAS_PDFTOTEXT = !spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).error;
export function pdfText(buf) {
  const r = spawnSync('pdftotext', ['-layout', '-', '-'], { input: Buffer.from(buf), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`pdftotext: ${r.stderr}`);
  return r.stdout.replace(/[ \t]+/g, ' ');
}

/**
 * Il contenuto del sito più tre servizi privati a PREZZO FISSO (passeggiata di 2 ore, mezza giornata, giornata):
 * nel sito oggi i servizi privati sono a ore, ma il prezzo fisso per gruppo (e il listino dedicato ai partner) resta una funzione da provare.
 */
export function loadContentWithFixedServices(root = ROOT) {
  const raw = readContentFiles(root);
  const dir = path.join(root, 'test', 'fixtures', 'tours');
  for (const f of fs.readdirSync(dir)) raw.tours[f.replace(/\.yml$/, '')] = YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  raw.tours = splitRawTours(raw.tours); // come fa il sito con i tour di prima della divisione B2C/B2B: B2C + una copia per le agenzie («<indirizzo>-agenzie»)
  return buildContent(raw);
}
