// Pagamento delle fatture: area dell'agenzia, pagina di pagamento con il link, carta, incasso dal pannello e avvisi.
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
import { createDrafts, getInvoice, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { createPackage, resolveLine } from '../server/packages.js';
import { addDays, nowRome } from '../server/time.js';
import { formatMoney } from '../server/util.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-invoice-payments-http-' + crypto.randomBytes(3).toString('hex'));
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

/** Una prenotazione a fattura dell'agenzia e la sua fattura emessa oggi (scade fra 30 giorni). */
function invoiced(s, over = {}) {
  const b = createBooking(s.app, { tourSlug: SHARED, date: day(10), time: '10:00', pax: 4, channel: 'b2b', account: s.agency, name: 'Giulia Bianchi', email: s.agency.email, lang: 'it', clientRef: 'Gruppo Rossi', paymentMethod: 'invoice', ...over });
  const [draft] = createDrafts(s.app, [`booking:${b.id}`]);
  const d = invoiceDetail(s.app, draft.id);
  saveDraft(s.app, draft.id, { buyer: { kind: 'company', name: 'Lagoon DMC', country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: s.agency.email, lang: 'it' }, lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } });
  return { b, inv: issueInvoice(s.app, draft.id) };
}
/** Sposta la scadenza di una fattura emessa (nelle parti di pagamento), per provare le fatture scadute. */
function setDue(app, inv, date) {
  const parts = JSON.parse(inv.payments_json).map((p) => (p.dueDate ? { ...p, dueDate: date } : p));
  app.db.prepare('UPDATE invoices SET payments_json = ? WHERE id = ?').run(JSON.stringify(parts), inv.id);
}

test('area agenzia: la fattura mostra stato e scadenza, «Paga ora», e la scheda della prenotazione dice come si paga', async () => {
  const s = await start();
  try {
    const { partner, app } = s;
    const o = createBooking(app, { tourSlug: SHARED, date: day(20), time: '10:00', pax: 2, channel: 'b2b', account: s.agency, name: 'Giulia', email: s.agency.email, lang: 'it', paymentMethod: 'invoice' });
    const before = await text(await partner(`/it/b2b/bookings/${o.ref}`));
    assert.match(before, /Pagamento a fattura/);
    assert.match(before, /Dopo il servizio ricevi la fattura elettronica e paghi con bonifico entro 30 giorni dalla data della fattura/);
    assert.match(before, /Paga ora online|Vuoi chiudere subito il conto\?/);
    assert.match(before, /Vuoi chiudere subito il conto\? Paga con carta/);

    const { b, inv } = invoiced(s);
    const page = await text(await partner('/it/b2b/invoices'));
    assert.match(page, new RegExp(inv.number.replace('/', '\\/')));
    assert.match(page, /Da pagare entro il/);
    assert.match(page, /\/it\/invoices\/IN-[A-Z0-9]{6}\?t=/);
    // con i pagamenti attivi «Paga con carta» porta subito alla carta (senza passare dalla pagina della fattura) e il bonifico resta un collegamento a parte
    const row0 = getInvoice(app.db, inv.id);
    assert.match(page, new RegExp(`<a class="btn btn-outline btn-sm" href="/pay/resume/${row0.pay_ref}\\?t=${row0.pay_token}&amp;lang=it">Paga con carta</a><a class="btn-text" href="/it/invoices/${row0.pay_ref}\\?t=${row0.pay_token}">Dati del bonifico</a>`));
    assert.ok(!page.includes('fatture scadute') && !page.includes('Paga tutto lo scaduto'));
    const card = await text(await partner(`/it/b2b/bookings/${b.ref}`));
    assert.match(card, /Fattura [\d/]+: [\d.,]+ €\./);
    assert.match(card, /Come pagare la fattura/);

    // scaduta: avviso in alto, pulsante in evidenza e riepilogo con la quota scaduta
    setDue(app, getInvoice(app.db, inv.id), day(-5));
    const late = await text(await partner('/it/b2b/invoices'));
    assert.match(late, /Fatture scadute da pagare: 1/);
    assert.match(late, /Scaduta il/);
    assert.match(await text(await partner('/it/b2b/bookings')), /di cui scaduti/);
  } finally {
    s.close();
  }
});

