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
import { openDb } from '../server/db.js';
import { dayClass, normalizeRates, parseServiceRecord } from '../server/rates.js';
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
    const page = await (await anon('/it/hourly')).text().then(nb);
    assert.match(page, /<h1>guida privata<\/h1>/);
    assert.match(page, /Mezza giornata · 4 ore[^]*?380 €/, 'tariffa al pubblico per 4 ore');
    for (const price of ['200 €', '700 €', '90 €']) assert.ok(page.includes(price), price);
    assert.match(page, /Festivi: domeniche, 6 gen, 25 apr/);
    assert.match(page, /Superfestivi: 25 dic, 1 gen, Pasqua/);
    assert.match(page, /Notturno, dalle 20:00 alle 07:00[^]*?\+30%/);
    assert.match(page, /Auricolari: 4 € a persona, da 8 persone/);
    assert.ok(!page.includes('Assistente in loco') && !page.includes('Tour leader'), 'i servizi per agenzie non si vedono');
    assert.ok(!page.includes('160 €'), 'né le tariffe agenzie');
    assert.match(page, /Operazione senza IVA \(regime forfettario\)/);

    // giorno feriale, 4 ore, 10 persone con auricolari: 380 + 40
    const date = plainDay();
    const q = await (await anon(`/it/hourly?product=guida-a-ore&date=${date}&hours=4&pax=10&earpieces=1`)).text().then(nb);
    assert.match(q, /Servizio, 4 ore<\/dt><dd>380 €/);
    assert.match(q, /Auricolari \(10 × 4 €\)<\/dt><dd>40 €/);
    assert.match(q, /Totale<\/dt><dd>420 €/);
    assert.match(q, /Scegli l’orario di inizio/);
    const slots = [...q.matchAll(/class="slot" href="([^"]+)"><strong>(\d\d:\d\d)<\/strong><small>([^<]+)<\/small>/g)];
    assert.ok(slots.length > 8, `${slots.length} orari`);
    assert.ok(slots.some(([, , time]) => time === '09:00'));
    const first = slots.find(([, , time]) => time === '09:30');
    assert.equal(first[3].trim(), '420 €');
    assert.match(first[1], new RegExp(`/it/book/checkout\\?tour=guida-a-ore&amp;date=${date}&amp;time=09:30&amp;pax=10&amp;hours=4&amp;earpieces=1`));
    // un orario serale: 4 ore dalle 16:00 sconfinano nella fascia notturna (20:00-24:00 = 2 ore su 4, +30% su metà di 380)
    const late = slots.find(([, , time]) => time === '15:30');
    if (late) assert.match(late[3], /(?:\d+\s)?€/);

    // domenica: +20%
    const sun = await (await anon(`/it/hourly?product=guida-a-ore&date=${sunday()}&hours=2&pax=2`)).text().then(nb);
    assert.match(sun, /Supplemento festivo \(20%\)<\/dt><dd>40 €/);
    assert.match(sun, /Totale<\/dt><dd>240 €/);
    // senza data: preventivo indicativo
    assert.match(await (await anon('/it/hourly?hours=3')).text().then(nb), /Scegli una data per vedere gli orari liberi/);
    // durata o servizio non validi tornano a valori ammessi, senza errori
    assert.equal((await anon('/it/hourly?product=meet-and-greet&hours=abc&pax=0&date=boh')).status, 200);
    assert.equal((await anon('/en/hourly')).status, 200);
    assert.match(await (await anon('/en/hourly')).text().then(nb), /private guide/);
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
    // lo sconto parte dal prezzo al pubblico: guida 4 ore: 380 − 15% = 323 → 325; guida 2 ore: 200 − 15% = 170; assistente (solo agenzie) 2 ore: 80 − 15% = 68 → 70
    assert.match(page, /Mezza giornata · 4 ore[^]*?325 €/);
    assert.match(page, /Servizio guida[^]*?170 €/, '200 − 15% = 170');
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
    assert.equal((await anon('/api/slots?tour=guida-a-ore&date=' + plainDay() + '&pax=2')).status, 400, 'i servizi a ore non passano dal calendario a data fissa');
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
    assert.match(priv, /guida privata/);
    assert.match(priv, /2 ore<\/span><strong>200 €/);
    assert.match(priv, /Mezza giornata · 4 ore<\/span><strong>380 €/);
    assert.match(priv, /Giornata intera · 8 ore<\/span><strong>700 €/);
    assert.match(priv, /href="\/it\/hourly">Calcola il preventivo/);
    assert.ok(!priv.includes('160 €'), 'niente tariffe per agenzie');
    // tour di gruppo: prezzo «da», prossime partenze (al massimo tre) e collegamento a «Prenota»
    assert.match(group, /Tour di gruppo/);
    assert.match(group, /da 35 € a persona/);
    const deps = [...group.matchAll(/class="dep" href="/g)].length;
    assert.ok(deps >= 1 && deps <= 3, `${deps} partenze`);
    assert.match(group, /href="\/it\/book">Vedi tutte le partenze/);
    // niente più elenco di tour in home e niente ricerca per data nella prima schermata
    assert.ok(!home.includes('tour-card'), 'nessuna scheda di tour in home');
    assert.ok(!home.includes('quick-search'));
    assert.match(home, /<a class="btn btn-gold" href="\/it\/hourly">guida privata<\/a>\s*<a class="btn btn-outline" href="\/it\/book">Tour di gruppo<\/a>/);
    // in inglese e spagnolo
    assert.match(await (await anon('/en/')).text(), /How would you like to discover Venice\?[^]*?private guide[^]*?Group tours/);
    assert.match(await (await anon('/es/')).text(), /¿Cómo quieres descubrir Venecia\?[^]*?guía privado[^]*?Tours en grupo/);

    // un partner con lo sconto del 15% vede le sue tariffe, calcolate sul prezzo al pubblico: 200 → 170, 380 → 323 → 325, 700 → 595
    const ph = await (await partner('/it/')).text().then(nb);
    const ppriv = /id="private">([^]*?)<\/article>/.exec(ph)?.[1] ?? '';
    for (const price of ['170 €', '325 €', '595 €']) assert.ok(ppriv.includes(price), price);
    assert.ok(!ppriv.includes('200 €'));

    // pagina Tour: prima la guida privata, poi i gruppi
    const tours = await (await anon('/it/tours')).text().then(nb);
    assert.ok(tours.indexOf('id="private"') > 0 && tours.indexOf('id="private"') < tours.indexOf('id="group"'));
    assert.match(tours, /guida privata<\/h2>[^]*?Venezia tra Oriente e Occidente[^]*?Tour di gruppo a posti liberi<\/h2>[^]*?Cannaregio/);
    assert.ok(!tours.includes('Assistente in loco'), 'i servizi per agenzie non si vedono al pubblico');
    assert.match(await (await partner('/it/tours')).text(), /Assistente in loco/);

    // «Prenota» rimanda alla guida a ore
    assert.match(await (await anon('/it/book')).text(), /Cerchi una guida tutta per te, a ore\?[^]*?href="\/it\/hourly">Calcola il preventivo/);

    // senza servizi privati visibili la scheda sparisce e resta solo il gruppo (il suo pulsante diventa quello principale)
    for (const slug of ['guida-a-ore', 'venezia-oriente-occidente', 'isole-murano-burano-torcello']) assert.equal(loc(await s.admin(`/admin/tours/${slug}/toggle`, post({}))), '/admin/tours?ok=toggled');
    const only = await (await anon('/it/')).text().then(nb);
    assert.ok(!only.includes('id="private"') && only.includes('id="group"'));
    assert.match(only, /<a class="btn btn-gold" href="\/it\/book">Tour di gruppo<\/a>/);
    assert.ok(!only.includes('guida privata'));
    assert.ok(!(await (await anon('/it/book')).text()).includes('Cerchi una guida tutta per te'));
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
    const q = `tour=guida-a-ore&date=${date}&time=09:00&pax=10&hours=4&earpieces=1`;
    const page = await (await anon(`/it/book/checkout?${q}`)).text().then(nb);
    assert.match(page, /09:00–13:00 <span class="muted">\(4 ore\)<\/span>/);
    assert.match(page, /Servizio, 4 ore<\/dt><dd>380 €/);
    assert.match(page, /Supplemento festivo \(20%\)<\/dt><dd>76 €/);
    assert.match(page, /Auricolari \(10 × 4 €\)<\/dt><dd>40 €/);
    assert.match(page, /Totale<\/dt><dd>496 €/);
    assert.match(page, /name="hours" value="4"/);

    // il cliente toglie gli auricolari (cambio che ricalcola senza prenotare)
    const apply = await anon('/it/book/checkout', post({ tour: 'guida-a-ore', date, time: '09:00', pax: '10', hours: '4', name: 'Anna', email: 'anna@example.com', lang: 'it', paymentMethod: 'card', apply: '1' }));
    assert.equal(apply.status, 200);
    assert.match(await apply.text().then(nb), /Totale<\/dt><dd>456 €/);

    const res = await anon('/it/book/checkout', post({ tour: 'guida-a-ore', date, time: '09:00', pax: '10', hours: '4', earpieces: '1', name: 'Anna Verdi', email: 'anna@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }));
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
    assert.equal((await anon('/it/book/checkout', post({ tour: 'guida-a-ore', date, time: '10:00', pax: '2', hours: '2', name: 'Bob', email: 'bob@example.com', lang: 'it', paymentMethod: 'card', consent: '1' }))).status, 409);

    // durate o auricolari impossibili
    const bad = (extra) => anon(`/it/book/checkout?tour=guida-a-ore&date=${plainDay(15)}&time=10:00&pax=2&${extra}`);
    for (const extra of ['hours=1', 'hours=2.25', 'hours=13', 'hours=abc', '']) assert.equal((await bad(extra)).status, 400, extra || 'senza ore');
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

    // itinerario a durata fissa (3 ore): non si sceglie la durata; 290 € al pubblico, meno il 15% = 246,5 → 250 €
    const fixed = await (await partner(`/it/book/checkout?tour=venezia-oriente-occidente&date=${date}&time=15:00&pax=6`)).text().then(nb);
    assert.match(fixed, /15:00–18:00 <span class="muted">\(3 ore\)<\/span>/);
    assert.match(fixed, /Totale<\/dt><dd>250 €/);
    assert.ok(!fixed.includes('name="hours"'), 'durata fissa: nessun campo');
    // la stessa cosa al pubblico: 200 + 90 = 290 €
    const publicFixed = await (await s.anon(`/it/book/checkout?tour=venezia-oriente-occidente&date=${date}&time=15:00&pax=6`)).text().then(nb);
    assert.match(publicFixed, /Totale<\/dt><dd>290 €/);
    // un parametro «hours» su un itinerario fisso è ignorato
    assert.match(await (await partner(`/it/book/checkout?tour=venezia-oriente-occidente&date=${date}&time=15:00&pax=6&hours=8`)).text().then(nb), /\(3 ore\)/);
    // l'itinerario ha la sua scheda con «Calcola e prenota»
    const tourPage = await (await s.anon('/it/tours/venezia-oriente-occidente')).text().then(nb);
    assert.match(tourPage, /Calcola e prenota/);
    assert.match(tourPage, /290 €<small> \/ 3 ore<\/small>/);
    assert.ok(!tourPage.includes('data-widget'), 'niente calendario a data fissa');
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
    const common = { tourSlug: 'guida-a-ore', date, pax: 4, name: 'Anna Verdi', email: 'anna@example.com', lang: 'it', paymentMethod: 'card' };
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
    assert.match(await (await anon('/it/hourly')).text().then(nb), /200 €/, 'invariato');

    // salvataggio: la tariffa del pubblico cambia subito sul sito
    const ok = await admin('/admin/rates', post(form({ 'guide.public.p0': '210', 'guide.public.p1': '400,50', festivoPct: '25', earpieceCents: '3,5', nightPct: '0' })));
    assert.equal(loc(ok), '/admin/rates?ok=saved');
    assert.match(await (await admin('/admin/rates?ok=saved')).text().then(nb), /Tariffe salvate/);
    const pub = await (await anon('/it/hourly')).text().then(nb);
    assert.ok(pub.includes('210 €'), 'nuova tariffa 2 ore'); assert.ok(pub.includes('400,50 €'), 'nuova tariffa 4 ore');
    assert.match(pub, /Auricolari: 3,50 € a persona/);
    assert.ok(!/Notturno, dalle/.test(pub), 'supplemento a zero: non compare');
    assert.match(await (await anon(`/it/hourly?date=${sunday()}&hours=2&pax=2`)).text().then(nb), /Supplemento festivo \(25%\)<\/dt><dd>53 €/, '25% di 210 € = 52,5 → 53 €');
    // il tour a durata fissa segue le nuove tariffe
    assert.match(await (await anon('/it/tours')).text().then(nb), /da 210 €<small> \/ 2 ore<\/small>/);

    // una tariffa al pubblico per un servizio per agenzie lo apre ai privati
    const open = await admin('/admin/rates', post(form({ 'meetgreet.public.p0': '60', 'meetgreet.public.extra': '35' })));
    assert.equal(loc(open), '/admin/rates?ok=saved');
    assert.match(await (await anon('/it/hourly')).text().then(nb), /<option value="meet-and-greet"/, 'ora il meet &amp; greet è disponibile ai privati? solo se il tour non è riservato');
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
    assert.match(list, /Assistente in loco · a ore[^]*?solo agenzie/);
    assert.match(list, /href="\/admin\/rates">tariffe a ore/);
    const prices = await (await admin('/admin/prices')).text().then(nb);
    assert.ok(!prices.includes('name="price_guida-a-ore"'), 'i servizi a ore non hanno un prezzo fisso');
    assert.match(prices, /name="price_san-marco-rialto"/);
    assert.match(prices, /Tariffe a ore/);
    assert.equal((await admin('/admin/prices', post({ 'price_san-marco-rialto': '36', 'b2b_san-marco-rialto': '29', 'price_cannaregio-ghetto': '35', 'b2b_cannaregio-ghetto': '28' }))).status, 303, 'il listino si salva senza i servizi a ore');

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
    assert.match(await (await s.anon('/it/hourly')).text().then(nb), /<option value="serata-a-ore"/);
    // durata che non va con il servizio (il tour leader parte da 4 ore)
    const bad = await admin('/admin/tours', post({ ...TOUR, slug: 'leader-corto', service: 'leader', durH: '2' }));
    assert.equal(bad.status, 400);
    assert.match(await bad.text().then(nb), /va da 4 a 12 ore/);
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
