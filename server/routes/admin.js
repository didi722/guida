import crypto from 'node:crypto';
import express from 'express';
import { getBooking } from '../bookings.js';
import { calendar, eventLines } from '../ics.js';
import { getSetting, setSetting } from '../db.js';
import { addDays, isDate, isMonth, isTime, monthDates, nowRome, toMin } from '../time.js';
import { cleanText, safeEqual } from '../util.js';
import { loginAdmin, logoutAdmin, send, sendPdf, tooMany } from '../http.js';
import { renderVoucherPdf } from '../pdf.js';
import { adminDiscountsRouter } from './admin-discounts.js';
import { adminProgramsRouter } from './admin-programs.js';
import { adminMailRouter } from './admin-mail.js';
import { adminPartnersRouter } from './admin-partners.js';
import { adminStatsRouter } from './admin-stats.js';
import { adminMediaRouter } from './admin-media.js';
import { adminToursRouter } from './admin-tours.js';
import { adminRatesRouter } from './admin-rates.js';
import { adminBlogRouter } from './admin-blog.js';
import { adminTextsRouter } from './admin-texts.js';
import { adminSettingsRouter } from './admin-settings.js';
import { adminBackupRouter } from './admin-backup.js';
import { adminGuideRouter } from './admin-guide.js';
import { adminInvoicesRouter } from './admin-invoices.js';
import { dayConflicts } from '../programs.js';
import { feedbackStats, setFeatured } from '../reviews.js';
import { maskUrl } from '../calendars.js';
import { feedbackAdminPage } from '../views/admin-feedback.js';
import { invoiceForSource } from '../invoices.js';
import { adminLoginPage, availabilityPage, bookingDetailPage, bookingsPage, dashboardPage } from '../views/admin.js';

const ERR = {
  calurl: 'Inserisci un nome e un indirizzo iCal valido (https://… oppure webcal://…).',
  calsync: 'Non sono riuscito a leggere il calendario: controlla l’indirizzo (vedi il dettaglio sotto).',
};

const FLASH = {
  cancelled: 'Prenotazione annullata e cliente avvisato.',
  notes: 'Note salvate.',
  paid: 'Prenotazione segnata come incassata.',
  review: 'Richiesta di recensione aggiornata.',
  featured: 'Fatto: la modifica è già visibile sul sito.',
  reminder: 'Promemoria aggiornato.',
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
};

