// Statistiche e KPI: cifre esatte su dati noti (privati e partner, carta e fattura, sconti, buoni, annulli con penale),
// confronto col periodo precedente, base servizio/prenotazione, filtri, arrotondamenti, periodo vuoto, CSV e pagina.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { confirmPaid, createBooking, expireBooking } from '../server/bookings.js';
import { acceptProgram, createProgramRequest, markDepositPaid, markQuoted, saveProposal } from '../server/programs.js';
import { CSV_HEAD, bookingsCsv, bucketsOf, change, diffDays, filterOptions, giftStats, granularityFor, parseFilters, presetRange, promoUsage, statsHref, statsReport, veniceDateSql } from '../server/stats.js';
import { addDays, localToInstant, nowRome } from '../server/time.js';
import { formatMoney } from '../server/util.js';
import { niceScale, statsPage, tickLabel } from '../server/views/admin-stats.js';
import { addAccount, addGift, addPromo, base, loadContentWithFixedServices, makeApp, NOW } from './helpers.js';

process.env.GUIDA_QUIET = '1';

const HOUR = 3600_000;
const TIERS = JSON.stringify([{ hours: 168, refund: 100 }, { hours: 72, refund: 50 }]);
const TITLES = { shared: 'Tour condiviso', private: 'Tour privato', 'half-day': 'Mezza giornata' };
const tourTitle = (slug) => TITLES[slug] ?? slug;
const FEB = { from: '2027-02-01', to: '2027-02-28' }; // 28 giorni; il periodo precedente è 4–31 gennaio
const clean = (s) => String(s).replace(/\u00a0/g, ' '); // formatMoney usa uno spazio non divisibile prima di «€»

/** Tutti i numeri di un oggetto devono essere finiti (mai NaN o Infinity). */
function assertFinite(value, where = 'report') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${where} non è un numero finito: ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertFinite(v, `${where}.${k}`);
}

// ───────────── i dati di prova ─────────────
// «Adesso» è lunedì 4 gennaio 2027, 10:00. Quasi tutte le prenotazioni sono state fatte allora; ciò che cambia è la data del servizio.
//
//  febbraio (periodo in esame), confermate:
//   c1  condiviso   9 feb  2 pers.  privato  carta, pagata                       70,00   it
//   c2  condiviso   9 feb  3 pers.  privato  sul posto                          105,00   en
//   c3  condiviso  10 feb  2 pers.  privato  carta, pagata, codice ESTATE10 −7   63,00   es
//   c4  condiviso  11 feb  3 pers.  privato  sul posto, buono da 50 €           105,00 (da pagare 55,00)  it
//   c5  privato    12 feb  4 pers.  privato  sul posto, codice WELCOME −5       145,00   it
//   c6  mezza gg.  15 feb  6 pers.  Alpha    fattura                            190,00   it
//   c7  condiviso  16 feb  4 pers.  Bravo    carta, pagata (sconto 10%: 25,20 a persona) 100,80  en
//  febbraio, annullate:
//   c8  privato    17 feb  5 pers.  Alpha    carta pagata 120,00; annullo a 100 ore: rimborso 50% = 60,00, trattenuti 60,00
//   c9  condiviso  18 feb  2 pers.  privato  carta pagata 70,00; annullo senza rimborso: trattenuti 70,00
//   c10 condiviso  19 feb  2 pers.  privato  sul posto 70,00; annullo senza rimborso: penale 70,00 da fatturare
//   c11 condiviso  22 feb  2 pers.  privato  carta pagata 70,00; annullo gratuito: rimborsati 70,00
//  febbraio, non contano: c12 in attesa di pagamento, c13 scaduta.
//  gennaio (periodo precedente): p1 12 gen carta 70,00 · p2 13 gen sul posto 140,00 · p3 20 gen Alpha fattura 120,00 · p4 25 gen annullata senza penale.
//  prenotate più tardi: l1 (2 mar) il 20 gennaio, 70,00 · l2 (3 mar) il 5 gennaio alle 00:30 di Venezia, che sono le 23:30 UTC del 4: 35,00.
async function seed() {
  const app = makeApp();
  const { db } = app;
  const alpha = addAccount(db, { email: 'alpha@example.com', company: 'Alpha Viaggi', cancel_policy_json: TIERS });
  const bravo = addAccount(db, { email: 'bravo@example.com', company: 'Bravo Tours', discount_percent: 10 });
  addPromo(db, { code: 'ESTATE10', kind: 'percent', value: 10 });
  addPromo(db, { code: 'WELCOME', kind: 'fixed', value: 500 });
  const at = (date, time = '12:00') => new Date(localToInstant(date, time)).toISOString();
  const g1 = addGift(db, { initial_cents: 5000, source: 'web', activated_at: at('2027-02-10') });
  addGift(db, { initial_cents: 8000, source: 'admin', activated_at: at('2027-02-12') });
  addGift(db, { initial_cents: 3000, source: 'web', activated_at: at('2027-01-15') });
  addGift(db, { initial_cents: 6000, source: 'web', status: 'pending', activated_at: null });
  addGift(db, { initial_cents: 4000, source: 'web', status: 'void', activated_at: at('2027-02-14') });
  addGift(db, { initial_cents: 2000, source: 'web', activated_at: at('2026-12-20'), expires_at: '2027-01-01' }); // scaduto

  const make = (over, nowMs = NOW) => createBooking(app, base(over), nowMs);
  const pay = (b) => (confirmPaid(app, b.id, `pi_${b.id}`, NOW), b);
  const cancel = (b, opts, nowMs) => app.services.cancel(b.id, { by: 'admin', ...opts }, nowMs);
  const b = {};
  b.c1 = pay(make({ date: '2027-02-09', time: '09:30', pax: 2, paymentMethod: 'card', email: 'c1@example.com' }));
  b.c2 = make({ date: '2027-02-09', time: '09:30', pax: 3, lang: 'en', email: 'c2@example.com' });
  b.c3 = pay(make({ date: '2027-02-10', time: '09:30', pax: 2, paymentMethod: 'card', promoCode: 'ESTATE10', lang: 'es', email: 'c3@example.com' }));
  b.c4 = make({ date: '2027-02-11', time: '09:30', pax: 3, giftCodes: g1.code, email: 'c4@example.com' });
  b.c5 = make({ tourSlug: 'private', date: '2027-02-12', time: '10:00', pax: 4, promoCode: 'WELCOME', email: 'c5@example.com' });
  b.c6 = make({ tourSlug: 'half-day', date: '2027-02-15', time: '10:00', pax: 6, channel: 'b2b', account: alpha, paymentMethod: 'invoice', email: 'c6@example.com' });
  b.c7 = pay(make({ date: '2027-02-16', time: '09:30', pax: 4, channel: 'b2b', account: bravo, paymentMethod: 'card', lang: 'en', email: 'c7@example.com' }));
  b.c8 = pay(make({ tourSlug: 'private', date: '2027-02-17', time: '10:00', pax: 5, channel: 'b2b', account: alpha, paymentMethod: 'card', email: 'c8@example.com' }));
  await cancel(b.c8, {}, localToInstant('2027-02-17', '10:00') - 100 * HOUR);
  b.c9 = pay(make({ date: '2027-02-18', time: '09:30', pax: 2, paymentMethod: 'card', email: 'c9@example.com' }));
  await cancel(b.c9, { refund: 'none' }, NOW);
  b.c10 = make({ date: '2027-02-19', time: '09:30', pax: 2, email: 'c10@example.com' });
  await cancel(b.c10, { refund: 'none' }, NOW);
  b.c11 = pay(make({ date: '2027-02-22', time: '09:30', pax: 2, paymentMethod: 'card', email: 'c11@example.com' }));
  await cancel(b.c11, {}, NOW);
  b.c12 = make({ date: '2027-02-23', time: '14:30', pax: 2, paymentMethod: 'card', email: 'c12@example.com' });
  b.c13 = make({ date: '2027-02-24', time: '14:30', pax: 2, paymentMethod: 'card', email: 'c13@example.com' });
  expireBooking(db, b.c13.id, NOW);
  b.p1 = pay(make({ date: '2027-01-12', time: '09:30', pax: 2, paymentMethod: 'card', email: 'p1@example.com' }));
  b.p2 = make({ date: '2027-01-13', time: '09:30', pax: 4, email: 'p2@example.com' });
  b.p3 = make({ tourSlug: 'private', date: '2027-01-20', time: '10:00', pax: 3, channel: 'b2b', account: alpha, paymentMethod: 'invoice', email: 'p3@example.com' });
  b.p4 = make({ date: '2027-01-25', time: '09:30', pax: 2, email: 'p4@example.com' });
  await cancel(b.p4, { refund: 'full' }, NOW);
  b.l1 = pay(make({ date: '2027-03-02', time: '09:30', pax: 2, paymentMethod: 'card', email: 'l1@example.com' }, localToInstant('2027-01-20', '10:00')));
  b.l2 = make({ date: '2027-03-03', time: '09:30', pax: 1, email: 'l2@example.com' }, localToInstant('2027-01-05', '00:30'));

  // programmi di più giorni
  const program = (over, days, { nowMs = NOW } = {}) => {
    const p = createProgramRequest(app, { name: 'Giulia Bianchi', email: 'giulia@example.com', participants: 6, dateFrom: days[0].date, dateTo: days.at(-1).date, ...over }, nowMs);
    saveProposal(app, p.id, { title: 'Programma', depositPercent: over.depositPercent ?? 30, validUntil: '2027-01-30', days }, { nowMs });
    markQuoted(app, p.id, nowMs);
    return p;
  };
  const pa = program({ channel: 'b2b', account: alpha }, [{ date: '2027-02-20', start: '09:30', end: '12:30', title: 'Primo giorno', priceCents: 60000 }, { date: '2027-02-21', start: '10:00', end: '13:00', title: 'Secondo giorno', priceCents: 30000 }]);
  acceptProgram(app, pa.id, {}, NOW);
  markDepositPaid(db, pa.id, 'pi_a', NOW); // confermato, acconto 270,00 incassato
  const pb = program({}, [{ date: '2027-02-26', start: '09:30', end: '12:30', title: 'Giorno unico', priceCents: 45000 }]);
  acceptProgram(app, pb.id, {}, NOW); // accettato, acconto da pagare
  program({}, [{ date: '2027-02-27', start: '09:30', end: '12:30', title: 'Solo proposta', priceCents: 20000 }]); // inviato, non accettato
  const pd = program({ depositPercent: 0 }, [{ date: '2027-01-27', start: '09:30', end: '12:30', title: 'Gennaio', priceCents: 20000 }]);
  acceptProgram(app, pd.id, {}, NOW); // senza acconto: confermato subito

  // fatture emesse (righe dirette: qui conta solo lo stato, la data e il totale)
  const inv = (status, docType, date, total) =>
    db.prepare(`INSERT INTO invoices(status, doc_type, issue_date, total_cents, buyer_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?)`).run(status, docType, date, total, '{}', at(date), at(date));
  inv('issued', 'TD01', '2027-02-05', 10000);
  inv('sent', 'TD01', '2027-02-20', 20000);
  inv('delivered', 'TD01', '2027-02-25', 5000);
  inv('undelivered', 'TD01', '2027-02-27', 3000);
  inv('issued', 'TD04', '2027-02-28', 4000); // nota di credito: si sottrae
  inv('draft', 'TD01', '2027-02-10', 99999); // bozza: non conta
  inv('rejected', 'TD01', '2027-02-11', 77777); // scartata da SdI: non conta
  inv('draft', 'TD04', '2027-02-12', 55555);
  inv('delivered', 'TD01', '2027-03-01', 12345); // fuori periodo
  inv('delivered', 'TD01', '2027-01-15', 8000); // periodo precedente
  return { app, alpha, bravo, b };
}

