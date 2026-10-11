import { html, raw } from '../html.js';
import { makeT } from '../i18n.js';
import { MAX_TIERS, accountTiers } from '../policy.js';
import { tierSentences } from '../policyText.js';
import { accountPrices, unitPriceFor } from '../pricing.js';
import { addDays, fmtDate, localToInstant, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { STATUS_IT, adminLayout } from './admin.js';

const ST = { pending: 'Da approvare', approved: 'Approvato', rejected: 'Rifiutato', suspended: 'Sospeso' };
const chip = (s) => ({ confirmed: 'chip-ok', held: 'chip-warn', cancelled: 'chip-err', expired: 'chip-err' }[s] ?? '');
const eur = (c) => formatMoney(c, 'it');
const euroInput = (c) => (c == null ? '' : c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100));
const splitHours = (h) => (h >= 48 && h % 24 === 0 ? { value: h / 24, unit: 'd' } : { value: h, unit: 'h' });

/** Modelli di politica: [ore (o giorni), unità, rimborso %] per riga. */
const PRESETS = [
  ['Standard (3 giorni)', [[3, 'd', 100]]],
  ['Flessibile (24 ore)', [[24, 'h', 100]]],
  ['Intermedia (7 giorni 100% · 3 giorni 50%)', [[7, 'd', 100], [3, 'd', 50]]],
  ['Rigida (14 giorni 100% · 7 giorni 50%)', [[14, 'd', 100], [7, 'd', 50]]],
];

