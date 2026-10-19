// Lista d'attesa delle agenzie («avvisami se si libera»): una data tenuta in opzione da un altro operatore (o completa) si può seguire;
// appena torna prenotabile l'agenzia riceve un'email (vedi waitlistServices.js). Qui solo regole e database.
//
// Regole in breve:
// - si può chiedere l'avviso solo per una data che ADESSO non ha posto (se c'è, si prenota subito) ma che in un giorno di lavoro
//   avrebbe posto senza le prenotazioni di altri: non per giorni chiusi, passati, fuori dalla finestra o dove il posto manca per le sue stesse pratiche;
// - un avviso vale per un servizio, un giorno, un numero di persone e (facoltativo) un orario, una durata (servizi a ore) e una lingua;
// - al massimo MAX_ACTIVE avvisi attivi per agenzia; non si ripete lo stesso avviso (servizio, giorno, orario, persone, durata e lingua);
// - nessuno riserva la data per chi aspetta: gli avvisi partono a tutti gli interessati e la prende chi prenota per primo.
import { dayOverviewFor } from './availability.js';
import { hourOptions, openTo } from './rates.js';
import { addDays, isDate, isTime, nowRome } from './time.js';

export const MAX_ACTIVE = 10;
const iso = (ms) => new Date(ms).toISOString();
const ACTIVE = `('waiting', 'notified')`;

