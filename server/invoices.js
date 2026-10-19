// Fatture elettroniche: coda delle voci da fatturare, bozze, emissione numerata, note di credito.
// L'invio (PEC verso SdI, copia al cliente) sta in createInvoiceServices, in fondo.
import { bookingDue } from './bookings.js';
import { tx } from './db.js';
import { buildInvoiceXml, buyerProblems, causaleChunks, computeDocument, invoiceFileName, sellerProblems } from './fatturapa.js';
import { formatGiftCode } from './pricing.js';
import { addDays, fmtDate, isDate, nowRome } from './time.js';
import { cleanText } from './util.js';
import { normLang } from './langs.js';
import { parseServiceRecord, serviceNote } from './rates.js';
import { vatWithoutPrefix } from './vat.js';

export class InvoiceError extends Error {
  constructor(code, message, problems = []) {
    super(message);
    this.code = code; // notfound | state | config | buyer | lines | amount | date | source | pec
    this.problems = problems;
  }
}

export const STATUS_LABEL = { draft: 'Bozza', issued: 'Emessa', sent: 'Inviata a SdI', delivered: 'Consegnata', rejected: 'Scartata da SdI', undelivered: 'Mancata consegna' };
const EDITABLE = ['draft', 'rejected'];
/** Stati in cui il documento esiste fiscalmente (ha un numero e non è stato scartato). */
const LIVE = ['issued', 'sent', 'delivered', 'undelivered'];
/** Esiti di SdI ammessi a partire da ciascuno stato: «consegnata» è definitiva, uno scarto si corregge riemettendo. */
const SDI_NEXT = { issued: ['sent', 'delivered', 'rejected', 'undelivered'], sent: ['delivered', 'rejected', 'undelivered'], undelivered: ['sent', 'delivered', 'rejected'], delivered: [], rejected: [] };
export const sdiNext = (status) => SDI_NEXT[status] ?? [];
export const CREDITABLE_STATUS = LIVE;

// ───────────── impostazioni ─────────────
/** Impostazioni fiscali con i dati del cedente (te) presi dal profilo del sito. */
export function settingsOf(cfg) {
  const i = cfg.invoice;
  return { ...i, seller: { ...i.seller, vatNumber: cfg.site.vatNumber, phone: cfg.site.phone, email: cfg.site.email } };
}

/** Cosa manca o non torna nei dati fiscali: finché c'è qualcosa non si può emettere. */
export function configProblems(cfg) {
  const s = settingsOf(cfg);
  const out = sellerProblems({ ...s.seller, vatBp: s.vatBp, nature: s.nature });
  if (s.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s.iban)) out.push('L’IBAN non ha un formato valido.');
  if (s.seller.regime === 'RF19' && s.vatBp > 0) out.push('Il regime forfettario (RF19) non prevede IVA: imposta l’aliquota IVA a 0.');
  return out;
}

// ───────────── voci fatturabili ─────────────
const keyOf = (type, id) => `${type}:${id}`;
export function parseKey(key) {
  const m = /^(booking|gift|program):(\d+)$/.exec(String(key));
  return m ? { type: m[1], id: Number(m[2]) } : null;
}

const splitName = (full) => {
  const parts = cleanText(full, 120).split(/\s+/).filter(Boolean);
  return parts.length < 2 ? { firstName: parts[0] ?? '', lastName: '' } : { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) };
};
/** Paese dell'account (codice a due lettere); «OTHER» o un valore sconosciuto lasciano il campo vuoto, da scegliere a mano. */
const countryOf = (raw) => {
  const c = String(raw ?? '').trim().toUpperCase();
  if (!c) return 'IT';
  return /^[A-Z]{2}$/.test(c) ? c : '';
};

/**
 * L'intestatario di una fattura a un partner, già compilato con i dati dati alla registrazione (o corretti dopo). Se mancano, vale l'ultimo
 * intestatario salvato all'emissione di una fattura precedente (partner registrati prima che si chiedessero tutti i dati).
 */
function buyerFromAccount(a) {
  const saved = a.billing_json ? JSON.parse(a.billing_json) : {};
  const pick = (own, old) => String(own ?? '').trim() || String(old ?? '').trim();
  const country = countryOf(pick(a.country, saved.country));
  return {
    kind: 'company',
    name: a.company,
    country,
    vat: vatWithoutPrefix(pick(a.vat, saved.vat), country),
    taxCode: pick(a.tax_code, saved.taxCode).toUpperCase(),
    address: pick(a.address, saved.address),
    zip: pick(a.zip, saved.zip),
    city: pick(a.city, saved.city),
    province: pick(a.province, saved.province).toUpperCase(),
    sdiCode: pick(a.sdi_code, saved.sdiCode).toUpperCase(),
    pec: pick(a.pec, saved.pec),
    email: a.email,
    lang: normLang(a.lang),
  };
}
const buyerFromPerson = (name, email, lang) => ({ kind: 'person', ...splitName(name), name: '', country: lang === 'it' ? 'IT' : '', vat: '', taxCode: '', address: '', zip: '', city: '', province: '', sdiCode: '', pec: '', email, lang: lang === 'en' ? 'en' : 'it' });

const dateOf = (iso) => (iso ? nowRome(Date.parse(iso)).date : null);

/**
 * Descrive una voce fatturabile (prenotazione, buono regalo, programma):
 * cliente, importo da fatturare, come è stata pagata e testo della riga.
 */
