// Modifica di una prenotazione dal pannello: persone, data, orario, ore e prezzo; regole, soldi (carta, fattura), registro, email e pagine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { AdminChangeError, evaluateAdminChange, modifyBookingAdmin } from '../server/adminChanges.js';
import { hashPassword } from '../server/auth.js';
import { cancelBooking, confirmPaid, createBooking, getBooking } from '../server/bookings.js';
import { changeHistory } from '../server/changes.js';
import { createConfig, ROOT } from '../server/config.js';
import { createContentStore } from '../server/contentStore.js';
import { createContext } from '../server/context.js';
import { openDb } from '../server/db.js';
import { createDrafts } from '../server/invoices.js';
import { localToInstant, addDays, nowRome } from '../server/time.js';
import { addAccount, addGift, base, makeApp, NOW } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-admin-edit-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MIN = 60_000;
const HOUR = 60 * MIN;
const SHARED = 'shared-agenzie'; // 09:30 e 14:30, fino a 10 persone, 28 € a persona per le agenzie
const D1 = '2027-02-20';
const D2 = '2027-02-21';

function setup(over = {}) {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' }, ...over });
  const acct = app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(addAccount(app.db, { email: 'a@dmc.example', company: 'Agenzia A', contact_name: 'Anna Bianchi', lang: 'it' }).id);
  return { app, acct };
}
const b2b = (app, acct, over = {}) => createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date: D1, time: '09:30', pax: 4, paymentMethod: 'invoice', clientRef: 'Gruppo Rossi', ...over }), NOW);
const b2c = (app, over = {}) => createBooking(app, base({ tourSlug: 'shared', date: D1, time: '09:30', pax: 2, paymentMethod: 'onsite', email: 'mario@example.com', ...over }), NOW);
const edit = (app, b, input, opts = {}, nowMs = NOW) => modifyBookingAdmin(app, b.id, input, opts, nowMs);
const code = (fn) => { try { fn(); } catch (e) { return e instanceof AdminChangeError ? e.code : `other:${e.message}`; } return null; };

test('persone: il prezzo si ricalcola dal listino, il registro ricorda chi e perché, la differenza è quella della tariffa', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const b = b2b(app, acct); // 4 persone: 112 €
  assert.equal(b.total_cents, 11200);
  const res = edit(app, b, { pax: 6 }, { note: 'si aggiungono due amici' });
  assert.equal(res.after.participants, 6);
  assert.equal(res.after.total_cents, 16800);
  assert.equal(res.after.custom_price, 0);
  assert.equal(res.deltaCents, 5600);
  assert.equal(res.refundCents, 0, 'a fattura: nulla da rimborsare');
  assert.equal(res.after.start_time, '09:30');
  assert.ok(res.after.modified_at);
  const [h] = changeHistory(app.db, b.id);
  assert.equal(h.by, 'admin');
  assert.equal(h.note, 'si aggiungono due amici');
  assert.deepEqual([h.before.pax, h.after.pax, h.before.totalCents, h.after.totalCents, h.after.custom], [4, 6, 11200, 16800, false]);
  // meno persone: scende
  assert.equal(edit(app, getBooking(app.db, b.id), { pax: 3 }).after.total_cents, 8400);
});

test('data e orario: serve posto (escluse le sue stesse persone); la guida può saltare il controllo; le scadenze di annullo ripartono dalla nuova data', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const other = app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(addAccount(app.db, { email: 'b@dmc.example', company: 'Agenzia B', contact_name: 'Bruno Neri' }).id);
  b2b(app, other, { date: D2, time: '09:30', pax: 10, clientRef: 'Pieno' }); // il 21 alle 09:30 non c'è più posto
  const b = b2b(app, acct, { pax: 4 });
  const freeBefore = b.free_cancel_until;

  assert.equal(code(() => edit(app, b, { date: D2, time: '09:30' })), 'unavailable');
  const forced = edit(app, b, { date: D2, time: '09:30', force: true });
  assert.deepEqual([forced.after.date, forced.after.start_time], [D2, '09:30']);
  assert.equal(forced.dateChanged, true);
  assert.notEqual(forced.after.free_cancel_until, freeBefore, 'le scadenze di annullo seguono la nuova data');
  // alla stessa ora dello stesso giorno ci sta (sposta nel pomeriggio)
  const pm = edit(app, getBooking(app.db, b.id), { time: '14:30' });
  assert.equal(pm.after.start_time, '14:30');
  assert.equal(pm.after.end_time, '17:00', '150 minuti dopo le 14:30');
  // più persone di quante ce ne stanno: il posto è quello degli altri più il suo gruppo
  const c = b2b(app, acct, { date: '2027-02-25', time: '09:30', pax: 4 });
  b2b(app, other, { date: '2027-02-25', time: '09:30', pax: 5, clientRef: 'Altri' });
  assert.equal(code(() => edit(app, c, { pax: 6 })), 'unavailable', '4 + 5 + 2 > 10');
  assert.equal(edit(app, c, { pax: 5 }).after.participants, 5, 'con 5 ci sta: il suo gruppo non conta due volte');
  // data passata o non valida
  assert.equal(code(() => edit(app, getBooking(app.db, c.id), { date: '2027-01-03' })), 'past');
  assert.equal(code(() => edit(app, getBooking(app.db, c.id), { date: 'x' })), 'invalid');
  assert.equal(code(() => edit(app, getBooking(app.db, c.id), { pax: 99 })), 'invalid');
  assert.equal(code(() => edit(app, getBooking(app.db, c.id), {})), 'nochange');
});

