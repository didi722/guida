// Più persone per agenzia, senza rete né email: inviti, password, stati, rimozione; e ciò che dipende da chi lavora
// (pacchetto in preparazione, «prenotata da», avvisi della lista d'attesa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createBooking } from '../server/bookings.js';
import { cartAdd, cartClear, cartCount, cartItems, cartRemove, createPackage } from '../server/packages.js';
import { MAX_MEMBERS, TEAM_INVITE_DAYS, TeamError, activateMember, actorOf, bookedBy, emailInUse, getMember, inviteMember, listMembers, loginTarget, memberByToken, removeMember, renewMemberInvite, teamSize, touchLogin } from '../server/team.js';
import { joinWaitlist, waitingEntries } from '../server/waitlist.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const DAY = 86_400_000;
const code = (fn) => { try { fn(); } catch (err) { return err instanceof TeamError ? err.code : `altro: ${err.message}`; } return null; };
const TOUR = (over = {}) => ({ tour: 'shared-agenzie', date: '2027-02-10', time: '09:30', pax: 2, ...over });

function setup(cfg = {}) {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' }, ...cfg });
  const acct = addAccount(app.db, { email: 'titolare@dmc.example', company: 'Venice DMC', contact_name: 'Giulia Bianchi', lang: 'it' });
  const other = addAccount(app.db, { email: 'altra@dmc.example', company: 'Altra DMC', contact_name: 'Carla Neri', lang: 'it' });
  return { app, acct, other };
}
const member = (app, acct, over = {}, nowMs = NOW) => inviteMember(app.db, acct, { name: 'Marco Rossi', email: 'marco@dmc.example', lang: 'it', ...over }, nowMs);
const activate = (app, user, nowMs = NOW) => { assert.equal(activateMember(app.db, user.id, 'hash', nowMs), true); return getMember(app.db, user.account_id, user.id); };

test('un indirizzo è «in uso» se è di un account o di un collaboratore, senza badare a maiuscole e spazi', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  assert.equal(emailInUse(app.db, 'TITOLARE@dmc.example'), true);
  assert.equal(emailInUse(app.db, '  titolare@dmc.example '), true);
  assert.equal(emailInUse(app.db, 'marco@dmc.example'), false);
  member(app, acct);
  assert.equal(emailInUse(app.db, 'Marco@DMC.example'), true);
  assert.equal(emailInUse(app.db, ''), false);
  assert.equal(emailInUse(app.db, null), false);
});

test('chi sta lavorando: il titolare (userId vuoto) o un collaboratore; e cosa si scrive nella prenotazione', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  assert.deepEqual(actorOf(acct), { userId: null, name: 'Giulia Bianchi', email: 'titolare@dmc.example', lang: 'it', owner: true });
  const { user } = member(app, acct, { lang: 'ja' });
  assert.deepEqual(actorOf(acct, user), { userId: user.id, name: 'Marco Rossi', email: 'marco@dmc.example', lang: 'ja', owner: false });
  assert.deepEqual(bookedBy(actorOf(acct)), { userId: null, name: 'Giulia Bianchi' });
  assert.deepEqual(bookedBy(actorOf(acct, user)), { userId: user.id, name: 'Marco Rossi' });
  assert.equal(bookedBy(null), null);
});

test('invito: dati ripuliti, collegamento che vale 7 giorni e di cui nel database c’è solo l’impronta', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { user, token } = member(app, acct, { name: '  Marco   Rossi ', email: '  Marco@DMC.example ', lang: 'es' });
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual([user.account_id, user.name, user.email, user.lang], [acct.id, 'Marco   Rossi', 'marco@dmc.example', 'es']);
  assert.equal(TEAM_INVITE_DAYS, 7);
  assert.equal(user.token_expires_at, new Date(NOW + 7 * DAY).toISOString());
  assert.equal(user.invited_at, new Date(NOW).toISOString());
  assert.equal(user.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(app.db.prepare('SELECT * FROM account_users').all()).includes(token));
  assert.deepEqual([user.password_hash, user.activated_at, user.last_login_at], [null, null, null], 'senza password finché non la sceglie');
  assert.equal(member(app, acct, { email: 'ju@dmc.example', lang: 'fr' }).user.lang, 'it', 'una lingua strana: italiano');
  assert.equal(teamSize(app.db, acct.id), 2);
  assert.deepEqual(listMembers(app.db, acct.id).map((u) => u.email), ['marco@dmc.example', 'ju@dmc.example']);
});

