// Modifiche che la guida fa a una prenotazione dal pannello: persone, data, orario, ore e prezzo, per un privato o per un'agenzia.
// La guida decide: non valgono il preavviso minimo né i limiti delle modifiche che l'agenzia fa da sola (changes.js).
// Valgono invece le regole di buon senso: la disponibilità (si può escludere), le fatture già preparate, il denaro già incassato.
// Solo regole e database: l'invio delle email e il rimborso stanno in changeServices.js.
//
// Regole in breve:
// - si cambiano le prenotazioni confermate e le opzioni (non quelle annullate, scadute o in attesa di pagamento);
// - una prenotazione già in una fattura (anche in bozza) non si cambia: prima si elimina la bozza o si emette la nota di credito;
// - dopo l'inizio del servizio si possono ancora correggere persone, ore e prezzo (prima di fatturare), non data e orario;
// - il prezzo si ricalcola dal listino quando cambiano persone, ore o orario; oppure lo scrive la guida (prezzo concordato: poi resta quello);
// - pagata con carta: se costa meno la differenza si rimborsa sulla carta; se costa di più non si può (si incassa a parte);
// - incassata in altro modo, o pagata con buoni regalo: il prezzo non cambia.
import { loadAvailabilityContext, slotsForDay } from './availability.js';
import { bookingDue, getBooking } from './bookings.js';
import { currentParams, movedTiers, policyBase } from './changes.js';
import { tx } from './db.js';
import { invoiceForSource } from './invoices.js';
import { optionWindow } from './optionPolicy.js';
import { freeHoursOf, hasFreeTier, parseTiers, singleTier } from './policy.js';
import { previewPricing } from './pricing.js';
import { parseServiceRecord, serviceRecord } from './rates.js';
import { readSlot } from './slotParams.js';
import { fromMin, localToInstant, toMin } from './time.js';

const HOUR = 3600_000;
const iso = (ms) => new Date(ms).toISOString();

export class AdminChangeError extends Error {
  /** `code`: status | invoiced | invalid | nochange | started | past | unavailable | option | price | promo | gift | card | paid */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

/**
 * Valuta una modifica (senza scrivere nulla): regole, disponibilità, nuovo prezzo, differenza e rimborso.
 * @param {{pax?: number|string, date?: string, time?: string, hours?: number|string, extra?: number|string, priceMode?: 'auto'|'custom', priceCents?: number|null, force?: boolean, keepTerms?: boolean}} input
 *   i campi non indicati restano come sono; `priceMode` custom senza `priceCents` conferma il prezzo di adesso; `force` salta il controllo delle disponibilità;
 *   `keepTerms`: spostando la data le scadenze di annullo restano quelle di prima (di base ripartono dalla nuova data)
 * @returns {{ok: true, ...}|{ok: false, error: string}}
 */
export function evaluateAdminChange(app, b, input = {}, nowMs = Date.now()) {
  const { db, cfg } = app;
  if (b.status !== 'confirmed' && b.status !== 'option') return fail('status');
  if (invoiceForSource(db, 'booking', b.id)) return fail('invoiced');
  const tour = app.content.tour(b.tour_slug);
  if (!tour) return fail('invalid');
  const cur = currentParams(app, b);
  const asked = {
    pax: input.pax ?? cur.pax,
    date: input.date ?? cur.date,
    time: input.time ?? cur.time,
    hours: tour.chooseHours ? (input.hours ?? cur.hours) : null,
    extra: tour.pricing === 'hourly' && !tour.chooseHours ? (input.extra ?? cur.extra) : 0,
  };
  const p = readSlot(app, { tour: b.tour_slug, ...asked }, b.channel);
  if (!p) return fail('invalid');
  const startMs = localToInstant(p.date, p.time);
  const started = localToInstant(b.date, b.start_time) <= nowMs;
  const oldDuration = toMin(b.end_time) - toMin(b.start_time);
  const newDuration = p.durationMin ?? tour.durationMin;
  const sameSlot = p.date === b.date && p.time === b.start_time;
  if (!sameSlot && started) return fail('started'); // a servizio iniziato non si sposta più
  if (!sameSlot && startMs <= nowMs) return fail('past');

  // il prezzo: ricalcolato dal listino quando cambia qualcosa che conta, oppure scritto dalla guida
  const account = b.account_id ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id) : null;
  const auto = previewPricing(app, { tour, pax: p.pax, channel: b.channel, account, date: p.date, time: p.time, hours: p.hours, earpieces: p.earpieces, nowMs, ignoreBookingId: b.id });
  if (auto.quote && !auto.quote.ok) return fail('invalid');
  const mode = input.priceMode === 'auto' || input.priceMode === 'custom' ? input.priceMode : b.custom_price ? 'custom' : 'auto';
  const priceRelevant = p.pax !== b.participants || newDuration !== oldDuration || (tour.pricing === 'hourly' && !sameSlot);
  let price;
  if (mode === 'custom') {
    const cents = input.priceCents ?? b.total_cents;
    if (!Number.isInteger(cents) || cents < 0 || cents > 10_000_000) return fail('price');
    price = { mode, listCents: auto.listCents, discountCents: Math.max(0, auto.listCents - cents), totalCents: cents, custom: 1 };
  } else if (priceRelevant || b.custom_price) {
    if (b.promo_code_id) return fail('promo'); // il codice sconto non si ricalcola: il nuovo prezzo lo scrive la guida
    price = { mode, listCents: auto.listCents, discountCents: 0, totalCents: auto.totalCents, custom: 0 };
  } else price = { mode, listCents: b.list_cents, discountCents: b.discount_cents, totalCents: b.total_cents, custom: b.custom_price };
  if ((b.gift_cents ?? 0) > 0 && price.totalCents !== b.total_cents) return fail('gift');

