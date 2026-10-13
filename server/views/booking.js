import { html, raw } from '../html.js';
import { bookingDue, cancellationState, paymentOptions, priceFor, unitPriceFor } from '../bookings.js';
import { freeHoursOf, hasFreeTier, policyFor, refundPercentAt } from '../policy.js';
import { isSimplePolicy, tierSentences } from '../policyText.js';
import { fmtDate, fmtInstant, localToInstant } from '../time.js';
import { formatMoney } from '../util.js';
import { page } from './layout.js';
import { breadcrumbs, departuresList, fmtDuration, fmtHours, langOptions, tourMedia } from './components.js';

const slotUrl = (u, tour, date, time, pax) => `${u('/book/checkout')}?tour=${encodeURIComponent(tour)}&date=${date}&time=${time}&pax=${pax}`;

// ───────────────────────── Pagina "Prenota" (prima la data) ─────────────────────────
export function bookPage(ctx, { date, pax, tourSlug, minDate, results, suggestions, departures = [], channel }) {
  const { t, lang, u, app } = ctx;
  const tours = app.content.tours;
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.book')]])}
  <h1>${t('book.title')}</h1><p class="lead">${t('book.lead')}</p>
  ${channel === 'b2b' ? html`<p><span class="chip chip-accent">${t('b2b.partnerRate')}</span> ${t('book.partnerNote')}</p>` : ''}
</div></section>

<section class="section tight"><div class="wrap">
  <form class="card pad search-card" method="get" action="${u('/book')}">
    <label class="field"><span class="label">${t('quick.date')}</span><input type="date" name="date" min="${minDate}" value="${date ?? ''}" required></label>
    <label class="field"><span class="label">${t('quick.guests')}</span><input type="number" name="pax" min="1" max="25" value="${pax}" inputmode="numeric" required></label>
    <label class="field"><span class="label">${t('book.tour')}</span>
      <select name="tour"><option value="">${t('book.allTours')}</option>${tours.map((x) => html`<option value="${x.slug}" ${x.slug === tourSlug ? raw('selected') : ''}>${x.i18n[lang].title}</option>`)}</select>
    </label>
    <button class="btn btn-gold" type="submit">${t('quick.go')}</button>
  </form>

  ${date
    ? html`<h2 class="h-sub spaced">${t('book.resultsFor', { date: fmtDate(date, lang) })}</h2>
      ${results.length
        ? html`<div class="results">${results.map(({ tour, slots }) => {
            const ti = tour.i18n[lang];
            const unit = unitPriceFor(tour, channel, ctx.acct);
            return html`<article class="card result reveal">
              <div class="result-media">${tourMedia(ctx, tour, '')}</div>
              <div class="result-body">
                <h3><a href="${u('/tours/' + tour.slug)}">${ti.title}</a></h3>
                <p class="muted small">${fmtDuration(tour.durationMin)} · ${tour.model === 'person' ? t('tour.maxPeople', { n: tour.maxParticipants }) : t('tour.upTo', { n: tour.maxParticipants })} · <strong>${formatMoney(tour.model === 'person' ? unit * pax : unit, lang)}</strong> <span class="muted">${tour.model === 'person' ? t('book.forPax', { n: pax }) : t('book.forGroup')}</span></p>
                <div class="slot-list">${slots.map((s) => html`<a class="slot" href="${slotUrl(u, tour.slug, date, s.time, pax)}"><strong>${s.time}</strong>${tour.model === 'person' ? html`<small>${s.joined ? t('book.confirmedDeparture') : t('book.newDeparture')}${s.left <= 4 ? html` · ${t('w.left', { n: s.left })}` : ''}</small>` : ''}</a>`)}</div>
              </div>
            </article>`;
          })}</div>`
        : html`<div class="card pad empty"><p>${t('book.none')}</p>
            ${suggestions.length ? html`<p>${t('book.nextDates')}</p><p class="date-chips">${suggestions.map((d) => html`<a class="chip chip-link" href="${u('/book')}?date=${d}&pax=${pax}${tourSlug ? '&tour=' + tourSlug : ''}">${fmtDate(d, lang, 'weekday')}</a>`)}</p>` : ''}
            <p class="small muted">${t('book.askUs')} <a href="${u('/contact')}">${t('nav.contact')}</a></p></div>`}`
    : html`<p class="muted spaced">${t('book.pickPrompt')}</p>
      ${departures.length ? html`<h2 class="h-sub spaced">${t('departures.title')}</h2>${departuresList(ctx, departures, { pax })}` : ''}`}
</div></section>`;
  return page(ctx, { title: t('nav.book'), description: t('book.lead'), path: `/${lang}/book`, body, activeNav: 'book' });
}

// ───────────────────────── Checkout ─────────────────────────
export function checkoutPage(ctx, { tour, date, time, pax, slot, values = {}, error = '', channel, pricing }) {
  const { t, lang, u, app, acct } = ctx;
  const { cfg } = app;
  const ti = tour.i18n[lang];
  pricing ??= { listCents: priceFor(tour, pax, channel, acct), discountCents: 0, totalCents: priceFor(tour, pax, channel, acct), giftCents: 0, dueCents: priceFor(tour, pax, channel, acct), promo: null, gifts: [], errors: {} };
  const nothingToPay = pricing.dueCents === 0;
  const options = paymentOptions(app, tour, channel, acct);
  const tiers = policyFor(cfg, tour, channel, acct);
  const startMs = localToInstant(date, time);
  const hours = freeHoursOf(tiers);
  const deadline = startMs - hours * 3600_000;
  const refundable = hasFreeTier(tiers) && Date.now() <= deadline;
  const refundNow = refundPercentAt(tiers, startMs, Date.now());
  const method = values.paymentMethod && options.includes(values.paymentMethod) ? values.paymentMethod : (options[0] ?? null);
  const isB2b = channel === 'b2b';
  const v = (k, d = '') => values[k] ?? d;

  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.book'), u('/book')], [t('checkout.title')]])}
  <h1>${t('checkout.title')}</h1>
</div></section>
<section class="section tight"><div class="wrap checkout-grid">
  <form class="card pad form" method="post" action="${u('/book/checkout')}" id="checkout-form">
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <input type="hidden" name="tour" value="${tour.slug}"><input type="hidden" name="date" value="${date}"><input type="hidden" name="time" value="${time}">
    <button type="submit" name="apply" value="1" formnovalidate hidden tabindex="-1" id="pax-apply"></button>
    <h2>${isB2b ? t('checkout.contactB2b') : t('checkout.contact')}</h2>
    <div class="form-grid">
      <label class="field"><span class="label">${t('f.name')}</span><input name="name" required maxlength="120" autocomplete="name" value="${v('name', isB2b ? acct.contact_name : '')}"></label>
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="email" value="${v('email', isB2b ? acct.email : '')}"></label>
      <label class="field"><span class="label">${t('f.phone')} <em>${isB2b ? t('f.phoneB2b') : t('f.optional')}</em></span><input type="tel" name="phone" maxlength="40" autocomplete="tel" value="${v('phone', isB2b ? (acct.phone ?? '') : '')}"></label>
      <label class="field"><span class="label">${t('f.lang')}</span><select name="lang">${langOptions(v('lang', lang))}</select></label>
    </div>
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
    <button class="btn btn-gold btn-block btn-lg" type="submit" id="checkout-submit" ${method || nothingToPay ? '' : raw('disabled')}>${nothingToPay ? t('pay.none.cta') : method ? t(`pay.${method}.cta`) : t('checkout.title')}</button>
  </form>

  <aside class="card summary-card">
    <div class="summary-media">${tourMedia(ctx, tour, '')}</div>
    <div class="pad">
      <h2>${ti.title}</h2>
      <dl class="summary-list">
        <div><dt>${t('s.date')}</dt><dd>${fmtDate(date, lang)}</dd></div>
        <div><dt>${t('s.time')}</dt><dd>${time}–${slot.end} <span class="muted">(${fmtDuration(tour.durationMin)})</span></dd></div>
        <div><dt><label for="pax-select">${t('s.guests')}</label></dt><dd><select name="pax" id="pax-select" form="checkout-form" class="pax-select">${Array.from({ length: Math.max(pax, Math.min(25, tour.maxParticipants, slot.left ?? tour.maxParticipants)) }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === pax ? raw('selected') : ''}>${n}</option>`)}</select><noscript> <button class="btn btn-outline btn-sm" type="submit" name="apply" value="1" form="checkout-form" formnovalidate>${t('checkout.update')}</button></noscript></dd></div>
        <div><dt>${t('s.meeting')}</dt><dd>${ti.meetingPoint}</dd></div>
        ${pricing.discountCents || pricing.giftCents ? html`<div><dt>${t('s.list')}</dt><dd>${formatMoney(pricing.listCents, lang)}</dd></div>` : ''}
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
  return page(ctx, { title: t('checkout.title'), path: `/${lang}/book/checkout`, body, noindex: true, activeNav: 'book', scripts: raw(`<script src="/js/checkout.js?v=${ctx.app.assetVersion}" defer></script>`) });
}

