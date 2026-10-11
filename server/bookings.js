// Logica di business delle prenotazioni (solo database, nessuna rete).
import { tx } from './db.js';
import { daySlots, loadAvailabilityContext, slotsForDay } from './availability.js';
import { isDate, isTime, localToInstant } from './time.js';
import { previewPricing, priceFor, redeemGifts, reserveGiftsAgain, restoreGifts, unitPriceFor } from './pricing.js';
import { cleanText, isEmail, newRef, newToken } from './util.js';
import { normLang } from './langs.js';

export { priceFor, unitPriceFor };

export class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // invalid | unavailable | payment | account
  }
}

const HOUR = 3600_000;

/** Ore di preavviso entro cui la cancellazione è gratuita. */
export function freeCancelHours(cfg, tour, channel, account = null) {
  if (channel === 'b2b') return account?.cancel_hours ?? cfg.policy.b2bFreeCancelHours;
  return tour.cancelHours ?? cfg.policy.b2cFreeCancelHours;
}

/** Importo che il cliente deve ancora pagare con carta/in sede/fattura (totale meno quanto coperto da buoni regalo). */
export const bookingDue = (b) => b.total_cents - (b.gift_cents ?? 0);

/** Metodi di pagamento disponibili (può essere vuoto: prenotazioni online non attive finché non si configura Stripe). */
export function paymentOptions(app, tour, channel, account = null) {
  const { cfg } = app;
  const cardOk = !!cfg.stripe.secretKey || cfg.demoPayments;
  const opts = [];
  if (channel === 'b2b') {
    if (account?.allow_invoice) opts.push('invoice');
    if (cardOk) opts.push('card');
  } else {
    if (cardOk) opts.push('card');
    if (cfg.policy.allowPayOnSite && tour.payOnSite) opts.push('onsite');
  }
  return opts;
}

export function getBooking(db, id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}
export function getBookingByRef(db, ref) {
  return db.prepare('SELECT * FROM bookings WHERE ref = ?').get(String(ref));
}

/**
 * Crea una prenotazione verificando di nuovo la disponibilità dentro una transazione.
 * - card     → status "held" (slot bloccato `holdMinutes`) fino al pagamento
 * - onsite   → confermata subito, si paga il giorno del tour
 * - invoice  → confermata subito, fatturata (solo B2B approvati)
 * - giftcard → totale coperto da buoni regalo: confermata subito
 * - free     → totale azzerato da un codice sconto: confermata subito
 * Codici sconto e buoni regalo (`promoCode`, `giftCodes`) valgono solo per i clienti privati.
 */
