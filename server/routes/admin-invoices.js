import express from 'express';
import { InvoiceError, getInvoice, settingsOf } from '../invoices.js';
import { nowRome } from '../time.js';
import { cleanText, parseEuros } from '../util.js';
import { send, sendPdf } from '../http.js';
import { renderInvoicePdf } from '../pdf-invoice.js';
import { invoiceDetailPage, invoicesPage } from '../views/admin-invoices.js';

const FLASH = {
  created: 'Bozza creata: controlla i dati e poi emetti la fattura.',
  drafts: 'Bozze create (una per cliente).',
  saved: 'Bozza salvata.',
  issued: 'Fattura emessa. Ora scaricala o trasmettila a SdI entro 12 giorni.',
  reissued: 'Fattura corretta e riemessa con lo stesso numero.',
  deleted: 'Bozza eliminata.',
  sent: 'Fattura trasmessa a SdI dalla PEC. Registra l’esito quando arriva la ricevuta.',
  emailed: 'Copia di cortesia inviata al cliente.',
  status: 'Esito registrato.',
  credit: 'Nota di credito in bozza: indica gli importi da stornare e poi emettila.',
  discarded: 'Fattura riportata in bozza: il numero è di nuovo disponibile.',
};

const arr = (v) => [].concat(v ?? []).map(String);

/** Modulo della bozza → dati per saveDraft, più le righe così come scritte (per rimostrarle se c'è un errore). */
export function parseInvoiceForm(body) {
  const keys = arr(body.l_key);
  const descs = arr(body.l_desc);
  const amounts = arr(body.l_amount);
  const n = Math.max(keys.length, descs.length, amounts.length);
  const rows = [];
  const lines = [];
  for (let i = 0; i < n; i++) {
    const row = { key: keys[i] ?? '', description: (descs[i] ?? '').trim(), amount: (amounts[i] ?? '').trim() };
    rows.push(row);
    if (!row.description && !row.amount) continue; // riga vuota: si ignora (se era collegata a una voce, la voce torna da fatturare)
    lines.push({ key: row.key || undefined, description: row.description, amountCents: parseEuros(row.amount) ?? Number.NaN, rowNo: i + 1 });
  }
  const pick = (k) => body[`b_${k}`];
  const buyer = Object.fromEntries(['kind', 'name', 'firstName', 'lastName', 'country', 'vat', 'taxCode', 'address', 'zip', 'city', 'province', 'sdiCode', 'pec', 'email', 'lang'].map((k) => [k, pick(k)]));
  const options = { bolloCharged: !!body.opt_bollo, contributionPercent: body.opt_contribution, withholdingPercent: body.opt_withholding, notes: body.opt_notes, dueDate: body.opt_due };
  return { buyer, lines, rows, issueDate: String(body.issue_date ?? ''), options };
}

const message = (e) => `${e.message.charAt(0).toUpperCase()}${e.message.slice(1)}${e.problems?.length ? `: ${e.problems.join(' ')}` : ''}.`.replace(/\.\.$/, '.');

