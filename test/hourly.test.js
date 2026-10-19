// Servizi a ore: pagina del calcolatore, prenotazione con ore e supplementi, servizi riservati alle agenzie,
// pannello delle tariffe e modulo dei tour.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { confirmPaid, createBooking, expireBooking, getBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { meetingOf, pickupText } from '../server/choices.js';
import { openDb } from '../server/db.js';
import { dayClass, extraHourOptions, normalizeRates, parseServiceRecord } from '../server/rates.js';
import { addDays, dayOfWeek, nowRome } from '../server/time.js';
import { addAccount } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-hourly-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const R = normalizeRates(null);

const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (fields = {}) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) sp.append(k, x); // campi ripetuti (giorni, lingue)
  return { method: 'POST', headers: urlencoded, body: sp.toString() };
};
const loc = (res) => res.headers.get('location');
const nb = (s) => s.replace(/\u00a0/g, ' '); // gli importi hanno uno spazio non divisibile prima del simbolo dell'euro

/** Il primo giorno, da `from` giorni in là, che non è né festivo né domenica (e non cade di sabato se `weekday`). */
function plainDay(from = 10) {
  for (let n = from; n < from + 20; n++) {
    const d = addDays(nowRome().date, n);
    if (dayClass(d, R) === 'feriale' && ![0, 6].includes(dayOfWeek(d))) return d;
  }
  throw new Error('nessun giorno feriale');
}
/** La prima domenica da `from` giorni in là. */
function sunday(from = 10) {
  for (let n = from; n < from + 10; n++) if (dayOfWeek(addDays(nowRome().date, n)) === 0) return addDays(nowRome().date, n);
  throw new Error('nessuna domenica');
}

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, policy: { allowPayOnSite: true }, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') }); // contenuto nel database, come nel sito vero
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
  const anon = jar();
  const admin = jar();
  await admin('/admin/login', post({ password: 'segreto-admin' }));
  // un partner approvato, con sconto del 15%
  const partnerRow = addAccount(app.db, { email: 'dmc@example.com', password_hash: await hashPassword('prova-prova-1'), company: 'Lagoon DMC', contact_name: 'Giulia Bianchi', discount_percent: 15 });
  const partner = jar();
  await partner('/it/b2b/login', post({ email: 'dmc@example.com', password: 'prova-prova-1' }));
  return { app, cfg, base, anon, admin, partner, partnerRow, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('servizi a ore: il pubblico vede la guida a ore con le tariffe al pubblico, il preventivo e gli orari liberi', async () => {
  const s = await start();
  try {
    const { anon } = s;
    const page = await (await anon(`/it/hourly?date=${plainDay()}`)).text().then(nb);
    assert.match(page, /<h1>Guida privata<\/h1>/);
    assert.match(page, /Mezza giornata · 4 ore[^]*?380 €/, 'tariffa al pubblico per 4 ore');
    for (const price of ['200 €', '700 €', '90 €']) assert.ok(page.includes(price), price);
    assert.match(page, /Festivi: domeniche, 6 gen, 25 apr/);
    assert.match(page, /Superfestivi: 25 dic, 1 gen, Pasqua/);
    assert.match(page, /Notturno, dalle 20:00 alle 07:00[^]*?\+30%/);
    assert.match(page, /Auricolari \(obbligatori\): 4 € a persona, da 9 persone/);
    assert.ok(!page.includes('Assistente in loco') && !page.includes('Tour leader'), 'i servizi per agenzie non si vedono');
    assert.ok(!page.includes('160 €'), 'né le tariffe agenzie');
    assert.match(page, /Operazione senza IVA \(regime forfettario\)/);

    // giorno feriale, 4 ore, 10 persone con auricolari: 380 + 40
    const date = plainDay();
    const q = await (await anon(`/it/hourly?product=guida-a-ore&date=${date}&hours=4&pax=10`)).text().then(nb);
    assert.match(q, /Servizio, 4 ore<\/dt><dd>380 €/);
    assert.match(q, /Auricolari \(10 × 4 €\)<\/dt><dd>40 €/);
    assert.match(q, /Totale<\/dt><dd>420 €/);
    assert.match(q, /Scegli l’orario di inizio/);
    const slots = [...q.matchAll(/class="slot" href="([^"]+)"><strong>(\d\d:\d\d)<\/strong><small>([^<]+)<\/small>/g)];
    assert.ok(slots.length > 8, `${slots.length} orari`);
    assert.ok(slots.some(([, , time]) => time === '09:00'));
    const first = slots.find(([, , time]) => time === '09:30');
    assert.equal(first[3].trim(), '420 €');
    assert.match(first[1], new RegExp(`/it/book/checkout\\?tour=guida-a-ore&amp;date=${date}&amp;time=09:30&amp;pax=10&amp;hours=4`));
    // un orario serale: 4 ore dalle 16:00 sconfinano nella fascia notturna (20:00-24:00 = 2 ore su 4, +30% su metà di 380)
    const late = slots.find(([, , time]) => time === '15:30');
    if (late) assert.match(late[3], /(?:\d+\s)?€/);

    // domenica: +20%
    const sun = await (await anon(`/it/hourly?product=guida-a-ore&date=${sunday()}&hours=2&pax=2`)).text().then(nb);
    assert.match(sun, /Supplemento festivo \(20%\)<\/dt><dd>40 €/);
    assert.match(sun, /Totale<\/dt><dd>240 €/);
    // senza data: preventivo indicativo
    assert.match(await (await anon(`/it/hourly?date=${plainDay()}&hours=3`)).text().then(nb), /Scegli l’orario di inizio/);
    // standard di prenotazione dei privati: senza una data si sceglie dal tour (elenco o pagina del tour)
    const toTours = await anon('/it/hourly?hours=3', { redirect: 'manual' });
    assert.equal(toTours.status, 302);
    assert.equal(toTours.headers.get('location'), '/it/tours?kind=private');
    assert.equal((await anon('/it/hourly?product=guida-a-ore', { redirect: 'manual' })).headers.get('location'), '/it/tours/guida-a-ore');
    // durata o servizio non validi tornano a valori ammessi, senza errori
    assert.equal((await anon(`/it/hourly?product=meet-and-greet&hours=abc&pax=0&date=${plainDay()}`)).status, 200);
    assert.equal((await anon(`/en/hourly?date=${plainDay()}`)).status, 200);
    assert.match(await (await anon(`/en/hourly?date=${plainDay()}`)).text().then(nb), /Private guide/);
  } finally {
    s.close();
  }
});

test('servizi a ore: i partner vedono tutti i servizi con le loro tariffe (sconto compreso); i servizi per agenzie sono chiusi al pubblico', async () => {
  const s = await start();
  try {
    const { anon, partner } = s;
    const page = await (await partner('/it/hourly')).text().then(nb);
    assert.match(page, /Servizi a ore per agenzie/);
    for (const name of ['Servizio guida', 'Assistente in loco', 'Tour leader', 'Meet &amp; greet']) assert.ok(page.includes(name), name);
    // guida 4 ore: 300 − 15% = 255; guida 2 ore: 160 − 15% = 136 → 140; assistente 2 ore: 80 − 15% = 68 → 70 (sempre al multiplo di 5 € successivo)
    assert.match(page, /Mezza giornata · 4 ore[^]*?255 €/);
    assert.match(page, /Servizio guida[^]*?140 €/, '160 − 15% = 136 → 140');
    assert.match(page, /Assistente in loco[^]*?70 €/);
    assert.match(page, /Nelle fatture alle imprese|Operazione senza IVA/);
    // il menu dei servizi
    assert.match(page, /<option value="assistente-a-ore"/);
    assert.match(page, /<option value="meet-and-greet"/);

    // pagina «Per agenzie» e conto del partner
    // le tariffe per le agenzie non compaiono mai nella pagina aperta a tutti (nemmeno per un partner che la visita)
    for (const who of [anon, partner]) {
      const landing = await (await who('/it/b2b')).text().then(nb);
      assert.ok(!landing.includes('Le mie tariffe a ore'));
      assert.ok(!/Assistente in loco/.test(landing) && !/id="tariffe"/.test(landing), 'nessuna tariffa agenzie nella pagina pubblica');
    }
    const account = await (await partner('/it/b2b/rates')).text().then(nb);
    assert.match(account, /Le tue tariffe/);
    assert.match(account, /Assistente in loco[^]*?70 €/);
    assert.ok(!/passeggiata|servizio-mezza/i.test(account));

    // il pubblico non può vedere né prenotare i servizi per agenzie
    for (const slug of ['assistente-a-ore', 'tour-leader', 'meet-and-greet']) {
      assert.equal((await anon(`/it/tours/${slug}`)).status, 404, slug);
      assert.equal((await partner(`/it/tours/${slug}`)).status, 200, `${slug} per il partner`);
      const date = plainDay();
      const denied = await anon('/it/book/checkout', post({ tour: slug, date, time: '10:00', pax: '5', hours: '2', name: 'Mario', email: 'mario@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }));
      assert.equal(denied.status, 400, `${slug}: prenotazione negata`);
    }
    assert.ok(!(await (await anon('/sitemap.xml')).text().then(nb)).includes('assistente-a-ore'));
    assert.equal((await anon('/api/slots?tour=guida-a-ore&date=' + plainDay() + '&pax=2')).status, 400, 'senza le ore il prezzo non si può calcolare');
  } finally {
    s.close();
  }
});

test('home e pagine Tour: due categorie (guida privata e tour di gruppo), senza elenco di tour', async () => {
  const s = await start();
  try {
    const { anon, partner } = s;
    const home = await (await anon('/it/')).text().then(nb);
    assert.match(home, /Come vuoi scoprire Venezia\?/);
    const priv = /<article class="card choice-card reveal" id="private">([^]*?)<\/article>/.exec(home)?.[1] ?? '';
    const group = /<article class="card choice-card reveal" id="group">([^]*?)<\/article>/.exec(home)?.[1] ?? '';
    assert.ok(priv && group, 'le due schede ci sono');
    assert.ok(home.indexOf('id="private"') < home.indexOf('id="group"'), 'prima la guida privata');
    // guida privata: tariffe al pubblico a colpo d'occhio e collegamento al calcolatore
    assert.match(priv, /Guida privata/);
    assert.ok(!/rate-mini|200 €|380 €|700 €/.test(priv), 'nella home niente prezzi orari');
    assert.match(priv, /href="\/it\/tours\?kind=private">Scegli il tuo tour/);
    assert.ok(!priv.includes('160 €'), 'niente tariffe per agenzie');
    // tour di gruppo: prezzo «da» e collegamento all'elenco, senza elenco di partenze (fanno confusione)
    assert.match(group, /Tour di gruppo/);
    assert.match(group, /Da 35 € a persona/);
    assert.ok(!group.includes('class="dep"') && !group.includes('Prossime partenze'), 'niente prossime partenze nella card');
    assert.match(group, /href="\/it\/tours\?kind=group">Scegli il tuo tour/);
    // niente più elenco di tour in home e niente ricerca per data nella prima schermata
    assert.ok(!home.includes('tour-card'), 'nessuna scheda di tour in home');
    assert.ok(!home.includes('quick-search'));
    assert.match(home, /<a class="btn btn-gold" href="\/it\/tours\?kind=private">Guida privata<\/a>\s*<a class="btn btn-outline" href="\/it\/tours\?kind=group">Tour di gruppo<\/a>/);
    // in inglese e spagnolo
    assert.match(await (await anon('/en/')).text(), /How would you like to discover Venice\?[^]*?Private guide[^]*?Group tours/);
    assert.match(await (await anon('/es/')).text(), /¿Cómo quieres descubrir Venecia\?[^]*?Guía privado[^]*?Tours en grupo/);

    // le tariffe orarie non stanno nella home (nemmeno per i partner: le vedono in cima alla loro area riservata)
    assert.ok(!/rate-mini/.test(await (await partner('/it/')).text()));

    // pagina Tour: prima la guida privata, poi i gruppi
    const tours = await (await anon('/it/tours')).text().then(nb);
    assert.ok(tours.indexOf('id="private"') > 0 && tours.indexOf('id="private"') < tours.indexOf('id="group"'));
    assert.match(tours, /Guida privata<\/h2>[^]*?Venezia tra Oriente e Occidente[^]*?Tour di gruppo a posti liberi<\/h2>[^]*?Cannaregio/);
    assert.ok(!tours.includes('Assistente in loco'), 'i servizi per agenzie non si vedono al pubblico');
    assert.match(await (await partner('/it/tours')).text(), /Assistente in loco/);

    // «Prenota» parte sempre dall'elenco dei tour (o dal tour scelto), mai da una ricerca per data
    const goBook = await anon('/it/book', { redirect: 'manual' });
    assert.equal(goBook.status, 302);
    assert.equal(goBook.headers.get('location'), '/it/tours');
    assert.equal((await anon('/it/book?tour=venezia-oriente-occidente', { redirect: 'manual' })).headers.get('location'), '/it/tours/venezia-oriente-occidente');

    // senza servizi privati visibili la scheda sparisce e resta solo il gruppo (il suo pulsante diventa quello principale)
    for (const slug of ['guida-a-ore', 'venezia-oriente-occidente', 'isole-murano-burano-torcello']) assert.equal(loc(await s.admin(`/admin/tours/${slug}/toggle`, post({}))), '/admin/tours?ok=toggled');
    const only = await (await anon('/it/')).text().then(nb);
    assert.ok(!only.includes('id="private"') && only.includes('id="group"'));
    assert.match(only, /<a class="btn btn-gold" href="\/it\/tours\?kind=group">Tour di gruppo<\/a>/);
    assert.ok(!only.includes('href="/it/hourly"'), 'nessun pulsante verso la guida privata');
    assert.ok(!(await (await anon('/it/tours')).text()).includes('id="private"'));
  } finally {
    s.close();
  }
});

test('servizi a ore: prenotazione di un cliente privato (ore, supplementi, orario di fine, conto conservato)', async () => {
  const s = await start();
  try {
    const { app, anon } = s;
    const date = sunday(12);
    const q = `tour=guida-a-ore&date=${date}&time=09:00&pax=10&hours=4`;
    const page = await (await anon(`/it/book/checkout?${q}`)).text().then(nb);
    assert.match(page, /09:00–13:00 <span class="muted">\(4 ore\)<\/span>/);
    assert.match(page, /Servizio, 4 ore<\/dt><dd>380 €/);
    assert.match(page, /Supplemento festivo \(20%\)<\/dt><dd>76 €/);
    assert.match(page, /Auricolari \(10 × 4 €\)<\/dt><dd>40 €/);
    assert.match(page, /Totale<\/dt><dd>496 €/);
    assert.match(page, /name="hours" value="4"/);

    // gli auricolari non sono una scelta: con meno di 9 persone spariscono da soli (cambio che ricalcola senza prenotare)
    const apply = await anon('/it/book/checkout', post({ tour: 'guida-a-ore', date, time: '09:00', pax: '8', hours: '4', name: 'Anna', email: 'anna@example.com', lang: 'it', paymentMethod: 'card', apply: '1' }));
    assert.equal(apply.status, 200);
    assert.match(await apply.text().then(nb), /Totale<\/dt><dd>456 €/); // 380 + 76 festivo, senza auricolari
    assert.ok(!page.includes('name="earpieces"'), 'niente spunta auricolari');

    const res = await anon('/it/book/checkout', post({ tour: 'guida-a-ore', theme: '0', date, time: '09:00', pax: '10', hours: '4', name: 'Anna Verdi', email: 'anna@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }));
    assert.equal(res.status, 303);
    const b = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b.tour_slug, 'guida-a-ore');
    assert.equal(b.start_time, '09:00');
    assert.equal(b.end_time, '13:00');
    assert.equal(b.total_cents, 49600);
    assert.equal(b.list_cents, 49600);
    assert.equal(b.status, 'held');
    const rec = parseServiceRecord(b.service_json);
    assert.equal(rec.hours, 4);
    assert.equal(rec.dayClass, 'festivo');
    assert.deepEqual(rec.lines.map((l) => [l.key, l.cents]), [['base', 38000], ['festivo', 7600], ['earpieces', 4000]]);
    // le tariffe cambiano: la prenotazione conserva il suo conto
    app.rates.save({ ...app.rates.get(), services: { ...app.rates.get().services, guide: { ...app.rates.get().services.guide, public: { prices: [30000, 50000, 90000], extra: 12000 } } } });
    assert.equal(getBooking(app.db, b.id).total_cents, 49600);
    const status = await (await anon(`/it/booking/${b.ref}?t=${b.token}`)).text().then(nb);
    assert.match(status, /09:00–13:00 <span class="muted">\(4 ore\)<\/span>/);
    assert.match(status, /Supplemento festivo \(20%\)<\/dt><dd>76 €/);
    assert.match(status, /Totale<\/dt><dd>496 €/);

    // la fascia occupata (09:00-13:00 + pausa) non è più prenotabile da altri, nemmeno con meno ore
    const again = await (await anon(`/it/hourly?product=guida-a-ore&date=${date}&hours=2&pax=2`)).text().then(nb);
    const times = [...again.matchAll(/class="slot" href="[^"]+"><strong>(\d\d:\d\d)<\/strong>/g)].map((m) => m[1]);
    assert.ok(!times.includes('09:00') && !times.includes('12:00') && !times.includes('13:00'), times.join(' '));
    assert.ok(times.includes('13:30'), 'dopo la pausa si può prenotare');
    assert.equal((await anon('/it/book/checkout', post({ tour: 'guida-a-ore', theme: '1', date, time: '10:00', pax: '2', hours: '2', name: 'Bob', email: 'bob@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }))).status, 409);

    // durate o auricolari impossibili
    const bad = (extra) => anon(`/it/book/checkout?tour=guida-a-ore&date=${plainDay(15)}&time=10:00&pax=2&${extra}`);
    for (const extra of ['hours=1', 'hours=2.25', 'hours=13', 'hours=abc', '']) assert.equal((await bad(extra)).status, 400, extra || 'senza ore');
  } finally {
    s.close();
  }
});

test('prenotazione di un’agenzia registrata dall’admin: agenda, area dell’agenzia, prezzo concordato, nuova agenzia con password provvisoria', async () => {
  const s = await start();
  try {
    const { app, admin, partner, partnerRow } = s;
    const date = plainDay(14);
    const form = await (await admin('/admin/agenda/agency')).text().then(nb);
    assert.match(form, new RegExp(`<option value="${partnerRow.id}"[^>]*>[^<]*${partnerRow.company}`));
    assert.match(form, /＋ Nuova agenzia/);
    assert.match(form, /data-agency-search/);
    assert.ok(!form.includes('value="guida-a-ore"'), 'solo i servizi per le agenzie');
    assert.equal(loc(await s.anon('/admin/agenda/agency')), '/admin/login', 'solo per l’admin');

    // agenzia già registrata, con il prezzo concordato
    const post1 = { agency: String(partnerRow.id), tour: 'guida-a-ore-agenzie', date, time: '10:00', pax: '4', hours: '4', price: '350,50', clientRef: 'Pratica 77', sendMail: '1' };
    const ok = await admin('/admin/agenda/agency', post(post1));
    assert.equal(ok.status, 200);
    assert.match(await ok.text().then(nb), /Registrata\.[^]*?350,50 €[^]*?da fatturare/);
    const b = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.deepEqual([b.channel, b.account_id, b.status, b.total_cents, b.payment_method, b.payment_status, b.client_ref, b.start_time, b.end_time], ['b2b', partnerRow.id, 'confirmed', 35050, 'invoice', 'unpaid', 'Pratica 77', '10:00', '14:00']);
    assert.ok(app.mail.sent.some((m) => m.to === partnerRow.email && /confermata/i.test(m.subject)), 'conferma all’agenzia');
    // l'agenzia la vede nelle sue prenotazioni; l'admin nell'agenda
    const mine = nb(await (await partner('/it/b2b/bookings?view=all')).text());
    assert.match(mine, /Pratica 77/);
    assert.match(mine, /350,50 €/);
    assert.match(nb(await (await admin(`/admin/bookings/${b.id}`)).text()), /Pratica 77/);
    // già pagata, e nessun controllo sulle disponibilità: stesso orario di nuovo
    const again = await admin('/admin/agenda/agency', post({ ...post1, clientRef: 'Pratica 78', price: '', paid: '1', sendMail: '' }));
    assert.equal(again.status, 200);
    const b2 = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b2.payment_status, 'paid');
    assert.ok(b2.total_cents > 0 && b2.total_cents !== 35050, 'senza prezzo vale la tariffa dell’agenzia');

    // errori: prezzo, servizio dei privati, agenzia mancante, ore mancanti
    const n0 = app.db.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    assert.equal((await admin('/admin/agenda/agency', post({ ...post1, price: 'boh' }))).status, 400);
    assert.equal((await admin('/admin/agenda/agency', post({ ...post1, tour: 'guida-a-ore' }))).status, 400);
    assert.equal((await admin('/admin/agenda/agency', post({ ...post1, agency: '' }))).status, 400);
    assert.equal((await admin('/admin/agenda/agency', post({ ...post1, agency: '99999' }))).status, 400);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM bookings').get().n, n0, 'nessuna prenotazione creata');

    // nuova agenzia: account approvato con password provvisoria che funziona
    const fresh = await admin('/admin/agenda/agency', post({ agency: 'new', company: 'Nuova Viaggi Srl', contact_name: 'Marta Neri', email: 'marta@nuova.example', phone: '+39 333 1234567', discount: '10', tour: 'guida-a-ore-agenzie', date, time: '15:00', pax: '2', hours: '2', price: '200' }));
    assert.equal(fresh.status, 200);
    const html = await fresh.text().then(nb);
    const temp = /Password provvisoria[^<]*<code>([^<]+)<\/code>/.exec(html)?.[1];
    assert.ok(temp && temp.length >= 10, 'password provvisoria mostrata una volta');
    const acct = app.db.prepare("SELECT * FROM accounts WHERE email = 'marta@nuova.example'").get();
    assert.deepEqual([acct.status, acct.company, acct.discount_percent], ['approved', 'Nuova Viaggi Srl', 10]);
    const login = await s.anon('/it/b2b/login', post({ email: 'marta@nuova.example', password: temp }));
    assert.equal(loc(login), '/it/b2b/account', 'la nuova agenzia entra con la password provvisoria');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM bookings WHERE account_id = ?').get(acct.id).n, 1);
    // stessa email di nuovo: errore, niente doppioni; un errore nella prenotazione non lascia l'agenzia creata a metà
    assert.equal((await admin('/admin/agenda/agency', post({ agency: 'new', company: 'X', contact_name: 'Y', email: 'marta@nuova.example', tour: 'guida-a-ore-agenzie', date, time: '15:00', pax: '2', hours: '2' }))).status, 400);
    assert.equal((await admin('/admin/agenda/agency', post({ agency: 'new', company: 'Zeta', contact_name: 'Z', email: 'zeta@nuova.example', tour: 'guida-a-ore-agenzie', date, time: '15:00', pax: '999', hours: '2' }))).status, 400);
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM accounts WHERE email = 'zeta@nuova.example'").get().n, 0);
  } finally {
    s.close();
  }
});

test('punto d’incontro per le agenzie: facoltativo, senza «Campo San Luca», si indica anche dopo dalla modifica della prenotazione', async () => {
  const s = await start();
  try {
    const { app, partner, partnerRow } = s;
    const date = plainDay(14);
    assert.equal(app.content.tour('guida-a-ore-agenzie').meetingChoice, true);
    const co = nb(await (await partner(`/it/book/checkout?tour=guida-a-ore-agenzie&date=${date}&time=10:00&pax=2&hours=2`)).text());
    assert.match(co, /<input name="pickup"/);
    assert.match(co, /lo puoi indicare anche dopo, modificando la prenotazione/);
    assert.ok(!co.includes('Campo San Luca'), 'niente punto standard per le agenzie');
    // senza indicarlo: vale il testo del servizio («Concordato con te…»)
    const res = await partner('/it/book/checkout', post({ tour: 'guida-a-ore-agenzie', date, time: '10:00', pax: '2', hours: '2', name: 'Giulia', email: partnerRow.email, lang: 'it', paymentMethod: 'invoice', consent: '1' }));
    assert.equal(res.status, 303);
    const b = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b.pickup, null);
    const page = nb(await (await partner(`/it/b2b/bookings/${b.ref}`)).text());
    assert.match(page, /Punto d’incontro<\/dt><dd>Concordato con te/);
    assert.ok(!page.includes('Campo San Luca'));
    assert.match(page, /<input name="pickup"[^>]*value=""/, 'si può indicare dopo');
    // lo indica dopo: compare ovunque
    const edit = await partner(`/it/b2b/bookings/${b.ref}/edit`, post({ name: 'Giulia', clientRef: '', phone: '', notes: '', pickup: 'Hotel Gritti' }));
    assert.equal(edit.status, 303);
    assert.equal(app.db.prepare('SELECT pickup FROM bookings WHERE id = ?').get(b.id).pickup, 'Hotel Gritti');
    assert.match(nb(await (await partner(`/it/b2b/bookings/${b.ref}`)).text()), /Punto d’incontro<\/dt><dd>Hotel Gritti/);
    assert.match(app.mail.sent.find((m) => m.to === 'guida@example.com' && /Prenotazione modificata/.test(m.subject))?.text ?? '', /Punto d’incontro: — → Hotel Gritti/);
  } finally {
    s.close();
  }
});

test('servizi a ore per agenzie: ore extra su un servizio a durata fissa (2 ore → 1; 4 ore → 1-3; 8 ore → nessuna)', async () => {
  const s = await start();
  try {
    const { app, partner, anon } = s;
    const svc = app.content.tour('assistente-a-ore');
    for (const [hours, expected] of [[2, [1]], [4, [1, 2, 3]], [8, []]]) {
      Object.assign(svc, { chooseHours: false, durationMin: hours * 60 });
      assert.deepEqual(extraHourOptions(svc, 'b2b'), expected, `${hours} ore`);
    }
    assert.deepEqual(extraHourOptions(svc, 'b2c'), [], 'solo per le agenzie');
    Object.assign(svc, { durationMin: 240 });
    const date = plainDay(14);
    const q = (extra) => `tour=assistente-a-ore&date=${date}&time=10:00&pax=4${extra}`;
    const base = nb(await (await partner(`/it/book/checkout?${q('')}`)).text());
    assert.match(base, /name="extra"[^>]*data-apply/);
    assert.match(base, /<option value="3" >\+ 3 ore<\/option>/);
    assert.ok(!/<option value="4" >\+/.test(base), 'oltre le 7 ore ci sarebbe lo scaglione successivo');
    const longer = nb(await (await partner(`/it/book/checkout?${q('&extra=2')}`)).text());
    assert.match(longer, /10:00–16:00 <span class="muted">\(6 ore\)<\/span>/);
    assert.match(longer, /<option value="2" selected>/);
    assert.equal((await partner(`/it/book/checkout?${q('&extra=4')}`)).status, 400, 'extra non ammesse');
    // la prenotazione conserva le ore totali
    const res = await partner('/it/book/checkout', post({ tour: 'assistente-a-ore', date, time: '10:00', pax: '4', extra: '2', name: 'Giulia Bianchi', email: 'dmc@example.com', lang: 'it', paymentMethod: 'invoice', consent: '1' }));
    assert.equal(res.status, 303);
    const b = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b.end_time, '16:00');
    assert.equal(parseServiceRecord(b.service_json).hours, 6);
    // i privati non possono allungare un servizio fisso
    const noExtra = await anon('/it/book/checkout?tour=guida-a-ore&date=' + date + '&time=10:00&pax=2&extra=1');
    assert.ok(noExtra.status === 400 || !(await noExtra.text()).includes('name="extra"'));
    // pagina del preventivo: la scelta compare solo per l'agenzia, e il totale segue
    const page = nb(await (await partner(`/it/hourly?product=assistente-a-ore&date=${date}&pax=4&extra=2`)).text());
    assert.match(page, /name="extra"/);
    assert.match(page, /<option value="2" selected>\+ 2 ore<\/option>/);
    assert.match(page, /Servizio, 6 ore/, "il preventivo segue le ore extra");
  } finally {
    s.close();
  }
});

test('servizi a ore: prenotazione di un partner a fattura con sconto, itinerari a durata fissa, e annullo', async () => {
  const s = await start();
  try {
    const { app, partner, partnerRow } = s;
    const date = plainDay(14);
    // assistente, 4 ore: 110 € − 15% = 93,50 → 95 € (multiplo di 5 € successivo)
    const res = await partner('/it/book/checkout', post({ tour: 'assistente-a-ore', date, time: '10:00', pax: '20', hours: '4', name: 'Giulia Bianchi', email: 'dmc@example.com', lang: 'it', paymentMethod: 'invoice', clientRef: 'PRATICA 7', consent: '1' }));
    assert.equal(res.status, 303);
    const b = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b.channel, 'b2b');
    assert.equal(b.account_id, partnerRow.id);
    assert.equal(b.total_cents, 9500);
    assert.equal(b.status, 'confirmed');
    assert.equal(b.payment_method, 'invoice');
    assert.equal(b.end_time, '14:00');
    assert.equal(parseServiceRecord(b.service_json).discountPercent, 15);
    // la conferma al cliente e l'avviso alla guida dicono quante ore sono
    const confirm = app.mail.sent.find((m) => m.to === 'dmc@example.com' && /confermata/i.test(m.subject));
    assert.match(confirm.text, /Orario: 10:00–14:00 \(4 ore\)/);
    assert.match(app.mail.sent.find((m) => m.to === 'guida@example.com' && /Nuova prenotazione/.test(m.subject))?.text ?? '', /Servizio a ore: 4 ore/);
    // e la scheda nel pannello
    const detail = await s.admin(`/admin/bookings/${b.id}`).then((r) => r.text().then(nb));
    assert.match(detail, /Servizio a ore<\/dt><dd>4 ore<\/dd>/);
    assert.match(detail, /Servizio, 4 ore<\/dt><dd>95 €/);

    // itinerario a durata fissa (3 ore): non si sceglie la durata; 230 € per le agenzie, meno il 15% = 195,5 → 200 €
    const fixed = await (await partner(`/it/book/checkout?tour=venezia-oriente-occidente-agenzie&date=${date}&time=15:00&pax=6`)).text().then(nb);
    assert.match(fixed, /15:00–18:00 <span class="muted">\(3 ore\)<\/span>/);
    assert.match(fixed, /Totale<\/dt><dd>200 €/);
    assert.ok(!fixed.includes('name="hours"'), 'durata fissa: nessun campo');
    assert.equal((await partner(`/it/book/checkout?tour=venezia-oriente-occidente&date=${date}&time=15:00&pax=6`)).status, 400, 'il tour B2C non è per le agenzie');
    // la stessa cosa al pubblico: 200 + 90 = 290 €
    const publicFixed = await (await s.anon(`/it/book/checkout?tour=venezia-oriente-occidente&date=${date}&time=15:00&pax=6`)).text().then(nb);
    assert.match(publicFixed, /Totale<\/dt><dd>290 €/);
    // un parametro «hours» su un itinerario fisso è ignorato
    assert.match(await (await partner(`/it/book/checkout?tour=venezia-oriente-occidente-agenzie&date=${date}&time=15:00&pax=6&hours=8`)).text().then(nb), /\(3 ore\)/);
    // l'itinerario ha la sua scheda con «Calcola e prenota»
    const tourPage = await (await s.anon('/it/tours/venezia-oriente-occidente')).text().then(nb);
    assert.match(tourPage, /290 €<small> \/ 3 ore<\/small>/);
    assert.ok(tourPage.includes('data-widget data-hourly') && !tourPage.includes('data-hours'), 'calendario con orari e prezzo; la durata è fissa: niente scelta delle ore');
    // elenco tour e carta
    assert.match(await (await s.anon('/it/tours')).text().then(nb), /da 200 €<small> \/ 2 ore<\/small>/);
    // annullo secondo la politica del partner
    const cancel = await partner(`/it/booking/${b.ref}/cancel`, post({ t: b.token }));
    assert.equal(cancel.status, 303);
  } finally {
    s.close();
  }
});

test('servizi a ore: se un pagamento scade, alla conferma si ricontrolla la durata scelta (non quella minima)', () => {
  const app = (() => {
    const dir = path.join(tmp, 'x' + crypto.randomBytes(3).toString('hex'));
    const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, demoPayments: true, policy: { allowPayOnSite: true } });
    return createApp({ cfg, db: openDb(':memory:') }).app;
  })();
  try {
    const date = plainDay(20);
    const now = Date.now();
    const common = { tourSlug: 'guida-a-ore', theme: '0', date, pax: 4, name: 'Anna Verdi', email: 'anna@example.com', lang: 'it', paymentMethod: 'card' };
    const a = createBooking(app, { ...common, time: '09:00', hours: 4 }, now); // 09:00-13:00 con pagamento in sospeso
    expireBooking(app.db, a.id, now);
    createBooking(app, { ...common, email: 'bob@example.com', time: '12:00', hours: 2 }, now); // 12:00-14:00 occupa la parte finale
    const r = confirmPaid(app, a.id, 'pi_x', now);
    assert.equal(r.outcome, 'conflict', 'con le sole 2 ore minime non ci sarebbe conflitto: con le 4 scelte sì');
    // senza conflitto, conferma
    const c = createBooking(app, { ...common, time: '15:00', hours: 3 }, now);
    expireBooking(app.db, c.id, now);
    assert.equal(confirmPaid(app, c.id, 'pi_y', now).outcome, 'confirmed');
  } finally {
    app.close();
  }
});

test('tariffe a ore nel pannello: modulo, salvataggio, errori, ripristino, e effetto sul sito', async () => {
  const s = await start();
  try {
    const { admin, anon } = s;
    assert.equal(loc(await anon('/admin/rates')), '/admin/login');
    assert.equal(loc(await anon('/admin/rates', post({}))), '/admin/login');

    const page = await (await admin('/admin/rates')).text().then(nb);
    assert.match(page, /<title>Tariffe a ore · Admin<\/title>/);
    assert.match(page, /cifre iniziali/);
    assert.match(page, /name="guide\.public\.p1" inputmode="decimal" autocomplete="off" value="380"/);
    assert.match(page, /name="guide\.b2b\.extra"[^>]*value="70"/);
    assert.match(page, /name="festivoPct"[^>]*value="20"/);
    assert.match(page, /aria-current="page">Tariffe a ore<\/a>/, 'voce nel menu Sito');

    const form = (over = {}) => {
      const f = {};
      const rates = s.app.rates.get();
      for (const [service, channels] of Object.entries(rates.services)) {
        for (const [ch, rate] of Object.entries(channels)) {
          rate.prices.forEach((c, i) => { f[`${service}.${ch}.p${i}`] = String(c / 100); });
          f[`${service}.${ch}.extra`] = String(rate.extra / 100);
        }
      }
      return { ...f, festivoPct: '20', superFestivoPct: '50', nightPct: '30', nightFrom: '20:00', nightTo: '07:00', earpieceCents: '4', earpieceFromPax: '8', holidays: rates.days.holidays, superHolidays: rates.days.superHolidays, sundays: '1', showB2bPublic: '1', ...over };
    };
    // errori: non si salva nulla e il modulo conserva ciò che è stato scritto
    const bad = await admin('/admin/rates', post(form({ 'guide.public.p0': 'tanto', festivoPct: '-5', holidays: '31-02' })));
    assert.equal(bad.status, 400);
    const badHtml = await bad.text().then(nb);
    assert.match(badHtml, /Alcune cifre non sono valide/);
    assert.match(badHtml, /value="tanto"/);
    assert.match(badHtml, /Scrivi un importo in euro/);
    assert.match(badHtml, /Non capisco: 31-02/);
    assert.match(await (await anon(`/it/hourly?date=${plainDay()}`)).text().then(nb), /200 €/, 'invariato');

    // salvataggio: la tariffa del pubblico cambia subito sul sito
    const ok = await admin('/admin/rates', post(form({ 'guide.public.p0': '210', 'guide.public.p1': '400,50', festivoPct: '25', earpieceCents: '3,5', nightPct: '0' })));
    assert.equal(loc(ok), '/admin/rates?ok=saved');
    assert.match(await (await admin('/admin/rates?ok=saved')).text().then(nb), /Tariffe salvate/);
    const pub = await (await anon(`/it/hourly?date=${plainDay()}`)).text().then(nb);
    assert.ok(pub.includes('210 €'), 'nuova tariffa 2 ore'); assert.ok(pub.includes('400,50 €'), 'nuova tariffa 4 ore');
    assert.match(pub, /Auricolari \(obbligatori\): 3,50 € a persona/);
    assert.ok(!/Notturno, dalle/.test(pub), 'supplemento a zero: non compare');
    assert.match(await (await anon(`/it/hourly?date=${sunday()}&hours=2&pax=2`)).text().then(nb), /Supplemento festivo \(25%\)<\/dt><dd>53 €/, '25% di 210 € = 52,5 → 53 €');
    // il tour a durata fissa segue le nuove tariffe
    assert.match(await (await anon('/it/tours')).text().then(nb), /da 210 €<small> \/ 2 ore<\/small>/);

    // una tariffa al pubblico non apre ai privati un tour B2B: serve un tour B2C (un tour è dell'uno o dell'altro)
    const open = await admin('/admin/rates', post(form({ 'meetgreet.public.p0': '60', 'meetgreet.public.extra': '35' })));
    assert.equal(loc(open), '/admin/rates?ok=saved');
    assert.ok(!(await (await anon(`/it/hourly?date=${plainDay()}`)).text().then(nb)).includes('<option value="meet-and-greet"'), 'il tour meet & greet resta per le agenzie');
    const dup = await (await admin('/admin/tours/new?from=meet-and-greet&audience=b2c')).text().then(nb);
    assert.match(dup, /<option value="b2c" selected>/, 'duplicato come tour B2C');
    const copy = await admin('/admin/tours', post({ slug: 'meet-and-greet-privati', title_it: 'Meet & greet', summary_it: 'Ti aspetto all’arrivo.', audience: 'b2c', model: 'group', pricing: 'hourly', service: 'meetgreet', flexible: '1', wd: ['0', '1', '2', '3', '4', '5', '6'], durH: '1', durM: '0', maxParticipants: '10', active: '1', payOnSite: '1', langs: ['it'] }));
    assert.equal(copy.status, 303);
    assert.match(await (await anon(`/it/hourly?date=${plainDay()}`)).text().then(nb), /<option value="meet-and-greet-privati"/, 'ora il meet & greet è disponibile ai privati');
  } finally {
    s.close();
  }
});

test('tariffe a ore nel pannello: ripristino delle cifre iniziali', async () => {
  const s = await start();
  try {
    const { admin, app } = s;
    app.rates.save({ ...app.rates.get(), surcharges: { ...app.rates.get().surcharges, festivoPct: 33 } });
    assert.equal(app.rates.isCustom(), true);
    assert.match(await (await admin('/admin/rates')).text().then(nb), /Ripristina le tariffe iniziali/);
    assert.equal(loc(await admin('/admin/rates/reset', post({}))), '/admin/rates?ok=reset');
    assert.equal(app.rates.isCustom(), false);
    assert.equal(app.rates.get().surcharges.festivoPct, 20);
    assert.match(await (await admin('/admin/rates?ok=reset')).text().then(nb), /riportate alle cifre iniziali/);
  } finally {
    s.close();
  }
});

test('tour dal pannello: servizio a ore (prezzo dalle tariffe) e prezzo fisso, listino senza i servizi a ore', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const list = await (await admin('/admin/tours')).text().then(nb);
    assert.match(list, /Servizio guida · a ore \(il cliente sceglie le ore\)/);
    assert.match(list, /href="\/admin\/rates">dalle tariffe a ore/);
    assert.match(list, /Servizio guida · a ore \(il cliente sceglie le ore\)[^]*?da 200 €/, 'il prezzo di oggi, dalla tabella');
    assert.match(list, /Venezia tra Oriente e Occidente[^]*?290 €/, 'durata fissa: il prezzo della tabella per 3 ore');
    const listB2b = await (await admin('/admin/tours-b2b')).text().then(nb);
    assert.match(listB2b, /Assistente in loco · a ore/);
    assert.ok(!list.includes('Assistente in loco'), 'sono in sezioni diverse');
    const prices = await (await admin('/admin/prices')).text().then(nb);
    assert.ok(!prices.includes('name="price_guida-a-ore"'), 'i servizi a ore non hanno un prezzo fisso');
    assert.match(prices, /name="price_san-marco-rialto"/);
    assert.match(prices, /Tariffe a ore/);
    assert.equal((await admin('/admin/prices', post({ 'price_san-marco-rialto': '36', 'price_san-marco-rialto-agenzie': '29', 'price_cannaregio-ghetto': '35', 'price_cannaregio-ghetto-agenzie': '28' }))).status, 303, 'il listino si salva senza i servizi a ore');

    const form = await (await admin('/admin/tours/guida-a-ore')).text().then(nb);
    assert.match(form, /name="pricing" value="hourly" checked/);
    assert.match(form, /name="chooseHours" value="1" checked/);
    assert.match(form, /<option value="guide" selected>/);

    const TOUR = { slug: 'serata-a-ore', title_it: 'Venezia di sera', summary_it: 'Una passeggiata serale.', model: 'group', pricing: 'hourly', service: 'guide', chooseHours: '1', flexible: '1', wd: ['0', '1', '2', '3', '4', '5', '6'], durH: '2', durM: '0', maxParticipants: '12', active: '1', langs: ['it'], art: 'bridge', order: '9' };
    const created = await admin('/admin/tours', post(TOUR));
    if (created.status !== 303) console.log((await created.text().then(nb)).match(/notice-err[^]*?<\/div>/)?.[0]);
    assert.equal(loc(created), '/admin/tours/serata-a-ore?ok=created', 'il prezzo non serve se è a ore');
    const t = s.app.content.tour('serata-a-ore');
    assert.equal(t.pricing, 'hourly');
    assert.equal(t.service, 'guide');
    assert.equal(t.chooseHours, true);
    assert.match(await (await s.anon(`/it/hourly?date=${plainDay()}`)).text().then(nb), /<option value="serata-a-ore"/);
    // durata che non va con il servizio (il tour leader parte da 4 ore)
    const bad = await admin('/admin/tours', post({ ...TOUR, slug: 'leader-corto', service: 'leader', durH: '2' }));
    assert.equal(bad.status, 400);
    assert.match(await bad.text().then(nb), /va da 4 a 8 ore/);
    // un prezzo fisso senza prezzo non è valido
    const noPrice = await admin('/admin/tours', post({ ...TOUR, slug: 'senza-prezzo', pricing: 'fixed', service: 'guide' }));
    assert.equal(noPrice.status, 400);
    assert.match(await noPrice.text().then(nb), /Prezzo al pubblico: scrivi un importo/);
    // riservato alle agenzie
    assert.equal(loc(await admin('/admin/tours/serata-a-ore', post({ ...TOUR, audience: 'b2b' }))), '/admin/tours/serata-a-ore?ok=saved');
    assert.equal(s.app.content.tour('serata-a-ore').audience, 'b2b');
    assert.equal((await s.anon('/it/tours/serata-a-ore')).status, 404);
  } finally {
    s.close();
  }
});

test('tariffe a ore e tour a ore: il prezzo dei tour segue sempre la tabella, e il pannello lo mostra', async () => {
  const s = await start();
  try {
    const { admin, anon } = s;
    // le tariffe elencano i tour che le usano, con il prezzo di oggi
    const rates = await (await admin('/admin/rates')).text().then(nb);
    assert.match(rates, /Usano queste tariffe[^]*?Venezia tra Oriente e Occidente<\/a> · Tour B2C · 3 ore fisse → <strong>290 €<\/strong>/);
    assert.match(rates, /Assistente in loco<\/a> · Tour B2B · ore a scelta → <strong>da 80 € \(2 ore\)<\/strong>/);
    assert.ok(!rates.includes('prezzo fisso e non'), 'nessun avviso: non ci sono servizi privati a prezzo fisso');
    // cambio la guida di 2 ore e l'ora in più: il tour a durata fissa (3 ore) e il preventivo seguono da soli
    const r = s.app.rates.get();
    s.app.rates.save({ ...r, services: { ...r.services, guide: { ...r.services.guide, public: { prices: [18000, ...r.services.guide.public.prices.slice(1)], extra: 10000 } } } });
    assert.match(await (await admin('/admin/rates')).text().then(nb), /Venezia tra Oriente e Occidente<\/a> · Tour B2C · 3 ore fisse → <strong>280 €<\/strong>/, '180 + 100');
    assert.match(await (await admin('/admin/tours')).text().then(nb), /Venezia tra Oriente e Occidente[^]*?280 €/);
    assert.match(await (await anon('/it/tours')).text().then(nb), /da 180 €<small> \/ 2 ore<\/small>/);
    const form1 = await (await admin('/admin/tours/venezia-oriente-occidente')).text().then(nb);
    assert.match(form1, /Prezzo di oggi, dalle tariffe a ore: <strong>280 €<\/strong> per 3 ore \(durata fissa\)/);
    // un servizio privato a prezzo fisso non segue la tabella: il pannello lo dice, nel tour e nelle tariffe
    const TOUR = { slug: 'gondola-privata', title_it: 'Gondola privata', summary_it: 'Un’ora in gondola.', audience: 'b2c', model: 'group', pricing: 'fixed', price: '160', flexible: '1', wd: ['0', '1', '2', '3', '4', '5', '6'], durH: '2', durM: '0', maxParticipants: '5', active: '1', payOnSite: '1', langs: ['it'] };
    assert.equal(loc(await admin('/admin/tours', post(TOUR))), '/admin/tours/gondola-privata?ok=created');
    assert.match(await (await admin('/admin/tours/gondola-privata')).text().then(nb), /Prezzo fisso su un servizio privato\.<\/strong> Non segue le tariffe a ore/);
    assert.match(await (await admin('/admin/rates')).text().then(nb), /Attenzione:[^]*?non segue[^]*?Gondola privata<\/a> \(160 €\)/);
    assert.match(await (await admin('/admin/tours')).text().then(nb), /Gondola privata[^]*?160 €<br><small[^>]*>prezzo fisso/);
    // il prezzo fisso di un tour a persona (condiviso) non ha l'avviso: non c'è una tariffa oraria equivalente
    assert.ok(!(await (await admin('/admin/tours/san-marco-rialto')).text().then(nb)).includes('Prezzo fisso su un servizio privato'));
  } finally {
    s.close();
  }
});

test('Guida privata B2C su misura: ore scelte dal cliente (a ore intere), festivo/notturno automatici, scelta tematica con «Altro» e testo per la guida', async () => {
  const s = await start();
  try {
    const { app, anon } = s;
    const t = app.content.tour('guida-a-ore');
    assert.deepEqual([t.roundHours, t.themeOther, t.i18n.it.themes.length], [true, true, 2]);
    assert.equal(app.content.tour('guida-a-ore-agenzie').i18n.it.themes.length, 0, 'la copia per le agenzie non ha scelte tematiche');
    assert.equal(app.content.tour('guida-a-ore-agenzie').roundHours, false);
    const date = plainDay(21); // un giorno feriale
    const base = { tour: 'guida-a-ore', date, time: '10:00', pax: '2', hours: '2.5' };
    // la durata, dove il cliente sceglie le ore: «A partire da» quella indicata nel tour (card, elenco e pagina del tour)
    assert.match(await (await anon('/it/tours?kind=private')).text().then(nb), /A partire da 2 ore/);
    assert.match(await (await anon('/it/tours/guida-a-ore')).text().then(nb), /fact-v">A partire da 2 ore/);
    // il modulo: la scelta tematica con «Altro» e la durata a mezze ore pagata a ore intere
    const co = await (await anon(`/it/book/checkout?${new URLSearchParams(base)}`)).text().then(nb);
    assert.match(co, /Che tipo di tour vuoi\?/);
    assert.match(co, /name="theme" value="0"[^]*?Classici imperdibili \(must-see\)/);
    assert.match(co, /name="theme" value="1"[^]*?Angoli nascosti \(hidden gems\)/);
    assert.match(co, /name="theme" value="other"/);
    assert.match(co, /<textarea name="themeNote"/);
    assert.match(await (await anon(`/it/hourly?product=guida-a-ore&date=${date}&hours=2.5&pax=2`)).text().then(nb), /Si paga a ore intere: per esempio 2,5 ore costano come 3/);
    assert.match(co, /<input name="pickup"[^>]*maxlength="200"/, 'il cliente può scrivere dove incontrarsi');
    assert.match(co, /Se lasci vuoto, ci vediamo a Campo San Luca/);
    assert.match(co, /Servizio, 3 ore/, 'si pagano 3 ore');
    assert.match(co, /Totale<\/dt><dd>290 €/);
    assert.match(co, /10:00–12:30/, 'ma il servizio dura 2,5 ore');
    // senza scegliere non si prenota; «Altro» senza testo nemmeno
    const form = (over = {}) => post({ ...base, name: 'Anna', email: 'anna@example.com', lang: 'it', paymentMethod: 'onsite', consent: '1', ...over });
    const none = await anon('/it/book/checkout', form());
    assert.equal(none.status, 400);
    assert.match(await none.text().then(nb), /Scegli che tipo di tour vuoi/);
    assert.equal((await anon('/it/book/checkout', form({ theme: 'other', themeNote: ' ' }))).status, 400);
    assert.equal((await anon('/it/book/checkout', form({ theme: '7' }))).status, 400);
    // «Altro» con il testo
    const other = await anon('/it/book/checkout', form({ theme: 'other', themeNote: 'Vorrei vedere i luoghi di Casanova, con calma.' }));
    assert.equal(other.status, 303);
    const b = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b.total_cents, 29000);
    assert.equal(b.end_time, '12:30');
    assert.equal(b.theme_note, 'Vorrei vedere i luoghi di Casanova, con calma.');
    assert.equal(parseServiceRecord(b.service_json).hours, 2.5);
    // punto d'incontro lasciato vuoto: quello standard, ovunque
    assert.equal(b.pickup, null);
    const bookingHtml = await (await anon(`/it/booking/${b.ref}?t=${b.token}`)).text().then(nb);
    assert.match(bookingHtml, /Punto d’incontro<\/dt><dd>Campo San Luca · <a href="https:\/\/www\.google\.com\/maps/);
    assert.match(app.mail.sent.find((m) => m.to === 'mario@example.com' || m.to === 'anna@example.com').text, /Campo San Luca/);
    assert.match(app.mail.sent.find((m) => m.to === 'guida@example.com' && /Nuova prenotazione/.test(m.subject)).text, /Punto d’incontro: Campo San Luca \(standard/);
    assert.match(await (await anon(`/it/booking/${b.ref}/calendar.ics?t=${b.token}`)).text(), /LOCATION:Campo San Luca/);
    // la guida, il pannello e il cliente lo leggono
    assert.match(app.mail.sent.find((m) => m.to === 'guida@example.com' && /Nuova prenotazione/.test(m.subject)).text, /Scelta del cliente: Altro: Vorrei vedere i luoghi di Casanova, con calma\./);
    assert.match(await (await s.admin(`/admin/bookings/${b.id}`)).text().then(nb), /Scelta del cliente<\/dt><dd>Altro: Vorrei vedere i luoghi di Casanova/);
    assert.match(await (await anon(`/it/booking/${b.ref}?t=${b.token}`)).text().then(nb), /Che tipo di tour vuoi\?<\/dt><dd>Altro: Vorrei vedere/);
    // una voce della lista, in inglese: la guida la legge in italiano, il cliente nella sua lingua
    const date2 = plainDay(Math.round((Date.parse(date) - Date.parse(nowRome().date)) / 86400000) + 1); // un altro giorno feriale, dopo il primo
    const en = await anon('/en/book/checkout', post({ ...base, date: date2, name: 'Mark', email: 'mark@example.com', lang: 'en', theme: '1', pickup: 'Hotel Danieli', paymentMethod: 'onsite', consent: '1' }));
    assert.equal(en.status, 303);
    const b2 = app.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
    assert.equal(b2.theme_note, null);
    assert.equal(b2.pickup, 'Hotel Danieli');
    assert.match(await (await anon(`/en/booking/${b2.ref}?t=${b2.token}`)).text().then(nb), /Meeting point<\/dt><dd>Hotel Danieli/);
    assert.match(await (await s.admin(`/admin/bookings/${b2.id}`)).text().then(nb), /Punto d’incontro<\/dt><dd>Hotel Danieli/);
    assert.match(app.mail.sent.find((m) => m.to === 'guida@example.com' && b2.ref && /Nuova prenotazione/.test(m.subject) && m.text.includes(b2.ref)).text, /Scelta del cliente: Angoli nascosti \(hidden gems\)/);
    assert.match(await (await anon(`/en/booking/${b2.ref}?t=${b2.token}`)).text().then(nb), /What kind of tour would you like\?<\/dt><dd>Hidden gems/);
    // domenica: festivo automatico, sempre sulle ore intere
    const sun = await anon(`/it/book/checkout?${new URLSearchParams({ ...base, date: sunday() })}`);
    assert.match(await sun.text().then(nb), /Supplemento festivo \(20%\)<\/dt><dd>58 €/);
    // un tour con punto d'incontro fisso non chiede dove incontrarsi e non conserva il campo
    assert.equal(app.content.tour('cannaregio-ghetto').meetingChoice, false);
    assert.equal(app.content.tour('guida-a-ore').meetingChoice, true);
    assert.equal(meetingOf(app.content.tour('cannaregio-ghetto'), { pickup: 'Hotel X' }, 'it').text, app.content.tour('cannaregio-ghetto').i18n.it.meetingPoint);
    assert.equal(pickupText(app.content.tour('cannaregio-ghetto'), 'Hotel X'), null);
    // i tour senza scelte tematiche non le chiedono
    assert.ok(!(await (await anon(`/it/book/checkout?tour=venezia-oriente-occidente&date=${date}&time=15:00&pax=2`)).text()).includes('name="theme"'));
  } finally {
    s.close();
  }
});

test('tour dal pannello: ore intere, scelta tematica e «Altro» si salvano e si rileggono', async () => {
  const s = await start();
  try {
    const TOUR = { slug: 'su-misura', title_it: 'Su misura', summary_it: 'Costruiamo insieme il tuo giro.', audience: 'b2c', model: 'group', pricing: 'hourly', service: 'guide', chooseHours: '1', roundHours: '1', themeOther: '1', flexible: '1', wd: ['0', '1', '2', '3', '4', '5', '6'], durH: '2', durM: '0', maxParticipants: '12', active: '1', payOnSite: '1', langs: ['it', 'en'], themes_it: 'Classici\nAngoli nascosti', title_en: 'Tailor-made', summary_en: 'We build your walk together.', themes_en: 'Classics\nHidden gems' };
    assert.equal(loc(await s.admin('/admin/tours', post(TOUR))), '/admin/tours/su-misura?ok=created');
    const t = s.app.content.tour('su-misura');
    assert.deepEqual([t.roundHours, t.themeOther, t.i18n.it.themes, t.i18n.en.themes], [true, true, ['Classici', 'Angoli nascosti'], ['Classics', 'Hidden gems']]);
    assert.deepEqual(t.i18n.es.themes, ['Classics', 'Hidden gems'], 'una lingua senza testi usa quelli inglesi, come il resto del tour');
    const form = await (await s.admin('/admin/tours/su-misura')).text().then(nb);
    assert.match(form, /name="roundHours" value="1" checked/);
    assert.match(form, /name="themeOther" value="1" checked/);
    assert.match(form, /name="themes_it"[^>]*>Classici\nAngoli nascosti<\/textarea>/);
    // un numero diverso di voci in una lingua: valgono quelle italiane (stessi indici per tutti)
    assert.equal(loc(await s.admin('/admin/tours/su-misura', post({ ...TOUR, themes_en: 'Only one' }))), '/admin/tours/su-misura?ok=saved');
    assert.deepEqual(s.app.content.tour('su-misura').i18n.en.themes, ['Classici', 'Angoli nascosti']);
    // «ore intere» vale solo se il cliente sceglie le ore
    await s.admin('/admin/tours/su-misura', post({ ...TOUR, chooseHours: '' }));
    assert.equal(s.app.content.tour('su-misura').roundHours, false);
  } finally {
    s.close();
  }
});

test('tour privati e di gruppo: due elenchi separati; il tour a ore ha il suo calendario con persone, ore, orari liberi e prezzo', async () => {
  const s = await start();
  try {
    const { anon } = s;
    const priv = await (await anon('/it/tours?kind=private')).text().then(nb);
    assert.match(priv, /<h1>Tour privati<\/h1>/);
    assert.match(priv, /\/it\/tours\/guida-a-ore"/);
    assert.ok(!priv.includes('/it/tours/san-marco-rialto"') && !priv.includes('/it/tours/cannaregio-ghetto"'), 'solo privati');
    const group = await (await anon('/it/tours?kind=group')).text().then(nb);
    assert.match(group, /<h1>Tour di gruppo<\/h1>/);
    assert.ok(group.includes('/it/tours/san-marco-rialto"') && !group.includes('/it/tours/guida-a-ore"'), 'solo condivisi');
    assert.match(await (await anon('/it/tours?kind=boh')).text().then(nb), /<h1>Tour e servizi<\/h1>/, 'senza filtro, tutti');
    // la scheda del tour a ore: persone, scelta delle ore, calendario, orari con prezzo
    const page = await (await anon('/it/tours/guida-a-ore')).text().then(nb);
    assert.match(page, /data-widget data-hourly/);
    assert.match(page, /<select data-hours>[^]*?<option value="2\.5" >2,5 ore<\/option>/);
    assert.match(page, /Si paga a ore intere/);
    const date = plainDay(21);
    const api = async (q) => (await anon(`/api/slots?tour=guida-a-ore&date=${date}&pax=2&${q}`)).json();
    const two = await api('hours=2');
    assert.ok(two.slots.length > 0 && two.slots.every((x) => x.totalCents === 20000), '2 ore: 200 € (feriale)');
    const half = await api('hours=2.5');
    assert.ok(half.slots.every((x) => x.totalCents === 29000), '2,5 ore costano come 3: 290 €');
    assert.ok(two.slots.some((x) => x.time === '08:30'));
    const sun = (await (await anon(`/api/slots?tour=guida-a-ore&date=${sunday()}&pax=2&hours=2`)).json()).slots;
    assert.ok(sun.every((x) => x.totalCents === 24000), 'domenica: +20% automatico');
    assert.equal((await anon(`/api/slots?tour=guida-a-ore&date=${date}&pax=2&hours=13`)).status, 400);
    assert.equal((await anon(`/api/slots?tour=guida-a-ore&date=${date}&pax=2&hours=2.25`)).status, 400);
    const month = await (await anon(`/api/availability?tour=guida-a-ore&month=${date.slice(0, 7)}&pax=2&hours=4`)).json();
    assert.ok(Object.keys(month.days).length > 0);
    // durata fissa: niente parametro
    const fixed = await (await anon(`/api/slots?tour=venezia-oriente-occidente&date=${date}&pax=2`)).json();
    assert.ok(fixed.slots.length > 0 && fixed.slots.every((x) => x.totalCents === 29000), '3 ore fisse: 290 €');
    assert.equal((await anon(`/api/slots?tour=guida-a-ore-agenzie&date=${date}&pax=2&hours=2`)).status, 400, 'i tour B2B non sono per i privati');
  } finally {
    s.close();
  }
});
