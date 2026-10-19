// Motore delle disponibilità.
//
// Regole (c'è una sola guida):
//  - Un servizio occupa [inizio, fine + pausa). Due servizi non possono sovrapporsi.
//  - Eccezione: i tour "a persona" (model: person) con la stessa partenza (stesso tour, stesso
//    orario) si sommano fino a `maxParticipants`.
//  - In una partenza condivisa la lingua del primo che prenota vincola quella partenza: chi viene dopo può unirsi solo nella stessa lingua
//    (così non si mescolano nello stesso gruppo persone che parlano lingue diverse).
//  - Un tour "a gruppo" (model: group, privato) blocca la fascia per chiunque altro.
//  - Una prenotazione, anche di una sola persona, occupa la sua fascia (più la pausa): gli orari degli altri tour che si sovrapporrebbero spariscono.
//  - Si può prenotare solo dentro gli orari di lavoro (modello settimanale + giorni speciali),
//    fuori dalle fasce bloccate e con il preavviso minimo.

import { getSetting } from './db.js';
import { paymentsFrom } from './opening.js';
import { addDays, dayOfWeek, fromMin, localToInstant, monthDates, nowRome, toMin } from './time.js';

/** Prenotazioni che occupano il calendario adesso: confermate, in attesa di pagamento (slot trattenuto) e opzioni non scadute. Servono due `now` (ISO). */
export const LIVE_BOOKING_SQL = `(status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?) OR (status = 'option' AND option_expires_at > ?))`;

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

/**
 * Carica in una volta sola tutto ciò che serve per calcolare le disponibilità in un intervallo di date.
 * `ignoreProgramId` esclude le giornate di un programma (per controllare i conflitti del programma stesso);
 * `holdsSentBefore` limita le proposte "trattenute" a quelle inviate prima di quell'istante ('' = nessuna):
 * chi ha inviato per primo ha la precedenza, e un programma già accettato non confligge con proposte arrivate dopo.
 */
export function loadAvailabilityContext(db, cfg, fromDate, toDate, nowMs, { ignoreProgramId = null, holdsSentBefore = null } = {}) {
  const weekly = getSetting(db, 'weekly', cfg.defaultWeekly);
  const overrides = new Map(db.prepare('SELECT * FROM day_overrides WHERE date BETWEEN ? AND ?').all(fromDate, toDate).map((r) => [r.date, r]));
  const blocks = groupBy(
    [
      ...db.prepare('SELECT date, start_time, end_time FROM blocks WHERE date BETWEEN ? AND ?').all(fromDate, toDate),
      // impegni letti dai calendari esterni (solo sorgenti attive)
      ...db
        .prepare(`SELECT e.date, e.start_time, e.end_time FROM external_busy e JOIN calendar_sources s ON s.id = e.source_id WHERE s.enabled = 1 AND e.date BETWEEN ? AND ?`)
        .all(fromDate, toDate),
      // giornate dei programmi di più giorni: accettate/confermate, oppure proposte con date trattenute ancora valide
      ...db
        .prepare(
          `SELECT d.date, d.start_time, d.end_time FROM program_days d JOIN programs p ON p.id = d.program_id
           WHERE d.date BETWEEN ? AND ? AND p.id != ?
             AND (p.status IN ('accepted', 'confirmed')
                  OR (p.status = 'quoted' AND p.hold_dates = 1 AND (p.valid_until IS NULL OR p.valid_until >= ?) AND (? IS NULL OR p.proposal_sent_at < ?)))`,
        )
        .all(fromDate, toDate, ignoreProgramId ?? -1, nowRome(nowMs).date, holdsSentBefore, holdsSentBefore),
    ],
    'date',
  );
  const bookings = groupBy(
    db
      .prepare(
        `SELECT id, tour_slug, date, start_time, end_time, buffer_min, participants, tour_lang, status, account_id FROM bookings
         WHERE date BETWEEN ? AND ? AND ${LIVE_BOOKING_SQL}`, // confermate, in pagamento e opzioni non scadute
      )
      .all(fromDate, toDate, new Date(nowMs).toISOString(), new Date(nowMs).toISOString()),
    'date',
  );
  return { weekly, overrides, blocks, bookings };
}

/** Fascia di lavoro del giorno ({from, to}) oppure null se la guida non lavora. */
export function dayWindow(ctx, date) {
  const o = ctx.overrides.get(date);
  if (o) return o.closed ? null : { from: o.from_time, to: o.to_time };
  const w = ctx.weekly[dayOfWeek(date)];
  return w?.open ? { from: w.from, to: w.to } : null;
}

