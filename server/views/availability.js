// Area agenzie › Date libere: il calendario del mese di un servizio (giorni liberi, tenuti da altri, completi) e la lista d'attesa.
import { html, raw } from '../html.js';
import { LANG_META, localeOf } from '../langs.js';
import { hourOptions } from '../rates.js';
import { dayOfWeek, fmtDate, fmtInstant, fmtMonth, monthDates, nowRome } from '../time.js';
import { MAX_ACTIVE } from '../waitlist.js';
import { breadcrumbs, hoursLabel, homeCrumb } from './components.js';
import { page } from './layout.js';

/** «Cerca per data | Date libere»: i due modi di cominciare una nuova prenotazione. */
export function bookTabs(ctx, active) {
  const { t, u } = ctx;
  return html`<nav class="tabs" aria-label="${t('partner.nav.new')}"><a href="${u('/book')}" ${active === 'search' ? raw('aria-current="page"') : ''}>${t('avail.tab.search')}</a><a href="${u('/b2b/availability')}" ${active === 'free' ? raw('aria-current="page"') : ''}>${t('avail.nav')}</a></nav>`;
}

const EV = { free: 'ev-ok', held: 'ev-opt', full: 'ev-priv', mine: 'ev-prog' };
const FLASH_OK = new Set(['joined', 'removed', 'rearmed']);
const FLASH_ERR = new Set(['invalid', 'closed', 'free', 'mine', 'dup', 'limit']);

/** I parametri della pagina, per costruire gli indirizzi (mese, giorno) mantenendo servizio, persone, durata e lingua. */
const query = (v, extra = {}) => {
  const q = new URLSearchParams({ tour: v.tour.slug, pax: String(v.pax) });
  if (v.tour.chooseHours && v.hours != null) q.set('hours', String(v.hours));
  if (v.tourLang) q.set('tl', v.tourLang);
  for (const [k, val] of Object.entries(extra)) if (val) q.set(k, val);
  return q.toString();
};

function filters(ctx, v) {
  const { t, lang, u } = ctx;
  const { tours, tour, pax, hours, tourLang, month } = v;
  return html`<form class="card pad avail-form" method="get" action="${u('/b2b/availability')}">
    <label class="field"><span class="label">${t('avail.service')}</span><select name="tour" data-autosubmit>${tours.map((x) => html`<option value="${x.slug}" ${x.slug === tour.slug ? raw('selected') : ''}>${x.i18n[lang].title}</option>`)}</select></label>
    <label class="field"><span class="label">${t('s.guests')}</span><select name="pax" data-autosubmit>${Array.from({ length: tour.maxParticipants }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${n === pax ? raw('selected') : ''}>${n}</option>`)}</select></label>
    ${tour.chooseHours ? html`<label class="field"><span class="label">${t('hourly.f.hours')}</span><select name="hours" data-autosubmit>${hourOptions(tour.service).map((h) => html`<option value="${h}" ${h === hours ? raw('selected') : ''}>${hoursLabel(t, lang, h)}</option>`)}</select></label>` : ''}
    ${tour.model === 'person' && tour.languages.length > 1 ? html`<label class="field"><span class="label">${t('s.tourLang')}</span><select name="tl" data-autosubmit><option value="">${t('avail.anyLang')}</option>${tour.languages.map((l) => html`<option value="${l}" ${l === tourLang ? raw('selected') : ''}>${LANG_META[l]?.name ?? l}</option>`)}</select></label>` : ''}
    <input type="hidden" name="m" value="${month}">
    <button class="btn btn-outline" type="submit">${t('avail.show')}</button>
  </form>`;
}

function grid(ctx, v) {
  const { t, lang, u } = ctx;
  const { month, prev, next, overview, selected } = v;
  const today = nowRome().date;
  const dates = monthDates(month);
  const pad = (dayOfWeek(dates[0]) + 6) % 7; // lunedì = 0
  const dows = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + i))));
  const href = (m, d = '') => `${u('/b2b/availability')}?${query(v, { m, d })}`;
  const free = (n) => (n === 1 ? t('avail.free.one', { n }) : t('avail.free.many', { n }));
  return html`
