// Incassi dalla banca nel pannello: si carica l'estratto conto, si vedono gli abbinamenti, si confermano e le fatture risultano incassate.
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
import { openPartsCents } from '../server/invoicePayments.js';
import { statementOf } from '../server/statement.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-bank-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
/** Un modulo con valori ripetuti (le caselle «pay» sono più d'una). */
const multi = (pairs) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString() });
const loc = (res) => res.headers.get('location');
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const SHARED = 'cannaregio-ghetto-agenzie'; // 28 € a persona
const it = (iso) => iso.split('-').reverse().join('/'); // 2027-01-20 → 20/01/2027
let n = 0;

async function start() {
  const cfg = createConfig({
    __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true,
    mail: { notifyTo: 'guida@example.com' }, site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { iban: 'IT60X0542811101000000123456', bank: 'Banca di Prova', seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
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
  const hash = await hashPassword(PW);
  const lagoon = addAccount(app.db, { email: 'anna@lagoon.example', password_hash: hash, company: 'Lagoon DMC Srl', contact_name: 'Anna Bianchi', vat: '01234567897', country: 'IT', lang: 'it' });
  const blue = addAccount(app.db, { email: 'bruno@bluesail.example', password_hash: hash, company: 'BlueSail Tours', contact_name: 'Bruno Neri', vat: '09876543210', country: 'IT', lang: 'en' });
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  return { app, admin, anon: jar(), lagoon, blue, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** Una prenotazione a fattura (ogni volta un giorno diverso) e la sua fattura emessa oggi. */
function invoiced(s, acct, pax) {
  const b = createBooking(s.app, { tourSlug: SHARED, date: day(10 + n++), time: '10:00', pax, channel: 'b2b', account: acct, name: acct.contact_name, email: acct.email, lang: acct.lang, clientRef: `Gruppo ${n}`, paymentMethod: 'invoice' });
  const [draft] = createDrafts(s.app, [`booking:${b.id}`]);
  const d = invoiceDetail(s.app, draft.id);
  saveDraft(s.app, draft.id, { buyer: { kind: 'company', name: acct.company, country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: acct.email, lang: acct.lang }, lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } });
  return { b, inv: issueInvoice(s.app, draft.id) };
}
const comma = (cents) => (cents / 100).toFixed(2).replace('.', ',');

test('pagina: serve il pannello; si apre dalla scheda «Incassi dalla banca» di Fatture; file vuoto, enorme o senza colonne danno un errore chiaro', async () => {
  const s = await start();
  try {
    const { admin, anon } = s;
    assert.equal((await anon('/admin/invoices/bank')).status, 302);
    assert.equal((await anon('/admin/invoices/bank', form({ csv: 'x' }))).status, 302);
    assert.equal((await anon('/admin/invoices/bank/apply', form({ pay: '1:2027-01-01' }))).status, 302);

    const page = await text(await admin('/admin/invoices/bank'));
    assert.match(page, /<h1>Incassi dalla banca<\/h1>/);
    assert.match(page, /href="\/admin\/invoices\/bank" aria-current="page">Incassi dalla banca/);
    assert.match(page, /data-bank-file/);
    assert.match(page, /\/js\/admin-bank\.js/);
    assert.doesNotMatch(page, /<script>/, 'nessuno script inline');
    // la scheda c'è anche nelle altre pagine delle fatture
    assert.match(await text(await admin('/admin/invoices')), /href="\/admin\/invoices\/bank" ?>Incassi dalla banca/);

    const empty = await admin('/admin/invoices/bank', form({ csv: '   ' }));
    assert.equal(empty.status, 400);
    assert.match(await text(empty), /Carica il file dell’estratto conto/);
    const junk = await admin('/admin/invoices/bank', form({ csv: 'nome;cognome\nMario;Rossi\n' }));
    assert.equal(junk.status, 400);
    const junkPage = await text(junk);
    assert.match(junkPage, /Non riconosco le colonne/);
    assert.match(junkPage, /nome;cognome/, 'il testo incollato resta nel campo');
    const big = await admin('/admin/invoices/bank', form({ csv: 'Data;Importo;Descrizione\n' + '01/01/2027;1,00;x\n'.repeat(130_000) }));
    assert.equal(big.status, 400);
    assert.match(await text(big), /troppo grande/);
  } finally {
    s.close();
  }
});

test('abbinamento e conferma: le sicure sono spuntate, le altre no; si segnano gli incassi alla data della banca, con la ricevuta all’agenzia', async () => {
  const s = await start();
  try {
    const { app, admin, lagoon, blue } = s;
    const a = invoiced(s, lagoon, 2); // 56 €
    const b = invoiced(s, lagoon, 3); // 86 € (con bollo)
    const c = invoiced(s, blue, 1); // 28 €
    const d = invoiced(s, blue, 5); // 142 €
    const e = invoiced(s, blue, 1); // 28 € (come la c)
    const owed = (x) => openPartsCents(x.inv);
    const yesterday = day(-1);
    const today = nowRome().date;
    const csv = [
      'Conto: IT60X0542811101000000123456;;;',
      'Data;Operazione;Dettagli;Importo',
      `${it(yesterday)};BONIFICO;LAGOON DMC SRL Fattura ${a.inv.number};${comma(owed(a))}`, // sicuro
      `${it(today)};BONIFICO;Saldo fatture ${b.inv.number} e ${d.inv.number};${comma(owed(b) + owed(d))}`, // somma di due: sicuro
      `${it(today)};BONIFICO;BLUESAIL fattura ${c.inv.number} acconto;10,00`, // importo diverso
      `${it(today)};BONIFICO;Bonifico da Mario Rossi;${comma(owed(e))}`, // stesso importo di due fatture (c ed e): ambiguo
      `${it(today)};COMMISSIONE;Imposta di bollo;-2,00`, // uscita
      `${it(today)};BONIFICO;<script>alert(1)</script> rimborso;999,00`, // senza fattura, con markup da neutralizzare
    ].join('\n');
    const res = await admin('/admin/invoices/bank', form({ csv }));
    assert.equal(res.status, 200);
    const page = await text(res);
    assert.match(page, /Letti 6 movimenti/);
    assert.match(page, /5 accrediti e 1 uscita ignorata/);
    assert.match(page, /Colonne riconosciute: data «Data», importo «Importo», descrizione «Dettagli \+ Operazione»/);
    assert.match(page, /Da segnare come incassate <span class="chip chip-ok">2<\/span>/);
    assert.match(page, /Da controllare <span class="chip chip-warn">1<\/span>/);
    assert.match(page, /Più fatture con lo stesso importo <span class="chip chip-warn">1<\/span>/);
    assert.match(page, /Accrediti senza fattura \(1\)/);
    assert.doesNotMatch(page, /<script>alert/, 'il testo dell’estratto è neutralizzato');
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    // le caselle sicure sono già spuntate, con id e data della banca
    for (const x of [[a, yesterday], [b, today], [d, today]]) {
      assert.match(page, new RegExp(`<input type="checkbox" name="pay" value="${x[0].inv.id}:${x[1]}" data-cents="${owed(x[0])}" checked`), `fattura ${x[0].inv.number}`);
    }
    assert.doesNotMatch(page, new RegExp(`name="pay" value="${c.inv.id}:[^"]*"[^>]*checked`), 'quella con importo diverso non è spuntata');
    assert.match(page, new RegExp(`<input type="radio" name="pay_\\d+" value="${c.inv.id}:${today}"`), 'le ambigue si scelgono con un pulsante');
    assert.match(page, new RegExp(`<input type="radio" name="pay_\\d+" value="${e.inv.id}:${today}"`));
    assert.match(page, /Segna come incassate le fatture selezionate/);
    // nulla è stato scritto
    assert.equal(getInvoice(app.db, a.inv.id).paid_at, null);

    // conferma: le tre sicure
    const before = app.mail.sent.length;
    const ok = await admin('/admin/invoices/bank/apply', multi([['pay', `${a.inv.id}:${yesterday}`], ['pay', `${b.inv.id}:${today}`], ['pay', `${d.inv.id}:${today}`], ['notify', '1']]));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), `/admin/invoices/bank?ok=applied&n=3&c=${owed(a) + owed(b) + owed(d)}&a=0&f=0`);
    for (const x of [a, b, d]) {
      const inv = getInvoice(app.db, x.inv.id);
      assert.ok(inv.paid_at, x.inv.number);
      assert.equal(inv.paid_method, 'bank');
    }
    assert.equal(getInvoice(app.db, a.inv.id).paid_at.slice(0, 10), yesterday, 'alla data della banca (mezzogiorno di Venezia)');
    assert.equal(getInvoice(app.db, b.inv.id).paid_at.slice(0, 10), today);
    assert.equal(getBooking(app.db, a.b.id).payment_status, 'paid', 'le prenotazioni della fattura risultano pagate');
    assert.equal(getInvoice(app.db, c.inv.id).paid_at, null, 'le altre non si toccano');
    const mails = app.mail.sent.slice(before).filter((m) => /Pagamento ricevuto|Payment received/i.test(m.subject));
    assert.deepEqual(mails.map((m) => m.to).sort(), [blue.email, lagoon.email, lagoon.email].sort(), 'la ricevuta va alle agenzie (una per fattura)');
    const done = await text(await admin(loc(ok)));
    assert.match(done, /Segnate come incassate 3 fatture \(/);

    // lo stesso estratto, di nuovo: ora le fatture risultano già incassate
    const again = await text(await admin('/admin/invoices/bank', form({ csv })));
    assert.match(again, /Già incassate <span class="chip ">2<\/span>|Già incassate <span class="chip">2<\/span>/);
    assert.match(again, /La fattura risulta già incassata\./);
    assert.doesNotMatch(again, new RegExp(`name="pay" value="${a.inv.id}:`), 'nessuna casella per le già incassate');

    // scelta di una delle ambigue (con il pulsante), senza avviso
    const m2 = app.mail.sent.length;
    const pick = await admin('/admin/invoices/bank/apply', multi([[`pay_5`, `${e.inv.id}:${today}`]]));
    assert.equal(loc(pick), `/admin/invoices/bank?ok=applied&n=1&c=${owed(e)}&a=0&f=0`);
    assert.ok(getInvoice(app.db, e.inv.id).paid_at);
    assert.equal(app.mail.sent.length, m2, 'senza la spunta «Avvisa» non parte nulla');

    // l'estratto conto dell'agenzia vede gli incassi, ciascuno alla data della banca
    const payments = (month) => statementOf(app, lagoon.id, month).movements.filter((m) => m.kind === 'payment').map((m) => [m.invoice.number, m.date, -m.cents]);
    assert.deepEqual(payments(yesterday.slice(0, 7)).filter((p) => p[1] === yesterday), [[a.inv.number, yesterday, owed(a)]]);
    assert.deepEqual(payments(today.slice(0, 7)).filter((p) => p[1] === today), [[b.inv.number, today, owed(b)]]);
  } finally {
    s.close();
  }
});

test('conferma con valori strani: già incassate, id inesistenti, date future o malformate; mai un errore e mai due volte la stessa fattura', async () => {
  const s = await start();
  try {
    const { app, admin, lagoon } = s;
    const a = invoiced(s, lagoon, 2);
    const today = nowRome().date;
    const res = await admin('/admin/invoices/bank/apply', multi([
      ['pay', `${a.inv.id}:${day(30)}`], // data futura: si segna a oggi
      ['pay', `${a.inv.id}:${today}`], // la stessa fattura due volte: una sola
      ['pay', '99999:2027-01-01'], // non esiste
      ['pay', 'abc'], // malformato
      ['pay', `${a.inv.id}:2027-02-31`], // data impossibile
      ['pay_3', `${a.inv.id}:${today}`],
    ]));
    assert.equal(loc(res), `/admin/invoices/bank?ok=applied&n=1&c=${openPartsCents(a.inv)}&a=0&f=3`);
    const inv = getInvoice(app.db, a.inv.id);
    assert.equal(inv.paid_at.slice(0, 10), today, 'una data futura diventa oggi');
    // di nuovo: «già incassata»
    const again = await admin('/admin/invoices/bank/apply', multi([['pay', `${a.inv.id}:${today}`]]));
    assert.equal(loc(again), '/admin/invoices/bank?ok=applied&n=0&c=0&a=1&f=0');
    const flash = await text(await admin(loc(again)));
    assert.match(flash, /Segnate come incassate 0 fatture/);
    assert.match(flash, /1 era già incassata/);
    // senza nulla di spuntato non succede niente
    assert.equal(loc(await admin('/admin/invoices/bank/apply', form({}))), '/admin/invoices/bank?ok=applied&n=0&c=0&a=0&f=0');
    // una bozza o una fattura inesistente non si incassa
    const [draft] = createDrafts(app, [`booking:${createBooking(app, { tourSlug: SHARED, date: day(60), time: '10:00', pax: 2, channel: 'b2b', account: lagoon, name: 'Anna Bianchi', email: lagoon.email, lang: 'it', paymentMethod: 'invoice' }).id}`]);
    assert.match(loc(await admin('/admin/invoices/bank/apply', multi([['pay', `${draft.id}:${today}`]]))), /n=0&c=0&a=0&f=1$/);
    assert.equal(getInvoice(app.db, draft.id).paid_at, null);
  } finally {
    s.close();
  }
});
