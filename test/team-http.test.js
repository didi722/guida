// Più persone per agenzia, dall'inizio alla fine: il titolare invita, il collaboratore sceglie la password ed entra, prenota («prenotata da»),
// ha il suo pacchetto in preparazione, cambia la password; il titolare lo toglie; il pannello lo vede.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword, signToken } from '../server/auth.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { makeT } from '../server/i18n.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-team-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PW = 'prova-prova-1';
const PW2 = 'password-lunga-1';
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const day = (n) => addDays(nowRome().date, n);
const BOOK = (over = {}) => ({ tour: 'cannaregio-ghetto-agenzie', date: day(40), time: '10:00', pax: '4', lang: 'it', tourLang: 'it', paymentMethod: 'invoice', consent: '1', ...over });
const CART = (over = {}) => ({ tour: 'cannaregio-ghetto-agenzie', date: day(40), time: '10:00', pax: '4', name: 'Giulia Bianchi', email: 'giulia@lagoon.example', lang: 'it', tourLang: 'it', ...over });
const JOIN = (over = {}) => ({ password: PW2, password2: PW2, ...over });

async function start({ limited = false } = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  if (!limited) app.limits.register = () => true; // i test fanno più tentativi di quanti il sito ne permetta in un'ora
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    const f = async (p, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(base + p, { redirect: 'manual', ...init, headers });
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        const val = kv.slice(i + 1);
        if (/Max-Age=0/i.test(c) || !val) cookies.delete(kv.slice(0, i));
        else cookies.set(kv.slice(0, i), val);
      }
      return res;
    };
    f.cookies = cookies;
    return f;
  };
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: await hashPassword(PW), company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234' });
  const owner = jar();
  assert.equal((await owner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  const mailsTo = (to) => app.mail.sent.filter((m) => m.to === to);
  const user = (email) => app.db.prepare('SELECT * FROM account_users WHERE email = ?').get(email);
  /** Il titolare invita; ritorna il collegamento dell'email. */
  const invite = async (over = {}) => {
    const v = { name: 'Marco Rossi', email: 'marco@lagoon.example', lang: 'it', ...over };
    const res = await owner('/it/b2b/team', form(v));
    assert.equal(res.status, 200, await res.clone().text());
    const mail = mailsTo(v.email.trim().toLowerCase()).at(-1);
    return { res, mail, url: mail.text.match(/(http:\/\/localhost\/[a-z]{2}\/b2b\/join\/[A-Za-z0-9_-]+)/)[1] };
  };
  /** Invita e fa scegliere la password: ritorna la sessione del collaboratore. */
  const member = async (over = {}, pw = PW2) => {
    const { url } = await invite(over);
    const me = jar();
    const done = await me(new URL(url).pathname, form({ password: pw, password2: pw }));
    assert.equal(done.status, 303);
    return me;
  };
  return { app, cfg, base, admin, owner, anon: jar(), jar, agency, mailsTo, user, invite, member, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('il titolare invita un collaboratore: email nella lingua scelta con il collegamento personale, solo l’impronta nel database', async () => {
  const s = await start();
  try {
    const { app, cfg, owner, anon, mailsTo, user } = s;
    assert.match(loc(await anon('/it/b2b/team')), /\/it\/b2b\/login\?next=/);
    assert.match(loc(await anon('/it/b2b/team', form({ name: 'X Y', email: 'x@example.com' }))), /\/b2b\/login/);
    let page = await text(await owner('/it/b2b/team'));
    assert.match(page, /<h1>Il tuo team<\/h1>/);
    assert.match(page, /Giulia Bianchi<\/strong> <span class="chip">Titolare<\/span><small class="muted">giulia@lagoon\.example/);
    assert.match(page, /Per ora lavori da solo/);
    assert.match(page, /Aggiungi un collaboratore/);

    const { res, mail, url } = await s.invite({ name: 'Marco Rossi', email: ' Marco@Lagoon.example ', lang: 'en' });
    page = await text(res);
    assert.match(page, /Invito mandato a marco@lagoon\.example\./);
    assert.match(page, /Marco Rossi<\/strong> <span class="chip">Collaboratore<\/span>/);
    assert.match(page, /<span class="chip chip-warn">Invito mandato<\/span><small class="muted">Non ha ancora scelto la password<\/small>/);
    assert.doesNotMatch(page, /Per ora lavori da solo/);
    assert.match(page, /\/it\/b2b\/team\/1\/resend/);
    assert.equal(mail.subject, makeT('en')('team.mail.subject', { company: 'Lagoon DMC', site: cfg.site.name }));
    assert.match(mail.text, /^Hi Marco Rossi,/);
    assert.ok(mail.text.includes(makeT('en')('team.mail.intro', { inviter: 'Giulia Bianchi', company: 'Lagoon DMC', site: cfg.site.name })));
    assert.ok(mail.text.includes(makeT('en')('pinv.mail.valid', { days: 7 })));
    assert.ok(mail.html.includes(`href="${url}"`));
    assert.equal(mail.replyTo, 'giulia@lagoon.example', 'chi risponde scrive al titolare');
    assert.equal(mailsTo('marco@lagoon.example').length, 1);

    const row = user('marco@lagoon.example');
    assert.deepEqual([row.account_id, row.name, row.lang, row.password_hash, row.activated_at], [s.agency.id, 'Marco Rossi', 'en', null, null]);
    const token = url.split('/').pop();
    assert.equal(row.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(app.db.prepare('SELECT * FROM account_users').all()).includes(token));
    assert.equal(Date.parse(row.token_expires_at) - Date.parse(row.invited_at), 7 * 86_400_000);
    assert.ok(!(await text(await owner('/it/b2b/team'))).includes(token), 'il collegamento non si rivede nella pagina');
  } finally {
    s.close();
  }
});

test('il collaboratore sceglie la password (una volta sola) ed entra: vede l’agenzia con il suo nome, senza la pagina Team', async () => {
  const s = await start();
  try {
    const { app, owner, anon, jar, user } = s;
    const { url } = await s.invite({ lang: 'en' });
    const at = new URL(url).pathname;
    const open = await anon(at);
    assert.equal(open.status, 200);
    let page = await text(open);
    assert.match(page, /<h1>Choose your password<\/h1>/);
    assert.ok(page.includes(makeT('en')('join.lead', { company: 'Lagoon DMC' })));
    assert.match(page, new RegExp(`<form method="post" action="${at}"`));
    assert.match(page, /<input value="Marco Rossi" readonly>/);
    assert.match(page, /<input type="email" name="email" value="marco@lagoon\.example" readonly/);
    assert.match(page, /<meta name="robots" content="noindex, nofollow">/);

    // password da correggere: il collegamento resta aperto
    const bad = (over, status = 400) => anon(at, form(JOIN(over))).then((r) => { assert.equal(r.status, status, JSON.stringify(over)); return text(r); });
    assert.ok((await bad({ password: 'corta', password2: 'corta' })).includes(makeT('en')('err.password')));
    assert.ok((await bad({ password2: 'un-altra-password' })).includes(makeT('en')('b2b.reset.mismatch')));
    await bad({ website2: 'bot' });
    assert.equal(user('marco@lagoon.example').password_hash, null);
    assert.equal((await anon(at)).status, 200);

    const me = jar();
    const done = await me(at, form(JOIN()));
    assert.equal(done.status, 303);
    assert.equal(loc(done), '/en/b2b/account?flash=welcome');
    const row = user('marco@lagoon.example');
    assert.ok(row.password_hash && row.password_hash !== PW2 && row.activated_at && row.last_login_at);

    // la sua pagina: il suo nome e la sua email, non quelli del titolare; niente pulsante Team
    page = await text(await me('/en/b2b/account?flash=welcome'));
    assert.match(page, /<h1>Lagoon DMC<\/h1><p class="muted">Marco Rossi · marco@lagoon\.example<\/p>/);
    assert.match(page, /Welcome!/);
    assert.doesNotMatch(page, /Giulia Bianchi/);
    assert.doesNotMatch(page, /href="\/en\/b2b\/team"/);
    const ownerPage = await text(await owner('/it/b2b/account'));
    assert.match(ownerPage, /<p class="muted">Giulia Bianchi · giulia@lagoon\.example<\/p>/);
    assert.match(ownerPage, /href="\/it\/b2b\/team">Team<\/a>/);

    // un collaboratore non gestisce il team
    assert.equal(loc(await me('/en/b2b/team')), '/en/b2b/account');
    assert.equal(loc(await me('/en/b2b/team', form({ name: 'Altra Persona', email: 'altra@lagoon.example' }))), '/en/b2b/account');
    assert.equal(loc(await me(`/en/b2b/team/${row.id}/remove`, form())), '/en/b2b/account');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM account_users').get().n, 1);

    // una volta sola
    const again = await anon(at);
    assert.equal(again.status, 410);
    page = await text(again);
    assert.match(page, /<h1>Password already chosen<\/h1>/);
    assert.match(page, /href="\/en\/b2b\/login"/);
    assert.equal((await anon(at, form(JOIN({ password: 'altra-password-1', password2: 'altra-password-1' })))).status, 410);
    assert.notEqual(user('marco@lagoon.example').password_hash, null);
    const login = await anon('/en/b2b/login', form({ email: 'marco@lagoon.example', password: 'altra-password-1' }));
    assert.equal(login.status, 401, 'la password nuova non ha sostituito la prima');
  } finally {
    s.close();
  }
});

test('collegamenti d’invito sbagliati, scaduti, rinviati, e due richieste insieme', async () => {
  const s = await start();
  try {
    const { app, owner, anon, jar, mailsTo, user } = s;
    for (const bad of ['abc', 'x'.repeat(30), 'x'.repeat(100)]) {
      const res = await anon(`/it/b2b/join/${bad}`);
      assert.equal(res.status, 404, bad.slice(0, 4));
      assert.match(await text(res), /<h1>Invito non valido<\/h1>/);
    }
    const first = await s.invite();
    const id = user('marco@lagoon.example').id;
    // scaduto
    app.db.prepare('UPDATE account_users SET token_expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    let res = await anon(new URL(first.url).pathname);
    assert.equal(res.status, 410);
    assert.match(await text(res), /<h1>Invito scaduto<\/h1>/);
    assert.equal((await anon(new URL(first.url).pathname, form(JOIN()))).status, 410);
    assert.match(await text(await owner('/it/b2b/team')), /<span class="chip chip-err">Invito scaduto<\/span><small class="muted">Rinvialo per dargli un collegamento nuovo<\/small>/);
    // rinviato: collegamento nuovo, il vecchio non vale più
    res = await owner(`/it/b2b/team/${id}/resend`, form());
    assert.equal(res.status, 200);
    assert.match(await text(res), /Nuovo invito mandato a marco@lagoon\.example: il collegamento di prima non vale più\./);
    const second = mailsTo('marco@lagoon.example').at(-1).text.match(/(http:\/\/localhost\/[a-z]{2}\/b2b\/join\/[A-Za-z0-9_-]+)/)[1];
    assert.notEqual(second, first.url);
    assert.equal(mailsTo('marco@lagoon.example').length, 2);
    assert.equal((await anon(new URL(first.url).pathname)).status, 404);
    assert.equal((await anon(new URL(second).pathname)).status, 200);
    // due richieste insieme: vince la prima, c'è una sola password
    const [one, two] = await Promise.all([jar()(new URL(second).pathname, form(JOIN({ password: 'prima-password-1', password2: 'prima-password-1' }))), jar()(new URL(second).pathname, form(JOIN({ password: 'seconda-password-1', password2: 'seconda-password-1' })))]);
    assert.deepEqual([one.status, two.status].sort(), [303, 410]);
    // già attivo: non si rinvia
    res = await owner(`/it/b2b/team/${id}/resend`, form());
    assert.equal(loc(res), '/it/b2b/team?err=gone');
    assert.match(await text(await owner(loc(res))), /Quell’invito non si può più rinviare/);
    assert.equal(loc(await owner('/it/b2b/team/9999/resend', form())), '/it/b2b/team?err=gone');
  } finally {
    s.close();
  }
});

test('invito: i tentativi alla pagina d’invito hanno lo stesso limite della registrazione', async () => {
  const s = await start({ limited: true });
  try {
    const { anon } = s;
    const { url } = await s.invite();
    const bad = () => anon(new URL(url).pathname, form(JOIN({ password: 'corta', password2: 'corta' })));
    for (let i = 0; i < 6; i++) assert.equal((await bad()).status, 400, `tentativo ${i + 1}`);
    assert.equal((await bad()).status, 429);
    assert.equal((await anon(new URL(url).pathname)).status, 200, 'aprire la pagina resta possibile');
  } finally {
    s.close();
  }
});

test('invito: errori del modulo, indirizzi già in uso, numero massimo, limite di richieste', async () => {
  const s = await start();
  try {
    const { app, owner, mailsTo } = s;
    const add = (v) => owner('/it/b2b/team', form({ lang: 'it', ...v }));
    let res = await add({ name: 'M', email: 'marco@lagoon.example' });
    assert.equal(res.status, 400);
    let page = await text(res);
    assert.ok(page.includes(makeT('it')('team.err.name')));
    assert.match(page, /name="email"[^>]*value="marco@lagoon\.example"/, 'ciò che si era scritto resta nel modulo');
    res = await add({ name: 'Marco Rossi', email: 'non-un-indirizzo' });
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(makeT('it')('err.email')));
    // già usati: il titolare, un'altra agenzia, un collaboratore
    addAccount(app.db, { email: 'altra@dmc.example', company: 'Altra DMC', contact_name: 'Carla' });
    for (const email of ['giulia@lagoon.example', 'GIULIA@lagoon.example', 'altra@dmc.example']) {
      res = await add({ name: 'Marco Rossi', email });
      assert.equal(res.status, 400, email);
      assert.ok((await text(res)).includes(makeT('it')('team.err.exists')), email);
    }
    assert.equal((await add({ name: 'Marco Rossi', email: 'marco@lagoon.example' })).status, 200);
    res = await add({ name: 'Marco Bis', email: 'Marco@lagoon.example' });
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(makeT('it')('team.err.exists')));
    assert.equal(mailsTo('giulia@lagoon.example').length + mailsTo('altra@dmc.example').length, 0, 'nessuna email a indirizzi che non si possono invitare');
    // il massimo
    for (let i = 2; i <= 10; i++) assert.equal((await add({ name: `Collega ${i}`, email: `c${i}@lagoon.example` })).status, 200);
    res = await add({ name: 'Uno di troppo', email: 'extra@lagoon.example' });
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(makeT('it')('team.err.limit', { n: 10 })));
    page = await text(await owner('/it/b2b/team'));
    assert.ok(page.includes(makeT('it')('team.err.limit', { n: 10 })), 'il modulo non si offre più');
    assert.doesNotMatch(page, /action="\/it\/b2b\/team">/);
    // limite di richieste per agenzia (20 l'ora)
    let blocked = 0;
    for (let i = 0; i < 25; i++) if ((await add({ name: 'M', email: 'x@lagoon.example' })).status === 429) blocked++;
    assert.ok(blocked >= 1, 'oltre il limite: troppe richieste');
  } finally {
    s.close();
  }
});

test('«prenotata da»: il collaboratore prenota con il suo nome e la sua email; il titolare lo vede e filtra le sue', async () => {
  const s = await start();
  try {
    const { app, owner, agency, mailsTo, user } = s;
    const me = await s.member();
    const row = user('marco@lagoon.example');

    // il modulo di prenotazione propone il nome e l'email di chi lavora
    const url = `/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(40)}&time=10:00&pax=4`;
    const mine = await text(await me(url));
    assert.match(mine, /name="name"[^>]*value="Marco Rossi"/);
    assert.match(mine, /name="email"[^>]*value="marco@lagoon\.example"/);
    const hers = await text(await owner(url));
    assert.match(hers, /name="name"[^>]*value="Giulia Bianchi"/);
    assert.match(hers, /name="email"[^>]*value="giulia@lagoon\.example"/);

    const before = mailsTo('marco@lagoon.example').length;
    const b1 = await me('/it/book/checkout', form(BOOK({ name: 'Marco Rossi', email: 'marco@lagoon.example', clientRef: 'PRATICA MARCO' })));
    assert.equal(b1.status, 303, await b1.clone().text());
    const b2 = await owner('/it/book/checkout', form(BOOK({ date: day(41), name: 'Giulia Bianchi', email: 'giulia@lagoon.example', clientRef: 'PRATICA GIULIA' })));
    assert.equal(b2.status, 303);
    const rowOf = (ref) => app.db.prepare('SELECT * FROM bookings WHERE client_ref = ?').get(ref);
    const bm = rowOf('PRATICA MARCO');
    const bg = rowOf('PRATICA GIULIA');
    assert.deepEqual([bm.account_id, bm.booked_by_user, bm.booked_by_name, bm.email], [agency.id, row.id, 'Marco Rossi', 'marco@lagoon.example']);
    assert.deepEqual([bg.account_id, bg.booked_by_user, bg.booked_by_name], [agency.id, null, 'Giulia Bianchi']);
    assert.equal(mailsTo('marco@lagoon.example').length, before + 1, 'la conferma arriva a chi ha prenotato');
    const guide = app.mail.sent.filter((m) => m.to === 'guida@example.com' && m.text.includes('PRATICA MARCO'));
    assert.equal(guide.length, 1);
    assert.match(guide[0].text, /\nPrenotata da: Marco Rossi\n/);

    // le pratiche sono dell'agenzia: tutti le vedono; il titolare vede anche chi le ha fatte
    const all = await text(await owner('/it/b2b/bookings?view=all'));
    assert.match(all, /PRATICA MARCO/);
    assert.match(all, /PRATICA GIULIA/);
    assert.match(all, /<small class="muted">Prenotata da Marco Rossi<\/small>/);
    assert.match(all, /<small class="muted">Prenotata da Giulia Bianchi<\/small>/);
    assert.match(all, /href="\/it\/b2b\/bookings\?mine=1&amp;view=all">Solo le mie<\/a>/);
    const memberAll = await text(await me('/it/b2b/bookings?view=all'));
    assert.match(memberAll, /PRATICA GIULIA/);
    assert.match(memberAll, /PRATICA MARCO/);

    // «solo le mie»
    const onlyOwner = await text(await owner('/it/b2b/bookings?view=all&mine=1'));
    assert.match(onlyOwner, /PRATICA GIULIA/);
    assert.doesNotMatch(onlyOwner, /PRATICA MARCO/);
    assert.match(onlyOwner, /href="\/it\/b2b\/bookings\?view=all">Tutto il team<\/a>/);
    assert.match(onlyOwner, /<input type="hidden" name="mine" value="1">/, 'cercando si resta fra le proprie');
    const onlyMember = await text(await me('/it/b2b/bookings?view=all&mine=1'));
    assert.match(onlyMember, /PRATICA MARCO/);
    assert.doesNotMatch(onlyMember, /PRATICA GIULIA/);
    assert.match(await text(await owner('/it/b2b/bookings?mine=1')), /PRATICA GIULIA/, 'mine da solo porta all’elenco');

    // l'esportazione ha la colonna in più, e rispetta il filtro
    const csv = await (await owner('/it/b2b/bookings.csv?view=all')).text();
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    assert.match(lines[0], /;Prenotata da$/);
    assert.equal(lines.filter((l) => l.endsWith(';Marco Rossi')).length, 1);
    assert.equal(lines.filter((l) => l.endsWith(';Giulia Bianchi')).length, 1);
    const csvMine = (await (await me('/it/b2b/bookings.csv?view=all&mine=1')).text()).replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(csvMine.length, 2);
    assert.match(csvMine[1], /PRATICA MARCO/);

    // la scheda della pratica, per l'agenzia (non per chi ha il solo collegamento del cliente) e per il pannello
    const detail = await text(await owner(`/it/b2b/bookings/${bm.ref}`));
    assert.match(detail, /<dt>Prenotata da<\/dt><dd>Marco Rossi<\/dd>/);
    const customer = await text(await s.anon(`/it/booking/${bm.ref}?t=${bm.token}`));
    assert.doesNotMatch(customer, /Prenotata da/);
    const adminDetail = await text(await s.admin(`/admin/bookings/${bm.id}`));
    assert.match(adminDetail, /<dt>Prenotata da<\/dt><dd>Marco Rossi<\/dd>/);
    assert.doesNotMatch(await text(await s.admin('/admin/bookings')), /Prenotata da/);

    // senza collaboratori l'elenco resta quello di prima
    await owner(`/it/b2b/team/${row.id}/remove`, form());
    const solo = await text(await owner('/it/b2b/bookings?view=all'));
    assert.doesNotMatch(solo, /Prenotata da (Giulia|Marco)|Solo le mie/);
    assert.equal(rowOf('PRATICA MARCO').booked_by_name, 'Marco Rossi', 'ma il nome resta sulla pratica');
  } finally {
    s.close();
  }
});

test('pacchetto in preparazione personale; il pacchetto prenotato dice chi l’ha fatto', async () => {
  const s = await start();
  try {
    const { app, owner, agency, user } = s;
    const me = await s.member();
    assert.equal((await me('/it/b2b/package/add', form(CART({ name: 'Marco Rossi', email: 'marco@lagoon.example' })))).status, 303);
    const cart = async (p) => text(await p('/it/b2b/package'));
    assert.match(await cart(me), /Pacchetto \(1\)/);
    const hers = await cart(owner);
    assert.match(hers, /Il pacchetto è vuoto/, 'il titolare non vede il pacchetto del collaboratore');
    assert.doesNotMatch(hers, /Pacchetto \(1\)/);
    // lo stesso servizio nel carrello del titolare: nessun doppione
    assert.equal((await owner('/it/b2b/package/add', form(CART()))).status, 303);
    assert.match(await cart(owner), /Pacchetto \(1\)/);
    // il titolare non toglie il servizio di un altro
    const memberItem = app.db.prepare('SELECT id FROM cart_items WHERE user_id IS NOT NULL').get().id;
    await owner(`/it/b2b/package/remove/${memberItem}`, form());
    assert.match(await cart(me), /Pacchetto \(1\)/);
    // il campo «email» del modulo propone quella di chi lavora
    assert.match(await cart(me), /name="email"[^>]*value="marco@lagoon\.example"/);
    // prenota: il pacchetto e i suoi servizi portano il nome
    const res = await me('/it/b2b/package', form({ name: 'Anna Conti', email: 'anna@lagoon.example', phone: '+39 333 1234567', lang: 'it', clientRef: 'Gruppo Rossi', consent: '1', paymentMethod: 'invoice' }));
    assert.equal(res.status, 303, await res.clone().text());
    const group = app.db.prepare('SELECT * FROM booking_groups').get();
    assert.deepEqual([group.account_id, group.booked_by_user, group.booked_by_name], [agency.id, user('marco@lagoon.example').id, 'Marco Rossi']);
    assert.deepEqual(app.db.prepare('SELECT booked_by_name FROM bookings WHERE group_id = ?').all(group.id).map((b) => b.booked_by_name), ['Marco Rossi']);
    assert.match(await text(await owner(`/it/b2b/packages/${group.ref}`)), /Prenotata da Marco Rossi/);
    assert.match(app.mail.sent.filter((m) => m.to === 'guida@example.com' && m.text.includes(group.ref)).at(-1).text, /\nPrenotato da: Marco Rossi\n/);
    assert.match(await cart(me), /Il pacchetto è vuoto/, 'il suo si svuota');
    assert.match(await cart(owner), /Pacchetto \(1\)/, 'quello del titolare è com’era');
  } finally {
    s.close();
  }
});

test('accesso e nuova password del collaboratore; il titolare e il collaboratore non si scambiano le credenziali', async () => {
  const s = await start();
  try {
    const { app, owner, anon, jar, mailsTo, user } = s;
    // invitato ma senza password: non entra
    const { url } = await s.invite({ lang: 'en' });
    assert.equal((await anon('/it/b2b/login', form({ email: 'marco@lagoon.example', password: PW2 }))).status, 401);
    assert.equal((await anon('/it/b2b/forgot', form({ email: 'marco@lagoon.example' }))).status, 200);
    assert.equal(mailsTo('marco@lagoon.example').length, 1, 'senza password non c’è nulla da recuperare');
    await jar()(new URL(url).pathname, form(JOIN()));

    const login = (email, password, p = jar()) => p('/it/b2b/login', form({ email, password })).then((res) => ({ res, p }));
    let r = await login('marco@lagoon.example', PW2);
    assert.equal(r.res.status, 303);
    assert.equal(loc(r.res), '/it/b2b/account');
    assert.equal((await r.p('/it/b2b/bookings')).status, 200);
    r = await login(' MARCO@lagoon.example', PW2);
    assert.equal(r.res.status, 303, 'maiuscole e spazi non contano');
    assert.equal((await login('marco@lagoon.example', PW)).res.status, 401, 'non vale la password del titolare');
    assert.equal((await login('giulia@lagoon.example', PW2)).res.status, 401, 'non vale quella del collaboratore');
    assert.equal((await login('giulia@lagoon.example', PW)).res.status, 303);
    const login2 = await anon('/it/b2b/login?next=%2Fit%2Fb2b%2Fbookings');
    assert.equal(login2.status, 200);
    const withNext = await anon('/it/b2b/login', form({ email: 'marco@lagoon.example', password: PW2, next: '/it/b2b/rates' }));
    assert.equal(loc(withNext), '/it/b2b/rates');
    assert.ok(user('marco@lagoon.example').last_login_at);

    // password dimenticata: il collegamento è del collaboratore
    assert.equal((await anon('/it/b2b/forgot', form({ email: 'nessuno@lagoon.example' }))).status, 200);
    assert.equal(mailsTo('nessuno@lagoon.example').length, 0);
    assert.equal((await anon('/en/b2b/forgot', form({ email: 'marco@lagoon.example' }))).status, 200);
    const mail = mailsTo('marco@lagoon.example').at(-1);
    assert.match(mail.subject, /password|Password|contraseña|パスワード/);
    const reset = mail.text.match(/(http:\/\/localhost\/en\/b2b\/reset\/[^\s]+)/)[1];
    const rp = new URL(reset).pathname;
    assert.equal((await anon(rp)).status, 200);
    assert.equal((await anon(rp, form({ password: 'corta', password2: 'corta' }))).status, 400);
    const ownerHash = app.db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(s.agency.id).password_hash;
    const done = await anon(rp, form({ password: 'nuova-password-9', password2: 'nuova-password-9' }));
    assert.equal(done.status, 303);
    assert.equal(loc(done), '/en/b2b/account');
    assert.equal(app.db.prepare('SELECT password_hash FROM accounts WHERE id = ?').get(s.agency.id).password_hash, ownerHash, 'la password del titolare non cambia');
    assert.equal((await login('marco@lagoon.example', PW2)).res.status, 401);
    assert.equal((await login('marco@lagoon.example', 'nuova-password-9')).res.status, 303);
    assert.equal((await anon(rp)).status, 400, 'il collegamento vale una volta sola');
    assert.equal((await anon(rp, form({ password: 'altra-password-9', password2: 'altra-password-9' }))).status, 400);
    // un collegamento di nuova password del titolare non cambia quello di un collaboratore (e viceversa)
    await anon('/it/b2b/forgot', form({ email: 'giulia@lagoon.example' }));
    const ownerReset = mailsTo('giulia@lagoon.example').at(-1).text.match(/(http:\/\/localhost\/it\/b2b\/reset\/[^\s]+)/)[1];
    assert.equal((await anon(new URL(ownerReset).pathname, form({ password: 'password-del-titolare-1', password2: 'password-del-titolare-1' }))).status, 303);
    assert.equal((await login('marco@lagoon.example', 'nuova-password-9')).res.status, 303, 'il collaboratore non ne risente');
    assert.equal((await login('giulia@lagoon.example', 'password-del-titolare-1')).res.status, 303);
  } finally {
    s.close();
  }
});

test('togliere un collaboratore: la sua sessione smette di valere, non entra più, le sue pratiche restano; l’indirizzo si può invitare di nuovo', async () => {
  const s = await start();
  try {
    const { app, owner, anon, jar, user } = s;
    const me = await s.member();
    const id = user('marco@lagoon.example').id;
    assert.equal((await me('/it/b2b/bookings')).status, 200);
    // un'altra agenzia (e i suoi collaboratori) non può toccare
    addAccount(app.db, { email: 'altra@dmc.example', password_hash: await hashPassword(PW), company: 'Altra DMC', contact_name: 'Carla Neri' });
    const other = jar();
    await other('/it/b2b/login', form({ email: 'altra@dmc.example', password: PW }));
    assert.equal(loc(await other(`/it/b2b/team/${id}/remove`, form())), '/it/b2b/team?ok=removed');
    assert.ok(user('marco@lagoon.example'), 'non è un collaboratore di quell’agenzia');
    assert.equal(loc(await other(`/it/b2b/team/${id}/resend`, form())), '/it/b2b/team?err=gone');

    const res = await owner(`/it/b2b/team/${id}/remove`, form());
    assert.equal(res.status, 303);
    assert.equal(loc(res), '/it/b2b/team?ok=removed');
    assert.match(await text(await owner(loc(res))), /Collaboratore rimosso: non può più entrare\./);
    assert.equal(user('marco@lagoon.example'), undefined);
    assert.match(loc(await me('/it/b2b/bookings')), /\/it\/b2b\/login/, 'la sessione aperta non vale più');
    assert.notEqual((await me('/it/book/checkout', form(BOOK({ name: 'Marco Rossi', email: 'marco@lagoon.example' })))).status, 303, 'senza accesso non si prenota alla tariffa delle agenzie');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
    assert.equal((await anon('/it/b2b/login', form({ email: 'marco@lagoon.example', password: PW2 }))).status, 401);
    assert.equal(loc(await owner('/it/b2b/team/9999/remove', form())), '/it/b2b/team?ok=removed', 'toglierne uno che non c’è non rompe nulla');
    const again = await s.invite();
    assert.equal(again.res.status, 200);
  } finally {
    s.close();
  }
});

test('un cookie di sessione costruito male non apre nulla: collaboratore di un’altra agenzia, inesistente, senza password', async () => {
  const s = await start();
  try {
    const { app, cfg, base, agency } = s;
    const second = addAccount(app.db, { email: 'altra@dmc.example', company: 'Altra DMC', contact_name: 'Carla Neri' });
    await s.member();
    const marco = app.db.prepare('SELECT * FROM account_users').get();
    const cookie = (payload) => `gs=${signToken(cfg.sessionSecret, { k: 'b2b', exp: Date.now() + 3_600_000, ...payload })}`;
    const get = (c) => fetch(`${base}/it/b2b/bookings`, { redirect: 'manual', headers: { cookie: c } });
    assert.equal((await get(cookie({ id: agency.id, u: marco.id }))).status, 200, 'il suo');
    assert.equal((await get(cookie({ id: second.id, u: marco.id }))).status, 302, 'il collaboratore di un’altra agenzia');
    assert.equal((await get(cookie({ id: agency.id, u: 9999 }))).status, 302, 'un collaboratore che non c’è');
    assert.equal((await get(cookie({ id: agency.id, u: 'x' }))).status, 302);
    app.db.prepare('UPDATE account_users SET password_hash = NULL WHERE id = ?').run(marco.id);
    assert.equal((await get(cookie({ id: agency.id, u: marco.id }))).status, 302, 'senza password non c’è sessione');
    assert.equal((await get(cookie({ id: agency.id }))).status, 200, 'il titolare: una sessione senza «u», come prima');
    assert.equal((await get(`gs=${signToken('un-altro-segreto', { k: 'b2b', id: agency.id, exp: Date.now() + 3_600_000 })}`)).status, 302, 'firmato con un altro segreto');
  } finally {
    s.close();
  }
});

test('collisioni: un indirizzo di un collaboratore non può diventare un’agenzia, né per registrazione né per invito né dal pannello', async () => {
  const s = await start();
  try {
    const { app, admin, anon } = s;
    await s.member();
    const reg = { company: 'Venice DMC', vat: 'IT12345678903', country: 'IT', sdi_code: 'ABCDEFG', contact_name: 'Marco', phone: '+39 041 000', email: 'marco@lagoon.example', password: 'password-lunga-1', consent: '1' };
    const res = await anon('/it/b2b/register', form(reg));
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(makeT('it')('err.exists')));
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE email = ?').get('marco@lagoon.example').n, 0);
    const inv = await admin('/admin/partners/invites', form({ email: 'Marco@lagoon.example', lang: 'it' }));
    assert.equal(inv.status, 400);
    assert.match(await text(inv), /Esiste già un’agenzia registrata con questo indirizzo/);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM partner_invites').get().n, 0);
    // un invito aperto per un indirizzo che nel frattempo è diventato di un collaboratore non si registra
    const open = await admin('/admin/partners/invites', form({ email: 'nuova@agenzia.example', lang: 'it' }));
    const at = new URL((await text(open)).match(/value="(http:\/\/localhost\/[a-z]{2}\/b2b\/invite\/[A-Za-z0-9_-]+)"/)[1]).pathname;
    await s.owner('/it/b2b/team', form({ name: 'Nuova Persona', email: 'nuova@agenzia.example', lang: 'it' }));
    const late = await anon(at, form({ ...reg, email: 'ignorata@x.example' }));
    assert.equal(late.status, 400, 'l’indirizzo dell’invito ora è di un collaboratore');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE email = ?').get('nuova@agenzia.example').n, 0);
  } finally {
    s.close();
  }
});

