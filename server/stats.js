// Statistiche e KPI del pannello admin: query e aggregazioni.
//
// Sono funzioni pure: ricevono il database (e, dove serve, l'istante «adesso») e restituiscono dati semplici,
// così la stessa logica alimenta la pagina, l'esportazione CSV e i test.
// Importi sempre in centesimi; date 'YYYY-MM-DD' in ora di Venezia.
//
// Definizioni (le stesse che compaiono nella pagina, alla voce «Come sono calcolati i numeri»):
//  - periodo: dal giorno `from` al giorno `to` compresi, calcolato sulla «base» scelta, cioè la data del servizio
//    (bookings.date) oppure la data di prenotazione (bookings.created_at, in ora di Venezia);
//  - Venduto: somma di total_cents delle prenotazioni confermate nel periodo (valore del servizio dopo gli sconti,
//    compresa la parte pagata con buoni regalo);
//  - Da pagare di una prenotazione (bookingDue): total_cents meno gift_cents;
//  - Incassato: da pagare delle confermate già pagate (carta, oppure segnate come incassate) più la parte trattenuta
//    (retained_cents) delle annullate dopo il pagamento, cioè quanto è rimasto in cassa al netto dei rimborsi;
//  - Da incassare: da pagare delle confermate non ancora pagate (fattura, pagamento sul posto);
//    perciò  Venduto = incassato sulle confermate + da incassare + pagato con buoni regalo;
//  - Annullate: prenotazioni in stato «annullata» nel periodo; tasso = annullate / (confermate + annullate);
//    Rimborsi = somma di refund_cents; Penali = somma di retained_cents (trattenute o ancora da fatturare);
//  - medie: arrotondate al centesimo (mezzi verso l'alto);
//  - variazione: rispetto al periodo immediatamente precedente di pari durata.
import { bookingDue } from './bookings.js';
import { PAY_IT, PAYSTATUS_IT, STATUS_IT } from './views/admin.js';
import { LANG_META } from './langs.js';
import { addDays, addMonths, dayOfWeek, daysInMonth, isDate, localToInstant, nowRome } from './time.js';

// ───────────── filtri ─────────────
export const PRESETS = [
  { key: 'month', label: 'Questo mese' },
  { key: 'lastmonth', label: 'Mese scorso' },
  { key: 'd30', label: 'Ultimi 30 giorni' },
  { key: 'd90', label: 'Ultimi 90 giorni' },
  { key: 'year', label: 'Quest’anno' },
  { key: 'lastyear', label: 'Anno scorso' },
  { key: 'all', label: 'Tutto' },
];
export const DEFAULT_PRESET = 'd90';
export const BASES = [
  { key: 'service', label: 'Data del servizio' },
  { key: 'booking', label: 'Data di prenotazione' },
];
export const CHANNELS = [
  { key: 'all', label: 'Tutti' },
  { key: 'b2c', label: 'Privati' },
  { key: 'b2b', label: 'Partner' },
];
export const CHANNEL_IT = { b2c: 'Privati', b2b: 'Partner' };
/** Giorni della settimana, da lunedì (come si leggono in Italia). */
export const WEEKDAYS_IT = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

// Date accettate nei filtri: oltre questi limiti il valore si ignora (e il periodo torna a quello predefinito).
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';
const validDate = (s) => isDate(s) && s >= MIN_DATE && s <= MAX_DATE;

