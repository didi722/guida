import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

/**
 * Invio email. Con SMTP configurato usa nodemailer; senza, scrive su console e in data/outbox/
 * (comodo in sviluppo e nei test: `mailer.sent` contiene i messaggi inviati).
 */
export function createMailer(cfg) {
  const transport = cfg.mail.host
    ? nodemailer.createTransport({
        host: cfg.mail.host,
        port: cfg.mail.port,
        secure: cfg.mail.secure,
        auth: cfg.mail.user ? { user: cfg.mail.user, pass: cfg.mail.pass } : undefined,
      })
    : null;
  const sent = [];
  let seq = 0;
  const outbox = path.join(cfg.dataDir, 'outbox');

  return {
    sent,
    live: !!transport,
    async send({ to, subject, text, html, replyTo, attachments }) {
      if (!to) return false;
      const msg = { from: cfg.mail.from, to, subject, text, html, replyTo, attachments };
      sent.push({ id: ++seq, at: Date.now(), to, subject, text, html, attachments });
      if (sent.length > 200) sent.shift();
      try {
        if (transport) {
          await transport.sendMail(msg);
        } else if (!process.env.GUIDA_QUIET) {
          fs.mkdirSync(outbox, { recursive: true });
          const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.txt`;
          fs.writeFileSync(path.join(outbox, name), `To: ${to}\nSubject: ${subject}\n\n${text}\n`);
          console.log(`[mail non inviata: SMTP non configurato] a ${to} — ${subject} (salvata in data/outbox/)`);
        }
        return true;
      } catch (err) {
        console.error('[mail] invio fallito:', err.message);
        return false;
      }
    },
  };
}
