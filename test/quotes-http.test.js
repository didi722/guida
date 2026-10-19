// Preventivi online delle agenzie, dall'inizio alla fine: dal pacchetto al preventivo, l'invio per email, la pagina del cliente (che accetta o
// rifiuta), gli avvisi all'agenzia e alla guida, il ritorno nel pacchetto. Il cliente non vede mai la tariffa dell'agenzia.
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
import { encodePng } from '../server/png.js';
import { parseLogo, setLogo } from '../server/agencyDocs.js';
import { addDays, fmtDate, nowRome } from '../server/time.js';
import { HAS_PDFTOTEXT, addAccount, isPdf, pdfText } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-quotes-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PW = 'prova-prova-1';
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const day = (n) => addDays(nowRome().date, n);
// una visita condivisa la mattina (28 € a persona: 4 persone = 112 €), un servizio a ore il pomeriggio
const TOUR = (over = {}) => ({ tour: 'cannaregio-ghetto-agenzie', date: day(40), time: '10:00', pax: '4', name: 'Famiglia Rossi', email: 'giulia@lagoon.example', lang: 'it', tourLang: 'it', clientRef: 'Gruppo Rossi', ...over });
const HOURLY = (over = {}) => ({ tour: 'guida-a-ore-agenzie', date: day(41), time: '15:30', pax: '6', hours: '3', name: 'Famiglia Rossi', email: 'giulia@lagoon.example', lang: 'it', tourLang: 'it', clientRef: 'Gruppo Rossi', ...over });
const NET = /112[\s]*€/; // la tariffa dell'agenzia per il primo servizio: il cliente non la vede mai
const QUOTE = (over = {}) => ({ client: 'Famiglia Rossi', email: 'cliente@example.com', clientRef: 'Gruppo Rossi', markup: '20', round: '5', lang: 'it', note: 'Hotel Danieli, ingresso principale', ...over });

