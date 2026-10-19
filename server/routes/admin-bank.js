// Pannello › Fatture › Incassi dalla banca: si legge l'estratto conto CSV, si propongono gli abbinamenti e, dopo conferma, si segnano gli incassi.
import express from 'express';
import { MAX_CSV_CHARS, matchStatement, readStatement } from '../bankMatch.js';
import { send } from '../http.js';
import { getInvoice } from '../invoices.js';
import { openPartsCents } from '../invoicePayments.js';
import { isDate, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { bankPage } from '../views/admin-bank.js';

export function adminBankRouter(app) {
  const r = express.Router();
  const { db } = app;
  // un estratto conto di un anno è grande: con i caratteri speciali codificati occupa più del file
  const form = express.urlencoded({ extended: false, limit: '8mb', parameterLimit: 5000 });
  const ctxOf = (req) => ({ app, req });
  const counts = () => ({ queue: app.invoices.queue().length, drafts: db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'draft'`).get().n });
  const flashOf = (q) => {
    if (q.ok !== 'applied') return '';
    const n = Number(q.n) || 0;
    const parts = [`${n === 1 ? 'Segnata come incassata 1 fattura' : `Segnate come incassate ${n} fatture`} (${formatMoney(Number(q.c) || 0, 'it')}).`];
    if (Number(q.a)) parts.push(`${Number(q.a)} ${Number(q.a) === 1 ? 'era già incassata' : 'erano già incassate'}.`);
    if (Number(q.f)) parts.push(`${Number(q.f)} non ${Number(q.f) === 1 ? 'è stata segnata' : 'sono state segnate'} (non più da incassare o non trovate).`);
    return parts.join(' ');
  };

  r.get('/invoices/bank', (req, res) => send(res, bankPage(ctxOf(req), { counts: counts(), flash: flashOf(req.query) })));

  // 1. si legge il file e si propone: nulla viene scritto
  r.post('/invoices/bank', form, (req, res) => {
    const csv = String(req.body.csv ?? '');
    const fail = (error) => send(res, bankPage(ctxOf(req), { counts: counts(), csv: csv.length <= MAX_CSV_CHARS ? csv : '', error }), 400);
    if (!csv.trim()) return fail('Carica il file dell’estratto conto o incolla il suo contenuto.');
    if (csv.length > MAX_CSV_CHARS) return fail('Il file è troppo grande: esporta un periodo più breve dalla banca.');
    const statement = readStatement(csv);
    if (statement.problem) return fail(statement.problem);
    const match = matchStatement(db, statement, { today: nowRome().date });
    send(res, bankPage(ctxOf(req), { counts: counts(), csv, review: { statement, match } }));
  });

  // 2. la guida ha confermato: si segnano le fatture scelte (come quando si segna un incasso a mano, con la ricevuta all'agenzia se si vuole)
  r.post('/invoices/bank/apply', form, async (req, res) => {
    const today = nowRome().date;
    const values = Object.entries(req.body)
      .filter(([k]) => k === 'pay' || k.startsWith('pay_'))
      .flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
    const done = new Set();
    let paid = 0;
    let cents = 0;
    let already = 0;
    let failed = 0;
    for (const raw of values) {
      const m = /^(\d{1,9}):(\d{4}-\d{2}-\d{2})$/.exec(String(raw));
      if (!m || !isDate(m[2])) {
        failed++;
        continue;
      }
      const id = Number(m[1]);
      if (done.has(id)) continue;
      done.add(id);
      const inv = getInvoice(db, id);
      const due = inv ? openPartsCents(inv) : 0;
      try {
        const out = await app.invoices.markPaid(id, { date: m[2] > today ? today : m[2], method: 'bank', notify: req.body.notify === '1' });
        if (out.already) already++;
        else {
          paid++;
          cents += due;
        }
      } catch {
        failed++;
      }
    }
    res.redirect(303, `/admin/invoices/bank?ok=applied&n=${paid}&c=${cents}&a=${already}&f=${failed}`);
  });

  return r;
}
