// Tariffe a ore: servizio guida, assistente in loco, tour leader e meet & greet, con i supplementi
// (festivo, superfestivo, notturno, auricolari). Il calcolo è puro (nessun database, nessuna rete) e testato;
// le cifre si modificano dal pannello (Sito › Tariffe a ore) e stanno nelle impostazioni, chiave `rate_card`.
import { getSetting, setSetting } from './db.js';
import { localeOf } from './langs.js';
import { addDays, dayOfWeek, isTime, toMin } from './time.js';
import { parseEuros } from './util.js';

export const SERVICES = ['guide', 'assistant', 'leader', 'meetgreet'];
/** Le ore comprese in ogni scaglione (fisse): il pannello cambia i prezzi, non gli scaglioni. */
export const BRACKETS = { guide: [2, 4, 8], assistant: [2, 4, 8], leader: [4, 8], meetgreet: [1] };
export const MAX_HOURS = 8;
export const HOUR_STEP = 0.5;

/**
 * Cifre iniziali (centesimi). Riferimenti: tariffe di singole guide a Venezia (80-85 €/h), di un'associazione di guide (125 €/h,
 * ora extra 150 €, festivi +20%, auricolari 4 € a persona da 8 persone) e di un coordinatore/assistente (meet & greet 55 €,
 * 4 h 120 €, 8 h 220 €, ora extra 35 €, notturno +30%). Il listino agenzie è leggermente sotto le singole guide (nuova guida),
 * quello al pubblico è circa +25%. Sono un punto di partenza: si cambiano dal pannello.
 */
export const DEFAULT_RATES = {
  services: {
    guide: { public: { prices: [20000, 38000, 70000], extra: 9000 }, b2b: { prices: [16000, 30000, 56000], extra: 7000 } },
    assistant: { b2b: { prices: [8000, 11000, 20000], extra: 3200 } },
    leader: { b2b: { prices: [14000, 25000], extra: 3600 } },
    meetgreet: { b2b: { prices: [5000], extra: 3000 } },
  },
  surcharges: { festivoPct: 20, superFestivoPct: 50, nightPct: 30, nightFrom: '20:00', nightTo: '07:00', earpieceCents: 400, earpieceFromPax: 8 },
  days: { sundays: true, holidays: '01-06 04-25 05-01 06-02 08-15 11-01 12-08 12-26 pasquetta', superHolidays: '12-25 01-01 pasqua' },
};

const isInt = (n) => Number.isInteger(n);
const clone = (x) => structuredClone(x);
export const roundEuro = (cents) => Math.round(cents / 100) * 100;
/** Il prezzo scontato di un partner si arrotonda sempre al multiplo di 5 € successivo (per eccesso): cifre pulite, nessun centesimo. */
export const DISCOUNT_STEP_CENTS = 500;
/**
 * Prezzo (centesimi) dopo lo sconto percentuale di un partner: arrotondato per eccesso al multiplo di 5 €, senza mai superare il prezzo non scontato
 * (su un prezzo piccolo, per esempio 28 € a persona, con uno sconto del 10% si resta a 28 €: 25,20 € salirebbe a 30 €).
 * Senza sconto il prezzo resta com'è scritto nel listino.
 * Lo sconto di un partner si calcola sulle TARIFFE B2B (i tour B2B hanno un solo prezzo, quello per le agenzie): vedi partnerRate e unitPriceFor.
 */
export function applyPartnerDiscount(cents, discountPercent) {
  const d = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  if (!(d > 0) || !(cents > 0)) return cents;
  const exact = (cents * (10000 - Math.round(d * 100))) / 10000; // sconti a passi di 0,01%: si calcola con interi per non perdere centesimi
  return Math.max(0, Math.min(cents, Math.ceil(exact / DISCOUNT_STEP_CENTS - 1e-9) * DISCOUNT_STEP_CENTS));
}