async function start({ limited = false } = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  if (!limited) {
    app.limits.quoteTo = () => true; // 3 al giorno per indirizzo: un test apposta lo prova
    app.limits.register = () => true;
  }
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
    return f;
  };
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: await hashPassword(PW), company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234' });
  const owner = jar();
  assert.equal((await owner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  const mailsTo = (to) => app.mail.sent.filter((m) => m.to === to);
  const quote = (ref) => app.db.prepare('SELECT * FROM quotes WHERE ref = ?').get(ref);
  /** Mette dei servizi nel pacchetto e prepara un preventivo; ritorna il preventivo. */
  const prepare = async (who = owner, lines = [TOUR(), HOURLY()], over = {}) => {
    for (const l of lines) assert.equal((await who('/it/b2b/package/add', form(l))).status, 303);
    const res = await who('/it/b2b/quotes', form(QUOTE(over)));
    assert.equal(res.status, 303, await res.clone().text());
    return quote(loc(res).match(/QT-[A-Z0-9]{6}/)[0]);
  };
  const link = (q, lang = q.lang) => `/${lang}/quotes/${q.ref}?t=${q.token}`;
  const member = async (over = {}) => {
    const v = { name: 'Marco Rossi', email: 'marco@lagoon.example', lang: 'en', ...over };
    assert.equal((await owner('/it/b2b/team', form(v))).status, 200);
    const url = mailsTo(v.email).at(-1).text.match(/(http:\/\/localhost\/[a-z]{2}\/b2b\/join\/[A-Za-z0-9_-]+)/)[1];
    const me = jar();
    assert.equal((await me(new URL(url).pathname, form({ password: 'password-lunga-1', password2: 'password-lunga-1' }))).status, 303);
    return me;
  };
  return { app, cfg, base, owner, admin: jar(), anon: jar(), jar, agency, mailsTo, quote, prepare, link, member, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('dal pacchetto al preventivo: pagine, errori del modulo e scheda', async () => {
  const s = await start();
  try {
    const { app, owner, anon, jar, agency } = s;
    assert.match(loc(await anon('/it/b2b/quotes')), /\/it\/b2b\/login\?next=/);
    assert.match(loc(await anon('/it/b2b/quotes/new')), /\/b2b\/login/);
    assert.match(loc(await anon('/it/b2b/quotes', form(QUOTE()))), /\/b2b\/login/);
    let page = await text(await owner('/it/b2b/quotes'));
    assert.match(page, /<h1>Preventivi per i tuoi clienti<\/h1>/);
    assert.match(page, /Nessun preventivo ancora/);
    assert.match(page, /href="\/it\/b2b\/quotes\/new">Prepara un preventivo<\/a>/);
    assert.match(await text(await owner('/it/b2b/account')), /href="\/it\/b2b\/quotes">Preventivi<\/a>/, 'dalla panoramica');
    page = await text(await owner('/it/b2b/quotes/new'));
    assert.match(page, /Il pacchetto è vuoto: aggiungi dei servizi prima di preparare un preventivo\./);
    assert.equal((await owner('/it/b2b/quotes', form(QUOTE()))).status, 400, 'senza servizi non si prepara');

    assert.equal((await owner('/it/b2b/package/add', form(TOUR()))).status, 303);
    assert.equal((await owner('/it/b2b/package/add', form(HOURLY()))).status, 303);
    assert.match(await text(await owner('/it/b2b/package')), /href="\/it\/b2b\/quotes\/new">Prepara un preventivo<\/a>/, 'dal pacchetto');
    page = await text(await owner('/it/b2b/quotes/new'));
    assert.match(page, /<h1>Nuovo preventivo<\/h1>/);
    assert.match(page, NET, 'all’agenzia si mostra la sua tariffa');
    assert.match(page, /La tua tariffa: /);
    assert.match(page, /name="client"[^>]*value="Famiglia Rossi"/, 'il nome del cliente dal pacchetto');
    assert.match(page, /name="clientRef"[^>]*value="Gruppo Rossi"/);
    assert.match(page, new RegExp(`name="until" min="${day(0)}" max="${day(40)}" value="${day(7)}"`), 'da oggi al primo servizio, di partenza una settimana');

    // errori: il modulo resta com'era
    const bad = async (over, expected, status = 400) => {
      const res = await owner('/it/b2b/quotes', form(QUOTE(over)));
      assert.equal(res.status, status, JSON.stringify(over));
      const out = await text(res);
      assert.ok(out.includes(expected), `${JSON.stringify(over)} → ${expected}`);
      return out;
    };
    const t = makeT('it');
    assert.match(await bad({ client: 'A' }, t('quotes.err.client')), /name="email"[^>]*value="cliente@example\.com"/);
    await bad({ email: 'non-un-indirizzo' }, t('err.email'));
    await bad({ markup: '999' }, t('docs.err.markup', { max: 300 }));
    await bad({ until: day(41) }, t('quotes.err.until', { date: fmtDate(day(40), 'it', 'short') }));
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM quotes').get().n, 0);

    // creato
    const res = await owner('/it/b2b/quotes', form(QUOTE()));
    assert.equal(res.status, 303);
    const ref = loc(res).match(/QT-[A-Z0-9]{6}/)[0];
    assert.equal(loc(res), `/it/b2b/quotes/${ref}?ok=created`);
    const q = s.quote(ref);
    assert.deepEqual([q.account_id, q.client_name, q.client_email, q.lang, q.markup_percent, q.status, q.valid_until], [agency.id, 'Famiglia Rossi', 'cliente@example.com', 'it', 20, 'draft', day(7)]);
    page = await text(await owner(loc(res)));
    assert.match(page, /Preventivo creato: ora puoi mandarlo al cliente\./);
    assert.match(page, new RegExp(`${ref} <span class="chip ">Da inviare</span>`));
    assert.match(page, /<h1>Per Famiglia Rossi<\/h1>/);
    assert.match(page, /Preparato il .* da Giulia Bianchi/);
    assert.match(page, /Prezzo al cliente: .* \(ricarico 20%\)/);
    assert.match(page, NET);
    assert.match(page, /Ancora prenotabile/);
    assert.match(page, new RegExp(`value="http://localhost/it/quotes/${ref}\\?t=${q.token}"`), 'il collegamento del cliente');
    assert.match(page, /name="email" required maxlength="200" autocomplete="off" value="cliente@example\.com"/);
    assert.match(page, new RegExp(`/it/b2b/quotes/${ref}/quote\\.pdf`));
    assert.match(await text(await owner('/it/b2b/quotes')), new RegExp(`${ref} · Gruppo Rossi.*Da inviare`, 's'));

    // il PDF per l'agenzia; un'altra agenzia non vede né apre nulla
    const pdf = await owner(`/it/b2b/quotes/${ref}/quote.pdf`);
    assert.equal(pdf.status, 200);
    assert.ok(isPdf(Buffer.from(await pdf.arrayBuffer())));
    addAccount(app.db, { email: 'altra@dmc.example', password_hash: await hashPassword(PW), company: 'Altra DMC', contact_name: 'Carla Neri' });
    const other = jar();
    await other('/it/b2b/login', form({ email: 'altra@dmc.example', password: PW }));
    for (const p of [`/it/b2b/quotes/${ref}`, `/it/b2b/quotes/${ref}/quote.pdf`]) assert.equal((await other(p)).status, 404, p);
    for (const p of ['send', 'cart', 'delete']) assert.equal((await other(`/it/b2b/quotes/${ref}/${p}`, form({ email: 'x@example.com' }))).status, 404, p);
    assert.doesNotMatch(await text(await other('/it/b2b/quotes')), new RegExp(ref));
    assert.ok(s.quote(ref), 'e nulla è stato toccato');
  } finally {
    s.close();
  }
});

test('invio per email: PDF in allegato, collegamento, risposte all’agenzia; limiti e rifiuti', async () => {
  const s = await start();
  try {
    const { app, cfg, owner, mailsTo } = s;
    const q = await s.prepare(owner, [TOUR(), HOURLY()], { lang: 'en' });
    const send = (email, ref = q.ref) => owner(`/it/b2b/quotes/${ref}/send`, form({ email }));
    const t = makeT('it');
    let res = await send('');
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(t('quotes.err.noEmail')));
    res = await send('non-un-indirizzo');
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(t('err.email')));
    assert.equal(mailsTo('cliente@example.com').length, 0);

    res = await send(' Cliente@Example.com ');
    assert.equal(res.status, 303);
    assert.equal(loc(res), `/it/b2b/quotes/${q.ref}?ok=sent`);
    assert.match(await text(await owner(loc(res))), /Preventivo mandato a cliente@example\.com\./);
    const mail = mailsTo('cliente@example.com')[0];
    const en = makeT('en');
    assert.equal(mail.subject, en('qm.subject', { agency: 'Lagoon DMC', ref: q.ref }));
    assert.equal(mail.replyTo, 'giulia@lagoon.example', 'le risposte del cliente arrivano all’agenzia');
    assert.match(mail.text, /^Hi Famiglia Rossi,/);
    assert.ok(mail.text.includes(en('qm.intro', { agency: 'Lagoon DMC', site: cfg.site.name })));
    assert.ok(mail.text.includes(en('qm.valid', { date: fmtDate(q.valid_until, 'en') })));
    assert.ok(mail.text.includes(`http://localhost/en/quotes/${q.ref}?t=${q.token}`));
    assert.ok(mail.text.includes(en('qm.reply', { agency: 'Lagoon DMC' })));
    assert.ok(mail.text.includes(en('qm.sentBy', { site: cfg.site.name, agency: 'Lagoon DMC' })));
    assert.ok(mail.text.includes('Hotel Danieli, ingresso principale'));
    assert.match(mail.text, /Test tour|Cannaregio/);
    assert.match(mail.text, /135[\s ]*€|€\s*135/, 'il prezzo al cliente (con il ricarico)');
    assert.doesNotMatch(mail.text, /\b112[\s ]*€|€\s*112\b/, 'non la tariffa dell’agenzia');
    assert.ok(mail.html.includes(`href="http://localhost/en/quotes/${q.ref}?t=${q.token}"`));
    assert.match(mail.html, /<strong style="font-size:20px">Lagoon DMC<\/strong>/);
    assert.equal(mail.attachments.length, 1);
    assert.equal(mail.attachments[0].filename, `preventivo-${q.ref}.pdf`);
    assert.ok(isPdf(Buffer.from(mail.attachments[0].content)));
    if (HAS_PDFTOTEXT) {
      const pdf = pdfText(mail.attachments[0].content).replace(/ /g, ' ');
      assert.match(pdf, new RegExp(q.ref));
      assert.doesNotMatch(pdf, /\b112 €/);
    }
    let now = s.quote(q.ref);
    assert.deepEqual([now.status, now.client_email, now.sent_count], ['sent', 'cliente@example.com', 1]);
    const page = await text(await owner(`/it/b2b/quotes/${q.ref}`));
    assert.match(page, /Mandato a cliente@example\.com; ultimo invio il/);
    assert.match(page, /Invii: 1 su 5/);
    assert.match(page, /Il cliente non l’ha ancora aperto/);
    assert.match(page, /Manda di nuovo/);
    assert.match(page, /<span class="chip chip-warn">Inviato<\/span>/);

    // fino a 5 invii; poi un preventivo nuovo
    for (let i = 2; i <= 5; i++) assert.equal((await send('cliente@example.com')).status, 303, `invio ${i}`);
    res = await send('cliente@example.com');
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(t('quotes.err.sends', { n: 5 })));
    assert.equal(s.quote(q.ref).sent_count, 5);
    assert.equal(mailsTo('cliente@example.com').length, 5);

    // altri limiti: per agenzia all'ora e verso uno stesso indirizzo al giorno
    const q2 = await s.prepare(owner, [TOUR({ time: '15:00' })]);
    app.limits.quoteMail = () => false;
    res = await send('altro@example.com', q2.ref);
    assert.equal(res.status, 429);
    assert.ok((await text(res)).includes(t('quotes.err.limit')));
    assert.equal(s.quote(q2.ref).sent_count, 0);
    app.limits.quoteMail = () => true;
    app.limits.quoteTo = (key) => key !== 'bloccato@example.com';
    assert.equal((await send('bloccato@example.com', q2.ref)).status, 429);
    assert.equal(mailsTo('bloccato@example.com').length, 0);
    // l'email non parte: nessun invio registrato
    const realSend = app.mail.send;
    app.mail.send = async () => false;
    res = await send('guasto@example.com', q2.ref);
    assert.equal(res.status, 502);
    assert.ok((await text(res)).includes(t('quotes.err.mail')));
    app.mail.send = realSend;
    now = s.quote(q2.ref);
    assert.deepEqual([now.status, now.sent_count, now.client_email], ['draft', 0, 'cliente@example.com']);

    // scaduto, accettato o rifiutato: non si manda più
    app.db.prepare('UPDATE quotes SET valid_until = ? WHERE id = ?').run(day(-1), q2.id);
    res = await send('cliente@example.com', q2.ref);
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(t('quotes.err.expired')));
    assert.match(await text(await owner(`/it/b2b/quotes/${q2.ref}`)), /<span class="chip ">Scaduto<\/span>/);
    app.db.prepare("UPDATE quotes SET valid_until = ?, status = 'approved' WHERE id = ?").run(day(7), q2.id);
    res = await send('cliente@example.com', q2.ref);
    assert.equal(res.status, 400);
    assert.ok((await text(res)).includes(t('quotes.err.decided')));
  } finally {
    s.close();
  }
});

