import { art } from '../art.js';
import { html, raw } from '../html.js';
import { freeCancelHours, unitPriceFor } from '../bookings.js';
import { fmtDate, fmtMonth } from '../time.js';
import { formatMoney } from '../util.js';
import { LANGS, LANG_META, localeOf } from '../langs.js';
import { minHours } from '../rates.js';
import { MEDIA_NAME, smallName } from '../media.js';

/** <option> di tutte le lingue del sito, con quella indicata selezionata. */
export const langOptions = (selected) => html`${LANGS.map((l) => html`<option value="${l}" ${l === selected ? raw('selected') : ''}>${LANG_META[l].name}</option>`)}`;

export function fmtDuration(min, lang) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (lang === 'ja') return h ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** «1 ora», «2 ore», «2,5 ore». */
export const hoursLabel = (t, lang, h) => (h === 1 ? t('hourly.hours1') : t('hourly.hoursN', { n: new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 1 }).format(h) }));

export function fmtHours(t, h) {
  return h >= 48 && h % 24 === 0 ? t('time.days', { n: h / 24 }) : t('time.hours', { n: h });
}

/** Immagine caricata dal pannello (due misure: `srcset`) oppure un percorso diretto a un file in public/. */
export function mediaImg(image, alt = '', { sizes = '(max-width: 700px) 100vw, 50vw', eager = false } = {}) {
  if (!image) return '';
  const loading = eager ? raw('fetchpriority="high"') : raw('loading="lazy"');
  if (MEDIA_NAME.test(image)) return html`<img src="/media/${image}" srcset="/media/${smallName(image)} 640w, /media/${image} 1600w" sizes="${sizes}" alt="${alt}" ${loading} decoding="async">`;
  return html`<img src="${image}" alt="${alt}" ${loading} decoding="async">`;
}
/** Indirizzo assoluto dell'immagine di copertina (anteprima quando si condivide la pagina). */
export const mediaUrl = (cfg, image) => (image && MEDIA_NAME.test(image) ? `${cfg.baseUrl}/media/${image}` : null);

/** Immagine fissa del sito: la foto scelta nel pannello (Immagini) oppure, se manca, l'illustrazione. */
export function siteArt(ctx, slot, artKey, { label = '', alt = label, sizes, eager = false } = {}) {
  const name = ctx.app.siteImages?.get(slot);
  return name ? mediaImg(name, alt, { sizes, eager }) : art(artKey, { label });
}

export function tourMedia(ctx, tour, label) {
  const ti = tour.i18n[ctx.lang];
  return tour.image ? mediaImg(tour.image, label ?? ti.title) : art(tour.art, { label: label ?? ti.title });
}

/** "€35 / persona" oppure "€190 / gruppo", con tariffa B2B se il visitatore è un partner approvato. */
export function priceParts(ctx, tour) {
  const channel = ctx.acct?.status === 'approved' ? 'b2b' : 'b2c';
  if (tour.pricing === 'hourly') {
    // servizi a ore: «da 200 € / 2 ore» (scegli tu la durata) oppure «290 € / 3 ore» (durata fissa); festivi e notturno si aggiungono dopo
    const hours = tour.chooseHours ? minHours(tour.service) : tour.durationMin / 60;
    const q = ctx.app.rates.quote({ service: tour.service, channel, hours, pax: 1, discountPercent: channel === 'b2b' ? (ctx.acct?.discount_percent ?? 0) : 0 });
    const unit = q.ok ? q.totalCents : 0;
    const money = formatMoney(unit, ctx.lang);
    return { channel, unit, hourly: true, money: tour.chooseHours ? ctx.t('price.from', { price: money }) : money, per: hoursLabel(ctx.t, ctx.lang, hours) };
  }
  const unit = unitPriceFor(tour, channel, ctx.acct);
  return { channel, unit, money: formatMoney(unit, ctx.lang), per: tour.model === 'person' ? ctx.t('price.perPerson') : ctx.t('price.perGroup') };
}