  // i soldi: pagata con carta si rimborsa la differenza (mai si incassa di più); incassata in altro modo non si cambia l'importo
  const dueNow = bookingDue(b);
  const dueNew = price.totalCents - (b.gift_cents ?? 0);
  const deltaCents = dueNew - dueNow;
  let refundCents = 0;
  if (b.status === 'confirmed' && deltaCents !== 0) {
    if (b.payment_method === 'card' && b.payment_status === 'paid') {
      if (deltaCents > 0) return fail('card');
      refundCents = -deltaCents;
    } else if (b.payment_status === 'paid') return fail('paid');
  }

  if (sameSlot && p.pax === b.participants && newDuration === oldDuration && price.totalCents === b.total_cents && price.custom === b.custom_price) return fail('nochange');

  // la disponibilità: solo se cambia qualcosa che occupa posto; la guida può escluderla (ha già deciso lei)
  let slot = null;
  if (!started && !input.force && (!sameSlot || p.pax !== b.participants || newDuration !== oldDuration)) {
    const ctx = loadAvailabilityContext(db, cfg, p.date, p.date, nowMs);
    slot = slotsForDay(ctx, cfg, tour, p.date, { pax: p.pax, channel: b.channel, nowMs, ignoreId: b.id, skipNotice: true, durationMin: p.durationMin, tourLang: b.tour_lang || null }).find((s) => s.time === p.time) ?? null;
    if (!slot) return fail('unavailable');
  }
  const end = slot?.end ?? (sameSlot && newDuration === oldDuration ? b.end_time : fromMin(Math.min(24 * 60 - 1, toMin(p.time) + newDuration)));

