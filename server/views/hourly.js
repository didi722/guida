// Tariffe a ore: tabelle delle tariffe, supplementi e pagina del calcolatore (preventivo + orari liberi).
import { html, raw } from '../html.js';
import { parseDayList, rateRows, hourOptions, minHours } from '../rates.js';
import { localeOf } from '../langs.js';
import { formatMoney } from '../util.js';
import { page } from './layout.js';
import { areaOf, breadcrumbs, homeCrumb, hoursLabel } from './components.js';

export { hoursLabel };

/** Etichetta di una voce del conto («Servizio, 4 ore», «Supplemento festivo (20%)»…). */
export function lineLabel(t, lang, line, hours) {
  switch (line.key) {
    case 'base':
      return t('hourly.line.base', { hours: hoursLabel(t, lang, line.hours ?? hours) }); // con le «ore intere» la voce dice quante ore si pagano
    case 'festivo':
    case 'superfestivo':
      return t(`hourly.line.${line.key}`, { pct: line.pct });
    case 'night':
      return t('hourly.line.night', { pct: line.pct, min: line.minutes });
    case 'earpieces':
      return t('hourly.line.earpieces', { n: line.pax, price: formatMoney(line.unitCents, lang) });
    default:
      return line.key;
  }
}

/** Le voci del conto con il totale, per il preventivo, il checkout e la pagina della prenotazione. */
export function quoteLines(t, lang, { lines, hours }, { total = true } = {}) {
  const sum = lines.reduce((s, l) => s + l.cents, 0);
  return html`${lines.map((l) => html`<div class="row-line ${l.key === 'base' ? '' : 'row-extra'}"><dt>${lineLabel(t, lang, l, hours)}</dt><dd>${l.cents < 0 ? '−' : ''}${formatMoney(Math.abs(l.cents), lang)}</dd></div>`)}${total ? html`<div class="summary-total"><dt>${t('hourly.quote.total')}</dt><dd>${formatMoney(sum, lang)}</dd></div>` : ''}`;
}

/** «domeniche, 6 gen, 25 apr, Pasquetta»: i giorni di una lista, leggibili. */
const dayWords = (t, lang, text, sundays = false) =>
  [
    ...(sundays ? [t('hourly.sup.sundays')] : []),
    ...parseDayList(text).tokens.map((tok) => (tok === 'pasqua' ? t('hourly.day.pasqua') : tok === 'pasquetta' ? t('hourly.day.pasquetta') : new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, Number(tok.slice(0, 2)) - 1, Number(tok.slice(3))))))),
  ].join(lang === 'ja' ? '、' : ', ');

/** Una tabella di tariffe (scaglioni + ora in più) per un servizio. `discountPercent`: sconto del partner, già applicato. */
export function rateCard(ctx, { service, channel, discountPercent = 0, account = null }) {
  const { t, lang, app } = ctx;
  const data = rateRows(app.rates.get(), service, channel, account?.discount_percent ?? discountPercent);
  if (!data) return '';
  return html`<div class="card pad rate-card reveal">
    <h3>${t(`hourly.s.${service}`)}</h3>
    <p class="muted small">${t(`hourly.d.${service}`)}</p>
    <table class="rate-table"><tbody>
      ${data.rows.map((r) => html`<tr><th scope="row">${t(`hourly.b.${r.hours}`)}</th><td>${formatMoney(r.cents, lang)}</td></tr>`)}
      <tr class="rate-extra"><th scope="row">${t('hourly.b.extra')}</th><td>${formatMoney(data.extraCents, lang)}</td></tr>
    </tbody></table>
    ${minHours(service) > 2 ? html`<p class="small muted">${t('hourly.note.min', { n: minHours(service) })}</p>` : ''}
  </div>`;
}

