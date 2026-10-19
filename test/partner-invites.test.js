// Inviti alle agenzie, senza rete né email: stati, collegamento (solo l'impronta nel database), una volta sola, rinnovo e annullo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { INVITE_DAYS, InviteError, cancelInvite, createInvite, getInvite, inviteByToken, listInvites, markSent, markUsed, renewInvite, stateOf } from '../server/partnerInvites.js';
import { addAccount, makeApp, NOW } from './helpers.js';

const DAY = 86_400_000;
const code = (fn) => { try { fn(); } catch (err) { return err instanceof InviteError ? err.code : `altro: ${err.message}`; } return null; };

test('un invito: indirizzo ripulito, dati facoltativi, scadenza a 14 giorni, solo l’impronta del collegamento nel database', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const made = createInvite(db, { email: '  Anna@Lagoon.EXAMPLE ', company: ' Lagoon DMC ', contactName: 'Anna', lang: 'en', note: 'Ciao\u0007!' }, NOW);
  assert.equal(made.reused, false);
  assert.match(made.token, /^[A-Za-z0-9_-]{32}$/);
  const i = made.invite;
  assert.deepEqual([i.email, i.company, i.contact_name, i.lang, i.note], ['anna@lagoon.example', 'Lagoon DMC', 'Anna', 'en', 'Ciao!']);
  assert.equal(i.created_at, new Date(NOW).toISOString());
  assert.equal(i.expires_at, new Date(NOW + INVITE_DAYS * DAY).toISOString());
  assert.equal(INVITE_DAYS, 14);
  assert.equal(i.token_hash, crypto.createHash('sha256').update(made.token).digest('hex'));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM partner_invites').all()).includes(made.token));
  assert.deepEqual([i.sent_at, i.used_at, i.cancelled_at, i.account_id], [null, null, null, null]);
  // senza dati facoltativi e con una lingua strana
  const bare = createInvite(db, { email: 'b@x.example', lang: 'fr' }, NOW);
  assert.deepEqual([bare.invite.company, bare.invite.contact_name, bare.invite.note, bare.invite.lang], [null, null, null, 'it']);
  // testi lunghi tagliati
  const long = createInvite(db, { email: 'c@x.example', company: 'x'.repeat(500), note: 'y'.repeat(2000) }, NOW).invite;
  assert.deepEqual([long.company.length, long.note.length], [160, 600]);
});

test('email non valida e agenzia già registrata', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  for (const email of ['', 'senza-chiocciola', 'a@b', 'due@@x.it', null, undefined]) assert.equal(code(() => createInvite(db, { email }, NOW)), 'email', String(email));
  addAccount(db, { email: 'esiste@x.example' });
  assert.equal(code(() => createInvite(db, { email: 'Esiste@X.example' }, NOW)), 'exists');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM partner_invites').get().n, 0);
});

test('lo stesso indirizzo con un invito aperto: stesso invito, collegamento nuovo e scadenza nuova; dopo annullo o uso, un invito nuovo', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const one = createInvite(db, { email: 'a@x.example', company: 'Prima', lang: 'it' }, NOW);
  markSent(db, one.invite.id, NOW);
  assert.equal(getInvite(db, one.invite.id).sent_at, new Date(NOW).toISOString());
  const two = createInvite(db, { email: 'A@x.example', company: 'Dopo', lang: 'es' }, NOW + 5 * DAY);
  assert.equal(two.reused, true);
  assert.equal(two.invite.id, one.invite.id);
  assert.deepEqual([two.invite.company, two.invite.lang, two.invite.sent_at], ['Dopo', 'es', null], 'da rimandare');
  assert.equal(two.invite.expires_at, new Date(NOW + 5 * DAY + 14 * DAY).toISOString());
  assert.equal(inviteByToken(db, one.token, NOW).state, 'unknown', 'il collegamento di prima non vale più');
  assert.equal(inviteByToken(db, two.token, NOW).state, 'open');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM partner_invites').get().n, 1);
  // annullato: il prossimo è un invito nuovo
  assert.equal(cancelInvite(db, two.invite.id, NOW), true);
  const three = createInvite(db, { email: 'a@x.example' }, NOW);
  assert.equal(three.reused, false);
  assert.notEqual(three.invite.id, two.invite.id);
  // usato: lo stesso (ma l'agenzia ora ha un account, quindi non si invita più)
  const acct = addAccount(db, { email: 'a@x.example' });
  assert.equal(markUsed(db, three.invite.id, acct.id, NOW), true);
  assert.equal(code(() => createInvite(db, { email: 'a@x.example' }, NOW)), 'exists');
});

