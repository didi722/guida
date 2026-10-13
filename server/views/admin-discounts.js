import { html, raw } from '../html.js';
import { formatGiftCode } from '../pricing.js';
import { fmtDate } from '../time.js';
import { formatMoney } from '../util.js';
import { adminLayout, invoiceRow } from './admin.js';
import { langOptions } from './components.js';

const eur = (c) => formatMoney(c, 'it');
const GIFT_STATUS = { active: ['Attivo', 'chip-ok'], pending: ['In attesa di pagamento', 'chip-warn'], void: ['Annullato', 'chip-err'] };
const LEDGER_KIND = { issue: 'Emissione', redeem: 'Utilizzo', restore: 'Ripristino', adjust: 'Rettifica' };

function giftState(card, today) {
  if (card.status === 'active' && card.expires_at && today > card.expires_at) return ['Scaduto', 'chip-err'];
  return GIFT_STATUS[card.status] ?? [card.status, ''];
}

export function discountsPage(ctx, { tab, promos, invites = { n: 0, used: 0 }, gifts, tours, today, flash, error }) {
  const tabs = [['promos', 'Codici sconto'], ['gifts', 'Buoni regalo']];
  const body = html`
<div class="tabs">${tabs.map(([k, l]) => html`<a href="/admin/discounts?tab=${k}" ${tab === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</div>
${tab === 'promos'
  ? html`
${invites.n ? html`<p class="muted"><strong>Inviti a un amico:</strong> ${invites.n} codic${invites.n === 1 ? 'e creato' : 'i creati'}, ${invites.used} già usat${invites.used === 1 ? 'o' : 'i'} (sconto e regole in <a href="/admin/settings">Impostazioni › Invita un amico</a>). Sono codici automatici, non compaiono nell’elenco qui sotto.</p>` : ''}
<div class="card pad">
  <h2>Nuovo codice sconto</h2>
  <form method="post" action="/admin/discounts/promos" class="form">
    <div class="form-grid">
      <label class="field"><span class="label">Codice</span><input name="code" required maxlength="40" placeholder="ESTATE10" autocapitalize="characters"></label>
      <label class="field"><span class="label">Tipo</span><select name="kind"><option value="percent">Percentuale (%)</option><option value="fixed">Importo fisso (€)</option></select></label>
      <label class="field"><span class="label">Valore <em>(% oppure €)</em></span><input name="value" required inputmode="decimal" placeholder="10"></label>
      <label class="field"><span class="label">Usi massimi <em>(vuoto = illimitati)</em></span><input type="number" name="max_uses" min="1"></label>
      <label class="field"><span class="label">Usabile dal <em>(data prenotazione)</em></span><input type="date" name="valid_from"></label>
      <label class="field"><span class="label">Usabile fino al</span><input type="date" name="valid_to"></label>
      <label class="field"><span class="label">Servizi dal <em>(data del tour)</em></span><input type="date" name="service_from"></label>
      <label class="field"><span class="label">Servizi fino al</span><input type="date" name="service_to"></label>
      <label class="field"><span class="label">Importo minimo (€)</span><input name="min_total" inputmode="decimal"></label>
      <label class="field"><span class="label">Nota interna</span><input name="note" maxlength="200"></label>
    </div>
    <fieldset class="check-grid"><legend class="label">Vale per <em>(nessuna selezione = tutti i tour)</em></legend>
      ${tours.map((x) => html`<label class="check"><input type="checkbox" name="tours" value="${x.slug}"> ${x.i18n.it.title}</label>`)}
    </fieldset>
    <label class="check"><input type="checkbox" name="one_per_email" value="1"> Un solo utilizzo per indirizzo email</label>
    <button class="btn btn-gold" type="submit">Crea codice</button>
  </form>
</div>
${promos.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Codice</th><th>Sconto</th><th>Validità</th><th class="num">Usi</th><th>Stato</th><th></th></tr></thead><tbody>
  ${promos.map((p) => html`<tr>
    <td><strong>${p.code}</strong>${p.note ? html`<br><small class="muted">${p.note}</small>` : ''}${p.tours ? html`<br><small class="muted">${JSON.parse(p.tours).join(', ')}</small>` : ''}</td>
    <td>${p.kind === 'percent' ? `${p.value}%` : eur(p.value)}${p.min_total_cents ? html`<br><small class="muted">da ${eur(p.min_total_cents)}</small>` : ''}${p.one_per_email ? html`<br><small class="muted">1 per email</small>` : ''}</td>
    <td><small>${p.valid_from || p.valid_to ? `Prenotazioni: ${p.valid_from ? fmtDate(p.valid_from, 'it', 'short') : '…'} → ${p.valid_to ? fmtDate(p.valid_to, 'it', 'short') : '…'}` : 'Sempre'}</small>${p.service_from || p.service_to ? html`<br><small>Servizi: ${p.service_from ? fmtDate(p.service_from, 'it', 'short') : '…'} → ${p.service_to ? fmtDate(p.service_to, 'it', 'short') : '…'}</small>` : ''}</td>
    <td class="num">${p.uses}${p.max_uses ? ` / ${p.max_uses}` : ''}</td>
    <td><span class="chip ${p.active ? 'chip-ok' : 'chip-err'}">${p.active ? 'Attivo' : 'Disattivato'}</span></td>
    <td class="actions"><form method="post" action="/admin/discounts/promos/${p.id}/toggle"><button class="btn btn-sm btn-outline" type="submit">${p.active ? 'Disattiva' : 'Attiva'}</button></form>
      ${p.uses === 0 ? html`<form method="post" action="/admin/discounts/promos/${p.id}/delete" data-confirm="Eliminare il codice ${p.code}?"><button class="btn btn-sm btn-outline" type="submit">Elimina</button></form>` : ''}</td>
  </tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessun codice sconto.</p>`}`
  : html`
<div class="card pad">
  <h2>Nuovo buono regalo</h2>
  <p class="muted">Per i buoni venduti di persona o regalati. L’acquisto online dal sito crea i buoni da solo, dopo il pagamento.</p>
  <form method="post" action="/admin/discounts/gifts" class="form">
    <div class="form-grid">
      <label class="field"><span class="label">Importo (€)</span><input name="amount" required inputmode="decimal" placeholder="100"></label>
      <label class="field"><span class="label">Scadenza <em>(vuoto = ${ctx.app.cfg.gift.validityMonths} mesi)</em></span><input type="date" name="expires_at"></label>
      <label class="field"><span class="label">Acquirente</span><input name="buyer_name" maxlength="120"></label>
      <label class="field"><span class="label">Email acquirente</span><input type="email" name="buyer_email" maxlength="200"></label>
      <label class="field"><span class="label">Destinatario</span><input name="recipient_name" maxlength="120"></label>
      <label class="field"><span class="label">Email destinatario</span><input type="email" name="recipient_email" maxlength="200"></label>
      <label class="field"><span class="label">Lingua</span><select name="lang">${langOptions('it')}</select></label>
      <label class="field"><span class="label">Invia email</span><select name="notify"><option value="none">Nessuna (consegno io)</option><option value="buyer">All’acquirente</option><option value="recipient">Al destinatario</option></select></label>
    </div>
    <label class="field"><span class="label">Messaggio <em>(facoltativo)</em></span><textarea name="message" rows="2" maxlength="400"></textarea></label>
    <button class="btn btn-gold" type="submit">Crea buono</button>
  </form>
</div>
${gifts.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Codice</th><th>Da / per</th><th class="num">Importo</th><th class="num">Saldo</th><th>Stato</th></tr></thead><tbody>
  ${gifts.map((g) => {
    const [label, cls] = giftState(g, today);
    return html`<tr>
      <td><a href="/admin/discounts/gifts/${g.id}"><strong>${formatGiftCode(g.code)}</strong></a><br><small class="muted">${g.ref} · ${g.source === 'admin' ? 'admin' : 'sito'}</small></td>
      <td>${g.buyer_name ?? '—'}${g.recipient_name || g.recipient_email ? html`<br><small class="muted">→ ${g.recipient_name ?? g.recipient_email}</small>` : ''}</td>
      <td class="num">${eur(g.initial_cents)}</td><td class="num"><strong>${eur(g.balance_cents)}</strong></td>
      <td><span class="chip ${cls}">${label}</span>${g.expires_at ? html`<br><small class="muted">fino al ${fmtDate(g.expires_at, 'it', 'short')}</small>` : ''}</td></tr>`;
  })}
  </tbody></table></div>`
  : html`<p class="muted">Nessun buono regalo.</p>`}`}`;
  return adminLayout(ctx, { title: 'Sconti e buoni', active: '/admin/discounts', body, flash, error });
}

export function giftDetailPage(ctx, card, ledger, today, flash = '', error = '', invoice = null) {
  const [label, cls] = giftState(card, today);
  const body = html`
<p><a href="/admin/discounts?tab=gifts">← Tutti i buoni</a></p>
<div class="grid grid-2 admin-detail">
  <div class="card pad">
    <p class="ref-line"><span class="chip ${cls}">${label}</span> <strong class="ref">${formatGiftCode(card.code)}</strong></p>
    <dl class="summary-list">
      <div><dt>Ordine</dt><dd>${card.ref} · ${card.source === 'admin' ? 'creato da admin' : 'acquistato sul sito'}</dd></div>
      <div><dt>Importo / saldo</dt><dd>${eur(card.initial_cents)} / <strong>${eur(card.balance_cents)}</strong></dd></div>
      <div><dt>Scadenza</dt><dd>${card.expires_at ? fmtDate(card.expires_at, 'it') : '—'}</dd></div>
      <div><dt>Acquirente</dt><dd>${card.buyer_name ?? '—'}${card.buyer_email ? html` · <a href="mailto:${card.buyer_email}">${card.buyer_email}</a>` : ''}</dd></div>
      <div><dt>Destinatario</dt><dd>${card.recipient_name ?? '—'}${card.recipient_email ? html` · <a href="mailto:${card.recipient_email}">${card.recipient_email}</a>` : ''}${card.deliver_on ? html`<br><small class="muted">invio ${fmtDate(card.deliver_on, 'it', 'short')}${card.delivered_at ? ' (inviato)' : ' (da inviare)'}</small>` : ''}</dd></div>
      ${card.message ? html`<div><dt>Messaggio</dt><dd>${card.message}</dd></div>` : ''}
      ${card.status === 'active' || invoice ? invoiceRow(invoice, { warn: true }) : ''}
    </dl>
    <p class="btn-row">
      <a class="btn btn-outline btn-sm" href="/admin/discounts/gifts/${card.id}/card.pdf">PDF del buono</a>
      ${card.status === 'active' && card.buyer_email ? html`<form method="post" action="/admin/discounts/gifts/${card.id}/resend"><input type="hidden" name="to" value="buyer"><button class="btn btn-outline btn-sm" type="submit">Reinvia all’acquirente</button></form>` : ''}
      ${card.status === 'active' && card.recipient_email ? html`<form method="post" action="/admin/discounts/gifts/${card.id}/resend"><input type="hidden" name="to" value="recipient"><button class="btn btn-outline btn-sm" type="submit">Reinvia al destinatario</button></form>` : ''}
    </p>
  </div>
  ${card.status === 'active'
    ? html`<div class="card pad">
    <form method="post" action="/admin/discounts/gifts/${card.id}/adjust" class="form">
      <h2>Rettifica il saldo</h2>
      <div class="form-grid">
        <label class="field"><span class="label">Importo (€) <em>positivo aggiunge, negativo toglie</em></span><input name="amount" required inputmode="decimal" placeholder="-20"></label>
        <label class="field"><span class="label">Motivo</span><input name="note" maxlength="200"></label>
      </div>
      <button class="btn btn-outline" type="submit">Applica</button>
    </form>
    <form method="post" action="/admin/discounts/gifts/${card.id}/expiry" class="form inline-form"><h3>Scadenza</h3><input type="date" name="expires_at" value="${card.expires_at ?? ''}" required><button class="btn btn-outline btn-sm" type="submit">Cambia</button></form>
    <form method="post" action="/admin/discounts/gifts/${card.id}/void" class="form" data-confirm="Annullare il buono? Il saldo residuo andrà a zero."><label class="field"><span class="label">Annulla il buono</span><input name="note" maxlength="200" placeholder="Motivo (facoltativo)"></label><button class="btn btn-danger btn-sm" type="submit">Annulla buono</button></form>
  </div>`
    : ''}
</div>
<h2 class="h-sub spaced">Movimenti</h2>
<div class="card table-wrap"><table class="table"><thead><tr><th>Quando</th><th>Movimento</th><th class="num">Importo</th><th>Nota</th></tr></thead><tbody>
${ledger.map((l) => html`<tr><td>${new Date(l.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}</td><td>${LEDGER_KIND[l.kind] ?? l.kind}${l.booking_id ? html` · <a href="/admin/bookings/${l.booking_id}">prenotazione</a>` : ''}</td><td class="num">${l.delta_cents > 0 ? '+' : ''}${eur(l.delta_cents)}</td><td>${l.note ?? ''}</td></tr>`)}
</tbody></table></div>`;
  return adminLayout(ctx, { title: 'Buono regalo', active: '/admin/discounts', body, flash, error });
}