export function createBooking(app, input, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  const tour = content.tour(input.tourSlug);
  if (!tour?.active) throw new BookingError('invalid', 'tour');
  const channel = input.channel === 'b2b' ? 'b2b' : 'b2c';
  const account = input.account ?? null;
  if (channel === 'b2b' && account?.status !== 'approved') throw new BookingError('account', 'account not approved');

  const pax = Number(input.pax);
  if (!Number.isInteger(pax) || pax < 1 || pax > tour.maxParticipants) throw new BookingError('invalid', 'participants');
  if (!isDate(input.date) || !isTime(input.time)) throw new BookingError('invalid', 'datetime');

  const name = cleanText(input.name, 120);
  const email = cleanText(input.email, 254).toLowerCase();
  if (name.length < 2) throw new BookingError('invalid', 'name');
  if (!isEmail(email)) throw new BookingError('invalid', 'email');

  const hours = freeCancelHours(cfg, tour, channel, account);
  const startInstant = localToInstant(input.date, input.time);

  return tx(db, () => {
    const ctx = loadAvailabilityContext(db, cfg, input.date, input.date, nowMs);
    const slot = slotsForDay(ctx, cfg, tour, input.date, { pax, channel, nowMs }).find((s) => s.time === input.time);
    if (!slot) throw new BookingError('unavailable', 'slot not available');

    const pricing = previewPricing(app, { tour, pax, channel, account, date: input.date, email, promoCode: input.promoCode, giftCodes: input.giftCodes, nowMs });
    if (pricing.errors.promo) throw new BookingError('promo', pricing.errors.promo);
    if (pricing.errors.gift) throw new BookingError('gift', pricing.errors.gift);

    let method = input.paymentMethod;
    if (pricing.dueCents === 0) method = pricing.giftCents > 0 ? 'giftcard' : 'free';
    else if (!paymentOptions(app, tour, channel, account).includes(method)) throw new BookingError('payment', 'payment method not allowed');

    const status = method === 'card' ? 'held' : 'confirmed';
    const prepaid = method === 'giftcard' || method === 'free';
    const now = new Date(nowMs).toISOString();
    const row = {
      ref: newRef(),
      token: newToken(),
      tour_slug: tour.slug,
      date: input.date,
      start_time: slot.time,
      end_time: slot.end,
      buffer_min: cfg.policy.bufferMin,
      participants: pax,
      channel,
      account_id: account?.id ?? null,
      name,
      email,
      phone: cleanText(input.phone, 40) || null,
      lang: normLang(input.lang),
      notes: cleanText(input.notes, 1000) || null,
      client_ref: cleanText(input.clientRef, 120) || null,
      billing_json: input.billing ? JSON.stringify(input.billing) : null,
      list_cents: pricing.listCents,
      discount_cents: pricing.discountCents,
      promo_code_id: pricing.promo?.id ?? null,
      promo_code: pricing.promo?.code ?? null,
      gift_cents: pricing.giftCents,
      total_cents: pricing.totalCents,
      currency: cfg.policy.currency,
      status,
      payment_method: method,
      payment_status: prepaid ? 'paid' : 'unpaid',
      hold_expires_at: status === 'held' ? new Date(nowMs + cfg.policy.holdMinutes * 60_000).toISOString() : null,
      free_cancel_until: new Date(startInstant - hours * HOUR).toISOString(),
      created_at: now,
      confirmed_at: status === 'confirmed' ? now : null,
    };
    const cols = Object.keys(row);
    const info = db.prepare(`INSERT INTO bookings(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
    const id = Number(info.lastInsertRowid);
    redeemGifts(db, id, pricing.gifts, nowMs);
    return getBooking(db, id);
  });
}

/** Segna come scaduta una prenotazione in attesa di pagamento e libera lo slot. */
export function expireBooking(db, bookingId, nowMs = Date.now()) {
  const changes = db.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'held'`).run(bookingId).changes;
  if (changes) restoreGifts(db, bookingId, nowMs); // il pagamento non è arrivato: i buoni tornano disponibili
  return changes;
}

/** Libera gli slot "held" scaduti (pagamento non completato). */
export function expireHolds(db, nowMs = Date.now()) {
  const ids = db.prepare(`SELECT id FROM bookings WHERE status = 'held' AND hold_expires_at <= ?`).all(new Date(nowMs).toISOString());
  let n = 0;
  for (const { id } of ids) n += expireBooking(db, id, nowMs);
  return n;
}

/**
 * Segna come pagata e conferma. Se lo slot era già scaduto prova a riprenderlo; se nel frattempo
 * è stato occupato restituisce outcome "conflict" (il chiamante deve rimborsare).
 * @returns {{outcome: 'confirmed'|'already'|'conflict'|'cancelled', booking: object}}
 */
export function confirmPaid(app, bookingId, paymentIntent = null, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new BookingError('invalid', 'booking not found');
    if (b.status === 'confirmed') {
      if (paymentIntent && !b.stripe_payment_intent) db.prepare('UPDATE bookings SET stripe_payment_intent = ? WHERE id = ?').run(paymentIntent, b.id);
      return { outcome: 'already', booking: getBooking(db, b.id) };
    }
    if (b.status === 'cancelled') return { outcome: 'cancelled', booking: b };

    if (b.status === 'expired') {
      const tour = content.tour(b.tour_slug);
      const ctx = loadAvailabilityContext(db, cfg, b.date, b.date, nowMs);
      const stillFree = slotsForDay(ctx, cfg, tour, b.date, { pax: b.participants, channel: b.channel, nowMs, ignoreId: b.id, skipNotice: true }).some((s) => s.time === b.start_time);
      if (!stillFree) return { outcome: 'conflict', booking: b };
      if (b.gift_cents > 0 && !reserveGiftsAgain(db, b.id, nowMs)) return { outcome: 'conflict', booking: b };
    }
    db.prepare(`UPDATE bookings SET status = 'confirmed', payment_status = 'paid', stripe_payment_intent = COALESCE(?, stripe_payment_intent),
                hold_expires_at = NULL, confirmed_at = ? WHERE id = ?`).run(paymentIntent, new Date(nowMs).toISOString(), b.id);
    return { outcome: 'confirmed', booking: getBooking(db, b.id) };
  });
}

/** Stato della politica di cancellazione per una prenotazione. */
export function cancellationState(b, nowMs = Date.now()) {
  const until = Date.parse(b.free_cancel_until);
  const startsAt = localToInstant(b.date, b.start_time);
  return {
    until,
    free: nowMs <= until && nowMs < startsAt,
    started: nowMs >= startsAt,
    // false se la prenotazione è stata fatta quando il termine era già passato
    everRefundable: Date.parse(b.created_at) <= until,
  };
}

/**
 * Annulla la prenotazione (solo DB). Calcola quanto va rimborsato:
 * refund: 'auto' (entro il termine di cancellazione gratuita) | 'full' | 'none'.
 * Il rimborso riguarda la quota pagata con carta; la quota pagata con buoni regalo torna sul buono.
 * Una prenotazione ancora in attesa di pagamento non ha incassato nulla: i buoni tornano sempre disponibili.
 * @returns {{booking: object, refundCents: number, giftRestoredCents: number}}
 */
export function cancelBooking(app, bookingId, { by, reason = null, refund = 'auto' }, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new BookingError('invalid', 'booking not found');
    if (b.status === 'cancelled' || b.status === 'expired') return { booking: b, refundCents: 0, giftRestoredCents: 0, already: true };

    const refundable = refund === 'full' || (refund === 'auto' && cancellationState(b, nowMs).free);
    const refundCents = b.payment_status === 'paid' && refundable ? bookingDue(b) : 0;

    db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, hold_expires_at = NULL WHERE id = ?`).run(
      new Date(nowMs).toISOString(),
      by,
      cleanText(reason, 300) || null,
      b.id,
    );
    const giftRestoredCents = b.status === 'held' || refundable ? restoreGifts(db, b.id, nowMs) : 0;
    return { booking: getBooking(db, b.id), refundCents, giftRestoredCents };
  });
}

export function markRefund(db, bookingId, { ok, cents }) {
  if (ok) db.prepare(`UPDATE bookings SET payment_status = 'refunded', refund_cents = ? WHERE id = ?`).run(cents, bookingId);
  else db.prepare(`UPDATE bookings SET payment_status = 'refund_failed' WHERE id = ?`).run(bookingId);
}

export function bookingEnd(b) {
  return localToInstant(b.date, b.end_time);
}

export function slotStillOpen(app, tour, date, time, pax, channel, nowMs = Date.now()) {
  return daySlots(app.db, app.cfg, tour, date, { pax, channel, nowMs }).find((s) => s.time === time) ?? null;
}

