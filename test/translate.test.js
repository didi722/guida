// Traduzione automatica dei commenti in evidenza: solo quelli pubblici, nelle lingue del sito, una volta sola,
// con «Vedi originale»; spenta senza chiave e prudente se il servizio non risponde.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { confirmPaid, createBooking, getBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { loadContent } from '../server/content.js';
import { openDb } from '../server/db.js';
import { featuredQuotes, saveFeedback, setFeatured } from '../server/reviews.js';
import { hashOf } from '../server/translate.js';
import { addDays, localToInstant, nowRome } from '../server/time.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-translate-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const content = loadContent(ROOT);

const IT = 'Una guida appassionata!';
const EN = 'Wonderful tour, we loved it';
const JA = 'とても良いツアーでした';
const LANG_OF = { [IT]: 'IT', [EN]: 'EN', [JA]: 'JA' };

/** Un DeepL finto: riconosce la lingua dai tre commenti di prova e «traduce» scrivendo [lingua] davanti. */
function fakeDeepL({ status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (status !== 200) return new Response('{}', { status });
    const text = body.text[0];
    const detected = LANG_OF[text] ?? 'DE';
    const target = body.target_lang.slice(0, 2).toLowerCase();
    return new Response(JSON.stringify({ translations: [{ detected_source_language: detected, text: target === detected.toLowerCase() ? text : `[${target}] ${text}` }] }), { status: 200 });
  };
  return { calls, fetchImpl };
}

