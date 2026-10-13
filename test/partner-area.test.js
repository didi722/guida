// Area riservata alle agenzie: accesso, barra semplice (niente blog né tour), elenco con schede, ricerca e filtri,
// scheda della pratica con modifica del nominativo, voucher, fatture, esportazione e uscita verso la home pubblica.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { cancelBooking, confirmPaid, createBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createDrafts, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount, isPdf } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-partner-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const post = (fields = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
const loc = (res) => res.headers.get('location');
const nb = (s) => s.replace(/ /g, ' ');
const day = (n) => addDays(nowRome().date, n);
const DAY = 86_400_000;

const SELLER = { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } };
const PW = 'prova-prova-1';

async function start() {
  const cfg = createConfig({
    __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true,
    policy: { allowPayOnSite: true }, mail: { notifyTo: 'guida@example.com' }, site: { vatNumber: 'IT12345678903' }, invoice: { seller: SELLER },
  });
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
  const lagoon = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', discount_percent: 15, vat: '01234567897', sdi_code: 'ABC1234', address: 'Fondamenta Test 1, Venezia', phone: '+39 041 1' });
  const blue = addAccount(app.db, { email: 'luca@blue.example', password_hash: hash, company: 'Blue Sail Tours', contact_name: 'Luca Neri', allow_invoice: 0, vat: '09876543217', sdi_code: 'XYZ9876' });
  const pending = addAccount(app.db, { email: 'marco@rialto.example', password_hash: hash, company: 'Rialto Travel', contact_name: 'Marco Verdi', status: 'pending' });
  const login = async (email) => {
    const f = jar();
    const res = await f('/it/b2b/login', post({ email, password: PW }));
    assert.equal(res.status, 303, `login ${email}`);
    return f;
  };
  return { app, cfg, base, anon: jar(), jar, login, lagoon, blue, pending, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** Prenotazione di un'agenzia: `kind` = 'invoice' (confermata, a fattura), 'card' (pagata), 'option' (data trattenuta). */
function book(app, account, { tour = 'cannaregio-ghetto', time = '10:00', date = day(10), pax = 2, kind = 'invoice', ref = null, name = null, nowMs = Date.now(), hours } = {}) {
  const b = createBooking(app, { tourSlug: tour, date, time, pax, channel: 'b2b', account, name: name ?? account.contact_name, email: account.email, lang: 'it', clientRef: ref, ...(hours ? { hours } : {}), ...(kind === 'option' ? { option: true } : { paymentMethod: kind === 'card' ? 'card' : 'invoice' }) }, nowMs);
  if (kind === 'card') confirmPaid(app, b.id, `pi_${b.ref}`, nowMs);
  return app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id);
}

const NAV_PUBLIC = ['/it/blog', '/it/about', '/it/programs', '/it/tours', '/it/gift'];
const navOf = (html) => html.match(/<nav class="main-nav"[^]*?<\/nav>/)[0];

test('area agenzie: senza login si va al modulo e poi si torna dov’eri; chi è in attesa vede solo lo stato', async () => {
  const s = await start();
  try {
    for (const p of ['/it/b2b/account', '/it/b2b/rates', '/it/b2b/invoices', '/it/b2b/bookings.csv', '/it/b2b/bookings/VE-NOPE00', '/it/b2b/invoices/1/pdf']) {
      const res = await s.anon(p);
      assert.equal(res.status, 302, p);
      assert.equal(loc(res), `/it/b2b/login?next=${encodeURIComponent(p)}`, p);
    }
    // il login riporta alla pagina richiesta (solo percorsi interni)
    const f = s.jar();
    assert.equal(loc(await f('/it/b2b/login', post({ email: 'giulia@lagoon.example', password: PW, next: '/it/b2b/rates' }))), '/it/b2b/rates');
    assert.equal(loc(await s.jar()('/it/b2b/login', post({ email: 'giulia@lagoon.example', password: PW, next: '//evil.example/x' }))), '/it/b2b/account');
    assert.equal(loc(await s.jar()('/it/b2b/login', post({ email: 'giulia@lagoon.example', password: PW, next: 'https://evil.example' }))), '/it/b2b/account');

    // account in attesa: pagina di stato e basta
    const p = await s.login('marco@rialto.example');
    const status = await (await p('/it/b2b/account')).text();
    assert.match(status, /In attesa di approvazione/);
    assert.ok(!status.includes('Nuova prenotazione') && !status.includes('class="kpis"'));
    for (const url of ['/it/b2b/rates', '/it/b2b/invoices', '/it/b2b/bookings.csv']) assert.equal(loc(await p(url)), '/it/b2b/account', `${url} non è per chi non è approvato`);
  } finally {
    s.close();
  }
});

test('area agenzie: barra semplice (niente blog, chi sono, programmi, tour), «Esci» riporta alla home pubblica', async () => {
  const s = await start();
  try {
    const f = await s.login('giulia@lagoon.example');
    for (const p of ['/it/b2b/account', '/it/b2b/rates', '/it/b2b/invoices', '/it/book', '/it/hourly']) {
      const res = await f(p);
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.match(html, /<body class="[^"]*partner-area/, `${p}: barra dell’area agenzie`);
      const nav = navOf(html);
      assert.ok(nav.includes('/it/b2b/account') && nav.includes('/it/b2b/rates') && nav.includes('/it/b2b/invoices'), `${p}: voci di lavoro`);
      for (const pub of NAV_PUBLIC) assert.ok(!html.includes(`href="${pub}"`), `${p}: nessun link a ${pub}`);
      assert.ok(html.includes('action="/it/b2b/logout"'), `${p}: c’è «Esci»`);
      assert.ok(!html.includes('footer-grid'), `${p}: piè di pagina ridotto`);
      assert.match(html, /<span class="brand-sub">Area agenzia<\/span>/);
    }
    // le tariffe sono solo quelle dell’agenzia: niente colonna «Pubblico»
    const rates = nb(await (await f('/it/b2b/rates')).text());
    assert.match(rates, /Le tue condizioni/);
    assert.match(rates, /−15%/);
    assert.match(rates, /Opzione sulla data/);
    assert.ok(!/>Pubblico</.test(rates), 'nessun prezzo al pubblico');

    // il sito pubblico, per chi è dentro: «Area agenzia» in alto e «Esci» nel menu e nel piè di pagina
    const home = await (await f('/it/')).text();
    assert.ok(!/<body class="[^"]*partner-area/.test(home));
    assert.match(home, /class="tool header-login"[^>]*>[^]*?Area agenzia/);
    assert.equal((home.match(/action="\/it\/b2b\/logout"/g) ?? []).length, 2, 'menu laterale e piè di pagina');

    // chi non ha fatto il login vede «Login agenzie» accanto a Prenota
    const anon = await (await s.anon('/it/')).text();
    assert.match(anon, /class="btn btn-sm btn-dark header-cta"[^]*?class="tool header-login" href="\/it\/b2b\/login"[^>]*>[^]*?Login agenzie/);
    assert.ok(!anon.includes('/it/b2b/logout'));
    assert.match(await (await s.anon('/ja/')).text(), /旅行会社ログイン/);

    // uscire riporta alla pagina di tutti e chiude davvero la sessione
    const out = await f('/it/b2b/logout', post());
    assert.equal(out.status, 303);
    assert.equal(loc(out), '/it/');
    assert.equal((await f('/it/b2b/account')).status, 302);
    assert.equal(loc(await (await s.login('giulia@lagoon.example'))('/en/b2b/logout', post())), '/en/', 'nella lingua in cui si era');
  } finally {
    s.close();
  }
});

