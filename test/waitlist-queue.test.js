// Lista d'attesa a coda: la prima agenzia in lista è avvisata per prima e ha qualche ora di vantaggio, poi tocca alla successiva.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { cancelBooking, createBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { addDays, fmtInstant, nowRome } from '../server/time.js';
import { exclusiveNow, getEntry, joinWaitlist, queueInfo, queuedBefore, reorderQueue, resetQueue, rivalsOf } from '../server/waitlist.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-waitlist-queue-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MIN = 60_000;
const HOUR = 60 * MIN;
const SHARED = 'shared-agenzie'; // partenze alle 09:30 e alle 14:30, fino a 10 persone
const PRIVATE = 'private-agenzie'; // servizio privato a orario libero
const FAR = '2027-02-20'; // 47 giorni da NOW: il vantaggio vale
const NEAR = '2027-01-06'; // a 38 ore da NOW (meno di 72): troppo vicino, gli avvisi partono a tutte

function setup(over = {}) {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' }, ...over });
  const mk = (email, company, name) => app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(addAccount(app.db, { email, company, contact_name: name, lang: 'it' }).id);
  const x = mk('x@dmc.example', 'Agenzia X', 'Xavier');
  const [a, b, c] = [mk('a@dmc.example', 'Agenzia A', 'Anna'), mk('b@dmc.example', 'Agenzia B', 'Bruno'), mk('c@dmc.example', 'Agenzia C', 'Carla')];
  app.db.prepare('UPDATE accounts SET option_max = 0').run();
  return { app, x, a, b, c };
}
const hold = (app, acct, date, time, pax = 10, tourSlug = SHARED) => createBooking(app, base({ tourSlug, channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date, time, pax, option: true, clientRef: 'Gruppo' }), NOW);
/** X tiene tutta la data (le due partenze); ritorna le sue due opzioni. */
const holdDay = (app, x, date) => ['09:30', '14:30'].map((time) => hold(app, x, date, time));
/** Come sopra, ma con prenotazioni confermate (per le date vicine non si può più opzionare). */
const bookDay = (app, x, date) => ['09:30', '14:30'].map((time) => createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: x, email: x.email, name: x.contact_name, date, time, pax: 10, paymentMethod: 'invoice', clientRef: 'Gruppo' }), NOW));
const free = (app, bookings, nowMs) => bookings.forEach((b) => cancelBooking(app, b.id, { by: 'customer' }, nowMs));
const join = (app, acct, date, over = {}, nowMs = NOW) => joinWaitlist(app, acct, { tour: SHARED, pax: 2, date, ...over }, nowMs);
const mailsTo = (app, to) => app.mail.sent.filter((m) => m.to === to && /Si è liberata/.test(m.subject));
const who = (app) => app.mail.sent.filter((m) => /Si è liberata/.test(m.subject)).map((m) => m.to.split('@')[0]);

