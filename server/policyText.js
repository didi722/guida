// Frasi che descrivono gli scaglioni di annullo (pagine, email, PDF), nella lingua del cliente.
import { fmtInstant } from './time.js';
import { deadlines } from './policy.js';

/** Politica «semplice»: un solo termine con rimborso totale (quella dei privati e di quasi tutti i partner). */
export const isSimplePolicy = (tiers) => tiers.length === 1 && tiers[0].refund === 100;

/** Una frase per scaglione, con le date calcolate per un servizio che inizia a startMs, più «dopo: nessun rimborso». */
export function tierSentences(t, lang, tiers, startMs) {
  const out = deadlines(tiers, startMs).map((d) => (d.refund === 100 ? t('policy.tierFull', { until: fmtInstant(d.until, lang) }) : t('policy.tier', { percent: d.refund, until: fmtInstant(d.until, lang) })));
  out.push(t('policy.rest'));
  return out;
}

/** Come sopra ma con le ore di preavviso invece delle date (pagine del partner). */
export function tierSentencesHours(t, tiers, fmtHours) {
  return [...tiers.map((x) => (x.refund === 100 ? t('policy.tierHoursFull', { when: fmtHours(t, x.hours) }) : t('policy.tierHours', { percent: x.refund, when: fmtHours(t, x.hours) }))), t('policy.rest')];
}
