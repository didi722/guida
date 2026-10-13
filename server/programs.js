// Programmi di più giorni: richiesta → proposta → accettazione (con acconto) → date bloccate in calendario.
import { loadAvailabilityContext } from './availability.js';
import { tx } from './db.js';
import { sendProgramAccepted, sendProgramConfirmed, sendProgramReceived, sendProposalEmail, notifyGuideProgram } from './emails.js';
import { addDays, isDate, isTime, nowRome, toMin } from './time.js';
import { cleanText, isEmail, newRef, newToken } from './util.js';
import { normLang, pick } from './langs.js';

export const INTERESTS = ['art', 'history', 'religions', 'food', 'lagoon', 'photography', 'architecture', 'family'];
export const GROUP_TYPES = ['family', 'friends', 'school', 'corporate', 'agency', 'other'];
export const BUDGETS = ['lt1000', '1000_2500', '2500_5000', 'gt5000', 'tbd'];
const MAX_DAYS = 40;

export class ProgramError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.code = code; // fields | dates | rows | total | deposit | validity | locked | state | conflict | payment
    this.detail = detail;
  }
}

export const getProgram = (db, id) => db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
export const getProgramByRef = (db, ref) => db.prepare('SELECT * FROM programs WHERE ref = ?').get(String(ref));
export const programDays = (db, id) => db.prepare('SELECT * FROM program_days WHERE program_id = ? ORDER BY date, start_time, position').all(id);
export const depositFor = (totalCents, percent) => Math.round((totalCents * percent) / 100);
export const isLocked = (p) => ['accepted', 'confirmed'].includes(p.status);

/** Stato della proposta rispetto alla scadenza. */
export function proposalExpired(p, nowMs = Date.now()) {
  return !!p.valid_until && nowRome(nowMs).date > p.valid_until;
}

// ───────────── richiesta del cliente ─────────────
/** Controlla i dati essenziali di una richiesta (senza scrivere nulla). Lancia ProgramError('fields' | 'dates'). */
export function validateProgramInput(input, nowMs = Date.now()) {
  const today = nowRome(nowMs).date;
  const name = cleanText(input.name, 120);
  const email = cleanText(input.email, 254).toLowerCase();
  const participants = Number.parseInt(input.participants, 10);
  if (name.length < 2 || !isEmail(email) || !Number.isInteger(participants) || participants < 1 || participants > 80) throw new ProgramError('fields', 'name/email/participants');

  const dateFrom = input.dateFrom || null;
  const dateTo = input.dateTo || null;
  if ((dateFrom && !isDate(dateFrom)) || (dateTo && !isDate(dateTo))) throw new ProgramError('dates', 'invalid date');
  if (dateFrom && dateFrom < today) throw new ProgramError('dates', 'date in the past');
  if (dateTo && (!dateFrom || dateTo < dateFrom || dateTo > addDays(dateFrom, 60))) throw new ProgramError('dates', 'date range');
  return { name, email, participants, dateFrom, dateTo };
}

export function createProgramRequest(app, input, nowMs = Date.now()) {
  const { db } = app;
  const { name, email, participants, dateFrom, dateTo } = validateProgramInput(input, nowMs);
  const interests = [].concat(input.interests ?? []).filter((x) => INTERESTS.includes(x));
  const channel = input.channel === 'b2b' ? 'b2b' : 'b2c';
  const now = new Date(nowMs).toISOString();
  const row = {
    ref: newRef('PR'),
    token: newToken(),
    status: 'new',
    channel,
    account_id: channel === 'b2b' ? (input.account?.id ?? null) : null,
    client_ref: cleanText(input.clientRef, 120) || null,
    lang: normLang(input.lang),
    name,
    email,
    phone: cleanText(input.phone, 40) || null,
    company: cleanText(input.company, 160) || null,
    date_from: dateFrom,
    date_to: dateTo,
    flexible_dates: input.flexibleDates ? 1 : 0,
    participants,
    group_type: GROUP_TYPES.includes(input.groupType) ? input.groupType : null,
    interests: interests.length ? JSON.stringify(interests) : null,
    accommodation: cleanText(input.accommodation, 200) || null,
    mobility: cleanText(input.mobility, 300) || null,
    budget: BUDGETS.includes(input.budget) ? input.budget : null,
    languages: cleanText(input.languages, 120) || null,
    message: cleanText(input.message, 3000) || null,
    created_at: now,
    updated_at: now,
  };
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO programs(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row));
  return getProgram(db, Number(info.lastInsertRowid));
}

// ───────────── conflitti con il calendario ─────────────
/**
 * Con cosa si sovrappone una giornata di programma: prenotazioni, blocchi, impegni dei calendari collegati,
 * altri programmi. @returns {string[]} descrizioni (vuoto = libero)
 */