test('invito: nome e email validi, nessun indirizzo già usato, non oltre il massimo', (t) => {
  const { app, acct, other } = setup();
  t.after(app.cleanup);
  assert.equal(code(() => member(app, acct, { name: 'M' })), 'name');
  assert.equal(code(() => member(app, acct, { name: '' })), 'name');
  for (const email of ['', 'senza-chiocciola', 'a@b', 'due@@x.it', null]) assert.equal(code(() => member(app, acct, { email })), 'email', String(email));
  assert.equal(code(() => member(app, acct, { email: 'TITOLARE@dmc.example' })), 'exists', 'il titolare ha già l’accesso');
  assert.equal(code(() => member(app, acct, { email: other.email })), 'exists', 'un’altra agenzia');
  member(app, acct);
  assert.equal(code(() => member(app, acct)), 'exists', 'già invitato');
  assert.equal(code(() => member(app, other)), 'exists', 'neanche da un’altra agenzia');
  for (let i = 1; i < MAX_MEMBERS; i++) member(app, acct, { email: `c${i}@dmc.example` });
  assert.equal(teamSize(app.db, acct.id), MAX_MEMBERS);
  assert.equal(code(() => member(app, acct, { email: 'uno-di-troppo@dmc.example' })), 'limit');
  assert.equal(teamSize(app.db, other.id), 0, 'il limite è per agenzia');
  assert.equal(code(() => member(app, other, { email: 'ok@dmc.example' })), null);
});

test('il collegamento: aperto, scaduto, già usato, sconosciuto', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { user, token } = member(app, acct);
  const r = memberByToken(app.db, token, NOW + DAY);
  assert.deepEqual([r.state, r.user.id, r.account.id], ['open', user.id, acct.id]);
  assert.equal(memberByToken(app.db, token, NOW + 7 * DAY - 1).state, 'open');
  assert.equal(memberByToken(app.db, token, NOW + 7 * DAY).state, 'expired');
  for (const bad of ['', 'corto', 'x'.repeat(81), token + 'x', token.slice(1), undefined, null, 42, {}, [token]]) assert.deepEqual(memberByToken(app.db, bad, NOW), { state: 'unknown', user: null, account: null }, String(bad));
  activate(app, user, NOW + DAY);
  assert.equal(memberByToken(app.db, token, NOW + 2 * DAY).state, 'used');
  assert.equal(memberByToken(app.db, token, NOW + 30 * DAY).state, 'used', 'usato vince su scaduto');
});

test('la password si sceglie una volta sola, e non a invito scaduto', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { user } = member(app, acct);
  assert.equal(activateMember(app.db, user.id, 'prima', NOW + 7 * DAY), false, 'scaduto');
  assert.equal(activateMember(app.db, user.id, 'prima', NOW + DAY), true);
  const done = getMember(app.db, acct.id, user.id);
  assert.deepEqual([done.password_hash, done.activated_at, done.last_login_at], ['prima', new Date(NOW + DAY).toISOString(), new Date(NOW + DAY).toISOString()]);
  assert.equal(activateMember(app.db, user.id, 'seconda', NOW + DAY), false, 'la seconda volta no');
  assert.equal(getMember(app.db, acct.id, user.id).password_hash, 'prima');
  assert.equal(activateMember(app.db, 9999, 'x', NOW), false);
  touchLogin(app.db, user.id, NOW + 3 * DAY);
  assert.equal(getMember(app.db, acct.id, user.id).last_login_at, new Date(NOW + 3 * DAY).toISOString());
});

test('rinvio: collegamento nuovo (il vecchio non vale più) per chi non ha ancora scelto la password; non per gli altri', (t) => {
  const { app, acct, other } = setup();
  t.after(app.cleanup);
  const { user, token } = member(app, acct);
  const r = renewMemberInvite(app.db, acct.id, user.id, NOW + 10 * DAY);
  assert.notEqual(r.token, token);
  assert.equal(r.user.token_expires_at, new Date(NOW + 17 * DAY).toISOString(), 'anche se era scaduto');
  assert.equal(memberByToken(app.db, token, NOW + 10 * DAY).state, 'unknown');
  assert.equal(memberByToken(app.db, r.token, NOW + 10 * DAY).state, 'open');
  assert.equal(renewMemberInvite(app.db, other.id, user.id, NOW), null, 'non è un collaboratore di quell’agenzia');
  assert.equal(renewMemberInvite(app.db, acct.id, 9999, NOW), null);
  activate(app, user, NOW + 10 * DAY);
  assert.equal(renewMemberInvite(app.db, acct.id, user.id, NOW + 11 * DAY), null, 'ha già la password');
});