test('la pagina del cliente: si legge senza accesso, con i suoi prezzi e mai la tariffa dell’agenzia; PDF e logo dal collegamento', async () => {
  const s = await start();
  try {
    const { app, anon, owner, agency } = s;
    const q = await s.prepare(owner, [TOUR(), HOURLY()], { lang: 'en' });
    assert.equal(s.quote(q.ref).viewed_at, null);
    const res = await anon(s.link(q));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const page = await text(res);
    assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(page, /<h1>Quote QT-[A-Z0-9]{6}<\/h1>/);
    assert.ok(page.includes(makeT('en')('qp.lead', { agency: 'Lagoon DMC', client: 'Famiglia Rossi' })));
    assert.match(page, /€135|135[\s]*€/);
    assert.doesNotMatch(page, /€112|112[\s]*€/, 'la tariffa dell’agenzia non c’è');
    assert.doesNotMatch(page, /ricarico|markup/i);
    assert.match(page, /Hotel Danieli, ingresso principale/);
    assert.match(page, /Valid until/);
    assert.match(page, /<button class="btn btn-gold btn-lg" type="submit" name="decision" value="approve">I accept the quote<\/button>/);
    assert.match(page, /name="decision" value="decline">Not interested<\/button>/);
    assert.match(page, new RegExp(`/en/quotes/${q.ref}/quote\\.pdf\\?t=${q.token}`));
    assert.ok(s.quote(q.ref).viewed_at, 'aperto');
    // il nome dell'agenzia, senza logo; poi con il logo
    assert.match(page, /<p class="eyebrow">Lagoon DMC<\/p>/);
    assert.equal((await anon(`/en/quotes/${q.ref}/logo?t=${q.token}`)).status, 404);
    setLogo(app.db, agency.id, await parseLogo(`data:image/png;base64,${Buffer.from(encodePng(160, 64, Buffer.alloc(160 * 64 * 4, 180))).toString('base64')}`));
    assert.match(await text(await anon(s.link(q))), new RegExp(`<img class="doc-logo" src="/en/quotes/${q.ref}/logo\\?t=${q.token}"`));
    const logo = await anon(`/en/quotes/${q.ref}/logo?t=${q.token}`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.equal((await anon(`/en/quotes/${q.ref}/logo?t=sbagliato`)).status, 404);

    const pdf = await anon(`/en/quotes/${q.ref}/quote.pdf?t=${q.token}`);
    assert.equal(pdf.status, 200);
    const buf = Buffer.from(await pdf.arrayBuffer());
    assert.ok(isPdf(buf));
    if (HAS_PDFTOTEXT) {
      const t = pdfText(buf).replace(/ /g, ' ');
      assert.match(t, new RegExp(q.ref));
      assert.doesNotMatch(t, /€112|\b112 €/);
    }

    // chi non ha il codice giusto non vede nulla
    for (const p of [`/en/quotes/${q.ref}`, `/en/quotes/${q.ref}?t=sbagliato`, `/en/quotes/QT-NONESI?t=${q.token}`, `/en/quotes/${q.ref}/quote.pdf`, `/en/quotes/${q.ref}/quote.pdf?t=x`]) assert.equal((await anon(p)).status, 404, p);
    assert.equal((await anon(`/en/quotes/${q.ref}/answer`, form({ t: 'sbagliato', decision: 'approve' }))).status, 404);
    assert.equal(s.quote(q.ref).status, 'draft');
  } finally {
    s.close();
  }
});

test('il cliente accetta: una volta sola; l’agenzia e la guida lo sanno; la pagina e la scheda lo dicono', async () => {
  const s = await start();
  try {
    const { app, anon, owner, mailsTo } = s;
    const q = await s.prepare(owner, [TOUR(), HOURLY()]);
    await owner(`/it/b2b/quotes/${q.ref}/send`, form({ email: 'cliente@example.com' }));
    const before = app.mail.sent.length;
    // una scelta non valida, e nulla cambia
    assert.equal(loc(await anon(`/it/quotes/${q.ref}/answer`, form({ t: q.token, decision: 'forse' }))), `/it/quotes/${q.ref}?t=${q.token}`);
    assert.equal(s.quote(q.ref).status, 'sent');
    const res = await anon(`/it/quotes/${q.ref}/answer`, form({ t: q.token, decision: 'approve', message: 'Perfetto, grazie!' }));
    assert.equal(res.status, 303);
    assert.equal(loc(res), `/it/quotes/${q.ref}?t=${q.token}&done=approved`);
    const now = s.quote(q.ref);
    assert.deepEqual([now.status, now.decided_note], ['approved', 'Perfetto, grazie!']);
    assert.ok(now.decided_at);
    let page = await text(await anon(loc(res)));
    assert.match(page, /Grazie! Abbiamo avvisato Lagoon DMC: ti scriverà per confermare\./);
    assert.match(page, /Hai accettato questo preventivo il .*: Lagoon DMC ti scriverà per confermare\./);
    assert.doesNotMatch(page, /name="decision"/, 'non si risponde due volte');

    // l'agenzia (titolare, in italiano) e la guida
    assert.equal(app.mail.sent.length, before + 2);
    const agencyMail = mailsTo('giulia@lagoon.example').at(-1);
    assert.equal(agencyMail.subject, `Il tuo cliente ha accettato il preventivo ${q.ref}`);
    assert.match(agencyMail.text, /Famiglia Rossi ha accettato il preventivo QT-[A-Z0-9]{6} \(.*€\)\. Nessuna data è stata trattenuta/);
    assert.match(agencyMail.text, /Il suo messaggio: «Perfetto, grazie!»/);
    assert.ok(agencyMail.text.includes(`http://localhost/it/b2b/quotes/${q.ref}`));
    assert.equal(agencyMail.replyTo, 'guida@example.com');
    const guideMail = mailsTo('guida@example.com').at(-1);
    assert.equal(guideMail.subject, `Preventivo accettato: Lagoon DMC — ${q.ref}`);
    assert.match(guideMail.text, /Il cliente \(Famiglia Rossi\) ha accettato il preventivo dell'agenzia\. Nessuna data è trattenuta/);
    assert.match(guideMail.text, /Tariffa dell'agenzia: 112[\s ]*€|Tariffa dell'agenzia: .*€/);
    assert.doesNotMatch(guideMail.text, /135[\s ]*€/, 'alla guida non si dice il prezzo al cliente né il ricarico');
    assert.ok(guideMail.text.includes(`http://localhost/admin/partners/${s.agency.id}`));

    // una seconda risposta (anche opposta) non cambia nulla e non manda altre email
    for (const decision of ['decline', 'approve']) assert.equal(loc(await anon(`/it/quotes/${q.ref}/answer`, form({ t: q.token, decision }))), `/it/quotes/${q.ref}?t=${q.token}`);
    assert.equal(s.quote(q.ref).status, 'approved');
    assert.equal(app.mail.sent.length, before + 2);

    // la scheda dell'agenzia
    page = await text(await owner(`/it/b2b/quotes/${q.ref}`));
    assert.match(page, /<span class="chip chip-ok">Accettato<\/span>/);
    assert.match(page, /Accettato dal cliente il /);
    assert.match(page, /Il messaggio del cliente: «Perfetto, grazie!»/);
    assert.match(page, /rimetti i servizi nel pacchetto e prenota \(o opziona\): nessuna data è trattenuta/);
    assert.doesNotMatch(page, /Manda di nuovo|Manda al cliente per email/, 'non si manda più');
    assert.match(await text(await owner('/it/b2b/quotes')), /<span class="chip chip-ok">Accettato<\/span>/);
  } finally {
    s.close();
  }
});

test('il cliente rifiuta, oppure il preventivo scade: la pagina lo dice e non si risponde più', async () => {
  const s = await start();
  try {
    const { app, anon, owner, mailsTo } = s;
    const a = await s.prepare(owner, [TOUR()], { lang: 'es' });
    const guideBefore = mailsTo('guida@example.com').length;
    const res = await anon(`/es/quotes/${a.ref}/answer`, form({ t: a.token, decision: 'decline', message: 'Hemos cambiado de plan' }));
    assert.equal(loc(res), `/es/quotes/${a.ref}?t=${a.token}&done=declined`);
    assert.deepEqual([s.quote(a.ref).status, s.quote(a.ref).decided_note], ['declined', 'Hemos cambiado de plan']);
    assert.match(await text(await anon(loc(res))), /Gracias, hemos avisado a Lagoon DMC\./);
    assert.match(await text(await anon(s.link(s.quote(a.ref)))), /Rechazaste este presupuesto el /);
    const mail = mailsTo('giulia@lagoon.example').at(-1);
    assert.equal(mail.subject, `Il tuo cliente ha rifiutato il preventivo ${a.ref}`);
    assert.match(mail.text, /Famiglia Rossi ha rifiutato il preventivo/);
    assert.equal(mailsTo('guida@example.com').length, guideBefore, 'la guida non è disturbata per un rifiuto');
    assert.match(await text(await owner(`/it/b2b/quotes/${a.ref}`)), /<span class="chip chip-err">Rifiutato<\/span>/);

    // scaduto
    app.db.exec('DELETE FROM cart_items');
    const b = await s.prepare(owner, [TOUR({ time: '15:00' })], { lang: 'en' });
    app.db.prepare('UPDATE quotes SET valid_until = ? WHERE id = ?').run(day(-1), b.id);
    const page = await text(await anon(s.link(b)));
    assert.match(page, /This quote expired on .*: please ask Lagoon DMC for a new one\./);
    assert.doesNotMatch(page, /name="decision"/);
    const mails = app.mail.sent.length;
    assert.equal(loc(await anon(`/en/quotes/${b.ref}/answer`, form({ t: b.token, decision: 'approve' }))), `/en/quotes/${b.ref}?t=${b.token}`);
    assert.equal(s.quote(b.ref).status, 'draft', 'scaduto: nessuna risposta');
    assert.equal(app.mail.sent.length, mails);
    assert.match(await text(await owner(`/it/b2b/quotes/${b.ref}`)), /<span class="chip ">Scaduto<\/span>/);
  } finally {
    s.close();
  }
});

test('rimettere i servizi nel pacchetto per prenotarli; eliminare il preventivo', async () => {
  const s = await start();
  try {
    const { app, owner, anon, agency } = s;
    const q = await s.prepare(owner, [TOUR(), HOURLY()]);
    const cartCount = () => app.db.prepare('SELECT COUNT(*) AS n FROM cart_items WHERE account_id = ?').get(agency.id).n;
    // sono ancora nel pacchetto: non si duplicano
    let res = await owner(`/it/b2b/quotes/${q.ref}/cart`, form());
    assert.equal(loc(res), `/it/b2b/quotes/${q.ref}?err=cartNone`);
    assert.match(await text(await owner(loc(res))), /Nessun servizio rimesso nel pacchetto: non sono più prenotabili, o ci sono già\./);
    assert.equal(s.quote(q.ref).loaded_at, null);
    app.db.exec('DELETE FROM cart_items');
    res = await owner(`/it/b2b/quotes/${q.ref}/cart`, form());
    assert.equal(loc(res), `/it/b2b/quotes/${q.ref}?ok=cart&n=2`);
    let page = await text(await owner(loc(res)));
    assert.match(page, /2 servizi rimessi nel pacchetto\./);
    assert.match(page, /Servizi messi nel pacchetto il .* · <a href="\/it\/b2b\/package">Vai al pacchetto<\/a>/);
    assert.equal(cartCount(), 2);
    const cart = await text(await owner('/it/b2b/package'));
    assert.match(cart, /Pacchetto \(2\)/);
    assert.match(cart, /name="name"[^>]*value="Famiglia Rossi"/, 'i dati del cliente sono quelli del preventivo');
    assert.match(cart, /name="email"[^>]*value="cliente@example\.com"/);
    assert.match(cart, /name="clientRef"[^>]*value="Gruppo Rossi"/);
    // il valore del messaggio in query non si prende alla lettera: solo un numero
    page = await text(await owner(`/it/b2b/quotes/${q.ref}?ok=cart&n=<script>alert(1)</script>`));
    assert.match(page, /0 servizi rimessi nel pacchetto\./);
    assert.doesNotMatch(page, /<script>alert/);
    page = await text(await owner(`/it/b2b/quotes/${q.ref}?ok=altro&err=altro`));
    assert.doesNotMatch(page, /notice-ok|notice-err/);

    // eliminato: il collegamento del cliente smette di funzionare
    assert.equal((await anon(s.link(q))).status, 200);
    res = await owner(`/it/b2b/quotes/${q.ref}/delete`, form());
    assert.equal(loc(res), '/it/b2b/quotes?ok=deleted');
    assert.match(await text(await owner(loc(res))), /Preventivo eliminato\./);
    assert.equal(s.quote(q.ref), undefined);
    for (const p of [s.link(q), `/it/quotes/${q.ref}/quote.pdf?t=${q.token}`, `/it/b2b/quotes/${q.ref}`]) assert.equal((await (p.includes('/b2b/') ? owner : anon)(p)).status, 404, p);
    assert.equal((await anon(`/it/quotes/${q.ref}/answer`, form({ t: q.token, decision: 'approve' }))).status, 404);
  } finally {
    s.close();
  }
});

test('un collaboratore prepara e manda un preventivo: le risposte arrivano a lui e al titolare', async () => {
  const s = await start();
  try {
    const { owner, anon, mailsTo, app } = s;
    const me = await s.member({ name: 'Marco Rossi', email: 'marco@lagoon.example', lang: 'en' });
    const q = await s.prepare(me, [TOUR(), HOURLY()], { email: 'cliente@example.com' });
    const member = app.db.prepare('SELECT id FROM account_users').get();
    assert.deepEqual([q.user_id, q.created_by], [member.id, 'Marco Rossi']);
    // il pacchetto era il suo: quello del titolare è vuoto; il preventivo, invece, è dell'agenzia
    assert.match(await text(await owner('/it/b2b/package')), /Il pacchetto è vuoto/);
    const list = await text(await owner('/it/b2b/quotes'));
    assert.match(list, new RegExp(`${q.ref} · Gruppo Rossi · .* · Marco Rossi`));
    assert.match(await text(await owner(`/it/b2b/quotes/${q.ref}`)), /Preparato il .* da Marco Rossi/);
    // lo manda lui: le risposte del cliente arrivano a lui
    assert.equal((await me(`/it/b2b/quotes/${q.ref}/send`, form({ email: 'cliente@example.com' }))).status, 303);
    assert.equal(mailsTo('cliente@example.com')[0].replyTo, 'marco@lagoon.example');
    assert.match(await text(await me(`/en/b2b/quotes/${q.ref}`)), /the reply comes to you \(marco@lagoon\.example\)/);
    // il cliente accetta: ne ricevono notizia Marco (in inglese) e Giulia (in italiano)
    await anon(`/it/quotes/${q.ref}/answer`, form({ t: q.token, decision: 'approve' }));
    const toMember = mailsTo('marco@lagoon.example').at(-1);
    assert.equal(toMember.subject, `Your client accepted quote ${q.ref}`);
    assert.match(toMember.text, /^Hi Marco Rossi,/);
    assert.ok(toMember.text.includes(`http://localhost/en/b2b/quotes/${q.ref}`));
    const toOwner = mailsTo('giulia@lagoon.example').at(-1);
    assert.equal(toOwner.subject, `Il tuo cliente ha accettato il preventivo ${q.ref}`);
    // il titolare lo vede come ogni altro preventivo dell'agenzia; chi è stato tolto non c'è più ma il preventivo resta
    assert.match(await text(await owner(`/it/b2b/quotes/${q.ref}`)), /<span class="chip chip-ok">Accettato<\/span>/);
    await owner(`/it/b2b/team/${member.id}/remove`, form());
    assert.equal((await owner(`/it/b2b/quotes/${q.ref}`)).status, 200);
    const mails = app.mail.sent.length;
    const q2 = await s.prepare(owner, [TOUR({ time: '15:00' })], { email: '' });
    app.db.prepare('UPDATE quotes SET user_id = ? WHERE id = ?').run(member.id, q2.id); // preparato da uno che non c'è più
    await anon(`/it/quotes/${q2.ref}/answer`, form({ t: q2.token, decision: 'decline' }));
    assert.equal(app.mail.sent.length, mails + 1, 'senza il collaboratore l’avviso va solo al titolare');
  } finally {
    s.close();
  }
});

test('nelle quattro lingue: email al cliente, pagina del cliente, avviso e pagine dell’agenzia', async () => {
  const s = await start();
  try {
    const { app, cfg, owner, anon, mailsTo } = s;
    const names = { it: 'Preventivo', en: 'Quote', es: 'Presupuesto', ja: '見積書' };
    for (const lang of ['it', 'en', 'es', 'ja']) {
      const t = makeT(lang);
      app.db.exec('DELETE FROM cart_items');
      const q = await s.prepare(owner, [TOUR({ time: lang === 'it' || lang === 'es' ? '10:00' : '15:00', date: day(lang === 'ja' || lang === 'es' ? 42 : 40) })], { lang, email: `${lang}@example.com` });
      assert.equal(q.lang, lang);
      assert.equal((await owner(`/${lang}/b2b/quotes/${q.ref}/send`, form({ email: `${lang}@example.com` }))).status, 303, lang);
      const mail = mailsTo(`${lang}@example.com`)[0];
      assert.equal(mail.subject, t('qm.subject', { agency: 'Lagoon DMC', ref: q.ref }), lang);
      assert.ok(mail.text.includes(t('qm.intro', { agency: 'Lagoon DMC', site: cfg.site.name })), lang);
      assert.ok(mail.text.includes(t('qm.cta')), lang);
      assert.ok(mail.text.includes(t('qm.reply', { agency: 'Lagoon DMC' })), lang);
      assert.ok(mail.text.includes(`/${lang}/quotes/${q.ref}?t=${q.token}`), lang);
      const page = await text(await anon(s.link(q)));
      assert.ok(page.includes(`<h1>${t('qp.title', { ref: q.ref })}</h1>`), lang);
      assert.ok(page.includes(names[lang]), lang);
      assert.ok(page.includes(t('qp.approve')), lang);
      assert.ok(page.includes(t('qp.how', { agency: 'Lagoon DMC' })), lang);
      await anon(`/${lang}/quotes/${q.ref}/answer`, form({ t: q.token, decision: 'approve' }));
      const done = await text(await anon(`${s.link(q)}&done=approved`));
      assert.ok(done.includes(t('qp.done.approved', { agency: 'Lagoon DMC' })), lang);
      // l'agenzia legge le sue pagine nella lingua dell'URL
      const detail = await text(await owner(`/${lang}/b2b/quotes/${q.ref}`));
      assert.ok(detail.includes(t('quotes.st.approved')), lang);
      assert.ok(detail.includes(t('quotes.detail.share')), lang);
      const list = await text(await owner(`/${lang}/b2b/quotes`));
      assert.ok(list.includes(`<h1>${t('quotes.title')}</h1>`), lang);
      assert.ok((await text(await owner(`/${lang}/b2b/quotes/new`))).includes(`<h1>${t('quotes.new.title')}</h1>`), lang);
    }
  } finally {
    s.close();
  }
});

test('un preventivo mandato a uno stesso indirizzo: al massimo 3 al giorno, da chiunque', async () => {
  const s = await start({ limited: true });
  try {
    const { owner, mailsTo } = s;
    const refs = [];
    for (let i = 0; i < 4; i++) refs.push((await s.prepare(owner, [TOUR({ date: day(40 + i) })], { email: '' })).ref);
    for (let i = 0; i < 3; i++) assert.equal((await owner(`/it/b2b/quotes/${refs[i]}/send`, form({ email: 'stesso@example.com' }))).status, 303, `invio ${i + 1}`);
    const res = await owner(`/it/b2b/quotes/${refs[3]}/send`, form({ email: 'stesso@example.com' }));
    assert.equal(res.status, 429);
    assert.equal(mailsTo('stesso@example.com').length, 3);
    assert.equal((await owner(`/it/b2b/quotes/${refs[3]}/send`, form({ email: 'un-altro@example.com' }))).status, 303, 'a un altro indirizzo sì');
    // la creazione ha il suo limite (30 l'ora per agenzia)
    s.app.limits.quote = () => false;
    assert.equal((await owner('/it/b2b/quotes', form(QUOTE()))).status, 429);
  } finally {
    s.close();
  }
});