test('coda: la prima è avvisata per prima e ha un vantaggio; poi tocca alla successiva, e così via', async (t) => {
  const { app, x, a, b, c } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  const ea = join(app, a, FAR, { pax: 8 }, NOW + MIN);
  const eb = join(app, b, FAR, { pax: 8 }, NOW + 2 * MIN);
  const ec = join(app, c, FAR, { pax: 8 }, NOW + 3 * MIN);
  const info = (e, ms = NOW + 4 * MIN) => queueInfo(app.db, app.cfg, getEntry(app.db, e.id), ms);
  assert.deepEqual([info(ea).ahead, info(ea).behind], [0, 2], 'A: nessuna davanti, due dietro');
  assert.deepEqual([info(eb).ahead, info(eb).behind], [1, 1]);
  assert.deepEqual([info(ec).ahead, info(ec).behind], [2, 0]);
  assert.ok([ea, eb, ec].every((e) => info(e).exclusive && info(e).until === null));

  free(app, held, NOW + 10 * MIN); // X rilascia: tutti e 10 i posti sono liberi
  const t0 = NOW + 11 * MIN;
  assert.equal(await app.waitlist.sweep(t0), 1, 'solo A');
  assert.deepEqual(who(app), ['a']);
  const mail = mailsTo(app, 'a@dmc.example')[0];
  assert.ok(mail.text.includes(`hai tempo fino al ${fmtInstant(t0 + 24 * HOUR, 'it')} prima che la data venga segnalata anche alle altre agenzie in lista`), mail.text);
  assert.match(mail.text, /chi prenota per primo/);
  assert.deepEqual(['a', 'b', 'c'].map((k) => [getEntry(app.db, { a: ea, b: eb, c: ec }[k].id).status]), [['notified'], ['waiting'], ['waiting']]);
  assert.equal(info(ea, t0 + MIN).until, t0 + 24 * HOUR, 'A vede fino a quando ha il vantaggio');
  assert.deepEqual([info(eb, t0 + MIN).ahead, info(ec, t0 + MIN).ahead], [1, 2], 'A ha ancora il vantaggio: conta come davanti');

  // dentro la finestra nessuno si muove
  assert.equal(await app.waitlist.sweep(t0 + 12 * HOUR), 0);
  assert.equal(await app.waitlist.sweep(t0 + 24 * HOUR - MIN), 0);
  // scaduto il vantaggio di A, tocca a B (e C aspetta B)
  const t1 = t0 + 24 * HOUR + MIN;
  assert.equal(await app.waitlist.sweep(t1), 1);
  assert.deepEqual(who(app), ['a', 'b']);
  assert.ok(mailsTo(app, 'b@dmc.example')[0].text.includes(`hai tempo fino al ${fmtInstant(t1 + 24 * HOUR, 'it')}`), 'B ha il suo vantaggio: dietro c’è C');
  assert.equal(getEntry(app.db, ec.id).status, 'waiting');
  assert.equal(info(ea, t1 + MIN).until, null, 'A non ha più vantaggio');
  assert.equal(info(ea, t1 + MIN).ahead, 0);
  // poi C, per ultima: l'email non parla di vantaggio perché nessuno aspetta dietro
  const t2 = t1 + 24 * HOUR + MIN;
  assert.equal(await app.waitlist.sweep(t2), 1);
  assert.deepEqual(who(app), ['a', 'b', 'c']);
  assert.doesNotMatch(mailsTo(app, 'c@dmc.example')[0].text, /hai tempo fino/);
  assert.equal(await app.waitlist.sweep(t2 + 48 * HOUR), 0, 'finita la coda non si manda altro');
});

test('chi esce dalla coda (toglie l’avviso, prenota) passa il turno subito; chi si rimette in lista va in fondo', async (t) => {
  const { app, x, a, b, c } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  const ea = join(app, a, FAR, { pax: 8 }, NOW + MIN);
  const eb = join(app, b, FAR, { pax: 8 }, NOW + 2 * MIN);
  join(app, c, FAR, { pax: 8 }, NOW + 3 * MIN);
  free(app, held, NOW + 10 * MIN);
  const t0 = NOW + 11 * MIN;
  assert.equal(await app.waitlist.sweep(t0), 1);
  assert.deepEqual(who(app), ['a']);

  // A toglie l'avviso: B viene avvisata subito, senza aspettare le 24 ore
  assert.equal(app.waitlist.remove(a, ea.id), true);
  assert.equal(await app.waitlist.sweep(t0 + MIN), 1);
  assert.deepEqual(who(app), ['a', 'b']);
  // B prenota: esce dalla lista; ma il posto non basta più per C (2 posti), quindi C aspetta e basta
  createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: b, email: b.email, name: b.contact_name, date: FAR, time: '09:30', pax: 8, paymentMethod: 'invoice', clientRef: 'Gruppo B' }), t0 + 2 * MIN);
  assert.equal(await app.waitlist.sweep(t0 + 3 * MIN), 1, 'C trova libera la seconda partenza (14:30)');
  assert.deepEqual(who(app), ['a', 'b', 'c']);

  // B riempie anche la seconda partenza: la data non ha più posto per 8 persone, e A può rimettersi in lista da capo (va in fondo, dietro a chi è già entrata)
  createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: b, email: b.email, name: b.contact_name, date: FAR, time: '14:30', pax: 8, paymentMethod: 'invoice', clientRef: 'Gruppo B2' }), t0 + 4 * MIN);
  const old = getEntry(app.db, eb.id);
  const again = await app.waitlist.join(a, { tour: SHARED, pax: 8, date: FAR }, t0 + 10 * MIN);
  assert.equal(again.status, 'waiting');
  assert.ok(queuedBefore(old, again) && !queuedBefore(again, old));
});