export function dayConflicts(app, day, { ignoreProgramId = null, nowMs = Date.now() } = {}) {
  const { db, cfg, content } = app;
  // un programma già accettato non confligge con le proposte altrui; una proposta inviata cede il passo solo a quelle inviate prima
  const me = ignoreProgramId ? getProgram(db, ignoreProgramId) : null;
  const holdsSentBefore = !me ? null : isLocked(me) ? '' : me.status === 'quoted' ? (me.proposal_sent_at ?? null) : null;
  const ctx = loadAvailabilityContext(db, cfg, day.date, day.date, nowMs, { ignoreProgramId, holdsSentBefore });
  const ps = toMin(day.start_time);
  const pe = toMin(day.end_time);
  const out = [];
  for (const b of ctx.bookings.get(day.date) ?? []) {
    if (ps < toMin(b.end_time) + b.buffer_min && toMin(b.start_time) < pe) out.push(`prenotazione ${b.start_time}–${b.end_time} (${content.tour(b.tour_slug)?.i18n.it.title ?? b.tour_slug})`);
  }
  for (const bl of ctx.blocks.get(day.date) ?? []) {
    if (ps < toMin(bl.end_time) && toMin(bl.start_time) < pe) out.push(`impegno già in calendario ${bl.start_time}–${bl.end_time.replace('24:00', '24:00')}`);
  }
  return out;
}

// ───────────── proposta ─────────────
/**
 * Salva (sostituisce) la proposta di un programma.
 * data: { title, intro, notes, depositPercent, validUntil, holdDates, totalCents|null, days:[{date,start,end,title,description,priceCents}] }
 * strict: controlli da applicare prima dell'invio al cliente.
 */
export function saveProposal(app, id, data, { strict = false, nowMs = Date.now() } = {}) {
  const { db } = app;
  const today = nowRome(nowMs).date;
  return tx(db, () => {
    const p = getProgram(db, id);
    if (!p) throw new ProgramError('state', 'not found');
    if (isLocked(p)) throw new ProgramError('locked', 'proposal accepted: cannot be edited');
    if (data.days.length > MAX_DAYS) throw new ProgramError('rows', 'too many rows');

    const days = data.days.map((d, i) => {
      const title = cleanText(d.title, 160);
      if (!isDate(d.date) || !isTime(d.start) || !isTime(d.end) || toMin(d.start) >= toMin(d.end) || title.length < 2) throw new ProgramError('rows', `row ${i + 1}`, i);
      const price = d.priceCents == null ? 0 : Number(d.priceCents);
      if (!Number.isInteger(price) || price < 0 || price > 100_000_00) throw new ProgramError('rows', `row ${i + 1} price`, i);
      return { date: d.date, start: d.start, end: d.end, title, description: cleanText(d.description, 800) || null, price };
    });
    const sum = days.reduce((a, d) => a + d.price, 0);
    const total = data.totalCents == null ? sum : Number(data.totalCents);
    if (!Number.isInteger(total) || total < 0) throw new ProgramError('total', 'invalid total');
    const percent = Number(data.depositPercent ?? 0);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new ProgramError('deposit', 'invalid deposit');
    const validUntil = data.validUntil || null;
    if (validUntil && !isDate(validUntil)) throw new ProgramError('validity', 'invalid date');
    if (strict) {
      if (!days.length) throw new ProgramError('rows', 'no rows');
      if (total <= 0) throw new ProgramError('total', 'total must be positive');
      if (!validUntil || validUntil < today) throw new ProgramError('validity', 'validity in the past');
    }

    db.prepare('DELETE FROM program_days WHERE program_id = ?').run(id);
    const ins = db.prepare('INSERT INTO program_days(program_id, position, date, start_time, end_time, title, description, price_cents) VALUES(?,?,?,?,?,?,?,?)');
    days.forEach((d, i) => ins.run(id, i, d.date, d.start, d.end, d.title, d.description, d.price));
    db.prepare(
      `UPDATE programs SET proposal_title = ?, proposal_intro = ?, proposal_notes = ?, total_cents = ?, deposit_percent = ?, deposit_cents = ?, valid_until = ?, hold_dates = ?, updated_at = ? WHERE id = ?`,
    ).run(cleanText(data.title, 160) || null, cleanText(data.intro, 3000) || null, cleanText(data.notes, 3000) || null, total, percent, depositFor(total, percent), validUntil, data.holdDates ? 1 : 0, new Date(nowMs).toISOString(), id);
    return getProgram(db, id);
  });
}

