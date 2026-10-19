// Preventivi online delle agenzie, senza rete né email: preparazione dal pacchetto, validità, stato, risposta del cliente, controllo di ciò che il
// preventivo promette, ritorno nel pacchetto, e ciò che il cliente vede (mai la tariffa dell'agenzia).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartAdd, cartCount, cartItems } from '../server/packages.js';
import { renderSavedQuotePdf } from '../server/pdf-quote.js';
import { QUOTE_DEFAULT_DAYS, QuoteError, clientView, createQuote, decide, deleteQuote, getQuote, liveCheck, listQuotes, loadIntoCart, markViewed, ownQuote, quoteByToken, quoteLines, recordSent, statusOf, validityBounds } from '../server/quotes.js';
import { createBooking } from '../server/bookings.js';
import { actorOf } from '../server/team.js';
import { HAS_PDFTOTEXT, addAccount, base, isPdf, makeApp, NOW, pdfText } from './helpers.js';

const DAY = 86_400_000;
const TODAY = '2027-01-04';
const SHARED = { tour: 'shared-agenzie', date: '2027-02-10', time: '09:30', pax: 2 }; // 28 € a persona → 56 €
const PRIVATE = { tour: 'private-agenzie', date: '2027-02-12', time: '16:00', pax: 5 }; // 120 € a gruppo
const code = (fn) => { try { fn(); } catch (err) { return err instanceof QuoteError ? err.code : `altro: ${err.message}`; } return null; };

function setup(over = {}) {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' } });
  const acct = addAccount(app.db, { email: 'giulia@dmc.example', company: 'Venice DMC', contact_name: 'Giulia Bianchi', lang: 'it', ...over });
  const actor = actorOf(acct);
  const fill = (...lines) => lines.forEach((l) => cartAdd(app, acct, { name: 'Cliente Rossi', email: 'giulia@dmc.example', lang: 'it', clientRef: 'Gruppo Rossi', ...l }, NOW, actor.userId));
  const make = (input = {}, nowMs = NOW) => createQuote(app, acct, actor, { client: 'Famiglia Rossi', ...input }, nowMs);
  return { app, acct, actor, fill, make };
}
/** Un'altra agenzia occupa tutta la partenza condivisa: i servizi del preventivo non sono più prenotabili. */
const fillUp = (app, date = SHARED.date, time = SHARED.time) => {
  const other = addAccount(app.db, { email: 'altra@dmc.example', company: 'Altra DMC', contact_name: 'Carla' });
  createBooking(app, base({ tourSlug: 'shared', channel: 'b2b', account: other, paymentMethod: 'invoice', date, time, pax: 10 }), NOW);
};

test('validità: da oggi al giorno del primo servizio, di partenza una settimana; lo stato «scaduto» si ricava dalla data', () => {
  assert.equal(QUOTE_DEFAULT_DAYS, 7);
  assert.deepEqual(validityBounds([{ date: '2027-02-10' }, { date: '2027-03-01' }], TODAY), { min: TODAY, max: '2027-02-10', fallback: '2027-01-11' });
  assert.deepEqual(validityBounds([{ date: '2027-01-06' }], TODAY), { min: TODAY, max: '2027-01-06', fallback: '2027-01-06' }, 'servizio vicino: la validità non supera il servizio');
  assert.deepEqual(validityBounds([{ date: TODAY }], TODAY), { min: TODAY, max: TODAY, fallback: TODAY });
  assert.deepEqual(validityBounds([], TODAY), { min: TODAY, max: TODAY, fallback: TODAY });
  assert.equal(validityBounds([{ date: '2026-12-01' }], TODAY).max, TODAY, 'una data passata non allunga nulla');
  const q = { status: 'sent', valid_until: '2027-01-10' };
  assert.equal(statusOf(q, '2027-01-10'), 'sent', 'compreso l’ultimo giorno');
  assert.equal(statusOf(q, '2027-01-11'), 'expired');
  assert.equal(statusOf({ ...q, status: 'draft' }, '2027-01-11'), 'expired');
  assert.equal(statusOf({ ...q, status: 'approved' }, '2027-03-01'), 'approved', 'una risposta già data non scade');
  assert.equal(statusOf({ ...q, status: 'declined' }, '2027-03-01'), 'declined');
});

