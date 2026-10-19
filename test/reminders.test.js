// Promemoria la sera prima del tour: quando parte, a chi, in che lingua, e cosa non invia.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { cancelBooking, confirmPaid, createBooking } from '../server/bookings.js';
import { openDb } from '../server/db.js';
import { reminderDueAt } from '../server/reminders.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-reminders-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DAY = '2027-01-12'; // martedì, 8 giorni dopo NOW (lunedì 4 gennaio 2027, 10:00)
const EVE = (h, m = 0) => localToInstant('2027-01-11', `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
const withMeeting = (app) => {
  const t = app.content.tour('shared');
  t.i18n.it = { ...t.i18n.it, meetingPoint: 'Piazza San Marco, davanti alla Basilica', meetingUrl: 'https://maps.example/qui', notes: 'Scarpe comode.' };
  t.i18n.en = { ...t.i18n.en, meetingPoint: 'St Mark’s Square, in front of the Basilica', notes: 'Wear comfortable shoes.' };
};
const book = (app, over = {}, at = NOW) => {
  const b = createBooking(app, base({ date: DAY, time: '09:30', paymentMethod: 'onsite', ...over }), at);
  return confirmPaid(app, b.id, null, at).booking;
};
const status = (app, id) => app.db.prepare('SELECT reminder_status AS s, reminder_sent_at AS at FROM bookings WHERE id = ?').get(id);

test('promemoria: parte la sera prima alle 18:00, una sola volta, nella lingua del cliente', async () => {
  const app = makeApp({ site: { phone: '+39 333 123 4567', whatsapp: '393331234567', email: 'info@example.com' } });
  try {
    withMeeting(app);
    const it = book(app, { name: 'Maria Rossi', email: 'maria@example.com', lang: 'it' });
    assert.equal(reminderDueAt(app.cfg, it), EVE(18));
    assert.equal(await app.reminders.sweep(EVE(17, 59)), 0, 'prima delle 18:00 non parte');
    assert.equal(app.reminders.due(EVE(17, 59)).length, 0);
    app.mail.sent.length = 0;
    assert.equal(await app.reminders.sweep(EVE(18)), 1);
    assert.equal(app.mail.sent.length, 1);
    const m = app.mail.sent[0];
    assert.equal(m.to, 'maria@example.com');
    assert.equal(m.subject, 'Domani: Tour di prova a Venezia');
    for (const part of ['Ciao Maria Rossi,', 'domani ci vediamo', 'martedì 12 gennaio 2027', '09:30–12:00', 'Partecipanti: 2', 'Piazza San Marco, davanti alla Basilica', 'https://maps.example/qui', 'Scarpe comode.', '+39 333 123 4567', 'https://wa.me/393331234567', 'info@example.com', `/it/booking/${it.ref}?t=${it.token}`, 'A domani!']) assert.ok(m.text.includes(part), `testo: ${part}\n${m.text}`);
    for (const part of ['Tour di prova', 'Piazza San Marco', 'Apri la mappa', 'wa.me/393331234567']) assert.ok(m.html.includes(part), `html: ${part}`);
    assert.equal(status(app, it.id).s, 'sent');
    // una sola volta, anche rilanciando il lavoro periodico
    assert.equal(await app.reminders.sweep(EVE(18, 5)), 0);
    await app.runJobs(EVE(19));
    assert.equal(app.mail.sent.length, 1);

    // inglese e spagnolo
    const en = book(app, { name: 'Anne Smith', email: 'anne@example.com', lang: 'en', time: '14:30' });
    const es = book(app, { name: 'Íñigo Muñoz', email: 'inigo@example.com', lang: 'es', time: '14:30', pax: 3 });
    app.mail.sent.length = 0;
    assert.equal(await app.reminders.sweep(EVE(18, 10)), 2);
    const byTo = Object.fromEntries(app.mail.sent.map((x) => [x.to, x]));
    assert.equal(byTo['anne@example.com'].subject, 'Tomorrow: Test tour in Venice');
    assert.match(byTo['anne@example.com'].text, /Hi Anne Smith,[^]*just a reminder[^]*Tuesday, 12 January 2027[^]*Wear comfortable shoes\.[^]*See you tomorrow!/);
    assert.equal(byTo['inigo@example.com'].subject, 'Mañana: Tour de prueba en Venecia');
    assert.match(byTo['inigo@example.com'].text, /Hola Íñigo Muñoz,[^]*te recuerdo que mañana[^]*Participantes: 3[^]*¡Hasta mañana!/);
    assert.ok(en.id && es.id);
  } finally {
    app.cleanup();
  }
});

test('promemoria: non serve per prenotazioni a ridosso, annullate, o se è spento (alle agenzie arriva come ai privati)', async () => {
  const app = makeApp({ policy: { allowPayOnSite: true, b2cMinNoticeHours: 2 } }); // con un preavviso breve si può prenotare anche il giorno prima
  try {
    withMeeting(app);
    // fatta il giorno prima (meno di 24 ore all'inizio): la conferma è appena arrivata → nessun promemoria
    const late = book(app, { name: 'Last Minute', email: 'late@example.com' }, localToInstant('2027-01-11', '12:00'));
    // partner (B2B): il promemoria arriva anche a loro, con il collegamento alla loro area
    const acct = addAccount(app.db);
    const b2b = book(app, { tourSlug: 'private', channel: 'b2b', account: acct, paymentMethod: 'invoice', email: 'dmc@example.com', time: '14:30' });
    // annullata
    const gone = book(app, { name: 'Annullata', email: 'gone@example.com' });
    cancelBooking(app, gone.id, { by: 'customer', refund: 'full' }, NOW);
    // una normale, per confronto
    const ok = book(app, { name: 'Normale', email: 'ok@example.com' });
    app.mail.sent.length = 0;
    assert.equal(await app.reminders.sweep(EVE(18)), 2);
    assert.deepEqual(app.mail.sent.map((m) => m.to).sort(), ['dmc@example.com', 'ok@example.com']);
    assert.match(app.mail.sent.find((m) => m.to === 'dmc@example.com').text, /\/it\/b2b\/bookings\/VE-/, 'collegamento all’area agenzie');
    assert.equal(status(app, late.id).s, 'skipped', 'segnata come non necessaria');
    assert.equal(status(app, b2b.id).s, 'sent');
    assert.equal(status(app, gone.id).s, null);
    assert.equal(status(app, ok.id).s, 'sent');

    // spento dalle impostazioni: nulla parte
    const off = makeApp({ reminders: { enabled: false } });
    try {
      withMeeting(off);
      book(off, { email: 'off@example.com' });
      off.mail.sent.length = 0;
      assert.equal(await off.reminders.sweep(EVE(18)), 0);
      assert.equal(off.mail.sent.length, 0);
    } finally {
      off.cleanup();
    }
    // un'altra ora di invio
    const late20 = makeApp({ reminders: { sendHour: 20 } });
    try {
      withMeeting(late20);
      book(late20, { email: 'sera@example.com' });
      assert.equal(await late20.reminders.sweep(EVE(18)), 0);
      assert.equal(await late20.reminders.sweep(EVE(20)), 1);
    } finally {
      late20.cleanup();
    }
  } finally {
    app.cleanup();
  }
});

test('promemoria: se la posta non va riprova dopo mezz’ora; senza telefono propone di rispondere all’email', async () => {
  const app = makeApp();
  try {
    withMeeting(app);
    const b = book(app, { email: 'retry@example.com' });
    let calls = 0;
    const send = app.mail.send.bind(app.mail);
    app.mail.send = async (m) => { calls++; return calls === 1 ? false : send(m); };
    app.mail.sent.length = 0;
    assert.equal(await app.reminders.sweep(EVE(18)), 0, 'invio fallito');
    assert.equal(status(app, b.id).s, null, 'resta da inviare');
    assert.equal(await app.reminders.sweep(EVE(18, 10)), 0, 'prima dei 30 minuti non riprova');
    assert.equal(calls, 1);
    assert.equal(await app.reminders.sweep(EVE(18, 31)), 1);
    assert.equal(app.mail.sent.length, 1);
    assert.match(app.mail.sent[0].text, /rispondi a questa email/);
    assert.doesNotMatch(app.mail.sent[0].text, /wa\.me/);
  } finally {
    app.cleanup();
  }
});

test('promemoria dal pannello: stato nella prenotazione, «Invia ora», «Non inviare», impostazioni', async () => {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp, adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, policy: { allowPayOnSite: true }, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  try {
    const login = await fetch(`${url}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const get = async (p) => (await fetch(url + p, { headers: { cookie } })).text();
    const post = (p, body = {}) => fetch(url + p, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const tour = app.content.tours[0];
    const date = (await import('../server/time.js')).addDays((await import('../server/time.js')).nowRome().date, 6);
    const mk = (extra) => {
      const b = createBooking(app, { tourSlug: tour.slug, date, time: tour.flexible ? '10:00' : tour.times[0], pax: 2, channel: 'b2c', name: 'Cliente Prova', email: 'cliente@example.com', lang: 'it', paymentMethod: 'onsite', ...extra });
      return confirmPaid(app, b.id).booking;
    };
    const a = mk({ email: 'a@example.com' });
    const page = await get(`/admin/bookings/${a.id}`);
    assert.match(page, /Promemoria al cliente/);
    assert.match(page, /parte la sera prima, alle 18:00/);
    app.mail.sent.length = 0;
    const res = await post(`/admin/bookings/${a.id}/reminder`, { action: 'send' });
    assert.equal(res.headers.get('location'), `/admin/bookings/${a.id}?ok=reminder`);
    assert.equal(app.mail.sent.filter((m) => m.to === 'a@example.com').length, 1, 'inviato subito');
    assert.match(await get(`/admin/bookings/${a.id}`), /inviato il/);
    await post(`/admin/bookings/${a.id}/reminder`, { action: 'send' });
    assert.equal(app.mail.sent.filter((m) => m.to === 'a@example.com').length, 1, 'non si invia due volte');
    // «Non inviare»
    const bk = mk({ email: 'b@example.com', time: tour.flexible ? '12:00' : tour.times.at(-1) });
    await post(`/admin/bookings/${bk.id}/reminder`, { action: 'skip' });
    assert.match(await get(`/admin/bookings/${bk.id}`), /non verrà inviato/);
    // impostazioni: si spegne e si cambia l'ora
    const rules = { 'policy.b2cFreeCancelHours': '48', 'policy.b2bFreeCancelHours': '72', 'policy.b2cMinNoticeHours': '24', 'policy.b2bMinNoticeHours': '12', 'policy.maxAdvanceDays': '365', 'policy.bufferMin': '30', 'policy.slotStepMin': '30', 'policy.holdMinutes': '35', 'reminders.sendHour': '20', 'reminders.briefing.enabled': '1', 'reminders.briefing.hour': '18', 'policy.allowPayOnSite': '1' };
    assert.equal((await post('/admin/settings/rules', rules)).headers.get('location'), '/admin/settings?ok=saved&s=rules#rules');
    assert.deepEqual([cfg.reminders.enabled, cfg.reminders.sendHour], [false, 20], 'casella non spuntata = spento');
    const c = mk({ email: 'c@example.com', time: tour.flexible ? '14:00' : tour.times[0], pax: 1 });
    assert.match(await get(`/admin/bookings/${c.id}`), /disattivato/);
    assert.equal((await post('/admin/settings/rules', { ...rules, 'reminders.enabled': '1', 'reminders.sendHour': '25' })).status, 400, 'ora non valida');
  } finally {
    app.close();
    http.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});