test('le scadenze di annullo: di base ripartono dalla nuova data, con «mantieni» le scadenze di prima non si allungano', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const mk = () => b2b(app, acct, { pax: 2 });
  const b = mk();
  const hours = (localToInstant(D1, '09:30') - Date.parse(b.free_cancel_until)) / HOUR; // ore prima dell'inizio
  assert.equal(hours, 72);
  const later = edit(app, b, { date: '2027-03-06', time: '09:30' });
  assert.equal((localToInstant('2027-03-06', '09:30') - Date.parse(later.after.free_cancel_until)) / HOUR, hours, 'stesse ore prima, ma della nuova data');

  const b2 = b2b(app, acct, { pax: 2, date: '2027-02-22' });
  const keep = edit(app, b2, { date: '2027-03-08', time: '09:30', keepTerms: true });
  assert.equal(keep.after.free_cancel_until, b2.free_cancel_until, 'la scadenza assoluta resta quella di prima');
});

test('prezzo concordato: si scrive, resta anche cambiando persone, e si torna al listino a richiesta', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const b = b2b(app, acct, { pax: 4 });
  const c1 = edit(app, b, { priceMode: 'custom', priceCents: 10000 }).after;
  assert.deepEqual([c1.total_cents, c1.custom_price, c1.list_cents, c1.discount_cents], [10000, 1, 11200, 1200]);
  // con il prezzo concordato cambiare le persone non lo ricalcola
  const c2 = edit(app, c1, { pax: 5 }).after;
  assert.deepEqual([c2.participants, c2.total_cents, c2.custom_price], [5, 10000, 1]);
  assert.equal(code(() => edit(app, c2, { priceMode: 'custom', priceCents: -1 })), 'price');
  assert.equal(code(() => edit(app, c2, { priceMode: 'custom', priceCents: Number.NaN })), 'price');
  // di nuovo dal listino
  const c3 = edit(app, c2, { priceMode: 'auto' }).after;
  assert.deepEqual([c3.total_cents, c3.custom_price, c3.discount_cents], [14000, 0, 0]);
  // senza cambiare nulla di rilevante il prezzo resta com'è, anche se il listino nel frattempo è diverso
  app.db.prepare('UPDATE bookings SET total_cents = 12345, list_cents = 12345 WHERE id = ?').run(b.id);
  const c4 = edit(app, getBooking(app.db, b.id), { date: '2027-02-23', time: '09:30' }).after;
  assert.equal(c4.total_cents, 12345, 'si sposta e basta: il prezzo non si tocca');
});

