// Adulti, bambini (fino a 12 anni, metà prezzo) e infanti (fino a 3 anni, gratis): lettura, prezzi, posti, prenotazione, modifiche, pacchetto e preventivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingError, createBooking, getBooking } from '../server/bookings.js';
import { ChangeError, evaluateChange, modifyBooking } from '../server/changes.js';
import { AdminChangeError, evaluateAdminChange, modifyBookingAdmin } from '../server/adminChanges.js';
import { describeSource } from '../server/invoices.js';
import { cartAdd, cartSummary, createPackage, resolveLine } from '../server/packages.js';
import {
  CHILD_MAX_AGE, CHILD_PERCENT, INFANT_MAX_AGE, adultsOnly, bookingPeople, bookingPeopleShort, childPriceCents, isValidParty, partyCompact, partyExtra, partyOfBooking, partyOfLine,
  partyPriceCents, partyText, partyTotal, peopleShort, peopleText, readParty, readPartyOr,
} from '../server/party.js';
import { hourlyQuote, previewPricing, priceFor, unitPriceFor } from '../server/pricing.js';
import { QuoteError, clientView, createQuote, quoteLines } from '../server/quotes.js';
import { readSlot } from '../server/slotParams.js';
import { actorOf } from '../server/team.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const code = (fn) => { try { fn(); } catch (err) { return err instanceof BookingError || err instanceof ChangeError || err instanceof AdminChangeError || err instanceof QuoteError ? err.code : `altro: ${err.message}`; } return null; };
const P = (adults, children = 0, infants = 0) => ({ adults, children, infants });
const D = '2027-02-15'; // lontano da NOW (4 gennaio 2027): cancellazione ancora gratuita

test('età e percentuale: bambini fino a 12 anni, infanti fino a 3 anni, bambini a metà prezzo', () => {
  assert.deepEqual([CHILD_MAX_AGE, INFANT_MAX_AGE, CHILD_PERCENT], [12, 3, 50]);
});

test('lettura: adulti, bambini, infanti (o il solo numero di persone, tutte adulte); serve almeno un adulto', () => {
  assert.deepEqual(readParty({ adults: '2', children: '1', infants: '1' }), P(2, 1, 1));
  assert.deepEqual(readParty({ adults: 3, children: 0, infants: 0 }), P(3), 'anche numeri');
  assert.deepEqual(readParty({ pax: '4' }), P(4), 'i vecchi link: tante persone adulte');
  assert.deepEqual(readParty({ adults: '2' }), P(2), 'i campi non scritti valgono zero');
  assert.deepEqual(readParty({ adults: '2', children: '', infants: ' ' }), P(2), 'vuoti: zero');
  assert.deepEqual(readParty({ pax: '9', adults: '1' }), P(1), 'se c’è la composizione, il solo numero non conta');
  assert.equal(readParty({ children: '2' }), null, 'senza adulti');
  assert.equal(readParty({ adults: '0', children: '2' }), null, 'zero adulti');
  assert.equal(readParty({}), null);
  assert.equal(readParty(undefined), null);
  for (const bad of ['-1', '1.5', 'x', '1000', '1e1', '0x2']) assert.equal(readParty({ adults: bad }), null, `adulti «${bad}»`);
  assert.equal(readParty({ adults: '2', children: '-1' }), null);
  assert.equal(readParty({ adults: '2', infants: 'x' }), null);
  // il totale (compresi gli infanti, che occupano un posto) non supera il massimo
  assert.deepEqual(readParty({ adults: '5', children: '3', infants: '2' }, { max: 10 }), P(5, 3, 2));
  assert.equal(readParty({ adults: '5', children: '3', infants: '3' }, { max: 10 }), null);
  assert.equal(readParty({ adults: '100' }), null, 'oltre il massimo di qualunque modulo');
  assert.equal(isValidParty(P(1, 0, 0), 1), true);
  assert.equal(isValidParty(P(0, 1, 0)), false);
  assert.equal(isValidParty(P(1.5, 0, 0)), false);
  assert.equal(isValidParty(null), false);
  // con un ripiego
  const fallback = P(2);
  assert.deepEqual(readPartyOr({}, fallback), fallback);
  assert.deepEqual(readPartyOr({ pax: 'x' }, fallback), fallback, 'scritto male: il ripiego');
  assert.deepEqual(readPartyOr({ adults: '3', children: '1' }, fallback), P(3, 1));
  assert.deepEqual(readPartyOr({ pax: '5' }, fallback, { max: 10 }), P(5));
  assert.deepEqual(readPartyOr({ pax: '11' }, fallback, { max: 10 }), fallback, 'più dei posti: il ripiego');
  assert.equal(partyTotal(P(2, 1, 1)), 4);
});