// ───────────── giorni festivi ─────────────
/** Domenica di Pasqua (calendario gregoriano) come 'YYYY-MM-DD'. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const DAY_TOKEN = /^(\d{2})-(\d{2})$/;
/** «12-25 01-01 pasqua» → { tokens, invalid }: giorni fissi (MM-GG) e le parole «pasqua» e «pasquetta». */
export function parseDayList(text) {
  const tokens = [];
  const invalid = [];
  for (const raw of String(text ?? '').toLowerCase().split(/[\s,;]+/)) {
    if (!raw) continue;
    const m = DAY_TOKEN.exec(raw);
    if (raw === 'pasqua' || raw === 'pasquetta') tokens.push(raw);
    else if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12 && Number(m[2]) >= 1 && Number(m[2]) <= new Date(Date.UTC(2024, Number(m[1]), 0)).getUTCDate()) tokens.push(raw);
    else invalid.push(raw);
  }
  return { tokens: [...new Set(tokens)], invalid };
}

const matches = (tokens, date) => {
  const year = Number(date.slice(0, 4));
  for (const t of tokens) {
    if (t === 'pasqua' ? easterSunday(year) === date : t === 'pasquetta' ? addDays(easterSunday(year), 1) === date : t === date.slice(5)) return true;
  }
  return false;
};

/** 'superfestivo' | 'festivo' | 'feriale' per una data (le domeniche sono festive se così impostato). */
export function dayClass(date, rates) {
  if (matches(parseDayList(rates.days.superHolidays).tokens, date)) return 'superfestivo';
  if ((rates.days.sundays && dayOfWeek(date) === 0) || matches(parseDayList(rates.days.holidays).tokens, date)) return 'festivo';
  return 'feriale';
}

/** Minuti del servizio che cadono nella fascia notturna (che può attraversare la mezzanotte: es. 20:00-07:00). */
export function nightMinutes(startMin, durationMin, from, to) {
  if (from === to) return 0;
  const end = startMin + durationMin;
  const windows = from < to ? [[from, to], [1440 + from, 1440 + to]] : [[0, to], [from, 1440 + to], [1440 + from, 2880]];
  let total = 0;
  for (const [a, b] of windows) total += Math.max(0, Math.min(end, b) - Math.max(startMin, a));
  return total;
}

// ───────────── prezzi ─────────────
const brackets = (service, rate) => BRACKETS[service].map((h, i) => [h, rate.prices[i]]);

/** Prezzo di base (centesimi, prima di sconti e supplementi) per `hours` ore: scaglione + ore extra, mai più dello scaglione successivo. */
export function basePrice(service, rate, hours) {
  const b = brackets(service, rate);
  const h = Math.max(hours, b[0][0]);
  const i = b.findLastIndex(([bh]) => bh <= h);
  let price = b[i][1] + Math.round((h - b[i][0]) * rate.extra);
  if (i < b.length - 1) price = Math.min(price, b[i + 1][1]);
  return price;
}

export const hasRates = (rates, service, channel) => !!rates.services[service]?.[channel];

/**
 * Il tour è aperto a questo canale? Un tour è B2C (solo privati) oppure B2B (solo partner approvati). Un servizio a ore dipende anche dalle tariffe
 * del suo canale: senza la tariffa corrispondente non si può prenotare.
 */
export function openTo(rates, tour, channel) {
  const key = channel === 'b2b' ? 'b2b' : 'public';
  if ((tour.audience === 'b2b') !== (key === 'b2b')) return false;
  return tour.pricing === 'hourly' ? hasRates(rates, tour.service, key) : true;
}
export const minHours = (service) => BRACKETS[service][0];

/** Le durate che si possono scegliere: dal minimo del servizio fino a 8 ore, di mezz'ora in mezz'ora. */
export function hourOptions(service) {
  const out = [];
  for (let h = minHours(service); h <= MAX_HOURS; h += HOUR_STEP) out.push(h);
  return out;
}

/**
 * Le tariffe che paga un partner per un servizio (scaglioni e ora extra): la tariffa agenzie, meno lo sconto % del partner se ce l'ha
 * (ogni cifra arrotondata ai 5 € successivi, mai oltre la tariffa agenzie).
 */
export function partnerRate(rates, service, discountPercent = 0) {
  const b2b = rates.services[service]?.b2b;
  if (!b2b) return null;
  const d = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  if (!(d > 0)) return b2b;
  return { prices: b2b.prices.map((p) => applyPartnerDiscount(p, d)), extra: applyPartnerDiscount(b2b.extra, d) };
}

/** La tariffa di un canale: per i privati quella al pubblico, per i partner quella con le loro condizioni (partnerRate). */
const rateFor = (rates, service, channel, discountPercent = 0) => (channel === 'b2b' ? partnerRate(rates, service, discountPercent) : (rates.services[service]?.public ?? null));