test('già in una fattura, annullata o con buoni regalo: non si cambia; ricevuta una nuova data il servizio iniziato non si sposta', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const inv = b2b(app, acct);
  createDrafts(app, [`booking:${inv.id}`], NOW + 10 * 86_400_000);
  assert.equal(code(() => edit(app, inv, { pax: 5 })), 'invoiced');
  assert.equal(evaluateAdminChange(app, inv, { pax: 5 }, NOW).error, 'invoiced');

  const gone = b2b(app, acct, { date: '2027-02-22' });
  cancelBooking(app, gone.id, { by: 'customer' }, NOW);
  assert.equal(code(() => edit(app, gone, { pax: 5 })), 'status');

  // buono regalo: si sposta, ma il prezzo non cambia
  const gift = addGift(app.db, { initial_cents: 3000 });
  const g = b2c(app, { date: '2027-02-24', pax: 2, giftCodes: gift.code });
  assert.ok(g.gift_cents > 0);
  assert.equal(code(() => edit(app, g, { pax: 3 })), 'gift');
  assert.equal(edit(app, g, { time: '14:30' }).after.start_time, '14:30');

  // servizio già iniziato (a LATER): persone e prezzo si correggono, data e orario no
  const later = localToInstant(D1, '12:00');
  const done = b2b(app, acct, { date: D1, time: '09:30', pax: 4, clientRef: 'Svolto' });
  assert.equal(code(() => edit(app, done, { date: D2 }, {}, later)), 'started');
  const fixed = edit(app, done, { pax: 3 }, {}, later);
  assert.equal(fixed.after.participants, 3);
  assert.equal(fixed.after.total_cents, 8400, 'corretto il numero di persone svolte: il prezzo segue');
  assert.equal(fixed.after.date, D1);
});

test('soldi: pagata con carta si rimborsa la differenza, non si può far costare di più; pagata in altro modo il prezzo non cambia', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const card = b2c(app, { paymentMethod: 'card', pax: 4 }); // 4 × 35 € = 140 €
  confirmPaid(app, card.id, 'pi_test', NOW);
  const paid = getBooking(app.db, card.id);
  assert.equal(paid.payment_status, 'paid');
  assert.equal(code(() => edit(app, paid, { pax: 5 })), 'card', 'costerebbe di più: niente da incassare da qui');
  // lo stesso prezzo ma una data diversa: nessun rimborso
  assert.equal(edit(app, paid, { time: '14:30' }).refundCents, 0);
  const less = edit(app, getBooking(app.db, card.id), { pax: 3 });
  assert.equal(less.deltaCents, -3500);
  assert.equal(less.refundCents, 3500);
  assert.equal(less.after.total_cents, 10500);
  assert.equal(less.after.payment_status, 'paid', 'resta pagata: la carta ha già pagato 140 e ne tornano 35');
  // incassata a mano: non si cambia l'importo
  const cash = b2b(app, acct, { date: '2027-02-22', pax: 2 });
  app.db.prepare(`UPDATE bookings SET payment_status = 'paid' WHERE id = ?`).run(cash.id);
  assert.equal(code(() => edit(app, getBooking(app.db, cash.id), { pax: 3 })), 'paid');
  assert.equal(edit(app, getBooking(app.db, cash.id), { time: '14:30' }).after.start_time, '14:30', 'spostarla sì');
  // sul posto, non incassata: l'importo si aggiorna
  const onsite = b2c(app, { date: '2027-02-26', pax: 2 });
  assert.equal(edit(app, onsite, { pax: 5 }).after.total_cents, 17500);
});

test('opzioni: si spostano senza allungare la scadenza; più vicina del consentito no', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const o = createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date: '2027-03-15', time: '09:30', pax: 3, option: true, clientRef: 'Opz' }), NOW);
  const expires = Date.parse(o.option_expires_at);
  const moved = edit(app, o, { date: '2027-03-20' });
  assert.equal(moved.after.status, 'option');
  assert.ok(Date.parse(moved.after.option_expires_at) <= expires, 'spostare la data non allunga l’opzione');
  assert.equal(moved.after.total_cents, 8400);
  // una data troppo vicina per le regole delle opzioni
  assert.equal(code(() => edit(app, moved.after, { date: '2027-01-06', force: true })), 'option');
});

test('un pacchetto in opzione: spostare un servizio fa scadere insieme anche gli altri', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const g = app.db.prepare('INSERT INTO booking_groups(ref, token, account_id, name, email, lang, currency, created_at) VALUES(?,?,?,?,?,?,?,?)').run('PT-TEST01', 'tok', acct.id, acct.contact_name, acct.email, 'it', 'EUR', new Date(NOW).toISOString());
  const gid = Number(g.lastInsertRowid);
  const mk = (date) => createBooking(app, base({ tourSlug: SHARED, channel: 'b2b', account: acct, email: acct.email, name: acct.contact_name, date, time: '09:30', pax: 2, option: true, groupId: gid, skipOptionLimit: true }), NOW);
  const a = mk('2027-03-15');
  const b = mk('2027-03-16');
  const moved = edit(app, a, { date: '2027-03-12' });
  const other = getBooking(app.db, b.id);
  assert.equal(other.option_expires_at, moved.after.option_expires_at);
});

