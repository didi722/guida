import { html, raw } from '../html.js';
import { unitPriceFor } from '../bookings.js';
import { maxActiveOptions, normalizeOptionTiers } from '../optionPolicy.js';
import { PARTNER_VIEWS, hasSearch } from '../partner.js';
import { accountTiers } from '../policy.js';
import { isSimplePolicy, tierSentencesHours } from '../policyText.js';
import { daysInMonth, fmtDate, fmtInstant, fmtMonth, nowRome } from '../time.js';
import { formatMoney } from '../util.js';
import { SERVICES, openTo } from '../rates.js';
import { page } from './layout.js';
import { breadcrumbs, fmtDuration, fmtHours, hasHourlyProducts, homeCrumb, timeLeft } from './components.js';
import { ratesBlock } from './hourly.js';

const COUNTRIES = ['IT', 'DE', 'FR', 'ES', 'GB', 'US', 'NL', 'AT', 'CH', 'BE', 'PT', 'PL', 'CZ', 'SE', 'DK', 'NO', 'IE', 'JP', 'CN', 'KR', 'AU', 'CA', 'BR', 'IN', 'AE', 'OTHER'];

export function loginPage(ctx, { error = '', email = '', next = '' } = {}) {
  const { t, lang, u } = ctx;
  const body = html`
<section class="page-head"><div class="wrap narrow">${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.b2b'), u('/b2b')], [t('b2b.login')]])}<h1>${t('b2b.loginTitle')}</h1></div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <form method="post" action="${u('/b2b/login')}" class="form">
      <input type="hidden" name="next" value="${next}">
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required autocomplete="username" value="${email}"></label>
      <label class="field"><span class="label">${t('f.password')}</span><input type="password" name="password" required autocomplete="current-password"></label>
      <button class="btn btn-gold btn-block" type="submit">${t('b2b.login')}</button>
    </form>
    <p class="small muted center">${t('b2b.noAccount')} <a href="${u('/b2b/register')}">${t('b2b.requestAccess')}</a></p>
  </div>
</div></section>`;
  return page(ctx, { title: t('b2b.login'), path: `/${lang}/b2b/login`, body, noindex: true, activeNav: 'b2b' });
}

export function registerPage(ctx, { error = '', values = {}, done = false } = {}) {
  const { t, lang, u } = ctx;
  const v = (k, d = '') => values[k] ?? d;
  const body = done
    ? html`<section class="page-head"><div class="wrap narrow center"><div class="status status-ok"><span class="status-dot"></span><div><h1>${t('b2b.reg.doneTitle')}</h1><p class="lead">${t('b2b.reg.doneText')}</p></div></div>
        <p class="btn-row center"><a class="btn btn-outline" href="${u('/')}">${t('nav.home')}</a></p></div></section>`
    : html`
<section class="page-head"><div class="wrap narrow">${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.b2b'), u('/b2b')], [t('b2b.requestAccess')]])}<h1>${t('b2b.reg.title')}</h1><p class="lead">${t('b2b.reg.lead')}</p></div></section>
<section class="section tight"><div class="wrap narrow">
  <form method="post" action="${u('/b2b/register')}" class="card pad form">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <h2>${t('b2b.reg.company')}</h2>
    <div class="form-grid">
      <label class="field"><span class="label">${t('b2b.reg.companyName')}</span><input name="company" required maxlength="160" autocomplete="organization" value="${v('company')}"></label>
      <label class="field"><span class="label">${t('b2b.reg.vat')}</span><input name="vat" required maxlength="40" value="${v('vat')}"></label>
      <label class="field"><span class="label">${t('b2b.reg.country')}</span><select name="country">${COUNTRIES.map((c) => html`<option value="${c}" ${v('country', 'IT') === c ? raw('selected') : ''}>${c === 'OTHER' ? t('b2b.reg.other') : c}</option>`)}</select></label>
      <label class="field"><span class="label">${t('b2b.reg.website')} <em>${t('f.optional')}</em></span><input type="url" name="website" maxlength="200" placeholder="https://" value="${v('website')}"></label>
      <label class="field"><span class="label">${t('b2b.reg.sdi')} <em>${t('b2b.reg.sdiHint')}</em></span><input name="sdi_code" maxlength="10" value="${v('sdi_code')}"></label>
      <label class="field"><span class="label">${t('b2b.reg.pec')} <em>${t('f.optional')}</em></span><input type="email" name="pec" maxlength="200" value="${v('pec')}"></label>
    </div>
    <label class="field"><span class="label">${t('b2b.reg.address')} <em>${t('f.optional')}</em></span><input name="address" maxlength="250" autocomplete="street-address" value="${v('address')}"></label>
    <h2>${t('b2b.reg.contact')}</h2>
    <div class="form-grid">
      <label class="field"><span class="label">${t('f.name')}</span><input name="contact_name" required maxlength="120" autocomplete="name" value="${v('contact_name')}"></label>
      <label class="field"><span class="label">${t('f.phone')}</span><input type="tel" name="phone" required maxlength="40" autocomplete="tel" value="${v('phone')}"></label>
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="username" value="${v('email')}"></label>
      <label class="field"><span class="label">${t('f.password')} <em>${t('b2b.reg.pwHint')}</em></span><input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
    </div>
    <label class="field"><span class="label">${t('b2b.reg.message')} <em>${t('f.optional')}</em></span><textarea name="message" rows="3" maxlength="1000" placeholder="${t('b2b.reg.messageHint')}">${v('message')}</textarea></label>
    <label class="check consent"><input type="checkbox" name="consent" value="1" required> <span>${t('f.consent')} <a href="${u('/terms')}" target="_blank">${t('footer.terms')}</a> · <a href="${u('/privacy')}" target="_blank">${t('footer.privacy')}</a></span></label>
    <input class="hp" type="text" name="website2" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button class="btn btn-gold btn-block btn-lg" type="submit">${t('b2b.reg.submit')}</button>
  </form>
</div></section>`;
  return page(ctx, { title: t('b2b.requestAccess'), path: `/${lang}/b2b/register`, body, noindex: true, activeNav: 'b2b' });
}