test('pannello: la scheda del partner elenca il team e permette di togliere un accesso', async () => {
  const s = await start();
  try {
    const { app, admin, anon, agency, user } = s;
    assert.match(await text(await admin(`/admin/partners/${agency.id}`)), /Nessun collaboratore: l’agenzia lavora solo con l’accesso del titolare\./);
    await s.member();
    await s.invite({ email: 'luca@lagoon.example', name: 'Luca Verdi' });
    app.db.prepare('UPDATE account_users SET token_expires_at = ? WHERE email = ?').run(new Date(Date.now() - 1000).toISOString(), 'luca@lagoon.example');
    await s.invite({ email: 'sara@lagoon.example', name: 'Sara Blu' });
    const page = await text(await admin(`/admin/partners/${agency.id}`));
    assert.match(page, /<h2 class="h-sub spaced" id="team">Team <span class="chip">3<\/span><\/h2>/);
    assert.match(page, /<strong>Marco Rossi<\/strong><br><small class="muted">marco@lagoon\.example<\/small>/);
    assert.match(page, /<span class="chip chip-ok">Attivo<\/span>/);
    assert.match(page, /non ha ancora fatto l’accesso|ultimo accesso/);
    assert.match(page, /<span class="chip chip-err">Invito scaduto<\/span>/);
    assert.match(page, /<span class="chip chip-warn">Invito mandato<\/span>/);
    assert.match(page, /Togli l’accesso/);
    const id = user('luca@lagoon.example').id;
    assert.match(loc(await anon(`/admin/partners/${agency.id}/team/${id}/remove`, form())), /\/admin\/login/);
    assert.equal(user('luca@lagoon.example').id, id);
    assert.equal((await admin('/admin/partners/9999/team/1/remove', form())).status, 404);
    const res = await admin(`/admin/partners/${agency.id}/team/${id}/remove`, form());
    assert.equal(res.status, 303);
    assert.equal(loc(res), `/admin/partners/${agency.id}?ok=teamRemoved#team`);
    assert.match(await text(await admin(`/admin/partners/${agency.id}?ok=teamRemoved`)), /Accesso tolto: quel collaboratore non può più entrare\./);
    assert.equal(user('luca@lagoon.example'), undefined);
    assert.match(await text(await admin(`/admin/partners/${agency.id}`)), /<span class="chip">2<\/span>/);
  } finally {
    s.close();
  }
});

