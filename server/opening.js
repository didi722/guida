// «Pre-apertura»: finché non si possono incassare pagamenti (per esempio prima dell'apertura della partita IVA) il sito accetta
// prenotazioni senza incassare nulla online. Si imposta in Sito › Impostazioni › Regole di prenotazione › «Incassi dal».
//  - si prenota solo per date da quel giorno in poi (un servizio fatto prima non si potrebbe incassare né fatturare);
//  - ai privati si offre solo il pagamento il giorno del servizio; alle agenzie la fattura o l'opzione, mai la carta;
//  - buoni regalo e acconti dei programmi si pagano online solo dopo.
import { nowRome } from './time.js';

/** La data (AAAA-MM-GG) da cui si incassa, oppure '' se non c'è una data (incassi sempre attivi). */
export const paymentsFrom = (cfg) => (/^\d{4}-\d{2}-\d{2}$/.test(cfg?.policy?.paymentsFrom ?? '') ? cfg.policy.paymentsFrom : '');

/** Siamo prima della data degli incassi? */
export function isPreOpening(cfg, nowMs = Date.now()) {
  const from = paymentsFrom(cfg);
  return !!from && nowRome(nowMs).date < from;
}

/** Si può pagare online adesso? (Stripe, o la modalità demo, e non siamo in pre-apertura) */
export const onlinePaymentsOpen = (app, nowMs = Date.now()) => (app.payments.live || app.payments.demo) && !isPreOpening(app.cfg, nowMs);
