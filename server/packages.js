// Pacchetti delle agenzie: più servizi prenotati insieme (una guida, un meet & greet, un tour leader…) con una sola opzione,
// una sola scadenza, un solo pagamento e una sola fattura. Ogni servizio resta una prenotazione a sé (così agenda, fatture e voucher
// non cambiano): il pacchetto le tiene insieme (`bookings.group_id`) e le crea in un colpo solo, tutte o nessuna.
// Solo regole e database: l'invio di email e il pagamento con carta stanno in packageServices.js.
import { BookingError, activeOptionCount, bookingDue, cancellationState, confirmOption, createBooking, releaseOption } from './bookings.js';
import { daySlots } from './availability.js';
import { themeChoice } from './choices.js';
import { invoiceForSource } from './invoices.js';
import { tx } from './db.js';
import { firmTiers, maxActiveOptions, optionWindow } from './optionPolicy.js';
import { policyFor } from './policy.js';
import { previewPricing } from './pricing.js';
import { readSlot } from './slotParams.js';
import { localToInstant, toMin } from './time.js';
import { cleanText, isEmail, newRef, newToken } from './util.js';

export const MAX_PACKAGE_LINES = 12;

export class PackageError extends Error {
  /** `code`: invalid | unavailable | theme | overlap | duplicate | full | empty | option | payment | language | account; `line`: posizione (da 0) del servizio che ha dato l'errore */
  constructor(code, message, line = null) {
    super(message ?? code);
    this.code = code;
    this.line = line;
  }
}

const iso = (ms) => new Date(ms).toISOString();

// ───────────── il pacchetto in preparazione (carrello) ─────────────
/** I campi che si conservano per ogni servizio aggiunto (con la lunghezza massima). I dati di contatto servono da proposta nel modulo finale. */
const LINE_FIELDS = { tour: 80, date: 10, time: 5, pax: 3, hours: 6, extra: 3, tourLang: 5, theme: 8, themeNote: 500, pickup: 200, name: 120, email: 200, phone: 40, lang: 5, clientRef: 120, notes: 1000 };