async function start({ translate = { provider: 'deepl', apiKey: 'abc:fx' }, fetchImpl } = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, translate });
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), content, fetchImpl });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  const login = await fetch(`${url}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const get = async (p) => (await fetch(url + p)).text();
  const adminGet = async (p) => (await fetch(url + p, { headers: { cookie } })).text();
  return { app, cfg, get, adminGet, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** Un servizio già svolto con il feedback del cliente; `featured` lo mostra sul sito. */
function review(app, i, { comment = IT, mayPublish = true, featured = true, lang = 'it', tour = 'san-marco-rialto', time = '09:30' } = {}) {
  const date = addDays(nowRome().date, -10 - i);
  const at = localToInstant(addDays(date, -4), '12:00');
  const b = createBooking(app, { tourSlug: tour, date, time, pax: 2, name: `Cliente${i} Rossi`, email: `c${i}@example.com`, lang, paymentMethod: 'card' }, at);
  confirmPaid(app, b.id, `pi_${i}`, at);
  assert.ok(saveFeedback(app.db, getBooking(app.db, b.id), { rating: 5, comment, mayPublish }).ok);
  const id = app.db.prepare('SELECT id FROM feedback WHERE booking_id = ?').get(b.id).id;
  if (featured) assert.ok(setFeatured(app.db, id, true));
  return { id, bookingId: b.id };
}
const rows = (app, id) => app.db.prepare('SELECT lang, same, src_lang, text FROM feedback_translations WHERE feedback_id = ? ORDER BY lang').all(id).map((r) => ({ ...r }));

test('traduzione: solo commenti pubblici e in evidenza, nelle quattro lingue, una volta sola; riconosce la lingua in cui sono già scritti', async () => {
  const fake = fakeDeepL();
  const s = await start({ fetchImpl: fake.fetchImpl });
  try {
    const { app } = s;
    assert.equal(app.translate.enabled, true);
    const privato = review(app, 1, { mayPublish: false, featured: false });
    const nonScelto = review(app, 2, { featured: false });
    assert.equal(await app.translate.sweep(), 0);
    assert.equal(fake.calls.length, 0, 'né il feedback privato né quello non scelto escono verso il servizio');

    const it = review(app, 3, { comment: IT });
    assert.equal(await app.translate.sweep(), 4);
    assert.equal(fake.calls.length, 4);
    assert.deepEqual(fake.calls.map((c) => c.body.target_lang).sort(), ['EN-GB', 'ES', 'IT', 'JA']);
    assert.ok(fake.calls.every((c) => c.url === 'https://api-free.deepl.com/v2/translate'), 'chiave «:fx» = piano gratuito');
    assert.ok(fake.calls.every((c) => c.headers.Authorization === 'DeepL-Auth-Key abc:fx' && JSON.stringify(c.body.text) === JSON.stringify([IT])));
    assert.deepEqual(rows(app, it.id), [
      { lang: 'en', same: 0, src_lang: 'it', text: `[en] ${IT}` },
      { lang: 'es', same: 0, src_lang: 'it', text: `[es] ${IT}` },
      { lang: 'it', same: 1, src_lang: 'it', text: null },
      { lang: 'ja', same: 0, src_lang: 'it', text: `[ja] ${IT}` },
    ]);
    assert.equal(rows(app, privato.id).length + rows(app, nonScelto.id).length, 0);
    assert.equal(await app.translate.sweep(), 0, 'non si traduce due volte');
    assert.equal(fake.calls.length, 4);

    // chi guarda in inglese riceve la traduzione e il testo originale; chi guarda in italiano solo l’originale
    const en = featuredQuotes(app.db, { limit: 5, lang: 'en' }).find((q) => q.id === it.id);
    assert.deepEqual(en.translation, { text: `[en] ${IT}`, from: 'it' });
    assert.equal(en.comment, IT);
    const itView = featuredQuotes(app.db, { limit: 5, lang: 'it' }).find((q) => q.id === it.id);
    assert.equal(itView.translation, undefined);
    assert.equal(featuredQuotes(app.db, { limit: 5 }).find((q) => q.id === it.id).translation, undefined, 'senza lingua nessuna traduzione');

    // un commento scritto in inglese da chi aveva prenotato in italiano: lo riconosce e per chi legge in inglese non c’è nulla da tradurre
    const odd = review(app, 4, { comment: EN, lang: 'it', time: '14:30' });
    await app.translate.sweep();
    const qEn = featuredQuotes(app.db, { limit: 9, lang: 'en' }).find((q) => q.id === odd.id);
    assert.equal(qEn.translation, undefined);
    assert.equal(qEn.lang, 'en', 'la lingua del commento è quella vera, non quella della prenotazione');
    assert.equal(featuredQuotes(app.db, { limit: 9, lang: 'it' }).find((q) => q.id === odd.id).translation.text, `[it] ${EN}`);

    // il cliente cambia il commento: la traduzione vecchia sparisce e si rifà
    assert.ok(saveFeedback(app.db, getBooking(app.db, it.bookingId), { rating: 5, comment: JA, mayPublish: true }).ok);
    assert.equal(rows(app, it.id).length, 0);
    await app.translate.sweep();
    assert.equal(featuredQuotes(app.db, { limit: 9, lang: 'it' }).find((q) => q.id === it.id).translation.text, `[it] ${JA}`);
    // e se il testo cambia senza passare di lì, l’impronta non coincide e la vecchia traduzione non si usa mai
    app.db.prepare('UPDATE feedback SET comment = ? WHERE id = ?').run('Testo diverso', it.id);
    assert.equal(featuredQuotes(app.db, { limit: 9, lang: 'it' }).find((q) => q.id === it.id).translation, undefined);
    assert.notEqual(hashOf('Testo diverso'), hashOf(JA));
  } finally {
    s.close();
  }
});

test('traduzione: poche chiamate per volta; se il servizio non risponde si fa una pausa e il sito mostra l’originale', async () => {
  const fake = fakeDeepL();
  const s = await start({ fetchImpl: fake.fetchImpl });
  try {
    const { app } = s;
    for (let i = 1; i <= 5; i++) review(app, i, { comment: IT, ...(i > 3 ? { tour: 'cannaregio-ghetto', time: '10:00' } : { tour: 'san-marco-rialto', time: '09:30' }) });
    // il limite per passaggio (12 chiamate) lascia fuori l'ultimo commento
    const first = await app.translate.sweep();
    assert.equal(first, 12);
    assert.equal(await app.translate.sweep(), 8, 'il giro dopo completa gli altri');
    assert.equal(fake.calls.length, 20);
  } finally {
    s.close();
  }

  // errore del servizio: pausa di 15 minuti, poi si riprova
  const down = fakeDeepL({ status: 500 });
  const t = await start({ fetchImpl: down.fetchImpl });
  try {
    const { app } = t;
    review(app, 1, { comment: IT });
    const now = Date.now();
    assert.equal(await app.translate.sweep(now), 0);
    assert.equal(down.calls.length, 1, 'un tentativo e poi pausa');
    assert.match(app.translate.lastError, /DeepL 500/);
    assert.equal(await app.translate.sweep(now + 5 * 60_000), 0);
    assert.equal(down.calls.length, 1, 'durante la pausa non si chiama il servizio');
    await app.translate.sweep(now + 16 * 60_000);
    assert.equal(down.calls.length, 2, 'dopo la pausa si riprova');
    // nel frattempo la pagina mostra l'originale
    assert.equal(featuredQuotes(app.db, { limit: 3, lang: 'en' })[0].translation, undefined);
    const html = await t.get('/en/');
    assert.ok(html.includes(IT) && !html.includes('quote-orig'));
    assert.match(await t.adminGet('/admin/feedback'), /ultimo errore: DeepL 500/);
  } finally {
    t.close();
  }

  // quota esaurita (456): pausa lunga
  const quota = fakeDeepL({ status: 456 });
  const q = await start({ fetchImpl: quota.fetchImpl });
  try {
    review(q.app, 1, { comment: IT });
    const now = Date.now();
    await q.app.translate.sweep(now);
    await q.app.translate.sweep(now + 60 * 60_000);
    assert.equal(quota.calls.length, 1, 'un’ora dopo non ha ancora riprovato');
    await q.app.translate.sweep(now + 100 * 60_000);
    assert.equal(quota.calls.length, 2);
  } finally {
    q.close();
  }
});

test('traduzione: senza chiave è spenta (nessuna chiamata, nessun pulsante); con Google Traduttore usa la sua interfaccia', async () => {
  const none = fakeDeepL();
  const off = await start({ translate: { provider: '', apiKey: '' }, fetchImpl: none.fetchImpl });
  try {
    assert.equal(off.app.translate.enabled, false);
    review(off.app, 1, { comment: IT });
    assert.equal(await off.app.translate.sweep(), 0);
    assert.equal(none.calls.length, 0);
    const html = await off.get('/en/');
    assert.ok(html.includes(IT) && !html.includes('quote-orig') && !html.includes('See original'));
    assert.match(await off.adminGet('/admin/feedback'), /Traduzione automatica non attiva/);
    assert.equal((await start({ translate: { provider: 'deepl', apiKey: '' } }).then((x) => { const e = x.app.translate.enabled; x.close(); return e; })), false, 'senza chiave');
    assert.equal((await start({ translate: { provider: 'altro', apiKey: 'k' } }).then((x) => { const e = x.app.translate.enabled; x.close(); return e; })), false, 'servizio sconosciuto');
  } finally {
    off.close();
  }

  const calls = [];
  const google = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ data: { translations: [{ translatedText: `(${calls.at(-1).body.target}) ${IT}`, detectedSourceLanguage: 'it' }] } }), { status: 200 });
  };
  const g = await start({ translate: { provider: 'google', apiKey: 'AIza-test' }, fetchImpl: google });
  try {
    const r = review(g.app, 1, { comment: IT });
    assert.equal(await g.app.translate.sweep(), 4);
    assert.ok(calls.every((c) => c.url === 'https://translation.googleapis.com/language/translate/v2?key=AIza-test' && c.body.q === IT && c.body.format === 'text'));
    assert.deepEqual(calls.map((c) => c.body.target).sort(), ['en', 'es', 'it', 'ja']);
    assert.equal(featuredQuotes(g.app.db, { lang: 'ja' })[0].translation.text, `(ja) ${IT}`);
    assert.equal(rows(g.app, r.id).find((x) => x.lang === 'it').same, 1);
    assert.match(await g.adminGet('/admin/feedback'), /Traduzione automatica attiva<\/strong> \(Google Traduttore\)/);
  } finally {
    g.close();
  }
});

test('traduzione sul sito: traduzione + «Vedi originale» nella lingua di chi guarda; l’originale resta com’è; testo del servizio sempre protetto', async () => {
  const hostile = async (url, init) => {
    const body = JSON.parse(init.body);
    const target = body.target_lang.slice(0, 2).toLowerCase();
    return new Response(JSON.stringify({ translations: [{ detected_source_language: 'IT', text: target === 'it' ? body.text[0] : `<script>alert('${target}')</script> ${body.text[0]}` }] }), { status: 200 });
  };
  const s = await start({ fetchImpl: hostile });
  try {
    review(s.app, 1, { comment: IT });
    await s.app.translate.sweep();
    const en = await s.get('/en/');
    assert.match(en, /<blockquote lang="en"><p>&lt;script&gt;alert\(&#39;en&#39;\)&lt;\/script&gt; Una guida appassionata!<\/p><\/blockquote>/);
    assert.ok(!en.includes("<script>alert('en')"), 'il testo del servizio esterno viene sempre protetto');
    assert.match(en, /<details class="quote-orig"><summary><span class="q-open-label">See original<\/span><span class="q-close-label">Hide original<\/span><\/summary>\s*<blockquote lang="it"><p>Una guida appassionata!<\/p><\/blockquote><\/details>/);
    assert.match(en, /<p class="quote-auto">Automatically translated<\/p>/);
    assert.match(await s.get('/ja/'), /原文を見る[^]*?原文を隠す[^]*?自動翻訳/);
    assert.match(await s.get('/es/'), /Ver original[^]*?Traducido automáticamente/);
    // in italiano il commento è già nella lingua di chi guarda: nessun pulsante
    const it = await s.get('/it/');
    assert.ok(it.includes('<blockquote lang="it"><p>Una guida appassionata!</p></blockquote>') && !it.includes('quote-orig'));
    // anche la pagina del tour
    assert.match(await s.get('/en/tours/san-marco-rialto'), /See original/);
    assert.match(await s.adminGet('/admin/feedback'), /Traduzione automatica attiva<\/strong> \(DeepL\)/);
  } finally {
    s.close();
  }
});
