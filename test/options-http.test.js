// Opzioni delle agenzie, pre-apertura (prima di partire con la partita IVA) e agenda a calendario: le pagine e i moduli, dall'inizio alla fine.
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
import { addDays, localToInstant, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-options-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const nb = (s) => s.replace(/ /g, ' ');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';

async function start(over = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' }, ...over });
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
    f.cookies = cookies;
    return f;
  };
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const hash = await hashPassword(PW);
  const agency = addAccount(app.db, { email: 'giulia@lagoon.example', password_hash: hash, company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', vat: '01234567897', sdi_code: 'ABC1234' });
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  return { app, cfg, base, admin, partner, anon: jar(), jar, agency, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

const checkout = (over = {}) => ({ tour: 'cannaregio-ghetto-agenzie', date: day(40), time: '10:00', pax: '4', name: 'Giulia Bianchi', email: 'giulia@lagoon.example', lang: 'it', clientRef: 'Preventivo Conti', consent: '1', ...over });
const row = (s, ref) => s.app.db.prepare('SELECT * FROM bookings WHERE ref = ?').get(ref);
const refOf = (res) => loc(res).match(/\/(?:booking|pay\/demo|pay\/resume)\/([A-Z0-9-]+)/)[1];

test('opzione dal checkout: l’agenzia tiene la data senza pagare; la guida e l’agenzia lo sanno; i privati non hanno questa strada', async () => {
  const s = await start();
  try {
    const { partner, anon } = s;
    const url = `/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(40)}&time=10:00&pax=4`;
    const page = nb(await (await partner(url)).text());
    assert.match(page, /id="option-submit"/, 'il pulsante «Opziona» c’è per l’agenzia');
    assert.match(page, /Il tuo cliente non ha ancora confermato\?/);
    assert.match(page, /10 giorni/, 'a 40 giorni dal tour l’opzione dura 10 giorni');
    assert.ok(!(await (await anon(url)).text()).includes('option-submit'), 'il pubblico non lo vede');

    const res = await partner('/it/book/checkout', form({ ...checkout(), action: 'option' }));
    assert.equal(res.status, 303);
    const ref = refOf(res);
    const b = row(s, ref);
    assert.equal(b.status, 'option');
    assert.equal(b.channel, 'b2b');
    assert.equal(b.payment_status, 'unpaid');
    assert.equal(b.client_ref, 'Preventivo Conti');
    const left = (Date.parse(b.option_expires_at) - Date.now()) / 86_400_000;
    assert.ok(left > 9.9 && left <= 10.01, `scade fra 10 giorni (${left})`);
    // la pagina della pratica mostra la data trattenuta, il tempo che resta e le due strade
    const mine = nb(await (await partner(loc(res))).text());
    assert.match(mine, /Data trattenuta \(opzione\)/);
    assert.match(mine, /Scade tra 10 giorni/);
    assert.match(mine, /Conferma la prenotazione/);
    assert.match(mine, /Rilascia la data/);
    // email: una all'agenzia, una alla guida
    const sent = s.app.mail.sent.filter((m) => /opzione/i.test(m.subject));
    assert.ok(sent.some((m) => m.to === 'giulia@lagoon.example'), 'all’agenzia');
    assert.ok(sent.some((m) => m.to === 'guida@example.com' && /Nuova opzione/.test(m.subject)), 'alla guida');
    // blocca lo slot: un altro cliente non può prenotarlo
    const taken = await anon('/it/book/checkout', form({ tour: 'cannaregio-ghetto', date: day(40), time: '10:00', pax: '8', name: 'Mario', email: 'm@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }));
    assert.equal(taken.status, 409, 'lo slot è trattenuto dall’opzione: 4 + 8 persone superano i 10 posti');

    // un privato che invia «option» non ottiene nessuna opzione: prenota come sempre
    const priv = await anon('/it/book/checkout', form({ tour: 'san-marco-rialto', date: day(45), time: '09:30', pax: '2', name: 'Mario Rossi', email: 'mario@example.com', lang: 'it', paymentMethod: 'card', consent: '1', action: 'option' }));
    assert.equal(priv.status, 303);
    assert.equal(row(s, refOf(priv)).status, 'held', 'in attesa di pagamento, non «option»');
  } finally {
    s.close();
  }
});

test('opzione: le regole si fanno rispettare (troppo vicino, limite, spenta per il partner, spente per il sito) e senza il consenso non parte nulla', async () => {
  const s = await start({ options: { maxActive: 2 } });
  try {
    const { partner, agency } = s;
    const opt = (over = {}) => partner('/it/book/checkout', form({ ...checkout(over), action: 'option' }));
    // a 2 giorni dal tour l'opzione non c'è: si prenota direttamente
    const near = `/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(3)}&time=10:00&pax=2`;
    const nearPage = nb(await (await partner(near)).text());
    assert.ok(!nearPage.includes('option-submit'));
    assert.match(nearPage, /Per una data così vicina non si può opzionare/);
    const tooClose = await opt({ date: day(2), pax: '2' });
    assert.equal(tooClose.status, 400);
    assert.match(nb(await tooClose.text()), /Per una data così vicina non si può opzionare/);
    assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM bookings WHERE status = 'option'").get().n, 0);

    // senza consenso niente prenotazione
    assert.equal((await opt({ consent: '' })).status, 400);

    // limite: due opzioni aperte, la terza no
    assert.equal((await opt({ date: day(40), time: '10:00' })).status, 303);
    assert.equal((await opt({ date: day(41), time: '10:00' })).status, 303);
    const third = await opt({ date: day(42), time: '10:00' });
    assert.equal(third.status, 400);
    assert.match(nb(await third.text()), /Hai già troppe opzioni aperte/);
    assert.ok(!nb(await (await partner(`/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(42)}&time=10:00&pax=2`)).text()).includes('option-submit'));

    // spenta per questo partner dal pannello: la strada non c'è più (si prenota direttamente)
    s.app.db.prepare('UPDATE accounts SET options_enabled = 0 WHERE id = ?').run(agency.id);
    const off = await (await partner(`/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(43)}&time=10:00&pax=2`)).text();
    assert.ok(!off.includes('option-submit') && !off.includes('Il tuo cliente non ha ancora confermato'));
    assert.equal((await opt({ date: day(43) })).status, 400);
    s.app.db.prepare('UPDATE accounts SET options_enabled = 1 WHERE id = ?').run(agency.id);
    // spente per tutto il sito
    s.cfg.options.enabled = false;
    assert.equal((await opt({ date: day(44) })).status, 400);
    assert.ok(!(await (await partner(`/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(44)}&time=10:00&pax=2`)).text()).includes('option-submit'));
  } finally {
    s.close();
  }
});

test('opzione dalla pagina della pratica: conferma (a fattura o con carta) e rilascia, con il link e con il token giusto', async () => {
  const s = await start();
  try {
    const { partner, anon, app, agency } = s;
    const make = (date) => createBooking(app, { tourSlug: 'cannaregio-ghetto-agenzie', date, time: '10:00', pax: 3, channel: 'b2b', account: agency, option: true, name: 'Giulia Bianchi', email: agency.email, lang: 'it' });
    const a = make(day(30));
    const page = nb(await (await anon(`/it/booking/${a.ref}?t=${a.token}`)).text());
    assert.match(page, /Data trattenuta \(opzione\)/);
    assert.match(page, /name="method"/, 'si sceglie come pagare (fattura o carta)');
    // il token sbagliato non apre nulla né conferma nulla
    assert.equal((await anon(`/it/booking/${a.ref}/option/confirm`, form({ t: 'sbagliato', method: 'invoice' }))).status, 404);
    assert.equal(row(s, a.ref).status, 'option');
    // a fattura: confermata subito, nessun pagamento
    const ok = await anon(`/it/booking/${a.ref}/option/confirm`, form({ t: a.token, method: 'invoice' }));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), `/it/booking/${a.ref}?t=${a.token}&flash=option-confirmed`);
    assert.equal(row(s, a.ref).status, 'confirmed');
    assert.equal(row(s, a.ref).payment_method, 'invoice');
    assert.match(nb(await (await anon(loc(ok))).text()), /Prenotazione confermata/);
    assert.equal((await anon(`/it/booking/${a.ref}/option/confirm`, form({ t: a.token, method: 'invoice' }))).status, 404, 'non è più un’opzione');

    // con carta: si va a pagare (e finché non si paga resta opzione)
    const c = make(day(31));
    const card = await partner(`/it/booking/${c.ref}/option/confirm`, form({ t: c.token, method: 'card' }));
    assert.equal(card.status, 303);
    assert.match(loc(card), /\/pay\//, 'verso il pagamento');
    assert.equal(row(s, c.ref).status, 'held', 'durante il pagamento la data è trattenuta (come per ogni pagamento con carta)');
    assert.ok(row(s, c.ref).option_expires_at, 'e la scadenza dell’opzione si conserva');

    // rilascio: la data si libera, senza annulli né penali; si può tornare alla dashboard
    const d = make(day(32));
    const rel = await partner(`/it/booking/${d.ref}/option/release`, form({ t: d.token, next: '/it/b2b/account' }));
    assert.equal(loc(rel), '/it/b2b/account?flash=option-released');
    assert.equal(row(s, d.ref).status, 'expired');
    assert.equal(row(s, d.ref).cancelled_by, 'customer', 'registra chi l’ha rilasciata');
    assert.equal(row(s, d.ref).retained_cents, 0, 'nessuna penale');
    assert.ok(app.mail.sent.some((m) => m.to === 'guida@example.com' && /rilasciata/i.test(m.subject)), 'la guida sa che la data è libera');
    // l'indirizzo di ritorno è solo interno al sito
    const e = make(day(33));
    assert.equal(loc(await anon(`/it/booking/${e.ref}/option/release`, form({ t: e.token, next: 'https://evil.example/x' }))), `/it/booking/${e.ref}?t=${e.token}&flash=option-released`);
  } finally {
    s.close();
  }
});

test('opzioni dal pannello: elenco, prolunga, rilascio, durata per partner e tabella del sito con le sue validazioni', async () => {
  const s = await start();
  try {
    const { admin, app, agency } = s;
    const o = createBooking(app, { tourSlug: 'cannaregio-ghetto-agenzie', date: day(30), time: '10:00', pax: 3, channel: 'b2b', account: agency, option: true, name: 'Giulia Bianchi', email: agency.email, lang: 'it', clientRef: 'Gruppo Conti' });
    const before = Date.parse(row(s, o.ref).option_expires_at);
    // elenco e scheda
    const list = nb(await (await admin('/admin/bookings?f=options')).text());
    assert.ok(list.includes(o.ref));
    const detail = nb(await (await admin(`/admin/bookings/${o.id}`)).text());
    assert.match(detail, /Prolunga la scadenza/);
    assert.match(detail, /Rilascia la data/);
    // prolungare: una sola volta, l'agenzia viene avvisata
    const ext = await admin(`/admin/bookings/${o.id}/option/extend`, form({ days: '3' }));
    assert.equal(loc(ext), `/admin/bookings/${o.id}?ok=extended`);
    const after = Date.parse(row(s, o.ref).option_expires_at);
    assert.ok(Math.abs(after - before - 3 * 86_400_000) < 1000, 'di 3 giorni');
    assert.ok(app.mail.sent.some((m) => m.to === agency.email && /Opzione prorogata/.test(m.subject)));
    assert.equal(loc(await admin(`/admin/bookings/${o.id}/option/extend`, form({ days: '2' }))), `/admin/bookings/${o.id}?ok=extended`, 'si può prolungare ancora');
    assert.ok(Math.abs(Date.parse(row(s, o.ref).option_expires_at) - after - 2 * 86_400_000) < 1000);
    for (const days of ['0', '-3', '91', 'abc', '']) assert.equal(loc(await admin(`/admin/bookings/${o.id}/option/extend`, form({ days }))), `/admin/bookings/${o.id}`, `giorni non validi: «${days}»`);
    // mai oltre un'ora prima dell'inizio del servizio
    await admin(`/admin/bookings/${o.id}/option/extend`, form({ days: '90' }));
    assert.equal(Date.parse(row(s, o.ref).option_expires_at), localToInstant(day(30), '10:00') - 3600_000);
    assert.equal(loc(await admin('/admin/bookings/9999/option/extend', form({ days: '2' }))), null, 'pratica inesistente: 404');
    // rilascio dalla guida
    const rel = await admin(`/admin/bookings/${o.id}/cancel`, form({ reason: 'Il cliente ha rinunciato' }));
    assert.equal(loc(rel), `/admin/bookings/${o.id}?ok=released`);
    assert.equal(getBooking(app.db, o.id).status, 'expired');
    assert.ok(app.mail.sent.some((m) => m.to === agency.email && /Opzione rilasciata/.test(m.subject)));

    // durata e limite per partner (scheda del partner), con validazione
    const own = await admin(`/admin/partners/${agency.id}/options`, form({ options_enabled: '1', option_days: '7', option_max: '2' }));
    assert.match(loc(own), /ok=options/);
    assert.deepEqual({ ...app.db.prepare('SELECT options_enabled, option_days, option_max FROM accounts WHERE id = ?').get(agency.id) }, { options_enabled: 1, option_days: 7, option_max: 2 });
    assert.match(loc(await admin(`/admin/partners/${agency.id}/options`, form({ option_days: '999', option_max: '2' }))), /err=options/);
    assert.equal(app.db.prepare('SELECT option_days FROM accounts WHERE id = ?').get(agency.id).option_days, 7, 'valore non valido: nulla cambia');
    assert.match(loc(await admin(`/admin/partners/${agency.id}/options`, form({ option_days: '', option_max: '' }))), /ok=options/);
    assert.deepEqual({ ...app.db.prepare('SELECT options_enabled, option_days, option_max FROM accounts WHERE id = ?').get(agency.id) }, { options_enabled: 0, option_days: null, option_max: null }, 'casella non spuntata = opzioni spente; vuoti = valori del sito');
    assert.match(nb(await (await admin(`/admin/partners/${agency.id}`)).text()), /Opzioni/);

    // tabella del sito: salvataggio e validazioni
    const ok = { 'options.enabled': '1', 'options.minReleaseHours': '36', 'options.maxActive': '4', 'options.reminderHours': '12', 'options.tiers.0.from': '7', 'options.tiers.0.days': '2', 'options.tiers.1.from': '30', 'options.tiers.1.days': '9' };
    assert.equal(loc(await admin('/admin/settings/options', form(ok))), '/admin/settings?ok=saved&s=options#options');
    assert.deepEqual(s.cfg.options.tiers, [{ fromDays: 30, days: 9 }, { fromDays: 7, days: 2 }], 'ordinate dalla più lontana');
    assert.deepEqual([s.cfg.options.minReleaseHours, s.cfg.options.maxActive, s.cfg.options.reminderHours], [36, 4, 12]);
    for (const [patch, message] of [
      [{ 'options.tiers.1.from': '7' }, /stesso numero di giorni/],
      [{ 'options.tiers.0.days': '0' }, /da 1 a 90/],
      [{ 'options.tiers.0.days': '91' }, /da 1 a 90/],
      [{ 'options.tiers.0.from': 'tanti' }, /numero intero \(da 0 a 730\)/],
      [{ 'options.tiers.0.from': '900' }, /da 0 a 730/],
      [{ 'options.maxActive': '101' }, /numero intero/],
    ]) {
      const res = await admin('/admin/settings/options', form({ ...ok, ...patch }));
      assert.equal(res.status, 400, JSON.stringify(patch));
      assert.match(await res.text(), message);
    }
    assert.deepEqual(s.cfg.options.tiers, [{ fromDays: 30, days: 9 }, { fromDays: 7, days: 2 }], 'nulla è cambiato con i valori sbagliati');
    // senza righe: nessuna opzione per i servizi vicini (si prenota direttamente)
    assert.equal(loc(await admin('/admin/settings/options', form({ 'options.enabled': '1', 'options.minReleaseHours': '48', 'options.maxActive': '5', 'options.reminderHours': '24' }))), '/admin/settings?ok=saved&s=options#options');
    assert.deepEqual(s.cfg.options.tiers, []);
  } finally {
    s.close();
  }
});

test('agenda del pannello: prima il calendario, si può passare all’elenco e la scelta si ricorda; mesi, giorni e valori strani non rompono nulla', async () => {
  const s = await start();
  try {
    const { admin, app, agency } = s;
    const mine = createBooking(app, { tourSlug: 'san-marco-rialto', date: day(5), time: '14:30', pax: 2, name: 'Mario Rossi', email: 'mario@example.com', lang: 'it', paymentMethod: 'card' });
    app.db.prepare("UPDATE bookings SET status = 'confirmed', payment_status = 'paid' WHERE id = ?").run(mine.id);
    const opt = createBooking(app, { tourSlug: 'cannaregio-ghetto-agenzie', date: day(5), time: '10:00', pax: 2, channel: 'b2b', account: agency, option: true, name: 'Giulia Bianchi', email: agency.email, lang: 'it', clientRef: 'Gruppo Conti' });

    // senza scelta: calendario
    const first = nb(await (await admin('/admin')).text());
    assert.match(first, /class="acal"/);
    assert.ok(!first.includes('class="agenda-day"><h3>'), 'non l’elenco dei 14 giorni');
    assert.match(first, /<a href="\/admin\?v=cal" aria-current="page">Calendario<\/a>/);
    assert.match(first, /ev-opt/, 'l’opzione ha il suo colore');
    assert.match(first, /Opzioni aperte<\/span><strong>1<\/strong>/);
    assert.ok(admin.cookies.get('av') === undefined, 'nessuna scelta, nessun cookie');
    // elenco: la scelta si ricorda
    const list = nb(await (await admin('/admin?v=list')).text());
    assert.ok(!list.includes('class="acal"'));
    assert.match(list, /<section class="agenda-day"><h3>/, 'i giorni con servizi, uno dopo l’altro');
    assert.match(list, /<a href="\/admin\?v=list" aria-current="page">Elenco/);
    assert.equal(admin.cookies.get('av'), 'list');
    assert.ok(!(await (await admin('/admin')).text()).includes('class="acal"'), 'la prossima volta è ancora l’elenco');
    assert.match(await (await admin('/admin?v=cal')).text(), /class="acal"/);
    assert.equal(admin.cookies.get('av'), 'cal');
    assert.match(await (await admin('/admin')).text(), /class="acal"/);
    // un altro browser parte dal calendario
    assert.match(await (await s.jar()('/admin/login')).text(), /password/i);

    // mesi e giorni: navigazione, giorno scelto con le sue prenotazioni, parametri sbagliati ignorati
    const month = day(0).slice(0, 7);
    const target = day(5);
    const sel = nb(await (await admin(`/admin?m=${target.slice(0, 7)}&d=${target}`)).text());
    assert.match(sel, new RegExp(`is-selected[^>]*href="[^"]*d=${target}`));
    assert.ok(sel.includes('Mario Rossi') && sel.includes('Giulia Bianchi'), 'il giorno scelto elenca le prenotazioni e l’opzione');
    assert.match(sel, /OPZIONE|Opzione/);
    for (const q of ['?m=2027-13', '?m=boh&d=nonunadata', `?m=${month}&d=1999-01-01`, '?v=zzz', '?m=2027-02-30']) assert.equal((await admin(`/admin${q}`)).status, 200, q);
    assert.match(nb(await (await admin('/admin?m=2031-05')).text()), /maggio 2031/);
    // il calendario sul telefono (feed .ics) include le opzioni, riconoscibili
    const token = app.db.prepare("SELECT value FROM settings WHERE key = 'feed_token'").get();
    const ics = token ? await (await s.anon(`/admin/calendar.ics?k=${JSON.parse(token.value)}`)).text() : '';
    if (ics) assert.match(ics, /OPZIONE · /);
    // l'opzione scaduta esce dal calendario
    app.db.prepare("UPDATE bookings SET option_expires_at = ? WHERE id = ?").run(new Date(Date.now() - 60_000).toISOString(), opt.id);
    assert.ok(!nb(await (await admin(`/admin?m=${target.slice(0, 7)}&d=${target}`)).text()).includes('Giulia Bianchi'));
  } finally {
    s.close();
  }
});

test('pre-apertura (prima della partita IVA): si prenota per le date da quel giorno, senza incassare online; poi si può pagare dalla pagina della prenotazione', async () => {
  const opening = day(30);
  const s = await start({ policy: { paymentsFrom: opening, allowPayOnSite: false } });
  try {
    const { anon, partner, app } = s;
    // l'avviso c'è nelle pagine che servono
    const book = nb(await (await anon(`/it/book?date=${day(40)}&pax=2`)).text());
    // il selettore di date (JavaScript) c'è nelle pagine del sito e il campo del browser resta sotto, per l'invio e i controlli; anche nel pannello
    assert.match(book, /<script src="\/js\/datepicker\.js\?v=[^"]+" defer><\/script>/);
    assert.match(book, /<input type="date" name="date" min="[\d-]+" value="[\d-]*" required>/);
    assert.ok((await (await s.admin('/admin')).text()).includes('/js/datepicker.js'), 'il selettore c\'è anche nel pannello');
    assert.match(book, /notice-info/);
    assert.match(book, /i pagamenti online partono il/);
    const earlySlots = await (await anon(`/api/slots?tour=san-marco-rialto&date=${day(10)}&pax=2`)).json();
    assert.deepEqual(earlySlots.slots ?? [], [], 'prima della data degli incassi non ci sono date prenotabili');
    const okSlots = await (await anon(`/api/slots?tour=san-marco-rialto&date=${day(40)}&pax=2`)).json();
    assert.ok(okSlots.slots.length > 0);

    // checkout privato: solo il pagamento il giorno del servizio
    const page = nb(await (await anon(`/it/book/checkout?tour=san-marco-rialto&date=${day(40)}&time=09:30&pax=2`)).text());
    assert.match(page, /value="onsite"/);
    assert.ok(!/value="card"/.test(page), 'niente carta online');
    const priv = { tour: 'san-marco-rialto', date: day(40), time: '09:30', pax: '2', name: 'Mario Rossi', email: 'mario@example.com', lang: 'it', consent: '1' };
    assert.equal((await anon('/it/book/checkout', form({ ...priv, paymentMethod: 'card' }))).status, 400, 'la carta non è ammessa');
    assert.equal((await anon('/it/book/checkout', form({ ...priv, date: day(10), paymentMethod: 'onsite' }))).status, 409, 'prima della data degli incassi');
    const okRes = await anon('/it/book/checkout', form({ ...priv, paymentMethod: 'onsite' }));
    assert.equal(okRes.status, 303);
    const ref = refOf(okRes);
    assert.equal(row(s, ref).status, 'confirmed');
    assert.equal(row(s, ref).payment_status, 'unpaid');
    const mine = nb(await (await anon(loc(okRes))).text());
    assert.match(mine, /Prenotazione confermata/);
    assert.ok(!mine.includes('/pay/resume'), 'prima dell’apertura non si può pagare online');

    // agenzie: solo a fattura (mai la carta); l'opzione resta
    const ag = nb(await (await partner(`/it/book/checkout?tour=cannaregio-ghetto-agenzie&date=${day(45)}&time=10:00&pax=2`)).text());
    assert.match(ag, /value="invoice"/);
    assert.ok(!/value="card"/.test(ag));
    assert.match(ag, /option-submit/);
    const invoiced = await partner('/it/book/checkout', form({ ...checkout({ date: day(41), pax: '2' }), paymentMethod: 'invoice' }));
    assert.equal(invoiced.status, 303);
    assert.equal(row(s, refOf(invoiced)).payment_method, 'invoice');

    // buoni regalo e acconti dei programmi non si incassano ancora
    assert.equal(app.gifts.available, false);
    const gift = await anon('/it/gift');
    assert.equal(gift.status, 200);
    // dopo la data degli incassi: tutto come sempre, e chi aveva prenotato può pagare online
    s.cfg.policy.paymentsFrom = day(-1);
    assert.match(nb(await (await anon(`/it/booking/${ref}?t=${row(s, ref).token}`)).text()), /\/pay\/resume\/|Paga ora/);
    assert.match(nb(await (await anon(`/it/book/checkout?tour=san-marco-rialto&date=${day(50)}&time=09:30&pax=2`)).text()), /value="card"/);
  } finally {
    s.close();
  }
});

test('«Incassi dal» nelle impostazioni: si salva una data vera, si toglie lasciando vuoto, una data sbagliata non salva nulla', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const rules = { 'policy.b2cFreeCancelHours': '24', 'policy.b2bFreeCancelHours': '72', 'policy.b2cMinNoticeHours': '12', 'policy.b2bMinNoticeHours': '6', 'policy.maxAdvanceDays': '200', 'policy.bufferMin': '45', 'policy.slotStepMin': '30', 'policy.holdMinutes': '35', 'reminders.enabled': '1', 'reminders.sendHour': '18', 'policy.allowPayOnSite': '1' };
    assert.equal(loc(await admin('/admin/settings/rules', form({ ...rules, 'policy.paymentsFrom': '2027-01-04' }))), '/admin/settings?ok=saved&s=rules#rules');
    assert.equal(s.cfg.policy.paymentsFrom, '2027-01-04');
    assert.match(nb(await (await admin('/admin')).text()), /pre-apertura|Incassi dal|incassi/i, 'l’agenda ricorda che gli incassi non sono ancora attivi');
    const bad = await admin('/admin/settings/rules', form({ ...rules, 'policy.paymentsFrom': '31/12/2026' }));
    assert.equal(bad.status, 400);
    assert.equal(s.cfg.policy.paymentsFrom, '2027-01-04');
    assert.equal(loc(await admin('/admin/settings/rules', form({ ...rules, 'policy.paymentsFrom': '' }))), '/admin/settings?ok=saved&s=rules#rules');
    assert.equal(s.cfg.policy.paymentsFrom, '');
  } finally {
    s.close();
  }
});
