import { art } from '../art.js';
import { html, raw } from '../html.js';
import { freeCancelHours, unitPriceFor } from '../bookings.js';
import { fmtDate } from '../time.js';
import { formatMoney } from '../util.js';

export function fmtDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export function fmtHours(t, h) {
  return h >= 48 && h % 24 === 0 ? t('time.days', { n: h / 24 }) : t('time.hours', { n: h });
}

export function tourMedia(ctx, tour, label) {
  const ti = tour.i18n[ctx.lang];
  return tour.image ? html`<img src="${tour.image}" alt="${label ?? ti.title}" loading="lazy" decoding="async">` : art(tour.art, { label: label ?? ti.title });
}

/** "€35 / persona" oppure "€190 / gruppo", con tariffa B2B se il visitatore è un partner approvato. */
export function priceParts(ctx, tour) {
  const channel = ctx.acct?.status === 'approved' ? 'b2b' : 'b2c';
  const unit = unitPriceFor(tour, channel, ctx.acct);
  return { channel, unit, money: formatMoney(unit, ctx.lang), per: tour.model === 'person' ? ctx.t('price.perPerson') : ctx.t('price.perGroup') };
}

export function tourCard(ctx, tour) {
  const { t, lang, u } = ctx;
  const ti = tour.i18n[lang];
  const p = priceParts(ctx, tour);
  return html`<a class="card tour-card reveal" href="${u('/tours/' + tour.slug)}">
    <div class="card-media">${tourMedia(ctx, tour, '')}<span class="chip chip-float">${tour.model === 'person' ? t('tour.kindGroup') : t('tour.kindPrivate')}</span></div>
    <div class="card-body">
      <h3>${ti.title}</h3>
      <p class="muted">${ti.summary}</p>
      <ul class="meta">
        <li>${fmtDuration(tour.durationMin)}</li>
        <li>${tour.model === 'person' ? t('tour.maxPeople', { n: tour.maxParticipants }) : t('tour.upTo', { n: tour.maxParticipants })}</li>
      </ul>
      <p class="card-foot"><span class="price">${p.money}<small> / ${p.per}</small></span>${p.channel === 'b2b' ? html`<span class="chip chip-accent">${t('b2b.partnerRate')}</span>` : ''}<span class="arrow" aria-hidden="true">→</span></p>
    </div>
  </a>`;
}

export function postCard(ctx, post) {
  const { lang, u, t } = ctx;
  const pi = post.i18n[lang];
  return html`<a class="card post-card reveal" href="${u('/blog/' + post.slug)}">
    <div class="card-media">${art(post.art, { label: '' })}</div>
    <div class="card-body">
      <p class="eyebrow small">${fmtDate(post.date, lang, 'short')} · ${t('blog.minutes', { n: pi.minutes })}</p>
      <h3>${pi.title}</h3>
      <p class="muted">${pi.summary}</p>
    </div>
  </a>`;
}

export function sectionHead(title, lead, extra = '') {
  return html`<header class="section-head reveal"><div><h2>${title}</h2>${lead ? html`<p class="lead">${lead}</p>` : ''}</div>${extra}</header>`;
}

export function cancellationLine(ctx, tour, channel = 'b2c') {
  const hours = freeCancelHours(ctx.app.cfg, tour, channel, ctx.acct);
  return ctx.t('policy.free', { when: fmtHours(ctx.t, hours) });
}

export const checkIcon = raw('<svg class="i-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>');
export const crossIcon = raw('<svg class="i-cross" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');

export function breadcrumbs(ctx, items) {
  return html`<nav class="breadcrumbs" aria-label="${ctx.t('a11y.breadcrumbs')}">${items.map(([label, href], i) => (href ? html`<a href="${href}">${label}</a><span aria-hidden="true">›</span>` : html`<span aria-current="page">${label}</span>`))}</nav>`;
}
