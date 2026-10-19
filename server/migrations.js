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

const V16_THEME = `
-- Scelta tematica del cliente in un tour (voci in tutte le lingue come {"labels":{"it":…}} oppure {"other":true} + testo libero per la guida).
ALTER TABLE bookings ADD COLUMN theme_json TEXT;
ALTER TABLE bookings ADD COLUMN theme_note TEXT;
`;

const V17_PICKUP = `
-- Punto d'incontro scritto dal cliente (hotel o altro) nei tour in cui lo sceglie lui; vuoto = quello standard.
ALTER TABLE bookings ADD COLUMN pickup TEXT;
`;

const V18_PENALTY_REMINDER = `
-- Promemoria all'agenzia: la cancellazione gratuita sta per finire (si manda una volta sola).
ALTER TABLE bookings ADD COLUMN penalty_reminded_at TEXT;
`;

const V19_PACKAGES = `
-- Pacchetto: più servizi prenotati insieme da un'agenzia (stessa opzione, stesso pagamento). Ogni servizio resta una prenotazione.
CREATE TABLE booking_groups (
  id                    INTEGER PRIMARY KEY,
  ref                   TEXT NOT NULL UNIQUE,            -- PT-XXXXXX
  token                 TEXT NOT NULL,
  account_id            INTEGER NOT NULL REFERENCES accounts(id),
  client_ref            TEXT,
  name                  TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  notes                 TEXT,
  lang                  TEXT NOT NULL DEFAULT 'it',
  currency              TEXT NOT NULL DEFAULT 'EUR',
  due_cents             INTEGER NOT NULL DEFAULT 0,      -- quanto si chiede con la carta (serve a riconoscere il pagamento quando arriva)
  stripe_session_id     TEXT,
  stripe_payment_intent TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX booking_groups_account ON booking_groups(account_id);
ALTER TABLE bookings ADD COLUMN group_id INTEGER REFERENCES booking_groups(id);
CREATE INDEX bookings_group ON bookings(group_id);

-- Il pacchetto in preparazione: i servizi aggiunti e non ancora prenotati (non trattengono nulla).
CREATE TABLE cart_items (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX cart_items_account ON cart_items(account_id);
`;

const V20_CHANGES = `
-- Modifiche fatte dall'agenzia da sola (persone, data, ore) e richieste di proroga di un'opzione.
ALTER TABLE bookings ADD COLUMN custom_price INTEGER NOT NULL DEFAULT 0;   -- prezzo concordato a mano (registrato dall'agenda): non si ricalcola
ALTER TABLE bookings ADD COLUMN modified_at TEXT;                          -- ultima modifica fatta dall'agenzia
ALTER TABLE bookings ADD COLUMN policy_base_json TEXT;                     -- scadenze di annullo di partenza (data e scaglioni): spostare la data non le allunga mai

CREATE TABLE booking_changes (
  id          INTEGER PRIMARY KEY,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  by          TEXT NOT NULL,                                                -- customer | admin
  before_json TEXT NOT NULL,
  after_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX booking_changes_booking ON booking_changes(booking_id);

CREATE TABLE extension_requests (
  id           INTEGER PRIMARY KEY,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  group_id     INTEGER REFERENCES booking_groups(id),                       -- se l'opzione fa parte di un pacchetto: vale per tutto il pacchetto
  days         INTEGER NOT NULL,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',                             -- pending | approved | denied
  granted_days INTEGER,
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX extension_requests_status ON extension_requests(status);
CREATE INDEX extension_requests_booking ON extension_requests(booking_id);
`;

