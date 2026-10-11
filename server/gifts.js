// Buoni regalo: acquisto, attivazione, consegna, annullo e rettifiche (solo database).
import { tx } from './db.js';
import { ledgerAdd } from './pricing.js';
import { addMonths, isDate, nowRome } from './time.js';
import { cleanText, isEmail, newGiftCode, newRef, newToken } from './util.js';
import { normLang } from './langs.js';

export class GiftError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // amount | buyer | recipient | date | payment
  }
}

export const getGift = (db, id) => db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
export const getGiftByRef = (db, ref) => db.prepare('SELECT * FROM gift_cards WHERE ref = ?').get(String(ref));

function uniqueCode(db) {
  for (let i = 0; i < 10; i++) {
    const code = newGiftCode();
    if (!db.prepare('SELECT 1 FROM gift_cards WHERE code = ?').get(code)) return code;
  }
  throw new Error('impossibile generare un codice univoco');
}

function validate(app, input, nowMs, { admin = false } = {}) {
  const { cfg } = app;
  const cents = Number(input.amountCents);
  if (!Number.isInteger(cents) || cents < cfg.gift.minCents || cents > cfg.gift.maxCents) throw new GiftError('amount', 'amount out of range');
  const buyerName = cleanText(input.buyerName, 120);
  const buyerEmail = cleanText(input.buyerEmail, 254).toLowerCase();
  if (!admin && (buyerName.length < 2 || !isEmail(buyerEmail))) throw new GiftError('buyer', 'buyer');
  if (buyerEmail && !isEmail(buyerEmail)) throw new GiftError('buyer', 'buyer email');
  const recipientEmail = cleanText(input.recipientEmail, 254).toLowerCase();
  if (input.delivery === 'recipient' && !isEmail(recipientEmail)) throw new GiftError('recipient', 'recipient email required');
  if (recipientEmail && !isEmail(recipientEmail)) throw new GiftError('recipient', 'recipient email');
  const today = nowRome(nowMs).date;
  let deliverOn = null;
  if (input.delivery === 'recipient') {
    deliverOn = input.deliverOn || today;
    if (!isDate(deliverOn) || deliverOn < today || deliverOn > addMonths(today, 12)) throw new GiftError('date', 'delivery date');
  }
  return {
    cents,
    buyerName: buyerName || null,
    buyerEmail: buyerEmail || null,
    recipientName: cleanText(input.recipientName, 120) || null,
    recipientEmail: recipientEmail || null,
    message: cleanText(input.message, 400) || null,
    lang: normLang(input.lang),
    deliverOn,
  };
}