/** Le cifre da mostrare in una tabella: gli scaglioni e l'ora extra, già con lo sconto del partner. */
export function rateRows(rates, service, channel, discountPercent = 0) {
  const rate = rateFor(rates, service, channel, discountPercent);
  if (!rate) return null;
  return { rows: BRACKETS[service].map((hours, i) => ({ hours, cents: rate.prices[i] })), extraCents: rate.extra };
}

/** Prezzo «da» (il primo scaglione) per mostrarlo sulle schede e negli elenchi. */
export function fromPrice(rates, service, channel, discountPercent = 0) {
  const rate = rateFor(rates, service, channel, discountPercent);
  if (!rate) return null;
  const h = minHours(service);
  return { hours: h, cents: basePrice(service, rate, h) };
}

/**
 * Preventivo. `date` e `time` (facoltativi) servono per festivo e notturno; `earpieces` solo per il servizio guida.
 * @returns {{ok:true, ...}|{ok:false, reason:'service'|'channel'|'hours'}}
 */
export function quote(rates, { service, channel = 'b2c', hours, date = null, time = null, pax = 1, earpieces = false, discountPercent = 0, roundHours = false }) {
  if (!SERVICES.includes(service)) return { ok: false, reason: 'service' };
  const key = channel === 'b2b' ? 'b2b' : 'public';
  const rate = rateFor(rates, service, channel, discountPercent);
  if (!rate) return { ok: false, reason: 'channel' };
  const h = Number(hours);
  if (!(h >= minHours(service) && h <= MAX_HOURS && Math.round(h / HOUR_STEP) * HOUR_STEP === h)) return { ok: false, reason: 'hours' };

  const disc = channel === 'b2b' ? Math.min(100, Math.max(0, Number(discountPercent) || 0)) : 0;
  const billed = roundHours ? Math.ceil(h) : h; // «ore intere»: 2,5 ore si pagano come 3
  const baseCents = basePrice(service, rate, billed); // lo sconto del partner è già nella tariffa (partnerRate)
  const s = rates.surcharges;
  const lines = [{ key: 'base', cents: baseCents, hours: billed }];

  const klass = date ? dayClass(date, rates) : 'feriale';
  if (klass === 'superfestivo' && s.superFestivoPct > 0) lines.push({ key: 'superfestivo', cents: roundEuro((baseCents * s.superFestivoPct) / 100), pct: s.superFestivoPct });
  else if (klass === 'festivo' && s.festivoPct > 0) lines.push({ key: 'festivo', cents: roundEuro((baseCents * s.festivoPct) / 100), pct: s.festivoPct });

  const night = time && s.nightPct > 0 ? nightMinutes(toMin(time), Math.round(h * 60), toMin(s.nightFrom), toMin(s.nightTo)) : 0;
  if (night > 0) lines.push({ key: 'night', cents: roundEuro((baseCents * s.nightPct * night) / (h * 60) / 100), pct: s.nightPct, minutes: night });

  const people = Math.max(1, Number(pax) || 1);
  if (service === 'guide' && earpieces && s.earpieceCents > 0 && people >= s.earpieceFromPax) lines.push({ key: 'earpieces', cents: s.earpieceCents * people, unitCents: s.earpieceCents, pax: people });

  return { ok: true, service, channel: key === 'b2b' ? 'b2b' : 'b2c', hours: h, discountPercent: disc, dayClass: klass, nightMinutes: night, earpieces: lines.some((l) => l.key === 'earpieces'), lines, baseCents, totalCents: lines.reduce((t, l) => t + l.cents, 0) };
}

/** Ciò che si conserva nella prenotazione (service_json): abbastanza per rileggere il conto anche se le tariffe cambiano. */
export const serviceRecord = (q) => ({ v: 1, service: q.service, hours: q.hours, dayClass: q.dayClass, nightMinutes: q.nightMinutes, earpieces: q.earpieces, discountPercent: q.discountPercent, lines: q.lines });
export function parseServiceRecord(json) {
  try {
    const r = typeof json === 'string' ? JSON.parse(json) : json;
    return r && SERVICES.includes(r.service) && Array.isArray(r.lines) ? r : null;
  } catch {
    return null;
  }
}