const V21_INVOICE_PAYMENTS = `
-- Pagamento delle fatture: incasso, pagamento con carta (un collegamento per fattura) e solleciti delle fatture scadute.
ALTER TABLE invoices ADD COLUMN paid_at TEXT;                       -- incassata il
ALTER TABLE invoices ADD COLUMN paid_method TEXT;                   -- bank | card | other
ALTER TABLE invoices ADD COLUMN pay_ref TEXT;                       -- IN-XXXXXX: serve a pagare con la carta e ad aprire la pagina di pagamento
ALTER TABLE invoices ADD COLUMN pay_token TEXT;
ALTER TABLE invoices ADD COLUMN stripe_session_id TEXT;
ALTER TABLE invoices ADD COLUMN stripe_payment_intent TEXT;
ALTER TABLE invoices ADD COLUMN overdue_reminded_at TEXT;           -- ultimo sollecito
ALTER TABLE invoices ADD COLUMN overdue_reminders INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX invoices_pay_ref ON invoices(pay_ref) WHERE pay_ref IS NOT NULL;
`;

const V22_WAITLIST = `
-- Lista d'attesa delle agenzie: «avvisami se si libera» (una data tenuta in opzione, o completa).
CREATE TABLE waitlist (
  id            INTEGER PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tour_slug     TEXT NOT NULL,
  date          TEXT NOT NULL,
  time          TEXT,                                                       -- NULL = un orario qualsiasi di quel giorno
  pax           INTEGER NOT NULL,
  hours         REAL,                                                       -- servizi a ore: la durata voluta
  tour_lang     TEXT,                                                       -- partenze condivise: la lingua voluta
  status        TEXT NOT NULL DEFAULT 'waiting',                            -- waiting | notified | booked | cancelled | expired
  created_at    TEXT NOT NULL,
  notified_at   TEXT,
  notified_time TEXT                                                        -- il primo orario che si è liberato
);
CREATE INDEX waitlist_status_date ON waitlist(status, date);
CREATE INDEX waitlist_account ON waitlist(account_id, status);
`;