test('la modifica manda l’email con i dati nuovi, il messaggio della guida e il rimborso; solo se lo si vuole', async (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const b = b2b(app, acct, { pax: 4, date: '2027-02-20' });
  const out = await app.changes.modifyAdmin(b.id, { pax: 5, time: '14:30' }, { note: 'Come d’accordo al telefono.', notify: true }, NOW);
  assert.equal(out.mailed, true);
  const mail = app.mail.sent.at(-1);
  assert.equal(mail.to, acct.email);
  assert.match(mail.subject, /Prenotazione modificata/);
  assert.match(mail.text, /Prima: 4 partecipanti · .*09:30/);
  assert.match(mail.text, /Ora: 5 partecipanti · .*14:30/);
  assert.match(mail.text, /«Come d’accordo al telefono\.»/);
  assert.match(mail.html, /Come d’accordo al telefono\./);
  assert.equal(mail.attachments.length, 2, 'calendario e voucher aggiornati');

  const before = app.mail.sent.length;
  const quiet = await app.changes.modifyAdmin(b.id, { pax: 6 }, { notify: false }, NOW);
  assert.equal(quiet.mailed, false);
  assert.equal(app.mail.sent.length, before, 'senza la spunta non parte nulla');
  assert.equal(quiet.after.participants, 6);

  // pagata con carta: l'email dice anche che la differenza torna sulla carta
  const card = createBooking(app, base({ tourSlug: 'shared', date: '2027-02-27', time: '09:30', pax: 4, paymentMethod: 'card', email: 'c@example.com', name: 'Carlo Verdi' }), NOW);
  confirmPaid(app, card.id, 'pi_card', NOW);
  const r = await app.changes.modifyAdmin(card.id, { pax: 3 }, { notify: true }, NOW);
  assert.equal(r.refunded, true);
  assert.equal(r.refundCents, 3500);
  const c = getBooking(app.db, card.id);
  assert.equal(c.refund_cents, 3500);
  assert.equal(c.refund_pending_cents, 0);
  assert.match(app.mail.sent.at(-1).text, /La differenza, 35\s€, ti viene rimborsata sul metodo di pagamento originale/);

  // se poi la prenotazione si annulla, i rimborsi si sommano (35 € della modifica + il nuovo totale)
  const svc = await app.services.cancel(card.id, { by: 'customer', refund: 'full' }, NOW);
  assert.equal(svc.refundCents, 10500);
  assert.equal(getBooking(app.db, card.id).refund_cents, 14000);
});

test('se il rimborso non parte la modifica resta, la differenza è «da rimborsare a mano» e compare in «Da fare»', async (t) => {
  const { app } = setup();
  t.after(app.cleanup);
  const card = createBooking(app, base({ tourSlug: 'shared', date: '2027-02-27', time: '09:30', pax: 4, paymentMethod: 'card', email: 'c@example.com', name: 'Carlo Verdi' }), NOW);
  confirmPaid(app, card.id, 'pi_card', NOW);
  app.payments.refund = async () => { throw new Error('Stripe non risponde'); };
  const r = await app.changes.modifyAdmin(card.id, { pax: 2 }, { notify: false }, NOW);
  assert.equal(r.refunded, false);
  const c = getBooking(app.db, card.id);
  assert.equal(c.participants, 2);
  assert.equal(c.payment_status, 'paid', 'resta pagata: un annullo di domani rimborserebbe il nuovo totale');
  assert.equal(c.refund_pending_cents, 7000);
  assert.equal(c.refund_cents, 0);
  const todo = (await import('../server/todo.js')).todoList(app, NOW);
  const item = todo.sections.flatMap((s) => s.items).find((i) => /Rimborso da fare: 70\s€/.test(i.text));
  assert.ok(item, 'in «Da fare»');
  assert.equal(item.tone, 'err');
  assert.equal(item.href, `/admin/bookings/${card.id}`);
  assert.ok(todo.count >= 1);
});

test('registro: ogni modifica lascia una riga, anche quelle fatte dall’agenzia convivono', (t) => {
  const { app, acct } = setup();
  t.after(app.cleanup);
  const b = b2b(app, acct);
  edit(app, b, { pax: 5 });
  edit(app, getBooking(app.db, b.id), { time: '14:30' }, { note: 'pomeriggio' });
  edit(app, getBooking(app.db, b.id), { priceMode: 'custom', priceCents: 12000 });
  const h = changeHistory(app.db, b.id);
  assert.deepEqual(h.map((x) => [x.by, x.note]), [['admin', null], ['admin', 'pomeriggio'], ['admin', null]]);
  assert.deepEqual(h.map((x) => [x.after.pax, x.after.time, x.after.totalCents]), [[5, '09:30', 14000], [5, '14:30', 14000], [5, '14:30', 12000]]);
  assert.equal(h[2].after.custom, true);
});

