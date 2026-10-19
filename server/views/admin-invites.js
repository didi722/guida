// Clienti › Partner › Inviti: la guida invita un'agenzia con un collegamento personale; l'account nasce già approvato.
import { html } from '../html.js';
import { INVITE_DAYS } from '../partnerInvites.js';
import { LANG_META } from '../langs.js';
import { adminLayout } from './admin.js';
import { partnerTabs } from './admin-partners.js';

const when = (iso) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', year: 'numeric' });
const STATE = {
  open: ['chip-warn', 'In attesa'],
  used: ['chip-ok', 'Registrata'],
  expired: ['chip-err', 'Scaduto'],
  cancelled: ['', 'Annullato'],
};

/**
 * @param {object} o
 * @param {object[]} o.invites gli inviti (con `state`)
 * @param {object} [o.values] ciò che si è appena scritto nel modulo (se c'è un errore)
 * @param {{ invite: object, url: string, sent: boolean }|null} [o.fresh] il collegamento appena creato: si vede solo ora
 */
export function invitesPage(ctx, { invites, values = {}, flash = '', error = '', fresh = null }) {
  const v = (k) => values[k] ?? '';
  const body = html`
${partnerTabs('invites')}
<p class="muted">Per portare in squadra un’agenzia che conosci: scrivi la sua email e il sito le manda un <strong>collegamento personale</strong>. Registrandosi da lì l’agenzia ha <strong>l’account già approvato</strong>, senza attendere te. Il collegamento vale ${INVITE_DAYS} giorni e una volta sola; chi ha già un account non serve invitarlo. Alla registrazione il sito controlla la partita IVA (formato e VIES) e ti scrive.</p>
${fresh
  ? html`<div class="notice ${fresh.sent ? 'notice-ok' : 'notice-err'}" role="status">
  <p>${fresh.sent ? html`Invito mandato a <strong>${fresh.invite.email}</strong>.` : html`<strong>L’email non è partita</strong> (controlla la posta in <em>Aiuto › Email</em>): puoi mandare tu il collegamento.`}</p>
  <p class="small"><strong>Collegamento personale</strong> <em class="muted">(si vede solo adesso: poi, con «Rinvia», se ne crea uno nuovo)</em></p>
  <p class="copy-line"><input class="copy-field" id="invite-link" readonly data-select-all value="${fresh.url}" aria-label="Collegamento personale"><button class="btn btn-outline btn-sm" type="button" data-copy="#invite-link" data-copied="Copiato">Copia</button></p>
</div>`
  : ''}
<form method="post" action="/admin/partners/invites" class="card pad form">
  <h2>Invita un’agenzia</h2>
  <div class="form-grid">
    <label class="field"><span class="label">Email dell’agenzia</span><input type="email" name="email" required maxlength="254" value="${v('email')}" autocomplete="off" placeholder="nome@agenzia.it"></label>
    <label class="field"><span class="label">Lingua dell’invito</span><select name="lang">${Object.entries(LANG_META).map(([code, m]) => html`<option value="${code}" ${(v('lang') || 'it') === code ? 'selected' : ''}>${m.name}</option>`)}</select></label>
    <label class="field"><span class="label">Agenzia <em>(facoltativo: compare già scritta nel modulo)</em></span><input name="company" maxlength="160" value="${v('company')}" autocomplete="off"></label>
    <label class="field"><span class="label">Referente <em>(facoltativo: «Ciao Anna,»)</em></span><input name="contactName" maxlength="120" value="${v('contactName')}" autocomplete="off"></label>
  </div>
  <label class="field"><span class="label">Un messaggio per lei <em>(facoltativo: compare nell’email)</em></span><textarea name="note" rows="3" maxlength="600">${v('note')}</textarea></label>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Invia l’invito</button></div>
</form>
<h2 class="h-sub spaced">Inviti mandati ${invites.length ? html`<span class="chip">${invites.length}</span>` : ''}</h2>
${invites.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Agenzia</th><th>Stato</th><th>Inviato</th><th></th></tr></thead><tbody>
  ${invites.map((i) => {
    const [chip, label] = STATE[i.state];
    return html`<tr><td><strong>${i.company || i.email}</strong><br><small class="muted">${i.company ? html`${i.email} · ` : ''}${LANG_META[i.lang]?.name ?? i.lang}</small></td>
    <td><span class="chip ${chip}">${label}</span><br><small class="muted">${i.state === 'used' ? html`${when(i.used_at)}${i.account_id ? html` · <a href="/admin/partners/${i.account_id}">apri la scheda</a>` : ''}` : i.state === 'open' ? `scade il ${when(i.expires_at)}` : i.state === 'expired' ? `scaduto il ${when(i.expires_at)}` : ''}</small></td>
    <td>${i.sent_at ? when(i.sent_at) : html`<span class="muted">non partito</span>`}<br><small class="muted">creato il ${when(i.created_at)}</small></td>
    <td class="actions">${['open', 'expired'].includes(i.state) ? html`<form method="post" action="/admin/partners/invites/${i.id}/resend"><button class="btn btn-sm btn-outline" type="submit">Rinvia</button></form>` : ''}
      ${i.state === 'open' ? html`<form method="post" action="/admin/partners/invites/${i.id}/cancel" data-confirm="Annullare l’invito a ${i.email}? Il collegamento smette di valere."><button class="btn btn-sm btn-link-danger" type="submit">Annulla</button></form>` : ''}</td></tr>`;
  })}
  </tbody></table></div>`
  : html`<div class="card pad muted">Nessun invito ancora.</div>`}`;
  return adminLayout(ctx, { title: 'Partner B2B', active: '/admin/partners', body, flash, error });
}
