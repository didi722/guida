import crypto from 'node:crypto';
import express from 'express';
import { BookingError, getBooking } from '../bookings.js';
import { meetingOf } from '../choices.js';
import { LIVE_BOOKING_SQL } from '../availability.js';
import { paymentsFrom, isPreOpening } from '../opening.js';
import { calendar, eventLines } from '../ics.js';
import { getSetting, setSetting } from '../db.js';
import { addDays, dayOfWeek, isDate, isMonth, isTime, monthDates, nowRome, toMin } from '../time.js';
import { cleanText, safeEqual } from '../util.js';
import { loginAdmin, logoutAdmin, send, sendPdf, startSecondStep, tooMany } from '../http.js';
import { parseCookies, setCookie } from '../auth.js';
import { renderVoucherPdf } from '../pdf.js';
import { adminAgencyBookingRouter } from './admin-agency-booking.js';
import { adminDiscountsRouter } from './admin-discounts.js';
import { adminProgramsRouter } from './admin-programs.js';
import { adminMailRouter } from './admin-mail.js';
import { adminBankRouter } from './admin-bank.js';
import { adminBookingEditRouter } from './admin-booking-edit.js';
import { adminInvitesRouter } from './admin-invites.js';
import { adminPartnersRouter } from './admin-partners.js';
import { adminStatementRouter } from './admin-statement.js';
import { adminStatsRouter } from './admin-stats.js';
import { adminMediaRouter } from './admin-media.js';
import { adminToursRouter } from './admin-tours.js';
import { adminRatesRouter } from './admin-rates.js';
import { adminBlogRouter } from './admin-blog.js';
import { adminTextsRouter } from './admin-texts.js';
import { adminSettingsRouter } from './admin-settings.js';
import { adminBackupRouter } from './admin-backup.js';
import { adminPeriodsRouter } from './admin-periods.js';
import { adminSecondStepRouter, adminSecurityRouter } from './admin-security.js';
import { adminGuideRouter } from './admin-guide.js';
import { adminInvoicesRouter } from './admin-invoices.js';
import { adminTodayRouter } from './admin-today.js';
import { adminWaitlistRouter } from './admin-waitlist.js';
import { waitingCount } from '../waitlist.js';
import { dayConflicts } from '../programs.js';
import { feedbackStats, setFeatured } from '../reviews.js';
import { maskUrl } from '../calendars.js';
import { feedbackAdminPage } from '../views/admin-feedback.js';
import { invoiceForSource } from '../invoices.js';
import { getPackage, packageBookings } from '../packages.js';
import { changeHistory, pendingExtension, pendingExtensions } from '../changes.js';
import { overdueInvoices } from '../invoicePayments.js';
import { LANGS } from '../langs.js';
import { adminLoginPage, availabilityPage, bookingDetailPage, bookingsPage, dashboardPage } from '../views/admin.js';

const ERR = {
  calurl: 'Inserisci un nome e un indirizzo iCal valido (https://… oppure webcal://…).',
  calsync: 'Non sono riuscito a leggere il calendario: controlla l’indirizzo (vedi il dettaglio sotto).',
};

const FLASH = {
  cancelled: 'Prenotazione annullata e cliente avvisato.',
  notes: 'Note salvate.',
  paid: 'Prenotazione segnata come incassata.',
  refunded: 'Rimborso segnato come fatto.',
  review: 'Richiesta di recensione aggiornata.',
  featured: 'Fatto: la modifica è già visibile sul sito.',
  reminder: 'Promemoria aggiornato.',
  extended: 'Opzione prorogata: l’agenzia è stata avvisata.',
  'extension-denied': 'Proroga non concessa: l’agenzia è stata avvisata.',
  'extension-failed': 'Non è stato possibile prolungare: l’opzione è già chiusa o scaduta.',
  released: 'Data rilasciata: l’agenzia è stata avvisata.',
  calendar: 'Calendario collegato e sincronizzato.',
  calsynced: 'Calendario sincronizzato.',
  caltoggled: 'Calendario aggiornato.',
  caldeleted: 'Calendario scollegato.',
  weekly: 'Orari di lavoro salvati.',
  closed: 'Giorno chiuso.',
  opened: 'Giorno riaperto.',
  custom: 'Orario speciale impostato.',
  block: 'Blocco aggiunto.',
  unblock: 'Blocco eliminato.',
  private: 'Impegno aggiunto in agenda: quelle ore non sono più prenotabili dal sito.',
  privateOver: 'Impegno aggiunto in agenda, ma attenzione: si sovrappone a prenotazioni già presenti (le trovi qui sotto, nei giorni indicati).',
  privateDeleted: 'Impegno tolto dall’agenda: quelle ore tornano prenotabili.',
  privateBad: 'Impegno non aggiunto: controlla titolo, date e orari.',
};

