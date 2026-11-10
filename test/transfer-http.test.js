// Bonifico alla conferma: l'agenzia sceglie «Bonifico», il posto resta trattenuto qualche giorno e la prenotazione è definitiva quando il bonifico arriva.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { confirmOption, createBooking, getBooking, paymentOptions, transferWindow } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { addDays, localToInstant, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-transfer-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
/** Il percorso (con la query) di un indirizzo, anche se assoluto. */
const rel = (u) => { const x = new URL(u, 'http://x'); return x.pathname + x.search; };
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const IBAN = 'IT60X0542811101000000123456';
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie';

async function start() {
  const cfg = createConfig({
    __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true,
    mail: { notifyTo: 'guida@example.com' }, site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { iban: IBAN, bank: 'Banca di Prova', seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
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
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const hash = await hashPassword(PW);
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234', country: 'IT', lang: 'it' });
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  return { app, admin, partner, anon: jar(), agency, hash, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const input = (s, over = {}) => ({ tourSlug: SHARED, date: day(10), time: '10:00', pax: 2, channel: 'b2b', account: s.agency, name: 'Giulia Bianchi', email: s.agency.email, lang: 'it', clientRef: 'Gruppo Rossi', paymentMethod: 'transfer', ...over });
const GROUPED = 'IT60 X054 2811 1010 0000 0123 456';

test('bonifico: si offre solo con l’IBAN, acceso per l’agenzia e con almeno un giorno di tempo', async () => {
  const s = await start();
  try {
    const { app } = s;
    const tour = app.content.tour(SHARED);
    const start1 = localToInstant(day(10), '10:00');
    const now = Date.now();
    assert.deepEqual(paymentOptions(app, tour, 'b2b', s.agency, now, start1), ['invoice', 'card', 'transfer'], 'fattura, carta e bonifico');
    assert.ok(!paymentOptions(app, tour, 'b2b', s.agency, now).includes('transfer'), 'senza la data del servizio (per esempio un pacchetto) non si offre');
    assert.ok(!paymentOptions(app, tour, 'b2b', s.agency, now, now + 20 * HOUR).includes('transfer'), 'meno di 24 ore: non c’è il tempo');
    assert.ok(paymentOptions(app, tour, 'b2b', s.agency, now, now + 25 * HOUR).includes('transfer'));
    assert.ok(!paymentOptions(app, tour, 'b2b', { ...s.agency, transfer_enabled: 0 }, now, start1).includes('transfer'), 'spento per questa agenzia');
    assert.ok(!paymentOptions(app, tour, 'b2c', null, now, start1).includes('transfer'), 'i privati non lo hanno');
    const iban = app.cfg.invoice.iban;
    app.cfg.invoice.iban = '';
    assert.ok(!paymentOptions(app, tour, 'b2b', s.agency, now, start1).includes('transfer'), 'senza IBAN non c’è dove pagare');
    app.cfg.invoice.iban = iban;

    // l'attesa: 2 giorni per tutti, quelli dell'agenzia se li ha, mai oltre 12 ore prima del servizio
    assert.equal(transferWindow(app, s.agency, start1, now).expiresMs, now + 2 * DAY);
    assert.equal(transferWindow(app, { ...s.agency, transfer_days: 5 }, start1, now).expiresMs, now + 5 * DAY);
    assert.equal(transferWindow(app, { ...s.agency, transfer_days: 5 }, now + 3 * DAY, now).expiresMs, now + 3 * DAY - 12 * HOUR, 'il servizio è fra 3 giorni: il posto si libera 12 ore prima');
  } finally {
    s.close();
  }
});

test('prenotare con bonifico: posto trattenuto, email con IBAN e causale, conferma quando la guida segna il bonifico', async () => {
  const s = await start();
  try {
    const { app, admin, partner } = s;
    const before = Date.now();
    const { booking: b, redirect } = await app.services.book(input(s), 'it');
    assert.match(redirect, /\/it\/booking\/VE-/);
    assert.deepEqual([b.status, b.payment_method, b.payment_status], ['held', 'transfer', 'unpaid']);
    const until = Date.parse(b.hold_expires_at);
    assert.ok(until >= before + 2 * DAY - 1000 && until <= Date.now() + 2 * DAY + 1000, 'due giorni di attesa');

    const mail = app.mail.sent.find((m) => m.to === s.agency.email && /bonifico/i.test(m.subject));
    assert.ok(mail, 'l’agenzia riceve le istruzioni');
    assert.ok(mail.text.includes(GROUPED) && mail.text.includes(b.ref), 'IBAN e causale (il codice della prenotazione)');
    assert.ok(!app.mail.sent.some((m) => /confermata/i.test(m.subject) && m.to === s.agency.email), 'non è ancora confermata');

    const page = await text(await partner(`/it/b2b/bookings/${b.ref}`));
    assert.match(page, /In attesa del bonifico/);
    assert.match(page, /Bonifico da fare/);
    assert.ok(page.includes(GROUPED) && page.includes(`value="${b.ref}"`), 'IBAN e causale da copiare');
    assert.match(page, /Preferisci la carta\?/);
    const adminPage = await text(await admin(`/admin/bookings/${b.id}`));
    assert.match(adminPage, /In attesa del bonifico fino al/);
    assert.match(adminPage, /Bonifico ricevuto: conferma la prenotazione/);
    assert.match(await text(await admin('/admin/todo')), new RegExp(`Bonifico atteso: .*${b.ref}`), 'tra le cose da fare');

    // il bonifico arriva: la guida lo segna
    const done = await admin(`/admin/bookings/${b.id}/transfer-received`, form({}));
    assert.equal(loc(done), `/admin/bookings/${b.id}?ok=transfer`);
    const c = getBooking(app.db, b.id);
    assert.deepEqual([c.status, c.payment_status, c.payment_method, c.hold_expires_at], ['confirmed', 'paid', 'transfer', null]);
    assert.ok(app.mail.sent.some((m) => m.to === s.agency.email && /confermata/i.test(m.subject)), 'ora parte la conferma con il voucher');
    assert.match(await text(await partner(`/it/b2b/bookings/${b.ref}`)), /Prenotazione confermata/);
    // una seconda volta non fa danni
    assert.equal(loc(await admin(`/admin/bookings/${b.id}/transfer-received`, form({}))), null, 'ormai è confermata: la pagina non esiste più per questa azione');
  } finally {
    s.close();
  }
});

test('bonifico che non arriva: il posto si libera, l’agenzia lo sa; se arriva tardi e il posto è libero si riprende', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const { booking: b } = await app.services.book(input(s), 'it');
    assert.equal(await app.services.sweep(Date.now() + DAY), 0, 'dopo un giorno aspetta ancora');
    assert.equal(getBooking(app.db, b.id).status, 'held');
    assert.equal(await app.services.sweep(Date.now() + 3 * DAY), 1);
    assert.equal(getBooking(app.db, b.id).status, 'expired');
    const mail = app.mail.sent.find((m) => m.to === s.agency.email && /scaduta: bonifico non ricevuto/.test(m.subject));
    assert.ok(mail, 'avviso all’agenzia');
    assert.equal(app.mail.sent.filter((m) => /scaduta: bonifico non ricevuto/.test(m.subject)).length, 1);
    await app.services.sweep(Date.now() + 4 * DAY);
    assert.equal(app.mail.sent.filter((m) => /scaduta: bonifico non ricevuto/.test(m.subject)).length, 1, 'una volta sola');

    // il bonifico arriva lo stesso: il posto è ancora libero e la prenotazione riprende
    assert.match(await text(await admin(`/admin/bookings/${b.id}`)), /Bonifico ricevuto: conferma la prenotazione/);
    assert.equal(loc(await admin(`/admin/bookings/${b.id}/transfer-received`, form({}))), `/admin/bookings/${b.id}?ok=transfer`);
    assert.equal(getBooking(app.db, b.id).status, 'confirmed');
  } finally {
    s.close();
  }
});

test('opzione confermata con bonifico: il posto resta suo, e se il bonifico non arriva torna opzione', async () => {
  const s = await start();
  try {
    const { app } = s;
    const o = createBooking(app, input(s, { option: true, date: day(30), paymentMethod: undefined }));
    assert.equal(o.status, 'option');
    const res = await app.services.confirmOption(o.id, 'it', { method: 'transfer' });
    assert.equal(res.outcome, 'transfer');
    const held = getBooking(app.db, o.id);
    assert.deepEqual([held.status, held.payment_method], ['held', 'transfer']);
    assert.ok(Math.abs(Date.parse(held.hold_expires_at) - (Date.now() + 2 * DAY)) < 5000);
    assert.ok(app.mail.sent.some((m) => m.to === s.agency.email && /bonifico/i.test(m.subject)));
    // il secondo clic su «Conferma» non rifà nulla
    assert.equal(loc(await s.partner(`/it/booking/${o.ref}/option/confirm`, form({ t: o.token, method: 'transfer' }))), `/it/booking/${o.ref}?t=${o.token}&flash=option-transfer`);

    await app.services.sweep(Date.now() + 3 * DAY);
    const back = getBooking(app.db, o.id);
    assert.equal(back.status, 'option', 'l’opzione è ancora valida: la data resta trattenuta');
    assert.ok(!app.mail.sent.some((m) => /scaduta: bonifico non ricevuto/.test(m.subject)), 'il posto non è stato liberato: nessun avviso di scadenza');

    // un pacchetto non usa il bonifico: confermare un'opzione di pacchetto passa solo da fattura o carta
    const inPkg = getBooking(app.db, createBooking(app, input(s, { option: true, date: day(31), paymentMethod: undefined })).id);
    app.db.exec('PRAGMA foreign_keys = OFF');
    app.db.prepare('UPDATE bookings SET group_id = 99 WHERE id = ?').run(inPkg.id);
    app.db.exec('PRAGMA foreign_keys = ON');
    const asPackage = confirmOption(app, inPkg.id, { method: 'transfer' });
    assert.notEqual(asPackage.outcome, 'transfer');
  } finally {
    s.close();
  }
});

test('bonifico: l’agenzia può rinunciare e liberare il posto; pagato e poi annullato, il bonifico si restituisce a mano', async () => {
  const s = await start();
  try {
    const { app, admin, partner } = s;
    // rinuncia mentre aspetta
    const { booking: a } = await app.services.book(input(s), 'it');
    const gone = await partner(`/it/booking/${a.ref}/cancel`, form({ t: a.token }));
    assert.equal(gone.status, 303);
    const cancelled = getBooking(app.db, a.id);
    assert.deepEqual([cancelled.status, cancelled.retained_cents], ['cancelled', 0]);

    // pagato con bonifico e annullato dalla guida: il rimborso non è automatico
    const { booking: b } = await app.services.book(input(s, { date: day(40) }), 'it');
    await admin(`/admin/bookings/${b.id}/transfer-received`, form({}));
    await app.services.cancel(b.id, { by: 'admin', refund: 'full' });
    const c = getBooking(app.db, b.id);
    assert.equal(c.status, 'cancelled');
    assert.ok(c.refund_pending_cents > 0, 'rimborso da fare a mano');
    assert.equal(c.payment_status, 'paid');
    const page = await text(await admin(`/admin/bookings/${b.id}`));
    assert.match(page, /restituisci la somma con un bonifico/);
    assert.match(await text(await admin('/admin/todo')), /Rimborso da fare/);
    await admin(`/admin/bookings/${b.id}/refund-done`, form({}));
    const d = getBooking(app.db, b.id);
    assert.deepEqual([d.payment_status, d.refund_pending_cents, d.refund_cents > 0], ['refunded', 0, true]);
  } finally {
    s.close();
  }
});

test('scheda agenzia: bonifico acceso o spento e giorni di attesa propri', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const page = await text(await admin(`/admin/partners/${s.agency.id}`));
    assert.match(page, /Può pagare con bonifico alla conferma/);
    const save = (over) => admin(`/admin/partners/${s.agency.id}`, form({ status: 'approved', discount_percent: '0', allow_invoice: '1', admin_notes: '', ...over }));
    assert.match(loc(await save({ transfer_enabled: '1', transfer_days: '5' })), /ok=partner/);
    let a = app.db.prepare('SELECT transfer_enabled, transfer_days FROM accounts WHERE id = ?').get(s.agency.id);
    assert.deepEqual([a.transfer_enabled, a.transfer_days], [1, 5]);
    const fresh = () => app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(s.agency.id);
    const { booking: b } = await app.services.book(input(s, { account: fresh() }), 'it', Date.now());
    assert.ok(Math.abs(Date.parse(b.hold_expires_at) - (Date.now() + 5 * DAY)) < 5000, 'cinque giorni per questa agenzia');
    assert.match(loc(await save({ transfer_enabled: '1', transfer_days: '0' })), /err=transfer/, 'giorni non validi');
    assert.match(loc(await save({ transfer_enabled: '1', transfer_days: '' })), /ok=partner/);
    assert.equal(app.db.prepare('SELECT transfer_days FROM accounts WHERE id = ?').get(s.agency.id).transfer_days, null, 'vuoto = quelli del sito');
    assert.match(loc(await save({ transfer_days: '3' })), /ok=partner/);
    a = app.db.prepare('SELECT transfer_enabled FROM accounts WHERE id = ?').get(s.agency.id);
    assert.equal(a.transfer_enabled, 0, 'spento');
    await assert.rejects(() => app.services.book(input(s, { date: day(11), account: fresh() }), 'it'), /payment/i);
    // la pagina di prenotazione non lo offre
    const q = '?' + new URLSearchParams({ tour: SHARED, date: day(12), time: '10:00', pax: '2' });
    const off = await s.partner('/it/book/checkout' + q);
    assert.equal(off.status, 200);
    assert.ok(!(await text(off)).includes('Prenota e paga con bonifico'));
    app.db.prepare('UPDATE accounts SET transfer_enabled = 1, transfer_days = NULL WHERE id = ?').run(s.agency.id);
    const on = await text(await s.partner('/it/book/checkout' + q));
    assert.match(on, /name="paymentMethod" value="transfer"/);
    assert.match(on, /Il posto resta trattenuto 2 giorni: la prenotazione è definitiva quando il bonifico arriva/);
    app.db.prepare('UPDATE accounts SET transfer_days = 1 WHERE id = ?').run(s.agency.id);
    assert.match(await text(await s.partner('/it/book/checkout' + q)), /Il posto resta trattenuto 1 giorno:/);
  } finally {
    s.close();
  }
});

test('dal modulo di prenotazione: scelto «Bonifico» si arriva alla pagina del bonifico, senza passare dalla carta', async () => {
  const s = await start();
  try {
    const { app, partner } = s;
    const res = await partner('/it/book/checkout', form({
      tour: SHARED, date: day(12), time: '10:00', pax: '2', name: 'Giulia Bianchi', email: s.agency.email, lang: 'it', clientRef: 'Gruppo Verdi', paymentMethod: 'transfer', consent: '1',
    }));
    assert.equal(res.status, 303);
    const to = loc(res);
    assert.match(to, /^\/it\/booking\/VE-[A-Z0-9]+\?t=.+&new=1$/, 'resta sul sito, non va a Stripe');
    const ref = /booking\/(VE-[A-Z0-9]+)/.exec(to)[1];
    const b = app.db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);
    assert.deepEqual([b.status, b.payment_method, b.client_ref], ['held', 'transfer', 'Gruppo Verdi']);
    const page = await text(await partner(to));
    assert.match(page, /Bonifico da fare/);
    assert.ok(page.includes(GROUPED));
    // senza la scelta di pagamento valida la prenotazione non parte
    const bad = await partner('/it/book/checkout', form({ tour: SHARED, date: day(13), time: '10:00', pax: '2', name: 'G', email: s.agency.email, lang: 'it', paymentMethod: 'bitcoin', consent: '1' }));
    assert.equal(bad.status, 400);
  } finally {
    s.close();
  }
});
