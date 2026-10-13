// Tariffe a ore: scaglioni, ore extra, sconto partner, festivi, notturno, auricolari e lettura del modulo del pannello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RATES, basePrice, dayClass, easterSunday, fromPrice, hourOptions, hoursText, normalizeRates, nightMinutes, parseDayList, parseRatesForm, parseServiceRecord, partnerRate, quote, serviceNote, serviceRecord, timeRange } from '../server/rates.js';

const R = normalizeRates(null);
const eur = (c) => c / 100;
const b2b = (hours, extra = {}) => quote(R, { service: 'guide', channel: 'b2b', hours, ...extra });
const pub = (hours, extra = {}) => quote(R, { service: 'guide', channel: 'b2c', hours, ...extra });

test('tariffe: scaglioni 2 / 4 / 8 ore e ore extra, mai più dello scaglione successivo', () => {
  const g = DEFAULT_RATES.services.guide.b2b;
  assert.deepEqual([2, 3, 3.5, 4, 5, 6, 7, 7.5, 8, 9, 12].map((h) => eur(basePrice('guide', g, h))), [160, 230, 265, 300, 370, 440, 510, 545, 560, 630, 840]);
  assert.equal(eur(basePrice('guide', g, 1)), 160, 'sotto il minimo si paga il minimo');
  // al pubblico
  assert.deepEqual([2, 4, 8, 3].map((h) => eur(pub(h).totalCents)), [200, 380, 700, 290]);
  // la tariffa non scende mai aumentando le ore
  let prev = 0;
  for (const h of hourOptions('guide')) {
    const p = basePrice('guide', g, h);
    assert.ok(p >= prev, `${h} ore`);
    prev = p;
  }
});

test('tariffe: lo sconto del partner parte dal prezzo al pubblico e sostituisce la tariffa agenzie; sempre arrotondato al multiplo di 5 € successivo', () => {
  assert.equal(eur(b2b(4, { discountPercent: 15 }).totalCents), 325, '380 € al pubblico − 15% = 323 → 325 (non 300 − 15%)');
  assert.equal(eur(b2b(2, { discountPercent: 15 }).totalCents), 170, '200 − 15% = 170: un prezzo già multiplo di 5 resta com’è');
  assert.equal(eur(pub(4, { discountPercent: 15 }).totalCents), 380, 'ai privati lo sconto dei partner non si applica');
  assert.equal(eur(b2b(3, { discountPercent: 7 }).totalCents), 275, '2 ore: 200 − 7% = 186 → 190; ora in più: 90 − 7% = 83,70 → 85');
  assert.equal(eur(b2b(4, { discountPercent: 15 }).baseCents), 325);
  assert.equal(eur(b2b(4, { discountPercent: 0 }).totalCents), 300, 'senza sconto vale la tariffa agenzie');
  assert.equal(eur(b2b(4, { discountPercent: 30 }).totalCents), 270, '380 − 30% = 266 → 270, sotto la tariffa agenzie');
  // senza un prezzo al pubblico (servizi solo per agenzie) lo sconto parte dalla tariffa agenzie
  assert.equal(eur(quote(R, { service: 'assistant', channel: 'b2b', hours: 2, discountPercent: 15 }).totalCents), 70, '80 − 15% = 68 → 70');
  assert.deepEqual(partnerRate(R, 'guide', 15).prices.map(eur), [170, 325, 595], '200, 380, 700 al pubblico − 15%: 595 è già multiplo di 5');
  assert.equal(partnerRate(R, 'guide', 0), R.services.guide.b2b);
  assert.equal(partnerRate(R, 'driver', 15), null);
  for (const q of [b2b(3, { discountPercent: 7, date: '2027-05-01', time: '19:00' }), b2b(5, { date: '2027-12-25', pax: 11, earpieces: true })]) assert.ok(q.lines.every((l) => l.cents % 100 === 0), JSON.stringify(q.lines));
});

