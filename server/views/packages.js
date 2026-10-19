// Pacchetti delle agenzie: il carrello (servizi aggiunti e non ancora prenotati) e la pagina del pacchetto prenotato.
import { html, raw } from '../html.js';
import { cancellationState, paymentOptions } from '../bookings.js';
import { pendingExtension } from '../changes.js';
import { bookingDue } from '../bookings.js';
import { onlinePaymentsOpen } from '../opening.js';
import { cancellable, packageStatus, packageTotal, payableLines } from '../packages.js';
import { fmtDate, fmtInstant } from '../time.js';
import { formatMoney } from '../util.js';
import { page } from './layout.js';
import { bookingStatusText } from './b2b.js';
import { extensionBox } from './changes.js';
import { breadcrumbs, fmtDuration, homeCrumb, hoursLabel, langOptions, timeLeft } from './components.js';

const checkoutScript = (ctx) => raw(`<script src="/js/checkout.js?v=${ctx.app.assetVersion}" defer></script>`);

/** Messaggi che le azioni sul pacchetto possono lasciare al ritorno sulla sua pagina. */
const FLASH = ['confirmed', 'released', 'expired', 'error', 'cancelled', 'cancelPartial', 'cancel-error', 'new', 'extension-sent', 'extension-error'];

// ───────────────────────── Il pacchetto in preparazione ─────────────────────────
/**
 * summary: vedi cartSummary · values: i dati già scritti nel modulo (se si torna con un errore) · error: messaggio · flash: 'added' | 'removed'
 */
