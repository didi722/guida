// Date libere per servizio e lista d'attesa «avvisami se si libera»: stati dei giorni, regole, avvisi quando una data si libera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOverviewFor, monthOverview } from '../server/availability.js';
import { cancelBooking, createBooking, expireOptions, getBooking } from '../server/bookings.js';
import { MAX_ACTIVE, WaitlistError, allActive, blockersOf, entriesOf, getEntry, joinWaitlist, rearmEntry, removeEntry, waitingCount } from '../server/waitlist.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const SHARED = 'shared-agenzie'; // partenze alle 09:30 e alle 14:30, fino a 10 persone
const PRIVATE = 'private-agenzie'; // servizio privato a orario libero

function setup(cfg = {}) {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' }, ...cfg });
  const a = addAccount(app.db, { email: 'a@dmc.example', company: 'Agenzia A', contact_name: 'Anna', lang: 'it' });
  const b = addAccount(app.db, { email: 'b@dmc.example', company: 'Agenzia B', contact_name: 'Bruno', lang: 'it' });
  app.db.prepare('UPDATE accounts SET option_max = 0 WHERE id IN (?, ?)').run(a.id, b.id); // nessun limite di opzioni: servono molte date occupate
  return { app, a: app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id), b: app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(b.id), tour: app.content.tour(SHARED) };
}
const hold = (app, acct, date, time, pax = 10, over = {}) => createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date, time, pax, option: true, clientRef: 'Gruppo', ...over }), NOW);
const book = (app, acct, date, time, pax = 10, over = {}) => createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date, time, pax, paymentMethod: 'invoice', ...over }), NOW);
const opts = (a, over = {}) => ({ pax: 2, channel: 'b2b', nowMs: NOW, accountId: a.id, ...over });
const join = (app, acct, date, over = {}, nowMs = NOW) => joinWaitlist(app, acct, { tour: SHARED, pax: 2, date, ...over }, nowMs);
const mailsTo = (app, to) => app.mail.sent.filter((m) => m.to === to);

test('calendario: libero, in opzione, completo, tua pratica; i giorni senza servizio non compaiono', (t) => {
  const { app, a, b, tour } = setup();
  t.after(app.cleanup);
  hold(app, b, '2027-02-20', '09:30');
  hold(app, b, '2027-02-20', '14:30'); // l'intero giorno è tenuto da B
  book(app, b, '2027-02-21', '09:30');
  book(app, b, '2027-02-21', '14:30'); // completo
  hold(app, a, '2027-02-22', '09:30');
  hold(app, a, '2027-02-22', '14:30'); // tenuto da A stessa
  hold(app, b, '2027-02-24', '09:30'); // solo la prima partenza è tenuta: la seconda è libera
  app.db.prepare(`INSERT INTO day_overrides (date, closed) VALUES ('2027-02-25', 1)`).run(); // la guida non lavora

  const m = monthOverview(app.db, app.cfg, tour, '2027-02', opts(a));
  assert.deepEqual(m['2027-02-20'], { state: 'held', n: 0 });
  assert.deepEqual(m['2027-02-21'], { state: 'full', n: 0 });
  assert.deepEqual(m['2027-02-22'], { state: 'mine', n: 0 });
  assert.deepEqual(m['2027-02-23'], { state: 'free', n: 2 });
  assert.deepEqual(m['2027-02-24'], { state: 'free', n: 1 }, 'una partenza è libera');
  assert.equal(m['2027-02-25'], undefined, 'giorno chiuso');
  assert.equal(m['2027-02-01']?.state, 'free');
  // la stessa data vista da B: la sua opzione e la sua pratica
  const mb = monthOverview(app.db, app.cfg, tour, '2027-02', opts(b));
  assert.equal(mb['2027-02-20'].state, 'mine');
  assert.equal(mb['2027-02-22'].state, 'held', 'per B la data di A è tenuta da altri');
  // le persone contano: 10 persone non trovano posto dove ne restano 8
  book(app, b, '2027-02-26', '09:30', 2);
  book(app, b, '2027-02-26', '14:30', 2);
  assert.equal(monthOverview(app.db, app.cfg, tour, '2027-02', opts(a, { pax: 8 }))['2027-02-26'].state, 'free');
  assert.equal(monthOverview(app.db, app.cfg, tour, '2027-02', opts(a, { pax: 9 }))['2027-02-26'].state, 'full');
  // giorni passati e troppo vicini non compaiono
  const jan = monthOverview(app.db, app.cfg, tour, '2027-01', opts(a));
  assert.equal(jan['2027-01-03'], undefined, 'passato');
  assert.equal(jan['2027-01-04'], undefined, 'oggi con il preavviso minimo: nessuna partenza possibile');
  assert.equal(jan['2027-01-12'].state, 'free');
  // un'opzione scaduta non occupa più (le opzioni di 47 giorni durano 10 giorni), anche prima che il lavoro periodico la chiuda
  const lateView = monthOverview(app.db, app.cfg, tour, '2027-02', { ...opts(a), nowMs: NOW + 12 * DAY });
  assert.deepEqual(lateView['2027-02-20'], { state: 'free', n: 2 });
  assert.equal(lateView['2027-02-21'].state, 'full', 'le prenotazioni confermate restano');
});

