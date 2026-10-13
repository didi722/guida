// Condizioni dedicate ai partner: listino per partner e politica di annullo a scaglioni (rimborsi parziali, penali, fatture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancellationState, confirmPaid, createBooking, freeCancelHours } from '../server/bookings.js';
import { createDrafts, invoiceQueue } from '../server/invoices.js';
import { MAX_TIERS, accountTiers, parseTiers, policyFor, refundPercentAt, splitAmounts, validateTiers } from '../server/policy.js';
import { isSimplePolicy, tierSentences } from '../server/policyText.js';
import { makeT } from '../server/i18n.js';
import { accountPrices, unitPriceFor } from '../server/pricing.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const HOUR = 3600_000;
const TIERS = JSON.stringify([{ hours: 168, refund: 100 }, { hours: 72, refund: 50 }]);
const tour = { slug: 'shared', audience: 'b2b', priceCents: 2800, model: 'person' }; // tour B2B: un solo prezzo, la tariffa agenzie
const DATE = '2027-02-20'; // lontano da NOW (4 gennaio 2027)
const START = localToInstant(DATE, '09:30');

test('listino dedicato: il prezzo del partner vince; senza, tariffa B2B meno lo sconto; ai privati nulla cambia', () => {
  const acct = { discount_percent: 10, prices_json: JSON.stringify({ shared: 2400, other: 100, bad: -5, text: 'x' }) };
  assert.equal(unitPriceFor(tour, 'b2b', acct), 2400, 'prezzo dedicato, senza sconto in più');
  assert.equal(unitPriceFor({ ...tour, slug: 'senza' }, 'b2b', acct), 2800, '28 € − 10% = 25,20 € → 30 € supera la tariffa B2B: si resta a 28 €');
  assert.equal(unitPriceFor({ ...tour, slug: 'senza' }, 'b2b', { ...acct, discount_percent: 20 }), 2500, '28 € − 20% = 22,40 € → 25 €');
  assert.equal(unitPriceFor({ ...tour, audience: 'b2c', priceCents: 3500 }, 'b2c', acct), 3500, 'il listino non tocca i privati');
  assert.deepEqual(accountPrices(acct), { shared: 2400, other: 100 }, 'valori non validi scartati');
  assert.deepEqual(accountPrices({ prices_json: '{rotto' }), {}, 'JSON rovinato: nessun prezzo dedicato, nessun errore');
  assert.equal(unitPriceFor(tour, 'b2b', { prices_json: JSON.stringify({ shared: 0 }) }), 0, 'anche gratuito è un prezzo valido');
  assert.equal(unitPriceFor(tour, 'b2b', null), 2800);
});

test('scaglioni: validazione, ordine, percentuale di rimborso nel tempo', () => {
  assert.deepEqual(validateTiers([]), { tiers: null, error: null }, 'nessuna riga = predefinito del sito');
  assert.deepEqual(validateTiers([{ hours: '', refund: '' }]).tiers, null);
  assert.deepEqual(validateTiers([{ hours: 72, refund: 50 }, { hours: 168, refund: 100 }]).tiers, [{ hours: 168, refund: 100 }, { hours: 72, refund: 50 }], 'si ordinano per preavviso');
  assert.deepEqual(validateTiers([{ hours: 72, refund: 100 }, { hours: 24, refund: 0 }]).tiers, [{ hours: 72, refund: 100 }], 'una riga allo 0% non serve: è ciò che succede dopo');
  for (const [rows, error] of [
    [[{ hours: 72, refund: 40 }, { hours: 24, refund: 60 }], 'order'],
    [[{ hours: 72, refund: 50 }, { hours: 72, refund: 40 }], 'duplicate'],
    [[{ hours: 'x', refund: 50 }], 'hours'],
    [[{ hours: 72, refund: '' }], 'hours'],
    [[{ hours: 3000, refund: 50 }], 'hours'],
    [[{ hours: -1, refund: 50 }], 'hours'],
    [[{ hours: 72, refund: 101 }], 'refund'],
    [[{ hours: 72, refund: 12.5 }], 'refund'],
    [Array.from({ length: MAX_TIERS + 1 }, (_, i) => ({ hours: 100 - i, refund: 100 - i })), 'count'],
  ]) assert.equal(validateTiers(rows).error, error, JSON.stringify(rows));

  const tiers = parseTiers(TIERS);
  assert.equal(refundPercentAt(tiers, START, START - 200 * HOUR), 100);
  assert.equal(refundPercentAt(tiers, START, START - 168 * HOUR), 100, 'al limite vale ancora lo scaglione');
  assert.equal(refundPercentAt(tiers, START, START - 100 * HOUR), 50);
  assert.equal(refundPercentAt(tiers, START, START - 72 * HOUR), 50);
  assert.equal(refundPercentAt(tiers, START, START - 71 * HOUR), 0);
  assert.equal(refundPercentAt(tiers, START, START + 1), 0, 'a servizio iniziato non si rimborsa');
  assert.equal(parseTiers('boh'), null);
  assert.equal(parseTiers(null), null);
  assert.deepEqual(splitAmounts({ paidCents: 10000, dueCents: 10000 }, 50), { refundCents: 5000, retainedCents: 5000 });
  assert.deepEqual(splitAmounts({ paidCents: 0, dueCents: 10000 }, 50), { refundCents: 0, retainedCents: 5000 }, 'chi non ha pagato deve la penale');
  assert.deepEqual(splitAmounts({ paidCents: 0, dueCents: 10000 }, 100), { refundCents: 0, retainedCents: 0 });
  assert.deepEqual(splitAmounts({ paidCents: 3333, dueCents: 3333 }, 50), { refundCents: 1667, retainedCents: 1666 }, 'arrotondamento: rimborso + trattenuto = pagato');
});

