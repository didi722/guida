import { html, raw } from '../html.js';
import { makeT } from '../i18n.js';
import { isLocked, proposalExpired } from '../programs.js';
import { addDays, fmtDate, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { adminLayout } from './admin.js';

const eur = (c, cur = 'EUR') => formatMoney(c, 'it', cur);
const when = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
const euroInput = (cents) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '');
const t = makeT('it');

export const PROGRAM_STATUS = {
  new: ['Da preparare', 'chip-warn'],
  quoted: ['Proposta inviata', 'chip-accent'],
  accepted: ['Accettata · manca l’acconto', 'chip-warn'],
  confirmed: ['Confermato', 'chip-ok'],
  declined: ['Rifiutata', 'chip-err'],
  closed: ['Chiuso', ''],
};
export const statusChip = (p) => {
  const [label, cls] = PROGRAM_STATUS[p.status] ?? [p.status, ''];
  return html`<span class="chip ${cls}">${label}</span>`;
};

const dateRange = (p) => (p.date_from ? `${fmtDate(p.date_from, 'it', 'short')}${p.date_to ? ' → ' + fmtDate(p.date_to, 'it', 'short') : ''}${p.flexible_dates ? ' (flessibili)' : ''}` : p.flexible_dates ? 'flessibili' : 'da definire');

export function programsAdminPage(ctx, { tab, items, counts, flash, error, values = {} }) {
  const tabs = [['open', 'Da gestire'], ['confirmed', 'Confermati'], ['archive', 'Archivio']];
  const body = html`
<div class="tabs">${tabs.map(([k, l]) => html`<a href="/admin/programs?tab=${k}" ${tab === k ? raw('aria-current="page"') : ''}>${l}${counts[k] ? ` (${counts[k]})` : ''}</a>`)}</div>
${items.length
  ? html`<div class="card table-wrap"><table class="table"><thead><tr><th>Richiesta</th><th>Date</th><th class="num">Pers.</th><th>Stato</th><th class="num">Totale</th></tr></thead><tbody>
  ${items.map((p) => html`<tr>
    <td><a href="/admin/programs/${p.id}"><strong>${p.name}</strong></a>${p.company ? html` · ${p.company}` : ''}<br><small class="muted">${p.ref} · ${p.channel === 'b2b' ? 'B2B' : 'Privato'} · ${new Date(p.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}</small></td>
    <td>${dateRange(p)}${p.status === 'quoted' && p.valid_until ? html`<br><small class="${proposalExpired(p) ? 'field-error' : 'muted'}">proposta valida fino al ${fmtDate(p.valid_until, 'it', 'short')}</small>` : ''}</td>
    <td class="num">${p.participants}</td>
    <td>${statusChip(p)}</td>
    <td class="num">${p.total_cents ? eur(p.total_cents, p.currency) : '—'}</td></tr>`)}
  </tbody></table></div>`
  : html`<p class="muted">Nessun programma in questa sezione.</p>`}

<details class="card pad how-to" ${error ? raw('open') : ''}>
  <summary>Nuovo programma (richiesta arrivata per telefono o email)</summary>
  <form method="post" action="/admin/programs" class="form">
    <div class="form-grid">
      <label class="field"><span class="label">Nome</span><input name="name" required maxlength="120" value="${values.name ?? ''}"></label>
      <label class="field"><span class="label">Email</span><input type="email" name="email" required maxlength="200" value="${values.email ?? ''}"></label>
      <label class="field"><span class="label">Telefono</span><input name="phone" maxlength="40" value="${values.phone ?? ''}"></label>
      <label class="field"><span class="label">Azienda <em>(se agenzia/DMC)</em></span><input name="company" maxlength="160" value="${values.company ?? ''}"></label>
      <label class="field"><span class="label">Dal</span><input type="date" name="dateFrom" value="${values.dateFrom ?? ''}"></label>
      <label class="field"><span class="label">Al</span><input type="date" name="dateTo" value="${values.dateTo ?? ''}"></label>
      <label class="field"><span class="label">Persone</span><input type="number" name="participants" min="1" max="80" required value="${values.participants ?? '2'}"></label>
      <label class="field"><span class="label">Canale</span><select name="channel"><option value="b2c">Privato</option><option value="b2b" ${values.channel === 'b2b' ? raw('selected') : ''}>Agenzia / B2B</option></select></label>
      <label class="field"><span class="label">Lingua del cliente</span><select name="lang"><option value="it">Italiano</option><option value="en" ${values.lang === 'en' ? raw('selected') : ''}>English</option></select></label>
    </div>
    <label class="field"><span class="label">Cosa ti ha chiesto</span><textarea name="message" rows="3" maxlength="3000">${values.message ?? ''}</textarea></label>
    <button class="btn btn-gold" type="submit">Crea e prepara la proposta</button>
  </form>
</details>`;
  return adminLayout(ctx, { title: 'Programmi di più giorni', active: '/admin/programs', body, flash, error });
}

