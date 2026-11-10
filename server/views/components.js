import { art } from '../art.js';
import { html, raw } from '../html.js';
import { freeCancelHours, unitPriceFor } from '../bookings.js';
import { fmtDate, fmtMonth } from '../time.js';
import { formatMoney } from '../util.js';
import { LANGS, LANG_META, localeOf } from '../langs.js';
import { minHours, openTo, parseServiceRecord } from '../rates.js';
import { invitePercentFor } from '../invites.js';
import { MEDIA_NAME, smallName } from '../media.js';
import { actorOf } from '../team.js';

/** <option> di tutte le lingue del sito, con quella indicata selezionata. */
export const langOptions = (selected) => html`${LANGS.map((l) => html`<option value="${l}" ${l === selected ? raw('selected') : ''}>${LANG_META[l].name}</option>`)}`;

export function fmtDuration(min, lang) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (lang === 'ja') return h ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

const GLOBE = raw('<svg class="i-globe" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>');

/**
 * «Guida abilitata in 4 lingue»: le lingue in cui conduco i tour, ben visibili (per le agenzie è un punto di forza: un solo referente per gruppi di lingue diverse).
 * variant: 'hero' (sotto il titolo, per tutti) | 'band' (con la frase per le agenzie).
 */
export function languagesBadge(ctx, { variant = 'hero' } = {}) {
  const { t } = ctx;
  return html`<div class="lang-badge lang-badge-${variant}" role="group" aria-label="${t('langs.badge.aria')}">
    <p class="lang-badge-title">${GLOBE}<strong>${t('langs.badge.title')}</strong></p>
    <ul class="lang-chips">${LANGS.map((l) => html`<li lang="${l}">${LANG_META[l].name}</li>`)}</ul>
    <p class="lang-badge-sub">${t(variant === 'band' ? 'langs.badge.sub' : 'langs.badge.consumer')}</p>
  </div>`;
}

/** Quanto manca a una scadenza, a parole: «3 giorni», «1 giorno», «20 ore». */
export function timeLeft(t, ms) {
  const hours = ms / 3_600_000;
  if (hours >= 47) { const d = Math.round(hours / 24); return d === 1 ? t('option.days1') : t('option.daysN', { n: d }); }
  if (hours >= 23) return t('option.days1');
  return t('time.hours', { n: Math.max(1, Math.round(hours)) });
}

/** Ci sono servizi a ore prenotabili da questo canale? Se no, «Calcola il prezzo» non porterebbe da nessuna parte e il pulsante non si mostra. */
export const hasHourlyProducts = (ctx, channel) => {
  const rates = ctx.app.rates.get();
  return ctx.app.content.tours.some((x) => x.pricing === 'hourly' && openTo(rates, x, channel));
};

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

/** Da quante ore parte un servizio a ore dove il cliente sceglie la durata: quella indicata nel tour, non meno del minimo del servizio. */
export const startHours = (tour) => (tour.chooseHours ? Math.max(minHours(tour.service), tour.durationMin / 60) : tour.durationMin / 60);

/** La durata del tour: «2 ore», oppure «A partire da 2 ore» se il cliente sceglie quante ore. */
export const durationText = (t, lang, tour) => (tour.pricing === 'hourly' && tour.chooseHours ? t('tour.fromDuration', { dur: fmtHours(t, startHours(tour)) }) : fmtDuration(tour.durationMin, lang));

