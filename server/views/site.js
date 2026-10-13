import { art } from '../art.js';
import { esc, html, raw } from '../html.js';
import { paymentOptions, unitPriceFor } from '../bookings.js';
import { fmtDate, nowRome } from '../time.js';
import { page, icon } from './layout.js';
import { giftBand } from './gift.js';
import { breadcrumbs, cancellationLine, checkIcon, crossIcon, departuresList, fmtDuration, fmtHours, mediaImg, mediaUrl, postCard, priceParts, sectionHead, siteArt, testimonials, tourCard, tourMedia } from './components.js';
import { LANGS, pick } from '../langs.js';
import { SERVICES, openTo } from '../rates.js';
import { ratesBlock } from './hourly.js';

/** Prima data prenotabile (indicativa) in base al preavviso minimo B2C. */
export function minBookableDate(app, channel = 'b2c', nowMs = Date.now()) {
  const hours = channel === 'b2b' ? app.cfg.policy.b2bMinNoticeHours : app.cfg.policy.b2cMinNoticeHours;
  return nowRome(nowMs + hours * 3600_000).date;
}

function faqItems(ctx, keys) {
  const { t, app } = ctx;
  const b2c = fmtHours(t, app.cfg.policy.b2cFreeCancelHours);
  // senza il pagamento sul posto la risposta sui pagamenti parla solo di carta
  const answer = (k) => (k === 'pay' && !app.cfg.policy.allowPayOnSite ? 'faq.pay.aCard' : `faq.${k}.a`);
  return keys.map((k) => html`<details class="faq-item reveal"><summary>${t(`faq.${k}.q`)}</summary><div class="faq-a">${t(answer(k), { cancel: b2c })}</div></details>`);
}

