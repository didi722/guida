import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { localToInstant } from '../server/time.js';
import { createContext } from '../server/context.js';

process.env.GUIDA_QUIET = '1';

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
  priceCents: 3500,
  b2bPriceCents: 2800,
  cancelHours: null,
  payOnSite: true,
  art: 'dome',
  languages: ['it', 'en'],
  i18n: { it: { title: 'Tour di prova', meetingPoint: 'Piazza' }, en: { title: 'Test tour', meetingPoint: 'The square' } },
  ...over,
});

export const FIXTURE_TOURS = [
  tour(),
  tour({ slug: 'private', model: 'group', flexible: true, times: [], durationMin: 120, maxParticipants: 20, priceCents: 15000, b2bPriceCents: 12000 }),
  tour({ slug: 'half-day', model: 'group', flexible: true, times: [], durationMin: 240, maxParticipants: 25, priceCents: 24000, b2bPriceCents: 19000, cancelHours: 72 }),
];

// "Adesso" di riferimento nei test: lunedì 4 gennaio 2027, 10:00 a Venezia
export const NOW = localToInstant('2027-01-04', '10:00');

export function makeApp(overrides = {}) {
  const dir = path.join(ROOT, 'data', 'test-' + crypto.randomBytes(4).toString('hex'));
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, demoPayments: true, policy: { allowPayOnSite: true }, ...overrides });
  const db = openDb(':memory:');
  const tours = FIXTURE_TOURS;
  const content = { tours, tour: (s) => tours.find((t) => t.slug === s), postsFor: () => [], post: () => null, page: () => null };
  const app = createContext({ cfg, db, content });
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

export const base = (over = {}) => ({
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
});