/**
 * «Cosa dicono i clienti»: i commenti scelti dal pannello (con il permesso del cliente), solo con il nome di battesimo.
 * `stats` ({count, average}) mostra anche la media di TUTTI i voti ricevuti, ma solo da 5 voti in su; `readUrl` il collegamento alle recensioni pubbliche.
 */
export function testimonials(ctx, quotes, { stats = null, readUrl = '' } = {}) {
  if (!quotes.length) return '';
  const { t, lang, app } = ctx;
  const avg = stats && stats.count >= 5 && stats.average != null ? new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 1 }).format(stats.average) : null;
  return html`<div class="quotes">
    <div class="quotes-grid">${quotes.map((q) => html`<figure class="quote">
      <div class="quote-stars" role="img" aria-label="${t('fb.star', { n: q.rating })}">${'★'.repeat(q.rating)}${'☆'.repeat(5 - q.rating)}</div>
      <blockquote lang="${q.lang}"><p>${q.comment}</p></blockquote>
      <figcaption>${q.firstName ? html`<strong>${q.firstName}</strong> · ` : ''}${app.content.tour(q.tourSlug)?.i18n[lang].title ?? ''}, ${fmtMonth(q.date.slice(0, 7), lang)}</figcaption>
    </figure>`)}</div>
    <p class="quotes-note">${avg ? html`<strong>★ ${t('reviews.avg', { avg, n: stats.count })}</strong><br>` : ''}${t('reviews.note')}${readUrl ? html` <a href="${readUrl}" target="_blank" rel="noopener">${t('reviews.readAll')}</a>` : ''}</p>
  </div>`;
}

/** «Prossime partenze»: i primi orari prenotabili dei tour a partenza fissa; un tocco porta al pagamento. */
export function departuresList(ctx, departures, { pax = 2 } = {}) {
  const { t, lang, u } = ctx;
  if (!departures.length) return '';
  return html`<ul class="dep-list">${departures.map((d) => {
    const { money, per } = priceParts(ctx, d.tour);
    const n = Math.max(1, Math.min(pax, d.left));
    const note = d.left <= 3 ? (d.left === 1 ? t('departures.left1') : t('departures.left', { n: d.left })) : d.joined ? t('book.confirmedDeparture') : fmtDuration(d.tour.durationMin, lang);
    return html`<li><a class="dep" href="${u('/book/checkout')}?tour=${encodeURIComponent(d.tour.slug)}&date=${d.date}&time=${d.time}&pax=${n}">
      <span class="dep-when"><strong>${fmtDate(d.date, lang, 'weekday')}</strong><span class="dep-time">${d.time}</span></span>
      <span class="dep-what"><strong>${d.tour.i18n[lang].title}</strong><small class="${d.left <= 3 ? 'dep-few' : ''}">${note}</small></span>
      <span class="dep-price"><strong>${money}</strong><small>/ ${per}</small></span>
    </a></li>`;
  })}</ul>`;
}

export function tourCard(ctx, tour) {
  const { t, lang, u } = ctx;
  const ti = tour.i18n[lang];
  const p = priceParts(ctx, tour);
  return html`<a class="card tour-card reveal" href="${u('/tours/' + tour.slug)}">
    <div class="card-media">${tourMedia(ctx, tour, '')}<span class="chip chip-float">${tour.pricing === 'hourly' ? t('tour.kindHourly') : tour.model === 'person' ? t('tour.kindGroup') : t('tour.kindPrivate')}</span></div>
    <div class="card-body">
      <h3>${ti.title}</h3>
      <p class="muted">${ti.summary}</p>
      <ul class="meta">
        <li>${fmtDuration(tour.durationMin, lang)}</li>
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
    <div class="card-media">${post.image ? mediaImg(post.image, '') : art(post.art, { label: '' })}</div>
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
