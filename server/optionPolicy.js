// Opzioni delle agenzie: la data resta trattenuta (senza pagare) fino a una scadenza, poi si libera da sola.
// Qui solo le regole, senza database né rete: quanto dura un'opzione in base a quanto manca al servizio (tabella modificabile dal
// pannello, Sito › Impostazioni › Opzioni per le agenzie) e alle condizioni dedicate a ogni partner.
import { periodOn } from './periods.js';
import { freeHoursOf, mergeTiers } from './policy.js';
import { nowRome } from './time.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** «Se il tour è fra almeno N giorni, l'opzione dura D giorni»: punto di partenza, si cambia dal pannello. */
export const DEFAULT_OPTION_TIERS = [
  { fromDays: 60, days: 14 },
  { fromDays: 30, days: 10 },
  { fromDays: 14, days: 5 },
  { fromDays: 7, days: 3 },
  { fromDays: 3, days: 1 },
];
export const MAX_OPTION_TIERS = 5;

/** Righe valide della tabella, dalla più lontana alla più vicina. */
export function normalizeOptionTiers(rows) {
  const out = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ fromDays: Number(r?.fromDays), days: Number(r?.days) }))
    .filter((r) => Number.isInteger(r.fromDays) && r.fromDays >= 0 && r.fromDays <= 730 && Number.isInteger(r.days) && r.days >= 1 && r.days <= 90)
    .sort((a, b) => b.fromDays - a.fromDays);
  return out.slice(0, MAX_OPTION_TIERS);
}

/** Del periodo si porta dietro solo ciò che serve a spiegarlo (nome e regola), per le pagine e i messaggi. */
const brief = (p) => (p ? { id: p.id, name: p.name, mode: p.optionsMode } : null);

/**
 * Può questo partner opzionare un servizio che inizia a `startMs`, e fino a quando?
 * - la durata viene dalla tabella (secondo quanto manca al servizio), oppure è quella fissa scelta per il partner (`option_days`);
 * - non supera mai il momento che lascia `minReleaseHours` ore prima del servizio: la data deve potersi rivendere;
 * - se la tabella non ha una riga per un servizio così vicino, non si può opzionare (si prenota direttamente), salvo durata fissa del partner;
 * - se la data del servizio cade in un periodo con regole particolari (`options.periods`): niente opzioni, oppure opzioni più brevi
 *   (durata massima e/o scadenza più lontana dal servizio). Vale anche per le durate fisse dei partner.
 * @param {{enabled: boolean, tiers: Array, minReleaseHours: number, periods?: Array}} options configurazione del sito
 * @returns {{ok: true, expiresMs: number, days: number, capped: boolean (più breve del solito), period: object|null} | {ok: false, reason: 'disabled'|'tooClose'|'period', period?: object}}
 */
export function optionWindow({ options, account = null, startMs, nowMs }) {
  if (!options?.enabled || account?.options_enabled === 0) return { ok: false, reason: 'disabled' };
  const period = periodOn(options.periods, nowRome(startMs).date);
  if (period?.optionsMode === 'off') return { ok: false, reason: 'period', period: brief(period) };
  const short = period?.optionsMode === 'short' ? period : null;
  const fixed = Number(account?.option_days) > 0 ? Number(account.option_days) : null;
  const leadDays = (startMs - nowMs) / DAY;
  const tier = normalizeOptionTiers(options.tiers).find((t) => leadDays >= t.fromDays);
  if (!tier && !fixed) return { ok: false, reason: 'tooClose' };
  const usual = nowMs + (fixed ?? tier.days) * DAY; // quanto durerebbe fuori da ogni periodo
  const wanted = short?.optionMaxDays != null ? Math.min(usual, nowMs + short.optionMaxDays * DAY) : usual;
  const releaseHours = Math.max(0, Number(options.minReleaseHours) || 0, short?.optionReleaseHours ?? 0);
  const latest = startMs - releaseHours * HOUR;
  const expiresMs = Math.min(wanted, latest);
  if (expiresMs - nowMs < HOUR) return { ok: false, reason: 'tooClose' };
  return { ok: true, expiresMs, days: Math.round(((expiresMs - nowMs) / DAY) * 10) / 10, capped: expiresMs < usual, period: brief(short) };
}

/** Quante opzioni può tenere aperte insieme un partner (0 = nessun limite). */
export const maxActiveOptions = (options, account) => {
  const own = account?.option_max;
  return Number.isInteger(own) && own >= 0 ? own : Math.max(0, Number(options?.maxActive) || 0);
};

/**
 * Quando mandare il promemoria di scadenza: `reminderHours` prima, ma solo se l'opzione dura abbastanza da non scattare subito
 * (un'opzione di un giorno appena creata non ha bisogno di un promemoria).
 * @returns {number|null} istante in ms
 */
export function reminderAt({ createdMs, expiresMs, reminderHours }) {
  const h = Number(reminderHours) || 0;
  if (h <= 0 || expiresMs - createdMs <= (h + 2) * HOUR) return null;
  return expiresMs - h * HOUR;
}

/**
 * Prenotazione ferma di un'agenzia per una data lontana: per spingere a opzionare (che non impegna) invece di prenotare e poi
 * dimenticarsi di annullare, liberando la data solo all'ultimo. Se il servizio è fra più di `firmFromDays` giorni, la cancellazione
 * gratuita vale solo per `firmGraceHours` ore dalla prenotazione; poi si rimborsa `firmRefundPercent`% fino al normale termine
 * gratuito (e dopo valgono, come sempre, gli scaglioni successivi). Vale anche quando un'opzione si conferma: da quel momento.
 * Gli scaglioni che ne risultano sono già ripuliti (due «50%» di fila diventano uno solo, fino all'ultima scadenza):
 * `refundPercent` e `normalUntilMs` sono quelli del primo scaglione dopo la cancellazione gratuita, `more` dice se ne seguono altri.
 * @returns {{ tiers: Array, applied: boolean, graceUntilMs?: number, refundPercent?: number, normalUntilMs?: number, more?: boolean }}
 */
export function firmTiers({ options, tiers, startMs, nowMs }) {
  const none = { tiers, applied: false };
  const grace = Number(options?.firmGraceHours);
  if (!options?.firmEnabled || !(grace > 0) || (startMs - nowMs) / DAY < (Number(options.firmFromDays) || 0)) return none;
  const freeH = freeHoursOf(tiers);
  if (!freeH) return none;
  const graceUntilMs = nowMs + grace * HOUR;
  const graceH = (startMs - graceUntilMs) / HOUR;
  if (graceH <= freeH) return none;
  const rest = tiers.filter((t) => t.refund < 100).sort((a, b) => b.hours - a.hours);
  const partial = Math.min(99, Math.max(Number(options.firmRefundPercent) || 0, rest[0]?.refund ?? 0));
  const out = mergeTiers([{ hours: graceH, refund: 100 }, ...(partial > 0 ? [{ hours: freeH, refund: partial }] : []), ...rest]);
  const next = out[1];
  return { tiers: out, applied: true, graceUntilMs: startMs - graceH * HOUR, refundPercent: next?.refund ?? 0, normalUntilMs: next ? startMs - next.hours * HOUR : startMs - freeH * HOUR, more: out.length > 2 };
}
