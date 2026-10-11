import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Giorni speciali: chiusura (closed=1) oppure orario diverso dal solito
CREATE TABLE IF NOT EXISTS day_overrides (
  date      TEXT PRIMARY KEY,
  closed    INTEGER NOT NULL DEFAULT 1,
  from_time TEXT,
  to_time   TEXT,
  note      TEXT
);

-- Fasce orarie occupate da impegni esterni (altre agenzie, visite mediche, ecc.)
CREATE TABLE IF NOT EXISTS blocks (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS blocks_date ON blocks(date);

-- Account B2B (DMC, tour operator, agenzie)
CREATE TABLE IF NOT EXISTS accounts (
  id               INTEGER PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash    TEXT NOT NULL,
  company          TEXT NOT NULL,
  vat              TEXT,
  sdi_code         TEXT,
  pec              TEXT,
  country          TEXT,
  address          TEXT,
  contact_name     TEXT NOT NULL,
  phone            TEXT,
  website          TEXT,
  message          TEXT,
  lang             TEXT NOT NULL DEFAULT 'it',
  status           TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | suspended
  discount_percent REAL NOT NULL DEFAULT 0,           -- sconto extra sulla tariffa B2B base
  cancel_hours     INTEGER,                           -- NULL = politica predefinita B2B
  allow_invoice    INTEGER NOT NULL DEFAULT 1,        -- pagamento a fattura/bonifico
  admin_notes      TEXT,
  created_at       TEXT NOT NULL,
  approved_at      TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id                    INTEGER PRIMARY KEY,
  ref                   TEXT NOT NULL UNIQUE,
  token                 TEXT NOT NULL,
  tour_slug             TEXT NOT NULL,
  date                  TEXT NOT NULL,
  start_time            TEXT NOT NULL,
  end_time              TEXT NOT NULL,
  buffer_min            INTEGER NOT NULL DEFAULT 0,
  participants          INTEGER NOT NULL,
  channel               TEXT NOT NULL,                -- b2c | b2b
  account_id            INTEGER REFERENCES accounts(id),
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  lang                  TEXT NOT NULL DEFAULT 'it',
  notes                 TEXT,
  client_ref            TEXT,                         -- B2B: riferimento pratica / nome gruppo
  billing_json          TEXT,                         -- dati per la fattura (se richiesta)
  total_cents           INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'EUR',
  status                TEXT NOT NULL,                -- held | confirmed | cancelled | expired
  payment_method        TEXT NOT NULL,                -- card | onsite | invoice
  payment_status        TEXT NOT NULL,                -- unpaid | paid | refunded | refund_failed
  stripe_session_id     TEXT,
  stripe_payment_intent TEXT,
  hold_expires_at       TEXT,
  free_cancel_until     TEXT NOT NULL,
  cancelled_at          TEXT,
  cancelled_by          TEXT,                         -- customer | admin | system
  cancel_reason         TEXT,
  refund_cents          INTEGER NOT NULL DEFAULT 0,
  admin_notes           TEXT,
  created_at            TEXT NOT NULL,
  confirmed_at          TEXT
);
CREATE INDEX IF NOT EXISTS bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS bookings_account ON bookings(account_id);
CREATE INDEX IF NOT EXISTS bookings_session ON bookings(stripe_session_id);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Esegue `fn` in una transazione (BEGIN IMMEDIATE: nessun altro scrittore nel frattempo). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
