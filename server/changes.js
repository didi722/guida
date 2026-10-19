// Modifiche che l'agenzia fa da sola a una prenotazione (persone, data, ore) e richieste di proroga di un'opzione.
// Solo regole e database: l'invio delle email sta in changeServices.js.
//
// Regole in breve:
// - un'opzione si cambia liberamente (prezzo ricalcolato; la scadenza non si allunga mai spostando la data);
// - una prenotazione a fattura, non ancora fatturata né incassata, si cambia liberamente fino alla fine del periodo gratuito;
//   dopo si può solo AUMENTARE (più persone o più ore sullo stesso orario), mai ridurre o spostare: lo si chiede alla guida;
// - carta (pagata), prezzo concordato a mano, fattura già preparata, servizio iniziato: si scrive alla guida.
// Spostare la data non regala tempo: le scadenze di annullo restano quelle di prima (mai più tardi).
import { loadAvailabilityContext, slotsForDay } from './availability.js';
import { cancellationState, getBooking } from './bookings.js';
import { tx } from './db.js';
import { invoiceForSource } from './invoices.js';
import { optionWindow } from './optionPolicy.js';
import { freeHoursOf, hasFreeTier, parseTiers, refundPercentAt, singleTier } from './policy.js';
import { previewPricing } from './pricing.js';
import { extraHourOptions, hourOptions, parseServiceRecord, serviceRecord } from './rates.js';
import { readSlot } from './slotParams.js';
import { localToInstant, toMin } from './time.js';
import { cleanText } from './util.js';

const HOUR = 3600_000;
const iso = (ms) => new Date(ms).toISOString();

export class ChangeError extends Error {
  /** `code`: locked | invalid | nochange | unavailable | moveLocked | reduceLocked | option | extension */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

/** I campi che l'agenzia può cambiare, così come sono adesso in una prenotazione. */
export function currentParams(app, b) {
  const tour = app.content.tour(b.tour_slug);
  const hours = parseServiceRecord(b.service_json)?.hours ?? null;
  const fixed = tour?.pricing === 'hourly' && !tour.chooseHours ? tour.durationMin / 60 : null; // durata fissa, con eventuali ore in più
  return { pax: b.participants, date: b.date, time: b.start_time, hours: tour?.chooseHours ? hours : null, extra: fixed != null && hours != null ? Math.max(0, hours - fixed) : 0 };
}

/** Le durate che l'agenzia può scegliere per questo servizio: [] se non ha ore da scegliere. */
export function hourChoices(app, b) {
  const tour = app.content.tour(b.tour_slug);
  if (tour?.pricing !== 'hourly') return { kind: null, values: [] };
  if (tour.chooseHours) return { kind: 'hours', values: hourOptions(tour.service) };
  const extra = extraHourOptions(tour, 'b2b');
  return { kind: 'extra', values: extra.length ? [0, ...extra] : [] };
}

/**
 * Cosa può cambiare adesso l'agenzia di questa prenotazione.
 * @returns {{allowed: true, mode: 'free'|'increase', until?: number} | {allowed: false, reason: string}}
 *   reason: channel | status | held | started | custom | card | paid | invoiced
 */
export function changeRules(app, b, nowMs = Date.now()) {
  const { db } = app;
  if (b.channel !== 'b2b' || !b.account_id) return { allowed: false, reason: 'channel' };
  if (b.status === 'held') return { allowed: false, reason: 'held' };
  if (b.status !== 'option' && b.status !== 'confirmed') return { allowed: false, reason: 'status' };
  if (localToInstant(b.date, b.start_time) <= nowMs) return { allowed: false, reason: 'started' };
  if (b.custom_price) return { allowed: false, reason: 'custom' }; // prezzo concordato: non si ricalcola
  if (b.status === 'option') return { allowed: true, mode: 'free' };
  if (b.payment_method === 'card') return { allowed: false, reason: 'card' }; // già pagata online: cambiare l'importo vuol dire rimborsare o incassare
  if (b.payment_status !== 'unpaid' || b.payment_method !== 'invoice') return { allowed: false, reason: 'paid' };
  if (invoiceForSource(db, 'booking', b.id)) return { allowed: false, reason: 'invoiced' }; // la fattura (anche in bozza) ha già l'importo
  const st = cancellationState(b, nowMs);
  return st.percent === 100 ? { allowed: true, mode: 'free', until: st.until } : { allowed: true, mode: 'increase' };
}

/** Le scadenze di annullo di partenza: data di inizio e scaglioni di quando la prenotazione è stata fatta (prima di ogni spostamento). */
export function policyBase(b) {
  try {
    const base = b.policy_base_json ? JSON.parse(b.policy_base_json) : null;
    const tiers = parseTiers(base?.tiers);
    if (tiers && Number.isFinite(base?.startMs)) return { startMs: base.startMs, tiers };
  } catch {
    /* si riparte dalla politica di adesso */
  }
  const startMs = localToInstant(b.date, b.start_time);
  return { startMs, tiers: parseTiers(b.cancel_policy_json) ?? singleTier(Math.round((startMs - Date.parse(b.free_cancel_until)) / HOUR)) };
}

/**
 * Le scadenze di annullo dopo uno spostamento: spostare la data più avanti non regala tempo (restano le scadenze assolute di partenza),
 * spostarla prima non le allunga (valgono i soliti «ore prima» della nuova data). Si parte sempre dalla politica di quando si è prenotato.
 */
export function movedTiers(b, newStartMs) {
  const base = policyBase(b);
  const delta = Math.max(0, newStartMs - base.startMs) / HOUR;
  return base.tiers.map((t) => ({ hours: t.hours + delta, refund: t.refund }));
}

/**
 * Valuta una modifica proposta (senza scrivere nulla): regole, disponibilità, nuovo prezzo, nuove scadenze.
 * @param {{pax?: number|string, date?: string, time?: string, hours?: number|string, extra?: number|string}} input i campi non indicati restano come sono
 * @returns {{ok: true, ...}|{ok: false, error: string, rules: object}}
 */
export function evaluateChange(app, b, input, nowMs = Date.now()) {
  const { db, cfg } = app;
  const rules = changeRules(app, b, nowMs);
  if (!rules.allowed) return { ok: false, error: 'locked', rules };
  const tour = app.content.tour(b.tour_slug);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id);
  const cur = currentParams(app, b);
  const asked = {
    pax: input.pax ?? cur.pax,
    date: input.date ?? cur.date,
    time: input.time ?? cur.time,
    hours: tour.chooseHours ? (input.hours ?? cur.hours) : null,
    extra: tour.pricing === 'hourly' && !tour.chooseHours ? (input.extra ?? cur.extra) : 0,
  };
  const p = readSlot(app, { tour: b.tour_slug, ...asked }, 'b2b');
  if (!p) return { ok: false, error: 'invalid', rules };
  const startMs = localToInstant(p.date, p.time);
  const oldDuration = toMin(b.end_time) - toMin(b.start_time);
  const newDuration = p.durationMin ?? tour.durationMin;
  const sameSlot = p.date === b.date && p.time === b.start_time;
  if (sameSlot && p.pax === b.participants && newDuration === oldDuration) return { ok: false, error: 'nochange', rules };
  if (startMs <= nowMs) return { ok: false, error: 'invalid', rules };

