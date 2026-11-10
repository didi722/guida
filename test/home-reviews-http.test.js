// Home: la fascia «Perché…» resta, «Guida abilitata…» e «Come funziona» non ci sono più; le recensioni scorrono, quelle di Google e quelle dei clienti del sito insieme.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { confirmPaid, createBooking, getBooking } from '../server/bookings.js';
import { loadContent } from '../server/content.js';
import { openDb } from '../server/db.js';
import { saveFeedback, setFeatured } from '../server/reviews.js';
import { addDays, localToInstant, nowRome } from '../server/time.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-home-reviews-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const content = loadContent(ROOT);

const PLACE = (lang) => ({
  rating: 4.86,
  userRatingCount: 37,
  googleMapsUri: 'https://maps.google.com/?cid=123',
  reviews: [
    { rating: 5, text: { text: lang === 'en' ? 'Wonderful guide, the story of Venice told with passion.' : 'Guida splendida <b>appassionata</b>.', languageCode: lang }, originalText: { text: 'Guida splendida <b>appassionata</b>.', languageCode: 'it' }, authorAttribution: { displayName: 'Anna Rossi', uri: 'https://www.google.com/maps/contrib/1' }, publishTime: '2026-12-10T08:00:00Z', googleMapsUri: 'https://maps.google.com/?cid=123&review=1' },
    { rating: 4, text: { text: 'x'.repeat(30) + ' ' + 'parola '.repeat(120), languageCode: lang }, originalText: { text: 'lunga', languageCode: lang }, authorAttribution: { displayName: 'Luca Verdi' }, publishTime: '2026-11-02T08:00:00Z' },
  ],
});

