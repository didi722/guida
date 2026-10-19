// Estratto conto di un'agenzia: ciò che deve alla guida, mese per mese, ricavato dalle fatture emesse, dalle note di credito e dagli incassi.
// Solo lettura del database.
//
// Il saldo è la somma dei movimenti:
//  · fattura emessa: la parte ancora da pagare (bonifico o contanti; ciò che l'agenzia ha già pagato con la carta non è un debito);
//  · nota di credito: meno, fino a quanto restava da pagare su quella fattura (il resto è un rimborso sulla carta, non tocca il saldo);
//  · incasso: meno. Un saldo negativo è un credito dell'agenzia (ha pagato più di quanto doveva, o una nota di credito è arrivata dopo l'incasso).
import { CREDITABLE_STATUS, creditableCents, invoiceForSource, settingsOf } from './invoices.js';
import { dueDateOf, openPartsCents } from './invoicePayments.js';
import { addDays, addMonths, isMonth, nowRome } from './time.js';

const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const dateOfInstant = (iso) => nowRome(Date.parse(iso)).date;

export const lastDayOf = (month) => addDays(addMonths(`${month}-01`, 1), -1);

/** Un mese valido e non futuro; altrimenti il mese in corso. */
export function normMonth(value, today = nowRome().date) {
  const current = today.slice(0, 7);
  const m = String(Array.isArray(value) ? value[0] : (value ?? '')).trim();
  return isMonth(m) && m <= current ? m : current;
}

/**
 * Tutti i movimenti dell'agenzia, in ordine di data (a parità di data: fatture, note di credito, incassi), e le fatture con ciò che le riguarda.
 * @returns {{ events: {date: string, order: number, id: number, kind: 'invoice'|'credit'|'payment', invoice: object, related?: object, method?: string, cents: number}[], items: Map<number, object> }}
 */
export function ledger(db, accountId) {
  const docs = db
    .prepare(`SELECT * FROM invoices WHERE account_id = ? AND number IS NOT NULL AND status IN (${CREDITABLE_STATUS.map(() => '?').join(',')}) ORDER BY issue_date, id`)
    .all(accountId, ...CREDITABLE_STATUS);
  const items = new Map();
  const events = [];
  for (const inv of docs) {
    if (inv.doc_type !== 'TD01') continue;
    const owed = openPartsCents(inv);
    const paidDate = inv.paid_at && owed > 0 ? dateOfInstant(inv.paid_at) : null;
    items.set(inv.id, { inv, owed, left: owed, credits: [], creditedTotal: 0, paidDate, paidCents: 0 });
    if (owed > 0) events.push({ date: inv.issue_date, order: 0, id: inv.id, kind: 'invoice', invoice: inv, cents: owed });
  }
  for (const cn of docs) {
    if (cn.doc_type !== 'TD04') continue;
    const item = items.get(cn.related_id);
    if (!item) continue;
    item.creditedTotal += cn.total_cents;
    // con l'ultima nota di credito che storna la fattura per intero (come per «stornata» in invoices.js) una fattura non ancora pagata
    // non è più da pagare, nemmeno per il bollo addebitato; se era già pagata il bollo resta pagato e si storna solo la nota di credito
    const full = creditableCents(item.inv) - item.creditedTotal <= 2;
    const paid = !!item.paidDate && item.paidDate <= cn.issue_date;
    const applied = full && !paid ? item.left : Math.min(cn.payable_cents, item.left);
    if (applied <= 0) continue;
    item.left -= applied;
    item.credits.push({ date: cn.issue_date, cents: applied });
    events.push({ date: cn.issue_date, order: 1, id: cn.id, kind: 'credit', invoice: cn, related: item.inv, cents: -applied });
  }
  for (const item of items.values()) {
    const { inv, owed, paidDate } = item;
    if (!paidDate) continue;
    // chi paga con la carta salda l'importo intero (la pagina di pagamento non tiene conto degli storni parziali); chi fa un bonifico paga al netto delle note di credito già ricevute
    const credits = inv.paid_method === 'card' ? 0 : item.credits.filter((c) => c.date <= paidDate).reduce((s, c) => s + c.cents, 0);
    item.paidCents = owed - credits;
    events.push({ date: paidDate, order: 2, id: inv.id, kind: 'payment', invoice: inv, method: inv.paid_method ?? 'bank', cents: -item.paidCents });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id - b.id);
  return { events, items };
}

/** Il primo e l'ultimo mese per cui ha senso un estratto conto (dal primo documento o servizio al mese in corso). */
export function statementRange(db, accountId, today = nowRome().date) {
  const inv = db.prepare(`SELECT MIN(issue_date) AS d FROM invoices WHERE account_id = ? AND number IS NOT NULL`).get(accountId).d;
  const svc = db.prepare(`SELECT MIN(date) AS d FROM bookings WHERE account_id = ?`).get(accountId).d;
  const first = [inv, svc].filter(Boolean).sort()[0]?.slice(0, 7) ?? today.slice(0, 7);
  const last = today.slice(0, 7);
  return { first: first > last ? last : first, last };
}

/** Lo stato di un servizio per l'agenzia: fatturato (con il numero), pagato online, da fatturare… */
function serviceState(db, b, today) {
  const penalty = b.status === 'cancelled';
  const inv = invoiceForSource(db, 'booking', b.id);
  if (inv?.number && inv.doc_type === 'TD01' && CREDITABLE_STATUS.includes(inv.status)) {
    return { state: 'invoiced', number: inv.number, paid: !!db.prepare('SELECT paid_at FROM invoices WHERE id = ?').get(inv.id).paid_at };
  }
  if (penalty) return { state: 'penalty' };
  if (b.payment_method === 'invoice') return { state: b.date > today ? 'upcoming' : 'toInvoice' };
  if (b.payment_method === 'card') return { state: 'card' };
  if (b.payment_method === 'onsite') return { state: 'onsite' };
  return { state: 'other' };
}

