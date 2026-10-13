// Logica di business delle prenotazioni (solo database, nessuna rete).
import { tx } from './db.js';
import { daySlots, loadAvailabilityContext, slotsForDay } from './availability.js';
import { isDate, isTime, localToInstant, toMin } from './time.js';
import { openTo, serviceRecord } from './rates.js';
import { previewPricing, priceFor, redeemGifts, reserveGiftsAgain, restoreGifts, unitPriceFor } from './pricing.js';
import { cleanText, isEmail, newRef, newToken } from './util.js';
import { LANGS, normLang } from './langs.js';
import { freeHoursOf, hasFreeTier, parseTiers, policyFor, refundPercentAt, singleTier, splitAmounts } from './policy.js';
import { isPreOpening } from './opening.js';
import { maxActiveOptions, optionWindow, reminderAt } from './optionPolicy.js';

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
  return freeHoursOf(policyFor(cfg, tour, channel, account));
}

/** Importo che il cliente deve ancora pagare con carta/in sede/fattura (totale meno quanto coperto da buoni regalo). */
export const bookingDue = (b) => b.total_cents - (b.gift_cents ?? 0);

/**
 * Metodi di pagamento disponibili (può essere vuoto: prenotazioni online non attive finché non si configura Stripe).
 * In «pre-apertura» (prima della data degli incassi, vedi opening.js) non si incassa online: ai privati resta il pagamento
 * il giorno del servizio, alle agenzie la fattura.
 */
export function paymentOptions(app, tour, channel, account = null, nowMs = Date.now()) {
  const { cfg } = app;
  const pre = isPreOpening(cfg, nowMs);
  const cardOk = (!!cfg.stripe.secretKey || cfg.demoPayments) && !pre;
  const opts = [];
  if (channel === 'b2b') {
    if (account?.allow_invoice) opts.push('invoice');
    if (cardOk) opts.push('card');
  } else if (pre) {
    opts.push('onsite');
  } else {
    if (cardOk) opts.push('card');
    if (cfg.policy.allowPayOnSite && tour.payOnSite) opts.push('onsite');
  }
  return opts;
}

const iso = (ms) => new Date(ms).toISOString();


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
 * - option   → (`input.option`, solo partner) status "option": la data resta trattenuta senza pagare fino a `option_expires_at`;
 *              si conferma (fattura o carta) o si rilascia; altrimenti si libera da sola
 * Codici sconto e buoni regalo (`promoCode`, `giftCodes`) valgono solo per i clienti privati.
 */