test('area agenzie: elenco per schede, ricerca per cliente o pratica, filtri per date, pagine e riepilogo; mai le pratiche di altri', async () => {
  const s = await start();
  try {
    const { app, lagoon, blue } = s;
    const rossi = book(app, lagoon, { ref: 'Gruppo Rossi', name: 'Mario Rossi', date: day(10) });
    const verdi = book(app, lagoon, { ref: 'Pratica 77', name: 'Anna Verdi', tour: 'san-marco-rialto', time: '09:30', date: day(20), kind: 'card' });
    const conti = book(app, lagoon, { ref: 'Preventivo Conti', date: day(40), kind: 'option' });
    const annullata = book(app, lagoon, { ref: 'Annullata Bruni', name: 'Carla Bruni', date: day(30) });
    cancelBooking(app, annullata.id, { by: 'admin', refund: 'full' });
    const passata = book(app, lagoon, { ref: 'Gruppo Passato', name: 'Paolo Neri', date: day(-5), nowMs: Date.now() - 14 * DAY });
    const altrui = book(app, blue, { ref: 'Gruppo Altrui', name: 'Luca Neri', kind: 'card', date: day(11) });

    const f = await s.login('giulia@lagoon.example');
    const get = async (qs = '') => nb(await (await f(`/it/b2b/account${qs}`)).text());
    const refsIn = (html) => [rossi, verdi, conti, annullata, passata, altrui].filter((b) => html.includes(b.ref)).map((b) => b.ref);
    const refs = (...bs) => bs.map((b) => b.ref).sort();

    // predefinita: le partenze in arrivo (anche l’opzione), senza annullate, passate o altrui
    const home = await get();
    assert.deepEqual(refsIn(home).sort(), refs(rossi, verdi, conti));
    assert.match(home, /<strong class="kpi-n">2<\/strong>/, 'prossime partenze: le due confermate');
    for (const [n, label] of [[3, 'In arrivo'], [1, 'Opzioni'], [1, 'Passate'], [1, 'Annullate'], [5, 'Tutte']]) assert.match(home, new RegExp(`${label} <span class="tab-n">${n}</span>`), `conteggio ${label}`);
    // la pratica compare col suo nome, il nominativo e il codice
    assert.match(home, /Gruppo Rossi<\/a><small class="muted">Mario Rossi · VE-/);
    assert.match(home, /Opzione<\/span><small class="muted">fino al/);

    assert.deepEqual(refsIn(await get('?view=options')).sort(), refs(conti));
    assert.deepEqual(refsIn(await get('?view=past')), refs(passata));
    assert.deepEqual(refsIn(await get('?view=cancelled')), refs(annullata));
    assert.deepEqual(refsIn(await get('?view=all')).sort(), refs(rossi, verdi, conti, annullata, passata));
    assert.deepEqual(refsIn(await get('?view=boh')).sort(), refs(rossi, verdi, conti), 'scheda sconosciuta: quella di default');

    // ricerca: per nominativo, per pratica, per codice; senza scheda scelta guarda tra tutte (anche passate e annullate)
    const q = (text) => get(`?q=${encodeURIComponent(text)}`);
    assert.deepEqual(refsIn(await q('rossi')), refs(rossi));
    assert.deepEqual(refsIn(await q('PRATICA 77')), refs(verdi), 'senza distinzione tra maiuscole e minuscole');
    assert.deepEqual(refsIn(await q('bruni')), refs(annullata), 'trova anche l’annullata');
    assert.deepEqual(refsIn(await q('neri')), refs(passata), 'Luca Neri è di un’altra agenzia');
    assert.deepEqual(refsIn(await q(verdi.ref)), refs(verdi));
    assert.deepEqual(refsIn(await q('%')), [], 'il simbolo % si cerca come testo, non come «tutto»');
    assert.deepEqual(refsIn(await q('_')), []);
    assert.match(await q('nessunoqui'), /Nessuna prenotazione corrisponde alla ricerca/);
    assert.match(await q('rossi'), /aria-selected="true"[^>]*aria-current="page">Tutte/, 'la scheda «Tutte» si accende da sola');
    assert.deepEqual(refsIn(await get('?view=past&q=rossi')), [], 'se la scheda è scelta, la ricerca resta lì');
    assert.deepEqual(refsIn(await get(`?q=${encodeURIComponent(`' OR 1=1 --`)}`)), [], 'niente iniezioni');

    // date di partenza e di prenotazione
    assert.deepEqual(refsIn(await get(`?from=${day(15)}&to=${day(25)}`)), refs(verdi));
    assert.deepEqual(refsIn(await get(`?from=${day(10)}&to=${day(10)}`)), refs(rossi), 'estremi inclusi');
    assert.deepEqual(refsIn(await get(`?to=${day(-1)}`)), refs(passata));
    assert.deepEqual(refsIn(await get(`?bto=${day(-10)}`)), refs(passata), 'prenotata due settimane fa');
    assert.deepEqual(refsIn(await get(`?bfrom=${day(0)}&view=all`)).sort(), refs(rossi, verdi, conti, annullata));
    assert.equal((await f('/it/b2b/account?from=zz&to=2027-13-45&bfrom=1&page=-3&q=' + 'x'.repeat(500))).status, 200, 'valori malformati non rompono nulla');
    assert.deepEqual(refsIn(await get('?from=zz&to=2027-13-45')).sort(), refs(rossi, verdi, conti), 'date non valide ignorate');
    assert.match(await get(`?from=${day(15)}`), /<details class="filters-more" open>/, 'con le date attive il riquadro resta aperto');

    // riepilogo
    const summary = await get();
    assert.match(summary, /Persone: 4/);
    assert.match(summary, /Opzioni aperte<\/span><strong class="kpi-n">1<\/strong>/);
    assert.match(summary, /Da saldare<\/span><strong class="kpi-n">[^<]*€/);

    // pagine: venti per volta
    for (let i = 0; i < 24; i++) book(app, lagoon, { ref: `Serie ${i}`, date: day(60 + i), pax: 1 });
    const p1 = await get('?view=upcoming');
    assert.match(p1, /Pagina 1 di 2/);
    assert.equal((p1.match(/<tr class="pb-/g) ?? []).length, 20);
    const p2 = await get('?view=upcoming&page=2');
    assert.match(p2, /Pagina 2 di 2/);
    assert.equal((p2.match(/<tr class="pb-/g) ?? []).length, 7, '27 in arrivo − 20');
    assert.match(await get('?view=upcoming&page=99'), /Pagina 2 di 2/, 'oltre l’ultima: l’ultima');
    assert.match(p1, /href="\/it\/b2b\/account\?view=upcoming&amp;page=2"/);
  } finally {
    s.close();
  }
});

test('area agenzie: esportazione dell’elenco in CSV (solo le proprie pratiche, senza formule che si eseguono)', async () => {
  const s = await start();
  try {
    const { app, lagoon, blue } = s;
    book(app, lagoon, { ref: 'Gruppo Rossi', name: 'Mario Rossi' });
    book(app, lagoon, { ref: '=HYPERLINK("http://evil.example")', name: '+cmd|calc', date: day(12) });
    book(app, blue, { ref: 'Gruppo Altrui', kind: 'card', date: day(13) });
    const f = await s.login('giulia@lagoon.example');
    const res = await f('/it/b2b/bookings.csv?view=all');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="prenotazioni.csv"/);
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    const raw = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 con BOM (Excel lo riconosce)');
    const csv = raw.toString('utf8').slice(1);
    assert.ok(csv.startsWith('Codice;Riferimento pratica / gruppo;'), 'intestazioni nella lingua');
    const rows = csv.trim().split('\r\n');
    assert.equal(rows.length, 3, 'intestazione + 2 pratiche');
    assert.ok(rows.some((r) => r.includes('Gruppo Rossi;Mario Rossi;Cannaregio e il Ghetto;') && r.includes(';Confermata;')));
    assert.ok(!csv.includes('Gruppo Altrui'));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"")"`), 'la formula è neutralizzata');
    assert.ok(csv.includes(`;'+cmd|calc;`));
    // il filtro vale anche per l’esportazione
    const only = (await (await f('/it/b2b/bookings.csv?q=rossi')).text()).trim().split('\r\n');
    assert.equal(only.length, 2);
    assert.match(Buffer.from(await (await f('/en/b2b/bookings.csv')).arrayBuffer()).toString('utf8').slice(1), /^Reference;/);
  } finally {
    s.close();
  }
});

test('scheda della pratica: solo la propria; si cambia il nominativo (la guida lo sa), non più a servizio iniziato; voucher dal proprio account', async () => {
  const s = await start();
  try {
    const { app, lagoon, blue } = s;
    const mia = book(app, lagoon, { ref: 'Gruppo Rossi', name: 'Giulia Bianchi', date: day(15) });
    const opzione = book(app, lagoon, { ref: 'Preventivo', date: day(40), kind: 'option' });
    const passata = book(app, lagoon, { ref: 'Passata', date: day(-3), nowMs: Date.now() - 10 * DAY });
    const altrui = book(app, blue, { kind: 'card', date: day(16) });
    const f = await s.login('giulia@lagoon.example');
    const other = await s.login('luca@blue.example');
    const sent = () => s.app.mail.sent.filter((m) => /Prenotazione modificata/.test(m.subject));

    const page = nb(await (await f(`/it/b2b/bookings/${mia.ref}`)).text());
    assert.match(page, /<body class="[^"]*partner-area/);
    assert.match(page, new RegExp(`<form class="card pad form edit-card" method="post" action="/it/b2b/bookings/${mia.ref}/edit"`));
    assert.match(page, /name="name" required maxlength="120" value="Giulia Bianchi"/);
    assert.match(page, /← Tutte le prenotazioni/);
    assert.match(page, new RegExp(`/it/b2b/bookings/${mia.ref}/voucher.pdf|/it/booking/${mia.ref}/voucher.pdf\\?t=${mia.token}`));

    // le pratiche degli altri non si vedono né si toccano
    assert.equal((await f(`/it/b2b/bookings/${altrui.ref}`)).status, 404);
    assert.equal((await f(`/it/b2b/bookings/${altrui.ref}/voucher.pdf`)).status, 404);
    assert.equal((await f(`/it/b2b/bookings/${altrui.ref}/edit`, post({ name: 'Hacker' }))).status, 404);
    assert.equal((await other(`/it/b2b/bookings/${mia.ref}/edit`, post({ name: 'Hacker' }))).status, 404);
    assert.equal((await s.anon(`/it/b2b/bookings/${mia.ref}`)).status, 302);
    assert.equal(s.app.db.prepare('SELECT name FROM bookings WHERE id = ?').get(mia.id).name, 'Giulia Bianchi');

    // cambio di nominativo, telefono e note: salvato, la guida riceve l’aggiornamento
    const ok = await f(`/it/b2b/bookings/${mia.ref}/edit`, post({ name: '  Famiglia Conti  ', clientRef: 'Pratica 12', phone: '+39 333 111', notes: 'Una carrozzina' }));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), `/it/b2b/bookings/${mia.ref}?flash=edited#edit`);
    const row = s.app.db.prepare('SELECT name, client_ref, phone, notes FROM bookings WHERE id = ?').get(mia.id);
    assert.deepEqual({ ...row }, { name: 'Famiglia Conti', client_ref: 'Pratica 12', phone: '+39 333 111', notes: 'Una carrozzina' });
    assert.equal(sent().length, 1);
    assert.equal(sent()[0].to, 'guida@example.com');
    assert.match(sent()[0].text, /Nominativo: Giulia Bianchi → Famiglia Conti/);
    assert.match(sent()[0].text, /Telefono: — → \+39 333 111/);
    assert.match(sent()[0].text, /Note: — → Una carrozzina/);
    assert.match(nb(await (await f(`/it/b2b/bookings/${mia.ref}?flash=edited`)).text()), /Modifiche salvate/);
    assert.match(nb(await (await f('/it/b2b/account')).text()), /Pratica 12<\/a><small class="muted">Famiglia Conti/);

    // solo il riferimento pratica (interno all’agenzia): nessun avviso alla guida
    await f(`/it/b2b/bookings/${mia.ref}/edit`, post({ name: 'Famiglia Conti', clientRef: 'Pratica 12-bis', phone: '+39 333 111', notes: 'Una carrozzina' }));
    assert.equal(sent().length, 1, 'nessun nuovo avviso');
    assert.equal(s.app.db.prepare('SELECT client_ref FROM bookings WHERE id = ?').get(mia.id).client_ref, 'Pratica 12-bis');

    // nominativo vuoto: errore e nulla cambia
    const empty = await f(`/it/b2b/bookings/${mia.ref}/edit`, post({ name: '   ', clientRef: 'X' }));
    assert.equal(loc(empty), `/it/b2b/bookings/${mia.ref}?flash=edit-error#edit`);
    assert.equal(s.app.db.prepare('SELECT name FROM bookings WHERE id = ?').get(mia.id).name, 'Famiglia Conti');
    assert.match(nb(await (await f(`/it/b2b/bookings/${mia.ref}?flash=edit-error`)).text()), /Il nominativo è obbligatorio/);

    // anche un’opzione si può intestare (la guida non riceve nulla: la prenotazione non è ancora confermata)
    assert.equal(loc(await f(`/it/b2b/bookings/${opzione.ref}/edit`, post({ name: 'Cliente scelto', clientRef: 'Preventivo' }))), `/it/b2b/bookings/${opzione.ref}?flash=edited#edit`);
    assert.equal(sent().length, 1);

    // servizio già iniziato: non si cambia più nulla e il modulo non c’è
    const late = await f(`/it/b2b/bookings/${passata.ref}/edit`, post({ name: 'Troppo tardi' }));
    assert.equal(loc(late), `/it/b2b/bookings/${passata.ref}?flash=edit-locked#edit`);
    assert.notEqual(s.app.db.prepare('SELECT name FROM bookings WHERE id = ?').get(passata.id).name, 'Troppo tardi');
    const latePage = await (await f(`/it/b2b/bookings/${passata.ref}`)).text();
    assert.ok(!latePage.includes('edit-card'));

    // voucher dal proprio account: solo per le prenotazioni confermate
    const pdf = await f(`/it/b2b/bookings/${mia.ref}/voucher.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.ok(isPdf(await pdf.arrayBuffer()));
    assert.equal((await f(`/it/b2b/bookings/${opzione.ref}/voucher.pdf`)).status, 404, 'un’opzione non ha voucher');

    // la stessa pratica dal link dell’email: dentro l’area per chi è il titolare, pagina di sempre per gli altri
    const asOwner = await (await f(`/it/booking/${mia.ref}?t=${mia.token}`)).text();
    assert.match(asOwner, /partner-area/);
    assert.ok(asOwner.includes('edit-card'));
    const asGuest = await (await s.anon(`/it/booking/${mia.ref}?t=${mia.token}`)).text();
    assert.ok(!asGuest.includes('edit-card') && !asGuest.includes('partner-area') && !asGuest.includes('Tutte le prenotazioni'));
    const asOther = await (await other(`/it/booking/${mia.ref}?t=${mia.token}`)).text();
    assert.ok(!asOther.includes('edit-card'), 'un’altra agenzia con il link non può modificare');
  } finally {
    s.close();
  }
});

test('opzioni dall’elenco: «Conferma» porta alla scheda, «Rilascia» libera la data e torna all’elenco', async () => {
  const s = await start();
  try {
    const { app, lagoon } = s;
    const opt = book(app, lagoon, { ref: 'Preventivo Conti', date: day(40), kind: 'option' });
    const f = await s.login('giulia@lagoon.example');
    const list = nb(await (await f('/it/b2b/account?view=options')).text());
    assert.match(list, new RegExp(`href="/it/b2b/bookings/${opt.ref}#option">Conferma</a>`));
    assert.match(list, new RegExp(`action="/it/booking/${opt.ref}/option/release"[^>]*data-confirm`));
    assert.match(list, new RegExp(`name="next" value="/it/b2b/account"`));
    // dalla scheda: conferma e rilascio con la scelta del pagamento
    const detail = nb(await (await f(`/it/b2b/bookings/${opt.ref}`)).text());
    assert.match(detail, /id="option"/);
    assert.match(detail, new RegExp(`action="/it/booking/${opt.ref}/option/confirm"`));

    const res = await f(`/it/booking/${opt.ref}/option/release`, post({ t: opt.token, next: '/it/b2b/account' }));
    assert.equal(res.status, 303);
    assert.equal(loc(res), '/it/b2b/account?flash=option-released');
    assert.equal(app.db.prepare('SELECT status FROM bookings WHERE id = ?').get(opt.id).status, 'expired', 'la data torna libera, senza annulli');
    assert.match(nb(await (await f('/it/b2b/account?flash=option-released')).text()), /Data rilasciata|rilasciata/i);
    assert.ok(!(await (await f('/it/b2b/account?flash=<script>alert(1)</script>')).text()).includes('<script>alert(1)'), 'il messaggio non si può inventare');
    // l’opzione rilasciata resta visibile tra le annullate/scadute come «Opzione scaduta»
    assert.match(nb(await (await f('/it/b2b/account?view=cancelled')).text()), /Opzione scaduta/);
  } finally {
    s.close();
  }
});

test('fatture: l’agenzia vede e scarica solo le sue (PDF), dall’elenco e dalla scheda; le bozze non si vedono', async () => {
  const s = await start();
  try {
    const { app, lagoon, blue } = s;
    const mia = book(app, lagoon, { ref: 'Gruppo Rossi', date: day(10) });
    const bozza = book(app, lagoon, { ref: 'Ancora in bozza', date: day(12) });
    const altrui = book(app, blue, { ref: 'Gruppo Altrui', kind: 'card', date: day(11) });

    const buyer = (a) => ({ kind: 'company', name: a.company, country: 'IT', vat: a.vat, sdiCode: a.sdi_code, address: 'Fondamenta Test 1', zip: '30100', city: 'Venezia', province: 'VE', email: a.email, lang: 'it' });
    const issue = (booking, account) => {
      const [draft] = createDrafts(app, [`booking:${booking.id}`]);
      const d = invoiceDetail(app, draft.id);
      saveDraft(app, draft.id, { buyer: buyer(account), lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: {} });
      return issueInvoice(app, draft.id);
    };
    const invMia = issue(mia, lagoon);
    const invAltrui = issue(altrui, blue);
    const [draftOnly] = createDrafts(app, [`booking:${bozza.id}`]);
    assert.equal(draftOnly.status, 'draft');

    const f = await s.login('giulia@lagoon.example');
    const list = nb(await (await f('/it/b2b/invoices')).text());
    assert.ok(list.includes(invMia.number), 'la sua fattura');
    assert.notEqual(invAltrui.number, invMia.number);
    assert.ok(!list.includes(`/it/b2b/invoices/${invAltrui.id}/pdf`), 'non quella di altri');
    assert.equal((list.match(/Scarica PDF/g) ?? []).length, 1, 'una fattura emessa, nessuna bozza');
    assert.match(list, /Importo ancora da saldare/);
    assert.match(list, /Le prenotazioni a fattura vengono fatturate dopo il servizio/);

    const pdf = await f(`/it/b2b/invoices/${invMia.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.ok(isPdf(await pdf.arrayBuffer()));
    assert.match(pdf.headers.get('content-disposition'), /fattura-/);
    assert.equal((await f(`/it/b2b/invoices/${invAltrui.id}/pdf`)).status, 404, 'fattura di un’altra agenzia');
    assert.equal((await f(`/it/b2b/invoices/${draftOnly.id}/pdf`)).status, 404, 'una bozza non è un documento');
    assert.equal((await f('/it/b2b/invoices/abc/pdf')).status, 404);
    assert.equal((await s.anon(`/it/b2b/invoices/${invMia.id}/pdf`)).status, 302);

    // dall’elenco delle prenotazioni e dalla scheda
    const dash = nb(await (await f('/it/b2b/account')).text());
    assert.match(dash, new RegExp(`href="/it/b2b/invoices/${invMia.id}/pdf"[^>]*>Fattura ${invMia.number}</a>`));
    assert.equal((dash.match(/Fattura \d+\/\d{4}<\/a>/g) ?? []).length, 1, 'solo la pratica fatturata');
    assert.match(nb(await (await f(`/it/b2b/bookings/${mia.ref}`)).text()), new RegExp(`href="/it/b2b/invoices/${invMia.id}/pdf"`));
    assert.match(nb(await (await f(`/it/b2b/bookings/${bozza.ref}`)).text()), /La fattura comparirà qui/, 'ancora da emettere');
  } finally {
    s.close();
  }
});

test('prenotare da agenzia: «Cerca» ha tour privati (attivo) e condivisi (spento); la barra resta quella dell’area agenzie fino al pagamento', async () => {
  const s = await start();
  try {
    const f = await s.login('giulia@lagoon.example');
    const date = day(12);
    const titles = (html) => [...html.matchAll(/<h3><a href="\/it\/tours\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    const page = nb(await (await f(`/it/book?date=${date}&pax=4`)).text());
    assert.match(page, /name="kind" value="private" checked/);
    assert.ok(!/name="kind" value="shared" checked/.test(page), 'condivisi spenti di default');
    assert.ok(titles(page).includes('guida-a-ore') && !titles(page).includes('cannaregio-ghetto'), `privati: ${titles(page)}`);
    const shared = nb(await (await f(`/it/book?date=${date}&pax=4&kinds=1&kind=shared`)).text());
    assert.ok(titles(shared).includes('cannaregio-ghetto') && !titles(shared).includes('guida-a-ore'), `condivisi: ${titles(shared)}`);
    const both = nb(await (await f(`/it/book?date=${date}&pax=4&kinds=1&kind=shared&kind=private`)).text());
    assert.ok(titles(both).includes('cannaregio-ghetto') && titles(both).includes('guida-a-ore'));
    // pagina di checkout: stessa barra
    const checkout = await (await f(`/it/book/checkout?tour=cannaregio-ghetto&date=${date}&time=10:00&pax=2`)).text();
    assert.match(checkout, /partner-area/);
    assert.match(checkout, /Area agenzia<\/a><span aria-hidden="true">›<\/span>/);
    // il pubblico (e chi non è dentro) non vede le spunte: sono solo per le agenzie
    const pub = await (await s.anon(`/it/book?date=${date}&pax=4`)).text();
    assert.ok(!pub.includes('name="kind"') && !pub.includes('partner-area'));
  } finally {
    s.close();
  }
});

test('uscita dal pannello admin: «Esci» riporta alla home del sito', async () => {
  const s = await start();
  try {
    const admin = s.jar();
    assert.equal((await admin('/admin/login', post({ password: 'segreto-admin' }))).status, 303);
    assert.equal((await admin('/admin')).status, 200);
    const out = await admin('/admin/logout', post());
    assert.equal(out.status, 303);
    assert.equal(loc(out), '/');
    assert.equal(loc(await admin('/admin')), '/admin/login', 'la sessione è chiusa');
  } finally {
    s.close();
  }
});