test('un giorno: orari liberi, orari possibili e perché non c’è posto', (t) => {
  const { app, a, b, tour } = setup();
  t.after(app.cleanup);
  hold(app, b, '2027-02-20', '09:30');
  const d = dayOverviewFor(app.db, app.cfg, tour, '2027-02-20', opts(a));
  assert.equal(d.state, 'free');
  assert.deepEqual(d.slots.map((s) => s.time), ['14:30']);
  assert.deepEqual(d.possible.map((s) => s.time), ['09:30', '14:30'], 'gli orari che ci sarebbero senza prenotazioni');
  hold(app, b, '2027-02-20', '14:30');
  const full = dayOverviewFor(app.db, app.cfg, tour, '2027-02-20', opts(a));
  assert.equal(full.state, 'held');
  assert.deepEqual(full.slots, []);
  assert.deepEqual(dayOverviewFor(app.db, app.cfg, tour, '2027-01-03', opts(a)), { state: null, slots: [], possible: [] });
});

test('lista d’attesa: si chiede solo per una data senza posto; regole, doppioni e limite', (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const code = (fn) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof WaitlistError, String(e));
      return e.code;
    }
    return 'ok';
  };
  hold(app, b, '2027-02-20', '09:30');
  hold(app, b, '2027-02-20', '14:30');
  app.db.prepare(`INSERT INTO day_overrides (date, closed) VALUES ('2027-02-25', 1)`).run();
  assert.equal(code(() => join(app, a, '2027-02-23')), 'free', 'la data ha già posto');
  assert.equal(code(() => join(app, a, '2027-02-25')), 'closed', 'giorno chiuso');
  assert.equal(code(() => join(app, a, '2027-01-03')), 'closed', 'giorno passato');
  assert.equal(code(() => join(app, a, '2029-02-20')), 'closed', 'oltre la finestra di prenotazione');
  assert.equal(code(() => join(app, a, '2027-02-20', { pax: 99 })), 'invalid');
  assert.equal(code(() => joinWaitlist(app, a, { tour: 'inesistente', pax: 2, date: '2027-02-20' }, NOW)), 'invalid');
  assert.equal(code(() => join(app, a, '2027-02-20', { time: '11:11' })), 'invalid', 'un orario che il servizio non ha');
  hold(app, a, '2027-02-22', '09:30');
  hold(app, a, '2027-02-22', '14:30');
  assert.equal(code(() => join(app, a, '2027-02-22')), 'mine', 'il posto è occupato da una sua pratica');

  const e = join(app, a, '2027-02-20');
  assert.deepEqual({ ...e }, { id: e.id, account_id: a.id, tour_slug: SHARED, date: '2027-02-20', time: null, pax: 2, hours: null, tour_lang: null, status: 'waiting', created_at: new Date(NOW).toISOString(), notified_at: null, notified_time: null });
  assert.equal(code(() => join(app, a, '2027-02-20')), 'dup', 'già in lista');
  assert.equal(code(() => join(app, a, '2027-02-20', { time: '09:30' })), 'ok', 'un orario preciso è un altro avviso');
  assert.equal(code(() => join(app, a, '2027-02-20', { time: '09:30' })), 'dup');
  assert.equal(waitingCount(app.db, '2027-01-04'), 2);

  // limite per agenzia
  for (let i = 0; entriesOf(app.db, a.id, '2027-01-04').length < MAX_ACTIVE; i++) {
    const date = `2027-03-${String(1 + i).padStart(2, '0')}`;
    book(app, b, date, '09:30');
    book(app, b, date, '14:30');
    join(app, a, date);
  }
  book(app, b, '2027-03-28', '09:30');
  book(app, b, '2027-03-28', '14:30');
  assert.equal(code(() => join(app, a, '2027-03-28')), 'limit');
  // un avviso tolto libera un posto; l'agenzia B non può toccare quelli di A
  assert.equal(removeEntry(app.db, b.id, e.id), false);
  assert.equal(removeEntry(app.db, a.id, e.id), true);
  assert.equal(getEntry(app.db, e.id).status, 'cancelled');
  assert.equal(removeEntry(app.db, a.id, e.id), false, 'già tolto');
  assert.equal(code(() => join(app, a, '2027-03-28')), 'ok');
  assert.equal(allActive(app.db, '2027-01-04').every((x) => x.acct_company === 'Agenzia A'), true);
});