export function minNoticeHours(cfg, channel) {
  return channel === 'b2b' ? cfg.policy.b2bMinNoticeHours : cfg.policy.b2cMinNoticeHours;
}

/**
 * Orari prenotabili di un tour in un giorno.
 * `tourLang`: se c'è, restano solo le partenze in cui si può prenotare in quella lingua (libere, oppure già in quella lingua).
 * @returns {{time:string,end:string,left:number,joined:boolean,lang:string|null}[]} `lang`: la lingua che vincola la partenza (solo se qualcuno ha già prenotato)
 */
export function slotsForDay(ctx, cfg, tour, date, { pax = 1, channel = 'b2c', nowMs, ignoreId = null, skipNotice = false, durationMin = null, tourLang = null }) {
  if (!tour.weekdays.includes(dayOfWeek(date))) return [];
  const win = dayWindow(ctx, date);
  if (!win) return [];

  const today = nowRome(nowMs).date;
  if (date < today || date > addDays(today, cfg.policy.maxAdvanceDays)) return [];
  if (date < (paymentsFrom(cfg) || '0000-00-00')) return []; // prima dell'apertura degli incassi non si prenota (vedi opening.js)

  const dur = durationMin ?? tour.durationMin; // i servizi a ore hanno la durata scelta dal cliente
  const buf = cfg.policy.bufferMin;
  const from = toMin(win.from);
  const to = toMin(win.to);

  let starts;
  if (tour.flexible) {
    starts = [];
    for (let m = from; m + dur <= to; m += cfg.policy.slotStepMin) starts.push(fromMin(m));
  } else {
    starts = tour.times.filter((t) => toMin(t) >= from && toMin(t) + dur <= to);
  }

  const notice = minNoticeHours(cfg, channel) * 3600_000;
  const dayBookings = ctx.bookings.get(date) ?? [];
  const dayBlocks = ctx.blocks.get(date) ?? [];
  const out = [];

  for (const start of starts) {
    if (!skipNotice && localToInstant(date, start) < nowMs + notice) continue;
    const s = toMin(start);
    const e = s + dur;
    const eb = e + buf;

    let conflict = false;
    let taken = 0;
    let lang = null;
    for (const b of dayBookings) {
      if (b.id === ignoreId) continue;
      const bs = toMin(b.start_time);
      const be = toMin(b.end_time) + b.buffer_min;
      if (!(s < be && bs < eb)) continue;
      if (tour.model === 'person' && b.tour_slug === tour.slug && b.start_time === start) {
        taken += b.participants;
        lang ??= b.tour_lang ?? null;
      }
      else {
        conflict = true;
        break;
      }
    }
    if (conflict) continue;
    for (const bl of dayBlocks) {
      if (s < toMin(bl.end_time) && toMin(bl.start_time) < eb) {
        conflict = true;
        break;
      }
    }
    if (conflict) continue;

    const left = tour.maxParticipants - taken;
    if (pax > left) continue;
    if (tourLang && lang && lang !== tourLang) continue; // la partenza è già in un'altra lingua
    out.push({ time: start, end: fromMin(e), left, joined: taken > 0, lang });
  }
  return out;
}

/** Numero di orari prenotabili per ogni giorno del mese (per colorare il calendario). */
export function monthAvailability(db, cfg, tour, month, { pax = 1, channel = 'b2c', nowMs, durationMin = null, tourLang = null }) {
  const dates = monthDates(month);
  const ctx = loadAvailabilityContext(db, cfg, dates[0], dates.at(-1), nowMs);
  const days = {};
  for (const d of dates) {
    const n = slotsForDay(ctx, cfg, tour, d, { pax, channel, nowMs, durationMin, tourLang }).length;
    if (n) days[d] = n;
  }
  return days;
}

/**
 * Le «viste» delle prenotazioni di un intervallo, per capire PERCHÉ un giorno non ha posto:
 * tutte; solo le confermate (senza opzioni e pagamenti in corso); senza quelle dell'agenzia; nessuna.
 */
function overviewViews(ctx, accountId) {
  const keep = (pred) => ({ ...ctx, bookings: new Map([...ctx.bookings].map(([d, rows]) => [d, rows.filter(pred)])) });
  return { all: ctx, firm: keep((b) => b.status === 'confirmed'), others: accountId ? keep((b) => b.account_id !== accountId) : ctx, none: { ...ctx, bookings: new Map() } };
}