// ───────────────────────── Home ─────────────────────────
export function homePage(ctx, { departures = [], quotes = [], reviewStats = null } = {}) {
  const { t, lang, u, app } = ctx;
  const { content, cfg } = app;
  const rates = app.rates.get();
  const channel = ctx.acct?.status === 'approved' ? 'b2b' : 'b2c';
  const featured = content.tours.filter((x) => x.featured && openTo(rates, x, channel));
  const posts = content.postsFor(lang).slice(0, 3);
  const minDate = minBookableDate(app);
  const hours = fmtHours(t, cfg.policy.b2cFreeCancelHours);

  const body = html`
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-text">
      <p class="eyebrow">${t('home.eyebrow')}</p>
      <h1>${t('home.h1')}</h1>
      <p class="lead">${t('home.lead')}</p>
      <form class="quick-search" method="get" action="${u('/book')}">
        <label><span>${t('quick.date')}</span><input type="date" name="date" min="${minDate}" required></label>
        <label><span>${t('quick.guests')}</span><input type="number" name="pax" min="1" max="25" value="2" inputmode="numeric" required></label>
        <button class="btn btn-gold" type="submit">${t('quick.go')}</button>
      </form>
      <p class="hero-links"><a href="${u('/tours')}">${t('home.allTours')} →</a> <span aria-hidden="true">·</span> <a href="${u('/b2b')}">${t('home.forAgencies')}</a></p>
    </div>
    <div class="hero-art">${siteArt(ctx, 'home', 'dome', { label: t('home.artAlt'), alt: t('site.title'), sizes: '(max-width: 900px) 100vw, 560px', eager: true })}</div>
  </div>
</section>

${departures.length ? html`<section class="section tight departures">
  <div class="wrap">
    <h2 class="h-sub">${t('departures.title')}</h2>
    <p class="muted">${t('departures.lead')}</p>
    ${departuresList(ctx, departures)}
  </div>
</section>` : ''}

<section class="trust">
  <div class="wrap trust-grid">
    <p class="reveal">${checkIcon}<span><strong>${t('trust.licensed')}</strong><br>${t('trust.licensedSub')}</span></p>
    <p class="reveal">${checkIcon}<span><strong>${t('trust.small')}</strong><br>${t('trust.smallSub')}</span></p>
    <p class="reveal">${checkIcon}<span><strong>${t('trust.cancel', { when: hours })}</strong><br>${t('trust.cancelSub')}</span></p>
    <p class="reveal">${checkIcon}<span><strong>${t(ctx.app.cfg.policy.allowPayOnSite ? 'trust.pay' : 'trust.payCard')}</strong><br>${t(ctx.app.cfg.policy.allowPayOnSite ? 'trust.paySub' : 'trust.paySubCard')}</span></p>
  </div>
</section>

<section class="section">
  <div class="wrap">
    ${sectionHead(t('home.toursTitle'), t('home.toursLead'), html`<a class="btn btn-outline" href="${u('/tours')}">${t('home.allTours')}</a>`)}
    <div class="grid grid-3">${featured.map((x) => tourCard(ctx, x))}</div>
  </div>
</section>

<section class="section section-alt">
  <div class="wrap">
    ${sectionHead(t('why.title'), t('why.lead'))}
    <div class="grid grid-3 why">
      ${[1, 2, 3].map((n) => html`<div class="why-item reveal"><span class="why-n" aria-hidden="true">${n}</span><h3>${t(`why.${n}.t`)}</h3><p>${t(`why.${n}.p`)}</p></div>`)}
    </div>
    <p class="center reveal"><a class="btn btn-outline" href="${u('/about')}">${t('why.cta')}</a></p>
  </div>
</section>

${quotes.length ? html`<section class="section">
  <div class="wrap">
    ${sectionHead(t('reviews.title'))}
    ${testimonials(ctx, quotes, { stats: reviewStats, readUrl: cfg.reviews.readUrl })}
  </div>
</section>` : ''}

<section class="section">
  <div class="wrap">
    ${sectionHead(t('how.title'))}
    <ol class="steps">
      ${[1, 2, 3].map((n) => html`<li class="reveal"><span class="step-n" aria-hidden="true">${n}</span><div><h3>${t(`how.${n}.t`)}</h3><p>${t(n === 2 && !ctx.app.cfg.policy.allowPayOnSite ? 'how.2.pCard' : `how.${n}.p`)}</p></div></li>`)}
    </ol>
  </div>
</section>

${giftBand(ctx)}

<section class="band band-dark">
  <div class="wrap band-grid">
    <div class="reveal">
      <p class="eyebrow">${t('b2b.eyebrow')}</p>
      <h2>${t('home.b2bTitle')}</h2>
      <p class="lead">${t('home.b2bLead')}</p>
      <p class="btn-row"><a class="btn btn-gold" href="${u('/b2b/register')}">${t('b2b.requestAccess')}</a> <a class="btn btn-outline-light" href="${u('/b2b')}">${t('home.b2bMore')}</a></p>
    </div>
    <ul class="check-list reveal">
      ${[1, 2, 3, 4].map((n) => html`<li>${checkIcon}<span>${t(`home.b2b.${n}`, { when: fmtHours(t, cfg.policy.b2bFreeCancelHours) })}</span></li>`)}
    </ul>
  </div>
</section>

${posts.length
  ? html`<section class="section">
  <div class="wrap">
    ${sectionHead(t('home.blogTitle'), t('home.blogLead'), html`<a class="btn btn-outline" href="${u('/blog')}">${t('home.allPosts')}</a>`)}
    <div class="grid grid-3">${posts.map((p) => postCard(ctx, p))}</div>
  </div>
</section>`
  : ''}

<section class="section section-alt">
  <div class="wrap narrow">
    ${sectionHead(t('faq.title'))}
    <div class="faq">${faqItems(ctx, ['how', 'cancel', 'pay', 'meet', 'rain', 'access'])}</div>
  </div>
</section>

<section class="band band-gold">
  <div class="wrap center reveal">
    <h2>${t('cta.title')}</h2>
    <p class="lead">${t('cta.lead')}</p>
    <p class="btn-row center"><a class="btn btn-dark" href="${u('/book')}">${t('cta.book')}</a> <a class="btn btn-outline-dark" href="${u('/contact')}">${t('cta.contact')}</a></p>
  </div>
</section>`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: cfg.site.name,
    jobTitle: pick({ it: 'Guida turistica abilitata a Venezia', en: 'Licensed tour guide in Venice', es: 'Guía turístico habilitado en Venecia' }, lang),
    knowsLanguage: LANGS,
    url: `${cfg.baseUrl}/${lang}/`,
    sameAs: [cfg.site.instagram, 'https://davidetomio.it'].filter(Boolean),
    areaServed: 'Venezia',
  };
  return page(ctx, { path: `/${lang}/`, body, ld, bodyClass: 'home' });
}

