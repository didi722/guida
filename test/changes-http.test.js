// Modifica autonoma di una prenotazione e richiesta di proroga: le pagine e i moduli, dall'inizio alla fine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createBooking, getBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createPackage, resolveLine } from '../server/packages.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-changes-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie';

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
  const hash = await hashPassword(PW);
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234' });
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  const login = async (acct) => { const j = jar(); assert.equal((await j('/it/b2b/login', form({ email: acct.email, password: PW }))).status, 303); return j; };
  return { app, admin, partner, anon: jar(), agency, hash, login, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

const book = (s, over = {}) => createBooking(s.app, { tourSlug: SHARED, date: day(40), time: '10:00', pax: 4, channel: 'b2b', account: s.agency, name: 'Giulia Bianchi', email: s.agency.email, lang: 'it', clientRef: 'Gruppo Rossi', ...over });

test('cambia persone, data o ore: pagina, elenco degli orari con il prezzo, conferma, email e motivi quando non si può', async () => {
  const s = await start();
  try {
    const { partner, anon, app, agency } = s;
    const o = book(s, { option: true });
    // la scheda dell'opzione ha il pulsante e il riquadro per la proroga
    const card = await text(await partner(`/it/b2b/bookings/${o.ref}`));
    assert.match(card, /Cambia persone, data o ore/);
    assert.match(card, new RegExp(`/it/b2b/bookings/${o.ref}/change`));
    assert.match(card, /Ti serve più tempo\?/);
    assert.match(card, /Chiedi la proroga/);

    assert.equal((await anon(`/it/b2b/bookings/${o.ref}/change`)).status, 302, 'serve l’accesso');
    const page = await text(await partner(`/it/b2b/bookings/${o.ref}/change?pax=6`));
    assert.match(page, /Finché è un’opzione puoi cambiare liberamente/);
    assert.match(page, /<fieldset class="party" id="ch-party" data-party data-autosubmit /);
    assert.match(page, /name="adults" id="ch-party-adults" min="1" max="\d+" step="1" value="6"/, 'il vecchio «pax» vale tante persone adulte');
    assert.match(page, /<option value="10:00" selected>10:00–12:30 · [\d.,]+ €[^<]*\(\+[^)]+\) · attuale<\/option>/, 'orario con prezzo, differenza ed etichetta dell’attuale');
    assert.match(page, /<option value="15:00" >15:00–17:30/);
    assert.match(page, /Conferma la modifica/);

    // un'altra agenzia non vede la pratica
    const other = addAccount(app.db, { email: 'altra@example.com', password_hash: s.hash, company: 'Altra', vat: '01234567890', sdi_code: 'ABC1234' });
    assert.equal((await (await s.login(other))(`/it/b2b/bookings/${o.ref}/change`)).status, 404);

    // si sposta alle 15:00 con 6 persone
    const ok = await partner(`/it/b2b/bookings/${o.ref}/change`, form({ pax: '6', date: day(40), time: '15:00' }));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), `/it/b2b/bookings/${o.ref}?flash=changed`);
    const after = getBooking(app.db, o.id);
    assert.deepEqual([after.participants, after.start_time, after.end_time], [6, '15:00', '17:30']);
    assert.equal(after.total_cents, (o.total_cents / 4) * 6);
    assert.match(await text(await partner(loc(ok))), /Modifica fatta: ti abbiamo mandato il riepilogo aggiornato/);
    assert.ok(app.mail.sent.some((m) => m.to === agency.email && /Opzione modificata/.test(m.subject)));
    assert.ok(app.mail.sent.some((m) => m.to === 'guida@example.com' && /Opzione modificata/.test(m.subject)));

    // errori: orario che non c'è, nessun cambiamento, troppe persone
    const bad = await partner(`/it/b2b/bookings/${o.ref}/change`, form({ pax: '6', date: day(40), time: '12:34' }));
    assert.equal(bad.status, 409);
    assert.match(await text(bad), /Quell’orario non è più libero/);
    const same = await partner(`/it/b2b/bookings/${o.ref}/change`, form({ pax: '6', date: day(40), time: '15:00' }));
    assert.equal(same.status, 400);
    assert.match(await text(same), /Non hai cambiato nulla/);
    assert.equal((await partner(`/it/b2b/bookings/${o.ref}/change`, form({ pax: '99', date: day(40), time: '15:00' }))).status, 400);

    // prenotazione pagata con carta: nessun pulsante, c'è il motivo; il modulo diretto non funziona
    const card2 = addAccount(app.db, { email: 'carta@example.com', password_hash: s.hash, company: 'Carta', vat: '01234567891', sdi_code: 'ABC1234', allow_invoice: 0 });
    const paid = createBooking(app, { tourSlug: SHARED, date: day(42), time: '10:00', pax: 2, channel: 'b2b', account: card2, name: 'Carla', email: card2.email, lang: 'it', paymentMethod: 'card' });
    app.db.prepare(`UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?`).run(paid.id);
    const cj = await s.login(card2);
    const locked = await text(await cj(`/it/b2b/bookings/${paid.ref}`));
    assert.match(locked, /Hai già pagato online: per cambiare persone, data o ore scrivimi/);
    assert.ok(!locked.includes(`/b2b/bookings/${paid.ref}/change`), 'niente pulsante');
    const direct = await cj(`/it/b2b/bookings/${paid.ref}/change`, form({ pax: '3', date: day(42), time: '10:00' }));
    assert.equal(direct.status, 400);
    assert.match(await text(direct), /non si può cambiare da sola/);
    assert.equal(getBooking(app.db, paid.id).participants, 2);
  } finally {
    s.close();
  }
});