/**
 * Com'è un giorno per un servizio (calendario delle agenzie):
 *  - `free`: ci sono orari prenotabili (`slots`);
 *  - `mine`: sarebbe libero senza le prenotazioni dell'agenzia stessa;
 *  - `held`: occupato solo da opzioni o pagamenti in corso: se vengono rilasciati si libera da solo;
 *  - `full`: occupato da prenotazioni confermate;
 *  - `null`: non si può prenotare comunque (la guida non lavora, giorno passato o troppo lontano, preavviso, impegni…).
 * `possible`: gli orari che ci sarebbero senza alcuna prenotazione (serve a sapere se un orario esiste).
 */
function dayOverview(views, cfg, tour, date, opts) {
  const slots = slotsForDay(views.all, cfg, tour, date, opts);
  const possible = slotsForDay(views.none, cfg, tour, date, opts);
  if (slots.length) return { state: 'free', slots, possible };
  if (!possible.length) return { state: null, slots, possible };
  if (views.others !== views.all && slotsForDay(views.others, cfg, tour, date, opts).length) return { state: 'mine', slots, possible };
  return { state: slotsForDay(views.firm, cfg, tour, date, opts).length ? 'held' : 'full', slots, possible };
}

/** Il mese di un servizio giorno per giorno: `{ 'AAAA-MM-GG': { state, n } }` (solo i giorni in cui qualcosa si può dire). */
export function monthOverview(db, cfg, tour, month, { pax = 1, channel = 'b2c', nowMs, durationMin = null, tourLang = null, accountId = null }) {
  const dates = monthDates(month);
  const views = overviewViews(loadAvailabilityContext(db, cfg, dates[0], dates.at(-1), nowMs), accountId);
  const out = {};
  for (const d of dates) {
    const { state, slots } = dayOverview(views, cfg, tour, d, { pax, channel, nowMs, durationMin, tourLang });
    if (state) out[d] = { state, n: slots.length };
  }
  return out;
}

/** Un giorno di un servizio: lo stato (vedi sopra), gli orari liberi e quelli possibili. */
export function dayOverviewFor(db, cfg, tour, date, { pax = 1, channel = 'b2c', nowMs, durationMin = null, tourLang = null, accountId = null }) {
  const views = overviewViews(loadAvailabilityContext(db, cfg, date, date, nowMs), accountId);
  return dayOverview(views, cfg, tour, date, { pax, channel, nowMs, durationMin, tourLang });
}

export function daySlots(db, cfg, tour, date, opts) {
  const ctx = loadAvailabilityContext(db, cfg, date, date, opts.nowMs);
  return slotsForDay(ctx, cfg, tour, date, opts);
}

/** Prossime date (dopo `from`, escluso) con almeno un orario prenotabile per uno qualsiasi dei tour dati. */
export function nextAvailableDates(db, cfg, tours, from, { pax = 1, channel = 'b2c', nowMs, limit = 5, monthsAhead = 4 } = {}) {
  const found = new Set();
  let month = from.slice(0, 7);
  for (let i = 0; i < monthsAhead && found.size < limit * 3; i++) {
    for (const tour of tours) {
      for (const d of Object.keys(monthAvailability(db, cfg, tour, month, { pax, channel, nowMs }))) if (d > from) found.add(d);
    }
    const [y, m] = month.split('-').map(Number);
    month = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return [...found].sort().slice(0, limit);
}

/**
 * Le prossime partenze prenotabili dei tour a partenza fissa (prezzo a persona), in ordine di data e ora:
 * servono a «scegliere subito» senza dover indovinare una data. I tour a orario libero non compaiono.
 */
export function nextDepartures(db, cfg, tours, from, { pax = 1, channel = 'b2c', nowMs, limit = 6, days = 45 } = {}) {
  const fixed = tours.filter((t) => t.model === 'person' && !t.flexible);
  if (!fixed.length) return [];
  const ctx = loadAvailabilityContext(db, cfg, from, addDays(from, days), nowMs);
  const out = [];
  for (let i = 0; i <= days && out.length < limit; i++) {
    const date = addDays(from, i);
    const day = [];
    for (const tour of fixed) for (const slot of slotsForDay(ctx, cfg, tour, date, { pax, channel, nowMs })) day.push({ tour, date, ...slot });
    day.sort((a, b) => a.time.localeCompare(b.time) || a.tour.order - b.tour.order);
    out.push(...day);
  }
  return out.slice(0, limit);
}