/** Un parametro della richiesta come stringa (se arriva ripetuto, vale il primo). */
const one = (v) => String(Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim().slice(0, 120);

/** Giorni fra due date 'YYYY-MM-DD' (b − a). */
export const diffDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Intervallo di un periodo predefinito rispetto a `today`; «Tutto» non ha limiti. */
export function presetRange(preset, today) {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const year = Number(today.slice(0, 4));
  switch (preset) {
    case 'month':
      return { from: firstOfMonth, to: `${today.slice(0, 7)}-${String(daysInMonth(today.slice(0, 7))).padStart(2, '0')}` };
    case 'lastmonth':
      return { from: addMonths(firstOfMonth, -1), to: addDays(firstOfMonth, -1) };
    case 'd30':
      return { from: addDays(today, -29), to: today };
    case 'year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'lastyear':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'all':
      return { from: null, to: null };
    default: // d90
      return { from: addDays(today, -89), to: today };
  }
}

/**
 * Filtri validati a partire dalla query string. Ciò che non è valido si scarta (mai un errore):
 * date malformate o invertite → periodo predefinito (con `datesIgnored`), canale/partner/tour sconosciuti → «tutti».
 * Se ci sono entrambe le date valide il periodo è personalizzato; altrimenti vale `p` (il periodo predefinito di questa pagina, se manca).
 * `tours` = slug dei tour conosciuti, `partners` = id dei partner conosciuti.
 */
export function parseFilters(query, { nowMs = Date.now(), tours = [], partners = [] } = {}) {
  const q = query ?? {};
  const today = nowRome(nowMs).date;
  const basis = one(q.basis) === 'booking' ? 'booking' : 'service';
  let channel = ['b2c', 'b2b'].includes(one(q.channel)) ? one(q.channel) : 'all';
  const partnerRaw = one(q.partner);
  const account = /^\d{1,9}$/.test(partnerRaw) && partners.includes(Number(partnerRaw)) ? Number(partnerRaw) : null;
  const tourRaw = one(q.tour);
  const tour = tourRaw && tours.includes(tourRaw) ? tourRaw : null;
  if (account) channel = 'b2b'; // un partner è, per forza, del canale partner

  let preset = PRESETS.some((p) => p.key === one(q.p)) ? one(q.p) : DEFAULT_PRESET;
  const fromRaw = one(q.from);
  const toRaw = one(q.to);
  let range = null;
  let datesIgnored = false;
  if (fromRaw || toRaw) {
    if (validDate(fromRaw) && validDate(toRaw) && fromRaw <= toRaw) {
      preset = 'custom';
      range = { from: fromRaw, to: toRaw };
    } else datesIgnored = true;
  }
  const { from, to } = range ?? presetRange(preset, today);
  return { preset, from, to, basis, channel, account, tour, datesIgnored };
}

/** Indirizzo della pagina (o del CSV) con i filtri dati, scrivendo solo ciò che differisce dal predefinito. */
export function statsHref(f, over = {}, path = '/admin/stats') {
  const m = { ...f, ...over };
  const q = new URLSearchParams();
  if (m.preset === 'custom') {
    q.set('from', m.from);
    q.set('to', m.to);
  } else if (m.preset !== DEFAULT_PRESET) q.set('p', m.preset);
  if (m.basis !== 'service') q.set('basis', m.basis);
  if (m.channel !== 'all') q.set('channel', m.channel);
  if (m.account) q.set('partner', String(m.account));
  if (m.tour) q.set('tour', m.tour);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Elenchi per i menu dei filtri: i tour noti (dal contenuto del sito) più quelli che compaiono solo nelle prenotazioni
 * (tour eliminati: si mostra lo slug) e i partner.
 * @param {{slug: string, title: string}[]} contentTours
 */
export function filterOptions(db, contentTours = []) {
  const known = new Map(contentTours.map((t) => [t.slug, t.title || t.slug]));
  for (const { tour_slug: slug } of db.prepare('SELECT DISTINCT tour_slug FROM bookings').all()) if (!known.has(slug)) known.set(slug, slug);
  const tours = [...known].map(([slug, title]) => ({ slug, title })).sort((a, b) => a.title.localeCompare(b.title, 'it'));
  const partners = db.prepare('SELECT id, company FROM accounts ORDER BY company COLLATE NOCASE, id').all();
  return { tours, partners };
}

// ───────────── SQL: periodo e filtri ─────────────
/**
 * Data (ora di Venezia) di una colonna con un istante ISO in UTC. L'ora legale europea va dall'ultima domenica di marzo
 * all'ultima di ottobre, in entrambi i casi alle 01:00 UTC: qui si decide in SQL fra +1 e +2 ore.
 */
export const veniceDateSql = (col) =>
  `date(${col}, CASE WHEN ${col} >= date(substr(${col}, 1, 4) || '-04-01', 'weekday 0', '-7 days') || 'T01:00:00' AND ${col} < date(substr(${col}, 1, 4) || '-11-01', 'weekday 0', '-7 days') || 'T01:00:00' THEN '+2 hours' ELSE '+1 hour' END)`;

/** Il «giorno» di una prenotazione secondo la base scelta. */
const dayExpr = (f, alias = '') => (f.basis === 'booking' ? veniceDateSql(`${alias}created_at`) : `${alias}date`);

/** Inizio del giorno (ora di Venezia) come istante ISO: i created_at si confrontano come testo. */
const startOfDayIso = (date) => new Date(localToInstant(date, '00:00')).toISOString();

/** Condizioni SQL comuni a tutte le interrogazioni sulle prenotazioni: periodo (se c'è) e filtri. */
function scope(f, range, alias = '') {
  const w = [];
  const p = [];
  if (range) {
    if (f.basis === 'booking') {
      w.push(`${alias}created_at >= ? AND ${alias}created_at < ?`);
      p.push(startOfDayIso(range.from), startOfDayIso(addDays(range.to, 1)));
    } else {
      w.push(`${alias}date BETWEEN ? AND ?`);
      p.push(range.from, range.to);
    }
  }
  if (f.channel !== 'all') {
    w.push(`${alias}channel = ?`);
    p.push(f.channel);
  }
  if (f.account) {
    w.push(`${alias}account_id = ?`);
    p.push(f.account);
  }
  if (f.tour) {
    w.push(`${alias}tour_slug = ?`);
    p.push(f.tour);
  }
  return { sql: w.length ? w.join(' AND ') : '1 = 1', params: p };
}

/**
 * Periodo effettivo: `from`/`to` compresi, durata in giorni e periodo precedente di pari durata.
 * «Tutto» va dal primo all'ultimo giorno con prenotazioni e non ha periodo precedente.
 * `range` è ciò che si passa alle interrogazioni (null = nessun limite).
 */
export function resolvePeriod(db, f, today) {
  if (f.from && f.to) {
    const days = diffDays(f.from, f.to) + 1;
    return { from: f.from, to: f.to, days, open: false, range: { from: f.from, to: f.to }, prev: { from: addDays(f.from, -days), to: addDays(f.from, -1) } };
  }
  const s = scope(f, null);
  const row = db.prepare(`SELECT MIN(${dayExpr(f)}) AS a, MAX(${dayExpr(f)}) AS b FROM bookings WHERE status IN ('confirmed', 'cancelled') AND ${s.sql}`).get(...s.params);
  const from = row.a ?? today;
  const to = row.b ?? today;
  return { from, to, days: diffDays(from, to) + 1, open: true, range: null, prev: null };
}

// ───────────── totali e confronto ─────────────
const GROUP_COLS = `COUNT(*) AS n, COALESCE(SUM(participants), 0) AS pax, COALESCE(SUM(total_cents), 0) AS cents`;

/** Totali grezzi del periodo: prenotazioni confermate e annullate. */
function rawTotals(db, f, range) {
  const s = scope(f, range);
  const conf = db
    .prepare(
      `SELECT COUNT(*) AS bookings,
              COALESCE(SUM(participants), 0) AS pax,
              COALESCE(SUM(total_cents), 0) AS sold,
              COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_cents - COALESCE(gift_cents, 0) ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN payment_status <> 'paid' THEN total_cents - COALESCE(gift_cents, 0) ELSE 0 END), 0) AS unpaid,
              COALESCE(SUM(COALESCE(gift_cents, 0)), 0) AS gift,
              COALESCE(SUM(CASE WHEN COALESCE(gift_cents, 0) > 0 THEN 1 ELSE 0 END), 0) AS giftBookings,
              COALESCE(SUM(discount_cents), 0) AS discount,
              COALESCE(SUM(CASE WHEN promo_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS promoBookings,
              COALESCE(SUM(CASE WHEN channel = 'b2b' THEN total_cents ELSE 0 END), 0) AS soldB2b,
              COALESCE(SUM(CASE WHEN channel = 'b2b' THEN 1 ELSE 0 END), 0) AS bookingsB2b,
              AVG(MAX(0, julianday(date) - julianday(${veniceDateSql('created_at')}))) AS leadDays
       FROM bookings WHERE status = 'confirmed' AND ${s.sql}`,
    )
    .get(...s.params);
  const canc = db
    .prepare(
      `SELECT COUNT(*) AS cancelled,
              COALESCE(SUM(refund_cents), 0) AS refunds,
              COALESCE(SUM(retained_cents), 0) AS penalties,
              COALESCE(SUM(CASE WHEN payment_status = 'unpaid' THEN retained_cents ELSE 0 END), 0) AS penaltiesToBill,
              COALESCE(SUM(CASE WHEN payment_status <> 'unpaid' THEN retained_cents ELSE 0 END), 0) AS penaltiesKept,
              COALESCE(SUM(CASE WHEN payment_status = 'refund_failed' THEN 1 ELSE 0 END), 0) AS refundsFailed
       FROM bookings WHERE status = 'cancelled' AND ${s.sql}`,
    )
    .get(...s.params);
  return { ...conf, ...canc };
}

/** Fatturato emesso: fatture (TD01) meno note di credito (TD04) emesse, per data di emissione. Non dipende dagli altri filtri. */
export function invoicedTotals(db, range) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN doc_type = 'TD04' THEN -total_cents ELSE total_cents END), 0) AS cents,
              COALESCE(SUM(CASE WHEN doc_type = 'TD01' THEN 1 ELSE 0 END), 0) AS invoices,
              COALESCE(SUM(CASE WHEN doc_type = 'TD04' THEN 1 ELSE 0 END), 0) AS creditNotes
       FROM invoices WHERE status IN ('issued', 'sent', 'delivered', 'undelivered') ${range ? 'AND issue_date BETWEEN ? AND ?' : ''}`,
    )
    .get(...(range ? [range.from, range.to] : []));
  return { ...row };
}

const ratio = (a, b) => (b ? a / b : 0);
const avg = (cents, n) => (n ? Math.round(cents / n) : 0);

/** Misure derivate (medie, tassi, incassato) a partire dai totali grezzi. */
function derive(t, invoiced) {
  const soldB2c = t.sold - t.soldB2b;
  const bookingsB2c = t.bookings - t.bookingsB2b;
  return {
    ...t,
    soldB2c,
    bookingsB2c,
    collected: t.paid + t.penaltiesKept,
    avgTicket: avg(t.sold, t.bookings),
    avgTicketB2c: avg(soldB2c, bookingsB2c),
    avgTicketB2b: avg(t.soldB2b, t.bookingsB2b),
    avgPerPax: avg(t.sold, t.pax),
    cancelRate: ratio(t.cancelled, t.bookings + t.cancelled),
    partnerShare: ratio(t.soldB2b, t.sold),
    leadDays: t.leadDays == null ? null : Math.round(t.leadDays * 10) / 10,
    invoiced: invoiced.cents,
    invoices: invoiced.invoices,
    creditNotes: invoiced.creditNotes,
  };
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Variazione fra due valori: in percentuale (`pct`) oppure, per i tassi (valori da 0 a 1), in punti percentuali (`points`).
 * `dir` è -1, 0 o 1. Se il valore precedente è zero non c'è una percentuale (`pct: null`, `fromZero` vero quando ora c'è qualcosa).
 */
export function change(cur, prev, kind = 'pct') {
  if (prev == null || cur == null) return null;
  if (kind === 'points') {
    const points = round1((cur - prev) * 100);
    return { points, dir: Math.sign(points) };
  }
  if (prev === 0) return { pct: null, dir: cur > 0 ? 1 : 0, fromZero: cur > 0 };
  const pct = round1(((cur - prev) / prev) * 100);
  return { pct, dir: Math.sign(pct) };
}

/** Le misure che si confrontano con il periodo precedente, e se la variazione è in punti. */
const COMPARED = {
  sold: 'pct', bookings: 'pct', pax: 'pct', avgTicket: 'pct', avgPerPax: 'pct', leadDays: 'pct', partnerShare: 'points',
  collected: 'pct', unpaid: 'pct', discount: 'pct', gift: 'pct',
  cancelled: 'pct', cancelRate: 'points', refunds: 'pct', penalties: 'pct',
  invoiced: 'pct',
};

// ───────────── raggruppamenti ─────────────
function withShares(rows, total) {
  return rows.map((r) => ({ ...r, share: ratio(r.cents, total), avg: avg(r.cents, r.n) }));
}

const byCentsDesc = (a, b) => b.cents - a.cents || b.n - a.n || String(a.label ?? a.key).localeCompare(String(b.label ?? b.key), 'it');

/** Prenotazioni confermate raggruppate per un'espressione SQL (colonna, o data secondo la base). */
function groupedBy(db, f, range, keyExpr) {
  const s = scope(f, range);
  return db
    .prepare(`SELECT ${keyExpr} AS k, ${GROUP_COLS} FROM bookings WHERE status = 'confirmed' AND ${s.sql} GROUP BY k`)
    .all(...s.params)
    .map((r) => ({ key: r.k, n: r.n, pax: r.pax, cents: r.cents }));
}

function partnerRows(db, f, range, total, limit = 10) {
  const s = scope(f, range, 'b.');
  const rows = db
    .prepare(
      `SELECT b.account_id AS id, COALESCE(a.company, 'Partner n. ' || b.account_id) AS company,
              COUNT(*) AS n, COALESCE(SUM(b.participants), 0) AS pax, COALESCE(SUM(b.total_cents), 0) AS cents, MAX(b.date) AS lastDate
       FROM bookings b LEFT JOIN accounts a ON a.id = b.account_id
       WHERE b.status = 'confirmed' AND b.channel = 'b2b' AND b.account_id IS NOT NULL AND ${s.sql}
       GROUP BY b.account_id`,
    )
    .all(...s.params)
    .map((r) => ({ key: r.id, id: r.id, label: r.company, n: r.n, pax: r.pax, cents: r.cents, lastDate: r.lastDate }))
    .sort(byCentsDesc);
  const top = withShares(rows.slice(0, limit), total);
  const rest = rows.slice(limit);
  const others = rest.length ? { count: rest.length, n: rest.reduce((a, r) => a + r.n, 0), pax: rest.reduce((a, r) => a + r.pax, 0), cents: rest.reduce((a, r) => a + r.cents, 0) } : null;
  return { rows: top, others, count: rows.length };
}

// ───────────── andamento nel tempo ─────────────
/** Passo del grafico: ≤ 45 giorni → giorno, ≤ 200 → settimana, altrimenti mese (anno se i mesi sarebbero troppi). */
export function granularityFor(days) {
  if (days <= 45) return 'day';
  if (days <= 200) return 'week';
  return days > 6 * 366 ? 'year' : 'month';
}

const weekStart = (date) => addDays(date, -((dayOfWeek(date) + 6) % 7)); // lunedì
const bucketKeyOf = (date, gran) => (gran === 'day' ? date : gran === 'week' ? weekStart(date) : gran === 'month' ? date.slice(0, 7) : date.slice(0, 4));

/** Intervalli (con le estremità tagliate sul periodo) in cui si divide il periodo. */
export function bucketsOf(from, to, gran) {
  const out = [];
  if (gran === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ key: d, from: d, to: d });
  } else if (gran === 'week') {
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) out.push({ key: w, from: w < from ? from : w, to: addDays(w, 6) > to ? to : addDays(w, 6) });
  } else if (gran === 'month') {
    for (let m = `${from.slice(0, 7)}-01`; m <= to; m = addMonths(m, 1)) {
      const last = `${m.slice(0, 7)}-${String(daysInMonth(m.slice(0, 7))).padStart(2, '0')}`;
      out.push({ key: m.slice(0, 7), from: m < from ? from : m, to: last > to ? to : last });
    }
  } else {
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) out.push({ key: String(y), from: `${y}-01-01` < from ? from : `${y}-01-01`, to: `${y}-12-31` > to ? to : `${y}-12-31` });
  }
  return out;
}

function timeSeries(db, f, period) {
  const gran = granularityFor(period.days);
  const s = scope(f, period.range);
  const days = db.prepare(`SELECT ${dayExpr(f)} AS d, ${GROUP_COLS} FROM bookings WHERE status = 'confirmed' AND ${s.sql} GROUP BY d`).all(...s.params);
  const buckets = bucketsOf(period.from, period.to, gran).map((b) => ({ ...b, n: 0, pax: 0, cents: 0 }));
  const index = new Map(buckets.map((b) => [b.key, b]));
  for (const r of days) {
    const b = index.get(bucketKeyOf(r.d, gran));
    if (!b) continue; // fuori dall'intervallo disegnato: non succede, ma non deve rompere nulla
    b.n += r.n;
    b.pax += r.pax;
    b.cents += r.cents;
  }
  return { gran, buckets, totalCents: buckets.reduce((a, b) => a + b.cents, 0), maxCents: buckets.reduce((m, b) => Math.max(m, b.cents), 0) };
}

// ───────────── portafoglio futuro ─────────────
/** Già prenotato (confermate con data da oggi in poi) nei prossimi 30, 60 e 90 giorni (oggi compreso). Non dipende dai filtri. */
export function futurePortfolio(db, today) {
  const rows = db.prepare(`SELECT date, ${GROUP_COLS} FROM bookings WHERE status = 'confirmed' AND date BETWEEN ? AND ? GROUP BY date`).all(today, addDays(today, 89));
  return [30, 60, 90].map((days) => {
    const last = addDays(today, days - 1);
    const inside = rows.filter((r) => r.date <= last);
    return { days, to: last, n: inside.reduce((a, r) => a + r.n, 0), pax: inside.reduce((a, r) => a + r.pax, 0), cents: inside.reduce((a, r) => a + r.cents, 0) };
  });
}

// ───────────── buoni regalo, codici sconto, programmi ─────────────
const isoRange = (range) => (range ? [startOfDayIso(range.from), startOfDayIso(addDays(range.to, 1))] : []);

/** Buoni regalo venduti nel periodo (per data di attivazione) e saldo ancora da onorare. Non dipende dai filtri su canale, partner e tour. */
export function giftStats(db, range, today) {
  const sold = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(initial_cents), 0) AS cents,
              COALESCE(SUM(CASE WHEN source = 'web' THEN 1 ELSE 0 END), 0) AS webN,
              COALESCE(SUM(CASE WHEN source = 'web' THEN initial_cents ELSE 0 END), 0) AS webCents
       FROM gift_cards WHERE status = 'active' AND activated_at IS NOT NULL ${range ? 'AND activated_at >= ? AND activated_at < ?' : ''}`,
    )
    .get(...isoRange(range));
  const balance = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(balance_cents), 0) AS cents FROM gift_cards WHERE status = 'active' AND balance_cents > 0 AND (expires_at IS NULL OR expires_at >= ?)`)
    .get(today);
  const expired = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(balance_cents), 0) AS cents FROM gift_cards WHERE status = 'active' AND balance_cents > 0 AND expires_at < ?`).get(today);
  return { sold: { ...sold, adminN: sold.n - sold.webN, adminCents: sold.cents - sold.webCents }, balance: { ...balance }, expired: { ...expired } };
}