test('chi può entrare con un indirizzo: il titolare, o un collaboratore con la password; non chi non l’ha ancora scelta', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { user } = member(app, acct);
  assert.equal(loginTarget(app.db, 'titolare@dmc.example').user, null);
  assert.equal(loginTarget(app.db, ' TITOLARE@dmc.example ').acct.id, acct.id);
  assert.equal(loginTarget(app.db, 'marco@dmc.example'), null, 'invitato ma senza password');
  activate(app, user);
  const who = loginTarget(app.db, 'Marco@dmc.example');
  assert.deepEqual([who.acct.id, who.user.id], [acct.id, user.id]);
  assert.equal(loginTarget(app.db, 'nessuno@dmc.example'), null);
  assert.equal(loginTarget(app.db, ''), null);
});

test('togliere un collaboratore: non entra più, il suo carrello sparisce, gli avvisi passano al titolare, le prenotazioni restano con il suo nome', (t) => {
  const { app, acct, other } = setup();
  t.after(app.cleanup);
  const { user } = member(app, acct);
  activate(app, user);
  cartAdd(app, acct, TOUR(), NOW, user.id);
  cartAdd(app, acct, TOUR({ time: '14:30' }), NOW, null);
  const booking = createBooking(app, base({ tourSlug: 'shared', channel: 'b2b', account: acct, bookedBy: bookedBy(actorOf(acct, user)), paymentMethod: 'invoice', date: '2027-02-12', time: '09:30' }), NOW);
  app.db.prepare("INSERT INTO waitlist (account_id, user_id, tour_slug, date, pax, created_at) VALUES (?, ?, 'shared-agenzie', '2027-02-20', 2, ?)").run(acct.id, user.id, new Date(NOW).toISOString());
  assert.equal(removeMember(app.db, other.id, user.id), false, 'un’altra agenzia non può');
  assert.equal(teamSize(app.db, acct.id), 1);
  assert.equal(removeMember(app.db, acct.id, user.id), true);
  assert.equal(removeMember(app.db, acct.id, user.id), false);
  assert.equal(teamSize(app.db, acct.id), 0);
  assert.equal(loginTarget(app.db, 'marco@dmc.example'), null);
  assert.equal(cartCount(app.db, acct.id, user.id), 0);
  assert.equal(cartCount(app.db, acct.id, null), 1, 'il carrello del titolare non si tocca');
  assert.equal(app.db.prepare('SELECT user_id FROM waitlist').get().user_id, null);
  const kept = app.db.prepare('SELECT booked_by_user, booked_by_name FROM bookings WHERE id = ?').get(booking.id);
  assert.deepEqual({ ...kept }, { booked_by_user: user.id, booked_by_name: 'Marco Rossi' });
  assert.equal(emailInUse(app.db, 'marco@dmc.example'), false, 'l’indirizzo si può invitare di nuovo');
  assert.equal(code(() => member(app, acct)), null);
});

test('pacchetto in preparazione: personale, per il titolare e per ogni collaboratore', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { user } = member(app, acct);
  const { user: second } = member(app, acct, { email: 'luca@dmc.example', name: 'Luca Verdi' });
  const mine = cartAdd(app, acct, TOUR(), NOW, null);
  const his = cartAdd(app, acct, TOUR(), NOW, user.id); // lo stesso servizio nel carrello di un altro: nessun doppione
  const hers = cartAdd(app, acct, TOUR({ time: '14:30' }), NOW, second.id);
  assert.equal(cartCount(app.db, acct.id, null), 1);
  assert.equal(cartCount(app.db, acct.id, user.id), 1);
  assert.equal(cartCount(app.db, acct.id, second.id), 1);
  assert.deepEqual(cartItems(app.db, acct.id, user.id).map((i) => i.id), [his]);
  assert.throws(() => cartAdd(app, acct, TOUR(), NOW, user.id), { code: 'duplicate' }, 'nel proprio carrello sì');
  assert.equal(cartRemove(app.db, acct.id, mine, user.id), false, 'il carrello di un altro non si tocca');
  assert.equal(cartRemove(app.db, acct.id, hers, null), false);
  assert.equal(cartRemove(app.db, acct.id, mine, null), true);
  assert.equal(cartClear(app.db, acct.id, user.id), 1);
  assert.equal(cartCount(app.db, acct.id, second.id), 1);
});