test('prezzi: adulti interi, bambini a metà, infanti gratis; arrotondamento al centesimo', () => {
  assert.equal(childPriceCents(3500), 1750);
  assert.equal(childPriceCents(2999), 1500, '1499,5 → 1500');
  assert.equal(childPriceCents(2801), 1401);
  assert.equal(childPriceCents(0), 0);
  assert.equal(partyPriceCents(3500, P(2, 1, 1)), 2 * 3500 + 1750);
  assert.equal(partyPriceCents(3500, P(1, 0, 3)), 3500, 'gli infanti non pagano');
  assert.equal(partyPriceCents(3500, P(1, 4, 0)), 3500 + 4 * 1750);
  assert.equal(partyPriceCents(2999, P(1, 3, 0)), 2999 + 3 * 1500, 'ogni bambino arrotondato, poi moltiplicato: lo stesso conto di una fattura per riga');
  const app = makeApp();
  const shared = app.content.tour('shared');
  const priv = app.content.tour('private');
  assert.equal(priceFor(shared, 3, 'b2c'), 10500, 'un numero vale «tante persone adulte»');
  assert.equal(priceFor(shared, P(2, 1, 1), 'b2c'), 8750);
  assert.equal(priceFor(priv, P(2, 3, 1), 'b2c'), 15000, 'a gruppo: la composizione non cambia il prezzo');
  assert.equal(priceFor(priv, 7, 'b2c'), 15000);
  app.cleanup();
});

