import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BookingError, cancelBooking, confirmPaid, createBooking, expireHolds, getBooking } from '../server/bookings.js';
import { checkGiftCode, formatGiftCode, normalizeGift, normalizePromo, previewPricing, splitGiftCodes } from '../server/pricing.js';
import { addAccount, addGift, addPromo, base, giftBalance, ledgerSum, makeApp, NOW } from './helpers.js';

const err = (code, reason) => (e) => e instanceof BookingError && e.code === code && (!reason || e.message === reason);
const book = (app, over = {}, now = NOW) => createBooking(app, base(over), now);

test('codice sconto: percentuale e importo fisso, solo sul listino del cliente privato', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  addPromo(app.db, { code: 'ESTATE10', kind: 'percent', value: 10 });
  addPromo(app.db, { code: 'MENO5', kind: 'fixed', value: 500 });
  addPromo(app.db, { code: 'TROPPO', kind: 'fixed', value: 99999 });

  const a = book(app, { promoCode: ' estate10 ', pax: 2 });
  assert.equal(a.list_cents, 7000);
  assert.equal(a.discount_cents, 700);
  assert.equal(a.total_cents, 6300);
  assert.equal(a.promo_code, 'ESTATE10');
  const b = book(app, { promoCode: 'MENO5', pax: 2, time: '14:30' });
  assert.equal(b.total_cents, 6500);
  const c = book(app, { promoCode: 'TROPPO', pax: 1, date: '2027-01-13', email: 'c@example.com' });
  assert.equal(c.total_cents, 0, 'lo sconto non supera il prezzo');
  assert.equal(c.payment_method, 'free');
  assert.equal(c.status, 'confirmed');
  assert.equal(c.payment_status, 'paid');

  // i partner non usano codici: hanno già la tariffa riservata
  const acct = addAccount(app.db);
  const d = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', promoCode: 'ESTATE10', date: '2027-01-14' }), NOW);
  assert.equal(d.discount_cents, 0);
  assert.equal(d.total_cents, 5600);
});

test('codice sconto: finestre di validità, tour, minimo e motivi di rifiuto', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  addPromo(app.db, { code: 'FUTURO', valid_from: '2027-02-01' });
  addPromo(app.db, { code: 'SCADUTO', valid_to: '2027-01-03' });
  addPromo(app.db, { code: 'INVERNO', service_from: '2027-02-01', service_to: '2027-02-28' });
  addPromo(app.db, { code: 'SOLOPRIVATI', tours: JSON.stringify(['private']) });
  addPromo(app.db, { code: 'MINIMO', min_total_cents: 20000 });
  addPromo(app.db, { code: 'SPENTO', active: 0 });
  const reasons = {
    NONESISTE: 'notfound',
    FUTURO: 'not_started',
    SCADUTO: 'expired',
    INVERNO: 'service_window',
    SOLOPRIVATI: 'tour',
    MINIMO: 'min_total',
    SPENTO: 'inactive',
  };
  for (const [code, reason] of Object.entries(reasons)) assert.throws(() => book(app, { promoCode: code }), err('promo', reason), code);
  // finestra di servizio rispettata
  assert.equal(book(app, { promoCode: 'INVERNO', date: '2027-02-10' }).discount_cents, 700);
  // codice valido solo per un tour
  assert.equal(book(app, { promoCode: 'SOLOPRIVATI', tourSlug: 'private', time: '10:00', paymentMethod: 'onsite', email: 'p@example.com' }).discount_cents, 1500);
  // nessuna prenotazione è stata creata dai tentativi falliti
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 2);
});

