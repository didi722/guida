// Fatture: collega la logica (invoices.js) a email e PEC.
import { InvoiceError, configProblems, createCreditNote, createDrafts, createManualDraft, deleteDraft, discardIssued, getInvoice, invoiceDetail, invoiceQueue, invoicesCsv, issueInvoice, saveDraft, setSdiStatus, settingsOf } from './invoices.js';
import { notifyGuideInvoice, sendInvoiceCopy, sendInvoiceOverdue, sendInvoicePaid } from './emails.js';
import { makeT } from './i18n.js';
import { ensurePayRef, getInvoiceByPayRef, invoiceDue, invoiceEmail, isPayable, markInvoicePaid, openPartsCents, payState, remindersDue, unmarkInvoicePaid } from './invoicePayments.js';
import { normLang } from './langs.js';
import { onlinePaymentsOpen } from './opening.js';
import { isDate, localToInstant, nowRome } from './time.js';
import { isEmail } from './util.js';

export function createInvoiceServices(app) {
  const { db, cfg, payments } = app;
  const need = (id) => {
    const inv = getInvoice(db, id);
    if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
    return inv;
  };
  const RETRY_MS = 15 * 60_000;
  const retryAfter = new Map(); // fattura → quando riprovare un sollecito che non è partito
  const svc = {
    settings: () => settingsOf(cfg),
    problems: () => configProblems(cfg),
    get pecConfigured() {
      return app.pec.live;
    },
    queue: (nowMs) => invoiceQueue(app, nowMs),
    optionalQueue: (nowMs) => invoiceQueue(app, nowMs, { optional: true }),
    detail: (id) => invoiceDetail(app, id),
    createDrafts: (keys, nowMs) => createDrafts(app, keys, nowMs),
    createManual: (nowMs) => createManualDraft(app, nowMs),
    save: (id, form, nowMs) => saveDraft(app, id, form, nowMs),
    remove: (id) => deleteDraft(app, id),
    issue: (id, nowMs) => issueInvoice(app, id, nowMs),
    creditNote: (id, nowMs) => createCreditNote(app, id, nowMs),
    discard: (id, nowMs) => discardIssued(app, id, nowMs),
    setStatus: (id, status, note, nowMs) => setSdiStatus(app, id, status, note, nowMs),
    csv: (year) => invoicesCsv(app, year),

    /** Trasmette l'XML a SdI dalla casella PEC. Resta «inviata» finché non registri l'esito. */
    async sendToSdi(id, nowMs = Date.now()) {
      const inv = need(id);
      if (!['issued', 'undelivered'].includes(inv.status)) throw new InvoiceError('state', 'si trasmette solo una fattura emessa e non ancora inviata (se è già «inviata» aspetta l’esito di SdI)');
      if (!app.pec.live) throw new InvoiceError('pec', 'la PEC non è configurata (PEC_SMTP_HOST, PEC_SMTP_USER, PEC_SMTP_PASS)');
      try {
        await app.pec.send({ to: cfg.invoice.sdiAddress, subject: inv.file_name, text: `Fattura ${inv.number}`, attachments: [{ filename: inv.file_name, content: inv.xml, contentType: 'application/xml' }] });
      } catch (err) {
        console.error('[fatture] invio PEC fallito:', err.message);
        throw new InvoiceError('pec', `invio PEC non riuscito: ${err.message}`);
      }
      const now = new Date(nowMs).toISOString();
      // nel frattempo la fattura potrebbe essere stata annullata o aggiornata da un'altra scheda: si aggiorna solo se è ancora allo stato di partenza
      const changed = db.prepare(`UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, ?), status_at = ?, updated_at = ? WHERE id = ? AND status = ?`).run(now, now, now, id, inv.status).changes;
      if (!changed) console.error(`[fatture] la fattura ${id} è cambiata durante l'invio PEC: controlla lo stato e l'esito su SdI`);
      return getInvoice(db, id);
    },

    /** Manda al cliente la copia di cortesia (PDF, e se vuoi anche l'XML). */
    async emailCopy(id, to, { includeXml = false } = {}, nowMs = Date.now()) {
      const inv = need(id);
      if (inv.status === 'draft') throw new InvoiceError('state', 'prima emetti la fattura');
      if (!isEmail(String(to ?? '').trim())) throw new InvoiceError('buyer', 'indirizzo email non valido');
      const ok = await sendInvoiceCopy(app, inv, String(to).trim(), { includeXml });
      if (!ok) throw new InvoiceError('pec', 'invio email non riuscito: controlla le impostazioni SMTP');
      const now = new Date(nowMs).toISOString();
      db.prepare('UPDATE invoices SET emailed_at = ?, updated_at = ? WHERE id = ?').run(now, now, id);
      return getInvoice(db, id);
    },

    // ───── incasso, pagamento con carta, solleciti ─────
    /** Si può pagare adesso con la carta? (fattura da pagare, e incassi online aperti) */
    canPayByCard: (inv, nowMs = Date.now()) => isPayable(inv) && invoiceDue(inv) > 0 && onlinePaymentsOpen(app, nowMs),

    /** Crea la sessione di pagamento con carta per ciò che resta da pagare della fattura. Ritorna l'URL a cui mandare l'agenzia. */
    async startCheckout(inv, lang, nowMs = Date.now(), attempt = 0) {
      const pay = ensurePayRef(db, inv);
      const to = invoiceEmail(db, pay);
      const l = normLang(to.lang);
      const session = await payments.createCheckout({
        ref: pay.pay_ref,
        email: to.email || undefined,
        amountCents: invoiceDue(pay),
        currency: pay.currency,
        title: makeT(l)('invpay.title', { number: pay.number }),
        description: `${cfg.site.name} · ${makeT(l)('invpay.title', { number: pay.number })}`,
        lang: l,
        successUrl: `${cfg.baseUrl}/${lang}/invoices/${pay.pay_ref}?t=${pay.pay_token}&paid=1`,
        cancelUrl: `${cfg.baseUrl}/${lang}/invoices/${pay.pay_ref}?t=${pay.pay_token}&canceled=1`,
        demoUrl: `${cfg.baseUrl}/pay/demo/${pay.pay_ref}?t=${pay.pay_token}&lang=${lang}`,
        nowMs,
        attempt,
      });
      db.prepare('UPDATE invoices SET stripe_session_id = ? WHERE id = ?').run(session.id, pay.id);
      return session.url;
    },

    /** Pagamento con carta ricevuto (webhook, ritorno da Stripe, demo): la fattura e le sue prenotazioni risultano pagate. */
    async handleCardPaid(id, paymentIntent = null, nowMs = Date.now()) {
      const before = need(id);
      const cents = openPartsCents(before);
      const res = markInvoicePaid(app, id, { method: 'card', paymentIntent }, nowMs);
      if (res.already) {
        // un secondo pagamento (due sessioni aperte): si rimborsa
        if (paymentIntent && before.stripe_payment_intent && paymentIntent !== before.stripe_payment_intent) {
          try {
            await payments.refund({ paymentIntent, cents, ref: `${before.pay_ref}-dup` });
          } catch (err) {
            console.error(`[rimborso doppio pagamento] fattura ${before.number}:`, err.message);
          }
        }
        return res;
      }
      const to = invoiceEmail(db, res.invoice);
      if (to.email) await sendInvoicePaid(app, res.invoice, { to: to.email, lang: to.lang, amountCents: cents });
      await notifyGuideInvoice(app, res.invoice, 'paid', `Importo: ${(cents / 100).toFixed(2).replace('.', ',')} €`);
      return res;
    },

    /** La guida segna l'incasso (di solito un bonifico arrivato): `date` è il giorno in cui è arrivato. L'agenzia riceve la ricevuta. */
    async markPaid(id, { date = null, method = 'bank', notify = true } = {}, nowMs = Date.now()) {
      const inv = need(id);
      if (inv.doc_type !== 'TD01' || !inv.number || inv.credited) throw new InvoiceError('state', 'si incassa solo una fattura emessa e non stornata');
      const paidAt = isDate(date) ? new Date(localToInstant(date, '12:00')).toISOString() : null;
      const cents = openPartsCents(need(id));
      const res = markInvoicePaid(app, id, { method: ['bank', 'other'].includes(method) ? method : 'bank', paidAt }, nowMs);
      if (!res.already && notify) {
        const to = invoiceEmail(db, res.invoice);
        if (to.email) await sendInvoicePaid(app, res.invoice, { to: to.email, lang: to.lang, amountCents: cents });
      }
      return res;
    },

    /** Toglie un incasso segnato per errore. */
    unmarkPaid(id, nowMs) {
      try {
        return unmarkInvoicePaid(app, id, nowMs);
      } catch (e) {
        throw new InvoiceError('state', e.message);
      }
    },

    /**
     * Manda il sollecito di una fattura scaduta (o, a mano, un promemoria prima della scadenza).
     * @returns {Promise<boolean>} false se non c'era nulla da sollecitare o manca l'email
     */
    async remind(id, nowMs = Date.now(), { manual = false } = {}) {
      const inv = need(id);
      const st = payState(inv, nowRome(nowMs).date);
      if (st.state !== 'overdue' && !(manual && st.state === 'open')) return false;
      const to = invoiceEmail(db, inv);
      if (!to.email) return false;
      const now = new Date(nowMs).toISOString();
      const claimed = db.prepare('UPDATE invoices SET overdue_reminded_at = ?, overdue_reminders = overdue_reminders + 1 WHERE id = ? AND overdue_reminders = ?').run(now, id, inv.overdue_reminders).changes;
      if (claimed !== 1) return false; // un altro giro l'ha già mandato
      const rollback = () => {
        db.prepare('UPDATE invoices SET overdue_reminded_at = ?, overdue_reminders = ? WHERE id = ?').run(inv.overdue_reminded_at, inv.overdue_reminders, id);
        retryAfter.set(id, nowMs + RETRY_MS); // niente tentativi ogni minuto se la posta non funziona
      };
      let sent;
      try {
        sent = await sendInvoiceOverdue(app, getInvoice(db, id), { to: to.email, lang: to.lang });
      } catch (err) {
        rollback();
        throw err;
      }
      if (sent === false) {
        rollback();
        return false;
      }
      await notifyGuideInvoice(app, getInvoice(db, id), 'overdue', `${st.state === 'overdue' ? `Scaduta da ${st.days} ${st.days === 1 ? 'giorno' : 'giorni'}` : 'Promemoria prima della scadenza'} · sollecito n. ${inv.overdue_reminders + 1} a ${to.email}`);
      return true;
    },

    /** Lavoro periodico: i solleciti delle fatture scadute. */
    async sweepOverdue(nowMs = Date.now()) {
      let n = 0;
      for (const { inv } of remindersDue(app, nowMs)) if (!(retryAfter.get(inv.id) > nowMs) && (await svc.remind(inv.id, nowMs))) n++;
      return n;
    },
  };

  app.jobs.push((nowMs) => svc.sweepOverdue(nowMs));

  // Le fatture si pagano con lo stesso meccanismo (webhook, ripresa, pagina demo) di prenotazioni, pacchetti, gift card e acconti.
  app.payables.register('invoice', {
    // le rotte generiche di /pay/* leggono `ref` e `token`: per le fatture sono `pay_ref` e `pay_token`
    find: (ref) => {
      const inv = getInvoiceByPayRef(db, ref);
      return inv && { ...inv, ref: inv.pay_ref, token: inv.pay_token };
    },
    dueCents: invoiceDue,
    isOpen: (inv) => svc.canPayByCard(inv),
    title: (inv, lang) => makeT(lang)('invpay.title', { number: inv.number }),
    onPaid: (inv, pi, nowMs) => svc.handleCardPaid(inv.id, pi, nowMs),
    onExpired: () => {},
    startCheckout: (inv, lang, nowMs, attempt) => svc.startCheckout(inv, lang, nowMs, attempt),
    statusUrl: (inv, lang) => `/${lang}/invoices/${inv.pay_ref}?t=${inv.pay_token}`,
  });
  return svc;
}