export function packageCartPage(ctx, { acct, summary, values = {}, error = '', flash = '' }) {
  const { t, lang, u, app } = ctx;
  const { lines, option, firm } = summary;
  const v = (k, d = '') => values[k] ?? summary.contact[k] ?? d;
  const money = (c) => formatMoney(c, lang);
  const methods = lines.length ? paymentOptions(app, lines.find((l) => l.p)?.p.tour ?? app.content.tours[0], 'b2b', acct) : [];
  const method = values.paymentMethod && methods.includes(values.paymentMethod) ? values.paymentMethod : (methods[0] ?? null);
  const ready = summary.allOk;

  const optionBox = option?.ok
    ? html`<div class="option-box ${firm.applied ? 'is-recommended' : ''}">${firm.applied ? html`<span class="chip chip-accent">${t('firm.recommended')}</span>` : ''}<h3>${t('option.title')}</h3>
        <p>${t('pkg.option.text', { until: fmtInstant(option.expiresMs, lang), days: timeLeft(t, option.expiresMs - Date.now()) })}</p>
        <button class="btn ${firm.applied ? 'btn-gold' : 'btn-outline'} btn-block" type="submit" name="action" value="option" id="option-submit" ${ready ? '' : raw('disabled')}>${t('pkg.option.btn')}</button></div>`
    : '';

  const rows = lines.map(
    (l) => html`<tr class="${l.ok ? '' : 'pb-expired'}">
      <td data-label="${t('s.service')}">${l.p ? html`<strong>${l.p.tour.i18n[lang].title}</strong><small class="muted">${l.p.hours != null ? hoursLabel(t, lang, l.p.hours) : fmtDuration(l.p.tour.durationMin, lang)}</small>` : html`<span class="muted">${l.src.tour}</span>`}${l.ok ? '' : html`<br><span class="chip chip-err">${t(`pkg.line.${l.reason}`)}</span>`}</td>
      <td data-label="${t('s.date')}"><strong>${fmtDate(l.src.date, lang, 'short')}</strong><small class="muted">${l.src.time}${l.slot ? `–${l.slot.end}` : ''}</small></td>
      <td class="num" data-label="${t('s.guests')}">${l.src.pax}</td>
      <td class="num" data-label="${t('s.total')}">${l.pricing ? money(l.pricing.dueCents) : '—'}</td>
      <td class="pb-actions"><div class="pb-actions-in"><form method="post" action="${u(`/b2b/package/remove/${l.id}`)}"><button class="btn btn-link-danger btn-sm" type="submit">${t('pkg.remove')}</button></form></div></td>
    </tr>`,
  );

  const body = html`
<section class="page-head partner-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('pkg.title')]])}
  <div class="account-head"><div><p class="eyebrow">${acct.company}</p><h1>${t('pkg.title')}</h1><p class="lead">${t('pkg.lead')}</p></div>
    <div class="btn-row"><a class="btn btn-outline btn-lg" href="${u('/book')}">${t('pkg.addAnother')}</a></div></div>
</div></section>
<section class="section tight"><div class="wrap">
  ${flash === 'added' || flash === 'removed' ? html`<div class="notice notice-ok" role="status">${t(`pkg.flash.${flash}`)}</div>` : ''}
  ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
  ${lines.length
    ? html`<div class="table-wrap card"><table class="table table-stack partner-table"><thead><tr><th>${t('s.service')}</th><th>${t('s.date')}</th><th class="num">${t('s.guests')}</th><th class="num">${t('s.total')}</th><th><span class="sr-only">${t('partner.col.actions')}</span></th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><th colspan="3">${t('pkg.total')}</th><th class="num">${money(summary.totalCents)}</th><th></th></tr></tfoot></table></div>
      ${ready ? '' : html`<div class="notice notice-err" role="alert">${t('pkg.err.stale')}</div>`}
      <form class="card pad form spaced" method="post" action="${u('/b2b/package')}" id="checkout-form">
        <h2>${t('pkg.details')}</h2>
        <div class="form-grid">
          <label class="field"><span class="label">${t('f.name')}</span><input name="name" required maxlength="120" autocomplete="name" value="${v('name', acct.contact_name)}"></label>
          <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="email" value="${v('email', acct.email)}"></label>
          <label class="field"><span class="label">${t('f.phone')} <em>${t('f.phoneB2b')}</em></span><input type="tel" name="phone" maxlength="40" autocomplete="tel" value="${v('phone', acct.phone ?? '')}"></label>
          <label class="field"><span class="label">${t('f.lang')}</span><select name="lang">${langOptions(v('lang', lang))}</select></label>
        </div>
        <label class="field"><span class="label">${t('f.clientRef')}</span><input name="clientRef" maxlength="120" value="${v('clientRef')}" placeholder="${t('f.clientRefHint')}"></label>
        <label class="field"><span class="label">${t('f.notes')} <em>${t('f.optional')}</em></span><textarea name="notes" rows="3" maxlength="1000" placeholder="${t('f.notesHintB2b')}">${v('notes')}</textarea></label>

        <h2>${t('checkout.payment')}</h2>
        ${methods.length
          ? html`<div class="pay-options" role="radiogroup">${methods.map((o) => html`<label class="pay-option"><input type="radio" name="paymentMethod" value="${o}" ${o === method ? raw('checked') : ''} data-label="${t(`pay.${o}.cta`)}"><span><strong>${t(`pay.${o}.title`)}</strong><small>${t(`pay.${o}.desc`)}</small></span></label>`)}</div>`
          : html`<div class="notice notice-err" role="alert">${t('checkout.noPayment')} <a href="${u('/contact')}">${t('nav.contact')}</a></div>`}

        <label class="check consent"><input type="checkbox" name="consent" value="1" required> <span>${t('f.consent')} <a href="${u('/terms')}" target="_blank">${t('footer.terms')}</a> · <a href="${u('/privacy')}" target="_blank">${t('footer.privacy')}</a></span></label>
        ${firm.applied ? html`<div class="notice notice-info firm-note" role="note"><strong>${t('firm.title')}</strong> ${t('pkg.firm', { grace: fmtInstant(firm.graceUntilMs, lang), percent: firm.refundPercent })}${option?.ok ? html` <strong>${t('firm.advice')}</strong>` : ''}</div>` : ''}
        ${option?.ok && firm.applied ? optionBox : ''}
        <button class="btn btn-gold btn-block btn-lg" type="submit" id="checkout-submit" ${method && ready ? '' : raw('disabled')}>${method ? t(`pay.${method}.cta`) : t('checkout.title')}</button>
        ${option?.ok && !firm.applied ? optionBox : option && !option.ok ? html`<p class="small muted option-note">${t(`option.err.${option.reason}`)}</p>` : ''}
      </form>`
    : html`<div class="card pad center empty-state"><p><strong>${t('pkg.empty')}</strong></p><p class="muted">${t('pkg.emptyHelp')}</p>
        <p class="btn-row center"><a class="btn btn-gold" href="${u('/book')}">${t('pkg.chooseService')}</a></p></div>`}
</div></section>`;
  return page(ctx, { title: t('pkg.title'), path: `/${lang}/b2b/package`, body, noindex: true, activeNav: 'b2b-package', area: 'partner', scripts: checkoutScript(ctx) });
}

// ───────────────────────── Il pacchetto prenotato ─────────────────────────
/**
 * La pagina del pacchetto: dal link dell'email (con il codice segreto) o dall'area dell'agenzia (`owner`).
 * Da qui si confermano o si rilasciano le opzioni di tutti i servizi, si paga con la carta e si annulla.
 */
