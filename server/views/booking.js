import { html, raw } from '../html.js';
import { bookingDue, cancellationState, inviteDiscountOwed, paymentOptions, priceFor, unitPriceFor } from '../bookings.js';
import { freeHoursOf, hasFreeTier, policyFor, refundPercentAt } from '../policy.js';
import { isSimplePolicy, tierSentences } from '../policyText.js';
import { fmtDate, fmtInstant, localToInstant } from '../time.js';
import { isPreOpening, paymentsFrom } from '../opening.js';
import { isEditable } from '../partner.js';
import { formatMoney } from '../util.js';
import { LANGS, LANG_META } from '../langs.js';
import { inviteLink } from '../invites.js';
import { firmTiers } from '../optionPolicy.js';
import { DEFAULT_MEETING, hasThemes, meetingOf, themeText } from '../choices.js';
import { icon, page } from './layout.js';
import { walletOptions } from '../wallet.js';
import { areaOf, breadcrumbs, departuresList, durationText, fmtDuration, fmtHours, homeCrumb, hoursLabel, langOptions, timeLeft, tourMedia } from './components.js';
import { quoteLines } from './hourly.js';
import { changeBox, extensionBox } from './changes.js';
import { pendingExtension } from '../changes.js';
import { extraHourOptions, parseServiceRecord } from '../rates.js';

const slotUrl = (u, tour, date, time, pax) => `${u('/book/checkout')}?tour=${encodeURIComponent(tour)}&date=${date}&time=${time}&pax=${pax}`;

// ───────────────────────── Pagina "Prenota" (prima la data) ─────────────────────────
/** Avviso «pre-apertura»: prenotazioni aperte, ma i pagamenti online partono più avanti. */
export function preOpenNotice(ctx, { agency = false } = {}) {
  const { app, t, lang } = ctx;
  if (!isPreOpening(app.cfg)) return '';
  return html`<div class="notice notice-info" role="note">${t(agency ? 'preopen.agency' : 'preopen.notice', { date: fmtDate(paymentsFrom(app.cfg), lang, 'date') })}</div>`;
}

export function bookPage(ctx, { date, pax, tourSlug, minDate, results, suggestions, departures = [], channel, kinds = { shown: false }, tours = ctx.app.content.tours, hourly = false }) {
  const { t, lang, u, app } = ctx;
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('nav.book')]])}
  <h1>${t('book.title')}</h1><p class="lead">${t('book.lead')}</p>
  ${channel === 'b2b' ? html`<p><span class="chip chip-accent">${t('b2b.partnerRate')}</span> ${t('book.partnerNote')}</p>` : ''}
  ${preOpenNotice(ctx, { agency: channel === 'b2b' })}
</div></section>

<section class="section tight"><div class="wrap">
  <form class="card pad search-card" method="get" action="${u('/book')}">
    <label class="field"><span class="label">${t('quick.date')}</span><input type="date" name="date" min="${minDate}" value="${date ?? ''}" required></label>
    <label class="field"><span class="label">${t('quick.guests')}</span><select name="pax">${Array.from({ length: 25 }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === pax ? raw('selected') : ''}>${n}</option>`)}</select></label>
    <label class="field"><span class="label">${t('book.tour')}</span>
      <select name="tour"><option value="">${t('book.allTours')}</option>${tours.map((x) => html`<option value="${x.slug}" ${x.slug === tourSlug ? raw('selected') : ''}>${x.i18n[lang].title}</option>`)}</select>
    </label>
    <button class="btn btn-gold" type="submit">${t('quick.go')}</button>
  </form>
  ${hourly && channel !== 'b2b' ? html`<p class="hourly-hint">${t('book.hourlyHint')} <a href="${u('/hourly')}">${t('book.hourlyLink')} →</a></p>` : ''}

  ${date
    ? html`<h2 class="h-sub spaced">${t('book.resultsFor', { date: fmtDate(date, lang) })}</h2>
      ${results.length
        ? html`<div class="results">${results.map(({ tour, slots, hours: serviceHours, quote }) => {
            const ti = tour.i18n[lang];
            const isHourly = tour.pricing === 'hourly';
            const unit = isHourly ? 0 : unitPriceFor(tour, channel, ctx.acct);
            const checkoutUrl = (time) => `${u('/book/checkout')}?tour=${encodeURIComponent(tour.slug)}&date=${date}&time=${time}&pax=${pax}${isHourly && tour.chooseHours ? `&hours=${serviceHours}` : ''}`;
            return html`<article class="card result reveal">
              <div class="result-media">${tourMedia(ctx, tour, '')}</div>
              <div class="result-body">
                <h3><a href="${u('/tours/' + tour.slug)}">${ti.title}</a> ${tour.model === 'person' ? '' : html`<span class="chip">${t('tour.kindPrivate')}</span>`}</h3>
                ${isHourly
                  ? html`<p class="muted small">${tour.chooseHours ? t('price.from', { price: formatMoney(quote.totalCents, lang) }) : formatMoney(quote.totalCents, lang)} · ${hoursLabel(t, lang, serviceHours)} · ${tour.chooseHours ? t('book.privateSlots', { hours: hoursLabel(t, lang, serviceHours) }) : t('book.forGroup')}</p>`
                  : html`<p class="muted small">${durationText(t, lang, tour)} · ${tour.model === 'person' ? t('tour.maxPeople', { n: tour.maxParticipants }) : t('tour.upTo', { n: tour.maxParticipants })} · <strong>${formatMoney(tour.model === 'person' ? unit * pax : unit, lang)}</strong> <span class="muted">${tour.model === 'person' ? t('book.forPax', { n: pax }) : t('book.forGroup')}</span></p>`}
                <div class="slot-list">${slots.map((s) => html`<a class="slot" href="${isHourly ? checkoutUrl(s.time) : slotUrl(u, tour.slug, date, s.time, pax)}"><strong>${s.time}</strong>${tour.model === 'person' ? html`<small>${s.joined ? t('book.confirmedDeparture') : t('book.newDeparture')}${s.lang ? html` · ${t('w.inLang', { lang: LANG_META[s.lang].name })}` : ''}${s.left <= 4 ? html` · ${t('w.left', { n: s.left })}` : ''}</small>` : ''}</a>`)}</div>
                ${isHourly && tour.chooseHours ? html`<p class="small"><a href="${u('/hourly')}?product=${tour.slug}&date=${date}&pax=${pax}">${t('book.privateOther')}</a></p>` : ''}
              </div>
            </article>`;
          })}</div>`
        : html`<div class="card pad empty"><p>${t('book.none')}</p>
            ${suggestions.length ? html`<p>${t('book.nextDates')}</p><p class="date-chips">${suggestions.map((d) => html`<a class="chip chip-link" href="${u('/book')}?date=${d}&pax=${pax}${tourSlug ? '&tour=' + tourSlug : ''}${kinds.shown ? '&kinds=1' + (kinds.private ? '&kind=private' : '') + (kinds.shared ? '&kind=shared' : '') : ''}">${fmtDate(d, lang, 'weekday')}</a>`)}</p>` : ''}
            <p class="small muted">${t('book.askUs')} <a href="${u('/contact')}">${t('nav.contact')}</a></p></div>`}`
    : html`<p class="muted spaced">${t('book.pickPrompt')}</p>
      ${departures.length ? html`<h2 class="h-sub spaced">${t('departures.title')}</h2>${departuresList(ctx, departures, { pax })}` : ''}`}
</div></section>`;
  return page(ctx, { title: t('nav.book'), description: t('book.lead'), path: `/${lang}/book`, body, activeNav: 'book', area: areaOf(ctx) });
}

