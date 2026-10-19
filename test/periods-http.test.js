// Sito › Periodi nel pannello e, per le agenzie, ciò che cambia nelle loro pagine (checkout, condizioni) nelle quattro lingue.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-periods-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PW = 'prova-prova-1';
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const nb = (s) => s.replace(/ /g, ' ');
const text = async (res) => nb(await res.text());
const day = (n) => addDays(nowRome().date, n);
const FIELDS = { name: 'Carnevale', from: day(30), to: day(50), mode: 'short', maxDays: '3', releaseHours: '', noticeB2c: '', noticeB2b: '' };

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
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: await hashPassword(PW), company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234' });
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  return { app, admin, partner, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('pannello: elenco, nuovo periodo, errori, modifica ed eliminazione', async () => {
  const s = await start();
  try {
    const { app, admin, anon } = s;
    assert.equal(loc(await anon('/admin/periods')), '/admin/login');
    assert.equal(loc(await anon('/admin/periods', form(FIELDS))), '/admin/login');
    let page = await text(await admin('/admin/periods'));
    assert.match(page, /<h1>Periodi<\/h1>/);
    assert.match(page, /href="\/admin\/periods" aria-current="page">Periodi/, 'è nel menu Sito');
    assert.match(page, /Nessun periodo: oggi ovunque valgono le regole del sito/);
    assert.match(page, /Le regole di base del sito/);
    assert.match(page, /fra almeno 60 giorni: opzione di 14 giorni/);
    assert.match(page, /scadono sempre almeno 48 ore prima del servizio/);
    assert.match(page, /Preavviso minimo<\/strong>: privati 24 ore, agenzie 12 ore/);
    assert.match(page, /<input type="date" name="from"/);
    assert.match(page, /name="mode" value="normal" checked/, 'di base «come sempre»');
    assert.match(page, /placeholder="24"/, 'il preavviso del sito come suggerimento');

    // nuovo
    const created = await admin('/admin/periods', form(FIELDS));
    assert.equal(created.status, 303);
    assert.equal(loc(created), '/admin/periods?ok=created');
    page = await text(await admin('/admin/periods?ok=created'));
    assert.match(page, /Periodo aggiunto: le sue regole valgono da subito/);
    assert.match(page, /<strong>Carnevale<\/strong>/);
    assert.match(page, /opzioni più brevi: al massimo 3 giorni/);
    assert.match(page, /21 giorni/);
    assert.equal(app.periods.list().length, 1);
    assert.equal(app.cfg.options.periods[0].optionMaxDays, 3, 'valgono subito per le regole');

    // errori: il modulo torna con ciò che si era scritto
    const bad = await admin('/admin/periods', form({ ...FIELDS, name: '', from: day(60), to: day(55), mode: 'short', maxDays: '' }));
    assert.equal(bad.status, 400);
    page = await text(bad);
    assert.match(page, /Scrivi un nome/);
    assert.match(page, /L’ultimo giorno non può venire prima del primo/);
    assert.match(page, /indica la durata massima/);
    assert.match(page, new RegExp(`name="from" required value="${day(60)}"`), 'le date scritte restano');
    assert.equal(app.periods.list().length, 1);
    const clash = await admin('/admin/periods', form({ ...FIELDS, name: 'Altro', from: day(40), to: day(70), mode: 'off' }));
    assert.equal(clash.status, 400);
    assert.match(await text(clash), /si sovrappongono a «Carnevale»/);
    const nothing = await admin('/admin/periods', form({ name: 'Niente', from: day(100), to: day(110), mode: 'normal' }));
    assert.match(await text(nothing), /non cambia nessuna regola/);

    // modifica
    const id = app.periods.list()[0].id;
    page = await text(await admin(`/admin/periods/${id}`));
    assert.match(page, /<h2>Carnevale/);
    assert.match(page, /name="mode" value="short" checked/);
    assert.match(page, /name="maxDays" inputmode="numeric" value="3"/);
    assert.match(page, new RegExp(`action="/admin/periods/${id}/delete" data-confirm="Eliminare il periodo «Carnevale»`));
    const saved = await admin(`/admin/periods/${id}`, form({ ...FIELDS, name: 'Carnevale grande', mode: 'off', maxDays: '', noticeB2c: '48' }));
    assert.equal(loc(saved), `/admin/periods/${id}?ok=saved`);
    page = await text(await admin(`/admin/periods/${id}?ok=saved`));
    assert.match(page, /Periodo salvato/);
    assert.deepEqual([app.periods.list()[0].name, app.periods.list()[0].optionsMode, app.periods.list()[0].noticeB2cHours], ['Carnevale grande', 'off', 48]);
    const rejected = await admin(`/admin/periods/${id}`, form({ ...FIELDS, name: 'Carnevale grande', from: day(50), to: day(30) }));
    assert.equal(rejected.status, 400);
    assert.equal(app.periods.list()[0].from, day(30), 'un salvataggio rifiutato non cambia nulla');
    assert.equal((await admin('/admin/periods/9999')).status, 404);
    assert.equal((await admin('/admin/periods/abc')).status, 404);

    // eliminazione
    assert.equal((await admin('/admin/periods/9999/delete', form())).status, 404);
    const gone = await admin(`/admin/periods/${id}/delete`, form());
    assert.equal(loc(gone), '/admin/periods?ok=deleted');
    assert.match(await text(await admin('/admin/periods?ok=deleted')), /Periodo eliminato/);
    assert.deepEqual(app.periods.list(), []);
    // un periodo passato va nell'elenco dei passati
    app.periods.save({ name: 'Vecchio', from: day(-40), to: day(-30), mode: 'off' });
    page = await text(await admin('/admin/periods'));
    assert.match(page, /Periodi passati \(1\)/);
    // un sito esterno non può cambiare nulla
    for (const p of ['/admin/periods', `/admin/periods/${app.periods.list()[0].id}`, `/admin/periods/${app.periods.list()[0].id}/delete`]) {
      assert.equal((await admin(p, { ...form(FIELDS), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } })).status, 403, p);
    }
    assert.equal(app.periods.list().length, 1);
  } finally {
    s.close();
  }
});

