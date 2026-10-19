// Preventivi online delle agenzie. L'agenzia prepara un preventivo dai servizi del suo pacchetto (senza prenotare né tenere nessuna data), lo manda
// al cliente finale per email e il cliente lo accetta o lo rifiuta da una pagina sua. Il preventivo è una fotografia: i servizi, la tariffa dell'agenzia
// e il prezzo al cliente (tariffa più ricarico, arrotondato riga per riga) restano com'erano quando è stato preparato. La tariffa dell'agenzia e il
// ricarico non compaiono mai al cliente. Solo regole e database: le email stanno in emails.js, le pagine in views/quotes.js.
import { MARKUP_MAX, ROUNDS, buildQuote, parseMarkup, parseRound, readProfile } from './agencyDocs.js';
import { meetingOf } from './choices.js';
import { LANGS, normLang, pick } from './langs.js';
import { partyOfBooking } from './party.js';
import { PackageError, cartAdd, cartSummary, openSlotOf, resolveLine } from './packages.js';
import { previewPricing } from './pricing.js';
import { serviceRecord, timeRange } from './rates.js';
import { addDays, isDate, nowRome } from './time.js';
import { cleanText, isEmail, newRef, newToken, safeEqual } from './util.js';

export const QUOTE_MAX_SENDS = 5; // quante volte si può mandare per email lo stesso preventivo
export const QUOTE_DEFAULT_DAYS = 7; // validità di partenza
export { MARKUP_MAX, ROUNDS };