export class WaitlistError extends Error {
  /** `code`: invalid | closed | free | mine | dup | limit */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

/**
 * Servizio, persone, giorno, e (facoltativi) orario, durata e lingua letti da un modulo o da un indirizzo.
 * @returns {{tour: object, pax: number, date: string, time: string|null, hours: number|null, tourLang: string|null, durationMin: number|null}|null} null se non è valido
 */
export function readWait(app, src = {}) {
  const tour = app.content.tour(String(src.tour ?? ''));
  const pax = Number.parseInt(src.pax, 10);
  if (!tour?.active || !openTo(app.rates.get(), tour, 'b2b') || !Number.isInteger(pax) || pax < 1 || pax > tour.maxParticipants || !isDate(src.date)) return null;
  let time = null;
  if (src.time) {
    if (!isTime(src.time) || (!tour.flexible && !tour.times.includes(src.time))) return null;
    time = src.time;
  }
  let hours = null;
  if (tour.pricing === 'hourly') {
    hours = tour.chooseHours ? Number(src.hours) : tour.durationMin / 60;
    if (tour.chooseHours && !hourOptions(tour.service).includes(hours)) return null;
  }
  const asked = String(src.tl ?? src.tourLang ?? '');
  const tourLang = tour.languages.includes(asked) ? asked : null;
  return { tour, pax, date: src.date, time, hours, tourLang, durationMin: hours != null ? Math.round(hours * 60) : null };
}

export const getEntry = (db, id) => db.prepare('SELECT * FROM waitlist WHERE id = ?').get(id);

/** Gli avvisi attivi di un'agenzia (in attesa o già scattati) per date non passate, i più vicini per primi. */
export const entriesOf = (db, accountId, today) => db.prepare(`SELECT * FROM waitlist WHERE account_id = ? AND status IN ${ACTIVE} AND date >= ? ORDER BY date, COALESCE(time, ''), id`).all(accountId, today);

/**
 * L'agenzia chiede di essere avvisata se questa data si libera.
 * @throws {WaitlistError} invalid | closed (non si può seguire: giorno chiuso, passato…) | free (si può già prenotare) | mine | dup | limit
 */
export function joinWaitlist(app, account, src, nowMs = Date.now()) {
  const { db, cfg } = app;
  const w = readWait(app, src);
  if (!w) throw new WaitlistError('invalid');
  const today = nowRome(nowMs).date;
  if (w.date < today || w.date > addDays(today, cfg.policy.maxAdvanceDays)) throw new WaitlistError('closed');
  const ov = dayOverviewFor(db, cfg, w.tour, w.date, { pax: w.pax, channel: 'b2b', nowMs, durationMin: w.durationMin, tourLang: w.tourLang, accountId: account.id });
  if (w.time ? ov.slots.some((s) => s.time === w.time) : ov.slots.length > 0) throw new WaitlistError('free');
  if (w.time ? !ov.possible.some((s) => s.time === w.time) : !ov.possible.length) throw new WaitlistError('closed');
  if (!w.time && ov.state === 'mine') throw new WaitlistError('mine');
  if (db.prepare(`SELECT 1 FROM waitlist WHERE account_id = ? AND tour_slug = ? AND date = ? AND COALESCE(time, '') = ? AND pax = ? AND COALESCE(hours, 0) = ? AND COALESCE(tour_lang, '') = ? AND status IN ${ACTIVE}`).get(account.id, w.tour.slug, w.date, w.time ?? '', w.pax, w.hours ?? 0, w.tourLang ?? '')) throw new WaitlistError('dup');
  if (db.prepare(`SELECT COUNT(*) AS n FROM waitlist WHERE account_id = ? AND status IN ${ACTIVE} AND date >= ?`).get(account.id, today).n >= MAX_ACTIVE) throw new WaitlistError('limit');
  const id = Number(db.prepare(`INSERT INTO waitlist (account_id, tour_slug, date, time, pax, hours, tour_lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(account.id, w.tour.slug, w.date, w.time, w.pax, w.hours, w.tourLang, iso(nowMs)).lastInsertRowid);
  return getEntry(db, id);
}

/** L'agenzia toglie un suo avviso. */
export const removeEntry = (db, accountId, id) => db.prepare(`UPDATE waitlist SET status = 'cancelled' WHERE id = ? AND account_id = ? AND status IN ${ACTIVE}`).run(id, accountId).changes === 1;

/** Dopo un avviso già scattato l'agenzia può rimettersi in lista (qualcun altro è stato più veloce, o ha cambiato idea). */
export const rearmEntry = (db, accountId, id, today) => db.prepare(`UPDATE waitlist SET status = 'waiting', notified_at = NULL, notified_time = NULL WHERE id = ? AND account_id = ? AND status = 'notified' AND date >= ?`).run(id, accountId, today).changes === 1;

/** Gli avvisi con la data passata non servono più. */
export const expireEntries = (db, today) => db.prepare(`UPDATE waitlist SET status = 'expired' WHERE status IN ${ACTIVE} AND date < ?`).run(today).changes;

/** Chi ha prenotato quel che aspettava (stesso servizio e giorno, dopo aver chiesto l'avviso) esce dalla lista. */
export function settleBooked(db, nowMs = Date.now()) {
  const now = iso(nowMs);
  return db
    .prepare(
      `UPDATE waitlist SET status = 'booked' WHERE status IN ${ACTIVE} AND EXISTS (
         SELECT 1 FROM bookings b WHERE b.account_id = waitlist.account_id AND b.tour_slug = waitlist.tour_slug AND b.date = waitlist.date
           AND (waitlist.time IS NULL OR b.start_time = waitlist.time) AND b.created_at >= waitlist.created_at
           AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > ?) OR (b.status = 'option' AND b.option_expires_at > ?)))`,
    )
    .run(now, now).changes;
}

/** Gli avvisi ancora in attesa di agenzie approvate, con i dati per scriver loro; le date più vicine per prime. */
export const waitingEntries = (db, today) =>
  db
    .prepare(
      `SELECT w.*, a.email AS acct_email, a.contact_name AS acct_name, a.company AS acct_company, a.lang AS acct_lang FROM waitlist w JOIN accounts a ON a.id = w.account_id
       WHERE w.status = 'waiting' AND w.date >= ? AND a.status = 'approved' ORDER BY w.date, w.id`,
    )
    .all(today);

/** Per il pannello: tutti gli avvisi attivi, con l'agenzia. */
export const allActive = (db, today) =>
  db
    .prepare(`SELECT w.*, a.company AS acct_company, a.email AS acct_email FROM waitlist w JOIN accounts a ON a.id = w.account_id WHERE w.status IN ${ACTIVE} AND w.date >= ? ORDER BY w.date, COALESCE(w.time, ''), w.id`)
    .all(today);

/** Quanti avvisi sono ancora in attesa (per il riepilogo del pannello). */
export const waitingCount = (db, today) => db.prepare(`SELECT COUNT(*) AS n FROM waitlist WHERE status = 'waiting' AND date >= ?`).get(today).n;

/** Le prenotazioni vive di quel giorno (di altri) che occupano il posto: dicono alla guida chi tiene la data e fino a quando. */
export function blockersOf(db, entry, nowMs = Date.now()) {
  const now = iso(nowMs);
  return db
    .prepare(
      `SELECT b.id, b.ref, b.status, b.tour_slug, b.start_time, b.end_time, b.participants, b.option_expires_at, a.company FROM bookings b LEFT JOIN accounts a ON a.id = b.account_id
       WHERE b.date = ? AND b.account_id IS NOT ? AND (b.status = 'confirmed' OR (b.status = 'held' AND b.hold_expires_at > ?) OR (b.status = 'option' AND b.option_expires_at > ?))
       ORDER BY b.start_time, b.id`,
    )
    .all(entry.date, entry.account_id, now, now);
}

/** Quante date l'agenzia ha poi prenotato dopo essere stata avvisata (le date «recuperate»), dal giorno indicato (ISO) in poi. */
export const recoveredCount = (db, sinceIso) => db.prepare(`SELECT COUNT(*) AS n FROM waitlist WHERE status = 'booked' AND notified_at IS NOT NULL AND notified_at >= ?`).get(sinceIso).n;

/** Avvisi già scattati e ancora aperti, o chiusi con una prenotazione: servono al riepilogo del pannello. */
export const notifiedCount = (db, sinceIso) => db.prepare(`SELECT COUNT(*) AS n FROM waitlist WHERE notified_at IS NOT NULL AND notified_at >= ?`).get(sinceIso).n;