test('testi: «2 adulti, 1 bambino, 1 infante» nelle quattro lingue; solo le categorie presenti', () => {
  assert.equal(partyText(P(2, 1, 1), 'it'), '2 adulti, 1 bambino, 1 infante');
  assert.equal(partyText(P(1, 2, 0), 'it'), '1 adulto, 2 bambini');
  assert.equal(partyText(P(3), 'it'), '3 adulti');
  assert.equal(partyText(P(2, 1, 1), 'en'), '2 adults, 1 child, 1 infant');
  assert.equal(partyText(P(1, 3, 2), 'en'), '1 adult, 3 children, 2 infants');
  assert.equal(partyText(P(2, 1, 1), 'es'), '2 adultos, 1 niño, 1 bebé');
  assert.equal(partyText(P(1, 2, 2), 'es'), '1 adulto, 2 niños, 2 bebés');
  assert.equal(partyText(P(2, 1, 1), 'ja'), '大人2名、子ども1名、乳幼児1名');
  assert.equal(peopleText(P(3), 'it'), '3 persone');
  assert.equal(peopleText(P(1), 'it'), '1 persona');
  assert.equal(peopleText(P(2, 1, 1), 'it'), '4 persone (2 adulti, 1 bambino, 1 infante)');
  assert.equal(peopleText(P(2, 1, 1), 'en'), '4 guests (2 adults, 1 child, 1 infant)');
  assert.equal(peopleText(P(2, 1, 1), 'es'), '4 personas (2 adultos, 1 niño, 1 bebé)');
  assert.equal(peopleText(P(2, 1, 1), 'ja'), '4名（大人2名、子ども1名、乳幼児1名）');
  assert.equal(peopleText(P(2, 1, 0), 'it', { noun: 'partecipanti' }), '3 partecipanti (2 adulti, 1 bambino)', 'le email dicono «partecipanti»');
  assert.equal(peopleText(P(2), 'it', { noun: 'partecipanti' }), '2 partecipanti');
  assert.equal(partyExtra(P(2), 'it'), '');
  assert.equal(partyExtra(P(2, 1, 0), 'it'), ' (2 adulti, 1 bambino)');
  assert.equal(peopleShort(P(4)), '4 pers.');
  assert.equal(peopleShort(P(2, 1, 1)), '4 pers. (2 ad. + 1 bamb. + 1 inf.)');
  assert.equal(peopleShort(P(1, 0, 2)), '3 pers. (1 ad. + 2 inf.)');
  assert.equal(partyCompact(P(4)), '4');
  assert.equal(partyCompact(P(2, 1, 1)), '4 (2 ad. + 1 bamb. + 1 inf.)');
  // da una prenotazione salvata (le vecchie non hanno bambini né infanti)
  const b = { participants: 4, children: 1, infants: 1 };
  assert.deepEqual(partyOfBooking(b), P(2, 1, 1));
  assert.deepEqual(partyOfBooking({ participants: 5 }), P(5), 'senza le colonne: tutti adulti');
  assert.equal(bookingPeople(b, 'it'), '4 persone (2 adulti, 1 bambino, 1 infante)');
  assert.equal(bookingPeopleShort(b), '4 pers. (2 ad. + 1 bamb. + 1 inf.)');
  assert.deepEqual(partyOfLine({ pax: 5, children: 2, infants: 1 }), P(2, 2, 1));
  assert.deepEqual(partyOfLine({ pax: 3 }), P(3), 'le righe di prima');
  assert.deepEqual(adultsOnly(2), P(2));
});

test('prenotazione privata: il totale occupa i posti, il prezzo viene dalla composizione e tutto si salva', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const b = createBooking(app, base({ party: P(2, 1, 1), paymentMethod: 'onsite', date: D }), NOW);
  assert.deepEqual([b.participants, b.children, b.infants], [4, 1, 1]);
  assert.deepEqual([b.list_cents, b.total_cents], [8750, 8750], '2 × 35 € + 1 × 17,50 € + infante gratis');
  assert.deepEqual(partyOfBooking(getBooking(app.db, b.id)), P(2, 1, 1));
  // la vecchia forma (solo «pax») prenota tutti adulti
  const old = createBooking(app, base({ pax: 3, date: D, time: '14:30' }), NOW);
  assert.deepEqual([old.participants, old.children, old.infants, old.total_cents], [3, 0, 0, 10500]);
  // senza bambini la composizione non cambia il conto di prima
  assert.equal(createBooking(app, base({ party: P(2), date: '2027-02-16' }), NOW).total_cents, 7000);
  // il codice sconto si applica sul totale della composizione
  const promo = previewPricing(app, { tour: app.content.tour('shared'), party: P(2, 1, 1), channel: 'b2c', date: D, time: '09:30', nowMs: NOW });
  assert.equal(promo.listCents, 8750);
});

test('posti: contano tutti, anche gli infanti; con la partenza quasi piena si può solo ciò che resta', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  createBooking(app, base({ party: P(2, 1, 1), date: D }), NOW); // 4 su 10
  assert.equal(code(() => createBooking(app, base({ party: P(5, 1, 1), date: D, email: 'altro@example.com' }), NOW)), 'unavailable', '4 + 7 > 10');
  const six = createBooking(app, base({ party: P(4, 1, 1), date: D, email: 'altro@example.com' }), NOW);
  assert.equal(six.participants, 6, '4 + 6 = 10: ci sta, e il gruppo è di 6 persone');
  assert.equal(code(() => createBooking(app, base({ party: P(1), date: D, email: 'terzo@example.com' }), NOW)), 'unavailable', 'pieno');
  // un gruppo di soli infanti più un adulto occupa tutti i posti che dice
  assert.equal(createBooking(app, base({ party: P(1, 0, 9), date: '2027-02-16' }), NOW).participants, 10);
});

