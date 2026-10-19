// Servizio, persone, data e ora (e, per i servizi a ore, durata) letti dai parametri di un modulo o di un indirizzo.
// Li usano il pagamento, il carrello delle agenzie e le prenotazioni dei pacchetti: le regole sono le stesse ovunque.
import { partyTotal, readParty } from './party.js';
import { hourlyQuote } from './pricing.js';
import { extraHourOptions, openTo } from './rates.js';
import { isDate, isTime } from './time.js';

/**
 * @param {object} app
 * @param {object} src `tour`, le persone (`adults`, `children`, `infants`; oppure solo `pax`, tutte adulte), `date`, `time` e, per i servizi a ore, `hours`
 *   (o `extra`: ore in più su un servizio a durata fissa) ed `earpieces`
 * @param {'b2c'|'b2b'} channel
 * @returns {{tour: object, pax: number, party: {adults: number, children: number, infants: number}, date: string, time: string, hours: number|null, earpieces: boolean, durationMin: number|null}|null}
 *   `pax` è il totale delle persone (tutte occupano un posto); null se non è valido
 */
export function readSlot(app, src, channel) {
  const tour = app.content.tour(String(src.tour ?? ''));
  const party = readParty(src, { max: tour?.maxParticipants });
  if (!tour?.active || !party || !isDate(src.date) || !isTime(src.time)) return null;
  if (!openTo(app.rates.get(), tour, channel)) return null;
  const pax = partyTotal(party);
  const p = { tour, pax, party, date: src.date, time: src.time, hours: null, earpieces: false, durationMin: null };
  if (tour.pricing === 'hourly') {
    p.hours = tour.chooseHours ? Number(src.hours) : tour.durationMin / 60;
    const extra = tour.chooseHours ? 0 : Number(src.extra) || 0; // ore extra (solo agenzie, su un servizio a durata fissa)
    if (extra) {
      if (!extraHourOptions(tour, channel).includes(extra)) return null;
      p.hours += extra;
    }
    p.earpieces = src.earpieces === '1' || src.earpieces === 'on';
    if (!hourlyQuote(app, tour, { party, channel, date: p.date, time: p.time, hours: p.hours, earpieces: p.earpieces }).ok) return null;
    p.durationMin = Math.round(p.hours * 60);
  }
  return p;
}
