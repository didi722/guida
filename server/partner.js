// Area riservata alle agenzie: elenco delle loro prenotazioni (con ricerca e filtri), riepilogo e fatture.
// Solo lettura del database: nessuna regola di prenotazione qui, quelle stanno in bookings.js.
import { addDays, addMonths, dayOfWeek, isDate, isMonth, localToInstant, monthDates, nowRome } from './time.js';
import { CREDITABLE_STATUS } from './invoices.js';
import { ensurePayRef, invoiceDue, isPayable, overdueInvoices } from './invoicePayments.js';

/** Le schede dell'elenco, nell'ordine in cui si mostrano. */
export const PARTNER_VIEWS = ['upcoming', 'options', 'past', 'cancelled', 'all'];
export const PAGE_SIZE = 20;
export const CSV_LIMIT = 5000;

const one = (v, max) => String(Array.isArray(v) ? v[0] : (v ?? '')).trim().slice(0, max);
const dateOf = (v) => (isDate(one(v, 10)) ? one(v, 10) : '');

/**
 * Filtri dell'elenco, letti dalla query string. Una ricerca (testo o date) senza scheda scelta guarda tra tutte le prenotazioni:
 * chi cerca un cliente non vuole sentirsi dire «nessuna» perché la sua pratica è già passata.
 */
export function parseFilters(query = {}) {
  const f = { q: one(query.q, 80), from: dateOf(query.from), to: dateOf(query.to), bfrom: dateOf(query.bfrom), bto: dateOf(query.bto), mine: one(query.mine, 2) === '1' }; // mine: solo ciò che ho prenotato io (chi ha un team)
  const searching = !!(f.q || f.from || f.to || f.bfrom || f.bto || f.mine);
  const asked = one(query.view, 12);
  f.explicit = PARTNER_VIEWS.includes(asked); // la scheda l'ha scelta chi guarda (altrimenti vale quella di default)
  f.view = f.explicit ? asked : searching ? 'all' : 'upcoming';
  const page = Number.parseInt(one(query.page, 6), 10);
  f.page = Number.isInteger(page) && page > 0 ? page : 1;
  return f;
}

/** Il filtro attivo, senza scheda né pagina: serve per i link delle schede e per capire se mostrare «azzera». */
export const hasSearch = (f) => !!(f.q || f.from || f.to || f.bfrom || f.bto || f.mine);

/** Una prenotazione scaduta senza essere mai stata un'opzione era solo un pagamento non completato: all'agenzia non interessa. */
const VISIBLE = `NOT (status = 'expired' AND option_expires_at IS NULL)`;

function searchSql(f) {
  const cond = [];
  const args = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
    cond.push(`(client_ref LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR ref LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`);
    args.push(like, like, like, like);
  }
  if (f.mine) (cond.push('booked_by_user IS ?'), args.push(f.actorId ?? null)); // il titolare è «vuoto»: le sue, quelle fatte dal pannello e le vecchie
  if (f.from) (cond.push('date >= ?'), args.push(f.from));
  if (f.to) (cond.push('date <= ?'), args.push(f.to));
  // «prenotata il»: created_at è un istante UTC, i giorni si contano a Venezia
  if (f.bfrom) (cond.push('created_at >= ?'), args.push(new Date(localToInstant(f.bfrom, '00:00')).toISOString()));
  if (f.bto) (cond.push('created_at < ?'), args.push(new Date(localToInstant(addDays(f.bto, 1), '00:00')).toISOString()));
  return { cond, args };
}

const VIEW_SQL = {
  upcoming: { cond: `status IN ('confirmed', 'held', 'option') AND date >= ?`, today: true, order: 'date, start_time, id' },
  options: { cond: `status = 'option'`, order: 'option_expires_at, id' },
  past: { cond: `status = 'confirmed' AND date < ?`, today: true, order: 'date DESC, start_time DESC, id DESC' },
  cancelled: { cond: `status IN ('cancelled', 'expired')`, order: 'COALESCE(cancelled_at, created_at) DESC, id DESC' },
  all: { cond: '1', order: 'date DESC, start_time DESC, id DESC' },
};

/** Le fatture emesse (non le bozze, non quelle scartate) che contengono le prenotazioni indicate. */
function invoicesOf(db, ids) {
  if (!ids.length) return new Map();
  const rows = db
    .prepare(
      `SELECT l.source_id AS bid, i.id, i.number, i.status FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE l.source_type = 'booking' AND l.released = 0 AND i.doc_type = 'TD01' AND i.number IS NOT NULL AND i.status IN (${CREDITABLE_STATUS.map(() => '?').join(',')}) AND l.source_id IN (${ids.map(() => '?').join(',')})
       ORDER BY i.id`,
    )
    .all(...CREDITABLE_STATUS, ...ids);
  return new Map(rows.map((r) => [r.bid, r]));
}