test('politica per canale: privati (ore del tour o predefinite), partner (scaglioni, ore singole di un tempo, predefinito)', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const { cfg } = app;
  assert.deepEqual(policyFor(cfg, { cancelHours: null }, 'b2c'), [{ hours: 48, refund: 100 }]);
  assert.deepEqual(policyFor(cfg, { cancelHours: 96 }, 'b2c'), [{ hours: 96, refund: 100 }]);
  assert.deepEqual(accountTiers(cfg, {}), [{ hours: 72, refund: 100 }], 'predefinito B2B');
  assert.deepEqual(accountTiers(cfg, { cancel_hours: 120 }), [{ hours: 120, refund: 100 }], 'vecchie ore singole');
  assert.deepEqual(accountTiers(cfg, { cancel_hours: 120, cancel_policy_json: TIERS }), [{ hours: 168, refund: 100 }, { hours: 72, refund: 50 }], 'gli scaglioni vincono');
  assert.equal(freeCancelHours(cfg, tour, 'b2b', { cancel_policy_json: TIERS }), 168);
  assert.equal(freeCancelHours(cfg, tour, 'b2b', { cancel_policy_json: JSON.stringify([{ hours: 48, refund: 50 }]) }), 0, 'senza rimborso totale non c’è periodo gratuito');
  assert.equal(isSimplePolicy([{ hours: 48, refund: 100 }]), true);
  assert.equal(isSimplePolicy(parseTiers(TIERS)), false);
  const it = tierSentences(makeT('it'), 'it', parseTiers(TIERS), START).join(' ');
  assert.match(it, /Rimborso totale fino al 13 feb 2027, 09:30\./);
  assert.match(it, /Rimborso del 50% fino al 17 feb 2027, 09:30\./);
  assert.match(it, /Dopo: nessun rimborso\./);
  assert.match(tierSentences(makeT('es'), 'es', parseTiers(TIERS), START).join(' '), /Reembolso del 50% hasta el/);
});

test('prenotazione di un partner: la politica del partner si conserva nella prenotazione; modificarla dopo non la cambia', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { cancel_policy_json: TIERS, prices_json: JSON.stringify({ 'shared-agenzie': 2400 }) });
  const b = createBooking(app, base({ date: DATE, channel: 'b2b', account: acct, paymentMethod: 'invoice', pax: 4 }), NOW);
  assert.equal(b.total_cents, 9600, '4 × 24 € dal listino dedicato');
  assert.equal(b.cancel_policy_json, TIERS.replace(/\s/g, ''));
  assert.equal(Date.parse(b.free_cancel_until), START - 168 * HOUR, 'fine del periodo gratuito = scaglione al 100%');
  app.db.prepare('UPDATE accounts SET cancel_policy_json = NULL, cancel_hours = 1 WHERE id = ?').run(acct.id);
  assert.equal(cancellationState(b, START - 100 * HOUR).percent, 50, 'la prenotazione ha ancora i suoi scaglioni');
  const priv = createBooking(app, base({ date: DATE, time: '14:30', email: 'p@example.com' }), NOW);
  const privStart = localToInstant(DATE, '14:30');
  assert.equal(cancellationState(priv, privStart - 49 * HOUR).percent, 100, 'privati: 48 ore, rimborso totale');
  assert.equal(cancellationState(priv, privStart - 47 * HOUR).percent, 0, 'dentro le 48 ore: niente');
  assert.equal(isSimplePolicy(cancellationState(priv, privStart).tiers), true);
});

