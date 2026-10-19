// Il modulo delle condizioni di annullo a scaglioni (pannello): tre righe «fino a N giorni/ore prima: rimborso X%», con i modelli.
// Lo usano la scheda del partner (campi h1, u1, r1…) e i periodi (privati: c_h1…, agenzie: a_h1…).
import { html, raw } from '../html.js';

/** Modelli: [numero, unità (d = giorni, h = ore), rimborso %] per riga. */
export const PRESETS = [
  ['Standard (3 giorni)', [[3, 'd', 100]]],
  ['Flessibile (24 ore)', [[24, 'h', 100]]],
  ['Intermedia (7 giorni 100% · 3 giorni 50%)', [[7, 'd', 100], [3, 'd', 50]]],
  ['Rigida (14 giorni 100% · 7 giorni 50%)', [[14, 'd', 100], [7, 'd', 50]]],
];

/** Le righe: `rows` = [{ value, unit, refund }]; `prefix` = l'inizio del nome dei campi (vuoto per la scheda del partner). */
export const tierRowsHtml = (rows, prefix = '') => html`<div class="tier-rows">${rows.map((row, i) => html`<div class="tier-row"><span class="muted">Fino a</span>
    <input name="${prefix}h${i + 1}" inputmode="numeric" value="${row.value}" aria-label="Preavviso, scaglione ${i + 1}" class="tier-num">
    <select name="${prefix}u${i + 1}" aria-label="Unità"><option value="d" ${row.unit === 'd' ? raw('selected') : ''}>giorni</option><option value="h" ${row.unit === 'h' ? raw('selected') : ''}>ore</option></select>
    <span class="muted">prima dell'inizio: rimborso</span>
    <input name="${prefix}r${i + 1}" inputmode="numeric" value="${row.refund}" aria-label="Rimborso, scaglione ${i + 1}" class="tier-num"><span>%</span></div>`)}</div>`;

/** I pulsanti dei modelli: riempiono le righe con lo stesso prefisso (vedi public/js/admin-partner.js). `clearLabel`: cosa fa «svuota». */
export const presetButtons = (prefix = '', clearLabel = 'Svuota') => html`${PRESETS.map(([label, preset]) => html`<button class="btn btn-outline btn-sm" type="button" data-preset="${JSON.stringify(preset)}" data-prefix="${prefix}">${label}</button> `)}<button class="btn btn-outline btn-sm" type="button" data-preset="[]" data-prefix="${prefix}">${clearLabel}</button>`;