test('preparazione: dal pacchetto, con tariffa dell’agenzia, ricarico e prezzo al cliente; il pacchetto resta com’è', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  assert.equal(code(() => s.make()), 'empty', 'pacchetto vuoto');
  s.fill(SHARED, PRIVATE);
  const q = s.make({ email: ' Cliente@Example.COM ', markup: '20', round: '5', until: '2027-02-05', lang: 'en', note: ' Grazie! ', clientRef: 'Rif 1' });
  assert.match(q.ref, /^QT-[A-Z0-9]{6}$/);
  assert.ok(q.token.length >= 20);
  assert.deepEqual([q.account_id, q.user_id, q.created_by, q.client_name, q.client_email, q.client_ref, q.lang, q.note], [s.acct.id, null, 'Giulia Bianchi', 'Famiglia Rossi', 'cliente@example.com', 'Rif 1', 'en', 'Grazie!']);
  assert.deepEqual([q.markup_percent, q.markup_round, q.valid_until, q.status, q.sent_count, q.currency], [20, 5, '2027-02-05', 'draft', 0, 'EUR']);
  assert.equal(q.net_cents, 5600 + 12000);
  assert.equal(q.total_cents, 7000 + 14500, '56 → 67,20 → 70; 120 → 144 → 145: riga per riga, per eccesso a 5 €');
  assert.deepEqual(quoteLines(q).map((l) => [l.slug, l.date, l.time, l.endTime, l.pax, l.netCents]), [['shared-agenzie', '2027-02-10', '09:30', '12:00', 2, 5600], ['private-agenzie', '2027-02-12', '16:00', '18:00', 5, 12000]]);
  assert.equal(cartCount(s.app.db, s.acct.id, null), 2, 'il pacchetto resta');
  assert.equal(q.sent_at, null);
  assert.equal(getQuote(s.app.db, q.ref).id, q.id);
  assert.equal(getQuote(s.app.db, 'QT-NONESI'), null);
  assert.deepEqual(listQuotes(s.app.db, s.acct.id).map((x) => x.ref), [q.ref]);
});

test('preparazione: valori di partenza (ricarico e arrotondamento del profilo, lingua dell’agenzia, una settimana)', (t) => {
  const s = setup({ markup_percent: 10, markup_round: 10, lang: 'es' });
  t.after(s.app.cleanup);
  s.fill(SHARED);
  const q = s.make();
  assert.deepEqual([q.markup_percent, q.markup_round, q.lang, q.valid_until], [10, 10, 'es', '2027-01-11']);
  assert.equal(q.total_cents, 7000, '56 → 61,60 → per eccesso a 10 € → 70');
  const zero = s.make({ markup: '0', lang: 'xx', until: 'non-una-data' });
  assert.deepEqual([zero.markup_percent, zero.total_cents, zero.lang, zero.valid_until], [0, 5600, 'es', '2027-01-11'], 'ricarico zero: il prezzo è la tariffa; lingua e data strane: i valori di partenza');
  assert.equal(s.make({ markup: '' }).markup_percent, 10, 'vuoto: quello del profilo');
});

test('preparazione: nome, email, ricarico e validità si controllano; un servizio non più prenotabile blocca', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED);
  assert.equal(code(() => s.make({ client: 'A' })), 'client');
  assert.equal(code(() => s.make({ client: '' })), 'client');
  assert.equal(code(() => s.make({ email: 'non-un-indirizzo' })), 'email');
  for (const markup of ['301', 'abc', '-1']) assert.equal(code(() => s.make({ markup })), 'markup', markup);
  assert.equal(code(() => s.make({ markup: '300' })), null);
  assert.equal(code(() => s.make({ until: '2027-01-03' })), 'until', 'già passato');
  try {
    s.make({ until: '2027-02-11' });
    assert.fail('oltre il giorno del servizio');
  } catch (e) {
    assert.deepEqual([e.code, e.detail], ['until', '2027-02-10']);
  }
  assert.equal(code(() => s.make({ until: '2027-02-10' })), null, 'il giorno del servizio è l’ultimo possibile');
  assert.equal(code(() => s.make({ until: TODAY })), null);
  fillUp(s.app); // il servizio nel pacchetto non c'è più
  assert.equal(code(() => s.make()), 'stale');
});