// ───────────────────────── Area riservata dell'agenzia ─────────────────────────
/** Messaggi che le azioni dell'elenco (rilascia, conferma) possono lasciare al ritorno sulla dashboard. */
const FLASH = ['option-confirmed', 'option-released', 'option-expired', 'option-error', 'cancelled', 'cancel-error'];
/** Lo stato di una prenotazione a parole (anche per l'esportazione): un'opzione scaduta non è una prenotazione «scaduta». */
export const bookingStatusText = (t, b) => (b.status === 'expired' && b.option_expires_at ? t('b2b.bst.optionExpired') : t(`b2b.bst.${b.status}`));

function statusChip(ctx, b) {
  const { t, lang } = ctx;
  if (b.status === 'option') return html`<span class="chip chip-warn">${t('b2b.bst.option')}</span><small class="muted">${t('partner.optUntil', { when: fmtInstant(Date.parse(b.option_expires_at), lang) })}</small>`;
  const cls = { confirmed: 'chip-ok', held: 'chip-warn' }[b.status] ?? 'chip-err';
  return html`<span class="chip ${cls}">${bookingStatusText(t, b)}</span>`;
}

/** Le condizioni dell'account in poche righe (sconto, annullo, pagamento): stesse parole nella pagina dedicata e nel riquadro in alto. */
function termsFacts(ctx, acct) {
  const { t, app } = ctx;
  const tiers = accountTiers(app.cfg, acct);
  return html`<ul class="plain facts-list">
    ${isSimplePolicy(tiers)
      ? html`<li><span class="muted">${t('b2b.cancelPolicy')}</span> <strong>${fmtHours(t, tiers[0].hours)}</strong></li>`
      : html`<li><span class="muted">${t('policy.title')}</span><ul class="plain tier-list">${tierSentencesHours(t, tiers, fmtHours).map((x) => html`<li>${x}</li>`)}</ul></li>`}
    <li><span class="muted">${t('b2b.discount')}</span> <strong>${acct.discount_percent ? `−${acct.discount_percent}%` : t('b2b.baseRate')}</strong></li>
    <li><span class="muted">${t('b2b.payments')}</span> <strong>${acct.allow_invoice ? t('b2b.payInvoiceCard') : t('b2b.payCardOnly')}</strong></li>
    <li><span class="muted">${t('partner.terms.options')}</span> ${optionTerms(ctx, acct)}</li>
  </ul>`;
}