/** Uso dei codici sconto nelle prenotazioni confermate del periodo (con gli stessi filtri del resto della pagina). */
export function promoUsage(db, f, range) {
  const s = scope(f, range);
  const rows = db
    .prepare(
      `SELECT promo_code AS code, COUNT(*) AS n, COALESCE(SUM(discount_cents), 0) AS cents
       FROM bookings WHERE status = 'confirmed' AND promo_code IS NOT NULL AND ${s.sql} GROUP BY promo_code`,
    )
    .all(...s.params)
    .map((r) => ({ ...r }))
    .sort((a, b) => b.cents - a.cents || b.n - a.n || a.code.localeCompare(b.code));
  return { rows, n: rows.reduce((a, r) => a + r.n, 0), cents: rows.reduce((a, r) => a + r.cents, 0) };
}

/** Programmi di più giorni accettati o confermati, per data della prima giornata. Rispettano canale e partner, non tour e base. */
export function programStats(db, f, range) {
  const w = [];
  const p = [];
  if (range) {
    w.push('d.firstDay BETWEEN ? AND ?');
    p.push(range.from, range.to);
  }
  if (f.channel !== 'all') {
    w.push('p.channel = ?');
    p.push(f.channel);
  }
  if (f.account) {
    w.push('p.account_id = ?');
    p.push(f.account);
  }
  const rows = db
    .prepare(
      `SELECT p.status AS status, COUNT(*) AS n, COALESCE(SUM(p.total_cents), 0) AS cents,
              COALESCE(SUM(CASE WHEN p.deposit_status = 'paid' THEN p.deposit_cents ELSE 0 END), 0) AS depositsPaid
       FROM programs p JOIN (SELECT program_id, MIN(date) AS firstDay FROM program_days GROUP BY program_id) d ON d.program_id = p.id
       WHERE p.status IN ('accepted', 'confirmed') ${w.length ? `AND ${w.join(' AND ')}` : ''} GROUP BY p.status`,
    )
    .all(...p);
  const get = (status) => rows.find((r) => r.status === status) ?? { n: 0, cents: 0, depositsPaid: 0 };
  const confirmed = get('confirmed');
  const accepted = get('accepted');
  return {
    n: confirmed.n + accepted.n,
    cents: confirmed.cents + accepted.cents,
    confirmed: { n: confirmed.n, cents: confirmed.cents },
    accepted: { n: accepted.n, cents: accepted.cents }, // accettati, in attesa dell'acconto
    depositsPaid: confirmed.depositsPaid + accepted.depositsPaid,
  };
}