test('tariffe: Pasqua e giorni festivi / superfestivi', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(easterSunday), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16']);
  const cls = (d) => dayClass(d, R);
  assert.equal(cls('2027-01-04'), 'feriale'); // lunedì
  assert.equal(cls('2027-01-03'), 'festivo'); // domenica
  assert.equal(cls('2027-01-06'), 'festivo'); // Epifania
  assert.equal(cls('2027-01-01'), 'superfestivo');
  assert.equal(cls('2027-12-25'), 'superfestivo'); // anche di sabato
  assert.equal(cls('2027-03-28'), 'superfestivo'); // Pasqua
  assert.equal(cls('2027-03-29'), 'festivo'); // Pasquetta
  assert.equal(cls('2027-04-25'), 'festivo');
  assert.equal(cls('2027-06-15'), 'feriale');
  const noSundays = normalizeRates({ days: { sundays: false } });
  assert.equal(dayClass('2027-01-03', noSundays), 'feriale');
  // il supplemento è sul prezzo di base: festivo +20%, superfestivo +50% (non si sommano)
  assert.equal(eur(b2b(4, { date: '2027-01-03' }).totalCents), 360);
  assert.equal(eur(b2b(4, { date: '2027-12-25' }).totalCents), 450);
  assert.deepEqual(b2b(4, { date: '2027-12-25' }).lines.map((l) => l.key), ['base', 'superfestivo']);
  assert.equal(b2b(4, { date: '2027-06-15' }).lines.length, 1);
  assert.deepEqual(parseDayList('12-25, 01-01  pasqua; PASQUETTA 13-40 foo'), { tokens: ['12-25', '01-01', 'pasqua', 'pasquetta'], invalid: ['13-40', 'foo'] });
});

test('tariffe: notturno in proporzione alle ore nella fascia 20:00-07:00', () => {
  assert.equal(nightMinutes(18 * 60, 240, 20 * 60, 7 * 60), 120);
  assert.equal(nightMinutes(9 * 60, 480, 20 * 60, 7 * 60), 0);
  assert.equal(nightMinutes(6 * 60, 120, 20 * 60, 7 * 60), 60);
  assert.equal(nightMinutes(22 * 60, 480, 20 * 60, 7 * 60), 480, 'a cavallo della mezzanotte');
  assert.equal(nightMinutes(19 * 60, 60, 20 * 60, 7 * 60), 0);
  assert.equal(nightMinutes(10 * 60, 120, 5 * 60, 5 * 60), 0, 'fascia spenta');
  assert.equal(nightMinutes(1 * 60, 120, 0, 5 * 60), 120, 'fascia dopo la mezzanotte');
  const q = b2b(4, { date: '2027-06-15', time: '18:00' });
  assert.equal(q.nightMinutes, 120);
  assert.equal(eur(q.lines.find((l) => l.key === 'night').cents), 45); // 30% di 300 € per metà del servizio
  assert.equal(eur(b2b(2, { date: '2027-06-15', time: '06:00' }).lines.find((l) => l.key === 'night').cents), 24);
  assert.equal(b2b(4, { date: '2027-06-15', time: '09:30' }).lines.length, 1, 'di giorno nessun supplemento');
  // festivo e notturno si sommano
  assert.equal(eur(b2b(4, { date: '2027-01-03', time: '18:00' }).totalCents), 300 + 60 + 45);
  // senza orario (preventivo indicativo) non c'è notturno
  assert.equal(b2b(4, { date: '2027-06-15' }).nightMinutes, 0);
});