/** Quanto dura un'opzione per questo account: durata fissa o tabella del sito (la stessa che si modifica dal pannello). */
function optionTerms(ctx, acct) {
  const { t, app } = ctx;
  const { options } = app.cfg;
  if (!options.enabled || acct.options_enabled === 0) return html`<strong>${t('partner.terms.optionsOff')}</strong>`;
  const day = 86_400_000;
  const fixed = Number(acct.option_days) > 0 ? Number(acct.option_days) : null;
  const max = maxActiveOptions(options, acct);
  return html`<ul class="plain tier-list">
    ${fixed ? html`<li>${t('partner.terms.optFixed', { days: timeLeft(t, fixed * day) })}</li>` : normalizeOptionTiers(options.tiers).map((x) => html`<li>${t('partner.terms.optTier', { from: timeLeft(t, x.fromDays * day), days: timeLeft(t, x.days * day) })}</li>`)}
    <li>${t('partner.terms.optRelease', { hours: fmtHours(t, options.minReleaseHours) })}</li>
    ${max > 0 ? html`<li>${t('partner.terms.optMax', { n: max })}</li>` : ''}
  </ul>`;
}

function pendingPage(ctx, acct) {
  const { t, lang, u } = ctx;
  const chip = { pending: 'chip-warn', rejected: 'chip-err', suspended: 'chip-err' }[acct.status];
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.agencyArea')]])}
  <h1>${acct.company}</h1><p class="muted">${acct.contact_name} · ${acct.email}</p>
</div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad"><h2>${t('b2b.status')}</h2>
    <p><span class="chip ${chip}">${t(`b2b.st.${acct.status}`)}</span></p>
    <p class="muted">${t(`b2b.st.${acct.status}.text`)}</p>
    <div class="btn-row"><a class="btn btn-outline" href="${u('/contact')}">${t('nav.contact')}</a><form method="post" action="${u('/b2b/logout')}"><button class="btn btn-outline" type="submit">${t('b2b.logout')}</button></form></div>
  </div>
</div></section>`;
  return page(ctx, { title: t('nav.agencyArea'), path: `/${lang}/b2b/account`, body, noindex: true, activeNav: 'b2b-account' });
}

/**
 * La dashboard dell'agenzia: riepilogo, ricerca e filtri, elenco delle prenotazioni con le azioni di ogni giorno.
 * list: { rows, counts, total, page, pages, view } · summary: vedi partnerSummary · filters: vedi parseFilters.
 */
export function accountPage(ctx, { acct, filters, list, summary, flash = '' }) {
  if (acct.status !== 'approved') return pendingPage(ctx, acct);
  const { t, lang, u, app } = ctx;
  const { content } = app;
  const base = u('/b2b/account');
  const canQuote = hasHourlyProducts(ctx, 'b2b'); // senza servizi a ore prenotabili il calcolatore non avrebbe nulla da mostrare
  const searching = hasSearch(filters);
  // link che conservano ricerca e date e cambiano solo ciò che serve (scheda, pagina)
  const qs = (over = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: filters.q, from: filters.from, to: filters.to, bfrom: filters.bfrom, bto: filters.bto, view: filters.view, ...over })) if (v) p.set(k, String(v));
    return p.toString() ? `?${p}` : '';
  };
  const detail = (b) => u(`/b2b/bookings/${b.ref}`);
  const flashKey = FLASH.includes(flash) ? `booking.flash.${flash}` : '';
  const month = fmtMonth(summary.month.month, lang);

  const kpi = (href, label, value, note, tone = '') => html`<a class="kpi ${tone}" href="${href}"><span class="kpi-l">${label}</span><strong class="kpi-n">${value}</strong><span class="kpi-s">${note}</span></a>`;
  const optionsSoon = summary.options.nextMs != null && summary.options.nextMs - Date.now() < 48 * 3600_000;

  const body = html`
<section class="page-head partner-head"><div class="wrap">
  <div class="account-head">
    <div><p class="eyebrow">${t('nav.agencyArea')}</p><h1>${acct.company}</h1><p class="muted">${acct.contact_name} · ${acct.email}</p></div>
    <div class="btn-row"><a class="btn btn-gold btn-lg" href="${u('/book')}">${t('partner.nav.new')}</a>${canQuote ? html`<a class="btn btn-outline btn-lg" href="${u('/hourly')}">${t('b2b.ratesCta')}</a>` : ''}</div>
  </div>
</div></section>
<section class="section tight"><div class="wrap">
  ${flashKey ? html`<div class="notice notice-${/error|expired|locked/.test(flash) ? 'err' : 'ok'}" role="status">${t(flashKey)}</div>` : ''}
  ${flash === 'welcome' ? html`<div class="notice notice-ok" role="status">${t('b2b.flash.welcome')}</div>` : ''}

  <div class="kpis">
    ${kpi(`${base}?view=upcoming`, t('partner.kpi.upcoming'), summary.upcoming.count, t('partner.kpi.pax', { n: summary.upcoming.pax }))}
    ${kpi(`${base}?view=options`, t('partner.kpi.options'), summary.options.count, summary.options.nextMs ? t('partner.kpi.optNext', { when: fmtInstant(summary.options.nextMs, lang) }) : t('partner.kpi.optNone'), optionsSoon ? 'kpi-warn' : '')}
    ${kpi(`${base}?view=all&from=${summary.month.month}-01&to=${summary.month.month}-${String(daysInMonth(summary.month.month)).padStart(2, '0')}`, t('partner.kpi.month', { month }), summary.month.count, formatMoney(summary.month.cents, lang))}
    ${kpi(`${u('/b2b/invoices')}`, t('partner.kpi.due'), formatMoney(summary.due.cents, lang), summary.due.cents ? t('partner.kpi.dueNote') : t('partner.kpi.dueNone'), summary.due.cents ? 'kpi-due' : '')}
  </div>

  <details class="terms-strip card"><summary>${t('partner.terms.title')} <span class="muted">· ${acct.discount_percent ? `−${acct.discount_percent}%` : t('b2b.baseRate')} · ${acct.allow_invoice ? t('b2b.payInvoiceCard') : t('b2b.payCardOnly')}</span></summary>
    ${termsFacts(ctx, acct)}
    <p class="small"><a href="${u('/b2b/rates')}">${t('partner.terms.all')} →</a></p>
  </details>

  <div class="tabs-bar">
    <div class="tabs" role="tablist" aria-label="${t('b2b.myBookings')}">
      ${PARTNER_VIEWS.map((v) => html`<a class="tab" role="tab" href="${base}${qs({ view: v, page: '' })}" aria-selected="${v === filters.view ? 'true' : 'false'}" ${v === filters.view ? raw('aria-current="page"') : ''}>${t(`partner.tab.${v}`)} <span class="tab-n">${list.counts[v]}</span></a>`)}
    </div>
    ${list.total ? html`<a class="tabs-export small" href="${u('/b2b/bookings.csv')}${qs({ page: '' })}">${t('partner.export')}</a>` : ''}
  </div>

  <form class="filters" method="get" action="${base}">
    ${filters.explicit ? html`<input type="hidden" name="view" value="${filters.view}">` : ''}
    <label class="field filters-q"><span class="sr-only">${t('partner.search.label')}</span><input type="search" name="q" value="${filters.q}" maxlength="80" placeholder="${t('partner.search.ph')}" autocomplete="off"></label>
    <button class="btn btn-dark" type="submit">${t('partner.search.btn')}</button>
    <details class="filters-more" ${filters.from || filters.to || filters.bfrom || filters.bto ? raw('open') : ''}><summary>${t('partner.filter.dates')}</summary>
      <div class="filters-dates">
        <label class="field"><span class="label">${t('partner.filter.depFrom')}</span><input type="date" name="from" value="${filters.from}"></label>
        <label class="field"><span class="label">${t('partner.filter.depTo')}</span><input type="date" name="to" value="${filters.to}"></label>
        <label class="field"><span class="label">${t('partner.filter.bookFrom')}</span><input type="date" name="bfrom" value="${filters.bfrom}"></label>
        <label class="field"><span class="label">${t('partner.filter.bookTo')}</span><input type="date" name="bto" value="${filters.bto}"></label>
      </div>
    </details>
    ${searching ? html`<p class="filters-links small"><a href="${base}?view=${filters.view}">${t('partner.filter.clear')}</a></p>` : ''}
  </form>

  ${list.rows.length
    ? html`<div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr>
        <th>${t('partner.col.file')}</th><th>${t('s.service')}</th><th>${t('s.date')}</th><th class="num">${t('s.guests')}</th><th>${t('b2b.state')}</th><th class="num">${t('s.total')}</th><th><span class="sr-only">${t('partner.col.actions')}</span></th></tr></thead><tbody>
      ${list.rows.map((b) => {
        const tour = content.tour(b.tour_slug);
        return html`<tr class="pb-${b.status}">
          <td data-label="${t('partner.col.file')}"><a class="pb-title" href="${detail(b)}">${b.client_ref || b.name}</a><small class="muted">${b.client_ref ? `${b.name} · ` : ''}${b.ref}</small></td>
          <td data-label="${t('s.service')}">${tour?.i18n[lang].title ?? b.tour_slug}<small class="muted">${b.start_time}–${b.end_time}</small></td>
          <td data-label="${t('s.date')}"><strong>${fmtDate(b.date, lang, 'short')}</strong><small class="muted">${t('partner.bookedOn', { date: fmtDate(nowRome(Date.parse(b.created_at)).date, lang, 'short') })}</small></td>
          <td class="num" data-label="${t('s.guests')}">${b.participants}</td>
          <td data-label="${t('b2b.state')}">${statusChip(ctx, b)}</td>
          <td class="num" data-label="${t('s.total')}">${formatMoney(b.total_cents, lang, b.currency)}</td>
          <td class="pb-actions"><div class="pb-actions-in">
            ${b.status === 'option' ? html`<a class="btn btn-gold btn-sm" href="${detail(b)}#option">${t('partner.act.confirm')}</a>` : html`<a class="btn btn-outline btn-sm" href="${detail(b)}">${t('partner.act.open')}</a>`}
            ${b.status === 'confirmed' ? html`<a class="btn btn-outline btn-sm" href="${detail(b)}/voucher.pdf" target="_blank" rel="noopener">${t('partner.act.voucher')}</a>` : ''}
            ${b.invoice ? html`<a class="btn btn-outline btn-sm" href="${u(`/b2b/invoices/${b.invoice.id}/pdf`)}" target="_blank" rel="noopener">${t('partner.act.invoice', { n: b.invoice.number })}</a>` : ''}
            ${b.status === 'option'
              ? html`<form method="post" action="${u(`/booking/${b.ref}/option/release`)}" data-confirm="${t('booking.optionReleaseAsk')}"><input type="hidden" name="t" value="${b.token}"><input type="hidden" name="next" value="${base}"><button class="btn btn-link-danger btn-sm" type="submit">${t('partner.act.release')}</button></form>`
              : ''}
          </div></td></tr>`;
      })}
    </tbody></table></div>
    ${list.pages > 1
      ? html`<nav class="pager" aria-label="${t('partner.page.aria')}">
        ${list.page > 1 ? html`<a class="btn btn-outline btn-sm" href="${base}${qs({ page: list.page - 1 })}">‹ ${t('partner.page.prev')}</a>` : html`<span></span>`}
        <span class="muted small">${t('partner.page.of', { n: list.page, total: list.pages })}</span>
        ${list.page < list.pages ? html`<a class="btn btn-outline btn-sm" href="${base}${qs({ page: list.page + 1 })}">${t('partner.page.next')} ›</a>` : html`<span></span>`}
      </nav>`
      : ''}`
    : html`<div class="card pad center empty-state">
        <p>${searching ? t('partner.results.none') : list.counts.all ? t('partner.results.noneHere') : t('partner.results.empty')}</p>
        <p class="btn-row center">${searching ? html`<a class="btn btn-outline" href="${base}?view=${filters.view}">${t('partner.filter.clear')}</a>` : html`<a class="btn btn-gold" href="${u('/book')}">${t('partner.nav.new')}</a>`}</p>
      </div>`}
</div></section>`;
  return page(ctx, { title: t('partner.nav.bookings'), path: `/${lang}/b2b/account`, body, noindex: true, activeNav: 'b2b-account', area: 'partner' });
}

/** Tariffe e condizioni dell'account: solo ciò che vale per l'agenzia (mai i prezzi al pubblico). */
export function ratesPage(ctx, { acct }) {
  const { t, lang, u, app } = ctx;
  const rateServices = SERVICES.filter((s) => app.rates.has(s, 'b2b'));
  const fixedTours = app.content.tours.filter((x) => x.active && x.pricing !== 'hourly' && openTo(app.rates.get(), x, 'b2b'));
  const canQuote = hasHourlyProducts(ctx, 'b2b');
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('partner.nav.rates')]])}
  <div class="account-head"><div><h1>${t('partner.rates.title')}</h1><p class="lead">${t('partner.rates.lead')}</p></div>
    <div class="btn-row"><a class="btn btn-gold" href="${u('/book')}">${t('partner.nav.new')}</a>${canQuote ? html`<a class="btn btn-outline" href="${u('/hourly')}">${t('b2b.ratesCta')}</a>` : ''}</div></div>
</div></section>
<section class="section tight"><div class="wrap">
  <div class="card pad"><h2>${t('partner.terms.title')}</h2>${termsFacts(ctx, acct)}</div>
  ${rateServices.length
    ? html`<h2 class="h-sub spaced">${t('hourly.ratesYours')}</h2><p class="muted sub-lead">${t('b2b.ratesPartnerLead')}</p>
    ${ratesBlock(ctx, { channel: 'b2b', services: rateServices, discountPercent: acct.discount_percent ?? 0 })}`
    : ''}
  ${fixedTours.length
    ? html`<h2 class="h-sub spaced">${t('partner.rates.fixed')}</h2>
    <div class="table-wrap card"><table class="table"><thead><tr><th>${t('s.service')}</th><th class="num">${t('b2b.yours')}</th></tr></thead><tbody>
      ${fixedTours.map((x) => html`<tr><td>${x.i18n[lang].title}<br><small class="muted">${fmtDuration(x.durationMin, lang)} · ${x.model === 'person' ? t('price.perPerson') : t('price.perGroup')}</small></td><td class="num"><strong>${formatMoney(unitPriceFor(x, 'b2b', acct), lang)}</strong></td></tr>`)}
    </tbody></table></div>`
    : ''}
</div></section>`;
  return page(ctx, { title: t('partner.nav.rates'), path: `/${lang}/b2b/rates`, body, noindex: true, activeNav: 'b2b-rates', area: 'partner' });
}

