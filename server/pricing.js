// Prezzi, codici sconto e buoni regalo (solo database, nessuna rete).
import { applyPartnerDiscount } from './rates.js';
import { nowRome } from './time.js';

/** Prezzo unitario. B2B: tariffa B2B del tour, meno lo sconto extra dell'account. */
const priceLists = new WeakMap();
/** Listino dedicato di un partner: { slug: centesimi } (vuoto se non ne ha). */
export function accountPrices(account) {
  if (!account?.prices_json) return {};
  if (!priceLists.has(account)) {
    let list = {};
    try {
      const raw = JSON.parse(account.prices_json);
      for (const [slug, cents] of Object.entries(raw ?? {})) if (Number.isInteger(cents) && cents >= 0) list[slug] = cents;
    } catch {
      list = {};
    }
    priceLists.set(account, list);
  }
  return priceLists.get(account);
}

/** Prezzo di un tour per un canale: ai partner, il prezzo dedicato se c'è; altrimenti la tariffa B2B meno lo sconto del partner. */
export function unitPriceFor(tour, channel, account = null) {
  if (channel !== 'b2b') return tour.priceCents;
  const dedicated = accountPrices(account)[tour.slug];
  if (dedicated != null) return dedicated;
  return applyPartnerDiscount(tour.b2bPriceCents, account?.discount_percent); // sconto del partner, arrotondato al multiplo di 5 € per eccesso
}

/** Preventivo di un servizio a ore: le ore sono quelle scelte dal cliente, oppure la durata del tour se è fissa. */
export function hourlyQuote(app, tour, { pax = 1, channel, account = null, date = null, time = null, hours = null, earpieces = false }) {
  const h = tour.chooseHours ? Number(hours) : tour.durationMin / 60;
  return app.rates.quote({ service: tour.service, channel, hours: h, date, time, pax, earpieces, discountPercent: channel === 'b2b' ? (account?.discount_percent ?? 0) : 0 });
}

/** Prezzo di listino in centesimi: a persona (× partecipanti) oppure a gruppo. Per i servizi a ore vale `previewPricing`. */
export function priceFor(tour, pax, channel, account = null) {
  const unit = unitPriceFor(tour, channel, account);
  return tour.model === 'person' ? unit * pax : unit;
}

// ───────────── codici ─────────────
export const normalizePromo = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
export const normalizeGift = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
/** Più buoni nello stesso campo, separati da spazi, virgole o punti e virgola (max 5). */
export const splitGiftCodes = (s) => [...new Set(String(s ?? '').split(/[\s,;]+/).map(normalizeGift).filter(Boolean))].slice(0, 5);
export const formatGiftCode = (code) => String(code).replace(/(.{4})(?=.)/g, '$1-');

// ───────────── codici sconto ─────────────
/** Quante prenotazioni attive usano il codice (le "held" scadute non contano). */
export function promoUses(db, promoId, nowMs, { email = null, ignoreBookingId = null } = {}) {
  let sql = `SELECT COUNT(*) n FROM bookings WHERE promo_code_id = ? AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))`;
  const args = [promoId, new Date(nowMs).toISOString()];
  if (email) {
    sql += ' AND lower(email) = ?';
    args.push(String(email).toLowerCase());
  }
  if (ignoreBookingId) {
    sql += ' AND id != ?';
    args.push(ignoreBookingId);
  }
  return db.prepare(sql).get(...args).n;
}

/**
 * Verifica un codice sconto per una prenotazione.
 * @returns {{ok: true, promo: object, discountCents: number} | {ok: false, reason: string}}
 * motivi: notfound | inactive | not_started | expired | service_window | tour | min_total | exhausted | email_used
 */
export function checkPromo(db, rawCode, { tour, date, listCents, email, nowMs, ignoreBookingId = null }) {
  const code = normalizePromo(rawCode);
  const promo = code ? db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code) : null;
  if (!promo) return { ok: false, reason: 'notfound' };
  if (!promo.active) return { ok: false, reason: 'inactive' };
  const today = nowRome(nowMs).date;
  if (promo.valid_from && today < promo.valid_from) return { ok: false, reason: 'not_started' };
  if (promo.valid_to && today > promo.valid_to) return { ok: false, reason: 'expired' };
  if ((promo.service_from && date < promo.service_from) || (promo.service_to && date > promo.service_to)) return { ok: false, reason: 'service_window' };
  if (promo.tours && !JSON.parse(promo.tours).includes(tour.slug)) return { ok: false, reason: 'tour' };
  if (promo.min_total_cents && listCents < promo.min_total_cents) return { ok: false, reason: 'min_total' };
  if (promo.max_uses != null && promoUses(db, promo.id, nowMs, { ignoreBookingId }) >= promo.max_uses) return { ok: false, reason: 'exhausted' };
  if (promo.one_per_email && email && promoUses(db, promo.id, nowMs, { email, ignoreBookingId }) > 0) return { ok: false, reason: 'email_used' };
  const discountCents = promo.kind === 'percent' ? Math.round((listCents * promo.value) / 100) : Math.min(promo.value, listCents);
  return { ok: true, promo, discountCents };
}

