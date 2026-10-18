// Pacchetti: più servizi prenotati insieme da un'agenzia (una sola opzione, un solo pagamento, tutti o nessuno).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeOptionCount, createBooking, expireHolds, getBooking } from '../server/bookings.js';
import { tx } from '../server/db.js';
import { PackageError, cancellable, cartAdd, cartClear, cartCount, cartRemove, cartSummary, confirmPackage, createPackage, getPackage, packageBookings, packageStatus, payableLines, releasePackage, resolveLine } from '../server/packages.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const GUIDE = 'guida@example.com';

function setup(over = {}, cfgOver = {}) {
  const app = makeApp({ mail: { notifyTo: GUIDE }, ...cfgOver });
  const acct = addAccount(app.db, { email: 'dmc@example.com', lang: 'it', ...over });
  return { app, acct };
}
/** Un servizio nel carrello (modulo di prenotazione): di default una privata di 2 ore, tra 47 giorni. */
const src = (over = {}) => ({ tour: 'private-agenzie', date: '2027-02-20', time: '10:00', pax: '5', ...over });
const common = (over = {}) => ({ name: 'Anna Conti', email: 'anna@dmc.example', phone: '+39 333 1234567', lang: 'it', clientRef: 'Gruppo Rossi', notes: 'Hotel Danieli', paymentMethod: 'invoice', ...over });
const lines = (app, ...sources) => sources.map((s) => resolveLine(app, s));
const count = (app, table) => app.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
/** Due servizi che non si pestano i piedi: una privata la mattina e una condivisa il pomeriggio. */
const TWO = () => [src(), src({ tour: 'shared-agenzie', time: '14:30', pax: '3' })];

test('transazioni annidate: se la transazione interna fallisce si annulla solo quanto ha fatto lei', (t) => {
  const { app } = setup();
  t.after(app.cleanup);
  const n = () => count(app, 'settings');
  tx(app.db, () => {
    app.db.prepare(`INSERT INTO settings(key, value) VALUES('a', '1')`).run();
    assert.throws(() => tx(app.db, () => {
      app.db.prepare(`INSERT INTO settings(key, value) VALUES('b', '2')`).run();
      throw new Error('boom');
    }), /boom/);
    assert.equal(n(), 1, 'la parte interna è stata annullata, la esterna c’è ancora');
  });
  assert.equal(n(), 1, 'la esterna è stata salvata');
  assert.throws(() => tx(app.db, () => {
    app.db.prepare(`INSERT INTO settings(key, value) VALUES('c', '3')`).run();
    tx(app.db, () => app.db.prepare(`INSERT INTO settings(key, value) VALUES('d', '4')`).run());
    throw new Error('fuori');
  }), /fuori/);
  assert.equal(n(), 1, 'se salta l’esterna salta tutto, anche ciò che l’interna aveva già concluso');
});

