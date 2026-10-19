// Agenzie: la partita IVA (scritta come capita, normalizzata, controllata alla registrazione e su VIES, esito nella scheda)
// e gli inviti con collegamento personale (email, registrazione con account già approvato, scadenza, annullo, rinvio, due richieste insieme).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { makeT } from '../server/i18n.js';
import { BILLING_IT, addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-onboarding-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const DAY = 86_400_000;

/** VIES finto: ricorda le richieste e risponde con `reply` (cambiabile durante il test). */
function viesFake() {
  const v = { calls: [], reply: { body: { valid: true, name: 'VENICE DMC SRL', address: 'CALLE LARGA 1\n30100 VENEZIA VE' } } };
  v.fetch = async (url, init) => {
    if (!String(url).includes('/vies/rest-api/')) return new Response('{}', { status: 404 });
    v.calls.push(JSON.parse(init.body));
    if (v.reply instanceof Error) throw v.reply;
    return new Response(JSON.stringify(v.reply.body ?? {}), { status: v.reply.status ?? 200 });
  };
  return v;
}

async function start({ limited = false } = {}) {
  const vies = viesFake();
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), fetchImpl: vies.fetch });
  if (!limited) app.limits.register = () => true; // i test fanno più tentativi di quanti il sito ne permetta in un'ora (ce n'è uno apposta per il limite)
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
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const row = (email) => app.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
  const accounts = () => app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  return { app, cfg, vies, admin, jar, anon: jar(), row, accounts, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

const REG = { company: 'Venice DMC', vat: 'it 123.456.789-03', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Giulia', phone: '+39 041 000', email: 'dmc@example.com', password: 'password-lunga-1', consent: '1' };

test('registrazione: la partita IVA si scrive come capita, si salva in forma normale e la guida riceve l’esito del controllo', async () => {
  const s = await start();
  try {
    const { app, anon, vies, row } = s;
    assert.equal((await anon('/it/b2b/register', form(REG))).status, 200);
    const a = row('dmc@example.com');
    assert.equal(a.vat, 'IT12345678903', 'prefisso, maiuscole, spazi e punti messi in ordine');
    assert.equal(a.status, 'pending');
    const mail = app.mail.sent.find((m) => m.to === 'guida@example.com' && /Nuova richiesta partner: Venice DMC/.test(m.subject));
    assert.match(mail.text, /\nP\.IVA: formato corretto; il controllo su VIES parte a momenti\n/);
    // il controllo su VIES parte dal lavoro periodico
    assert.equal(await app.vat.sweep(Date.now()), 1);
    assert.deepEqual(vies.calls, [{ countryCode: 'IT', vatNumber: '12345678903' }]);
    assert.deepEqual({ ...app.db.prepare('SELECT vat_status, vat_name, vat_address FROM accounts WHERE id = ?').get(a.id) }, { vat_status: 'valid', vat_name: 'VENICE DMC SRL', vat_address: 'CALLE LARGA 1, 30100 VENEZIA VE' });

    // una partita IVA italiana con la cifra di controllo sbagliata non passa (la fattura elettronica non la accetterebbe), nelle quattro lingue
    const before = s.accounts();
    for (const lang of ['it', 'en', 'es', 'ja']) {
      const res = await anon(`/${lang}/b2b/register`, form({ ...REG, email: `x-${lang}@example.com`, vat: 'IT12345678901' }));
      assert.equal(res.status, 400, lang);
      assert.ok((await text(res)).includes(makeT(lang)('err.vat')), lang);
    }
    for (const vat of ['IT00000000000', 'IT1234567890A', 'IT123', '1']) assert.equal((await anon('/it/b2b/register', form({ ...REG, email: 'y@example.com', vat }))).status, 400, vat);
    assert.equal(s.accounts(), before, 'nessun account creato');

    // fuori dall'Italia il formato non blocca: lo vede la guida nell'email e nella scheda
    vies.calls.length = 0;
    const foreign = { ...REG, sdi_code: '', country: 'DE', zip: '10115', city: 'Berlin', address: 'Unter den Linden 1' };
    assert.equal((await anon('/en/b2b/register', form({ ...foreign, vat: 'DE 123 456 789', email: 'de@example.com' }))).status, 200);
    assert.equal((await anon('/en/b2b/register', form({ ...foreign, vat: 'DE12345', email: 'odd@example.com' }))).status, 200, 'una P.IVA tedesca con la forma sbagliata passa');
    assert.equal((await anon('/en/b2b/register', form({ ...foreign, country: 'CH', vat: 'CHE-123.456.789 MWST', email: 'ch@example.com' }))).status, 200);
    assert.equal((await anon('/en/b2b/register', form({ ...foreign, country: 'GR', vat: '123456789', email: 'gr@example.com' }))).status, 200);
    assert.equal(row('de@example.com').vat, 'DE123456789');
    assert.equal(row('ch@example.com').vat, 'CHE-123.456.789 MWST', 'fuori dall’UE resta com’è stata scritta');
    assert.equal(row('gr@example.com').vat, 'EL123456789', 'la Grecia usa il prefisso EL');
    const guideMail = (email) => app.mail.sent.find((m) => m.to === 'guida@example.com' && m.text.includes(`<${email}>`)).text;
    assert.match(guideMail('odd@example.com'), /\nP\.IVA: Formato non valido \(formato non valido per il paese\)\n/);
    assert.match(guideMail('ch@example.com'), /\nP\.IVA: Fuori dall’UE\n/);
    assert.equal(await app.vat.sweep(Date.now()), 3);
    assert.equal(await app.vat.sweep(Date.now()), 1);
    assert.deepEqual(vies.calls, [{ countryCode: 'DE', vatNumber: '123456789' }, { countryCode: 'EL', vatNumber: '123456789' }], 'formato sbagliato e paese fuori dall’UE non chiamano VIES');
    assert.deepEqual(['de', 'odd', 'ch', 'gr'].map((n) => row(`${n}@example.com`).vat_status), ['valid', 'format', 'unsupported', 'valid']);
  } finally {
    s.close();
  }
});

test('scheda partner: esito della verifica, «Verifica ora», elenco e «Da fare»; l’approvazione non dipende da VIES', async () => {
  const s = await start();
  try {
    const { app, admin, anon, vies } = s;
    const a = addAccount(app.db, { email: 'rialto@example.com', company: 'Rialto Travel', contact_name: 'Marta', vat: 'IT12345678903', country: 'IT', status: 'pending' });
    const detail = async () => text(await admin(`/admin/partners/${a.id}`));
    const list = async () => text(await admin('/admin/partners?f=pending'));
    const verify = async () => { const res = await admin(`/admin/partners/${a.id}/vat`, form()); assert.equal(res.status, 303); assert.equal(loc(res), `/admin/partners/${a.id}?ok=vat`); };
    let page = await detail();
    assert.match(page, /Verifica P\.IVA/);
    assert.match(page, /Non ancora verificata/);
    assert.match(page, new RegExp(`action="/admin/partners/${a.id}/vat"`));
    assert.match(page, /Verifica ora<\/button>/);
    assert.equal(loc(await anon(`/admin/partners/${a.id}/vat`, form())), '/admin/login');
    assert.equal((await admin('/admin/partners/9999/vat', form())).status, 404);

    // valida, ma il registro dice un altro nome
    await verify();
    assert.deepEqual(vies.calls, [{ countryCode: 'IT', vatNumber: '12345678903' }]);
    page = await text(await admin(`/admin/partners/${a.id}?ok=vat`));
    assert.match(page, /Partita IVA controllata: l’esito è qui sotto\./);
    assert.match(page, /Valida su VIES/);
    assert.match(page, /Nel registro: <strong>VENICE DMC SRL<\/strong>, CALLE LARGA 1, 30100 VENEZIA VE/);
    assert.match(page, /Il nome nel registro sembra diverso da «Rialto Travel»: controlla con l’agenzia\./);
    assert.match(await list(), /<span class="chip chip-ok" title="Valida su VIES: VENICE DMC SRL">P\.IVA ✓<\/span>/);
    // lo stesso nome: «corrisponde»
    app.db.prepare('UPDATE accounts SET company = ? WHERE id = ?').run('Venice DMC S.r.l.', a.id);
    page = await detail();
    assert.match(page, /\(corrisponde\)/);
    assert.doesNotMatch(page, /sembra diverso/);

    // non valida: si vede nella scheda, nell'elenco e fra le cose da fare; approvare si può comunque
    vies.reply = { body: { valid: false } };
    await verify();
    page = await detail();
    assert.match(page, /Non risulta valida su VIES/);
    assert.match(page, /chiedi conferma all’agenzia prima di approvare/);
    assert.match(await list(), /P\.IVA non valida/);
    assert.match(await text(await admin('/admin/todo')), /1 con la partita IVA da controllare/);

    // VIES non risponde: «non verificata», nessun giudizio
    vies.reply = { status: 503, body: {} };
    await verify();
    page = await detail();
    assert.match(page, /Non verificata/);
    assert.match(page, /VIES non ha risposto/);
    assert.match(page, /riprova tra poco/);
    const quiet = await list();
    assert.doesNotMatch(quiet, /P\.IVA non valida|P\.IVA ✓|P\.IVA: formato/);
    assert.doesNotMatch(await text(await admin('/admin/todo')), /partita IVA da controllare/);

    // cifra di controllo italiana sbagliata, e paese fuori dall'UE: senza chiamare VIES
    vies.calls.length = 0;
    app.db.prepare('UPDATE accounts SET vat = ? WHERE id = ?').run('12345678901', a.id);
    await verify();
    assert.match(await detail(), /Formato non valido/);
    assert.match(await list(), /P\.IVA: formato/);
    assert.match(await text(await admin('/admin/todo')), /1 con la partita IVA da controllare/);
    app.db.prepare('UPDATE accounts SET vat = ?, country = ? WHERE id = ?').run('12-3456789', 'US', a.id);
    await verify();
    page = await detail();
    assert.match(page, /Fuori dall’UE/);
    assert.match(page, /serve un controllo a mano/);
    assert.equal(vies.calls.length, 0);

    // senza partita IVA (account vecchi): niente pulsante
    const none = addAccount(app.db, { email: 'old@example.com', company: 'Old DMC', vat: null, status: 'approved' });
    assert.doesNotMatch(await text(await admin(`/admin/partners/${none.id}`)), /Verifica ora/);

    // approvare non dipende dall'esito
    app.db.prepare('UPDATE accounts SET vat_status = ? WHERE id = ?').run('invalid', a.id);
    assert.equal((await admin(`/admin/partners/${a.id}`, form({ status: 'approved', discount_percent: '0', allow_invoice: '1' }))).status, 303);
    assert.equal(app.db.prepare('SELECT status FROM accounts WHERE id = ?').get(a.id).status, 'approved');
    assert.doesNotMatch(await text(await admin('/admin/todo')), /partita IVA da controllare/, 'approvato: non c’è più nulla da decidere');
  } finally {
    s.close();
  }
});

test('invito: la guida scrive l’email, l’agenzia riceve il collegamento personale e si registra con l’account già approvato', async () => {
  const s = await start();
  try {
    const { app, cfg, admin, anon, row } = s;
    assert.equal(loc(await anon('/admin/partners/invites')), '/admin/login');
    assert.equal(loc(await anon('/admin/partners/invites', form({ email: 'x@example.com' }))), '/admin/login');
    let page = await text(await admin('/admin/partners/invites'));
    assert.match(page, /href="\/admin\/partners\/invites" aria-current="page">Inviti/);
    assert.match(page, /Nessun invito ancora/);
    assert.match(page, /<button class="btn btn-gold" type="submit">Invia l’invito<\/button>/);

    const res = await admin('/admin/partners/invites', form({ email: ' Anna@Lagoon.example ', lang: 'en', company: 'Lagoon DMC', contactName: 'Anna', note: 'Great to meet you at ITB.' }));
    assert.equal(res.status, 200);
    page = await text(res);
    const url = page.match(/value="(http:\/\/localhost\/en\/b2b\/invite\/[A-Za-z0-9_-]{20,})"/)?.[1];
    assert.ok(url, 'il collegamento si vede subito, una volta sola');
    assert.match(page, /Invito mandato a <strong>anna@lagoon\.example<\/strong>/);
    assert.match(page, /data-copy="#invite-link"/);
    const token = url.split('/').pop();

    // l'email, nella lingua dell'invito
    const invMail = app.mail.sent.find((m) => m.to === 'anna@lagoon.example');
    assert.equal(invMail.subject, makeT('en')('pinv.mail.subject', { site: cfg.site.name }));
    assert.match(invMail.text, /^Hi Anna,/);
    assert.match(invMail.text, /Great to meet you at ITB\./);
    assert.ok(invMail.text.includes(url));
    assert.ok(invMail.html.includes(`href="${url}"`));
    assert.match(invMail.text, /valid for 14 days, once only/);
    assert.equal(invMail.replyTo, 'guida@example.com');

    // nel database c'è solo l'impronta del collegamento
    const inv = app.db.prepare('SELECT * FROM partner_invites').get();
    assert.deepEqual([inv.email, inv.company, inv.contact_name, inv.lang, inv.note], ['anna@lagoon.example', 'Lagoon DMC', 'Anna', 'en', 'Great to meet you at ITB.']);
    assert.equal(inv.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.ok(!JSON.stringify(inv).includes(token));
    assert.ok(inv.sent_at && !inv.used_at && !inv.cancelled_at);
    assert.equal(Date.parse(inv.expires_at) - Date.parse(inv.created_at), 14 * DAY);
    page = await text(await admin('/admin/partners/invites'));
    assert.match(page, /<span class="chip chip-warn">In attesa<\/span>/);
    assert.match(page, /Lagoon DMC<\/strong><br><small class="muted">anna@lagoon\.example · English/);
    assert.match(page, /\/admin\/partners\/invites\/1\/resend/);
    assert.match(page, /\/admin\/partners\/invites\/1\/cancel/);
    assert.ok(!page.includes(token), 'dopo la prima volta il collegamento non si rivede');

    // la pagina dell'invito: nella lingua del collegamento, con email fissa e dati già scritti
    const at = new URL(url).pathname;
    const open = await anon(at);
    assert.equal(open.status, 200);
    page = await text(open);
    assert.match(page, /<h1>Register your agency<\/h1>/);
    assert.ok(page.includes(makeT('en')('pinv.lead', { site: cfg.site.name })));
    assert.match(page, new RegExp(`<form method="post" action="${at}"`));
    assert.match(page, /<input type="email" name="email" readonly maxlength="200" autocomplete="username" value="anna@lagoon\.example">/);
    assert.match(page, /name="company"[^>]*value="Lagoon DMC"/);
    assert.match(page, /name="contact_name"[^>]*value="Anna"/);
    assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(page, /Create my account/);

    // registrazione: l'account nasce approvato, l'email è quella dell'invito, si entra subito
    const post = (over = {}) => anon(at, form({ company: 'Lagoon DMC', vat: 'IT 123 456 789 03', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Anna', phone: '+39 041 111', email: 'altra@example.com', password: 'password-lunga-1', consent: '1', ...over }));
    const done = await post();
    assert.equal(done.status, 303);
    assert.equal(loc(done), '/en/b2b/account');
    const a = row('anna@lagoon.example');
    assert.equal(a.status, 'approved');
    assert.ok(a.approved_at);
    assert.equal(a.lang, 'en');
    assert.equal(a.vat, 'IT12345678903');
    assert.equal(row('altra@example.com'), undefined, 'l’indirizzo scritto nel modulo conta meno di quello dell’invito');
    assert.equal((await anon('/en/b2b/account')).status, 200, 'è già dentro');

    // le email: all'agenzia l'invito e «account attivo» (niente «richiesta ricevuta»), alla guida l'avviso con l'esito della P.IVA
    assert.deepEqual(app.mail.sent.filter((m) => m.to === 'anna@lagoon.example').map((m) => m.subject), [invMail.subject, 'Your partner account is active']);
    const toGuide = app.mail.sent.filter((m) => m.to === 'guida@example.com');
    assert.equal(toGuide.length, 1);
    assert.equal(toGuide[0].subject, 'Agenzia invitata registrata: Lagoon DMC');
    assert.match(toGuide[0].text, /Si è registrata dal tuo invito: l'account è già approvato\. http:\/\/localhost\/admin\/partners\/\d+/);
    assert.match(toGuide[0].text, /\nP\.IVA: formato corretto; il controllo su VIES parte a momenti\n/);

    // l'invito risulta usato, con il collegamento alla scheda; la P.IVA si controlla anche per chi arriva da un invito
    const used = app.db.prepare('SELECT * FROM partner_invites').get();
    assert.ok(used.used_at);
    assert.equal(used.account_id, a.id);
    page = await text(await admin('/admin/partners/invites'));
    assert.match(page, /<span class="chip chip-ok">Registrata<\/span>/);
    assert.match(page, new RegExp(`href="/admin/partners/${a.id}">apri la scheda`));
    assert.doesNotMatch(page, /invites\/1\/resend|invites\/1\/cancel/);
    assert.equal(await app.vat.sweep(Date.now()), 1);
    assert.equal(row('anna@lagoon.example').vat_status, 'valid');

    // una volta sola
    const again = await anon(at);
    assert.equal(again.status, 410);
    page = await text(again);
    assert.match(page, /<h1>Invitation already used<\/h1>/);
    assert.match(page, /href="\/en\/b2b\/login"/);
    const accounts = s.accounts();
    assert.equal((await post({ company: 'Altra' })).status, 410);
    assert.equal(s.accounts(), accounts);
  } finally {
    s.close();
  }
});

test('invito: sbagliato, scaduto, annullato, rinviato, già registrata e dati da correggere', async () => {
  const s = await start();
  try {
    const { app, admin, anon, row } = s;
    const invite = async (over = {}) => {
      const res = await admin('/admin/partners/invites', form({ email: 'a@x.example', lang: 'it', ...over }));
      const page = await text(res);
      return { res, page, url: page.match(/value="(http:\/\/localhost\/[a-z]{2}\/b2b\/invite\/[A-Za-z0-9_-]+)"/)?.[1] };
    };
    const at = (url) => new URL(url).pathname;
    const invites = () => app.db.prepare('SELECT * FROM partner_invites ORDER BY id').all();
    const REGI = { company: 'Agenzia A', vat: 'IT12345678903', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Anna', phone: '+39 041 111', password: 'password-lunga-1', consent: '1' };

    // email non valida; collegamenti che non esistono
    let r = await invite({ email: 'non-un-indirizzo', company: 'Prova' });
    assert.equal(r.res.status, 400);
    assert.match(r.page, /Scrivi un indirizzo email valido\./);
    assert.match(r.page, /name="company"[^>]*value="Prova"/, 'ciò che si era scritto resta nel modulo');
    assert.equal(invites().length, 0);
    for (const bad of ['abc', 'x'.repeat(32), 'x'.repeat(200)]) {
      const res = await anon(`/it/b2b/invite/${bad}`);
      assert.equal(res.status, 404, bad.slice(0, 5));
      assert.match(await text(res), /<h1>Invito non valido<\/h1>/);
      assert.equal((await anon(`/it/b2b/invite/${bad}`, form({ ...REGI }))).status, 404);
    }

    // un invito; con lo stesso indirizzo se ne crea uno nuovo solo quando il primo non è più aperto: finché è aperto si rinnova (il vecchio collegamento smette di valere)
    r = await invite({ company: 'Agenzia A', contactName: 'Anna' });
    assert.equal(r.res.status, 200);
    const first = r.url;
    r = await invite({ lang: 'es', company: 'Agencia A' });
    assert.equal(invites().length, 1, 'stesso indirizzo, invito ancora aperto: è lo stesso invito');
    assert.equal(invites()[0].lang, 'es');
    assert.equal(invites()[0].company, 'Agencia A');
    assert.notEqual(r.url, first);
    assert.match(r.url, /\/es\/b2b\/invite\//);
    assert.equal((await anon(at(first))).status, 404, 'il collegamento di prima non vale più');
    const second = r.url;
    assert.equal((await anon(at(second))).status, 200);
    assert.match(app.mail.sent.filter((m) => m.to === 'a@x.example').at(-1).subject, /Te invitamos a registrar tu agencia/);

    // già registrata: non serve invitarla
    addAccount(app.db, { email: 'b@x.example', company: 'Agenzia B' });
    r = await invite({ email: 'B@x.example' });
    assert.equal(r.res.status, 400);
    assert.match(r.page, /Esiste già un’agenzia registrata con questo indirizzo/);
    assert.equal(invites().length, 1);

    // dati da correggere: l'invito resta aperto
    const bad = async (over, status = 400) => { const res = await anon(at(second), form({ ...REGI, ...over })); assert.equal(res.status, status, JSON.stringify(over)); return text(res); };
    assert.ok((await bad({ vat: 'IT12345678901' })).includes(makeT('es')('err.vat')));
    assert.ok((await bad({ password: 'corta' })).includes(makeT('es')('err.password')));
    assert.ok((await bad({ consent: '' })).includes(makeT('es')('err.consent')));
    assert.ok((await bad({ sdi_code: '', pec: '' })).includes(makeT('es')('err.sdi')));
    assert.ok((await bad({ phone: '' })).includes(makeT('es')('err.phone')), 'senza telefono');
    assert.ok((await bad({ phone: '333 1234567' })).includes(makeT('es')('err.phone')), 'un numero senza prefisso: non si saprebbe da dove chiamare');
    assert.ok((await bad({ address: '' })).includes(makeT('es')('err.address')));
    assert.ok((await bad({ zip: '3012' })).includes(makeT('es')('err.zip')));
    assert.ok((await bad({ city: '' })).includes(makeT('es')('err.city')));
    assert.ok((await bad({ province: 'V' })).includes(makeT('es')('err.province')));
    assert.ok((await bad({ tax_code: '' })).includes(makeT('es')('err.taxCode')));
    assert.ok((await bad({ tax_code: '12345678901' })).includes(makeT('es')('err.taxCode')), 'cifra di controllo sbagliata');
    await bad({ website2: 'bot' }); // il campo trappola dei robot
    assert.equal(s.accounts(), 1, 'nessun account creato (c’è solo B)');
    assert.equal((await anon(at(second))).status, 200, 'e l’invito è ancora aperto');
    assert.match(await bad({ vat: 'IT12345678901', company: 'Agencia A, S.L.' }), /value="Agencia A, S\.L\."/, 'ciò che si era scritto resta nel modulo');

    // scaduto: le due pagine lo dicono, la guida lo vede e può rinviarlo (nuovo collegamento, vecchio non vale più)
    app.db.prepare('UPDATE partner_invites SET expires_at = ?').run(new Date(Date.now() - DAY).toISOString());
    let res = await anon(at(second));
    assert.equal(res.status, 410);
    assert.match(await text(res), /<h1>Invitación caducada<\/h1>/);
    assert.equal((await anon(at(second), form({ ...REGI }))).status, 410);
    let page = await text(await admin('/admin/partners/invites'));
    assert.match(page, /<span class="chip chip-err">Scaduto<\/span>/);
    assert.match(page, /\/admin\/partners\/invites\/1\/resend/);
    assert.doesNotMatch(page, /invites\/1\/cancel/);
    const mails = app.mail.sent.length;
    res = await admin('/admin/partners/invites/1/resend', form());
    assert.equal(res.status, 200);
    const third = (await text(res)).match(/value="(http:\/\/localhost\/[a-z]{2}\/b2b\/invite\/[A-Za-z0-9_-]+)"/)?.[1];
    assert.ok(third);
    assert.equal(app.mail.sent.length, mails + 1, 'l’email riparte');
    assert.equal((await anon(at(second))).status, 404);
    assert.equal((await anon(at(third))).status, 200);

    // annullato: il collegamento non vale più e non si rinvia
    res = await admin('/admin/partners/invites/1/cancel', form());
    assert.equal(res.status, 303);
    assert.equal(loc(res), '/admin/partners/invites?ok=cancelled');
    page = await text(await admin(loc(res)));
    assert.match(page, /Invito annullato: il collegamento non vale più\./);
    assert.match(page, /<span class="chip ">Annullato<\/span>/);
    res = await anon(at(third));
    assert.equal(res.status, 404);
    assert.match(await text(res), /<h1>Invitación no válida<\/h1>/);
    res = await admin('/admin/partners/invites/1/resend', form());
    assert.equal(loc(res), '/admin/partners/invites?ok=gone');
    assert.match(await text(await admin(loc(res))), /Quell’invito non si può più rinviare/);
    // invitarla di nuovo dopo l'annullo: un invito nuovo
    r = await invite({ lang: 'it' });
    assert.equal(invites().length, 2);
    assert.equal((await anon(at(r.url))).status, 200);

    // registrata da sola nel frattempo: l'invito aperto non crea un secondo account
    assert.equal((await anon('/it/b2b/register', form({ ...REGI, company: 'Da sola', email: 'a@x.example' }))).status, 200);
    res = await anon(at(r.url), form({ ...REGI }));
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(makeT('it')('err.exists')));
    assert.equal(row('a@x.example').company, 'Da sola');
    assert.equal(row('a@x.example').status, 'pending');
    assert.equal(loc(await admin('/admin/partners/invites/2/resend', form())), '/admin/partners/invites?ok=gone');
  } finally {
    s.close();
  }
});

test('invito: due richieste insieme creano un solo account', async () => {
  const s = await start();
  try {
    const { app, admin, jar } = s;
    const made = await text(await admin('/admin/partners/invites', form({ email: 'race@x.example', lang: 'en' })));
    const url = made.match(/value="(http:\/\/localhost\/en\/b2b\/invite\/[A-Za-z0-9_-]+)"/)[1];
    const at = new URL(url).pathname;
    const body = (password) => form({ company: 'Race DMC', vat: 'IT12345678903', country: 'IT', sdi_code: 'ABCDEFG', ...BILLING_IT, contact_name: 'Rita', phone: '+39 041 111', password, consent: '1' });
    const [one, two] = await Promise.all([jar()(at, body('password-lunga-1')), jar()(at, body('password-lunga-2'))]);
    assert.deepEqual([one.status, two.status].sort(), [303, 410]);
    assert.equal(s.accounts(), 1);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM partner_invites WHERE used_at IS NOT NULL').get().n, 1);
    // l'agenzia non riceve due email di «account attivo»
    assert.equal(app.mail.sent.filter((m) => m.to === 'race@x.example' && /active/.test(m.subject)).length, 1);
  } finally {
    s.close();
  }
});

test('invito: i tentativi di registrazione hanno lo stesso limite della registrazione normale', async () => {
  const s = await start({ limited: true });
  try {
    const { admin, anon } = s;
    const made = await text(await admin('/admin/partners/invites', form({ email: 'limit@x.example', lang: 'it' })));
    const at = new URL(made.match(/value="(http:\/\/localhost\/it\/b2b\/invite\/[A-Za-z0-9_-]+)"/)[1]).pathname;
    const bad = () => anon(at, form({ ...REG, vat: 'IT12345678901' }));
    for (let i = 0; i < 6; i++) assert.equal((await bad()).status, 400, `tentativo ${i + 1}`);
    assert.equal((await bad()).status, 429);
    assert.equal(s.accounts(), 0);
    assert.equal((await anon(at)).status, 200, 'aprire la pagina resta possibile');
  } finally {
    s.close();
  }
});

test('invito: email e pagine nelle quattro lingue', async () => {
  const s = await start();
  try {
    const { app, cfg, admin, anon } = s;
    const titles = { it: 'Registra la tua agenzia', en: 'Register your agency', es: 'Registra tu agencia', ja: 'エージェンシーを登録する' };
    for (const lang of ['it', 'en', 'es', 'ja']) {
      const made = await text(await admin('/admin/partners/invites', form({ email: `${lang}@x.example`, lang, contactName: lang === 'ja' ? '山田' : 'Anna' })));
      const url = made.match(/value="(http:\/\/localhost\/[a-z]{2}\/b2b\/invite\/[A-Za-z0-9_-]+)"/)[1];
      assert.match(url, new RegExp(`/${lang}/b2b/invite/`));
      const mail = app.mail.sent.find((m) => m.to === `${lang}@x.example`);
      assert.equal(mail.subject, makeT(lang)('pinv.mail.subject', { site: cfg.site.name }));
      assert.ok(mail.text.includes(makeT(lang)('pinv.mail.intro', { site: cfg.site.name })), lang);
      assert.ok(mail.text.includes(makeT(lang)('pinv.mail.valid', { days: 14 })), lang);
      assert.ok(mail.text.includes(url));
      assert.match(mail.text, lang === 'ja' ? /^山田 様/ : /^(Ciao|Hi|Hola) Anna,/);
      const page = await text(await anon(new URL(url).pathname));
      assert.ok(page.includes(`<h1>${titles[lang]}</h1>`), lang);
      assert.ok(page.includes(makeT(lang)('pinv.emailNote')), lang);
    }
  } finally {
    s.close();
  }
});