// ───────────── buoni regalo ─────────────
/** motivi: notfound | inactive | expired | empty */
export function checkGiftCode(db, rawCode, nowMs) {
  const code = normalizeGift(rawCode);
  const card = code ? db.prepare('SELECT * FROM gift_cards WHERE code = ?').get(code) : null;
  if (!card || card.status === 'pending') return { ok: false, reason: 'notfound' };
  if (card.status === 'void') return { ok: false, reason: 'inactive' };
  if (card.expires_at && nowRome(nowMs).date > card.expires_at) return { ok: false, reason: 'expired' };
  if (card.balance_cents <= 0) return { ok: false, reason: 'empty' };
  return { ok: true, card };
}

/**
 * Calcola il prezzo con sconto e buoni regalo (senza modificare nulla).
 * Solo il canale B2C usa codici e buoni: i partner hanno già le loro tariffe.
 */
export function previewPricing(app, { tour, pax, channel, account = null, date, time = null, hours = null, earpieces = false, email = '', promoCode = '', giftCodes = '', nowMs = Date.now(), ignoreBookingId = null }) {
  const { db } = app;
  // servizi a ore: il prezzo viene dalle tariffe a ore (ore, festivo, notturno, auricolari)
  const quote = tour.pricing === 'hourly' ? hourlyQuote(app, tour, { pax, channel, account, date, time, hours, earpieces }) : null;
  const listCents = quote ? (quote.ok ? quote.totalCents : 0) : priceFor(tour, pax, channel, account);
  const out = { listCents, discountCents: 0, totalCents: listCents, giftCents: 0, dueCents: listCents, promo: null, gifts: [], errors: {}, quote };
  if (channel !== 'b2c') return out;

  if (normalizePromo(promoCode)) {
    const r = checkPromo(db, promoCode, { tour, date, listCents, email, nowMs, ignoreBookingId });
    if (r.ok) {
      out.promo = r.promo;
      out.discountCents = r.discountCents;
      out.totalCents = listCents - r.discountCents;
    } else out.errors.promo = r.reason;
  }

  let remaining = out.totalCents;
  for (const code of splitGiftCodes(giftCodes)) {
    const r = checkGiftCode(db, code, nowMs);
    if (!r.ok) {
      out.errors.gift = r.reason;
      continue;
    }
    if (remaining <= 0) break;
    const cents = Math.min(r.card.balance_cents, remaining);
    out.gifts.push({ card: r.card, cents });
    remaining -= cents;
    out.giftCents += cents;
  }
  out.dueCents = out.totalCents - out.giftCents;
  return out;
}

// ───────────── movimenti dei buoni (registro) ─────────────
export function ledgerAdd(db, cardId, deltaCents, kind, { bookingId = null, note = null, nowMs = Date.now() } = {}) {
  db.prepare('INSERT INTO gift_card_ledger(gift_card_id, delta_cents, kind, booking_id, note, created_at) VALUES(?,?,?,?,?,?)').run(cardId, deltaCents, kind, bookingId, note, new Date(nowMs).toISOString());
  db.prepare('UPDATE gift_cards SET balance_cents = balance_cents + ? WHERE id = ?').run(deltaCents, cardId);
}

/** Scala il saldo dei buoni usati da una prenotazione. */
export function redeemGifts(db, bookingId, gifts, nowMs) {
  for (const { card, cents } of gifts) ledgerAdd(db, card.id, -cents, 'redeem', { bookingId, nowMs });
}

function giftUsage(db, bookingId) {
  return db
    .prepare(
      `SELECT gift_card_id AS cardId,
              COALESCE(SUM(CASE WHEN kind = 'redeem' THEN -delta_cents END), 0) AS used,
              COALESCE(SUM(CASE WHEN kind = 'restore' THEN delta_cents END), 0) AS restored
       FROM gift_card_ledger WHERE booking_id = ? GROUP BY gift_card_id`,
    )
    .all(bookingId);
}

/** Restituisce ai buoni quanto la prenotazione aveva usato (idempotente). @returns {number} centesimi restituiti */
export function restoreGifts(db, bookingId, nowMs = Date.now()) {
  let total = 0;
  for (const u of giftUsage(db, bookingId)) {
    const outstanding = u.used - u.restored;
    if (outstanding > 0) {
      ledgerAdd(db, u.cardId, outstanding, 'restore', { bookingId, nowMs });
      total += outstanding;
    }
  }
  return total;
}

/**
 * Riserva di nuovo i buoni già restituiti (pagamento arrivato dopo la scadenza dello slot).
 * @returns {boolean} false se non è più possibile (saldo speso o buono non valido): nulla viene modificato
 */
export function reserveGiftsAgain(db, bookingId, nowMs = Date.now()) {
  const need = giftUsage(db, bookingId).filter((u) => u.used > 0 && u.used - u.restored === 0);
  const today = nowRome(nowMs).date;
  for (const u of need) {
    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(u.cardId);
    if (!card || card.status !== 'active' || card.balance_cents < u.used || (card.expires_at && today > card.expires_at)) return false;
  }
  for (const u of need) {
    ledgerAdd(db, u.cardId, -u.used, 'redeem', { bookingId, note: 'ri-riservato dopo pagamento tardivo', nowMs });
  }
  return true;
}