export function describeSource(app, type, id, nowMs = Date.now()) {
  const { db, cfg, content } = app;
  const s = settingsOf(cfg);
  const today = nowRome(nowMs).date;
  const account = (accountId) => (accountId ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) : null);
  const common = { key: keyOf(type, id), type, id };

  if (type === 'booking') {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!b) return null;
    const tour = content.tour(b.tour_slug);
    const acct = b.channel === 'b2b' ? account(b.account_id) : null;
    const pkg = b.group_id ? db.prepare('SELECT ref FROM booking_groups WHERE id = ?').get(b.group_id) : null; // un pacchetto si fattura tutto insieme (le sue voci hanno lo stesso cliente)
    if (b.status === 'cancelled') {
      // prenotazione annullata con penale: si fattura solo quanto resta dovuto (se non c'è nulla, la voce non esiste)
      const kept = b.retained_cents ?? 0;
      const paidPart = b.payment_status !== 'unpaid';
      const cancelDate = dateOf(b.cancelled_at) ?? today;
      const title = tour?.i18n.it.title ?? b.tour_slug;
      return {
        ...common,
        ref: b.ref,
        label: `Penale di annullo · ${title} · ${fmtDate(b.date, 'it', 'short')} ${b.start_time} · ${b.participants} pers.`,
        date: cancelDate,
        served: true,
        channel: b.channel,
        invoiceRequested: !!acct || !!b.billing_json,
        accountId: acct?.id ?? null,
        buyerKey: acct ? `account:${acct.id}` : `email:${b.email}`,
        customer: acct ? acct.company : b.name,
        buyer: acct ? buyerFromAccount(acct) : buyerFromPerson(b.name, b.email, b.lang),
        hint: b.billing_json ? (JSON.parse(b.billing_json).text ?? null) : null,
        description: `Penale di annullo – ${title} – ${fmtDate(b.date, 'it', 'short')} ore ${b.start_time} – ${b.participants} ${b.participants === 1 ? 'persona' : 'persone'}${b.client_ref ? ` – rif. ${b.client_ref}` : ''}`,
        amountCents: kept,
        payments: [{ method: paidPart ? ({ card: 'MP08', onsite: 'MP01', invoice: 'MP05' }[b.payment_method] ?? null) : 'MP05', cents: kept, paid: paidPart }],
        dueBy: addDays(cancelDate, 12),
      };
    }
    // la parte pagata con un buono regalo è già stata fatturata alla vendita del buono (se è considerato monouso)
    const cents = s.giftInvoiceAt === 'sale' ? bookingDue(b) : b.total_cents;
    const paidNow = b.payment_status === 'paid';
    const method = { card: 'MP08', onsite: 'MP01', invoice: 'MP05' }[b.payment_method] ?? null;
    const payments = [];
    if (bookingDue(b) > 0) payments.push({ method, cents: bookingDue(b), paid: paidNow });
    if (cents > bookingDue(b)) payments.push({ method: null, cents: cents - bookingDue(b), paid: true });
    const served = b.date <= today;
    const paidDate = b.payment_method === 'card' && b.confirmed_at ? dateOf(b.confirmed_at) : null;
    const trigger = paidDate && paidDate < b.date ? paidDate : b.date;
    return {
      ...common,
      ref: b.ref,
      label: `${tour?.i18n.it.title ?? b.tour_slug} · ${fmtDate(b.date, 'it', 'short')} ${b.start_time} · ${b.participants} pers.`,
      package: pkg?.ref ?? null,
      date: b.date,
      served,
      channel: b.channel,
      invoiceRequested: !!acct || !!b.billing_json,
      accountId: acct?.id ?? null,
      buyerKey: acct ? `account:${acct.id}` : `email:${b.email}`,
      customer: acct ? acct.company : b.name,
      buyer: acct ? buyerFromAccount(acct) : buyerFromPerson(b.name, b.email, b.lang),
      hint: b.billing_json ? (JSON.parse(b.billing_json).text ?? null) : null,
      description: `${tour?.i18n.it.title ?? b.tour_slug} – ${fmtDate(b.date, 'it', 'short')} ore ${b.start_time} – ${b.participants} ${b.participants === 1 ? 'persona' : 'persone'}${serviceNote(parseServiceRecord(b.service_json)) ? ` – ${serviceNote(parseServiceRecord(b.service_json))}` : ''}${b.client_ref ? ` – rif. ${b.client_ref}` : ''}`,
      amountCents: cents,
      payments,
      dueBy: addDays(trigger, 12),
    };
  }

  if (type === 'gift') {
    const g = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
    if (!g) return null;
    const web = g.source === 'web';
    const date = dateOf(g.activated_at ?? g.created_at);
    return {
      ...common,
      ref: g.ref,
      label: `Buono regalo ${formatGiftCode(g.code)}`,
      date,
      served: true,
      channel: 'b2c',
      invoiceRequested: !!g.billing_json,
      accountId: null,
      buyerKey: `email:${g.buyer_email ?? g.ref}`,
      customer: g.buyer_name ?? g.buyer_email ?? g.ref,
      buyer: buyerFromPerson(g.buyer_name ?? '', g.buyer_email ?? '', g.lang),
      hint: null,
      description: `Buono regalo ${formatGiftCode(g.code)}${g.expires_at ? ` – valido fino al ${fmtDate(g.expires_at, 'it', 'date')}` : ''}`,
      amountCents: g.initial_cents,
      payments: [{ method: web ? 'MP08' : 'MP01', cents: g.initial_cents, paid: true }],
      dueBy: addDays(date, 12),
    };
  }

  if (type === 'program') {
    const p = db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
    if (!p) return null;
    const days = db.prepare('SELECT date FROM program_days WHERE program_id = ? ORDER BY date').all(p.id);
    const first = days[0]?.date;
    const last = days.at(-1)?.date ?? first ?? today;
    const acct = p.channel === 'b2b' ? account(p.account_id) : null;
    const total = p.total_cents ?? 0;
    const payments = [];
    if (p.deposit_status === 'paid' && p.deposit_cents) {
      payments.push({ method: p.stripe_payment_intent ? 'MP08' : 'MP05', cents: p.deposit_cents, paid: true });
      if (total > p.deposit_cents) payments.push({ method: 'MP05', cents: total - p.deposit_cents, paid: false });
    } else payments.push({ method: 'MP05', cents: total, paid: false });
    const range = first ? (last !== first ? `dal ${fmtDate(first, 'it', 'short')} al ${fmtDate(last, 'it', 'short')}` : `il ${fmtDate(first, 'it', 'short')}`) : '';
    return {
      ...common,
      ref: p.ref,
      label: `Programma ${p.proposal_title ?? p.ref}${range ? ` · ${range}` : ''}`,
      date: last,
      served: last <= today,
      channel: p.channel,
      invoiceRequested: true, // un programma su misura si fattura sempre
      accountId: acct?.id ?? null,
      buyerKey: acct ? `account:${acct.id}` : `email:${p.email}`,
      customer: acct ? acct.company : (p.company || p.name),
      buyer: acct ? buyerFromAccount(acct) : p.company ? { ...buyerFromPerson('', p.email, p.lang), kind: 'company', name: p.company } : buyerFromPerson(p.name, p.email, p.lang),
      hint: null,
      description: `Programma «${p.proposal_title ?? p.ref}»${range ? ` ${range}` : ''} – ${days.length} ${days.length === 1 ? 'giornata' : 'giornate'}${p.client_ref ? ` – rif. ${p.client_ref}` : ''}`,
      amountCents: total,
      payments,
      dueBy: addDays(last, 12),
    };
  }
  return null;
}

