import { html, raw } from '../html.js';
import { makeT } from '../i18n.js';
import { partyCompact, partyOfBooking } from '../party.js';
import { accountTiers, tierInputOf } from '../policy.js';
import { tierSentences } from '../policyText.js';
import { accountPrices, unitPriceFor } from '../pricing.js';
import { addDays, fmtDate, localToInstant, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { vatLabel } from '../vat.js';
import { adminLayout, statusLabel } from './admin.js';
import { memberState } from './team.js';
import { presetButtons, tierRowsHtml } from './policyRows.js';
import { BILLING_LABEL, billingGaps } from '../billing.js';
import { billingFields } from './fields.js';

const ST = { pending: 'Da approvare', approved: 'Approvato', rejected: 'Rifiutato', suspended: 'Sospeso' };
const chip = (s) => ({ confirmed: 'chip-ok', held: 'chip-warn', option: 'chip-warn', cancelled: 'chip-err', expired: 'chip-err' }[s] ?? '');
const eur = (c) => formatMoney(c, 'it');
const euroInput = (c) => (c == null ? '' : c % 100 ? (c / 100).toFixed(2).replace('.', ',') : String(c / 100));
/** Un'etichetta piccola sull'esito della verifica della partita IVA (niente se non c'è nulla da dire). */
const vatBadge = (vat) => ({ valid: html`<span class="chip chip-ok" title="Valida su VIES${vat.name ? `: ${vat.name}` : ''}">P.IVA ✓</span>`, invalid: html`<span class="chip chip-err" title="Non risulta valida su VIES">P.IVA non valida</span>`, format: html`<span class="chip chip-err" title="Il formato non è quello del paese">P.IVA: formato</span>` }[vat.status] ?? '');

/** L'esito della verifica a parole, per la scheda di un'agenzia. */
function vatResult(vat, company) {
  const day = vat.checkedAt ? new Date(vat.checkedAt).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  switch (vat.status) {
    case 'valid':
      return html`<span class="chip chip-ok">Valida su VIES</span> <small class="muted">controllata il ${day}</small>${vat.name ? html`<br>Nel registro: <strong>${vat.name}</strong>${vat.address ? html`, ${vat.address}` : ''}` : html`<br><small class="muted">Il registro di questo paese non dice a chi appartiene.</small>`}${vat.sameName === false ? html`<br><span class="field-error">Il nome nel registro sembra diverso da «${company}»: controlla con l’agenzia.</span>` : vat.sameName ? html` <small class="muted">(corrisponde)</small>` : ''}`;
    case 'invalid':
      return html`<span class="chip chip-err">Non risulta valida su VIES</span> <small class="muted">controllata il ${day}</small><br><small class="muted">Il numero non è attivo (o è sbagliato): chiedi conferma all’agenzia prima di approvare.</small>`;
    case 'format':
      return html`<span class="chip chip-err">Formato non valido</span><br><small class="muted">Il numero non ha la forma di una partita IVA del suo paese (o l’italiana ha la cifra di controllo sbagliata).</small>`;
    case 'unavailable':
      return html`<span class="chip chip-warn">Non verificata</span> <small class="muted">VIES non ha risposto${day ? ` (${day})` : ''}: riprova tra poco.</small>`;
    case 'unsupported':
      return html`<span class="chip">Fuori dall’UE</span> <small class="muted">VIES non copre questo paese: serve un controllo a mano.</small>`;
    default:
      return html`<span class="chip">Non ancora verificata</span> <small class="muted">il controllo parte da solo entro un minuto.</small>`;
  }
}

/** Le schede dell'elenco dei partner (e degli inviti). */
export function partnerTabs(active) {
  const tabs = [['all', 'Tutti', '/admin/partners?f=all'], ['pending', 'Da approvare', '/admin/partners?f=pending'], ['approved', 'Approvati', '/admin/partners?f=approved'], ['invites', 'Inviti', '/admin/partners/invites']];
  return html`<div class="tabs">${tabs.map(([k, l, href]) => html`<a href="${href}" ${active === k ? raw('aria-current="page"') : ''}>${l}</a>`)}</div>`;
}

export function partnersPage(ctx, { items, filter }) {
  const { app } = ctx;
  const body = html`${partnerTabs(filter)}
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Azienda</th><th>Referente</th><th>Stato</th><th>Condizioni</th><th class="num">Prenotazioni</th></tr></thead><tbody>
    ${items.map((a) => {
      const prices = Object.keys(accountPrices(a)).length;
      const vat = app.vat.summary(a);
      return html`<tr><td><a href="/admin/partners/${a.id}"><strong>${a.company}</strong></a><br><small class="muted">${vatLabel(a)}</small> ${vatBadge(vat)}${a.referrer ? html`<br><small class="muted">segnalata da ${a.referrer}</small>` : ''}</td><td>${a.contact_name}<br><small class="muted">${a.email}</small></td>
      <td><span class="chip ${a.status === 'approved' ? 'chip-ok' : a.status === 'pending' ? 'chip-warn' : 'chip-err'}">${ST[a.status]}</span></td>
      <td><small>${a.discount_percent ? `sconto ${a.discount_percent}%` : 'tariffa B2B'}${prices ? ` · ${prices} prezz${prices === 1 ? 'o dedicato' : 'i dedicati'}` : ''}${a.cancel_policy_json || a.cancel_hours != null ? ' · annullo dedicato' : ''}</small></td><td class="num">${a.bookings}</td></tr>`;
    })}
  </tbody></table></div>`
  : html`<p class="muted">Nessun partner.</p>`}`;
  return adminLayout(ctx, { title: 'Partner B2B', active: '/admin/partners', body });
}

export function partnerDetailPage(ctx, a, { bookings, others, team = [], openOptions = 0, referrer = null, referred = [], flash = '', error = '' }) {
  const { app } = ctx;
  const { cfg, content } = app;
  const tours = content.tours.filter((x) => x.pricing !== 'hourly' && x.audience === 'b2b'); // il listino dedicato riguarda i tour B2B
  const hourlyServices = content.tours.some((x) => x.pricing === 'hourly' && x.audience === 'b2b');
  const dedicated = accountPrices(a);
  const custom = !!(a.cancel_policy_json || a.cancel_hours != null);
  const tiers = accountTiers(cfg, a);
  const rows = tierInputOf(custom ? tiers : null);
  const sampleDate = addDays(nowRome().date, 30);
  const sample = tierSentences(makeT('it'), 'it', tiers, localToInstant(sampleDate, '10:00'));
  const copyOptions = others.map((o) => html`<option value="${o.id}">${o.company}</option>`);
  const gaps = billingGaps(a);
  const billingCtx = { app, lang: 'it', t: makeT('it'), u: (p) => `/it${p}` }; // il modulo dei dati è lo stesso dell'area agenzie, qui in italiano

  const body = html`
<p><a href="/admin/partners">← Tutti i partner</a></p>
<div class="grid grid-2 admin-detail">
  <div class="card pad"><h2>${a.company} <span class="chip ${a.status === 'approved' ? 'chip-ok' : a.status === 'pending' ? 'chip-warn' : 'chip-err'}">${ST[a.status]}</span></h2>
    <dl class="summary-list">
      <div><dt>P.IVA / VAT</dt><dd>${a.vat ?? ''} ${a.country ? '(' + a.country + ')' : ''}</dd></div>
      <div><dt>Verifica P.IVA</dt><dd>${vatResult(app.vat.summary(a), a.company)}${a.vat ? html` <form method="post" action="/admin/partners/${a.id}/vat" class="inline-form"><button class="btn btn-sm btn-outline" type="submit">Verifica ora</button></form>` : ''}</dd></div>
      <div><dt>Fatturazione</dt><dd>${gaps.length ? html`<span class="chip chip-warn">mancano: ${gaps.map((k) => BILLING_LABEL[k]).join(', ')}</span><br>` : ''}${a.address ? html`${a.address}, ${a.zip ?? ''} ${a.city ?? ''}${a.province ? ` (${a.province})` : ''}<br>` : ''}${a.tax_code ? html`C.F. ${a.tax_code}<br>` : ''}SDI ${a.sdi_code ?? '—'} · PEC ${a.pec ?? '—'}<br><a href="#fatturazione">Modifica i dati di fatturazione</a></dd></div>
      <div><dt>Referente</dt><dd>${a.contact_name} · <a href="mailto:${a.email}">${a.email}</a>${a.phone ? html` · <a href="tel:${a.phone}">${a.phone}</a>` : ''}</dd></div>
      ${a.website ? html`<div><dt>Sito</dt><dd><a href="${a.website}" rel="noopener nofollow" target="_blank">${a.website}</a></dd></div>` : ''}
      ${a.message ? html`<div><dt>Messaggio</dt><dd>${a.message}</dd></div>` : ''}
      <div><dt>Registrato</dt><dd>${new Date(a.created_at).toLocaleDateString('it-IT')}</dd></div>
      ${referrer ? html`<div><dt>Segnalata da</dt><dd><a href="/admin/partners/${referrer.id}">${referrer.company}</a></dd></div>` : ''}
      ${referred.length ? html`<div><dt>Ha segnalato</dt><dd>${referred.map((x, i) => html`${i ? ', ' : ''}<a href="/admin/partners/${x.id}">${x.company}</a>${x.status === 'pending' ? ' (da approvare)' : ''}`)}</dd></div>` : ''}
    </dl>
    ${a.status === 'approved' ? html`<p class="btn-row"><a class="btn btn-outline btn-sm" href="/admin/partners/${a.id}/statement">Estratto conto</a></p>` : ''}</div>
  <form class="card pad form" method="post" action="/admin/partners/${a.id}">
    <h2>Stato e pagamento</h2>
    <label class="field"><span class="label">Stato</span><select name="status">${[['pending', 'Da approvare'], ['approved', 'Approvato'], ['rejected', 'Rifiutato'], ['suspended', 'Sospeso']].map(([v, l]) => html`<option value="${v}" ${a.status === v ? raw('selected') : ''}>${l}</option>`)}</select></label>
    <label class="field"><span class="label">Sconto su tutto il listino (%) <em>— si toglie dalle tariffe B2B (tour e tariffe a ore) e si arrotonda ai 5 € successivi; i tour con prezzo dedicato non lo usano</em></span><input type="number" name="discount_percent" min="0" max="60" step="0.5" value="${a.discount_percent}"></label>
    <label class="check"><input type="checkbox" name="allow_invoice" value="1" ${a.allow_invoice ? raw('checked') : ''}> Può pagare a fattura / bonifico</label>
    <label class="field"><span class="label">Note interne</span><textarea name="admin_notes" rows="3" maxlength="2000">${a.admin_notes ?? ''}</textarea></label>
    <button class="btn btn-gold" type="submit">Salva${a.status === 'pending' ? ' (e approva se imposti "Approvato")' : ''}</button>
  </form>
</div>

<h2 class="h-sub spaced" id="fatturazione">Dati di fatturazione</h2>
<form class="card pad form" method="post" action="/admin/partners/${a.id}/billing">
  <p class="muted">Sono i dati con cui si prepara la fattura a questa azienda (la ragione sociale e la partita IVA sono quelle sopra). Il partner li vede e li può correggere anche dalla sua area (Dati di fatturazione).${gaps.length ? ` Ora mancano: <strong>${gaps.map((k) => BILLING_LABEL[k]).join(', ')}</strong>.` : ''}</p>
  ${billingFields(billingCtx, a)}
  <button class="btn btn-gold" type="submit">Salva i dati di fatturazione</button>
</form>

<h2 class="h-sub spaced" id="team">Team ${team.length ? html`<span class="chip">${team.length}</span>` : ''}</h2>
<div class="card pad">
  <p class="muted">Chi lavora per questa agenzia con un accesso suo. Il titolare (${a.contact_name}) invita e toglie i collaboratori dalla pagina <strong>Team</strong> della sua area; se serve puoi togliere un accesso anche da qui (per esempio se il titolare non risponde): chi viene tolto non entra più, le sue prenotazioni restano.</p>
  ${team.length
    ? html`<div class="table-wrap"><table class="table"><thead><tr><th>Collaboratore</th><th>Stato</th><th></th></tr></thead><tbody>
    ${team.map((m) => {
      const state = memberState(m);
      return html`<tr><td><strong>${m.name}</strong><br><small class="muted">${m.email}</small></td>
        <td>${state === 'active' ? html`<span class="chip chip-ok">Attivo</span><br><small class="muted">${m.last_login_at ? `ultimo accesso ${new Date(m.last_login_at).toLocaleDateString('it-IT')}` : 'non ha ancora fatto l’accesso'}</small>` : state === 'expired' ? html`<span class="chip chip-err">Invito scaduto</span>` : html`<span class="chip chip-warn">Invito mandato</span><br><small class="muted">non ha ancora scelto la password</small>`}</td>
        <td class="actions"><form method="post" action="/admin/partners/${a.id}/team/${m.id}/remove" data-confirm="Togliere l’accesso a ${m.name}? Non potrà più entrare; le prenotazioni che ha fatto restano."><button class="btn btn-sm btn-link-danger" type="submit">Togli l’accesso</button></form></td></tr>`;
    })}
    </tbody></table></div>`
    : html`<p class="muted">Nessun collaboratore: l’agenzia lavora solo con l’accesso del titolare.</p>`}
</div>

<h2 class="h-sub spaced" id="listino">Listino dedicato</h2>
<form class="card pad form" method="post" action="/admin/partners/${a.id}/prices">
  <p class="muted">Scrivi il prezzo che questo partner paga per ogni tour. <strong>Lascia vuoto</strong> per applicare ${a.discount_percent ? `la tariffa del tour meno lo sconto del ${a.discount_percent}%` : 'la tariffa del tour'}. Il prezzo è «a persona» o «a gruppo» come nel tour. Qui compaiono i tour della sezione <a href="/admin/tours/b2b">Tour B2B</a>.</p>
  <div class="table-wrap"><table class="table price-table"><thead><tr><th>Tour B2B</th><th class="num">Tariffa B2B</th><th class="num">Prezzo dedicato (€)</th><th class="num">Applicato</th></tr></thead><tbody>
    ${tours.map((x) => {
      const applied = unitPriceFor(x, 'b2b', a);
      const own = dedicated[x.slug] != null;
      return html`<tr><td><strong>${x.i18n.it.title}</strong><br><small class="muted">${x.model === 'person' ? 'a persona' : 'a gruppo'}</small></td>
        <td class="num muted">${eur(x.priceCents)}</td>
        <td class="num"><input class="price-input" name="price_${x.slug}" inputmode="decimal" autocomplete="off" value="${euroInput(dedicated[x.slug])}" placeholder="${euroInput(own ? unitPriceFor(x, 'b2b', { ...a, prices_json: null }) : applied)}" aria-label="Prezzo dedicato per ${x.i18n.it.title}"></td>
        <td class="num"><strong>${eur(applied)}</strong>${own ? html` <span class="chip chip-accent">dedicato</span>` : ''}</td></tr>`;
    })}
  </tbody></table></div>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva il listino</button></div>
</form>
${hourlyServices ? html`<p class="muted small">I servizi a ore (guida, assistente, tour leader, meet &amp; greet) non hanno un prezzo per tour: per questo partner valgono le <a href="/admin/rates">Tariffe a ore</a> con lo <strong>sconto su tutto il listino</strong>${a.discount_percent ? ` del ${a.discount_percent}%` : ' (oggi nessuno)'} indicato sopra, applicato alle tariffe agenzie di ogni scaglione (arrotondato ai 5 € successivi).</p>` : ''}
${others.length
  ? html`<form class="inline-form copy-form" method="post" action="/admin/partners/${a.id}/prices"><input type="hidden" name="action" value="copy"><label class="small muted">Copia il listino da</label> <select name="copy_from">${copyOptions}</select> <button class="btn btn-outline btn-sm" type="submit" data-confirm="Sostituire il listino di ${a.company} con quello scelto?">Copia</button></form>`
  : ''}

<h2 class="h-sub spaced" id="opzioni">Opzioni (data trattenuta senza pagare)</h2>
<form class="card pad form" method="post" action="/admin/partners/${a.id}/options">
  <p class="muted">Con l’opzione l’agenzia tiene la data mentre aspetta la conferma del suo cliente, senza pagare e senza impegno; se non conferma entro la scadenza la data si libera da sola. ${cfg.options.enabled ? html`Per questo partner valgono le regole del sito (<a href="/admin/settings?s=options#options">Sito › Impostazioni › Opzioni per le agenzie</a>) salvo ciò che cambi qui sotto.` : html`Le opzioni sono <strong>spente per tutto il sito</strong> (<a href="/admin/settings?s=options#options">Sito › Impostazioni › Opzioni per le agenzie</a>).`}</p>
  <ul class="plain facts-list">${cfg.options.tiers.map((t) => html`<li><span class="muted">tour fra almeno ${t.fromDays} giorni</span> <strong>${t.days} ${t.days === 1 ? 'giorno' : 'giorni'}</strong></li>`)}</ul>
  <label class="check"><input type="checkbox" name="options_enabled" value="1" ${a.options_enabled ? raw('checked') : ''}> Può opzionare</label>
  <div class="form-grid">
    <label class="field"><span class="label">Durata fissa dell’opzione <em>(giorni; vuoto = secondo la tabella)</em></span><input type="number" name="option_days" min="1" max="90" value="${a.option_days ?? ''}" inputmode="numeric" placeholder="tabella del sito"></label>
    <label class="field"><span class="label">Opzioni aperte insieme <em>(vuoto = ${cfg.options.maxActive || 'nessun limite'}, come il sito; 0 = nessun limite)</em></span><input type="number" name="option_max" min="0" max="100" value="${a.option_max ?? ''}" inputmode="numeric" placeholder="${cfg.options.maxActive || 'nessun limite'}"></label>
  </div>
  <p class="small muted">Una durata fissa vale anche per i tour vicini, ma l’opzione scade sempre almeno ${cfg.options.minReleaseHours} ore prima del servizio. Opzioni aperte ora: <strong>${openOptions}</strong>.</p>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva le opzioni</button></div>
</form>

<h2 class="h-sub spaced" id="annullo">Politica di annullo</h2>
<form class="card pad form" method="post" action="/admin/partners/${a.id}/policy" id="policy-form">
  <p class="muted">${custom ? 'Questo partner ha una politica propria.' : html`Ora vale quella predefinita del sito: <strong>rimborso totale fino a ${cfg.policy.b2bFreeCancelHours} ore prima</strong>. Compila le righe per personalizzarla.`}
  Il rimborso non può aumentare avvicinandosi al servizio; dopo l'ultimo scaglione <strong>non si rimborsa nulla</strong>. Chi paga a fattura riceve una <strong>penale</strong> pari alla parte non rimborsata, che compare in <a href="/admin/invoices">Fatture → Da fatturare</a>.</p>
  ${tierRowsHtml(rows)}
  <p class="small muted">Modelli: ${presetButtons('', 'Svuota (predefinito del sito)')}</p>
  <div class="policy-box ok"><strong>Per un servizio il ${fmtDate(sampleDate, 'it', 'date')} alle 10:00:</strong><ul class="plain tier-list">${sample.map((x) => html`<li>${x}</li>`)}</ul></div>
  <div class="btn-row"><button class="btn btn-gold" type="submit">Salva la politica</button></div>
</form>
${others.length
  ? html`<form class="inline-form copy-form" method="post" action="/admin/partners/${a.id}/policy"><input type="hidden" name="action" value="copy"><label class="small muted">Copia la politica da</label> <select name="copy_from">${copyOptions}</select> <button class="btn btn-outline btn-sm" type="submit" data-confirm="Sostituire la politica di ${a.company} con quella scelta?">Copia</button></form>`
  : ''}

<h2 class="h-sub spaced">Prenotazioni</h2>
${bookings.length
  ? html`<div class="card table-wrap"><table class="table"><tbody>${bookings.map((b) => html`<tr><td><a href="/admin/bookings/${b.id}">${fmtDate(b.date, 'it', 'short')} ${b.start_time}</a></td><td>${content.tour(b.tour_slug)?.i18n.it.title}</td><td class="num">${partyCompact(partyOfBooking(b))}</td><td><span class="chip ${chip(b.status)}">${statusLabel(b)}</span></td><td class="num">${formatMoney(b.total_cents, 'it', b.currency)}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">Ancora nessuna prenotazione.</p>`}`;
  return adminLayout(ctx, { title: a.company, active: '/admin/partners', body, flash, error, scripts: `<script src="/js/admin-partner.js?v=${app.assetVersion}" defer></script><script src="/js/b2b-register.js?v=${app.assetVersion}" defer></script>` });
}