test('carrello: si aggiungono servizi non in conflitto; si segnalano doppioni, sovrapposizioni, orari non liberi e servizi non validi', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  cartAdd(app, acct, src(), NOW);
  cartAdd(app, acct, src({ tour: 'shared-agenzie', time: '14:30', pax: '3' }), NOW);
  assert.equal(cartCount(app.db, acct.id), 2);
  const err = (s) => { try { cartAdd(app, acct, s, NOW); } catch (e) { return e; } return null; };
  assert.equal(err(src())?.code, 'duplicate', 'lo stesso servizio nello stesso orario');
  assert.equal(err(src({ tour: 'half-day-agenzie', time: '11:00' }))?.code, 'overlap', 'la guida è una sola: 11:00 cade dentro la privata delle 10:00');
  assert.equal(err(src({ tour: 'half-day-agenzie', time: '03:00' }))?.code, 'unavailable', 'fuori dall’orario di lavoro');
  assert.equal(err(src({ tour: 'nessuno' }))?.code, 'invalid');
  assert.equal(err(src({ pax: '99' }))?.code, 'invalid', 'più persone del massimo');
  assert.equal(err(src({ tour: 'private', date: '2027-02-21' }))?.code, 'invalid', 'un servizio per i privati non si aggiunge: il pacchetto è delle agenzie');
  assert.equal(cartCount(app.db, acct.id), 2, 'i rifiutati non entrano');

  const s = cartSummary(app, acct, NOW);
  assert.equal(s.lines.length, 2);
  assert.ok(s.allOk);
  assert.equal(s.totalCents, 12000 + 2800 * 3, 'privata a gruppo + condivisa a persona');
  assert.deepEqual(s.option.ok && [s.option.days], [10], 'a 47 giorni: 10 giorni di opzione');
  assert.deepEqual(s.contact.email, '', 'nessun contatto scritto nel carrello');
  // un altro account ha il suo carrello
  const other = addAccount(app.db, { email: 'altra@example.com' });
  assert.equal(cartCount(app.db, other.id), 0);
  assert.equal(cartRemove(app.db, other.id, s.lines[0].id), false, 'non si toglie un servizio altrui');
  assert.equal(cartRemove(app.db, acct.id, s.lines[0].id), true);
  assert.equal(cartCount(app.db, acct.id), 1);
  assert.equal(cartClear(app.db, acct.id), 1);
});

test('carrello: massimo di servizi, e un servizio che si occupa nel frattempo si segnala senza perdere il resto', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  for (let d = 10; d < 22; d++) cartAdd(app, acct, src({ date: `2027-03-${d}` }), NOW);
  assert.throws(() => cartAdd(app, acct, src({ date: '2027-03-22' }), NOW), (e) => e instanceof PackageError && e.code === 'full');
  cartClear(app.db, acct.id);
  cartAdd(app, acct, src(), NOW);
  cartAdd(app, acct, src({ tour: 'shared-agenzie', time: '14:30', pax: '3' }), NOW);
  // un privato prende la partenza condivisa del pomeriggio
  createBooking(app, base({ tourSlug: 'shared', date: '2027-02-20', time: '14:30', pax: 9, paymentMethod: 'onsite' }), NOW);
  const s = cartSummary(app, acct, NOW);
  assert.deepEqual(s.lines.map((l) => [l.ok, l.reason]), [[true, null], [false, 'unavailable']]);
  assert.equal(s.allOk, false);
});

test('prenotazione del pacchetto: tutti i servizi o nessuno; se uno non c’è più non resta nulla a metà', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  createBooking(app, base({ tourSlug: 'shared', date: '2027-02-20', time: '14:30', pax: 9, paymentMethod: 'onsite' }), NOW); // occupa quasi tutta la condivisa
  const before = { bookings: count(app, 'bookings'), groups: count(app, 'booking_groups') };
  let err;
  try {
    createPackage(app, acct, lines(app, ...TWO()), common(), NOW);
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof PackageError);
  assert.equal(err.code, 'unavailable');
  assert.equal(err.line, 1, 'dice quale servizio non si può prenotare');
  assert.deepEqual({ bookings: count(app, 'bookings'), groups: count(app, 'booking_groups') }, before, 'né il pacchetto né il primo servizio sono rimasti');
  assert.throws(() => createPackage(app, acct, [], common(), NOW), (e) => e.code === 'empty');
  assert.throws(() => createPackage(app, acct, lines(app, src()), common({ email: 'non-una-email' }), NOW), (e) => e.code === 'invalid');
});