/** Righe iniziali del modulo: quelle salvate più qualche riga vuota (date precompilate dalla richiesta). */
function initialRows(p, days) {
  const rows = days.map((d) => ({ date: d.date, start: d.start_time, end: d.end_time, title: d.title, description: d.description ?? '', price: euroInput(d.price_cents) }));
  const blank = (date) => ({ date, start: '09:30', end: '13:00', title: '', description: '', price: '' });
  if (rows.length) return [...rows, blank(addDays(rows.at(-1).date, 1)), blank(addDays(rows.at(-1).date, 2))];
  if (p.date_from) {
    const out = [];
    let d = p.date_from;
    const last = p.date_to ?? p.date_from;
    while (d <= last && out.length < 10) {
      out.push(blank(d));
      d = addDays(d, 1);
    }
    return out.length >= 2 ? out : [...out, blank(addDays(p.date_from, 1))];
  }
  return [blank(''), blank(''), blank('')];
}

function rowHtml(r, i, flag) {
  return html`<div class="prow">
    <div class="prow-when"><span class="prow-n">${i + 1}</span>
      <input type="date" name="d_date" value="${r.date}" aria-label="Data"><input type="time" name="d_start" value="${r.start}" aria-label="Dalle"><span>–</span><input type="time" name="d_end" value="${r.end}" aria-label="Alle"></div>
    <input class="prow-price" name="d_price" inputmode="decimal" placeholder="Prezzo €" value="${r.price}" aria-label="Prezzo in euro">
    <input class="prow-title" name="d_title" maxlength="160" placeholder="Titolo (es. San Marco e Rialto)" value="${r.title}" aria-label="Titolo">
    <textarea class="prow-desc" name="d_desc" rows="2" maxlength="800" placeholder="Descrizione per il cliente (facoltativa)" aria-label="Descrizione">${r.description}</textarea>
    ${flag ?? ''}
  </div>`;
}