/** La fattura (anche in bozza) che contiene una prenotazione, un buono o un programma. */
export const invoiceForSource = (db, type, id) =>
  db.prepare(`SELECT i.id, i.number, i.status, i.doc_type FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.source_type = ? AND l.source_id = ? AND l.released = 0`).get(type, id) ?? null;

/** Una voce è fatturabile solo finché è valida: una prenotazione annullata o rimborsata, un buono annullato o un programma chiuso non si fatturano. */
function isBillable(db, type, id) {
  if (type === 'booking') {
    const b = db.prepare('SELECT status, retained_cents FROM bookings WHERE id = ?').get(id);
    return b?.status === 'confirmed' || (b?.status === 'cancelled' && b.retained_cents > 0); // annullata ma con una penale dovuta
  }
  const table = { gift: 'gift_cards', program: 'programs' }[type];
  const ok = { gift: 'active', program: 'confirmed' }[type];
  return db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id)?.status === ok;
}

const isReserved = (db, type, id) => !!db.prepare('SELECT 1 FROM invoice_lines WHERE source_type = ? AND source_id = ? AND released = 0').get(type, id);

/**
 * Voci ancora da fatturare: prenotazioni confermate (pagate o già svolte), penali di annullo, buoni venduti, programmi conclusi.
 * Dei clienti privati compaiono solo quelli che hanno chiesto la fattura al momento di prenotare (e non si può conoscere il codice fiscale
 * di tutti): gli altri stanno nell'elenco a parte (`optional: true`), per quando uno la chiede dopo.
 * Le agenzie e i programmi sono sempre da fatturare.
 */
export function invoiceQueue(app, nowMs = Date.now(), { optional = false } = {}) {
  const { db, cfg } = app;
  const today = nowRome(nowMs).date;
  const start = settingsOf(cfg).startDate;
  const items = [];
  const push = (type, id) => {
    if (isReserved(db, type, id)) return;
    const item = describeSource(app, type, id, nowMs);
    if (!item || item.amountCents <= 0 || (start && (item.date ?? '') < start)) return;
    if (item.invoiceRequested === optional) return; // richiesta → elenco normale; non richiesta → elenco a parte
    items.push({ ...item, overdue: !optional && item.dueBy < today });
  };
  for (const { id } of db.prepare(`SELECT id FROM bookings WHERE (status = 'confirmed' AND (payment_status = 'paid' OR date <= ?)) OR (status = 'cancelled' AND retained_cents > 0) ORDER BY date, start_time`).all(today)) push('booking', id);
  if (settingsOf(cfg).giftInvoiceAt === 'sale') for (const { id } of db.prepare(`SELECT id FROM gift_cards WHERE status = 'active' ORDER BY id`).all()) push('gift', id);
  for (const { id } of db.prepare(`SELECT id FROM programs WHERE status = 'confirmed' ORDER BY id`).all()) {
    const item = describeSource(app, 'program', id, nowMs);
    if (item?.served) push('program', id);
  }
  return items;
}

