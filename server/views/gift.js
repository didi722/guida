import { html, raw } from '../html.js';
import { fmtDate } from '../time.js';
import { formatGiftCode } from '../pricing.js';
import { formatMoney } from '../util.js';
import { page } from './layout.js';
import { breadcrumbs, checkIcon, siteArt } from './components.js';
import { pick } from '../langs.js';

export function giftPage(ctx, { values = {}, error = '', unavailable = false } = {}) {
  const { t, lang, app } = ctx;
  const { cfg } = app;
  const v = (k, d = '') => values[k] ?? d;
  const presets = cfg.gift.presets;
  const selected = values.amount ?? String(presets[1]);
  const money = (c) => formatMoney(c, lang);
  const delivery = v('delivery', 'me');

  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('gift.title')]])}
  <h1>${t('gift.title')}</h1><p class="lead">${t('gift.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap gift-grid">
  <div>
    ${unavailable ? html`<div class="notice notice-err" role="status">${t('gift.unavailable')} <a href="/${lang}/contact">${t('nav.contact')}</a></div>` : ''}
    <form class="card pad form" method="post" action="/${lang}/gift" id="gift-form">
      ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
      <h2>${t('gift.amount')}</h2>
      <div class="amount-options" role="radiogroup">
        ${presets.map((c) => html`<label class="amount-option"><input type="radio" name="amount" value="${c}" ${selected === String(c) ? raw('checked') : ''}><span>${money(c)}</span></label>`)}
        <label class="amount-option"><input type="radio" name="amount" value="custom" ${selected === 'custom' ? raw('checked') : ''}><span>${t('gift.custom')}</span></label>
      </div>
      <label class="field custom-amount"><span class="label">${t('gift.custom')} (€) <em>${t('gift.customHint', { min: money(cfg.gift.minCents), max: money(cfg.gift.maxCents) })}</em></span><input name="custom" inputmode="decimal" maxlength="8" value="${v('custom')}" placeholder="75"></label>

      <h2>${t('gift.you')}</h2>
      <div class="form-grid">
        <label class="field"><span class="label">${t('f.name')}</span><input name="buyerName" required maxlength="120" autocomplete="name" value="${v('buyerName')}"></label>
        <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="buyerEmail" required maxlength="200" autocomplete="email" value="${v('buyerEmail')}"></label>
      </div>

      <h2>${t('gift.deliveryTitle')}</h2>
      <div class="pay-options" role="radiogroup">
        <label class="pay-option"><input type="radio" name="delivery" value="me" ${delivery === 'me' ? raw('checked') : ''}><span><strong>${t('gift.deliveryMe')}</strong></span></label>
        <label class="pay-option"><input type="radio" name="delivery" value="recipient" ${delivery === 'recipient' ? raw('checked') : ''}><span><strong>${t('gift.deliveryRecipient')}</strong></span></label>
      </div>
      <div class="recipient-fields">
        <div class="form-grid">
          <label class="field"><span class="label">${t('gift.recipientName')} <em>${t('f.optional')}</em></span><input name="recipientName" maxlength="120" value="${v('recipientName')}"></label>
          <label class="field"><span class="label">${t('gift.recipientEmail')}</span><input type="email" name="recipientEmail" maxlength="200" value="${v('recipientEmail')}"></label>
          <label class="field"><span class="label">${t('gift.sendOn')}</span><input type="date" name="deliverOn" value="${v('deliverOn')}"></label>
        </div>
        <p class="small muted">${t('gift.sendOnHint')}</p>
      </div>
      <label class="field"><span class="label">${t('gift.message')} <em>${t('f.optional')}</em></span><textarea name="message" rows="3" maxlength="400" placeholder="${t('gift.messageHint')}">${v('message')}</textarea></label>

      <label class="check consent"><input type="checkbox" name="consent" value="1" required> <span>${t('f.consent')} <a href="/${lang}/terms" target="_blank">${t('footer.terms')}</a> · <a href="/${lang}/privacy" target="_blank">${t('footer.privacy')}</a></span></label>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <button class="btn btn-gold btn-block btn-lg" type="submit" ${unavailable ? raw('disabled') : ''}>${t('gift.pay')}</button>
      <p class="small muted">${t('gift.terms', { months: cfg.gift.validityMonths })}</p>
    </form>
  </div>
  <aside class="gift-side">
    <div class="gift-art">${siteArt(ctx, 'gift', 'bridge', { alt: t('gift.title'), sizes: '(max-width: 900px) 100vw, 480px' })}</div>
    <ol class="steps steps-col">
      ${[1, 2, 3].map((n) => html`<li><span class="step-n" aria-hidden="true">${n}</span><div><p>${t(`gift.how.${n}`)}</p></div></li>`)}
    </ol>
  </aside>
</div></section>`;
  return page(ctx, { title: t('gift.title'), description: t('gift.lead'), path: `/${lang}/gift`, body, activeNav: 'gift', scripts: raw(`<script src="/js/gift.js?v=${ctx.app.assetVersion}" defer></script>`) });
}

export function giftStatusPage(ctx, card, { flash = '' } = {}) {
  const { t, lang } = ctx;
  const active = card.status === 'active';
  const [tone, title, text] = active
    ? ['ok', t('gift.statusReady'), t('gift.statusReadyText', { email: card.buyer_email ?? '' })]
    : card.status === 'pending'
      ? ['wait', t('gift.statusPending'), t('gift.statusPendingText')]
      : ['err', t('gift.statusVoid'), t('gift.statusVoidText')];
  const q = `?t=${card.token}`;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${flash ? html`<div class="notice notice-ok" role="status">${flash}</div>` : ''}
  <div class="status status-${tone}"><span class="status-dot" aria-hidden="true"></span><div><h1>${title}</h1><p class="lead">${text}</p></div></div>
</div></section>
<section class="section tight"><div class="wrap narrow">
  <div class="card pad">
    <p class="ref-line"><span class="muted">${t('s.ref')}</span> <strong class="ref">${card.ref}</strong></p>
    <dl class="summary-list">
      <div><dt>${t('gift.amount')}</dt><dd>${formatMoney(card.initial_cents, lang, card.currency)}</dd></div>
      ${active ? html`<div><dt>${t('gift.code')}</dt><dd><strong class="gift-code">${formatGiftCode(card.code)}</strong></dd></div>
      <div><dt>${t('gift.balance')}</dt><dd>${formatMoney(card.balance_cents, lang, card.currency)}</dd></div>
      <div><dt>${t('gift.validUntil')}</dt><dd>${fmtDate(card.expires_at, lang, 'date')}</dd></div>` : ''}
      ${card.recipient_email ? html`<div><dt>${pick({ it: 'Destinatario', en: 'Recipient', es: 'Destinatario' }, lang)}</dt><dd>${card.recipient_name ? card.recipient_name + ' · ' : ''}${card.recipient_email}${card.delivered_at ? '' : card.deliver_on ? html`<br><small class="muted">${t('gift.scheduled', { name: card.recipient_name || card.recipient_email, date: fmtDate(card.deliver_on, lang, 'short') })}</small>` : ''}</dd></div>` : ''}
    </dl>
    ${active ? html`<p class="muted">${t('gift.useIt')}</p><p class="btn-row"><a class="btn btn-outline" href="/${lang}/gift/${card.ref}/card.pdf${q}">${t('gift.download')}</a> <a class="btn btn-gold" href="/${lang}/tours">${t('nav.tours')}</a></p>` : ''}
    ${card.status === 'pending' ? html`<p class="btn-row"><a class="btn btn-gold" href="/pay/resume/${card.ref}${q}&lang=${lang}">${t('gift.payNow')}</a></p>` : ''}
  </div>
</div></section>`;
  return page(ctx, { title: `${t('gift.title')} ${card.ref}`, path: `/${lang}/gift/${card.ref}`, body, noindex: true });
}

/** Sezione per la home: invito a regalare un buono. */
export function giftBand(ctx) {
  const { t, lang } = ctx;
  return html`<section class="band band-soft">
  <div class="wrap band-grid">
    <div class="reveal"><p class="eyebrow">${t('nav.gift')}</p><h2>${t('gift.homeTitle')}</h2><p class="lead">${t('gift.homeLead')}</p>
      <p class="btn-row"><a class="btn btn-gold" href="/${lang}/gift">${t('gift.cta')}</a></p></div>
    <ul class="check-list reveal">${[1, 2, 3].map((n) => html`<li>${checkIcon}<span>${t(`gift.how.${n}`)}</span></li>`)}</ul>
  </div>
</section>`;
}