test('codice sconto: numero massimo di usi, un uso per email, usi liberati da annullo e scadenza', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  addPromo(app.db, { code: 'DUEUSI', max_uses: 2 });
  addPromo(app.db, { code: 'UNAVOLTA', one_per_email: 1 });

  const first = book(app, { promoCode: 'DUEUSI' });
  const held = book(app, { promoCode: 'DUEUSI', paymentMethod: 'card', time: '14:30', email: 'h@example.com' });
  assert.equal(held.status, 'held');
  assert.throws(() => book(app, { promoCode: 'DUEUSI', date: '2027-01-13', email: 'z@example.com' }), err('promo', 'exhausted'));
  // l'annullo libera un uso
  cancelBooking(app, first.id, { by: 'admin' }, NOW);
  assert.equal(book(app, { promoCode: 'DUEUSI', date: '2027-01-13', email: 'z@example.com' }).discount_cents, 700);
  // un pagamento mai completato libera l'uso quando la hold scade
  assert.throws(() => book(app, { promoCode: 'DUEUSI', date: '2027-01-14', email: 'k@example.com' }), err('promo', 'exhausted'));
  expireHolds(app.db, NOW + 3600_000);
  assert.equal(book(app, { promoCode: 'DUEUSI', date: '2027-01-14', email: 'k@example.com' }, NOW + 3600_000).discount_cents, 700);

  book(app, { promoCode: 'UNAVOLTA', date: '2027-01-20', email: 'Mario@Example.com' });
  assert.throws(() => book(app, { promoCode: 'UNAVOLTA', date: '2027-01-21', email: 'mario@example.com' }), err('promo', 'email_used'));
  assert.equal(book(app, { promoCode: 'UNAVOLTA', date: '2027-01-21', email: 'altro@example.com' }).discount_cents, 700);
});

test('buono regalo: uso parziale con carta, saldo e registro coerenti', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const card = addGift(app.db, { initial_cents: 5000 });
  const b = book(app, { giftCodes: formatGiftCode(card.code).toLowerCase(), paymentMethod: 'card', pax: 3 }); // 105 €
  assert.equal(b.total_cents, 10500);
  assert.equal(b.gift_cents, 5000);
  assert.equal(b.status, 'held');
  assert.equal(b.payment_method, 'card');
  assert.equal(giftBalance(app.db, card.id), 0);
  assert.equal(ledgerSum(app.db, card.id), 0);
  // la parte da pagare con carta è totale − buono
  const { outcome } = confirmPaid(app, b.id, 'pi_1', NOW);
  assert.equal(outcome, 'confirmed');
  assert.throws(() => book(app, { giftCodes: card.code, date: '2027-01-13', email: 'q@example.com' }), err('gift', 'empty'));
});

test('buono regalo: copre tutto il totale → prenotazione confermata senza pagamento', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const card = addGift(app.db, { initial_cents: 20000 });
  const b = book(app, { giftCodes: card.code, paymentMethod: 'card', pax: 2 }); // il metodo scelto non conta
  assert.equal(b.payment_method, 'giftcard');
  assert.equal(b.status, 'confirmed');
  assert.equal(b.payment_status, 'paid');
  assert.equal(b.gift_cents, 7000);
  assert.equal(giftBalance(app.db, card.id), 13000);
  // il residuo si può usare per un'altra prenotazione
  const b2 = book(app, { giftCodes: card.code, date: '2027-01-13', pax: 4 });
  assert.equal(b2.total_cents, 14000);
  assert.equal(b2.gift_cents, 13000, 'il buono copre solo il saldo residuo');
  assert.equal(giftBalance(app.db, card.id), 0);
});

test('buoni regalo: più codici insieme, buono + sconto, errori di validità', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const a = addGift(app.db, { initial_cents: 3000 });
  const b = addGift(app.db, { initial_cents: 3000 });
  addPromo(app.db, { code: 'ESTATE10', kind: 'percent', value: 10 });
  const tour = app.content.tour('shared');
  const p = previewPricing(app, { tour, pax: 2, channel: 'b2c', date: '2027-01-12', promoCode: 'ESTATE10', giftCodes: `${a.code}, ${b.code}`, nowMs: NOW });
  assert.equal(p.listCents, 7000);
  assert.equal(p.discountCents, 700);
  assert.equal(p.totalCents, 6300);
  assert.equal(p.giftCents, 6000);
  assert.equal(p.dueCents, 300);
  assert.deepEqual(p.gifts.map((g) => g.cents), [3000, 3000]);

  assert.deepEqual(checkGiftCode(app.db, 'XXXXXXXXXXXX', NOW), { ok: false, reason: 'notfound' });
  const expired = addGift(app.db, { expires_at: '2027-01-03' });
  assert.equal(checkGiftCode(app.db, expired.code, NOW).reason, 'expired');
  const voided = addGift(app.db, { status: 'void' });
  assert.equal(checkGiftCode(app.db, voided.code, NOW).reason, 'inactive');
  const pending = addGift(app.db, { status: 'pending' });
  assert.equal(checkGiftCode(app.db, pending.code, NOW).reason, 'notfound', 'un buono non pagato non esiste');
  assert.throws(() => book(app, { giftCodes: expired.code }), err('gift', 'expired'));
  assert.equal(giftBalance(app.db, expired.id), 10000, 'un tentativo fallito non tocca il saldo');
});