export class QuoteError extends Error {
  /** `code`: empty | stale | client | email | markup | until | expired | sends · `detail`: per `until`, l'ultimo giorno possibile */
  constructor(code, detail = null) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const iso = (ms) => new Date(ms).toISOString();

/** Fino a quando può valere un preventivo con questi servizi: da oggi al giorno del primo servizio (compreso); di partenza una settimana. */
export function validityBounds(lines, today) {
  const first = lines.map((l) => l.date).sort()[0] ?? today;
  const max = first < today ? today : first;
  const week = addDays(today, QUOTE_DEFAULT_DAYS);
  return { min: today, max, fallback: week < max ? week : max };
}

/** Lo stato a parole: «scaduto» non si salva, si ricava dalla data (un preventivo già deciso resta com'è). */
export const statusOf = (q, today = nowRome().date) => (['draft', 'sent'].includes(q.status) && q.valid_until < today ? 'expired' : q.status);

export const getQuote = (db, ref) => db.prepare('SELECT * FROM quotes WHERE ref = ?').get(String(ref)) ?? null;
/** Il preventivo dal collegamento del cliente (il codice segreto deve coincidere). */
export function quoteByToken(db, ref, token) {
  const q = getQuote(db, ref);
  const t = String(token ?? '');
  return q && t && safeEqual(t, q.token) ? q : null;
}
/** Un preventivo di questa agenzia. */
export function ownQuote(db, accountId, ref) {
  const q = getQuote(db, ref);
  return q && q.account_id === accountId ? q : null;
}
export const listQuotes = (db, accountId) => db.prepare('SELECT * FROM quotes WHERE account_id = ? ORDER BY id DESC').all(accountId);
export const quoteLines = (q) => JSON.parse(q.lines_json);

/**
 * Prepara un preventivo dai servizi del pacchetto in preparazione di chi lavora (non prenota nulla e non svuota il pacchetto).
 * @param {{ client: string, email?: string, clientRef?: string, markup?: string|number, round?: string|number, until?: string, lang?: string, note?: string }} input
 * @param {{ userId: number|null, name: string }} actor
 * @throws {QuoteError} empty (pacchetto vuoto) · stale (un servizio non è più prenotabile) · client · email · markup · until
 */
export function createQuote(app, account, actor, input, nowMs = Date.now()) {
  const { db } = app;
  const today = nowRome(nowMs).date;
  const summary = cartSummary(app, account, nowMs, actor.userId ?? null);
  if (!summary.lines.length) throw new QuoteError('empty');
  if (!summary.allOk) throw new QuoteError('stale');
  const client = cleanText(input.client, 120);
  if (client.length < 2) throw new QuoteError('client');
  const email = cleanText(input.email, 254).toLowerCase();
  if (email && !isEmail(email)) throw new QuoteError('email');
  const profile = readProfile(account);
  const markup = input.markup === undefined || String(input.markup).trim() === '' ? profile.markup : parseMarkup(input.markup);
  if (markup == null) throw new QuoteError('markup');
  const round = parseRound(input.round) ?? profile.round;
  const lines = summary.lines.map((l) => ({
    src: l.src,
    slug: l.p.tour.slug,
    date: l.p.date,
    time: l.p.time,
    endTime: l.slot.end,
    pax: l.p.pax,
    children: l.p.party.children,
    infants: l.p.party.infants,
    pickup: l.p.pickup || '',
    service: l.pricing.quote?.ok ? serviceRecord(l.pricing.quote) : null,
    netCents: l.pricing.totalCents,
  }));
  const bounds = validityBounds(lines, today);
  const until = isDate(input.until) ? String(input.until) : bounds.fallback;
  if (until < bounds.min || until > bounds.max) throw new QuoteError('until', bounds.max);
  const lang = LANGS.includes(String(input.lang)) ? String(input.lang) : normLang(account.lang);
  const net = lines.reduce((s, l) => s + l.netCents, 0);
  const view = buildQuote(virtualBookings({ lines, currency: 'EUR', client_ref: null, client_name: client }), { markup, round });
  const row = {
    ref: newRef('QT'),
    token: newToken(),
    account_id: account.id,
    user_id: actor.userId ?? null,
    created_by: cleanText(actor.name, 120) || null,
    client_name: client,
    client_email: email || null,
    client_ref: cleanText(input.clientRef, 120) || null,
    lang,
    markup_percent: markup,
    markup_round: round,
    valid_until: until,
    note: cleanText(input.note, 800) || null,
    lines_json: JSON.stringify(lines),
    net_cents: net,
    total_cents: view.totalCents,
    currency: app.cfg.policy.currency,
    created_at: iso(nowMs),
  };
  const cols = Object.keys(row);
  const id = Number(db.prepare(`INSERT INTO quotes(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
  return db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
}

/** I servizi del preventivo come «prenotazioni» che il preventivo PDF e la pagina del cliente sanno leggere (non toccano il database). */
function virtualBookings(q) {
  const lines = Array.isArray(q.lines) ? q.lines : quoteLines(q);
  return lines.map((l, i) => ({
    id: i + 1,
    tour_slug: l.slug,
    date: l.date,
    start_time: l.time,
    end_time: l.endTime,
    participants: l.pax,
    children: l.children ?? 0,
    infants: l.infants ?? 0,
    status: 'option',
    channel: 'b2b',
    pickup: l.pickup || null,
    service_json: l.service ? JSON.stringify(l.service) : null,
    total_cents: l.netCents,
    gift_cents: 0,
    currency: q.currency ?? 'EUR',
    client_ref: q.client_ref ?? null,
    name: q.client_name,
  }));
}
export const quoteBookings = (q) => virtualBookings(q);

/**
 * Ciò che vede il cliente: per ogni servizio titolo, data, orario, persone, punto d'incontro e prezzo (con il ricarico), e il totale.
 * La tariffa dell'agenzia non c'è.
 */
export function clientView(app, q, lang = normLang(q.lang)) {
  const built = buildQuote(virtualBookings(q), { markup: q.markup_percent, round: q.markup_round });
  const lines = built.lines.map(({ booking: b, cents }) => {
    const tour = app.content.tour(b.tour_slug);
    const ti = tour ? pick(tour.i18n, lang) : { title: b.tour_slug, includes: [] };
    const meet = tour ? meetingOf(tour, b, lang) : { text: '' };
    return { title: ti.title, date: b.date, when: timeRange(b, lang), pax: b.participants, party: partyOfBooking(b), meeting: meet.text, included: (ti.includes ?? []).slice(0, 5), cents };
  });
  return { lines, totalCents: built.totalCents };
}

/** Il preventivo è stato aperto dal cliente (la prima volta). */
export const markViewed = (db, id, nowMs = Date.now()) => db.prepare('UPDATE quotes SET viewed_at = COALESCE(viewed_at, ?) WHERE id = ?').run(iso(nowMs), id);

/** Il preventivo è partito per email a questo indirizzo (da bozza diventa «inviato»). */
export function recordSent(db, id, email, nowMs = Date.now()) {
  db.prepare("UPDATE quotes SET client_email = ?, sent_at = ?, sent_count = sent_count + 1, status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END WHERE id = ?").run(email, iso(nowMs), id);
}

/**
 * Il cliente accetta o rifiuta (una sola volta, anche se due richieste arrivano insieme; non dopo la scadenza).
 * @returns {boolean} false se non era più possibile (già deciso, scaduto, non c'è)
 */
export function decide(db, id, decision, message = '', nowMs = Date.now()) {
  if (!['approved', 'declined'].includes(decision)) return false;
  return db.prepare("UPDATE quotes SET status = ?, decided_at = ?, decided_note = ? WHERE id = ? AND status IN ('draft', 'sent') AND valid_until >= ?").run(decision, iso(nowMs), cleanText(message, 500) || null, id, nowRome(nowMs).date).changes === 1;
}

export const deleteQuote = (db, accountId, ref) => db.prepare('DELETE FROM quotes WHERE ref = ? AND account_id = ?').run(String(ref), accountId).changes === 1;

/**
 * Com'è adesso ciò che il preventivo promette: per ogni servizio se si può ancora prenotare e se la tariffa dell'agenzia è cambiata.
 * @returns {{ ok: boolean, netNow: number, lines: { ok: boolean, netNow: number|null, changed: boolean }[] }}
 */
export function liveCheck(app, account, q, nowMs = Date.now()) {
  const lines = quoteLines(q).map((l) => {
    const p = resolveLine(app, l.src);
    if (!p) return { ok: false, netNow: null, changed: false };
    const ok = !!openSlotOf(app, p, nowMs);
    const netNow = previewPricing(app, { tour: p.tour, party: p.party, channel: 'b2b', account, date: p.date, time: p.time, hours: p.hours, earpieces: p.earpieces, nowMs }).totalCents;
    return { ok, netNow, changed: netNow !== l.netCents };
  });
  return { ok: lines.every((l) => l.ok), netNow: lines.reduce((s, l) => s + (l.netNow ?? 0), 0), lines };
}

/**
 * Rimette i servizi del preventivo nel pacchetto in preparazione di chi lavora, per prenotarli (o opzionarli) davvero: quelli non più prenotabili,
 * già nel pacchetto o che si sovrappongono restano fuori. I dati del cliente diventano quelli proposti nel modulo.
 * @returns {{ added: number, skipped: { index: number, code: string }[] }}
 */
export function loadIntoCart(app, account, q, actor, nowMs = Date.now()) {
  const out = { added: 0, skipped: [] };
  quoteLines(q).forEach((l, index) => {
    try {
      cartAdd(app, account, { ...l.src, name: q.client_name, email: q.client_email || actor.email || '', lang: q.lang, clientRef: q.client_ref || '' }, nowMs, actor.userId ?? null);
      out.added++;
    } catch (e) {
      if (!(e instanceof PackageError)) throw e;
      out.skipped.push({ index, code: e.code });
    }
  });
  if (out.added) app.db.prepare('UPDATE quotes SET loaded_at = ? WHERE id = ?').run(iso(nowMs), q.id);
  return out;
}