test('pagina di pagamento con il link: importo, scadenza, IBAN e causale, PDF; senza il codice giusto non si apre', async () => {
  const s = await start();
  try {
    const { anon, partner, app } = s;
    const { inv } = invoiced(s);
    await partner('/it/b2b/invoices'); // crea il riferimento
    const row = getInvoice(app.db, inv.id);
    const url = `/it/invoices/${row.pay_ref}?t=${row.pay_token}`;
    const page = await text(await anon(url));
    assert.match(page, new RegExp(`Fattura ${inv.number.replace('/', '\\/')}`));
    assert.match(page, /Come pagare/);
    assert.match(page, /IT60 X054 2811 1010 0000 0123 456/);
    assert.match(page, new RegExp(`Fattura ${inv.number.replace('/', '\\/')}`), 'la causale');
    assert.match(page, /Banca di Prova/);
    assert.match(page, /Paga ora con carta/);
    assert.match(page, /data-copy="#pay-iban"/);
    assert.match(page, /Da pagare entro il/);
    assert.equal((await anon(`/it/invoices/${row.pay_ref}?t=sbagliato`)).status, 404);
    assert.equal((await anon(`/it/invoices/${row.pay_ref}`)).status, 404);
    assert.equal((await anon('/it/invoices/IN-ZZZZZZ?t=x')).status, 404);
    const pdf = await anon(`/it/invoices/${row.pay_ref}/pdf?t=${row.pay_token}`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type'), /pdf/);
    assert.equal((await anon(`/it/invoices/${row.pay_ref}/pdf?t=zz`)).status, 404);
    // la vede dentro la sua area se è la sua
    assert.match(await text(await partner(url)), /Area agenzia/);
    assert.ok(!(await text(await anon(url))).includes('Area agenzia'));

    // carta: dal link si va al pagamento, e a pagamento fatto la pagina dice «pagata»
    const go = await anon(`/pay/resume/${row.pay_ref}?t=${row.pay_token}&lang=it`);
    assert.equal(go.status, 303);
    assert.match(loc(go), new RegExp(`/pay/demo/${row.pay_ref}\\?t=`));
    const demo = await text(await anon(rel(loc(go))));
    assert.match(demo, new RegExp(row.pay_ref));
    const done = await anon(`/pay/demo/${row.pay_ref}/complete`, form({ t: row.pay_token, lang: 'it' }));
    assert.equal(done.status, 303);
    assert.match(loc(done), new RegExp(`/it/invoices/${row.pay_ref}\\?t=${row.pay_token}&paid=1`));
    const paid = await text(await anon(rel(loc(done))));
    assert.match(paid, /Pagamento ricevuto: grazie/);
    assert.match(paid, /Pagata il .* con carta/);
    assert.ok(!paid.includes('Paga ora con carta'));
    assert.equal(getInvoice(app.db, inv.id).paid_method, 'card');
    assert.equal(loc(await anon(`/pay/resume/${row.pay_ref}?t=${row.pay_token}&lang=it`)), `/it/invoices/${row.pay_ref}?t=${row.pay_token}`, 'già pagata: si torna alla pagina');
    assert.match(await text(await partner('/it/b2b/invoices')), /Pagata il .* con carta/);
  } finally {
    s.close();
  }
});

/** Due fatture scadute dell'agenzia (e una terza, ancora da scadere). */
function twoOverdue(s) {
  const one = invoiced(s, { date: day(10), time: '10:00' });
  const two = invoiced(s, { date: day(12), time: '15:00', pax: 2 });
  const fresh = invoiced(s, { date: day(14), time: '10:00', pax: 3 });
  for (const x of [one, two]) setDue(s.app, getInvoice(s.app.db, x.inv.id), day(-4));
  return { one: one.inv, two: two.inv, fresh: fresh.inv };
}

test('«Paga tutto lo scaduto»: un solo pagamento con carta per le fatture scadute; ognuna risulta pagata con la sua ricevuta; ripetuto non paga due volte', async () => {
  const s = await start();
  try {
    const { partner, anon, app } = s;
    const { one, two, fresh } = twoOverdue(s);
    const page = await text(await partner('/it/b2b/invoices'));
    // l'avviso dice quante sono e quanto, e c'è il pulsante per pagarle tutte insieme (non la terza, che non è scaduta)
    assert.match(page, /Fatture scadute da pagare: 2 \(in tutto [\d.,]+ €\)\. Paga con carta dalla riga della fattura o tutte insieme con «Paga tutto lo scaduto»/);
    const total = getInvoice(app.db, one.id).total_cents + getInvoice(app.db, two.id).total_cents;
    assert.match(page, /<form method="post" action="\/it\/b2b\/invoices\/pay-all"><button class="btn btn-gold" type="submit">Paga tutto lo scaduto · [\d.,]+ €<\/button><\/form>/);
    assert.equal(app.invoices.overdueToPay(s.agency.id).reduce((a, x) => a + x.dueCents, 0), total);

    // un clic: si crea il pagamento (SD-…) e si va alla carta
    const start1 = await partner('/it/b2b/invoices/pay-all', form({}));
    assert.equal(start1.status, 303);
    const m = loc(start1).match(/^\/pay\/resume\/(SD-[A-Z0-9]{6})\?t=([\w-]+)&lang=it$/);
    assert.ok(m, loc(start1));
    const [, ref, token] = m;
    const batch = app.db.prepare('SELECT * FROM invoice_batches WHERE ref = ?').get(ref);
    assert.equal(batch.amount_cents, total);
    assert.deepEqual(JSON.parse(batch.lines_json).map((l) => l.id), [one.id, two.id], 'la vecchia prima; non la fattura ancora da scadere');
    // un secondo clic con le stesse fatture riusa lo stesso pagamento
    assert.equal(loc(await partner('/it/b2b/invoices/pay-all', form({}))), loc(start1));
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invoice_batches').get().n, 1);

    const go = await anon(loc(start1));
    assert.equal(go.status, 303);
    assert.match(loc(go), new RegExp(`/pay/demo/${ref}\\?t=${token}`));
    const demo = await text(await anon(rel(loc(go))));
    assert.match(demo, /Fatture scadute \(2\)/);
    assert.ok(demo.includes(formatMoney(total, 'it').replace(/\u00a0/g, ' ')), 'l’importo è la somma');

    // a pagamento fatto: tutte e due pagate con carta, una ricevuta ciascuna, la guida avvisata
    const done = await anon(`/pay/demo/${ref}/complete`, form({ t: token, lang: 'it' }));
    assert.equal(done.status, 303);
    assert.equal(loc(done), `/it/b2b/invoices?batch=${ref}&paid=1`);
    for (const inv of [one, two]) {
      const row = getInvoice(app.db, inv.id);
      assert.equal(row.paid_method, 'card', inv.number);
      assert.ok(row.paid_at);
      assert.ok(app.mail.sent.some((x) => x.to === s.agency.email && x.subject === `Pagamento ricevuto — fattura ${inv.number}`), `ricevuta ${inv.number}`);
    }
    assert.equal(getInvoice(app.db, fresh.id).paid_at, null, 'la fattura non scaduta resta com’era');
    assert.equal(app.db.prepare("SELECT status FROM invoice_batches WHERE ref = ?").get(ref).status, 'paid');
    assert.equal(app.mail.sent.filter((x) => x.to === 'guida@example.com' && /Fattura pagata con carta/.test(x.subject)).length, 2);
    // chi torna dal pagamento vede l'esito e nient'altro da pagare tra le scadute
    const after = await text(await partner(loc(done)));
    assert.match(after, /Pagamento ricevuto: grazie! Le fatture risultano pagate e ti abbiamo mandato una ricevuta per ciascuna\./);
    assert.doesNotMatch(after, /Fatture scadute da pagare|Paga tutto lo scaduto/);
    // lo stesso pagamento ricevuto due volte (webhook e ritorno) non cambia nulla né manda altre email
    const mails = app.mail.sent.length;
    await anon(`/pay/demo/${ref}/complete`, form({ t: token, lang: 'it' }));
    assert.equal(app.mail.sent.length, mails);
    // un pagamento già chiuso non si riapre
    assert.equal(loc(await anon(`/pay/resume/${ref}?t=${token}&lang=it`)), `/it/b2b/invoices?batch=${ref}`);
    // senza il codice giusto non si apre
    assert.equal((await anon(`/pay/resume/${ref}?t=sbagliato&lang=it`)).status, 404);
  } finally {
    s.close();
  }
});

test('«Paga tutto lo scaduto»: se una fattura cambia nel frattempo il pagamento non parte, e se era già in corso la quota di quella fattura si rimborsa; nulla da pagare → messaggio', async () => {
  const s = await start();
  try {
    const { partner, anon, app } = s;
    // niente di scaduto: il pulsante non c'è e l'invio dice che non c'è nulla da pagare
    invoiced(s);
    assert.doesNotMatch(await text(await partner('/it/b2b/invoices')), /Paga tutto lo scaduto/);
    const none = await partner('/it/b2b/invoices/pay-all', form({}));
    assert.equal(loc(none), '/it/b2b/invoices?flash=nothing');
    assert.match(await text(await partner(loc(none))), /Non c’è nulla da pagare con la carta adesso/);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invoice_batches').get().n, 0);
    assert.equal((await s.anon('/it/b2b/invoices/pay-all', form({}))).status, 302, 'serve l’accesso');

    const { one, two } = twoOverdue(s);
    const first = loc(await partner('/it/b2b/invoices/pay-all', form({})));
    const ref = first.match(/SD-[A-Z0-9]{6}/)[0];
    const token = first.match(/t=([\w-]+)/)[1];
    // la guida registra il bonifico di una fattura prima che l'agenzia paghi: il pagamento non parte e si torna all'elenco
    await s.admin(`/admin/invoices/${one.id}/paid`, form({ date: day(-1), method: 'bank' }));
    assert.equal(loc(await anon(first)), `/it/b2b/invoices?batch=${ref}`, 'le fatture non sono più quelle');
    // un nuovo clic crea un pagamento nuovo, solo per la fattura rimasta, e chiude il vecchio
    const second = loc(await partner('/it/b2b/invoices/pay-all', form({})));
    const ref2 = second.match(/SD-[A-Z0-9]{6}/)[0];
    assert.notEqual(ref2, ref);
    assert.equal(app.db.prepare('SELECT status FROM invoice_batches WHERE ref = ?').get(ref).status, 'expired');
    assert.deepEqual(JSON.parse(app.db.prepare('SELECT lines_json FROM invoice_batches WHERE ref = ?').get(ref2).lines_json).map((l) => l.id), [two.id]);

    // pagamento già avviato col vecchio importo e arrivato dopo il bonifico: la fattura già saldata non si paga due volte, la sua quota si rimborsa
    const refunds = [];
    app.payments.refund = async (r) => { refunds.push(r); return { id: 'demo_refund', demo: true }; };
    const old = app.db.prepare('SELECT * FROM invoice_batches WHERE ref = ?').get(ref);
    app.db.prepare("UPDATE invoice_batches SET status = 'open' WHERE ref = ?").run(ref); // com'era quando il pagamento è partito
    await anon(`/pay/demo/${ref}/complete`, form({ t: old.token, lang: 'it' }));
    assert.equal(getInvoice(app.db, one.id).paid_method, 'bank', 'resta saldata col bonifico');
    assert.equal(getInvoice(app.db, two.id).paid_method, 'card');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].cents, JSON.parse(old.lines_json).find((l) => l.id === one.id).cents);
    assert.equal(refunds[0].paymentIntent, `demo_pi_${ref}`);
    assert.equal(refunds[0].ref, `${ref}-${one.id}`);
  } finally {
    s.close();
  }
});