// ───────────────────────── Tour ─────────────────────────
export function toursPage(ctx) {
  const { t, lang, app } = ctx;
  const rates = app.rates.get();
  const shown = app.content.tours.filter((x) => openTo(rates, x, ctx.acct?.status === 'approved' ? 'b2b' : 'b2c'));
  const groups = shown.filter((x) => x.model === 'person');
  const priv = shown.filter((x) => x.model === 'group');
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.tours')]])}
  <h1>${t('tours.title')}</h1><p class="lead">${t('tours.lead')}</p>
</div></section>
<section class="section"><div class="wrap">
  <h2 class="h-sub">${t('tours.groupTitle')}</h2><p class="muted sub-lead">${t('tours.groupLead')}</p>
  <div class="grid grid-3">${groups.map((x) => tourCard(ctx, x))}</div>
  <h2 class="h-sub spaced">${t('tours.privateTitle')}</h2><p class="muted sub-lead">${t('tours.privateLead')}</p>
  <div class="grid grid-3">${priv.map((x) => tourCard(ctx, x))}</div>
  <p class="center spaced reveal"><a class="btn btn-outline" href="${ctx.u('/programs')}">${t('pg.toursLink')}</a></p>
</div></section>`;
  return page(ctx, { title: t('nav.tours'), description: t('tours.lead'), path: `/${lang}/tours`, body, activeNav: 'tours' });
}

export function tourPage(ctx, tour, { quotes = [], reviewStats = null } = {}) {
  const { t, lang, u, app } = ctx;
  const { cfg } = app;
  const ti = tour.i18n[lang];
  const p = priceParts(ctx, tour);
  const channel = p.channel;
  const minDate = minBookableDate(app, channel);
  const related = app.content.postsFor(lang).filter((x) => x.tours.includes(tour.slug)).slice(0, 2);
  const options = paymentOptions(app, tour, channel, ctx.acct);
  const widgetI18n = {
    persons: t('w.persons'), person1: t('w.person1'), personN: t('w.personN'), pickDate: t('w.pickDate'), pickTime: t('w.pickTime'), noSlots: t('w.noSlots'), noMonth: t('w.noMonth'),
    total: t('w.total'), cont: t('w.continue'), left: t('w.left'), joined: t('w.joined'), perPerson: t('price.perPerson'), perGroup: t('price.perGroup'), prev: t('w.prev'), next: t('w.next'), loading: t('w.loading'), error: t('w.error'),
    legend: t('w.legend'), selected: t('w.selected'), minPeople: t('w.min'), maxPeople: t('w.max'),
  };

  const hourly = tour.pricing === 'hourly';
  const hourlyCard = html`
<aside class="book-card" id="book">
  <div class="book-head">
    <p class="price-big">${p.money}<small> / ${p.per}</small></p>
    ${channel === 'b2b' ? html`<span class="chip chip-accent">${t('b2b.partnerRate')}</span>` : ''}
  </div>
  <p class="muted">${t('hourly.card.note')}</p>
  <a class="btn btn-gold btn-block" href="${u('/hourly')}?product=${tour.slug}">${t('hourly.card.cta')}</a>
  <p class="small muted policy-note">${cancellationLine(ctx, tour, channel)}</p>
</aside>`;
  const widget = hourly ? hourlyCard : html`
<aside class="book-card" id="book" data-widget data-tour="${tour.slug}" data-model="${tour.model}" data-max="${tour.maxParticipants}" data-unit="${p.unit}" data-lang="${lang}" data-min-date="${minDate}" data-book-url="${u('/book/checkout')}" data-i18n="${JSON.stringify(widgetI18n)}">
  <div class="book-head">
    <p class="price-big">${p.money}<small> / ${p.per}</small></p>
    ${channel === 'b2b' ? html`<span class="chip chip-accent">${t('b2b.partnerRate')}</span>` : ''}
  </div>
  <h2 class="sr-only">${t('w.title')}</h2>
  <div class="field stepper-field">
    <span class="label" id="lbl-pax">${t('w.persons')}</span>
    <div class="stepper" role="group" aria-labelledby="lbl-pax">
      <button type="button" data-pax-minus aria-label="−">−</button><output data-pax aria-live="polite">2</output><button type="button" data-pax-plus aria-label="+">+</button>
    </div>
  </div>
  <div class="cal" data-cal><p class="muted small">${t('w.loading')}</p></div>
  <div class="slots-wrap" data-slots hidden></div>
  <div class="book-summary" data-summary hidden></div>
  <a class="btn btn-gold btn-block" data-continue href="${u('/book')}?tour=${tour.slug}" aria-disabled="true">${t('w.continue')}</a>
  <p class="small muted policy-note">${cancellationLine(ctx, tour, channel)}${options.includes('onsite') ? html` · ${t('w.payOnSite')}` : ''}</p>
  <noscript><form method="get" action="${u('/book')}" class="noscript-form"><input type="hidden" name="tour" value="${tour.slug}"><label>${t('quick.date')} <input type="date" name="date" min="${minDate}" required></label> <label>${t('quick.guests')} <input type="number" name="pax" min="1" max="${tour.maxParticipants}" value="2"></label> <button class="btn btn-gold" type="submit">${t('quick.go')}</button></form></noscript>
</aside>`;

  const body = html`
${tour.image ? html`<section class="tour-hero"><div class="tour-hero-art">${tourMedia(ctx, tour)}</div></section>` : ''}
<div class="wrap tour-layout ${tour.image ? '' : 'no-hero'}">
  <article class="tour-main">
    ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.tours'), u('/tours')], [ti.title]])}
    ${tour.image ? '' : html`<div class="tour-banner">${tourMedia(ctx, tour)}</div>`}
    <p class="eyebrow">${hourly ? t('tour.kindHourly') : tour.model === 'person' ? t('tour.kindGroup') : t('tour.kindPrivate')}</p>
    <h1>${ti.title}</h1>
    <p class="lead">${ti.subtitle || ti.summary}</p>
    <ul class="facts">
      <li><span class="fact-k">${t('tour.duration')}</span><span class="fact-v">${fmtDuration(tour.durationMin)}</span></li>
      <li><span class="fact-k">${t('tour.group')}</span><span class="fact-v">${tour.model === 'person' ? t('tour.maxPeople', { n: tour.maxParticipants }) : t('tour.upTo', { n: tour.maxParticipants })}</span></li>
      <li><span class="fact-k">${t('tour.languages')}</span><span class="fact-v">${tour.languages.map((l) => t(`lang.${l}`)).join(', ')}</span></li>
      <li><span class="fact-k">${t('tour.start')}</span><span class="fact-v">${tour.flexible ? t('tour.startFlexible') : tour.times.join(' · ')}</span></li>
    </ul>

    <div class="prose">${raw(ti.descriptionHtml)}</div>

    ${ti.highlights.length ? html`<h2 class="h-sub">${t('tour.highlights')}</h2><ul class="check-list">${ti.highlights.map((h) => html`<li>${checkIcon}<span>${h}</span></li>`)}</ul>` : ''}

    <div class="two-col">
      ${ti.includes.length ? html`<div><h3>${t('tour.includes')}</h3><ul class="check-list compact">${ti.includes.map((h) => html`<li>${checkIcon}<span>${h}</span></li>`)}</ul></div>` : ''}
      ${ti.excludes.length ? html`<div><h3>${t('tour.excludes')}</h3><ul class="check-list compact muted-list">${ti.excludes.map((h) => html`<li>${crossIcon}<span>${h}</span></li>`)}</ul></div>` : ''}
    </div>

    <div class="info-box">
      <h3>${t('tour.meeting')}</h3>
      <p>${ti.meetingPoint}${ti.meetingUrl ? html` · <a href="${ti.meetingUrl}" target="_blank" rel="noopener">${t('tour.openMap')}</a>` : ''}</p>
      ${ti.notes ? html`<h3>${t('tour.goodToKnow')}</h3><p>${ti.notes}</p>` : ''}
      <h3>${t('tour.cancellation')}</h3>
      <p>${cancellationLine(ctx, tour, channel)} ${t('policy.after')} <a href="${u('/terms')}">${t('policy.terms')}</a></p>
    </div>

    ${ti.faq?.length ? html`<h2 class="h-sub">${t('faq.title')}</h2><div class="faq tour-faq">${ti.faq.map((f) => html`<details class="faq-item"><summary>${f.q}</summary><div class="faq-a prose">${raw(f.html)}</div></details>`)}</div>` : ''}

    ${quotes.length ? html`<h2 class="h-sub">${t('reviews.tourTitle')}</h2>${testimonials(ctx, quotes, { stats: reviewStats, readUrl: cfg.reviews.readUrl })}` : ''}

    ${related.length ? html`<h2 class="h-sub">${t('tour.readMore')}</h2><div class="grid grid-2">${related.map((x) => postCard(ctx, x))}</div>` : ''}
  </article>
  <div class="tour-side">${widget}</div>
</div>
<div class="mobile-cta"><div><strong>${p.money}</strong><small> / ${p.per}</small></div>${hourly ? html`<a class="btn btn-gold btn-sm" href="${u('/hourly')}?product=${tour.slug}">${t('hourly.card.cta')}</a>` : html`<a class="btn btn-gold btn-sm" href="#book">${t('w.pickDate')}</a>`}</div>`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: ti.title,
    description: ti.summary,
    touristType: pick({ it: 'Turisti a Venezia', en: 'Visitors to Venice', es: 'Visitantes de Venecia' }, lang),
    provider: { '@type': 'Person', name: cfg.site.name },
    offers: { '@type': 'Offer', price: ((hourly ? (app.rates.fromPrice(tour.service, 'b2c')?.cents ?? 0) : unitPriceFor(tour, 'b2c')) / 100).toFixed(2), priceCurrency: 'EUR', url: `${cfg.baseUrl}/${lang}/tours/${tour.slug}` },
  };
  return page(ctx, { title: ti.title, description: ti.summary, path: `/${lang}/tours/${tour.slug}`, body, ld, ogImage: mediaUrl(cfg, tour.image), activeNav: 'tours', bodyClass: 'tour-page', scripts: raw('<script src="/js/booking.js?v=' + app.assetVersion + '" defer></script>') });
}

// ───────────────────────── Blog ─────────────────────────
export function blogPage(ctx) {
  const { t, lang, app } = ctx;
  const posts = app.content.postsFor(lang);
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.blog')]])}
  <h1>${t('blog.title')}</h1><p class="lead">${t('blog.lead')}</p>
</div></section>
<section class="section"><div class="wrap"><div class="grid grid-3">${posts.map((p) => postCard(ctx, p))}</div></div></section>`;
  return page(ctx, { title: t('nav.blog'), description: t('blog.lead'), path: `/${lang}/blog`, body, activeNav: 'blog' });
}

