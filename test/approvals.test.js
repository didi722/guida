// Approvare le agenzie: il collegamento «Approva con un clic» dell'email alla guida, l'approvazione automatica con la partita IVA verificata
// (se la guida la lascia accesa) e le tariffe base che vede chi aspetta.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { signToken } from '../server/auth.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { BILLING_IT, addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-approvals-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const text = async (res) => (await res.text()).replace(/\u00a0/g, ' ');
const PW = 'password-lunga-1';
/** Una partita IVA italiana valida da dieci cifre (la undicesima è la cifra di controllo). */
const itVat = (ten) => {
  const d = String(ten).padStart(10, '0').split('').map(Number);
  const sum = d.reduce((a, x, i) => a + (i % 2 === 0 ? x : (x * 2 > 9 ? x * 2 - 9 : x * 2)), 0);
  return `IT${d.join('')}${(10 - (sum % 10)) % 10}`;
};
const REG = { company: 'Venice DMC', vat: 'IT12345678903', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Giulia', phone: '+39 041 000', email: 'dmc@example.com', password: PW, consent: '1' };

/** VIES finto: risponde con `reply` (cambiabile durante il test). */
function viesFake() {
  const v = { reply: { body: { valid: true, name: 'VENICE DMC SRL', address: 'CALLE LARGA 1\n30100 VENEZIA VE' } } };
  v.fetch = async (url) => (String(url).includes('/vies/rest-api/') ? new Response(JSON.stringify(v.reply.body ?? {}), { status: v.reply.status ?? 200 }) : new Response('{}', { status: 404 }));
  return v;
}

async function start() {
  const vies = viesFake();
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), fetchImpl: vies.fetch });
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
  const row = (email) => app.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
  const registered = (email) => app.mail.sent.filter((m) => m.to === 'guida@example.com' && /Nuova richiesta partner/.test(m.subject) && m.text.includes(`<${email}>`)).at(-1);
  return { app, cfg, vies, jar, anon: jar(), row, registered, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('«Approva con un clic»: l’email alla guida ha il collegamento; la pagina mostra i dati e approva solo col pulsante; sconto e fattura si scelgono lì', async () => {
  const s = await start();
  try {
    const { app, anon, row } = s;
    assert.equal((await anon('/it/b2b/register', form(REG))).status, 200);
    const mail = s.registered('dmc@example.com');
    assert.match(mail.text, /Approva con un clic: http:\/\/localhost\/it\/b2b\/approve\/[\w.-]+\n/);
    assert.match(mail.text, /Approvazione automatica accesa: se la partita IVA risulta valida su VIES e il nome coincide, entra da sola/);
    assert.match(mail.text, /Approva o rifiuta dal pannello: http:\/\/localhost\/admin\/partners\/\d+/);
    const link = mail.text.match(/Approva con un clic: http:\/\/localhost(\/it\/b2b\/approve\/[\w.-]+)/)[1];

    // aprire il collegamento (anche un'anteprima dell'email o un antivirus) non approva nulla: mostra i dati e il pulsante
    const page = await text(await anon(link));
    assert.match(page, /<h1>Approvare questa agenzia\?<\/h1>/);
    assert.match(page, /<strong>Venice DMC<\/strong>/);
    assert.match(page, /dmc@example\.com/);
    assert.match(page, /IT12345678903 · Non ancora verificata/);
    assert.match(page, new RegExp(`<form method="post" action="${link}"`));
    assert.match(page, /name="invoice" value="1"> Consenti il pagamento a fattura e bonifico/);
    assert.match(page, /name="discount" min="0" max="60"/);
    assert.equal(row('dmc@example.com').status, 'pending', 'solo guardare non approva');
    assert.equal(app.mail.sent.filter((m) => m.to === 'dmc@example.com' && /account partner è attivo/.test(m.subject)).length, 0);

    // il pulsante: approva, con fattura e sconto scelti, e l'agenzia riceve l'email
    const done = await anon(link, form({ invoice: '1', discount: '12,5' }));
    assert.equal(done.status, 200);
    const donePage = await text(done);
    assert.match(donePage, /<h1>Agenzia approvata<\/h1>/);
    assert.match(donePage, /Fatto: Venice DMC è approvata e le ho scritto\. Pagamento a fattura: sì · sconto: 12\.5%\./);
    assert.match(donePage, /href="\/admin\/partners\/\d+">Apri la scheda dell’agenzia/);
    const a = row('dmc@example.com');
    assert.deepEqual([a.status, a.allow_invoice, a.discount_percent, !!a.approved_at], ['approved', 1, 12.5, true]);
    assert.equal(app.mail.sent.filter((m) => m.to === 'dmc@example.com' && /account partner è attivo/.test(m.subject)).length, 1);
    // una seconda volta (doppio clic, o email aperta di nuovo): nessun cambiamento e nessuna seconda email
    const again = await text(await anon(link, form({ discount: '50' })));
    assert.match(again, /<h1>Agenzia già approvata<\/h1>/);
    assert.deepEqual([row('dmc@example.com').discount_percent, row('dmc@example.com').allow_invoice], [12.5, 1]);
    assert.equal(app.mail.sent.filter((m) => m.to === 'dmc@example.com' && /account partner è attivo/.test(m.subject)).length, 1);
    assert.match(await text(await anon(link)), /<h1>Agenzia già approvata<\/h1>/);

    // senza scelte: solo carta e nessuno sconto; i valori strani si riportano ai limiti
    assert.equal((await s.jar()('/it/b2b/register', form({ ...REG, email: 'altra@example.com', company: 'Altra DMC', vat: itVat(1111111) }))).status, 200);
    const link2 = s.registered('altra@example.com').text.match(/http:\/\/localhost(\/it\/b2b\/approve\/[\w.-]+)/)[1];
    assert.notEqual(link2, link, 'ogni agenzia ha il suo collegamento');
    await anon(link2, form({}));
    const b = row('altra@example.com');
    assert.deepEqual([b.status, b.allow_invoice, b.discount_percent], ['approved', 0, 0], 'di partenza solo carta, nessuno sconto');
    assert.equal((await s.jar()('/it/b2b/register', form({ ...REG, email: 'terza@example.com', company: 'Terza DMC', vat: itVat(2222222) }))).status, 200);
    await anon(s.registered('terza@example.com').text.match(/http:\/\/localhost(\/it\/b2b\/approve\/[\w.-]+)/)[1], form({ discount: '99999' }));
    assert.equal(row('terza@example.com').discount_percent, 60, 'sconto al massimo del pannello');

    // rifiutata o sospesa: il collegamento non la riapre
    app.db.prepare("UPDATE accounts SET status = 'rejected' WHERE email = 'altra@example.com'").run();
    const rejected = await anon(link2, form({ invoice: '1' }));
    assert.match(await text(rejected), /Richiesta non più in attesa/);
    assert.equal(row('altra@example.com').status, 'rejected');
  } finally {
    s.close();
  }
});

test('il collegamento di approvazione è firmato: modificato, scaduto o fatto per altro non vale', async () => {
  const s = await start();
  try {
    const { app, cfg, anon, row } = s;
    await anon('/it/b2b/register', form(REG));
    const link = s.registered('dmc@example.com').text.match(/http:\/\/localhost(\/it\/b2b\/approve\/[\w.-]+)/)[1];
    const id = row('dmc@example.com').id;
    const bad = [
      `${link}x`,
      '/it/b2b/approve/abc.def',
      '/it/b2b/approve/niente',
      `/it/b2b/approve/${signToken(cfg.sessionSecret, { k: 'approve', id, exp: Date.now() - 1000 })}`, // scaduto
      `/it/b2b/approve/${signToken(cfg.sessionSecret, { k: 'pwreset', id, exp: Date.now() + 100000 })}`, // fatto per un'altra cosa
      `/it/b2b/approve/${signToken('un-altro-segreto', { k: 'approve', id, exp: Date.now() + 100000 })}`, // firmato da altri
      `/it/b2b/approve/${signToken(cfg.sessionSecret, { k: 'approve', id: 9999, exp: Date.now() + 100000 })}`, // agenzia che non c'è
    ];
    for (const url of bad) {
      const res = await anon(url);
      assert.equal(res.status, 400, url);
      assert.match(await text(res), /<h1>Collegamento non valido<\/h1>/);
      assert.equal((await anon(url, form({ invoice: '1' }))).status, 400, `${url} (POST)`);
    }
    assert.equal(row('dmc@example.com').status, 'pending', 'nessun collegamento sbagliato ha approvato');
    assert.equal(app.mail.sent.filter((m) => m.to === 'dmc@example.com' && /account partner è attivo/.test(m.subject)).length, 0);
  } finally {
    s.close();
  }
});

test('approvazione automatica: partita IVA valida su VIES e nome che coincide → entra da sola, con la carta e senza sconto; in ogni altro caso resta da approvare', async () => {
  const s = await start();
  try {
    const { app, anon, vies, row } = s;
    assert.equal(app.cfg.partners.autoApprove, true, 'acceso di partenza');
    const register = async (email, vat, company = 'Venice DMC', extra = {}) => {
      assert.equal((await s.jar()('/it/b2b/register', form({ ...REG, email, vat, company, ...extra }))).status, 200);
      return row(email);
    };

    // il caso buono: il controllo su VIES e poi l'approvazione, nel giro di un minuto
    const a = await register('dmc@example.com', 'IT12345678903');
    assert.equal(await app.approvals.sweep(), 0, 'finché la partita IVA non è verificata non si approva');
    assert.equal(await app.vat.sweep(Date.now()), 1);
    assert.equal(row('dmc@example.com').vat_status, 'valid');
    assert.equal(await app.approvals.sweep(), 1);
    const ok = row('dmc@example.com');
    assert.deepEqual([ok.status, ok.allow_invoice, ok.discount_percent, !!ok.approved_at], ['approved', 0, 0, true], 'carta, nessuno sconto');
    const toAgency = app.mail.sent.filter((m) => m.to === 'dmc@example.com' && /account partner è attivo/.test(m.subject));
    assert.equal(toAgency.length, 1);
    const toGuide = app.mail.sent.find((m) => m.to === 'guida@example.com' && m.subject === 'Agenzia approvata in automatico: Venice DMC');
    assert.match(toGuide.text, /La partita IVA risulta valida su VIES \(registro: VENICE DMC SRL\): l'agenzia è entrata da sola\./);
    assert.match(toGuide.text, /il pagamento a fattura e lo sconto restano spenti finché non li accendi tu/);
    assert.match(toGuide.text, new RegExp(`/admin/partners/${a.id}`));
    assert.equal(await app.approvals.sweep(), 0, 'una volta sola');
    // e l'agenzia (già dentro dalla registrazione) vede subito l'area vera
    const f = s.jar();
    assert.equal((await f('/it/b2b/login', form({ email: 'dmc@example.com', password: PW }))).status, 303);
    assert.match(await text(await f('/it/b2b/account')), /<h2>Prenota o opziona<\/h2>/);

    // partita IVA non valida, fuori dall'UE, VIES che non risponde: restano da approvare
    vies.reply = { body: { valid: false } };
    await register('invalida@example.com', itVat(3333333));
    await app.vat.sweep(Date.now());
    vies.reply = { status: 500, body: {} };
    await register('muta@example.com', itVat(4444444));
    await app.vat.sweep(Date.now());
    await register('svizzera@example.com', 'CHE-123.456.789 MWST', 'Swiss DMC', { country: 'CH', sdi_code: '', zip: '8001', city: 'Zurich', address: 'Bahnhofstrasse 1' });
    await app.vat.sweep(Date.now());
    assert.deepEqual(['invalida', 'muta', 'svizzera'].map((n) => row(`${n}@example.com`).vat_status), ['invalid', 'unavailable', 'unsupported']);
    assert.equal(await app.approvals.sweep(), 0);
    assert.deepEqual(['invalida', 'muta', 'svizzera'].map((n) => row(`${n}@example.com`).status), ['pending', 'pending', 'pending']);

    // valida ma il nome è un altro: la guida lo guarda
    vies.reply = { body: { valid: true, name: 'TUTT ALTRA SOCIETA SRL', address: 'VIA ROMA 1' } };
    await register('nome@example.com', itVat(5555555));
    await app.vat.sweep(Date.now());
    assert.equal(row('nome@example.com').vat_status, 'valid');
    assert.equal(await app.approvals.sweep(), 0);
    assert.equal(row('nome@example.com').status, 'pending', 'nome diverso: non entra da sola');

    // già approvata una volta e rimessa in attesa dalla guida: non rientra da sola
    vies.reply = { body: { valid: true, name: 'VENICE DMC SRL', address: 'X' } };
    await register('tornata@example.com', itVat(6666666));
    await app.vat.sweep(Date.now());
    app.db.prepare("UPDATE accounts SET approved_at = '2026-01-01T00:00:00.000Z' WHERE email = 'tornata@example.com'").run();
    assert.equal(await app.approvals.sweep(), 0);
    assert.equal(row('tornata@example.com').status, 'pending');

    // spenta dalle Impostazioni: nessuna entra da sola
    app.cfg.partners.autoApprove = false;
    app.db.prepare("UPDATE accounts SET approved_at = NULL WHERE email = 'tornata@example.com'").run();
    assert.equal(await app.approvals.sweep(), 0);
    assert.equal(row('tornata@example.com').status, 'pending');
    await register('spenta@example.com', itVat(7777777));
    assert.doesNotMatch(s.registered('spenta@example.com').text, /Approvazione automatica accesa/, 'l’email alla guida non la promette se è spenta');
    assert.match(s.registered('spenta@example.com').text, /Approva con un clic: /, 'ma il collegamento c’è sempre');
  } finally {
    s.close();
  }
});

test('Impostazioni › Nuove agenzie: l’interruttore dell’approvazione automatica si legge e si cambia dal pannello', async () => {
  const s = await start();
  try {
    const admin = s.jar();
    assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
    const page = await text(await admin('/admin/settings?s=partners'));
    assert.match(page, /Nuove agenzie/);
    assert.match(page, /Approva da sola le agenzie con partita IVA verificata/);
    assert.match(page, /name="partners\.autoApprove"[^>]*checked/);
    // spenta: salvando senza la spunta
    assert.equal((await admin('/admin/settings/partners', form({}))).status, 303);
    assert.equal(s.app.cfg.partners.autoApprove, false);
    assert.doesNotMatch(await text(await admin('/admin/settings?s=partners')), /name="partners\.autoApprove"[^>]*checked/);
    // e riaccesa
    assert.equal((await admin('/admin/settings/partners', form({ 'partners.autoApprove': '1' }))).status, 303);
    assert.equal(s.app.cfg.partners.autoApprove, true);
  } finally {
    s.close();
  }
});

test('chi aspetta l’approvazione vede le tariffe base, solo da guardare; chi è stato rifiutato no', async () => {
  const s = await start();
  try {
    const { app } = s;
    const hash = (await import('../server/auth.js')).hashPassword;
    const pw = await hash(PW);
    addAccount(app.db, { email: 'attesa@example.com', password_hash: pw, company: 'In Attesa DMC', status: 'pending', discount_percent: 15 });
    addAccount(app.db, { email: 'no@example.com', password_hash: pw, company: 'Rifiutata DMC', status: 'rejected' });
    const wait = s.jar();
    assert.equal((await wait('/it/b2b/login', form({ email: 'attesa@example.com', password: PW }))).status, 303);
    const page = await text(await wait('/it/b2b/account'));
    assert.match(page, /<h2 class="h-sub">Le tariffe per le agenzie<\/h2>/);
    assert.match(page, /Sono le tariffe base, solo da guardare: appena il tuo account è approvato potrai prenotare/);
    assert.match(page, /<th scope="row">2 ore<\/th><td>160 €<\/td>/, 'le tariffe base (anche se ha uno sconto concordato: lo avrà dopo l’approvazione)');
    assert.match(page, /Richiesta ricevuta|In attesa di approvazione|Stiamo/);
    assert.doesNotMatch(page, /Nuova prenotazione|partner-area/, 'prenotare si può solo dopo: niente barra dell’area né pulsante di prenotazione');
    const no = s.jar();
    assert.equal((await no('/it/b2b/login', form({ email: 'no@example.com', password: PW }))).status, 303);
    assert.doesNotMatch(await text(await no('/it/b2b/account')), /Le tariffe per le agenzie/);
  } finally {
    s.close();
  }
});