test('pannello: stato di incasso nell’elenco, scheda «Incasso e solleciti», incasso del bonifico, sollecito a mano, avviso in agenda se scaduta', async () => {
  const s = await start();
  try {
    const { admin, partner, app } = s;
    const { b, inv } = invoiced(s);
    const issued = await text(await admin('/admin/invoices?tab=issued'));
    assert.match(issued, /Da incassare · entro il/);
    const detail = await text(await admin(`/admin/invoices/${inv.id}`));
    assert.match(detail, /Incasso e solleciti/);
    assert.match(detail, /Segna come incassata/);
    assert.match(detail, /Link di pagamento per l’agenzia/);
    assert.match(detail, /\/it\/invoices\/IN-/);
    assert.ok(!(await text(await admin('/admin'))).includes('fatture scadute'), 'non ancora scaduta');

    setDue(app, getInvoice(app.db, inv.id), day(-3));
    assert.match(await text(await admin('/admin')), /1 fattura scaduta e non incassata/);
    assert.match(await text(await admin('/admin/invoices?tab=issued')), /Scaduta da 3 giorni/);
    const remind = await admin(`/admin/invoices/${inv.id}/remind`, form({}));
    assert.match(loc(remind), /ok=reminded/);
    assert.ok(app.mail.sent.some((m) => m.to === s.agency.email && /Promemoria di pagamento/.test(m.subject)));
    assert.match(await text(await admin(`/admin/invoices/${inv.id}`)), /Inviati 1 sollecito/);

    // il bonifico è arrivato
    const paid = await admin(`/admin/invoices/${inv.id}/paid`, form({ date: day(-1), method: 'bank' }));
    assert.match(loc(paid), /ok=paid/);
    assert.equal(getBooking(app.db, b.id).payment_status, 'paid');
    const after = await text(await admin(`/admin/invoices/${inv.id}`));
    assert.match(after, /Incassata/);
    assert.match(after, /Annulla l’incasso registrato/);
    assert.ok(!(await text(await admin('/admin'))).includes('fattura scaduta'));
    assert.match(await text(await partner('/it/b2b/invoices')), /Pagata il .* con bonifico/);
    assert.ok(app.mail.sent.some((m) => m.to === s.agency.email && /Pagamento ricevuto/.test(m.subject)));
    // annullo l'incasso: torna tutto da incassare
    assert.match(loc(await admin(`/admin/invoices/${inv.id}/unpaid`, form({}))), /ok=unpaid/);
    assert.equal(getBooking(app.db, b.id).payment_status, 'unpaid');
    // una bozza non si incassa
    const draft = createDrafts(app, [`booking:${createBooking(app, { tourSlug: SHARED, date: day(12), time: '10:00', pax: 2, channel: 'b2b', account: s.agency, name: 'Giulia', email: s.agency.email, lang: 'it', paymentMethod: 'invoice' }).id}`])[0];
    assert.equal((await admin(`/admin/invoices/${draft.id}/paid`, form({ date: day(0) }))).status, 400);
  } finally {
    s.close();
  }
});