test('la guida riceve un avviso con chi tiene la data; senza posta configurata non succede nulla', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const o = hold(app, b, '2027-02-20', '09:30');
  hold(app, b, '2027-02-20', '14:30');
  const e = await app.waitlist.join(a, { tour: SHARED, pax: 2, date: '2027-02-20' }, NOW);
  const mail = mailsTo(app, 'guida@example.com').at(-1);
  assert.match(mail.subject, /Lista d’attesa: Agenzia A/);
  assert.match(mail.text, /Agenzia A aspetta una data/);
  assert.match(mail.text, /qualsiasi orario/);
  assert.match(mail.text, new RegExp(`opzione ${o.ref} di Agenzia B`));
  assert.match(mail.text, /\/admin\/waitlist/);
  assert.deepEqual(blockersOf(app.db, e, NOW).map((x) => [x.ref, x.status, x.company]).slice(0, 1), [[o.ref, 'option', 'Agenzia B']]);
  const quiet = setup({ mail: { notifyTo: '' } });
  t.after(quiet.app.cleanup);
  hold(quiet.app, quiet.b, '2027-02-20', '09:30');
  hold(quiet.app, quiet.b, '2027-02-20', '14:30');
  await quiet.app.waitlist.join(quiet.a, { tour: SHARED, pax: 2, date: '2027-02-20' }, NOW);
  assert.equal(quiet.app.mail.sent.length, 0);
});

test('quando una data si libera l’agenzia riceve l’email, una volta sola; poi può rimettersi in lista', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const o1 = hold(app, b, '2027-02-20', '09:30');
  const o2 = hold(app, b, '2027-02-20', '14:30');
  const e = join(app, a, '2027-02-20');
  assert.equal(await app.waitlist.sweep(NOW + MIN), 0, 'ancora tenuta');
  assert.equal(mailsTo(app, 'a@dmc.example').length, 0);

  cancelBooking(app, o1.id, { by: 'customer' }, NOW + 2 * MIN); // B rilascia la prima partenza
  assert.equal(await app.waitlist.sweep(NOW + 3 * MIN), 1);
  const mail = mailsTo(app, 'a@dmc.example').at(-1);
  assert.match(mail.subject, /Si è liberata una data: Tour di prova, .*20 feb/);
  assert.match(mail.text, /Ciao Anna,/);
  assert.match(mail.text, /Orari liberi: 09:30/);
  assert.match(mail.text, /\/it\/book\?date=2027-02-20&pax=2&tour=shared-agenzie/);
  assert.match(mail.text, /chi prenota per primo/);
  assert.match(mail.html, /Vedi gli orari e prenota/);
  assert.equal(getEntry(app.db, e.id).status, 'notified');
  assert.equal(getEntry(app.db, e.id).notified_time, '09:30');
  assert.equal(await app.waitlist.sweep(NOW + 4 * MIN), 0, 'una sola email');
  assert.equal(mailsTo(app, 'a@dmc.example').length, 1);

  // non è più in attesa ma resta in lista finché la data non passa: si può rimettere in attesa
  assert.equal(waitingCount(app.db, '2027-01-04'), 0);
  assert.equal(entriesOf(app.db, a.id, '2027-01-04').length, 1);
  assert.equal(rearmEntry(app.db, b.id, e.id, '2027-01-04'), false, 'non è di B');
  assert.equal(rearmEntry(app.db, a.id, e.id, '2027-01-04'), true);
  assert.equal(getEntry(app.db, e.id).status, 'waiting');
  assert.equal(rearmEntry(app.db, a.id, e.id, '2027-01-04'), false, 'solo dopo un avviso scattato');
  void o2;
});

