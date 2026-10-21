// «Segnala un'agenzia collega»: il collegamento con il codice, la registrazione da quel collegamento, «Segnalata da» per la guida; l'approvazione resta manuale.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { makeT } from '../server/i18n.js';
import { findReferrer, isRefCode, refCodeOf, referralUrl, referralsOf, referrerOf } from '../server/referral.js';
import { MIGRATIONS } from '../server/migrations.js';
import { BILLING_IT, addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-referral-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const REG = { company: 'Nuova DMC', vat: 'IT12345678903', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Marta', phone: '+39 041 000', email: 'nuova@example.com', password: 'password-lunga-1', consent: '1' };

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  app.limits.register = () => true;
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    return async (p, init = {}) => {
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
  };
  const hash = await hashPassword('prova-prova-1');
  const lagoon = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia', lang: 'it' });
  const login = async (email, lang = 'it') => {
    const f = jar();
    assert.equal((await f(`/${lang}/b2b/login`, form({ email, password: 'prova-prova-1' }))).status, 303);
    return f;
  };
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  return { app, lagoon, jar, anon: jar(), login, admin, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('codici: nascono al primo bisogno, sono stabili e unici; un codice sbagliato o di un’agenzia non approvata non vale', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  const a = addAccount(db, { email: 'a@x.example', company: 'A' });
  const b = addAccount(db, { email: 'b@x.example', company: 'B' });
  const pending = addAccount(db, { email: 'p@x.example', company: 'P', status: 'pending' });
  assert.equal(db.prepare('SELECT ref_code FROM accounts WHERE id = ?').get(a.id).ref_code, null, 'non si creano codici che nessuno userà');
  const ca = refCodeOf(db, a);
  assert.match(ca, /^[a-z2-9]{8}$/);
  assert.equal(refCodeOf(db, db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id)), ca, 'stabile');
  assert.notEqual(refCodeOf(db, b), ca);
  assert.deepEqual(findReferrer(db, ca), { id: a.id, company: 'A', email: 'a@x.example', code: ca });
  assert.deepEqual(findReferrer(db, ca.toUpperCase())?.id, a.id, 'maiuscole e minuscole non contano');
  for (const bad of [undefined, '', 'x', 'zzzzzzzz', "'; DROP TABLE accounts;--", 'a'.repeat(40), '../etc']) assert.equal(findReferrer(db, bad), null, String(bad));
  assert.equal(findReferrer(db, refCodeOf(db, pending)), null, 'un’agenzia non ancora approvata non segnala');
  assert.equal(isRefCode(ca), true);
  assert.equal(referralUrl({ baseUrl: 'https://x.example' }, 'en', ca), `https://x.example/en/b2b/register?ref=${ca}`);
});

test('area agenzie: il riquadro «Segnala un’agenzia collega» ha messaggio, collegamento, WhatsApp, email e copia, nella lingua della pagina', async () => {
  const s = await start();
  try {
    const f = await s.login('giulia@lagoon.example');
    const page = await text(await f('/it/b2b/account'));
    const code = s.app.db.prepare('SELECT ref_code FROM accounts WHERE id = ?').get(s.lagoon.id).ref_code;
    assert.match(code, /^[a-z2-9]{8}$/);
    const url = `http://localhost/it/b2b/register?ref=${code}`;
    assert.match(page, /<section class="card pad share-card spaced" id="segnala" data-share /);
    assert.ok(page.includes(`data-url="${url}"`));
    assert.match(page, /<h2 class="h-sub">Segnala un’agenzia collega<\/h2>/);
    assert.match(page, /Lavoro con Davide Tomio, guida turistica abilitata a Venezia/);
    assert.ok(page.includes(`href="https://wa.me/?text=${encodeURIComponent(`${makeT('it')('ref.msg', { site: 'Davide Tomio' })} ${url}`)}"`), 'WhatsApp con messaggio e collegamento');
    assert.match(page, /href="mailto:\?subject=Accesso%20partner%20con%20Davide%20Tomio&amp;body=/);
    assert.match(page, /data-share-copy>Copia il collegamento<\/button>/);
    assert.match(page, /data-share-native hidden>/);
    assert.match(page, /src="\/js\/share\.js\?v=/);
    assert.doesNotMatch(page, /Agenzie segnalate da te/, 'nessuna segnalazione ancora');
    // niente prezzi o tariffe nel messaggio che si manda in giro
    assert.doesNotMatch(page.match(/data-text="([^"]*)"/)[1], /€|tariff/i);
    // stesso codice, collegamento nella lingua scelta
    const en = await text(await f('/en/b2b/account'));
    assert.ok(en.includes(`data-url="http://localhost/en/b2b/register?ref=${code}"`));
    assert.match(en, /I work with Davide Tomio, a licensed tour guide in Venice/);
    const ja = await text(await f('/ja/b2b/account'));
    assert.ok(ja.includes(`data-url="http://localhost/ja/b2b/register?ref=${code}"`));
    // non in attesa di approvazione: nessun riquadro (e nessun codice creato)
    const p = addAccount(s.app.db, { email: 'att@x.example', password_hash: await hashPassword('prova-prova-1'), company: 'Attesa', status: 'pending' });
    const fp = await s.login('att@x.example');
    assert.doesNotMatch(await text(await fp('/it/b2b/account')), /share-card/);
    assert.equal(s.app.db.prepare('SELECT ref_code FROM accounts WHERE id = ?').get(p.id).ref_code, null);
  } finally {
    s.close();
  }
});

test('registrazione dal collegamento: avviso «ti ha segnalato», «Segnalata da» per la guida; l’account resta in attesa di approvazione', async () => {
  const s = await start();
  try {
    const { app, anon, admin } = s;
    const code = refCodeOf(app.db, s.lagoon);
    const page = await text(await anon(`/it/b2b/register?ref=${code}`));
    assert.match(page, /Ti ha segnalato Lagoon DMC\./);
    assert.ok(page.includes(`<input type="hidden" name="ref" value="${code}">`));
    assert.match(await text(await anon(`/en/b2b/register?ref=${code}`)), /Lagoon DMC recommended you\./);
    // codice sbagliato: il modulo è quello di sempre, senza avviso
    const none = await text(await anon('/it/b2b/register?ref=zzzzzzzz'));
    assert.doesNotMatch(none, /name="ref"|ha segnalato/i);
    assert.doesNotMatch(await text(await anon('/it/b2b/register')), /name="ref"/);

    // errore nel modulo: il codice resta
    const bad = await anon('/it/b2b/register', form({ ...REG, ref: code, vat: 'IT123' }));
    assert.equal(bad.status, 400);
    assert.ok((await text(bad)).includes(`name="ref" value="${code}"`));
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);

    // registrazione riuscita
    assert.equal((await anon('/it/b2b/register', form({ ...REG, ref: code }))).status, 200);
    const nuova = app.db.prepare("SELECT * FROM accounts WHERE email = 'nuova@example.com'").get();
    assert.equal(nuova.status, 'pending', 'l’approvazione resta manuale');
    assert.equal(nuova.referred_by, s.lagoon.id);
    assert.equal(nuova.discount_percent, 0, 'nessun vantaggio automatico');
    assert.deepEqual({ ...referrerOf(app.db, nuova) }, { id: s.lagoon.id, company: 'Lagoon DMC', email: 'giulia@lagoon.example' });
    assert.deepEqual(referralsOf(app.db, s.lagoon.id).map((x) => x.company), ['Nuova DMC']);
    const mail = app.mail.sent.find((m) => m.to === 'guida@example.com' && /Nuova richiesta partner: Nuova DMC/.test(m.subject));
    assert.match(mail.text, /\nSegnalata da: Lagoon DMC <giulia@lagoon\.example>\n/);
    assert.doesNotMatch(app.mail.sent.find((m) => m.to === 'nuova@example.com').text, /Segnalata da/, 'all’agenzia nuova non serve');

    // senza codice (o con codice inventato): registrazione normale, nessuna segnalazione
    assert.equal((await anon('/it/b2b/register', form({ ...REG, email: 'altra@example.com', company: 'Altra', ref: 'inventato' }))).status, 200);
    assert.equal(app.db.prepare("SELECT referred_by FROM accounts WHERE email = 'altra@example.com'").get().referred_by, null);
    assert.doesNotMatch(app.mail.sent.find((m) => /Nuova richiesta partner: Altra/.test(m.subject)).text, /Segnalata da/);

    // la guida lo vede nell'elenco e nelle due schede
    const list = await text(await admin('/admin/partners?f=pending'));
    const rowOf = (email) => list.split('<tr>').find((r) => r.includes(email));
    assert.match(rowOf('nuova@example.com'), /segnalata da Lagoon DMC/);
    assert.doesNotMatch(rowOf('altra@example.com'), /segnalata da/);
    const card = await text(await admin(`/admin/partners/${nuova.id}`));
    assert.match(card, new RegExp(`<dt>Segnalata da</dt><dd><a href="/admin/partners/${s.lagoon.id}">Lagoon DMC</a>`));
    const lagoonCard = await text(await admin(`/admin/partners/${s.lagoon.id}`));
    assert.match(lagoonCard, /<dt>Ha segnalato<\/dt><dd><a href="\/admin\/partners\/\d+">Nuova DMC<\/a> \(da approvare\)/);

    // il riquadro dell'agenzia che segnala mostra il conteggio
    const f = await s.login('giulia@lagoon.example');
    assert.match(await text(await f('/it/b2b/account')), /Agenzie segnalate da te finora: 1/);
  } finally {
    s.close();
  }
});

test('un’agenzia sospesa non segnala più; il collegamento di un invito ignora il codice; i testi ci sono nelle quattro lingue', async () => {
  const s = await start();
  try {
    const code = refCodeOf(s.app.db, s.lagoon);
    s.app.db.prepare("UPDATE accounts SET status = 'suspended' WHERE id = ?").run(s.lagoon.id);
    assert.doesNotMatch(await text(await s.anon(`/it/b2b/register?ref=${code}`)), /name="ref"/);
    assert.equal((await s.anon('/it/b2b/register', form({ ...REG, ref: code }))).status, 200);
    assert.equal(s.app.db.prepare("SELECT referred_by FROM accounts WHERE email = 'nuova@example.com'").get().referred_by, null);
    const keys = ['ref.title', 'ref.lead', 'ref.msg', 'ref.mailSubject', 'ref.whatsapp', 'ref.email', 'ref.copy', 'ref.copied', 'ref.native', 'ref.count', 'ref.notice'];
    const texts = {};
    for (const lang of ['it', 'en', 'es', 'ja']) {
      texts[lang] = keys.map((k) => makeT(lang)(k, { site: 'Davide Tomio', company: 'ACME', n: 2 }));
      texts[lang].forEach((v, i) => assert.ok(v && v !== keys[i] && !/\{\w+\}/.test(v), `${lang}: ${keys[i]}`));
    }
    for (const lang of ['en', 'es', 'ja']) for (const i of [0, 1, 2, 3, 6, 10]) assert.notEqual(texts[lang][i], texts.it[i], `${lang}: ${keys[i]} è tradotto`);
  } finally {
    s.close();
  }
});
