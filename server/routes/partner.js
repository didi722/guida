// Area riservata alle agenzie: dashboard con le prenotazioni, scheda di ogni pratica, voucher, fatture, tariffe e condizioni.
// Il login, la registrazione e l'uscita stanno in public.js; la prenotazione vera e propria (cerca, pagamento) è la stessa del sito,
// solo con la barra dell'area agenzie al posto di quella pubblica (vedi views/layout.js, area: 'partner').
import express from 'express';
import { parseCookies, setCookie } from '../auth.js';
import { getBookingByRef } from '../bookings.js';
import { notifyGuideBookingEdited } from '../emails.js';
import { send, sendPdf } from '../http.js';
import { bookingsCsv, invoiceOfBooking, isEditable, parseFilters, partnerBookings, partnerCalendar, partnerInvoice, partnerInvoices, partnerSummary } from '../partner.js';
import { renderInvoicePdf } from '../pdf-invoice.js';
import { renderVoucherPdf } from '../pdf.js';
import { cleanText } from '../util.js';
import { accountPage, bookingStatusText, invoicesPage, ratesPage } from '../views/b2b.js';
import { bookingPage } from '../views/booking.js';

export function partnerRouter(app) {
  const r = express.Router();
  const { db, cfg } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });

  // dati personali e fiscali: mai in cache del browser o di proxy
  r.use(['/b2b/account', '/b2b/rates', '/b2b/invoices', '/b2b/bookings', '/b2b/bookings.csv'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const toLogin = (req, res) => res.redirect(`/${req.lang}/b2b/login?next=${encodeURIComponent(req.originalUrl)}`);
  /** Serve un account approvato: chi non ha fatto il login va al modulo (e poi torna qui), chi è ancora in attesa alla pagina di stato. */
  const needPartner = (req, res, next) => {
    if (!req.acct) return toLogin(req, res);
    if (req.acct.status !== 'approved') return res.redirect(303, `/${req.lang}/b2b/account`);
    next();
  };
  /** La prenotazione indicata nell'URL, solo se è di questa agenzia. */
  const own = (req) => {
    const b = getBookingByRef(db, req.params.ref);
    return b && b.account_id === req.acct.id ? b : null;
  };

  // «Elenco» o «Calendario»: la scelta si ricorda (cookie); cercare, filtrare o cambiare scheda porta sempre all'elenco
  const VIEW_COOKIE = 'pv';
  const YEAR = 365 * 24 * 3600;
  r.get('/b2b/account', (req, res) => {
    if (!req.acct) return toLogin(req, res);
    const ctx = res.locals.ctx;
    if (req.acct.status !== 'approved') return send(res, accountPage(ctx, { acct: req.acct }));
    const nowMs = Date.now();
    const asked = ['cal', 'list'].includes(req.query.v) ? req.query.v : null;
    const listParams = ['q', 'from', 'to', 'bfrom', 'bto', 'view', 'page'].some((k) => req.query[k] !== undefined);
    const mode = asked ?? (listParams ? 'list' : parseCookies(req.headers.cookie)[VIEW_COOKIE] === 'cal' ? 'cal' : 'list');
    if (asked) setCookie(res, cfg, VIEW_COOKIE, asked, { maxAgeSec: YEAR });
    const filters = parseFilters(req.query);
    send(res, accountPage(ctx, {
      acct: req.acct, mode, filters, summary: partnerSummary(app, req.acct.id, nowMs), flash: String(req.query.flash ?? ''),
      list: mode === 'list' ? partnerBookings(app, req.acct.id, filters, { nowMs }) : null,
      calendar: mode === 'cal' ? partnerCalendar(app, req.acct.id, { month: req.query.m, selected: req.query.d }, nowMs) : null,
    }));
  });

  // elenco filtrato in un foglio di calcolo (per la contabilità dell'agenzia)
  r.get('/b2b/bookings.csv', needPartner, (req, res) => {
    const { t } = res.locals.ctx;
    const { rows } = partnerBookings(app, req.acct.id, parseFilters(req.query), { limit: null });
    const head = [t('s.ref'), t('f.clientRef'), t('partner.edit.name'), t('s.service'), t('s.date'), t('s.time'), t('s.guests'), t('b2b.state'), t('partner.col.booked'), t('s.total'), t('partner.col.invoice')];
    res
      .type('text/csv; charset=utf-8')
      .set({ 'Content-Disposition': 'attachment; filename="prenotazioni.csv"', 'Cache-Control': 'private, no-store' })
      .send(bookingsCsv(rows, { content: app.content, statusLabel: (b) => bookingStatusText(t, b), head }));
  });

  // scheda di una pratica: la stessa pagina del link nell'email, ma dentro l'area dell'agenzia (con fattura e modifica del nominativo)
  r.get('/b2b/bookings/:ref', needPartner, (req, res, next) => {
    const b = own(req);
    if (!b) return next();
    send(res, bookingPage(res.locals.ctx, b, { flash: String(req.query.flash ?? ''), nextUrl: `/${req.lang}/b2b/bookings/${b.ref}`, owner: true, invoice: invoiceOfBooking(db, b.id) }));
  });
  r.get('/b2b/bookings/:ref/voucher.pdf', needPartner, async (req, res, next) => {
    const b = own(req);
    if (!b || b.status !== 'confirmed') return next();
    sendPdf(res, await renderVoucherPdf(app, b, { lang: req.lang }), `voucher-${b.ref}.pdf`);
  });
  r.post('/b2b/bookings/:ref/edit', needPartner, form, async (req, res, next) => {
    const b = own(req);
    if (!b) return next();
    const back = (flash) => res.redirect(303, `/${req.lang}/b2b/bookings/${b.ref}?flash=${flash}#edit`);
    if (!isEditable(b)) return back('edit-locked'); // a servizio iniziato (o prenotazione chiusa) non si cambia più nulla
    const after = { name: cleanText(req.body.name, 120), clientRef: cleanText(req.body.clientRef, 120) || null, phone: cleanText(req.body.phone, 40) || null, notes: cleanText(req.body.notes, 1000) || null };
    if (!after.name) return back('edit-error');
    db.prepare('UPDATE bookings SET name = ?, client_ref = ?, phone = ?, notes = ? WHERE id = ?').run(after.name, after.clientRef, after.phone, after.notes, b.id);
    // alla guida interessa ciò che vede sul campo (nominativo, telefono, note); il riferimento pratica è interno all'agenzia
    const changed = after.name !== b.name || (after.phone ?? '') !== (b.phone ?? '') || (after.notes ?? '') !== (b.notes ?? '');
    if (changed && b.status === 'confirmed') await notifyGuideBookingEdited(app, b, after).catch((err) => console.error('[partner] avviso modifica:', err));
    back('edited');
  });

  r.get('/b2b/rates', needPartner, (req, res) => send(res, ratesPage(res.locals.ctx, { acct: req.acct })));

  r.get('/b2b/invoices', needPartner, (req, res) => send(res, invoicesPage(res.locals.ctx, { acct: req.acct, invoices: partnerInvoices(db, req.acct.id), due: partnerSummary(app, req.acct.id).due })));
  r.get('/b2b/invoices/:id/pdf', needPartner, async (req, res, next) => {
    const id = Number(req.params.id);
    const inv = Number.isInteger(id) ? partnerInvoice(db, req.acct.id, id) : null;
    if (!inv) return next();
    sendPdf(res, await renderInvoicePdf(app, inv), `${inv.doc_type === 'TD04' ? 'nota-di-credito' : 'fattura'}-${String(inv.number).replace('/', '-')}.pdf`);
  });

  return r;
}