test('avviso per un orario preciso: parte solo se si libera proprio quello; la data passata chiude l’avviso', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const o1 = hold(app, b, '2027-02-20', '09:30');
  const o2 = hold(app, b, '2027-02-20', '14:30');
  const e = join(app, a, '2027-02-20', { time: '14:30' });
  cancelBooking(app, o1.id, { by: 'customer' }, NOW + MIN);
  assert.equal(await app.waitlist.sweep(NOW + 2 * MIN), 0, 'si è liberata un’altra partenza: nessun avviso');
  cancelBooking(app, o2.id, { by: 'customer' }, NOW + 3 * MIN);
  assert.equal(await app.waitlist.sweep(NOW + 4 * MIN), 1);
  assert.match(mailsTo(app, 'a@dmc.example').at(-1).text, /Orari liberi: 14:30\./);
  assert.equal(getEntry(app.db, e.id).notified_time, '14:30');

  // data passata: l'avviso non serve più
  book(app, b, '2027-02-21', '09:30');
  const f = join(app, a, '2027-02-21', { time: '09:30' }, NOW);
  await app.waitlist.sweep(NOW + 60 * DAY);
  assert.equal(getEntry(app.db, f.id).status, 'expired');
  assert.equal(entriesOf(app.db, a.id, '2027-03-05').length, 0);
  assert.equal(getEntry(app.db, e.id).status, 'expired');
});

test('chi prenota da sé quello che aspettava esce dalla lista, senza email; le opzioni scadute liberano la data', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const o1 = hold(app, b, '2027-02-20', '09:30');
  hold(app, b, '2027-02-20', '14:30');
  const e = join(app, a, '2027-02-20');
  cancelBooking(app, o1.id, { by: 'customer' }, NOW + MIN);
  createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: a, email: a.email, name: 'Anna', date: '2027-02-20', time: '09:30', pax: 2, paymentMethod: 'invoice' }), NOW + 2 * MIN); // l'ha preso prima di essere avvisata
  assert.equal(await app.waitlist.sweep(NOW + 3 * MIN), 0);
  assert.equal(getEntry(app.db, e.id).status, 'booked');
  assert.equal(mailsTo(app, 'a@dmc.example').length, 0);

  // l'opzione che scade da sola libera la data e l'avviso parte (con l'ordine giusto: prima la scadenza, poi il giro)
  const { app: app2, a: a2, b: b2 } = setup();
  t.after(app2.cleanup);
  hold(app2, b2, '2027-02-20', '09:30');
  hold(app2, b2, '2027-02-20', '14:30');
  join(app2, a2, '2027-02-20');
  const after = NOW + 10 * DAY + MIN; // le opzioni di 47 giorni durano 10 giorni
  assert.equal(expireOptions(app2.db, after).length, 2);
  assert.equal(await app2.waitlist.sweep(after), 1);
  assert.equal(mailsTo(app2, 'a@dmc.example').length, 1);
  void getBooking;
});

