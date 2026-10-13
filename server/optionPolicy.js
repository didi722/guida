// Opzioni delle agenzie: la data resta trattenuta (senza pagare) fino a una scadenza, poi si libera da sola.
// Qui solo le regole, senza database né rete: quanto dura un'opzione in base a quanto manca al servizio (tabella modificabile dal
// pannello, Sito › Impostazioni › Opzioni per le agenzie) e alle condizioni dedicate a ogni partner.
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

/**
 * Può questo partner opzionare un servizio che inizia a `startMs`, e fino a quando?
 * - la durata viene dalla tabella (secondo quanto manca al servizio), oppure è quella fissa scelta per il partner (`option_days`);
 * - non supera mai il momento che lascia `minReleaseHours` ore prima del servizio: la data deve potersi rivendere;
 * - se la tabella non ha una riga per un servizio così vicino, non si può opzionare (si prenota direttamente), salvo durata fissa del partner.
 * @param {{enabled: boolean, tiers: Array, minReleaseHours: number}} options configurazione del sito
 * @returns {{ok: true, expiresMs: number, days: number, capped: boolean} | {ok: false, reason: 'disabled'|'tooClose'}}
 */
export function optionWindow({ options, account = null, startMs, nowMs }) {
  if (!options?.enabled || account?.options_enabled === 0) return { ok: false, reason: 'disabled' };
  const fixed = Number(account?.option_days) > 0 ? Number(account.option_days) : null;
  const leadDays = (startMs - nowMs) / DAY;
  const tier = normalizeOptionTiers(options.tiers).find((t) => leadDays >= t.fromDays);
  if (!tier && !fixed) return { ok: false, reason: 'tooClose' };
  const wanted = nowMs + (fixed ?? tier.days) * DAY;
  const latest = startMs - Math.max(0, Number(options.minReleaseHours) || 0) * HOUR;
  const expiresMs = Math.min(wanted, latest);
  if (expiresMs - nowMs < HOUR) return { ok: false, reason: 'tooClose' };
  return { ok: true, expiresMs, days: Math.round(((expiresMs - nowMs) / DAY) * 10) / 10, capped: expiresMs < wanted };
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