/** Dal modulo ai soli campi che si conservano per un servizio del pacchetto. */
export function cleanLine(src = {}) {
  const out = {};
  for (const [k, max] of Object.entries(LINE_FIELDS)) {
    const v = cleanText(src[k], max);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * Un servizio del carrello come lo vuole il motore di prenotazione: servizio, persone, data e ora (e durata) già validati,
 * più lingua del tour, scelta tematica e punto d'incontro. null se non è valido (servizio spento, orario non permesso…).
 */
export function resolveLine(app, src) {
  const p = readSlot(app, src, 'b2b');
  if (!p) return null;
  const tourLang = p.tour.languages?.includes(src.tourLang) ? src.tourLang : '';
  return { ...p, tourLang, theme: src.theme ?? '', themeNote: src.themeNote ?? '', pickup: src.pickup ?? '' };
}

/** La partenza (o l'orario libero) è ancora prenotabile da un'agenzia con queste persone? @returns {object|null} lo slot */
export function openSlotOf(app, line, nowMs = Date.now()) {
  const { tour, date, time, pax, durationMin, tourLang } = line;
  return daySlots(app.db, app.cfg, tour, date, { pax, channel: 'b2b', nowMs, durationMin, tourLang: tourLang || null }).find((s) => s.time === time) ?? null;
}

/** I servizi aggiunti e non ancora prenotati, dal più vecchio. */
export function cartItems(db, accountId) {
  return db
    .prepare('SELECT * FROM cart_items WHERE account_id = ? ORDER BY id')
    .all(accountId)
    .map((r) => ({ id: r.id, src: JSON.parse(r.data_json), createdAt: r.created_at }));
}

export const cartCount = (db, accountId) => db.prepare('SELECT COUNT(*) n FROM cart_items WHERE account_id = ?').get(accountId).n;

/** L'ora d'inizio e quella in cui la guida è di nuovo libera (con la pausa tra un servizio e l'altro), in minuti dall'inizio del giorno. */
function span(app, line) {
  const start = toMin(line.time);
  return { start, end: start + (line.durationMin ?? line.tour.durationMin) + app.cfg.policy.bufferMin };
}

/** Due servizi dello stesso giorno si sovrappongono (la guida è una sola)? Stessa regola del motore delle disponibilità. */
function overlaps(app, a, b) {
  if (a.date !== b.date) return false;
  const x = span(app, a);
  const y = span(app, b);
  return x.start < y.end && y.start < x.end;
}

const sameService = (a, b) => a.tour.slug === b.tour.slug && a.date === b.date && a.time === b.time;

/**
 * Aggiunge un servizio al pacchetto in preparazione. Lancia PackageError se non è valido, se non c'è più posto,
 * se si sovrappone a un altro servizio del pacchetto o se il pacchetto è già pieno.
 * @returns {number} l'id della riga del carrello
 */
export function cartAdd(app, account, src, nowMs = Date.now()) {
  const { db } = app;
  const clean = cleanLine(src);
  const line = resolveLine(app, clean);
  if (!line) throw new PackageError('invalid', 'servizio non valido');
  try {
    themeChoice(line.tour, line.theme, line.themeNote); // se il servizio chiede una scelta, deve esserci
  } catch (e) {
    if (e.reason) throw new PackageError('theme', 'scelta mancante');
    throw e;
  }
  if (!openSlotOf(app, line, nowMs)) throw new PackageError('unavailable', 'non più disponibile');
  return tx(db, () => {
    const others = cartItems(db, account.id).map((it) => resolveLine(app, it.src)).filter(Boolean);
    if (others.length >= MAX_PACKAGE_LINES) throw new PackageError('full', 'pacchetto pieno');
    if (others.some((o) => sameService(o, line))) throw new PackageError('duplicate', 'già nel pacchetto'); // per cambiare le persone si toglie e si riaggiunge
    if (others.some((o) => overlaps(app, o, line))) throw new PackageError('overlap', 'si sovrappone a un altro servizio del pacchetto');
    return Number(db.prepare('INSERT INTO cart_items(account_id, data_json, created_at) VALUES(?,?,?)').run(account.id, JSON.stringify(clean), iso(nowMs)).lastInsertRowid);
  });
}

export const cartRemove = (db, accountId, id) => db.prepare('DELETE FROM cart_items WHERE id = ? AND account_id = ?').run(Number(id), accountId).changes === 1;
export const cartClear = (db, accountId) => db.prepare('DELETE FROM cart_items WHERE account_id = ?').run(accountId).changes;

/**
 * Il pacchetto in preparazione com'è adesso: ogni servizio con il suo prezzo e se si può ancora prenotare, il totale, se si può opzionare
 * (una sola scadenza per tutti: la più vicina) e i dati di contatto da proporre (quelli dell'ultimo servizio aggiunto).
 */
export function cartSummary(app, account, nowMs = Date.now()) {
  const { db, cfg } = app;
  const items = cartItems(db, account.id);
  const lines = items.map((it, index) => {
    const p = resolveLine(app, it.src);
    const line = { id: it.id, index, src: it.src, p, ok: false, reason: p ? null : 'invalid', slot: null, pricing: null, startMs: null, option: null, firm: null };
    if (!p) return line;
    line.slot = openSlotOf(app, p, nowMs);
    line.reason = line.slot ? null : 'unavailable';
    line.pricing = previewPricing(app, { tour: p.tour, pax: p.pax, channel: 'b2b', account, date: p.date, time: p.time, hours: p.hours, earpieces: p.earpieces, nowMs });
    line.startMs = localToInstant(p.date, p.time);
    line.option = optionWindow({ options: cfg.options, account, startMs: line.startMs, nowMs });
    line.firm = firmTiers({ options: cfg.options, tiers: policyFor(cfg, p.tour, 'b2b', account), startMs: line.startMs, nowMs });
    line.ok = !!line.slot;
    return line;
  });
  // due servizi che si pestano i piedi: il secondo non si può prenotare (può succedere se l'agenda cambia dopo l'aggiunta)
  for (const a of lines) {
    if (!a.ok) continue;
    if (lines.some((b) => b.p && b.index < a.index && b.ok && overlaps(app, a.p, b.p))) Object.assign(a, { ok: false, reason: 'overlap' });
  }
  const valid = lines.filter((l) => l.p);
  let option = null;
  if (valid.length) {
    const blocked = valid.find((l) => !l.option.ok);
    if (blocked) option = blocked.option.reason === 'disabled' ? null : { ok: false, reason: blocked.option.reason };
    else {
      const limit = maxActiveOptions(cfg.options, account);
      if (limit > 0 && activeOptionCount(db, account.id, nowMs) >= limit) option = { ok: false, reason: 'limit', limit };
      else {
        const expiresMs = Math.min(...valid.map((l) => l.option.expiresMs));
        option = { ok: true, expiresMs, days: Math.round(((expiresMs - nowMs) / 86_400_000) * 10) / 10, period: valid.map((l) => l.option.period).find(Boolean) ?? null };
      }
    }
  }
  const firmLine = valid.find((l) => l.firm.applied);
  const last = items.at(-1)?.src ?? {};
  return {
    lines,
    totalCents: valid.reduce((s, l) => s + (l.pricing?.dueCents ?? 0), 0),
    allOk: lines.length > 0 && lines.every((l) => l.ok),
    option,
    firm: firmLine ? { applied: true, graceUntilMs: firmLine.firm.graceUntilMs, refundPercent: firmLine.firm.refundPercent } : { applied: false },
    contact: { name: last.name ?? '', email: last.email ?? '', phone: last.phone ?? '', lang: last.lang ?? '', clientRef: last.clientRef ?? '', notes: last.notes ?? '' },
  };
}

// ───────────── il pacchetto prenotato ─────────────
export const getPackage = (db, id) => db.prepare('SELECT * FROM booking_groups WHERE id = ?').get(id);
export const getPackageByRef = (db, ref) => db.prepare('SELECT * FROM booking_groups WHERE ref = ?').get(String(ref));
export const packageBookings = (db, groupId) => db.prepare('SELECT * FROM bookings WHERE group_id = ? ORDER BY date, start_time, id').all(groupId);

/** Lo stato del pacchetto, dai suoi servizi: 'option' | 'held' | 'confirmed' | 'cancelled' | 'expired'. */
export function packageStatus(bookings) {
  const has = (s) => bookings.some((b) => b.status === s);
  if (has('option')) return 'option';
  if (has('held')) return 'held';
  if (has('confirmed')) return 'confirmed';
  return has('cancelled') ? 'cancelled' : 'expired';
}

/** I servizi vivi (non annullati né scaduti), con il totale. */
export const liveBookings = (bookings) => bookings.filter((b) => ['confirmed', 'held', 'option'].includes(b.status));
export const packageTotal = (bookings) => liveBookings(bookings).reduce((s, b) => s + bookingDue(b), 0);

/**
 * I servizi che il pagamento con carta del pacchetto copre adesso: quelli in attesa di pagamento e quelli confermati a fattura ma non ancora
 * pagati (l'agenzia può anticipare con la carta). Con `late` anche quelli la cui attesa è scaduta da poco: il pagamento può arrivare in ritardo.
 */
export function payableLines(db, groupId, nowMs = Date.now(), { late = false } = {}) {
  const now = iso(nowMs);
  return packageBookings(db, groupId).filter((b) => {
    if (b.payment_status !== 'unpaid' || bookingDue(b) <= 0) return false;
    if (b.status === 'held') return late || b.hold_expires_at > now;
    if (b.status === 'confirmed') return b.payment_method === 'invoice' && !invoiceForSource(db, 'booking', b.id); // già in una fattura: si paga la fattura
    return late && b.status === 'expired' && b.payment_method === 'card' && !b.cancelled_at; // attesa scaduta (non un'opzione lasciata scadere)
  });
}

/** Ricorda quanto si chiede con la carta per questo pacchetto (serve a riconoscere il pagamento quando arriva). */
export function setCardDue(db, groupId, lines) {
  db.prepare('UPDATE booking_groups SET due_cents = ? WHERE id = ?').run(lines.reduce((s, b) => s + bookingDue(b), 0), groupId);
}

/**
 * Prenota tutti i servizi in una sola transazione: o ci sono tutti, o nessuno.
 * @param {object[]} lines servizi già validati (`resolveLine`)
 * @param {{name:string,email:string,phone?:string,lang:string,clientRef?:string,notes?:string,option?:boolean,paymentMethod?:string}} common
 * @returns {{group: object, bookings: object[]}}
 */
export function createPackage(app, account, lines, common, nowMs = Date.now()) {
  const { db, cfg } = app;
  if (!lines.length) throw new PackageError('empty', 'pacchetto vuoto');
  if (lines.length > MAX_PACKAGE_LINES) throw new PackageError('full', 'pacchetto pieno');
  const name = cleanText(common.name, 120);
  const email = cleanText(common.email, 254).toLowerCase();
  if (name.length < 2 || !isEmail(email)) throw new PackageError('invalid', 'dati di contatto');
  const wantsOption = !!common.option;
  return tx(db, () => {
    let optionExpiresMs = null;
    if (wantsOption) {
      const windows = lines.map((l) => optionWindow({ options: cfg.options, account, startMs: localToInstant(l.date, l.time), nowMs }));
      const bad = windows.findIndex((w) => !w.ok);
      if (bad >= 0) throw new PackageError('option', windows[bad].reason, bad);
      const limit = maxActiveOptions(cfg.options, account);
      if (limit > 0 && activeOptionCount(db, account.id, nowMs) >= limit) throw new PackageError('option', 'limit');
      optionExpiresMs = Math.min(...windows.map((w) => w.expiresMs)); // una sola scadenza per tutto il pacchetto
    }
    const group = {
      ref: newRef('PT'),
      token: newToken(),
      account_id: account.id,
      client_ref: cleanText(common.clientRef, 120) || null,
      name,
      email,
      phone: cleanText(common.phone, 40) || null,
      notes: cleanText(common.notes, 1000) || null,
      lang: common.lang,
      currency: cfg.policy.currency,
      created_at: iso(nowMs),
    };
    const cols = Object.keys(group);
    const groupId = Number(db.prepare(`INSERT INTO booking_groups(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(group)).lastInsertRowid);
    const billing = { company: account.company, vat: account.vat, sdi: account.sdi_code, pec: account.pec, address: account.address };
    // in ordine di data: se due servizi si pestano i piedi lo si scopre sul secondo, e salta tutto
    const ordered = lines.map((line, index) => ({ line, index })).sort((a, b) => (a.line.date + a.line.time).localeCompare(b.line.date + b.line.time));
    for (const { line, index } of ordered) {
      try {
        createBooking(
          app,
          {
            tourSlug: line.tour.slug, date: line.date, time: line.time, pax: line.pax, hours: line.hours, earpieces: line.earpieces,
            tourLang: line.tourLang, theme: line.theme, themeNote: line.themeNote, pickup: line.pickup,
            channel: 'b2b', account, name, email, phone: group.phone, lang: group.lang, clientRef: group.client_ref, notes: group.notes, billing,
            paymentMethod: common.paymentMethod, option: wantsOption, optionExpiresMs, skipOptionLimit: true, groupId,
          },
          nowMs,
        );
      } catch (e) {
        if (e instanceof BookingError) throw Object.assign(new PackageError(e.code, e.message, index), { cause: e });
        throw e;
      }
    }
    const bookings = packageBookings(db, groupId);
    setCardDue(db, groupId, bookings.filter((b) => b.status === 'held'));
    return { group: getPackage(db, groupId), bookings };
  });
}

class Undo extends Error {}

/**
 * Conferma tutti i servizi in opzione del pacchetto (a fattura sono subito confermati; con la carta passano «in attesa di pagamento»).
 * Se uno solo non si può confermare, non cambia nulla.
 * @returns {{outcome: 'confirmed'|'pay'|'expired'|'state'|'payment'|'account', bookings: object[]}}
 */
export function confirmPackage(app, groupId, { method = null } = {}, nowMs = Date.now()) {
  const { db } = app;
  const ids = db.prepare(`SELECT id FROM bookings WHERE group_id = ? AND status = 'option' ORDER BY date, start_time, id`).all(groupId).map((r) => r.id);
  if (!ids.length) return { outcome: 'state', bookings: packageBookings(db, groupId) };
  try {
    return tx(db, () => {
      let outcome = null;
      for (const id of ids) {
        const res = confirmOption(app, id, { method }, nowMs);
        if (res.outcome !== 'confirmed' && res.outcome !== 'pay') throw Object.assign(new Undo(), { outcome: res.outcome });
        outcome = res.outcome;
      }
      const bookings = packageBookings(db, groupId);
      if (outcome === 'pay') setCardDue(db, groupId, bookings.filter((b) => b.status === 'held'));
      return { outcome, bookings };
    });
  } catch (e) {
    if (e instanceof Undo) return { outcome: e.outcome, bookings: packageBookings(db, groupId) };
    throw e;
  }
}

/** Rilascia tutti i servizi ancora in opzione (le date tornano libere). @returns {object[]} i servizi rilasciati */
export function releasePackage(app, groupId, { by, reason = 'Opzione rilasciata' }, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const ids = db.prepare(`SELECT id FROM bookings WHERE group_id = ? AND status = 'option'`).all(groupId).map((r) => r.id);
    return ids.map((id) => releaseOption(app, id, { by, reason }, nowMs)).filter(Boolean);
  });
}

/** Tra i servizi confermati, quali si possono annullare online (c'è ancora qualcosa da rimborsare) e quali no (si scrive alla guida). */
export function cancellable(bookings, nowMs = Date.now()) {
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  return { yes: confirmed.filter((b) => cancellationState(b, nowMs).percent > 0), no: confirmed.filter((b) => cancellationState(b, nowMs).percent <= 0) };
}