test('servizi a ore: le ore cambiano prezzo e fine; il prezzo concordato tiene le righe del preventivo e nell’email c’è il nuovo importo', async (t) => {
  const dir = path.join(ROOT, 'data', 'test-admin-edit-hourly-' + crypto.randomBytes(3).toString('hex'));
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const db = openDb(':memory:');
  const app = createContext({ cfg, db, content: createContentStore({ db, root: ROOT }) });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const acct = addAccount(db, { email: 'dmc@example.com', company: 'DMC', contact_name: 'Anna Bianchi', lang: 'it' });
  const b = createBooking(app, { tourSlug: 'guida-a-ore-agenzie', date: '2027-03-09', time: '10:00', pax: 5, hours: 4, channel: 'b2b', account: acct, name: 'Anna', email: acct.email, lang: 'it', paymentMethod: 'invoice' }, NOW);
  const more = edit(app, b, { hours: 6 });
  assert.equal(more.after.end_time, '16:00');
  assert.equal(JSON.parse(more.after.service_json).hours, 6);
  assert.ok(more.after.total_cents > b.total_cents);
  assert.equal(more.after.custom_price, 0);
  const custom = edit(app, more.after, { priceMode: 'custom', priceCents: 99900 }).after;
  assert.equal(custom.total_cents, 99900);
  assert.equal(JSON.parse(custom.service_json).hours, 6, 'le righe del preventivo (ore, notturno, festivo…) restano');
  assert.ok(custom.discount_cents > 0 || custom.list_cents <= 99900);
  // con il prezzo concordato cambiare le ore non lo ricalcola; tornare al listino sì
  const fewer = edit(app, custom, { hours: 4 }).after;
  assert.deepEqual([fewer.end_time, fewer.total_cents], ['14:00', 99900]);
  const list = edit(app, fewer, { priceMode: 'auto' }).after;
  assert.equal(list.total_cents, b.total_cents);
  assert.equal(list.custom_price, 0);
  // ore non valide
  assert.equal(code(() => edit(app, list, { hours: 3.7 })), 'invalid');
  assert.equal(code(() => edit(app, list, { hours: 1 })), 'invalid');
  // e l'email dice il nuovo importo
  const out = await app.changes.modifyAdmin(b.id, { hours: 5 }, { notify: true }, NOW);
  assert.equal(out.mailed, true);
  assert.match(app.mail.sent.at(-1).text, /Ora: 5 partecipanti · .*10:00–15:00 \(5 ore\) · 370\s€/);
});

// ───────────── pagine ─────────────
const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const day = (n) => addDays(nowRome().date, n);
const REAL = 'cannaregio-ghetto-agenzie'; // 10:00 e 15:00, 28 € a persona

