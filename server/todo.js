// «Da fare»: tutto ciò che per la guida scade, aspetta una decisione o va controllato, in una pagina sola (e il suo conteggio per il menu).
// Ogni voce ha un tono: err e warn sono cose da fare (contano nel numero del menu), info è ciò che sta per succedere.
import { pendingExtensions } from './changes.js';
import { overdueInvoices } from './invoicePayments.js';
import { addDays, fmtDate, fmtInstant, nowRome } from './time.js';
import { waitingCount } from './waitlist.js';

const HOUR = 3_600_000;
const eur = (cents) => `${(cents / 100).toLocaleString('it-IT', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @typedef {{ tone: 'err'|'warn'|'info', text: string, meta?: string, href: string }} TodoItem
 * @returns {{ sections: {id: string, title: string, items: TodoItem[]}[], count: number }}
 */
export function todoList(app, nowMs = Date.now()) {
  const { db, content } = app;
  const today = nowRome(nowMs).date;
  const tomorrow = addDays(today, 1);
  const nowIso = new Date(nowMs).toISOString();
  const title = (slug) => content.tour(slug)?.i18n.it.title ?? slug;
  const sections = [];
  const section = (id, heading, items) => {
    if (items.length) sections.push({ id, title: heading, items });
  };

  // ── da decidere ──
  const decide = [];
  for (const r of pendingExtensions(db)) {
    const b = db.prepare('SELECT b.*, a.company FROM bookings b LEFT JOIN accounts a ON a.id = b.account_id WHERE b.id = ?').get(r.booking_id);
    if (!b) continue;
    decide.push({ tone: 'warn', text: `Proroga richiesta${r.group_id ? ' (pacchetto)' : ''}: ${b.company ?? b.name} · ${title(b.tour_slug)}, ${fmtDate(b.date, 'it', 'short')}`, meta: `chiede ${plural(r.days, 'giorno', 'giorni')}${b.option_expires_at ? `; l’opzione scade il ${fmtInstant(Date.parse(b.option_expires_at), 'it')}` : ''}`, href: `/admin/bookings/${b.id}` });
  }
  const partners = db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE status = 'pending'`).get().n;
  const badVat = db.prepare(`SELECT COUNT(*) AS n FROM accounts WHERE status = 'pending' AND vat_status IN ('invalid', 'format')`).get().n;
  if (partners) decide.push({ tone: 'warn', text: `${plural(partners, 'partner da approvare', 'partner da approvare')}`, meta: badVat ? `${badVat} con la partita IVA da controllare` : 'si sono registrati e aspettano il via libera', href: '/admin/partners?f=pending' });
  const programs = db.prepare(`SELECT COUNT(*) AS n FROM programs WHERE status = 'new'`).get().n;
  if (programs) decide.push({ tone: 'warn', text: `${plural(programs, 'richiesta di programma da preparare', 'richieste di programma da preparare')}`, href: '/admin/programs' });
  section('decide', 'Da decidere', decide);

  // ── soldi e fatture ──
  const money = [];
  const refunds = db.prepare(`SELECT id, ref, tour_slug, date, total_cents FROM bookings WHERE payment_status = 'refund_failed' ORDER BY date`).all();
  for (const b of refunds) money.push({ tone: 'err', text: `Rimborso non riuscito: ${b.ref} · ${title(b.tour_slug)}, ${fmtDate(b.date, 'it', 'short')}`, meta: 'il denaro non è tornato al cliente: riprova dalla scheda o rimborsa da Stripe', href: `/admin/bookings/${b.id}` });
  const pendingRefunds = db.prepare(`SELECT id, ref, tour_slug, date, refund_pending_cents FROM bookings WHERE refund_pending_cents > 0 ORDER BY date`).all();
  for (const b of pendingRefunds) money.push({ tone: 'err', text: `Rimborso da fare: ${eur(b.refund_pending_cents)} · ${b.ref} · ${title(b.tour_slug)}, ${fmtDate(b.date, 'it', 'short')}`, meta: 'dopo una modifica il prezzo è sceso ma il rimborso sulla carta non è partito: rimborsa da Stripe e segnalo dalla scheda', href: `/admin/bookings/${b.id}` });
  const late = overdueInvoices(db, today);
  if (late.length) money.push({ tone: 'err', text: `${plural(late.length, 'fattura scaduta e non incassata', 'fatture scadute e non incassate')}`, meta: `in tutto ${eur(late.reduce((s, x) => s + x.dueCents, 0))}; i solleciti partono da soli`, href: '/admin/invoices?tab=issued' });
  const queue = app.invoices.queue(nowMs);
  const overdueQueue = queue.filter((i) => i.overdue).length;
  if (overdueQueue) money.push({ tone: 'err', text: `${plural(overdueQueue, 'voce da fatturare oltre i 12 giorni', 'voci da fatturare oltre i 12 giorni')}`, href: '/admin/invoices' });
  const toSend = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status IN ('issued', 'undelivered') AND number IS NOT NULL`).get().n;
  if (toSend) money.push({ tone: 'warn', text: `${plural(toSend, 'fattura emessa da trasmettere a SdI', 'fatture emesse da trasmettere a SdI')}`, meta: 'entro 12 giorni dall’operazione; se l’hai già caricata, segnala che è inviata', href: '/admin/invoices?tab=issued' });
  const rejected = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'rejected'`).get().n;
  if (rejected) money.push({ tone: 'err', text: `${plural(rejected, 'fattura scartata da SdI', 'fatture scartate da SdI')}`, meta: 'correggi e riemetti con lo stesso numero', href: '/admin/invoices?tab=issued' });
  const unpaid = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents - gift_cents), 0) AS cents FROM bookings WHERE status = 'confirmed' AND payment_method = 'onsite' AND payment_status = 'unpaid' AND date < ?`).get(today);
  if (unpaid.n) money.push({ tone: 'warn', text: `${plural(unpaid.n, 'servizio svolto ancora da incassare', 'servizi svolti ancora da incassare')} (${eur(Number(unpaid.cents))})`, meta: 'pagamento sul posto: segnali come incassati quando i soldi sono arrivati', href: '/admin/bookings?f=past' });
  const rest = queue.length - overdueQueue;
  if (rest > 0) money.push({ tone: 'info', text: `${plural(rest, 'voce da fatturare', 'voci da fatturare')}`, meta: 'il giro settimanale delle fatture', href: '/admin/invoices' });
  const drafts = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'`).get().n;
  if (drafts) money.push({ tone: 'info', text: `${plural(drafts, 'bozza di fattura', 'bozze di fattura')} da controllare ed emettere`, href: '/admin/invoices?tab=drafts' });
  section('money', 'Soldi e fatture', money);

  // ── da controllare ──
  const check = [];
  for (const s of app.calendars.problems(nowMs)) check.push({ tone: 'warn', text: `Il calendario «${s.name}» non si aggiorna`, meta: 'finché non torna a funzionare le sue ore non bloccano il sito', href: '/admin/availability' });
  const backup = app.autoBackup.problem(nowMs);
  if (backup) check.push({ ...backup, href: '/admin/backup' });
  section('check', 'Da controllare', check);

  // ── in arrivo ──
  const soon = [];
  const services = (date) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(participants), 0) AS pax, COALESCE(SUM(CASE WHEN payment_method = 'onsite' AND payment_status = 'unpaid' THEN total_cents - gift_cents ELSE 0 END), 0) AS cash FROM bookings WHERE date = ? AND status = 'confirmed'`).get(date);
  for (const [label, date, href] of [['Oggi', today, `/admin/day?date=${today}`], ['Domani', tomorrow, '/admin/day']]) {
    const s = services(date);
    if (s.n) soon.push({ tone: 'info', text: `${label}: ${plural(s.n, 'servizio', 'servizi')}, ${plural(Number(s.pax), 'persona', 'persone')}`, meta: Number(s.cash) ? `da incassare sul posto: ${eur(Number(s.cash))}` : 'apri la scheda del giorno', href });
  }
  const options = db.prepare(`SELECT b.*, a.company FROM bookings b LEFT JOIN accounts a ON a.id = b.account_id WHERE b.status = 'option' AND b.option_expires_at > ? AND b.option_expires_at <= ? ORDER BY b.option_expires_at, b.id`).all(nowIso, new Date(nowMs + 48 * HOUR).toISOString());
  const seen = new Set();
  for (const b of options) {
    const key = b.group_id ? `g${b.group_id}` : `b${b.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lines = b.group_id ? options.filter((x) => x.group_id === b.group_id).length : 1;
    soon.push({ tone: 'info', text: `Opzione in scadenza: ${b.company ?? b.name} · ${lines > 1 ? `${lines} servizi` : `${title(b.tour_slug)}, ${fmtDate(b.date, 'it', 'short')}`}`, meta: `scade il ${fmtInstant(Date.parse(b.option_expires_at), 'it')}; se non conferma, la data si libera da sola`, href: `/admin/bookings/${b.id}` });
  }
  const waiting = waitingCount(db, today);
  if (waiting) soon.push({ tone: 'info', text: `${waiting === 1 ? '1 agenzia aspetta' : `${waiting} agenzie aspettano`} una data libera`, href: '/admin/waitlist' });
  section('soon', 'In arrivo', soon);

  const count = sections.reduce((n, s) => n + s.items.filter((i) => i.tone !== 'info').length, 0);
  return { sections, count, today };
}

/**
 * Il numero di cose da fare per il menu, calcolato al massimo ogni 10 secondi (compare in ogni pagina del pannello).
 * Ogni modifica dal pannello lo azzera (vedi routes/admin.js).
 */
export function todoBadge(app, nowMs = Date.now()) {
  const c = app.todoCache;
  if (c && nowMs - c.at < 10_000) return c.count;
  let count = 0;
  try {
    count = todoList(app, nowMs).count;
  } catch (err) {
    console.error('[da fare] conteggio non riuscito:', err.message); // il menu non deve rompere nessuna pagina
  }
  app.todoCache = { at: nowMs, count };
  return count;
}