test('composizione non valida: nessun adulto, troppe persone, numeri strani', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  assert.equal(code(() => createBooking(app, base({ party: P(0, 2, 0), date: D }), NOW)), 'invalid', 'senza adulti');
  assert.equal(code(() => createBooking(app, base({ party: P(8, 2, 1), date: D }), NOW)), 'invalid', '11 persone, il tour ne ha 10');
  assert.equal(code(() => createBooking(app, base({ party: P(1.5, 0, 0), date: D }), NOW)), 'invalid');
  assert.equal(code(() => createBooking(app, base({ party: P(-1, 3, 0), date: D }), NOW)), 'invalid');
  assert.equal(code(() => createBooking(app, base({ pax: 0, date: D }), NOW)), 'invalid');
  assert.equal(code(() => createBooking(app, base({ pax: 11, date: D }), NOW)), 'invalid');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0, 'nulla è stato scritto');
});

test('agenzie: la tariffa dell’agenzia vale per gli adulti, i bambini pagano la metà di quella', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = addAccount(app.db, { email: 'a@dmc.example', prices_json: JSON.stringify({ 'shared-agenzie': 2500 }) }); // listino dedicato: 25 €
  const tour = app.content.tour('shared-agenzie');
  const unit = unitPriceFor(tour, 'b2b', acct);
  assert.equal(unit, 2500);
  const b = createBooking(app, base({ channel: 'b2b', account: acct, party: P(3, 2, 1), paymentMethod: 'invoice', date: D }), NOW);
  assert.equal(b.total_cents, 3 * 2500 + 2 * 1250);
  assert.equal(b.total_cents, 3 * unit + 2 * childPriceCents(unit));
  assert.deepEqual([b.participants, b.children, b.infants], [6, 2, 1]);
  // un servizio privato a gruppo: stesso prezzo con o senza bambini
  const priv = createBooking(app, base({ tourSlug: 'private', channel: 'b2b', account: acct, party: P(2, 3, 2), time: '10:00', paymentMethod: 'invoice', date: '2027-02-16' }), NOW);
  assert.equal(priv.total_cents, unitPriceFor(app.content.tour('private-agenzie'), 'b2b', acct));
  assert.deepEqual([priv.participants, priv.children, priv.infants], [7, 3, 2]);
});

test('servizi a ore: gli auricolari li usano adulti e bambini, non gli infanti', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const hourly = { service: 'guide', chooseHours: true, durationMin: 240, roundHours: false };
  const quote = (party) => hourlyQuote(app, hourly, { party, channel: 'b2c', hours: 4 });
  assert.equal(quote(P(7, 1, 3)).earpieces, false, '11 persone ma solo 8 usano gli auricolari: sotto la soglia di 9');
  const nine = quote(P(8, 1, 5));
  assert.equal(nine.earpieces, true);
  assert.equal(nine.lines.find((l) => l.key === 'earpieces').pax, 9, 'non 14');
  assert.equal(nine.lines.find((l) => l.key === 'earpieces').cents, 9 * 400);
  assert.equal(quote(P(9)).totalCents, nine.totalCents, 'lo stesso conto di 9 adulti');
  // il vecchio «pax» vale persone adulte
  assert.equal(hourlyQuote(app, hourly, { pax: 9, channel: 'b2c', hours: 4 }).totalCents, nine.totalCents);
});