// ───────────── lettura ─────────────
export const getInvoice = (db, id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
export const invoiceLines = (db, id) => db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position, id').all(id);
export const parseJson = (s, d = {}) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
export const buyerOf = (inv) => parseJson(inv.buyer_json);
export const optionsOf = (inv) => parseJson(inv.options_json);

// ───────────── calcolo ─────────────
function reconcilePayments(lines, calc, s, dueDate, isCredit) {
  if (isCredit) return [];
  const merged = new Map();
  const add = (method, cents, paid) => {
    if (cents <= 0) return;
    const k = `${method ?? 'none'}|${paid ? 1 : 0}`;
    merged.set(k, { method, paid, cents: (merged.get(k)?.cents ?? 0) + cents });
  };
  for (const l of lines) {
    const parts = parseJson(l.source_payments, null);
    if (parts) parts.forEach((p) => add(p.method, p.cents, p.paid));
    else add('MP05', l.amount_cents, false);
  }
  const items = [...merged.values()];
  const sum = () => items.reduce((a, b) => a + b.cents, 0);
  let diff = calc.payableCents - sum();
  if (diff > 0) {
    const open = items.filter((i) => !i.paid && i.method).at(-1);
    if (open) open.cents += diff;
    else items.push({ method: 'MP05', paid: false, cents: diff });
  } else if (diff < 0) {
    for (const item of [...items].sort((a, b) => Number(a.paid) - Number(b.paid))) {
      const cut = Math.min(item.cents, -diff);
      item.cents -= cut;
      diff += cut;
      if (!diff) break;
    }
  }
  return items
    .filter((i) => i.method && i.cents > 0)
    .map((i) => ({ method: i.method, cents: i.cents, paid: i.paid, dueDate: !i.paid && i.method === 'MP05' ? dueDate : null, iban: i.method === 'MP05' ? s.iban : null, bank: s.bank }));
}

/** Calcola importi e pagamenti di una fattura a partire dalle sue righe e opzioni. */
export function calcInvoice(app, inv, lines) {
  const s = settingsOf(app.cfg);
  const opts = optionsOf(inv);
  const isCredit = inv.doc_type === 'TD04';
  const vatIncluded = s.vatBp > 0 && !!opts.vatIncluded;
  let calc;
  try {
    calc = computeDocument({
      lines: lines.map((l) => ({ description: l.description, amountCents: l.amount_cents, sourceKey: l.source_type ? keyOf(l.source_type, l.source_id) : null })),
      vatBp: s.vatBp,
      nature: s.vatBp === 0 ? s.nature : null,
      vatIncluded,
      bolloMode: s.bollo,
      bolloCharged: !!opts.bolloCharged && !vatIncluded,
      contributionPercent: vatIncluded ? 0 : opts.contributionPercent,
      withholdingPercent: opts.withholdingPercent,
      withholdingCause: s.withholdingCause,
      targetTotalCents: vatIncluded ? lines.reduce((a, l) => a + l.amount_cents, 0) : null,
      isCreditNote: isCredit,
    });
  } catch (err) {
    throw new InvoiceError('amount', err.message);
  }
  const payments = reconcilePayments(lines, calc, s, opts.dueDate ?? null, isCredit);
  return { calc, payments, settings: s, options: opts };
}

function persistCalc(db, id, calc, payments, nowMs) {
  db.prepare(
    `UPDATE invoices SET taxable_cents = ?, vat_cents = ?, bollo_cents = ?, bollo_charged = ?, contribution_cents = ?, withholding_cents = ?, rounding_cents = ?, total_cents = ?, payable_cents = ?, payments_json = ?, updated_at = ? WHERE id = ?`,
  ).run(calc.taxableCents, calc.vatCents, calc.bolloCents, calc.bolloCharged ? 1 : 0, calc.contributionCents, calc.withholdingCents, calc.roundingCents, calc.totalCents, calc.payableCents, JSON.stringify(payments), new Date(nowMs).toISOString(), id);
}

function writeLines(db, id, lines, calc) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(id);
  const ins = db.prepare('INSERT INTO invoice_lines(invoice_id, position, description, amount_cents, net_cents, vat_bp, nature, source_type, source_id, source_payments) VALUES(?,?,?,?,?,?,?,?,?,?)');
  lines.forEach((l, i) => {
    const c = calc.lines[i];
    ins.run(id, i, l.description, l.amount_cents, c.netCents, c.vatBp, c.nature, l.source_type ?? null, l.source_id ?? null, l.source_payments ?? null);
  });
}

// ───────────── bozze ─────────────
function defaultOptions(s, buyer, sources, issueDate) {
  const company = buyer.kind === 'company';
  const unpaid = sources.some((x) => x.payments.some((p) => p.method && !p.paid));
  const b2b = company || sources.some((x) => x.channel === 'b2b');
  const vatIncluded = s.vatBp > 0 && (b2b ? s.vatIncluded.b2b : s.vatIncluded.b2c);
  const italianBusiness = company && String(buyer.country).toUpperCase() === 'IT' && !!buyer.vat;
  return {
    vatIncluded,
    bolloCharged: unpaid, // se il cliente deve ancora pagare, il bollo gli si addebita; se ha già pagato il prezzo concordato lo assorbi tu
    contributionPercent: company && unpaid && !vatIncluded ? s.contributionPercent : 0,
    withholdingPercent: italianBusiness && unpaid ? s.withholdingPercent : 0,
    notes: '',
    dueDate: unpaid && sources.some((x) => x.payments.some((p) => p.method === 'MP05' && !p.paid)) ? addDays(issueDate, s.b2bDueDays) : null,
    hint: sources.map((x) => x.hint).filter(Boolean).join(' | ') || null,
    attempt: 0,
  };
}

function insertDraft(app, group, nowMs) {
  const { db, cfg } = app;
  const s = settingsOf(cfg);
  const today = nowRome(nowMs).date;
  const first = group[0];
  const buyer = first.buyer;
  const options = defaultOptions(s, buyer, group, today);
  const now = new Date(nowMs).toISOString();
  const info = db
    .prepare(`INSERT INTO invoices(status, doc_type, issue_date, account_id, buyer_json, options_json, currency, created_at, updated_at) VALUES('draft', 'TD01', ?, ?, ?, ?, 'EUR', ?, ?)`)
    .run(today, first.accountId, JSON.stringify(buyer), JSON.stringify(options), now, now);
  const id = Number(info.lastInsertRowid);
  const lines = group.map((x) => ({ description: x.description, amount_cents: x.amountCents, source_type: x.type, source_id: x.id, source_payments: JSON.stringify(x.payments) }));
  const inv = getInvoice(db, id);
  const { calc, payments } = calcInvoice(app, inv, lines);
  writeLines(db, id, lines, calc);
  persistCalc(db, id, calc, payments, nowMs);
  return getInvoice(db, id);
}

