import express from 'express';
import { ProgramError, createProgramRequest, dayConflicts, getProgram, programDays, saveProposal, setProgramStatus } from '../programs.js';
import { notifyGuideProgram, programUrl } from '../emails.js';
import { toMin } from '../time.js';
import { cleanText, parseEuros } from '../util.js';
import { invoiceForSource } from '../invoices.js';
import { send, sendPdf } from '../http.js';
import { renderProposalPdf } from '../pdf.js';
import { programDetailPage, programsAdminPage } from '../views/admin-programs.js';

const FLASH = {
  created: 'Programma creato: prepara la proposta qui sotto.',
  saved: 'Proposta salvata (non ancora inviata al cliente).',
  sent: 'Proposta inviata al cliente.',
  accepted: 'Accettazione registrata e cliente avvisato.',
  confirmed: 'Programma confermato e cliente avvisato.',
  deposit: 'Acconto registrato: il programma è confermato e il cliente è stato avvisato.',
  cancelled: 'Programma annullato: le date sono di nuovo libere.',
  status: 'Stato aggiornato.',
  notes: 'Note salvate.',
};
const ERR = {
  state: 'Questa operazione non è possibile nello stato attuale del programma.',
  conflict: 'Ci sono sovrapposizioni in calendario: controlla i ⚠ oppure registra l’accettazione ignorandole.',
  mailfail: 'La proposta è salvata e segnata come inviata, ma l’email non è partita (controlla le impostazioni SMTP). Scrivi tu al cliente con il link della pagina qui sotto.',
  refund: 'Il rimborso dell’acconto non è riuscito: fallo a mano dalla dashboard di Stripe (è scritto anche nelle note).',
  create: 'Compila nome, email e numero di persone; controlla le date.',
};

const arr = (v) => [].concat(v ?? []).map(String);

/** Righe del modulo → giornate. Le righe senza titolo, descrizione e prezzo sono vuote e vengono ignorate. */
export function parseProposalForm(body) {
  const col = (k) => arr(body[k]);
  const dates = col('d_date');
  const starts = col('d_start');
  const ends = col('d_end');
  const titles = col('d_title');
  const descs = col('d_desc');
  const prices = col('d_price');
  const n = Math.max(dates.length, titles.length);
  const rows = [];
  const days = [];
  for (let i = 0; i < n; i++) {
    const row = { date: dates[i] ?? '', start: starts[i] ?? '', end: ends[i] ?? '', title: (titles[i] ?? '').trim(), description: (descs[i] ?? '').trim(), price: (prices[i] ?? '').trim() };
    rows.push(row);
    if (!row.title && !row.description && !row.price) continue;
    days.push({ ...row, rowNo: i + 1, priceCents: row.price === '' ? 0 : (parseEuros(row.price) ?? Number.NaN) });
  }
  return { rows, days };
}