test('parametri di un servizio: totale, composizione e la vecchia forma', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const src = { tour: 'shared', date: D, time: '09:30' };
  const p = readSlot(app, { ...src, adults: '2', children: '1', infants: '1' }, 'b2c');
  assert.deepEqual([p.pax, p.party], [4, P(2, 1, 1)]);
  assert.deepEqual([readSlot(app, { ...src, pax: '3' }, 'b2c').pax, readSlot(app, { ...src, pax: '3' }, 'b2c').party], [3, P(3)]);
  assert.equal(readSlot(app, { ...src, adults: '0', children: '2' }, 'b2c'), null, 'senza adulti');
  assert.equal(readSlot(app, { ...src, adults: '8', children: '2', infants: '1' }, 'b2c'), null, 'più dei posti del tour');
  assert.equal(readSlot(app, { ...src }, 'b2c'), null, 'nessuna persona');
  assert.equal(readSlot(app, { ...src, adults: 'due' }, 'b2c'), null);
});

// ───────────── modifiche ─────────────
function agency(app, over = {}) {
  return addAccount(app.db, { email: 'dmc@example.com', company: 'Lagoon DMC', ...over });
}
const b2b = (app, acct, over = {}) => createBooking(app, base({ channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date: D, time: '09:30', paymentMethod: 'invoice', party: P(4), clientRef: 'Gruppo', ...over }), NOW);

test('l’agenzia cambia la composizione: il prezzo si ricalcola, le persone restano nel totale e il registro lo ricorda', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = agency(app);
  const bk = b2b(app, acct);
  assert.equal(bk.total_cents, 4 * 2800);
  assert.equal(evaluateChange(app, bk, {}, NOW).error, 'nochange', 'niente è cambiato');
  assert.equal(evaluateChange(app, bk, { adults: '4', children: '0', infants: '0' }, NOW).error, 'nochange');
  const ev = evaluateChange(app, bk, { adults: '2', children: '2', infants: '0' }, NOW);
  assert.equal(ev.ok, true);
  assert.deepEqual(ev.to.party, P(2, 2));
  assert.equal(ev.to.totalCents, 2 * 2800 + 2 * 1400);
  assert.equal(ev.deltaCents, -2800, 'due adulti diventano due bambini: 28 € in meno');
  const out = modifyBooking(app, bk.id, { adults: '3', children: '1', infants: '2' }, { by: 'customer' }, NOW);
  assert.deepEqual([out.after.participants, out.after.children, out.after.infants, out.after.total_cents], [6, 1, 2, 3 * 2800 + 1400]);
  assert.deepEqual(partyOfBooking(getBooking(app.db, bk.id)), P(3, 1, 2));
  const row = app.db.prepare('SELECT before_json, after_json FROM booking_changes WHERE booking_id = ?').get(bk.id);
  assert.deepEqual([JSON.parse(row.before_json).children, JSON.parse(row.after_json).children, JSON.parse(row.after_json).infants], [0, 1, 2]);
  // il vecchio «pax» vale tante persone adulte
  const again = modifyBooking(app, bk.id, { pax: 5 }, { by: 'customer' }, NOW);
  assert.deepEqual([again.after.participants, again.after.children, again.after.infants, again.after.total_cents], [5, 0, 0, 5 * 2800]);
  // composizione non valida
  assert.equal(code(() => modifyBooking(app, bk.id, { adults: '0', children: '3' }, { by: 'customer' }, NOW)), 'invalid');
  assert.equal(code(() => modifyBooking(app, bk.id, { adults: '9', children: '2' }, { by: 'customer' }, NOW)), 'invalid', 'più dei posti');
});