/** Crea una bozza per ciascun cliente tra le voci scelte (le voci dello stesso partner finiscono nella stessa fattura). */
export function createDrafts(app, keys, nowMs = Date.now()) {
  const { db } = app;
  const parsed = [...new Set(keys)].map(parseKey).filter(Boolean);
  if (!parsed.length) throw new InvoiceError('source', 'nessuna voce selezionata');
  return tx(db, () => {
    const sources = parsed.map(({ type, id }) => {
      const item = describeSource(app, type, id, nowMs);
      if (!item) throw new InvoiceError('source', 'voce non trovata');
      if (isReserved(db, type, id)) throw new InvoiceError('source', `${item.ref} è già in una fattura`);
      if (!isBillable(db, type, id)) throw new InvoiceError('source', `${item.ref}: annullata o non valida, non si fattura`);
      if (item.amountCents <= 0) throw new InvoiceError('source', `${item.ref}: nulla da fatturare`);
      return item;
    });
    const groups = new Map();
    for (const x of sources) groups.set(x.buyerKey, [...(groups.get(x.buyerKey) ?? []), x]);
    return [...groups.values()].map((g) => insertDraft(app, g, nowMs));
  });
}

/** Bozza senza voci collegate (servizio reso di persona, fattura a mano). */
export function createManualDraft(app, nowMs = Date.now()) {
  const { db, cfg } = app;
  const s = settingsOf(cfg);
  const today = nowRome(nowMs).date;
  const now = new Date(nowMs).toISOString();
  const buyer = { ...buyerFromPerson('', '', 'it'), country: 'IT' };
  const options = { vatIncluded: s.vatBp > 0 && s.vatIncluded.b2c, bolloCharged: true, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: null, hint: null, attempt: 0 };
  const id = Number(db.prepare(`INSERT INTO invoices(status, doc_type, issue_date, buyer_json, options_json, currency, created_at, updated_at) VALUES('draft', 'TD01', ?, ?, ?, 'EUR', ?, ?)`).run(today, JSON.stringify(buyer), JSON.stringify(options), now, now).lastInsertRowid);
  return getInvoice(db, id);
}

const num = (v, max) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : 0;
};

/**
 * Salva le modifiche a una bozza (o a una fattura scartata da SdI).
 * form: { buyer, lines: [{ key?, description, amountCents }], issueDate, options: { bolloCharged, contributionPercent, withholdingPercent, notes, dueDate } }
 */
export function saveDraft(app, id, form, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
    if (!EDITABLE.includes(inv.status)) throw new InvoiceError('state', 'una fattura emessa non si modifica: emetti una nota di credito');
    const old = invoiceLines(db, id);
    const b = form.buyer ?? {};
    const buyer = {
      kind: b.kind === 'person' ? 'person' : 'company',
      name: cleanText(b.name, 120),
      firstName: cleanText(b.firstName, 60),
      lastName: cleanText(b.lastName, 60),
      country: cleanText(b.country, 2).toUpperCase(),
      vat: cleanText(b.vat, 30).replace(/\s+/g, '').toUpperCase(),
      taxCode: cleanText(b.taxCode, 20).replace(/\s+/g, '').toUpperCase(),
      address: cleanText(b.address, 120),
      zip: cleanText(b.zip, 10),
      city: cleanText(b.city, 80),
      province: cleanText(b.province, 3).toUpperCase(),
      sdiCode: cleanText(b.sdiCode, 7).toUpperCase(),
      pec: cleanText(b.pec, 200),
      email: cleanText(b.email, 200).toLowerCase(),
      lang: normLang(b.lang),
    };
    const lines = (form.lines ?? []).map((l) => {
      const prev = l.key ? old.find((o) => o.source_type && keyOf(o.source_type, o.source_id) === l.key) : null;
      return { description: cleanText(l.description, 400), amount_cents: l.amountCents, rowNo: l.rowNo, source_type: prev?.source_type ?? null, source_id: prev?.source_id ?? null, source_payments: prev?.source_payments ?? null };
    });
    if (!lines.length) throw new InvoiceError('lines', 'serve almeno una riga');
    lines.forEach((l, i) => {
      if (l.description.length < 2) throw new InvoiceError('lines', `riga ${l.rowNo ?? i + 1}: manca la descrizione`);
      if (!Number.isInteger(l.amount_cents) || l.amount_cents <= 0) throw new InvoiceError('amount', `riga ${l.rowNo ?? i + 1}: importo non valido`);
    });
    const issueDate = isDate(form.issueDate) ? form.issueDate : inv.issue_date;
    const prev = optionsOf(inv);
    const o = form.options ?? {};
    const options = {
      ...prev,
      bolloCharged: !!o.bolloCharged,
      contributionPercent: num(o.contributionPercent, 100),
      withholdingPercent: num(o.withholdingPercent, 100),
      notes: cleanText(o.notes, 600),
      dueDate: isDate(o.dueDate) ? o.dueDate : null,
    };
    // un rifiuto di SdI si corregge tenendo numero e data: la data non si cambia
    const keepDate = inv.status === 'rejected';
    db.prepare('UPDATE invoices SET buyer_json = ?, options_json = ?, issue_date = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(buyer), JSON.stringify(options), keepDate ? inv.issue_date : issueDate, new Date(nowMs).toISOString(), id);
    const fresh = getInvoice(db, id);
    const { calc, payments } = calcInvoice(app, fresh, lines);
    writeLines(db, id, lines, calc);
    persistCalc(db, id, calc, payments, nowMs);
    return getInvoice(db, id);
  });
}

export function deleteDraft(app, id) {
  const inv = getInvoice(app.db, id);
  if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
  if (inv.status !== 'draft') throw new InvoiceError('state', 'si possono eliminare solo le bozze');
  app.db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
}

// ───────────── emissione ─────────────
/** Progressivo del file (max 5 caratteri alfanumerici): contatore globale, nuovo a ogni emissione o riemissione, mai riusato. */
export const progressiveFor = (fileSeq) => Number(fileSeq).toString(36).toUpperCase().padStart(5, '0');