test('il collegamento del cliente: il codice segreto deve coincidere; un preventivo è dell’agenzia che l’ha preparato', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED);
  const q = s.make();
  assert.equal(quoteByToken(s.app.db, q.ref, q.token).id, q.id);
  for (const bad of ['', 'x', q.token + 'x', q.token.slice(1), undefined, null]) assert.equal(quoteByToken(s.app.db, q.ref, bad), null, String(bad));
  assert.equal(quoteByToken(s.app.db, 'QT-NONESI', q.token), null);
  assert.equal(ownQuote(s.app.db, s.acct.id, q.ref).id, q.id);
  assert.equal(ownQuote(s.app.db, s.acct.id + 1, q.ref), null);
  assert.equal(deleteQuote(s.app.db, s.acct.id + 1, q.ref), false);
  assert.equal(deleteQuote(s.app.db, s.acct.id, q.ref), true);
  assert.equal(deleteQuote(s.app.db, s.acct.id, q.ref), false);
  assert.equal(getQuote(s.app.db, q.ref), null);
});

test('ciò che vede il cliente: servizi in ordine di data con il suo prezzo e il totale; la tariffa dell’agenzia non c’è', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(PRIVATE, SHARED);
  const q = s.make({ markup: '20', lang: 'en' });
  const v = clientView(s.app, q);
  assert.deepEqual(v.lines.map((l) => [l.title, l.date, l.when, l.pax, l.cents]), [['Test tour', '2027-02-10', '09:30–12:00', 2, 7000], ['Test tour', '2027-02-12', '16:00–18:00', 5, 14500]]);
  assert.equal(v.totalCents, 21500);
  assert.equal(JSON.stringify(v).includes('5600'), false, 'né la tariffa di un servizio…');
  assert.equal(JSON.stringify(v).includes('17600'), false, '…né il totale della tariffa');
  assert.deepEqual(Object.keys(v.lines[0]).sort(), ['cents', 'date', 'included', 'meeting', 'party', 'pax', 'title', 'when']);
  assert.equal(clientView(s.app, q, 'it').lines[0].title, 'Tour di prova');
  assert.equal(clientView(s.app, q, 'es').lines[0].meeting, 'La plaza');
});

test('la risposta del cliente: una volta sola, anche da bozza, non dopo la scadenza', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED);
  const a = s.make({ email: 'c@example.com' });
  markViewed(s.app.db, a.id, NOW + DAY);
  markViewed(s.app.db, a.id, NOW + 2 * DAY);
  assert.equal(getQuote(s.app.db, a.ref).viewed_at, new Date(NOW + DAY).toISOString(), 'la prima apertura');
  recordSent(s.app.db, a.id, 'c@example.com', NOW + DAY);
  assert.equal(decide(s.app.db, a.id, 'approved', `  ${'x'.repeat(600)} `, NOW + 2 * DAY), true);
  const done = getQuote(s.app.db, a.ref);
  assert.deepEqual([done.status, done.decided_at, done.decided_note.length], ['approved', new Date(NOW + 2 * DAY).toISOString(), 500]);
  assert.equal(decide(s.app.db, a.id, 'declined', 'ci ripenso', NOW + 3 * DAY), false, 'la prima risposta resta');
  assert.equal(decide(s.app.db, a.id, 'approved', '', NOW + 3 * DAY), false);
  assert.equal(getQuote(s.app.db, a.ref).status, 'approved');
  assert.equal(statusOf(getQuote(s.app.db, a.ref), '2027-12-31'), 'approved');
  // dalla bozza, senza averlo mai mandato per email (il collegamento si può girare in altro modo)
  const b = s.make();
  assert.equal(decide(s.app.db, b.id, 'declined', '', NOW + DAY), true);
  assert.equal(getQuote(s.app.db, b.ref).decided_note, null);
  // scelta non valida, e scaduto
  const c = s.make();
  assert.equal(decide(s.app.db, c.id, 'forse', '', NOW), false);
  assert.equal(decide(s.app.db, c.id, 'approved', '', NOW + 8 * DAY), false, 'valido fino all’11 gennaio: il 12 non si può più');
  assert.equal(decide(s.app.db, c.id, 'approved', '', NOW + 7 * DAY), true, 'l’ultimo giorno sì');
  assert.equal(decide(s.app.db, 9999, 'approved', '', NOW), false);
});

test('invio: da bozza diventa «inviato» e conta gli invii; un preventivo già accettato non cambia stato', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED);
  const q = s.make();
  recordSent(s.app.db, q.id, 'cliente@example.com', NOW + DAY);
  let now = getQuote(s.app.db, q.ref);
  assert.deepEqual([now.status, now.client_email, now.sent_count, now.sent_at], ['sent', 'cliente@example.com', 1, new Date(NOW + DAY).toISOString()]);
  recordSent(s.app.db, q.id, 'altro@example.com', NOW + 2 * DAY);
  now = getQuote(s.app.db, q.ref);
  assert.deepEqual([now.status, now.client_email, now.sent_count], ['sent', 'altro@example.com', 2]);
  decide(s.app.db, q.id, 'approved', '', NOW + 3 * DAY);
  recordSent(s.app.db, q.id, 'altro@example.com', NOW + 4 * DAY);
  assert.equal(getQuote(s.app.db, q.ref).status, 'approved');
});