/** "€35 / persona" oppure "€190 / gruppo", con tariffa B2B se il visitatore è un partner approvato. */
export function priceParts(ctx, tour) {
  const channel = ctx.acct?.status === 'approved' ? 'b2b' : 'b2c';
  if (tour.pricing === 'hourly') {
    // servizi a ore: «da 200 € / 2 ore» (scegli tu la durata) oppure «290 € / 3 ore» (durata fissa); festivi e notturno si aggiungono dopo
    const hours = startHours(tour);
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
      ${q.translation
        ? html`<blockquote lang="${lang}"><p>${q.translation.text}</p></blockquote>
      <details class="quote-orig"><summary><span class="q-open-label">${t('reviews.seeOriginal')}</span><span class="q-close-label">${t('reviews.hideOriginal')}</span></summary>
        <blockquote lang="${q.translation.from}"><p>${q.comment}</p></blockquote></details>
      <p class="quote-auto">${t('reviews.autoTranslated')}</p>`
        : html`<blockquote lang="${q.lang}"><p>${q.comment}</p></blockquote>`}
      <figcaption>${q.firstName ? html`<strong>${q.firstName}</strong> · ` : ''}${app.content.tour(q.tourSlug)?.i18n[lang].title ?? ''}, ${fmtMonth(q.date.slice(0, 7), lang)}</figcaption>
    </figure>`)}</div>
    <p class="quotes-note">${avg ? html`<strong>★ ${t('reviews.avg', { avg, n: stats.count })}</strong><br>` : ''}${t('reviews.note')}${readUrl ? html` <a href="${readUrl}" target="_blank" rel="noopener">${t('reviews.readAll')}</a>` : ''}</p>
  </div>`;
}

/** Un testo lungo accorciato a una parola intera, con i puntini (le recensioni di Google si leggono per intero su Google). */
const shorten = (text, max) => {
  if (text.length <= max) return { text, cut: false };
  const cut = text.slice(0, max).replace(/\s+\S*$/, '');
  return { text: `${cut}…`, cut: true };
};

/**
 * Le recensioni della home, in una fila che scorre: i commenti dei clienti del sito e le recensioni di Google, alternati.
 * Senza JavaScript è una fila che si fa scorrere con il dito; con JavaScript avanza da sola (si ferma al passaggio del mouse, al tocco,
 * alla tastiera e con il pulsante di pausa, e non parte con «riduci movimento»): vedi public/js/reviews.js.
 * @param {object} o
 * @param {object[]} o.quotes commenti dei clienti (vedi featuredQuotes)
 * @param {{rating: number|null, count: number|null, uri: string, reviews: object[]}|null} [o.google] le recensioni di Google nella lingua di chi guarda
 * @param {{count: number, average: number|null}|null} [o.stats] i voti dei feedback del sito (la media compare da 5 voti)
 */
export function reviewsCarousel(ctx, { quotes, google = null, stats = null, readUrl = '' }) {
  const { t, lang, app } = ctx;
  const fmtNum = new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 1 });
  const siteCards = quotes.map((q) => ({ kind: 'site', q }));
  const googleCards = (google?.reviews ?? []).map((r) => ({ kind: 'google', r }));
  // alternate, cominciando da Google; quando una delle due finisce, seguono le altre
  const cards = [];
  for (let i = 0; i < Math.max(siteCards.length, googleCards.length); i++) {
    if (googleCards[i]) cards.push(googleCards[i]);
    if (siteCards[i]) cards.push(siteCards[i]);
  }
  if (!cards.length) return '';
  const stars = (n) => html`<div class="quote-stars" role="img" aria-label="${t('fb.star', { n })}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</div>`;
  const card = (c) => {
    if (c.kind === 'google') {
      const r = c.r;
      const body = shorten(r.text, 420);
      const translated = r.original && r.originalLang && r.originalLang !== r.lang.slice(0, 2);
      return html`<figure class="quote rv-card rv-google" role="group" aria-roledescription="slide">
      <div class="rv-top">${stars(r.rating)}<span class="rv-src rv-src-google">${t('reviews.src.google')}</span></div>
      <blockquote lang="${r.lang || lang}"><p>${body.text}</p></blockquote>
      ${translated
        ? html`<details class="quote-orig"><summary><span class="q-open-label">${t('reviews.seeOriginal')}</span><span class="q-close-label">${t('reviews.hideOriginal')}</span></summary>
        <blockquote lang="${r.originalLang}"><p>${r.original}</p></blockquote></details>
      <p class="quote-auto">${t('reviews.google.translated')}</p>`
        : ''}
      <figcaption>${r.authorUrl ? html`<a href="${r.authorUrl}" target="_blank" rel="noopener nofollow"><strong>${r.author}</strong></a>` : html`<strong>${r.author}</strong>`}${r.when ? html`, ${fmtMonth(r.when.slice(0, 7), lang)}` : ''}${r.url ? html` · <a href="${r.url}" target="_blank" rel="noopener nofollow">${t('reviews.google.read')}</a>` : ''}</figcaption>
    </figure>`;
    }
    const q = c.q;
    return html`<figure class="quote rv-card" role="group" aria-roledescription="slide">
      <div class="rv-top">${stars(q.rating)}<span class="rv-src">${t('reviews.src.site')}</span></div>
      ${q.translation
        ? html`<blockquote lang="${lang}"><p>${q.translation.text}</p></blockquote>
      <details class="quote-orig"><summary><span class="q-open-label">${t('reviews.seeOriginal')}</span><span class="q-close-label">${t('reviews.hideOriginal')}</span></summary>
        <blockquote lang="${q.translation.from}"><p>${q.comment}</p></blockquote></details>
      <p class="quote-auto">${t('reviews.autoTranslated')}</p>`
        : html`<blockquote lang="${q.lang}"><p>${q.comment}</p></blockquote>`}
      <figcaption>${q.firstName ? html`<strong>${q.firstName}</strong> · ` : ''}${app.content.tour(q.tourSlug)?.i18n[lang].title ?? ''}, ${fmtMonth(q.date.slice(0, 7), lang)}</figcaption>
    </figure>`;
  };
  const siteAvg = stats && stats.count >= 5 && stats.average != null ? fmtNum.format(stats.average) : null;
  const googleAvg = google?.rating && google?.count ? t('reviews.google.avg', { avg: fmtNum.format(google.rating), n: google.count }) : '';
  return html`<div class="rv" data-reviews role="region" aria-roledescription="carousel" aria-label="${t('reviews.carousel')}">
    <div class="rv-track" data-reviews-track>${cards.map(card)}</div>
    <div class="rv-nav" data-reviews-nav hidden>
      <button type="button" class="rv-btn" data-rv="prev" aria-label="${t('reviews.prev')}">‹</button>
      <button type="button" class="rv-btn rv-pause" data-rv="pause" aria-label="${t('reviews.pause')}" data-label-pause="${t('reviews.pause')}" data-label-play="${t('reviews.play')}"><span class="rv-i-pause" aria-hidden="true">❚❚</span><span class="rv-i-play" aria-hidden="true">▶</span></button>
      <button type="button" class="rv-btn" data-rv="next" aria-label="${t('reviews.next')}">›</button>
    </div>
    <p class="quotes-note">${googleAvg ? html`<strong>★ ${google.uri ? html`<a href="${google.uri}" target="_blank" rel="noopener nofollow">${googleAvg}</a>` : googleAvg}</strong><br>` : ''}${siteAvg ? html`<strong>★ ${t('reviews.avg', { avg: siteAvg, n: stats.count })}</strong><br>` : ''}${t('reviews.note')}${googleCards.length ? html` ${t('reviews.googleNote')}` : ''}${readUrl ? html` <a href="${readUrl}" target="_blank" rel="noopener">${t('reviews.readAll')}</a>` : ''}</p>
  </div>`;
}