test('pacchetto a fattura: servizi confermati subito, stesso cliente e stessa pratica; un solo pacchetto', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { group, bookings } = createPackage(app, acct, lines(app, ...TWO()), common(), NOW);
  assert.match(group.ref, /^PT-[A-Z0-9]{6}$/);
  assert.equal(group.account_id, acct.id);
  assert.equal(bookings.length, 2);
  assert.deepEqual(bookings.map((b) => b.status), ['confirmed', 'confirmed']);
  assert.ok(bookings.every((b) => b.group_id === group.id && b.channel === 'b2b' && b.payment_method === 'invoice' && b.client_ref === 'Gruppo Rossi' && b.name === 'Anna Conti'));
  assert.deepEqual(bookings.map((b) => b.tour_slug), ['private-agenzie', 'shared-agenzie'], 'in ordine di data e ora');
  assert.equal(packageStatus(bookings), 'confirmed');
  assert.equal(group.due_cents, 0, 'a fattura non si chiede nulla con la carta');
  assert.equal(getPackage(app.db, group.id).ref, group.ref);
  assert.equal(packageBookings(app.db, group.id).length, 2);
  // le prenotazioni restano normali: ciascuna ha il suo voucher e la sua fattura
  assert.ok(bookings.every((b) => b.billing_json && JSON.parse(b.billing_json).company === 'Test DMC'));
});

test('pacchetto in opzione: una sola scadenza (la più vicina), conta come una sola opzione, rispetta limite e regole', (t) => {
  const { app, acct } = setup({ option_max: 1 });
  t.after(app.cleanup);
  // due date: fra 47 giorni (10 giorni di opzione) e fra 16 giorni (5 giorni)
  const ls = lines(app, src(), src({ tour: 'private-agenzie', date: '2027-01-20', time: '10:00', pax: '4' }));
  const { group, bookings } = createPackage(app, acct, ls, common({ option: true }), NOW);
  assert.equal(packageStatus(bookings), 'option');
  const expiries = new Set(bookings.map((b) => b.option_expires_at));
  assert.equal(expiries.size, 1, 'tutti i servizi scadono insieme');
  assert.equal(Date.parse([...expiries][0]), NOW + 5 * DAY, 'vale la scadenza più vicina');
  assert.equal(activeOptionCount(app.db, acct.id, NOW), 1, 'un pacchetto è una sola opzione');
  assert.ok(bookings.every((b) => b.payment_status === 'unpaid' && b.hold_expires_at === null));
  // con un limite di una sola opzione, un’altra non si può aprire (né singola, né in pacchetto)
  assert.throws(() => createBooking(app, base({ channel: 'b2b', account: acct, option: true, tourSlug: 'private', date: '2027-02-25', time: '10:00', pax: 3, email: acct.email, name: 'Anna' }), NOW), (e) => e.code === 'option' && e.message === 'limit');
  assert.throws(() => createPackage(app, acct, lines(app, src({ date: '2027-02-27' })), common({ option: true }), NOW), (e) => e instanceof PackageError && e.code === 'option' && e.message === 'limit');
  // un servizio troppo vicino impedisce l’opzione del pacchetto, e dice quale
  const { app: app2, acct: acct2 } = setup({ email: 'altra@example.com' });
  t.after(app2.cleanup);
  let err;
  try {
    createPackage(app2, acct2, lines(app2, src(), src({ date: '2027-01-06', time: '10:00' })), common({ option: true }), NOW);
  } catch (e) {
    err = e;
  }
  assert.deepEqual([err?.code, err?.message, err?.line], ['option', 'tooClose', 1]);
  assert.equal(count(app2, 'bookings'), 0, 'niente a metà');
  void group;
});