function causaliFor(app, inv, s, opts) {
  const out = String(s.notes ?? '').split('|').map((x) => x.trim()).filter(Boolean);
  if (inv.doc_type === 'TD04' && inv.related_id) {
    const rel = getInvoice(app.db, inv.related_id);
    if (rel) out.unshift(`Nota di credito relativa alla fattura n. ${rel.number} del ${fmtDate(rel.issue_date, 'it', 'date')}.`);
  }
  if (opts.notes) out.push(opts.notes);
  return out;
}

const eur = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
/** Quanto si può stornare in tutto: il totale della fattura meno il bollo addebitato (che sulla nota di credito non si riporta). */
export const creditableCents = (rel) => rel.total_cents - (rel.bollo_charged ? rel.bollo_cents : 0);
/** Totale delle note di credito valide (emesse e non scartate) di una fattura, escluse quelle indicate. */
const creditedCents = (db, relatedId, exceptId = 0) =>
  db.prepare(`SELECT COALESCE(SUM(total_cents), 0) AS s FROM invoices WHERE related_id = ? AND doc_type = 'TD04' AND status IN ('issued','sent','delivered','undelivered') AND id != ?`).get(relatedId, exceptId).s;
/** «Stornata» e «voci di nuovo fatturabili» derivano sempre dalle note di credito valide: se una viene annullata o scartata si torna indietro. */
function refreshCredited(db, relatedId) {
  const rel = getInvoice(db, relatedId);
  if (!rel) return;
  const full = creditableCents(rel) - creditedCents(db, relatedId) <= 2;
  db.prepare('UPDATE invoices SET credited = ? WHERE id = ?').run(full ? 1 : 0, relatedId);
  if (full) db.prepare('UPDATE invoice_lines SET released = 1 WHERE invoice_id = ? AND source_type IS NOT NULL').run(relatedId);
  else {
    // la nota di credito è stata annullata o scartata: le voci tornano in questa fattura, a meno che nel frattempo siano finite in un'altra
    db.prepare(`UPDATE invoice_lines SET released = 0 WHERE invoice_id = ? AND released = 1 AND source_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoice_lines o WHERE o.source_type = invoice_lines.source_type AND o.source_id = invoice_lines.source_id AND o.released = 0)`).run(relatedId);
  }
}

/**
 * Emette la fattura: controlla i dati, assegna il numero progressivo dell'anno (senza buchi), genera l'XML.
 * Una fattura scartata da SdI si riemette con lo stesso numero e la stessa data.
 */