/** Segna la proposta come inviata (status "quoted"). */
export function markQuoted(app, id, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const p = getProgram(db, id);
    if (!p || !['new', 'quoted'].includes(p.status)) throw new ProgramError('state', 'cannot send in this state');
    if (!(programDays(db, id).length > 0 && p.total_cents > 0 && p.valid_until && p.valid_until >= nowRome(nowMs).date)) throw new ProgramError('state', 'proposal incomplete');
    db.prepare(`UPDATE programs SET status = 'quoted', proposal_sent_at = ?, updated_at = ? WHERE id = ?`).run(new Date(nowMs).toISOString(), new Date(nowMs).toISOString(), id);
    return getProgram(db, id);
  });
}

// ───────────── accettazione, rifiuto, acconto ─────────────
/**
 * Il cliente accetta la proposta.
 * @returns {{outcome: 'accepted'|'confirmed'|'expired'|'conflict'|'state', conflicts?: string[], program: object}}
 */
export function acceptProgram(app, id, { override = false } = {}, nowMs = Date.now()) {
  const { db } = app;
  return tx(db, () => {
    const p = getProgram(db, id);
    if (!p || p.status !== 'quoted') return { outcome: 'state', program: p };
    if (!override && proposalExpired(p, nowMs)) return { outcome: 'expired', program: p };
    if (!override) {
      const conflicts = programDays(db, id).flatMap((d) => dayConflicts(app, d, { ignoreProgramId: id, nowMs }).map((c) => `${d.date}: ${c}`));
      if (conflicts.length) return { outcome: 'conflict', conflicts, program: p };
    }
    const needsDeposit = p.deposit_cents > 0;
    const now = new Date(nowMs).toISOString();
    db.prepare(`UPDATE programs SET status = ?, accepted_at = ?, deposit_status = ?, updated_at = ? WHERE id = ?`).run(needsDeposit ? 'accepted' : 'confirmed', now, needsDeposit ? 'pending' : 'none', now, id);
    return { outcome: needsDeposit ? 'accepted' : 'confirmed', program: getProgram(db, id) };
  });
}

export function declineProgram(db, id, message, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  return db.prepare(`UPDATE programs SET status = 'declined', declined_at = ?, updated_at = ?, admin_notes = COALESCE(admin_notes || char(10), '') || ? WHERE id = ? AND status IN ('new', 'quoted')`).run(now, now, message ? `Il cliente ha rifiutato: ${cleanText(message, 500)}` : 'Il cliente ha rifiutato.', id).changes === 1;
}

/** Acconto incassato (online o registrato a mano): il programma diventa "confirmed". Idempotente. */
export function markDepositPaid(db, id, paymentIntent = null, nowMs = Date.now()) {
  return tx(db, () => {
    const p = getProgram(db, id);
    if (!p) return { outcome: 'missing' };
    if (p.deposit_status === 'paid') return { outcome: 'already', program: p };
    const now = new Date(nowMs).toISOString();
    if (['declined', 'closed'].includes(p.status)) {
      // pagato dopo che il programma era stato chiuso: va rimborsato dal chiamante
      db.prepare('UPDATE programs SET stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?').run(paymentIntent, id);
      return { outcome: 'closed', program: getProgram(db, id) };
    }
    db.prepare(`UPDATE programs SET deposit_status = 'paid', deposit_paid_at = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent), status = 'confirmed', accepted_at = COALESCE(accepted_at, ?), updated_at = ? WHERE id = ?`).run(now, paymentIntent, now, now, id);
    return { outcome: 'paid', program: getProgram(db, id) };
  });
}