export function adminProgramsRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 500 });
  const ctxOf = (req) => ({ app, req });
  const flash = (req) => FLASH[String(req.query.ok ?? '')] ?? '';
  const errOf = (req) => ERR[String(req.query.err ?? '')] ?? '';
  const go = (res, id, k, v) => res.redirect(303, `/admin/programs/${id}?${k}=${v}`);

  /** Con cosa si sovrappone ogni giornata (calendario, prenotazioni, altri programmi, righe dello stesso programma). */
  function conflictsFor(p, days) {
    return days.map((d, i) => {
      const list = dayConflicts(app, d, { ignoreProgramId: p.id });
      days.forEach((o, j) => {
        if (j !== i && o.date === d.date && toMin(d.start_time) < toMin(o.end_time) && toMin(o.start_time) < toMin(d.end_time)) list.push(`si sovrappone alla riga ${j + 1} di questo programma`);
      });
      return list;
    });
  }

  r.get('/programs', (req, res) => {
    const tab = ['open', 'confirmed', 'archive'].includes(req.query.tab) ? req.query.tab : 'open';
    const where = { open: `status IN ('new','quoted','accepted')`, confirmed: `status = 'confirmed'`, archive: `status IN ('declined','closed')` };
    const counts = Object.fromEntries(Object.entries(where).map(([k, w]) => [k, db.prepare(`SELECT COUNT(*) n FROM programs WHERE ${w}`).get().n]));
    const items = db.prepare(`SELECT * FROM programs WHERE ${where[tab]} ORDER BY ${tab === 'archive' ? 'updated_at DESC' : "COALESCE(date_from, '9999') ASC, created_at DESC"} LIMIT 300`).all();
    send(res, programsAdminPage(ctxOf(req), { tab, items, counts, flash: flash(req), error: errOf(req) }));
  });

  r.post('/programs', form, (req, res) => {
    const b = req.body;
    try {
      const p = createProgramRequest(app, {
        name: b.name, email: b.email, phone: b.phone, company: b.company, dateFrom: b.dateFrom, dateTo: b.dateTo, participants: b.participants,
        channel: b.channel === 'b2b' ? 'b2b' : 'b2c', lang: b.lang, message: b.message, flexibleDates: !b.dateFrom,
      });
      go(res, p.id, 'ok', 'created');
    } catch (err) {
      if (!(err instanceof ProgramError)) throw err;
      res.redirect(303, '/admin/programs?err=create');
    }
  });

  function render(req, res, p, { formState = null, error = '', status = 200 } = {}) {
    const days = programDays(db, p.id);
    send(res, programDetailPage(ctxOf(req), p, { days, conflicts: conflictsFor(p, days), form: formState, flash: flash(req), error: error || errOf(req), publicUrl: programUrl(app, p), invoice: invoiceForSource(db, 'program', p.id) }), status);
  }

  r.get('/programs/:id', (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    render(req, res, p);
  });

  r.get('/programs/:id/proposal.pdf', async (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p || !programDays(db, p.id).length) return next();
    sendPdf(res, await renderProposalPdf(app, p, p.lang), `proposta-${p.ref}.pdf`);
  });

  r.post('/programs/:id/proposal', form, async (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    const b = req.body;
    const { rows, days } = parseProposalForm(b);
    const totalRaw = String(b.total ?? '').trim();
    const total = totalRaw === '' ? null : parseEuros(totalRaw);
    const sending = b.action === 'send';
    const formState = {
      title: cleanText(b.title, 160), intro: cleanText(b.intro, 3000), notes: cleanText(b.notes, 3000), depositPercent: b.deposit_percent, validUntil: String(b.valid_until ?? ''), holdDates: !!b.hold_dates, total: String(b.total ?? ''), rows,
    };
    const fail = (message) => render(req, res, p, { formState, error: message, status: 400 });
    if (totalRaw !== '' && (total === null || total < 0)) return fail('Il totale concordato non è valido.');
    try {
      saveProposal(app, p.id, {
        title: b.title, intro: b.intro, notes: b.notes, depositPercent: Number.parseInt(b.deposit_percent, 10) || 0, validUntil: String(b.valid_until ?? '') || null, holdDates: !!b.hold_dates, totalCents: total,
        days: days.map((d) => ({ date: d.date, start: d.start, end: d.end, title: d.title, description: d.description, priceCents: d.priceCents })),
      }, { strict: sending });
    } catch (err) {
      if (!(err instanceof ProgramError)) throw err;
      const rowNo = typeof err.detail === 'number' ? days[err.detail]?.rowNo : null;
      return fail({
        rows: rowNo ? `Controlla la riga ${rowNo}: servono data, orario di inizio prima di quello di fine, un titolo e un prezzo valido.` : 'Controlla le righe della proposta.',
        total: 'Il totale concordato deve essere positivo prima di inviare la proposta.',
        deposit: 'L’acconto deve essere una percentuale tra 0 e 100.',
        validity: sending ? 'Per inviare la proposta indica fino a quando è valida (una data futura).' : 'La data di validità non è corretta.',
        locked: 'La proposta è già stata accettata: non si può modificare.',
      }[err.code] ?? 'Impossibile salvare la proposta.');
    }
    if (!sending) return go(res, p.id, 'ok', 'saved');
    if (days.length === 0) return fail('Aggiungi almeno una giornata prima di inviare la proposta.');
    let mailed;
    try {
      ({ mailed } = await app.programs.send(p.id));
    } catch (err) {
      if (!(err instanceof ProgramError)) throw err;
      return fail('La proposta non può essere inviata in questo stato.');
    }
    go(res, p.id, mailed ? 'ok' : 'err', mailed ? 'sent' : 'mailfail');
  });

  r.post('/programs/:id/accept', form, async (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    if (p.status === 'new') return go(res, p.id, 'err', 'state'); // prima la proposta va inviata
    const out = await app.programs.accept(p.id, p.lang, Date.now(), { override: !!req.body.force, checkout: false });
    if (out.outcome === 'conflict') return go(res, p.id, 'err', 'conflict');
    if (out.outcome === 'state' || out.outcome === 'expired') return go(res, p.id, 'err', 'state');
    go(res, p.id, 'ok', out.outcome === 'confirmed' ? 'confirmed' : 'accepted');
  });

  r.post('/programs/:id/deposit', form, async (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    if (!['quoted', 'accepted'].includes(p.status)) return go(res, p.id, 'err', 'state');
    await app.programs.handleDepositPaid(p.id, null, Date.now(), { notifyGuide: false });
    go(res, p.id, 'ok', 'deposit');
  });

  r.post('/programs/:id/cancel', form, async (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    const out = await app.programs.cancel(p.id, { refundDeposit: !!req.body.refund });
    if (out.outcome === 'state') return go(res, p.id, 'err', 'state');
    go(res, p.id, out.outcome === 'refund_failed' ? 'err' : 'ok', out.outcome === 'refund_failed' ? 'refund' : 'cancelled');
  });

  r.post('/programs/:id/status', form, async (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    const status = String(req.body.status);
    const allowed = { new: ['declined', 'closed'], quoted: ['declined', 'closed'], declined: ['new'], closed: ['new'] };
    if (!allowed[p.status]?.includes(status)) return go(res, p.id, 'err', 'state');
    setProgramStatus(db, p.id, status);
    go(res, p.id, 'ok', 'status');
  });

  r.post('/programs/:id/notes', form, (req, res, next) => {
    const p = getProgram(db, Number(req.params.id));
    if (!p) return next();
    db.prepare('UPDATE programs SET admin_notes = ?, updated_at = ? WHERE id = ?').run(cleanText(req.body.admin_notes, 2000) || null, new Date().toISOString(), p.id);
    go(res, p.id, 'ok', 'notes');
  });

  return r;
}