export function postPage(ctx, post) {
  const { t, lang, u, app } = ctx;
  const pi = post.i18n[lang];
  const tours = post.tours.map((s) => app.content.tour(s)).filter((x) => x?.active);
  const body = html`
<article class="wrap article">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.blog'), u('/blog')], [pi.title]])}
  <header class="article-head">
    <p class="eyebrow">${fmtDate(post.date, lang)} · ${t('blog.minutes', { n: pi.minutes })}</p>
    <h1>${pi.title}</h1>
    <p class="lead">${pi.summary}</p>
    <ul class="tags">${pi.tags.map((x) => html`<li>${x}</li>`)}</ul>
  </header>
  <div class="article-art">${post.image ? mediaImg(post.image, '', { sizes: '(max-width: 900px) 100vw, 900px', eager: true }) : art(post.art, { label: '' })}</div>
  <div class="prose article-body">${raw(pi.html)}</div>
  ${tours.length ? html`<aside class="article-cta"><h2>${t('blog.tourCta')}</h2><div class="grid grid-2">${tours.map((x) => tourCard(ctx, x))}</div></aside>` : ''}
</article>`;
  const ld = { '@context': 'https://schema.org', '@type': 'Article', headline: pi.title, datePublished: post.date, author: { '@type': 'Person', name: app.cfg.site.name }, inLanguage: lang };
  return page(ctx, { title: pi.title, description: pi.summary, path: `/${lang}/blog/${post.slug}`, body, article: true, ld, activeNav: 'blog', ogImage: mediaUrl(app.cfg, post.image) });
}