test('promemoria alle agenzie: tra poco la cancellazione gratuita finisce (una sola volta, solo se la prenotazione esisteva già)', async () => {
  const app = makeApp({ policy: { b2bFreeCancelHours: 72, allowPayOnSite: true } });
  try {
    const acct = addAccount(app.db);
    const mk = (over = {}, at = NOW) => confirmPaid(app, createBooking(app, base({ date: DAY, time: '09:30', tourSlug: 'shared', channel: 'b2b', account: acct, paymentMethod: 'invoice', ...over }), at).id, null, at).booking;
    const b = mk();
    const until = Date.parse(b.free_cancel_until);
    assert.equal(until, localToInstant(DAY, '09:30') - 72 * 3600_000);
    const remindAt = until - 24 * 3600_000;
    app.mail.sent.length = 0;
    assert.equal(await app.reminders.sweepPenalty(remindAt - 60_000), 0, 'troppo presto');
    assert.equal(await app.reminders.sweepPenalty(remindAt + 60_000), 1);
    const m = app.mail.sent.find((x) => /non è più cancellabile gratuitamente/.test(x.subject));
    assert.equal(m.to, b.email, 'all’email della prenotazione dell’agenzia');
    assert.match(m.text, /Cancellazione gratuita fino a: /);
    assert.match(m.text, /\/it\/b2b\/bookings\//);
    assert.equal(await app.reminders.sweepPenalty(remindAt + 3600_000), 0, 'una volta sola');
    // prenotata dopo l'ora del promemoria: la conferma dice già le condizioni → niente
    const lateMade = mk({ time: '14:30' }, remindAt + 2 * 3600_000 > NOW ? NOW : NOW);
    app.db.prepare('UPDATE bookings SET created_at = ? WHERE id = ?').run(new Date(Date.parse(lateMade.free_cancel_until) - 3600_000).toISOString(), lateMade.id);
    assert.equal(await app.reminders.sweepPenalty(Date.parse(lateMade.free_cancel_until) - 1800_000), 0);
    // i privati non lo ricevono; annullate nemmeno; spento nemmeno
    const priv = book(app, { name: 'Privato', email: 'p@example.com', date: '2027-01-14' });
    const gone = mk({ date: '2027-01-13' });
    cancelBooking(app, gone.id, { by: 'customer', refund: 'full' }, NOW);
    app.mail.sent.length = 0;
    assert.equal(await app.reminders.sweepPenalty(Date.parse(gone.free_cancel_until) - 3600_000), 0);
    assert.ok(priv && !app.mail.sent.some((x) => /cancellabile/.test(x.subject)));
    const off = makeApp({ reminders: { enabled: false }, policy: { b2bFreeCancelHours: 72 } });
    try {
      const a2 = addAccount(off.db);
      const ob = confirmPaid(off, createBooking(off, base({ date: DAY, time: '09:30', tourSlug: 'shared', channel: 'b2b', account: a2, paymentMethod: 'invoice' }), NOW).id, null, NOW).booking;
      assert.equal(await off.reminders.sweepPenalty(Date.parse(ob.free_cancel_until) - 3600_000), 0, 'spento dalle impostazioni');
    } finally {
      off.cleanup();
    }
  } finally {
    app.cleanup();
  }
});
