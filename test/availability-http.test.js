// Date libere e lista d'attesa nell'area delle agenzie: la pagina, i moduli e gli avvisi, dall'inizio alla fine.
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
import { addDays, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-availability-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie'; // partenze 10:00 e 15:00, fino a 10 persone
const HOURLY = 'guida-a-ore-agenzie';

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
  const a = addAccount(app.db, { email: 'anna@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Anna Bianchi', lang: 'it' });
  const b = addAccount(app.db, { email: 'bruno@bluesail.example', password_hash: hash, company: 'BlueSail Tours', contact_name: 'Bruno Neri', lang: 'it' });
  app.db.prepare('UPDATE accounts SET option_max = 0 WHERE id IN (?, ?)').run(a.id, b.id);
  const pa = jar();
  const pb = jar();
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  assert.equal((await pa('/it/b2b/login', form({ email: a.email, password: PW }))).status, 303);
  assert.equal((await pb('/it/b2b/login', form({ email: b.email, password: PW }))).status, 303);
  return { app, a, b, pa, pb, admin, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** L'agenzia tiene la data in opzione per tutte e due le partenze. */
function holdDay(app, acct, date) {
  return ['10:00', '15:00'].map((time) => createBooking(app, { tourSlug: SHARED, date, time, pax: 10, channel: 'b2b', account: acct, name: acct.contact_name, email: acct.email, lang: 'it', option: true, clientRef: 'Gruppo' }));
}
const view = (date, extra = '') => `/it/b2b/availability?tour=${SHARED}&pax=2&m=${date.slice(0, 7)}&d=${date}${extra}`;

test('la pagina Date libere: solo per le agenzie, con servizi, calendario del mese e parametri strani che non la rompono', async () => {
  const s = await start();
  try {
    const { pa, anon } = s;
    const r = await anon('/it/b2b/availability');
    assert.equal(r.status, 302);
    assert.match(loc(r), /^\/it\/b2b\/login\?next=%2Fit%2Fb2b%2Favailability/);

    const page = await text(await pa('/it/b2b/availability'));
    assert.match(page, /<h1>Date libere<\/h1>/);
    assert.match(page, /Cerca per data/);
    assert.match(page, /name="tour"/);
    assert.match(page, /Cannaregio e il Ghetto/);
    assert.match(page, /Guida privata/);
    assert.match(page, /class="acal avail-grid"/);
    assert.match(page, /acal-cell is-free/);
    assert.match(page, /tenuto da altri: puoi farti avvisare/, 'la legenda');
    assert.match(page, /La mia lista d’attesa/);
    assert.match(page, /Non stai aspettando nessuna data/);
    assert.match(page, /\/it\/book\/checkout\?tour=/, 'gli orari del primo giorno libero portano al pagamento');

    // servizio a ore: la durata si sceglie e si ricorda
    const hourly = await text(await pa(`/it/b2b/availability?tour=${HOURLY}&pax=3&hours=4`));
    assert.match(hourly, /name="hours"/);
    assert.match(hourly, /<option value="4" selected>/);
    assert.match(hourly, /hours=4/, 'il collegamento al pagamento porta la durata');
    // la lingua si sceglie sui tour condivisi
    const shared = await text(await pa(`/it/b2b/availability?tour=${SHARED}&pax=2&tl=en`));
    assert.match(shared, /name="tl"/);
    assert.match(shared, /<option value="en" selected>/);

    // valori non validi: ripiego su quelli di partenza, mai un errore
    for (const q of ['tour=inesistente&pax=999&m=boh&d=ieri', 'pax=-3&hours=77&tl=xx&m=2099-12', 'm=1999-01&d=2001-01-01', 'tour[]=x&pax[]=1']) {
      const res = await pa(`/it/b2b/availability?${q}`);
      assert.equal(res.status, 200, q);
      assert.match(await text(res), /<h1>Date libere<\/h1>/);
    }
    // il mese non va indietro oltre quello in corso
    const past = await text(await pa('/it/b2b/availability?m=2001-01'));
    assert.match(past, /is-off/, 'il mese precedente non si apre');
  } finally {
    s.close();
  }
});

test('una data tenuta in opzione da un altro operatore: si segue, si vede in lista, si toglie; ci si può rimettere dopo l’avviso', async () => {
  const s = await start();
  try {
    const { app, pa, pb, a, b } = s;
    const D = day(40);
    const opts = holdDay(app, b, D);

    // l'agenzia A vede il giorno «in opzione» e il modulo per farsi avvisare (la guida non rivela chi la tiene)
    const page = await text(await pa(view(D)));
    assert.match(page, /acal-cell is-held[^>]*>\s*<span class="acal-n">\d+<\/span>\s*<span class="acal-evs"><span class="acal-ev ev-opt">In opzione/);
    assert.match(page, /occupata da un’opzione o da un pagamento in corso di un altro operatore/);
    assert.ok(!page.includes('BlueSail'), 'il nome di chi tiene la data non compare');
    assert.match(page, /action="\/it\/b2b\/waitlist"/);
    assert.match(page, /Avvisami se si libera/);
    assert.match(page, /<option value="">Qualsiasi orario<\/option><option value="10:00">10:00<\/option><option value="15:00">15:00<\/option>/);

    // si chiede l'avviso
    const join = await pa('/it/b2b/waitlist', form({ tour: SHARED, date: D, pax: '2', time: '', next: view(D) }));
    assert.equal(join.status, 303);
    assert.match(loc(join), new RegExp(`^/it/b2b/availability\\?tour=${SHARED}.*flash=joined#giorno$`));
    const after = await text(await pa(loc(join)));
    assert.match(after, /Fatto: ti scriviamo appena la data si libera/);
    assert.match(after, /\(1\/10\)/);
    assert.match(after, /In attesa/);
    assert.match(after, /Persone: 2/);
    assert.match(after, /Ti avviseremo appena si libera/, 'nel giorno scelto: già in lista');
    const guide = app.mail.sent.filter((m) => m.to === 'guida@example.com').at(-1);
    assert.match(guide.text, /Lagoon DMC aspetta una data/);
    assert.match(guide.text, /BlueSail Tours/, 'la guida sa chi tiene la data');

    // lo stesso avviso due volte: un messaggio chiaro, nessun doppione
    const dup = await pa('/it/b2b/waitlist', form({ tour: SHARED, date: D, pax: '2', time: '', next: view(D) }));
    assert.match(await text(await pa(loc(dup))), /Hai già un avviso per questa data/);
    // una data che ha già posto non si segue
    const free = await pa('/it/b2b/waitlist', form({ tour: SHARED, date: day(41), pax: '2', next: view(day(41)) }));
    assert.match(await text(await pa(loc(free))), /Questa data ha già posto: puoi prenotarla subito/);
    // dati strani: nessun errore del server, solo un messaggio; l'indirizzo di ritorno non può uscire dal sito
    const odd = await pa('/it/b2b/waitlist', form({ tour: 'zzz', date: 'x', pax: '0', next: 'https://evil.example/' }));
    assert.equal(odd.status, 303);
    assert.match(loc(odd), /^\/it\/b2b\/availability\?flash=err-invalid/);

    // un'altra agenzia non può toccare l'avviso di A
    const id = app.db.prepare('SELECT id FROM waitlist WHERE account_id = ?').get(a.id).id;
    await pb(`/it/b2b/waitlist/${id}/remove`, form({}));
    assert.equal(app.db.prepare('SELECT status FROM waitlist WHERE id = ?').get(id).status, 'waiting');

    // B rilascia la data: ogni minuto il sito controlla e A riceve l'email
    for (const o of opts) cancelBooking(app, o.id, { by: 'customer' });
    assert.equal(await app.waitlist.sweep(Date.now()), 1);
    const mail = app.mail.sent.filter((m) => m.to === a.email).at(-1);
    assert.match(mail.subject, /Si è liberata una data: Cannaregio e il Ghetto/);
    assert.match(mail.text, new RegExp(`/it/book\\?date=${D}&pax=2&tour=${SHARED}`));
    const notified = await text(await pa(view(D)));
    assert.match(notified, /Si è liberata il/);
    assert.match(notified, /Vedi gli orari/);
    assert.match(notified, /Avvisami ancora/);
    const rearm = await pa(`/it/b2b/waitlist/${id}/rearm`, form({ next: view(D) }));
    assert.match(loc(rearm), /flash=rearmed#lista$/);
    assert.match(await text(await pa(loc(rearm))), /Ti avviseremo di nuovo/);
    assert.equal(app.db.prepare('SELECT status FROM waitlist WHERE id = ?').get(id).status, 'waiting');

    // si toglie
    const rm = await pa(`/it/b2b/waitlist/${id}/remove`, form({ next: view(D) }));
    assert.match(loc(rm), /flash=removed#lista$/);
    const empty = await text(await pa(loc(rm)));
    assert.match(empty, /Avviso tolto/);
    assert.match(empty, /Non stai aspettando nessuna data/);
  } finally {
    s.close();
  }
});

test('i collegamenti: schede in «Nuova prenotazione», pulsante nella panoramica, rimando quando non c’è posto; i privati non vedono nulla', async () => {
  const s = await start();
  try {
    const { app, pa, anon, b } = s;
    const book = await text(await pa('/it/book'));
    assert.match(book, /<nav class="tabs"[^>]*><a href="\/it\/book" aria-current="page">Cerca per data<\/a><a href="\/it\/b2b\/availability" >Date libere<\/a><\/nav>/);
    const home = await text(await pa('/it/b2b/account'));
    assert.match(home, /href="\/it\/b2b\/availability">Date libere<\/a>/);
    // nessuna disponibilità per quella data: il rimando al calendario porta alla pagina giusta
    const D = day(45);
    holdDay(app, b, D);
    const none = await text(await pa(`/it/book?date=${D}&pax=2&tour=${SHARED}`));
    assert.match(none, /Nessuna disponibilità per questa data/);
    assert.match(none, new RegExp(`href="/it/b2b/availability\\?tour=${SHARED}&amp;pax=2&amp;m=${D.slice(0, 7)}">Data occupata\\? Guarda il calendario`));
    // chi non è un'agenzia non ha né schede né pagina
    const pub = await text(await anon('/it/book?date=' + day(30)));
    assert.ok(!pub.includes('Date libere'));
    assert.equal((await anon('/it/b2b/availability')).status, 302);
    assert.equal((await anon('/it/b2b/waitlist', form({ tour: SHARED, date: D, pax: '2' }))).status, 302);
    // in giapponese e in spagnolo la pagina c'è
    for (const lang of ['en', 'es', 'ja']) {
      const res = await pa(`/${lang}/b2b/availability`);
      assert.equal(res.status, 200, lang);
    }
  } finally {
    s.close();
  }
});

test('pannello: scheda «Lista d’attesa» con chi aspetta e chi tiene la data; avviso in agenda; date recuperate dopo l’avviso', async () => {
  const s = await start();
  try {
    const { app, pa, admin, a, b } = s;
    assert.match(await text(await admin('/admin/waitlist')), /Nessuna agenzia sta aspettando una data/);
    assert.ok(!(await text(await admin('/admin'))).includes('aspetta una data libera'));

    const D = day(40);
    const opts = holdDay(app, b, D);
    await pa('/it/b2b/waitlist', form({ tour: SHARED, date: D, pax: '4', time: '', next: view(D) }));
    const page = await text(await admin('/admin/waitlist'));
    assert.match(page, /<h1>Lista d’attesa<\/h1>/);
    assert.match(page, /Lagoon DMC/);
    assert.match(page, /Cannaregio e il Ghetto/);
    assert.match(page, /qualsiasi orario/);
    assert.match(page, /4 persone/);
    assert.match(page, /In attesa/);
    assert.match(page, /Opzione, scade il/);
    assert.match(page, /BlueSail Tours/, 'la guida vede chi tiene la data');
    assert.match(page, new RegExp(`/admin/bookings/${opts[0].id}`));
    assert.match(page, new RegExp(`/admin/partners/${a.id}`));
    assert.match(await text(await admin('/admin')), /1 agenzia aspetta una data libera/);
    assert.match(await text(await admin('/admin')), /<a href="\/admin\/waitlist" aria-current="page">Lista d’attesa<\/a>|href="\/admin\/waitlist"/);

    // B rilascia: A viene avvisata (la scheda lo mostra); poi prenota e la data risulta recuperata
    for (const o of opts) cancelBooking(app, o.id, { by: 'customer' });
    assert.equal(await app.waitlist.sweep(Date.now()), 1);
    const notified = await text(await admin('/admin/waitlist'));
    assert.match(notified, /Avvisata/);
    assert.match(notified, />libera</);
    assert.match(notified, /Avvisi inviati<\/span><strong>1<\/strong>/);
    assert.ok(!(await text(await admin('/admin'))).includes('aspetta una data libera'), 'non è più in attesa');
    createBooking(app, { tourSlug: SHARED, date: D, time: '10:00', pax: 4, channel: 'b2b', account: a, name: 'Anna', email: a.email, lang: 'it', paymentMethod: 'invoice' });
    await app.waitlist.sweep(Date.now());
    const done = await text(await admin('/admin/waitlist'));
    assert.match(done, /Date recuperate<\/span><strong>1<\/strong>/);
    assert.match(done, /Nessuna agenzia sta aspettando una data/);
  } finally {
    s.close();
  }
});

test('pannello: la guida riordina la lista d’attesa di una data (trascinando); l’ordine si legge nella pagina, si salva, si ripristina', async () => {
  const s = await start();
  try {
    const { app, a, b, admin, pa, pb } = s;
    const json = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
    const c = addAccount(app.db, { email: 'carla@c.example', password_hash: await hashPassword(PW), company: 'Carla Tours', contact_name: 'Carla Verdi', lang: 'it' });
    app.db.prepare('UPDATE accounts SET option_max = 0 WHERE id = ?').run(c.id);
    const D = day(40);
    const x = addAccount(app.db, { email: 'xavier@x.example', password_hash: await hashPassword(PW), company: 'Agenzia X', contact_name: 'Xavier', lang: 'it' });
    app.db.prepare('UPDATE accounts SET option_max = 0 WHERE id = ?').run(x.id);
    holdDay(app, x, D);
    // A e B si mettono in lista dalle loro pagine; C la aggiungiamo a mano (stesso servizio e giorno)
    await pa('/it/b2b/waitlist', form({ tour: SHARED, date: D, pax: '4', time: '', next: view(D) }));
    await pb('/it/b2b/waitlist', form({ tour: SHARED, date: D, pax: '3', time: '', next: view(D) }));
    app.db.prepare(`INSERT INTO waitlist (account_id, tour_slug, date, time, pax, hours, tour_lang, status, created_at, queued_at) VALUES (?, ?, ?, NULL, 2, NULL, NULL, 'waiting', ?, ?)`).run(c.id, SHARED, D, new Date(Date.now() + 1000).toISOString(), new Date(Date.now() + 1000).toISOString());
    const ids = app.db.prepare('SELECT id, account_id FROM waitlist ORDER BY id').all().map((r) => ({ ...r }));
    const idOf = (acct) => ids.find((r) => r.account_id === acct.id).id;
    const group = `${SHARED}|${D}`;

    // la pagina: un gruppo ordinabile con le tre agenzie, numerate nell'ordine di arrivo
    const page = await text(await admin('/admin/waitlist'));
    assert.match(page, /<tbody data-sortable data-order-url="\/admin\/waitlist\/order" data-key-attr="data-id" data-field="ids"/);
    assert.match(page, /admin-sortable\.js/);
    assert.ok(page.includes(`data-payload="{&quot;group&quot;:&quot;${group}&quot;}"`), 'il gruppo viaggia con la richiesta');
    const order = (html) => [...html.matchAll(/<tr data-id="(\d+)">/g)].map((m) => Number(m[1]));
    assert.deepEqual(order(page), [idOf(a), idOf(b), idOf(c)]);
    assert.match(page, /Trascina un’agenzia sopra un’altra/);
    assert.doesNotMatch(page, /ordine deciso da te/);
    assert.doesNotMatch(page, /Riporta all’ordine di arrivo/);

    // richieste sbagliate
    const post = (body) => admin('/admin/waitlist/order', json(body));
    assert.equal((await post({ group: 'non-esiste|' + D, ids: [1] })).status, 400, 'servizio inesistente');
    assert.equal((await post({ group: `${SHARED}|domani`, ids: [1] })).status, 400, 'data non valida');
    assert.equal((await post({ group, ids: 'a,b' })).status, 400, 'non è un elenco');
    assert.equal((await post({ group, ids: ['x'] })).status, 400, 'identificativi non numerici');
    assert.equal((await post({ group, ids: [idOf(a), idOf(b)] })).status, 409, 'manca C: la pagina era vecchia');
    assert.equal((await admin('/admin/waitlist/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400, 'JSON rotto');
    assert.equal((await s.anon('/admin/waitlist/order', json({ group, ids: [idOf(a), idOf(b), idOf(c)] }))).status, 302, 'senza accesso si va al login');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE position IS NOT NULL').get().n, 0, 'i rifiuti non cambiano nulla');

    // la sequenza giusta: C davanti a tutte
    const ok = await post({ group, ids: [idOf(c), idOf(a), idOf(b)] });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const moved = await text(await admin('/admin/waitlist'));
    assert.deepEqual(order(moved), [idOf(c), idOf(a), idOf(b)]);
    assert.match(moved, /ordine deciso da te/);
    assert.match(moved, /Riporta all’ordine di arrivo/);
    assert.match(moved, /dopo Carla Tours/, 'A sta dopo C');
    // …e l'agenzia lo vede dalla sua pagina: ora ha C davanti
    assert.match(await text(await pa(view(D))), /Davanti a te in lista: 1\./);
    assert.match(await text(await pb(view(D))), /Davanti a te in lista: 2\./);

    // ripristino
    assert.equal((await admin('/admin/waitlist/reset', form({ group: 'x|y' }))).status, 404, 'gruppo che non esiste');
    const back = await admin('/admin/waitlist/reset', form({ group }));
    assert.equal(back.status, 303);
    assert.equal(loc(back), '/admin/waitlist?ok=reset');
    const reset = await text(await admin('/admin/waitlist?ok=reset'));
    assert.deepEqual(order(reset), [idOf(a), idOf(b), idOf(c)]);
    assert.match(reset, /Ordine di arrivo ripristinato\./);
    assert.doesNotMatch(reset, /ordine deciso da te/);
  } finally {
    s.close();
  }
});