function insertGift(db, v, { status, source, nowMs, billing = null, expiresAt = null }) {
  const row = {
    ref: newRef('GC'),
    token: newToken(),
    code: uniqueCode(db),
    status,
    initial_cents: v.cents,
    balance_cents: 0,
    source,
    buyer_name: v.buyerName,
    buyer_email: v.buyerEmail,
    recipient_name: v.recipientName,
    recipient_email: v.recipientEmail,
    message: v.message,
    lang: v.lang,
    deliver_on: v.deliverOn,
    billing_json: billing ? JSON.stringify(billing) : null,
    created_at: new Date(nowMs).toISOString(),
    activated_at: status === 'active' ? new Date(nowMs).toISOString() : null,
    expires_at: expiresAt,
  };
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO gift_cards(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
  const id = Number(info.lastInsertRowid);
  if (status === 'active') ledgerAdd(db, id, v.cents, 'issue', { nowMs });
  return getGift(db, id);
}

/** Ordine d'acquisto dal sito: resta "pending" finché il pagamento non arriva. */
export function createGiftOrder(app, input, nowMs = Date.now()) {
  const v = validate(app, input, nowMs);
  return tx(app.db, () => insertGift(app.db, v, { status: 'pending', source: 'web', nowMs, billing: input.billing }));
}

/** Buono creato dal pannello admin (venduto di persona, omaggio…): attivo subito. */
export function createAdminGift(app, input, nowMs = Date.now()) {
  const v = validate(app, { ...input, delivery: input.sendToRecipient ? 'recipient' : 'me' }, nowMs, { admin: true });
  const expiresAt = input.expiresAt && isDate(input.expiresAt) ? input.expiresAt : addMonths(nowRome(nowMs).date, app.cfg.gift.validityMonths);
  return tx(app.db, () => insertGift(app.db, v, { status: 'active', source: 'admin', nowMs, expiresAt }));
}

/**
 * Pagamento ricevuto: attiva il buono (idempotente).
 * @returns {{outcome: 'activated'|'already'|'void', card: object}}
 */
export function activateGift(app, id, paymentIntent = null, nowMs = Date.now()) {
  const { db, cfg } = app;
  return tx(db, () => {
    const card = getGift(db, id);
    if (!card) throw new GiftError('payment', 'gift not found');
    if (card.status === 'active') return { outcome: 'already', card };
    if (card.status === 'void') {
      db.prepare('UPDATE gift_cards SET stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?').run(paymentIntent, id);
      return { outcome: 'void', card: getGift(db, id) };
    }
    const now = new Date(nowMs).toISOString();
    db.prepare(`UPDATE gift_cards SET status = 'active', activated_at = ?, expires_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?`).run(
      now,
      addMonths(nowRome(nowMs).date, cfg.gift.validityMonths),
      paymentIntent,
      id,
    );
    ledgerAdd(db, id, card.initial_cents, 'issue', { nowMs });
    return { outcome: 'activated', card: getGift(db, id) };
  });
}

/** Buoni da consegnare ora al destinatario (alle 9:00 del giorno scelto, o subito se la data è passata). */
export function giftsDueForDelivery(db, nowMs = Date.now()) {
  const { date, time } = nowRome(nowMs);
  return db
    .prepare(`SELECT * FROM gift_cards WHERE status = 'active' AND recipient_email IS NOT NULL AND delivered_at IS NULL AND deliver_on IS NOT NULL AND (deliver_on < ? OR (deliver_on = ? AND ? >= '09:00')) ORDER BY id`)
    .all(date, date, time);
}

/** Segna la consegna; restituisce false se qualcun altro l'aveva già segnata (evita doppi invii). */
export function claimDelivery(db, id, nowMs = Date.now()) {
  return db.prepare('UPDATE gift_cards SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL').run(new Date(nowMs).toISOString(), id).changes === 1;
}

/** Annulla un buono: il saldo residuo va a zero (resta traccia nel registro). */
export function voidGift(db, id, note = null, nowMs = Date.now()) {
  return tx(db, () => {
    const card = getGift(db, id);
    if (!card || card.status === 'void') return card;
    if (card.balance_cents > 0) ledgerAdd(db, id, -card.balance_cents, 'adjust', { note: note ?? 'buono annullato', nowMs });
    db.prepare(`UPDATE gift_cards SET status = 'void' WHERE id = ?`).run(id);
    return getGift(db, id);
  });
}

/** Rettifica manuale del saldo (non può diventare negativo). */
export function adjustGift(db, id, deltaCents, note, nowMs = Date.now()) {
  return tx(db, () => {
    const card = getGift(db, id);
    if (!card || card.status !== 'active') throw new GiftError('payment', 'gift not active');
    if (!Number.isInteger(deltaCents) || deltaCents === 0 || card.balance_cents + deltaCents < 0) throw new GiftError('amount', 'invalid adjustment');
    ledgerAdd(db, id, deltaCents, 'adjust', { note: cleanText(note, 200) || 'rettifica manuale', nowMs });
    return getGift(db, id);
  });
}

export function setGiftExpiry(db, id, date) {
  if (!isDate(date)) throw new GiftError('date', 'invalid date');
  db.prepare('UPDATE gift_cards SET expires_at = ? WHERE id = ?').run(date, id);
}

/** Ordini mai pagati: dopo qualche giorno non servono più. */
export function voidAbandonedGifts(db, nowMs = Date.now(), days = 7) {
  return db.prepare(`UPDATE gift_cards SET status = 'void' WHERE status = 'pending' AND created_at < ?`).run(new Date(nowMs - days * 86400_000).toISOString()).changes;
}

export const giftLedger = (db, id) => db.prepare('SELECT * FROM gift_card_ledger WHERE gift_card_id = ? ORDER BY id').all(id);
