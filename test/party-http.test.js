// Adulti, bambini e infanti dall'inizio alla fine: scheda del tour e calendario, pagamento, prenotazione, email, voucher, area agenzie e pannello.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { createBooking, getBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { daySheet } from '../server/daySheet.js';
import { openDb } from '../server/db.js';
import { renderVoucherPdf } from '../server/pdf.js';
import { addDays, nowRome } from '../server/time.js';
import { HAS_PDFTOTEXT, addAccount, isPdf, pdfText } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-party-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const PW = 'prova-prova-1';
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const B2C = 'cannaregio-ghetto'; // partenze 10:00 e 15:00, fino a 10 persone, 35 € a persona
const B2B = 'cannaregio-ghetto-agenzie'; // 28 € a persona
const HOURLY = 'venezia-oriente-occidente'; // a ore, per gruppo

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
  const agency = addAccount(app.db, { email: 'anna@lagoon.example', password_hash: await hashPassword(PW), company: 'Lagoon DMC', contact_name: 'Anna Bianchi', lang: 'it', option_max: 0, phone: '+39 3331234567' });
  const admin = jar();
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  const partner = jar();
  assert.equal((await partner('/it/b2b/login', form({ email: agency.email, password: PW }))).status, 303);
  return { app, agency, admin, partner, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('scheda del tour: tre contatori con le età e il prezzo; nei servizi a gruppo c’è la nota che il prezzo non cambia', async () => {
  const s = await start();
  try {
    const page = await text(await s.anon(`/it/tours/${B2C}`));
    assert.match(page, /<fieldset class="party party-compact" id="w-party" data-party /);
    assert.match(page, /name="adults" id="w-party-adults" min="1" max="10" step="1" value="2"/);
    assert.match(page, /name="children" id="w-party-children" min="0" max="10" step="1" value="0"/);
    assert.match(page, /name="infants" id="w-party-infants" min="0" max="10" step="1" value="0"/);
    assert.match(page, /da 13 anni/);
    assert.match(page, /4–12 anni · prezzo al 50%/);
    assert.match(page, /0–3 anni · gratis/);
    assert.match(page, /data-child-pct="50"/, 'lo script calcola il prezzo dei bambini');
    assert.doesNotMatch(page, /class="party-note"/);
    assert.match(page, /data-total-label="Totale: \{text\}"/);
    // in inglese e in giapponese
    assert.match(await text(await s.anon(`/en/tours/${B2C}`)), /ages 4–12 · 50% of the price/);
    assert.match(await text(await s.anon(`/ja/tours/${B2C}`)), /4〜12歳 · 料金50%/);
    assert.match(await text(await s.anon(`/es/tours/${B2C}`)), /4–12 años · 50% del precio/);
    // servizio a ore: il prezzo è per il gruppo
    const hourly = await text(await s.anon(`/it/tours/${HOURLY}`));
    assert.match(hourly, /id="w-party"/);
    assert.match(hourly, /Il prezzo è per tutto il gruppo/);
    assert.doesNotMatch(hourly, /prezzo al 50%/);
  } finally {
    s.close();
  }
});

test('API del calendario: la composizione conta come totale per i posti e come prezzo per gli orari', async () => {
  const s = await start();
  try {
    const d = day(40);
    const slots = async (q) => (await s.anon(`/api/slots?tour=${B2C}&date=${d}&${q}`));
    const ok = await slots('adults=2&children=1&infants=1');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.ok(body.slots.length >= 1);
    assert.equal(body.slots[0].totalCents, 2 * 3500 + 1750, '2 adulti + 1 bambino a metà, l’infante gratis');
    assert.equal((await (await slots('pax=3')).json()).slots[0].totalCents, 3 * 3500, 'il vecchio «pax» vale tante persone adulte');
    assert.equal((await slots('adults=0&children=2')).status, 400, 'serve un adulto');
    assert.equal((await slots('adults=8&children=2&infants=1')).status, 400, 'più persone dei posti del tour');
    assert.equal((await slots('adults=x')).status, 400);
    const month = await s.anon(`/api/availability?tour=${B2C}&month=${d.slice(0, 7)}&adults=2&children=2&infants=1`);
    assert.equal(month.status, 200);
    assert.equal((await s.anon(`/api/availability?tour=${B2C}&month=${d.slice(0, 7)}&adults=0&children=1`)).status, 400);
    // servizio a ore: il prezzo non dipende dall'età, solo gli auricolari (da 9 persone) e li usano adulti e bambini
    const hourly = async (q) => (await (await s.anon(`/api/slots?tour=guida-a-ore&date=${d}&hours=4&${q}`)).json()).slots[0].totalCents;
    const nine = await hourly('adults=9');
    assert.equal(await hourly('adults=8&children=1&infants=2'), nine, '9 persone che usano gli auricolari: stesso conto di 9 adulti');
    assert.ok((await hourly('adults=8&infants=3')) < nine, 'otto con gli auricolari: sotto la soglia, niente supplemento');
    // i posti si contano sul totale (infanti compresi): con 8 persone già prenotate non si può chiederne altre 3
    createBooking(s.app, { tourSlug: B2C, date: d, time: '10:00', party: { adults: 6, children: 1, infants: 1 }, channel: 'b2c', name: 'Mario', email: 'mario@example.com', lang: 'it', paymentMethod: 'card' }); // in attesa di pagamento: il posto è già occupato
    const left = await (await slots('adults=2')).json();
    assert.ok(left.slots.some((x) => x.time === '10:00'), '8 + 2 = 10: ci sta');
    const full = await (await slots('adults=2&infants=1')).json();
    assert.ok(!full.slots.some((x) => x.time === '10:00'), '8 + 3 > 10: l’infante occupa un posto, la partenza non è più disponibile');
  } finally {
    s.close();
  }
});

test('pagamento e prenotazione di un privato: il prezzo per età, il ricalcolo in pagina, la conferma con le persone scritte per esteso', async () => {
  const s = await start();
  try {
    const { app, anon } = s;
    const d = day(40);
    const co = { tour: B2C, date: d, time: '10:00' };
    const q = new URLSearchParams({ ...co, adults: '2', children: '1', infants: '1' });
    const page = await text(await anon(`/it/book/checkout?${q}`));
    assert.match(page, /<fieldset class="party" id="co-party" data-party /);
    assert.match(page, /name="adults" id="co-party-adults" min="1" max="10" step="1" value="2" form="checkout-form"/);
    assert.match(page, /name="children" id="co-party-children" min="0" max="10" step="1" value="1" form="checkout-form"/);
    assert.match(page, /Totale: 4 persone/);
    assert.match(page, /<dt>2 adulti <small class="muted">\(35 €\)<\/small><\/dt><dd>70 €<\/dd>/);
    assert.match(page, /<dt>1 bambino <small class="muted">\(17,50 €\)<\/small><\/dt><dd>17,50 €<\/dd>/);
    assert.match(page, /<dt>1 infante<\/dt><dd>gratis<\/dd>/);
    assert.match(page, /<dt>Totale<\/dt><dd>87,50 €/);
    // senza bambini né infanti il riquadro resta quello di sempre
    const plain = await text(await anon(`/it/book/checkout?${new URLSearchParams({ ...co, adults: '2' })}`));
    assert.doesNotMatch(plain, /<dt>2 adulti/);
    assert.match(plain, /<dt>Totale<\/dt><dd>70 €/);
    // composizione non valida: la richiesta non è più una partenza prenotabile
    assert.equal((await anon(`/it/book/checkout?${new URLSearchParams({ ...co, adults: '0', children: '2' })}`)).status, 400);
    assert.equal((await anon(`/it/book/checkout?${new URLSearchParams({ ...co, adults: '9', children: '2' })}`)).status, 400);

    // «Aggiorna»: nuovo prezzo senza prenotare, con i dati già scritti
    const base = { ...co, name: 'Luca Neri', email: 'luca@example.com', lang: 'it', paymentMethod: 'card', consent: '1' };
    const applied = await anon('/it/book/checkout', form({ ...base, adults: '2', children: '3', infants: '0', apply: '1' }));
    assert.equal(applied.status, 200);
    const html = await text(applied);
    assert.match(html, /value="Luca Neri"/);
    assert.match(html, /name="children" id="co-party-children" min="0" max="10" step="1" value="3"/);
    assert.match(html, /<dt>Totale<\/dt><dd>122,50 €/, '2 × 35 + 3 × 17,50');
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM bookings').get().n, 0, 'aggiornare non crea prenotazioni');
    assert.equal((await anon('/it/book/checkout', form({ ...base, adults: '2', children: '9', infants: '0', apply: '1' }))).status, 400, 'oltre i posti');

    // prenotazione vera
    const book = await anon('/it/book/checkout', form({ ...base, adults: '2', children: '1', infants: '1' }));
    assert.equal(book.status, 303);
    const bk = app.db.prepare('SELECT * FROM bookings').get();
    assert.deepEqual([bk.participants, bk.children, bk.infants, bk.total_cents, bk.list_cents], [4, 1, 1, 8750, 8750]);
    const u = new URL(loc(book));
    await anon(u.pathname + '/complete', form({ t: u.searchParams.get('t'), lang: 'it' }));
    const done = getBooking(app.db, bk.id);
    assert.equal(done.status, 'confirmed');
    // la pagina della prenotazione, l'email, il calendario e il voucher dicono chi viene
    const mine = await text(await anon(`/it/booking/${bk.ref}?t=${bk.token}`));
    assert.match(mine, /4 persone \(2 adulti, 1 bambino, 1 infante\)/);
    const mail = app.mail.sent.find((m) => m.to === 'luca@example.com' && /Prenotazione/.test(m.subject));
    assert.ok(mail, 'conferma al cliente');
    assert.match(mail.text, /Partecipanti: 4 \(2 adulti, 1 bambino, 1 infante\)/);
    const note = app.mail.sent.find((m) => m.to === 'guida@example.com' && m.text.includes(bk.ref));
    assert.ok(note, 'avviso alla guida');
    assert.match(note.text, /4 pers\. \(2 ad\. \+ 1 bamb\. \+ 1 inf\.\)/);
    const ics = await text(await anon(`/it/booking/${bk.ref}/calendar.ics?t=${bk.token}`));
    assert.match(ics, /4 partecipanti \(2 adulti\\, 1 bambino\\, 1 infante\)/);
    const pdf = await renderVoucherPdf(app, done, { lang: 'it' });
    assert.ok(isPdf(pdf));
    if (HAS_PDFTOTEXT) assert.match(pdfText(pdf).replace(/\s+/g, ' '), /4 \(2 adulti, 1 bambino, 1 infante\)/);
    // in inglese
    const en = await text(await anon(`/en/booking/${bk.ref}?t=${bk.token}`));
    assert.match(en, /4 guests \(2 adults, 1 child, 1 infant\)/);
    // il pannello: scheda, agenda e scheda del giorno
    const adm = await text(await s.admin(`/admin/bookings/${bk.id}`));
    assert.match(adm, /<dt>Persone<\/dt><dd>4 persone \(2 adulti, 1 bambino, 1 infante\)<\/dd>/);
    const sheet = daySheet(app, d);
    assert.equal(sheet.services[0].people, 4);
    assert.equal(sheet.services[0].peopleLine, '4 persone (2 adulti, 1 bambino, 1 infante)');
    assert.equal(sheet.totals.people, 4);
    assert.match(await text(await s.admin(`/admin/day?date=${d}`)), /4 persone \(2 adulti, 1 bambino, 1 infante\)/);
    const dayPdf = await s.admin(`/admin/day.pdf?date=${d}`);
    assert.equal(dayPdf.status, 200);
    const dayBuf = Buffer.from(await dayPdf.arrayBuffer());
    assert.ok(isPdf(dayBuf));
    if (HAS_PDFTOTEXT) assert.match(pdfText(dayBuf).replace(/\s+/g, ' '), /4 persone \(2 adulti, 1 bambino, 1 infante\)/);
  } finally {
    s.close();
  }
});

test('area agenzie: tariffa a persona con bambini a metà, modifica della composizione, elenco, esportazione e pannello', async () => {
  const s = await start();
  try {
    const { app, agency, partner, admin } = s;
    const d = day(40);
    const q = new URLSearchParams({ tour: B2B, date: d, time: '15:00', adults: '3', children: '2', infants: '1' });
    const page = await text(await partner(`/it/book/checkout?${q}`));
    assert.match(page, /Totale: 6 persone/);
    assert.match(page, /<dt>3 adulti <small class="muted">\(28 €\)<\/small><\/dt><dd>84 €<\/dd>/);
    assert.match(page, /<dt>2 bambini <small class="muted">\(14 €\)<\/small><\/dt><dd>28 €<\/dd>/);
    assert.match(page, /<dt>Totale<\/dt><dd>112 €/);

    const book = await partner('/it/book/checkout', form({ tour: B2B, date: d, time: '15:00', adults: '3', children: '2', infants: '1', name: 'Anna Bianchi', email: agency.email, phone: '3331234567', phone_cc: 'IT', lang: 'it', paymentMethod: 'invoice', consent: '1', clientRef: 'Famiglia Verdi' }));
    assert.equal(book.status, 303);
    const bk = app.db.prepare("SELECT * FROM bookings WHERE channel = 'b2b'").get();
    assert.deepEqual([bk.participants, bk.children, bk.infants, bk.total_cents], [6, 2, 1, 3 * 2800 + 2 * 1400]);

    // la scheda, l'elenco e l'esportazione
    const mine = await text(await partner(`/it/b2b/bookings/${bk.ref}`));
    assert.match(mine, /6 persone \(3 adulti, 2 bambini, 1 infante\)/);
    const list = await text(await partner('/it/b2b/bookings?view=all'));
    assert.match(list, /6 \(3 ad\. \+ 2 bamb\. \+ 1 inf\.\)/);
    const csv = (await (await partner('/it/b2b/bookings.csv?view=all')).text()).replace(/^﻿/, '').trim().split('\r\n');
    const head = csv[0].split(';');
    const i = head.indexOf('Persone');
    assert.deepEqual(head.slice(i, i + 3), ['Persone', 'Bambini', 'Infanti']);
    assert.deepEqual(csv[1].split(';').slice(i, i + 3), ['6', '2', '1']);

    // modifica dell'agenzia: la pagina mostra i contatori, la conferma ricalcola il prezzo
    const change = await text(await partner(`/it/b2b/bookings/${bk.ref}/change`));
    assert.match(change, /<fieldset class="party" id="ch-party" data-party data-autosubmit /);
    assert.match(change, /name="adults" id="ch-party-adults" min="1" max="10" step="1" value="3"/);
    assert.match(change, /6 persone \(3 adulti, 2 bambini, 1 infante\)/);
    const ok = await partner(`/it/b2b/bookings/${bk.ref}/change`, form({ adults: '3', children: '1', infants: '1', date: d, time: '15:00' }));
    assert.equal(ok.status, 303);
    const after = getBooking(app.db, bk.id);
    assert.deepEqual([after.participants, after.children, after.infants, after.total_cents], [5, 1, 1, 3 * 2800 + 1400]);
    // il vecchio «pax» dal modulo vale persone adulte
    assert.equal((await partner(`/it/b2b/bookings/${bk.ref}/change`, form({ pax: '4', date: d, time: '15:00' }))).status, 303);
    assert.deepEqual([getBooking(app.db, bk.id).participants, getBooking(app.db, bk.id).children], [4, 0]);

    // il pannello: modulo di modifica (con i valori scritti), anteprima e applicazione
    const edit = await text(await admin(`/admin/bookings/${bk.id}/edit`));
    assert.match(edit, /<fieldset class="party" id="ed-party" data-party /);
    assert.match(edit, /name="adults" id="ed-party-adults" min="1" max="10" step="1" value="4"/);
    const prev = await text(await admin(`/admin/bookings/${bk.id}/edit?${new URLSearchParams({ preview: '1', adults: '2', children: '2', infants: '2', date: d, time: '15:00', priceMode: 'auto' })}`));
    assert.match(prev, /4 → 6 \(2 ad\. \+ 2 bamb\. \+ 2 inf\.\)/);
    assert.match(prev, /<dt>Totale<\/dt>/);
    const edited = await admin(`/admin/bookings/${bk.id}/edit`, form({ adults: '2', children: '2', infants: '2', date: d, time: '15:00', priceMode: 'auto', note: 'Arrivano due neonati' }));
    assert.equal(edited.status, 303);
    const fin = getBooking(app.db, bk.id);
    assert.deepEqual([fin.participants, fin.children, fin.infants, fin.total_cents], [6, 2, 2, 2 * 2800 + 2 * 1400]);
    const detail = await text(await admin(`/admin/bookings/${bk.id}?ok=edited`));
    assert.match(detail, /persone 4 → 6 \(2 ad\. \+ 2 bamb\. \+ 2 inf\.\)/, 'nel registro delle modifiche');
    // una composizione sbagliata resta nel modulo con l'errore
    const bad = await admin(`/admin/bookings/${bk.id}/edit`, form({ adults: '0', children: '3', infants: '0', date: d, time: '15:00', priceMode: 'auto' }));
    assert.equal(bad.status, 400);
  } finally {
    s.close();
  }
});

test('prenotazione per un’agenzia dal pannello: composizione e prezzo dalla tariffa', async () => {
  const s = await start();
  try {
    const { app, agency, admin } = s;
    const d = day(45);
    const form1 = await text(await admin('/admin/agenda/agency'));
    assert.match(form1, /<fieldset class="party" id="ab-party" data-party /);
    assert.match(form1, /Nei servizi a persona i bambini pagano la metà/);
    const res = await admin('/admin/agenda/agency', form({ agency: String(agency.id), tour: B2B, date: d, time: '10:00', adults: '2', children: '2', infants: '1', hours: '', price: '', clientRef: 'Pratica 7' }));
    assert.equal(res.status, 200);
    const out = await text(res);
    assert.match(out, /Registrata/);
    assert.match(out, /5 pers\. \(2 ad\. \+ 2 bamb\. \+ 1 inf\.\)/);
    const b = app.db.prepare("SELECT * FROM bookings WHERE client_ref = 'Pratica 7'").get();
    assert.deepEqual([b.participants, b.children, b.infants, b.total_cents], [5, 2, 1, 2 * 2800 + 2 * 1400]);
    // senza adulti: errore nel modulo
    const bad = await admin('/admin/agenda/agency', form({ agency: String(agency.id), tour: B2B, date: d, time: '15:00', adults: '0', children: '2', infants: '0', hours: '', price: '' }));
    assert.equal(bad.status, 400);
    assert.match(await text(bad), /Il numero di persone non è valido per questo servizio/);
  } finally {
    s.close();
  }
});