test('conferma dell’opzione del pacchetto: a fattura tutti confermati insieme; con la carta si paga una volta sola; se uno non si può confermare non cambia nulla', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const mk = (a, over = {}, date = '2027-02-20') => createPackage(app, a, lines(app, src({ date }), src({ tour: 'shared-agenzie', date, time: '14:30', pax: '3' })), common({ option: true, ...over }), NOW);
  const { group, bookings } = mk(acct);
  const res = confirmPackage(app, group.id, { method: 'invoice' }, NOW + DAY);
  assert.equal(res.outcome, 'confirmed');
  assert.deepEqual(res.bookings.map((b) => [b.status, b.payment_method]), [['confirmed', 'invoice'], ['confirmed', 'invoice']]);
  assert.equal(confirmPackage(app, group.id, {}, NOW + DAY).outcome, 'state', 'un secondo clic non fa nulla');
  assert.ok(bookings.length === 2);

  // con la carta: tutti «in attesa di pagamento», e quanto chiedere è la somma
  const card = addAccount(app.db, { email: 'carta@example.com', allow_invoice: 0 });
  const g2 = createPackage(app, card, lines(app, src({ date: '2027-03-10' }), src({ tour: 'shared-agenzie', date: '2027-03-10', time: '14:30', pax: '3' })), common({ option: true, email: 'carta@example.com' }), NOW);
  const pay = confirmPackage(app, g2.group.id, {}, NOW + DAY);
  assert.equal(pay.outcome, 'pay');
  assert.deepEqual(pay.bookings.map((b) => b.status), ['held', 'held']);
  assert.equal(getPackage(app.db, g2.group.id).due_cents, 12000 + 2800 * 3);
  assert.equal(payableLines(app.db, g2.group.id, NOW + DAY).length, 2);

  // se l'opzione è scaduta nessun servizio si conferma
  const g3 = mk(addAccount(app.db, { email: 'terza@example.com' }), { email: 'terza@example.com' }, '2027-02-05');
  const late = confirmPackage(app, g3.group.id, { method: 'invoice' }, NOW + 11 * DAY);
  assert.equal(late.outcome, 'expired');
  assert.ok(late.bookings.every((b) => b.status === 'option'), 'la chiusura la fa il lavoro periodico, non una conferma tardiva a metà');
});

test('rilascio e proroga: il rilascio libera tutte le date; si può togliere una sola data; la proroga vale per tutto il pacchetto', async (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { group, bookings } = createPackage(app, acct, lines(app, ...TWO()), common({ option: true }), NOW);
  const [a, b] = bookings;
  // la guida prolunga di 3 giorni una delle date: valgono per tutte
  const done = await app.services.extendOption(a.id, 3, NOW + DAY);
  assert.equal(done.id, a.id);
  const [x, y] = packageBookings(app.db, group.id);
  assert.equal(x.option_expires_at, y.option_expires_at, 'una scadenza sola');
  assert.equal(Date.parse(x.option_expires_at), NOW + 13 * DAY);
  assert.equal(app.mail.sent.filter((m) => /Opzione prorogata sul pacchetto/.test(m.subject)).length, 1, 'un solo avviso, non uno per servizio');
  // l'agenzia toglie solo una data: l'altra resta
  const one = await app.services.releaseOption(b.id, { by: 'customer' }, NOW + 2 * DAY);
  assert.equal(one.status, 'expired');
  assert.equal(packageStatus(packageBookings(app.db, group.id)), 'option');
  // rilascia il resto
  const released = await app.packages.release(group.id, { by: 'customer' }, NOW + 3 * DAY);
  assert.deepEqual(released.map((r) => r.id), [a.id]);
  assert.equal(packageStatus(packageBookings(app.db, group.id)), 'expired');
  assert.equal(releasePackage(app, group.id, { by: 'customer' }, NOW + 4 * DAY).length, 0, 'già rilasciato');
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /rilasciato dall’agenzia/.test(m.subject)), 'la guida lo sa (una volta sola per il pacchetto)');
});

