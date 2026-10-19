// Politica di annullo a scaglioni: «fino a N ore prima rimborso X%». Dopo l'ultimo scaglione non si rimborsa nulla.
// I partner possono averne una propria (admin → Partner); la prenotazione ne conserva una copia, così le modifiche successive non la cambiano.
const HOUR = 3600_000;
export const MAX_TIERS = 3;
export const MAX_HOURS = 2000;

/**
 * Toglie gli scaglioni che non aggiungono nulla: se quello più vicino al servizio rimborsa la stessa percentuale, quello più lontano
 * è già compreso (due righe «50%» di fila significano solo «50% fino all'ultima»). Dal più lontano al più vicino.
 */
export function mergeTiers(tiers) {
  const sorted = [...tiers].sort((a, b) => b.hours - a.hours);
  return sorted.filter((t, i) => sorted[i + 1]?.refund !== t.refund);
}

/** Scaglioni validi, dal più lontano al più vicino: [{ hours, refund }] con refund da 1 a 100. */
export function parseTiers(json) {
  if (!json) return null;
  try {
    const rows = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(rows)) return null;
    const tiers = rows
      .map((r) => ({ hours: Number(r?.hours), refund: Number(r?.refund) }))
      .filter((r) => Number.isFinite(r.hours) && r.hours >= 0 && Number.isFinite(r.refund) && r.refund > 0 && r.refund <= 100);
    return tiers.length ? mergeTiers(tiers) : null;
  } catch {
    return null;
  }
}

/**
 * Controlla le righe inserite nel pannello. Righe vuote ignorate; il rimborso non può aumentare avvicinandosi al servizio.
 * @returns {{ tiers: Array|null, error: string|null }}  tiers = null significa «usa il predefinito del sito»
 */
export function validateTiers(rows) {
  const tiers = [];
  for (const r of rows) {
    const blankHours = r.hours === '' || r.hours == null;
    const blankRefund = r.refund === '' || r.refund == null;
    if (blankHours && blankRefund) continue;
    const hours = Number(String(r.hours).replace(',', '.'));
    const refund = Number(String(r.refund).replace(',', '.'));
    if (blankHours || blankRefund || !Number.isInteger(hours) || hours < 0 || hours > MAX_HOURS) return { tiers: null, error: 'hours' };
    if (!Number.isInteger(refund) || refund < 0 || refund > 100) return { tiers: null, error: 'refund' };
    if (refund > 0) tiers.push({ hours, refund }); // 0% è già ciò che succede dopo l'ultimo scaglione
  }
  tiers.sort((a, b) => b.hours - a.hours);
  if (tiers.length > MAX_TIERS) return { tiers: null, error: 'count' };
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].hours === tiers[i - 1].hours) return { tiers: null, error: 'duplicate' };
    if (tiers[i].refund > tiers[i - 1].refund) return { tiers: null, error: 'order' };
  }
  return { tiers: tiers.length ? mergeTiers(tiers) : null, error: null };
}

export const singleTier = (hours) => [{ hours: Math.max(0, Number(hours) || 0), refund: 100 }];

/** Scaglioni per un partner: i suoi; altrimenti le ore singole di un tempo; altrimenti il predefinito B2B del sito. */
export function accountTiers(cfg, account) {
  return parseTiers(account?.cancel_policy_json) ?? (account?.cancel_hours != null ? singleTier(account.cancel_hours) : singleTier(cfg.policy.b2bFreeCancelHours));
}

/** Il partner ha una politica di annullo propria (scaglioni o ore singole)? */
export const hasOwnPolicy = (account) => !!(account?.cancel_policy_json || account?.cancel_hours != null);

/** Il periodo con regole particolari che contiene una data del servizio (la lista sta in `cfg.options.periods`, vedi periods.js). */
const periodAt = (cfg, date) => (date ? (cfg.options?.periods ?? []).find((p) => p.from <= date && date <= p.to) ?? null : null);

/**
 * Politica in vigore per un servizio: dei partner (B2B) oppure dei privati (ore del tour o predefinite).
 * Se la data del servizio cade in un periodo con condizioni di annullo proprie, valgono quelle (per le agenzie con una politica propria solo se il
 * periodo lo dice), qualunque sia il giorno in cui si prenota.
 */
