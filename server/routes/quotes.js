// Preventivi online delle agenzie. Area agenzie: si prepara dal pacchetto, si manda al cliente per email, si scarica in PDF, si rimettono i servizi
// nel pacchetto per prenotarli. Pagina del cliente (dal collegamento dell'email, senza accesso): legge il preventivo e lo accetta o lo rifiuta.
import express from 'express';
import { notifyAgencyQuote, notifyGuideQuote, sendQuoteToClient } from '../emails.js';
import { getLogo, MARKUP_MAX } from '../agencyDocs.js';
import { send, sendPdf, tooMany } from '../http.js';
import { cartSummary } from '../packages.js';
import { renderSavedQuotePdf } from '../pdf-quote.js';
import { QUOTE_MAX_SENDS, QuoteError, createQuote, decide, deleteQuote, getQuote, liveCheck, listQuotes, loadIntoCart, markViewed, ownQuote, quoteByToken, recordSent, statusOf } from '../quotes.js';
import { teamSize } from '../team.js';
import { fmtDate } from '../time.js';
import { cleanText, isEmail } from '../util.js';
import { newQuotePage, publicQuotePage, quoteDetailPage, quotesPage } from '../views/quotes.js';
import { needPartner } from './guards.js';

export function quotesRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const ip = (req) => req.ip ?? 'ip';
  const uid = (req) => req.actor?.userId ?? null;

  // dati personali e collegamenti personali: mai in cache del browser o di proxy
  r.use(['/b2b/quotes', '/quotes'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const count = (v) => Math.min(99, Math.max(0, Number.parseInt(v, 10) || 0));
  /** I messaggi di ritorno: il testo viene dal sito, nella query c'è solo la chiave (e un numero). */
  const flashOf = (t, q, query) => ({ created: t('quotes.ok.created'), deleted: t('quotes.ok.deleted'), sent: q?.client_email ? t('quotes.ok.sent', { email: q.client_email }) : '', cart: t('quotes.ok.cart', { n: count(query.n) }), cartSome: t('quotes.ok.cartSome', { n: count(query.n) }) }[String(query.ok ?? '')] ?? '');
  const errorOf = (t, query) => ({ cartNone: t('quotes.err.cartNone') }[String(query.err ?? '')] ?? '');

  // ───── area agenzie ─────
  r.get('/b2b/quotes', needPartner, (req, res) => {
    const ctx = res.locals.ctx;
    send(res, quotesPage(ctx, { quotes: listQuotes(db, req.acct.id), team: teamSize(db, req.acct.id) > 0, flash: flashOf(ctx.t, null, req.query), error: errorOf(ctx.t, req.query) }));
  });

  r.get('/b2b/quotes/new', needPartner, (req, res) => {
    send(res, newQuotePage(res.locals.ctx, { acct: req.acct, summary: cartSummary(app, req.acct, Date.now(), uid(req)) }));
  });

  r.post('/b2b/quotes', needPartner, form, (req, res) => {
    const ctx = res.locals.ctx;
    const { t } = ctx;
    if (!app.limits.quote(String(req.acct.id))) return tooMany(res);
    const b = req.body;
    let q;
    try {
      q = createQuote(app, req.acct, req.actor, { client: b.client, email: b.email, clientRef: b.clientRef, markup: b.markup, round: b.round, until: b.until, lang: b.lang, note: b.note });
    } catch (e) {
      if (!(e instanceof QuoteError)) throw e;
      const error = { empty: t('quotes.new.empty'), stale: t('pkg.err.stale'), client: t('quotes.err.client'), email: t('err.email'), markup: t('docs.err.markup', { max: MARKUP_MAX }), until: t('quotes.err.until', { date: e.detail ? fmtDate(e.detail, ctx.lang, 'short') : '' }) }[e.code];
      const values = { client: cleanText(b.client, 120), email: cleanText(b.email, 200), clientRef: cleanText(b.clientRef, 120), lang: String(b.lang ?? ''), markup: String(b.markup ?? ''), round: String(b.round ?? ''), until: String(b.until ?? ''), note: cleanText(b.note, 800) };
      return send(res, newQuotePage(ctx, { acct: req.acct, summary: cartSummary(app, req.acct, Date.now(), uid(req)), values, error }), e.code === 'stale' ? 409 : 400);
    }
    res.redirect(303, `/${req.lang}/b2b/quotes/${q.ref}?ok=created`);
  });

  const show = (req, res, q, { error = '', status = 200 } = {}) => {
    const ctx = res.locals.ctx;
    send(res, quoteDetailPage(ctx, { q, live: ['draft', 'sent', 'approved'].includes(q.status) ? liveCheck(app, req.acct, q) : null, replyTo: req.actor.email, team: teamSize(db, req.acct.id) > 0, flash: flashOf(ctx.t, q, req.query), error: error || errorOf(ctx.t, req.query) }), status);
  };

  r.get('/b2b/quotes/:ref', needPartner, (req, res, next) => {
    const q = ownQuote(db, req.acct.id, req.params.ref);
    if (!q) return next();
    show(req, res, q);
  });

  r.get('/b2b/quotes/:ref/quote.pdf', needPartner, async (req, res, next) => {
    const q = ownQuote(db, req.acct.id, req.params.ref);
    if (!q) return next();
    if (!app.limits.docs(ip(req))) return tooMany(res);
    sendPdf(res, await renderSavedQuotePdf(app, q), `preventivo-${q.ref}.pdf`);
  });

  // lo manda al cliente per email, con il PDF e il collegamento per accettarlo; le risposte arrivano a chi lo manda
  r.post('/b2b/quotes/:ref/send', needPartner, form, async (req, res, next) => {
    const q = ownQuote(db, req.acct.id, req.params.ref);
    if (!q) return next();
    const { t } = res.locals.ctx;
    const fail = (message, status = 400) => show(req, res, q, { error: message, status });
    const state = statusOf(q);
    if (state === 'approved' || state === 'declined') return fail(t('quotes.err.decided'));
    if (state === 'expired') return fail(t('quotes.err.expired'));
    if (q.sent_count >= QUOTE_MAX_SENDS) return fail(t('quotes.err.sends', { n: q.sent_count }));
    const email = cleanText(req.body.email, 254).toLowerCase();
    if (!email) return fail(t('quotes.err.noEmail'));
    if (!isEmail(email)) return fail(t('err.email'));
    if (!app.limits.quoteMail(String(req.acct.id)) || !app.limits.quoteTo(email)) return fail(t('quotes.err.limit'), 429);
    const sent = await sendQuoteToClient(app, q, { to: email, replyTo: req.actor.email, pdf: await renderSavedQuotePdf(app, q) });
    if (sent === false) return fail(t('quotes.err.mail'), 502);
    recordSent(db, q.id, email);
    res.redirect(303, `/${req.lang}/b2b/quotes/${q.ref}?ok=sent`);
  });

  // rimette i servizi nel pacchetto in preparazione di chi lavora, per prenotarli o opzionarli davvero
  r.post('/b2b/quotes/:ref/cart', needPartner, form, (req, res, next) => {
    const q = ownQuote(db, req.acct.id, req.params.ref);
    if (!q) return next();
    const done = loadIntoCart(app, req.acct, q, req.actor);
    const back = `/${req.lang}/b2b/quotes/${q.ref}`;
    if (!done.added) return res.redirect(303, `${back}?err=cartNone`);
    res.redirect(303, `${back}?ok=${done.skipped.length ? 'cartSome' : 'cart'}&n=${done.added}`);
  });

  r.post('/b2b/quotes/:ref/delete', needPartner, form, (req, res, next) => {
    if (!ownQuote(db, req.acct.id, req.params.ref)) return next();
    deleteQuote(db, req.acct.id, req.params.ref);
    res.redirect(303, `/${req.lang}/b2b/quotes?ok=deleted`);
  });

  // ───── la pagina del cliente finale (si arriva dal collegamento dell'email: nessun accesso) ─────
  const byToken = (req) => quoteByToken(db, req.params.ref, req.query.t ?? req.body?.t);

  r.get('/quotes/:ref', (req, res, next) => {
    if (!app.limits.quotePublic(ip(req))) return tooMany(res);
    const q = byToken(req);
    if (!q) return next();
    markViewed(db, q.id);
    send(res, publicQuotePage(res.locals.ctx, { q: getQuote(db, q.ref), done: ['approved', 'declined'].includes(req.query.done) ? req.query.done : '' }));
  });

  r.get('/quotes/:ref/quote.pdf', async (req, res, next) => {
    if (!app.limits.quotePublic(ip(req))) return tooMany(res);
    const q = byToken(req);
    if (!q) return next();
    sendPdf(res, await renderSavedQuotePdf(app, q, { lang: res.locals.ctx.lang }), `preventivo-${q.ref}.pdf`);
  });

  r.get('/quotes/:ref/logo', (req, res, next) => {
    const q = byToken(req);
    const logo = q ? getLogo(db, q.account_id) : null;
    if (!logo) return next();
    res.status(200).set({ 'Content-Type': logo.mime, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(logo.data));
  });

  // accetta o rifiuta (una sola volta, non dopo la scadenza); l'agenzia e la guida lo sanno subito
  r.post('/quotes/:ref/answer', form, async (req, res, next) => {
    if (!app.limits.quotePublic(ip(req))) return tooMany(res);
    const q = byToken(req);
    if (!q) return next();
    const decision = req.body.decision === 'decline' ? 'declined' : req.body.decision === 'approve' ? 'approved' : '';
    const back = `/${res.locals.ctx.lang}/quotes/${q.ref}?t=${q.token}`;
    if (!decision || !decide(db, q.id, decision, req.body.message)) return res.redirect(303, back); // già risposto, scaduto, o scelta non valida: la pagina dice com'è
    const fresh = getQuote(db, q.ref);
    try {
      await notifyAgencyQuote(app, fresh, decision);
      if (decision === 'approved') await notifyGuideQuote(app, fresh);
    } catch (err) {
      console.error('[preventivi] avviso non inviato:', err.message); // la risposta del cliente è già registrata
    }
    res.redirect(303, `${back}&done=${decision}`);
  });

  return r;
}