/** Fatture e note di credito emesse all'agenzia, con la copia in PDF. */
export function invoicesPage(ctx, { acct, invoices, due }) {
  const { t, lang, u } = ctx;
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('partner.nav.invoices')]])}
  <h1>${t('partner.inv.title')}</h1><p class="lead">${t('partner.inv.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap">
  ${due.cents ? html`<div class="notice notice-info" role="note">${t('partner.inv.due', { amount: formatMoney(due.cents, lang) })}</div>` : ''}
  ${invoices.length
    ? html`<div class="table-wrap card"><table class="table table-stack"><thead><tr><th>${t('partner.inv.number')}</th><th>${t('s.date')}</th><th>${t('partner.inv.type')}</th><th class="num">${t('s.total')}</th><th><span class="sr-only">PDF</span></th></tr></thead><tbody>
      ${invoices.map((i) => html`<tr>
        <td data-label="${t('partner.inv.number')}"><strong>${i.number}</strong></td>
        <td data-label="${t('s.date')}">${fmtDate(i.issue_date, lang, 'short')}</td>
        <td data-label="${t('partner.inv.type')}">${i.doc_type === 'TD04' ? t('partner.inv.td04') : t('partner.inv.td01')}</td>
        <td class="num" data-label="${t('s.total')}">${formatMoney(i.total_cents, lang, i.currency)}</td>
        <td class="pb-actions"><div class="pb-actions-in"><a class="btn btn-outline btn-sm" href="${u(`/b2b/invoices/${i.id}/pdf`)}" target="_blank" rel="noopener">${t('partner.inv.pdf')}</a></div></td></tr>`)}
    </tbody></table></div>`
    : html`<div class="card pad center empty-state"><p>${t('partner.inv.none')}</p></div>`}
  <p class="small muted">${acct.allow_invoice ? t('partner.inv.howInvoice') : t('partner.inv.howCard')}</p>
</div></section>`;
  return page(ctx, { title: t('partner.nav.invoices'), path: `/${lang}/b2b/invoices`, body, noindex: true, activeNav: 'b2b-invoices', area: 'partner' });
}
