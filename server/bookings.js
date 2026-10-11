// Logica di business delle prenotazioni (solo database, nessuna rete).
import { tx } from './db.js';
import { daySlots, loadAvailabilityContext, slotsForDay } from './availability.js';
import { isDate, isTime, localToInstant } from './time.js';
import { cleanText, isEmail, newRef, newToken } from './util.js';

export class BookingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // invalid | unavailable | payment | account
  }
}

const HOUR = 3600_000;

/** Prezzo totale in centesimi. B2B: tariffa B2B del tour, meno lo sconto extra dell'account. */
export function priceFor(tour, pax, channel, account = null) {
  let unit = channel === 'b2b' ? tour.b2bPriceCents : tour.priceCents;
  if (channel === 'b2b' && account?.discount_percent) unit = Math.round(unit * (1 - account.discount_percent / 100));
  return tour.model === 'person' ? unit * pax : unit;
}

export function unitPriceFor(tour, channel, account = null) {
  let unit = channel === 'b2b' ? tour.b2bPriceCents : tour.priceCents;
  if (channel === 'b2b' && account?.discount_percent) unit = Math.round(unit * (1 - account.discount_percent / 100));
  return unit;
}

/** Ore di preavviso entro cui la cancellazione è gratuita. */
export function freeCancelHours(cfg, tour, channel, account = null) {
  if (channel === 'b2b') return account?.cancel_hours ?? cfg.policy.b2bFreeCancelHours;
  return tour.cancelHours ?? cfg.policy.b2cFreeCancelHours;
}

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
  return opts.length ? opts : channel === 'b2b' ? ['invoice'] : ['onsite'];
}

export function getBooking(db, id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}
export function getBookingByRef(db, ref) {
  return db.prepare('SELECT * FROM bookings WHERE ref = ?').get(String(ref));
}

/**
 * Crea una prenotazione verificando di nuovo la disponibilità dentro una transazione.
 * - card    → status "held" (slot bloccato `holdMinutes`) fino al pagamento
 * - onsite  → confermata subito, si paga il giorno del tour
 * - invoice → confermata subito, fatturata (solo B2B approvati)
 */
export function createBooking(app, input, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  const tour = content.tour(input.tourSlug);
  if (!tour) throw new BookingError('invalid', 'tour');
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

  const method = input.paymentMethod;
  if (!paymentOptions(app, tour, channel, account).includes(method)) throw new BookingError('payment', 'payment method not allowed');

  const hours = freeCancelHours(cfg, tour, channel, account);
  const total = priceFor(tour, pax, channel, account);
  const startInstant = localToInstant(input.date, input.time);

  return tx(db, () => {
    const ctx = loadAvailabilityContext(db, cfg, input.date, input.date, nowMs);
    const slot = slotsForDay(ctx, cfg, tour, input.date, { pax, channel, nowMs }).find((s) => s.time === input.time);
    if (!slot) throw new BookingError('unavailable', 'slot not available');

    const status = method === 'card' ? 'held' : 'confirmed';
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
      lang: input.lang === 'en' ? 'en' : 'it',
      notes: cleanText(input.notes, 1000) || null,
      client_ref: cleanText(input.clientRef, 120) || null,
      billing_json: input.billing ? JSON.stringify(input.billing) : null,
      total_cents: total,
      currency: cfg.policy.currency,
      status,
      payment_method: method,
      payment_status: 'unpaid',
      hold_expires_at: status === 'held' ? new Date(nowMs + cfg.policy.holdMinutes * 60_000).toISOString() : null,
      free_cancel_until: new Date(startInstant - hours * HOUR).toISOString(),
      created_at: now,
      confirmed_at: status === 'confirmed' ? now : null,
    };
    const cols = Object.keys(row);
    const info = db.prepare(`INSERT INTO bookings(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
    return getBooking(db, Number(info.lastInsertRowid));
  });
}

/** Libera gli slot "held" scaduti (pagamento non completato). */
export function expireHolds(db, nowMs = Date.now()) {
  return db.prepare(`UPDATE bookings SET status = 'expired' WHERE status = 'held' AND hold_expires_at <= ?`).run(new Date(nowMs).toISOString()).changes;
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
 * refund: 'auto' (se pagata con carta ed entro il termine) | 'full' | 'none'
 * @returns {{booking: object, refundCents: number}}
 */
export function cancelBooking(app, bookingId, { by, reason = null, refund = 'auto' }, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new BookingError('invalid', 'booking not found');
    if (b.status === 'cancelled' || b.status === 'expired') return { booking: b, refundCents: 0, already: true };

    const paid = b.payment_status === 'paid';
    let refundCents = 0;
    if (paid && (refund === 'full' || (refund === 'auto' && cancellationState(b, nowMs).free))) refundCents = b.total_cents;

    db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, hold_expires_at = NULL WHERE id = ?`).run(
      new Date(nowMs).toISOString(),
      by,
      cleanText(reason, 300) || null,
      b.id,
    );
    return { booking: getBooking(db, b.id), refundCents };
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