export function issueInvoice(app, id, nowMs = Date.now()) {
  const { db, cfg } = app;
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
    if (!EDITABLE.includes(inv.status)) throw new InvoiceError('state', 'la fattura è già stata emessa');
    const s = settingsOf(cfg);
    const cp = configProblems(cfg);
    if (cp.length) throw new InvoiceError('config', 'i dati fiscali non sono completi', cp);
    const buyer = buyerOf(inv);
    const bp = buyerProblems(buyer);
    if (bp.length) throw new InvoiceError('buyer', 'i dati dell’intestatario non sono completi', bp);
    const lines = invoiceLines(db, id);
    if (!lines.length) throw new InvoiceError('lines', 'serve almeno una riga');
    const today = nowRome(nowMs).date;
    const reissue = inv.status === 'rejected';
    const date = inv.issue_date;
    if (!isDate(date)) throw new InvoiceError('date', 'la data della fattura non è valida');
    if (!reissue && date > today) throw new InvoiceError('date', 'la data della fattura non può essere futura');
    if (!reissue && s.startDate && date < s.startDate) throw new InvoiceError('date', `prima del ${fmtDate(s.startDate, 'it', 'date')} non si emettono fatture (data iniziale impostata in Impostazioni › Fatturazione)`);
    if (buyer.country?.toUpperCase() === 'IT' && ((buyer.vat && buyer.vat === s.seller.vatNumber.replace(/^IT/i, '')) || (buyer.taxCode && buyer.taxCode === s.seller.fiscalCode))) {
      throw new InvoiceError('buyer', 'l’intestatario coincide con te (cedente): SdI scarta le fatture a sé stessi', ['Partita IVA o codice fiscale uguali ai tuoi.']);
    }
    if (inv.doc_type === 'TD01' && !reissue) {
      for (const l of lines) {
        if (l.source_type && !isBillable(db, l.source_type, l.source_id)) throw new InvoiceError('source', `${describeSource(app, l.source_type, l.source_id, nowMs)?.ref ?? 'una voce'} è stata annullata o non è più valida: toglila dalla fattura`);
      }
    }
    const relatedDoc = inv.related_id ? getInvoice(db, inv.related_id) : null;
    if (inv.doc_type === 'TD04' && !(relatedDoc?.number && LIVE.includes(relatedDoc.status))) throw new InvoiceError('state', 'la fattura da stornare non è valida: una nota di credito si emette solo su una fattura emessa');

    let { year, seq, number } = inv;
    const attempt = reissue ? (optionsOf(inv).attempt ?? 0) + 1 : 0;
    if (!reissue) {
      year = Number(date.slice(0, 4));
      const last = db.prepare('SELECT MAX(seq) AS seq FROM invoices WHERE year = ?').get(year).seq ?? 0;
      // la numerazione segue l'ordine cronologico: niente fatture con data precedente all'ultima già emessa nell'anno
      const lastDate = last ? db.prepare('SELECT issue_date FROM invoices WHERE year = ? AND seq = ?').get(year, last).issue_date : null;
      if (lastDate && date < lastDate) throw new InvoiceError('date', `la data non può essere precedente all'ultima fattura emessa (${fmtDate(lastDate, 'it', 'date')}): le fatture si numerano in ordine di data`);
      seq = last + 1;
      number = `${seq}/${year}`;
    }

    const fresh = { ...inv, number, issue_date: date, options_json: JSON.stringify({ ...optionsOf(inv), attempt }) };
    const { calc, payments, options } = calcInvoice(app, fresh, lines);
    if (relatedDoc) {
      const room = creditableCents(relatedDoc) - creditedCents(db, relatedDoc.id, id);
      if (calc.totalCents > room + 2) throw new InvoiceError('amount', `la nota di credito (${eur(calc.totalCents)}) supera quanto resta da stornare (${eur(Math.max(room, 0))})`);
    }
    const fileSeq = (db.prepare('SELECT MAX(file_seq) AS m FROM invoices').get().m ?? 0) + 1;
    const progressive = progressiveFor(fileSeq);
    const related = relatedDoc;
    const xml = buildInvoiceXml({
      progressive,
      seller: s.seller,
      buyer,
      type: inv.doc_type,
      date,
      number,
      currency: 'EUR',
      calc,
      causali: causaliFor(app, fresh, s, options),
      related: related ? { number: related.number, date: related.issue_date } : null,
      payments,
      legalReference: s.legalReference,
    });
    const snapshot = { regime: s.seller.regime, vatBp: s.vatBp, nature: s.nature, vatIncluded: options.vatIncluded, notes: s.notes, legalReference: s.legalReference, seller: s.seller };
    db.prepare(
      `UPDATE invoices SET status = 'issued', year = ?, seq = ?, number = ?, options_json = ?, config_json = ?, file_seq = ?, file_name = ?, xml = ?, sdi_note = NULL, status_at = ?, updated_at = ? WHERE id = ?`,
    ).run(year, seq, number, JSON.stringify({ ...options, attempt }), JSON.stringify(snapshot), fileSeq, invoiceFileName(s.seller.vatNumber, progressive), xml, new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), id);
    persistCalc(db, id, calc, payments, nowMs);
    writeLines(db, id, lines, calc);

    // intestatario memorizzato per le prossime fatture dello stesso partner
    if (inv.account_id) {
      const { kind, name, firstName, lastName, email, lang, ...saved } = buyer;
      db.prepare('UPDATE accounts SET billing_json = ? WHERE id = ?').run(JSON.stringify(saved), inv.account_id);
      // ciò che hai corretto nella bozza vale anche per le prossime fatture (e per la scheda del partner)
      const keep = (v) => (String(v ?? '').trim() ? String(v).trim() : null);
      db.prepare('UPDATE accounts SET address = COALESCE(?, address), zip = COALESCE(?, zip), city = COALESCE(?, city), province = COALESCE(?, province), tax_code = COALESCE(?, tax_code), sdi_code = COALESCE(?, sdi_code), pec = COALESCE(?, pec) WHERE id = ?')
        .run(keep(buyer.address), keep(buyer.zip), keep(buyer.city), keep(buyer.province), keep(buyer.taxCode), keep(buyer.sdiCode), keep(buyer.pec), inv.account_id);
    }
    // nota di credito: se storna per intero la fattura, le sue voci tornano fatturabili
    if (inv.doc_type === 'TD04' && related) refreshCredited(db, related.id);
    return getInvoice(db, id);
  });
}

/** Nota di credito (TD04) che storna una fattura emessa: nasce come bozza con le stesse righe, da rivedere. */
export function createCreditNote(app, relatedId, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const rel = getInvoice(db, relatedId);
    if (!rel) throw new InvoiceError('notfound', 'fattura non trovata');
    if (rel.doc_type !== 'TD01' || !LIVE.includes(rel.status)) throw new InvoiceError('state', 'si può stornare solo una fattura emessa');
    if (rel.credited) throw new InvoiceError('state', 'la fattura è già stata stornata per intero');
    if (db.prepare(`SELECT 1 FROM invoices WHERE related_id = ? AND doc_type = 'TD04' AND status = 'draft'`).get(relatedId)) throw new InvoiceError('state', 'c’è già una nota di credito in bozza per questa fattura');
    const now = new Date(nowMs).toISOString();
    const done = creditedCents(db, rel.id);
    const room = creditableCents(rel) - done;
    const relOpts = optionsOf(rel);
    // la nota di credito riprende rivalsa e ritenuta della fattura; dopo uno storno parziale propone solo ciò che resta
    const opts = { ...relOpts, bolloCharged: false, contributionPercent: done ? 0 : relOpts.contributionPercent ?? 0, withholdingPercent: done ? 0 : relOpts.withholdingPercent ?? 0, notes: '', dueDate: null, attempt: 0 };
    const id = Number(
      db.prepare(`INSERT INTO invoices(status, doc_type, issue_date, related_id, account_id, buyer_json, options_json, currency, created_at, updated_at) VALUES('draft', 'TD04', ?, ?, ?, ?, ?, 'EUR', ?, ?)`).run(nowRome(nowMs).date, rel.id, rel.account_id, rel.buyer_json, JSON.stringify(opts), now, now).lastInsertRowid,
    );
    const s = settingsOf(app.cfg);
    const gross = s.vatBp > 0 && !!relOpts.vatIncluded;
    const lines = done
      ? [{ description: `Storno parziale della fattura n. ${rel.number}`, amount_cents: Math.max(1, gross ? room : Math.round((room * 10000) / (10000 + s.vatBp))), source_type: null, source_id: null, source_payments: null }]
      : invoiceLines(db, rel.id)
          .filter((l) => !/^Imposta di bollo/.test(l.description))
          .map((l) => ({ description: `Storno: ${l.description}`.slice(0, 400), amount_cents: l.amount_cents, source_type: null, source_id: null, source_payments: null }));
    const inv = getInvoice(db, id);
    const { calc, payments } = calcInvoice(app, inv, lines);
    writeLines(db, id, lines, calc);
    persistCalc(db, id, calc, payments, nowMs);
    return getInvoice(db, id);
  });
}