test('dopo il periodo gratuito si può solo aumentare: non più persone in meno, non un conto più basso', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = agency(app);
  const near = b2b(app, acct, { date: '2027-01-06' }); // a 38 ore: la cancellazione non è più gratuita
  assert.equal(evaluateChange(app, near, { adults: '5' }, NOW).ok, true, 'un adulto in più');
  assert.equal(evaluateChange(app, near, { adults: '4', infants: '2' }, NOW).ok, true, 'due infanti in più: il conto non cala');
  assert.equal(evaluateChange(app, near, { adults: '3', children: '1' }, NOW).error, 'reduceLocked', 'un adulto diventa bambino: il conto cala');
  assert.equal(evaluateChange(app, near, { adults: '3' }, NOW).error, 'reduceLocked', 'una persona in meno');
  // «in più» a parità di totale ma con un conto più alto (un infante che si scopre bambino) si può
  const withInfant = b2b(app, acct, { date: '2027-01-06', time: '14:30', party: P(3, 0, 1) });
  assert.equal(evaluateChange(app, withInfant, { adults: '3', children: '1', infants: '0' }, NOW).ok, true, 'un infante diventa bambino: paga un po’ di più');
});

test('la guida cambia la composizione dal pannello: prezzo dal listino, registro, e nessun cambiamento se è uguale', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const bk = createBooking(app, base({ party: P(4), date: D }), NOW); // 140 €, sul posto
  const ev = evaluateAdminChange(app, bk, { adults: '2', children: '2', infants: '0' }, NOW);
  assert.equal(ev.ok, true);
  assert.deepEqual([ev.to.party, ev.to.totalCents, ev.deltaCents], [P(2, 2), 105 * 100, -35 * 100]);
  assert.equal(evaluateAdminChange(app, bk, { adults: '4', children: '0', infants: '0' }, NOW).error, 'nochange');
  const out = modifyBookingAdmin(app, bk.id, { adults: '2', children: '1', infants: '2' }, { note: 'Arrivano anche due neonati' }, NOW);
  assert.deepEqual([out.after.participants, out.after.children, out.after.infants, out.after.total_cents], [5, 1, 2, 2 * 3500 + 1750]);
  const h = app.db.prepare('SELECT after_json FROM booking_changes WHERE booking_id = ?').get(bk.id);
  assert.deepEqual([JSON.parse(h.after_json).pax, JSON.parse(h.after_json).children, JSON.parse(h.after_json).infants], [5, 1, 2]);
  // prezzo concordato: la composizione cambia, l'importo resta quello scritto dalla guida
  const custom = modifyBookingAdmin(app, bk.id, { adults: '3', children: '1', infants: '2', priceMode: 'custom', priceCents: 9000 }, {}, NOW);
  assert.deepEqual([custom.after.participants, custom.after.total_cents, custom.after.custom_price], [6, 9000, 1]);
  // a gruppo: la composizione non cambia il prezzo dal listino
  const priv = createBooking(app, base({ tourSlug: 'private', date: '2027-02-16', time: '10:00', party: P(2) }), NOW);
  const same = evaluateAdminChange(app, priv, { adults: '2', children: '3', infants: '1' }, NOW);
  assert.equal(same.ok, true);
  assert.equal(same.to.totalCents, priv.total_cents);
});

// ───────────── pacchetto e preventivo ─────────────
test('pacchetto: ogni servizio ha la sua composizione, il prezzo la rispetta e le prenotazioni la conservano', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = agency(app);
  const actor = actorOf(acct);
  const common = { name: 'Cliente Rossi', email: acct.email, lang: 'it' };
  cartAdd(app, acct, { ...common, tour: 'shared-agenzie', date: '2027-02-10', time: '09:30', adults: '2', children: '1', infants: '1' }, NOW, actor.userId);
  cartAdd(app, acct, { ...common, tour: 'private-agenzie', date: '2027-02-12', time: '16:00', pax: '5' }, NOW, actor.userId);
  const sum = cartSummary(app, acct, NOW, actor.userId);
  assert.equal(sum.lines.length, 2);
  assert.deepEqual([sum.lines[0].p.pax, sum.lines[0].p.party], [4, P(2, 1, 1)]);
  assert.equal(sum.lines[0].pricing.totalCents, 2 * 2800 + 1400);
  assert.deepEqual([sum.lines[1].p.pax, sum.lines[1].p.party], [5, P(5)], 'il vecchio «pax»');
  const lines = sum.lines.map((l) => resolveLine(app, l.src));
  const pkg = createPackage(app, acct, lines, { name: 'Cliente Rossi', email: acct.email, lang: 'it', paymentMethod: 'invoice' }, NOW);
  const bookings = app.db.prepare('SELECT participants, children, infants, total_cents FROM bookings WHERE group_id = ? ORDER BY id').all(pkg.group.id).map((r) => ({ ...r }));
  assert.deepEqual(bookings[0], { participants: 4, children: 1, infants: 1, total_cents: 2 * 2800 + 1400 });
  assert.deepEqual([bookings[1].participants, bookings[1].children, bookings[1].infants], [5, 0, 0]);
});