async function start({ google = true } = {}) {
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => PLACE(/languageCode=(\w+)/.exec(String(url))[1]) });
  const cfg = createConfig({
    __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true,
    ...(google ? { reviews: { google: { placeId: 'ChIJtest', apiKey: 'k' } } } : {}),
  });
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), content, fetchImpl });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  const get = async (p) => (await fetch(url + p, { headers: { 'accept-language': 'it' } })).text();
  const login = await fetch(`${url}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const admin = (p, body = null) => fetch(url + p, { redirect: 'manual', headers: { cookie, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(body ? { method: 'POST', body: new URLSearchParams(body).toString() } : {}) });
  return { app, url, get, admin, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

function featured(app, comment, name, i) {
  const date = addDays(nowRome().date, -10 - i);
  const at = localToInstant(addDays(date, -4), '12:00');
  const b = createBooking(app, { tourSlug: 'san-marco-rialto', date, time: '09:30', pax: 2, name, email: `c${i}@example.com`, lang: 'it', paymentMethod: 'card' }, at);
  confirmPaid(app, b.id, `pi_${i}`, at);
  saveFeedback(app.db, getBooking(app.db, b.id), { rating: 5, comment, mayPublish: true });
  setFeatured(app.db, app.db.prepare('SELECT id FROM feedback WHERE booking_id = ?').get(b.id).id, true);
}

test('home: tolte la fascia «Guida abilitata…» e la sezione «Come funziona», resta «Perché»', async () => {
  const s = await start({ google: false });
  try {
    const h = await s.get('/it/');
    assert.doesNotMatch(h, /class="trust|Guida abilitata|Pagamento sicuro|Cancellazione fino a/);
    assert.doesNotMatch(h, /<h2>Come funziona<\/h2>|class="steps"/);
    assert.match(h, /class="why-item/, 'la sezione «Perché» c’è ancora');
    assert.doesNotMatch(h, /data-reviews/, 'senza recensioni la sezione non compare');
  } finally {
    s.close();
  }
});

test('home: Google e commenti del sito alternati nella fila che scorre, con le attribuzioni', async () => {
  const s = await start();
  try {
    const { app } = s;
    assert.equal(await app.googleReviews.sweep(), 4);
    featured(app, 'Una guida appassionata!', 'Laura Bianchi', 1);
    featured(app, 'Giro bellissimo', 'Marco Neri', 2);
    const h = await s.get('/it/');
    assert.match(h, /<h2>Cosa dicono i clienti<\/h2>/);
    assert.match(h, /data-reviews[^>]*role="region" aria-roledescription="carousel"/);
    const order = [...h.matchAll(/<figure class="quote rv-card( rv-google)?"/g)].map((m) => (m[1] ? 'G' : 'S'));
    assert.deepEqual(order, ['G', 'S', 'G', 'S'], 'alternate, cominciando da Google');
    // Google: nome (con il suo profilo), mese, collegamento alla recensione, etichetta; testo senza HTML eseguibile
    assert.match(h, /<span class="rv-src rv-src-google">Google<\/span>/);
    assert.match(h, /<a href="https:\/\/www\.google\.com\/maps\/contrib\/1" target="_blank" rel="noopener nofollow"><strong>Anna Rossi<\/strong><\/a>, dicembre 2026/);
    assert.match(h, /<a href="https:\/\/maps\.google\.com\/\?cid=123&amp;review=1" target="_blank" rel="noopener nofollow">Leggi su Google<\/a>/);
    assert.match(h, /Guida splendida &lt;b&gt;appassionata&lt;\/b&gt;\./);
    assert.ok(!h.includes('<b>appassionata'));
    // il testo lungo si accorcia, senza spezzare le parole
    assert.match(h, /parola…<\/p>/);
    // sito: nome di battesimo e tour
    assert.match(h, /<strong>Laura<\/strong> · San Marco e Rialto/);
    assert.doesNotMatch(h, /Bianchi|Neri/);
    // valutazione di Google (da tutte le recensioni del profilo) col collegamento al profilo, e la dicitura
    assert.match(h, /★ <a href="https:\/\/maps\.google\.com\/\?cid=123" target="_blank" rel="noopener nofollow">4,9 su Google · 37 recensioni<\/a>/);
    assert.match(h, /Le recensioni di Google sono lette ogni giorno dal profilo/);
    // pulsanti (nascosti finché il JavaScript non li accende) e script
    assert.match(h, /<div class="rv-nav" data-reviews-nav hidden>/);
    assert.match(h, /src="\/js\/reviews\.js\?v=/);
    assert.equal((await fetch(`${s.url}/js/reviews.js`)).status, 200);
  } finally {
    s.close();
  }
});

test('home: nella lingua di chi guarda Google dà il testo tradotto, con «Vedi originale»; solo Google, senza commenti del sito', async () => {
  const s = await start();
  try {
    await s.app.googleReviews.sweep();
    const en = await s.get('/en/');
    assert.match(en, /Wonderful guide, the story of Venice told with passion\./);
    assert.match(en, /<p class="quote-auto">Translated by Google<\/p>/);
    assert.match(en, /<blockquote lang="it"><p>Guida splendida &lt;b&gt;appassionata&lt;\/b&gt;\.<\/p><\/blockquote>/, 'l’originale, nella sua lingua');
    assert.match(en, /4\.9 on Google · 37 reviews/);
    const it = await s.get('/it/');
    assert.doesNotMatch(it, /Tradotto da Google/, 'in italiano il testo è già quello originale');
    assert.equal((it.match(/<figure class="quote rv-card rv-google"/g) ?? []).length, 2);
  } finally {
    s.close();
  }
});

test('home: se Google non ha mai risposto, restano i commenti del sito', async () => {
  const s = await start();
  try {
    featured(s.app, 'Una guida appassionata!', 'Laura Bianchi', 1);
    const h = await s.get('/it/');
    assert.doesNotMatch(h, /rv-google|su Google/);
    assert.match(h, /Una guida appassionata!/);
  } finally {
    s.close();
  }
});

test('pannello: Clienti › Feedback dice se Google è collegato e rilegge con «Aggiorna adesso»', async () => {
  const on = await start();
  try {
    const page = await (await on.admin('/admin/feedback')).text();
    assert.match(page, /Recensioni di Google nella home/);
    assert.match(page, /<strong>Collegate\.<\/strong> Non è ancora stata fatta una lettura valida/);
    const go = await on.admin('/admin/feedback/google/refresh', { x: '1' });
    assert.equal(go.headers.get('location'), '/admin/feedback?ok=google-ok');
    const after = await (await on.admin('/admin/feedback?ok=google-ok')).text();
    assert.match(after, /Ultima lettura: /);
    assert.match(after, /Recensioni di Google aggiornate/);
    assert.ok(on.app.googleReviews.forLang('it'));
  } finally {
    on.close();
  }
  const off = await start({ google: false });
  try {
    const page = await (await off.admin('/admin/feedback')).text();
    assert.match(page, /Non collegate\. Servono il <strong>codice del profilo<\/strong>/);
    assert.equal((await off.admin('/admin/feedback/google/refresh', { x: '1' })).status, 404, 'senza collegamento il pulsante non fa nulla');
  } finally {
    off.close();
  }
});