/**
 * L'estratto conto di un mese (AAAA-MM).
 * `open`: le fatture ancora da pagare alla fine del mese (o a oggi, per il mese in corso), con scadenza e giorni di ritardo;
 * `creditCents`: quanto l'agenzia ha già pagato in più (note di credito arrivate dopo l'incasso): il saldo finale è `open` meno questo.
 */
export function statementOf(app, accountId, month, nowMs = Date.now()) {
  const { db, cfg } = app;
  const today = nowRome(nowMs).date;
  const from = `${month}-01`;
  const to = lastDayOf(month);
  const asOf = to < today ? to : today;
  const { events, items } = ledger(db, accountId);

  let running = events.filter((e) => e.date < from).reduce((s, e) => s + e.cents, 0);
  const opening = running;
  const movements = [];
  for (const e of events) {
    if (e.date < from || e.date > to) continue;
    running += e.cents;
    movements.push({ ...e, balance: running });
  }
  const sum = (kind) => movements.filter((m) => m.kind === kind).reduce((s, m) => s + m.cents, 0);

  const open = [];
  let creditCents = 0;
  for (const item of items.values()) {
    if (item.inv.issue_date > to) continue;
    const credited = item.credits.filter((c) => c.date <= to).reduce((s, c) => s + c.cents, 0);
    const paid = item.paidDate && item.paidDate <= to ? item.paidCents : 0;
    const cents = item.owed - credited - paid;
    if (cents < 0) creditCents -= cents;
    if (cents <= 0) continue;
    const dueDate = dueDateOf(item.inv);
    open.push({ invoice: item.inv, cents, dueDate, daysLate: dueDate && dueDate < asOf ? daysBetween(dueDate, asOf) : 0 });
  }
  open.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.invoice.issue_date.localeCompare(b.invoice.issue_date) || a.invoice.id - b.invoice.id);

  const rows = db
    .prepare(`SELECT * FROM bookings WHERE account_id = ? AND date BETWEEN ? AND ? AND (status = 'confirmed' OR (status = 'cancelled' AND retained_cents > 0)) ORDER BY date, start_time, id`)
    .all(accountId, from, to);
  const services = rows.map((b) => ({
    id: b.id,
    ref: b.ref,
    date: b.date,
    start: b.start_time,
    slug: b.tour_slug,
    i18n: app.content.tour(b.tour_slug)?.i18n,
    people: b.participants,
    clientRef: b.client_ref ?? '',
    cents: b.status === 'cancelled' ? b.retained_cents : b.total_cents - (b.gift_cents ?? 0),
    ...serviceState(db, b, today),
  }));

  // servizi svolti ma non ancora in una fattura emessa (da oggi, qualunque mese): l'agenzia sa cosa le arriverà
  const startDate = settingsOf(cfg).startDate || '';
  const unbilled = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN b.status = 'cancelled' THEN b.retained_cents ELSE b.total_cents - b.gift_cents END), 0) AS cents FROM bookings b
       WHERE b.account_id = ? AND b.date <= ? AND b.date >= ? AND ((b.status = 'confirmed' AND b.payment_method = 'invoice' AND b.total_cents - b.gift_cents > 0) OR (b.status = 'cancelled' AND b.retained_cents > 0))
         AND NOT EXISTS (SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.source_type = 'booking' AND l.source_id = b.id AND l.released = 0 AND i.number IS NOT NULL)`,
    )
    .get(accountId, asOf, startDate);

  return {
    accountId,
    month,
    from,
    to,
    today,
    asOf,
    opening,
    closing: running,
    invoiced: sum('invoice'),
    credited: -sum('credit') || 0, // (mai «-0»: si stamperebbe come importo negativo)
    paid: -sum('payment') || 0,
    movements,
    open,
    creditCents,
    overdueCents: open.filter((o) => o.daysLate > 0).reduce((s, o) => s + o.cents, 0),
    services,
    unbilled: { count: Number(unbilled.n), cents: Number(unbilled.cents) },
    // c'è qualcosa da dire: movimenti nel mese, o un saldo (anche a credito) ancora aperto
    hasActivity: movements.length > 0 || running !== 0 || opening !== 0,
  };
}

// ───────────── CSV ─────────────
const money = (c) => (c / 100).toFixed(2).replace('.', ',');
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // niente formule dal foglio di calcolo
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Il registro dei movimenti per il foglio di calcolo (separatore «;», UTF-8 con BOM, decimali con la virgola):
 * saldo iniziale, un movimento per riga con il saldo progressivo, saldo finale.
 * `label(m)` dà il testo del documento e del dettaglio di un movimento: [documento, dettaglio].
 */
export function statementCsv(st, { head, opening, closing, label }) {
  const rows = [
    [st.from, opening, '', '', '', money(st.opening)],
    ...st.movements.map((m) => {
      const [doc, detail] = label(m);
      const due = m.kind === 'invoice' ? (dueDateOf(m.invoice) ?? '') : '';
      return [m.date, doc, due ? '' : detail, due, money(m.cents), money(m.balance)]; // la scadenza ha la sua colonna: non si ripete nel dettaglio
    }),
    [st.to, closing, '', '', '', money(st.closing)],
  ];
  // gli importi (ultime due colonne) sono già testo numerico con il segno: vanno scritti così; i testi liberi invece si proteggono
  return `﻿${[head.join(';'), ...rows.map((r) => r.map((v, i) => (i >= 4 ? v : cell(v))).join(';'))].join('\r\n')}\r\n`;
}