const world = await seed();
const { app, alpha, bravo, b } = world;
const { db } = app;
after(() => app.cleanup());

const filters = (query = {}, nowMs = NOW) => parseFilters(query, { nowMs, tours: ['shared', 'private', 'half-day'], partners: [alpha.id, bravo.id] });
const report = (query = {}, nowMs = NOW) => statsReport(db, filters(query, nowMs), { nowMs, tourTitle });
const feb = (extra = {}) => report({ ...FEB, ...extra });
const rows = (list, fields = ['key', 'n', 'pax', 'cents']) => list.map((r) => fields.map((f) => r[f]));

// ───────────── periodi e filtri ─────────────
test('periodi predefiniti: intervalli esatti (mese, mese scorso, 30 e 90 giorni, anno, anno scorso, tutto), anche a cavallo d’anno e in anno bisestile', () => {
  const t = '2027-03-15';
  assert.deepEqual(presetRange('month', t), { from: '2027-03-01', to: '2027-03-31' });
  assert.deepEqual(presetRange('lastmonth', t), { from: '2027-02-01', to: '2027-02-28' });
  assert.deepEqual(presetRange('d30', t), { from: '2027-02-14', to: t }, '30 giorni: oggi compreso');
  assert.deepEqual(presetRange('d90', t), { from: '2026-12-16', to: t });
  assert.deepEqual(presetRange('year', t), { from: '2027-01-01', to: '2027-12-31' });
  assert.deepEqual(presetRange('lastyear', t), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(presetRange('all', t), { from: null, to: null });
  assert.deepEqual(presetRange('lastmonth', '2027-01-10'), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(presetRange('lastmonth', '2028-03-10'), { from: '2028-02-01', to: '2028-02-29' }, 'febbraio bisestile');
  assert.deepEqual(presetRange('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(diffDays('2027-02-01', '2027-02-28') + 1, 28);
  for (const p of ['d30', 'd90']) assert.equal(diffDays(presetRange(p, t).from, t) + 1, Number(p.slice(1)));
});

test('filtri: predefiniti, periodo personalizzato, valori non validi scartati senza errori', () => {
  const none = filters();
  assert.deepEqual({ ...none }, { preset: 'd90', from: '2026-10-07', to: '2027-01-04', basis: 'service', channel: 'all', account: null, tour: null, datesIgnored: false });
  assert.equal(filters({ p: 'month' }).from, '2027-01-01');
  assert.equal(filters({ p: 'mese-che-non-esiste' }).preset, 'd90');
  assert.equal(filters({ p: ['year', 'month'] }).preset, 'year', 'se il parametro è ripetuto vale il primo');

  const custom = filters({ from: '2027-02-01', to: '2027-02-28', p: 'year' });
  assert.deepEqual([custom.preset, custom.from, custom.to, custom.datesIgnored], ['custom', '2027-02-01', '2027-02-28', false], 'le due date valgono più del periodo predefinito');
  const sameDay = filters({ from: '2027-02-10', to: '2027-02-10' });
  assert.equal(diffDays(sameDay.from, sameDay.to) + 1, 1, 'un giorno solo è un periodo valido');
  assert.equal(filters({ from: '2015-01-01', to: '2027-01-01' }).preset, 'custom', 'oltre 5 anni va bene');

  for (const q of [
    { from: '2027-03-01', to: '2027-02-01' }, // invertite
    { from: '2027-02-30', to: '2027-03-01' }, // il 30 febbraio non esiste
    { from: 'abc', to: 'def' },
    { from: '2027-02-01' }, // ne manca una
    { to: '2027-02-01' },
    { from: '1999-12-31', to: '2027-01-01' }, // fuori dai limiti
    { from: '2027-01-01', to: '2101-01-01' },
    { from: ['2027-01-01'], to: [{}] },
    { from: '2027-1-1', to: '2027-1-31' },
  ]) {
    const f = filters(q);
    assert.deepEqual([f.preset, f.from, f.to, f.datesIgnored], ['d90', '2026-10-07', '2027-01-04', true], JSON.stringify(q));
  }
  assert.equal(filters({ p: 'month', from: 'zzz', to: '2027-01-01' }).preset, 'month', 'date rotte: resta il periodo scelto con i pulsanti');

  // base, canale, partner, tour
  assert.equal(filters({ basis: 'booking' }).basis, 'booking');
  assert.equal(filters({ basis: 'altro' }).basis, 'service');
  assert.equal(filters({ channel: 'b2c' }).channel, 'b2c');
  assert.equal(filters({ channel: 'tutti-i-canali' }).channel, 'all');
  assert.equal(filters({ tour: 'shared' }).tour, 'shared');
  assert.equal(filters({ tour: 'non-esiste' }).tour, null);
  assert.equal(filters({ tour: 'x'.repeat(5000) }).tour, null);
  assert.equal(filters({ partner: String(alpha.id) }).account, alpha.id);
  for (const bad of ['999', '-1', '1;DROP TABLE bookings', '1.5', ' ', 'x', '99999999999999999999']) assert.equal(filters({ partner: bad }).account, null, bad);
  assert.equal(filters({ partner: String(alpha.id), channel: 'b2c' }).channel, 'b2b', 'un partner è del canale partner');
  assert.doesNotThrow(() => parseFilters(undefined, { nowMs: NOW }));
  assert.doesNotThrow(() => parseFilters({ p: {}, from: {}, to: [], basis: [[]], channel: null }, { nowMs: NOW }));
});

test('indirizzi dei filtri: corti, completi e di nuovo leggibili', () => {
  const f = filters();
  assert.equal(statsHref(f), '/admin/stats');
  assert.equal(statsHref(f, { preset: 'd30' }), '/admin/stats?p=d30');
  assert.equal(statsHref(filters({ p: 'year', basis: 'booking', channel: 'b2b', tour: 'shared' }), { preset: 'all' }, '/admin/stats.csv'), '/admin/stats.csv?p=all&basis=booking&channel=b2b&tour=shared');
  const c = filters({ from: '2027-02-01', to: '2027-02-28', partner: String(bravo.id) });
  assert.equal(statsHref(c), `/admin/stats?from=2027-02-01&to=2027-02-28&channel=b2b&partner=${bravo.id}`);
  assert.equal(statsHref(c, { preset: 'month' }), `/admin/stats?p=month&channel=b2b&partner=${bravo.id}`, 'un periodo predefinito lascia cadere le date');
  const back = filters(Object.fromEntries(new URL(statsHref(c), 'http://x').searchParams));
  assert.deepEqual(back, c);
});

test('la data di Venezia ricavata in SQL coincide con quella di nowRome, anche attorno ai cambi d’ora', () => {
  const q = db.prepare(`SELECT ${veniceDateSql('c')} AS d FROM (SELECT ? AS c)`);
  let n = 0;
  for (let ms = Date.UTC(2026, 11, 20); ms < Date.UTC(2028, 11, 20); ms += HOUR / 2) {
    const iso = new Date(ms).toISOString();
    if (q.get(iso).d !== nowRome(ms).date) assert.fail(`${iso}: SQL ${q.get(iso).d}, nowRome ${nowRome(ms).date}`);
    n++;
  }
  assert.ok(n > 35000);
  // i casi di confine: mezzanotte di Venezia in inverno (23:00 UTC) e in estate (22:00 UTC), e i due cambi d'ora
  for (const [iso, date] of [['2027-01-04T23:00:00.000Z', '2027-01-05'], ['2027-01-04T22:59:59.999Z', '2027-01-04'], ['2027-07-14T22:00:00.000Z', '2027-07-15'], ['2027-07-14T21:59:59.999Z', '2027-07-14'], ['2027-03-28T01:00:00.000Z', '2027-03-28'], ['2027-10-31T00:30:00.000Z', '2027-10-31']]) {
    assert.equal(q.get(iso).d, date, iso);
  }
});

// ───────────── le cifre ─────────────
test('KPI di febbraio: venduto, prenotazioni, persone, medie, incassato e da incassare, sconti, buoni, annulli, penali', () => {
  const r = feb();
  const k = r.kpi;
  assert.equal(r.empty, false);
  assert.deepEqual([r.period.from, r.period.to, r.period.days, r.period.prev.from, r.period.prev.to], ['2027-02-01', '2027-02-28', 28, '2027-01-04', '2027-01-31']);

  // venduto = 70 + 105 + 63 + 105 + 145 + 190 + 100,80
  assert.equal(k.sold, 7000 + 10500 + 6300 + 10500 + 14500 + 19000 + 10080);
  assert.equal(k.sold, 77880);
  assert.equal(k.bookings, 7);
  assert.equal(k.pax, 24);
  assert.equal(k.avgTicket, 11126, '778,80 / 7 = 111,257…: arrotondato al centesimo');
  assert.equal(k.avgPerPax, 3245, '778,80 / 24 = 32,45');
  assert.equal(k.soldB2b, 29080);
  assert.equal(k.bookingsB2b, 2);
  assert.equal(k.soldB2c, 48800);
  assert.equal(k.bookingsB2c, 5);
  assert.equal(k.avgTicketB2c, 9760);
  assert.equal(k.avgTicketB2b, 14540);
  assert.ok(Math.abs(k.partnerShare - 29080 / 77880) < 1e-12);
  assert.equal(Math.round(k.partnerShare * 1000) / 10, 37.3);

  // incassato / da incassare
  assert.equal(k.paid, 7000 + 6300 + 10080, 'carta pagata: c1, c3, c7');
  assert.equal(k.unpaid, 10500 + 5500 + 14500 + 19000, 'sul posto e fattura: c2, c4 (senza il buono), c5, c6');
  assert.equal(k.gift, 5000);
  assert.equal(k.giftBookings, 1);
  assert.equal(k.paid + k.unpaid + k.gift, k.sold, 'venduto = incassato sulle confermate + da incassare + buoni regalo');
  assert.equal(k.penaltiesKept, 6000 + 7000, 'trattenuto sulle annullate già pagate: c8 (50%) e c9 (nessun rimborso)');
  assert.equal(k.collected, 23380 + 13000, 'incassato = pagato sulle confermate + quota trattenuta');
  assert.equal(k.collected, 36380);

  // sconti
  assert.equal(k.discount, 700 + 500);
  assert.equal(k.promoBookings, 2);

  // annulli: c8, c9, c10, c11 (non c12 in attesa né c13 scaduta)
  assert.equal(k.cancelled, 4);
  assert.ok(Math.abs(k.cancelRate - 4 / 11) < 1e-12);
  assert.equal(Math.round(k.cancelRate * 1000) / 10, 36.4);
  assert.equal(k.refunds, 6000 + 7000);
  assert.equal(k.penalties, 6000 + 7000 + 7000);
  assert.equal(k.penaltiesToBill, 7000, 'solo c10 non aveva pagato: la penale è da fatturare');
  assert.equal(k.penaltiesKept, 13000);
  assert.equal(k.refundsFailed, 0);
  assert.equal(k.leadDays, 38.7, '(36+36+37+38+39+42+43)/7 giorni fra la prenotazione (4 gen) e il servizio');

  // fatturato emesso: 100 + 200 + 50 + 30 − 40; bozze, scartate e fuori periodo escluse
  assert.equal(k.invoiced, 34000);
  assert.equal(k.invoices, 4);
  assert.equal(k.creditNotes, 1);
  assertFinite(r);
});

test('i dettagli sommano sempre al venduto: prodotto, canale, partner, pagamento, lingua, giorno, andamento', () => {
  const r = feb();
  const sold = r.kpi.sold;
  const sum = (list, f = 'cents') => list.reduce((a, x) => a + x[f], 0);
  for (const [name, list] of [['tours', r.tours], ['channels', r.channels], ['payments', r.payments], ['langs', r.langs], ['weekdays', r.weekdays], ['series', r.series.buckets]]) {
    assert.equal(sum(list), sold, `${name}: venduto`);
    assert.equal(sum(list, 'n'), r.kpi.bookings, `${name}: prenotazioni`);
    assert.equal(sum(list, 'pax'), r.kpi.pax, `${name}: persone`);
  }
  assert.equal(r.series.totalCents, sold);
  assert.equal(sum(r.partners.rows) + (r.partners.others?.cents ?? 0), r.kpi.soldB2b);
  assert.equal(r.tours.reduce((a, x) => a + x.share, 0).toFixed(6), '1.000000');

  assert.deepEqual(rows(r.tours), [['shared', 5, 14, 44380], ['half-day', 1, 6, 19000], ['private', 1, 4, 14500]], 'ordinati per venduto');
  assert.deepEqual(r.tours.map((t) => [t.label, t.avg]), [['Tour condiviso', 8876], ['Mezza giornata', 19000], ['Tour privato', 14500]]);
  assert.equal(Math.round(r.tours[0].share * 1000) / 10, 57, '443,80 / 778,80');
  assert.deepEqual(rows(r.channels), [['b2c', 5, 14, 48800], ['b2b', 2, 10, 29080]]);
  assert.deepEqual(r.channels.map((x) => x.label), ['Privati', 'Partner']);
  assert.deepEqual(rows(r.payments), [['onsite', 3, 10, 35500], ['card', 3, 8, 23380], ['invoice', 1, 6, 19000]]);
  assert.deepEqual(r.payments.map((x) => x.label), ['Sul posto', 'Carta', 'Fattura']);
  assert.deepEqual(rows(r.langs, ['key', 'n', 'cents']), [['it', 4, 51000], ['en', 2, 20580], ['es', 1, 6300]]);
  assert.deepEqual(r.langs.map((x) => x.label), ['Italiano', 'English', 'Español']);
  assert.deepEqual(rows(r.weekdays, ['label', 'n', 'cents']), [['Lunedì', 1, 19000], ['Martedì', 3, 27580], ['Mercoledì', 1, 6300], ['Giovedì', 1, 10500], ['Venerdì', 1, 14500], ['Sabato', 0, 0], ['Domenica', 0, 0]]);

  // partner: Alpha (c6) e Bravo (c7); c8 è annullata e non conta
  assert.deepEqual(r.partners.rows.map((p) => [p.label, p.n, p.pax, p.cents, p.avg, p.lastDate]), [['Alpha Viaggi', 1, 6, 19000, 19000, '2027-02-15'], ['Bravo Tours', 1, 4, 10080, 10080, '2027-02-16']]);
  assert.equal(r.partners.others, null);

  // andamento: un giorno per colonna (28 giorni), con i giorni vuoti
  assert.equal(r.series.gran, 'day');
  assert.equal(r.series.buckets.length, 28);
  assert.deepEqual(r.series.buckets[8], { key: '2027-02-09', from: '2027-02-09', to: '2027-02-09', n: 2, pax: 5, cents: 17500 });
  assert.equal(r.series.buckets[0].cents, 0);
  assert.equal(r.series.maxCents, 19000, 'il giorno più alto è il 15 febbraio (190,00)');
});

test('confronto col periodo precedente di pari durata: variazioni in % (e in punti per i tassi)', () => {
  const r = feb();
  const p = r.prevKpi;
  assert.deepEqual([p.bookings, p.pax, p.sold, p.paid, p.unpaid, p.cancelled, p.soldB2b, p.avgTicket, p.avgPerPax, p.collected, p.leadDays], [3, 9, 33000, 7000, 26000, 1, 12000, 11000, 3667, 7000, 11]);
  assert.equal(p.cancelRate, 0.25);
  assert.equal(p.invoiced, 8000, 'una fattura di gennaio');
  const c = r.changes;
  assert.deepEqual(c.sold, { pct: 136, dir: 1 }, '(778,80 − 330,00) / 330,00');
  assert.deepEqual(c.bookings, { pct: 133.3, dir: 1 });
  assert.deepEqual(c.pax, { pct: 166.7, dir: 1 });
  assert.deepEqual(c.avgTicket, { pct: 1.1, dir: 1 });
  assert.deepEqual(c.avgPerPax, { pct: -11.5, dir: -1 });
  assert.deepEqual(c.collected, { pct: 419.7, dir: 1 });
  assert.deepEqual(c.unpaid, { pct: 90.4, dir: 1 });
  assert.deepEqual(c.cancelled, { pct: 300, dir: 1 });
  assert.deepEqual(c.cancelRate, { points: 11.4, dir: 1 }, '36,4% contro 25%: punti percentuali');
  assert.deepEqual(c.partnerShare, { points: 1, dir: 1 });
  assert.deepEqual(c.leadDays, { pct: 251.8, dir: 1 });
  assert.deepEqual(c.invoiced, { pct: 325, dir: 1 }, '340 contro 80');
  for (const key of ['discount', 'gift', 'refunds', 'penalties']) assert.deepEqual(c[key], { pct: null, dir: 1, fromZero: true }, `${key}: prima c'era zero`);

  // la funzione di confronto, nei casi limite
  assert.deepEqual(change(0, 0), { pct: null, dir: 0, fromZero: false });
  assert.deepEqual(change(5, 0), { pct: null, dir: 1, fromZero: true });
  assert.deepEqual(change(0, 5), { pct: -100, dir: -1 });
  assert.deepEqual(change(5, 5), { pct: 0, dir: 0 });
  assert.deepEqual(change(10001, 10000), { pct: 0, dir: 0 }, 'sotto lo 0,05% = invariato');
  assert.equal(change(null, 5), null);
  assert.equal(change(5, null), null);
  assert.deepEqual(change(0.5, 0.25, 'points'), { points: 25, dir: 1 });

  // «Tutto» non ha un periodo precedente: nessuna variazione
  const all = report({ p: 'all' });
  assert.equal(all.prevKpi, null);
  assert.equal(all.period.prev, null);
  assert.ok(Object.values(all.changes).every((x) => x === null));
  assert.equal(all.period.open, true);
  assert.deepEqual([all.period.from, all.period.to], ['2027-01-12', '2027-03-03'], 'dal primo all’ultimo servizio');
  assert.equal(all.kpi.sold, 77880 + 33000 + 7000 + 3500);
});

test('filtri su canale, partner e tour: cifre e dettagli seguono sempre lo stesso insieme di prenotazioni', () => {
  const b2b = feb({ channel: 'b2b' });
  assert.deepEqual([b2b.kpi.bookings, b2b.kpi.sold, b2b.kpi.pax, b2b.kpi.cancelled, b2b.kpi.partnerShare], [2, 29080, 10, 1, 1]);
  assert.deepEqual(rows(b2b.channels, ['key', 'cents']), [['b2b', 29080]]);
  assert.equal(b2b.prevKpi.sold, 12000, 'anche il periodo precedente è filtrato');
  assert.equal(b2b.kpi.collected, 10080 + 6000, 'c7 pagata + quota trattenuta su c8');

  const b2c = feb({ channel: 'b2c' });
  assert.deepEqual([b2c.kpi.bookings, b2c.kpi.sold, b2c.kpi.discount, b2c.kpi.gift, b2c.kpi.cancelled, b2c.kpi.partnerShare], [5, 48800, 1200, 5000, 3, 0]);
  assert.deepEqual(b2c.partners.rows, []);
  assert.equal(b2c.kpi.penaltiesToBill, 7000);

  const al = feb({ partner: String(alpha.id) });
  assert.equal(al.filters.channel, 'b2b');
  assert.deepEqual([al.kpi.bookings, al.kpi.sold, al.kpi.cancelled, al.kpi.refunds, al.kpi.penalties], [1, 19000, 1, 6000, 6000]);
  assert.deepEqual(rows(al.tours), [['half-day', 1, 6, 19000]]);
  const br = feb({ partner: String(bravo.id) });
  assert.deepEqual([br.kpi.bookings, br.kpi.sold, br.kpi.cancelled], [1, 10080, 0]);

  const priv = feb({ tour: 'private' });
  assert.deepEqual([priv.kpi.bookings, priv.kpi.sold, priv.kpi.cancelled, priv.kpi.refunds], [1, 14500, 1, 6000]);
  const shared = feb({ tour: 'shared' });
  assert.deepEqual([shared.kpi.bookings, shared.kpi.sold, shared.kpi.discount, shared.kpi.gift, shared.kpi.cancelled], [5, 44380, 700, 5000, 3]);
  const both = feb({ tour: 'shared', channel: 'b2b' });
  assert.deepEqual([both.kpi.bookings, both.kpi.sold], [1, 10080], 'solo c7: condiviso venduto a un partner');
  assert.deepEqual(rows(feb({ tour: 'half-day', channel: 'b2c' }).tours), [], 'combinazione senza prenotazioni');

  // ogni insieme filtrato torna con i suoi dettagli
  for (const r of [b2b, b2c, al, br, priv, shared, both]) {
    for (const list of [r.tours, r.channels, r.payments, r.langs, r.weekdays, r.series.buckets]) assert.equal(list.reduce((a, x) => a + x.cents, 0), r.kpi.sold);
  }
});

test('base del periodo: data del servizio o data di prenotazione (in ora di Venezia)', () => {
  const service = report({ from: '2027-01-04', to: '2027-01-04' });
  assert.equal(service.kpi.bookings, 0, 'nessun servizio il 4 gennaio');
  const booked = report({ from: '2027-01-04', to: '2027-01-04', basis: 'booking' });
  assert.equal(booked.kpi.bookings, 10, 'c1–c7 e p1–p3 sono state prenotate il 4 gennaio alle 10:00');
  assert.equal(booked.kpi.sold, 77880 + 33000);
  assert.equal(booked.kpi.cancelled, 5, 'c8–c11 e p4');
  assert.equal(booked.kpi.leadDays, 30.4, '(271 + 8 + 9 + 16) giorni / 10 prenotazioni');
  assert.equal(booked.series.gran, 'day');
  assert.equal(booked.series.buckets.length, 1);
  assert.equal(booked.series.buckets[0].cents, 110880);
  assert.equal(booked.weekdays[0].cents, 110880, 'con la base «prenotazione» il giorno della settimana è quello della prenotazione: lunedì');
  assert.equal(booked.weekdays.slice(1).reduce((a, x) => a + x.cents, 0), 0);
  assert.equal(booked.prevKpi.bookings, 0, 'il giorno prima non c’è nulla');

  // l2 è stata prenotata alle 00:30 del 5 gennaio a Venezia (23:30 UTC del 4): è del 5, non del 4
  const l2 = report({ from: '2027-01-05', to: '2027-01-05', basis: 'booking' });
  assert.deepEqual([l2.kpi.bookings, l2.kpi.sold, l2.kpi.leadDays], [1, 3500, 57], 'anticipo: dal 5 gennaio al 3 marzo, non dal 4');
  assert.equal(booked.kpi.bookings + l2.kpi.bookings + report({ from: '2027-01-20', to: '2027-01-20', basis: 'booking' }).kpi.bookings, 12, 'ogni prenotazione confermata cade in un solo giorno');
  const l1 = report({ from: '2027-01-20', to: '2027-01-20', basis: 'booking' });
  assert.deepEqual([l1.kpi.bookings, l1.kpi.sold, l1.kpi.leadDays], [1, 7000, 41]);

  // lo stesso insieme visto per data del servizio: marzo
  const mar = report({ from: '2027-03-01', to: '2027-03-31' });
  assert.deepEqual([mar.kpi.bookings, mar.kpi.sold], [2, 10500]);

  // con la base «prenotazione» le annullate seguono la data di prenotazione, non quella del servizio
  const febBooked = report({ ...FEB, basis: 'booking' });
  assert.deepEqual([febBooked.kpi.bookings, febBooked.kpi.cancelled], [0, 0]);
});

test('base «prenotazione» con l’ora legale: le 00:30 del 15 luglio a Venezia sono le 22:30 UTC del 14', () => {
  const summer = makeApp();
  try {
    const late = createBooking(summer, base({ date: '2027-08-20', time: '09:30', pax: 1 }), localToInstant('2027-07-15', '00:30'));
    assert.equal(late.created_at, '2027-07-14T22:30:00.000Z');
    const run = (day) => statsReport(summer.db, parseFilters({ from: day, to: day, basis: 'booking' }, { nowMs: NOW, tours: [], partners: [] }), { nowMs: NOW });
    assert.deepEqual([run('2027-07-15').kpi.bookings, run('2027-07-14').kpi.bookings, run('2027-07-16').kpi.bookings], [1, 0, 0]);
    assert.equal(run('2027-07-15').kpi.leadDays, 36);
  } finally {
    summer.cleanup();
  }
});

test('arrotondamenti: medie al centesimo (mezzi verso l’alto) e quote con una cifra decimale', () => {
  const r = makeApp();
  try {
    addPromo(r.db, { code: 'UNO', kind: 'fixed', value: 1 });
    createBooking(r, base({ date: '2027-02-10', time: '09:30', pax: 1, email: 'a@example.com' }), NOW);
    createBooking(r, base({ date: '2027-02-11', time: '09:30', pax: 1, promoCode: 'UNO', email: 'b@example.com' }), NOW);
    const rep = statsReport(r.db, parseFilters(FEB, { nowMs: NOW }), { nowMs: NOW, tourTitle });
    assert.equal(rep.kpi.sold, 3500 + 3499);
    assert.equal(rep.kpi.avgTicket, 3500, '6999 / 2 = 3499,5 → 3500');
    assert.equal(rep.kpi.avgPerPax, 3500);
    assert.equal(rep.kpi.discount, 1);
    assert.deepEqual(rep.tours.map((t) => t.avg), [3500]);
    assert.equal(rep.tours[0].share, 1);
    // tre prenotazioni con importi che non dividono: la somma dei dettagli resta esatta
    createBooking(r, base({ date: '2027-02-12', time: '09:30', pax: 1, promoCode: 'UNO', email: 'c@example.com' }), NOW);
    const three = statsReport(r.db, parseFilters(FEB, { nowMs: NOW }), { nowMs: NOW });
    assert.equal(three.kpi.sold, 10498);
    assert.equal(three.kpi.avgTicket, 3499, '10498 / 3 = 3499,33');
    assert.equal(three.tours.reduce((a, t) => a + t.cents, 0), 10498);
    assertFinite(three);
  } finally {
    r.cleanup();
  }
});

test('periodo senza dati: tutto a zero, nessun NaN, elenchi vuoti, andamento con i giorni vuoti', () => {
  const empty = makeApp();
  try {
    for (const q of [{}, { p: 'all' }, { p: 'lastyear' }, { from: '2027-02-01', to: '2027-02-28', basis: 'booking' }]) {
      const r = statsReport(empty.db, parseFilters(q, { nowMs: NOW }), { nowMs: NOW });
      assert.equal(r.empty, true);
      assertFinite(r);
      const k = r.kpi;
      assert.deepEqual([k.sold, k.bookings, k.pax, k.avgTicket, k.avgPerPax, k.collected, k.unpaid, k.discount, k.gift, k.cancelled, k.cancelRate, k.refunds, k.penalties, k.invoiced, k.partnerShare], new Array(15).fill(0));
      assert.equal(k.leadDays, null, 'nessuna prenotazione: nessun anticipo da mostrare');
      assert.deepEqual([r.tours, r.channels, r.payments, r.langs, r.partners.rows], [[], [], [], [], []]);
      assert.equal(r.weekdays.length, 7);
      assert.ok(r.weekdays.every((d) => d.cents === 0 && d.n === 0 && d.share === 0));
      assert.equal(r.series.maxCents, 0);
      assert.ok(r.series.buckets.length >= 1);
      assert.deepEqual(r.portfolio.map((w) => [w.n, w.cents]), [[0, 0], [0, 0], [0, 0]]);
      assert.deepEqual([r.gifts.sold.n, r.gifts.balance.cents, r.gifts.promos.rows.length, r.programs.n], [0, 0, 0, 0]);
    }
    assert.equal(statsReport(empty.db, parseFilters({ p: 'all' }, { nowMs: NOW }), { nowMs: NOW }).period.from, '2027-01-04', '«Tutto» senza prenotazioni: oggi');
  } finally {
    empty.cleanup();
  }
  // un periodo vuoto dentro un database pieno
  const none = report({ from: '2025-01-01', to: '2025-01-31' });
  assert.equal(none.empty, true);
  assertFinite(none);
  assert.equal(none.series.buckets.length, 31);
  assert.equal(none.changes.sold.dir, 0, 'zero contro zero: invariato');
});

test('andamento: passo giornaliero, settimanale, mensile o annuale; estremità tagliate sul periodo; somme esatte', () => {
  assert.deepEqual([1, 45, 46, 200, 201, 365, 6 * 366, 6 * 366 + 1].map(granularityFor), ['day', 'day', 'week', 'week', 'month', 'month', 'month', 'year']);

  const weeks = report({ from: '2027-01-04', to: '2027-03-04' });
  assert.equal(weeks.series.gran, 'week');
  assert.deepEqual(weeks.series.buckets.map((x) => [x.from, x.to, x.cents]), [
    ['2027-01-04', '2027-01-10', 0],
    ['2027-01-11', '2027-01-17', 21000],
    ['2027-01-18', '2027-01-24', 12000],
    ['2027-01-25', '2027-01-31', 0],
    ['2027-02-01', '2027-02-07', 0],
    ['2027-02-08', '2027-02-14', 48800],
    ['2027-02-15', '2027-02-21', 29080],
    ['2027-02-22', '2027-02-28', 0],
    ['2027-03-01', '2027-03-04', 10500], // l'ultima settimana si ferma alla fine del periodo
  ]);
  assert.equal(weeks.series.totalCents, weeks.kpi.sold);

  const midWeek = bucketsOf('2027-01-06', '2027-01-20', 'week');
  assert.deepEqual(midWeek.map((x) => [x.key, x.from, x.to]), [['2027-01-04', '2027-01-06', '2027-01-10'], ['2027-01-11', '2027-01-11', '2027-01-17'], ['2027-01-18', '2027-01-18', '2027-01-20']], 'la prima settimana parte dal periodo, non dal lunedì precedente');

  const year = report({ from: '2027-01-01', to: '2027-12-31' });
  assert.equal(year.series.gran, 'month');
  assert.deepEqual(year.series.buckets.map((x) => x.key), Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(year.series.buckets.slice(0, 4).map((x) => x.cents), [33000, 77880, 10500, 0]);
  assert.equal(year.series.totalCents, year.kpi.sold);
  assert.deepEqual(bucketsOf('2027-01-15', '2027-03-10', 'month').map((x) => [x.from, x.to]), [['2027-01-15', '2027-01-31'], ['2027-02-01', '2027-02-28'], ['2027-03-01', '2027-03-10']]);

  const long = report({ from: '2015-01-01', to: '2027-12-31' }); // oltre 5 anni: si passa agli anni
  assert.equal(long.series.gran, 'year');
  assert.equal(long.series.buckets.length, 13);
  assert.equal(long.series.buckets.at(-1).cents, long.kpi.sold);
  assert.deepEqual(bucketsOf('2026-12-30', '2027-01-02', 'year').map((x) => [x.from, x.to]), [['2026-12-30', '2026-12-31'], ['2027-01-01', '2027-01-02']]);
  assert.equal(bucketsOf('2027-02-01', '2027-02-28', 'day').length, 28);
});

test('portafoglio futuro: confermate da oggi in poi nei prossimi 30, 60 e 90 giorni, senza filtri', () => {
  const r = report({ channel: 'b2b', tour: 'private', from: '2025-01-01', to: '2025-01-31' }); // i filtri non lo toccano
  assert.deepEqual(r.portfolio.map((w) => [w.days, w.to, w.n, w.pax, w.cents]), [
    [30, '2027-02-02', 3, 9, 33000], // p1, p2, p3
    [60, '2027-03-04', 12, 36, 121380], // + c1–c7, l1, l2
    [90, '2027-04-03', 12, 36, 121380],
  ]);
  const later = report({}, localToInstant('2027-02-12', '10:00')); // oggi è il 12 febbraio: c5 (oggi) conta, c1–c4 sono passate
  assert.deepEqual(later.portfolio.map((w) => [w.n, w.cents]), [[5, 14500 + 19000 + 10080 + 7000 + 3500], [5, 14500 + 19000 + 10080 + 7000 + 3500], [5, 14500 + 19000 + 10080 + 7000 + 3500]]);
  assert.equal(later.portfolio[0].to, '2027-03-13');
});

test('buoni regalo e codici sconto: venduti nel periodo, saldo da onorare, uso dei codici', () => {
  const r = feb();
  assert.deepEqual(r.gifts.sold, { n: 2, cents: 13000, webN: 1, webCents: 5000, adminN: 1, adminCents: 8000 }, 'attivati a febbraio; il buono annullato e quello non pagato non contano');
  assert.deepEqual(r.gifts.balance, { n: 2, cents: 11000 }, 'attivi e non scaduti con saldo: 80,00 + 30,00 (il primo buono è stato speso)');
  assert.deepEqual(r.gifts.expired, { n: 1, cents: 2000 });
  assert.deepEqual(r.gifts.promos.rows, [{ code: 'ESTATE10', n: 1, cents: 700 }, { code: 'WELCOME', n: 1, cents: 500 }]);
  assert.equal(r.gifts.promos.cents, r.kpi.discount, 'il dettaglio dei codici coincide con «Sconti concessi»');
  assert.equal(r.gifts.promos.n, r.kpi.promoBookings);

  assert.equal(giftStats(db, { from: '2027-01-01', to: '2027-01-31' }, '2027-01-04').sold.cents, 3000, 'gennaio');
  assert.equal(giftStats(db, null, '2027-01-04').sold.n, 4, 'tutto: i quattro attivati (anche quello di dicembre)');
  assert.deepEqual(giftStats(db, null, '2027-02-01').expired.n, 1);
  assert.deepEqual(giftStats(db, null, '2027-01-01').balance.n, 3, 'il 1° gennaio il buono scade in giornata: ancora valido');
  assert.deepEqual(promoUsage(db, filters({ ...FEB, channel: 'b2b' }), { from: '2027-02-01', to: '2027-02-28' }).rows, [], 'i codici valgono solo per i privati');
  assert.equal(feb({ tour: 'private' }).gifts.promos.rows.length, 1, 'i codici seguono i filtri come il resto delle prenotazioni');
  assert.equal(feb({ tour: 'private' }).gifts.promos.rows[0].code, 'WELCOME');
});

test('programmi di più giorni: confermati e accettati per data della prima giornata', () => {
  const r = feb();
  assert.deepEqual(r.programs, { n: 2, cents: 135000, confirmed: { n: 1, cents: 90000 }, accepted: { n: 1, cents: 45000 }, depositsPaid: 27000 });
  assert.deepEqual(feb({ channel: 'b2b' }).programs, { n: 1, cents: 90000, confirmed: { n: 1, cents: 90000 }, accepted: { n: 0, cents: 0 }, depositsPaid: 27000 });
  assert.deepEqual(feb({ channel: 'b2c' }).programs.n, 1);
  assert.equal(feb({ partner: String(alpha.id) }).programs.cents, 90000);
  assert.equal(feb({ partner: String(bravo.id) }).programs.n, 0);
  assert.equal(feb({ tour: 'shared' }).programs.n, 2, 'i programmi non hanno un tour: il filtro non li tocca');
  assert.equal(feb({ basis: 'booking' }).programs.n, 2, 'né dipendono dalla base');
  assert.deepEqual(report({ from: '2027-01-01', to: '2027-01-31' }).programs, { n: 1, cents: 20000, confirmed: { n: 1, cents: 20000 }, accepted: { n: 0, cents: 0 }, depositsPaid: 0 });
  assert.equal(report({ p: 'all' }).programs.n, 3, 'la proposta solo inviata non conta');
});

test('fatturato emesso: fatture meno note di credito per data di emissione; bozze, scartate e fuori periodo escluse', () => {
  assert.equal(feb().kpi.invoiced, 34000);
  assert.equal(report({ from: '2027-01-01', to: '2027-01-31' }).kpi.invoiced, 8000);
  assert.equal(report({ from: '2027-03-01', to: '2027-03-31' }).kpi.invoiced, 12345);
  assert.equal(report({ p: 'all' }).kpi.invoiced, 34000 + 8000 + 12345);
  assert.equal(feb({ channel: 'b2b', tour: 'private' }).kpi.invoiced, 34000, 'non segue canale, partner e tour');
  assert.equal(feb({ basis: 'booking' }).kpi.invoiced, 34000, 'né la base');
});

test('l’elenco dei filtri: tour del sito più quelli rimasti solo nelle prenotazioni; partner in ordine', () => {
  const o = filterOptions(db, [{ slug: 'shared', title: 'Tour condiviso' }, { slug: 'zeta', title: 'Zeta' }]);
  assert.deepEqual(o.tours.map((t) => t.slug).sort(), ['half-day', 'private', 'shared', 'zeta']);
  assert.equal(o.tours.find((t) => t.slug === 'private').title, 'private', 'tour non più nel sito: lo slug');
  assert.deepEqual(o.partners.map((p) => p.company), ['Alpha Viaggi', 'Bravo Tours']);
});

// ───────────── CSV ─────────────
const parseCsv = (csv) => csv.replace(/^\ufeff/, '').split('\r\n').slice(0, -1).map((l) => l.split(';'));
const money = (c) => (c / 100).toFixed(2).replace('.', ',');
/** Una riga di CSV con «;» e virgolette (raddoppiate dentro i testi tra virgolette). */
function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') (out.push(cur), (cur = ''));
    else cur += ch;
  }
  return [...out, cur];
}

test('CSV: BOM, a capo \\r\\n, «;» e virgola decimale, una riga per prenotazione, stessi filtri della pagina', () => {
  const csv = bookingsCsv(db, filters(FEB), { nowMs: NOW, tourTitle });
  assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM UTF-8');
  assert.ok(csv.endsWith('\r\n') && !/[^\r]\n/.test(csv), 'a capo \\r\\n');
  const table = parseCsv(csv);
  assert.deepEqual(table[0], CSV_HEAD);
  assert.equal(CSV_HEAD.length, 19);
  assert.deepEqual(CSV_HEAD.slice(0, 4), ['Riferimento', 'Data servizio', 'Ora', 'Tour']);
  assert.equal(table.length - 1, 13, 'c1–c13: ogni stato, anche annullate, in attesa e scadute');
  assert.ok(table.every((row) => row.length === 19));
  const byRef = Object.fromEntries(table.slice(1).map((row) => [row[0], row]));
  const c4 = byRef[b.c4.ref];
  assert.deepEqual(c4, [b.c4.ref, '2027-02-11', '09:30', 'Tour condiviso', 'Privato', '', '3', '105,00', '0,00', '50,00', '105,00', '55,00', 'Sul posto', 'Da incassare', 'Confermata', '0,00', '0,00', 'Italiano', '2027-01-04']);
  const c3 = byRef[b.c3.ref];
  assert.deepEqual([c3[7], c3[8], c3[10], c3[11], c3[12], c3[13], c3[17]], ['70,00', '7,00', '63,00', '63,00', 'Carta', 'Pagata', 'Español']);
  const c8 = byRef[b.c8.ref];
  assert.deepEqual([c8[3], c8[4], c8[5], c8[10], c8[13], c8[14], c8[15], c8[16]], ['Tour privato', 'Partner', 'Alpha Viaggi', '120,00', 'Rimborsata', 'Annullata', '60,00', '60,00']);
  assert.deepEqual([byRef[b.c12.ref][14], byRef[b.c13.ref][14]], ['In attesa di pagamento', 'Scaduta']);
  assert.deepEqual([byRef[b.c10.ref][13], byRef[b.c10.ref][16]], ['Da incassare', '70,00'], 'penale da fatturare');

  // le cifre tornano con la pagina
  const confirmed = table.slice(1).filter((row) => row[14] === 'Confermata');
  assert.equal(confirmed.length, 7);
  const cents = (s) => Math.round(Number(s.replace(',', '.')) * 100);
  const r = feb();
  assert.equal(confirmed.reduce((a, row) => a + cents(row[10]), 0), r.kpi.sold, 'somma dei totali delle confermate = venduto');
  assert.equal(confirmed.reduce((a, row) => a + cents(row[11]), 0), r.kpi.paid + r.kpi.unpaid, 'somma di «da pagare» = incassato + da incassare sulle confermate');
  assert.equal(confirmed.reduce((a, row) => a + Number(row[6]), 0), r.kpi.pax);
  assert.equal(table.slice(1).filter((row) => row[14] === 'Annullata').reduce((a, row) => a + cents(row[15]), 0), r.kpi.refunds);
  assert.equal(table.slice(1).filter((row) => row[14] === 'Annullata').reduce((a, row) => a + cents(row[16]), 0), r.kpi.penalties);
  // ordine: per data e ora del servizio
  assert.deepEqual(table.slice(1).map((row) => row[1] + row[2]), [...table.slice(1).map((row) => row[1] + row[2])].sort());

  // filtri
  const csvOf = (q) => parseCsv(bookingsCsv(db, filters(q), { nowMs: NOW, tourTitle })).slice(1);
  assert.deepEqual(csvOf({ ...FEB, channel: 'b2b' }).map((row) => row[0]).sort(), [b.c6.ref, b.c7.ref, b.c8.ref].sort());
  assert.deepEqual(csvOf({ ...FEB, partner: String(bravo.id) }).map((row) => row[0]), [b.c7.ref]);
  assert.deepEqual(csvOf({ ...FEB, tour: 'private' }).map((row) => row[0]).sort(), [b.c5.ref, b.c8.ref].sort());
  assert.equal(csvOf({ from: '2027-01-01', to: '2027-01-31' }).length, 4, 'gennaio: p1–p4');
  assert.deepEqual(csvOf({ from: '2027-01-05', to: '2027-01-05', basis: 'booking' }).map((row) => [row[0], row[18]]), [[b.l2.ref, '2027-01-05']], 'data di prenotazione in ora di Venezia');
  assert.equal(csvOf({ p: 'all' }).length, 13 + 4 + 2);
  assert.equal(parseCsv(bookingsCsv(db, filters({ from: '2025-01-01', to: '2025-01-31' }), { nowMs: NOW })).length, 1, 'nessuna prenotazione: solo l’intestazione');
  assert.equal(money(0), '0,00');
});

test('CSV: i testi inseriti da chiunque non si eseguono come formule e i separatori si proteggono', () => {
  const x = makeApp();
  try {
    const evil = addAccount(x.db, { email: 'e1@example.com', company: '=HYPERLINK("http://evil.example";"clic")' });
    const quoted = addAccount(x.db, { email: 'e2@example.com', company: 'Rossi; "Figli" srl' });
    const plus = addAccount(x.db, { email: 'e3@example.com', company: '+39 Viaggi' });
    const minus = addAccount(x.db, { email: 'e4@example.com', company: '-1 Tour' });
    const at = addAccount(x.db, { email: 'e5@example.com', company: '@somma' });
    let day = 8;
    for (const a of [evil, quoted, plus, minus, at]) createBooking(x, base({ date: `2027-02-${String(day++).padStart(2, '0')}`, time: '09:30', channel: 'b2b', account: a, paymentMethod: 'invoice', email: `b${day}@example.com` }), NOW);
    const csv = bookingsCsv(x.db, parseFilters(FEB, { nowMs: NOW }), { nowMs: NOW, tourTitle: () => '=1+1' });
    const lines = csv.replace(/^\ufeff/, '').split('\r\n');
    const partners = lines.slice(1, 6).map((l) => splitRow(l));
    assert.deepEqual(partners.map((row) => row.length), [19, 19, 19, 19, 19], 'le virgolette tengono insieme i «;» dentro un testo');
    assert.deepEqual(
      partners.map((row) => row[5]),
      ['\'=HYPERLINK("http://evil.example";"clic")', 'Rossi; "Figli" srl', "'+39 Viaggi", "'-1 Tour", "'@somma"],
      'un apice davanti ai testi che iniziano con = + - @; virgolette e punti e virgola restano interi',
    );
    assert.deepEqual(partners.map((row) => row[3]), new Array(5).fill("'=1+1"), 'anche il nome del tour');
    assert.ok(lines[2].includes('"Rossi; ""Figli"" srl"'), 'virgolette raddoppiate');
  } finally {
    x.cleanup();
  }
});

// ───────────── la pagina ─────────────
const ctx = { app, req: {} };
const page = (query = {}, nowMs = NOW) => {
  const f = filters(query, nowMs);
  const options = filterOptions(db, Object.entries(TITLES).map(([slug, title]) => ({ slug, title })));
  return clean(statsPage(ctx, { report: statsReport(db, f, { nowMs, tourTitle }), options }));
};

test('la pagina mostra le cifre del report con formatMoney, i grafici SVG con alternativa in tabella e nessun NaN', () => {
  const html = page(FEB);
  for (const [text, what] of [['778,80 €', 'venduto'], ['32,45 €', 'valore medio per persona'], ['363,80 €', 'incassato'], ['495 €', 'da incassare'], ['12 €', 'sconti'], ['50 €', 'pagato con buoni regalo'], ['340 €', 'fatturato emesso'], ['111,26 €', 'scontrino medio'], ['130 €', 'rimborsi'], ['200 €', 'penali']]) {
    assert.ok(html.includes(text), `manca «${text}» (${what})`);
  }
  assert.ok(html.includes('97,60 €') && html.includes('145,40 €'), 'scontrino medio dei privati e dei partner');
  assert.ok(html.includes('+136%'), 'variazione del venduto');
  assert.match(html, /36,4%/);
  assert.match(html, /\+11,4 pt/, 'il tasso di annullo cambia in punti');
  assert.match(html, /Nessun codice|ESTATE10/);
  assert.ok(html.includes('Tour condiviso') && html.includes('Mezza giornata') && html.includes('Alpha Viaggi'));
  assert.ok(html.includes('href="/admin/partners/' + alpha.id + '"'));
  assert.ok(html.includes('Dal modulo Fatture; include IVA se presente'));
  assert.ok(html.includes('<link rel="stylesheet" href="/css/admin-stats.css?v='));
  assert.ok(html.includes('class="st-svg st-svg-narrow"') && html.includes('class="st-svg st-svg-wide"'));
  for (const svg of html.match(/<svg class="st-svg [^>]*>/g)) assert.ok(/role="img"/.test(svg) && /aria-label="[^"]{20,}"/.test(svg), svg);
  assert.ok((html.match(/<details class="st-details">/g) ?? []).length >= 2, 'tabella equivalente dentro un <details>');
  assert.ok(html.includes('<title>Giovedì') || html.includes('<title>giovedì'), 'suggerimenti sulle colonne');
  for (const bad of ['NaN', 'undefined', 'Infinity', '[object', 'null%']) assert.ok(!html.includes(bad), `la pagina contiene «${bad}»`);
  assert.ok(!/<[a-z][^>]*\sstyle=/i.test(html), 'la CSP vieta gli stili in linea');
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>[^<]/i.test(html), 'la CSP vieta gli script in linea');
});

test('la pagina: filtri mantenuti nei link, periodo selezionato, periodo vuoto con messaggio chiaro, testi dei clienti escapati', () => {
  const html = page({ p: 'd30', basis: 'booking', channel: 'b2b', tour: 'shared' });
  assert.ok(html.includes('<a href="/admin/stats?basis=booking&amp;channel=b2b&amp;tour=shared" >Ultimi 90 giorni</a>') || html.includes('href="/admin/stats?basis=booking&amp;channel=b2b&amp;tour=shared"'), 'i preset mantengono gli altri filtri');
  assert.ok(html.includes('href="/admin/stats?p=month&amp;basis=booking&amp;channel=b2b&amp;tour=shared"'));
  assert.match(html, /<a href="[^"]*p=d30[^"]*" aria-current="page">Ultimi 30 giorni<\/a>/);
  assert.ok(html.includes('href="/admin/stats.csv?p=d30&amp;basis=booking&amp;channel=b2b&amp;tour=shared"'), 'il CSV usa gli stessi filtri');
  assert.ok(/<option value="booking" selected>/.test(html) && /<option value="b2b" selected>/.test(html) && /<option value="shared" selected>/.test(html));
  assert.ok(html.includes('<details class="st-adv" open>'), 'con filtri attivi la sezione si apre da sola');
  assert.ok(!page({}).includes('<details class="st-adv" open>'));
  assert.ok(html.includes('<input type="hidden" name="p" value="d30">'));

  const custom = page({ from: '2027-02-01', to: '2027-02-28' });
  assert.ok(custom.includes('name="from" value="2027-02-01"') && custom.includes('name="to" value="2027-02-28"'));
  assert.ok(!custom.includes('name="p"'), 'periodo personalizzato: niente periodo predefinito nascosto');
  assert.ok(custom.includes('Periodo <strong>1 feb 2027 – 28 feb 2027</strong> (28 giorni)'));
  assert.ok(custom.includes('<strong>4 gen 2027 – 31 gen 2027</strong>'), 'si dice con quale periodo si confronta');
  assert.ok(page({ p: 'all' }).includes('non c’è un periodo precedente'));

  const empty = page({ from: '2025-01-01', to: '2025-01-31' });
  assert.ok(empty.includes('Nessuna prenotazione nel periodo'));
  for (const bad of ['NaN', 'undefined', 'Infinity']) assert.ok(!empty.includes(bad), bad);
  assert.ok(empty.includes('<dd class="st-kpi-value">0 €</dd>'));
  assert.ok(empty.includes('—'), 'anticipo medio: un trattino, non un numero inventato');
  assert.ok(!/class="st-svg/.test(empty), 'senza prenotazioni niente grafico vuoto');

  assert.ok(page({ from: '2027-03-01', to: '2027-02-01' }).includes('Le date indicate non sono valide'));

  const html2 = clean(statsPage(ctx, { report: { ...statsReport(db, filters(FEB), { nowMs: NOW, tourTitle: (s) => `<img src=x onerror=alert(1)> ${s}` }) }, options: { tours: [], partners: [] } }));
  assert.ok(!html2.includes('<img src=x'), 'i nomi dei tour sono escapati');
  assert.ok(html2.includes('&lt;img src=x'));
});

test('asse del grafico: scale tonde e importi leggibili', () => {
  assert.deepEqual(niceScale(245850), { step: 100000, max: 300000, ticks: [0, 100000, 200000, 300000] });
  assert.deepEqual(niceScale(590040), { step: 200000, max: 600000, ticks: [0, 200000, 400000, 600000] });
  assert.deepEqual(niceScale(0), { step: 100, max: 100, ticks: [0, 100] });
  assert.deepEqual(niceScale(7000).ticks, [0, 2000, 4000, 6000, 8000]);
  assert.deepEqual(niceScale(100).ticks, [0, 100]);
  assert.deepEqual(niceScale(12000000).ticks, [0, 5000000, 10000000, 15000000]);
  for (const max of [1, 99, 150, 777, 1234567]) {
    const s = niceScale(max);
    assert.ok(s.max >= max && s.ticks.length >= 2 && s.ticks.length <= 7, `${max}: ${JSON.stringify(s)}`);
  }
  assert.deepEqual([0, 50000, 100000, 150000, 250000, 1200000].map(tickLabel), ['0', '500', '1k', '1,5k', '2,5k', '12k']);
});

// ───────────── HTTP ─────────────
const tmp = path.join(ROOT, 'data', 'test-stats-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const content = loadContentWithFixedServices(ROOT);
const day = (n) => addDays(nowRome().date, n);

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp, adminPassword: 'segreto-admin', baseUrl: 'http://localhost', mail: { notifyTo: 'guida@example.com' }, policy: { allowPayOnSite: true }, demoPayments: true });
  const { app: a, server } = createApp({ cfg, db: openDb(':memory:'), content });
  const http = await new Promise((resolve) => {
    const s = server.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    return async (p, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(baseUrl + p, { redirect: 'manual', ...init, headers });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        const val = kv.slice(i + 1);
        if (/Max-Age=0/i.test(c) || !val) cookies.delete(kv.slice(0, i));
        else cookies.set(kv.slice(0, i), val);
      }
      return res;
    };
  };
  return { app: a, jar, close: () => { a.close(); http.close(); } };
}
const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(obj).toString() });

test('HTTP: pagina e CSV solo per l’admin; con dati veri rispondono 200 senza NaN; parametri malformati non rompono nulla', async () => {
  const s = await start();
  try {
    const f = s.jar();
    // senza accesso: tutto rimanda al login
    for (const p of ['/admin/stats', '/admin/stats.csv', '/admin/stats?p=all', '/admin/stats.csv?p=all']) {
      const res = await f(p);
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.get('location'), '/admin/login', p);
    }
    assert.equal((await f('/admin/login', form({ password: 'segreto-admin' }))).status, 303);

    // dati: privati e partner, carta e fattura, un annullo, un codice sconto (date relative a oggi: il periodo le comprende sempre)
    const acct = addAccount(s.app.db, { company: '<b>Rossi</b> & Figli', discount_percent: 5 });
    addPromo(s.app.db, { code: 'WEB10', kind: 'percent', value: 10 });
    const a = createBooking(s.app, tourBooking({ date: day(10), pax: 3, paymentMethod: 'card', promoCode: 'WEB10' }));
    confirmPaid(s.app, a.id, 'pi_1');
    createBooking(s.app, tourBooking({ date: day(12), time: '14:30', pax: 2, email: 'b@example.com', lang: 'en' }));
    createBooking(s.app, tourBooking({ tourSlug: 'passeggiata-privata-2h', date: day(14), time: '10:00', pax: 4, channel: 'b2b', account: acct, paymentMethod: 'invoice', email: 'c@example.com' }));
    const cx = createBooking(s.app, tourBooking({ date: day(15), pax: 2, email: 'd@example.com', paymentMethod: 'card' }));
    confirmPaid(s.app, cx.id, 'pi_2');
    await s.app.services.cancel(cx.id, { by: 'admin', refund: 'none' });
    const range = `from=${day(0)}&to=${day(30)}`;

    const res = await f(`/admin/stats?${range}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = clean(await res.text());
    assert.ok(html.includes('Statistiche e KPI') && html.includes('Venduto') && html.includes('Portafoglio futuro'));
    assert.ok(html.includes('Prossimi 30 giorni') && html.includes('Buoni regalo e codici sconto') && html.includes('Programmi di più giorni'));
    assert.ok(html.includes('&lt;b&gt;Rossi&lt;/b&gt; &amp; Figli'), 'il nome del partner è escapato');
    assert.ok(!html.includes('<b>Rossi</b>'));
    assert.ok(html.includes('WEB10') && html.includes('San Marco e Rialto'), 'codice sconto e nome del tour');
    for (const bad of ['NaN', 'undefined', 'Infinity', '[object']) assert.ok(!html.includes(bad), `la pagina contiene «${bad}»`);
    assert.ok(!/<[a-z][^>]*\sstyle=/i.test(html) && !/<script(?![^>]*\ssrc=)[^>]*>[^<]/i.test(html), 'la CSP vieta stili e script in linea');
    assert.match(res.headers.get('content-security-policy'), /style-src 'self'/);
    assert.equal((await f('/css/admin-stats.css')).status, 200, 'il foglio di stile della pagina è servito');
    assert.match(await (await f('/css/admin-stats.css')).text(), /\.st-kpi/);
    const sold = s.app.db.prepare(`SELECT SUM(total_cents) AS cents FROM bookings WHERE status = 'confirmed'`).get().cents;
    assert.ok(html.includes(`<dd class="st-kpi-value">${clean(formatMoney(sold, 'it'))}</dd>`), 'il venduto della pagina è la somma delle prenotazioni confermate');

    // la voce di menu porta alla pagina
    assert.ok((await (await f('/admin/invoices')).text()).includes('href="/admin/stats"'));

    // tutti i periodi, basi e canali
    for (const q of ['', '?p=month', '?p=lastmonth', '?p=d30', '?p=d90', '?p=year', '?p=lastyear', '?p=all', '?p=all&basis=booking', '?basis=booking&channel=b2b', '?channel=b2c&p=year', `?partner=${acct.id}&p=all`, '?tour=san-marco-rialto&p=all', '?from=2020-01-01&to=2030-12-31', '?from=2000-01-01&to=2100-12-31', `?from=${day(10)}&to=${day(10)}`, '?from=2020-01-01&to=2020-01-31']) {
      const r = await f(`/admin/stats${q}`);
      assert.equal(r.status, 200, q);
      const body = await r.text();
      for (const bad of ['NaN', 'undefined', 'Infinity']) assert.ok(!body.includes(bad), `${q}: «${bad}»`);
      assert.equal((await f(`/admin/stats.csv${q}`)).status, 200, q);
    }

    // parametri malformati: mai un errore
    const nasty = [
      '?p=<script>alert(1)</script>', '?from=abc&to=2027-99-99', '?from=2027-03-01&to=2027-02-01', '?from=2027-02-01', "?basis='; DROP TABLE bookings;--", '?channel[]=b2b&channel[]=b2c',
      '?partner=1%3BDROP', `?partner[]=${acct.id}`, '?tour=../../etc/passwd', `?tour=${'x'.repeat(6000)}`, '?p=month&p=year&p=all', '?from=%00&to=%FF', '?partner=9999999999999999999999', '?tour[a]=b&p[b]=c',
      '?from=2027-02-01&from=2027-03-01&to=2027-04-01', '?p=custom', '?p=', '?&&&', '?basis=booking&basis=service',
    ];
    for (const q of nasty) {
      const r = await f(`/admin/stats${q}`);
      assert.equal(r.status, 200, q);
      const body = await r.text();
      assert.ok(!body.includes('<script>alert'), q);
      for (const bad of ['NaN', 'undefined']) assert.ok(!body.includes(bad), `${q}: «${bad}»`);
      assert.equal((await f(`/admin/stats.csv${q}`)).status, 200, q);
    }
    for (const q of ['?from=abc&to=2027-99-99', '?from=2027-03-01&to=2027-02-01']) assert.ok((await (await f(`/admin/stats${q}`)).text()).includes('Le date indicate non sono valide'), q);
    assert.ok(!(await (await f('/admin/stats?p=year')).text()).includes('Le date indicate non sono valide'));
    assert.equal((await f('/admin/stats', { method: 'POST' })).status, 404, 'nessuna scrittura da qui');

    // CSV
    const csv = await f(`/admin/stats.csv?${range}`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.equal(csv.headers.get('content-disposition'), `attachment; filename="prenotazioni-${day(0)}_${day(30)}.csv"`);
    assert.equal(csv.headers.get('cache-control'), 'no-store');
    const raw = Buffer.from(await csv.arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 (fetch lo toglie dal testo: si guardano i byte)');
    const lines = raw.toString('utf8').replace(/^\ufeff/, '').split('\r\n');
    assert.equal(lines[0], CSV_HEAD.join(';'));
    assert.equal(lines.length, 1 + 4 + 1, 'intestazione, quattro prenotazioni, riga finale vuota');
    assert.ok(lines.some((l) => l.includes('Rossi') && l.includes('Partner')));
    assert.ok(lines.some((l) => l.includes('Annullata')));
    assert.match((await f('/admin/stats.csv?p=all')).headers.get('content-disposition'), /filename="prenotazioni-tutto\.csv"/);
    const partnersOnly = (await (await f(`/admin/stats.csv?${range}&channel=b2b`)).text()).split('\r\n');
    assert.equal(partnersOnly.length, 1 + 1 + 1, 'solo la prenotazione del partner');
  } finally {
    s.close();
  }
});

/** Prenotazione sui tour veri del sito (san-marco-rialto: partenze alle 09:30 e alle 14:30, 35 € a persona). */
function tourBooking(over = {}) {
  return base({ tourSlug: 'san-marco-rialto', time: '09:30', email: 'a@example.com', ...over });
}