/** Supplementi (festivo, superfestivo, notturno, auricolari) con le cifre in vigore. */
export function supplementsBox(ctx, { earpieces = true, only = null } = {}) {
  const { t, lang, app } = ctx;
  const { surcharges: s, days } = app.rates.get();
  const row = (label, value) => html`<li><span>${label}</span><strong>${value}</strong></li>`;
  const has = (key) => !only || only.includes(key); // `only`: solo alcune voci (la dashboard dell'agenzia mostra festivi e auricolari)
  return html`<div class="card pad sup-card reveal">
    <h3>${t('hourly.sup.title')}</h3>
    <ul class="plain sup-list">
      ${has('festivo') && s.festivoPct > 0 ? row(t('hourly.sup.festivo', { days: dayWords(t, lang, days.holidays, days.sundays) }), `+${s.festivoPct}%`) : ''}
      ${has('superfestivo') && s.superFestivoPct > 0 ? row(t('hourly.sup.superfestivo', { days: dayWords(t, lang, days.superHolidays) }), `+${s.superFestivoPct}%`) : ''}
      ${has('night') && s.nightPct > 0 && s.nightFrom !== s.nightTo ? row(t('hourly.sup.night', { from: s.nightFrom, to: s.nightTo }), `+${s.nightPct}%`) : ''}
      ${has('earpieces') && earpieces && s.earpieceCents > 0 ? row(t('hourly.sup.earpieces', { price: formatMoney(s.earpieceCents, lang), n: s.earpieceFromPax }), '') : ''}
    </ul>
  </div>`;
}

/** Note in calce alle tariffe: gruppo, IVA e rivalsa (secondo la configurazione fiscale). */
export function ratesNotes(ctx, { channel }) {
  const { t, app } = ctx;
  const inv = app.cfg.invoice;
  return html`<ul class="plain notes-list small muted">
    <li>${t('hourly.note.group', { max: 25 })}</li>
    <li>${inv.vatBp === 0 ? t('hourly.note.noVat') : channel === 'b2b' ? t('hourly.note.vatExc') : t('hourly.note.vatInc')}</li>
    ${channel === 'b2b' && inv.contributionPercent > 0 ? html`<li>${t('hourly.note.rivalsa', { pct: inv.contributionPercent })}</li>` : ''}
  </ul>`;
}

/** Il blocco completo delle tariffe per un canale: schede dei servizi, supplementi e note. */
export function ratesBlock(ctx, { channel, services, discountPercent = 0 }) {
  const cards = services.map((service) => rateCard(ctx, { service, channel, discountPercent })).filter((x) => String(x));
  if (!cards.length) return '';
  return html`<div class="rate-grid">${cards}</div><div class="rate-extras">${supplementsBox(ctx, { earpieces: services.includes('guide') })}</div>${ratesNotes(ctx, { channel })}`;
}

// ───────────────────────── Pagina del calcolatore ─────────────────────────
/**
 * products: i servizi prenotabili (tour a ore); product: quello scelto; values: { date, hours, pax, earpieces };
 * quote: il preventivo (anche senza data); slots: [{ time, end, quote }] per la data scelta; channel: 'b2c' | 'b2b'.
 */
export function hourlyPage(ctx, { products, product, channel, values, quote, slots, minDate, error = '' }) {
  const { t, lang, u, app } = ctx;
  const isB2b = channel === 'b2b';
  const rates = app.rates.get();
  const title = isB2b ? t('hourly.titleB2b') : t('hourly.title');
  const lead = isB2b ? t('hourly.leadB2b') : t('hourly.lead');
  const services = [...new Set(products.map((p) => p.service))];
  const slotUrl = (time) => `${u('/book/checkout')}?tour=${encodeURIComponent(product.slug)}&date=${values.date}&time=${time}&pax=${values.pax}${product.chooseHours ? `&hours=${values.hours}` : ''}${values.earpieces ? '&earpieces=1' : ''}`;

  const body = products.length
    ? html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [title]])}
  <h1>${title}</h1><p class="lead">${lead}</p>
  ${isB2b ? html`<p><span class="chip chip-accent">${t('b2b.partnerRate')}</span></p>` : ''}
</div></section>