test('stati e ricerca per collegamento', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const { invite, token } = createInvite(db, { email: 'a@x.example' }, NOW);
  assert.equal(stateOf(invite, NOW), 'open');
  assert.equal(stateOf(invite, NOW + 14 * DAY - 1), 'open');
  assert.equal(stateOf(invite, NOW + 14 * DAY), 'expired', 'allo scadere dei 14 giorni non vale più');
  assert.equal(stateOf({ ...invite, used_at: 'x' }, NOW), 'used');
  assert.equal(stateOf({ ...invite, cancelled_at: 'x' }, NOW), 'cancelled');
  assert.equal(stateOf({ ...invite, used_at: 'x', cancelled_at: 'y' }, NOW + 99 * DAY), 'used', 'usato vince su scaduto e annullato');
  assert.equal(inviteByToken(db, token, NOW).invite.id, invite.id);
  assert.equal(inviteByToken(db, token, NOW + 15 * DAY).state, 'expired');
  for (const bad of ['', 'corto', 'x'.repeat(81), token + 'x', token.slice(1), undefined, null, 42, {}, [token]]) assert.deepEqual(inviteByToken(db, bad, NOW), { state: 'unknown', invite: null }, String(bad));
});

test('si usa una volta sola, e non se è scaduto o annullato', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const mk = (email) => createInvite(db, { email }, NOW).invite;
  const a = addAccount(db, { email: 'nuova@x.example' }); // l'account che l'invito crea
  const ok = mk('invitata@x.example');
  assert.equal(markUsed(db, ok.id, a.id, NOW + DAY), true);
  assert.equal(markUsed(db, ok.id, a.id, NOW + DAY), false, 'la seconda volta no');
  assert.deepEqual([getInvite(db, ok.id).account_id, getInvite(db, ok.id).used_at], [a.id, new Date(NOW + DAY).toISOString()]);
  const expired = mk('e@x.example');
  assert.equal(markUsed(db, expired.id, a.id, NOW + 14 * DAY), false);
  const cancelled = mk('c@x.example');
  cancelInvite(db, cancelled.id, NOW);
  assert.equal(markUsed(db, cancelled.id, a.id, NOW), false);
  assert.equal(markUsed(db, 9999, a.id, NOW), false);
  // annullare: solo un invito aperto, una volta
  const open = mk('d@x.example');
  assert.equal(cancelInvite(db, open.id, NOW), true);
  assert.equal(cancelInvite(db, open.id, NOW), false);
  assert.equal(cancelInvite(db, ok.id, NOW), false, 'uno già usato non si annulla');
  assert.equal(cancelInvite(db, 9999, NOW), false);
});

test('rinnovo: un invito aperto o scaduto riparte con un collegamento nuovo; usato, annullato o con l’agenzia già registrata no', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const mk = (email) => createInvite(db, { email }, NOW);
  const open = mk('open@x.example');
  markSent(db, open.invite.id, NOW);
  const r1 = renewInvite(db, open.invite.id, NOW + 3 * DAY);
  assert.equal(r1.invite.expires_at, new Date(NOW + 17 * DAY).toISOString());
  assert.equal(r1.invite.sent_at, null);
  assert.notEqual(r1.token, open.token);
  assert.equal(inviteByToken(db, open.token, NOW).state, 'unknown');
  assert.equal(inviteByToken(db, r1.token, NOW + 3 * DAY).state, 'open');
  // scaduto: si rinnova
  const r2 = renewInvite(db, open.invite.id, NOW + 40 * DAY);
  assert.equal(inviteByToken(db, r2.token, NOW + 40 * DAY).state, 'open');
  // usato, annullato, inesistente
  const used = mk('used@x.example').invite;
  markUsed(db, used.id, addAccount(db, { email: 'used@x.example' }).id, NOW);
  assert.equal(renewInvite(db, used.id, NOW), null);
  const cancelled = mk('canc@x.example').invite;
  cancelInvite(db, cancelled.id, NOW);
  assert.equal(renewInvite(db, cancelled.id, NOW), null);
  assert.equal(renewInvite(db, 9999, NOW), null);
  // registrata da sola nel frattempo
  const alone = mk('alone@x.example').invite;
  addAccount(db, { email: 'alone@x.example' });
  assert.equal(renewInvite(db, alone.id, NOW), null);
});

test('elenco: dal più recente, con lo stato e l’agenzia registrata', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  createInvite(db, { email: 'a@x.example' }, NOW);
  createInvite(db, { email: 'b@x.example' }, NOW - 20 * DAY);
  const c = createInvite(db, { email: 'c@x.example' }, NOW).invite;
  const acct = addAccount(db, { email: 'c@x.example', company: 'Ce DMC', status: 'pending' });
  markUsed(db, c.id, acct.id, NOW);
  const list = listInvites(db, NOW);
  assert.deepEqual(list.map((i) => [i.email, i.state]), [['c@x.example', 'used'], ['b@x.example', 'expired'], ['a@x.example', 'open']]);
  assert.deepEqual([list[0].account_company, list[0].account_status], ['Ce DMC', 'pending']);
  assert.equal(list[2].account_company, null);
});