export function packagePage(ctx, group, bookings, { flash = '', owner = false } = {}) {
  const { t, lang, u, app } = ctx;
  const { cfg } = app;
  const status = packageStatus(bookings);
  const base = `/${lang}/packages/${group.ref}`;
  const q = `?t=${group.token}`;
  const money = (c, cur = group.currency) => formatMoney(c, lang, cur);
  const untilMs = bookings.some((b) => b.status === 'option') ? Math.min(...bookings.filter((b) => b.status === 'option').map((b) => Date.parse(b.option_expires_at))) : 0; // la scadenza comune
  const holdLeft = Math.max(0, ...bookings.filter((b) => b.status === 'held').map((b) => Math.ceil((Date.parse(b.hold_expires_at) - Date.now()) / 60000)));
  const wasOption = bookings.some((b) => b.option_expires_at);
  const heads = {
    option: () => ['wait', t('pkg.optionTitle'), t('pkg.optionText', { until: fmtInstant(untilMs, lang) })],
    held: () => ['wait', t('pkg.heldTitle'), t('pkg.heldText', { n: holdLeft })],
    confirmed: () => ['ok', t('pkg.confirmedTitle'), t('pkg.confirmedText', { email: group.email })],
    cancelled: () => ['err', t('pkg.cancelledTitle'), t('pkg.cancelledText')],
    expired: () => (wasOption ? ['err', t('pkg.expiredOptionTitle'), t('pkg.expiredOptionText')] : ['err', t('pkg.expiredTitle'), t('pkg.expiredText')]),
  };
  const [tone, title, text] = heads[status]();
  const optionLines = bookings.filter((b) => b.status === 'option');
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const canc = cancellable(bookings);
  const lineUrl = (b) => (owner ? u(`/b2b/bookings/${b.ref}`) : `/${lang}/booking/${b.ref}?t=${b.token}`);
  const cancelCell = (b) => {
    if (b.status !== 'confirmed') return '';
    const st = cancellationState(b);
    if (st.percent === 100) return t('pkg.cancelUntil', { until: fmtInstant(st.until, lang) });
    return st.percent > 0 ? t('pkg.cancelPercent', { percent: st.percent }) : t('pkg.cancelClosed');
  };
  const methods = optionLines.length ? paymentOptions(app, app.content.tour(optionLines[0].tour_slug), 'b2b', ctx.acct?.id === group.account_id ? ctx.acct : app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(group.account_id)) : [];
  const late = optionLines.some((b) => cancellationState(b).percent < 100);
  const hidden = html`<input type="hidden" name="t" value="${group.token}">${owner ? html`<input type="hidden" name="next" value="${u(`/b2b/packages/${group.ref}`)}">` : ''}`;
  const payLeft = bookings.filter((b) => b.status === 'held');
  const cardNow = onlinePaymentsOpen(app) ? payableLines(app.db, group.id).filter((b) => b.status === 'confirmed') : []; // confermati a fattura: si può anticipare con la carta

  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${owner ? html`<p class="back-link"><a href="${u('/b2b/bookings')}">← ${t('partner.back')}</a></p>` : ''}
  ${FLASH.includes(flash) ? html`<div class="notice notice-${/error|expired/.test(flash) ? 'err' : 'ok'}" role="status">${t(`pkg.flash.${flash}`)}</div>` : ''}
  <div class="status status-${tone}"><span class="status-dot" aria-hidden="true"></span><div><h1>${title}</h1><p class="lead">${text}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad">
    <p class="ref-line"><span class="muted">${t('s.ref')}</span> <strong class="ref">${group.ref}</strong>${group.client_ref ? html` · <span class="muted">${t('f.clientRef')}</span> <strong>${group.client_ref}</strong>` : ''}</p>
    <div class="table-wrap"><table class="table table-stack partner-table"><thead><tr><th>${t('s.service')}</th><th>${t('s.date')}</th><th class="num">${t('s.guests')}</th><th>${t('b2b.state')}</th><th class="num">${t('s.total')}</th></tr></thead><tbody>
      ${bookings.map((b) => {
        const tour = app.content.tour(b.tour_slug);
        return html`<tr class="pb-${b.status}">
          <td data-label="${t('s.service')}"><a class="pb-title" href="${lineUrl(b)}">${tour?.i18n[lang].title ?? b.tour_slug}</a><small class="muted">${b.ref}</small></td>
          <td data-label="${t('s.date')}"><strong>${fmtDate(b.date, lang, 'short')}</strong><small class="muted">${b.start_time}–${b.end_time}</small></td>
          <td class="num" data-label="${t('s.guests')}">${b.participants}</td>
          <td data-label="${t('b2b.state')}"><span class="chip ${{ confirmed: 'chip-ok', held: 'chip-warn', option: 'chip-warn' }[b.status] ?? 'chip-err'}">${bookingStatusText(t, b)}</span>${b.status === 'confirmed' ? html`<small class="muted">${cancelCell(b)}</small>` : ''}</td>
          <td class="num" data-label="${t('s.total')}">${money(b.total_cents - (b.gift_cents ?? 0), b.currency)}</td>
        </tr>`;
      })}
    </tbody><tfoot><tr><th colspan="4">${t('pkg.total')}</th><th class="num">${money(packageTotal(bookings))}</th></tr></tfoot></table></div>
    <dl class="summary-list">
      <div><dt>${t('s.name')}</dt><dd>${group.name} · ${group.email}${group.phone ? ' · ' + group.phone : ''}</dd></div>
      ${group.notes ? html`<div><dt>${t('f.notes')}</dt><dd>${group.notes}</dd></div>` : ''}
    </dl>

    ${optionLines.length
      ? html`<div class="option-actions" id="option">
        <p class="chip ${untilMs - Date.now() < 48 * 3600_000 ? 'chip-warn' : ''}">${t('booking.optionLeft', { when: timeLeft(t, Math.max(0, untilMs - Date.now())) })}</p>
        <form method="post" action="${base}/confirm" class="form option-confirm" data-confirm="${late ? t('pkg.confirmAskLate') : t('pkg.confirmAsk')}">
          ${hidden}
          ${methods.length > 1 ? html`<label class="field"><span class="label">${t('booking.optionPayWith')}</span><select name="method">${methods.map((m) => html`<option value="${m}">${t(`pay.${m}.title`)}</option>`)}</select></label>` : methods.length ? html`<input type="hidden" name="method" value="${methods[0]}">` : ''}
          <button class="btn btn-gold" type="submit" ${methods.length ? '' : raw('disabled')}>${t('pkg.confirm')}</button>
        </form>
        <form method="post" action="${base}/release" class="option-release" data-confirm="${t('pkg.releaseAsk')}">${hidden}<button class="btn btn-outline" type="submit">${t('pkg.release')}</button></form>
        ${extensionBox(ctx, { action: `${base}/extend-request`, hidden, pending: pendingExtension(app.db, optionLines[0]), untilMs })}
      </div>`
      : ''}
    ${payLeft.length ? html`<p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${group.ref}${q}&lang=${lang}">${t('booking.payNow')}</a></p>` : ''}
    ${cardNow.length ? html`<div class="pay-later"><p class="small muted">${t('invpay.booking.cardHint')}</p><p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${group.ref}${q}&lang=${lang}">${t('pkg.payCard', { amount: money(cardNow.reduce((a, b) => a + bookingDue(b), 0)) })}</a></p></div>` : ''}

    ${confirmed.length
      ? html`<p class="btn-row"><a class="btn btn-outline" href="${base}/calendar.ics${q}">${t('booking.addCalendar')}</a></p>
      <ul class="plain voucher-list">${confirmed.map((b) => html`<li><a class="btn btn-outline btn-sm" href="/${lang}/booking/${b.ref}/voucher.pdf?t=${b.token}" target="_blank" rel="noopener">${t('pkg.voucherOf', { date: fmtDate(b.date, lang, 'short'), time: b.start_time })}</a></li>`)}</ul>
      ${canc.no.length ? html`<p class="policy-box warn small">${t('pkg.cancelKept', { n: canc.no.length })} <a href="mailto:${cfg.site.email}">${cfg.site.email}</a></p>` : ''}
      ${canc.yes.length
        ? html`<form method="post" action="${base}/cancel" class="cancel-form" data-confirm="${t('pkg.cancelAsk', { n: canc.yes.length })}">${hidden}<button class="btn btn-link-danger" type="submit">${t('pkg.cancelBtn', { n: canc.yes.length })}</button></form>`
        : ''}`
      : ''}
  </div>
</div></section>`;
  return page(ctx, { title: `${t('pkg.title')} ${group.ref}`, path: `/${lang}/packages/${group.ref}`, body, noindex: true, ...(owner ? { area: 'partner', activeNav: 'b2b-bookings' } : {}) });
}