<section class="section tight"><div class="wrap">
  <form class="card pad hourly-form" method="get" action="${u('/hourly')}" data-hourly-live>
    ${error ? html`<div class="notice notice-err" role="alert">${error}</div>` : ''}
    ${products.length > 1
      ? html`<label class="field wide"><span class="label">${t('hourly.f.product')}</span><select name="product">${products.map((p) => html`<option value="${p.slug}" ${p.slug === product.slug ? raw('selected') : ''}>${p.i18n[lang].title}</option>`)}</select></label>`
      : html`<input type="hidden" name="product" value="${product.slug}">`}
    <label class="field"><span class="label">${t('quick.date')}</span><input type="date" name="date" min="${minDate}" value="${values.date ?? ''}"></label>
    <div class="dyn" data-dyn="hours">
    ${product.chooseHours
      ? html`<label class="field"><span class="label">${t('hourly.f.hours')}</span><select name="hours">${hourOptions(product.service).map((h) => html`<option value="${h}" ${h === values.hours ? raw('selected') : ''}>${hoursLabel(t, lang, h)}</option>`)}</select>${product.roundHours ? html`<small class="muted">${t('hourly.note.round')}</small>` : ''}</label>`
      : html`<p class="field"><span class="label">${t('hourly.f.hours')}</span><strong>${hoursLabel(t, lang, product.durationMin / 60)}</strong></p>`}
    </div>
    <div class="dyn" data-dyn="pax"><label class="field"><span class="label">${t('quick.guests')}</span><input type="number" name="pax" min="1" max="${product.maxParticipants}" value="${values.pax}" inputmode="numeric" required></label></div>
    <div class="dyn" data-dyn="ear">
    ${product.service === 'guide' && rates.surcharges.earpieceCents > 0
      ? html`<label class="check"><input type="checkbox" name="earpieces" value="1" ${values.earpieces ? raw('checked') : ''}> <span>${t('hourly.f.earpieces')} <small class="muted">(${t('hourly.sup.earpieces', { price: formatMoney(rates.surcharges.earpieceCents, lang), n: rates.surcharges.earpieceFromPax })})</small></span></label>`
      : ''}
    </div>
    <button class="btn btn-gold" type="submit" data-go>${t('hourly.f.go')}</button>
  </form>

  <div data-quote>${quote?.ok
    ? html`<div class="card pad quote-card">
        <h2 class="h-sub">${t('hourly.quote.title')}</h2>
        <p class="muted small">${product.i18n[lang].title}</p>
        <dl class="summary-list">${quoteLines(t, lang, quote)}</dl>
        ${values.date ? '' : html`<p class="small muted">${t('hourly.quote.estimate')}</p>`}
      </div>`
    : ''}</div>

  <div data-slots>${values.date && quote?.ok
    ? html`<h2 class="h-sub spaced">${t('hourly.quote.times')}</h2>
      ${slots.length
        ? html`<div class="slot-list">${slots.map((s) => html`<a class="slot" href="${slotUrl(s.time)}"><strong>${s.time}</strong><small>${formatMoney(s.quote.totalCents, lang)}</small></a>`)}</div>`
        : html`<div class="card pad empty"><p>${t('hourly.quote.none')}</p><p class="small muted"><a href="${u('/contact')}">${t('nav.contact')}</a></p></div>`}`
    : quote?.ok ? html`<p class="muted spaced">${t('hourly.quote.pickDate')}</p>` : ''}</div>

  <h2 class="h-sub spaced">${isB2b ? t('hourly.ratesYours') : t('hourly.rates')}</h2>
  ${ratesBlock(ctx, { channel, services: isB2b ? services : [product.service], discountPercent: isB2b ? (ctx.acct?.discount_percent ?? 0) : 0 })}
</div></section>`
    : html`<section class="page-head"><div class="wrap narrow center"><h1>${title}</h1><p class="lead">${t('hourly.err.service')}</p><p class="btn-row center"><a class="btn btn-gold" href="${u('/contact')}">${t('nav.contact')}</a></p></div></section>`;
  return page(ctx, { title, description: lead, path: `/${lang}/hourly`, body, scripts: raw(`<script src="/js/hourly.js?v=${app.assetVersion}" defer></script>`), activeNav: isB2b ? 'book' : 'tours', area: areaOf(ctx) });
}