test('annullo a scaglioni: partner a fattura → penale; carta → rimborso parziale e quota trattenuta; tutto compare in «Da fatturare»', async (t) => {
  const app = makeApp({ invoice: { seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } }, site: { vatNumber: 'IT12345678903' } });
  t.after(app.cleanup);
  const acct = addAccount(app.db, { cancel_policy_json: TIERS, discount_percent: 0 });
  // servizio privato (a gruppo, 120 € per i partner), un giorno diverso per ogni prova
  const make = (n, over = {}) => createBooking(app, base({ tourSlug: 'private', date: `2027-02-${String(20 + n).padStart(2, '0')}`, time: '10:00', channel: 'b2b', account: acct, pax: 5, email: `p${n}@example.com`, ...over }), NOW);
  const startOf = (b) => localToInstant(b.date, b.start_time);
  const row = (id) => app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);

  // a fattura: a 100 ore dal servizio si è nello scaglione al 50% → penale del 50%
  const inv = make(0, { paymentMethod: 'invoice' });
  assert.equal(inv.total_cents, 12000);
  let res = await app.services.cancel(inv.id, { by: 'admin' }, startOf(inv) - 100 * HOUR);
  assert.equal(res.refundCents, 0);
  assert.equal(row(inv.id).cancel_percent, 50);
  assert.equal(row(inv.id).retained_cents, 6000, 'penale: metà di 120 €');
  assert.ok(app.mail.sent.some((m) => m.to === 'p0@example.com' && /penale/.test(m.text)), 'l’email dice che si applica una penale');

  // più di 7 giorni prima: nessuna penale
  const free = make(1, { paymentMethod: 'invoice' });
  await app.services.cancel(free.id, { by: 'admin' }, startOf(free) - 200 * HOUR);
  assert.equal(row(free.id).retained_cents, 0);

  // oltre l'ultimo scaglione, con «secondo la politica»: penale per l'intero importo
  const late = make(2, { paymentMethod: 'invoice' });
  await app.services.cancel(late.id, { by: 'admin' }, startOf(late) - 10 * HOUR);
  assert.equal(row(late.id).retained_cents, 12000);
  assert.equal(row(late.id).cancel_percent, 0);

  // «rimborso totale» scelto dall'admin: nessuna penale, anche se la politica ne prevederebbe una
  const waived = make(3, { paymentMethod: 'invoice' });
  await app.services.cancel(waived.id, { by: 'admin', refund: 'full' }, startOf(waived) - 5 * HOUR);
  assert.equal(row(waived.id).retained_cents, 0);
  // «nessun rimborso»: penale totale
  const harsh = make(4, { paymentMethod: 'invoice' });
  await app.services.cancel(harsh.id, { by: 'admin', refund: 'none' }, startOf(harsh) - 300 * HOUR);
  assert.equal(row(harsh.id).retained_cents, 12000);

  // pagata con carta (dal partner): rimborso parziale
  const card = make(5, { paymentMethod: 'card' });
  confirmPaid(app, card.id, 'pi_x', NOW);
  res = await app.services.cancel(card.id, { by: 'customer' }, startOf(card) - 100 * HOUR);
  assert.equal(res.refundCents, 6000, 'metà di 120 €');
  assert.equal(row(card.id).payment_status, 'refunded');
  assert.equal(row(card.id).refund_cents, 6000);
  assert.equal(row(card.id).retained_cents, 6000);
  assert.ok(app.mail.sent.some((m) => m.to === 'p5@example.com' && /parziale/i.test(m.text)), 'email di rimborso parziale');

  // coda delle fatture: le penali compaiono con l'importo giusto
  const queue = invoiceQueue(app, localToInstant('2027-03-30', '10:00'));
  const penalties = queue.filter((q) => /Penale di annullo/.test(q.description));
  assert.deepEqual(penalties.map((p) => p.amountCents).sort((a, b) => a - b), [6000, 6000, 12000, 12000], 'fattura al 50% + carta trattenuta + oltre i termini + penale totale');
  assert.ok(![free.id, waived.id].some((id) => queue.some((q) => q.id === id)), 'senza penale non si fattura');
  assert.deepEqual(penalties.find((p) => p.id === card.id).payments, [{ method: 'MP08', cents: 6000, paid: true }], 'quota già incassata con carta');
  assert.deepEqual(penalties.find((p) => p.id === inv.id).payments, [{ method: 'MP05', cents: 6000, paid: false }], 'da incassare con bonifico');
  const [draft] = createDrafts(app, [`booking:${inv.id}`], localToInstant('2027-03-30', '10:00'));
  assert.equal(draft.total_cents, 6000);
  assert.ok(!invoiceQueue(app, localToInstant('2027-03-30', '10:00')).some((q) => q.id === inv.id), 'una volta in bozza esce dalla coda');
});

test('annullo online: il cliente annulla finché c’è qualcosa da rimborsare (anche in parte); a rimborso zero deve scrivere alla guida', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { cancel_policy_json: TIERS });
  const b = createBooking(app, base({ date: DATE, channel: 'b2b', account: acct, paymentMethod: 'invoice' }), NOW);
  assert.equal(cancellationState(b, START - 200 * HOUR).percent, 100);
  assert.equal(cancellationState(b, START - 100 * HOUR).percent, 50);
  assert.equal(cancellationState(b, START - 100 * HOUR).free, false, '«gratuita» solo con rimborso totale');
  assert.equal(cancellationState(b, START - 10 * HOUR).percent, 0);
  assert.equal(cancellationState(b, START - 10 * HOUR).everRefundable, true, 'era rimborsabile quando è stata fatta');
});