// ───────────────────────── Checkout ─────────────────────────
export function checkoutPage(ctx, { tour, date, time, pax, slot, values = {}, error = '', channel, pricing, option = null, hours: serviceHours = null, earpieces = false }) {
  const extraOptions = extraHourOptions(tour, channel);
  const { t, lang, u, app, acct } = ctx;
  const { cfg } = app;
  const hourly = tour.pricing === 'hourly';
  const rates = hourly ? app.rates.get() : null;
  const duration = hourly ? serviceHours * 60 : tour.durationMin;
  const ti = tour.i18n[lang];
  pricing ??= { listCents: priceFor(tour, pax, channel, acct), discountCents: 0, totalCents: priceFor(tour, pax, channel, acct), giftCents: 0, dueCents: priceFor(tour, pax, channel, acct), promo: null, gifts: [], errors: {} };
  const nothingToPay = pricing.dueCents === 0;
  const options = paymentOptions(app, tour, channel, acct);
  const startMs = localToInstant(date, time);
  const baseTiers = policyFor(cfg, tour, channel, acct);
  const firm = channel === 'b2b' ? firmTiers({ options: cfg.options, tiers: baseTiers, startMs, nowMs: Date.now() }) : { applied: false, tiers: baseTiers }; // data lontana: la prenotazione diretta ha una cancellazione gratuita breve
  const tiers = firm.tiers;
  const hours = freeHoursOf(tiers);
  const deadline = startMs - hours * 3600_000;
  const refundable = hasFreeTier(tiers) && Date.now() <= deadline;
  const refundNow = refundPercentAt(tiers, startMs, Date.now());
  const method = values.paymentMethod && options.includes(values.paymentMethod) ? values.paymentMethod : (options[0] ?? null);
  const isB2b = channel === 'b2b';
  const v = (k, d = '') => values[k] ?? d;
  const optionBox = option?.ok
    ? html`<div class="option-box ${firm.applied ? 'is-recommended' : ''}">${firm.applied ? html`<span class="chip chip-accent">${t('firm.recommended')}</span>` : ''}<h3>${t('option.title')}</h3>
          <p>${t('option.text', { until: fmtInstant(option.expiresMs, lang), days: timeLeft(t, option.expiresMs - Date.now()) })}</p>
          <button class="btn ${firm.applied ? 'btn-gold' : 'btn-outline'} btn-block" type="submit" name="action" value="option" id="option-submit">${t('option.btn')}</button></div>`
    : '';
  // lingua del tour: tra quelle offerte; se la partenza condivisa ha già qualcuno, vale la lingua di chi ha prenotato per primo
  const offered = tour.languages;
  const tourLang = slot.lang && offered.includes(slot.lang) ? slot.lang : offered.includes(v('tourLang')) ? v('tourLang') : offered.includes(lang) ? lang : offered[0];
  const tourLangField = slot.lang
    ? html`<div class="field"><span class="label">${t('f.tourLang')}</span><strong>${LANG_META[tourLang].name}</strong><input type="hidden" name="tourLang" value="${tourLang}"><small class="muted">${t('checkout.langLocked', { lang: LANG_META[tourLang].name })}</small></div>`
    : offered.length > 1
      ? html`<label class="field"><span class="label">${t('f.tourLang')}</span><select name="tourLang">${offered.map((l) => html`<option value="${l}" ${l === tourLang ? raw('selected') : ''}>${LANG_META[l].name}</option>`)}</select><small class="muted">${t('f.tourLangHint')}</small></label>`
      : html`<input type="hidden" name="tourLang" value="${tourLang}">`;

  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('nav.book'), u('/book')], [t('checkout.title')]])}
  <h1>${t('checkout.title')}</h1>
  ${preOpenNotice(ctx, { agency: isB2b })}
