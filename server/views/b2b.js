import { html, raw } from '../html.js';
import { unitPriceFor } from '../bookings.js';
import { accountTiers } from '../policy.js';
import { isSimplePolicy, tierSentencesHours } from '../policyText.js';
import { fmtDate } from '../time.js';
import { formatMoney } from '../util.js';
import { SERVICES } from '../rates.js';
import { page } from './layout.js';
import { breadcrumbs, fmtDuration, fmtHours, hasHourlyProducts } from './components.js';
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

export function accountPage(ctx, { acct, bookings, flash = '' }) {
  const { t, lang, u, app } = ctx;
  const { cfg, content } = app;
  const approved = acct.status === 'approved';
  const tiers = accountTiers(cfg, acct);
  const upcoming = bookings.filter((b) => b.status !== 'expired');
  const statusChip = { pending: 'chip-warn', approved: 'chip-ok', rejected: 'chip-err', suspended: 'chip-err' }[acct.status];
  const rateServices = approved ? SERVICES.filter((s) => app.rates.has(s, 'b2b')) : [];
  const fixedTours = content.tours.filter((x) => x.pricing !== 'hourly');
  const canQuote = approved && hasHourlyProducts(ctx, 'b2b'); // senza servizi a ore prenotabili il calcolatore non avrebbe nulla da mostrare

  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.myAccount')]])}
  <div class="account-head"><div><h1>${acct.company}</h1><p class="muted">${acct.contact_name} · ${acct.email}</p></div>
    <div class="btn-row">${approved ? html`${canQuote ? html`<a class="btn btn-gold" href="${u('/hourly')}">${t('b2b.ratesCta')}</a>` : ''}<a class="btn ${canQuote ? 'btn-outline' : 'btn-gold'}" href="${u('/book')}">${t('b2b.newBooking')}</a>` : ''}<form method="post" action="${u('/b2b/logout')}"><button class="btn btn-outline" type="submit">${t('b2b.logout')}</button></form></div></div>
</div></section>
<section class="section tight"><div class="wrap">
  ${flash ? html`<div class="notice notice-ok" role="status">${t(`b2b.flash.${flash}`)}</div>` : ''}
  ${rateServices.length
    ? html`<h2 class="h-sub">${t('hourly.ratesYours')}</h2><p class="muted sub-lead">${t('b2b.ratesPartnerLead')}</p>
    ${ratesBlock(ctx, { channel: 'b2b', services: rateServices, discountPercent: acct.discount_percent ?? 0 })}
    <div class="spaced"></div>`
    : ''}
  <div class="grid grid-2 account-grid">
    <div class="card pad"><h2>${t('b2b.status')}</h2>
      <p><span class="chip ${statusChip}">${t(`b2b.st.${acct.status}`)}</span></p>
      <p class="muted">${t(`b2b.st.${acct.status}.text`)}</p>
      ${approved ? html`<ul class="plain facts-list">
        ${isSimplePolicy(tiers)
          ? html`<li><span class="muted">${t('b2b.cancelPolicy')}</span> <strong>${fmtHours(t, tiers[0].hours)}</strong></li>`
          : html`<li><span class="muted">${t('policy.title')}</span><ul class="plain tier-list">${tierSentencesHours(t, tiers, fmtHours).map((x) => html`<li>${x}</li>`)}</ul></li>`}
        <li><span class="muted">${t('b2b.discount')}</span> <strong>${acct.discount_percent ? `−${acct.discount_percent}%` : t('b2b.baseRate')}</strong></li>
        <li><span class="muted">${t('b2b.payments')}</span> <strong>${acct.allow_invoice ? t('b2b.payInvoiceCard') : t('b2b.payCardOnly')}</strong></li></ul>` : ''}
    </div>
    ${approved && fixedTours.length
      ? html`<div class="card pad"><h2>${t('b2b.rates')}</h2>
        <div class="table-wrap"><table class="table"><thead><tr><th>${t('s.service')}</th><th class="num">${t('b2b.public')}</th><th class="num">${t('b2b.yours')}</th></tr></thead><tbody>
          ${fixedTours.map((x) => html`<tr><td><a href="${u('/tours/' + x.slug)}">${x.i18n[lang].title}</a><br><small class="muted">${fmtDuration(x.durationMin, lang)} · ${x.model === 'person' ? t('price.perPerson') : t('price.perGroup')}</small></td><td class="num muted">${formatMoney(x.priceCents, lang)}</td><td class="num"><strong>${formatMoney(unitPriceFor(x, 'b2b', acct), lang)}</strong></td></tr>`)}
        </tbody></table></div></div>`
      : ''}
  </div>

  ${approved
    ? html`<h2 class="h-sub spaced">${t('b2b.myBookings')}</h2>
    ${upcoming.length
      ? html`<div class="table-wrap card"><table class="table"><thead><tr><th>${t('s.date')}</th><th>${t('s.service')}</th><th class="num">${t('s.guests')}</th><th>${t('f.clientRef')}</th><th>${t('b2b.state')}</th><th class="num">${t('s.total')}</th></tr></thead><tbody>
        ${upcoming.map((b) => html`<tr><td><a href="/${lang}/booking/${b.ref}?t=${b.token}">${fmtDate(b.date, lang, 'short')}</a><br><small class="muted">${b.start_time}</small></td><td>${content.tour(b.tour_slug).i18n[lang].title}<br><small class="muted">${b.ref}</small></td><td class="num">${b.participants}</td><td>${b.client_ref ?? ''}</td><td><span class="chip ${b.status === 'confirmed' ? 'chip-ok' : b.status === 'held' ? 'chip-warn' : 'chip-err'}">${t(`b2b.bst.${b.status}`)}</span></td><td class="num">${formatMoney(b.total_cents, lang, b.currency)}</td></tr>`)}
      </tbody></table></div>`
      : html`<p class="muted">${t('b2b.noBookings')}</p>`}`
    : ''}
</div></section>`;
  return page(ctx, { title: t('nav.myAccount'), path: `/${lang}/b2b/account`, body, noindex: true, activeNav: 'b2b' });
}