export function adminInvoicesRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 600 });
  const ctxOf = (req) => ({ app, req });
  const flash = (req) => FLASH[String(req.query.ok ?? '')] ?? '';
  const go = (res, id, ok) => res.redirect(303, `/admin/invoices/${id}?ok=${ok}`);

  // ───── elenco ─────
  function renderList(req, res, { error = '', status = 200 } = {}) {
    const tab = ['queue', 'drafts', 'issued', 'settings'].includes(req.query.tab) ? req.query.tab : 'queue';
    const thisYear = Number(nowRome().date.slice(0, 4));
    const years = [...new Set([thisYear, ...db.prepare('SELECT DISTINCT year FROM invoices WHERE year IS NOT NULL ORDER BY year DESC').all().map((x) => x.year)])].sort((a, b) => b - a);
    const year = years.includes(Number(req.query.year)) ? Number(req.query.year) : years[0];
    const queue = app.invoices.queue();
    const drafts = db.prepare(`SELECT i.*, (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = i.id) AS lines FROM invoices i WHERE i.status = 'draft' ORDER BY i.id DESC`).all();
    const issued = tab === 'issued' ? db.prepare(`SELECT * FROM invoices WHERE status != 'draft' AND year = ? ORDER BY seq DESC`).all(year) : [];
    send(res, invoicesPage(ctxOf(req), {
      tab, queue: tab === 'queue' ? queue : [], drafts: tab === 'drafts' ? drafts : [], issued, year, years, counts: { queue: queue.length, drafts: drafts.length },
      problems: app.invoices.problems(), settings: settingsOf(app.cfg), pec: app.invoices.pecConfigured, flash: flash(req), error,
    }), status);
  }

  r.get('/invoices', (req, res) => renderList(req, res));

  r.post('/invoices/draft', form, async (req, res, next) => {
    const keys = arr(req.body.src);
    if (!keys.length) return renderList(req, res, { error: 'Scegli almeno una voce da fatturare.', status: 400 });
    try {
      const drafts = app.invoices.createDrafts(keys);
      if (drafts.length === 1) return go(res, drafts[0].id, 'created');
      res.redirect(303, '/admin/invoices?tab=drafts&ok=drafts');
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      renderList(req, res, { error: message(e), status: 400 });
    }
  });

  r.post('/invoices/manual', form, (req, res) => go(res, app.invoices.createManual().id, 'created'));

  r.get('/invoices/export.csv', (req, res) => {
    const year = Number.parseInt(req.query.year, 10) || Number(nowRome().date.slice(0, 4));
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="fatture-${year}.csv"`).send(app.invoices.csv(year));
  });

  // ───── singola fattura ─────
  function renderDetail(req, res, id, { error = '', form: formState = null, status = 200 } = {}) {
    const d = app.invoices.detail(id);
    const inv = d.inv;
    const lastSeq = inv.year ? db.prepare('SELECT MAX(seq) AS seq FROM invoices WHERE year = ?').get(inv.year).seq : null;
    send(res, invoiceDetailPage(ctxOf(req), d, {
      flash: flash(req), error, form: formState, problems: d.problems ?? [],
      canDiscard: inv.status === 'issued' && !inv.sent_at && !inv.emailed_at && inv.seq === lastSeq,
      creditNotes: db.prepare(`SELECT id, number, total_cents, status FROM invoices WHERE related_id = ? AND doc_type = 'TD04' ORDER BY id`).all(id),
      pecConfigured: app.invoices.pecConfigured, settings: settingsOf(app.cfg),
    }), status);
  }
  const load = (req) => {
    const inv = getInvoice(db, Number(req.params.id));
    return inv ?? null;
  };

  r.get('/invoices/:id', (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    renderDetail(req, res, inv.id);
  });

  r.post('/invoices/:id/save', form, (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    const parsed = parseInvoiceForm(req.body);
    const wasRejected = inv.status === 'rejected';
    try {
      app.invoices.save(inv.id, { buyer: parsed.buyer, lines: parsed.lines, issueDate: parsed.issueDate, options: parsed.options });
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      const formState = { buyer: { ...parsed.buyer, kind: parsed.buyer.kind === 'person' ? 'person' : 'company' }, lines: parsed.rows, issueDate: parsed.issueDate, options: { ...parsed.options, contributionPercent: Number(parsed.options.contributionPercent) || 0, withholdingPercent: Number(parsed.options.withholdingPercent) || 0 } };
      return renderDetail(req, res, inv.id, { error: message(e), form: formState, status: 400 });
    }
    if (req.body.action !== 'issue') return go(res, inv.id, 'saved');
    try {
      app.invoices.issue(inv.id);
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      return renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
    go(res, inv.id, wasRejected ? 'reissued' : 'issued');
  });

  r.post('/invoices/:id/delete', form, (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    try {
      app.invoices.remove(inv.id);
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      return renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
    res.redirect(303, '/admin/invoices?tab=drafts&ok=deleted');
  });

  r.get('/invoices/:id/xml', (req, res, next) => {
    const inv = load(req);
    if (!inv || !inv.xml) return next();
    res.type('application/xml; charset=utf-8').set({ 'Content-Disposition': `attachment; filename="${inv.file_name}"`, 'Cache-Control': 'private, no-store' }).send(inv.xml);
  });

  r.get('/invoices/:id/pdf', async (req, res, next) => {
    const inv = load(req);
    if (!inv || !inv.number) return next();
    sendPdf(res, await renderInvoicePdf(app, inv), `${inv.doc_type === 'TD04' ? 'nota-di-credito' : 'fattura'}-${String(inv.number).replace('/', '-')}.pdf`);
  });

  r.post('/invoices/:id/email', form, async (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    try {
      await app.invoices.emailCopy(inv.id, cleanText(req.body.to, 200), { includeXml: !!req.body.xml });
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      return renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
    go(res, inv.id, 'emailed');
  });

  r.post('/invoices/:id/sdi', form, async (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    try {
      await app.invoices.sendToSdi(inv.id);
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      return renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
    go(res, inv.id, 'sent');
  });

  r.post('/invoices/:id/status', form, (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    try {
      app.invoices.setStatus(inv.id, String(req.body.status), req.body.note);
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      return renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
    go(res, inv.id, 'status');
  });

  r.post('/invoices/:id/credit-note', form, (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    try {
      go(res, app.invoices.creditNote(inv.id).id, 'credit');
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
  });

  r.post('/invoices/:id/discard', form, (req, res, next) => {
    const inv = load(req);
    if (!inv) return next();
    try {
      app.invoices.discard(inv.id);
    } catch (e) {
      if (!(e instanceof InvoiceError)) return next(e);
      return renderDetail(req, res, inv.id, { error: message(e), status: 400 });
    }
    go(res, inv.id, 'discarded');
  });

  return r;
}