  // dopo il periodo gratuito: solo aumenti, sullo stesso orario
  if (rules.mode === 'increase') {
    if (!sameSlot) return { ok: false, error: 'moveLocked', rules };
    if (p.pax < b.participants || newDuration < oldDuration) return { ok: false, error: 'reduceLocked', rules };
  }

  const ctx = loadAvailabilityContext(db, cfg, p.date, p.date, nowMs);
  const slot = slotsForDay(ctx, cfg, tour, p.date, { pax: p.pax, channel: 'b2b', nowMs, ignoreId: b.id, skipNotice: sameSlot, durationMin: p.durationMin, tourLang: b.tour_lang || null }).find((s) => s.time === p.time);
  if (!slot) return { ok: false, error: 'unavailable', rules };

  const pricing = previewPricing(app, { tour, pax: p.pax, channel: 'b2b', account, date: p.date, time: p.time, hours: p.hours, earpieces: p.earpieces, nowMs, ignoreBookingId: b.id });
  if (pricing.quote && !pricing.quote.ok) return { ok: false, error: 'invalid', rules };

  // le scadenze di annullo (se si sposta la data) e, per un'opzione, la scadenza dell'opzione
  const dateChanged = !sameSlot;
  const tiers = dateChanged ? movedTiers(b, startMs) : (parseTiers(b.cancel_policy_json) ?? singleTier(0));
  const freeUntil = hasFreeTier(tiers) ? startMs - freeHoursOf(tiers) * HOUR : nowMs;
  let expiresMs = b.option_expires_at ? Date.parse(b.option_expires_at) : null;
  if (b.status === 'option' && dateChanged) {
    const win = optionWindow({ options: cfg.options, account, startMs, nowMs });
    if (!win.ok) return { ok: false, error: 'option', rules, reason: win.reason };
    expiresMs = Math.min(expiresMs, win.expiresMs); // spostare la data non allunga mai l'opzione
  }
  return {
    ok: true,
    rules,
    dateChanged,
    from: { ...cur, end: b.end_time, totalCents: b.total_cents },
    to: { pax: p.pax, date: p.date, time: p.time, end: slot.end, hours: p.hours, extra: asked.extra, durationMin: p.durationMin, totalCents: pricing.totalCents },
    pricing,
    slot,
    deltaCents: pricing.totalCents - b.total_cents,
    tiers,
    freeUntilMs: freeUntil,
    expiresMs,
  };
}

