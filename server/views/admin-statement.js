// Pannello › Partner › Estratto conto: lo stesso che vede l'agenzia, con PDF, CSV e l'invio per email.
import { html } from '../html.js';
import { makeT } from '../i18n.js';
import { fmtInstant } from '../time.js';
import { adminLayout } from './admin.js';
import { statementBar, statementBlocks } from './statement.js';

const t = makeT('it');

/**
 * @param {object} a l'agenzia · @param {object} o
 * @param {ReturnType<import('../statement.js').statementOf>} o.st
 * @param {{first: string, last: string}} o.range
 * @param {{status: string, sent_at: string}|null} o.sent l'ultimo invio di questo mese
 */
export function adminStatementPage(ctx, a, { st, range, sent = null, autoSend = false, flash = '', error = '' }) {
  const { app } = ctx;
  const base = `/admin/partners/${a.id}/statement`;
  const body = html`
<p><a href="/admin/partners/${a.id}">← ${a.company}</a></p>
<p class="lead">Quello che vede l’agenzia nella sua area riservata, nella sua lingua nel PDF e nell’email.</p>
${statementBar({ t, lang: 'it', st, range, base })}
${statementBlocks({ t, lang: 'it', st, invoiceHref: (inv) => `/admin/invoices/${inv.id}/pdf`, serviceHref: (s) => `/admin/bookings/${s.id}` })}
<form class="card pad form spaced" method="post" action="${base}/send">
  <h2 class="h-sub">Mandalo all’agenzia</h2>
  <p class="small muted">L’email va a <strong>${a.email}</strong> con il PDF di questo mese in allegato${sent ? html` · ultimo invio ${sent.status === 'sent' ? '' : '(saltato) '}${fmtInstant(Date.parse(sent.sent_at), 'it')}` : ''}.
    ${autoSend ? 'L’invio automatico a inizio mese è attivo' : 'L’invio automatico a inizio mese è spento (Impostazioni › Regole di prenotazione)'}${a.statement_email ? '' : '; questa agenzia ha scelto di non riceverlo'}.</p>
  <input type="hidden" name="month" value="${st.month}">
  <div class="btn-row"><button class="btn btn-outline" type="submit" data-confirm="Mandare l’estratto conto a ${a.email}?">Manda ora</button></div>
</form>`;
  return adminLayout(ctx, { title: `Estratto conto · ${a.company}`, active: '/admin/partners', body, flash, error });
}
