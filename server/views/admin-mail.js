import { html } from '../html.js';
import { adminLayout } from './admin.js';

const when = (ms) => new Date(ms).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'medium' });
const size = (a) => {
  const n = Buffer.isBuffer(a.content) ? a.content.length : String(a.content ?? '').length;
  return n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};

/** Il testo dell'email con i link al sito cliccabili (solo quelli del tuo dominio: un testo scritto da un cliente non deve portarti altrove). */
function linkify(text, base) {
  return String(text ?? '')
    .split(/(https?:\/\/[^\s<>"']+)/)
    .map((part) => (part.startsWith(base + '/') || part === base ? html`<a href="${part}">${part}</a>` : part));
}

export function adminMailPage(ctx, { messages, live }) {
  const base = ctx.app.cfg.baseUrl;
  const body = html`
${live
  ? html`<p class="muted">Email spedite dal sito dall'ultimo avvio (al massimo 200, le più recenti in alto).</p>`
  : html`<div class="notice notice-err" role="note"><strong>SMTP non configurato: le email non vengono spedite.</strong> Qui vedi quelle che il sito avrebbe inviato (dall'ultimo avvio, al massimo 200): conferme, richieste dei partner, approvazioni, buoni regalo, recensioni, fatture. Per spedirle davvero imposta <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> e <code>MAIL_FROM</code>.</div>`}
${messages.length
  ? html`<div class="mail-list">${messages.map((m) => html`<details class="card pad"><summary><strong>${m.subject}</strong><span class="muted small">a ${m.to} · ${when(m.at)}</span></summary>
    <pre class="mail-body">${linkify(m.text, base)}</pre>
    ${m.attachments?.length ? html`<p class="small">Allegati: ${m.attachments.map((a, i) => html`<a href="/admin/mail/${m.id}/attachment/${i}">${a.filename} (${size(a)})</a> `)}</p>` : ''}
  </details>`)}</div>`
  : html`<p class="muted">Ancora nessuna email dall'ultimo avvio.</p>`}`;
  return adminLayout(ctx, { title: 'Email', active: '/admin/mail', body });
}