/** La fattura emessa che contiene una prenotazione, se c'è. */
export const invoiceOfBooking = (db, bookingId) => invoicesOf(db, [bookingId]).get(bookingId) ?? null;

/**
 * Le prenotazioni di un'agenzia per una scheda, con i conteggi di tutte le schede (sotto la stessa ricerca) e la fattura di ciascuna.
 * `limit: null` = tutte (per l'esportazione), nei limiti di CSV_LIMIT.
 */
export function partnerBookings(app, accountId, filters, { nowMs = Date.now(), limit = PAGE_SIZE } = {}) {
  const { db } = app;
  const today = nowRome(nowMs).date;
  const { cond, args } = searchSql(filters);
  const base = [`account_id = ?`, VISIBLE, ...cond].join(' AND ');
  const baseArgs = [accountId, ...args];

  const c = db
    .prepare(
      `SELECT
         SUM(status IN ('confirmed', 'held', 'option') AND date >= ?) AS upcoming,
         SUM(status = 'option') AS options,
         SUM(status = 'confirmed' AND date < ?) AS past,
         SUM(status IN ('cancelled', 'expired')) AS cancelled,
         COUNT(*) AS "all"
       FROM bookings WHERE ${base}`,
    )
    .get(today, today, ...baseArgs);
  const counts = Object.fromEntries(PARTNER_VIEWS.map((v) => [v, Number(c[v] ?? 0)]));

  const view = VIEW_SQL[filters.view] ?? VIEW_SQL.upcoming;
  const total = counts[filters.view] ?? counts.upcoming;
  const size = limit ?? CSV_LIMIT;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(filters.page ?? 1, pages);
  const rows = db
    .prepare(`SELECT * FROM bookings WHERE ${base} AND ${view.cond} ORDER BY ${view.order} LIMIT ? OFFSET ?`)
    .all(...baseArgs, ...(view.today ? [today] : []), size, limit == null ? 0 : (page - 1) * size);
  const invoices = invoicesOf(
    db,
    rows.map((b) => b.id),
  );
  const groupIds = [...new Set(rows.map((b) => b.group_id).filter(Boolean))];
  const groups = new Map(groupIds.length ? db.prepare(`SELECT id, ref FROM booking_groups WHERE id IN (${groupIds.map(() => '?').join(',')})`).all(...groupIds).map((g) => [g.id, g.ref]) : []);
  return { rows: rows.map((b) => ({ ...b, invoice: invoices.get(b.id) ?? null, group_ref: groups.get(b.group_id) ?? null })), counts, total, page, pages, view: filters.view };
}

/**
 * Il calendario del mese dell'agenzia: le sue pratiche vive giorno per giorno (confermate, in pagamento, opzioni non scadute).
 * `month` = AAAA-MM; `selected` = il giorno da mostrare sotto (se manca o è fuori dal mese: oggi, o il primo del mese).
 */
export function partnerCalendar(app, accountId, { month, selected } = {}, nowMs = Date.now()) {
  const { db } = app;
  const today = nowRome(nowMs).date;
  const m = isMonth(String(month ?? '')) ? month : today.slice(0, 7);
  const dates = monthDates(m);
  const offset = (dayOfWeek(dates[0]) + 6) % 7; // lunedì = 0
  const gridStart = addDays(dates[0], -offset);
  const total = Math.ceil((offset + dates.length) / 7) * 7;
  const gridEnd = addDays(gridStart, total - 1);
  const nowIso = new Date(nowMs).toISOString();
  const rows = db
    .prepare(`SELECT * FROM bookings WHERE account_id = ? AND date BETWEEN ? AND ? AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?) OR (status = 'option' AND option_expires_at > ?)) ORDER BY date, start_time, id`)
    .all(accountId, gridStart, gridEnd, nowIso, nowIso);
  const cells = Array.from({ length: total }, (_, i) => {
    const date = addDays(gridStart, i);
    return { date, inMonth: date.slice(0, 7) === m, items: rows.filter((b) => b.date === date) };
  });
  const wanted = isDate(String(selected ?? '')) && cells.some((c) => c.date === selected) ? selected : cells.some((c) => c.date === today) ? today : dates[0];
  return { month: m, prev: addMonths(`${m}-01`, -1).slice(0, 7), next: addMonths(`${m}-01`, 1).slice(0, 7), cells, selected: wanted, selectedItems: cells.find((c) => c.date === wanted).items };
}