test('un’agenzia che si rimette in lista dopo l’avviso torna in fondo alla coda', async (t) => {
  const { app, x, a, b } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  const ea = join(app, a, FAR, { pax: 8 }, NOW + MIN);
  const eb = join(app, b, FAR, { pax: 8 }, NOW + 2 * MIN);
  free(app, held, NOW + 10 * MIN);
  const t0 = NOW + 11 * MIN;
  await app.waitlist.sweep(t0);
  assert.equal(getEntry(app.db, ea.id).status, 'notified');
  // A non ci è riuscita (altri hanno preso la data) e si rimette in lista: ora B è prima di lei
  assert.equal(app.waitlist.rearm(a, ea.id, t0 + 2 * MIN), true);
  const a2 = getEntry(app.db, ea.id);
  assert.equal(a2.status, 'waiting');
  assert.equal(a2.queued_at, new Date(t0 + 2 * MIN).toISOString());
  assert.equal(a2.created_at, new Date(NOW + MIN).toISOString(), 'la data di iscrizione non cambia');
  assert.ok(queuedBefore(getEntry(app.db, eb.id), a2));
  assert.deepEqual([queueInfo(app.db, app.cfg, a2, t0 + 3 * MIN).ahead, queueInfo(app.db, app.cfg, getEntry(app.db, eb.id), t0 + 3 * MIN).ahead], [1, 0]);
  // al prossimo giro il turno è di B
  assert.equal(await app.waitlist.sweep(t0 + 3 * MIN), 1);
  assert.deepEqual(who(app), ['a', 'b']);
  assert.equal(getEntry(app.db, ea.id).status, 'waiting', 'A aspetta che finisca il vantaggio di B');
});

test('se il posto basta per più agenzie partono insieme; chi non ci sta aspetta che finiscano i vantaggi di tutte', async (t) => {
  const { app, x, a, b, c } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  join(app, a, FAR, { pax: 2 }, NOW + MIN);
  join(app, b, FAR, { pax: 3 }, NOW + 2 * MIN);
  const ec = join(app, c, FAR, { pax: 8 }, NOW + 3 * MIN);
  free(app, held, NOW + 10 * MIN);
  const t0 = NOW + 11 * MIN;
  assert.equal(await app.waitlist.sweep(t0), 2, 'A (2) e B (3) ci stanno insieme in 10 posti');
  assert.deepEqual(who(app), ['a', 'b']);
  assert.match(mailsTo(app, 'b@dmc.example')[0].text, /hai tempo fino/, 'dietro a B c’è C (8 persone), che con loro non ci sta');
  assert.equal(getEntry(app.db, ec.id).status, 'waiting');
  assert.equal(await app.waitlist.sweep(t0 + 12 * HOUR), 0);
  assert.equal(await app.waitlist.sweep(t0 + 24 * HOUR + MIN), 1, 'finiti i due vantaggi, tocca a C');
  assert.deepEqual(who(app), ['a', 'b', 'c']);
});