// ───────────────────────── Pagine statiche ─────────────────────────
export function staticPage(ctx, name, pg, vars, { activeNav = '' } = {}) {
  const { t, lang } = ctx;
  const htmlBody = String(pg.html).replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? esc(vars[k]) : ''));
  const portrait = name === 'about' ? ctx.app.siteImages?.get('about') : null;
  const body = html`
<section class="page-head"><div class="wrap narrow">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [pg.title]])}
  <h1>${pg.title}</h1>
</div></section>
<section class="section tight"><div class="wrap narrow">
  ${portrait ? html`<figure class="portrait">${mediaImg(portrait, pg.title, { sizes: '(max-width: 640px) 100vw, 260px', eager: true })}</figure>` : ''}
  <div class="prose">${raw(htmlBody)}</div>
  ${name === 'about' ? html`<p class="btn-row"><a class="btn btn-gold" href="/${lang}/tours">${t('about.cta')}</a> <a class="btn btn-outline" href="/${lang}/contact">${t('cta.contact')}</a></p>` : ''}
</div></section>`;
  return page(ctx, { title: pg.title, description: pg.description, path: `/${lang}/${name}`, body, activeNav, noindex: false });
}

// ───────────────────────── Contatti ─────────────────────────
export function contactPage(ctx, { sent = false, error = '', values = {} } = {}) {
  const { t, lang, app } = ctx;
  const { cfg } = app;
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [[t('nav.home'), `/${lang}/`], [t('nav.contact')]])}
  <h1>${t('contact.title')}</h1><p class="lead">${t('contact.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap contact-grid">
  <div class="card pad">
    ${sent ? html`<div class="notice notice-ok" role="status">${t('contact.sent')}</div>` : ''}
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    <form method="post" action="/${lang}/contact" class="form">
      <label class="field"><span class="label">${t('f.name')}</span><input name="name" required maxlength="120" autocomplete="name" value="${values.name ?? ''}"></label>
      <label class="field"><span class="label">${t('f.email')}</span><input type="email" name="email" required maxlength="200" autocomplete="email" value="${values.email ?? ''}"></label>
      <label class="field"><span class="label">${t('contact.message')}</span><textarea name="message" rows="6" required maxlength="3000">${values.message ?? ''}</textarea></label>
      <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="small muted">${t('contact.privacy')} <a href="/${lang}/privacy">${t('footer.privacy')}</a></p>
      <button class="btn btn-gold" type="submit">${t('contact.send')}</button>
    </form>
  </div>
  <div class="card pad contact-info">
    <h2>${t('contact.direct')}</h2>
    <ul class="plain contact-list big">
      <li><a href="mailto:${cfg.site.email}">${icon('mail')} ${cfg.site.email}</a></li>
      ${cfg.site.whatsapp ? html`<li><a href="https://wa.me/${cfg.site.whatsapp}" rel="noopener">${icon('whatsapp')} WhatsApp</a></li>` : ''}
      ${cfg.site.phone ? html`<li><a href="tel:${cfg.site.phone.replace(/\s+/g, '')}">${icon('phone')} ${cfg.site.phone}</a></li>` : ''}
      ${cfg.site.instagram ? html`<li><a href="${cfg.site.instagram}" rel="noopener" target="_blank">${icon('insta')} Instagram</a></li>` : ''}
    </ul>
    <p class="muted">${t('contact.reply')}</p>
  </div>
</div></section>`;
  return page(ctx, { title: t('nav.contact'), description: t('contact.lead'), path: `/${lang}/contact`, body });
}

// ───────────────────────── B2B (pagina commerciale) ─────────────────────────
export function b2bLandingPage(ctx) {
  const { t, lang, u, app } = ctx;
  const { cfg, content } = app;
  const hours = fmtHours(t, cfg.policy.b2bFreeCancelHours);
  const notice = fmtHours(t, cfg.policy.b2bMinNoticeHours);
  const rateServices = SERVICES.filter((s) => app.rates.has(s, 'b2b'));
  const showRates = rateServices.length && (app.rates.get().showB2bPublic || ctx.acct?.status === 'approved');
  const body = html`
<section class="hero hero-b2b">
  <div class="wrap hero-grid">
    <div class="hero-text">
      <p class="eyebrow">${t('b2b.eyebrow')}</p>
      <h1>${t('b2b.h1')}</h1>
      <p class="lead">${t('b2b.lead')}</p>
      <p class="btn-row">
        ${ctx.acct ? html`<a class="btn btn-gold" href="${u('/b2b/account')}">${t('nav.myAccount')}</a>` : html`<a class="btn btn-gold" href="${u('/b2b/register')}">${t('b2b.requestAccess')}</a> <a class="btn btn-outline" href="${u('/b2b/login')}">${t('b2b.login')}</a>`}
        ${showRates ? html`<a class="btn btn-outline" href="#tariffe">${t('b2b.seeRates')}</a>` : ''}
      </p>
    </div>
    <div class="hero-art">${siteArt(ctx, 'b2b', 'walk', { alt: t('b2b.h1'), sizes: '(max-width: 900px) 100vw, 560px', eager: true })}</div>
  </div>
</section>

${showRates ? html`<section class="section" id="tariffe">
  <div class="wrap">
    ${sectionHead(t('b2b.ratesTitle'), t('b2b.ratesLead'), html`<a class="btn btn-gold" href="${u('/hourly')}">${t('b2b.ratesCta')}</a>`)}
    ${ratesBlock(ctx, { channel: 'b2b', services: rateServices })}
  </div>
</section>` : ''}

<section class="section${showRates ? ' section-alt' : ''}">
  <div class="wrap">
    ${sectionHead(t('b2b.benefitsTitle'))}
    <div class="grid grid-3 benefits">
      ${[1, 2, 3, 4, 5, 6].map((n) => html`<div class="benefit reveal"><h3>${t(`b2b.b${n}.t`)}</h3><p>${t(`b2b.b${n}.p`, { when: hours, notice })}</p></div>`)}
    </div>
  </div>
</section>

<section class="section section-alt">
  <div class="wrap">
    ${sectionHead(t('b2b.howTitle'))}
    <ol class="steps steps-4">
      ${[1, 2, 3, 4].map((n) => html`<li class="reveal"><span class="step-n" aria-hidden="true">${n}</span><div><h3>${t(`b2b.s${n}.t`)}</h3><p>${t(`b2b.s${n}.p`)}</p></div></li>`)}
    </ol>
  </div>
</section>

<section class="section">
  <div class="wrap narrow">
    ${sectionHead(t('b2b.policyTitle'))}
    <div class="card pad policy-card reveal">
      <ul class="check-list">
        <li>${checkIcon}<span>${t('b2b.policy.1', { when: hours })}</span></li>
        <li>${checkIcon}<span>${t('b2b.policy.2', { notice })}</span></li>
        <li>${checkIcon}<span>${t('b2b.policy.3')}</span></li>
        <li>${checkIcon}<span>${t('b2b.policy.4')}</span></li>
      </ul>
      <p class="muted small">${t('b2b.policy.note')}</p>
    </div>
    <p class="center reveal"><a href="${u('/programs')}">${t('pg.b2bLink')} →</a></p>
    ${showRates ? html`<p class="center reveal"><a href="${u('/hourly')}">${t('b2b.ratesCta')} →</a></p>` : ''}
  </div>
</section>

<section class="section section-alt">
  <div class="wrap narrow">
    ${sectionHead(t('faq.title'))}
    <div class="faq">${[1, 2, 3, 4].map((n) => html`<details class="faq-item reveal"><summary>${t(`b2b.faq${n}.q`)}</summary><div class="faq-a">${t(`b2b.faq${n}.a`, { when: hours, notice })}</div></details>`)}</div>
  </div>
</section>

<section class="band band-gold">
  <div class="wrap center reveal">
    <h2>${t('b2b.ctaTitle')}</h2>
    <p class="lead">${t('b2b.ctaLead')}</p>
    <p class="btn-row center"><a class="btn btn-dark" href="${u('/b2b/register')}">${t('b2b.requestAccess')}</a> <a class="btn btn-outline-dark" href="${u('/contact')}">${t('b2b.ask')}</a></p>
  </div>
</section>`;
  return page(ctx, { title: t('b2b.title'), description: t('b2b.lead'), path: `/${lang}/b2b`, body, activeNav: 'b2b' });
}