/** Il riepilogo in alto: partenze in arrivo, opzioni aperte, il mese in corso e quanto resta da saldare. */
export function partnerSummary(app, accountId, nowMs = Date.now()) {
  const { db } = app;
  const today = nowRome(nowMs).date;
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = addMonths(monthStart, 1);
  const up = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(participants), 0) AS pax FROM bookings WHERE account_id = ? AND status = 'confirmed' AND date >= ?`).get(accountId, today);
  const opt = db.prepare(`SELECT COUNT(DISTINCT COALESCE('g' || group_id, 'b' || id)) AS n, MIN(option_expires_at) AS next FROM bookings WHERE account_id = ? AND status = 'option'`).get(accountId); // un pacchetto è una sola opzione
  const month = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents - gift_cents), 0) AS cents FROM bookings WHERE account_id = ? AND status = 'confirmed' AND date >= ? AND date < ?`).get(accountId, monthStart, nextMonth);
  // da saldare: servizi confermati con fattura/bonifico non ancora incassati, e penali di annullo non ancora pagate
  const due = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total_cents - gift_cents ELSE retained_cents END), 0) AS cents FROM bookings
       WHERE account_id = ? AND payment_status = 'unpaid' AND ((status = 'confirmed' AND payment_method = 'invoice') OR (status = 'cancelled' AND retained_cents > 0))`,
    )
    .get(accountId);
  // di cui scaduto: le fatture emesse non incassate oltre la scadenza
  const late = overdueInvoices(db, today).filter((x) => x.inv.account_id === accountId);
  return {
    upcoming: { count: Number(up.n), pax: Number(up.pax) },
    options: { count: Number(opt.n), nextMs: opt.next ? Date.parse(opt.next) : null },
    month: { count: Number(month.n), cents: Number(month.cents), month: monthStart.slice(0, 7) },
    due: { count: Number(due.n), cents: Number(due.cents), overdueCount: late.length, overdueCents: late.reduce((a, x) => a + x.dueCents, 0) },
  };
}

/** Fatture e note di credito emesse all'agenzia, dalla più recente. */
export function partnerInvoices(db, accountId) {
  return db
    .prepare(
      `SELECT id, number, doc_type, status, issue_date, total_cents, payable_cents, currency, related_id, credited, paid_at, paid_method, payments_json, pay_ref, pay_token FROM invoices
       WHERE account_id = ? AND number IS NOT NULL AND status IN (${CREDITABLE_STATUS.map(() => '?').join(',')}) ORDER BY issue_date DESC, id DESC`,
    )
    .all(accountId, ...CREDITABLE_STATUS)
    .map((i) => {
      // da pagare: serve il riferimento per aprire la pagina di pagamento (si crea al primo bisogno)
      if (!isPayable(i) || !invoiceDue(i) || (i.pay_ref && i.pay_token)) return i;
      const p = ensurePayRef(db, i);
      return { ...i, pay_ref: p.pay_ref, pay_token: p.pay_token };
    });
}

/** Una fattura dell'agenzia (null se non è sua o non è stata ancora emessa). */
export const partnerInvoice = (db, accountId, id) =>
  db.prepare(`SELECT * FROM invoices WHERE id = ? AND account_id = ? AND number IS NOT NULL AND status IN (${CREDITABLE_STATUS.map(() => '?').join(',')})`).get(id, accountId, ...CREDITABLE_STATUS) ?? null;

/** Il nominativo (e il resto) si può cambiare finché la prenotazione è viva e il servizio non è iniziato. */
/** Una prenotazione confermata il cui servizio è già finito: all'agenzia non serve sapere che è «confermata», serve sapere che è fatto. */
export const isDone = (b, nowMs = Date.now()) => b.status === 'confirmed' && localToInstant(b.date, b.end_time) <= nowMs;

export const isEditable = (b, nowMs = Date.now()) => ['confirmed', 'held', 'option'].includes(b.status) && localToInstant(b.date, b.start_time) > nowMs;

/** Esportazione CSV delle righe (Excel italiano: separatore «;», UTF-8 con BOM, importi con la virgola). */
export function bookingsCsv(rows, { content, statusLabel, head }) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // niente formule dal foglio di calcolo
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const lines = rows.map((b) =>
    [b.ref, b.client_ref, b.name, content.tour(b.tour_slug)?.i18n.it.title ?? b.tour_slug, b.date, b.start_time, b.participants, statusLabel(b), b.created_at.slice(0, 10), money(b.total_cents - (b.gift_cents ?? 0)), b.invoice?.number ?? '', b.booked_by_name ?? ''].map(cell).join(';'),
  );
  return `﻿${[head.join(';'), ...lines].join('\r\n')}\r\n`;
}