/**
 * Le partenze (o gli orari liberi) del giorno scelto con il prezzo di ciascuna, per scegliere dove spostare la prenotazione.
 * Dopo il periodo gratuito c'è solo l'orario di adesso (si può solo aumentare).
 * @returns {{time: string, end: string, left: number, totalCents: number, deltaCents: number, current: boolean, ok: boolean, error?: string, percent: number|null}[]} percent: il rimborso se si annullasse adesso dopo la modifica
 */
export function changeSlots(app, b, input, nowMs = Date.now()) {
  const { db, cfg } = app;
  const rules = changeRules(app, b, nowMs);
  if (!rules.allowed) return [];
  const tour = app.content.tour(b.tour_slug);
  const cur = currentParams(app, b);
  const date = input.date ?? cur.date;
  const base = { pax: input.pax ?? cur.pax, hours: tour.chooseHours ? (input.hours ?? cur.hours) : null, extra: tour.pricing === 'hourly' && !tour.chooseHours ? (input.extra ?? cur.extra) : 0 };
  const probe = readSlot(app, { tour: b.tour_slug, ...base, date, time: b.start_time }, 'b2b');
  if (!probe) return [];
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id);
  const ctx = loadAvailabilityContext(db, cfg, date, date, nowMs);
  const opts = { pax: probe.pax, channel: 'b2b', nowMs, ignoreId: b.id, durationMin: probe.durationMin, tourLang: b.tour_lang || null };
  const normal = rules.mode === 'increase' ? [] : slotsForDay(ctx, cfg, tour, date, { ...opts, skipNotice: false });
  const own = date === b.date ? slotsForDay(ctx, cfg, tour, date, { ...opts, skipNotice: true }).filter((s) => s.time === b.start_time) : []; // l'orario di adesso resta possibile anche dentro il preavviso
  const all = [...normal, ...own.filter((s) => !normal.some((x) => x.time === s.time))].sort((a, c) => a.time.localeCompare(c.time));
  return all.map((s) => {
    const ev = evaluateChange(app, b, { ...base, date, time: s.time }, nowMs);
    const pricing = previewPricing(app, { tour, pax: probe.pax, channel: 'b2b', account, date, time: s.time, hours: probe.hours, earpieces: probe.earpieces, nowMs, ignoreBookingId: b.id });
    // con questa data la cancellazione gratuita varrebbe ancora? (spostare prima avvicina i termini)
    const percent = ev.ok ? refundPercentAt(ev.tiers, localToInstant(date, s.time), nowMs) : null;
    return { time: s.time, end: s.end, left: s.left, totalCents: pricing.totalCents, deltaCents: pricing.totalCents - b.total_cents, current: date === b.date && s.time === b.start_time, ok: ev.ok || ev.error === 'nochange', error: ev.ok ? undefined : ev.error, percent };
  });
}

const snapshot = (b) => ({ pax: b.participants, date: b.date, time: b.start_time, end: b.end_time, totalCents: b.total_cents, hours: parseServiceRecord(b.service_json)?.hours ?? null });

/**
 * Applica la modifica (una transazione). Lancia ChangeError se non si può.
 * @returns {{before: object, after: object, dateChanged: boolean, deltaCents: number}}
 */