// ───────────── il rapporto completo ─────────────
/**
 * Tutto ciò che mostra la pagina, calcolato su `f` (vedi parseFilters). `nowMs` è l'istante «adesso»;
 * `tourTitle` traduce lo slug di un tour nel suo nome (se il tour non esiste più resta lo slug).
 * @param {{ nowMs?: number, tourTitle?: (slug: string) => string }} [opts]
 */
export function statsReport(db, f, { nowMs = Date.now(), tourTitle = (slug) => slug } = {}) {
  const today = nowRome(nowMs).date;
  const period = resolvePeriod(db, f, today);
  const invoicedNow = invoicedTotals(db, period.range);
  const cur = derive(rawTotals(db, f, period.range), invoicedNow);
  const prev = period.prev ? derive(rawTotals(db, f, period.prev), invoicedTotals(db, period.prev)) : null;

  const changes = {};
  for (const [key, kind] of Object.entries(COMPARED)) changes[key] = prev ? change(cur[key], prev[key], kind) : null;

  const sold = cur.sold;
  const tours = withShares(groupedBy(db, f, period.range, 'tour_slug').sort(byCentsDesc), sold).map((r) => ({ ...r, label: tourTitle(r.key) }));
  const channels = withShares(groupedBy(db, f, period.range, 'channel').sort(byCentsDesc), sold).map((r) => ({ ...r, label: CHANNEL_IT[r.key] ?? r.key }));
  const payments = withShares(groupedBy(db, f, period.range, 'payment_method').sort(byCentsDesc), sold).map((r) => ({ ...r, label: PAY_IT[r.key] ?? r.key }));
  const langs = withShares(groupedBy(db, f, period.range, 'lang').sort(byCentsDesc), sold).map((r) => ({ ...r, label: LANG_META[r.key]?.name ?? String(r.key).toUpperCase() }));
  const byDay = groupedBy(db, f, period.range, `CAST(strftime('%w', ${dayExpr(f)}) AS INTEGER)`); // 0 = domenica
  const weekdays = withShares(
    WEEKDAYS_IT.map((label, i) => {
      const r = byDay.find((x) => x.key === (i + 1) % 7) ?? { n: 0, pax: 0, cents: 0 };
      return { key: i, label, n: r.n, pax: r.pax, cents: r.cents };
    }),
    sold,
  );

  return {
    filters: f,
    today,
    period: { from: period.from, to: period.to, days: period.days, open: period.open, prev: period.prev },
    empty: cur.bookings === 0 && cur.cancelled === 0,
    kpi: cur,
    prevKpi: prev,
    changes,
    series: timeSeries(db, f, period),
    tours,
    channels,
    partners: partnerRows(db, f, period.range, sold),
    payments,
    langs,
    weekdays,
    portfolio: futurePortfolio(db, today),
    gifts: { ...giftStats(db, period.range, today), promos: promoUsage(db, f, period.range) },
    programs: programStats(db, f, period.range),
  };
}

