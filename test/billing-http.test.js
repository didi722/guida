// Registrazione con tutti i dati di fatturazione, il campo del paese e del telefono nelle pagine, la scheda «Dati di fatturazione»
// (area agenzie e pannello) e la fattura che nasce già compilata.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { makeT } from '../server/i18n.js';
import { createDrafts, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { todoList } from '../server/todo.js';
import { addDays, nowRome } from '../server/time.js';
import { BILLING_IT, addAccount, base } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-billing-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const PW = 'prova-prova-1';

async function start() {
  const cfg = createConfig({
    __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' },
    site: { vatNumber: 'IT12345678903' },
    invoice: { seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
  });
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
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  return { app, cfg, admin, jar, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

const REG = { company: 'Venice DMC S.r.l.', vat: 'IT12345678903', country: 'IT', sdi_code: 'abcdefg', ...BILLING_IT, contact_name: 'Giulia', phone: '041 5201234', phone_cc: 'IT', email: 'dmc@example.com', password: 'password-lunga-1', consent: '1' };

test('la pagina di registrazione: paese in ordine alfabetico con ricerca, tutti i dati di fatturazione, telefono con prefisso', async () => {
  const s = await start();
  try {
    for (const [lang, first, italy] of [['it', 'Afghanistan', 'Italia'], ['en', 'Afghanistan', 'Italy'], ['es', 'Afganistán', 'Italia'], ['ja', 'アイスランド', 'イタリア']]) {
      const page = await text(await s.anon(`/${lang}/b2b/register`));
      const sel = page.match(/<select name="country"[^>]*>(.*?)<\/select>/s);
      assert.ok(sel, lang);
      assert.match(sel[0], /data-combo="country"/);
      assert.match(sel[0], /required/);
      const names = [...sel[1].matchAll(/<option value="([A-Z]{2})"[^>]*data-name="([^"]*)"/g)].map((m) => m[2]);
      assert.ok(names.length > 230, lang);
      assert.equal(names[0], first, `in ${lang} si parte da ${first}`);
      assert.deepEqual(names, [...names].sort(new Intl.Collator(lang).compare), `alfabetico in ${lang}`);
      assert.match(sel[1], new RegExp(`<option value="IT"[^>]*selected[^>]*>🇮🇹 ${italy}</option>`), 'l’Italia è preselezionata, con la sua bandiera');
      assert.ok(!/value="OTHER"/.test(sel[1]), 'niente più «Altro» né sigle da decifrare');
    }
    const page = await text(await s.anon('/it/b2b/register'));
    for (const name of ['company', 'vat', 'country', 'tax_code', 'address', 'zip', 'city', 'province', 'sdi_code', 'pec', 'contact_name', 'phone', 'phone_cc', 'email', 'password']) assert.match(page, new RegExp(`name="${name}"`), name);
    assert.match(page, /<select name="phone_cc"[^>]*data-combo="phone"[^>]*required/, 'il prefisso del telefono è obbligatorio');
    assert.match(page, /<option value="IT" data-flag="🇮🇹" data-name="Italia" data-s="[^"]*" data-dial="39" data-main selected>/, 'il prefisso dell’Italia è preselezionato (+39)');
    assert.match(page, /<option value="GB" [^>]*data-dial="44" data-main /, 'tra i paesi con lo stesso prefisso uno è quello «principale»');
    assert.match(page, /<script src="\/js\/combo\.js/);
    assert.match(page, /<script src="\/js\/b2b-register\.js/);
    assert.match(page, /name="province"[^>]*placeholder="es\. VE"/);
    // il paese di partenza è l'Italia in ogni lingua e il prefisso del telefono lo segue (lo script lo allinea se si cambia paese)
    const en = await text(await s.anon('/en/b2b/register'));
    assert.match(en, /<option value="IT" data-flag="🇮🇹" data-name="Italy"[^>]*data-dial="39" data-main selected>/);
    const de = await text(await s.anon('/en/b2b/register'));
    assert.ok(de.includes('data-search-label="Search for a country…"'));
    // il font delle bandiere e il file ci sono
    const font = await s.anon('/fonts/TwemojiCountryFlags.woff2');
    assert.equal(font.status, 200);
    assert.equal(font.headers.get('content-type'), 'font/woff2');
    assert.ok((await font.arrayBuffer()).byteLength > 50_000);
    assert.equal((await s.anon('/js/combo.js')).status, 200);
    assert.match(await text(await s.anon('/it/')), /Bandiere: <a href="https:\/\/twemoji/, 'la licenza (CC BY 4.0) chiede di citare Twemoji');
  } finally {
    s.close();
  }
});

test('registrazione: si salvano tutti i dati (maiuscole, telefono con prefisso); ciò che manca o non torna si segnala e il modulo resta compilato', async () => {
  const s = await start();
  try {
    const { anon } = s;
    const T = makeT('it');
    const bad = async (over, key) => {
      const res = await anon('/it/b2b/register', form({ ...REG, ...over }));
      assert.equal(res.status, 400, JSON.stringify(over));
      const page = await text(res);
      assert.ok(page.includes(T(`err.${key}`).replace(/'/g, '&#39;')), `${JSON.stringify(over)} → ${key}`);
      return page;
    };
    await bad({ address: '' }, 'address');
    await bad({ zip: '3012' }, 'zip');
    await bad({ zip: 'ABCDE' }, 'zip');
    await bad({ city: '' }, 'city');
    await bad({ province: '' }, 'province');
    await bad({ province: 'V1' }, 'province');
    await bad({ tax_code: '' }, 'taxCode');
    await bad({ tax_code: '12345678901' }, 'taxCode');
    await bad({ sdi_code: '', pec: '' }, 'sdi');
    await bad({ sdi_code: '', pec: 'non-un-indirizzo' }, 'pec');
    await bad({ country: '' }, 'country');
    await bad({ country: 'XX' }, 'country');
    await bad({ phone: '' }, 'phone');
    await bad({ phone: '041 5201234', phone_cc: '' }, 'phone');
    const page = await bad({ phone: '12', phone_cc: 'IT' }, 'phone');
    assert.match(page, /name="address"[^>]*value="Fondamenta Nuove 10"/, 'ciò che si era scritto resta nel modulo');
    assert.match(page, /name="city"[^>]*value="Venezia"/);
    assert.match(page, /<option value="IT"[^>]*selected/);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0, 'nessun account creato');

    // tutto a posto
    const ok = await anon('/it/b2b/register', form(REG));
    assert.equal(ok.status, 200);
    const a = s.app.db.prepare('SELECT * FROM accounts WHERE email = ?').get('dmc@example.com');
    assert.deepEqual(
      { vat: a.vat, country: a.country, tax_code: a.tax_code, address: a.address, zip: a.zip, city: a.city, province: a.province, sdi: a.sdi_code, pec: a.pec, phone: a.phone },
      { vat: 'IT12345678903', country: 'IT', tax_code: '12345678903', address: 'Fondamenta Nuove 10', zip: '30121', city: 'Venezia', province: 'VE', sdi: 'ABCDEFG', pec: null, phone: '+39 0415201234' },
      'la sigla e l’SDI in maiuscolo, il telefono con il prefisso',
    );
    // un numero scritto per esteso conta più del paese scelto
    const intl = await anon('/it/b2b/register', form({ ...REG, email: 'intl@example.com', phone: '+44 7911 123456', phone_cc: 'IT' }));
    assert.equal(intl.status, 200);
    assert.equal(s.app.db.prepare('SELECT phone FROM accounts WHERE email = ?').get('intl@example.com').phone, '+44 7911123456');
    // fuori dall'Italia bastano indirizzo, codice postale e città (codice fiscale, provincia e SDI non si chiedono e non si salvano)
    const de = await anon('/en/b2b/register', form({ ...REG, email: 'de@example.com', country: 'DE', vat: 'DE123456789', zip: '10115', city: 'Berlin', address: 'Unter den Linden 1', tax_code: 'xx', province: 'BE', sdi_code: 'ABCDEFG', phone: '30 1234567', phone_cc: 'DE' }));
    assert.equal(de.status, 200);
    const d = s.app.db.prepare('SELECT * FROM accounts WHERE email = ?').get('de@example.com');
    assert.deepEqual([d.country, d.zip, d.city, d.tax_code, d.province, d.sdi_code, d.phone], ['DE', '10115', 'Berlin', null, null, null, '+49 301234567']);
  } finally {
    s.close();
  }
});

test('dati di fatturazione: l’agenzia li completa dalla sua area, un collaboratore no; la fattura nasce già compilata', async () => {
  const s = await start();
  try {
    const { app, anon } = s;
    const hash = await hashPassword(PW);
    // un partner registrato prima: ha solo partita IVA, SDI e un indirizzo
    const old = addAccount(app.db, { email: 'vecchia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia', vat: 'IT01234567897', country: 'IT', sdi_code: 'ABCDEFG', address: 'Calle Larga 1', zip: null, city: null, province: null, tax_code: null });
    const partner = s.jar();
    assert.equal((await partner('/it/b2b/login', form({ email: old.email, password: PW }))).status, 303);
    const dash = await text(await partner('/it/b2b/account'));
    assert.match(dash, /Mancano dei dati di fatturazione \(CAP, città, provincia, codice fiscale\)/, 'l’agenzia vede cosa manca');
    assert.match(dash, /href="\/it\/b2b\/billing"/);
    const page = await text(await partner('/it/b2b/billing'));
    assert.match(page, /<h1>Dati di fatturazione<\/h1>/);
    assert.match(page, /Lagoon DMC/);
    assert.match(page, /name="address"[^>]*value="Calle Larga 1"/);
    assert.match(page, /Mancano dei dati di fatturazione/);
    // il pannello li segnala nel «Da fare»
    const todo = todoList(app).sections.flatMap((x) => x.items).find((i) => /dati di fatturazione incompleti/.test(i.text));
    assert.ok(todo, 'compare tra le cose da fare');
    assert.equal(todo.tone, 'info');
    assert.match(todo.meta, /Lagoon DMC/);

    // non si salva con dati che non tornano
    const T = makeT('it');
    const save = (over) => partner('/it/b2b/billing', form({ country: 'IT', tax_code: '01234567897', address: 'Calle Larga 1', zip: '30124', city: 'Venezia', province: 've', sdi_code: 'ABCDEFG', pec: '', ...over }));
    const wrong = await save({ zip: '301' });
    assert.equal(wrong.status, 400);
    assert.ok((await text(wrong)).includes(T('err.zip')));
    assert.equal(app.db.prepare('SELECT zip FROM accounts WHERE id = ?').get(old.id).zip, null);
    const saved = await save({});
    assert.equal(saved.status, 303);
    assert.equal(loc(saved), '/it/b2b/billing?ok=saved');
    assert.match(await text(await partner('/it/b2b/billing?ok=saved')), /Dati salvati\./);
    const a = app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(old.id);
    assert.deepEqual([a.zip, a.city, a.province, a.tax_code, a.company, a.vat], ['30124', 'Venezia', 'VE', '01234567897', 'Lagoon DMC', 'IT01234567897'], 'ragione sociale e partita IVA non si cambiano da qui');
    assert.ok(!/Mancano dei dati di fatturazione/.test(await text(await partner('/it/b2b/account'))), 'ora è tutto completo');
    assert.ok(!todoList(app).sections.flatMap((x) => x.items).some((i) => /dati di fatturazione incompleti/.test(i.text)));

    // la fattura nasce già compilata e non ha nulla da completare a mano
    const b = createBooking(app, base({ tourSlug: 'cannaregio-ghetto-agenzie', date: addDays(nowRome().date, 40), time: '10:00', channel: 'b2b', account: a, paymentMethod: 'invoice' }), Date.now());
    const [draft] = createDrafts(app, [`booking:${b.id}`], Date.now() + 40 * 86_400_000);
    const d = invoiceDetail(app, draft.id);
    assert.deepEqual([d.buyer.address, d.buyer.zip, d.buyer.city, d.buyer.province, d.buyer.taxCode, d.buyer.sdiCode], ['Calle Larga 1', '30124', 'Venezia', 'VE', '01234567897', 'ABCDEFG']);
    assert.deepEqual(d.problems, [], d.problems.join(' | '));

    // ciò che si corregge nella bozza vale per le prossime fatture e per la scheda
    const lines = d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents }));
    saveDraft(app, draft.id, { buyer: { ...d.buyer, zip: '30121', address: 'Fondamenta Nuove 10' }, lines, issueDate: d.inv.issue_date, options: {} });
    issueInvoice(app, draft.id, Date.now() + 40 * 86_400_000);
    const after = app.db.prepare('SELECT address, zip FROM accounts WHERE id = ?').get(old.id);
    assert.deepEqual({ ...after }, { address: 'Fondamenta Nuove 10', zip: '30121' });

    // un collaboratore non può cambiare i dati dell'azienda
    const member = app.db.prepare("INSERT INTO account_users(account_id, email, name, lang, password_hash, invited_at, activated_at) VALUES(?, 'collega@lagoon.example', 'Marco', 'it', ?, ?, ?)").run(old.id, hash, new Date().toISOString(), new Date().toISOString());
    assert.ok(member.lastInsertRowid);
    const colleague = s.jar();
    assert.equal((await colleague('/it/b2b/login', form({ email: 'collega@lagoon.example', password: PW }))).status, 303);
    assert.equal(loc(await colleague('/it/b2b/billing')), '/it/b2b/account');
    assert.equal(loc(await colleague('/it/b2b/billing', form({ country: 'IT' }))), '/it/b2b/account');
    assert.ok(!/href="\/it\/b2b\/billing"/.test(await text(await colleague('/it/b2b/account'))), 'nemmeno il pulsante');
    // senza accesso si va al login
    assert.match(loc(await anon('/it/b2b/billing')), /\/it\/b2b\/login/);
  } finally {
    s.close();
  }
});

test('pannello: scheda del partner con i dati di fatturazione, salvataggio con controlli', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const a = addAccount(app.db, { email: 'x@lagoon.example', company: 'Lagoon DMC', vat: 'IT01234567897', country: 'IT', sdi_code: 'ABCDEFG', address: 'Calle Larga 1', zip: null, city: null, province: null, tax_code: null });
    const page = await text(await admin(`/admin/partners/${a.id}`));
    assert.match(page, /mancano: CAP, città, provincia, codice fiscale/);
    assert.match(page, /id="fatturazione"/);
    assert.match(page, /action="\/admin\/partners\/\d+\/billing"/);
    assert.match(page, /<select name="country"[^>]*data-combo="country"/);
    assert.match(page, /<option value="IT"[^>]*selected[^>]*>🇮🇹 Italia<\/option>/);
    const post = (over) => admin(`/admin/partners/${a.id}/billing`, form({ country: 'IT', tax_code: '01234567897', address: 'Calle Larga 1', zip: '30124', city: 'Venezia', province: 'VE', sdi_code: 'ABCDEFG', pec: '', ...over }));
    const wrong = await post({ province: '' });
    assert.equal(loc(wrong), `/admin/partners/${a.id}?err=billing-province#fatturazione`);
    assert.match(await text(await admin(loc(wrong).replace('#fatturazione', ''))), /Dati di fatturazione non salvati: Scrivi la sigla della provincia/);
    const ok = await post({});
    assert.equal(loc(ok), `/admin/partners/${a.id}?ok=billing#fatturazione`);
    const row = app.db.prepare('SELECT zip, city, province, tax_code FROM accounts WHERE id = ?').get(a.id);
    assert.deepEqual({ ...row }, { zip: '30124', city: 'Venezia', province: 'VE', tax_code: '01234567897' });
    assert.ok(!/mancano:/.test(await text(await admin(`/admin/partners/${a.id}`))));
    assert.equal((await admin('/admin/partners/9999/billing', form({}))).status, 404);
  } finally {
    s.close();
  }
});