test('team e invito nelle quattro lingue: pagina, email e pagine di stato', async () => {
  const s = await start();
  try {
    const { app, cfg, owner, anon, mailsTo } = s;
    const titles = { it: 'Il tuo team', en: 'Your team', es: 'Tu equipo', ja: 'チーム' };
    for (const lang of ['it', 'en', 'es', 'ja']) {
      const t = makeT(lang);
      assert.ok((await text(await owner(`/${lang}/b2b/team`))).includes(`<h1>${titles[lang]}</h1>`), lang);
      const email = `${lang}@lagoon.example`;
      const res = await owner(`/${lang}/b2b/team`, form({ name: 'Persona Prova', email, lang }));
      assert.equal(res.status, 200, lang);
      assert.ok((await text(res)).includes(t('team.ok.invited', { email })), lang);
      const mail = mailsTo(email)[0];
      assert.equal(mail.subject, t('team.mail.subject', { company: 'Lagoon DMC', site: cfg.site.name }), lang);
      assert.ok(mail.text.includes(t('team.mail.intro', { inviter: 'Giulia Bianchi', company: 'Lagoon DMC', site: cfg.site.name })), lang);
      assert.ok(mail.text.includes(t('pinv.mail.valid', { days: 7 })), lang);
      const link = mail.text.match(/(http:\/\/localhost\/[a-z]{2}\/b2b\/join\/[A-Za-z0-9_-]+)/)[1];
      assert.ok(link.includes(`/${lang}/b2b/join/`), lang);
      const page = await text(await anon(new URL(link).pathname));
      assert.ok(page.includes(`<h1>${t('join.title')}</h1>`), lang);
      assert.ok(page.includes(t('join.lead', { company: 'Lagoon DMC' })), lang);
      const gone = await text(await anon(`/${lang}/b2b/join/${'x'.repeat(30)}`));
      assert.ok(gone.includes(`<h1>${t('join.invalid.title')}</h1>`), lang);
      app.db.prepare('UPDATE account_users SET token_expires_at = ? WHERE email = ?').run(new Date(Date.now() - 1000).toISOString(), email);
      assert.ok((await text(await anon(new URL(link).pathname))).includes(`<h1>${t('join.expired.title')}</h1>`), lang);
    }
  } finally {
    s.close();
  }
});
