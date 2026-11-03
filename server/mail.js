import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

/**
 * Invio email. Con SMTP configurato usa nodemailer; senza, scrive su console e in data/outbox/
 * (comodo in sviluppo e nei test: `mailer.sent` contiene i messaggi inviati).
 *
 * Ogni messaggio può indicare `from` (altrimenti vale MAIL_FROM), `bcc` e `transport: 'sales'`: le email commerciali partono dalla posta
 * separata (SALES_SMTP_*) se c'è, altrimenti da quella di tutti. Se l'invio non riesce `send` dà `false` e `mailer.lastError` dice perché
 * (per esempio «il server non accetta quel mittente»): serve a spiegarlo nel pannello.
 * `createTransport` si può sostituire (i test non aprono connessioni vere).
 */
export function createMailer(cfg, { createTransport = nodemailer.createTransport } = {}) {
  const open = (c) => (c?.host ? createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined }) : null);
  const transport = open(cfg.mail);
  const salesTransport = open(cfg.mail.sales);
  const sent = [];
  let seq = 0;
  const outbox = path.join(cfg.dataDir, 'outbox');

  const mailer = {
    sent,
    live: !!transport,
    /** Le email commerciali hanno una posta tutta loro (SALES_SMTP_*)? */
    salesLive: !!salesTransport,
    /** Perché l'ultimo invio non è riuscito (vuoto se è riuscito). */
    lastError: '',
    async send({ to, subject, text, html, replyTo, attachments, headers, from, bcc, transport: which }) {
      if (!to) return false;
      const via = which === 'sales' && salesTransport ? salesTransport : transport;
      const msg = { from: from ?? cfg.mail.from, to, bcc, subject, text, html, replyTo, attachments, headers };
      sent.push({ id: ++seq, at: Date.now(), to, subject, text, html, replyTo, attachments, headers, from: msg.from, bcc, via: via === salesTransport && salesTransport ? 'sales' : 'main' });
      if (sent.length > 200) sent.shift();
      try {
        if (via) {
          await via.sendMail(msg);
        } else if (!process.env.GUIDA_QUIET) {
          fs.mkdirSync(outbox, { recursive: true });
          const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.txt`;
          fs.writeFileSync(path.join(outbox, name), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
          console.log(`[mail non inviata: SMTP non configurato] a ${to} — ${subject} (salvata in data/outbox/)`);
        }
        mailer.lastError = '';
        return true;
      } catch (err) {
        mailer.lastError = String(err?.response || err?.message || err).slice(0, 300);
        console.error('[mail] invio fallito:', err.message);
        return false;
      }
    },
  };
  return mailer;
}