export function adminRouter(app) {
  const r = express.Router();
  const { cfg, db, services } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ctxOf = (req) => ({ app, req });
  const flash = (req) => FLASH[String(req.query.ok ?? '')] ?? '';
  const feedToken = crypto.createHmac('sha256', cfg.sessionSecret).update('ics-feed').digest('base64url').slice(0, 32);

  r.use((req, res, next) => {
    if (!cfg.admin.password) return res.status(404).type('text/plain').send('Pannello admin disattivato: manca la variabile ADMIN_PASSWORD (nel pannello dell\'hosting o nel file .env). Impostala e riavvia il sito.');
    next();
  });

  // Feed .ics in abbonamento: protetto da un token nell'URL (le app calendario non hanno cookie)
  r.get('/calendar.ics', (req, res) => {
    if (!safeEqual(String(req.query.k ?? ''), feedToken)) return res.status(404).end();
    const since = addDays(nowRome().date, -30);
    const rows = db.prepare(`SELECT * FROM bookings WHERE status = 'confirmed' AND date >= ? ORDER BY date, start_time`).all(since);
    const events = rows.map((b) => {
      const tour = app.content.tour(b.tour_slug);
      return eventLines({
        uid: `${b.ref}@${new URL(cfg.baseUrl).hostname}`,
        date: b.date,
        start: b.start_time,
        end: b.end_time,
        summary: `${tour?.i18n.it.title ?? b.tour_slug} · ${b.participants} pers. · ${b.name}`,
        description: [b.ref, b.channel === 'b2b' ? 'B2B' : 'Privato', b.client_ref, b.phone, b.email, b.notes, `Pagamento: ${b.payment_method} (${b.payment_status})`].filter(Boolean).join('\n'),
        location: tour?.i18n.it.meetingPoint,
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
    loginAdmin(res, cfg);
    res.redirect(303, '/admin');
  });
  r.post('/logout', form, (req, res) => {
    logoutAdmin(res, cfg);
    res.redirect(303, '/admin/login');
  });
  r.use((req, res, next) => (req.isAdmin ? next() : res.redirect('/admin/login')));
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.use(adminDiscountsRouter(app));
  r.use(adminProgramsRouter(app));
  r.use(adminInvoicesRouter(app));
  r.use(adminMailRouter(app));
  r.use(adminPartnersRouter(app));
  r.use(adminStatsRouter(app));
  r.use(adminMediaRouter(app));
  r.use(adminToursRouter(app));
  r.use(adminRatesRouter(app));
  r.use(adminBlogRouter(app));
  r.use(adminTextsRouter(app));
  r.use(adminSettingsRouter(app));
  r.use(adminBackupRouter(app));
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

  // ───── agenda ─────
  r.get('/', (req, res) => {
    const today = nowRome().date;
    const end = addDays(today, 13);
    const rows = db.prepare(`SELECT * FROM bookings WHERE date BETWEEN ? AND ? AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?)) ORDER BY date, start_time`).all(today, end, new Date().toISOString());
    // giornate dei programmi di più giorni (accettati o confermati), con l'avviso se si sovrappongono a qualcosa
    const programRows = db
      .prepare(`SELECT d.*, p.id AS pid, p.ref, p.name, p.status, p.participants, p.proposal_title FROM program_days d JOIN programs p ON p.id = d.program_id WHERE d.date BETWEEN ? AND ? AND p.status IN ('accepted', 'confirmed') ORDER BY d.date, d.start_time`)
      .all(today, end)
      .map((d) => ({ ...d, kind: 'program', conflicts: dayConflicts(app, d, { ignoreProgramId: d.pid }) }));
    const days = Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i);
      const items = [...rows.filter((b) => b.date === date).map((b) => ({ ...b, kind: 'booking' })), ...programRows.filter((x) => x.date === date)];
      return { date, items: items.sort((a, b) => toMin(a.start_time) - toMin(b.start_time)) };
    });
    const programs = db.prepare(`SELECT COALESCE(SUM(status = 'new'), 0) AS todo, COALESCE(SUM(status IN ('quoted', 'accepted')), 0) AS waiting FROM programs`).get();
    const pendingPartners = db.prepare(`SELECT COUNT(*) n FROM accounts WHERE status = 'pending'`).get().n;
    const held = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status = 'held' AND hold_expires_at > ?`).get(new Date().toISOString()).n;
    const invoicesDue = app.invoices.queue().filter((i) => i.overdue).length;
    send(res, dashboardPage(ctxOf(req), { problems: app.calendars.problems(), invoicesDue, today, days, pendingPartners, held, programs, feedUrl: `${cfg.baseUrl}/admin/calendar.ics?k=${feedToken}`, flash: flash(req) }));
  });

  // ───── prenotazioni ─────
  r.get('/bookings', (req, res) => {
    const filter = ['upcoming', 'past', 'cancelled', 'all'].includes(req.query.f) ? req.query.f : 'upcoming';
    const q = cleanText(req.query.q, 80);
    const today = nowRome().date;
    const where = { upcoming: `date >= '${today}' AND status IN ('confirmed','held')`, past: `date < '${today}' AND status IN ('confirmed','held')`, cancelled: `status IN ('cancelled','expired')`, all: '1=1' }[filter];
    const like = `%${q}%`;
    const items = db
      .prepare(`SELECT * FROM bookings WHERE ${where} ${q ? 'AND (name LIKE ? OR email LIKE ? OR ref LIKE ? OR client_ref LIKE ?)' : ''} ORDER BY date ${filter === 'past' || filter === 'all' ? 'DESC' : 'ASC'}, start_time LIMIT 300`)
      .all(...(q ? [like, like, like, like] : []));
    send(res, bookingsPage(ctxOf(req), { items, filter, q }));
  });

  r.get('/bookings/:id', (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const account = b.account_id ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id) : null;
    send(res, bookingDetailPage(ctxOf(req), b, account, flash(req), invoiceForSource(db, 'booking', b.id)));
  });
  r.get('/bookings/:id/voucher.pdf', async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    sendPdf(res, await renderVoucherPdf(app, b, { lang: b.lang }), `voucher-${b.ref}.pdf`);
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
  r.post('/bookings/:id/paid', form, (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    db.prepare(`UPDATE bookings SET payment_status = 'paid' WHERE id = ? AND status = 'confirmed' AND payment_status = 'unpaid'`).run(b.id);
    res.redirect(303, `/admin/bookings/${b.id}?ok=paid`);
  });
  r.post('/bookings/:id/cancel', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const refund = ['auto', 'full', 'none'].includes(req.body.refund) ? req.body.refund : 'auto';
    await services.cancel(b.id, { by: 'admin', reason: req.body.reason, refund });
    res.redirect(303, `/admin/bookings/${b.id}?ok=cancelled`);
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
