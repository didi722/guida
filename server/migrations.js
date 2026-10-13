// Migrazioni del database. Ogni voce dell'elenco porta lo schema alla versione successiva
// (PRAGMA user_version). NON modificare le voci già pubblicate: aggiungine una nuova in fondo.
const BASE_SCHEMA = `
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

const V2_PROMO_GIFT = `
-- Sconti e buoni regalo
ALTER TABLE bookings ADD COLUMN list_cents INTEGER;                          -- prezzo di listino prima dello sconto
ALTER TABLE bookings ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN promo_code_id INTEGER;
ALTER TABLE bookings ADD COLUMN promo_code TEXT;
ALTER TABLE bookings ADD COLUMN gift_cents INTEGER NOT NULL DEFAULT 0;       -- quota pagata con buoni regalo

CREATE TABLE promo_codes (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind            TEXT NOT NULL,        -- percent | fixed
  value           INTEGER NOT NULL,     -- percentuale (1-100) oppure centesimi
  valid_from      TEXT, valid_to TEXT,  -- quando il codice si può usare (data della prenotazione)
  service_from    TEXT, service_to TEXT,-- a quali date di servizio si applica
  max_uses        INTEGER,
  one_per_email   INTEGER NOT NULL DEFAULT 0,
  tours           TEXT,                 -- JSON: elenco di slug, NULL = tutti i tour
  min_total_cents INTEGER,
  active          INTEGER NOT NULL DEFAULT 1,
  note            TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE gift_cards (
  id                    INTEGER PRIMARY KEY,
  ref                   TEXT NOT NULL UNIQUE,   -- GC-XXXXXX (ordine d'acquisto)
  token                 TEXT NOT NULL,
  code                  TEXT NOT NULL UNIQUE,   -- da inserire al checkout (12 caratteri)
  status                TEXT NOT NULL,          -- pending | active | void
  initial_cents         INTEGER NOT NULL,
  balance_cents         INTEGER NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'EUR',
  source                TEXT NOT NULL DEFAULT 'web',   -- web | admin
  buyer_name            TEXT, buyer_email TEXT,
  recipient_name        TEXT, recipient_email TEXT,
  message               TEXT,
  lang                  TEXT NOT NULL DEFAULT 'it',
  deliver_on            TEXT,                   -- data di consegna al destinatario
  delivered_at          TEXT,
  stripe_session_id     TEXT, stripe_payment_intent TEXT,
  billing_json          TEXT,
  created_at            TEXT NOT NULL,
  activated_at          TEXT,
  expires_at            TEXT,                   -- data (YYYY-MM-DD)
  admin_notes           TEXT
);

-- Registro dei movimenti: il saldo è sempre la somma dei movimenti
CREATE TABLE gift_card_ledger (
  id           INTEGER PRIMARY KEY,
  gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id),
  delta_cents  INTEGER NOT NULL,
  kind         TEXT NOT NULL,                   -- issue | redeem | restore | adjust
  booking_id   INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX gift_ledger_card ON gift_card_ledger(gift_card_id);
CREATE INDEX gift_ledger_booking ON gift_card_ledger(booking_id);
`;

const V3_REVIEWS = `
ALTER TABLE bookings ADD COLUMN review_status TEXT;      -- NULL = da inviare | sent | skipped
ALTER TABLE bookings ADD COLUMN review_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN review_attempt_at TEXT;

CREATE TABLE feedback (
  id          INTEGER PRIMARY KEY,
  booking_id  INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  rating      INTEGER NOT NULL,            -- 1-5
  comment     TEXT,
  may_publish INTEGER NOT NULL DEFAULT 0,  -- il cliente accetta che il commento sia citato sul sito
  created_at  TEXT NOT NULL
);
`;

const V4_CALENDARS = `
-- Calendari esterni (es. Google Calendar via indirizzo segreto iCal): gli impegni bloccano le disponibilità
CREATE TABLE calendar_sources (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  last_attempt_at TEXT,
  last_ok_at      TEXT,
  last_error      TEXT,
  event_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE external_busy (
  id         INTEGER PRIMARY KEY,
  source_id  INTEGER NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  title      TEXT,
  uid        TEXT
);
CREATE INDEX external_busy_date ON external_busy(date);
`;

const V5_PROGRAMS = `
-- Programmi di più giorni: richiesta del cliente → proposta → accettazione (con acconto)
CREATE TABLE programs (
  id                    INTEGER PRIMARY KEY,
  ref                   TEXT NOT NULL UNIQUE,              -- PR-XXXXXX
  token                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'new',       -- new | quoted | accepted | confirmed | declined | closed
  channel               TEXT NOT NULL DEFAULT 'b2c',       -- b2c | b2b
  account_id            INTEGER REFERENCES accounts(id),
  client_ref            TEXT,
  lang                  TEXT NOT NULL DEFAULT 'it',
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  company               TEXT,
  date_from             TEXT, date_to TEXT,
  flexible_dates        INTEGER NOT NULL DEFAULT 0,
  participants          INTEGER NOT NULL,
  group_type            TEXT,
  interests             TEXT,                              -- JSON: elenco di temi
  accommodation         TEXT, mobility TEXT, budget TEXT, languages TEXT,
  message               TEXT,
  -- proposta
  proposal_title        TEXT, proposal_intro TEXT, proposal_notes TEXT,
  total_cents           INTEGER,
  currency              TEXT NOT NULL DEFAULT 'EUR',
  deposit_percent       INTEGER NOT NULL DEFAULT 0,
  deposit_cents         INTEGER NOT NULL DEFAULT 0,
  valid_until           TEXT,
  hold_dates            INTEGER NOT NULL DEFAULT 0,        -- le date restano bloccate finché la proposta è valida
  proposal_sent_at      TEXT,
  -- esito
  accepted_at           TEXT, declined_at TEXT,
  deposit_status        TEXT NOT NULL DEFAULT 'none',      -- none | pending | paid | refunded
  stripe_session_id     TEXT, stripe_payment_intent TEXT, deposit_paid_at TEXT,
  admin_notes           TEXT,
  created_at            TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE program_days (
  id          INTEGER PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  date        TEXT NOT NULL,
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX program_days_date ON program_days(date);
CREATE INDEX program_days_program ON program_days(program_id);
`;

const V6_INVOICES = `
-- Fatture elettroniche (FatturaPA) e note di credito
CREATE TABLE invoices (
  id                  INTEGER PRIMARY KEY,
  status              TEXT NOT NULL DEFAULT 'draft',   -- draft | issued | sent | delivered | rejected | undelivered
  doc_type            TEXT NOT NULL DEFAULT 'TD01',    -- TD01 fattura | TD04 nota di credito
  year                INTEGER, seq INTEGER, number TEXT,   -- assegnati all'emissione: N/AAAA, senza buchi
  issue_date          TEXT,
  related_id          INTEGER REFERENCES invoices(id), -- nota di credito: la fattura stornata
  credited            INTEGER NOT NULL DEFAULT 0,      -- la fattura è stata stornata per intero
  account_id          INTEGER REFERENCES accounts(id),
  buyer_json          TEXT NOT NULL,                   -- intestatario (copia: non cambia se cambiano i dati del partner)
  options_json        TEXT NOT NULL DEFAULT '{}',      -- bollo addebitato, rivalsa, ritenuta, causale aggiuntiva, tentativi di invio…
  config_json         TEXT,                            -- impostazioni fiscali usate all'emissione (regime, aliquota, natura…)
  taxable_cents       INTEGER NOT NULL DEFAULT 0,
  vat_cents           INTEGER NOT NULL DEFAULT 0,
  bollo_cents         INTEGER NOT NULL DEFAULT 0,      -- bollo virtuale dovuto (2 €)
  bollo_charged       INTEGER NOT NULL DEFAULT 0,      -- 1 = addebitato al cliente con una riga in fattura
  contribution_cents  INTEGER NOT NULL DEFAULT 0,
  withholding_cents   INTEGER NOT NULL DEFAULT 0,
  rounding_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  payable_cents       INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  payments_json       TEXT,                            -- [{method, cents, dueDate}]
  file_name           TEXT, xml TEXT,
  sent_at             TEXT, emailed_at TEXT, status_at TEXT, sdi_note TEXT,
  created_at          TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX invoices_number ON invoices(year, seq) WHERE seq IS NOT NULL;
CREATE INDEX invoices_status ON invoices(status);
CREATE INDEX invoices_related ON invoices(related_id);

CREATE TABLE invoice_lines (
  id            INTEGER PRIMARY KEY,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,                      -- importo come indicato (lordo se i prezzi comprendono l'IVA)
  net_cents     INTEGER NOT NULL DEFAULT 0,
  vat_bp        INTEGER NOT NULL DEFAULT 0,            -- aliquota in punti base (2200 = 22%)
  nature        TEXT,
  source_type   TEXT,                                  -- booking | gift | program: da dove viene la riga
  source_id     INTEGER,
  source_payments TEXT,                                -- JSON [{method: MP08|MP05|MP01|null, cents, paid}]: come è stata o sarà pagata
  released      INTEGER NOT NULL DEFAULT 0             -- 1 = la voce è di nuovo fatturabile (fattura stornata)
);
CREATE UNIQUE INDEX invoice_lines_source ON invoice_lines(source_type, source_id) WHERE source_type IS NOT NULL AND released = 0;
CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id);

ALTER TABLE accounts ADD COLUMN billing_json TEXT;     -- dati di fatturazione strutturati del partner, per precompilare le prossime fatture
`;

const V7_INVOICE_FILES = `
-- Progressivo univoco del file inviato a SdI: non si riusa mai, nemmeno dopo un annullamento
ALTER TABLE invoices ADD COLUMN file_seq INTEGER;
CREATE UNIQUE INDEX invoices_file_seq ON invoices(file_seq) WHERE file_seq IS NOT NULL;
`;

const V8_PARTNER_TERMS = `
-- Condizioni dedicate ai partner: listino e politica di annullo a scaglioni
ALTER TABLE accounts ADD COLUMN prices_json TEXT;                  -- listino dedicato {"slug-del-tour": centesimi}; assente = tariffa B2B meno lo sconto %
ALTER TABLE accounts ADD COLUMN cancel_policy_json TEXT;           -- [{"hours":168,"refund":100},{"hours":72,"refund":50}]; NULL = ore singole (cancel_hours) o predefinito del sito
ALTER TABLE bookings ADD COLUMN cancel_policy_json TEXT;           -- scaglioni validi al momento della prenotazione (non cambiano se poi cambi le condizioni)
ALTER TABLE bookings ADD COLUMN cancel_percent INTEGER;            -- annullata: percentuale di rimborso applicata
ALTER TABLE bookings ADD COLUMN retained_cents INTEGER NOT NULL DEFAULT 0;  -- annullata: importo che resta dovuto (penale), trattenuto o da fatturare
`;

const V9_CONTENT = `
-- Contenuti modificabili dal pannello: tour, articoli, pagine, testi del sito, immagini
CREATE TABLE content_tours (slug TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE content_posts (slug TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE content_pages (name TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE content_texts (key TEXT NOT NULL, lang TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (key, lang));
CREATE TABLE media (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,   -- file a risoluzione piena (nome = impronta del contenuto + estensione)
  small_name  TEXT,                   -- versione piccola per gli elenchi
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  created_at  TEXT NOT NULL
);
`;

const V10_REMINDERS = `
-- Promemoria ai clienti la sera prima del tour
ALTER TABLE bookings ADD COLUMN reminder_status TEXT;      -- NULL = da inviare | sent | skipped
ALTER TABLE bookings ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE bookings ADD COLUMN reminder_attempt_at TEXT;
`;

const V11_FEATURED_FEEDBACK = `
-- Commenti dei clienti scelti per essere mostrati sul sito (solo se il cliente ha dato il permesso)
ALTER TABLE feedback ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
`;

const V12_SERVICE_JSON = `
-- Servizi a ore: ore, supplementi e voci del conto (si conservano con la prenotazione)
ALTER TABLE bookings ADD COLUMN service_json TEXT;
`;

const V13_OPTIONS = `
-- Opzioni delle agenzie: la data resta trattenuta fino a una scadenza (status 'option'), poi si libera da sola
ALTER TABLE bookings ADD COLUMN option_expires_at TEXT;       -- fino a quando lo slot resta trattenuto (si conserva anche dopo la conferma o la scadenza)
ALTER TABLE bookings ADD COLUMN option_reminded_at TEXT;      -- promemoria di scadenza già inviato
ALTER TABLE accounts ADD COLUMN options_enabled INTEGER NOT NULL DEFAULT 1;  -- il partner può opzionare
ALTER TABLE accounts ADD COLUMN option_days INTEGER;          -- durata fissa dell'opzione (giorni) per questo partner; NULL = tabella del sito
ALTER TABLE accounts ADD COLUMN option_max INTEGER;           -- massimo di opzioni aperte insieme per questo partner; NULL = valore del sito
CREATE INDEX IF NOT EXISTS bookings_option ON bookings(status, option_expires_at);
`;

const V14_REVIEW_TRANSLATIONS = `
-- Traduzioni automatiche dei commenti in evidenza (una per lingua del sito). Se il cliente cambia il commento, l'impronta non coincide più e la traduzione non si usa.
CREATE TABLE feedback_translations (
  feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,               -- lingua della traduzione (it | en | es | ja)
  src_hash    TEXT NOT NULL,               -- impronta del commento tradotto
  src_lang    TEXT,                        -- lingua del commento originale, riconosciuta dal servizio di traduzione
  same        INTEGER NOT NULL DEFAULT 0,  -- 1 = il commento è già scritto in questa lingua: niente da tradurre
  text        TEXT,
  provider    TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (feedback_id, lang)
);
`;

const V15_LANG_PRIVATE_INVITES = `
-- Lingua in cui si svolge il tour (diversa dalla lingua della conferma, bookings.lang): in un tour condiviso a posti, la lingua del primo che prenota
-- vincola quella partenza. NULL = prenotazione di prima (nessun vincolo).
ALTER TABLE bookings ADD COLUMN tour_lang TEXT;

-- Impegni privati in agenda (tour presi fuori dal sito): sono blocchi orari con un titolo; una serie di giorni si elimina insieme.
ALTER TABLE blocks ADD COLUMN title TEXT;
ALTER TABLE blocks ADD COLUMN details TEXT;
ALTER TABLE blocks ADD COLUMN kind TEXT NOT NULL DEFAULT 'external';  -- external (altra agenzia, impegno) | private (tour preso privatamente)
ALTER TABLE blocks ADD COLUMN series TEXT;

-- Inviti a un amico: ogni invito ha un suo codice sconto, valido una volta sola, per quella partenza.
CREATE TABLE invites (
  id            INTEGER PRIMARY KEY,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id),
  promo_code_id INTEGER NOT NULL REFERENCES promo_codes(id),
  code          TEXT NOT NULL,
  friend_email  TEXT,
  sent_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX invites_booking ON invites(booking_id);
`;

export const MIGRATIONS = [
  // v1 — schema iniziale (prenotazioni, partner, orari, blocchi)
  BASE_SCHEMA,
  // v2 — codici sconto e buoni regalo
  V2_PROMO_GIFT,
  // v3 — richiesta di recensione e feedback
  V3_REVIEWS,
  // v4 — calendari esterni
  V4_CALENDARS,
  // v5 — programmi di più giorni
  V5_PROGRAMS,
  // v6 — fatture elettroniche
  V6_INVOICES,
  // v7 — progressivo univoco dei file di fattura
  V7_INVOICE_FILES,
  // v8 — condizioni dedicate ai partner (listino, scaglioni di annullo)
  V8_PARTNER_TERMS,
  // v9 — contenuti nel database (tour, articoli, pagine, testi, immagini)
  V9_CONTENT,
  // v10 — promemoria il giorno prima
  V10_REMINDERS,
  // v11 — commenti dei clienti mostrati sul sito
  V11_FEATURED_FEEDBACK,
  // v12 — dettaglio dei servizi a ore
  V12_SERVICE_JSON,
  // v13 — opzioni delle agenzie
  V13_OPTIONS,
  // v14 — traduzioni automatiche dei commenti
  V14_REVIEW_TRANSLATIONS,
  // v15 — lingua del tour, impegni privati in agenda, inviti a un amico
  V15_LANG_PRIVATE_INVITES,
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migrazione ${i + 1} fallita: ${err.message}`);
    }
  }
}