export function partnersPage(ctx, { items, filter }) {
  const tabs = [['all', 'Tutti'], ['pending', 'Da approvare'], ['approved', 'Approvati']];
  const body = html`<div class="tabs">${tabs.map(([k, l]) => html`<a href="/admin/partners?f=${k}" ${filter === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</div>
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Azienda</th><th>Referente</th><th>Stato</th><th>Condizioni</th><th class="num">Prenotazioni</th></tr></thead><tbody>
    ${items.map((a) => {
      const prices = Object.keys(accountPrices(a)).length;
      return html`<tr><td><a href="/admin/partners/${a.id}"><strong>${a.company}</strong></a><br><small class="muted">${a.country ?? ''} ${a.vat ?? ''}</small></td><td>${a.contact_name}<br><small class="muted">${a.email}</small></td>
      <td><span class="chip ${a.status === 'approved' ? 'chip-ok' : a.status === 'pending' ? 'chip-warn' : 'chip-err'}">${ST[a.status]}</span></td>
      <td><small>${a.discount_percent ? `sconto ${a.discount_percent}%` : 'tariffa B2B'}${prices ? ` · ${prices} prezz${prices === 1 ? 'o dedicato' : 'i dedicati'}` : ''}${a.cancel_policy_json || a.cancel_hours != null ? ' · annullo dedicato' : ''}</small></td><td class="num">${a.bookings}</td></tr>`;
    })}
  </tbody></table></div>`
  : html`<p class="muted">Nessun partner.</p>`}`;
  return adminLayout(ctx, { title: 'Partner B2B', active: '/admin/partners', body });
}

export function partnerDetailPage(ctx, a, { bookings, others, flash = '', error = '' }) {
  const { app } = ctx;
  const { cfg, content } = app;
  const tours = content.tours;
  const dedicated = accountPrices(a);
  const custom = !!(a.cancel_policy_json || a.cancel_hours != null);
  const tiers = accountTiers(cfg, a);
  const rows = Array.from({ length: MAX_TIERS }, (_, i) => (custom && tiers[i] ? { ...splitHours(tiers[i].hours), refund: tiers[i].refund } : { value: '', unit: 'd', refund: '' }));
  const sampleDate = addDays(nowRome().date, 30);
  const sample = tierSentences(makeT('it'), 'it', tiers, localToInstant(sampleDate, '10:00'));
  const copyOptions = others.map((o) => html`<option value="${o.id}">${o.company}</option>`);

  const body = html`
<p><a href="/admin/partners">← Tutti i partner</a></p>
<div class="grid grid-2 admin-detail">
  <div class="card pad"><h2>${a.company} <span class="chip ${a.status === 'approved' ? 'chip-ok' : a.status === 'pending' ? 'chip-warn' : 'chip-err'}">${ST[a.status]}</span></h2>
    <dl class="summary-list">
      <div><dt>P.IVA / VAT</dt><dd>${a.vat ?? ''} ${a.country ? '(' + a.country + ')' : ''}</dd></div>
      <div><dt>SDI / PEC</dt><dd>${a.sdi_code ?? '—'} / ${a.pec ?? '—'}</dd></div>
      ${a.address ? html`<div><dt>Indirizzo</dt><dd>${a.address}</dd></div>` : ''}
      <div><dt>Referente</dt><dd>${a.contact_name} · <a href="mailto:${a.email}">${a.email}</a>${a.phone ? html` · <a href="tel:${a.phone}">${a.phone}</a>` : ''}</dd></div>
      ${a.website ? html`<div><dt>Sito</dt><dd><a href="${a.website}" rel="noopener nofollow" target="_blank">${a.website}</a></dd></div>` : ''}
      ${a.message ? html`<div><dt>Messaggio</dt><dd>${a.message}</dd></div>` : ''}
      <div><dt>Registrato</dt><dd>${new Date(a.created_at).toLocaleDateString('it-IT')}</dd></div>
    </dl></div>
  <form class="card pad form" method="post" action="/admin/partners/${a.id}">
    <h2>Stato e pagamento</h2>
    <label class="field"><span class="label">Stato</span><select name="status">${[['pending', 'Da approvare'], ['approved', 'Approvato'], ['rejected', 'Rifiutato'], ['suspended', 'Sospeso']].map(([v, l]) => html`<option value="${v}" ${a.status === v ? raw('selected') : ''}>${l}</option>`)}</select></label>
    <label class="field"><span class="label">Sconto su tutto il listino (%) <em>— vale per i tour senza prezzo dedicato</em></span><input type="number" name="discount_percent" min="0" max="60" step="0.5" value="${a.discount_percent}"></label>
    <label class="check"><input type="checkbox" name="allow_invoice" value="1" ${a.allow_invoice ? raw('checked') : ''}> Può pagare a fattura / bonifico</label>
    <label class="field"><span class="label">Note interne</span><textarea name="admin_notes" rows="3" maxlength="2000">${a.admin_notes ?? ''}</textarea></label>
    <button class="btn btn-gold" type="submit">Salva${a.status === 'pending' ? ' (e approva se imposti "Approvato")' : ''}</button>
  </form>
</div>

<h2 class="h-sub spaced" id="listino">Listino dedicato</h2>
<form class="card pad form" method="post" action="/admin/partners/${a.id}/prices">
  <p class="muted">Scrivi il prezzo che questo partner paga per ogni tour. <strong>Lascia vuoto</strong> per applicare la tariffa B2B${a.discount_percent ? ` con lo sconto del ${a.discount_percent}%` : ''}. Il prezzo è «a persona» o «a gruppo» come nel tour.</p>
  <div class="table-wrap"><table class="table price-table"><thead><tr><th>Tour</th><th class="num">Pubblico</th><th class="num">Tariffa B2B</th><th class="num">Prezzo dedicato (€)</th><th class="num">Applicato</th></tr></thead><tbody>
    ${tours.map((x) => {
      const applied = unitPriceFor(x, 'b2b', a);
      const own = dedicated[x.slug] != null;
      return html`<tr><td><strong>${x.i18n.it.title}</strong><br><small class="muted">${x.model === 'person' ? 'a persona' : 'a gruppo'}</small></td>
        <td class="num muted">${eur(x.priceCents)}</td><td class="num muted">${eur(x.b2bPriceCents)}</td>
        <td class="num"><input class="price-input" name="price_${x.slug}" inputmode="decimal" autocomplete="off" value="${euroInput(dedicated[x.slug])}" placeholder="${euroInput(own ? unitPriceFor(x, 'b2b', { ...a, prices_json: null }) : applied)}" aria-label="Prezzo dedicato per ${x.i18n.it.title}"></td>
        <td class="num"><strong>${eur(applied)}</strong>${own ? html` <span class="chip chip-accent">dedicato</span>` : ''}</td></tr>`;
    })}
  </tbody></table></div>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva il listino</button></div>
</form>
${others.length
  ? html`<form class="inline-form copy-form" method="post" action="/admin/partners/${a.id}/prices"><input type="hidden" name="action" value="copy"><label class="small muted">Copia il listino da</label> <select name="copy_from">${copyOptions}</select> <button class="btn btn-outline btn-sm" type="submit" data-confirm="Sostituire il listino di ${a.company} con quello scelto?">Copia</button></form>`
  : ''}

<h2 class="h-sub spaced" id="annullo">Politica di annullo</h2>
<form class="card pad form" method="post" action="/admin/partners/${a.id}/policy" id="policy-form">
  <p class="muted">${custom ? 'Questo partner ha una politica propria.' : html`Ora vale quella predefinita del sito: <strong>rimborso totale fino a ${cfg.policy.b2bFreeCancelHours} ore prima</strong>. Compila le righe per personalizzarla.`}
  Il rimborso non può aumentare avvicinandosi al servizio; dopo l'ultimo scaglione <strong>non si rimborsa nulla</strong>. Chi paga a fattura riceve una <strong>penale</strong> pari alla parte non rimborsata, che compare in <a href="/admin/invoices">Fatture → Da fatturare</a>.</p>
  <div class="tier-rows">${rows.map((row, i) => html`<div class="tier-row"><span class="muted">Fino a</span>
    <input name="h${i + 1}" inputmode="numeric" value="${row.value}" aria-label="Preavviso, scaglione ${i + 1}" class="tier-num">
    <select name="u${i + 1}" aria-label="Unità"><option value="d" ${row.unit === 'd' ? raw('selected') : ''}>giorni</option><option value="h" ${row.unit === 'h' ? raw('selected') : ''}>ore</option></select>
    <span class="muted">prima dell'inizio: rimborso</span>
    <input name="r${i + 1}" inputmode="numeric" value="${row.refund}" aria-label="Rimborso, scaglione ${i + 1}" class="tier-num"><span>%</span></div>`)}</div>
  <p class="small muted">Modelli: ${PRESETS.map(([label, preset]) => html`<button class="btn btn-outline btn-sm" type="button" data-preset="${JSON.stringify(preset)}">${label}</button> `)}<button class="btn btn-outline btn-sm" type="button" data-preset="[]">Svuota (predefinito del sito)</button></p>
  <div class="policy-box ok"><strong>Per un servizio il ${fmtDate(sampleDate, 'it', 'date')} alle 10:00:</strong><ul class="plain tier-list">${sample.map((x) => html`<li>${x}</li>`)}</ul></div>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva la politica</button></div>
</form>
${others.length
  ? html`<form class="inline-form copy-form" method="post" action="/admin/partners/${a.id}/policy"><input type="hidden" name="action" value="copy"><label class="small muted">Copia la politica da</label> <select name="copy_from">${copyOptions}</select> <button class="btn btn-outline btn-sm" type="submit" data-confirm="Sostituire la politica di ${a.company} con quella scelta?">Copia</button></form>`
  : ''}

<h2 class="h-sub spaced">Prenotazioni</h2>
${bookings.length
  ? html`<div class="card table-wrap"><table class="table"><tbody>${bookings.map((b) => html`<tr><td><a href="/admin/bookings/${b.id}">${fmtDate(b.date, 'it', 'short')} ${b.start_time}</a></td><td>${content.tour(b.tour_slug)?.i18n.it.title}</td><td class="num">${b.participants}</td><td><span class="chip ${chip(b.status)}">${STATUS_IT[b.status]}</span></td><td class="num">${formatMoney(b.total_cents, 'it', b.currency)}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">Ancora nessuna prenotazione.</p>`}`;
  return adminLayout(ctx, { title: a.company, active: '/admin/partners', body, flash, error, scripts: `<script src="/js/admin-partner.js?v=${app.assetVersion}" defer></script>` });
}