/**
 * «Prenota di nuovo»: la pagina di prenotazione con servizio, persone, durata e lingua di questa pratica già scelti
 * e il suo riferimento pratica, che arriva fino alla conferma (così un gruppo che torna si prenota in due tocchi).
 */
export function rebookHref(ctx, b) {
  const tour = ctx.app.content.tour(b.tour_slug);
  const service = parseServiceRecord(b.service_json);
  const q = new URLSearchParams({ tour: b.tour_slug, pax: String(b.participants) });
  if (tour?.chooseHours && service?.hours) q.set('hours', String(service.hours));
  if (tour?.model === 'person' && b.tour_lang) q.set('tl', b.tour_lang);
  if (b.client_ref) q.set('cr', b.client_ref);
  return `${ctx.u('/book')}?${q}`;
}

export function tourCard(ctx, tour) {
  const { t, lang, u } = ctx;
  const ti = tour.i18n[lang];
  const p = priceParts(ctx, tour);
  const invite = ctx.acct?.status === 'approved' ? null : invitePercentFor(ctx.app, tour); // lo sconto «porta un amico» è dei privati
  return html`<a class="card tour-card reveal" href="${u('/tours/' + tour.slug)}">
    <div class="card-media">${tourMedia(ctx, tour, '')}<span class="chip chip-float">${tour.pricing === 'hourly' ? t('tour.kindHourly') : tour.model === 'person' ? t('tour.kindGroup') : t('tour.kindPrivate')}</span>${invite ? html`<span class="chip chip-accent chip-invite">${t('tour.inviteTag', { percent: invite })}</span>` : ''}</div>
    <div class="card-body">
      <h3>${ti.title}</h3>
      <p class="muted">${ti.summary}</p>
      <ul class="meta">
        <li>${durationText(t, lang, tour)}</li>
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

/**
 * Un'agenzia approvata che prenota (cerca, preventivo, pagamento, scheda) resta nella sua area riservata: stessa barra semplice,
 * senza blog, «chi sono», tour o programmi. Per tutti gli altri è il sito di sempre.
 */
export const areaOf = (ctx) => (ctx.acct?.status === 'approved' ? 'partner' : '');

/** Il primo gradino delle briciole di pane: la home del sito, o l'area dell'agenzia. */
/** Chi sta lavorando in area agenzie (il titolare o un collaboratore): il suo nome e la sua email vanno proposti nei moduli di prenotazione. */
export const whoOf = (ctx) => ctx.actor ?? (ctx.acct ? actorOf(ctx.acct) : null);

export const homeCrumb = (ctx) => (areaOf(ctx) ? [ctx.t('nav.agencyArea'), ctx.u('/b2b/account')] : [ctx.t('nav.home'), `/${ctx.lang}/`]);

export function breadcrumbs(ctx, items) {
  return html`<nav class="breadcrumbs" aria-label="${ctx.t('a11y.breadcrumbs')}">${items.map(([label, href], i) => (href ? html`<a href="${href}">${label}</a><span aria-hidden="true">›</span>` : html`<span aria-current="page">${label}</span>`))}</nav>`;
}
