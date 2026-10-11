// Motore delle disponibilità.
//
// Regole (c'è una sola guida):
//  - Un servizio occupa [inizio, fine + pausa). Due servizi non possono sovrapporsi.
//  - Eccezione: i tour "a persona" (model: person) con la stessa partenza (stesso tour, stesso
//    orario) si sommano fino a `maxParticipants`.
//  - Un tour "a gruppo" (model: group, privato) blocca la fascia per chiunque altro.
//  - Si può prenotare solo dentro gli orari di lavoro (modello settimanale + giorni speciali),
//    fuori dalle fasce bloccate e con il preavviso minimo.

import { getSetting } from './db.js';
import { addDays, dayOfWeek, fromMin, localToInstant, monthDates, nowRome, toMin } from './time.js';

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

/** Carica in una volta sola tutto ciò che serve per calcolare le disponibilità in un intervallo di date. */
export function loadAvailabilityContext(db, cfg, fromDate, toDate, nowMs) {
  const weekly = getSetting(db, 'weekly', cfg.defaultWeekly);
  const overrides = new Map(db.prepare('SELECT * FROM day_overrides WHERE date BETWEEN ? AND ?').all(fromDate, toDate).map((r) => [r.date, r]));
  const blocks = groupBy(db.prepare('SELECT * FROM blocks WHERE date BETWEEN ? AND ?').all(fromDate, toDate), 'date');
  const bookings = groupBy(
    db
      .prepare(
        `SELECT id, tour_slug, date, start_time, end_time, buffer_min, participants FROM bookings
         WHERE date BETWEEN ? AND ? AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))`,
      )
      .all(fromDate, toDate, new Date(nowMs).toISOString()),
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
 * @returns {{time:string,end:string,left:number,joined:boolean}[]}
 */
export function slotsForDay(ctx, cfg, tour, date, { pax = 1, channel = 'b2c', nowMs, ignoreId = null, skipNotice = false }) {
  if (!tour.weekdays.includes(dayOfWeek(date))) return [];
  const win = dayWindow(ctx, date);
  if (!win) return [];

  const today = nowRome(nowMs).date;
  if (date < today || date > addDays(today, cfg.policy.maxAdvanceDays)) return [];

  const dur = tour.durationMin;
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
    for (const b of dayBookings) {
      if (b.id === ignoreId) continue;
      const bs = toMin(b.start_time);
      const be = toMin(b.end_time) + b.buffer_min;
      if (!(s < be && bs < eb)) continue;
      if (tour.model === 'person' && b.tour_slug === tour.slug && b.start_time === start) taken += b.participants;
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
    out.push({ time: start, end: fromMin(e), left, joined: taken > 0 });
  }
  return out;
}

/** Numero di orari prenotabili per ogni giorno del mese (per colorare il calendario). */
export function monthAvailability(db, cfg, tour, month, { pax = 1, channel = 'b2c', nowMs }) {
  const dates = monthDates(month);
  const ctx = loadAvailabilityContext(db, cfg, dates[0], dates.at(-1), nowMs);
  const days = {};
  for (const d of dates) {
    const n = slotsForDay(ctx, cfg, tour, d, { pax, channel, nowMs }).length;
    if (n) days[d] = n;
  }
  return days;
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