test('controllo di ciò che il preventivo promette: disponibilità e tariffa dell’agenzia di adesso', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED, PRIVATE);
  const q = s.make({ markup: '20' });
  let live = liveCheck(s.app, s.acct, q, NOW);
  assert.deepEqual([live.ok, live.netNow, live.lines.map((l) => [l.ok, l.changed])], [true, 17600, [[true, false], [true, false]]]);
  fillUp(s.app); // la partenza condivisa non ha più posto
  live = liveCheck(s.app, s.acct, q, NOW);
  assert.deepEqual([live.ok, live.lines[0].ok, live.lines[1].ok], [false, false, true]);
  s.app.db.prepare('UPDATE accounts SET discount_percent = 10 WHERE id = ?').run(s.acct.id);
  live = liveCheck(s.app, s.app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(s.acct.id), q, NOW);
  assert.equal(live.lines[1].changed, true, 'la tariffa dell’agenzia è cambiata');
  assert.ok(live.lines[1].netNow < 12000);
  assert.equal(getQuote(s.app.db, q.ref).net_cents, 17600, 'ma il preventivo resta com’era');
});

test('ritorno nel pacchetto: i servizi si rimettono (non quelli già presenti o non più prenotabili) con i dati del cliente', (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED, PRIVATE);
  const q = s.make({ email: 'cliente@example.com', clientRef: 'Rif 7' });
  const first = loadIntoCart(s.app, s.acct, q, s.actor, NOW);
  assert.deepEqual([first.added, first.skipped.map((x) => x.code)], [0, ['duplicate', 'duplicate']], 'sono ancora nel pacchetto');
  assert.equal(getQuote(s.app.db, q.ref).loaded_at, null);
  s.app.db.prepare('DELETE FROM cart_items').run();
  fillUp(s.app);
  const second = loadIntoCart(s.app, s.acct, q, s.actor, NOW + DAY);
  assert.deepEqual([second.added, second.skipped.map((x) => [x.index, x.code])], [1, [[0, 'unavailable']]]);
  assert.equal(getQuote(s.app.db, q.ref).loaded_at, new Date(NOW + DAY).toISOString());
  const [item] = cartItems(s.app.db, s.acct.id, null);
  assert.deepEqual([item.src.tour, item.src.name, item.src.email, item.src.clientRef, item.src.lang], ['private-agenzie', 'Famiglia Rossi', 'cliente@example.com', 'Rif 7', 'it']);
  // un collaboratore lo mette nel suo pacchetto, con la sua email se il cliente non ne ha una
  const member = { userId: 77, name: 'Marco Rossi', email: 'marco@dmc.example', owner: false };
  const q2 = s.make();
  const third = loadIntoCart(s.app, s.acct, q2, member, NOW + 2 * DAY);
  assert.equal(third.added, 1);
  assert.equal(cartItems(s.app.db, s.acct.id, 77)[0].src.email, 'marco@dmc.example');
  assert.equal(cartCount(s.app.db, s.acct.id, null), 1, 'quello del titolare non si tocca');
});

test('il PDF del preventivo salvato: numero, cliente e prezzi per il cliente; la tariffa dell’agenzia non compare', async (t) => {
  const s = setup();
  t.after(s.app.cleanup);
  s.fill(SHARED, PRIVATE);
  const q = s.make({ markup: '20', note: 'Hotel Danieli' });
  const pdf = await renderSavedQuotePdf(s.app, q);
  assert.ok(isPdf(Buffer.from(pdf)));
  if (HAS_PDFTOTEXT) {
    const text = pdfText(pdf).replace(/ /g, ' ');
    assert.match(text, new RegExp(q.ref));
    assert.match(text, /Famiglia Rossi/);
    assert.match(text, /70 €/);
    assert.match(text, /145 €/);
    assert.match(text, /215 €/);
    assert.match(text, /Hotel Danieli/);
    assert.doesNotMatch(text, /56 €|120 €|176 €/, 'la tariffa dell’agenzia non c’è');
  }
  assert.ok(isPdf(Buffer.from(await renderSavedQuotePdf(s.app, q, { lang: 'ja' }))), 'in un’altra lingua');
});