// ───────────── testi brevi per email, voucher e fatture ─────────────
const HOURS_WORD = { it: ['ora', 'ore'], en: ['hour', 'hours'], es: ['hora', 'horas'], ja: ['時間', '時間'] };
/** «4 ore», «2,5 ore», «1 hour». */
export function hoursText(lang, hours) {
  const n = new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 1 }).format(hours);
  const [one, many] = HOURS_WORD[lang] ?? HOURS_WORD.en;
  return `${n}${lang === 'ja' ? '' : ' '}${hours === 1 ? one : many}`;
}
/** «09:00–13:00 (4 ore)»: l'orario di una prenotazione, con le ore se è un servizio a ore. */
export function timeRange(b, lang) {
  const range = `${b.start_time}–${b.end_time}`;
  const rec = parseServiceRecord(b.service_json);
  return rec ? `${range} (${hoursText(lang, rec.hours)})` : range;
}
const NOTE_WORD = { superfestivo: 'superfestivo', festivo: 'festivo', night: 'notturno', earpieces: 'auricolari' };
/** In italiano, per la guida e per le fatture: «4 ore, festivo +20%, auricolari». */
export function serviceNote(rec) {
  if (!rec) return '';
  const extras = rec.lines.filter((l) => l.key !== 'base').map((l) => (l.pct ? `${NOTE_WORD[l.key]} +${l.pct}%` : NOTE_WORD[l.key] ?? l.key));
  return [hoursText('it', rec.hours), ...extras].join(', ');
}

// ───────────── lettura e controllo delle cifre ─────────────
/** Completa e ripulisce ciò che è salvato (o ciò che arriva dal pannello): ogni cifra mancante o strana torna al valore iniziale. */
export function normalizeRates(raw) {
  const out = clone(DEFAULT_RATES);
  if (!raw || typeof raw !== 'object') return out;
  for (const service of SERVICES) {
    const src = raw.services?.[service];
    out.services[service] = out.services[service] ?? {};
    for (const key of ['public', 'b2b']) {
      const rate = src?.[key];
      if (rate === null) {
        delete out.services[service][key]; // tolto di proposito (per esempio: nessuna tariffa al pubblico)
        continue;
      }
      const prices = rate?.prices;
      const base = out.services[service][key];
      if (!base && !prices) continue;
      const wanted = BRACKETS[service].length;
      const good = Array.isArray(prices) && prices.length === wanted && prices.every((p) => isInt(p) && p >= 0 && p <= 10_000_000);
      out.services[service][key] = { prices: good ? prices.slice() : (base?.prices ?? Array(wanted).fill(0)), extra: isInt(rate?.extra) && rate.extra >= 0 && rate.extra <= 10_000_000 ? rate.extra : (base?.extra ?? 0) };
    }
  }
  const s = raw.surcharges ?? {};
  const pct = (v, d) => (Number.isFinite(v) && v >= 0 && v <= 300 ? v : d);
  out.surcharges = {
    festivoPct: pct(s.festivoPct, out.surcharges.festivoPct),
    superFestivoPct: pct(s.superFestivoPct, out.surcharges.superFestivoPct),
    nightPct: pct(s.nightPct, out.surcharges.nightPct),
    nightFrom: isTime(s.nightFrom) ? s.nightFrom : out.surcharges.nightFrom,
    nightTo: isTime(s.nightTo) ? s.nightTo : out.surcharges.nightTo,
    earpieceCents: isInt(s.earpieceCents) && s.earpieceCents >= 0 && s.earpieceCents <= 100000 ? s.earpieceCents : out.surcharges.earpieceCents,
    earpieceFromPax: isInt(s.earpieceFromPax) && s.earpieceFromPax >= 1 && s.earpieceFromPax <= 100 ? s.earpieceFromPax : out.surcharges.earpieceFromPax,
  };
  const d = raw.days ?? {};
  out.days = {
    sundays: typeof d.sundays === 'boolean' ? d.sundays : out.days.sundays,
    holidays: typeof d.holidays === 'string' && !parseDayList(d.holidays).invalid.length ? d.holidays : out.days.holidays,
    superHolidays: typeof d.superHolidays === 'string' && !parseDayList(d.superHolidays).invalid.length ? d.superHolidays : out.days.superHolidays,
  };
  return out;
}

/** I campi del modulo: nome del campo → etichetta, per i messaggi di errore. */
export const priceFieldName = (service, channel, i) => `${service}.${channel}.p${i}`;
export const extraFieldName = (service, channel) => `${service}.${channel}.extra`;