test('buono regalo: ripristino su annullo gratuito, nessun ripristino fuori termine, scadenza della hold', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const card = addGift(app.db, { initial_cents: 10000 });

  // annullo gratuito di una prenotazione confermata: il buono torna intero
  const early = book(app, { giftCodes: card.code, date: '2027-01-20' });
  assert.equal(giftBalance(app.db, card.id), 3000);
  const c1 = cancelBooking(app, early.id, { by: 'customer' }, NOW);
  assert.equal(c1.giftRestoredCents, 7000);
  assert.equal(giftBalance(app.db, card.id), 10000);
  assert.equal(cancelBooking(app, early.id, { by: 'customer' }, NOW).already, true, 'doppio annullo innocuo');
  assert.equal(giftBalance(app.db, card.id), 10000);

  // fuori termine: la quota in buono non torna (salvo rimborso totale deciso dall'admin)
  const late = book(app, { giftCodes: card.code, date: '2027-01-06' });
  assert.equal(cancelBooking(app, late.id, { by: 'customer' }, NOW).giftRestoredCents, 0);
  assert.equal(giftBalance(app.db, card.id), 3000);
  const late2 = book(app, { giftCodes: card.code, date: '2027-01-07', pax: 1, email: 'l@example.com' });
  assert.equal(late2.total_cents, 3500);
  assert.equal(late2.gift_cents, 3000, 'saldo residuo di 30 € su 35 €');
  assert.equal(cancelBooking(app, late2.id, { by: 'admin', refund: 'full' }, NOW).giftRestoredCents, 3000);

  // pagamento mai completato: la hold scade e i buoni tornano
  const before = giftBalance(app.db, card.id);
  const held = book(app, { giftCodes: card.code, paymentMethod: 'card', date: '2027-01-22', pax: 2, email: 'h@example.com' });
  assert.ok(giftBalance(app.db, card.id) < before);
  expireHolds(app.db, NOW + 3600_000);
  assert.equal(giftBalance(app.db, card.id), before);
  assert.equal(getBooking(app.db, held.id).status, 'expired');

  // una prenotazione ancora "held" annullata dall'admin restituisce sempre i buoni
  const held2 = book(app, { giftCodes: card.code, paymentMethod: 'card', date: '2027-01-08', pax: 2, email: 'h2@example.com' });
  cancelBooking(app, held2.id, { by: 'admin', refund: 'none' }, NOW);
  assert.equal(giftBalance(app.db, card.id), before);
  assert.equal(ledgerSum(app.db, card.id), giftBalance(app.db, card.id), 'il saldo è la somma del registro');
});

test('buono regalo: pagamento tardivo riprende il buono se c\'è ancora, altrimenti conflitto', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const card = addGift(app.db, { initial_cents: 5000 });
  const held = book(app, { giftCodes: card.code, paymentMethod: 'card', pax: 3 }); // 105 € − 50 € di buono
  const late = NOW + 3600_000;
  expireHolds(app.db, late);
  assert.equal(giftBalance(app.db, card.id), 5000);
  assert.equal(confirmPaid(app, held.id, 'pi_late', late).outcome, 'confirmed');
  assert.equal(giftBalance(app.db, card.id), 0, 'il buono è di nuovo riservato');

  // se nel frattempo il buono è stato speso altrove, il pagamento tardivo va rimborsato
  const card2 = addGift(app.db, { initial_cents: 5000 });
  const held2 = book(app, { giftCodes: card2.code, paymentMethod: 'card', pax: 3, date: '2027-01-14', email: 'x@example.com' });
  expireHolds(app.db, late);
  book(app, { giftCodes: card2.code, pax: 1, date: '2027-01-15', email: 'y@example.com' }, late); // spende 35 €
  assert.equal(confirmPaid(app, held2.id, 'pi_late2', late).outcome, 'conflict');
});

test('normalizzazione dei codici', () => {
  assert.equal(normalizePromo(' estate-10 '), 'ESTATE-10');
  assert.equal(normalizeGift('ab12-cd34 ef56'), 'AB12CD34EF56');
  assert.deepEqual(splitGiftCodes('aaaa-bbbb-cccc, AAAABBBBCCCC;dddd eeee'), ['AAAABBBBCCCC', 'DDDD', 'EEEE']);
  assert.equal(formatGiftCode('ABCD1234EFGH'), 'ABCD-1234-EFGH');
});