<div class="acal-head">
  ${prev ? html`<a class="btn btn-sm btn-outline" href="${href(prev)}" aria-label="${t('partner.cal.prev')}">←</a>` : html`<span class="btn btn-sm btn-outline is-off" aria-hidden="true">←</span>`}
  <strong class="acal-title">${fmtMonth(month, lang)}</strong>
  ${next ? html`<a class="btn btn-sm btn-outline" href="${href(next)}" aria-label="${t('partner.cal.next')}">→</a>` : html`<span class="btn btn-sm btn-outline is-off" aria-hidden="true">→</span>`}
  ${month !== today.slice(0, 7) ? html`<a class="btn btn-sm btn-outline" href="${href(today.slice(0, 7))}">${t('partner.cal.today')}</a>` : html`<span class="btn btn-sm btn-outline is-ghost" aria-hidden="true">${t('partner.cal.today')}</span>`}
</div>
<div class="acal avail-grid" role="grid" aria-label="${t('avail.grid', { month: fmtMonth(month, lang) })}">
  ${dows.map((d) => html`<span class="acal-dow">${d}</span>`)}
  ${Array.from({ length: pad }, () => html`<span aria-hidden="true"></span>`)}
  ${dates.map((date) => {
    const st = overview[date];
    const cls = `acal-cell ${st ? `is-${st.state}` : 'is-none'} ${date === today ? 'is-today' : ''} ${date === selected ? 'is-selected' : ''}`;
    if (!st) return html`<span class="${cls}" aria-hidden="true"><span class="acal-n">${Number(date.slice(8))}</span></span>`;
    const counted = st.state === 'free' && !v.tour.flexible; // sui servizi a orario libero i «tanti orari» non dicono nulla: basta «libero»
    const label = st.state === 'free' ? (counted ? free(st.n) : t('avail.st.free')) : t(`avail.st.${st.state}`);
    return html`<a class="${cls}" href="${href(month, date)}#giorno" aria-label="${fmtDate(date, lang, 'weekday')}: ${label}">
      <span class="acal-n">${Number(date.slice(8))}</span>
      <span class="acal-evs"><span class="acal-ev ${EV[st.state]}">${label}</span></span>
      <span class="acal-count is-${st.state} ${counted ? '' : 'is-dot'}" aria-hidden="true">${counted ? st.n : ''}</span>
    </a>`;
  })}