test('richiesta di proroga: l’agenzia chiede dal link, la guida la vede (scheda e agenda) e la concede o la rifiuta', async () => {
  const s = await start();
  try {
    const { partner, anon, admin, app, agency } = s;
    const o = book(s, { option: true });
    const url = `/it/booking/${o.ref}/option/extend-request`;
    assert.equal((await anon(url, form({ t: 'sbagliato', days: '3' }))).status, 404, 'serve il codice segreto');
    const sent = await anon(url, form({ t: o.token, days: '3', note: 'Il cliente aspetta il budget' }));
    assert.equal(sent.status, 303);
    assert.match(loc(sent), /flash=extension-sent/);
    const page = await text(await anon(loc(sent)));
    assert.match(page, /Richiesta di proroga inviata|Proroga richiesta/);
    assert.match(page, /Hai chiesto 3 giorni in più/);
    assert.ok(!page.includes('Chiedi la proroga'), 'una richiesta alla volta');
    assert.match(loc(await anon(url, form({ t: o.token, days: '2' }))), /flash=extension-error/);

    // la guida: avviso in agenda e scheda con i pulsanti
    assert.match(await text(await admin('/admin')), /1 richiesta di proroga da decidere/);
    const detail = await text(await admin(`/admin/bookings/${o.id}`));
    assert.match(detail, /Richiesta di proroga:/);
    assert.match(detail, /Il cliente aspetta il budget/);
    const rid = app.db.prepare('SELECT id FROM extension_requests').get().id;
    const approve = await admin(`/admin/bookings/${o.id}/extension/${rid}/approve`, form({ days: '5' }));
    assert.match(loc(approve), /ok=extended/);
    const ext = getBooking(app.db, o.id);
    assert.equal(Date.parse(ext.option_expires_at), Date.parse(o.option_expires_at) + 5 * 86_400_000);
    assert.ok(app.mail.sent.some((m) => m.to === agency.email && /Opzione prorogata/.test(m.subject)));
    assert.ok(!(await text(await admin('/admin'))).includes('richiesta di proroga da decidere'));
    assert.match(loc(await admin(`/admin/bookings/${o.id}/extension/${rid}/approve`, form({ days: '5' }))), /ok=extension-failed/, 'già decisa');

    // una seconda richiesta, rifiutata
    await anon(url, form({ t: o.token, days: '1' }));
    const rid2 = app.db.prepare(`SELECT id FROM extension_requests WHERE status = 'pending'`).get().id;
    const deny = await admin(`/admin/bookings/${o.id}/extension/${rid2}/deny`, form({}));
    assert.match(loc(deny), /ok=extension-denied/);
    assert.equal(getBooking(app.db, o.id).option_expires_at, ext.option_expires_at);
    assert.ok(app.mail.sent.some((m) => m.to === agency.email && /Proroga non concessa/.test(m.subject)));
    // l'agenzia dentro la sua area vede lo stesso riquadro
    assert.match(await text(await partner(`/it/b2b/bookings/${o.ref}`)), /Chiedi la proroga/);
  } finally {
    s.close();
  }
});

test('proroga di un pacchetto: si chiede dalla pagina del pacchetto e vale per tutte le date', async () => {
  const s = await start();
  try {
    const { anon, admin, app, agency } = s;
    const pkg = createPackage(app, agency, [resolveLine(app, { tour: SHARED, date: day(40), time: '10:00', pax: '3' }), resolveLine(app, { tour: SHARED, date: day(41), time: '15:00', pax: '3' })], { name: 'Anna Conti', email: 'anna@lagoon.example', lang: 'it', option: true });
    const page = await text(await anon(`/it/packages/${pkg.group.ref}?t=${pkg.group.token}`));
    assert.match(page, /Chiedi la proroga/);
    const sent = await anon(`/it/packages/${pkg.group.ref}/extend-request`, form({ t: pkg.group.token, days: '2', note: 'In attesa del cliente' }));
    assert.match(loc(sent), /flash=extension-sent/);
    assert.match(await text(await anon(loc(sent))), /Richiesta inviata: ti rispondo appena posso/);
    assert.match(await text(await anon(loc(sent))), /Hai chiesto 2 giorni in più/);
    assert.match(loc(await anon(`/it/packages/${pkg.group.ref}/extend-request`, form({ t: pkg.group.token, days: '2' }))), /extension-error/);
    assert.equal((await anon(`/it/packages/${pkg.group.ref}/extend-request`, form({ t: 'x', days: '2' }))).status, 404);
    const rid = app.db.prepare('SELECT id FROM extension_requests').get().id;
    assert.match(loc(await admin(`/admin/bookings/${pkg.bookings[1].id}/extension/${rid}/approve`, form({ days: '3' }))), /ok=extended/);
    const exp = app.db.prepare('SELECT DISTINCT option_expires_at e FROM bookings WHERE group_id = ?').all(pkg.group.id);
    assert.equal(exp.length, 1);
    assert.equal(Date.parse(exp[0].e), Date.parse(pkg.bookings[0].option_expires_at) + 3 * 86_400_000);
  } finally {
    s.close();
  }
});
