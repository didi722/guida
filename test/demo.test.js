// Demo per le agenzie: un'area agenzie finta, isolata dal sito vero. Tabelle copiate e non, configurazione ripulita, dati d'esempio, ingresso con la chiave,
// smistamento per cookie, accessi che non valgono da una parte all'altra, «Ricomincia», «Esci», e il pannello con il collegamento.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { getSetting, openDb, setSetting } from '../server/db.js';
import { DEMO_COPIED_SETTINGS, DEMO_COPIED_TABLES, DEMO_SKIPPED_TABLES, copyCatalog, demoConfig, demoLink } from '../server/demo.js';
import { nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-demo-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');

// i dati «veri» del sito: con questi si controlla che nella demo non ne arrivi nemmeno uno
const REAL = {
  site: { vatNumber: 'IT04657970485', legalName: 'Davide Tomio' },
  invoice: { iban: 'IT28W8000000292100645211208', bank: 'Banca Vera', startDate: '2026-01-01', seller: { firstName: 'Davide', lastName: 'Tomio', fiscalCode: 'TMODVD80A01L736F', address: { street: 'Via Vera 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
  stripe: { secretKey: 'sk_live_vera', webhookSecret: 'whsec_vero' },
  mail: { host: 'smtp.vero.example', user: 'vero', pass: 'segreto-vero', notifyTo: 'guida@vero.example', sales: { host: 'smtp.vendite.example', user: 'vendite', pass: 'segreto-vendite' } },
};

async function start(over = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', sessionSecret: 'segreto-di-sessione-molto-lungo-0123456789', ...REAL, ...over });
  cfg.demoPayments = true; // (la chiave Stripe finta sopra serve solo a verificare che la demo non la erediti)
  delete cfg.adminPassword; // createConfig copia anche questa chiave dei test: in produzione non c'è
  const mail = { sent: [], live: false, salesLive: false, lastError: '', async send(m) { this.sent.push(m); return true; } };
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), mail });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    const fn = async (p, init = {}) => {
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
    fn.cookies = cookies;
    return fn;
  };
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  return { app, cfg, mail, admin, jar, base, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('ogni tabella del database è classificata: o si copia nella demo (catalogo) o non si copia mai', () => {
  const db = openDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const known = new Set([...DEMO_COPIED_TABLES, ...DEMO_SKIPPED_TABLES]);
  assert.deepEqual(tables.filter((t) => !known.has(t)), [], 'una tabella nuova va messa in DEMO_COPIED_TABLES (solo se è catalogo) o in DEMO_SKIPPED_TABLES');
  assert.deepEqual(DEMO_COPIED_TABLES.filter((t) => DEMO_SKIPPED_TABLES.includes(t)), [], 'una tabella non può essere in entrambi gli elenchi');
  assert.deepEqual([...known].filter((t) => !tables.includes(t)), [], 'nell’elenco c’è una tabella che non esiste più');
  // le tabelle copiate sono catalogo: nessuna ha colonne di persone o di clienti
  for (const t of DEMO_COPIED_TABLES) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.deepEqual(cols.filter((c) => /email|phone|password|token|account|booking|iban|vat/i.test(c)), [], `${t}: colonne che sembrano dati di persone`);
  }
});

test('copia del catalogo: tour, tariffe e regole sì; agenzie, prenotazioni, fatture, contatti, chiavi e dati fiscali no', () => {
  const real = openDb(':memory:');
  real.prepare("INSERT INTO content_tours(slug, data_json, updated_at) VALUES('giro', '{\"x\":1}', 't')").run();
  addAccount(real, { email: 'vera@agenzia.example' });
  real.prepare("INSERT INTO leads(company, kind, status, priority, created_at, updated_at) VALUES('Contatto vero', 'agency', 'new', 2, 't', 't')").run();
  setSetting(real, 'rate_card', { v: 1 });
  setSetting(real, 'weekly', { 1: { open: true, from: '09:00', to: '18:00' } });
  setSetting(real, 'admin_security', { totp: 'segretissimo' });
  setSetting(real, 'demo_key', 'chiave-segreta-del-collegamento');
  setSetting(real, 'lead_send', { fromEmail: 'info@vero.example' });
  setSetting(real, 'auto_backup', { copies: { a: 1 } });
  setSetting(real, 'config_overrides', { 'policy.b2bFreeCancelHours': 96, 'options.maxActive': 7, 'invoice.iban': 'IT28W8000000292100645211208', 'invoice.seller.address.street': 'Via Vera 1', 'invoice.startDate': '2027-01-01', 'mail.notifyTo': 'vero@x.it', 'site.vatNumber': 'IT04657970485', 'policy.paymentsFrom': '2027-01-01', 'reminders.overdue.enabled': true });
  const demo = openDb(':memory:');
  demo.prepare('DELETE FROM content_tours').run();
  const copied = copyCatalog(real, demo);

  assert.equal(copied.content_tours, 1);
  assert.deepEqual(demo.prepare('SELECT slug FROM content_tours').all().map((r) => r.slug), ['giro']);
  assert.deepEqual(getSetting(demo, 'rate_card'), { v: 1 });
  assert.deepEqual(getSetting(demo, 'weekly'), { 1: { open: true, from: '09:00', to: '18:00' } });
  assert.deepEqual(getSetting(demo, 'config_overrides'), { 'policy.b2bFreeCancelHours': 96, 'options.maxActive': 7 }, 'restano le regole; spariscono dati fiscali, posta, solleciti e pre-apertura');
  for (const key of ['admin_security', 'demo_key', 'lead_send', 'auto_backup']) assert.equal(getSetting(demo, key, null), null, `${key} non si copia`);
  for (const table of DEMO_SKIPPED_TABLES.filter((t) => t !== 'settings')) assert.equal(demo.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `${table} deve restare vuota`);
  assert.deepEqual(DEMO_COPIED_SETTINGS.filter((k) => /key|secret|admin|mail|backup/i.test(k)), []);
});

test('configurazione della demo: nessuna chiave, posta, PEC, admin o dato fiscale del sito vero; sessioni diverse; la configurazione vera non cambia', async () => {
  const s = await start();
  try {
    const real = s.cfg;
    const before = JSON.stringify(real);
    const d = demoConfig(real);
    assert.equal(JSON.stringify(real), before, 'la configurazione vera non si tocca');
    assert.equal(d.isDemo, true);
    assert.notEqual(d.sessionSecret, real.sessionSecret);
    assert.deepEqual([d.admin.password, d.stripe.secretKey, d.stripe.webhookSecret, d.mail.host, d.mail.user, d.mail.pass, d.mail.notifyTo, d.mail.sales.host, d.mail.sales.pass, d.invoice.pec.host], ['', '', '', '', '', '', '', '', '', '']);
    assert.equal(d.demoPayments, true);
    assert.equal(d.site.vatNumber, 'IT12345678903');
    assert.equal(d.invoice.seller.fiscalCode, 'RSSMRA80A01H501U');
    assert.equal(d.invoice.seller.address.street, 'Calle del Test 1');
    assert.equal(d.invoice.iban, 'IT60X0542811101000000123456');
    assert.equal(d.invoice.startDate, '');
    assert.equal(d.policy.paymentsFrom, '');
    assert.match(d.invoice.notes, /^DOCUMENTO DIMOSTRATIVO/);
    assert.deepEqual([d.invoice.seller.firstName, d.invoice.seller.lastName], ['Davide', 'Tomio'], 'il nome resta quello del sito');
    const dump = JSON.stringify(d);
    for (const vero of ['sk_live_vera', 'whsec_vero', 'segreto-vero', 'segreto-vendite', 'smtp.vero.example', 'IT04657970485', 'TMODVD80A01L736F', 'Via Vera 1', 'IT28W8000000292100645211208', 'segreto-admin']) assert.ok(!dump.includes(vero), `nella demo c'è ancora «${vero}»`);
  } finally {
    s.close();
  }
});

test('dati d’esempio: agenzia approvata con prenotazioni in tutti gli stati e fatture in tutti gli stati (pagata, scaduta, stornata, da pagare); niente è andato sul sito vero', async () => {
  const s = await start();
  try {
    const realCounts = () => ['accounts', 'bookings', 'invoices', 'quotes', 'programs', 'account_users', 'cart_items'].map((t) => s.app.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
    assert.deepEqual(realCounts(), [0, 0, 0, 0, 0, 0, 0]);
    const inst = await s.app.demo.ensure();
    assert.deepEqual(inst.report.filter((l) => l.startsWith('✗')), [], inst.report.join('\n'));
    assert.deepEqual(realCounts(), [0, 0, 0, 0, 0, 0, 0], 'il sito vero non ha ricevuto nulla');
    assert.equal(s.mail.sent.length, 0, 'nessuna email dal sito vero');

    const { db } = inst.app;
    assert.deepEqual([inst.account.status, inst.account.company, inst.account.allow_invoice], ['approved', 'Laguna Viaggi (demo)', 1]);
    const states = db.prepare("SELECT status, payment_method, payment_status FROM bookings").all().map((b) => `${b.status}/${b.payment_method}/${b.payment_status}`);
    for (const want of ['confirmed/card/paid', 'confirmed/invoice/unpaid', 'confirmed/invoice/paid', 'option/invoice/unpaid', 'cancelled/card/refunded', 'cancelled/invoice/unpaid']) assert.ok(states.includes(want), `manca una prenotazione ${want}`);
    assert.ok(db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE booked_by_name = 'Marco Verdi'").get().n > 0, 'qualcuna è del collaboratore');
    assert.deepEqual(db.prepare('SELECT status FROM quotes ORDER BY id').all().map((q) => q.status), ['sent', 'approved', 'draft'], 'preventivi: inviato, accettato, da inviare');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM programs').get().n, 1);

    const today = nowRome().date;
    const invs = db.prepare("SELECT * FROM invoices ORDER BY seq").all();
    assert.equal(invs.length, 5);
    assert.deepEqual(invs.map((i) => i.number.split('/')[0]), ['1', '2', '3', '4', '5'], 'numerate senza buchi, nell’ordine delle date');
    assert.deepEqual(invs.map((i) => i.doc_type), ['TD01', 'TD01', 'TD01', 'TD04', 'TD01'], 'la quarta è una nota di credito');
    const { payState } = await import('../server/invoicePayments.js');
    assert.deepEqual([invs[0], invs[1], invs[2], invs[4]].map((i) => payState(i, today).state), ['paid', 'overdue', 'credited', 'open']);
    assert.equal(invs[3].related_id, invs[2].id, 'la nota di credito storna la terza fattura');
    // tutte le date partono da oggi: la scaduta lo è da pochi giorni, quella da pagare scade tra qualche settimana, i preventivi sono validi
    const { dueDateOf } = await import('../server/invoicePayments.js');
    const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
    assert.equal(days(dueDateOf(invs[1]), today), 4, 'scaduta da 4 giorni');
    assert.equal(days(today, dueDateOf(invs[4])), 22, 'l’ultima scade tra 22 giorni');
    assert.equal(days(invs[4].issue_date, today), 8);
    assert.ok(db.prepare('SELECT valid_until FROM quotes').all().every((q) => q.valid_until >= today), 'nessun preventivo scaduto');
    // dati fiscali finti, dicitura di prova, e nessun dato fiscale vero in nessun documento
    for (const i of invs) {
      assert.match(i.xml, /DOCUMENTO DIMOSTRATIVO/);
      for (const vero of ['IT04657970485', '04657970485', 'TMODVD80A01L736F', 'IT28W8000000292100645211208']) assert.ok(!i.xml.includes(vero) && !i.config_json.includes(vero), `la fattura ${i.number} contiene «${vero}»`);
      assert.ok(i.xml.includes('12345678903') && i.xml.includes('RSSMRA80A01H501U'));
    }
  } finally {
    s.close();
  }
});

test('ingresso: senza la chiave la pagina non esiste; con la chiave si entra come l’agenzia, in qualunque lingua, e si vede la fascia di avviso', async () => {
  const s = await start();
  try {
    const anon = s.jar();
    assert.equal((await anon('/demo')).status, 404, 'senza chiave');
    assert.equal(getSetting(s.app.db, 'demo_key', null), null, 'chi bussa senza chiave non fa creare la chiave');
    assert.equal((await anon('/demo?k=sbagliata')).status, 404, 'chiave sbagliata');
    assert.equal((await anon('/demo?k=')).status, 404);
    assert.equal(anon.cookies.size, 0);

    const key = s.app.demo.key();
    assert.match(key, /^[A-Za-z0-9_-]{20,}$/);
    assert.equal(s.app.demo.key(), key, 'la chiave resta la stessa finché non si cambia');
    const enter = await anon(`/demo?k=${key}&lang=en`);
    assert.equal(enter.status, 303);
    assert.equal(loc(enter), '/en/b2b/account');
    assert.ok(anon.cookies.has('gd') && anon.cookies.has('gs'));
    assert.match(enter.headers.get('cache-control'), /no-store/);

    const home = await anon('/en/b2b/account');
    assert.equal(home.status, 200);
    const page = await home.text();
    assert.match(page, /Laguna Viaggi \(demo\)/);
    assert.match(page, /DEMO AREA/);
    assert.match(page, /action="\/demo\/reset"/);
    assert.match(page, /href="\/demo\/exit"/);
    assert.match(page, /noindex/);
    for (const lang of ['it', 'es', 'ja']) assert.equal((await anon(`/demo?k=${key}&lang=${lang}`)).headers.get('location'), `/${lang}/b2b/account`);
    assert.equal(s.mail.sent.length, 0);
  } finally {
    s.close();
  }
});

test('l’area agenzie della demo funziona: prenotazioni, fatture (anche il PDF), tariffe, preventivi, pacchetto, estratto conto, team, programma', async () => {
  const s = await start();
  try {
    const demo = s.jar();
    await demo(`/demo?k=${s.app.demo.key()}&lang=it`);
    const get = async (p, status = 200) => {
      const res = await demo(p);
      assert.equal(res.status, status, p);
      return res;
    };
    const bookings = await (await get('/it/b2b/bookings')).text();
    for (const cliente of ['Gruppo Rossi', 'Famiglia Conti', 'Gruppo Miller (USA)']) assert.match(bookings, new RegExp(cliente.replace(/[()]/g, '\\$&')));
    const invoices = await (await get('/it/b2b/invoices')).text();
    for (const n of ['1/', '2/', '3/', '4/', '5/']) assert.ok(invoices.includes(n), `fattura ${n}`);
    const inst = await s.app.demo.ensure();
    const first = inst.app.db.prepare('SELECT id FROM invoices ORDER BY seq LIMIT 1').get().id;
    const pdf = await get(`/it/b2b/invoices/${first}/pdf`);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    for (const p of ['/it/b2b/rates', '/it/b2b/quotes', '/it/b2b/package', '/it/b2b/statement', '/it/b2b/team', '/it/b2b/billing', '/it/b2b/documents', '/it/b2b/help', '/it/b2b/availability']) await get(p);
    const team = await (await get('/it/b2b/team')).text();
    assert.match(team, /Marco Verdi/);
    const program = inst.app.db.prepare('SELECT ref, token FROM programs').get();
    assert.match(await (await get(`/it/programs/${program.ref}?t=${program.token}`)).text(), /Venezia in tre giorni/);
    const statement = await get('/it/b2b/statement.pdf');
    assert.equal(statement.headers.get('content-type'), 'application/pdf');
    // il voucher di una prenotazione
    const ref = inst.app.db.prepare("SELECT ref FROM bookings WHERE status = 'confirmed' LIMIT 1").get().ref;
    assert.equal((await get(`/it/b2b/bookings/${ref}/voucher.pdf`)).headers.get('content-type'), 'application/pdf');
  } finally {
    s.close();
  }
});

test('nella demo si può prenotare e pagare (per finta): i dati restano nella demo, nessuna email parte e nessuna carta è addebitata', async () => {
  const s = await start();
  try {
    const demo = s.jar();
    await demo(`/demo?k=${s.app.demo.key()}&lang=it`);
    const inst = await s.app.demo.ensure();
    const { createBooking } = await import('../server/bookings.js');
    const { daySlots } = await import('../server/availability.js');
    const tour = inst.app.content.tours.find((t) => t.active && t.audience === 'b2b' && t.pricing !== 'hourly' && t.model === 'person');
    const today = nowRome().date;
    let date = null;
    let slot = null;
    for (let i = 60; i < 120 && !slot; i++) {
      date = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
      slot = daySlots(inst.app.db, inst.app.cfg, tour, date, { pax: 2, channel: 'b2b', nowMs: Date.now() })[0];
    }
    const b = createBooking(inst.app, { tourSlug: tour.slug, date, time: slot.time, pax: 2, channel: 'b2b', account: inst.account, name: 'Giulia', email: inst.account.email, lang: 'it', paymentMethod: 'card' });
    assert.equal(b.status, 'held');
    const pay = await demo(`/pay/demo/${b.ref}?t=${b.token}&lang=it`);
    assert.equal(pay.status, 200);
    assert.match(await pay.text(), /Nessun addebito reale/);
    const done = await demo(`/pay/demo/${b.ref}/complete`, form({ t: b.token, lang: 'it' }));
    assert.ok([302, 303].includes(done.status));
    assert.equal(inst.app.db.prepare('SELECT status FROM bookings WHERE id = ?').get(b.id).status, 'confirmed');
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0, 'nulla è finito nel sito vero');
    assert.equal(s.mail.sent.length, 0, 'nessuna email dal sito vero');
    assert.ok(inst.app.mail.sent.some((m) => m.to === inst.account.email), 'la conferma è finita nella posta (finta) della demo');
    assert.ok(inst.app.mail.sent.every((m) => !m.html && !m.text), 'la posta della demo tiene solo destinatario e oggetto');
  } finally {
    s.close();
  }
});

test('accessi separati: quello della demo non vale sul sito vero (nemmeno con lo stesso numero di agenzia), né il pannello vero vale nella demo', async () => {
  const s = await start();
  try {
    // sul sito vero c'è un'agenzia con lo stesso numero (id 1) di quella della demo
    const real = addAccount(s.app.db, { email: 'vera@agenzia.example', company: 'Agenzia Vera' });
    const demo = s.jar();
    await demo(`/demo?k=${s.app.demo.key()}&lang=it`);
    assert.equal(real.id, 1);
    const gs = demo.cookies.get('gs');

    const outside = s.jar(); // chi ha solo il cookie dell'accesso, senza quello che porta alla demo, parla con il sito vero
    outside.cookies.set('gs', gs);
    const res = await outside('/it/b2b/account');
    assert.notEqual(res.status, 200, 'l’accesso della demo non apre l’agenzia vera');
    assert.match(loc(res) ?? '', /\/b2b\/login/);

    // il pannello è sempre quello vero, anche da un browser che è dentro la demo (la demo non ha un pannello suo)
    const both = s.jar();
    both.cookies.set('ga', s.admin.cookies.get('ga'));
    both.cookies.set('gd', demo.cookies.get('gd'));
    const adminRes = await both('/admin');
    assert.equal(adminRes.status, 200);
    assert.doesNotMatch(await adminRes.text(), /Pannello admin disattivato/, 'è il pannello vero, non quello spento della demo');
    const noAdmin = s.jar();
    noAdmin.cookies.set('gd', demo.cookies.get('gd'));
    assert.equal((await noAdmin('/admin/leads/demo')).status, 302, 'senza il tuo accesso il pannello resta chiuso, demo o no');
    assert.equal((await s.app.demo.ensure()).app.cfg.admin.password, '', 'e dentro la demo il pannello non esiste');
    // e il cookie che porta alla demo, falsificato, non vale
    const forged = s.jar();
    forged.cookies.set('gd', 'eyJrIjoiZGVtbyIsImV4cCI6OTk5OTk5OTk5OTk5OX0.firma-falsa');
    const home = await forged('/it/');
    assert.equal(home.status, 200);
    assert.doesNotMatch(await home.text(), /AREA DIMOSTRATIVA/, 'un cookie falso non porta alla demo');
  } finally {
    s.close();
  }
});

test('«Ricomincia» rifà la demo da capo (solo da dentro e dallo stesso sito), «Esci» torna al sito vero', async () => {
  const s = await start();
  try {
    const demo = s.jar();
    await demo(`/demo?k=${s.app.demo.key()}&lang=it`);
    const inst = await s.app.demo.ensure();
    const total = inst.app.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n;
    inst.app.db.prepare('DELETE FROM bookings').run();
    inst.app.db.prepare("INSERT INTO settings(key, value) VALUES('provato', '1')").run();

    assert.equal((await s.jar()('/demo/reset', form({}))).status, 404, 'senza essere dentro la demo non c’è nulla da ricominciare');
    assert.equal((await demo('/demo/reset', { ...form({}), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://altro.example' } })).status, 403, 'da un altro sito no');
    const res = await demo('/demo/reset', { ...form({}), headers: { 'content-type': 'application/x-www-form-urlencoded', referer: 'http://localhost/ja/b2b/bookings' } });
    assert.equal(res.status, 303);
    assert.equal(loc(res), '/ja/b2b/account');
    const fresh = await s.app.demo.ensure();
    assert.notEqual(fresh, inst, 'è un’applicazione nuova');
    assert.equal(await s.app.demo.freshIfIdle(10), fresh, 'se la si sta usando, il collegamento non la azzera');
    assert.notEqual(await s.app.demo.freshIfIdle(-1), fresh, 'dopo una pausa il collegamento la rifà con le date di oggi');
    assert.equal(fresh.app.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, total);
    assert.equal(fresh.app.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'provato'").get().n, 0);
    assert.equal((await demo('/ja/b2b/account')).status, 200, 'si rientra come l’agenzia');

    const out = await demo('/demo/exit');
    assert.equal(out.status, 303);
    assert.equal(loc(out), '/');
    assert.equal(demo.cookies.size, 0);
    assert.doesNotMatch(await (await demo('/it/')).text(), /AREA DIMOSTRATIVA/, 'di nuovo il sito vero');
  } finally {
    s.close();
  }
});

test('pannello: il collegamento sta in Commerciale › Demo, solo per la guida; cambiarlo spegne quello vecchio', async () => {
  const s = await start();
  try {
    assert.equal((await s.jar()('/admin/leads/demo')).status, 302, 'senza accesso si va al login');
    const page = await s.admin('/admin/leads/demo');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Demo per le agenzie/);
    assert.ok(html.includes(demoLink(s.app, '', s.base)), 'c’è il collegamento riservato, con l’indirizzo da cui guardi il pannello');
    assert.match(html, /href="\/admin\/leads\/demo"/, 'è nel menu del Commerciale');
    for (const l of ['it', 'en', 'es', 'ja']) assert.ok(html.includes(demoLink(s.app, l, s.base).replace(/&/g, '&amp;')), `collegamento in ${l}`);
    assert.doesNotMatch(html, /onfocus|onclick/, 'niente codice dentro la pagina (CSP)');

    const old = s.app.demo.key();
    const res = await s.admin('/admin/leads/demo/key', form({}));
    assert.equal(res.status, 303);
    assert.equal(loc(res), '/admin/leads/demo?ok=key');
    assert.notEqual(s.app.demo.key(), old);
    assert.equal((await s.jar()(`/demo?k=${old}`)).status, 404, 'il vecchio collegamento non funziona più');
    assert.equal((await s.jar()(`/demo?k=${s.app.demo.key()}`)).status, 303);
    assert.equal((await s.jar()('/admin/leads/demo/key', form({}))).status, 302, 'senza accesso si va al login');
    assert.equal(getSetting(s.app.db, 'demo_key'), s.app.demo.key());
  } finally {
    s.close();
  }
});

test('la demo non si porta fuori: la chiave non finisce nelle copie di sicurezza e la demo stessa non ha una demo', async () => {
  const s = await start();
  try {
    const { PRIVATE_SETTINGS } = await import('../server/privateSettings.js');
    assert.ok(PRIVATE_SETTINGS.includes('demo_key'));
    const inst = await s.app.demo.ensure();
    assert.equal(inst.app.demo, undefined, 'niente demo dentro la demo');
    assert.equal(inst.app.cfg.isDemo, true);
    assert.equal(inst.app.payments.demo, true);
    assert.equal(inst.app.payments.live, false);
    assert.equal(inst.app.pec.live, false);
    assert.equal(inst.app.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key IN ('demo_key', 'admin_security')").get().n, 0);
  } finally {
    s.close();
  }
});

test('panoramica dell’agenzia: tre schede (prenotare, prenotazioni, fatture) con i numeri veri; team, logo e fatturazione stanno in «La tua agenzia»', async () => {
  const s = await start();
  try {
    const demo = s.jar();
    await demo(`/demo?k=${s.app.demo.key()}&lang=it`);
    const page = await (await demo('/it/b2b/account')).text();
    assert.match(page, /<h2>Prenota o opziona<\/h2>/);
    assert.match(page, /<h2>Le tue prenotazioni<\/h2>/);
    assert.match(page, /<h2>Fatture e pagamenti<\/h2>/);
    assert.match(page, /In arrivo: \d+/);
    assert.match(page, /Opzioni aperte: 2/);
    assert.match(page, /Scaduto da pagare: 422/, 'la fattura scaduta di 422 € si vede subito, senza aprire le fatture');
    assert.match(page, /class="btn btn-gold" href="\/it\/b2b\/invoices"/, 'con una fattura scaduta il pulsante delle fatture è quello in evidenza');
    for (const sparito of ['b2b/availability', 'b2b/team', 'b2b/billing', 'b2b/documents']) assert.doesNotMatch(page, new RegExp(sparito), `${sparito} non è più un pulsante della panoramica`);
    for (const rimasto of ['/it/book', '/it/b2b/bookings', '/it/b2b/invoices', '/it/b2b/quotes', '/it/b2b/agency', '/it/b2b/help']) assert.ok(page.includes(`href="${rimasto}"`), rimasto);
    const hub = await (await demo('/it/b2b/agency')).text();
    for (const link of ['/it/b2b/billing', '/it/b2b/team', '/it/b2b/documents']) assert.ok(hub.includes(`href="${link}"`), link);
    assert.match(hub, /Collaboratori: 1/);
    for (const sub of ['team', 'billing', 'documents']) assert.ok((await (await demo(`/it/b2b/${sub}`)).text()).includes('<a href="/it/b2b/agency">La tua agenzia</a>'), `${sub}: la briciola porta a «La tua agenzia»`);
  } finally {
    s.close();
  }
});
