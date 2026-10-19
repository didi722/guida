// Logo e documenti dell'agenzia: la pagina, il caricamento del logo, il preventivo PDF e il riquadro nelle schede, dall'inizio alla fine.
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
import { createPackage, resolveLine } from '../server/packages.js';
import { encodePng } from '../server/png.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount, HAS_PDFTOTEXT, isPdf, pdfText } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-agency-docs-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const json = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie'; // 28 € a persona per le agenzie

const logoUrl = (w = 200, h = 70) => {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set((i % w) % 10 < 5 ? [175, 145, 104, 255] : [255, 255, 255, 0], i * 4);
  return `data:image/png;base64,${Buffer.from(encodePng(w, h, rgba)).toString('base64')}`;
};

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
  const b = addAccount(app.db, { email: 'bruno@bluesail.example', password_hash: hash, company: 'BlueSail Tours', contact_name: 'Bruno Neri', lang: 'en' });
  const pa = jar();
  const pb = jar();
  assert.equal((await pa('/it/b2b/login', form({ email: a.email, password: PW }))).status, 303);
  assert.equal((await pb('/it/b2b/login', form({ email: b.email, password: PW }))).status, 303);
  return { app, a, b, pa, pb, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const mk = (app, acct, date, over = {}) => createBooking(app, { tourSlug: SHARED, date, time: '10:00', pax: 2, channel: 'b2b', account: acct, name: acct.contact_name, email: acct.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Rossi', ...over });

test('pagina Logo e documenti: valori di partenza, salvataggio, ricarico non valido, solo per le agenzie', async () => {
  const s = await start();
  try {
    const { pa, anon, a, app } = s;
    assert.equal((await anon('/it/b2b/documents')).status, 302);
    assert.equal((await anon('/it/b2b/documents', form({ markup: '10' }))).status, 302);
    const page = await text(await pa('/it/b2b/documents'));
    assert.match(page, /<h1>Logo e documenti<\/h1>/);
    assert.match(page, /Nessun logo caricato/);
    assert.match(page, /data-logo-upload/);
    assert.match(page, /\/js\/agency-logo\.js/);
    assert.match(page, /name="markup"[^>]*value="0"/);
    assert.match(page, /<option value="5" selected>ai 5 € successivi<\/option>/);
    assert.match(page, /name="logoOnVoucher" value="1" checked/);
    assert.match(page, /placeholder="Lagoon DMC"/);

    const save = await pa('/it/b2b/documents', form({ name: 'Lagoon Travel', contact: 'info@lagoon.example', footer: 'Prezzi IVA compresa.', markup: '22,5', round: '10' }));
    assert.equal(save.status, 303);
    assert.equal(loc(save), '/it/b2b/documents?flash=saved');
    const after = await text(await pa(loc(save)));
    assert.match(after, /Salvato\./);
    assert.match(after, /value="Lagoon Travel"/);
    assert.match(after, /name="markup"[^>]*value="22.5"/);
    assert.match(after, /<option value="10" selected>/);
    assert.ok(!/name="logoOnVoucher" value="1" checked/.test(after), 'la spunta tolta resta tolta');
    assert.equal(app.db.prepare('SELECT doc_name, markup_percent, markup_round FROM accounts WHERE id = ?').get(a.id).markup_percent, 22.5);

    const bad = await pa('/it/b2b/documents', form({ name: 'Mai salvato', markup: '999', round: '5' }));
    assert.equal(bad.status, 400);
    const badPage = await text(bad);
    assert.match(badPage, /Il ricarico deve essere un numero tra 0 e 300/);
    assert.match(badPage, /value="Mai salvato"/, 'quel che si era scritto resta nel modulo');
    assert.equal(app.db.prepare('SELECT doc_name FROM accounts WHERE id = ?').get(a.id).doc_name, 'Lagoon Travel');
    for (const lang of ['en', 'es', 'ja']) assert.equal((await pa(`/${lang}/b2b/documents`)).status, 200, lang);
    assert.match(await text(await pa('/it/b2b/account')), /href="\/it\/b2b\/documents">Logo e documenti<\/a>/);
  } finally {
    s.close();
  }
});

test('logo: si carica, si vede solo il proprio, si sostituisce e si toglie; i file sbagliati non passano', async () => {
  const s = await start();
  try {
    const { pa, pb, anon } = s;
    assert.equal((await pa('/it/b2b/documents/logo')).status, 404, 'ancora nessun logo');
    const ok = await pa('/it/b2b/documents/logo', json({ logo: logoUrl() }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const img = await pa('/it/b2b/documents/logo');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.match(img.headers.get('cache-control'), /no-store/);
    assert.equal(Buffer.from(await img.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
    assert.match(await text(await pa('/it/b2b/documents')), /<img class="doc-logo" src="\/it\/b2b\/documents\/logo\?v=\d+" alt="Lagoon DMC"/);
    // l'altra agenzia non vede quel logo; chi non è entrato nemmeno
    assert.equal((await pb('/it/b2b/documents/logo')).status, 404);
    assert.equal((await anon('/it/b2b/documents/logo')).status, 302);
    assert.equal((await anon('/it/b2b/documents/logo', json({ logo: logoUrl() }))).status, 302);

    // file sbagliati: messaggio chiaro e nessun cambiamento
    for (const bad of [{ logo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, { logo: 'testo' }, { logo: logoUrl(8, 8) }, {}, { logo: 42 }]) {
      const res = await pa('/it/b2b/documents/logo', json(bad));
      assert.equal(res.status, 400, JSON.stringify(bad).slice(0, 40));
      assert.match((await res.json()).error, /Caricamento non riuscito/);
    }
    const huge = await pa('/it/b2b/documents/logo', json({ logo: 'data:image/png;base64,' + 'A'.repeat(1_200_000) }));
    assert.equal(huge.status, 413);
    assert.equal((await huge.json()).ok, false);
    const broken = await pa('/it/b2b/documents/logo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{non json' });
    assert.equal(broken.status, 400);
    assert.equal((await pa('/it/b2b/documents/logo')).status, 200, 'il logo di prima è ancora lì');

    // si sostituisce e si toglie
    assert.equal((await pa('/it/b2b/documents/logo', json({ logo: logoUrl(120, 120) }))).status, 200);
    const rm = await pa('/it/b2b/documents/logo/remove', form({}));
    assert.equal(loc(rm), '/it/b2b/documents?flash=logoRemoved');
    assert.match(await text(await pa(loc(rm))), /Logo tolto/);
    assert.equal((await pa('/it/b2b/documents/logo')).status, 404);
  } finally {
    s.close();
  }
});

test('preventivo PDF: pratica e pacchetto dell’agenzia, con il ricarico; di altri o chiuse no; parametri strani non rompono nulla', async () => {
  const s = await start();
  try {
    const { app, pa, pb, anon, a, b } = s;
    const D = day(40);
    const o = mk(app, a, D, { option: true, paymentMethod: undefined, pax: 3 }); // opzione: tariffa 84 €
    await pa('/it/b2b/documents', form({ name: 'Lagoon Travel', contact: 'info@lagoon.example', footer: 'Prezzi IVA compresa.', markup: '25', round: '5' }));
    await pa('/it/b2b/documents/logo', json({ logo: logoUrl() }));

    const res = await pa(`/it/b2b/quote.pdf?ref=${o.ref}&markup=25&round=5&client=Famiglia%20Rossi&until=${day(10)}&lang=it&note=Include%20il%20trasferimento`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), new RegExp(`preventivo-${o.ref}\\.pdf`));
    const pdf = Buffer.from(await res.arrayBuffer());
    assert.ok(isPdf(pdf));
    assert.ok(pdf.toString('latin1').includes('/Subtype /Image'), 'il logo');
    if (HAS_PDFTOTEXT) {
      const t = pdfText(pdf);
      assert.match(t, /Per Famiglia Rossi/);
      assert.match(t, /105 €/, '84 € + 25% = 105 €');
      assert.ok(!/\b84(,00)? €/.test(t), 'la tariffa non compare');
      assert.match(t, /Include il trasferimento/);
      assert.match(t, /Prezzi IVA compresa\./);
    }
    // ricarico e arrotondamento di partenza dal profilo, se il modulo non li dice; valori strani ripiegano su quelli
    for (const q of ['markup=abc&round=7&until=ieri&lang=xx', 'markup=-3', 'markup=999999', `client=${'x'.repeat(500)}&note=${'y'.repeat(3000)}`, 'client[]=a']) {
      const r2 = await pa(`/it/b2b/quote.pdf?ref=${o.ref}&${q}`);
      assert.equal(r2.status, 200, q);
      assert.ok(isPdf(Buffer.from(await r2.arrayBuffer())));
    }
    if (HAS_PDFTOTEXT) {
      const fallback = pdfText(Buffer.from(await (await pa(`/it/b2b/quote.pdf?ref=${o.ref}&markup=abc`)).arrayBuffer()));
      assert.match(fallback, /105 €/, 'markup non valido: quello del profilo (25%)');
    }

    // pacchetto: tutte le righe, in un solo documento
    const pkg = createPackage(app, a, [resolveLine(app, { tour: SHARED, date: day(41), time: '10:00', pax: '2' }), resolveLine(app, { tour: SHARED, date: day(42), time: '15:00', pax: '4' })], { name: 'Anna Conti', email: 'anna@lagoon.example', lang: 'it', paymentMethod: 'invoice' });
    const pk = await pa(`/it/b2b/quote.pdf?ref=${pkg.group.ref}&markup=10&round=1&lang=en`);
    assert.equal(pk.status, 200);
    if (HAS_PDFTOTEXT) {
      const t = pdfText(Buffer.from(await pk.arrayBuffer()));
      assert.match(t, /Cannaregio and the Ghetto/, 'nella lingua scelta per il documento');
      assert.match(t, /€62\b/, '56 € + 10% = 61,60 → 62 €');
      assert.match(t, /€124\b/, '112 € + 10% = 123,20 → 124 €');
      assert.match(t, /€186\b/, 'totale');
      assert.match(t, /QUOTE/);
    }

    // di altri, chiuse o inesistenti: 404; chi non è entrato: login
    assert.equal((await pb(`/it/b2b/quote.pdf?ref=${o.ref}`)).status, 404, 'la pratica di un’altra agenzia');
    assert.equal((await pb(`/it/b2b/quote.pdf?ref=${pkg.group.ref}`)).status, 404, 'il pacchetto di un’altra agenzia');
    assert.equal((await pa('/it/b2b/quote.pdf?ref=VE-ZZZZZZ')).status, 404);
    assert.equal((await pa('/it/b2b/quote.pdf')).status, 404);
    assert.equal((await anon(`/it/b2b/quote.pdf?ref=${o.ref}`)).status, 302);
    const done = mk(app, a, day(50));
    cancelBooking(app, done.id, { by: 'customer' });
    assert.equal((await pa(`/it/b2b/quote.pdf?ref=${done.ref}`)).status, 404, 'una pratica annullata non si quota');
    void b;
  } finally {
    s.close();
  }
});

test('riquadro «Documenti per il tuo cliente» nelle schede della pratica e del pacchetto (solo per chi le ha fatte)', async () => {
  const s = await start();
  try {
    const { app, pa, pb, anon, a } = s;
    const D = day(40);
    const o = mk(app, a, D, { option: true, paymentMethod: undefined, pax: 2 });
    const page = await text(await pa(`/it/b2b/bookings/${o.ref}`));
    assert.match(page, /<h2>Documenti per il tuo cliente<\/h2>/);
    assert.match(page, new RegExp(`action="/it/b2b/quote\\.pdf" target="_blank"`));
    assert.match(page, new RegExp(`name="ref" value="${o.ref}"`));
    assert.match(page, /La tua tariffa: 56 €/);
    assert.match(page, /name="client"[^>]*value="Gruppo Rossi"/);
    assert.match(page, /name="until" value="\d{4}-\d{2}-\d{2}"/, 'la scadenza dell’opzione è la validità di partenza');
    assert.match(page, /Non hai ancora caricato il tuo logo/);
    assert.match(page, /name="markup"[^>]*value="0"/);
    await pa('/it/b2b/documents', form({ markup: '18', round: '10' }));
    await pa('/it/b2b/documents/logo', json({ logo: logoUrl() }));
    const again = await text(await pa(`/it/b2b/bookings/${o.ref}`));
    assert.ok(!again.includes('Non hai ancora caricato il tuo logo'));
    assert.match(again, /name="markup"[^>]*value="18"/);
    assert.match(again, /<option value="10" selected>/);
    // chi apre il link con il codice senza essere l'agenzia (o con un'altra agenzia) non lo vede
    const row = app.db.prepare('SELECT token FROM bookings WHERE id = ?').get(o.id);
    assert.ok(!(await text(await anon(`/it/booking/${o.ref}?t=${row.token}`))).includes('Documenti per il tuo cliente'));
    assert.ok(!(await text(await pb(`/it/booking/${o.ref}?t=${row.token}`))).includes('Documenti per il tuo cliente'));
    // una prenotazione annullata non ha preventivo
    const gone = mk(app, a, day(60));
    cancelBooking(app, gone.id, { by: 'customer' });
    assert.ok(!(await text(await pa(`/it/b2b/bookings/${gone.ref}`))).includes('Documenti per il tuo cliente'));
    // il pacchetto
    const pkg = createPackage(app, a, [resolveLine(app, { tour: SHARED, date: day(41), time: '10:00', pax: '2' }), resolveLine(app, { tour: SHARED, date: day(42), time: '15:00', pax: '2' })], { name: 'Anna Conti', email: a.email, lang: 'it', paymentMethod: 'invoice' });
    const pk = await text(await pa(`/it/b2b/packages/${pkg.group.ref}`));
    assert.match(pk, /<h2>Documenti per il tuo cliente<\/h2>/);
    assert.match(pk, new RegExp(`name="ref" value="${pkg.group.ref}"`));
    assert.match(pk, /La tua tariffa: 112 €/);
    const pkPublic = await text(await anon(`/it/packages/${pkg.group.ref}?t=${pkg.group.token}`));
    assert.ok(!pkPublic.includes('Documenti per il tuo cliente'));
  } finally {
    s.close();
  }
});

test('voucher dall’area dell’agenzia: porta il suo logo, senza prezzi', async () => {
  const s = await start();
  try {
    const { app, pa, a } = s;
    const b = mk(app, a, day(40));
    await pa('/it/b2b/documents', form({ name: 'Lagoon Travel', contact: 'info@lagoon.example', markup: '0', round: '5', logoOnVoucher: '1' }));
    await pa('/it/b2b/documents/logo', json({ logo: logoUrl() }));
    const res = await pa(`/it/b2b/bookings/${b.ref}/voucher.pdf`);
    assert.equal(res.status, 200);
    const pdf = Buffer.from(await res.arrayBuffer());
    assert.ok(pdf.toString('latin1').includes('/Subtype /Image'));
    if (HAS_PDFTOTEXT) {
      const t = pdfText(pdf);
      assert.match(t, /Lagoon Travel/);
      assert.ok(!/€/.test(t));
    }
  } finally {
    s.close();
  }
});