export function setProgramStatus(db, id, status, nowMs = Date.now()) {
  if (!['new', 'quoted', 'closed', 'declined'].includes(status)) throw new ProgramError('state', 'invalid status');
  return db.prepare('UPDATE programs SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date(nowMs).toISOString(), id).changes === 1;
}

// ───────────── servizi: collegano DB, pagamenti ed email ─────────────
export function createProgramServices(app) {
  const { db, cfg, payments } = app;

  const svc = {
    get depositsOnline() {
      return payments.live || payments.demo;
    },

    async submit(input, nowMs = Date.now()) {
      const p = createProgramRequest(app, input, nowMs);
      await sendProgramReceived(app, p);
      await notifyGuideProgram(app, p, 'new');
      return p;
    },

    /** Segna la proposta come inviata e scrive al cliente. @returns {{program: object, mailed: boolean}} */
    async send(id, nowMs = Date.now()) {
      const p = markQuoted(app, id, nowMs);
      const mailed = await sendProposalEmail(app, p);
      return { program: p, mailed };
    },

    /**
     * Il cliente accetta (o la guida accetta per suo conto: `override` ignora i conflitti, `checkout: false` non prepara il pagamento).
     * Se c'è un acconto prepara il pagamento. @returns {{outcome, program, redirect?, conflicts?}}
     */
    async accept(id, lang, nowMs = Date.now(), { override = false, checkout = true } = {}) {
      const res = acceptProgram(app, id, { override }, nowMs);
      if (res.outcome === 'confirmed') {
        await sendProgramConfirmed(app, res.program);
        await notifyGuideProgram(app, res.program, 'confirmed');
      } else if (res.outcome === 'accepted') {
        await notifyGuideProgram(app, res.program, 'accepted');
        await sendProgramAccepted(app, res.program);
        if (checkout && svc.depositsOnline) {
          try {
            res.redirect = await svc.startCheckout(res.program, lang, nowMs);
          } catch (err) {
            console.error('[programma] errore Stripe:', err.message); // l'acconto resta "pending": si può riprovare dal link
          }
        }
      }
      return res;
    },

    async startCheckout(p, lang, nowMs = Date.now(), attempt = 0) {
      const session = await payments.createCheckout({
        ref: p.ref,
        email: p.email,
        amountCents: p.deposit_cents,
        currency: p.currency,
        title: `${pick({ it: 'Acconto programma', en: 'Programme deposit', es: 'Anticipo del programa', ja: 'プログラムの手付金' }, p.lang)} — ${p.proposal_title ?? p.ref}`,
        description: `${p.ref} · ${p.deposit_percent}%`,
        lang: p.lang,
        successUrl: `${cfg.baseUrl}/${lang}/programs/${p.ref}?t=${p.token}&paid=1`,
        cancelUrl: `${cfg.baseUrl}/${lang}/programs/${p.ref}?t=${p.token}&canceled=1`,
        demoUrl: `${cfg.baseUrl}/pay/demo/${p.ref}?t=${p.token}&lang=${lang}`,
        nowMs,
        attempt,
      });
      db.prepare('UPDATE programs SET stripe_session_id = ? WHERE id = ?').run(session.id, p.id);
      return session.url;
    },

    async handleDepositPaid(id, paymentIntent = null, nowMs = Date.now(), { notifyGuide = true } = {}) {
      const res = markDepositPaid(db, id, paymentIntent, nowMs);
      if (res.outcome === 'paid') {
        await sendProgramConfirmed(app, res.program);
        if (notifyGuide) await notifyGuideProgram(app, res.program, 'deposit');
      } else if (res.outcome === 'closed' && paymentIntent) {
        try {
          await payments.refund({ paymentIntent, cents: res.program.deposit_cents, ref: res.program.ref });
        } catch (err) {
          console.error(`[programma] rimborso acconto ${res.program.ref} fallito:`, err.message);
        }
      }
      return res;
    },

    /** La guida annulla un programma già accettato/confermato; facoltativamente rimborsa l'acconto incassato online. */
    async cancel(id, { refundDeposit = false } = {}, nowMs = Date.now()) {
      const p = getProgram(db, id);
      if (!p || !['accepted', 'confirmed'].includes(p.status)) return { outcome: 'state', program: p };
      let refunded = 0;
      let refundFailed = false;
      if (refundDeposit && p.deposit_status === 'paid' && p.deposit_cents > 0) {
        try {
          if (p.stripe_payment_intent) await payments.refund({ paymentIntent: p.stripe_payment_intent, cents: p.deposit_cents, ref: p.ref });
          refunded = p.deposit_cents;
        } catch (err) {
          console.error(`[programma] rimborso acconto ${p.ref} fallito:`, err.message);
          refundFailed = true;
        }
      }
      const now = new Date(nowMs).toISOString();
      db.prepare(`UPDATE programs SET status = 'closed', deposit_status = CASE WHEN ? THEN 'refunded' ELSE deposit_status END, updated_at = ?, admin_notes = COALESCE(admin_notes || char(10), '') || ? WHERE id = ?`).run(
        refunded > 0 ? 1 : 0,
        now,
        `Annullato dalla guida${refunded ? ` (acconto rimborsato: ${(refunded / 100).toFixed(2)} €)` : ''}${refundFailed ? ' — RIMBORSO ACCONTO NON RIUSCITO, da fare a mano' : ''}.`,
        id,
      );
      return { outcome: refundFailed ? 'refund_failed' : 'closed', refundedCents: refunded, program: getProgram(db, id) };
    },
  };

  app.payables.register('program', {
    find: (ref) => getProgramByRef(db, ref),
    dueCents: (p) => p.deposit_cents,
    isOpen: (p) => p.status === 'accepted' && p.deposit_status === 'pending' && p.deposit_cents > 0,
    title: (p) => p.proposal_title ?? p.ref,
    onPaid: (p, pi, nowMs) => svc.handleDepositPaid(p.id, pi, nowMs),
    onExpired: () => {},
    startCheckout: (p, lang, nowMs, attempt) => svc.startCheckout(p, lang, nowMs, attempt),
    statusUrl: (p, lang) => `/${lang}/programs/${p.ref}?t=${p.token}`,
  });
  return svc;
}
