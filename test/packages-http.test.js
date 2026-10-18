// Pacchetti delle agenzie: le pagine e i moduli, dall'inizio alla fine (carrello, opzione, conferma, pagamento con carta, annullo, admin).
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
const tmp = path.join(ROOT, 'data', 'test-packages-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';

async function start(acctOver = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    const f = async (p, init = {}) => {
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
    return f;
  };
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: await hashPassword(PW), company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234', ...acctOver });
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  return { app, base, admin, partner, anon: jar(), agency, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** I campi del modulo di prenotazione di un servizio: una visita condivisa la mattina, un servizio a ore il pomeriggio. */
const TOUR = (over = {}) => ({ tour: 'cannaregio-ghetto-agenzie', date: day(40), time: '10:00', pax: '4', name: 'Giulia Bianchi', email: 'giulia@lagoon.example', lang: 'it', tourLang: 'it', ...over });
const HOURLY = (over = {}) => ({ tour: 'guida-a-ore-agenzie', date: day(40), time: '15:30', pax: '6', hours: '3', name: 'Giulia Bianchi', email: 'giulia@lagoon.example', lang: 'it', tourLang: 'it', ...over });
const DETAILS = (over = {}) => ({ name: 'Anna Conti', email: 'anna@lagoon.example', phone: '+39 333 1234567', lang: 'it', clientRef: 'Gruppo Rossi', notes: 'Hotel Danieli', consent: '1', ...over });
const groupRef = (res) => loc(res).match(/\/packages\/(PT-[A-Z0-9]{6})\?t=([\w-]+)/);
const text = async (res) => (await res.text()).replace(/ /g, ' ');

test('senza accesso non c’è carrello; per un’agenzia il pagamento ha «Aggiungi al pacchetto», per i privati no', async () => {
  const s = await start();
  try {
    const { partner, anon } = s;
    const cart = await anon('/it/b2b/package');
    assert.equal(cart.status, 302);
    assert.match(loc(cart), /\/it\/b2b\/login\?next=/);
    assert.match(loc(await anon('/it/b2b/package/add', form(TOUR()))), /\/b2b\/login/);
    const url = `/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(40)}&time=10:00&pax=4`;
    const page = await text(await partner(url));
    assert.match(page, /id="package-add"/);
    assert.match(page, /formaction="\/it\/b2b\/package\/add"/);
    assert.match(page, /Aggiungi al pacchetto/);
    const priv = await text(await anon(`/it/book/checkout?tour=cannaregio-ghetto&date=${day(40)}&time=10:00&pax=2`));
    assert.ok(!priv.includes('package-add'), 'i privati non hanno il pacchetto');
  } finally {
    s.close();
  }
});

test('carrello: si aggiungono due servizi, il totale è la somma, si toglie un servizio, i doppioni e le sovrapposizioni si spiegano', async () => {
  const s = await start();
  try {
    const { partner } = s;
    const empty = await text(await partner('/it/b2b/package'));
    assert.match(empty, /Il pacchetto è vuoto/);
    assert.ok(!/Pacchetto \(\d/.test(empty), 'senza servizi la voce di menu non compare');

    const a = await partner('/it/b2b/package/add', form(TOUR()));
    assert.equal(a.status, 303);
    assert.equal(loc(a), '/it/b2b/package?flash=added');
    assert.equal((await partner('/it/b2b/package/add', form(HOURLY()))).status, 303);
    assert.match(await text(await partner(loc(a))), /Servizio aggiunto al pacchetto/);
    const page = await text(await partner('/it/b2b/package'));
    assert.match(page, /Pacchetto \(2\)/, 'la voce di menu mostra quanti servizi ci sono');
    assert.match(page, /Totale del pacchetto/);
    const cart = s.app.db.prepare('SELECT COUNT(*) n FROM cart_items WHERE account_id = ?').get(s.agency.id).n;
    assert.equal(cart, 2);

    const dup = await partner('/it/b2b/package/add', form(TOUR()));
    assert.equal(dup.status, 400);
    assert.match(await text(dup), /già nel pacchetto/);
    const clash = await partner('/it/b2b/package/add', form(HOURLY({ time: '11:00', hours: '2' })));
    assert.equal(clash.status, 400);
    assert.match(await text(clash), /si sovrappone a un altro servizio del pacchetto/i);
    const gone = await partner('/it/b2b/package/add', form(TOUR({ time: '12:34' })));
    assert.ok([400, 409].includes(gone.status), 'un orario che non esiste non entra');
    assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM cart_items').get().n, 2, 'i rifiutati non entrano');

    const id = s.app.db.prepare('SELECT id FROM cart_items ORDER BY id').get().id;
    const rm = await partner(`/it/b2b/package/remove/${id}`, form({}));
    assert.equal(loc(rm), '/it/b2b/package?flash=removed');
    assert.match(await text(await partner('/it/b2b/package')), /Pacchetto \(1\)/);
  } finally {
    s.close();
  }
});

test('opzione del pacchetto: una sola pagina, una sola scadenza; conferma a fattura; voucher, calendario e annullo; ogni servizio rimanda al pacchetto', async () => {
  const s = await start();
  try {
    const { partner, anon, app } = s;
    await partner('/it/b2b/package/add', form(TOUR()));
    await partner('/it/b2b/package/add', form(HOURLY()));
    const cartPage = await text(await partner('/it/b2b/package'));
    assert.match(cartPage, /name="action" value="option"/);
    assert.match(cartPage, /Opziona il pacchetto senza pagare/);

    const miss = await partner('/it/b2b/package', form({ ...DETAILS(), consent: '' , action: 'option' }));
    assert.equal(miss.status, 400, 'senza consenso non si prenota');

    const res = await partner('/it/b2b/package', form({ ...DETAILS(), action: 'option' }));
    assert.equal(res.status, 303);
    const [, ref, token] = groupRef(res);
    assert.match(loc(res), /&new=1$/);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM cart_items').get().n, 0, 'il carrello si svuota');
    const rows = app.db.prepare('SELECT * FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?) ORDER BY start_time').all(ref);
    assert.deepEqual(rows.map((b) => [b.tour_slug, b.status, b.client_ref]), [['cannaregio-ghetto-agenzie', 'option', 'Gruppo Rossi'], ['guida-a-ore-agenzie', 'option', 'Gruppo Rossi']]);
    assert.equal(new Set(rows.map((b) => b.option_expires_at)).size, 1, 'scadenza unica');
    assert.ok(app.mail.sent.some((m) => m.to === 'anna@lagoon.example' && /Opzione registrata sul pacchetto/.test(m.subject)));

    // la pagina del pacchetto: per chi ha il link, e per l'agenzia dentro la sua area
    const page = await text(await anon(`/it/packages/${ref}?t=${token}`));
    assert.match(page, /Date trattenute \(opzione\)/);
    assert.match(page, /Conferma il pacchetto/);
    assert.match(page, /Rilascia le date/);
    assert.equal((await anon(`/it/packages/${ref}?t=sbagliato`)).status, 404, 'il codice segreto serve');
    assert.equal((await anon(`/it/packages/${ref}`)).status, 404);
    const own = await text(await partner(`/it/b2b/packages/${ref}`));
    assert.match(own, /Tutte le prenotazioni/);
    assert.equal((await anon(`/it/b2b/packages/${ref}`)).status, 302, 'l’area riservata chiede l’accesso');
    // ogni servizio rimanda al pacchetto e non si conferma da solo
    const line = await text(await anon(`/it/booking/${rows[0].ref}?t=${rows[0].token}`));
    assert.match(line, new RegExp(`Pacchetto ${ref}`));
    assert.match(line, /Apri il pacchetto/);
    assert.ok(!line.includes('/option/confirm'), 'la conferma è del pacchetto');
    assert.match(await text(await partner('/it/b2b/bookings?view=options')), new RegExp(`Pacchetto ${ref}`));

    // conferma: a fattura tutto confermato insieme
    const conf = await anon(`/it/packages/${ref}/confirm`, form({ t: token, method: 'invoice' }));
    assert.equal(conf.status, 303);
    assert.match(loc(conf), /flash=confirmed/);
    assert.deepEqual(app.db.prepare('SELECT status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').all(ref).map((b) => b.status), ['confirmed', 'confirmed']);
    const done = await text(await anon(loc(conf)));
    assert.match(done, /Pacchetto confermato: ti abbiamo mandato riepilogo e voucher/);
    assert.match(done, /Voucher del/);
    assert.equal((await anon(`/it/packages/${ref}/confirm`, form({ t: token, method: 'invoice' }))).status, 303, 'un secondo clic non dà errore');
    assert.equal(app.mail.sent.filter((m) => /Pacchetto confermato PT-/.test(m.subject)).length, 1);

    const ics = await anon(`/it/packages/${ref}/calendar.ics?t=${token}`);
    assert.equal(ics.status, 200);
    assert.match(ics.headers.get('content-type'), /text\/calendar/);
    assert.equal(((await ics.text()).match(/BEGIN:VEVENT/g) ?? []).length, 2);
    const voucher = await anon(`/it/booking/${rows[0].ref}/voucher.pdf?t=${rows[0].token}`);
    assert.equal(voucher.status, 200);

    // annullo di tutto il pacchetto (dentro il periodo gratuito)
    const cancel = await anon(`/it/packages/${ref}/cancel`, form({ t: token }));
    assert.match(loc(cancel), /flash=cancelled/);
    assert.deepEqual(app.db.prepare('SELECT status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').all(ref).map((b) => b.status), ['cancelled', 'cancelled']);
    assert.match(await text(await anon(loc(cancel))), /Pacchetto annullato/);
  } finally {
    s.close();
  }
});

test('rilascio dell’opzione dal pacchetto: tutte le date tornano libere; un secondo clic non dà errore', async () => {
  const s = await start();
  try {
    const { partner, anon, app } = s;
    await partner('/it/b2b/package/add', form(TOUR()));
    await partner('/it/b2b/package/add', form(HOURLY()));
    const [, ref, token] = groupRef(await partner('/it/b2b/package', form({ ...DETAILS(), action: 'option' })));
    const rel = await anon(`/it/packages/${ref}/release`, form({ t: token }));
    assert.match(loc(rel), /flash=released/);
    assert.deepEqual(app.db.prepare('SELECT status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').all(ref).map((b) => b.status), ['expired', 'expired']);
    assert.match(await text(await anon(loc(rel))), /Opzione terminata/);
    assert.equal((await anon(`/it/packages/${ref}/release`, form({ t: token }))).status, 303);
    assert.equal(app.mail.sent.filter((m) => m.to === 'guida@example.com' && /rilasciato dall’agenzia/.test(m.subject)).length, 1);
    // le date tornano prenotabili da subito
    assert.equal((await partner('/it/b2b/package/add', form(TOUR()))).status, 303);
  } finally {
    s.close();
  }
});

test('pacchetto con la carta: un solo pagamento (pagina demo) per tutti i servizi, poi tutto confermato', async () => {
  const s = await start({ allow_invoice: 0 });
  try {
    const { partner, anon, app } = s;
    await partner('/it/b2b/package/add', form(TOUR()));
    await partner('/it/b2b/package/add', form(HOURLY()));
    const cart = await text(await partner('/it/b2b/package'));
    assert.match(cart, /Vai al pagamento/, 'il pulsante dice che si va a pagare');
    const res = await partner('/it/b2b/package', form({ ...DETAILS(), paymentMethod: 'card' }));
    assert.equal(res.status, 303);
    const m = loc(res).match(/\/pay\/demo\/(PT-[A-Z0-9]{6})\?t=([\w-]+)/);
    assert.ok(m, 'si va al pagamento del pacchetto');
    const [, ref, token] = m;
    assert.deepEqual(app.db.prepare('SELECT status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').all(ref).map((b) => b.status), ['held', 'held']);
    const demo = await text(await anon(`/pay/demo/${ref}?t=${token}&lang=it`));
    assert.match(demo, new RegExp(ref));
    const total = app.db.prepare('SELECT SUM(total_cents) s FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').get(ref).s;
    assert.equal(app.db.prepare('SELECT due_cents FROM booking_groups WHERE ref = ?').get(ref).due_cents, total, 'si chiede la somma dei servizi');
    // la pagina del pacchetto in attesa propone di completare il pagamento
    const waiting = await text(await anon(`/it/packages/${ref}?t=${token}`));
    assert.match(waiting, /In attesa di pagamento/);
    assert.match(waiting, new RegExp(`/pay/resume/${ref}\\?t=${token}`));
    const paid = await anon(`/pay/demo/${ref}/complete`, form({ t: token, lang: 'it' }));
    assert.equal(paid.status, 303);
    assert.match(loc(paid), new RegExp(`/it/packages/${ref}\\?t=${token}&paid=1`));
    const rows = app.db.prepare('SELECT status, payment_status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').all(ref);
    assert.deepEqual(rows.map((r) => [r.status, r.payment_status]), [['confirmed', 'paid'], ['confirmed', 'paid']]);
    assert.match(await text(await anon(loc(paid))), /Pacchetto confermato/);
    assert.equal(app.mail.sent.filter((x) => /Pacchetto confermato PT-/.test(x.subject)).length, 1);
  } finally {
    s.close();
  }
});

test('pannello: il pacchetto si vede nella scheda e nell’elenco, e si segna incassato tutto insieme', async () => {
  const s = await start();
  try {
    const { partner, admin, app } = s;
    await partner('/it/b2b/package/add', form(TOUR()));
    await partner('/it/b2b/package/add', form(HOURLY()));
    const [, ref] = groupRef(await partner('/it/b2b/package', form({ ...DETAILS() })));
    const rows = app.db.prepare('SELECT id, ref, payment_status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?) ORDER BY id').all(ref);
    assert.equal(rows.length, 2);
    const detail = await text(await admin(`/admin/bookings/${rows[0].id}`));
    assert.match(detail, new RegExp(`<strong>${ref}</strong>`));
    assert.match(detail, new RegExp(`/admin/bookings/${rows[1].id}`), 'rimanda agli altri servizi');
    assert.match(detail, /Segna incassato tutto il pacchetto/);
    assert.match(await text(await admin('/admin/bookings?f=all')), new RegExp(`pacchetto ${ref}`));
    const one = await admin(`/admin/bookings/${rows[0].id}/paid`, form({}));
    assert.equal(one.status, 303);
    assert.deepEqual(app.db.prepare('SELECT payment_status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?) ORDER BY id').all(ref).map((b) => b.payment_status), ['paid', 'unpaid'], 'senza «tutto» segna solo quel servizio');
    await admin(`/admin/bookings/${rows[1].id}/paid`, form({ all: '1' }));
    assert.deepEqual(app.db.prepare('SELECT payment_status FROM bookings WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').all(ref).map((b) => b.payment_status), ['paid', 'paid']);
    // la coda delle fatture riconosce il pacchetto
    app.db.prepare('UPDATE bookings SET date = ? WHERE group_id = (SELECT id FROM booking_groups WHERE ref = ?)').run(addDays(nowRome().date, -1), ref);
    assert.match(await text(await admin('/admin/invoices?tab=queue')), new RegExp(`pacchetto ${ref}`));
  } finally {
    s.close();
  }
});