// ───────────── esportazione CSV ─────────────
const money = (c) => (c / 100).toFixed(2).replace('.', ',');
const cell = (v) => {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Testo libero (nomi inseriti da chiunque): un apice davanti impedisce che Excel o Sheets lo eseguano come formula. */
const text = (v) => (/^[=+\-@\t\r]/.test(String(v ?? '')) ? `'${v}` : v);

export const CSV_HEAD = ['Riferimento', 'Data servizio', 'Ora', 'Tour', 'Canale', 'Partner', 'Persone', 'Listino', 'Sconto', 'Buono regalo', 'Totale', 'Da pagare', 'Metodo di pagamento', 'Stato pagamento', 'Stato', 'Rimborso', 'Penale', 'Lingua', 'Data prenotazione'];

/**
 * Una riga per prenotazione del periodo (di qualsiasi stato, con gli stessi filtri della pagina), in CSV:
 * separatore «;», decimali con la virgola, BOM UTF-8 e a capo \r\n come il registro delle fatture.
 */
export function bookingsCsv(db, f, { nowMs = Date.now(), tourTitle = (slug) => slug } = {}) {
  const period = resolvePeriod(db, f, nowRome(nowMs).date);
  const s = scope(f, period.range, 'b.');
  const rows = db
    .prepare(
      `SELECT b.*, a.company AS company, ${veniceDateSql('b.created_at')} AS bookedOn
       FROM bookings b LEFT JOIN accounts a ON a.id = b.account_id
       WHERE ${s.sql} ORDER BY b.date, b.start_time, b.id`,
    )
    .all(...s.params);
  const lines = rows.map((b) =>
    [
      text(b.ref),
      b.date,
      b.start_time,
      text(tourTitle(b.tour_slug)),
      b.channel === 'b2b' ? 'Partner' : 'Privato',
      text(b.company ?? ''),
      b.participants,
      money(b.list_cents ?? b.total_cents + b.discount_cents),
      money(b.discount_cents),
      money(b.gift_cents ?? 0),
      money(b.total_cents),
      money(bookingDue(b)),
      PAY_IT[b.payment_method] ?? b.payment_method,
      PAYSTATUS_IT[b.payment_status] ?? b.payment_status,
      STATUS_IT[b.status] ?? b.status,
      money(b.refund_cents ?? 0),
      money(b.retained_cents ?? 0),
      LANG_META[b.lang]?.name ?? b.lang,
      b.bookedOn,
    ]
      .map(cell)
      .join(';'),
  );
  return String.fromCharCode(0xfeff) + [CSV_HEAD.join(';'), ...lines].join('\r\n') + '\r\n';
}
