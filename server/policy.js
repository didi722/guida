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

/** Politica in vigore per un servizio: dei partner (B2B) oppure dei privati (ore del tour o predefinite). */
export function policyFor(cfg, tour, channel, account = null) {
  if (channel === 'b2b') return accountTiers(cfg, account);
  return singleTier(tour?.cancelHours ?? cfg.policy.b2cFreeCancelHours);
}

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
