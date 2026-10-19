// Estratto conto delle agenzie, dall'inizio alla fine: pagina, PDF, CSV, scelta dell'email, scheda nel pannello e invio mensile.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createCreditNote, createDrafts, getInvoice, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { openPartsCents } from '../server/invoicePayments.js';
import { addDays, addMonths, localToInstant, nowRome } from '../server/time.js';
import { addAccount, HAS_PDFTOTEXT, isPdf, pdfText } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-statement-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const IBAN = 'IT60X0542811101000000123456';
const text = async (res) => (await res.text()).replace(/\u00a0/g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie'; // 28 € a persona per le agenzie

async function start(over = {}) {
  const cfg = createConfig({
    __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true,
    mail: { notifyTo: 'guida@example.com' }, site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { iban: IBAN, bank: 'Banca di Prova', seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
    ...over,
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
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234', country: 'IT', lang: 'it' });
  const other = addAccount(app.db, { email: 'bruno@bluesail.example', password_hash: hash, company: 'BlueSail Tours', contact_name: 'Bruno Neri', vat: '09876543210', country: 'IT', lang: 'en' });
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  const partnerEn = jar();
  assert.equal((await partnerEn('/en/b2b/login', form({ email: other.email, password: PW }))).status, 303);
  return { app, admin, partner, partnerEn, anon: jar(), agency, other, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

let n = 0;
/** Una prenotazione a fattura (ogni volta un giorno diverso) e la sua fattura emessa oggi. */
function invoiced(s, acct = s.agency, over = {}) {
  const b = createBooking(s.app, { tourSlug: SHARED, date: day(10 + n++), time: '10:00', pax: 4, channel: 'b2b', account: acct, name: acct.contact_name, email: acct.email, lang: 'it', clientRef: 'Gruppo Rossi', paymentMethod: 'invoice', ...over });
  s.app.db.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(nowRome().date, b.id); // il servizio «è oggi»: cade nello stesso mese della fattura, qualunque sia il giorno in cui girano i test
  const [draft] = createDrafts(s.app, [`booking:${b.id}`]);
  const d = invoiceDetail(s.app, draft.id);
  saveDraft(s.app, draft.id, { buyer: { kind: 'company', name: acct.company, country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: acct.email, lang: 'it' }, lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } });
  return { b, inv: issueInvoice(s.app, draft.id) };
}
const monthOf = (inv) => inv.issue_date.slice(0, 7);

test('pagina: senza accesso si va al login; con l’accesso si vedono saldo, movimenti, da pagare e servizi, solo i propri', async () => {
  const s = await start();
  try {
    const { anon, partner, other } = s;
    for (const p of ['/it/b2b/statement', '/it/b2b/statement.pdf', '/it/b2b/statement.csv']) {
      const res = await anon(p);
      assert.equal(res.status, 302, p);
      assert.match(loc(res), /\/b2b\/login/);
    }
    assert.equal((await anon('/it/b2b/statement/email', form({ on: '1' }))).status, 302);

    const { inv, b } = invoiced(s);
    invoiced(s, other); // di un'altra agenzia
    const owed = openPartsCents(inv);
    const month = monthOf(inv);
    const page = await text(await partner(`/it/b2b/statement?month=${month}`));
    assert.match(page, /<h1>Estratto conto<\/h1>/);
    assert.match(page, /Saldo iniziale/);
    assert.match(page, new RegExp(`Fattura ${inv.number.replace('/', '\\/')}`));
    assert.match(page, /Movimenti del mese/);
    assert.match(page, /\+ 114 €/, 'la fattura (4 persone, bollo compreso) fra i movimenti');
    assert.equal(owed, 11400);
    assert.match(page, /Fatture da pagare al/);
    assert.match(page, /href="\/it\/invoices\/IN-[A-Z0-9]+\?t=/, 'pulsante per pagare');
    assert.match(page, /Come pagare/);
    assert.match(page, new RegExp(IBAN.replace(/(.{4})/g, '$1 ').trim().replace(/ /g, '\\s?')), 'coordinate per il bonifico');
    assert.match(page, /Servizi del mese/);
    assert.match(page, new RegExp(`/it/b2b/bookings/${b.ref}`));
    assert.ok(!/BlueSail|Altro/.test(page), 'nessun dato di altre agenzie');
    assert.equal((await s.partner('/it/b2b/statement')).status, 200, 'il mese in corso è quello di partenza');

    // mesi non validi o futuri → il mese in corso
    const now = nowRome().date.slice(0, 7);
    for (const bad of ['x', '2099-01', '2027-13', '']) {
      const res = await text(await partner(`/it/b2b/statement?month=${bad}`));
      assert.match(res, new RegExp(`href="/it/b2b/statement.pdf\\?month=${now}"`), bad);
    }
    // senza fatture si può comunque aprire un mese: tutto a zero
    const early = await text(await partner(`/it/b2b/statement?month=${addMonths(`${now}-01`, -1).slice(0, 7)}`));
    assert.match(early, /Nessun movimento in questo mese\./);
  } finally {
    s.close();
  }
});

test('pagina: più mesi (saldo iniziale, ritardo, incasso), frecce per cambiare mese, in inglese', async () => {
  const s = await start();
  try {
    const { app, partner, partnerEn, other } = s;
    const now = nowRome().date;
    const m2 = addMonths(`${now.slice(0, 7)}-01`, -2);
    const m1 = addMonths(`${now.slice(0, 7)}-01`, -1);
    const a = invoiced(s).inv; // fattura di due mesi fa, scaduta
    app.db.prepare('UPDATE invoices SET issue_date = ? WHERE id = ?').run(`${m2.slice(0, 7)}-10`, a.id);
    app.db.prepare('UPDATE invoices SET payments_json = ? WHERE id = ?').run(JSON.stringify(JSON.parse(getInvoice(app.db, a.id).payments_json).map((p) => (p.dueDate ? { ...p, dueDate: `${m1.slice(0, 7)}-09` } : p))), a.id);
    const o = openPartsCents(a);
    const prevPage = await text(await partner(`/it/b2b/statement?month=${m1.slice(0, 7)}`));
    assert.match(prevPage, /rel="prev"/, 'si può andare ancora indietro (c’è una fattura di due mesi fa)');
    assert.match(prevPage, /rel="next"/);
    assert.match(prevPage, /Mese in corso/);
    assert.match(prevPage, /scaduta da \d+ gg/);
    assert.match(prevPage, /Nessun movimento in questo mese\./);
    const first = await text(await partner(`/it/b2b/statement?month=${m2.slice(0, 7)}`));
    assert.ok(!/rel="prev"/.test(first), 'prima del primo documento non si va');
    assert.match(first, /rel="next"/);
    const current = await text(await partner('/it/b2b/statement'));
    assert.ok(!/rel="next"/.test(current), 'oltre il mese in corso non si va');
    assert.match(current, /<div class="notice notice-err" role="alert">/, 'fattura scaduta: avviso in rosso');

    // la stessa fattura incassata questo mese: nel mese compare l'incasso e a fine mese non è più da pagare
    app.db.prepare('UPDATE invoices SET paid_at = ?, paid_method = ? WHERE id = ?').run(new Date(localToInstant(now, '09:00')).toISOString(), 'bank', a.id);
    const paid = await text(await partner('/it/b2b/statement'));
    assert.match(paid, /Incasso fattura/);
    assert.match(paid, /Nessuna fattura da pagare\./);
    assert.ok(!/notice-err/.test(paid));
    assert.ok(o > 0);

    // in inglese (l'altra agenzia): titoli e importi tradotti
    invoiced(s, other);
    const en = await text(await partnerEn('/en/b2b/statement'));
    assert.match(en, /<h1>Statement of account<\/h1>/);
    assert.match(en, /Opening balance/);
    assert.match(en, /Invoices to pay at/);
    assert.match(en, /Invoice \d+\/\d{4}/);
  } finally {
    s.close();
  }
});

test('PDF: nella lingua dell’agenzia, con intestatario, saldo, movimenti, fatture da pagare, come pagare e servizi', { skip: !HAS_PDFTOTEXT && 'serve pdftotext' }, async () => {
  const s = await start();
  try {
    const { partner, partnerEn, other } = s;
    const { inv } = invoiced(s);
    const month = monthOf(inv);
    const res = await partner(`/it/b2b/statement.pdf?month=${month}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.match(res.headers.get('content-disposition'), new RegExp(`estratto-conto-${month}\\.pdf`));
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(isPdf(buf));
    const txt = pdfText(buf).replace(/\s+/g, ''); // il testo del PDF ha spaziature variabili: si confronta senza spazi
    assert.match(txt, /estrattoconto/i);
    assert.match(txt, /LagoonDMC/);
    assert.match(txt, /01234567897/);
    assert.ok(txt.includes(`Fattura${inv.number}`));
    assert.match(txt, /Saldoal/);
    assert.match(txt, /114€/);
    assert.ok(txt.includes(IBAN));
    assert.match(txt, /Serviziodelmese|Servizidelmese/i);
    assert.match(txt, /GruppoRossi/);

    invoiced(s, other);
    const en = pdfText(Buffer.from(await (await partnerEn(`/en/b2b/statement.pdf?month=${month}`)).arrayBuffer())).replace(/\s+/g, '');
    assert.match(en, /statementofaccount/i);
    assert.match(en, /BlueSailTours/);
    assert.match(en, /Balanceat/);
    assert.match(en, /Invoicestopayat/i);
    assert.ok(!/LagoonDMC/.test(en), 'solo i propri dati');
  } finally {
    s.close();
  }
});

test('CSV: saldo iniziale, movimenti, saldo finale; importi con la virgola', async () => {
  const s = await start();
  try {
    const { partner, other } = s;
    const { inv } = invoiced(s);
    invoiced(s, other);
    const month = monthOf(inv);
    const res = await partner(`/it/b2b/statement.csv?month=${month}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv; charset=utf-8/);
    assert.match(res.headers.get('content-disposition'), new RegExp(`attachment; filename="estratto-conto-${month}\\.csv"`));
    const bytes = Buffer.from(await res.arrayBuffer()); // text() toglie da solo il BOM: per vederlo si leggono i byte
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 con BOM, per Excel');
    const csv = bytes.toString('utf8');
    assert.ok(csv.startsWith('\ufeffData;Documento;Dettaglio;Scadenza;Importo;Saldo\r\n'));
    const rows = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(rows.length, 4, 'intestazione, saldo iniziale, una fattura, saldo finale');
    assert.match(rows[1], /^\d{4}-\d{2}-01;Saldo iniziale;;;;0,00$/);
    assert.match(rows[2], new RegExp(`^${inv.issue_date};Fattura ${inv.number.replace('/', '\\/')};;\\d{4}-\\d{2}-\\d{2};114,00;114,00$`));
    assert.match(rows[3], /^\d{4}-\d{2}-\d{2};Saldo finale;;;;114,00$/);
    assert.ok(!/BlueSail/.test(csv));
  } finally {
    s.close();
  }
});

test('scelta dell’email mensile: si salva (e si vede solo se l’invio automatico è acceso)', async () => {
  const off = await start();
  try {
    assert.doesNotMatch(await text(await off.partner('/it/b2b/statement')), /Ricevi l’estratto conto per email/, 'invio spento: nessuna scelta da fare');
  } finally {
    off.close();
  }
  const s = await start({ statements: { enabled: true, day: 3 } });
  try {
    const { app, partner, agency } = s;
    const page = await text(await partner('/it/b2b/statement'));
    assert.match(page, /name="on" value="1" checked/, 'di partenza lo vuole');
    const month = nowRome().date.slice(0, 7);
    const off1 = await partner('/it/b2b/statement/email', form({ month }));
    assert.equal(off1.status, 303);
    assert.equal(loc(off1), `/it/b2b/statement?month=${month}&flash=saved`);
    assert.equal(app.db.prepare('SELECT statement_email FROM accounts WHERE id = ?').get(agency.id).statement_email, 0);
    const after = await text(await partner(`/it/b2b/statement?month=${month}&flash=saved`));
    assert.doesNotMatch(after, /name="on" value="1" checked/);
    assert.match(after, /Scelta salvata\./);
    await partner('/it/b2b/statement/email', form({ on: '1', month }));
    assert.equal(app.db.prepare('SELECT statement_email FROM accounts WHERE id = ?').get(agency.id).statement_email, 1);
    // un mese inventato nel modulo non rompe nulla
    assert.equal(loc(await partner('/it/b2b/statement/email', form({ on: '1', month: '../x' }))), `/it/b2b/statement?month=${month}&flash=saved`);
  } finally {
    s.close();
  }
});

test('pannello: la scheda partner ha il link, lo stesso estratto conto, PDF, CSV e l’invio per email', async () => {
  const s = await start({ statements: { enabled: true, day: 3 } });
  try {
    const { app, admin, anon, partner, agency } = s;
    const { inv } = invoiced(s);
    const month = monthOf(inv);
    const detail = await text(await admin(`/admin/partners/${agency.id}`));
    assert.match(detail, new RegExp(`href="/admin/partners/${agency.id}/statement"`));
    assert.equal((await anon(`/admin/partners/${agency.id}/statement`)).status, 302, 'serve l’accesso del pannello');
    assert.equal((await partner(`/admin/partners/${agency.id}/statement`)).status, 302, 'un’agenzia non entra nel pannello');
    assert.equal((await admin('/admin/partners/9999/statement')).status, 404);

    const page = await text(await admin(`/admin/partners/${agency.id}/statement?month=${month}`));
    assert.match(page, /Estratto conto · Lagoon DMC/);
    assert.match(page, new RegExp(`Fattura ${inv.number.replace('/', '\\/')}`));
    assert.match(page, new RegExp(`href="/admin/invoices/${inv.id}/pdf"`));
    assert.ok(!/Come pagare/.test(page), 'il pannello non mostra i pulsanti per pagare');
    assert.match(page, /L’invio automatico a inizio mese è attivo/);
    assert.match(page, new RegExp(`href="/admin/partners/${agency.id}/statement.pdf\\?month=${month}"`));
    const pdf = await admin(`/admin/partners/${agency.id}/statement.pdf?month=${month}`);
    assert.equal(pdf.status, 200);
    assert.ok(isPdf(Buffer.from(await pdf.arrayBuffer())));
    const csv = await (await admin(`/admin/partners/${agency.id}/statement.csv?month=${month}`)).text();
    assert.match(csv, /Fattura \d+\/\d{4}/);

    // invio manuale: l'email va all'agenzia, con il PDF, e si registra
    const sent = await admin(`/admin/partners/${agency.id}/statement/send`, form({ month }));
    assert.equal(sent.status, 303);
    assert.equal(loc(sent), `/admin/partners/${agency.id}/statement?month=${month}&ok=sent`);
    const mail = app.mail.sent.at(-1);
    assert.equal(mail.to, agency.email);
    assert.match(mail.subject, /^Estratto conto .* — /);
    assert.equal(mail.attachments.length, 1);
    assert.equal(mail.attachments[0].filename, `estratto-conto-${month}.pdf`);
    assert.ok(isPdf(mail.attachments[0].content));
    assert.match(mail.text, /Saldo al .*: 114\s€/);
    assert.match(mail.text, new RegExp(`http://localhost/it/b2b/statement\\?month=${month}`));
    assert.equal(app.db.prepare('SELECT status FROM statement_sends WHERE account_id = ? AND month = ?').get(agency.id, month).status, 'sent');
    assert.match(await text(await admin(`/admin/partners/${agency.id}/statement?month=${month}&ok=sent`)), /Estratto conto inviato\./);
    // dal pannello non si manda ad altri né si cambia il mese a piacere
    assert.match(loc(await admin(`/admin/partners/${agency.id}/statement/send`, form({ month: '2099-01' }))), new RegExp(`month=${nowRome().date.slice(0, 7)}`));
    // un'agenzia in attesa di approvazione non ha la scheda nel pannello
    const pending = addAccount(app.db, { email: 'nuova@example.com', company: 'Nuova', contact_name: 'N', status: 'pending' });
    assert.doesNotMatch(await text(await admin(`/admin/partners/${pending.id}`)), /statement"/);
  } finally {
    s.close();
  }
});

// ───────────── invio mensile ─────────────
const T_MAR3 = (h) => localToInstant('2027-03-03', h);

/** Un'app con un'agenzia per ogni caso: una con una fattura a febbraio, una senza nulla, una che non vuole l'email, una in inglese. */
async function monthly() {
  const s = await start({ statements: { enabled: true, day: 3 } });
  const { app, agency, other } = s;
  const quiet = addAccount(app.db, { email: 'quiet@example.com', company: 'Quiet Tours', contact_name: 'Quinto Quieti', lang: 'it' });
  const nope = addAccount(app.db, { email: 'nope@example.com', company: 'Nope Tours', contact_name: 'Nora Nope', lang: 'it', statement_email: 0 });
  const pending = addAccount(app.db, { email: 'pending@example.com', company: 'Pending', contact_name: 'Paolo Pending', status: 'pending' });
  try {
    // prima si emettono tutte (le fatture si numerano in ordine di data), poi si portano a febbraio, con la scadenza 30 giorni dopo
    const issued = [agency, other, nope].map((acct) => invoiced(s, acct).inv);
    for (const inv of issued) {
      app.db.prepare('UPDATE invoices SET issue_date = ? WHERE id = ?').run('2027-02-10', inv.id);
      app.db.prepare('UPDATE invoices SET payments_json = ? WHERE id = ?').run(JSON.stringify(JSON.parse(getInvoice(app.db, inv.id).payments_json).map((p) => (p.dueDate ? { ...p, dueDate: '2027-03-12' } : p))), inv.id);
    }
  } catch (err) {
    s.close();
    throw err;
  }
  return { ...s, quiet, nope, pending };
}

test('invio mensile: dal giorno scelto alle 9, a chi ha qualcosa da leggere, una volta sola', async () => {
  const s = await monthly();
  try {
    const { app, agency, other, quiet, nope, pending } = s;
    const sweep = (ms) => app.statements.sweep(ms);
    assert.equal(app.statements.dueMonth(T_MAR3('08:59')), null, 'prima delle 9 no');
    assert.equal(app.statements.dueMonth(localToInstant('2027-03-02', '12:00')), null, 'prima del giorno scelto no');
    assert.equal(app.statements.dueMonth(T_MAR3('09:00')), '2027-02', 'il mese scorso');
    assert.equal(app.statements.dueMonth(localToInstant('2027-03-28', '23:00')), '2027-02', 'e così fino a fine mese');
    assert.equal(app.statements.dueMonth(localToInstant('2027-01-05', '10:00')), '2026-12', 'a gennaio: dicembre dell’anno prima');
    assert.equal(await sweep(T_MAR3('08:00')), 0);
    assert.equal(app.mail.sent.length, 0);

    assert.equal(await sweep(T_MAR3('09:05')), 2, 'le due agenzie con una fattura aperta');
    const mails = app.mail.sent.filter((m) => /Estratto conto|Statement of account/.test(m.subject));
    assert.deepEqual(mails.map((m) => m.to).sort(), [agency.email, other.email].sort());
    const it = mails.find((m) => m.to === agency.email);
    assert.match(it.subject, /^Estratto conto febbraio 2027 — /);
    assert.equal(it.attachments[0].filename, 'estratto-conto-2027-02.pdf');
    assert.ok(isPdf(it.attachments[0].content));
    assert.match(it.text, /^Ciao Giulia Bianchi,/);
    assert.match(it.text, /Saldo al 28 feb 2027: 114\s€/);
    assert.doesNotMatch(it.text, /Di cui scaduto/, 'a fine febbraio la scadenza (12 marzo) è ancora lontana');
    const en = mails.find((m) => m.to === other.email);
    assert.match(en.subject, /^Statement of account February 2027 — /);
    assert.match(en.text, /^Hi Bruno Neri,/);
    assert.match(en.text, /Balance at 28 Feb 2027/);
    assert.equal(en.replyTo, 'guida@example.com');

    const sends = app.db.prepare('SELECT account_id, status FROM statement_sends WHERE month = ? ORDER BY account_id').all('2027-02');
    assert.deepEqual(sends.map((x) => [x.account_id, x.status]), [[agency.id, 'sent'], [other.id, 'sent'], [quiet.id, 'skipped']], 'chi non ha nulla è saltato; chi non lo vuole e chi non è approvato non compaiono');
    assert.ok(!sends.some((x) => x.account_id === nope.id || x.account_id === pending.id));
    // non si manda due volte
    const before = app.mail.sent.length;
    assert.equal(await sweep(T_MAR3('09:06')), 0);
    assert.equal(await sweep(localToInstant('2027-03-10', '12:00')), 0);
    assert.equal(app.mail.sent.length, before);
    // il mese dopo ne parte uno nuovo (per chi ha ancora un saldo aperto)
    assert.equal(await sweep(localToInstant('2027-04-03', '09:30')), 2);
    const march = app.mail.sent.filter((m) => /marzo 2027/.test(m.subject) && m.to === agency.email);
    assert.equal(march.length, 1);
    assert.match(march[0].text, /Di cui scaduto: 114\s€/, 'a fine marzo la fattura è scaduta da 19 giorni');
  } finally {
    s.close();
  }
});

test('invio mensile: spento di base e con il pannello; un invio non riuscito si riprova dopo mezz’ora', async () => {
  const s = await monthly();
  try {
    const { app, agency } = s;
    app.cfg.statements.enabled = false;
    assert.equal(await app.statements.sweep(T_MAR3('10:00')), 0);
    assert.equal(app.mail.sent.length, 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM statement_sends').get().n, 0, 'spento: non si registra nulla');
    app.cfg.statements.enabled = true;

    // la posta non funziona: nulla viene registrato, e si riprova dopo mezz’ora
    const real = app.mail.send;
    let calls = 0;
    app.mail.send = async (m) => { calls++; return false; };
    assert.equal(await app.statements.sweep(T_MAR3('10:00')), 0);
    const first = calls;
    assert.ok(first >= 2);
    assert.equal(await app.statements.sweep(T_MAR3('10:10')), 0);
    assert.equal(calls, first, 'non si riprova subito');
    assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM statement_sends WHERE status = 'sent'`).get().n, 0);
    app.mail.send = real;
    assert.equal(await app.statements.sweep(T_MAR3('10:31')), 2, 'passata mezz’ora riparte');
    assert.equal(app.db.prepare(`SELECT status FROM statement_sends WHERE account_id = ? AND month = '2027-02'`).get(agency.id).status, 'sent');
  } finally {
    s.close();
  }
});

test('invio mensile: senza PDF l’email parte lo stesso; un saldo a credito lo dice', async () => {
  const s = await monthly();
  try {
    const { app, agency } = s;
    const real = app.statements.pdf;
    app.statements.pdf = async () => { throw new Error('boom'); };
    const ok = await app.statements.send(agency, '2027-02', T_MAR3('10:00'));
    assert.equal(ok, true);
    assert.deepEqual(app.mail.sent.at(-1).attachments, []);
    app.statements.pdf = real;

    // incassata e poi stornata: l'agenzia ha un credito
    const inv = app.db.prepare('SELECT * FROM invoices WHERE account_id = ?').get(agency.id);
    app.db.prepare('UPDATE invoices SET paid_at = ?, paid_method = ? WHERE id = ?').run(new Date(localToInstant('2027-02-20', '10:00')).toISOString(), 'bank', inv.id);
    const draft = createCreditNote(app, inv.id, T_MAR3('10:00'));
    const d = invoiceDetail(app, draft.id);
    saveDraft(app, draft.id, { buyer: JSON.parse(getInvoice(app.db, draft.id).buyer_json), lines: [{ description: 'Storno parziale', amountCents: 2800 }], issueDate: d.inv.issue_date, options: { bolloCharged: false, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: null } });
    const cn = issueInvoice(app, draft.id, T_MAR3('10:00'));
    app.db.prepare('UPDATE invoices SET issue_date = ? WHERE id = ?').run('2027-02-25', cn.id);
    assert.equal(await app.statements.send(agency, '2027-02', T_MAR3('10:00')), true);
    const mail = app.mail.sent.at(-1);
    assert.match(mail.text, /Saldo al 28 feb 2027: [-−]28\s€/);
    assert.match(mail.text, /credito a tuo favore di 28\s€/);
    assert.doesNotMatch(mail.text, /Di cui scaduto/);
  } finally {
    s.close();
  }
});