/** Riporta in bozza l'ultima fattura emessa dell'anno se non è mai partita: libera il numero senza lasciare buchi. */
export function discardIssued(app, id, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const inv = getInvoice(db, id);
    if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
    if (db.prepare(`SELECT 1 FROM invoices WHERE related_id = ?`).get(id)) throw new InvoiceError('state', 'ci sono note di credito collegate a questa fattura: eliminale prima');
    if (inv.status !== 'issued' || inv.sent_at || inv.emailed_at) throw new InvoiceError('state', 'si può annullare solo una fattura emessa che non è stata inviata né mandata al cliente');
    const last = db.prepare('SELECT MAX(seq) AS seq FROM invoices WHERE year = ?').get(inv.year).seq;
    if (inv.seq !== last) throw new InvoiceError('state', 'si può annullare solo l’ultima fattura dell’anno (altrimenti la numerazione avrebbe un buco): emetti una nota di credito');
    db.prepare(`UPDATE invoices SET status = 'draft', year = NULL, seq = NULL, number = NULL, file_name = NULL, xml = NULL, config_json = NULL, updated_at = ? WHERE id = ?`).run(new Date(nowMs).toISOString(), id);
    if (inv.doc_type === 'TD04' && inv.related_id) refreshCredited(db, inv.related_id);
    return getInvoice(db, id);
  });
}

/** Esito comunicato da SdI (lo registri tu, leggendo le ricevute). */
export function setSdiStatus(app, id, status, note = '', nowMs = Date.now()) {
  const { db } = app;
  if (!['sent', 'delivered', 'rejected', 'undelivered'].includes(status)) throw new InvoiceError('state', 'stato non valido');
  const inv = getInvoice(db, id);
  if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
  if (inv.status === 'draft') throw new InvoiceError('state', 'la bozza non è stata emessa');
  if (status !== inv.status && !sdiNext(inv.status).includes(status)) {
    throw new InvoiceError('state', inv.status === 'delivered' ? 'una fattura consegnata è definitiva: per correggerla serve una nota di credito' : inv.status === 'rejected' ? 'una fattura scartata si corregge e si riemette' : `da «${STATUS_LABEL[inv.status]}» non si passa a «${STATUS_LABEL[status]}»`);
  }
  const now = new Date(nowMs).toISOString();
  db.prepare('UPDATE invoices SET status = ?, status_at = ?, sdi_note = ?, sent_at = CASE WHEN ? = \'sent\' AND sent_at IS NULL THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?').run(status, now, cleanText(note, 500) || null, status, now, now, id);
  if (inv.doc_type === 'TD04' && inv.related_id) refreshCredited(db, inv.related_id);
  return getInvoice(db, id);
}

// ───────────── registro ─────────────
const money = (c) => (c / 100).toFixed(2).replace('.', ',');
const cell = (v) => {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Testo libero (nomi inseriti da chiunque): un apice davanti impedisce che Excel o Sheets lo eseguano come formula. */
const text = (v) => (/^[=+\-@\t\r]/.test(String(v ?? '')) ? `'${v}` : v);

/** Registro delle fatture emesse in un anno, in CSV (separatore «;», decimali con la virgola) per il commercialista. */
export function invoicesCsv(app, year) {
  const rows = app.db.prepare(`SELECT * FROM invoices WHERE year = ? AND status != 'draft' ORDER BY seq`).all(year);
  const head = ['Numero', 'Data', 'Tipo', 'Cliente', 'Paese', 'P.IVA / ID fiscale', 'Codice fiscale', 'Imponibile (compresi contributo e bollo addebitato)', 'IVA', 'Bollo', 'Contributo', 'Ritenuta', 'Totale', 'Da pagare', 'Stato', 'Fattura collegata', 'File XML'];
  const lines = rows.map((r) => {
    const b = buyerOf(r);
    const related = r.related_id ? getInvoice(app.db, r.related_id)?.number : '';
    const sign = r.doc_type === 'TD04' ? -1 : 1; // le note di credito si sottraggono
    const m = (c) => money(sign * c);
    return [r.number, r.issue_date, r.doc_type === 'TD04' ? 'Nota di credito' : 'Fattura', text(b.kind === 'person' ? `${b.firstName} ${b.lastName}` : b.name), b.country, text(b.vat), text(b.taxCode), m(r.taxable_cents), m(r.vat_cents), m(r.bollo_cents), m(r.contribution_cents), m(r.withholding_cents), m(r.total_cents), m(r.payable_cents), STATUS_LABEL[r.status], related, r.file_name].map(cell).join(';');
  });
  return String.fromCharCode(0xfeff) + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}

/** Dettaglio per la pagina: fattura, righe, importi calcolati e problemi da risolvere prima di emettere. */
export function invoiceDetail(app, id) {
  const inv = getInvoice(app.db, id);
  if (!inv) return null;
  const lines = invoiceLines(app.db, id);
  const buyer = buyerOf(inv);
  const out = { inv, lines, buyer, options: optionsOf(inv), payments: parseJson(inv.payments_json, []), related: inv.related_id ? getInvoice(app.db, inv.related_id) : null };
  if (EDITABLE.includes(inv.status)) {
    out.problems = [...configProblems(app.cfg), ...buyerProblems(buyer)];
    try {
      out.calc = calcInvoice(app, inv, lines).calc;
    } catch (err) {
      out.problems.push(err.message);
    }
  }
  out.causali = causaliFor(app, inv, settingsOf(app.cfg), out.options).flatMap((c) => causaleChunks(c));
  return out;
}

