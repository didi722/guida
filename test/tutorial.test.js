// Il giro dell'area agenzie al primo accesso e la pagina «Guida e FAQ»: chi lo vede, quando compare, come si salta, come si rivede.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { makeT } from '../server/i18n.js';
import { actorOf } from '../server/team.js';
import { FAQ_GROUPS, TUTORIAL_STEPS, markTutorialDone, tutorialDue } from '../server/tutorial.js';
import { addAccount, makeApp } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-tutorial-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PW = 'prova-prova-1';
const form = (obj = {}, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');

test('chi lo deve vedere: titolare e collaboratori ognuno per sé, solo gli account approvati; «visto» si ricorda e non si sovrascrive', (t) => {
  const app = makeApp();
  t.after(app.cleanup);
  const owner = addAccount(app.db, { email: 'elena@dmc.example', company: 'Serenissima Travel' });
  const pending = addAccount(app.db, { email: 'nuova@dmc.example', status: 'pending' });
  const member = app.db.prepare("INSERT INTO account_users(account_id, email, name, lang, password_hash, invited_at, activated_at) VALUES(?, 'marco@dmc.example', 'Marco', 'it', 'x', ?, ?) RETURNING *").get(owner.id, new Date().toISOString(), new Date().toISOString());
  const fresh = () => app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(owner.id);
  const asOwner = actorOf(owner);
  const asMember = actorOf(owner, member);

  assert.equal(tutorialDue(app.db, fresh(), asOwner), true, 'il titolare non l’ha ancora visto');
  assert.equal(tutorialDue(app.db, fresh(), asMember), true, 'neppure il collaboratore: ognuno ha il suo primo accesso');
  assert.equal(tutorialDue(app.db, pending, actorOf(pending)), false, 'un account non ancora approvato non entra nell’area');
  assert.equal(tutorialDue(app.db, fresh(), null), true, 'senza chi lavora vale il titolare');

  markTutorialDone(app.db, fresh(), asOwner, Date.parse('2027-01-04T10:00:00Z'));
  assert.equal(tutorialDue(app.db, fresh(), asOwner), false);
  assert.equal(tutorialDue(app.db, fresh(), asMember), true, 'il collaboratore lo vede ancora');
  const first = fresh().tutorial_done_at;
  assert.equal(first, '2027-01-04T10:00:00.000Z');
  markTutorialDone(app.db, fresh(), asOwner, Date.parse('2027-02-01T10:00:00Z'));
  assert.equal(fresh().tutorial_done_at, first, 'la prima volta resta quella');

  markTutorialDone(app.db, fresh(), asMember);
  assert.equal(tutorialDue(app.db, fresh(), asMember), false);
  assert.equal(app.db.prepare('SELECT tutorial_done_at FROM account_users WHERE id = ?').get(member.id).tutorial_done_at !== null, true);
  // un collaboratore di un'altra agenzia non tocca questa
  const other = addAccount(app.db, { email: 'altra@dmc.example' });
  markTutorialDone(app.db, other, { userId: member.id });
  assert.equal(tutorialDue(app.db, other, null), true);
  // un collaboratore tolto nel frattempo: niente da mostrare
  assert.equal(tutorialDue(app.db, fresh(), { userId: 9999 }), false);
});

test('testi completi: ogni passo e ogni domanda c’è in italiano, inglese, spagnolo e giapponese', () => {
  const keys = [
    'tut.title', 'tut.intro', 'tut.start', 'tut.skip', 'tut.banner', 'tut.banner.start', 'tut.banner.skip', 'tut.replay',
    'partner.nav.help', 'help.title', 'help.lead', 'help.steps', 'help.faq',
    'tour.exit', 'tour.skipStop', 'tour.hint', 'tour.finish', 'tour.resume', 'tour.resumeBtn',
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `tour.s${n}`), 'tour.s3m', 'tut.next', 'tut.step',
    ...TUTORIAL_STEPS.flatMap((n) => [`tut.${n}.title`, `tut.${n}.text`]),
    ...FAQ_GROUPS.flatMap(([group, ids]) => [group, ...ids.flatMap((n) => [`faq.${n}.q`, `faq.${n}.a`])]),
  ];
  assert.equal(TUTORIAL_STEPS.length, 5, 'un giro breve');
  assert.deepEqual(FAQ_GROUPS.flatMap(([, ids]) => ids), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 'ogni domanda in un gruppo, una volta sola');
  const texts = {};
  for (const lang of ['it', 'en', 'es', 'ja']) {
    const tr = makeT(lang);
    texts[lang] = keys.map((k) => tr(k, { company: 'ACME', email: 'info@x.example', n: 1, total: 5 }));
    texts[lang].forEach((v, i) => assert.ok(v && v !== keys[i], `${lang}: manca ${keys[i]}`));
    assert.ok(texts[lang].every((v) => !/\{\w+\}/.test(v)), `${lang}: segnaposto rimasti`);
  }
  // le traduzioni non sono copie dell'italiano
  const diff = (a, b) => a.filter((v, i) => v !== b[i]).length;
  for (const lang of ['en', 'es', 'ja']) assert.equal(diff(texts.it, texts[lang]), keys.length, `${lang} è tradotto`);
  // il giro è breve: nessun testo di passo è un muro
  assert.ok(TUTORIAL_STEPS.every((n) => makeT('it')(`tut.${n}.text`).length < 420));
});

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
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
  const hash = await hashPassword(PW);
  const owner = addAccount(app.db, { email: 'elena@serenissima.example', password_hash: hash, company: 'Serenissima Travel', contact_name: 'Elena Rossi', lang: 'it' });
  const pending = addAccount(app.db, { email: 'nuova@dmc.example', password_hash: hash, company: 'Nuova DMC', status: 'pending' });
  const login = async (who, email, lang = 'it') => {
    const f = jar();
    assert.equal((await f(`/${lang}/b2b/login`, form({ email, password: PW }))).status, 303);
    return f;
  };
  return { app, owner, pending, jar, login, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('primo accesso: la prima pagina porta il giro (finestra che si apre da sola e riquadro per chi non ha JavaScript); saltato o finito, non torna', async () => {
  const s = await start();
  try {
    const { app, owner } = s;
    const f = await s.login('owner', owner.email);
    const home = await text(await f('/it/b2b/account'));
    assert.match(home, /<dialog class="tutorial" id="tutorial"[^>]* data-auto data-mark>/);
    assert.match(home, /Benvenuti, Serenissima Travel/);
    assert.match(home, /Un giro veloce dell’area agenzie/);
    assert.equal((home.match(/class="tut-list"/g) ?? []).length, 1);
    assert.equal((home.match(/<li><span class="tut-icon">/g) ?? []).length, 4, 'i passi 2–5 in elenco');
    assert.match(home, /<button class="btn btn-gold" type="button" autofocus data-tut-go>Inizia il giro<\/button>/);
    assert.match(home, /data-tut-banner/, 'il riquadro per chi non ha JavaScript');
    assert.match(home, /data-tour-start data-tour-mark>/, 'il riquadro fa partire il giro');
    // il giro interattivo: testi nella lingua della pagina e indirizzi nell'area, in un elemento nascosto (niente script in linea)
    const cfg = JSON.parse(home.match(/id="tour-config" hidden data-config="([^"]*)"/)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
    assert.equal(cfg.total, 5);
    assert.equal(cfg.done, '/it/b2b/tutorial/done');
    assert.deepEqual(cfg.urls, { home: '/it/b2b/account', book: '/it/book', invoices: '/it/b2b/invoices' });
    assert.equal(Object.keys(cfg.t.stops).length, 10);
    assert.match(cfg.t.stops.s1, /Nuova prenotazione/);
    assert.match(home, /src="\/js\/tour\.js\?v=[^"]*" defer/);
    assert.match(home, /data-tour="new"/, 'il punto del primo passo');
    assert.match(home, /<form method="post" action="\/it\/b2b\/tutorial\/done">/);
    assert.match(home, /src="\/js\/tutorial\.js\?v=/);
    assert.match(home, /href="\/it\/b2b\/help">Guida e FAQ<\/a>/, 'il pulsante della guida sulla prima pagina');
    assert.doesNotMatch(home, /class="main-nav"[\s\S]{0,900}b2b\/help/, 'la barra in alto resta quella di sempre');

    // visitare altre pagine non lo segna come visto
    await f('/it/b2b/bookings');
    assert.equal(app.db.prepare('SELECT tutorial_done_at FROM accounts WHERE id = ?').get(owner.id).tutorial_done_at, null);

    // la finestra lo segna con una richiesta in background (nessun contenuto), il riquadro con un normale invio
    const bg = await f('/it/b2b/tutorial/done', form({}, { 'x-requested-with': 'tutorial' }));
    assert.equal(bg.status, 204);
    assert.ok(app.db.prepare('SELECT tutorial_done_at FROM accounts WHERE id = ?').get(owner.id).tutorial_done_at);
    const again = await text(await f('/it/b2b/account'));
    assert.doesNotMatch(again, /<dialog class="tutorial"/);
    assert.doesNotMatch(again, /data-tut-banner/);
    assert.doesNotMatch(again, /src="\/js\/tutorial\.js/);
    assert.match(again, /id="tour-config"/, 'il giro si può sempre rivedere');
    assert.match(again, /Serenissima Travel/, 'la pagina è quella di sempre');

    // invio normale: torna alla prima pagina (o a un indirizzo interno), mai fuori dal sito
    app.db.prepare('UPDATE accounts SET tutorial_done_at = NULL').run();
    const skip = await f('/it/b2b/tutorial/done', form({}));
    assert.equal(skip.status, 303);
    assert.equal(loc(skip), '/it/b2b/account');
    assert.ok(app.db.prepare('SELECT tutorial_done_at FROM accounts WHERE id = ?').get(owner.id).tutorial_done_at);
    assert.equal(loc(await f('/it/b2b/tutorial/done', form({ next: '/it/b2b/bookings' }))), '/it/b2b/bookings');
    assert.equal(loc(await f('/it/b2b/tutorial/done', form({ next: 'https://evil.example/' }))), '/it/b2b/account');
    assert.equal(loc(await f('/it/b2b/tutorial/done', form({ next: '//evil.example' }))), '/it/b2b/account');
  } finally {
    s.close();
  }
});

test('chi non è entrato non lo segna, chi non è ancora approvato non vede l’area; il collaboratore ha il suo primo accesso', async () => {
  const s = await start();
  try {
    const { app, owner, pending } = s;
    const anon = s.jar();
    assert.match(loc(await anon('/it/b2b/help')), /^\/it\/b2b\/login\?next=%2Fit%2Fb2b%2Fhelp/);
    assert.match(loc(await anon('/it/b2b/tutorial/done', form({}))), /^\/it\/b2b\/login/);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE tutorial_done_at IS NOT NULL').get().n, 0);
    const wait = await s.login('pending', pending.email);
    assert.equal(loc(await wait('/it/b2b/help')), '/it/b2b/account', 'in attesa di approvazione: la pagina di stato');
    assert.equal(loc(await wait('/it/b2b/tutorial/done', form({}))), '/it/b2b/account');
    assert.equal(app.db.prepare('SELECT tutorial_done_at FROM accounts WHERE id = ?').get(pending.id).tutorial_done_at, null, 'non si segna un account non approvato');

    // un collaboratore: il titolare ha già visto il giro, lui no
    app.db.prepare("UPDATE accounts SET tutorial_done_at = ? WHERE id = ?").run(new Date().toISOString(), owner.id);
    app.db.prepare("INSERT INTO account_users(account_id, email, name, lang, password_hash, invited_at, activated_at) VALUES(?, 'marco@serenissima.example', 'Marco Verdi', 'it', ?, ?, ?)").run(owner.id, await hashPassword(PW), new Date().toISOString(), new Date().toISOString());
    const boss = await s.login('owner', owner.email);
    assert.doesNotMatch(await text(await boss('/it/b2b/account')), /<dialog class="tutorial"/);
    const marco = await s.login('member', 'marco@serenissima.example');
    assert.match(await text(await marco('/it/b2b/account')), /<dialog class="tutorial" id="tutorial"[^>]* data-auto data-mark>/, 'il suo primo accesso');
    assert.equal((await marco('/it/b2b/tutorial/done', form({}, { 'x-requested-with': 'tutorial' }))).status, 204);
    assert.doesNotMatch(await text(await marco('/it/b2b/account')), /<dialog class="tutorial"/);
    assert.ok(app.db.prepare("SELECT tutorial_done_at FROM account_users WHERE email = 'marco@serenissima.example'").get().tutorial_done_at);
    assert.ok(app.db.prepare('SELECT tutorial_done_at FROM accounts WHERE id = ?').get(owner.id).tutorial_done_at, 'quello del titolare non è toccato');
  } finally {
    s.close();
  }
});

test('Guida e FAQ: i passi per intero, le domande per gruppo, il pulsante per rivedere il giro, nelle quattro lingue', async () => {
  const s = await start();
  try {
    const { app, owner } = s;
    const f = await s.login('owner', owner.email);
    // prima di aver visto il giro: la finestra c'è, non si apre da sola e quando si chiude segna «visto»
    const help = await text(await f('/it/b2b/help'));
    assert.match(help, /<h1>Guida e domande frequenti<\/h1>/);
    assert.match(help, /Scrivi a info@example\.com/);
    assert.match(help, /<button class="btn btn-outline btn-lg" type="button" data-tour-start data-tour-mark>Rivedi il giro dell’area<\/button>/, 'prima di averlo visto, finirlo lo segna');
    assert.doesNotMatch(help, /<dialog/, 'il giro parte direttamente dal pulsante');
    assert.match(help, /id="tour-config"/);
    assert.equal((help.match(/class="help-steps"/g) ?? []).length, 1);
    assert.equal((help.match(/<details class="faq">/g) ?? []).length, 14, 'quattordici domande');
    for (const g of ['Prenotare', 'Opzioni, date libere e pacchetti', 'Modifiche e annullo', 'Pagamenti e fatture', 'Il tuo account']) assert.ok(help.includes(`>${g}<`), g);
    assert.match(help, /Come prenoto un servizio per un mio cliente\?/);
    assert.match(help, /i bambini da 4 a 12 anni il 50% e gli infanti fino a 3 anni niente/);
    assert.match(help, /Benvenuti, Serenissima Travel/);
    assert.match(help, /aria-current="page">Guida e FAQ<\/a>/, 'nel piè di pagina la voce è quella attuale');
    // dopo averlo visto, la finestra resta per rivederlo ma non segna più nulla
    markTutorialDone(app.db, owner, null);
    const seen = await text(await f('/it/b2b/help'));
    assert.match(seen, /<button class="btn btn-outline btn-lg" type="button" data-tour-start >Rivedi il giro dell’area<\/button>/);
    assert.doesNotMatch(seen, /data-tour-mark/, 'rivederlo non segna più nulla');
    // in inglese, spagnolo e giapponese
    const en = await text(await f('/en/b2b/help'));
    assert.match(en, /<h1>Help and frequently asked questions<\/h1>/);
    assert.match(en, /How do I book a service for one of my clients\?/);
    assert.match(en, /Welcome, Serenissima Travel/);
    assert.match(en, /Write to info@example\.com/);
    const es = await text(await f('/es/b2b/help'));
    assert.match(es, /<h1>Ayuda y preguntas frecuentes<\/h1>/);
    assert.match(es, /¿Cómo reservo un servicio para un cliente mío\?/);
    const ja = await text(await f('/ja/b2b/help'));
    assert.match(ja, /<h1>ヘルプとよくある質問<\/h1>/);
    assert.match(ja, /Serenissima Travel様、ようこそ/);
    assert.match(ja, /お客様のためにサービスを予約するには？/);
    // la finestra, nelle altre lingue
    app.db.prepare('UPDATE accounts SET tutorial_done_at = NULL').run();
    const enHome = await text(await f('/en/b2b/account'));
    assert.match(enHome, /A quick tour of the agency area/);
    assert.match(enHome, /data-tut-go>Start the tour<\/button>/);
    assert.match(enHome, /First time here\? A one-minute tour to find your way around\./);
  } finally {
    s.close();
  }
});