test('l’email di A parla di vantaggio solo se qualcuna deve davvero aspettare', async (t) => {
  const { app, x, a, b } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  join(app, a, FAR, { pax: 2 }, NOW + MIN);
  join(app, b, FAR, { pax: 3 }, NOW + 2 * MIN); // ci stanno insieme: B non aspetta
  free(app, held, NOW + 10 * MIN);
  assert.equal(await app.waitlist.sweep(NOW + 11 * MIN), 2);
  for (const k of ['a', 'b']) assert.doesNotMatch(mailsTo(app, `${k}@dmc.example`)[0].text, /hai tempo fino/);
});

test('servizio vicino, vantaggio spento, orari diversi e servizi privati', async (t) => {
  // vicino (meno di 72 ore): tutte insieme
  const near = setup();
  t.after(near.app.cleanup);
  const heldNear = bookDay(near.app, near.x, NEAR);
  join(near.app, near.a, NEAR, { pax: 8 }, NOW + MIN);
  join(near.app, near.b, NEAR, { pax: 8 }, NOW + 2 * MIN);
  free(near.app, heldNear, NOW + 10 * MIN);
  assert.equal(exclusiveNow(near.app.cfg, { date: NEAR, time: null }, NOW), false);
  assert.equal(await near.app.waitlist.sweep(NOW + 11 * MIN), 2, 'entrambe, senza aspettare');
  assert.deepEqual(who(near.app), ['a', 'b']);
  assert.doesNotMatch(mailsTo(near.app, 'a@dmc.example')[0].text, /hai tempo fino/);
  assert.deepEqual(queueInfo(near.app.db, near.app.cfg, getEntry(near.app.db, 1), NOW + 12 * MIN), { exclusive: false, ahead: 0, behind: 0, until: null });

  // vantaggio spento (0 ore)
  const off = setup({ waitlist: { priorityHours: 0 } });
  t.after(off.app.cleanup);
  const heldOff = holdDay(off.app, off.x, FAR);
  join(off.app, off.a, FAR, { pax: 8 }, NOW + MIN);
  join(off.app, off.b, FAR, { pax: 8 }, NOW + 2 * MIN);
  free(off.app, heldOff, NOW + 10 * MIN);
  assert.equal(await off.app.waitlist.sweep(NOW + 11 * MIN), 2);
  assert.equal(queueInfo(off.app.db, off.app.cfg, getEntry(off.app.db, 1), NOW + 12 * MIN).exclusive, false);

  // orari diversi non si contendono: 09:30 e 14:30
  const split = setup();
  t.after(split.app.cleanup);
  const heldSplit = holdDay(split.app, split.x, FAR);
  const e1 = join(split.app, split.a, FAR, { pax: 8, time: '09:30' }, NOW + MIN);
  const e2 = join(split.app, split.b, FAR, { pax: 8, time: '14:30' }, NOW + 2 * MIN);
  assert.deepEqual(rivalsOf(split.app.db, getEntry(split.app.db, e1.id)), []);
  assert.deepEqual(rivalsOf(split.app.db, getEntry(split.app.db, e2.id)), []);
  free(split.app, heldSplit, NOW + 10 * MIN);
  assert.equal(await split.app.waitlist.sweep(NOW + 11 * MIN), 2);

  // «qualsiasi orario» contende con un orario preciso dello stesso giorno
  const any = setup();
  t.after(any.app.cleanup);
  const heldAny = holdDay(any.app, any.x, FAR);
  const e3 = join(any.app, any.a, FAR, { pax: 8, time: '09:30' }, NOW + MIN);
  join(any.app, any.b, FAR, { pax: 8 }, NOW + 2 * MIN);
  assert.deepEqual(rivalsOf(any.app.db, getEntry(any.app.db, e3.id)).map((r) => r.acct_company), ['Agenzia B']);

  // servizio privato: una sola agenzia alla volta, anche se i numeri «ci starebbero»
  const priv = setup();
  t.after(priv.app.cleanup);
  const heldPriv = [hold(priv.app, priv.x, FAR, '10:00', 4, PRIVATE)];
  const pa = joinWaitlist(priv.app, priv.a, { tour: PRIVATE, pax: 2, date: FAR, time: '10:00' }, NOW + MIN);
  joinWaitlist(priv.app, priv.b, { tour: PRIVATE, pax: 2, date: FAR, time: '10:00' }, NOW + 2 * MIN);
  free(priv.app, heldPriv, NOW + 10 * MIN);
  assert.equal(await priv.app.waitlist.sweep(NOW + 11 * MIN), 1);
  assert.deepEqual(who(priv.app), ['a']);
  void pa;
});