  // le scadenze di annullo e, per un'opzione, la scadenza dell'opzione
  const dateChanged = !sameSlot;
  const tiers = dateChanged ? (input.keepTerms ? movedTiers(b, startMs) : policyBase(b).tiers) : (parseTiers(b.cancel_policy_json) ?? singleTier(0));
  const freeUntilMs = dateChanged ? (hasFreeTier(tiers) ? startMs - freeHoursOf(tiers) * HOUR : nowMs) : Date.parse(b.free_cancel_until);
  let expiresMs = b.option_expires_at ? Date.parse(b.option_expires_at) : null;
  if (b.status === 'option' && dateChanged) {
    const win = optionWindow({ options: cfg.options, account, startMs, nowMs });
    if (!win.ok) return fail('option', { reason: win.reason });
    expiresMs = Math.min(expiresMs, win.expiresMs); // spostare la data non allunga mai l'opzione (per allungarla c'è «Prolunga»)
  }
  return {
    ok: true,
    dateChanged,
    started,
    forced: !!input.force,
    from: { ...cur, end: b.end_time, totalCents: b.total_cents, dueCents: dueNow },
    to: { pax: p.pax, date: p.date, time: p.time, end, hours: p.hours, extra: asked.extra, durationMin: p.durationMin, totalCents: price.totalCents, dueCents: dueNew },
    price,
    quote: auto.quote,
    deltaCents,
    refundCents,
    tiers,
    freeUntilMs,
    expiresMs,
  };
}

const snapshot = (b) => ({ pax: b.participants, date: b.date, time: b.start_time, end: b.end_time, totalCents: b.total_cents, hours: parseServiceRecord(b.service_json)?.hours ?? null, custom: !!b.custom_price });

/**
 * Applica la modifica (una transazione) e la scrive nel registro delle modifiche. Lancia AdminChangeError se non si può.
 * @returns {{before: object, after: object, changeId: number, dateChanged: boolean, deltaCents: number, refundCents: number}}
 */
export function modifyBookingAdmin(app, bookingId, input, { note = '' } = {}, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const b = getBooking(db, bookingId);
    if (!b) throw new AdminChangeError('invalid');
    const ev = evaluateAdminChange(app, b, input, nowMs);
    if (!ev.ok) throw Object.assign(new AdminChangeError(ev.error), { reason: ev.reason });
    const { to, price } = ev;
    const now = iso(nowMs);
    db.prepare(
      `UPDATE bookings SET participants = ?, date = ?, start_time = ?, end_time = ?, list_cents = ?, discount_cents = ?, total_cents = ?, custom_price = ?, service_json = ?,
         cancel_policy_json = ?, free_cancel_until = ?, option_expires_at = ?, modified_at = ? WHERE id = ?`,
    ).run(
      to.pax, to.date, to.time, to.end, price.listCents, price.discountCents, price.totalCents, price.custom,
      ev.quote ? JSON.stringify(serviceRecord(ev.quote)) : b.service_json,
      JSON.stringify(ev.tiers), iso(ev.freeUntilMs), ev.expiresMs != null ? iso(ev.expiresMs) : null, now, b.id,
    );
    if (ev.dateChanged) {
      // la politica «di partenza» di un'eventuale modifica dell'agenzia si azzera: da qui in poi vale quella scelta dalla guida
      db.prepare('UPDATE bookings SET policy_base_json = NULL WHERE id = ?').run(b.id);
      // i promemoria (la sera prima, fine annullo gratuito) ripartono per la nuova data
      db.prepare(`UPDATE bookings SET reminder_status = NULL, reminder_sent_at = NULL, reminder_attempt_at = NULL, penalty_reminded_at = NULL, option_reminded_at = NULL WHERE id = ?`).run(b.id);
      // le altre date di un pacchetto in opzione scadono insieme a questa
      if (b.status === 'option' && b.group_id) db.prepare(`UPDATE bookings SET option_expires_at = ?, option_reminded_at = NULL WHERE group_id = ? AND status = 'option'`).run(iso(ev.expiresMs), b.group_id);
    }
    const after = getBooking(db, b.id);
    const changeId = Number(
      db.prepare('INSERT INTO booking_changes(booking_id, by, before_json, after_json, note, created_at) VALUES(?,?,?,?,?,?)').run(b.id, 'admin', JSON.stringify(snapshot(b)), JSON.stringify(snapshot(after)), String(note ?? '').slice(0, 500) || null, now).lastInsertRowid,
    );
    return { before: b, after, changeId, dateChanged: ev.dateChanged, deltaCents: ev.deltaCents, refundCents: ev.refundCents };
  });
}