test('email del pacchetto: una sola conferma con un voucher per servizio e un solo file di calendario; una sola email alla guida', async (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { group, redirect } = await app.packages.book(acct, lines(app, ...TWO()), common(), 'it', NOW);
  assert.equal(redirect, `/it/packages/${group.ref}?t=${group.token}&new=1`);
  const mails = app.mail.sent.filter((m) => m.to === 'anna@dmc.example');
  assert.equal(mails.length, 1, 'un’unica email per tutto il pacchetto');
  assert.match(mails[0].subject, new RegExp(`Pacchetto confermato ${group.ref} — 2 servizi`));
  const names = mails[0].attachments.map((a) => a.filename);
  assert.equal(names.filter((n) => n.endsWith('.ics')).length, 1);
  assert.equal(names.filter((n) => /^voucher-VE-.*\.pdf$/.test(n)).length, 2, 'un voucher per ciascun servizio');
  const ics = mails[0].attachments.find((a) => a.filename.endsWith('.ics')).content;
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2, 'il calendario ha tutti i servizi');
  assert.match(mails[0].text, /Gruppo Rossi/);
  assert.match(mails[0].text, new RegExp(`/it/packages/${group.ref}\\?t=${group.token}`));
  assert.equal(app.mail.sent.filter((m) => m.to === GUIDE).length, 1, 'alla guida un solo avviso, non uno per servizio');
  assert.match(app.mail.sent.find((m) => m.to === GUIDE).subject, /Nuovo pacchetto/);
});

test('pacchetto con la carta: un solo pagamento per tutti i servizi, riconosciuto dal riferimento PT-', async (t) => {
  const { app, acct } = setup({ allow_invoice: 0 });
  t.after(app.cleanup);
  const { group, redirect, external } = await app.packages.book(acct, lines(app, ...TWO()), common({ paymentMethod: 'card' }), 'it', NOW);
  assert.ok(external);
  assert.match(redirect, new RegExp(`/pay/demo/${group.ref}\\?t=${group.token}`));
  let bookings = packageBookings(app.db, group.id);
  assert.deepEqual(bookings.map((b) => b.status), ['held', 'held']);
  const found = app.payables.lookup(group.ref);
  assert.equal(found.kind, 'group');
  assert.equal(found.handler.dueCents(found.row), 12000 + 2800 * 3, 'il totale dei due servizi');
  assert.ok(found.handler.isOpen(found.row));
  assert.equal(app.mail.sent.filter((m) => m.to === 'anna@dmc.example').length, 0, 'ancora nessuna conferma');
  // il pagamento arriva: tutto confermato e pagato, con una sola email
  await found.handler.onPaid(found.row, 'pi_demo_1', NOW + 60_000);
  bookings = packageBookings(app.db, group.id);
  assert.deepEqual(bookings.map((b) => [b.status, b.payment_status, b.stripe_payment_intent]), [['confirmed', 'paid', 'pi_demo_1'], ['confirmed', 'paid', 'pi_demo_1']]);
  assert.equal(app.mail.sent.filter((m) => m.to === 'anna@dmc.example' && /Pacchetto confermato/.test(m.subject)).length, 1);
  // lo stesso pagamento notificato due volte non conferma né scrive di nuovo
  await found.handler.onPaid(app.payables.lookup(group.ref).row, 'pi_demo_1', NOW + 120_000);
  assert.equal(app.mail.sent.filter((m) => /Pacchetto confermato/.test(m.subject)).length, 1);
  assert.equal(app.payables.lookup(group.ref).handler.isOpen(app.payables.lookup(group.ref).row), false, 'non si paga due volte');
});

test('pagamento arrivato tardi: se un servizio nel frattempo è stato preso, il pacchetto non si conferma a metà e si rimborsa tutto', async (t) => {
  const { app, acct } = setup({ allow_invoice: 0 });
  t.after(app.cleanup);
  const { group } = await app.packages.book(acct, lines(app, ...TWO()), common({ paymentMethod: 'card' }), 'it', NOW);
  const later = NOW + 2 * HOUR; // il blocco di 30 minuti è scaduto
  assert.equal(expireHolds(app.db, later), 2);
  assert.deepEqual(packageBookings(app.db, group.id).map((b) => b.status), ['expired', 'expired']);
  createBooking(app, base({ tourSlug: 'shared', date: '2027-02-20', time: '14:30', pax: 9, paymentMethod: 'onsite' }), later); // la condivisa non ha più posto
  const found = app.payables.lookup(group.ref);
  const res = await found.handler.onPaid(found.row, 'pi_late', later);
  assert.equal(res.outcome, 'conflict');
  const bookings = packageBookings(app.db, group.id);
  assert.deepEqual(bookings.map((b) => b.status), ['cancelled', 'cancelled'], 'nemmeno la privata (che era libera) resta confermata');
  assert.deepEqual(bookings.map((b) => b.payment_status), ['refunded', 'refunded']);
  assert.equal(packageStatus(bookings), 'cancelled');
  const mail = app.mail.sent.find((m) => m.to === 'anna@dmc.example');
  assert.match(mail.subject, new RegExp(`Pacchetto ${group.ref}: una data non è più disponibile`));
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /Pacchetto annullato/.test(m.subject)));
});