export function programDetailPage(ctx, p, { days, conflicts = [], form = null, flash = '', error = '', publicUrl }) {
  const { cfg } = ctx.app;
  const locked = isLocked(p);
  const interests = p.interests ? JSON.parse(p.interests).map((k) => t(`pg.int.${k}`)).join(', ') : '';
  const wa = p.phone ? p.phone.replace(/[^\d]/g, '') : '';
  const rows = form?.rows ?? initialRows(p, days);
  const f = {
    title: form?.title ?? p.proposal_title ?? '',
    intro: form?.intro ?? p.proposal_intro ?? '',
    notes: form?.notes ?? p.proposal_notes ?? '',
    depositPercent: form?.depositPercent ?? (p.proposal_title || days.length ? p.deposit_percent : cfg.program.depositPercent),
    validUntil: form?.validUntil ?? p.valid_until ?? addDays(nowRome().date, cfg.program.validityDays),
    holdDates: form ? form.holdDates : p.proposal_title || days.length ? !!p.hold_dates : true,
    total: form?.total ?? (p.total_cents && p.total_cents !== days.reduce((a, d) => a + d.price_cents, 0) ? euroInput(p.total_cents) : ''),
  };
  const sum = days.reduce((a, d) => a + d.price_cents, 0);
  const flagFor = (i) => {
    if (!days[i] || form) return '';
    const c = conflicts[i] ?? [];
    return c.length ? html`<p class="prow-flag field-error">⚠ ${c.join(' · ')}</p>` : html`<p class="prow-flag ok-text">✓ libero in calendario</p>`;
  };
  const anyConflict = conflicts.some((c) => c?.length);

  const body = html`
<p><a href="/admin/programs">← Tutti i programmi</a></p>
${anyConflict && p.status !== 'declined' && p.status !== 'closed' ? html`<div class="notice notice-err" role="alert"><strong>Attenzione, sovrapposizioni in calendario.</strong> Qualche giornata del programma coincide con altri impegni (vedi i ⚠ nella proposta).</div>` : ''}
<div class="grid grid-2 admin-detail">
  <div class="card pad">
    <p class="ref-line">${statusChip(p)} <strong class="ref">${p.ref}</strong> <span class="muted">${p.channel === 'b2b' ? 'B2B' : 'Privato'}</span></p>
    <h2>${p.name}${p.company ? html` <small class="muted">· ${p.company}</small>` : ''}</h2>
    <dl class="summary-list">
      <div><dt>Contatti</dt><dd><a href="mailto:${p.email}">${p.email}</a>${p.phone ? html` · <a href="tel:${p.phone}">${p.phone}</a>${wa ? html` · <a href="https://wa.me/${wa}" rel="noopener">WhatsApp</a>` : ''}` : ''}</dd></div>
      <div><dt>Date richieste</dt><dd>${dateRange(p)}</dd></div>
      <div><dt>Persone</dt><dd>${p.participants}${p.group_type ? ` · ${t(`pg.group.${p.group_type}`)}` : ''}</dd></div>
      ${interests ? html`<div><dt>Interessi</dt><dd>${interests}</dd></div>` : ''}
      ${p.budget ? html`<div><dt>Budget</dt><dd>${t(`pg.budget.${p.budget}`)}</dd></div>` : ''}
      ${p.accommodation ? html`<div><dt>Alloggio</dt><dd>${p.accommodation}</dd></div>` : ''}
      ${p.languages ? html`<div><dt>Lingue</dt><dd>${p.languages}</dd></div>` : ''}
      ${p.mobility ? html`<div><dt>Mobilità / esigenze</dt><dd>${p.mobility}</dd></div>` : ''}
      ${p.client_ref ? html`<div><dt>Rif. pratica</dt><dd>${p.client_ref}</dd></div>` : ''}
      ${p.message ? html`<div><dt>Messaggio</dt><dd class="pre">${p.message}</dd></div>` : ''}
      <div><dt>Lingua</dt><dd>${p.lang === 'en' ? 'English' : 'Italiano'}</dd></div>
    </dl>
  </div>

  <div class="card pad">
    <h2>Stato</h2>
    <ul class="timeline">
      <li>Richiesta ricevuta · ${when(p.created_at)}</li>
      ${p.proposal_sent_at ? html`<li>Proposta inviata · ${when(p.proposal_sent_at)}${p.valid_until ? html` <small class="muted">(valida fino al ${fmtDate(p.valid_until, 'it', 'short')})</small>` : ''}</li>` : ''}
      ${p.accepted_at ? html`<li>Accettata · ${when(p.accepted_at)}</li>` : ''}
      ${p.deposit_status === 'paid' ? html`<li>Acconto incassato (${eur(p.deposit_cents, p.currency)}) · ${when(p.deposit_paid_at)}</li>` : ''}
      ${p.deposit_status === 'refunded' ? html`<li>Acconto rimborsato (${eur(p.deposit_cents, p.currency)})</li>` : ''}
      ${p.declined_at ? html`<li>Rifiutata · ${when(p.declined_at)}</li>` : ''}
    </ul>
    <p><small class="muted">Pagina del cliente (link riservato)</small><br><input class="copy-field" readonly value="${publicUrl}" data-select-all></p>
    <p class="btn-row"><a class="btn btn-outline btn-sm" href="${publicUrl}" target="_blank" rel="noopener">Apri come la vede il cliente</a>${days.length ? html`<a class="btn btn-outline btn-sm" href="/admin/programs/${p.id}/proposal.pdf">PDF della proposta</a>` : ''}</p>

    <div class="actions-stack">
      ${['new', 'quoted'].includes(p.status) && days.length
        ? html`<form method="post" action="/admin/programs/${p.id}/accept" class="form" data-confirm="Registrare l’accettazione a nome del cliente?">
        <label class="check"><input type="checkbox" name="force" value="1"> Ignora le sovrapposizioni in calendario</label>
        <button class="btn btn-outline btn-sm" type="submit">Il cliente ha accettato (telefono/email)</button></form>`
        : ''}
      ${p.status === 'accepted' || (p.status === 'quoted' && p.deposit_cents > 0)
        ? html`<form method="post" action="/admin/programs/${p.id}/deposit" class="form" data-confirm="Segnare l’acconto come incassato e confermare il programma?"><button class="btn btn-gold btn-sm" type="submit">Acconto ricevuto (bonifico) · ${eur(p.deposit_cents, p.currency)}</button></form>`
        : ''}
      ${['accepted', 'confirmed'].includes(p.status)
        ? html`<form method="post" action="/admin/programs/${p.id}/cancel" class="form" data-confirm="Annullare il programma? Le date si liberano.">
        ${p.deposit_status === 'paid' ? html`<label class="check"><input type="checkbox" name="refund" value="1"> Rimborsa l’acconto${p.stripe_payment_intent ? '' : ' (incassato fuori dal sito: da restituire a mano)'}</label>` : ''}
        <button class="btn btn-danger btn-sm" type="submit">Annulla il programma</button></form>`
        : ''}
      ${['new', 'quoted'].includes(p.status)
        ? html`<form method="post" action="/admin/programs/${p.id}/status" class="inline-form"><button class="btn btn-outline btn-sm" type="submit" name="status" value="declined">Segna come rifiutata</button><button class="btn btn-outline btn-sm" type="submit" name="status" value="closed">Archivia</button></form>`
        : ''}
      ${['declined', 'closed'].includes(p.status)
        ? html`<form method="post" action="/admin/programs/${p.id}/status"><button class="btn btn-outline btn-sm" type="submit" name="status" value="new">Riapri come bozza</button></form>`
        : ''}
    </div>
  </div>
</div>

<div class="card pad">
  <h2>Proposta</h2>
  ${locked
    ? html`<p class="muted">La proposta è stata accettata: non si può più modificare. Per cambiarla annulla il programma e riparti da una nuova richiesta.</p>
    ${p.proposal_title ? html`<h3>${p.proposal_title}</h3>` : ''}${p.proposal_intro ? html`<p class="pre">${p.proposal_intro}</p>` : ''}
    <div class="itinerary">${days.map((d, i) => html`<div class="itin-day"><div class="itin-when"><strong>${fmtDate(d.date, 'it', 'weekday')}</strong><small>${d.start_time}–${d.end_time}</small></div><div class="itin-what"><strong>${d.title}</strong>${d.description ? html`<p>${d.description}</p>` : ''}${conflicts[i]?.length ? html`<p class="field-error">⚠ ${conflicts[i].join(' · ')}</p>` : ''}</div><div class="itin-price">${d.price_cents ? eur(d.price_cents, p.currency) : ''}</div></div>`)}</div>
    <p><strong>Totale ${eur(p.total_cents, p.currency)}</strong>${p.deposit_cents ? ` · acconto ${p.deposit_percent}% (${eur(p.deposit_cents, p.currency)})` : ''}</p>
    ${p.proposal_notes ? html`<div class="info-box"><p class="pre">${p.proposal_notes}</p></div>` : ''}`
    : html`
  <p class="muted">Una riga per ogni giornata o servizio. Le righe lasciate senza titolo vengono ignorate. Prima di inviare il sito controlla che le giornate non si sovrappongano a prenotazioni o impegni del tuo calendario.</p>
  <form method="post" action="/admin/programs/${p.id}/proposal" class="form" id="proposal-form">
    <div class="form-grid">
      <label class="field"><span class="label">Titolo del programma</span><input name="title" maxlength="160" value="${f.title}" placeholder="Venezia in tre giorni"></label>
      <label class="field"><span class="label">Valida fino al</span><input type="date" name="valid_until" value="${f.validUntil}"></label>
    </div>
    <label class="field"><span class="label">Presentazione <em>(visibile al cliente)</em></span><textarea name="intro" rows="3" maxlength="3000">${f.intro}</textarea></label>
    <div class="prows" data-prows>${rows.map((r, i) => rowHtml(r, i, flagFor(i)))}</div>
    <p class="btn-row"><button class="btn btn-outline btn-sm" type="button" data-add-row hidden>+ Aggiungi una giornata</button> <span class="muted" data-sum-label>Somma delle righe: <strong data-sum>${eur(form ? 0 : sum, p.currency)}</strong></span></p>
    <div class="form-grid">
      <label class="field"><span class="label">Totale concordato (€) <em>vuoto = somma delle righe</em></span><input name="total" inputmode="decimal" value="${f.total}" placeholder="${euroInput(sum)}"></label>
      <label class="field"><span class="label">Acconto (%) <em>0 = nessun acconto</em></span><input type="number" name="deposit_percent" min="0" max="100" value="${f.depositPercent}"></label>
    </div>
    <label class="check"><input type="checkbox" name="hold_dates" value="1" ${f.holdDates ? raw('checked') : ''}> Tieni occupate le date in calendario finché la proposta è valida</label>
    <label class="field"><span class="label">Cosa è incluso, condizioni, cancellazione <em>(visibile al cliente)</em></span><textarea name="notes" rows="5" maxlength="3000" placeholder="Incluso: guida abilitata, auricolari… Non incluso: ingressi, trasporti… Cancellazione: acconto rimborsabile fino a…">${f.notes}</textarea></label>
    <div class="btn-row">
      <button class="btn btn-outline" type="submit" name="action" value="save">Salva bozza</button>
      <button class="btn btn-gold" type="submit" name="action" value="send">${p.status === 'quoted' ? 'Salva e reinvia al cliente' : 'Salva e invia al cliente'}</button>
    </div>
  </form>`}
</div>

<form class="card pad form" method="post" action="/admin/programs/${p.id}/notes">
  <h2>Note interne</h2>
  <label class="field"><textarea name="admin_notes" rows="3" maxlength="2000">${p.admin_notes ?? ''}</textarea></label>
  <button class="btn btn-outline" type="submit">Salva note</button>
</form>`;
  return adminLayout(ctx, { title: p.proposal_title || `Programma ${p.ref}`, active: '/admin/programs', body, flash, error, scripts: `<script src="/js/admin-programs.js?v=${ctx.app.assetVersion}" defer></script>` });
}