test('preventivo: le righe conservano la composizione e il cliente la vede, senza la tariffa dell’agenzia', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const acct = agency(app);
  const actor = actorOf(acct);
  cartAdd(app, acct, { name: 'Cliente Rossi', email: acct.email, lang: 'it', tour: 'shared-agenzie', date: '2027-02-10', time: '09:30', adults: '2', children: '2', infants: '1' }, NOW, actor.userId);
  const q = createQuote(app, acct, actor, { client: 'Famiglia Rossi', markup: '0' }, NOW);
  const [line] = quoteLines(q);
  assert.deepEqual([line.pax, line.children, line.infants, line.netCents], [5, 2, 1, 2 * 2800 + 2 * 1400]);
  assert.deepEqual(partyOfLine(line), P(2, 2, 1));
  const view = clientView(app, q, 'it');
  assert.deepEqual([view.lines[0].pax, view.lines[0].party], [5, P(2, 2, 1)]);
  assert.deepEqual(Object.keys(view.lines[0]).sort(), ['cents', 'date', 'included', 'meeting', 'party', 'pax', 'title', 'when'], 'nessuna tariffa dell’agenzia');
  assert.equal(view.lines[0].cents, line.netCents, 'senza ricarico il prezzo al cliente è la tariffa');
});

test('colonne nuove: le prenotazioni di prima sono tutte di adulti', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const cols = app.db.prepare('PRAGMA table_info(bookings)').all().map((c) => [c.name, c.dflt_value, c.notnull]);
  assert.deepEqual(cols.find((c) => c[0] === 'children'), ['children', '0', 1]);
  assert.deepEqual(cols.find((c) => c[0] === 'infants'), ['infants', '0', 1]);
  // una riga scritta come prima (senza le colonne) vale tutti adulti
  const b = createBooking(app, base({ pax: 2, date: D }), NOW);
  app.db.prepare('UPDATE bookings SET participants = 3 WHERE id = ?').run(b.id);
  assert.deepEqual(partyOfBooking(getBooking(app.db, b.id)), P(3));
});

test('fattura: la riga dice chi veniva e l’importo è quello del conto a età', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const b = createBooking(app, base({ party: P(2, 1, 1), paymentMethod: 'onsite', date: '2027-01-07' }), NOW);
  const src = describeSource(app, 'booking', b.id, NOW + 5 * 86_400_000);
  assert.match(src.description, /Tour di prova – 7 gen 2027 ore 09:30 – 4 persone \(2 adulti, 1 bambino, 1 infante\)$/);
  assert.match(src.label, /4 pers\. \(2 ad\. \+ 1 bamb\. \+ 1 inf\.\)$/);
  assert.equal(src.amountCents, 8750);
  const plain = createBooking(app, base({ pax: 2, paymentMethod: 'onsite', date: '2027-01-08' }), NOW);
  assert.match(describeSource(app, 'booking', plain.id, NOW + 5 * 86_400_000).description, /ore 09:30 – 2 persone$/, 'senza bambini la riga è quella di sempre');
});