</div></section>
<section class="section tight"><div class="wrap checkout-grid">
  <form class="card pad form" method="post" action="${u('/book/checkout')}" id="checkout-form">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <input type="hidden" name="tour" value="${tour.slug}"><input type="hidden" name="date" value="${date}"><input type="hidden" name="time" value="${time}">${hourly && tour.chooseHours ? html`<input type="hidden" name="hours" value="${serviceHours}">` : ''}
    <button type="submit" name="apply" value="1" formnovalidate hidden tabindex="-1" id="pax-apply"></button>
    <h2>${isB2b ? t('checkout.contactB2b') : t('checkout.contact')}</h2>
    <div class="form-grid">
      <label class="field"><span class="label">${t('f.name')}</span><input name="name" required maxlength="120" autocomplete="name" value="${v('name', isB2b ? acct.contact_name : '')}"></label>
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="email" value="${v('email', isB2b ? acct.email : '')}"></label>
      <label class="field"><span class="label">${t('f.phone')} <em>${isB2b ? t('f.phoneB2b') : t('f.optional')}</em></span><input type="tel" name="phone" maxlength="40" autocomplete="tel" value="${v('phone', isB2b ? (acct.phone ?? '') : '')}"></label>
      ${tourLangField}
      ${tour.meetingChoice ? html`<label class="field wide"><span class="label">${t('f.pickup')} <em>${t('f.optional')}</em></span><input name="pickup" maxlength="200" value="${v('pickup')}" placeholder="${t('f.pickupHint')}" autocomplete="off"><small class="muted">${isB2b ? t('f.pickupNoteB2b') : t('f.pickupNote', { place: DEFAULT_MEETING.text[lang] })}</small></label>` : ''}
      <label class="field"><span class="label">${t('f.lang')}</span><select name="lang">${langOptions(v('lang', lang))}</select></label>
    </div>
    ${hasThemes(tour)
      ? html`<fieldset class="field themes"><legend class="label">${t('f.theme')}</legend>
        ${ti.themes.map((x, i) => html`<label class="check"><input type="radio" name="theme" value="${i}" required ${v('theme') === String(i) ? raw('checked') : ''}> <span>${x}</span></label>`)}
        ${tour.themeOther ? html`<label class="check"><input type="radio" name="theme" value="other" required ${v('theme') === 'other' ? raw('checked') : ''}> <span>${t('f.themeOther')}</span></label>
          <textarea name="themeNote" rows="3" maxlength="500" placeholder="${t('f.themeNote')}" aria-label="${t('f.themeNote')}">${v('themeNote')}</textarea>` : ''}</fieldset>`
      : ''}
    ${isB2b ? html`<label class="field"><span class="label">${t('f.clientRef')}</span><input name="clientRef" maxlength="120" value="${v('clientRef')}" placeholder="${t('f.clientRefHint')}"></label>` : ''}
    <label class="field"><span class="label">${t('f.notes')} <em>${t('f.optional')}</em></span><textarea name="notes" rows="3" maxlength="1000" placeholder="${isB2b ? t('f.notesHintB2b') : t('f.notesHint')}">${v('notes')}</textarea></label>

    ${!isB2b
      ? html`<details class="invoice-opt" ${values.invoice ? raw('open') : ''}><summary>${t('f.invoiceAsk')}</summary>
        <label class="check"><input type="checkbox" name="invoice" value="1" ${values.invoice ? raw('checked') : ''}> ${t('f.invoiceCheck')}</label>
        <label class="field"><span class="label">${t('f.invoiceData')}</span><textarea name="billing" rows="3" maxlength="500" placeholder="${t('f.invoiceHint')}">${v('billing')}</textarea></label></details>`
      : ''}

    ${!isB2b
      ? html`<details class="promo-box" ${values.promo || values.gift || pricing.promo || pricing.gifts.length || pricing.errors.promo || pricing.errors.gift ? raw('open') : ''}>
        <summary>${t('promo.title')}</summary>
        <div class="promo-grid">
          <label class="field"><span class="label">${t('promo.code')}</span><input name="promo" maxlength="40" value="${v('promo')}" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
          <label class="field"><span class="label">${t('promo.gift')}</span><input name="gift" maxlength="120" value="${v('gift')}" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
          <button class="btn btn-outline btn-sm" type="submit" name="apply" value="1" formnovalidate>${t('promo.apply')}</button>
        </div>
        <p class="small muted">${t('promo.giftHint')}</p>
        ${pricing.errors.promo ? html`<p class="field-error" role="alert">${t(`promo.err.${pricing.errors.promo}`)}</p>` : ''}
        ${pricing.promo ? html`<p class="field-ok">${t('promo.applied', { code: pricing.promo.code })}</p>` : ''}
        ${pricing.errors.gift ? html`<p class="field-error" role="alert">${t(`gift.err.${pricing.errors.gift}`)}</p>` : ''}
        ${pricing.gifts.map((g) => html`<p class="field-ok">${t('s.giftLeft', { amount: formatMoney(g.card.balance_cents - g.cents, lang) })}</p>`)}
      </details>`
      : ''}

    <h2>${t('checkout.payment')}</h2>
    ${nothingToPay
      ? html`<div class="notice notice-ok" role="status">${t('checkout.nothingToPay')}</div><input type="hidden" name="paymentMethod" value="card">`
      : options.length
      ? html`<div class="pay-options" role="radiogroup">
      ${options.map((o) => html`<label class="pay-option"><input type="radio" name="paymentMethod" value="${o}" ${o === method ? raw('checked') : ''} data-label="${t(`pay.${o}.cta`)}"><span><strong>${t(`pay.${o}.title`)}</strong><small>${t(`pay.${o}.desc`)}</small></span></label>`)}
    </div>`
      : html`<div class="notice notice-err" role="alert">${t('checkout.noPayment')} <a href="${u('/contact')}">${t('nav.contact')}</a></div>`}

    <label class="check consent"><input type="checkbox" name="consent" value="1" required> <span>${t('f.consent')} <a href="${u('/terms')}" target="_blank">${t('footer.terms')}</a> · <a href="${u('/privacy')}" target="_blank">${t('footer.privacy')}</a></span></label>
    <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    ${firm.applied
      ? html`<div class="notice notice-info firm-note" role="note"><strong>${t('firm.title')}</strong> ${t(firm.refundPercent > 0 ? 'firm.text' : 'firm.text0', { grace: fmtInstant(firm.graceUntilMs, lang), percent: firm.refundPercent, normal: fmtInstant(firm.normalUntilMs, lang) })}${option?.ok ? html` <strong>${t('firm.advice')}</strong>` : ''}</div>`
      : ''}
    ${option?.ok && firm.applied ? optionBox : ''}
    <button class="btn btn-gold btn-block btn-lg" type="submit" id="checkout-submit" ${method || nothingToPay ? '' : raw('disabled')}>${nothingToPay ? t('pay.none.cta') : method ? t(`pay.${method}.cta`) : t('checkout.title')}</button>
    ${option?.ok && !firm.applied ? optionBox : option && !option.ok ? html`<p class="small muted option-note">${t(`option.err.${option.reason}`)}</p>` : ''}
    ${isB2b
      ? html`<div class="package-add"><button class="btn btn-outline btn-block" type="submit" formaction="${u('/b2b/package/add')}" formnovalidate name="action" value="package" id="package-add">${t('pkg.add')}</button><p class="small muted">${t('pkg.addHint')}</p></div>`
      : ''}
  </form>

  <aside class="card summary-card">
    <div class="summary-media">${tourMedia(ctx, tour, '')}</div>
    <div class="pad">
      <h2>${ti.title}</h2>
      <dl class="summary-list">
        <div><dt>${t('s.date')}</dt><dd>${fmtDate(date, lang)}</dd></div>
        <div><dt>${t('s.time')}</dt><dd>${time}–${slot.end} <span class="muted">(${hourly ? hoursLabel(t, lang, serviceHours) : fmtDuration(duration, lang)})</span></dd></div>
        <div><dt><label for="pax-select">${t('s.guests')}</label></dt><dd><select name="pax" id="pax-select" form="checkout-form" class="pax-select">${Array.from({ length: Math.max(pax, Math.min(25, tour.maxParticipants, slot.left ?? tour.maxParticipants)) }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === pax ? raw('selected') : ''}>${n}</option>`)}</select><noscript> <button class="btn btn-outline btn-sm" type="submit" name="apply" value="1" form="checkout-form" formnovalidate>${t('checkout.update')}</button></noscript></dd></div>
        ${extraOptions.length
          ? html`<div><dt><label for="extra-select">${t('hourly.f.extra')}</label></dt><dd><select name="extra" id="extra-select" form="checkout-form" data-apply><option value="0">${t('hourly.extra.none')}</option>${extraOptions.map((n) => html`<option value="${n}" ${n === serviceHours - tour.durationMin / 60 ? raw('selected') : ''}>+ ${hoursLabel(t, lang, n)}</option>`)}</select></dd></div>`
          : ''}
        <div><dt>${t('s.meeting')}</dt><dd>${tour.meetingChoice ? t(isB2b ? 'meeting.summaryB2b' : 'meeting.summary') : ti.meetingPoint}</dd></div>
        ${offered.length > 1 || slot.lang ? html`<div><dt>${t('s.tourLang')}</dt><dd>${LANG_META[tourLang].name}</dd></div>` : ''}
        ${pricing.quote?.ok ? quoteLines(t, lang, pricing.quote, { total: false }) : ''}
        ${!pricing.quote && (pricing.discountCents || pricing.giftCents) ? html`<div><dt>${t('s.list')}</dt><dd>${formatMoney(pricing.listCents, lang)}</dd></div>` : ''}
        ${pricing.discountCents ? html`<div class="row-discount"><dt>${t('s.discount')} · ${pricing.promo.code}</dt><dd>−${formatMoney(pricing.discountCents, lang)}</dd></div>` : ''}
        ${pricing.giftCents ? html`<div class="row-discount"><dt>${t('s.giftUsed')}</dt><dd>−${formatMoney(pricing.giftCents, lang)}</dd></div>` : ''}
        <div class="summary-total"><dt>${pricing.discountCents || pricing.giftCents ? t('s.due') : t('s.total')}</dt><dd>${formatMoney(pricing.dueCents, lang)}${isB2b ? html` <span class="chip chip-accent">${t('b2b.partnerRate')}</span>` : ''}</dd></div>
      </dl>
      ${isSimplePolicy(tiers)
        ? html`<p class="policy-box ${refundable ? 'ok' : 'warn'}">${refundable ? t('checkout.refundable', { until: fmtInstant(deadline, lang), when: fmtHours(t, hours) }) : t('checkout.nonRefundable')}</p>`
        : html`<div class="policy-box ${refundNow === 100 ? 'ok' : 'warn'}"><strong>${t('policy.title')}</strong><ul class="plain tier-list">${tierSentences(t, lang, tiers, startMs).map((x) => html`<li>${x}</li>`)}</ul>${refundNow === 0 ? html`<p>${t('checkout.nonRefundable')}</p>` : ''}</div>`}
      ${slot.joined ? html`<p class="small muted">${t('checkout.joined')}</p>` : ''}
    </div>
  </aside>
</div></section>`;
  return page(ctx, { title: t('checkout.title'), path: `/${lang}/book/checkout`, body, noindex: true, activeNav: 'book', area: areaOf(ctx), scripts: raw(`<script src="/js/checkout.js?v=${ctx.app.assetVersion}" defer></script>`) });
}

