// Pagina «Statistiche e KPI» del pannello admin. I grafici sono SVG disegnati qui, con classi CSS
// (la CSP del sito vieta stili e script in linea): vedi public/css/admin-stats.css.
import { html, raw } from '../html.js';
import { BASES, CHANNELS, PRESETS, statsHref } from '../stats.js';
import { fmtDate, fmtMonth } from '../time.js';
import { formatMoney } from '../util.js';
import { adminLayout } from './admin.js';

// ───────────── formati ─────────────
const eur = (cents) => formatMoney(cents, 'it');
const nfInt = new Intl.NumberFormat('it-IT');
const nfDec = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
const nfSigned = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
const int = (n) => nfInt.format(n);
const dec = (n) => nfDec.format(n);
/** Una frazione (0–1) come percentuale: 0,3734 → «37,3%». */
const pct = (ratio) => `${dec(Math.round(ratio * 1000) / 10)}%`;
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`;
const dmFmt = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monFmt = new Intl.DateTimeFormat('it-IT', { month: 'short', timeZone: 'UTC' });
const atNoon = (date) => new Date(`${date}T12:00:00Z`);
const dm = (date) => dmFmt.format(atNoon(date)).replace(/\.$/, '');
const day = (date) => fmtDate(date, 'it', 'short');
const rangeText = (from, to) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);

// ───────────── piccoli pezzi ─────────────
const ICON = {
  up: html`<svg class="st-ico" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M5 1.5 9 8.5H1z"/></svg>`,
  down: html`<svg class="st-ico" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M5 8.5 1 1.5h8z"/></svg>`,
  flat: html`<svg class="st-ico" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M1.5 4.2h7v1.6h-7z"/></svg>`,
};

/**
 * Variazione rispetto al periodo precedente: freccia + testo (mai solo il colore).
 * good: 'up' se salire è un bene, 'down' se è un male, 'neutral' se non si giudica.
 */
function delta(ch, good = 'up') {
  if (!ch) return html`<span class="st-delta st-flat"><span aria-hidden="true">—</span><span class="st-sr">confronto non disponibile</span></span>`;
  let text;
  let spoken;
  if (ch.points != null) {
    text = ch.dir === 0 ? 'invariato' : `${nfSigned.format(ch.points)} pt`;
    spoken = ch.dir === 0 ? 'invariato' : `${ch.dir > 0 ? 'in aumento' : 'in calo'} di ${dec(Math.abs(ch.points))} punti percentuali`;
  } else if (ch.pct == null) {
    text = ch.fromZero ? 'nuovo' : 'invariato';
    spoken = ch.fromZero ? 'nuovo: nel periodo precedente era zero' : 'invariato (zero in entrambi i periodi)';
  } else {
    text = ch.dir === 0 ? 'invariato' : `${nfSigned.format(ch.pct)}%`;
    spoken = ch.dir === 0 ? 'invariato' : `${ch.dir > 0 ? 'in aumento' : 'in calo'} del ${dec(Math.abs(ch.pct))}%`;
  }
  const tone = ch.dir === 0 || good === 'neutral' ? (ch.dir === 0 ? 'st-flat' : 'st-neutral') : (ch.dir > 0) === (good === 'up') ? 'st-good' : 'st-bad';
  return html`<span class="st-delta ${tone}">${ch.dir > 0 ? ICON.up : ch.dir < 0 ? ICON.down : ICON.flat}<span>${text}</span><span class="st-sr"> (${spoken} rispetto al periodo precedente)</span></span>`;
}

function kpi(r, { key, label, value, good = 'up', sub = '', note = '', hero = false }) {
  return html`<div class="st-kpi ${hero ? 'st-kpi-hero' : ''}">
    <dt class="st-kpi-label">${label}</dt>
    <dd class="st-kpi-value">${value}</dd>
    ${r.period.open ? '' : html`<dd class="st-kpi-delta">${delta(r.changes[key], good)}</dd>`}
    ${sub ? html`<dd class="st-kpi-sub">${sub}</dd>` : ''}
    ${note ? html`<dd class="st-kpi-note">${note}</dd>` : ''}
  </div>`;
}

/** Barra orizzontale proporzionale (decorativa: i numeri sono nella tabella). */
function meter(ratio) {
  const w = ratio > 0 ? Math.min(100, Math.max(ratio * 100, 1.5)) : 0;
  return html`<svg class="st-meter" width="100%" height="8" aria-hidden="true" focusable="false"><rect class="st-meter-track" width="100%" height="8" rx="4"/><rect class="st-meter-fill" width="${w.toFixed(2)}%" height="8" rx="4"/></svg>`;
}

const sectionHead = (id, title, hint = '') => html`<div class="st-head"><h2 class="h-sub" id="${id}">${title}</h2>${hint ? html`<p class="muted small">${hint}</p>` : ''}</div>`;
const emptyMsg = (text = 'Nessuna prenotazione nel periodo.') => html`<p class="muted st-empty">${text}</p>`;