export function adminRouter(app) {
  const r = express.Router();
  const { cfg, db, services } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ctxOf = (req) => ({ app, req });
  const flash = (req) => {
    if (req.query.ok === 'edited') {
      // modifica dal pannello: dice anche come è andata l'email e l'eventuale rimborso della differenza
      return ['Prenotazione modificata.', { sent: 'Ho avvisato il cliente.', failed: 'Attenzione: l’email non è partita.' }[String(req.query.mail ?? '')], { done: 'La differenza è stata rimborsata sulla carta.', pending: 'Attenzione: il rimborso sulla carta non è partito: resta da fare a mano (lo trovi in «Da fare»).' }[String(req.query.refund ?? '')]].filter(Boolean).join(' ');
    }
    return FLASH[String(req.query.ok ?? '')] ?? '';
  };
  const feedToken = crypto.createHmac('sha256', cfg.sessionSecret).update('ics-feed').digest('base64url').slice(0, 32);

  r.use((req, res, next) => {
    if (!cfg.admin.password) return res.status(404).type('text/plain').send('Pannello admin disattivato: manca la variabile ADMIN_PASSWORD (nel pannello dell\'hosting o nel file .env). Impostala e riavvia il sito.');
    next();
  });

  // Feed .ics in abbonamento: protetto da un token nell'URL (le app calendario non hanno cookie)
  r.get('/calendar.ics', (req, res) => {
    if (!safeEqual(String(req.query.k ?? ''), feedToken)) return res.status(404).end();
    const since = addDays(nowRome().date, -30);
    const nowIso = new Date().toISOString();
    const rows = db.prepare(`SELECT * FROM bookings WHERE (status = 'confirmed' OR (status = 'option' AND option_expires_at > ?)) AND date >= ? ORDER BY date, start_time`).all(nowIso, since);
    const events = rows.map((b) => {
      const tour = app.content.tour(b.tour_slug);
      return eventLines({
        uid: `${b.ref}@${new URL(cfg.baseUrl).hostname}`,
        date: b.date,
        start: b.start_time,
        end: b.end_time,
        summary: `${b.status === 'option' ? 'OPZIONE · ' : ''}${tour?.i18n.it.title ?? b.tour_slug} · ${b.participants} pers. · ${b.name}`,
        description: [b.ref, b.channel === 'b2b' ? 'B2B' : 'Privato', b.client_ref, b.phone, b.email, b.notes, `Pagamento: ${b.payment_method} (${b.payment_status})`].filter(Boolean).join('\n'),
        location: meetingOf(tour, b, 'it').text,
        url: `${cfg.baseUrl}/admin/bookings/${b.id}`,
      });
    });
    res.type('text/calendar; charset=utf-8').set('Cache-Control', 'no-cache').send(calendar(`${cfg.site.name} — prenotazioni`, events));
  });

  // ───── accesso ─────
  r.get('/login', (req, res) => (req.isAdmin ? res.redirect('/admin') : send(res, adminLoginPage(ctxOf(req)))));
  r.post('/login', form, (req, res) => {
    if (!app.limits.login(`admin|${req.ip}`)) return tooMany(res);
    // gli spazi attorno si ignorano: la tastiera del telefono ne aggiunge uno dopo l'autocompletamento
    if (!safeEqual(String(req.body.password ?? '').trim(), cfg.admin.password)) return send(res, adminLoginPage(ctxOf(req), { error: 'Password errata.' }), 401);
    // con i due passaggi attivi la password da sola non basta: si passa al codice (la sessione nasce solo dopo)
    if (app.adminSecurity.enabled()) {
      startSecondStep(res, app);
      return res.redirect(303, '/admin/login/2fa');
    }
    loginAdmin(res, cfg, app.adminSecurity.sessionTag());
    res.redirect(303, '/admin');
  });
  r.use(adminSecondStepRouter(app));
  // «Esci» riporta al sito pubblico (la home nella lingua del browser), non alla pagina di accesso
  r.post('/logout', form, (req, res) => {
    logoutAdmin(res, cfg);
    res.redirect(303, '/');
  });
  r.use((req, res, next) => (req.isAdmin ? next() : res.redirect('/admin/login')));
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET') res.on('finish', () => { app.todoCache = null; }); // una modifica cambia ciò che c'è da fare: il numero nel menu si ricalcola
    next();
  });

  r.use(adminDiscountsRouter(app));
  r.use(adminAgencyBookingRouter(app));
  r.use(adminBookingEditRouter(app));
  r.use(adminProgramsRouter(app));
  r.use(adminBankRouter(app));
  r.use(adminInvoicesRouter(app));
  r.use(adminWaitlistRouter(app));
  r.use(adminTodayRouter(app));
  r.use(adminMailRouter(app));
  r.use(adminInvitesRouter(app));
  r.use(adminPartnersRouter(app));
  r.use(adminStatementRouter(app));
  r.use(adminStatsRouter(app));
  r.use(adminMediaRouter(app));
  r.use(adminToursRouter(app));
  r.use(adminRatesRouter(app));
  r.use(adminBlogRouter(app));
  r.use(adminTextsRouter(app));
  r.use(adminSettingsRouter(app));
  r.use(adminBackupRouter(app));
  r.use(adminSecurityRouter(app));
  r.use(adminPeriodsRouter(app));
  r.use(adminGuideRouter(app));

  r.get('/feedback', (req, res) => {
    const items = db.prepare(`SELECT f.*, b.name, b.email, b.tour_slug, b.date FROM feedback f JOIN bookings b ON b.id = f.booking_id ORDER BY f.created_at DESC LIMIT 200`).all();
    const requested = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE review_status = 'sent'`).get().n;
    send(res, feedbackAdminPage(ctxOf(req), { items, stats: { ...feedbackStats(db), requested }, flash: flash(req) }));
  });

  r.post('/feedback/:id/featured', form, (req, res, next) => {
    if (!db.prepare('SELECT 1 FROM feedback WHERE id = ?').get(Number(req.params.id))) return next();
    setFeatured(db, Number(req.params.id), req.body.on === '1');
    res.redirect(303, '/admin/feedback?ok=featured');
  });

  // ───── agenda: prima come calendario (si può tornare all'elenco dei prossimi 14 giorni; la scelta si ricorda) ─────
  const AGENDA_COOKIE = 'av';
  const YEAR = 365 * 24 * 3600;
  /** Prenotazioni e giornate dei programmi tra due date, per l'agenda (elenco e calendario). */
  const agendaItems = (from, to) => {
    const nowIso = new Date().toISOString();
    const rows = db.prepare(`SELECT * FROM bookings WHERE date BETWEEN ? AND ? AND ${LIVE_BOOKING_SQL} ORDER BY date, start_time`).all(from, to, nowIso, nowIso);
    // giornate dei programmi di più giorni (accettati o confermati), con l'avviso se si sovrappongono a qualcosa
    const programRows = db
      .prepare(`SELECT d.*, p.id AS pid, p.ref, p.name, p.status, p.participants, p.proposal_title FROM program_days d JOIN programs p ON p.id = d.program_id WHERE d.date BETWEEN ? AND ? AND p.status IN ('accepted', 'confirmed') ORDER BY d.date, d.start_time`)
      .all(from, to)
      .map((d) => ({ ...d, kind: 'program', conflicts: dayConflicts(app, d, { ignoreProgramId: d.pid }) }));
    // impegni fuori dal sito (tour privati presi per email o di persona, altre agenzie): tolgono le ore dalle disponibilità
    const blockRows = db.prepare('SELECT * FROM blocks WHERE date BETWEEN ? AND ? ORDER BY date, start_time').all(from, to).map((x) => ({ ...x, blockKind: x.kind, kind: 'block' }));
    const itemsOn = (date) => [...rows.filter((b) => b.date === date).map((b) => ({ ...b, kind: 'booking' })), ...programRows.filter((x) => x.date === date), ...blockRows.filter((x) => x.date === date)].sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
    return { itemsOn };
  };

  r.get('/', (req, res) => {
    const today = nowRome().date;
    const asked = ['cal', 'list'].includes(req.query.v) ? req.query.v : null;
    const view = asked ?? (parseCookies(req.headers.cookie)[AGENDA_COOKIE] === 'list' ? 'list' : 'cal'); // senza scelta: calendario
    if (asked) setCookie(res, cfg, AGENDA_COOKIE, asked, { maxAgeSec: YEAR });

    let days = [];
    let calendar = null;
    if (view === 'list') {
      const end = addDays(today, 13);
      const { itemsOn } = agendaItems(today, end);
      days = Array.from({ length: 14 }, (_, i) => ({ date: addDays(today, i), items: itemsOn(addDays(today, i)) }));
    } else {
      const month = isMonth(String(req.query.m ?? '')) ? String(req.query.m) : today.slice(0, 7);
      const dates = monthDates(month);
      const offset = (dayOfWeek(dates[0]) + 6) % 7; // lunedì = 0
      const gridStart = addDays(dates[0], -offset);
      const total = Math.ceil((offset + dates.length) / 7) * 7;
      const gridEnd = addDays(gridStart, total - 1);
      const { itemsOn } = agendaItems(gridStart, gridEnd);
      const closed = new Set(db.prepare('SELECT date FROM day_overrides WHERE closed = 1 AND date BETWEEN ? AND ?').all(gridStart, gridEnd).map((x) => x.date));
      const cells = Array.from({ length: total }, (_, i) => {
        const date = addDays(gridStart, i);
        return { date, inMonth: date.slice(0, 7) === month, items: itemsOn(date), closed: closed.has(date) };
      });
      const wanted = isDate(String(req.query.d ?? '')) ? String(req.query.d) : null;
      const selected = wanted && cells.some((c) => c.date === wanted) ? wanted : cells.some((c) => c.date === today) ? today : dates[0];
      const [y, m] = month.split('-').map(Number);
      const shift = (n) => `${new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)}`;
      calendar = { month, prev: shift(-1), next: shift(1), cells, selected, selectedItems: cells.find((c) => c.date === selected).items, todayCount: agendaItems(today, today).itemsOn(today).filter((x) => x.kind !== 'block').length };
    }
    const programs = db.prepare(`SELECT COALESCE(SUM(status = 'new'), 0) AS todo, COALESCE(SUM(status IN ('quoted', 'accepted')), 0) AS waiting FROM programs`).get();
    const pendingPartners = db.prepare(`SELECT COUNT(*) n FROM accounts WHERE status = 'pending'`).get().n;
    const nowIso = new Date().toISOString();
    const held = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status = 'held' AND hold_expires_at > ?`).get(nowIso).n;
    const options = db.prepare(`SELECT COUNT(DISTINCT COALESCE('g' || group_id, 'b' || id)) n, MIN(option_expires_at) next FROM bookings WHERE status = 'option' AND option_expires_at > ?`).get(nowIso); // un pacchetto è una sola opzione
    const invoicesDue = app.invoices.queue().filter((i) => i.overdue).length;
    send(res, dashboardPage(ctxOf(req), { problems: app.calendars.problems(), invoicesDue, invoicesOverdue: overdueInvoices(db).length, waiting: waitingCount(db, today), today, view, days, calendar, pendingPartners, held, options: { ...options, requests: pendingExtensions(db).length }, programs, preOpening: isPreOpening(cfg) ? paymentsFrom(cfg) : null, feedUrl: `${cfg.baseUrl}/admin/calendar.ics?k=${feedToken}`, flash: flash(req) }));
  });

  // ───── impegni privati in agenda: un tour preso fuori dal sito (email, di persona…) toglie quelle ore dalle disponibilità ─────
  r.post('/agenda/private', form, (req, res) => {
    const b = req.body;
    const title = cleanText(b.title, 120);
    const from = String(b.from ?? '');
    const to = b.to ? String(b.to) : from;
    const allDay = b.allDay === '1';
    const start = allDay ? '00:00' : String(b.start ?? '');
    const end = allDay ? '23:59' : String(b.end ?? '');
    const days = isDate(from) && isDate(to) && to >= from ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : 0;
    if (!title || !days || days > 60 || !isTime(start) || !isTime(end) || toMin(start) >= toMin(end)) return res.redirect(303, `/admin?v=cal${isDate(from) ? `&m=${from.slice(0, 7)}&d=${from}` : ''}&ok=privateBad#privato`);
    const details = cleanText(b.details, 600) || null;
    const series = days > 1 ? crypto.randomBytes(6).toString('hex') : null;
    const now = new Date().toISOString();
    const nowIso = now;
    let over = 0;
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      db.prepare("INSERT INTO blocks(date, start_time, end_time, note, title, details, kind, series, created_at) VALUES(?,?,?,?,?,?,'private',?,?)").run(date, start, end, title, title, details, series, now);
      over += db.prepare(`SELECT COUNT(*) n FROM bookings WHERE date = ? AND ${LIVE_BOOKING_SQL} AND start_time < ? AND end_time > ?`).get(date, nowIso, nowIso, end, start).n;
    }
    res.redirect(303, `/admin?v=cal&m=${from.slice(0, 7)}&d=${from}&ok=${over ? 'privateOver' : 'private'}#giorno`);
  });
  r.post('/agenda/block/:id/delete', form, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
    if (row) {
      if (req.body.all === '1' && row.series) db.prepare('DELETE FROM blocks WHERE series = ?').run(row.series);
      else db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
    }
    const d = isDate(String(req.body.d ?? '')) ? String(req.body.d) : row?.date;
    res.redirect(303, `/admin?v=cal${d ? `&m=${d.slice(0, 7)}&d=${d}` : ''}&ok=privateDeleted#giorno`);
  });

  // ───── prenotazioni ─────
  r.get('/bookings', (req, res) => {
    const filter = ['upcoming', 'options', 'past', 'cancelled', 'all'].includes(req.query.f) ? req.query.f : 'upcoming';
    const q = cleanText(req.query.q, 80);
    const today = nowRome().date;
    const where = { upcoming: `date >= '${today}' AND status IN ('confirmed','held','option')`, options: `status = 'option'`, past: `date < '${today}' AND status IN ('confirmed','held','option')`, cancelled: `status IN ('cancelled','expired')`, all: '1=1' }[filter];
    const like = `%${q}%`;
    const items = db
      .prepare(`SELECT * FROM bookings WHERE ${where} ${q ? 'AND (name LIKE ? OR email LIKE ? OR ref LIKE ? OR client_ref LIKE ?)' : ''} ORDER BY date ${filter === 'past' || filter === 'all' ? 'DESC' : 'ASC'}, start_time LIMIT 300`)
      .all(...(q ? [like, like, like, like] : []));
    const groupIds = [...new Set(items.map((b) => b.group_id).filter(Boolean))];
    const refs = new Map(groupIds.length ? db.prepare(`SELECT id, ref FROM booking_groups WHERE id IN (${groupIds.map(() => '?').join(',')})`).all(...groupIds).map((g) => [g.id, g.ref]) : []);
    send(res, bookingsPage(ctxOf(req), { items: items.map((b) => ({ ...b, group_ref: refs.get(b.group_id) ?? null })), filter, q }));
  });

  r.get('/bookings/:id', (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const account = b.account_id ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id) : null;
    const group = b.group_id ? getPackage(db, b.group_id) : null;
    send(res, bookingDetailPage(ctxOf(req), b, account, flash(req), invoiceForSource(db, 'booking', b.id), group ? { group, bookings: packageBookings(db, group.id) } : null, b.status === 'option' ? pendingExtension(db, b) : null, changeHistory(db, b.id)));
  });
  r.get('/bookings/:id/voucher.pdf', async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const vl = LANGS.includes(String(req.query.vl)) ? String(req.query.vl) : b.lang;
    sendPdf(res, await renderVoucherPdf(app, b, { lang: vl }), `voucher-${b.ref}${req.query.vl ? `-${vl}` : ''}.pdf`);
  });
  r.post('/bookings/:id/notes', form, (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    db.prepare('UPDATE bookings SET admin_notes = ? WHERE id = ?').run(cleanText(req.body.admin_notes, 2000) || null, b.id);
    res.redirect(303, `/admin/bookings/${b.id}?ok=notes`);
  });
  r.post('/bookings/:id/review', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    if (req.body.action === 'skip') app.reviews.skip(b.id);
    else if (b.status === 'confirmed' && b.channel === 'b2c' && !b.review_status) await app.reviews.send(b);
    res.redirect(303, `/admin/bookings/${b.id}?ok=review`);
  });
  r.post('/bookings/:id/reminder', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    if (req.body.action === 'skip') app.reminders.skip(b.id);
    else if (b.status === 'confirmed' && b.channel === 'b2c' && !b.reminder_status) await app.reminders.send(b);
    res.redirect(303, `/admin/bookings/${b.id}?ok=reminder`);
  });
  // la differenza di prezzo era da rimborsare a mano (il rimborso sulla carta non è partito): fatto
  r.post('/bookings/:id/refund-done', form, (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    db.prepare('UPDATE bookings SET refund_cents = refund_cents + refund_pending_cents, refund_pending_cents = 0 WHERE id = ? AND refund_pending_cents > 0').run(b.id);
    res.redirect(303, `/admin/bookings/${b.id}?ok=refunded`);
  });
  r.post('/bookings/:id/paid', form, (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    // «tutto il pacchetto»: il bonifico di un pacchetto copre tutti i suoi servizi
    if (req.body.all && b.group_id) db.prepare(`UPDATE bookings SET payment_status = 'paid' WHERE group_id = ? AND status = 'confirmed' AND payment_status = 'unpaid'`).run(b.group_id);
    else db.prepare(`UPDATE bookings SET payment_status = 'paid' WHERE id = ? AND status = 'confirmed' AND payment_status = 'unpaid'`).run(b.id);
    res.redirect(303, `/admin/bookings/${b.id}?ok=paid`);
  });
  // richiesta di proroga dell'agenzia: la guida concede (i giorni li sceglie lei) o rifiuta
  r.post('/bookings/:id/extension/:rid/approve', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const days = Number.parseInt(req.body.days, 10);
    let done = false;
    try {
      done = await app.changes.approveExtension(Number(req.params.rid), Number.isInteger(days) && days > 0 ? days : undefined);
    } catch (e) {
      if (!(e instanceof BookingError)) throw e; // giorni non validi: nulla cambia
    }
    res.redirect(303, `/admin/bookings/${b.id}?ok=${done ? 'extended' : 'extension-failed'}`);
  });
  r.post('/bookings/:id/extension/:rid/deny', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const done = await app.changes.denyExtension(Number(req.params.rid));
    res.redirect(303, `/admin/bookings/${b.id}?ok=${done ? 'extension-denied' : 'extension-failed'}`);
  });
  r.post('/bookings/:id/cancel', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const refund = ['auto', 'full', 'none'].includes(req.body.refund) ? req.body.refund : 'auto';
    await services.cancel(b.id, { by: 'admin', reason: req.body.reason, refund });
    res.redirect(303, `/admin/bookings/${b.id}?ok=${b.status === 'option' ? 'released' : 'cancelled'}`);
  });
  r.post('/bookings/:id/option/extend', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    let done = null;
    try {
      done = await services.extendOption(b.id, Number(req.body.days));
    } catch (e) {
      if (!(e instanceof BookingError)) throw e; // numero di giorni non valido: nulla cambia
    }
    res.redirect(303, `/admin/bookings/${b.id}${done ? '?ok=extended' : ''}`);
  });

  // ───── disponibilità ─────
  const monthOf = (v) => (isMonth(String(v ?? '')) ? String(v) : nowRome().date.slice(0, 7));
  const back = (m, ok) => `/admin/availability?m=${monthOf(m)}&ok=${ok}`;

  r.get('/availability', (req, res) => {
    const today = nowRome().date;
    const month = monthOf(req.query.m);
    const weekly = getSetting(db, 'weekly', cfg.defaultWeekly);
    const dates = monthDates(month);
    const counts = new Map(db.prepare(`SELECT date, COUNT(*) n FROM bookings WHERE date BETWEEN ? AND ? AND status = 'confirmed' GROUP BY date`).all(dates[0], dates.at(-1)).map((x) => [x.date, x.n]));
    send(res, availabilityPage(ctxOf(req), {
      weekly,
      month,
      today,
      overrides: db.prepare('SELECT * FROM day_overrides WHERE date >= ? ORDER BY date LIMIT 60').all(today),
      blocks: db.prepare('SELECT * FROM blocks WHERE date >= ? ORDER BY date, start_time LIMIT 100').all(today),
      bookingsByDate: counts,
      calendars: app.calendars.list().map((c) => ({ ...c, masked: maskUrl(c.url) })),
      external: app.calendars.busyBetween(dates[0], dates.at(-1)),
      problems: app.calendars.problems(),
      flash: flash(req),
      error: ERR[String(req.query.err ?? '')] ?? '',
    }));
  });

  // ───── calendari esterni (Google Calendar, ecc.) ─────
  r.post('/availability/calendars', form, async (req, res) => {
    const month = monthOf(req.body.m);
    const source = app.calendars.add({ name: req.body.name, url: req.body.url });
    if (!source) return res.redirect(303, `/admin/availability?m=${month}&err=calurl`);
    const result = await app.calendars.syncSource(source);
    res.redirect(303, `/admin/availability?m=${month}&${result.ok ? 'ok=calendar' : 'err=calsync'}`);
  });
  r.post('/availability/calendars/:id/sync', form, async (req, res, next) => {
    const source = app.calendars.get(Number(req.params.id));
    if (!source) return next();
    const result = await app.calendars.syncSource(source);
    res.redirect(303, `/admin/availability?m=${monthOf(req.body.m)}&${result.ok ? 'ok=calsynced' : 'err=calsync'}`);
  });
  r.post('/availability/calendars/:id/toggle', form, (req, res) => {
    const source = app.calendars.get(Number(req.params.id));
    if (source) app.calendars.setEnabled(source.id, !source.enabled);
    res.redirect(303, back(req.body.m, 'caltoggled'));
  });
  r.post('/availability/calendars/:id/delete', form, (req, res) => {
    app.calendars.remove(Number(req.params.id));
    res.redirect(303, back(req.body.m, 'caldeleted'));
  });

  r.post('/availability/weekly', form, (req, res) => {
    const weekly = {};
    for (let d = 0; d < 7; d++) {
      const from = String(req.body[`from_${d}`] ?? '');
      const to = String(req.body[`to_${d}`] ?? '');
      weekly[d] = { open: !!req.body[`open_${d}`], from: isTime(from) ? from : '08:30', to: isTime(to) ? to : '19:30' };
      if (toMin(weekly[d].from) >= toMin(weekly[d].to)) weekly[d] = { open: false, from: '08:30', to: '19:30' };
    }
    setSetting(db, 'weekly', weekly);
    res.redirect(303, back(req.body.m, 'weekly'));
  });

  r.post('/availability/day', form, (req, res) => {
    const date = String(req.body.date ?? '');
    if (!isDate(date)) return res.status(400).end();
    if (req.body.action === 'open') db.prepare('DELETE FROM day_overrides WHERE date = ?').run(date);
    else db.prepare(`INSERT INTO day_overrides(date, closed) VALUES(?, 1) ON CONFLICT(date) DO UPDATE SET closed = 1, from_time = NULL, to_time = NULL`).run(date);
    res.redirect(303, back(req.body.m ?? date.slice(0, 7), req.body.action === 'open' ? 'opened' : 'closed'));
  });

  r.post('/availability/custom', form, (req, res) => {
    const { date, from, to } = req.body;
    if (!isDate(String(date)) || !isTime(String(from)) || !isTime(String(to)) || toMin(from) >= toMin(to)) return res.status(400).type('text/plain').send('Dati non validi');
    db.prepare(`INSERT INTO day_overrides(date, closed, from_time, to_time) VALUES(?, 0, ?, ?) ON CONFLICT(date) DO UPDATE SET closed = 0, from_time = excluded.from_time, to_time = excluded.to_time`).run(date, from, to);
    res.redirect(303, back(date.slice(0, 7), 'custom'));
  });

  r.post('/availability/block', form, (req, res) => {
    const { date, from, to } = req.body;
    if (!isDate(String(date)) || !isTime(String(from)) || !isTime(String(to)) || toMin(from) >= toMin(to)) return res.status(400).type('text/plain').send('Dati non validi');
    db.prepare('INSERT INTO blocks(date, start_time, end_time, note, created_at) VALUES(?,?,?,?,?)').run(date, from, to, cleanText(req.body.note, 120) || null, new Date().toISOString());
    res.redirect(303, back(req.body.m ?? date.slice(0, 7), 'block'));
  });
  r.post('/availability/block/:id/delete', form, (req, res) => {
    db.prepare('DELETE FROM blocks WHERE id = ?').run(Number(req.params.id));
    res.redirect(303, back(req.body.m, 'unblock'));
  });

  return r;
}