// ───────────── pagine ─────────────
const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const REAL = 'cannaregio-ghetto-agenzie'; // partenze 10:00 e 15:00, fino a 10 persone

test('pagine: l’agenzia vede il suo posto in coda e il suo vantaggio; il pannello vede l’ordine e può cambiare le regole', async () => {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    return async (p, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(url + p, { redirect: 'manual', ...init, headers });
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
  try {
    const hash = await hashPassword(PW);
    const mk = (email, company, name) => addAccount(app.db, { email, password_hash: hash, company, contact_name: name, lang: 'it', option_max: 0 });
    const x = mk('xavier@x.example', 'Agenzia X', 'Xavier Rossi');
    const a = mk('anna@lagoon.example', 'Lagoon DMC', 'Anna Bianchi');
    const b = mk('bruno@bluesail.example', 'BlueSail Tours', 'Bruno Neri');
    const c = mk('carla@c.example', 'Carla Tours', 'Carla Verdi');
    const date = day(40);
    for (const time of ['10:00', '15:00']) createBooking(app, { tourSlug: REAL, date, time, pax: 10, channel: 'b2b', account: x, name: x.contact_name, email: x.email, lang: 'it', option: true, clientRef: 'Gruppo' });
    const pa = jar();
    const pb = jar();
    const pc = jar();
    const admin = jar();
    assert.equal((await pc('/it/b2b/login', form({ email: c.email, password: PW }))).status, 303);
    assert.equal((await pa('/it/b2b/login', form({ email: a.email, password: PW }))).status, 303);
    assert.equal((await pb('/it/b2b/login', form({ email: b.email, password: PW }))).status, 303);
    assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
    const joinForm = { tour: REAL, date, pax: '8', time: '' };
    assert.equal((await pa('/it/b2b/waitlist', form(joinForm))).status, 303);
    assert.equal((await pb('/it/b2b/waitlist', form(joinForm))).status, 303);

    const view = (d) => `/it/b2b/availability?tour=${REAL}&pax=8&m=${date.slice(0, 7)}&d=${d}`;
    const pageA = await text(await pa(view(date)));
    const pageB = await text(await pb(view(date)));
    assert.match(pageA, /Sei la prima in lista: sarai avvisata per prima\./);
    assert.doesNotMatch(pageA, /Davanti a te/);
    assert.match(pageB, /Davanti a te in lista: 1\./);
    assert.match(await text(await pc(view(date))), /la prima ha 24 h di vantaggio/, 'il modulo di chi non è ancora in lista spiega come funziona la coda');

    // la data si libera: A ha il vantaggio, B aspetta
    for (const bk of app.db.prepare(`SELECT id FROM bookings WHERE account_id = ? AND status = 'option'`).all(x.id)) cancelBooking(app, bk.id, { by: 'customer' });
    assert.equal(await app.waitlist.sweep(Date.now()), 1);
    assert.equal(app.mail.sent.filter((m) => /Si è liberata/.test(m.subject)).at(-1).to, a.email);
    const afterA = await text(await pa(view(date)));
    assert.match(afterA, /Hai un vantaggio fino al .*: poi l’avviso passa alle altre agenzie in lista\./);
    assert.match(await text(await pb(view(date))), /Davanti a te in lista: 1\./);

    // pannello: ordine e vantaggio
    const adm = await text(await admin('/admin/waitlist'));
    assert.match(adm, /vantaggio fino al/);
    assert.match(adm, /dopo Lagoon DMC/, 'B sta dopo A');
    assert.match(adm, /la prima ha <strong>24 ore di vantaggio<\/strong>/);
    // e le regole si cambiano dalle impostazioni
    const settings = await text(await admin('/admin/settings?s=waitlist'));
    assert.match(settings, /Vantaggio per chi è prima in lista/);
    assert.match(settings, /name="waitlist\.priorityHours"[^>]*value="24"/);
    assert.equal((await admin('/admin/settings/waitlist', form({ 'waitlist.priorityHours': '0', 'waitlist.openBelowHours': '48' }))).status, 303);
    assert.deepEqual(app.cfg.waitlist, { priorityHours: 0, openBelowHours: 48 });
    assert.match(await text(await admin('/admin/waitlist')), /il vantaggio per chi è prima in lista è spento/);
    assert.doesNotMatch(await text(await pb(view(date))), /Davanti a te/, 'senza vantaggio la coda non si mostra');
  } finally {
    app.close();
    http.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});

// ───────────── l'ordine deciso dalla guida ─────────────
const wid = (app, e) => getEntry(app.db, e.id);

test('la guida porta avanti un’agenzia: avvisata per prima anche se è arrivata dopo; chi arriva dopo la sistemazione va in fondo; si torna all’ordine di arrivo', async (t) => {
  const { app, x, a, b, c } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  const ea = join(app, a, FAR, { pax: 8 }, NOW + MIN);
  const eb = join(app, b, FAR, { pax: 8 }, NOW + 2 * MIN);
  const ec = join(app, c, FAR, { pax: 8 }, NOW + 3 * MIN);
  assert.equal(queuedBefore(wid(app, ea), wid(app, eb)), true, 'di partenza conta l’arrivo');
  // la guida porta B davanti a tutte: B, A, C
  assert.equal(reorderQueue(app.db, SHARED, FAR, [eb.id, ea.id, ec.id]), true);
  assert.deepEqual([ea, eb, ec].map((e) => wid(app, e).position), [2, 1, 3]);
  assert.equal(queuedBefore(wid(app, eb), wid(app, ea)), true);
  assert.equal(queuedBefore(wid(app, ea), wid(app, eb)), false);
  assert.equal(queuedBefore(wid(app, ea), wid(app, ec)), true);
  const info = (e, ms = NOW + 4 * MIN) => queueInfo(app.db, app.cfg, wid(app, e), ms);
  assert.deepEqual([info(eb).ahead, info(eb).behind], [0, 2], 'B ora è la prima');
  assert.deepEqual([info(ea).ahead, info(ea).behind], [1, 1]);
  assert.deepEqual([info(ec).ahead, info(ec).behind], [2, 0]);
  assert.deepEqual(rivalsOf(app.db, wid(app, ec)).map((r) => r.acct_company), ['Agenzia B', 'Agenzia A'], 'anche l’elenco delle rivali segue l’ordine');

  // la data si libera: l'avviso va a B, non ad A (che è arrivata prima)
  free(app, held, NOW + 10 * MIN);
  const t0 = NOW + 11 * MIN;
  assert.equal(await app.waitlist.sweep(t0), 1);
  assert.deepEqual(who(app), ['b']);
  assert.deepEqual([wid(app, ea).status, wid(app, eb).status, wid(app, ec).status], ['waiting', 'notified', 'waiting']);
  // finito il vantaggio di B tocca ad A (non a C), poi C
  assert.equal(await app.waitlist.sweep(t0 + 24 * HOUR + MIN), 1);
  assert.deepEqual(who(app), ['b', 'a']);
  assert.equal(await app.waitlist.sweep(t0 + 48 * HOUR + 2 * MIN), 1);
  assert.deepEqual(who(app), ['b', 'a', 'c']);
});

test('ordine deciso dalla guida: i nuovi arrivi vanno in fondo; chi si rimette in lista perde il posto; chi è già stato avvisato resta davanti; si ripristina l’arrivo', async (t) => {
  const { app, x, a, b, c } = setup();
  t.after(app.cleanup);
  const held = holdDay(app, x, FAR);
  const ea = join(app, a, FAR, { pax: 8 }, NOW + MIN);
  const eb = join(app, b, FAR, { pax: 8 }, NOW + 2 * MIN);
  assert.equal(reorderQueue(app.db, SHARED, FAR, [eb.id, ea.id]), true);
  // arriva C dopo la sistemazione: va in fondo, anche se il suo istante sarebbe stato prima di quello di qualcuno
  const ec = join(app, c, FAR, { pax: 8 }, NOW + 3 * MIN);
  assert.equal(wid(app, ec).position, null);
  assert.equal(queuedBefore(wid(app, ea), wid(app, ec)), true);
  assert.equal(queuedBefore(wid(app, ec), wid(app, eb)), false);
  assert.deepEqual(rivalsOf(app.db, wid(app, ea)).map((r) => r.acct_company), ['Agenzia B', 'Agenzia C']);
  // un elenco che non è quello vero non si accetta: manca C, o c'è un estraneo, o un doppione
  assert.equal(reorderQueue(app.db, SHARED, FAR, [ea.id, eb.id]), false, 'manca C (è entrata mentre la pagina era aperta)');
  assert.equal(reorderQueue(app.db, SHARED, FAR, [ea.id, eb.id, ec.id, 9999]), false);
  assert.equal(reorderQueue(app.db, SHARED, FAR, [ea.id, ea.id, ec.id]), false);
  assert.equal(reorderQueue(app.db, SHARED, '2027-02-21', [ea.id, eb.id, ec.id]), false, 'un altro giorno');
  assert.equal(reorderQueue(app.db, 'private-agenzie', FAR, [ea.id, eb.id, ec.id]), false, 'un altro servizio');
  assert.deepEqual([ea, eb, ec].map((e) => wid(app, e).position), [2, 1, null], 'i rifiuti non cambiano nulla');

  // B (davanti) è avvisata; poi la guida porta C davanti ad A: B resta davanti a tutti (già avvisata), C passa A
  free(app, held, NOW + 10 * MIN);
  const t0 = NOW + 11 * MIN;
  assert.equal(await app.waitlist.sweep(t0), 1);
  assert.deepEqual(who(app), ['b']);
  assert.equal(reorderQueue(app.db, SHARED, FAR, [ec.id, ea.id]), true, 'solo chi aspetta ancora; B è già stata avvisata e resta davanti');
  assert.deepEqual([eb, ec, ea].map((e) => wid(app, e).position), [1, 2, 3]);
  assert.equal(queueInfo(app.db, app.cfg, wid(app, ec), t0 + MIN).ahead, 1, 'davanti a C c’è B, con il suo vantaggio');
  // B si rimette in lista dopo l'avviso: torna in fondo, senza numero
  assert.equal(app.waitlist.rearm(b, eb.id, t0 + 2 * MIN), true);
  assert.equal(wid(app, eb).position, null);
  assert.equal(queuedBefore(wid(app, ea), wid(app, eb)), true);
  // la guida riporta il gruppo all'ordine di arrivo
  assert.equal(resetQueue(app.db, SHARED, FAR), 2);
  assert.deepEqual([ea, eb, ec].map((e) => wid(app, e).position), [null, null, null]);
  assert.equal(queuedBefore(wid(app, ea), wid(app, ec)), true, 'A era arrivata prima di C');
  assert.equal(resetQueue(app.db, SHARED, FAR), 0);
});