test('pacchetto a fattura: dalla sua pagina si può anticipare con la carta; impostazioni dei solleciti nel pannello', async () => {
  const s = await start();
  try {
    const { anon, admin, app } = s;
    const pkg = createPackage(app, s.agency, [resolveLine(app, { tour: SHARED, date: day(15), time: '10:00', pax: '3' }), resolveLine(app, { tour: 'guida-a-ore-agenzie', date: day(15), time: '15:30', pax: '4', hours: '3' })], { name: 'Anna Conti', email: 'anna@lagoon.example', lang: 'it', paymentMethod: 'invoice' });
    const page = await text(await anon(`/it/packages/${pkg.group.ref}?t=${pkg.group.token}`));
    assert.match(page, /Vuoi chiudere subito il conto\?/);
    assert.match(page, /Paga ora con carta \([\d.,]+ €\)/);
    const go = await anon(`/pay/resume/${pkg.group.ref}?t=${pkg.group.token}&lang=it`);
    assert.match(loc(go), new RegExp(`/pay/demo/${pkg.group.ref}`));
    await anon(`/pay/demo/${pkg.group.ref}/complete`, form({ t: pkg.group.token, lang: 'it' }));
    assert.deepEqual(app.db.prepare('SELECT payment_status, payment_method FROM bookings WHERE group_id = ?').all(pkg.group.id).map((x) => [x.payment_status, x.payment_method]), [['paid', 'card'], ['paid', 'card']]);
    assert.ok(!(await text(await anon(`/it/packages/${pkg.group.ref}?t=${pkg.group.token}`))).includes('Vuoi chiudere subito il conto?'), 'pagato');
    // i solleciti si regolano in Impostazioni › Fatturazione
    const settings = await text(await admin('/admin/settings'));
    assert.match(settings, /Solleciti automatici delle fatture scadute/);
    assert.match(settings, /Primo sollecito dopo la scadenza/);
  } finally {
    s.close();
  }
});