test('pagine: la scheda ha il pulsante, l’anteprima mostra cosa cambia, si applica, resta il registro e si vede l’errore', async () => {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    return async (p, init = {}) => {
      const headers = { ...(init.headers ?? {}) };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(url + p, { redirect: 'manual', ...init, headers });
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
  try {
    const acct = addAccount(app.db, { email: 'anna@lagoon.example', password_hash: await hashPassword('prova-prova-1'), company: 'Lagoon DMC', contact_name: 'Anna Bianchi', lang: 'it' });
    const d = day(30);
    const bk = createBooking(app, { tourSlug: REAL, date: d, time: '10:00', pax: 4, channel: 'b2b', account: acct, name: acct.contact_name, email: acct.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Rossi' });
    const admin = jar();
    const anon = jar();
    assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
    assert.equal((await anon(`/admin/bookings/${bk.id}/edit`)).status, 302);

    const detail = await text(await admin(`/admin/bookings/${bk.id}`));
    assert.match(detail, new RegExp(`href="/admin/bookings/${bk.id}/edit"`));
    assert.doesNotMatch(detail, /Storico modifiche/);

    const page = await text(await admin(`/admin/bookings/${bk.id}/edit`));
    assert.match(page, /Modifica la prenotazione/);
    assert.match(page, /name="pax"[^>]*value="4"/);
    assert.match(page, new RegExp(`name="date"[^>]*value="${d}"`));
    assert.match(page, /name="priceMode" value="auto" checked/);

    // anteprima: nulla si scrive
    const q = new URLSearchParams({ preview: '1', pax: '6', date: d, time: '10:00', priceMode: 'auto', notify: '1' });
    const prev = await text(await admin(`/admin/bookings/${bk.id}/edit?${q}`));
    assert.match(prev, /Anteprima/);
    assert.match(prev, /4 → 6/);
    assert.match(prev, /112 € → 168 €/);
    assert.match(prev, /sarà fatturata per il nuovo importo/);
    assert.equal(getBooking(app.db, bk.id).participants, 4);

    // anteprima con errore
    const bad = await text(await admin(`/admin/bookings/${bk.id}/edit?${new URLSearchParams({ preview: '1', pax: '99' })}`));
    assert.match(bad, /Dati non validi/);

    // applica: torna alla scheda con l'esito, e l'email è partita
    const ok = await admin(`/admin/bookings/${bk.id}/edit`, form({ pax: '6', date: d, time: '10:00', priceMode: 'auto', notify: '1', note: 'Concordato per telefono' }));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), `/admin/bookings/${bk.id}?ok=edited&mail=sent`);
    const after = getBooking(app.db, bk.id);
    assert.deepEqual([after.participants, after.total_cents], [6, 16800]);
    const mail = app.mail.sent.at(-1);
    assert.equal(mail.to, acct.email);
    assert.match(mail.text, /Concordato per telefono/);
    const detail2 = await text(await admin(`/admin/bookings/${bk.id}?ok=edited&mail=sent`));
    assert.match(detail2, /Prenotazione modificata\. Ho avvisato il cliente\./);
    assert.match(detail2, /Storico modifiche/);
    assert.match(detail2, /dalla guida: persone 4 → 6; prezzo 112 € → 168 €/);
    assert.match(detail2, /Concordato per telefono/);

    // prezzo concordato dal modulo
    const custom = await admin(`/admin/bookings/${bk.id}/edit`, form({ pax: '6', date: d, time: '10:00', priceMode: 'custom', price: '150,50' }));
    assert.equal(loc(custom), `/admin/bookings/${bk.id}?ok=edited`, 'senza la spunta: nessuna email');
    assert.equal(getBooking(app.db, bk.id).total_cents, 15050);
    assert.equal(getBooking(app.db, bk.id).custom_price, 1);
    assert.match(await text(await admin(`/admin/bookings/${bk.id}/edit`)), /name="priceMode" value="custom" checked/);

    // errore: prezzo non valido → si resta nel modulo con il messaggio e i valori scritti
    const err = await admin(`/admin/bookings/${bk.id}/edit`, form({ pax: '7', date: d, time: '10:00', priceMode: 'custom', price: 'abc' }));
    assert.equal(err.status, 400);
    const errPage = await text(err);
    assert.match(errPage, /Il prezzo non è valido/);
    assert.match(errPage, /name="pax"[^>]*value="7"/);
    assert.equal(getBooking(app.db, bk.id).participants, 6, 'nulla è cambiato');

    // una prenotazione annullata non si modifica
    cancelBooking(app, bk.id, { by: 'admin' });
    const gone = await admin(`/admin/bookings/${bk.id}/edit`, form({ pax: '3', date: d, time: '10:00' }));
    assert.equal(gone.status, 400);
    assert.match(await text(gone), /non si può più modificare/);
    assert.doesNotMatch(await text(await admin(`/admin/bookings/${bk.id}`)), /href="\/admin\/bookings\/\d+\/edit"/, 'niente pulsante');
    assert.equal((await admin('/admin/bookings/9999/edit')).status, 404);

    // rimborso da fare a mano: il pulsante della scheda lo chiude
    app.db.prepare('UPDATE bookings SET refund_pending_cents = 3500 WHERE id = ?').run(bk.id);
    assert.match(await text(await admin(`/admin/bookings/${bk.id}`)), /Rimborso da fare: 35 €/);
    assert.equal(loc(await admin(`/admin/bookings/${bk.id}/refund-done`, form({}))), `/admin/bookings/${bk.id}?ok=refunded`);
    const done = getBooking(app.db, bk.id);
    assert.deepEqual([done.refund_pending_cents, done.refund_cents], [0, 3500]);
  } finally {
    app.close();
    http.close();
    fs.rmSync(cfg.dataDir, { recursive: true, force: true });
  }
});