export function modifyBooking(app, bookingId, input, { by = 'customer' } = {}, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new ChangeError('invalid');
    const ev = evaluateChange(app, b, input, nowMs);
    if (!ev.ok) throw Object.assign(new ChangeError(ev.error), { reason: ev.reason, rules: ev.rules });
    const { to, pricing } = ev;
    const now = iso(nowMs);
    db.prepare(
      `UPDATE bookings SET participants = ?, date = ?, start_time = ?, end_time = ?, list_cents = ?, discount_cents = ?, total_cents = ?, service_json = ?,
         cancel_policy_json = ?, free_cancel_until = ?, option_expires_at = ?, modified_at = ? WHERE id = ?`,
    ).run(
      to.pax, to.date, to.time, to.end, pricing.listCents, pricing.discountCents, pricing.totalCents,
      pricing.quote ? JSON.stringify(serviceRecord(pricing.quote)) : null,
      JSON.stringify(ev.tiers), iso(ev.freeUntilMs), ev.expiresMs != null ? iso(ev.expiresMs) : null, now, b.id,
    );
    if (ev.dateChanged) {
      if (!b.policy_base_json) db.prepare('UPDATE bookings SET policy_base_json = ? WHERE id = ?').run(JSON.stringify({ startMs: localToInstant(b.date, b.start_time), tiers: policyBase(b).tiers }), b.id); // la politica di partenza si ricorda
      // i promemoria (la sera prima, fine annullo gratuito) ripartono per la nuova data
      db.prepare(`UPDATE bookings SET reminder_status = NULL, reminder_sent_at = NULL, reminder_attempt_at = NULL, penalty_reminded_at = NULL, option_reminded_at = NULL WHERE id = ?`).run(b.id);
      // le altre date di un pacchetto in opzione scadono insieme a questa
      if (b.status === 'option' && b.group_id) db.prepare(`UPDATE bookings SET option_expires_at = ?, option_reminded_at = NULL WHERE group_id = ? AND status = 'option'`).run(iso(ev.expiresMs), b.group_id);
    }
    const after = getBooking(db, b.id);
    db.prepare('INSERT INTO booking_changes(booking_id, by, before_json, after_json, created_at) VALUES(?,?,?,?,?)').run(b.id, by, JSON.stringify(snapshot(b)), JSON.stringify(snapshot(after)), now);
    return { before: b, after, dateChanged: ev.dateChanged, deltaCents: ev.deltaCents };
  });
}

export const changeHistory = (db, bookingId) =>
  db.prepare('SELECT * FROM booking_changes WHERE booking_id = ? ORDER BY id').all(bookingId).map((r) => ({ ...r, before: JSON.parse(r.before_json), after: JSON.parse(r.after_json) }));

// ───────────── richieste di proroga ─────────────
export const MAX_REQUEST_DAYS = 14;
export const REQUEST_DAYS = [1, 2, 3, 5, 7];

/** La richiesta di proroga ancora aperta per questa opzione (o per il suo pacchetto), se c'è. */
export function pendingExtension(db, b) {
  return (
    (b.group_id
      ? db.prepare(`SELECT * FROM extension_requests WHERE status = 'pending' AND group_id = ? ORDER BY id DESC LIMIT 1`).get(b.group_id)
      : db.prepare(`SELECT * FROM extension_requests WHERE status = 'pending' AND booking_id = ? ORDER BY id DESC LIMIT 1`).get(b.id)) ?? null
  );
}

/** Le richieste aperte, dalla più vecchia (per il pannello). */
export const pendingExtensions = (db) => db.prepare(`SELECT * FROM extension_requests WHERE status = 'pending' ORDER BY id`).all();

/**
 * L'agenzia chiede alla guida di prolungare l'opzione. Una sola richiesta aperta alla volta per opzione (o pacchetto).
 * @returns {object} la richiesta
 */
export function requestExtension(app, b, { days, note = '' }, nowMs = Date.now()) {
  const { db } = app;
  const n = Math.round(Number(days));
  if (!Number.isInteger(n) || n < 1 || n > MAX_REQUEST_DAYS) throw new ChangeError('invalid', 'days');
  return tx(db, () => {
    const fresh = getBooking(db, b.id);
    if (!fresh || fresh.status !== 'option' || Date.parse(fresh.option_expires_at) <= nowMs) throw new ChangeError('extension', 'not an open option');
    if (pendingExtension(db, fresh)) throw new ChangeError('extension', 'already pending');
    const id = Number(db.prepare('INSERT INTO extension_requests(booking_id, group_id, days, note, created_at) VALUES(?,?,?,?,?)').run(fresh.id, fresh.group_id ?? null, n, cleanText(note, 500) || null, iso(nowMs)).lastInsertRowid);
    return db.prepare('SELECT * FROM extension_requests WHERE id = ?').get(id);
  });
}

/** Chiude le richieste aperte di un'opzione (o del suo pacchetto): la guida ha prolungato, a prescindere da come. */
export function resolveExtensions(db, b, grantedDays, nowMs = Date.now()) {
  return db
    .prepare(`UPDATE extension_requests SET status = 'approved', granted_days = ?, decided_at = ? WHERE status = 'pending' AND (booking_id = ? ${b.group_id ? 'OR group_id = ?' : ''})`)
    .run(grantedDays, iso(nowMs), b.id, ...(b.group_id ? [b.group_id] : [])).changes;
}

/** La guida non concede la proroga. @returns {object|null} la richiesta (null se non era più aperta) */
export function denyExtension(db, requestId, nowMs = Date.now()) {
  const changed = db.prepare(`UPDATE extension_requests SET status = 'denied', decided_at = ? WHERE id = ? AND status = 'pending'`).run(iso(nowMs), requestId).changes;
  return changed ? db.prepare('SELECT * FROM extension_requests WHERE id = ?').get(requestId) : null;
}
