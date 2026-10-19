// Calendario in abbonamento dell'agenzia (.ics): chiave privata, contenuto del file, pulsante per cambiare indirizzo, dall'inizio alla fine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { accountByIcsKey, agencyFeed, ensureIcsKey, feedUrl, rotateIcsKey } from '../server/agencyFeed.js';
import { hashPassword } from '../server/auth.js';
import { cancelBooking, createBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createPackage, resolveLine } from '../server/packages.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-agency-feed-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const text = async (res) => (await res.text()).replace(/\u00a0/g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie'; // 10:00 e 15:00, 28 € a persona per le agenzie
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Gli eventi di un file .ics come oggetti {PROPRIETÀ: valore} (righe riunite, valori ancora con le protezioni \, \; \n). */
function events(ics) {
  const unfolded = ics.replace(/\r\n /g, '');
  return [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map((m) => Object.fromEntries(m[1].split('\r\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)])));
}
const bySummary = (list, re) => list.filter((e) => re.test(e.SUMMARY));

async function start({ lang = 'it' } = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, policy: { allowPayOnSite: true }, mail: { notifyTo: 'guida@example.com' } });
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
  const a = addAccount(app.db, { email: 'anna@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Anna Bianchi', lang });
  const b = addAccount(app.db, { email: 'bruno@bluesail.example', password_hash: hash, company: 'BlueSail Tours', contact_name: 'Bruno Neri', lang: 'en' });
  const pa = jar();
  assert.equal((await pa(`/${lang}/b2b/login`, form({ email: a.email, password: PW }))).status, 303);
  return { app, a, b, pa, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const mk = (app, acct, date, over = {}) => createBooking(app, { tourSlug: SHARED, date, time: '10:00', pax: 2, channel: 'b2b', account: acct, name: 'Mario Rossi', email: acct.email, phone: '+39 333 1234567', lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Rossi', ...over });

test('chiave: nasce al primo bisogno, resta la stessa, cambia solo se la si rigenera; solo le agenzie approvate la usano', async () => {
  const s = await start();
  try {
    const { app, a, b } = s;
    assert.equal(a.ics_key, null);
    const k1 = ensureIcsKey(app.db, a);
    assert.match(k1, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(ensureIcsKey(app.db, app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id)), k1); // stessa chiave, anche rileggendo l'agenzia
    assert.equal(ensureIcsKey(app.db, a), k1); // e anche con la riga vecchia in mano (ics_key ancora null): non ne crea una seconda
    const kb = ensureIcsKey(app.db, b);
    assert.notEqual(kb, k1);
    assert.equal(accountByIcsKey(app.db, k1).id, a.id);
    assert.equal(accountByIcsKey(app.db, kb).id, b.id);

    const k2 = rotateIcsKey(app.db, a.id);
    assert.notEqual(k2, k1);
    assert.equal(accountByIcsKey(app.db, k1), null, 'la chiave vecchia non vale più');
    assert.equal(accountByIcsKey(app.db, k2).id, a.id);
    assert.equal(app.db.prepare('SELECT ics_key FROM accounts WHERE id = ?').get(b.id).ics_key, kb, 'le altre agenzie non cambiano');

    for (const bad of [undefined, null, '', 'abc', 'x'.repeat(19), 'x'.repeat(65), 'x'.repeat(32), ['a'], { k: 1 }]) assert.equal(accountByIcsKey(app.db, bad), null, String(bad));
    for (const status of ['pending', 'rejected', 'suspended']) {
      app.db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, a.id);
      assert.equal(accountByIcsKey(app.db, k2), null, `agenzia ${status}`);
    }
    app.db.prepare(`UPDATE accounts SET status = 'approved' WHERE id = ?`).run(a.id);
    assert.equal(accountByIcsKey(app.db, k2).id, a.id);
    assert.throws(() => app.db.prepare('UPDATE accounts SET ics_key = ? WHERE id = ?').run(kb, a.id), /UNIQUE/, 'due agenzie non possono avere la stessa chiave');
  } finally {
    s.close();
  }
});

test('indirizzo: nella lingua dell\'agenzia, con la chiave', async () => {
  const s = await start();
  try {
    const { app, a, b } = s;
    const url = feedUrl(app, a);
    assert.equal(url, `http://localhost/it/b2b/calendar.ics?k=${a.ics_key ?? ensureIcsKey(app.db, a)}`);
    assert.match(feedUrl(app, b), /^http:\/\/localhost\/en\/b2b\/calendar\.ics\?k=[A-Za-z0-9_-]{32}$/);
    assert.match(feedUrl(app, b, 'es'), /^http:\/\/localhost\/es\/b2b\/calendar\.ics\?k=/);
  } finally {
    s.close();
  }
});

test('contenuto: prenotazione confermata, opzione con scadenza, ordine e solo le sue', async () => {
  const s = await start();
  try {
    const { app, a, b } = s;
    const done = mk(app, a, day(41), { notes: 'Passeggino; due bambini, uno piccolo' });
    const opt = mk(app, a, day(40), { option: true, paymentMethod: undefined, pax: 3, time: '15:00', clientRef: 'Famiglia Verdi' });
    mk(app, b, day(41), { time: '15:00', clientRef: 'Altro cliente' }); // un'altra agenzia
    createBooking(app, { tourSlug: 'cannaregio-ghetto', date: day(42), time: '10:00', pax: 2, channel: 'b2c', name: 'Cliente B2C', email: 'c@example.com', lang: 'it', paymentMethod: 'onsite' }); // un cliente diretto

    const ics = agencyFeed(app, a);
    assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
    assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
    assert.match(ics, /\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n/);
    assert.match(ics, /\r\nX-PUBLISHED-TTL:PT1H\r\n/);
    assert.match(ics, /\r\nX-WR-CALNAME:.*le mie prenotazioni\r\n/);
    assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'righe di al massimo 75 byte');

    const ev = events(ics);
    assert.equal(ev.length, 3, 'una prenotazione, un\'opzione e la scadenza dell\'opzione');
    const conf = ev.find((e) => e.UID === `${done.ref}@localhost`);
    assert.match(conf.SUMMARY, /^Cannaregio.* · 2 · Gruppo Rossi$/);
    assert.equal(conf.STATUS, 'CONFIRMED');
    assert.match(conf.DESCRIPTION, new RegExp(`^${done.ref}\\\\nCliente: Mario Rossi · \\+39 333 1234567\\\\nConfermata\\\\nPasseggino\\\\; due bambini\\\\, uno piccolo$`), 'ref, cliente, stato e note; ; e , protetti');
    assert.equal(conf.URL, `http://localhost/it/b2b/bookings/${done.ref}`);
    assert.ok(conf.LOCATION, 'punto d\'incontro');
    assert.equal(conf.DTSTART, stamp(Date.parse(`${day(41)}T10:00:00${offsetOf(day(41))}`)));

    const o = ev.find((e) => e.UID === `${opt.ref}@localhost`);
    assert.match(o.SUMMARY, /^OPZIONE · Cannaregio.* · 3 · Famiglia Verdi$/);
    assert.equal(o.STATUS, 'TENTATIVE');
    assert.match(o.DESCRIPTION, /Opzione: la data resta trattenuta fino al /);

    const exp = ev.find((e) => /scadenza@localhost$/.test(e.UID));
    assert.equal(exp.UID, `b${app.db.prepare('SELECT id FROM bookings WHERE ref = ?').get(opt.ref).id}-scadenza@localhost`);
    assert.match(exp.SUMMARY, /^⏰ Scade l’opzione · Cannaregio/);
    const expires = Date.parse(app.db.prepare('SELECT option_expires_at FROM bookings WHERE ref = ?').get(opt.ref).option_expires_at);
    assert.equal(exp.DTSTART, stamp(Math.floor(expires / 60000) * 60000), 'il promemoria cade alla scadenza (al minuto)');
    assert.equal(exp.DTEND, stamp(Math.floor(expires / 60000) * 60000 + 15 * 60000), 'dura un quarto d\'ora');
    assert.equal(exp.URL, `http://localhost/it/b2b/bookings/${opt.ref}`);

    assert.ok(!/Altro cliente|Cliente B2C/.test(ics), 'nessuna prenotazione di altri');
  } finally {
    s.close();
  }
});

/** Lo scarto da UTC di un giorno a Venezia a mezzogiorno (per costruire un istante sicuro, anche attorno al cambio d'ora). */
function offsetOf(date) {
  const noon = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).formatToParts(noon);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  return `+0${h - 12}:00`;
}

test('chi non c\'è: opzioni scadute, annullate e prenotazioni vecchie di oltre 30 giorni', async () => {
  const s = await start();
  try {
    const { app, a } = s;
    const keep = mk(app, a, day(41));
    const opt = mk(app, a, day(40), { option: true, paymentMethod: undefined, time: '15:00' });
    const cancelled = mk(app, a, day(39));
    cancelBooking(app, cancelled.id, { by: 'customer' });
    const recent = mk(app, a, day(43));
    const old = mk(app, a, day(44));
    app.db.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(day(-10), recent.id); // svolta 10 giorni fa: ancora in agenda
    app.db.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(day(-31), old.id); // 31 giorni fa: non più

    const uids = (ics) => events(ics).map((e) => e.UID.replace('@localhost', ''));
    const now = agencyFeed(app, a);
    assert.deepEqual(uids(now).filter((u) => !/scadenza/.test(u)).sort(), [keep.ref, opt.ref, recent.ref].sort());
    assert.ok(!uids(now).includes(cancelled.ref));
    assert.ok(!uids(now).includes(old.ref));

    // dopo la scadenza l'opzione sparisce dal calendario, con il suo promemoria
    const expires = Date.parse(app.db.prepare('SELECT option_expires_at FROM bookings WHERE id = ?').get(opt.id).option_expires_at);
    assert.equal(uids(agencyFeed(app, a, expires - 60_000)).filter((u) => /scadenza/.test(u)).length, 1);
    const later = uids(agencyFeed(app, a, expires + 60_000));
    assert.ok(!later.includes(opt.ref));
    assert.equal(later.filter((u) => /scadenza/.test(u)).length, 0);
    assert.ok(later.includes(keep.ref));
  } finally {
    s.close();
  }
});

test('ordine: per data e ora; calendario vuoto è comunque un calendario valido', async () => {
  const s = await start();
  try {
    const { app, a } = s;
    const empty = agencyFeed(app, a);
    assert.match(empty, /^BEGIN:VCALENDAR\r\n[\s\S]*\r\nEND:VCALENDAR\r\n$/);
    assert.equal(events(empty).length, 0);

    const late = mk(app, a, day(45), { time: '15:00' });
    const early = mk(app, a, day(45), { time: '10:00' });
    const first = mk(app, a, day(44));
    assert.deepEqual(events(agencyFeed(app, a)).map((e) => e.UID.replace('@localhost', '')), [first.ref, early.ref, late.ref]);
  } finally {
    s.close();
  }
});

test('un pacchetto in opzione ha un solo promemoria di scadenza, con i servizi elencati una volta ciascuno', async () => {
  const s = await start();
  try {
    const { app, a } = s;
    const pkg = createPackage(app, a, [resolveLine(app, { tour: SHARED, date: day(41), time: '10:00', pax: '2' }), resolveLine(app, { tour: SHARED, date: day(42), time: '15:00', pax: '4' })], { name: 'Anna Conti', email: a.email, lang: 'it', option: true });
    const ev = events(agencyFeed(app, a));
    const lines = ev.filter((e) => !/scadenza/.test(e.UID));
    assert.equal(lines.length, 2);
    assert.ok(lines.every((e) => e.STATUS === 'TENTATIVE' && /^OPZIONE · /.test(e.SUMMARY)));
    const exp = ev.filter((e) => /scadenza/.test(e.UID));
    assert.equal(exp.length, 1, 'una sola scadenza per tutto il pacchetto');
    assert.equal(exp[0].UID, `g${pkg.group.id}-scadenza@localhost`);
    assert.match(exp[0].SUMMARY, /^⏰ Scade l’opzione · Cannaregio[^,]*$/, 'lo stesso servizio due volte compare una volta sola');
  } finally {
    s.close();
  }
});

test('nella lingua dell\'agenzia', async () => {
  const s = await start({ lang: 'en' });
  try {
    const { app, a } = s;
    mk(app, a, day(41), { lang: 'en' });
    mk(app, a, day(40), { option: true, paymentMethod: undefined, time: '15:00', lang: 'en' });
    const ics = agencyFeed(app, a);
    assert.match(ics, /X-WR-CALNAME:.* — my bookings/);
    const ev = events(ics);
    assert.equal(bySummary(ev, /^OPTION · /).length, 1);
    assert.equal(bySummary(ev, /^⏰ Option expires · /).length, 1);
    assert.ok(ev.some((e) => /\\nConfirmed$/.test(e.DESCRIPTION) || /\\nConfirmed\\n/.test(e.DESCRIPTION)));
    assert.ok(ev.some((e) => e.URL?.startsWith('http://localhost/en/b2b/bookings/')));
    assert.ok(!/Scade l’opzione|le mie prenotazioni/.test(ics));
  } finally {
    s.close();
  }
});

test('HTTP: il file si scarica senza accesso ma solo con la chiave giusta; chiave vecchia e sbagliata danno 404', async () => {
  const s = await start();
  try {
    const { app, a, anon, pa } = s;
    mk(app, a, day(41));
    const url = new URL(feedUrl(app, a));
    const rel = `${url.pathname}${url.search}`;

    const res = await anon(rel);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/calendar; charset=utf-8/);
    assert.match(res.headers.get('cache-control'), /private/);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    const body = await res.text();
    assert.match(body, /^BEGIN:VCALENDAR\r\n/);
    assert.equal(events(body).length, 1);
    // è lo stesso file con o senza sessione, in ogni lingua del percorso
    assert.equal((await pa(rel)).status, 200);
    assert.equal((await anon(rel.replace('/it/', '/en/'))).status, 200);

    for (const bad of ['', '?k=', '?k=abc', `?k=${'x'.repeat(32)}`, `?k=${url.searchParams.get('k')}x`, `?k[]=${url.searchParams.get('k')}`, `?k=${url.searchParams.get('k')}&k=zzz`]) {
      const r = await anon(`/it/b2b/calendar.ics${bad}`);
      assert.equal(r.status, 404, bad);
      assert.doesNotMatch(await r.text(), /VCALENDAR/);
    }

    // una chiave nuova: la vecchia smette di funzionare
    const rotate = await pa('/it/b2b/calendar/rotate', { method: 'POST' });
    assert.equal(rotate.status, 303);
    assert.equal(loc(rotate), '/it/b2b/bookings?flash=feed#calendario-telefono');
    assert.equal((await anon(rel)).status, 404);
    const fresh = new URL(feedUrl(app, app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id)));
    assert.notEqual(fresh.searchParams.get('k'), url.searchParams.get('k'));
    assert.equal((await anon(`${fresh.pathname}${fresh.search}`)).status, 200);

    // un'agenzia non più approvata non ha più il calendario
    app.db.prepare(`UPDATE accounts SET status = 'suspended' WHERE id = ?`).run(a.id);
    assert.equal((await anon(`${fresh.pathname}${fresh.search}`)).status, 404);
  } finally {
    s.close();
  }
});

test('HTTP: cambiare indirizzo richiede l\'accesso e vale solo per la propria agenzia', async () => {
  const s = await start();
  try {
    const { app, a, b, anon } = s;
    const ka = ensureIcsKey(app.db, a);
    const kb = ensureIcsKey(app.db, b);
    const res = await anon('/it/b2b/calendar/rotate', { method: 'POST' });
    assert.equal(res.status, 302);
    assert.match(loc(res), /\/b2b\/login/);
    assert.equal(app.db.prepare('SELECT ics_key FROM accounts WHERE id = ?').get(a.id).ics_key, ka);
    assert.equal(app.db.prepare('SELECT ics_key FROM accounts WHERE id = ?').get(b.id).ics_key, kb);
    // da un'altra origine non si cambia nulla, nemmeno con la sessione
    const forged = await s.pa('/it/b2b/calendar/rotate', { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(forged.status, 403);
    assert.equal(app.db.prepare('SELECT ics_key FROM accounts WHERE id = ?').get(a.id).ics_key, ka);
    // il file non si scarica con il metodo sbagliato
    assert.equal((await anon('/it/b2b/calendar.ics', { method: 'POST' })).status, 404);
  } finally {
    s.close();
  }
});

test('HTTP: il riquadro «Calendario sul telefono» nella pagina delle prenotazioni', async () => {
  const s = await start();
  try {
    const { app, a, pa, anon } = s;
    assert.equal((await anon('/it/b2b/bookings')).status, 302);
    const page = await text(await pa('/it/b2b/bookings'));
    assert.match(page, /id="calendario-telefono"/);
    assert.match(page, /Calendario sul telefono/);
    const url = feedUrl(app, app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id));
    assert.ok(page.includes(url), 'mostra l\'indirizzo completo');
    assert.match(page, /<form[^>]*action="\/it\/b2b\/calendar\/rotate"[^>]*method="post"|<form[^>]*method="post"[^>]*action="\/it\/b2b\/calendar\/rotate"/);
    assert.match(page, /Google Calendar/);
    assert.doesNotMatch(page, /Nuovo indirizzo creato/);
    // dopo il cambio si torna al riquadro con l'avviso
    const after = await text(await pa('/it/b2b/bookings?flash=feed'));
    assert.match(after, /Nuovo indirizzo creato/);
    // nessuno script inline (la richiesta di conferma del pulsante sta in public/js)
    assert.doesNotMatch(page.match(/<div[^>]*id="calendario-telefono"[\s\S]*?<\/section>|<section[^>]*id="calendario-telefono"[\s\S]*?<\/section>/)?.[0] ?? '', /onclick=|onsubmit=|<script>/);
    // in inglese
    const en = await text(await pa('/en/b2b/bookings'));
    assert.match(en, /Calendar on your phone/);
    assert.ok(en.includes(`/en/b2b/calendar.ics?k=`), 'indirizzo nella lingua della pagina');
  } finally {
    s.close();
  }
});

test('HTTP: troppe richieste di seguito ricevono 429 (anche con chiavi sbagliate)', async () => {
  const s = await start();
  try {
    const { anon } = s;
    let last = 0;
    for (let i = 0; i < 160; i++) last = (await anon(`/it/b2b/calendar.ics?k=${'x'.repeat(30)}`)).status;
    assert.equal(last, 429);
  } finally {
    s.close();
  }
});