// ───────────── tabelle con barre ─────────────
const COLS = {
  n: { head: 'Pren.', cell: (r) => int(r.n), sub: (r) => `${int(r.n)} pren.`, sm: false },
  pax: { head: 'Pers.', cell: (r) => int(r.pax), sub: (r) => `${int(r.pax)} pers.`, sm: false },
  cents: { head: 'Venduto', cell: (r) => eur(r.cents) },
  share: { head: 'Quota', cell: (r) => pct(r.share) },
  avg: { head: 'Medio', cell: (r) => eur(r.avg), sub: (r) => `medio ${eur(r.avg)}`, sm: false },
  last: { head: 'Ultimo servizio', cell: (r) => (r.lastDate ? day(r.lastDate) : '—'), sub: (r) => (r.lastDate ? `ultimo servizio ${day(r.lastDate)}` : ''), sm: false },
};

/**
 * Tabella di un raggruppamento: nome con barra proporzionale al valore più alto e le colonne scelte.
 * Sui telefoni le colonne `sm: false` spariscono e il loro contenuto passa sotto il nome.
 * `compact`: la riga sotto il nome è sempre visibile (per le schede strette).
 */
function breakdown({ rows, labelHead, cols, total, compact = false, link = null }) {
  if (!rows.length) return emptyMsg();
  const max = rows.reduce((m, r) => Math.max(m, r.cents), 0);
  const specs = cols.map((c) => ({ ...COLS[c], key: c }));
  const subKeys = compact ? ['n', 'pax'] : specs.filter((c) => c.sm === false).map((c) => c.key);
  const subs = (r) => subKeys.map((k) => COLS[k].sub(r)).filter(Boolean);
  const hide = (c) => (c.sm === false ? 'st-hide-sm' : '');
  return html`<div class="st-wrap"><table class="st-table ${compact ? 'st-compact' : ''}">
    <thead><tr><th scope="col">${labelHead}</th>${specs.map((c) => html`<th scope="col" class="num ${hide(c)}">${c.head}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => {
      const line = subs(r);
      return html`<tr>
        <th scope="row" class="st-name">${link ? link(r) : html`<span class="st-name-text">${r.label}</span>`}${meter(max ? r.cents / max : 0)}${line.length ? html`<small class="st-subline ${compact ? 'st-subline-always' : ''}">${line.join(' · ')}</small>` : ''}</th>
        ${specs.map((c) => html`<td class="num ${hide(c)}">${c.cell(r)}</td>`)}
      </tr>`;
    })}</tbody>
    ${total ? html`<tfoot><tr><th scope="row">Totale</th>${specs.map((c) => html`<td class="num ${hide(c)}">${total[c.key] ?? ''}</td>`)}</tr></tfoot>` : ''}
  </table></div>`;
}

/** Riga dei totali: tutte le colonne con gli stessi valori del KPI «Venduto». */
const totalsOf = (rows, sold) => {
  const n = rows.reduce((a, r) => a + r.n, 0);
  const pax = rows.reduce((a, r) => a + r.pax, 0);
  const cents = rows.reduce((a, r) => a + r.cents, 0);
  return { n: int(n), pax: int(pax), cents: eur(cents), share: pct(sold ? cents / sold : 0), avg: eur(n ? Math.round(cents / n) : 0) };
};

// ───────────── grafico a colonne ─────────────
const VARIANTS = {
  narrow: { name: 'narrow', w: 320, h: 240, left: 36, right: 6, top: 20, bottom: 38, charW: 6.3 },
  wide: { name: 'wide', w: 800, h: 300, left: 48, right: 10, top: 22, bottom: 42, charW: 7.3 },
};

/** Scala «tonda» da 0 al massimo: estremo superiore e passo (in centesimi) con 3–5 intervalli. */
export function niceScale(maxCents) {
  const maxEur = Math.max(maxCents / 100, 1);
  const raw = maxEur / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const stepEur = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag);
  const step = Math.round(stepEur * 100);
  const max = Math.max(1, Math.ceil(maxCents / step)) * step;
  const ticks = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { step, max, ticks };
}

/** Importo per l'asse: «500», «1k», «2,5k» (l'unità, euro, sta nella didascalia). */
export function tickLabel(cents) {
  const eurs = cents / 100;
  return eurs >= 1000 ? `${dec(eurs / 1000)}k` : dec(eurs);
}

function bucketLabels(b, gran) {
  if (gran === 'day') return { short: dm(b.from), full: fmtDate(b.from, 'it', 'long') };
  if (gran === 'week') {
    const same = b.from === b.to;
    const sameMonth = b.from.slice(0, 7) === b.to.slice(0, 7);
    const text = same ? day(b.from) : sameMonth ? `${Number(b.from.slice(8))}–${Number(b.to.slice(8))} ${monFmt.format(atNoon(b.to)).replace(/\.$/, '')} ${b.to.slice(0, 4)}` : `${dm(b.from)} – ${dm(b.to)} ${b.to.slice(0, 4)}`;
    return { short: dm(b.from), full: `Settimana ${same ? 'del' : 'dal'} ${text}` };
  }
  if (gran === 'month') return { short: monFmt.format(atNoon(`${b.key}-15`)).replace(/\.$/, ''), full: fmtMonth(b.key, 'it') };
  return { short: b.key, full: `Anno ${b.key}` };
}

const yearOf = (b) => b.from.slice(0, 4);
const tipText = (b, label) => (b.n ? `${label}: ${eur(b.cents)} · ${plural(b.n, 'prenotazione', 'prenotazioni')} · ${plural(b.pax, 'persona', 'persone')}` : `${label}: nessuna prenotazione`);
const px = (n) => n.toFixed(1);

/** Una colonna con la parte alta arrotondata (4) e la base dritta. */
function columnPath(x, w, yTop, base) {
  const h = base - yTop;
  const r = Math.min(4, w / 2, h);
  return `M${px(x)} ${px(base)}V${px(yTop + r)}Q${px(x)} ${px(yTop)} ${px(x + r)} ${px(yTop)}H${px(x + w - r)}Q${px(x + w)} ${px(yTop)} ${px(x + w)} ${px(yTop + r)}V${px(base)}Z`;
}

/**
 * Grafico a colonne di `spec.buckets` (ognuno con n, pax, cents).
 * spec.labels[i] = { short, full } (etichetta sotto la colonna e testo del suggerimento); spec.years[i] = anno da scrivere sotto (facoltativo).
 */
function columnChart(spec, v) {
  const { buckets, labels, years = null, label } = spec;
  const maxCents = buckets.reduce((m, b) => Math.max(m, b.cents), 0);
  const { w, h, left, right, top, bottom, charW } = v;
  const plotW = w - left - right;
  const plotH = h - top - bottom;
  const base = top + plotH;
  const scale = niceScale(maxCents);
  const n = buckets.length;
  const slot = plotW / n;
  const bw = Math.max(1, Math.min(24, slot - 2)); // colonne sottili, con 2 di vuoto fra l'una e l'altra
  const yOf = (c) => base - (plotH * c) / scale.max;
  const maxChars = labels.reduce((m, l) => Math.max(m, l.short.length), 1);
  const every = Math.max(1, Math.ceil((maxChars * charW + 10) / slot)); // etichette ridotte se non c'è posto
  const peak = buckets.findIndex((b) => b.cents === maxCents);

  let lastYear = '';
  const xLabels = buckets.flatMap((b, i) => {
    if (i % every !== 0) return [];
    const cx = left + slot * i + slot / 2;
    const half = (labels[i].short.length * charW) / 2;
    const [x, anchor] = cx - half < 2 ? [2, 'start'] : cx + half > w - 2 ? [w - 2, 'end'] : [cx, 'middle'];
    const year = years?.[i] ?? '';
    const showYear = year && year !== lastYear;
    if (year) lastYear = year;
    return [html`<text x="${px(x)}" y="${px(base + 15)}" text-anchor="${anchor}">${labels[i].short}</text>${showYear ? html`<text class="st-yr" x="${px(x)}" y="${px(base + 29)}" text-anchor="${anchor}">${year}</text>` : ''}`];
  });

  const peakText = eur(maxCents);
  const peakHalf = (peakText.length * charW) / 2;
  const peakX = Math.min(Math.max(left + slot * peak + slot / 2, left + peakHalf), w - right - peakHalf);

  return html`<svg class="st-svg st-svg-${v.name}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}" focusable="false">
    <g class="st-grid" aria-hidden="true">${scale.ticks.map((t) => html`<line class="${t === 0 ? 'st-axis' : ''}" x1="${left}" x2="${w - right}" y1="${px(yOf(t))}" y2="${px(yOf(t))}" shape-rendering="crispEdges"/>`)}</g>
    <g class="st-ylab" aria-hidden="true">${scale.ticks.map((t) => html`<text x="${left - 6}" y="${px(yOf(t) + 4)}" text-anchor="end">${tickLabel(t)}</text>`)}</g>
    <g class="st-cols">${buckets.map((b, i) => html`<g class="st-col"><title>${tipText(b, labels[i].full)}</title><rect class="st-hit" x="${px(left + slot * i)}" y="${top}" width="${px(slot)}" height="${plotH}"/>${b.cents > 0 ? html`<path class="st-bar" d="${columnPath(left + slot * i + (slot - bw) / 2, bw, Math.min(yOf(b.cents), base - 2), base)}"/>` : ''}</g>`)}</g>
    <text class="st-peak" x="${px(peakX)}" y="${px(Math.max(yOf(maxCents) - 5, 11))}" text-anchor="middle" aria-hidden="true">${peakText}</text>
    <g class="st-xlab" aria-hidden="true">${xLabels}</g>
  </svg>`;
}

/** Le due versioni del grafico (telefono e schermo largo): il CSS mostra quella che sta meglio nello spazio disponibile. */
const chartPair = (spec) => html`<div class="st-chart">${columnChart(spec, VARIANTS.narrow)}${columnChart(spec, VARIANTS.wide)}</div>`;

const GRAN_IT = { day: 'giorno', week: 'settimana', month: 'mese', year: 'anno' };
const GRAN_HEAD = { day: 'Giorno', week: 'Settimana', month: 'Mese', year: 'Anno' };

function seriesSection(r) {
  const { series } = r;
  const total = series.buckets.reduce((a, b) => ({ n: a.n + b.n, pax: a.pax + b.pax, cents: a.cents + b.cents }), { n: 0, pax: 0, cents: 0 });
  const head = sectionHead('st-series', 'Andamento nel tempo', `Venduto per ${GRAN_IT[series.gran]}, in euro.`);
  if (!series.maxCents) return html`<section class="st-section" aria-labelledby="st-series">${head}<div class="card pad">${r.kpi.bookings ? emptyMsg('Le prenotazioni del periodo non hanno un importo da mostrare.') : emptyMsg()}</div></section>`;
  const labels = series.buckets.map((b) => bucketLabels(b, series.gran));
  const top = series.buckets.findIndex((b) => b.cents === series.maxCents);
  const label = `Grafico a colonne del venduto per ${GRAN_IT[series.gran]}, ${rangeText(r.period.from, r.period.to)}: totale ${eur(series.totalCents)}; il massimo è ${eur(series.maxCents)} (${labels[top].full}). I dati completi sono nella tabella qui sotto.`;
  return html`<section class="st-section" aria-labelledby="st-series">${head}
    <div class="card pad">
      <figure class="st-fig">
        ${chartPair({ buckets: series.buckets, labels, years: series.buckets.map(yearOf), label })}
        <figcaption class="muted small">Importi in euro. Passa il mouse su una colonna per il dettaglio.</figcaption>
      </figure>
      <details class="st-details"><summary>Mostra i dati in tabella</summary>
        <div class="st-wrap"><table class="st-table st-data">
          <thead><tr><th scope="col">${GRAN_HEAD[series.gran]}</th><th scope="col" class="num">Pren.</th><th scope="col" class="num">Pers.</th><th scope="col" class="num">Venduto</th></tr></thead>
          <tbody>${series.buckets.map((b, i) => html`<tr><th scope="row">${labels[i].full}</th><td class="num">${int(b.n)}</td><td class="num">${int(b.pax)}</td><td class="num">${eur(b.cents)}</td></tr>`)}</tbody>
          <tfoot><tr><th scope="row">Totale</th><td class="num">${int(total.n)}</td><td class="num">${int(total.pax)}</td><td class="num">${eur(total.cents)}</td></tr></tfoot>
        </table></div>
      </details>
    </div></section>`;
}

/** Venduto per giorno della settimana: sette colonne (da lunedì) e, sotto, la stessa cosa in tabella. */
function weekdaysSection(r) {
  const rows = r.weekdays;
  const hint = r.filters.basis === 'booking' ? 'Giorno in cui è stata fatta la prenotazione.' : 'Giorno del servizio.';
  const head = sectionHead('st-weekdays', 'Per giorno della settimana', hint);
  if (!r.kpi.bookings || !r.kpi.sold) return html`<section class="st-section" aria-labelledby="st-weekdays">${head}<div class="card pad">${emptyMsg()}</div></section>`;
  const best = rows.reduce((m, x) => (x.cents > m.cents ? x : m), rows[0]);
  const spec = {
    buckets: rows,
    labels: rows.map((x) => ({ short: x.label.slice(0, 3), full: x.label })),
    label: `Grafico a colonne del venduto per giorno della settimana (${hint.toLowerCase().replace(/\.$/, '')}): il giorno più forte è ${best.label.toLowerCase()} con ${eur(best.cents)}. I dati sono nella tabella qui sotto.`,
  };
  const t = totalsOf(rows, r.kpi.sold);
  return html`<section class="st-section" aria-labelledby="st-weekdays">${head}
    <div class="card pad">
      ${chartPair(spec)}
      <details class="st-details"><summary>Mostra i dati in tabella</summary>
        <div class="st-wrap"><table class="st-table st-data">
          <thead><tr><th scope="col">Giorno</th><th scope="col" class="num">Pren.</th><th scope="col" class="num">Venduto</th><th scope="col" class="num">Quota</th></tr></thead>
          <tbody>${rows.map((x) => html`<tr><th scope="row">${x.label}</th><td class="num">${int(x.n)}</td><td class="num">${eur(x.cents)}</td><td class="num">${pct(x.share)}</td></tr>`)}</tbody>
          <tfoot><tr><th scope="row">Totale</th><td class="num">${t.n}</td><td class="num">${t.cents}</td><td class="num">${t.share}</td></tr></tfoot>
        </table></div>
      </details>
    </div></section>`;
}

// ───────────── filtri ─────────────
const opt = (value, text, selected) => html`<option value="${value}" ${selected ? raw('selected') : ''}>${text}</option>`;

function filtersBlock(r, options) {
  const f = r.filters;
  const custom = f.preset === 'custom';
  const active = [custom, f.basis !== 'service', f.channel !== 'all', !!f.account, !!f.tour].filter(Boolean).length;
  return html`<section class="card pad st-filters" aria-labelledby="st-filters-title">
    <div class="st-filters-head">
      <h2 class="st-h" id="st-filters-title">Filtri</h2>
      <a class="btn btn-outline btn-sm" href="${statsHref(f, {}, '/admin/stats.csv')}" download>Esporta CSV</a>
    </div>
    <nav class="tabs st-presets" aria-label="Periodo">${PRESETS.map((p) => html`<a href="${statsHref(f, { preset: p.key })}" ${f.preset === p.key ? raw('aria-current="page"') : ''}>${p.label}</a>`)}</nav>
    <form method="get" action="/admin/stats" class="st-form">
      ${custom ? '' : html`<input type="hidden" name="p" value="${f.preset}">`}
      <details class="st-adv" ${active ? raw('open') : ''}>
        <summary>Periodo personalizzato e altri filtri${active ? html` <span class="chip chip-accent">${active} ${active === 1 ? 'attivo' : 'attivi'}</span>` : ''}</summary>
        <div class="st-fields">
          <label class="field"><span class="label">Dal</span><input type="date" name="from" value="${custom ? f.from : ''}" min="2000-01-01" max="2100-12-31"></label>
          <label class="field"><span class="label">Al</span><input type="date" name="to" value="${custom ? f.to : ''}" min="2000-01-01" max="2100-12-31"></label>
          <label class="field st-wide"><span class="label">Base del periodo</span><select name="basis">${BASES.map((b) => opt(b.key, b.label, f.basis === b.key))}</select></label>
          <label class="field"><span class="label">Canale</span><select name="channel">${CHANNELS.map((c) => opt(c.key, c.label, f.channel === c.key))}</select></label>
          <label class="field"><span class="label">Partner</span><select name="partner">${opt('', 'Tutti i partner', !f.account)}${options.partners.map((p) => opt(p.id, p.company, f.account === p.id))}</select></label>
          <label class="field st-wide"><span class="label">Tour</span><select name="tour">${opt('', 'Tutti i tour', !f.tour)}${options.tours.map((t) => opt(t.slug, t.title, f.tour === t.slug))}</select></label>
        </div>
        <div class="btn-row st-actions">
          <button class="btn btn-gold btn-sm" type="submit">Applica</button>
          <a class="btn btn-outline btn-sm" href="/admin/stats">Azzera i filtri</a>
        </div>
        <p class="muted small st-hint">Se indichi «Dal» e «Al», valgono al posto dei pulsanti dei periodi. L’esportazione CSV ha una riga per prenotazione (di ogni stato) con gli stessi filtri.</p>
      </details>
    </form>
  </section>`;
}

function summaryLine(r, options) {
  const f = r.filters;
  const partner = f.account ? options.partners.find((p) => p.id === f.account)?.company : null;
  const tour = f.tour ? options.tours.find((t) => t.slug === f.tour)?.title : null;
  const parts = [
    html`Periodo <strong>${rangeText(r.period.from, r.period.to)}</strong> (${plural(r.period.days, 'giorno', 'giorni')})`,
    html`calcolato sulla <strong>${f.basis === 'booking' ? 'data di prenotazione' : 'data del servizio'}</strong>`,
    f.channel !== 'all' ? html`canale <strong>${f.channel === 'b2b' ? 'partner' : 'privati'}</strong>` : '',
    partner ? html`partner <strong>${partner}</strong>` : '',
    tour ? html`tour <strong>${tour}</strong>` : '',
  ].filter(Boolean);
  const compare = r.period.prev ? html`Le variazioni confrontano con il periodo precedente di pari durata: <strong>${rangeText(r.period.prev.from, r.period.prev.to)}</strong>.` : html`Con «Tutto» non c’è un periodo precedente, quindi niente variazioni.`;
  return html`<div class="st-summary"><p>${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}</p><p class="muted small">${compare}</p></div>`;
}

// ───────────── KPI ─────────────
function kpiGroups(r) {
  const k = r.kpi;
  const none = '—';
  const subTicket = [k.bookingsB2c ? `Privati ${eur(k.avgTicketB2c)}` : 'Privati —', k.bookingsB2b ? `Partner ${eur(k.avgTicketB2b)}` : 'Partner —'].join(' · ');
  const kpis = (cards) => html`<dl class="st-kpis">${cards.map((c) => kpi(r, c))}</dl>`;
  const group = (id, title, cards) => html`<div class="st-group" role="group" aria-labelledby="${id}"><h3 class="st-group-title" id="${id}">${title}</h3>${kpis(cards)}</div>`;

  return html`<section class="st-section" aria-labelledby="st-kpi-title">
    ${sectionHead('st-kpi-title', 'Numeri del periodo', 'Prenotazioni confermate, salvo dove indicato.')}
    ${r.empty ? html`<div class="notice st-info" role="status"><strong>Nessuna prenotazione nel periodo.</strong> Prova con un altro periodo o togli qualche filtro.</div>` : ''}
    ${group('st-g-sales', 'Vendite', [
      { key: 'sold', label: 'Venduto', value: eur(k.sold), hero: true },
      { key: 'bookings', label: 'Prenotazioni', value: int(k.bookings) },
      { key: 'pax', label: 'Persone', value: int(k.pax) },
      { key: 'avgTicket', label: 'Scontrino medio', value: eur(k.avgTicket), sub: subTicket },
      { key: 'avgPerPax', label: 'Valore medio per persona', value: eur(k.avgPerPax) },
      { key: 'leadDays', label: 'Anticipo medio di prenotazione', value: k.leadDays == null ? none : `${dec(k.leadDays)} ${k.leadDays === 1 ? 'giorno' : 'giorni'}`, good: 'neutral', sub: 'fra prenotazione e servizio' },
      ...(r.filters.channel === 'all' && !r.filters.account ? [{ key: 'partnerShare', label: 'Quota partner', value: pct(k.partnerShare), good: 'neutral', sub: `${eur(k.soldB2b)} del venduto` }] : []),
    ])}
    ${group('st-g-cash', 'Incassi e sconti', [
      {
        key: 'collected', label: 'Incassato', value: eur(k.collected),
        sub: k.penaltiesKept ? `di cui ${eur(k.penaltiesKept)} trattenuti su prenotazioni annullate` : '',
        note: 'Denaro ricevuto, al netto dei rimborsi e senza la parte pagata con buoni regalo.',
      },
      { key: 'unpaid', label: 'Da incassare', value: eur(k.unpaid), good: 'neutral', note: 'Fatture e pagamenti sul posto non ancora incassati.' },
      { key: 'discount', label: 'Sconti concessi', value: eur(k.discount), good: 'neutral', sub: `${plural(k.promoBookings, 'prenotazione', 'prenotazioni')} con codice` },
      { key: 'gift', label: 'Pagato con buoni regalo', value: eur(k.gift), good: 'neutral', sub: `${plural(k.giftBookings, 'prenotazione', 'prenotazioni')}` },
    ])}
    ${group('st-g-cancel', 'Annulli', [
      { key: 'cancelled', label: 'Prenotazioni annullate', value: int(k.cancelled), good: 'down', sub: `su ${plural(k.bookings + k.cancelled, 'prenotazione', 'prenotazioni')} (confermate e annullate)` },
      { key: 'cancelRate', label: 'Tasso di annullo', value: pct(k.cancelRate), good: 'down', sub: 'annullate / (confermate + annullate)' },
      { key: 'refunds', label: 'Rimborsi', value: eur(k.refunds), good: 'neutral', sub: k.refundsFailed ? `${plural(k.refundsFailed, 'rimborso non riuscito', 'rimborsi non riusciti')}: controlla le prenotazioni` : '' },
      { key: 'penalties', label: 'Penali', value: eur(k.penalties), good: 'neutral', sub: k.penaltiesToBill ? `${eur(k.penaltiesToBill)} da fatturare · ${eur(k.penaltiesKept)} già trattenuti` : k.penalties ? 'già trattenute' : '' },
    ])}
    ${group('st-g-invoices', 'Fatturazione', [
      {
        key: 'invoiced', label: 'Fatturato emesso', value: eur(k.invoiced),
        sub: `${plural(k.invoices, 'fattura', 'fatture')} − ${plural(k.creditNotes, 'nota di credito', 'note di credito')}`,
        note: 'Dal modulo Fatture; include IVA se presente. Non segue canale, partner e tour.',
      },
    ])}
  </section>`;
}

// ───────────── raggruppamenti ─────────────
function breakdowns(r) {
  const sold = r.kpi.sold;
  const { rows: partnerRows, others } = r.partners;
  const partnerAll = { n: partnerRows.reduce((a, p) => a + p.n, others?.n ?? 0), cents: partnerRows.reduce((a, p) => a + p.cents, others?.cents ?? 0) };
  const partnerTotal = { n: int(partnerAll.n), cents: eur(partnerAll.cents), avg: eur(partnerAll.n ? Math.round(partnerAll.cents / partnerAll.n) : 0) };
  const partnerTable = !partnerRows.length
    ? emptyMsg('Nessuna prenotazione di partner nel periodo.')
    : html`${breakdown({
        rows: partnerRows,
        labelHead: 'Partner',
        cols: ['n', 'cents', 'avg', 'last'],
        total: partnerTotal,
        link: (p) => html`<a class="st-name-text" href="/admin/partners/${p.id}">${p.label}</a>`,
      })}
      ${others ? html`<p class="muted small st-more">Il totale comprende altri ${plural(others.count, 'partner', 'partner')} (${plural(others.n, 'prenotazione', 'prenotazioni')}, ${eur(others.cents)}).</p>` : ''}`;
  const small = (id, title, rows, labelHead) => html`<section class="st-section" aria-labelledby="${id}">
      ${sectionHead(id, title)}
      <div class="card pad">${breakdown({ rows, labelHead, cols: ['cents', 'share'], compact: true, total: rows.length ? totalsOf(rows, sold) : null })}</div>
    </section>`;

  return html`
  <section class="st-section" aria-labelledby="st-tours">
    ${sectionHead('st-tours', 'Per prodotto', 'Tour ordinati per venduto; la barra è relativa al più venduto.')}
    <div class="card pad">${breakdown({ rows: r.tours, labelHead: 'Tour', cols: ['n', 'pax', 'cents', 'share', 'avg'], total: r.tours.length ? totalsOf(r.tours, sold) : null })}</div>
  </section>
  <section class="st-section" aria-labelledby="st-partners">
    ${sectionHead('st-partners', 'Per partner', 'I primi 10 per venduto.')}
    <div class="card pad">${partnerTable}</div>
  </section>
  <div class="st-cols2">
    ${small('st-channels', 'Per canale', r.channels, 'Canale')}
    ${small('st-payments', 'Per metodo di pagamento', r.payments, 'Metodo')}
    ${small('st-langs', 'Per lingua del cliente', r.langs, 'Lingua')}
    ${weekdaysSection(r)}
  </div>`;
}

// ───────────── portafoglio, buoni, programmi ─────────────
function portfolioBlock(r) {
  return html`<section class="st-section" aria-labelledby="st-portfolio">
    ${sectionHead('st-portfolio', 'Portafoglio futuro', 'Già prenotato (confermate) da oggi in poi. Non dipende dai filtri.')}
    <div class="card pad"><dl class="st-tiles">${r.portfolio.map((w) => html`<div class="st-tile"><dt>Prossimi ${w.days} giorni</dt><dd class="st-tile-value">${eur(w.cents)}</dd><dd class="muted small">${plural(w.n, 'prenotazione', 'prenotazioni')} · ${plural(w.pax, 'persona', 'persone')}<br>fino al ${day(w.to)}</dd></div>`)}</dl></div>
  </section>`;
}

function giftsBlock(r) {
  const g = r.gifts;
  const promoTable = g.promos.rows.length
    ? html`<div class="st-wrap"><table class="st-table st-promos"><thead><tr><th scope="col">Codice</th><th scope="col" class="num">Usi</th><th scope="col" class="num">Sconto totale</th></tr></thead>
        <tbody>${g.promos.rows.map((p) => html`<tr><th scope="row"><span class="st-code">${p.code}</span></th><td class="num">${int(p.n)}</td><td class="num">${eur(p.cents)}</td></tr>`)}</tbody>
        ${g.promos.rows.length > 1 ? html`<tfoot><tr><th scope="row">Totale</th><td class="num">${int(g.promos.n)}</td><td class="num">${eur(g.promos.cents)}</td></tr></tfoot>` : ''}</table></div>`
    : emptyMsg('Nessun codice sconto usato nel periodo.');
  return html`<section class="st-section" aria-labelledby="st-gifts">
    ${sectionHead('st-gifts', 'Buoni regalo e codici sconto')}
    <div class="st-cols2">
      <div class="card pad">
        <h3 class="st-sub">Buoni regalo</h3>
        <dl class="st-tiles st-tiles-2">
          <div class="st-tile"><dt>Venduti nel periodo</dt><dd class="st-tile-value">${eur(g.sold.cents)}</dd><dd class="muted small">${plural(g.sold.n, 'buono', 'buoni')}${g.sold.adminN ? html`<br>${int(g.sold.webN)} online · ${int(g.sold.adminN)} dal pannello (${eur(g.sold.adminCents)})` : ''}<br>per data di attivazione</dd></div>
          <div class="st-tile"><dt>Saldo da onorare</dt><dd class="st-tile-value">${eur(g.balance.cents)}</dd><dd class="muted small">su ${plural(g.balance.n, 'buono attivo', 'buoni attivi')}: è l’impegno verso i clienti${g.expired.n ? html`<br>Scaduti: ${eur(g.expired.cents)} su ${plural(g.expired.n, 'buono', 'buoni')}` : ''}</dd></div>
        </dl>
        <p class="muted small">Vendite e saldo non dipendono dai filtri su canale, partner e tour.</p>
      </div>
      <div class="card pad">
        <h3 class="st-sub">Uso dei codici sconto</h3>
        ${promoTable}
      </div>
    </div>
  </section>`;
}

function programsBlock(r) {
  const p = r.programs;
  return html`<section class="st-section" aria-labelledby="st-programs">
    ${sectionHead('st-programs', 'Programmi di più giorni', 'Confermati o accettati, per data della prima giornata (non dipende da base e tour).')}
    <div class="card pad">${p.n
      ? html`<dl class="st-tiles">
          <div class="st-tile"><dt>Programmi</dt><dd class="st-tile-value">${int(p.n)}</dd><dd class="muted small">valore ${eur(p.cents)}</dd></div>
          <div class="st-tile"><dt>Confermati</dt><dd class="st-tile-value">${eur(p.confirmed.cents)}</dd><dd class="muted small">${plural(p.confirmed.n, 'programma', 'programmi')}</dd></div>
          <div class="st-tile"><dt>Accettati, in attesa dell’acconto</dt><dd class="st-tile-value">${eur(p.accepted.cents)}</dd><dd class="muted small">${plural(p.accepted.n, 'programma', 'programmi')} · acconti già incassati: ${eur(p.depositsPaid)}</dd></div>
        </dl>`
      : emptyMsg('Nessun programma di più giorni nel periodo.')}</div>
  </section>`;
}

function definitions() {
  const items = [
    ['Periodo e base', 'Dal primo all’ultimo giorno compresi. «Data del servizio» usa il giorno in cui si svolge il servizio; «data di prenotazione» il giorno (ora di Venezia) in cui il cliente ha prenotato.'],
    ['Venduto', 'Somma del totale delle prenotazioni confermate nel periodo, dopo gli sconti; comprende la parte pagata con buoni regalo. Le tabelle per prodotto, canale, partner, pagamento, lingua e giorno sommano sempre a questa cifra.'],
    ['Scontrino medio, valore per persona', 'Venduto diviso per le prenotazioni (o per le persone), arrotondato al centesimo.'],
    ['Incassato', 'Denaro ricevuto al netto dei rimborsi: per le confermate già pagate (carta, o segnate come incassate) il totale meno la parte coperta da buoni regalo; per le annullate dopo il pagamento, la sola quota trattenuta (importo pagato meno rimborso).'],
    ['Da incassare', 'Come sopra, per le confermate non ancora pagate (fattura, pagamento sul posto). Vale: venduto = incassato sulle confermate + da incassare + pagato con buoni regalo.'],
    ['Annulli', 'Prenotazioni annullate nel periodo (stessa base). Tasso = annullate / (confermate + annullate). Rimborsi = somma dei rimborsi; penali = somma delle quote che restano dovute, già trattenute o da fatturare.'],
    ['Fatturato emesso', 'Fatture emesse meno note di credito, per data di emissione, dal modulo Fatture (bozze e fatture scartate escluse); include l’IVA se presente.'],
    ['Anticipo medio', 'Giorni fra il giorno della prenotazione e quello del servizio, in media sulle confermate.'],
    ['Quota partner', 'Parte del venduto che arriva dal canale partner.'],
    ['Variazioni', 'Confronto con il periodo immediatamente precedente di pari durata. I tassi si confrontano in punti percentuali (pt). Verde = bene, rosso = male; le voci senza giudizio restano grigie.'],
  ];
  return html`<section class="st-section" aria-labelledby="st-defs"><h2 class="st-h" id="st-defs">Come sono calcolati i numeri</h2>
    <details class="card pad st-defs"><summary>Mostra le definizioni</summary><dl>${items.map(([t, d]) => html`<div><dt>${t}</dt><dd>${d}</dd></div>`)}</dl></details></section>`;
}

// ───────────── pagina ─────────────
/**
 * @param {object} ctx  { app, req }
 * @param {{ report: object, options: { tours: {slug,title}[], partners: {id,company}[] } }} data
 */
export function statsPage(ctx, { report: r, options }) {
  const body = html`<div class="st">
    ${r.filters.datesIgnored ? html`<div class="notice notice-err" role="alert"><strong>Le date indicate non sono valide.</strong> Servono le due date («Dal» e «Al», la prima non dopo la seconda): mostro il periodo predefinito.</div>` : ''}
    ${filtersBlock(r, options)}
    ${summaryLine(r, options)}
    ${kpiGroups(r)}
    ${seriesSection(r)}
    ${breakdowns(r)}
    ${portfolioBlock(r)}
    ${giftsBlock(r)}
    ${programsBlock(r)}
    ${definitions()}
  </div>`;
  return adminLayout(ctx, { title: 'Statistiche e KPI', active: '/admin/stats', body, styles: ['/css/admin-stats.css'] });
}
