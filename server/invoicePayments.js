// Pagamento delle fatture ai partner: quanto resta da pagare, entro quando, come (IBAN e causale), incasso e solleciti.
// Solo regole e database: email, pagamento con carta e lavoro periodico stanno in invoiceServices.js.
import { tx } from './db.js';
import { CREDITABLE_STATUS, getInvoice, invoiceLines, parseJson, settingsOf } from './invoices.js';
import { nowRome } from './time.js';
import { newRef, newToken } from './util.js';

const iso = (ms) => new Date(ms).toISOString();
const day = 86_400_000;

export const partsOf = (inv) => parseJson(inv.payments_json, []);

/** Una fattura (non una nota di credito), emessa, non stornata per intero e non ancora incassata: si può ancora pagare. */
export const isPayable = (inv) => inv.doc_type === 'TD01' && !!inv.number && CREDITABLE_STATUS.includes(inv.status) && !inv.credited && !inv.paid_at;

/** Le parti della fattura non pagate al momento dell'emissione (bonifico o contanti): è ciò che l'agenzia deve, finché non risulta incassata. */
export const openPartsCents = (inv) => partsOf(inv).filter((p) => !p.paid && p.method).reduce((s, p) => s + p.cents, 0);

/** Quanto resta da pagare (centesimi); 0 se è incassata, stornata, non è una fattura da pagare o era già saldata all'emissione. */
export function invoiceDue(inv) {
  return isPayable(inv) ? openPartsCents(inv) : 0;
}

/** La scadenza di pagamento (AAAA-MM-GG): la più vicina tra le parti ancora da pagare. */
export function dueDateOf(inv) {
  const dates = partsOf(inv).filter((p) => !p.paid && p.dueDate).map((p) => p.dueDate).sort();
  return dates[0] ?? null;
}

/**
 * Lo stato dell'incasso di una fattura, per elenchi e pagine.
 * state: paid | credited | settled (nulla da pagare: già saldata) | open (da pagare) | overdue (scaduta)
 * @returns {{state: string, dueCents: number, dueDate: string|null, days: number}} days: giorni di ritardo (se scaduta) o che mancano alla scadenza (se da pagare)
 */
export function payState(inv, today = nowRome().date) {
  if (inv.credited) return { state: 'credited', dueCents: 0, dueDate: null, days: 0 };
  if (inv.paid_at) return { state: 'paid', dueCents: 0, dueDate: null, days: 0 };
  const dueCents = invoiceDue(inv);
  if (!dueCents) return { state: 'settled', dueCents: 0, dueDate: null, days: 0 };
  const dueDate = dueDateOf(inv);
  if (!dueDate) return { state: 'open', dueCents, dueDate: null, days: 0 };
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / day);
  return diff > 0 ? { state: 'overdue', dueCents, dueDate, days: diff } : { state: 'open', dueCents, dueDate, days: Math.abs(diff) };
}

/** Il riferimento e il codice segreto per pagare questa fattura con la carta e per aprirne la pagina (si creano al primo bisogno). */
export function ensurePayRef(db, inv) {
  if (inv.pay_ref && inv.pay_token) return inv;
  const ref = inv.pay_ref ?? newRef('IN');
  const token = inv.pay_token ?? newToken();
  db.prepare('UPDATE invoices SET pay_ref = ?, pay_token = ? WHERE id = ?').run(ref, token, inv.id);
  return getInvoice(db, inv.id);
}

export const getInvoiceByPayRef = (db, ref) => db.prepare('SELECT * FROM invoices WHERE pay_ref = ?').get(String(ref));

export const invoicePayUrl = (app, inv, lang) => `${app.cfg.baseUrl}/${lang}/invoices/${inv.pay_ref}?t=${inv.pay_token}`;

export const groupIban = (iban) => String(iban ?? '').replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');

/** Come pagare con un bonifico: a chi, su quale conto, con quale causale, quanto ed entro quando. */
export function payInstructions(app, inv) {
  const s = settingsOf(app.cfg);
  const name = s.seller.name || [s.seller.firstName, s.seller.lastName].filter(Boolean).join(' ') || app.cfg.site.legalName;
  return { beneficiary: name, iban: groupIban(s.iban), bank: s.bank || '', reference: `Fattura ${inv.number}`, amountCents: invoiceDue(inv), dueDate: dueDateOf(inv) };
}