test('scadenza e promemoria: un solo messaggio per pacchetto (non uno per servizio), all’agenzia e alla guida', async (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { group } = await app.packages.book(acct, lines(app, ...TWO()), common({ option: true }), 'it', NOW);
  assert.equal(app.mail.sent.filter((m) => m.to === 'anna@dmc.example' && /Opzione registrata sul pacchetto/.test(m.subject)).length, 1);
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /Nuovo pacchetto in opzione/.test(m.subject)));
  await app.services.sweepOptions(NOW + 9 * DAY + HOUR); // 24 ore alla scadenza
  assert.equal(app.mail.sent.filter((m) => /Promemoria: l’opzione del pacchetto/.test(m.subject)).length, 1);
  await app.services.sweepOptions(NOW + 9 * DAY + 2 * HOUR);
  assert.equal(app.mail.sent.filter((m) => /Promemoria: l’opzione del pacchetto/.test(m.subject)).length, 1, 'il promemoria parte una volta sola');
  await app.services.sweepOptions(NOW + 10 * DAY + 1000);
  const expired = app.mail.sent.filter((m) => /Opzione scaduta sul pacchetto/.test(m.subject));
  assert.equal(expired.length, 1);
  assert.equal(app.mail.sent.filter((m) => /Option expired|Opzione scaduta VE-/.test(m.subject)).length, 0, 'niente avvisi per singolo servizio');
  assert.ok(app.mail.sent.some((m) => m.to === GUIDE && /Pacchetto in opzione scaduto/.test(m.subject)));
  assert.equal(packageStatus(packageBookings(app.db, group.id)), 'expired');
});

test('annullo del pacchetto: annulla i servizi ancora rimborsabili, lascia gli altri e manda un solo riepilogo', async (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { group } = await app.packages.book(acct, lines(app, src(), src({ tour: 'shared-agenzie', date: '2027-03-15', time: '14:30', pax: '3' })), common(), 'it', NOW);
  app.mail.sent.length = 0;
  // la sera prima del primo servizio: per quello il termine è passato, per il secondo no
  const eve = localToInstant('2027-02-19', '10:00');
  const bookings = packageBookings(app.db, group.id);
  const c = cancellable(bookings, eve);
  assert.deepEqual([c.yes.map((b) => b.tour_slug), c.no.map((b) => b.tour_slug)], [['shared-agenzie'], ['private-agenzie']]);
  const res = await app.packages.cancel(group.id, { by: 'customer' }, eve);
  assert.deepEqual([res.cancelled, res.kept], [1, 1]);
  assert.deepEqual(packageBookings(app.db, group.id).map((b) => b.status), ['confirmed', 'cancelled']);
  const mails = app.mail.sent.filter((m) => m.to === 'anna@dmc.example');
  assert.equal(mails.length, 1, 'un solo riepilogo');
  assert.match(mails[0].subject, new RegExp(`Pacchetto annullato ${group.ref}`));
  assert.equal(app.mail.sent.filter((m) => m.to === GUIDE).length, 1);
  // niente da annullare: non cambia nulla e non scrive
  app.mail.sent.length = 0;
  const again = await app.packages.cancel(group.id, { by: 'customer' }, eve);
  assert.deepEqual([again.cancelled, again.kept], [0, 1]);
  assert.equal(app.mail.sent.length, 0);
  void getBooking;
});