test('persone e lingua: 8 persone non entrano dove ne restano 5, e la lingua della partenza vincola', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const x = book(app, b, '2027-02-20', '09:30', 5, { tourLang: 'it' });
  const y = book(app, b, '2027-02-20', '14:30', 5, { tourLang: 'it' });
  const big = join(app, a, '2027-02-20', { pax: 8 });
  const en = join(app, a, '2027-02-20', { pax: 2, tl: 'en' }); // posti ce ne sono, ma le partenze sono in italiano
  assert.equal(en.tour_lang, 'en');
  assert.equal(await app.waitlist.sweep(NOW + MIN), 0);
  cancelBooking(app, x.id, { by: 'customer' }, NOW + 2 * MIN); // la partenza delle 09:30 torna vuota: 8 persone ci stanno e una partenza in inglese è possibile
  assert.equal(await app.waitlist.sweep(NOW + 3 * MIN), 2);
  assert.equal(getEntry(app.db, big.id).status, 'notified');
  assert.equal(getEntry(app.db, en.id).status, 'notified');
  void y;
});

test('invio che non riesce: l’avviso resta in attesa e si riprova dopo un quarto d’ora, senza martellare', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const o1 = hold(app, b, '2027-02-20', '09:30');
  const o2 = hold(app, b, '2027-02-20', '14:30');
  const e = join(app, a, '2027-02-20');
  cancelBooking(app, o1.id, { by: 'customer' }, NOW + MIN);
  cancelBooking(app, o2.id, { by: 'customer' }, NOW + MIN);
  const real = app.mail.send;
  let calls = 0;
  app.mail.send = async () => {
    calls++;
    return false;
  };
  assert.equal(await app.waitlist.sweep(NOW + 2 * MIN), 0);
  assert.equal(getEntry(app.db, e.id).status, 'waiting');
  assert.equal(calls, 1);
  assert.equal(await app.waitlist.sweep(NOW + 3 * MIN), 0);
  assert.equal(calls, 1, 'nessun nuovo tentativo subito');
  app.mail.send = real;
  assert.equal(await app.waitlist.sweep(NOW + 18 * MIN), 1, 'dopo un quarto d’ora riprova e ce la fa');
  assert.equal(getEntry(app.db, e.id).status, 'notified');
});

test('un’agenzia sospesa non riceve avvisi', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const o1 = hold(app, b, '2027-02-20', '09:30');
  const o2 = hold(app, b, '2027-02-20', '14:30');
  const e = join(app, a, '2027-02-20');
  app.db.prepare(`UPDATE accounts SET status = 'suspended' WHERE id = ?`).run(a.id);
  cancelBooking(app, o1.id, { by: 'customer' }, NOW + MIN);
  cancelBooking(app, o2.id, { by: 'customer' }, NOW + MIN);
  assert.equal(await app.waitlist.sweep(NOW + 2 * MIN), 0);
  assert.equal(getEntry(app.db, e.id).status, 'waiting');
});

test('servizio privato a orario libero: l’avviso vale per un orario preciso e per la durata scelta', async (t) => {
  const { app, a, b } = setup();
  t.after(app.cleanup);
  const priv = app.content.tour(PRIVATE);
  const o = createBooking(app, base({ tourSlug: PRIVATE, channel: 'b2b', account: b, email: b.email, name: 'Bruno', date: '2027-02-20', time: '10:00', pax: 5, option: true, clientRef: 'X' }), NOW);
  const ov = dayOverviewFor(app.db, app.cfg, priv, '2027-02-20', opts(a, { pax: 5 }));
  assert.equal(ov.state, 'free', 'il resto della giornata è libero');
  assert.ok(ov.possible.some((s) => s.time === '10:00') && !ov.slots.some((s) => s.time === '10:00'), '10:00 è occupato');
  assert.throws(() => joinWaitlist(app, a, { tour: PRIVATE, pax: 5, date: '2027-02-20', time: '13:00' }, NOW), (e) => e.code === 'free', '13:00 si prenota subito');
  const e = joinWaitlist(app, a, { tour: PRIVATE, pax: 5, date: '2027-02-20', time: '10:00' }, NOW);
  assert.equal(e.time, '10:00');
  assert.equal(await app.waitlist.sweep(NOW + MIN), 0);
  cancelBooking(app, o.id, { by: 'customer' }, NOW + 2 * MIN);
  assert.equal(await app.waitlist.sweep(NOW + 3 * MIN), 1);
  assert.match(mailsTo(app, 'a@dmc.example').at(-1).text, /Orari liberi: 10:00\./);
});