export function slotGonePage(ctx, { tour, date, pax }) {
  const { t, lang, u } = ctx;
  const body = html`<section class="page-head"><div class="wrap narrow center">
    <h1>${t('checkout.goneTitle')}</h1><p class="lead">${t('checkout.goneText')}</p>
    <p class="btn-row center"><a class="btn btn-gold" href="${ctx.acct?.status === 'approved' ? (tour?.pricing === 'hourly' ? `${u('/hourly')}?product=${tour.slug}${date ? '&date=' + date : ''}&pax=${pax}` : `${u('/book')}?${tour ? 'tour=' + tour.slug + '&' : ''}${date ? 'date=' + date + '&' : ''}pax=${pax}`) : tour ? u('/tours/' + tour.slug) : u('/tours')}">${t('checkout.pickAnother')}</a></p></div></section>`;
  return page(ctx, { title: t('checkout.goneTitle'), path: `/${lang}/book/checkout`, body, noindex: true, area: areaOf(ctx) });
}

/** Conferma o rilascia di un'opzione: dal link della prenotazione e dall'area dell'agenzia. */
export function optionActions(ctx, b, { st, nextUrl = '', group = null }) {
  const { t, lang, app } = ctx;
  const account = b.account_id ? app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.account_id) : null;
  const methods = paymentOptions(app, app.content.tour(b.tour_slug), 'b2b', account);
  const late = st.percent < 100; // già oltre il periodo di cancellazione gratuita: confermando non è più rimborsabile (del tutto)
  const left = Date.parse(b.option_expires_at) - Date.now();
  const base = `/${lang}/booking/${b.ref}`;
  if (group) {
    // la data fa parte di un pacchetto: si conferma (o si rilascia) insieme alle altre; da qui si può solo togliere questa
    const pkgHref = nextUrl ? `/${lang}/b2b/packages/${group.ref}` : `/${lang}/packages/${group.ref}?t=${group.token}`;
    return html`<div class="option-actions" id="option">
    <p class="chip ${left < 48 * 3600_000 ? 'chip-warn' : ''}">${t('booking.optionLeft', { when: timeLeft(t, Math.max(0, left)) })}</p>
    <p class="small">${t('pkg.inPackage', { ref: group.ref })}</p>
    <p class="btn-row"><a class="btn btn-gold" href="${pkgHref}#option">${t('pkg.openPackage')}</a></p>
    <form method="post" action="${base}/option/release" class="option-release" data-confirm="${t('pkg.releaseLineAsk')}">
      <input type="hidden" name="t" value="${b.token}">${nextUrl ? html`<input type="hidden" name="next" value="${nextUrl}">` : ''}
      <button class="btn btn-outline" type="submit">${t('pkg.releaseLine')}</button>
    </form>
  </div>`;
  }
  return html`<div class="option-actions" id="option">
    <p class="chip ${left < 48 * 3600_000 ? 'chip-warn' : ''}">${t('booking.optionLeft', { when: timeLeft(t, Math.max(0, left)) })}</p>
    <form method="post" action="${base}/option/confirm" class="form option-confirm" data-confirm="${late ? t('booking.optionConfirmAskLate') : t('booking.optionConfirmAsk')}">
      <input type="hidden" name="t" value="${b.token}">${nextUrl ? html`<input type="hidden" name="next" value="${nextUrl}">` : ''}
      ${methods.length > 1 ? html`<label class="field"><span class="label">${t('booking.optionPayWith')}</span><select name="method">${methods.map((m) => html`<option value="${m}">${t(`pay.${m}.title`)}</option>`)}</select></label>` : methods.length ? html`<input type="hidden" name="method" value="${methods[0]}">` : ''}
      <button class="btn btn-gold" type="submit" ${methods.length ? '' : raw('disabled')}>${t('booking.optionConfirm')}</button>
    </form>
    <form method="post" action="${base}/option/release" class="option-release" data-confirm="${t('booking.optionReleaseAsk')}">
      <input type="hidden" name="t" value="${b.token}">${nextUrl ? html`<input type="hidden" name="next" value="${nextUrl}">` : ''}
      <button class="btn btn-outline" type="submit">${t('booking.optionRelease')}</button>
    </form>
    ${extensionBox(ctx, { action: `${base}/option/extend-request`, hidden: html`<input type="hidden" name="t" value="${b.token}">${nextUrl ? html`<input type="hidden" name="next" value="${nextUrl}">` : ''}`, pending: pendingExtension(app.db, b), untilMs: Date.parse(b.option_expires_at) })}
  </div>`;
}