test('«prenotata da»: sulla prenotazione e sul pacchetto, solo per le agenzie', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const { user } = member(app, acct);
  const mk = (over) => createBooking(app, base({ tourSlug: 'shared', channel: 'b2b', account: acct, paymentMethod: 'invoice', date: '2027-02-12', time: '09:30', ...over }), NOW);
  const b1 = mk({ bookedBy: bookedBy(actorOf(acct, user)) });
  assert.deepEqual([b1.booked_by_user, b1.booked_by_name], [user.id, 'Marco Rossi']);
  const b2 = mk({ time: '14:30', bookedBy: bookedBy(actorOf(acct)) });
  assert.deepEqual([b2.booked_by_user, b2.booked_by_name], [null, 'Giulia Bianchi'], 'il titolare: nome, ma nessun id');
  const b3 = mk({ date: '2027-02-13' });
  assert.deepEqual([b3.booked_by_user, b3.booked_by_name], [null, null], 'dal pannello: nessuno in particolare');
  const b4 = mk({ date: '2027-02-14', bookedBy: { userId: user.id, name: `  ${'x'.repeat(300)}` } });
  assert.equal(b4.booked_by_name.length, 120);
  const priv = createBooking(app, base({ tourSlug: 'shared', channel: 'b2c', paymentMethod: 'onsite', date: '2027-02-15', time: '09:30', bookedBy: { userId: user.id, name: 'Marco Rossi' } }), NOW);
  assert.deepEqual([priv.booked_by_user, priv.booked_by_name], [null, null], 'un privato non ha un «prenotata da»');

  const lines = [TOUR({ date: '2027-02-16' }), TOUR({ date: '2027-02-17' })].map((x) => ({ tour: app.content.tour(x.tour), date: x.date, time: x.time, pax: x.pax }));
  const { group, bookings } = createPackage(app, acct, lines, { name: 'Anna Conti', email: 'anna@dmc.example', lang: 'it', paymentMethod: 'invoice', bookedBy: bookedBy(actorOf(acct, user)) }, NOW);
  assert.deepEqual([group.booked_by_user, group.booked_by_name], [user.id, 'Marco Rossi']);
  assert.deepEqual(bookings.map((b) => [b.booked_by_user, b.booked_by_name]), [[user.id, 'Marco Rossi'], [user.id, 'Marco Rossi']]);
});

test('lista d’attesa: l’avviso arriva a chi l’ha chiesto; un collega può chiedere lo stesso avviso', (t) => {
  const { app, acct, other } = setup();
  t.after(app.cleanup);
  const { user } = member(app, acct, { lang: 'en' });
  activate(app, user);
  // la data è tutta occupata da un'altra agenzia
  for (const time of ['09:30', '14:30']) createBooking(app, base({ tourSlug: 'shared', channel: 'b2b', account: other, paymentMethod: 'invoice', date: '2027-02-20', time, pax: 10 }), NOW);
  const mine = joinWaitlist(app, acct, { tour: 'shared-agenzie', pax: 2, date: '2027-02-20' }, NOW);
  assert.equal(mine.user_id, null);
  assert.throws(() => joinWaitlist(app, acct, { tour: 'shared-agenzie', pax: 2, date: '2027-02-20' }, NOW), { code: 'dup' });
  const his = joinWaitlist(app, acct, { tour: 'shared-agenzie', pax: 2, date: '2027-02-20' }, NOW, user.id);
  assert.equal(his.user_id, user.id);
  assert.throws(() => joinWaitlist(app, acct, { tour: 'shared-agenzie', pax: 2, date: '2027-02-20' }, NOW, user.id), { code: 'dup' });
  const waiting = waitingEntries(app.db, '2027-01-04');
  assert.deepEqual(waiting.map((w) => [w.id, w.acct_email, w.acct_name, w.acct_lang, w.acct_company]), [
    [mine.id, 'titolare@dmc.example', 'Giulia Bianchi', 'it', 'Venice DMC'],
    [his.id, 'marco@dmc.example', 'Marco Rossi', 'en', 'Venice DMC'],
  ]);
  removeMember(app.db, acct.id, user.id);
  assert.deepEqual(waitingEntries(app.db, '2027-01-04').map((w) => w.acct_email), ['titolare@dmc.example', 'titolare@dmc.example'], 'tolto: gli avvisi vanno al titolare');
});