const V23_AGENCY_DOCS = `
-- Documenti dell'agenzia per il suo cliente finale: nome, logo e recapiti sui voucher e sui preventivi, ricarico dei preventivi.
ALTER TABLE accounts ADD COLUMN doc_name TEXT;                              -- nome sui documenti (vuoto = ragione sociale)
ALTER TABLE accounts ADD COLUMN doc_contact TEXT;                           -- recapiti sui documenti (email, telefono, sito)
ALTER TABLE accounts ADD COLUMN doc_footer TEXT;                            -- nota in fondo ai preventivi (condizioni, IVA…)
ALTER TABLE accounts ADD COLUMN markup_percent REAL NOT NULL DEFAULT 0;     -- ricarico predefinito sui preventivi
ALTER TABLE accounts ADD COLUMN markup_round INTEGER NOT NULL DEFAULT 5;    -- i prezzi al cliente si arrotondano per eccesso a N euro (1, 5 o 10)
ALTER TABLE accounts ADD COLUMN logo_on_voucher INTEGER NOT NULL DEFAULT 1; -- mostra il logo sui voucher

CREATE TABLE account_logos (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const V24_AGENCY_FEED = `
-- Calendario in abbonamento (.ics) di ogni agenzia: un indirizzo privato con una chiave che si può rigenerare.
ALTER TABLE accounts ADD COLUMN ics_key TEXT;
CREATE UNIQUE INDEX accounts_ics_key ON accounts(ics_key) WHERE ics_key IS NOT NULL;
`;

const V25_STATEMENTS = `
-- Estratto conto mensile: chi lo vuole ricevere per email, e a chi è già stato mandato (o saltato perché non c'era nulla da dire)
ALTER TABLE accounts ADD COLUMN statement_email INTEGER NOT NULL DEFAULT 1;
CREATE TABLE statement_sends (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,                -- AAAA-MM
  status     TEXT NOT NULL,                -- sent | skipped
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (account_id, month)
);
`;

const V26_WAITLIST_QUEUE = `
-- Lista d'attesa a coda: l'ordine è quello in cui l'agenzia è entrata in lista (o si è rimessa in lista dopo un avviso)
ALTER TABLE waitlist ADD COLUMN queued_at TEXT;
UPDATE waitlist SET queued_at = created_at;
`;

const V27_ADMIN_CHANGES = `
-- Modifiche fatte dalla guida dal pannello: la nota per il cliente e, se il rimborso della differenza non è riuscito, quanto resta da rimborsare a mano
ALTER TABLE booking_changes ADD COLUMN note TEXT;
ALTER TABLE bookings ADD COLUMN refund_pending_cents INTEGER NOT NULL DEFAULT 0;
`;

const V28_PERIODS = `
-- Periodi con regole particolari (alta stagione, Carnevale…): intervalli di date del SERVIZIO in cui le opzioni delle agenzie e il preavviso minimo cambiano
CREATE TABLE periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  options_mode TEXT NOT NULL DEFAULT 'normal' CHECK (options_mode IN ('normal', 'short', 'off')),
  option_max_days INTEGER,
  option_release_hours INTEGER,
  notice_b2c_hours INTEGER,
  notice_b2b_hours INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_periods_from ON periods(date_from);
`;

const V29_PARTNER_ONBOARDING = `
-- Verifica della partita IVA delle agenzie (controllo formale e VIES): esito, quando e cosa dice il registro
ALTER TABLE accounts ADD COLUMN vat_status TEXT;
ALTER TABLE accounts ADD COLUMN vat_checked_at TEXT;
ALTER TABLE accounts ADD COLUMN vat_name TEXT;
ALTER TABLE accounts ADD COLUMN vat_address TEXT;

-- Inviti alle agenzie: un collegamento personale (se ne conserva solo l'impronta) che apre la registrazione con l'account già approvato
CREATE TABLE partner_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  company TEXT,
  contact_name TEXT,
  lang TEXT NOT NULL DEFAULT 'it',
  note TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  cancelled_at TEXT
);
CREATE INDEX idx_partner_invites_email ON partner_invites(email);
`;

const V30_TEAM = `
-- Più persone per agenzia: ogni collaboratore ha il suo accesso (email e password) e lavora sulle prenotazioni dell'agenzia.
-- Il titolare resta nell'account (accounts); qui ci sono gli altri. La password è vuota finché non la sceglie dal collegamento dell'invito
-- (del quale si conserva solo l'impronta).
CREATE TABLE account_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'it',
  password_hash TEXT,
  token_hash TEXT UNIQUE,
  token_expires_at TEXT,
  invited_at TEXT NOT NULL,
  activated_at TEXT,
  last_login_at TEXT
);
CREATE INDEX idx_account_users_account ON account_users(account_id);
-- Chi ha prenotato: il collaboratore (vuoto = il titolare, o la guida dal pannello) e il suo nome com'era allora
ALTER TABLE bookings ADD COLUMN booked_by_user INTEGER;
ALTER TABLE bookings ADD COLUMN booked_by_name TEXT;
ALTER TABLE booking_groups ADD COLUMN booked_by_user INTEGER;
ALTER TABLE booking_groups ADD COLUMN booked_by_name TEXT;
-- Il pacchetto in preparazione è personale; l'avviso della lista d'attesa va a chi l'ha chiesto (vuoto = il titolare)
ALTER TABLE cart_items ADD COLUMN user_id INTEGER;
ALTER TABLE waitlist ADD COLUMN user_id INTEGER;
`;

const V31_QUOTES = `
-- Preventivi online delle agenzie: una fotografia dei servizi (tariffa dell'agenzia e prezzo al cliente) che l'agenzia manda al suo cliente
-- finale per email; il cliente lo apre dal collegamento e lo accetta o lo rifiuta. Non trattiene nessuna data.
CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,                       -- QT-XXXXXX
  token TEXT NOT NULL,                            -- il segreto del collegamento del cliente
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id INTEGER,                                -- chi dell'agenzia l'ha preparato (vuoto: il titolare)
  created_by TEXT,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_ref TEXT,
  lang TEXT NOT NULL DEFAULT 'it',                -- lingua del documento e dell'email al cliente
  markup_percent REAL NOT NULL DEFAULT 0,
  markup_round INTEGER NOT NULL DEFAULT 5,
  valid_until TEXT NOT NULL,                      -- AAAA-MM-GG, compreso
  note TEXT,
  lines_json TEXT NOT NULL,                       -- i servizi com'erano quando è stato preparato
  net_cents INTEGER NOT NULL,                     -- quanto paga l'agenzia (la sua tariffa)
  total_cents INTEGER NOT NULL,                   -- quanto vede il cliente (con il ricarico)
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'draft',           -- draft | sent | approved | declined (scaduto si ricava dalla data)
  sent_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  viewed_at TEXT,
  decided_at TEXT,
  decided_note TEXT,
  loaded_at TEXT,                                 -- quando l'agenzia ha rimesso i servizi nel pacchetto per prenotarli
  created_at TEXT NOT NULL
);
CREATE INDEX idx_quotes_account ON quotes(account_id, id);
`;

const V32_BILLING = `
-- Dati di fatturazione dell'azienda partner, tutti già in fase di registrazione (prima c'erano solo partita IVA, SDI/PEC, paese e indirizzo):
-- così la fattura si prepara già compilata. Chi aveva già ricevuto una fattura ha i dati nel riepilogo salvato (billing_json): si copiano qui.
ALTER TABLE accounts ADD COLUMN zip TEXT;
ALTER TABLE accounts ADD COLUMN city TEXT;
ALTER TABLE accounts ADD COLUMN province TEXT;
ALTER TABLE accounts ADD COLUMN tax_code TEXT;
UPDATE accounts SET
  address  = COALESCE(NULLIF(address, ''), json_extract(billing_json, '$.address')),
  zip      = json_extract(billing_json, '$.zip'),
  city     = json_extract(billing_json, '$.city'),
  province = json_extract(billing_json, '$.province'),
  tax_code = json_extract(billing_json, '$.taxCode')