// ───────────────────────── Stato prenotazione ─────────────────────────
/**
 * owner: chi guarda è l'agenzia che ha fatto la prenotazione (con il suo accesso): vede la scheda nella sua area, con fattura e modifica del nominativo.
 * invoice: la fattura emessa che contiene la prenotazione, se c'è.
 */
export function bookingPage(ctx, b, { flash = '', payLater = false, nextUrl = '', owner = false, invoice = null, invite = null, group = null } = {}) {
  const { t, lang, u, app } = ctx;
  const { cfg } = app;
  const tour = app.content.tour(b.tour_slug);
  const ti = tour.i18n[lang];
  const meet = meetingOf(tour, b, lang);
  const st = cancellationState(b);
  const inviteOwed = b.status === 'confirmed' ? inviteDiscountOwed(app.db, b.id) : 0; // sconto già dato a un amico invitato: si trattiene se si annulla
  const q = `?t=${b.token}`;
  const base = `/${lang}/booking/${b.ref}`;
  const service = parseServiceRecord(b.service_json);
  const holdLeft = b.status === 'held' ? Math.max(0, Math.ceil((Date.parse(b.hold_expires_at) - Date.now()) / 60000)) : 0;

  const wallet = walletOptions(app, b); // pulsanti «Aggiungi al wallet» solo se sono configurati e la prenotazione è di un cliente privato
  const invoiceBtn = owner && invoice ? html`<a class="btn btn-outline" href="${u(`/b2b/invoices/${invoice.id}/pdf`)}" target="_blank" rel="noopener">${t('partner.act.invoice', { n: invoice.number })}</a>` : '';
  const wasOption = !!b.option_expires_at; // un'opzione (anche se poi scaduta o confermata)
  const optionUntil = b.option_expires_at ? fmtInstant(Date.parse(b.option_expires_at), lang) : '';
  const heads = {
    confirmed: ['ok', t('booking.confirmedTitle'), t('booking.confirmedText', { email: b.email })],
    held: ['wait', t('booking.heldTitle'), t('booking.heldText', { n: holdLeft })],
    option: ['wait', t('booking.optionTitle'), t('booking.optionText', { until: optionUntil })],
    cancelled: ['err', t('booking.cancelledTitle'), t('booking.cancelledText')],
    expired: wasOption ? ['err', t('booking.expiredOptionTitle'), t('booking.expiredOptionText')] : ['err', t('booking.expiredTitle'), t('booking.expiredText')],
  };
  const [tone, title, text] = heads[b.status];
  const due = bookingDue(b);
  const payLabel = b.status === 'option' ? '' : {
    card: b.payment_status === 'paid' || b.payment_status === 'refunded' ? t('booking.paidOnline') : t('booking.cardPending'),
    onsite: b.gift_cents ? t('booking.dueOnSite', { amount: formatMoney(due, lang, b.currency) }) : t('booking.onsite'),
    invoice: t('booking.invoice'),
    giftcard: t('booking.giftcard'),
    free: t('booking.free'),
  }[b.payment_method];
  const paymentNote = b.payment_status === 'refunded' ? html` · <strong>${b.cancel_percent != null && b.cancel_percent < 100 ? t('booking.refundedPartial', { amount: formatMoney(b.refund_cents, lang, b.currency), percent: b.cancel_percent }) : t('booking.refunded', { amount: formatMoney(b.refund_cents, lang, b.currency) })}</strong>` : b.payment_status === 'refund_failed' ? html` · <strong>${t('booking.refundFailed')}</strong>` : '';

  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${owner ? html`<p class="back-link"><a href="${u('/b2b/bookings')}">← ${t('partner.back')}</a></p>` : ''}
  ${flash ? html`<div class="notice notice-${/error|expired|locked/.test(flash) ? 'err' : 'ok'}" role="status">${t(`booking.flash.${flash}`)}</div>` : ''}
  <div class="status status-${tone}"><span class="status-dot" aria-hidden="true"></span><div><h1>${title}</h1><p class="lead">${text}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${inviteBox(ctx, b, invite)}
  <div class="card pad">
    <p class="ref-line"><span class="muted">${t('s.ref')}</span> <strong class="ref">${b.ref}</strong>${group ? html` · <a class="chip chip-link" href="${owner ? u(`/b2b/packages/${group.ref}`) : `/${lang}/packages/${group.ref}?t=${group.token}`}">${t('pkg.chip', { ref: group.ref })}</a>` : ''}</p>
    <dl class="summary-list">
      <div><dt>${t('s.service')}</dt><dd>${ti.title}</dd></div>
      <div><dt>${t('s.date')}</dt><dd>${fmtDate(b.date, lang)}</dd></div>
      <div><dt>${t('s.time')}</dt><dd>${b.start_time}–${b.end_time}${service ? html` <span class="muted">(${hoursLabel(t, lang, service.hours)})</span>` : ''}</dd></div>
      <div><dt>${t('s.guests')}</dt><dd>${b.participants}</dd></div>
      <div><dt>${t('s.meeting')}</dt><dd>${meet.text}${meet.url ? html` · <a href="${meet.url}" target="_blank" rel="noopener">${t('tour.openMap')}</a>` : ''}</dd></div>
      ${b.tour_lang && LANG_META[b.tour_lang] ? html`<div><dt>${t('s.tourLang')}</dt><dd>${LANG_META[b.tour_lang].name}</dd></div>` : ''}
      ${themeText(b, lang) ? html`<div><dt>${t('f.theme')}</dt><dd>${themeText(b, lang)}</dd></div>` : ''}
      <div><dt>${t('s.name')}</dt><dd>${b.name} · ${b.email}${b.phone ? ' · ' + b.phone : ''}</dd></div>
      ${b.client_ref ? html`<div><dt>${t('f.clientRef')}</dt><dd>${b.client_ref}</dd></div>` : ''}
      ${b.notes ? html`<div><dt>${t('f.notes')}</dt><dd>${b.notes}</dd></div>` : ''}
      ${service ? quoteLines(t, lang, service, { total: false }) : ''}
      ${b.discount_cents ? html`<div class="row-discount"><dt>${t('booking.discountLine', { code: b.promo_code ?? '' })}</dt><dd>−${formatMoney(b.discount_cents, lang, b.currency)}</dd></div>` : ''}
      ${b.gift_cents ? html`<div class="row-discount"><dt>${t('s.giftUsed')}</dt><dd>−${formatMoney(b.gift_cents, lang, b.currency)}</dd></div>` : ''}
      <div class="summary-total"><dt>${b.discount_cents || b.gift_cents ? t('s.due') : t('s.total')}</dt><dd>${formatMoney(due, lang, b.currency)}${payLabel ? html` <span class="muted">· ${payLabel}</span>` : ''}${paymentNote}</dd></div>
    </dl>
    ${b.status === 'cancelled' && b.retained_cents > 0 ? html`<p class="policy-box warn">${t('booking.penalty', { amount: formatMoney(b.retained_cents, lang, b.currency) })}</p>` : ''}

    ${b.status === 'held'
      ? html`<p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${b.ref}${q}&lang=${lang}">${t('booking.payNow')}</a></p>`
      : ''}

    ${b.status === 'option' ? optionActions(ctx, b, { st, nextUrl, group }) : ''}
    ${payLater ? html`<div class="pay-later"><p class="small muted">${t('booking.payOnlineHint')}</p><p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${b.ref}${q}&lang=${lang}">${t('booking.payOnlineNow')}</a></p></div>`
      : b.status === 'confirmed' && b.payment_method === 'onsite' && b.payment_status === 'unpaid' && isPreOpening(cfg) ? preOpenNotice(ctx) : ''}

    ${b.status === 'confirmed'
      ? html`
      ${isSimplePolicy(st.tiers)
        ? html`<p class="policy-box ${st.free ? 'ok' : 'warn'}">${st.everRefundable ? (st.free ? t('booking.canCancel', { until: fmtInstant(st.until, lang) }) : t('booking.cancelClosed', { until: fmtInstant(st.until, lang) })) : t('checkout.nonRefundable')}</p>`
        : html`<div class="policy-box ${st.percent === 100 ? 'ok' : 'warn'}"><strong>${t('policy.title')}</strong><ul class="plain tier-list">${tierSentences(t, lang, st.tiers, st.startsAt).map((x) => html`<li>${x}</li>`)}</ul></div>
        ${st.percent > 0 && st.percent < 100 ? html`<p class="small">${due && b.payment_status !== 'paid' ? t('booking.cancelNowFee', { percent: 100 - st.percent, amount: formatMoney(due - Math.round((due * st.percent) / 100), lang, b.currency) }) : t('booking.cancelNow', { percent: st.percent, amount: formatMoney(Math.round((due * st.percent) / 100), lang, b.currency) })}</p>` : ''}`}
      <p class="btn-row">
        <a class="btn btn-outline" href="${base}/calendar.ics${q}">${t('booking.addCalendar')}</a>
        <a class="btn btn-outline" href="${base}/voucher.pdf${q}" target="_blank" rel="noopener">${t('booking.voucher')}</a>
        ${invoiceBtn}
      </p>
      <p class="voucher-langs small"><span class="muted">${t('booking.voucherIn')}</span> ${LANGS.map((l) => html`<a class="chip chip-link" href="${base}/voucher.pdf${q}&amp;vl=${l}" target="_blank" rel="noopener" hreflang="${l}">${LANG_META[l].name}</a>`)}</p>
      ${wallet.google || wallet.apple
        ? html`<div class="wallet-box"><p class="small muted">${t('wallet.hint')}</p><p class="btn-row">
          ${wallet.apple ? html`<a class="btn btn-dark" href="${base}/wallet/apple.pkpass${q}">${icon('wallet')} ${t('wallet.apple')}</a>` : ''}
          ${wallet.google ? html`<a class="btn btn-dark" href="${base}/wallet/google${q}">${icon('wallet')} ${t('wallet.google')}</a>` : ''}</p></div>`
        : ''}
      ${st.percent > 0 && inviteOwed > 0 ? html`<p class="policy-box warn small">${t('booking.inviteOwed', { amount: formatMoney(inviteOwed, lang, b.currency) })}</p>` : ''}
      ${st.percent > 0
        ? html`<form method="post" action="${base}/cancel" class="cancel-form" data-confirm="${inviteOwed > 0 ? t('booking.confirmCancelInvite', { amount: formatMoney(inviteOwed, lang, b.currency) }) : st.percent < 100 && b.payment_status !== 'paid' ? t('booking.confirmCancelFee') : t('booking.confirmCancel')}"><input type="hidden" name="t" value="${b.token}"><button class="btn btn-link-danger" type="submit">${t('booking.cancelBtn')}</button></form>`
        : st.started ? '' : html`<p class="small muted">${t('booking.contactForChanges')} <a href="mailto:${cfg.site.email}">${cfg.site.email}</a>${cfg.site.whatsapp ? html` · <a href="https://wa.me/${cfg.site.whatsapp}">WhatsApp</a>` : ''}</p>`}`
      : invoiceBtn ? html`<p class="btn-row">${invoiceBtn}</p>` : ''}
    ${owner && b.status === 'confirmed' && b.payment_method === 'invoice' && !invoice ? html`<p class="small muted">${t('partner.docs.invoiceLater')}</p>` : ''}
  </div>
  ${owner ? changeBox(ctx, b) : ''}
  ${owner && isEditable(b)
    ? html`<form class="card pad form edit-card" method="post" action="${u(`/b2b/bookings/${b.ref}/edit`)}" id="edit">
    <h2>${t('partner.edit.title')}</h2><p class="small muted">${t('partner.edit.hint')}</p>
    <div class="form-grid">
      <label class="field"><span class="label">${t('partner.edit.name')}</span><input name="name" required maxlength="120" value="${b.name}"></label>
      <label class="field"><span class="label">${t('f.clientRef')}</span><input name="clientRef" maxlength="120" value="${b.client_ref ?? ''}"></label>
      <label class="field"><span class="label">${t('f.phone')}</span><input type="tel" name="phone" maxlength="40" value="${b.phone ?? ''}"></label>
    </div>
    ${tour.meetingChoice ? html`<label class="field"><span class="label">${t('f.pickup')}</span><input name="pickup" maxlength="200" value="${b.pickup ?? ''}" placeholder="${t('f.pickupHint')}" autocomplete="off"></label>` : ''}
    <label class="field"><span class="label">${t('f.notes')}</span><textarea name="notes" rows="3" maxlength="1000">${b.notes ?? ''}</textarea></label>
    <button class="btn btn-gold" type="submit">${t('partner.edit.btn')}</button>
  </form>`
    : ''}
</div></section>`;
  return page(ctx, { title: `${t('s.ref')} ${b.ref}`, path: `/${lang}/booking/${b.ref}`, body, noindex: true, ...(owner ? { area: 'partner', activeNav: 'b2b-account' } : {}) });
}

/** «Porta un amico»: si crea il link con un solo clic; ogni link si copia o si manda su WhatsApp (o per email) lì accanto. */
function inviteBox(ctx, b, offer) {
  const { t, lang, app } = ctx;
  if (!offer || (!offer.ok && !offer.invites?.length)) return '';
  const ti = app.content.tour(b.tour_slug).i18n[lang];
  const percent = offer.ok ? offer.percent : (offer.invites[0]?.percent ?? app.cfg.invite.percent);
  const max = app.cfg.invite.maxPerBooking;
  const made = (offer.invites ?? []).length;
  const share = (code, link) => `https://wa.me/?text=${encodeURIComponent(`${t('invite.share', { tour: ti.title, date: fmtDate(b.date, lang, 'short'), time: b.start_time, percent, code })} ${link}`)}`;
  const q = `?t=${b.token}`;
  return html`<div class="card pad invite-box" id="invita">
    <h2>${t('invite.title', { percent })}</h2>
    <p>${t('invite.lead', { percent, max })}</p>
    ${offer.ok
      ? html`<form method="post" action="/${lang}/booking/${b.ref}/invite${q}"><p class="btn-row"><button class="btn btn-gold" type="submit">${t('invite.btn')}</button> <span class="small muted">${t('invite.count', { made, max })}</span></p></form>`
      : html`<p class="small muted">${t(`invite.none.${offer.reason === 'max' ? 'max' : 'full'}`)}</p>`}
    ${[...(offer.invites ?? [])].reverse().map((i, n) => {
      const link = inviteLink(app, b, i.code, lang);
      const id = `invite-link-${i.id}`;
      return html`<div class="invite-item ${i.used ? 'is-used' : ''}">
        <p class="small"><span class="chip ${i.used ? 'chip-ok' : ''}">${i.used ? t('invite.used') : t('invite.unused')}</span> <code>${i.code}</code>${i.friend_email ? html` · <span class="muted">${t('invite.sentTo', { email: i.friend_email })}</span>` : ''}</p>
        ${i.used ? '' : html`<div class="invite-link"><input class="copy-field" id="${id}" readonly value="${link}" data-select-all aria-label="${t('invite.link')}"><button type="button" class="btn btn-outline btn-sm" data-copy="#${id}" data-copied="${t('invite.copied')}">${t('invite.copy')}</button></div>
        <p class="btn-row"><a class="btn btn-outline btn-sm" href="${share(i.code, link)}" target="_blank" rel="noopener">${t('invite.whatsapp')}</a></p>
        <form method="post" action="/${lang}/booking/${b.ref}/invite/${i.id}/email${q}" class="invite-mail"><label class="field"><span class="label">${t('invite.mailTo')}</span><span class="invite-mail-row"><input type="email" name="email" required maxlength="200" autocomplete="off" placeholder="${t('invite.emailPh')}" value="${i.friend_email ?? ''}"><button class="btn btn-outline btn-sm" type="submit">${t('invite.mailBtn')}</button></span></label></form>`}
      </div>`;
    })}
  </div>`;
}

export function demoPayPage(ctx, o) {
  const { t, lang } = ctx;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  <div class="notice notice-err" role="note"><strong>${t('demo.banner')}</strong> ${t('demo.text')}</div>
  <h1>${t('demo.title')}</h1>
  <p class="lead">${o.title} · ${formatMoney(o.amountCents, lang, o.currency)} · ${o.ref}</p>
  <form method="post" action="/pay/demo/${o.ref}/complete" class="btn-row">
    <input type="hidden" name="t" value="${o.token}"><input type="hidden" name="lang" value="${lang}">
    <button class="btn btn-gold" type="submit">${t('demo.pay')}</button>
    <a class="btn btn-outline" href="${o.cancelUrl}">${t('demo.cancel')}</a>
  </form>
</div></section>`;
  return page(ctx, { title: t('demo.title'), path: `/pay/demo/${o.ref}`, body, noindex: true });
}
