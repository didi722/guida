// «Invita un amico»: chi ha prenotato un tour condiviso (partenza a posti) può mandare a un amico un codice sconto
// tutto suo, valido una sola volta e solo per quella partenza. L'amico arriva dritto alla pagina di pagamento di quella partenza.
import crypto from 'node:crypto';
import { slotStillOpen } from './bookings.js';
import { localToInstant } from './time.js';
import { isEmail } from './util.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // senza 0/O/1/I/L: si legge e si detta senza errori
const iso = (ms) => new Date(ms).toISOString();

const randomCode = () => `AMICO-${Array.from(crypto.randomBytes(6), (x) => ALPHABET[x % ALPHABET.length]).join('')}`;

/** Gli inviti di una prenotazione, con il codice e se l'amico lo ha già usato (una prenotazione confermata o in pagamento). */
export function invitesOf(db, bookingId, nowMs = Date.now()) {
  return db
    .prepare(
      `SELECT i.*, p.value AS percent,
         EXISTS (SELECT 1 FROM bookings x WHERE x.promo_code_id = i.promo_code_id AND (x.status = 'confirmed' OR (x.status = 'held' AND x.hold_expires_at > ?))) AS used
       FROM invites i JOIN promo_codes p ON p.id = i.promo_code_id WHERE i.booking_id = ? ORDER BY i.id`,
    )
    .all(iso(nowMs), bookingId)
    .map((r) => ({ ...r, used: !!r.used }));
}

/**
 * Questa prenotazione può invitare un amico? Solo i clienti privati, per un tour condiviso a posti, finché la partenza non è iniziata
 * e c'è ancora almeno un posto libero (meno gli inviti non ancora usati). `reason` dice perché no.
 * @returns {{ok: true, percent: number, left: number, remaining: number, invites: object[]} | {ok: false, reason: string}}
 */
export function inviteOffer(app, b, nowMs = Date.now()) {
  const cfg = app.cfg.invite;
  const tour = app.content.tour(b.tour_slug);
  const percent = tour?.invitePercent ?? cfg?.percent; // lo sconto può essere diverso per ogni tour
  if (!cfg?.enabled || tour?.inviteEnabled === false || !(percent > 0)) return { ok: false, reason: 'off' };
  if (!tour || tour.model !== 'person' || b.channel !== 'b2c' || b.status !== 'confirmed') return { ok: false, reason: 'ineligible' };
  if (localToInstant(b.date, b.start_time) <= nowMs) return { ok: false, reason: 'started' };
  const invites = invitesOf(app.db, b.id, nowMs);
  if (invites.length >= cfg.maxPerBooking) return { ok: false, reason: 'max', invites };
  const slot = slotStillOpen(app, tour, b.date, b.start_time, 1, 'b2c', nowMs);
  const free = slot ? slot.left - invites.filter((i) => !i.used).length : 0;
  if (free < 1) return { ok: false, reason: 'full', invites };
  return { ok: true, percent, left: slot.left, remaining: Math.min(free, cfg.maxPerBooking - invites.length), invites };
}

/**
 * Crea l'invito: un codice sconto nuovo (una sola volta, solo per questo tour e per il giorno del servizio) legato alla prenotazione.
 * @returns {{invite: object, link: string}}  `link`: la pagina di pagamento di quella partenza, già con il codice e la lingua del tour
 */
export function createInvite(app, b, { email = '', nowMs = Date.now() } = {}) {
  const offer = inviteOffer(app, b, nowMs);
  if (!offer.ok) throw Object.assign(new Error(`invite: ${offer.reason}`), { reason: offer.reason });
  const friend = String(email ?? '').trim().toLowerCase();
  if (friend && !isEmail(friend)) throw Object.assign(new Error('invite: email'), { reason: 'email' });
  const { db } = app;
  let code = randomCode();
  while (db.prepare('SELECT 1 FROM promo_codes WHERE code = ?').get(code)) code = randomCode();
  const now = iso(nowMs);
  const promoId = Number(
    db
      .prepare(`INSERT INTO promo_codes(code, kind, value, valid_to, service_from, service_to, max_uses, one_per_email, tours, note, created_at) VALUES(?, 'percent', ?, ?, ?, ?, 1, 0, ?, ?, ?)`)
      .run(code, offer.percent, b.date, b.date, b.date, JSON.stringify([b.tour_slug]), `Invito di ${b.ref}`, now).lastInsertRowid,
  );
  const id = Number(db.prepare('INSERT INTO invites(booking_id, promo_code_id, code, friend_email, created_at) VALUES(?,?,?,?,?)').run(b.id, promoId, code, friend || null, now).lastInsertRowid);
  return { invite: db.prepare('SELECT * FROM invites WHERE id = ?').get(id), link: inviteLink(app, b, code) };
}

/** Il collegamento per l'amico: stessa partenza, un posto, codice già inserito, stessa lingua del tour. */
export function inviteLink(app, b, code, lang = 'it') {
  const q = new URLSearchParams({ tour: b.tour_slug, date: b.date, time: b.start_time, pax: '1', promo: code });
  if (b.tour_lang) q.set('tl', b.tour_lang);
  return `${app.cfg.baseUrl}/${lang}/book/checkout?${q}`;
}