/**
 * Legge il modulo del pannello. Una cifra vuota in una colonna del pubblico toglie quella tariffa al pubblico (solo per i servizi
 * riservati alle agenzie); gli importi si scrivono in euro («160» o «160,50»).
 * @returns {{ok:true, rates:object}|{ok:false, errors:Record<string,string>}}
 */
export function parseRatesForm(body = {}, current = DEFAULT_RATES) {
  const errors = {};
  const next = clone(normalizeRates(current));
  const num = (key, { min = 0, max = 1000, int = false } = {}) => {
    const raw = String(body[key] ?? '').trim().replace(',', '.');
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
      errors[key] = 'Scrivi un numero valido.';
      return null;
    }
    return n;
  };
  const euros = (key) => {
    const raw = String(body[key] ?? '').trim();
    const cents = raw === '' ? null : parseEuros(raw);
    if (raw !== '' && (cents == null || cents < 0 || cents > 10_000_000)) errors[key] = 'Scrivi un importo in euro (per esempio 160 o 160,50).';
    return raw === '' ? undefined : cents;
  };

  for (const service of SERVICES) {
    for (const channel of ['public', 'b2b']) {
      const names = BRACKETS[service].map((_, i) => priceFieldName(service, channel, i));
      const filled = names.filter((n) => String(body[n] ?? '').trim() !== '');
      const extraKey = extraFieldName(service, channel);
      if (!filled.length && String(body[extraKey] ?? '').trim() === '') {
        // colonna lasciata vuota: per le agenzie non si può, al pubblico significa «non offerto»
        if (channel === 'b2b') errors[names[0]] = 'Le tariffe per le agenzie non possono mancare.';
        else if (service === 'guide') errors[names[0]] = 'La tariffa al pubblico del servizio guida non può mancare.';
        else delete next.services[service].public;
        continue;
      }
      const prices = names.map((n) => euros(n));
      const extra = euros(extraKey);
      if (prices.some((p) => p === undefined) || extra === undefined) {
        for (const n of [...names, extraKey]) if (String(body[n] ?? '').trim() === '') errors[n] = 'Compila tutte le cifre di questa colonna.';
        continue;
      }
      if (prices.some((p) => p == null) || extra == null) continue;
      next.services[service][channel] = { prices, extra };
    }
  }
  next.days.sundays = !!body.sundays;
  const s = next.surcharges;
  s.festivoPct = num('festivoPct', { max: 300 }) ?? s.festivoPct;
  s.superFestivoPct = num('superFestivoPct', { max: 300 }) ?? s.superFestivoPct;
  s.nightPct = num('nightPct', { max: 300 }) ?? s.nightPct;
  for (const key of ['nightFrom', 'nightTo']) {
    if (isTime(String(body[key] ?? ''))) s[key] = String(body[key]);
    else errors[key] = 'Scrivi un orario, per esempio 20:00.';
  }
  const ear = euros('earpieceCents');
  if (ear === undefined) errors.earpieceCents = 'Scrivi un importo (anche 0).';
  else if (ear != null) s.earpieceCents = ear;
  s.earpieceFromPax = num('earpieceFromPax', { min: 1, max: 100, int: true }) ?? s.earpieceFromPax;
  for (const key of ['holidays', 'superHolidays']) {
    const { tokens, invalid } = parseDayList(body[key]);
    if (invalid.length) errors[key] = `Non capisco: ${invalid.join(', ')}. Usa giorno e mese come 25-12, oppure le parole pasqua e pasquetta.`;
    else next.days[key] = tokens.join(' ');
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, rates: next };
}

// ───────────── collegamento con il sito ─────────────
const SETTING = 'rate_card';

export function createRates({ db }) {
  const get = () => normalizeRates(getSetting(db, SETTING, null));
  return {
    get,
    save(rates) {
      setSetting(db, SETTING, normalizeRates(rates));
    },
    reset() {
      db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING);
    },
    isCustom: () => getSetting(db, SETTING, null) != null,
    quote: (input) => quote(get(), input),
    fromPrice: (service, channel, discountPercent = 0) => fromPrice(get(), service, channel, discountPercent),
    has: (service, channel) => hasRates(get(), service, channel === 'b2b' ? 'b2b' : 'public'),
  };
}