test('agenzie: nel checkout la data dentro un periodo mostra l’opzione più breve (con il motivo) o l’assenza di opzioni; fuori tutto come prima', async () => {
  const s = await start();
  try {
    const { app, partner } = s;
    app.periods.save({ name: 'Carnevale', from: day(30), to: day(50), mode: 'short', maxDays: '3' });
    app.periods.save({ name: 'Natale', from: day(60), to: day(70), mode: 'off' });
    const url = (lang, date) => `/${lang}/book/checkout?tour=cannaregio-ghetto-agenzie&date=${date}&time=10:00&pax=4`;
    // fuori dai periodi: come sempre (a 25 giorni dal tour l'opzione dura 5 giorni)
    let page = await text(await partner(url('it', day(25))));
    assert.match(page, /id="option-submit"/);
    assert.match(page, /5 giorni/);
    assert.doesNotMatch(page, /le opzioni sono più brevi del solito/);
    // dentro il periodo con opzioni brevi: 3 giorni, e il motivo
    page = await text(await partner(url('it', day(40))));
    assert.match(page, /id="option-submit"/);
    assert.match(page, /3 giorni/);
    assert.match(page, /In questo periodo le opzioni sono più brevi del solito\./);
    for (const [lang, note] of [['en', 'In this period, options are shorter than usual.'], ['es', 'En este periodo las opciones son más cortas de lo habitual.'], ['ja', 'この期間は、仮押さえの期間が通常より短くなります。']]) {
      assert.ok((await text(await partner(url(lang, day(40))))).includes(note), lang);
    }
    // periodo senza opzioni: niente pulsante «Opziona», una riga che spiega, e anche un modulo costruito a mano non ottiene nulla
    page = await text(await partner(url('it', day(65))));
    assert.doesNotMatch(page, /id="option-submit"/);
    assert.match(page, /In questo periodo le date non si possono opzionare: prenota direttamente\./);
    assert.ok((await text(await partner(url('en', day(65))))).includes('Dates in this period can’t be held on option: please book directly.'));
    const forged = await partner('/it/book/checkout', form({ tour: 'cannaregio-ghetto-agenzie', date: day(65), time: '10:00', pax: '4', name: 'Giulia Bianchi', email: 'giulia@lagoon.example', lang: 'it', clientRef: 'Prova', consent: '1', action: 'option' }));
    assert.equal(forged.status, 400);
    assert.match(await text(forged), /In questo periodo le date non si possono opzionare/);
    assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'option'`).get().n, 0);
    // nel periodo con opzioni brevi l'opzione si prende davvero, e scade nei 3 giorni
    const ok = await partner('/it/book/checkout', form({ tour: 'cannaregio-ghetto-agenzie', date: day(40), time: '10:00', pax: '4', name: 'Giulia Bianchi', email: 'giulia@lagoon.example', lang: 'it', clientRef: 'Prova', consent: '1', action: 'option' }));
    assert.equal(ok.status, 303);
    const b = app.db.prepare(`SELECT * FROM bookings WHERE status = 'option'`).get();
    const left = (Date.parse(b.option_expires_at) - Date.now()) / 86_400_000;
    assert.ok(left > 2.9 && left <= 3.01, `scade fra 3 giorni (${left})`);
  } finally {
    s.close();
  }
});

test('agenzie: le loro condizioni elencano i periodi con le date e le regole, nella loro lingua; i privati non vedono nulla', async () => {
  const s = await start();
  try {
    const { app, partner, anon } = s;
    const rates = async (lang) => text(await partner(`/${lang}/b2b/rates`));
    assert.doesNotMatch(await rates('it'), /Periodi con regole particolari/, 'senza periodi la riga non c’è');
    app.periods.save({ name: 'Carnevale', from: day(30), to: day(50), mode: 'short', maxDays: '3', releaseHours: '96', noticeB2b: '48', noticeB2c: '72' });
    app.periods.save({ name: 'Natale', from: day(60), to: day(70), mode: 'off' });
    app.periods.save({ name: 'Solo privati', from: day(80), to: day(90), mode: 'normal', noticeB2c: '72' }); // non cambia nulla per le agenzie
    app.periods.save({ name: 'Passato', from: day(-20), to: day(-10), mode: 'off' });
    const it = await rates('it');
    assert.match(it, /Periodi con regole particolari/);
    assert.match(it, /«Carnevale», [^<]+ – [^<]+: opzioni più brevi: al massimo 3 giorni, scadenza almeno 4 giorni prima del servizio; preavviso minimo 2 giorni/);
    assert.match(it, /«Natale», [^<]+: niente opzioni, si prenota direttamente/);
    assert.doesNotMatch(it, /Solo privati/);
    assert.doesNotMatch(it, /Passato/, 'i periodi finiti non si mostrano');
    const en = await rates('en');
    assert.match(en, /Periods with special rules/);
    assert.match(en, /“Carnevale”, [^<]+: shorter options: 3 days at most, expires at least 4 days before the service; minimum notice 2 days/);
    assert.match(en, /“Natale”, [^<]+: no options, you book directly/);
    assert.match(await rates('es'), /Periodos con reglas especiales/);
    const es = await rates('es');
    assert.match(es, /«Natale», [^<]+: sin opciones, se reserva directamente/);
    const ja = await rates('ja');
    assert.match(ja, /特別ルールの期間/);
    assert.match(ja, /「Natale」[^<]+：オプション不可（直接のご予約のみ）/);
    // se le opzioni sono spente per l'agenzia, i periodi di preavviso si vedono lo stesso
    app.db.prepare('UPDATE accounts SET options_enabled = 0').run();
    assert.match(await rates('it'), /Periodi con regole particolari/);
    // senza accesso non si vede la pagina
    assert.notEqual((await anon('/it/b2b/rates')).status, 200);
  } finally {
    s.close();
  }
});