WHERE billing_json IS NOT NULL AND json_valid(billing_json);
`;

const V33_PERIOD_CANCEL = `
-- Condizioni di annullo particolari per i servizi di un periodo (privati e agenzie), come scaglioni [{"hours":168,"refund":100},…]; vuoto = come il sito.
-- cancel_partners = 1: valgono anche per le agenzie che hanno una politica di annullo propria.
ALTER TABLE periods ADD COLUMN cancel_b2c_json TEXT;
ALTER TABLE periods ADD COLUMN cancel_b2b_json TEXT;
ALTER TABLE periods ADD COLUMN cancel_partners INTEGER NOT NULL DEFAULT 0;
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
  // v16 — scelta tematica del cliente
  V16_THEME,
  // v17 — punto d'incontro scelto dal cliente
  V17_PICKUP,
  // v18 — promemoria di fine cancellazione gratuita
  V18_PENALTY_REMINDER,
  // v19 — pacchetti di più servizi
  V19_PACKAGES,
  V20_CHANGES,
  V21_INVOICE_PAYMENTS,
  // v22 — lista d'attesa delle agenzie
  V22_WAITLIST,
  // v23 — logo, recapiti e ricarico dei documenti delle agenzie
  V23_AGENCY_DOCS,
  // v24 — calendario in abbonamento delle agenzie
  V24_AGENCY_FEED,
  // v25 — estratto conto mensile alle agenzie
  V25_STATEMENTS,
  // v26 — lista d'attesa a coda
  V26_WAITLIST_QUEUE,
  // v27 — modifiche delle prenotazioni dal pannello
  V27_ADMIN_CHANGES,
  // v28 — periodi con regole particolari
  V28_PERIODS,
  // v29 — verifica della partita IVA e inviti alle agenzie
  V29_PARTNER_ONBOARDING,
  V30_TEAM,
  V31_QUOTES,
  // v32 — dati di fatturazione completi dei partner
  V32_BILLING,
  // v33 — condizioni di annullo nei periodi
  V33_PERIOD_CANCEL,
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