test('tariffe: auricolari solo per la guida, da 8 persone, a persona', () => {
  assert.equal(eur(b2b(4, { pax: 12, earpieces: true }).lines.find((l) => l.key === 'earpieces').cents), 48);
  assert.equal(b2b(4, { pax: 7, earpieces: true }).lines.length, 1, 'sotto le 8 persone non si applicano');
  assert.equal(b2b(4, { pax: 8, earpieces: true }).earpieces, true);
  assert.equal(b2b(4, { pax: 12, earpieces: false }).lines.length, 1, 'solo se richiesti');
  const assistant = quote(R, { service: 'assistant', channel: 'b2b', hours: 4, pax: 20, earpieces: true });
  assert.equal(assistant.lines.length, 1, 'per assistente, tour leader e meet & greet non esistono');
});

test('tariffe: assistente, tour leader e meet & greet esistono solo per le agenzie', () => {
  assert.equal(eur(quote(R, { service: 'assistant', channel: 'b2b', hours: 2 }).totalCents), 80);
  assert.equal(eur(quote(R, { service: 'assistant', channel: 'b2b', hours: 8 }).totalCents), 200);
  assert.equal(eur(quote(R, { service: 'leader', channel: 'b2b', hours: 4 }).totalCents), 140);
  assert.equal(eur(quote(R, { service: 'leader', channel: 'b2b', hours: 9 }).totalCents), 286, '250 + 1 ora extra da 36 €');
  assert.equal(eur(quote(R, { service: 'meetgreet', channel: 'b2b', hours: 1 }).totalCents), 50);
  assert.equal(eur(quote(R, { service: 'meetgreet', channel: 'b2b', hours: 2.5 }).totalCents), 95);
  assert.deepEqual(quote(R, { service: 'assistant', channel: 'b2c', hours: 4 }), { ok: false, reason: 'channel' });
  assert.deepEqual(quote(R, { service: 'leader', channel: 'b2b', hours: 2 }), { ok: false, reason: 'hours' }, 'il tour leader parte da 4 ore');
  assert.deepEqual(quote(R, { service: 'guide', channel: 'b2b', hours: 2.25 }), { ok: false, reason: 'hours' });
  assert.deepEqual(quote(R, { service: 'guide', channel: 'b2b', hours: 13 }), { ok: false, reason: 'hours' });
  assert.deepEqual(quote(R, { service: 'driver', channel: 'b2b', hours: 4 }), { ok: false, reason: 'service' });
  assert.equal(fromPrice(R, 'guide', 'b2c').cents, 20000);
  assert.deepEqual(fromPrice(R, 'guide', 'b2b', 15), { hours: 2, cents: 17000 });
  assert.equal(fromPrice(R, 'assistant', 'b2c'), null);
  assert.deepEqual(hourOptions('meetgreet').slice(0, 3), [1, 1.5, 2]);
  assert.equal(hourOptions('guide').at(-1), 12);
});

test('tariffe: cifre salvate rovinate tornano ai valori iniziali', () => {
  const broken = normalizeRates({ services: { guide: { b2b: { prices: [1, 2], extra: -5 }, public: { prices: [100, 200, 300], extra: 50 } } }, surcharges: { festivoPct: 'molto', nightFrom: '25:00', earpieceFromPax: 0 }, days: { holidays: '99-99' } });
  assert.deepEqual(broken.services.guide.b2b, DEFAULT_RATES.services.guide.b2b);
  assert.deepEqual(broken.services.guide.public, { prices: [100, 200, 300], extra: 50 });
  assert.equal(broken.surcharges.festivoPct, 20);
  assert.equal(broken.surcharges.nightFrom, '20:00');
  assert.equal(broken.surcharges.earpieceFromPax, 8);
  assert.equal(broken.days.holidays, DEFAULT_RATES.days.holidays);
  assert.deepEqual(normalizeRates('boh'), DEFAULT_RATES);
});

