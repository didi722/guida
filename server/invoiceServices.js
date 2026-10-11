// Fatture: collega la logica (invoices.js) a email e PEC.
import { InvoiceError, configProblems, createCreditNote, createDrafts, createManualDraft, deleteDraft, discardIssued, getInvoice, invoiceDetail, invoiceQueue, invoicesCsv, issueInvoice, saveDraft, setSdiStatus, settingsOf } from './invoices.js';
import { sendInvoiceCopy } from './emails.js';
import { isEmail } from './util.js';

export function createInvoiceServices(app) {
  const { db, cfg } = app;
  const need = (id) => {
    const inv = getInvoice(db, id);
    if (!inv) throw new InvoiceError('notfound', 'fattura non trovata');
    return inv;
  };
  return {
    settings: () => settingsOf(cfg),
    problems: () => configProblems(cfg),
    get pecConfigured() {
      return app.pec.live;
    },
    queue: (nowMs) => invoiceQueue(app, nowMs),
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
  };
}