/**
 * Segna la fattura come incassata (bonifico arrivato, o pagata con carta) e, con lei, le prenotazioni e le penali che contiene.
 * @returns {{already: boolean, invoice: object}}
 */
export function markInvoicePaid(app, id, { method = 'bank', paymentIntent = null, paidAt = null } = {}, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (!inv || inv.doc_type !== 'TD01' || !inv.number) throw new Error('fattura non incassabile');
    if (inv.paid_at) return { already: true, invoice: inv };
    const when = paidAt ?? iso(nowMs);
    db.prepare('UPDATE invoices SET paid_at = ?, paid_method = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent), updated_at = ? WHERE id = ?').run(when, method, paymentIntent, iso(nowMs), id);
    const ids = invoiceLines(db, id).filter((l) => l.source_type === 'booking').map((l) => l.source_id);
    if (ids.length) {
      db.prepare(
        `UPDATE bookings SET payment_status = 'paid', payment_method = CASE WHEN ? = 'card' THEN 'card' ELSE payment_method END, stripe_payment_intent = COALESCE(?, stripe_payment_intent)
         WHERE id IN (${ids.map(() => '?').join(',')}) AND status IN ('confirmed', 'cancelled') AND payment_status = 'unpaid'`,
      ).run(method, paymentIntent, ...ids);
    }
    return { already: false, invoice: getInvoice(db, id) };
  });
}

/** Toglie l'incasso (registrato per errore): le prenotazioni tornano da incassare. Un pagamento con carta non si toglie da qui (si rimborsa). */
export function unmarkInvoicePaid(app, id, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (!inv?.paid_at) return null;
    if (inv.paid_method === 'card') throw new Error('un pagamento con carta non si toglie: si rimborsa');
    db.prepare('UPDATE invoices SET paid_at = NULL, paid_method = NULL, updated_at = ? WHERE id = ?').run(iso(nowMs), id);
    const ids = invoiceLines(db, id).filter((l) => l.source_type === 'booking').map((l) => l.source_id);
    if (ids.length) db.prepare(`UPDATE bookings SET payment_status = 'unpaid' WHERE id IN (${ids.map(() => '?').join(',')}) AND payment_method = 'invoice' AND stripe_payment_intent IS NULL AND payment_status = 'paid'`).run(...ids);
    return getInvoice(db, id);
  });
}

/** Le fatture scadute e non incassate, dalla più in ritardo. */
export function overdueInvoices(db, today = nowRome().date) {
  return db
    .prepare(`SELECT * FROM invoices WHERE doc_type = 'TD01' AND number IS NOT NULL AND paid_at IS NULL AND credited = 0 AND status IN (${CREDITABLE_STATUS.map(() => '?').join(',')})`)
    .all(...CREDITABLE_STATUS)
    .map((inv) => ({ inv, ...payState(inv, today) }))
    .filter((x) => x.state === 'overdue')
    .sort((a, b) => b.days - a.days);
}

/**
 * Le fatture a cui va mandato adesso un sollecito: scadute da almeno `firstAfterDays` giorni (la prima volta), poi ogni `everyDays` giorni,
 * fino a un massimo di solleciti. Il sollecito si manda a chi ha un'email.
 */
export function remindersDue(app, nowMs = Date.now()) {
  const cfg = app.cfg.reminders.overdue;
  if (!cfg?.enabled) return [];
  const today = nowRome(nowMs).date;
  return overdueInvoices(app.db, today).filter(({ inv, days }) => {
    if (inv.overdue_reminders >= cfg.max) return false;
    if (!inv.overdue_reminders) return days >= cfg.firstAfterDays;
    const since = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${nowRome(Date.parse(inv.overdue_reminded_at)).date}T00:00:00Z`)) / day);
    return since >= cfg.everyDays;
  });
}

/** Dove mandare i solleciti: l'email dell'intestatario della fattura, altrimenti quella dell'account del partner. */
export function invoiceEmail(db, inv) {
  const buyer = parseJson(inv.buyer_json);
  const acct = inv.account_id ? db.prepare('SELECT email, lang FROM accounts WHERE id = ?').get(inv.account_id) : null;
  return { email: buyer.email || acct?.email || '', lang: buyer.lang || acct?.lang || 'it', name: buyer.kind === 'person' ? buyer.firstName : buyer.name };
}