test('tariffe: modulo del pannello — importi in euro, errori leggibili, colonna del pubblico facoltativa', () => {
  const form = {
    'guide.public.p0': '210', 'guide.public.p1': '400', 'guide.public.p2': '720,50', 'guide.public.extra': '95',
    'guide.b2b.p0': '170', 'guide.b2b.p1': '320', 'guide.b2b.p2': '580', 'guide.b2b.extra': '75',
    'assistant.public.p0': '', 'assistant.public.p1': '', 'assistant.public.p2': '', 'assistant.public.extra': '',
    'assistant.b2b.p0': '80', 'assistant.b2b.p1': '110', 'assistant.b2b.p2': '200', 'assistant.b2b.extra': '32',
    'leader.b2b.p0': '140', 'leader.b2b.p1': '250', 'leader.b2b.extra': '36',
    'meetgreet.b2b.p0': '50', 'meetgreet.b2b.extra': '30',
    festivoPct: '25', superFestivoPct: '60', nightPct: '35', nightFrom: '21:00', nightTo: '06:30', earpieceCents: '3,50', earpieceFromPax: '10',
    holidays: '01-06, 04-25 pasquetta', superHolidays: '12-25 01-01 pasqua', sundays: '1',
  };
  const ok = parseRatesForm(form, R);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const r = ok.rates;
  assert.deepEqual(r.services.guide.public, { prices: [21000, 40000, 72050], extra: 9500 });
  assert.deepEqual(r.services.guide.b2b.prices, [17000, 32000, 58000]);
  assert.equal(r.services.assistant.public, undefined, 'tariffa al pubblico lasciata vuota = non offerta');
  assert.equal(r.surcharges.earpieceCents, 350);
  assert.equal(r.surcharges.festivoPct, 25);
  assert.equal(r.days.holidays, '01-06 04-25 pasquetta');
  assert.equal(normalizeRates(r).services.assistant.public, undefined, 'e resta tale dopo il salvataggio');
  assert.equal(quote(r, { service: 'guide', channel: 'b2c', hours: 2 }).totalCents, 21000);

  const bad = parseRatesForm({ ...form, 'guide.b2b.p1': 'tanto', 'guide.public.extra': '', nightFrom: 'sera', festivoPct: '-3', holidays: '31-02 boh', 'leader.b2b.p0': '' }, R);
  assert.equal(bad.ok, false);
  for (const k of ['guide.b2b.p1', 'guide.public.extra', 'nightFrom', 'festivoPct', 'holidays', 'leader.b2b.p0']) assert.ok(bad.errors[k], k);
  assert.equal(parseRatesForm({ ...form, 'guide.public.p0': '', 'guide.public.p1': '', 'guide.public.p2': '', 'guide.public.extra': '' }, R).ok, false, 'il pubblico non può restare senza tariffa guida');
});

test('tariffe: testi brevi per email, voucher e fatture, e conto conservato nella prenotazione', () => {
  const q = quote(R, { service: 'guide', channel: 'b2b', hours: 4, date: '2027-01-03', time: '18:00', pax: 12, earpieces: true });
  const rec = serviceRecord(q);
  assert.equal(serviceNote(rec), '4 ore, festivo +20%, notturno +30%, auricolari');
  assert.equal(serviceNote(null), '');
  assert.deepEqual(parseServiceRecord(JSON.stringify(rec)), rec, 'si rilegge identico');
  assert.equal(parseServiceRecord('{non json'), null);
  assert.equal(parseServiceRecord(JSON.stringify({ service: 'driver', lines: [] })), null);
  assert.deepEqual([hoursText('it', 3), hoursText('en', 1), hoursText('es', 2.5), hoursText('xx', 2)], ['3 ore', '1 hour', '2,5 horas', '2 hours']);
  assert.equal(timeRange({ start_time: '09:00', end_time: '13:00', service_json: JSON.stringify(rec) }, 'it'), '09:00–13:00 (4 ore)');
  assert.equal(timeRange({ start_time: '09:00', end_time: '13:00', service_json: JSON.stringify(rec) }, 'en'), '09:00–13:00 (4 hours)');
  assert.equal(timeRange({ start_time: '09:00', end_time: '11:30', service_json: null }, 'it'), '09:00–11:30', 'i tour a prezzo fisso non cambiano');
});