export function policyFor(cfg, tour, channel, account = null, date = null) {
  const period = periodAt(cfg, date);
  if (channel === 'b2b') {
    if (period?.cancelB2b && (!hasOwnPolicy(account) || period.cancelPartners)) return period.cancelB2b;
    return accountTiers(cfg, account);
  }
  return period?.cancelB2c ?? singleTier(tour?.cancelHours ?? cfg.policy.b2cFreeCancelHours);
}

/** Il periodo le cui condizioni di annullo valgono per questo servizio, o null (per dirlo a chi prenota). */
export function cancelPeriodFor(cfg, tour, channel, account, date) {
  const period = periodAt(cfg, date);
  if (!period) return null;
  const special = channel === 'b2b' ? period.cancelB2b && (!hasOwnPolicy(account) || period.cancelPartners) : period.cancelB2c;
  return special ? period : null;
}

/** Ore → numero e unità per il modulo: 72 → 3 giorni, 36 → 36 ore. */
export const splitHours = (h) => (h >= 48 && h % 24 === 0 ? { value: h / 24, unit: 'd' } : { value: h, unit: 'h' });

/**
 * Le righe di un modulo di scaglioni, come sono state scritte: i campi si chiamano `${prefix}h1` (numero), `${prefix}u1` (d = giorni, h = ore),
 * `${prefix}r1` (rimborso %), fino a MAX_TIERS.
 * @returns {{ value: string, unit: 'd'|'h', refund: string }[]}
 */
export const tierInput = (body, prefix = '') =>
  Array.from({ length: MAX_TIERS }, (_, i) => ({ value: String(body?.[`${prefix}h${i + 1}`] ?? '').trim(), unit: body?.[`${prefix}u${i + 1}`] === 'd' ? 'd' : 'h', refund: String(body?.[`${prefix}r${i + 1}`] ?? '').trim() }));

/** Le righe scritte → quelle che vuole `validateTiers` (il preavviso in ore). */
export const tierRows = (input) => input.map((r) => ({ hours: String(r.value ?? '').trim() === '' ? '' : Number(String(r.value).replace(',', '.')) * (r.unit === 'd' ? 24 : 1), refund: String(r.refund ?? '').trim() }));

/** Scaglioni salvati → righe da mostrare nel modulo (le righe in più restano vuote). */
export const tierInputOf = (tiers) => Array.from({ length: MAX_TIERS }, (_, i) => (tiers?.[i] ? { ...splitHours(tiers[i].hours), refund: tiers[i].refund } : { value: '', unit: 'd', refund: '' }));

/** I messaggi (per il pannello) di ciò che `validateTiers` può rifiutare. */
export const TIER_ERRORS = {
  hours: `Controlla le ore: numeri interi da 0 a ${MAX_HOURS} (con «giorni» ×24), e il rimborso va indicato per ogni riga.`,
  refund: 'Il rimborso è una percentuale intera da 0 a 100.',
  duplicate: 'Due scaglioni hanno lo stesso preavviso.',
  order: 'Il rimborso non può aumentare avvicinandosi al servizio: più si è vicini, meno si rimborsa.',
  count: `Al massimo ${MAX_TIERS} scaglioni.`,
};

/** Ore di preavviso entro cui l'annullo è gratuito (rimborso totale); 0 se non c'è un periodo gratuito. */
export const freeHoursOf = (tiers) => tiers.filter((t) => t.refund === 100).reduce((m, t) => Math.max(m, t.hours), 0);
export const hasFreeTier = (tiers) => tiers.some((t) => t.refund === 100);

/** Percentuale di rimborso se si annulla a `nowMs` un servizio che inizia a `startMs`. */
export function refundPercentAt(tiers, startMs, nowMs) {
  if (nowMs >= startMs) return 0;
  for (const t of tiers) if (nowMs <= startMs - t.hours * HOUR) return t.refund;
  return 0;
}

/** Scadenze degli scaglioni per un servizio che inizia a `startMs`: [{ until (ms), refund, hours }]. */
export const deadlines = (tiers, startMs) => tiers.map((t) => ({ ...t, until: startMs - t.hours * HOUR }));

/** Quanto resta dovuto e quanto si rimborsa annullando con la percentuale `percent` (importo `paid` già incassato oppure `due` ancora da incassare). */
export function splitAmounts({ paidCents, dueCents }, percent) {
  const base = paidCents > 0 ? paidCents : dueCents;
  const refund = paidCents > 0 ? Math.round((paidCents * percent) / 100) : 0;
  const retained = Math.max(0, base - Math.round((base * percent) / 100));
  return { refundCents: refund, retainedCents: paidCents > 0 ? paidCents - refund : retained };
}