export function createBooking(app, input, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  const tour = content.tour(input.tourSlug);
  if (!tour?.active) throw new BookingError('invalid', 'tour');
  const channel = input.channel === 'b2b' ? 'b2b' : 'b2c';
  if (!openTo(app.rates.get(), tour, channel)) throw new BookingError('invalid', 'audience'); // servizio riservato alle agenzie
  const account = input.account ?? null;
  if (channel === 'b2b' && account?.status !== 'approved') throw new BookingError('account', 'account not approved');

  const pax = Number(input.pax);
  if (!Number.isInteger(pax) || pax < 1 || pax > tour.maxParticipants) throw new BookingError('invalid', 'participants');
  if (!isDate(input.date) || !isTime(input.time)) throw new BookingError('invalid', 'datetime');

  const name = cleanText(input.name, 120);
  const email = cleanText(input.email, 254).toLowerCase();
  if (name.length < 2) throw new BookingError('invalid', 'name');
  if (!isEmail(email)) throw new BookingError('invalid', 'email');

  const wantsOption = !!input.option;
  if (wantsOption && channel !== 'b2b') throw new BookingError('option', 'only agencies can option a date');
  const tiers = policyFor(cfg, tour, channel, account); // dei partner o dei privati; se ne conserva una copia nella prenotazione
  const startInstant = localToInstant(input.date, input.time);

  return tx(db, () => {
    const ctx = loadAvailabilityContext(db, cfg, input.date, input.date, nowMs);
    // servizi a ore: la durata è quella scelta (o fissa del tour) e il prezzo viene dalle tariffe a ore
    const quoteInput = { hours: input.hours, earpieces: !!input.earpieces };
    const pricing = previewPricing(app, { tour, pax, channel, account, date: input.date, time: input.time, ...quoteInput, email, promoCode: input.promoCode, giftCodes: input.giftCodes, nowMs });
    if (pricing.quote && !pricing.quote.ok) throw new BookingError('invalid', `hours (${pricing.quote.reason})`);
    const durationMin = pricing.quote ? Math.round(pricing.quote.hours * 60) : null;

    const slot = slotsForDay(ctx, cfg, tour, input.date, { pax, channel, nowMs, durationMin }).find((s) => s.time === input.time);
    if (!slot) throw new BookingError('unavailable', 'slot not available');
    // lingua del tour: tra quelle offerte; in una partenza condivisa già iniziata vale quella di chi ha prenotato per primo
    const offered = tour.languages?.length ? tour.languages : LANGS;
    const asked = input.tourLang ? String(input.tourLang) : '';
    if (asked && !offered.includes(asked)) throw new BookingError('invalid', 'tourLang');
    const confirmLang = normLang(input.lang);
    const tourLang = asked || slot.lang || (offered.includes(confirmLang) ? confirmLang : offered[0]);
    if (slot.lang && slot.lang !== tourLang) throw new BookingError('language', slot.lang); // il gruppo parla già un'altra lingua
    if (pricing.errors.promo) throw new BookingError('promo', pricing.errors.promo);
    if (pricing.errors.gift) throw new BookingError('gift', pricing.errors.gift);

    // opzione: la data resta trattenuta senza pagare, fino a una scadenza decisa dalle regole del sito (e del partner)
    let optionExpires = null;
    if (wantsOption) {
      const win = optionWindow({ options: cfg.options, account, startMs: startInstant, nowMs });
      if (!win.ok) throw new BookingError('option', win.reason);
      const limit = maxActiveOptions(cfg.options, account);
      if (limit > 0 && activeOptionCount(db, account.id, nowMs) >= limit) throw new BookingError('option', 'limit');
      optionExpires = iso(win.expiresMs);
    }

    let method = input.paymentMethod;
    if (wantsOption) method = account.allow_invoice ? 'invoice' : 'card'; // come pagherà si sceglie alla conferma
    else if (pricing.dueCents === 0) method = pricing.giftCents > 0 ? 'giftcard' : 'free';
    else if (!paymentOptions(app, tour, channel, account, nowMs).includes(method)) throw new BookingError('payment', 'payment method not allowed');

    const status = wantsOption ? 'option' : method === 'card' ? 'held' : 'confirmed';
    const prepaid = !wantsOption && (method === 'giftcard' || method === 'free');
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
      lang: confirmLang,
      tour_lang: tourLang,
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
      option_expires_at: optionExpires,
      free_cancel_until: hasFreeTier(tiers) ? new Date(startInstant - freeHoursOf(tiers) * HOUR).toISOString() : now, // senza periodo gratuito: già scaduto
      cancel_policy_json: JSON.stringify(tiers),
      service_json: pricing.quote ? JSON.stringify(serviceRecord(pricing.quote)) : null,
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

/**
 * Segna come scaduta una prenotazione in attesa di pagamento e libera lo slot.
 * Se era un'opzione che si stava confermando con la carta e la sua scadenza non è ancora arrivata, torna opzione (il pagamento
 * non è andato a buon fine, ma la data resta trattenuta fino alla scadenza dell'opzione).
 */
export function expireBooking(db, bookingId, nowMs = Date.now()) {
  const b = getBooking(db, bookingId);
  if (b?.status === 'held' && b.option_expires_at && Date.parse(b.option_expires_at) > nowMs) {
    return db.prepare(`UPDATE bookings SET status = 'option', hold_expires_at = NULL WHERE id = ? AND status = 'held'`).run(bookingId).changes;
  }
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
 * @returns {{outcome: 'confirmed'|'paid_later'|'already'|'conflict'|'cancelled', booking: object}}
 */
export function confirmPaid(app, bookingId, paymentIntent = null, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new BookingError('invalid', 'booking not found');
    if (b.status === 'confirmed') {
      if (paymentIntent && !b.stripe_payment_intent) {
        // chi aveva scelto di pagare il giorno del servizio (o prenotato prima dell'apertura degli incassi) può pagare online dalla pagina della prenotazione
        const payNow = b.payment_status === 'unpaid' && b.payment_method === 'onsite';
        db.prepare(`UPDATE bookings SET stripe_payment_intent = ?${payNow ? ", payment_status = 'paid', payment_method = 'card'" : ''} WHERE id = ?`).run(paymentIntent, b.id);
        if (payNow) return { outcome: 'paid_later', booking: getBooking(db, b.id) };
      }
      return { outcome: 'already', booking: getBooking(db, b.id) };
    }
    if (b.status === 'cancelled') return { outcome: 'cancelled', booking: b };

    if (b.status === 'expired') {
      const tour = content.tour(b.tour_slug);
      const ctx = loadAvailabilityContext(db, cfg, b.date, b.date, nowMs);
      const durationMin = toMin(b.end_time) - toMin(b.start_time); // anche per i servizi a ore, con la durata scelta
      const stillFree = slotsForDay(ctx, cfg, tour, b.date, { pax: b.participants, channel: b.channel, nowMs, ignoreId: b.id, skipNotice: true, durationMin, tourLang: b.tour_lang ?? null }).some((s) => s.time === b.start_time);
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
  // le prenotazioni più vecchie non hanno gli scaglioni: avevano un solo termine gratuito
  const tiers = parseTiers(b.cancel_policy_json) ?? singleTier(Math.round((startsAt - until) / HOUR));
  const percent = refundPercentAt(tiers, startsAt, nowMs);
  return {
    until, // fine del periodo gratuito
    tiers,
    startsAt,
    percent, // rimborso se si annulla adesso (0-100)
    free: percent === 100,
    started: nowMs >= startsAt,
    // false se la prenotazione è stata fatta quando non c'era già più nulla da rimborsare
    everRefundable: refundPercentAt(tiers, startsAt, Date.parse(b.created_at)) > 0,
  };
}

/**
 * Annulla la prenotazione (solo DB). Calcola quanto va rimborsato e quanto resta dovuto (penale):
 * refund: 'auto' (percentuale dello scaglione in cui ci si trova) | 'full' (nessuna penale) | 'none' (penale per l'intero importo).
 * Il rimborso riguarda la quota pagata con carta; chi non ha ancora pagato (fattura, sul posto) deve la penale.
 * La quota pagata con buoni regalo torna sul buono solo se il rimborso è totale.
 * Una prenotazione ancora in attesa di pagamento non ha incassato nulla e non deve nulla: i buoni tornano sempre disponibili.
 * @returns {{booking: object, refundCents: number, retainedCents: number, percent: number, giftRestoredCents: number}}
 */
export function cancelBooking(app, bookingId, { by, reason = null, refund = 'auto' }, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new BookingError('invalid', 'booking not found');
    if (b.status === 'cancelled' || b.status === 'expired') return { booking: b, refundCents: 0, retainedCents: 0, percent: 0, giftRestoredCents: 0, already: true };
    // un'opzione non ha incassato nulla né dà diritto a penali: annullarla vuol dire rilasciare la data (e non conta come annullo)
    if (b.status === 'option') {
      lapseOption(db, b, by, nowMs, reason || 'Opzione rilasciata');
      return { booking: getBooking(db, b.id), refundCents: 0, retainedCents: 0, percent: 100, giftRestoredCents: 0, option: true };
    }

    const percent = refund === 'full' ? 100 : refund === 'none' ? 0 : cancellationState(b, nowMs).percent;
    const { refundCents, retainedCents } = b.status === 'confirmed' ? splitAmounts({ paidCents: b.payment_status === 'paid' ? bookingDue(b) : 0, dueCents: bookingDue(b) }, percent) : { refundCents: 0, retainedCents: 0 };

    db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, cancel_percent = ?, retained_cents = ?, hold_expires_at = NULL WHERE id = ?`).run(
      new Date(nowMs).toISOString(),
      by,
      cleanText(reason, 300) || null,
      percent,
      retainedCents,
      b.id,
    );
    const giftRestoredCents = b.status === 'held' || percent === 100 ? restoreGifts(db, b.id, nowMs) : 0;
    return { booking: getBooking(db, b.id), refundCents, retainedCents, percent, giftRestoredCents };
  });
}

export function markRefund(db, bookingId, { ok, cents }) {
  if (ok) db.prepare(`UPDATE bookings SET payment_status = 'refunded', refund_cents = ? WHERE id = ?`).run(cents, bookingId);
  else db.prepare(`UPDATE bookings SET payment_status = 'refund_failed' WHERE id = ?`).run(bookingId);
}

export function bookingEnd(b) {
  return localToInstant(b.date, b.end_time);
}

export function slotStillOpen(app, tour, date, time, pax, channel, nowMs = Date.now(), durationMin = null) {
  return daySlots(app.db, app.cfg, tour, date, { pax, channel, nowMs, durationMin }).find((s) => s.time === time) ?? null;
}


// ───────────── opzioni ─────────────
/** Quante opzioni non scadute ha aperte un partner. */
export function activeOptionCount(db, accountId, nowMs = Date.now()) {
  return db.prepare(`SELECT COUNT(*) n FROM bookings WHERE account_id = ? AND status = 'option' AND option_expires_at > ?`).get(accountId, iso(nowMs)).n;
}

/** Chiude un'opzione senza conferma (scaduta o rilasciata): lo slot si libera. Non è un annullo: nessun rimborso, nessuna penale. */
function lapseOption(db, b, by, nowMs, reason) {
  return db.prepare(`UPDATE bookings SET status = 'expired', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, hold_expires_at = NULL WHERE id = ? AND status = 'option'`).run(iso(nowMs), by, cleanText(reason, 300) || null, b.id).changes;
}

/** Il partner (o la guida) rilascia l'opzione: la data torna libera. @returns {object|null} la prenotazione, o null se non era un'opzione aperta */
export function releaseOption(app, bookingId, { by, reason = 'Opzione rilasciata' }, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b || b.status !== 'option') return null;
    lapseOption(db, b, by, nowMs, reason);
    return getBooking(db, b.id);
  });
}

/** Libera le opzioni scadute. @returns {object[]} le prenotazioni appena scadute (servono per avvisare l'agenzia) */
export function expireOptions(db, nowMs = Date.now()) {
  const due = db.prepare(`SELECT * FROM bookings WHERE status = 'option' AND option_expires_at <= ?`).all(iso(nowMs));
  return due.filter((b) => lapseOption(db, b, 'system', nowMs, 'Opzione scaduta senza conferma') === 1).map((b) => getBooking(db, b.id));
}

/** Opzioni a cui va mandato adesso il promemoria di scadenza. */
export function optionsDueForReminder(app, nowMs = Date.now()) {
  const { db, cfg } = app;
  return db
    .prepare(`SELECT * FROM bookings WHERE status = 'option' AND option_reminded_at IS NULL AND option_expires_at > ?`)
    .all(iso(nowMs))
    .filter((b) => {
      const at = reminderAt({ createdMs: Date.parse(b.created_at), expiresMs: Date.parse(b.option_expires_at), reminderHours: cfg.options.reminderHours });
      return at != null && at <= nowMs;
    });
}

/** Prolunga un'opzione di `days` giorni (dalla scadenza attuale, o da adesso se è già scaduta ma non ancora liberata), mai oltre l'inizio del servizio. */
export function extendOption(app, bookingId, days, nowMs = Date.now()) {
  const { db } = app;
  const n = Math.round(Number(days));
  if (!Number.isInteger(n) || n < 1 || n > 90) throw new BookingError('invalid', 'days');
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b || b.status !== 'option') return null;
    const from = Math.max(Date.parse(b.option_expires_at), nowMs);
    const latest = localToInstant(b.date, b.start_time) - HOUR;
    const next = Math.min(from + n * 24 * HOUR, latest);
    if (next <= nowMs) return null;
    db.prepare(`UPDATE bookings SET option_expires_at = ?, option_reminded_at = NULL WHERE id = ?`).run(iso(next), b.id);
    return getBooking(db, b.id);
  });
}

/**
 * L'agenzia conferma l'opzione. Se può pagare a fattura, la prenotazione è subito confermata; altrimenti passa «in attesa di pagamento»
 * con la carta (lo slot resta trattenuto `holdMinutes`, come per ogni prenotazione con carta).
 * @returns {{outcome: 'confirmed'|'pay'|'expired'|'state'|'payment'|'account', booking: object}}
 */
export function confirmOption(app, bookingId, { method = null } = {}, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b || b.status !== 'option') return { outcome: 'state', booking: b };
    if (Date.parse(b.option_expires_at) <= nowMs) {
      lapseOption(db, b, 'system', nowMs, 'Opzione scaduta senza conferma');
      return { outcome: 'expired', booking: getBooking(db, b.id) };
    }
    const account = b.account_id ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id) : null;
    if (account?.status !== 'approved') return { outcome: 'account', booking: b };
    const allowed = paymentOptions(app, content.tour(b.tour_slug), 'b2b', account, nowMs);
    const chosen = allowed.includes(method) ? method : allowed[0];
    if (!chosen) return { outcome: 'payment', booking: b };
    if (chosen === 'invoice') {
      db.prepare(`UPDATE bookings SET status = 'confirmed', payment_method = 'invoice', confirmed_at = ?, hold_expires_at = NULL WHERE id = ?`).run(iso(nowMs), b.id);
      return { outcome: 'confirmed', booking: getBooking(db, b.id) };
    }
    db.prepare(`UPDATE bookings SET status = 'held', payment_method = 'card', hold_expires_at = ? WHERE id = ?`).run(iso(nowMs + cfg.policy.holdMinutes * 60_000), b.id);
    return { outcome: 'pay', booking: getBooking(db, b.id) };
  });
}
