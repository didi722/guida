// Posta elettronica certificata (PEC) usata per trasmettere le fatture al Sistema di Interscambio (SdI).
import nodemailer from 'nodemailer';

/**
 * Invio da casella PEC. Senza le credenziali (PEC_SMTP_HOST, PEC_SMTP_USER, PEC_SMTP_PASS) `live` è falso e l'invio a SdI è disattivato:
 * le fatture si scaricano in XML e si caricano a mano dal portale «Fatture e Corrispettivi» dell'Agenzia delle Entrate.
 */
export function createPecMailer(cfg) {
  const c = cfg.invoice.pec;
  const live = !!(c.host && c.user && c.pass);
  const transport = live ? nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass } }) : null;
  return {
    live,
    /** Invia un messaggio dalla casella PEC. Lancia l'errore del server SMTP se l'invio non riesce. */
    async send({ to, subject, text, attachments }) {
      if (!transport) return false;
      await transport.sendMail({ from: c.from || c.user, to, subject, text, attachments });
      return true;
    },
  };
}