export function slotGonePage(ctx, { tour, date, pax }) {
  const { t, lang, u } = ctx;
  const body = html`<section class="page-head"><div class="wrap narrow center">
    <h1>${t('checkout.goneTitle')}</h1><p class="lead">${t('checkout.goneText')}</p>
    <p class="btn-row center"><a class="btn btn-gold" href="${u('/book')}?${tour ? 'tour=' + tour.slug + '&' : ''}${date ? 'date=' + date + '&' : ''}pax=${pax}">${t('checkout.pickAnother')}</a></p></div></section>`;
  return page(ctx, { title: t('checkout.goneTitle'), path: `/${lang}/book/checkout`, body, noindex: true });
}

// ───────────────────────── Stato prenotazione ─────────────────────────
export function bookingPage(ctx, b, { flash = '' } = {}) {
  const { t, lang, u, app } = ctx;
  const { cfg } = app;
  const tour = app.content.tour(b.tour_slug);
  const ti = tour.i18n[lang];
  const st = cancellationState(b);
  const q = `?t=${b.token}`;
  const base = `/${lang}/booking/${b.ref}`;
  const holdLeft = b.status === 'held' ? Math.max(0, Math.ceil((Date.parse(b.hold_expires_at) - Date.now()) / 60000)) : 0;

  const heads = {
    confirmed: ['ok', t('booking.confirmedTitle'), t('booking.confirmedText', { email: b.email })],
    held: ['wait', t('booking.heldTitle'), t('booking.heldText', { n: holdLeft })],
    cancelled: ['err', t('booking.cancelledTitle'), t('booking.cancelledText')],
    expired: ['err', t('booking.expiredTitle'), t('booking.expiredText')],
  };
  const [tone, title, text] = heads[b.status];
  const due = bookingDue(b);
  const payLabel = {
    card: b.payment_status === 'paid' || b.payment_status === 'refunded' ? t('booking.paidOnline') : t('booking.cardPending'),
    onsite: b.gift_cents ? t('booking.dueOnSite', { amount: formatMoney(due, lang, b.currency) }) : t('booking.onsite'),
    invoice: t('booking.invoice'),
    giftcard: t('booking.giftcard'),
    free: t('booking.free'),
  }[b.payment_method];
  const paymentNote = b.payment_status === 'refunded' ? html` · <strong>${b.cancel_percent != null && b.cancel_percent < 100 ? t('booking.refundedPartial', { amount: formatMoney(b.refund_cents, lang, b.currency), percent: b.cancel_percent }) : t('booking.refunded', { amount: formatMoney(b.refund_cents, lang, b.currency) })}</strong>` : b.payment_status === 'refund_failed' ? html` · <strong>${t('booking.refundFailed')}</strong>` : '';

  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${flash ? html`<div class="notice notice-${flash === 'cancel-error' ? 'err' : 'ok'}" role="status">${t(`booking.flash.${flash}`)}</div>` : ''}
  <div class="status status-${tone}"><span class="status-dot" aria-hidden="true"></span><div><h1>${title}</h1><p class="lead">${text}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad">
    <p class="ref-line"><span class="muted">${t('s.ref')}</span> <strong class="ref">${b.ref}</strong></p>
    <dl class="summary-list">
      <div><dt>${t('s.service')}</dt><dd>${ti.title}</dd></div>
      <div><dt>${t('s.date')}</dt><dd>${fmtDate(b.date, lang)}</dd></div>
      <div><dt>${t('s.time')}</dt><dd>${b.start_time}–${b.end_time}</dd></div>
      <div><dt>${t('s.guests')}</dt><dd>${b.participants}</dd></div>
      <div><dt>${t('s.meeting')}</dt><dd>${ti.meetingPoint}${ti.meetingUrl ? html` · <a href="${ti.meetingUrl}" target="_blank" rel="noopener">${t('tour.openMap')}</a>` : ''}</dd></div>
      <div><dt>${t('s.name')}</dt><dd>${b.name} · ${b.email}${b.phone ? ' · ' + b.phone : ''}</dd></div>
      ${b.client_ref ? html`<div><dt>${t('f.clientRef')}</dt><dd>${b.client_ref}</dd></div>` : ''}
      ${b.notes ? html`<div><dt>${t('f.notes')}</dt><dd>${b.notes}</dd></div>` : ''}
      ${b.discount_cents ? html`<div class="row-discount"><dt>${t('booking.discountLine', { code: b.promo_code ?? '' })}</dt><dd>−${formatMoney(b.discount_cents, lang, b.currency)}</dd></div>` : ''}
      ${b.gift_cents ? html`<div class="row-discount"><dt>${t('s.giftUsed')}</dt><dd>−${formatMoney(b.gift_cents, lang, b.currency)}</dd></div>` : ''}
      <div class="summary-total"><dt>${b.discount_cents || b.gift_cents ? t('s.due') : t('s.total')}</dt><dd>${formatMoney(due, lang, b.currency)} <span class="muted">· ${payLabel}</span>${paymentNote}</dd></div>
    </dl>
    ${b.status === 'cancelled' && b.retained_cents > 0 ? html`<p class="policy-box warn">${t('booking.penalty', { amount: formatMoney(b.retained_cents, lang, b.currency) })}</p>` : ''}

    ${b.status === 'held'
      ? html`<p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${b.ref}${q}&lang=${lang}">${t('booking.payNow')}</a></p>`
      : ''}

    ${b.status === 'confirmed'
      ? html`
      ${isSimplePolicy(st.tiers)
        ? html`<p class="policy-box ${st.free ? 'ok' : 'warn'}">${st.everRefundable ? (st.free ? t('booking.canCancel', { until: fmtInstant(st.until, lang) }) : t('booking.cancelClosed', { until: fmtInstant(st.until, lang) })) : t('checkout.nonRefundable')}</p>`
        : html`<div class="policy-box ${st.percent === 100 ? 'ok' : 'warn'}"><strong>${t('policy.title')}</strong><ul class="plain tier-list">${tierSentences(t, lang, st.tiers, st.startsAt).map((x) => html`<li>${x}</li>`)}</ul></div>
        ${st.percent > 0 && st.percent < 100 ? html`<p class="small">${due && b.payment_status !== 'paid' ? t('booking.cancelNowFee', { percent: 100 - st.percent, amount: formatMoney(due - Math.round((due * st.percent) / 100), lang, b.currency) }) : t('booking.cancelNow', { percent: st.percent, amount: formatMoney(Math.round((due * st.percent) / 100), lang, b.currency) })}</p>` : ''}`}
      <p class="btn-row">
        <a class="btn btn-outline" href="${base}/calendar.ics${q}">${t('booking.addCalendar')}</a>
        <a class="btn btn-outline" href="${base}/voucher.pdf${q}" target="_blank" rel="noopener">${t('booking.voucher')}</a>
      </p>
      ${st.percent > 0
        ? html`<form method="post" action="${base}/cancel" class="cancel-form" data-confirm="${st.percent < 100 && b.payment_status !== 'paid' ? t('booking.confirmCancelFee') : t('booking.confirmCancel')}"><input type="hidden" name="t" value="${b.token}"><button class="btn btn-link-danger" type="submit">${t('booking.cancelBtn')}</button></form>`
        : st.started ? '' : html`<p class="small muted">${t('booking.contactForChanges')} <a href="mailto:${cfg.site.email}">${cfg.site.email}</a>${cfg.site.whatsapp ? html` · <a href="https://wa.me/${cfg.site.whatsapp}">WhatsApp</a>` : ''}</p>`}`
      : ''}
  </div>
</div></section>`;
  return page(ctx, { title: `${t('s.ref')} ${b.ref}`, path: `/${lang}/booking/${b.ref}`, body, noindex: true });
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