</div>
<p class="small muted acal-legend"><span class="legend ev-ok"></span> ${t('avail.lg.free')} · <span class="legend ev-opt"></span> ${t('avail.lg.held')} · <span class="legend ev-priv"></span> ${t('avail.lg.full')} · <span class="legend ev-prog"></span> ${t('avail.lg.mine')} · ${t('avail.hint')}.</p>`;
}

/** Il giorno scelto: gli orari liberi con il collegamento al pagamento e, se non c'è posto, «Avvisami se si libera». */
function dayDetail(ctx, v) {
  const { t, lang, u, app } = ctx;
  const { tour, pax, hours, tourLang, selected, day, entries, here } = v;
  const queue = app.cfg.waitlist;
  if (!selected || !day) return '';
  const checkout = (time) => `${u('/book/checkout')}?tour=${encodeURIComponent(tour.slug)}&date=${selected}&time=${time}&pax=${pax}${tour.chooseHours && hours != null ? `&hours=${hours}` : ''}${tourLang ? `&tl=${tourLang}` : ''}`;
  const waiting = (time) => entries.some((e) => e.tour_slug === tour.slug && e.date === selected && (e.time ?? '') === time && e.pax === pax);
  // orari che hanno una partenza fissa ma sono occupati: ognuno si può seguire da solo
  const takenTimes = tour.flexible ? [] : day.possible.filter((p) => !day.slots.some((s) => s.time === p.time)).map((p) => p.time);
  // un avviso per «qualsiasi orario» copre già tutti gli altri
  const options = waiting('') ? [] : (day.state === 'free' ? takenTimes : ['', ...takenTimes]).filter((x) => !waiting(x));
  const canWait = (day.state === 'held' || day.state === 'full' || day.state === 'free') && options.length > 0;
  const alreadyWaiting = entries.some((e) => e.tour_slug === tour.slug && e.date === selected);
  const waitForm = html`<form class="card pad form wait-form" method="post" action="${u('/b2b/waitlist')}">
      <input type="hidden" name="tour" value="${tour.slug}"><input type="hidden" name="date" value="${selected}"><input type="hidden" name="pax" value="${pax}">
      ${tour.chooseHours && hours != null ? html`<input type="hidden" name="hours" value="${hours}">` : ''}${tourLang ? html`<input type="hidden" name="tl" value="${tourLang}">` : ''}
      <input type="hidden" name="next" value="${here}">
      <p class="muted small">${t('wl.hint')}${queue?.priorityHours ? html` ${t('wl.hintQueue', { hours: queue.priorityHours, below: queue.openBelowHours })}` : ''}</p>
      <div class="wait-row">
        ${options.length > 1 || (options.length === 1 && options[0] !== '') ? html`<label class="field"><span class="label">${t('wl.time')}</span><select name="time">${options.map((x) => html`<option value="${x}">${x || t('wl.anyTime')}</option>`)}</select></label>` : html`<input type="hidden" name="time" value="${options[0] ?? ''}">`}
        <button class="btn btn-gold" type="submit">${t('wl.cta')}</button>
      </div>
    </form>`;
  return html`<section class="agenda-day" id="giorno"><h3>${fmtDate(selected, lang)} <span class="chip">${t('avail.pax', { n: pax })}</span></h3>
    ${day.state === 'free'
      ? html`<div class="card pad"><p><strong>${t('avail.day.free')}</strong></p>
          <div class="slot-list">${day.slots.map((s) => html`<a class="slot" href="${checkout(s.time)}"><strong>${s.time}</strong>${tour.model === 'person' ? html`<small>${s.joined ? t('book.confirmedDeparture') : t('book.newDeparture')}${s.lang ? html` · ${t('w.inLang', { lang: LANG_META[s.lang]?.name ?? s.lang })}` : ''}${s.left <= 4 ? html` · ${t('w.left', { n: s.left })}` : ''}</small>` : ''}</a>`)}</div>
          ${canWait ? html`<p class="small muted">${t('avail.day.otherTimes')}</p>` : ''}</div>`
      : day.state === 'held' || day.state === 'full'
        ? html`<div class="card pad"><p>${t(`avail.day.${day.state}`)}</p></div>`
        : day.state === 'mine'
          ? html`<div class="card pad"><p>${t('avail.day.mine')} <a href="${u('/b2b/bookings')}">${t('partner.nav.bookings')}</a></p></div>`
          : html`<div class="card pad"><p class="muted">${t('avail.day.none')}</p></div>`}
    ${alreadyWaiting && day.state !== 'mine' ? html`<p class="notice notice-info" role="status">${t('wl.already')}</p>` : ''}
    ${canWait ? waitForm : ''}
  </section>`;
}

/** Dove si è in coda: chi aspetta sa se è la prima, quante agenzie ha davanti, e chi è stata avvisata per prima fino a quando ha il vantaggio. */
function queueNote(t, lang, e) {
  const q = e.queue;
  if (!q?.exclusive) return '';
  if (e.status === 'notified') return q.until ? html`<small class="muted">${t('wl.q.advantage', { when: fmtInstant(q.until, lang) })}</small>` : '';
  return html`<small class="muted">${q.ahead ? t('wl.q.ahead', { n: q.ahead }) : q.behind ? t('wl.q.first') : ''}</small>`;
}

/** «La mia lista d'attesa»: le date che l'agenzia segue, con lo stato e i pulsanti per toglierle o riattivarle. */
function waitlist(ctx, v) {
  const { t, lang, u, app } = ctx;
  const { entries, here } = v;
  const title = (e) => app.content.tour(e.tour_slug)?.i18n[lang]?.title ?? e.tour_slug;
  const row = (e) => {
    const [, mm, dd] = e.date.split('-');
    const notified = e.status === 'notified';
    const search = `${u('/book')}?date=${e.date}&pax=${e.pax}&tour=${encodeURIComponent(e.tour_slug)}`;
    const post = (action, label, cls = 'btn-outline') => html`<form method="post" action="${u(`/b2b/waitlist/${e.id}/${action}`)}"><input type="hidden" name="next" value="${here}"><button class="btn btn-sm ${cls}" type="submit">${label}</button></form>`;
    return html`<div class="agenda-item wait-item">
      <span class="agenda-time"><strong>${dd}/${mm}</strong><small>${e.date.slice(0, 4)}</small></span>
      <span class="agenda-main"><strong>${title(e)}</strong><small>${fmtDate(e.date, lang, 'weekday')} · ${e.time ?? t('wl.anyTime')} · ${t('avail.pax', { n: e.pax })}${e.hours != null && app.content.tour(e.tour_slug)?.chooseHours ? ` · ${hoursLabel(t, lang, e.hours)}` : ''}${e.tour_lang ? ` · ${LANG_META[e.tour_lang]?.name ?? e.tour_lang}` : ''}</small></span>
      <span class="agenda-state"><span class="wait-status"><span class="chip ${notified ? 'chip-ok' : 'chip-warn'}">${notified ? t('wl.st.notified', { when: fmtDate(nowRome(Date.parse(e.notified_at)).date, lang, 'short') }) : t('wl.st.waiting')}</span>${queueNote(t, lang, e)}</span>
        <span class="wait-actions">${notified ? html`<a class="btn btn-sm btn-gold" href="${search}">${t('wl.book')}</a>${post('rearm', t('wl.rearm'))}` : ''}${post('remove', t('wl.remove'))}</span></span>
    </div>`;
  };
  return html`<h2 class="h-sub spaced" id="lista">${t('wl.title')} <span class="muted small">(${entries.length}/${MAX_ACTIVE})</span></h2>
    ${entries.length ? html`<p class="muted small">${t('wl.lead')}</p><div class="card">${entries.map(row)}</div>` : html`<p class="muted">${t('wl.empty')}</p>`}`;
}

/**
 * @param {object} v
 * @param {object[]} v.tours servizi prenotabili dall'agenzia; `tour` quello scelto (null se non ce ne sono)
 * @param {number} v.pax persone; `hours` durata (servizi a ore); `tourLang` lingua voluta
 * @param {string} v.month AAAA-MM; `prev`/`next` mesi vicini ('' se non si può andare oltre)
 * @param {object} v.overview giorno → { state, n }
 * @param {string|null} v.selected giorno scelto; `day` il suo dettaglio ({state, slots, possible})
 * @param {object[]} v.entries avvisi attivi dell'agenzia; `here` l'indirizzo di questa pagina (per tornarci dopo un invio)
 */
export function availabilityPage(ctx, v) {
  const { t, lang, u } = ctx;
  const flash = v.flash?.startsWith('err-') && FLASH_ERR.has(v.flash.slice(4)) ? { err: t(`wl.err.${v.flash.slice(4)}`, { max: MAX_ACTIVE }) } : FLASH_OK.has(v.flash) ? { ok: t(`wl.flash.${v.flash}`) } : null;
  const body = html`
<section class="page-head"><div class="wrap">
  ${breadcrumbs(ctx, [homeCrumb(ctx), [t('avail.title')]])}
  <h1>${t('avail.title')}</h1><p class="lead">${t('avail.lead')}</p>
</div></section>
<section class="section tight"><div class="wrap">
  ${bookTabs(ctx, 'free')}
  ${flash?.ok ? html`<div class="notice notice-ok" role="status">${flash.ok}</div>` : ''}${flash?.err ? html`<div class="notice notice-err" role="alert">${flash.err}</div>` : ''}
  ${v.tour
    ? html`${filters(ctx, v)}${grid(ctx, v)}${dayDetail(ctx, v)}`
    : html`<div class="card pad empty"><p>${t('avail.none')}</p></div>`}
  ${waitlist(ctx, v)}
</div></section>`;
  return page(ctx, { title: t('avail.title'), path: `/${lang}/b2b/availability`, body, noindex: true, activeNav: 'book', area: 'partner' });
}
