// Preventivi online delle agenzie: l'elenco, la preparazione dal pacchetto, la scheda (invio, PDF, ritorno nel pacchetto) e — per il cliente
// finale dell'agenzia, che arriva dal collegamento dell'email — la pagina in cui legge il preventivo e lo accetta o lo rifiuta.
import { html, raw } from '../html.js';
import { ROUNDS, brandOf, readProfile } from '../agencyDocs.js';
import { LANGS, LANG_META, normLang } from '../langs.js';
import { partyExtra, partyOfLine } from '../party.js';
import { QUOTE_MAX_SENDS, MARKUP_MAX, clientView, quoteLines, statusOf, validityBounds } from '../quotes.js';
import { fmtDate, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { breadcrumbs, homeCrumb } from './components.js';
import { page } from './layout.js';

const CHIP = { draft: '', sent: 'chip-warn', approved: 'chip-ok', declined: 'chip-err', expired: '' };
const day = (iso, lang) => (iso ? fmtDate(nowRome(Date.parse(iso)).date, lang, 'short') : '');
const chip = (t, state) => html`<span class="chip ${CHIP[state]}">${t(`quotes.st.${state}`)}</span>`;

/** L'elenco dei preventivi dell'agenzia. `team`: l'agenzia ha dei collaboratori (si mostra chi l'ha preparato). */
export function quotesPage(ctx, { quotes, team = false, flash = '', error = '' }) {
  const { t, lang, u } = ctx;
  const today = nowRome().date;
  const body = html`
<section class="page-head partner-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('quotes.nav')]])}
  <div class="account-head"><div><h1>${t('quotes.title')}</h1><p class="lead">${t('quotes.lead')}</p></div>
    <div class="btn-row"><a class="btn btn-gold" href="${u('/b2b/quotes/new')}">${t('quotes.fromCart')}</a></div></div>
</div></section>
<section class="section tight"><div class="wrap">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${quotes.length
    ? html`<div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr><th>${t('quotes.col.client')}</th><th class="num">${t('quotes.col.total')}</th><th>${t('quotes.col.valid')}</th><th>${t('b2b.state')}</th><th><span class="sr-only">${t('partner.col.actions')}</span></th></tr></thead><tbody>
    ${quotes.map((q) => html`<tr>
      <td data-label="${t('quotes.col.client')}"><a class="pb-title" href="${u(`/b2b/quotes/${q.ref}`)}">${q.client_name}</a><small class="muted">${q.ref}${q.client_ref ? ` · ${q.client_ref}` : ''} · ${day(q.created_at, lang)}${team && q.created_by ? ` · ${q.created_by}` : ''}</small></td>
      <td class="num" data-label="${t('quotes.col.total')}">${formatMoney(q.total_cents, lang, q.currency)}</td>
      <td data-label="${t('quotes.col.valid')}">${fmtDate(q.valid_until, lang, 'short')}</td>
      <td data-label="${t('b2b.state')}">${chip(t, statusOf(q, today))}</td>
      <td class="pb-actions"><div class="pb-actions-in"><a class="btn btn-outline btn-sm" href="${u(`/b2b/quotes/${q.ref}`)}">${t('partner.act.open')}</a></div></td></tr>`)}
    </tbody></table></div>`
    : html`<div class="card pad center empty-state"><p>${t('quotes.empty')}</p><p class="btn-row center"><a class="btn btn-gold" href="${u('/b2b/package')}">${t('pkg.title')}</a></p></div>`}
</div></section>`;
  return page(ctx, { title: t('quotes.nav'), path: `/${lang}/b2b/quotes`, body, noindex: true, activeNav: 'b2b-account', area: 'partner' });
}

/** La preparazione: i servizi del pacchetto e i dati del preventivo (cliente, ricarico, validità, lingua, nota). */
export function newQuotePage(ctx, { acct, summary, values = {}, error = '' }) {
  const { t, lang, u } = ctx;
  const profile = readProfile(acct);
  const v = (k, d = '') => values[k] ?? d;
  const valid = summary.lines.filter((l) => l.p);
  const bounds = validityBounds(valid.map((l) => ({ date: l.p.date })), nowRome().date);
  const title = (l) => l.p.tour.i18n[lang]?.title ?? l.p.tour.slug;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('quotes.nav'), u('/b2b/quotes')], [t('quotes.new.title')]])}
  <h1>${t('quotes.new.title')}</h1><p class="lead">${t('quotes.new.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${summary.lines.length
    ? html`<h2 class="h-sub">${t('quotes.new.services')}</h2>
  <div class="table-wrap card"><table class="table"><tbody>
    ${valid.map((l) => html`<tr><td><strong>${title(l)}</strong><br><small class="muted">${fmtDate(l.p.date, lang, 'short')} · ${l.p.time} · ${t('quote.pax', { n: l.p.pax })}${partyExtra(l.p.party, lang)}${l.ok ? '' : html` · <span class="field-error">${t('quotes.live.gone')}</span>`}</small></td><td class="num">${formatMoney(l.pricing.totalCents, lang)}</td></tr>`)}
  </tbody></table></div>
  <p class="small muted">${t('quotes.new.yourRate', { amount: formatMoney(summary.totalCents, lang) })}</p>
  ${summary.allOk
    ? html`<form class="card pad form spaced" method="post" action="${u('/b2b/quotes')}">
    <div class="form-grid">
      <label class="field"><span class="label">${t('quotes.f.client')}</span><input name="client" required maxlength="120" value="${v('client', summary.contact.name)}"></label>
      <label class="field"><span class="label">${t('quotes.f.email')}</span><input type="email" name="email" maxlength="200" autocomplete="off" value="${v('email')}"><small class="muted">${t('quotes.f.emailHint')}</small></label>
      <label class="field"><span class="label">${t('f.clientRef')}</span><input name="clientRef" maxlength="120" value="${v('clientRef', summary.contact.clientRef)}"></label>
      <label class="field"><span class="label">${t('docs.q.lang')}</span><select name="lang">${LANGS.map((l) => html`<option value="${l}" ${l === (v('lang') || normLang(acct.lang)) ? raw('selected') : ''}>${LANG_META[l].name}</option>`)}</select></label>
      <label class="field"><span class="label">${t('docs.q.markup')}</span><input type="number" name="markup" min="0" max="${MARKUP_MAX}" step="0.5" value="${v('markup', profile.markup)}" inputmode="decimal"></label>
      <label class="field"><span class="label">${t('docs.q.round')}</span><select name="round">${ROUNDS.map((r) => html`<option value="${r}" ${r === Number(v('round', profile.round)) ? raw('selected') : ''}>${t(`docs.round.${r}`)}</option>`)}</select></label>
      <label class="field"><span class="label">${t('docs.q.until')}</span><input type="date" name="until" min="${bounds.min}" max="${bounds.max}" value="${v('until', bounds.fallback)}"></label>
    </div>
    <label class="field"><span class="label">${t('docs.q.note')}</span><textarea name="note" rows="3" maxlength="800">${v('note')}</textarea></label>
    <div class="btn-row"><button class="btn btn-gold" type="submit">${t('quotes.new.submit')}</button><a class="small" href="${u('/b2b/documents')}">${t('docs.q.settings')}</a></div>
  </form>`
    : html`<div class="notice notice-err" role="alert">${t('pkg.err.stale')}</div><p class="btn-row"><a class="btn btn-outline" href="${u('/b2b/package')}">${t('pkg.title')}</a></p>`}`
    : html`<div class="card pad center empty-state"><p>${t('quotes.new.empty')}</p><p class="btn-row center"><a class="btn btn-gold" href="${u('/book')}">${t('partner.nav.new')}</a></p></div>`}
</div></section>`;
  return page(ctx, { title: t('quotes.new.title'), path: `/${lang}/b2b/quotes/new`, body, noindex: true, activeNav: 'b2b-account', area: 'partner' });
}

/** La scheda di un preventivo per l'agenzia: stato, servizi com'è adesso la loro disponibilità, collegamento del cliente, invio e azioni. */
export function quoteDetailPage(ctx, { q, live, replyTo, team = false, flash = '', error = '' }) {
  const { t, lang, u, app } = ctx;
  const today = nowRome().date;
  const state = statusOf(q, today);
  const lines = quoteLines(q);
  const money = (c) => formatMoney(c, lang, q.currency);
  const url = `${app.cfg.baseUrl}/${normLang(q.lang)}/quotes/${q.ref}?t=${q.token}`;
  const canSend = state === 'draft' || state === 'sent';
  const body = html`
<section class="page-head partner-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('quotes.nav'), u('/b2b/quotes')], [q.ref]])}
  <div class="account-head"><div><p class="eyebrow">${q.ref} ${chip(t, state)}</p><h1>${t('quotes.detail.client', { name: q.client_name })}</h1>
    <p class="muted">${t('quotes.detail.created', { date: day(q.created_at, lang), name: q.created_by ?? '' })}${q.client_ref ? ` · ${q.client_ref}` : ''}</p></div>
    <div class="btn-row"><a class="btn btn-outline" href="${u(`/b2b/quotes/${q.ref}/quote.pdf`)}" target="_blank" rel="noopener">${t('quotes.act.pdf')}</a></div></div>
</div></section>
<section class="section tight"><div class="wrap">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${state === 'approved' || state === 'declined'
    ? html`<div class="notice ${state === 'approved' ? 'notice-ok' : 'notice-err'}" role="status"><p>${t(`quotes.decided.${state}`, { date: day(q.decided_at, lang) })}</p>${q.decided_note ? html`<p>${t('quotes.decided.note', { note: q.decided_note })}</p>` : ''}${state === 'approved' ? html`<p class="small">${t('quotes.decided.next')}</p>` : ''}</div>`
    : ''}
  <div class="grid grid-2">
    <div class="card pad">
      <h2 class="h-sub">${t('quotes.new.services')}</h2>
      <dl class="summary-list">
        ${lines.map((l, i) => {
          const tour = app.content.tour(l.slug);
          const check = live?.lines[i];
          return html`<div><dt><strong>${tour?.i18n[lang]?.title ?? l.slug}</strong><br><small>${fmtDate(l.date, lang, 'short')} · ${l.time} · ${t('quote.pax', { n: l.pax })}${partyExtra(partyOfLine(l), lang)}</small>${check ? html`<br><small class="${check.ok ? 'muted' : 'field-error'}">${check.ok ? t('quotes.live.ok') : t('quotes.live.gone')}</small>${check.changed ? html`<br><small class="field-error">${t('quotes.live.changed', { now: money(check.netNow), was: money(l.netCents) })}</small>` : ''}` : ''}</dt><dd>${money(l.netCents)}</dd></div>`;
        })}
        <div class="summary-total"><dt>${t('quotes.detail.yourRate')}</dt><dd>${money(q.net_cents)}</dd></div>
      </dl>
      <p><strong>${t('quotes.detail.clientPrice', { amount: money(q.total_cents), markup: q.markup_percent })}</strong></p>
      <p class="small muted">${t('quote.valid')}: ${fmtDate(q.valid_until, lang)}</p>
      ${q.note ? html`<p class="small" style="white-space:pre-line">${q.note}</p>` : ''}
    </div>
    <div class="card pad">
      ${canSend
        ? html`<h2 class="h-sub">${t('quotes.send.title')}</h2>
      <form class="form" method="post" action="${u(`/b2b/quotes/${q.ref}/send`)}">
        <label class="field"><span class="label">${t('quotes.f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="off" value="${q.client_email ?? ''}"></label>
        <p class="small muted">${t('quotes.send.note', { email: replyTo })}</p>
        <div class="btn-row"><button class="btn btn-gold" type="submit">${q.sent_at ? t('quotes.act.resend') : t('quotes.act.send')}</button></div>
      </form>`
        : ''}
      <p class="small muted">${q.sent_at ? `${t('quotes.detail.sent', { email: q.client_email ?? '', date: day(q.sent_at, lang) })} · ${t('quotes.detail.sends', { n: q.sent_count, max: QUOTE_MAX_SENDS })}` : ''}</p>
      <p class="small muted">${q.viewed_at ? t('quotes.detail.viewed', { date: day(q.viewed_at, lang) }) : q.sent_at ? t('quotes.detail.notViewed') : ''}</p>
      <h3>${t('quotes.detail.share')}</h3>
      <p class="copy-line"><input class="copy-field" id="quote-link" readonly value="${url}" data-select-all aria-label="${t('quotes.detail.share')}"><button type="button" class="btn btn-outline btn-sm" data-copy="#quote-link" data-copied="${t('invpay.copied')}">${t('invpay.copy')}</button></p>
      <p class="small muted">${t('quotes.detail.shareHint')}</p>
      <div class="btn-row">
        <a class="btn btn-outline btn-sm" href="${url}" target="_blank" rel="noopener">${t('quotes.act.open')}</a>
        <form method="post" action="${u(`/b2b/quotes/${q.ref}/cart`)}"><button class="btn btn-outline btn-sm" type="submit">${t('quotes.act.cart')}</button></form>
        <form method="post" action="${u(`/b2b/quotes/${q.ref}/delete`)}" data-confirm="${t('quotes.act.deleteAsk', { ref: q.ref })}"><button class="btn btn-link-danger btn-sm" type="submit">${t('quotes.act.delete')}</button></form>
      </div>
      ${q.loaded_at ? html`<p class="small muted">${t('quotes.loaded', { date: day(q.loaded_at, lang) })} · <a href="${u('/b2b/package')}">${t('quotes.act.goCart')}</a></p>` : ''}
    </div>
  </div>
</div></section>`;
  return page(ctx, { title: `${t('quotes.nav')} ${q.ref}`, path: `/${lang}/b2b/quotes/${q.ref}`, body, noindex: true, activeNav: 'b2b-account', area: 'partner' });
}

/**
 * La pagina del cliente finale (dal collegamento dell'email): l'agenzia, i servizi con il prezzo per lui e il totale; accetta o rifiuta.
 * Non c'è nulla della tariffa dell'agenzia. `done`: 'approved' | 'declined' subito dopo la risposta.
 */
export function publicQuotePage(ctx, { q, done = '', error = '' }) {
  const { t, lang, app } = ctx;
  const state = statusOf(q);
  const brand = brandOf(app, q.account_id);
  const view = clientView(app, q, lang);
  const money = (c) => formatMoney(c, lang, q.currency);
  const base = `/${lang}/quotes/${q.ref}`;
  const site = app.cfg.site.name;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${brand.logo ? html`<p><img class="doc-logo" src="${base}/logo?t=${q.token}" alt="${brand.name}" width="${Math.min(brand.logo.width, 200)}"></p>` : html`<p class="eyebrow">${brand.name}</p>`}
  <h1>${t('qp.title', { ref: q.ref })}</h1>
  <p class="lead">${t('qp.lead', { agency: brand.name, client: q.client_name })}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${done ? html`<div class="notice notice-ok" role="status">${t(`qp.done.${done}`, { agency: brand.name })}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${state === 'approved' ? html`<div class="notice notice-ok" role="status">${t('qp.state.approved', { date: day(q.decided_at, lang), agency: brand.name })}</div>` : ''}
  ${state === 'declined' ? html`<div class="notice notice-err" role="status">${t('qp.state.declined', { date: day(q.decided_at, lang) })}</div>` : ''}
  ${state === 'expired' ? html`<div class="notice notice-err" role="status">${t('qp.state.expired', { date: fmtDate(q.valid_until, lang), agency: brand.name })}</div>` : ''}
  <div class="card pad">
    <h2 class="h-sub">${t('qp.services')}</h2>
    <dl class="summary-list">
      ${view.lines.map((l) => html`<div><dt><strong>${l.title}</strong><br><small>${fmtDate(l.date, lang)} · ${l.when} · ${t('quote.pax', { n: l.pax })}${partyExtra(l.party, lang)}</small>${l.meeting ? html`<br><small class="muted">${t('s.meeting')}: ${l.meeting}</small>` : ''}</dt><dd>${money(l.cents)}</dd></div>`)}
      <div class="summary-total"><dt>${t('quote.total')}</dt><dd>${money(view.totalCents)}</dd></div>
    </dl>
    <p class="small muted">${t('quote.valid')}: ${fmtDate(q.valid_until, lang)}</p>
    ${q.note ? html`<p style="white-space:pre-line">${q.note}</p>` : ''}
    <p class="btn-row"><a class="btn btn-outline btn-sm" href="${base}/quote.pdf?t=${q.token}" target="_blank" rel="noopener">${t('qp.pdf')}</a></p>
  </div>
  ${state === 'draft' || state === 'sent'
    ? html`<form class="card pad form spaced" method="post" action="${base}/answer">
    <input type="hidden" name="t" value="${q.token}">
    <label class="field"><span class="label">${t('qp.msg', { agency: brand.name })}</span><textarea name="message" rows="3" maxlength="500"></textarea></label>
    <p class="small muted">${t('qp.how', { agency: brand.name })}</p>
    <div class="btn-row"><button class="btn btn-gold btn-lg" type="submit" name="decision" value="approve">${t('qp.approve')}</button><button class="btn btn-link-danger" type="submit" name="decision" value="decline">${t('qp.decline')}</button></div>
  </form>`
    : ''}
  <p class="small muted center spaced">${t('qp.by', { agency: brand.name, site })}</p>
</div></section>`;
  return page(ctx, { title: t('qp.title', { ref: q.ref }), path: base, body, noindex: true });
}
