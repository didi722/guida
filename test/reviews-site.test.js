// Commenti dei clienti sul sito: solo con il permesso del cliente e scelti dal pannello, solo nome di battesimo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { cancelBooking, confirmPaid, createBooking, getBooking } from '../server/bookings.js';
import { loadContent } from '../server/content.js';
import { openDb } from '../server/db.js';
import { featuredQuotes, firstNameOf, saveFeedback, setFeatured } from '../server/reviews.js';
import { addDays, localToInstant, nowRome } from '../server/time.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-reviews-site-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const content = loadContent(ROOT);

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true });
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), content });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  const login = await fetch(`${url}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const get = async (p) => (await fetch(url + p, { headers: { 'accept-language': 'it' } })).text();
  const adminGet = async (p) => (await fetch(url + p, { headers: { cookie } })).text();
  const adminPost = (p, body = {}) => fetch(url + p, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  return { app, cfg, get, adminGet, adminPost, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

/** Un servizio già svolto, pagato con carta, con il feedback del cliente. Restituisce l'id del feedback. */
function feedbackFor(app, i, { tour = 'san-marco-rialto', time = '09:30', rating = 5, comment = 'Bello', mayPublish = true, name = 'Laura Bianchi', lang = 'it' } = {}) {
  const date = addDays(nowRome().date, -10 - i);
  const at = localToInstant(addDays(date, -4), '12:00');
  const b = createBooking(app, { tourSlug: tour, date, time, pax: 2, name, email: `cliente${i}@example.com`, lang, paymentMethod: 'card' }, at);
  confirmPaid(app, b.id, `pi_${i}`, at);
  assert.ok(saveFeedback(app.db, getBooking(app.db, b.id), { rating, comment, mayPublish }).ok);
  return { id: app.db.prepare('SELECT id FROM feedback WHERE booking_id = ?').get(b.id).id, bookingId: b.id, ref: b.ref };
}

test('commenti sul sito: nome di battesimo, solo con permesso e commento, scelta dal pannello', () => {
  assert.equal(firstNameOf('  Laura   Bianchi '), 'Laura');
  assert.equal(firstNameOf('Madonna'), 'Madonna');
  assert.equal(firstNameOf(''), '');
  assert.equal(firstNameOf(null), '');
});

test('commenti sul sito: home e pagina del tour, con privacy, escape, limite, media e collegamento alle recensioni', async () => {
  const s = await start();
  try {
    const { app } = s;
    const f1 = feedbackFor(app, 1, { rating: 5, comment: 'Una guida appassionata!', name: 'Laura Bianchi' });
    const f2 = feedbackFor(app, 2, { rating: 4, comment: 'Very good <script>alert(1)</script>', name: 'John Smith', lang: 'en', time: '14:30' });
    const f3 = feedbackFor(app, 3, { tour: 'cannaregio-ghetto', time: '10:00', rating: 5, comment: 'Bellissimo ma privato', mayPublish: false });
    const f4 = feedbackFor(app, 4, { rating: 3, comment: '', mayPublish: true, time: '14:30' });
    const f5 = feedbackFor(app, 5, { tour: 'cannaregio-ghetto', time: '15:00', rating: 5, comment: 'Il Ghetto raccontato benissimo', name: 'Carmen Ruiz', lang: 'es' });
    const f6 = feedbackFor(app, 6, { rating: 5, comment: 'Ottimo', name: 'Paolo Neri', time: '09:30' });
    const f7 = feedbackFor(app, 7, { rating: 2, comment: 'Così così', mayPublish: true, name: 'Anna Verdi', time: '14:30' });
    const home = () => s.get('/it/');

    // nulla di scelto: nessuna sezione, nemmeno la media
    assert.doesNotMatch(await home(), /class="quotes"/);
    assert.deepEqual(featuredQuotes(app.db), []);

    // il pannello: chi non ha dato il permesso o non ha scritto nulla non si può mostrare
    const page = await s.adminGet('/admin/feedback');
    assert.match(page, /Mostra sul sito/);
    assert.match(page, /il cliente non ha dato il permesso/);
    assert.match(page, /nessun commento/);
    for (const id of [f3.id, f4.id]) {
      assert.equal((await s.adminPost(`/admin/feedback/${id}/featured`, { on: '1' })).headers.get('location'), '/admin/feedback?ok=featured');
      assert.equal(app.db.prepare('SELECT featured FROM feedback WHERE id = ?').get(id).featured, 0, 'non si può mostrare');
    }
    assert.equal(setFeatured(app.db, f3.id, true), false);
    assert.equal((await s.adminPost('/admin/feedback/99999/featured', { on: '1' })).status, 404);

    // si sceglie un commento: compare in home con il solo nome, senza cognome né email
    await s.adminPost(`/admin/feedback/${f1.id}/featured`, { on: '1' });
    let h = await home();
    assert.match(h, /<h2>Cosa dicono i clienti<\/h2>/);
    assert.match(h, /<blockquote lang="it"><p>Una guida appassionata!<\/p><\/blockquote>/);
    assert.match(h, /<figcaption><strong>Laura<\/strong> · San Marco e Rialto, \w+ \d{4}<\/figcaption>/);
    assert.doesNotMatch(h, /Bianchi|cliente1@example\.com/);
    assert.match(h, /role="img" aria-label="5 su 5">★★★★★<\/div>/);
    assert.match(h, /Commenti reali, pubblicati con il permesso dei clienti\./);
    // media di TUTTI i voti (5,4,5,3,5,5,2 = 29/7 = 4,1) e solo da 5 voti in su
    assert.match(h, /★ 4,1 su 5 · media di 7 voti lasciati dai clienti dopo il tour/);
    assert.match(await s.get('/en/'), /★ 4\.1 out of 5 · average of 7 ratings/);

    // testo con HTML: mai eseguito
    await s.adminPost(`/admin/feedback/${f2.id}/featured`, { on: '1' });
    h = await home();
    assert.match(h, /<blockquote lang="en"><p>Very good &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/p><\/blockquote>/);
    assert.ok(!h.includes('<script>alert(1)'));

    // la pagina del tour mostra solo i commenti di quel tour
    assert.match(await s.get('/it/tours/san-marco-rialto'), /<h2 class="h-sub">Dicono di questo tour<\/h2>/);
    const sm = await s.get('/it/tours/san-marco-rialto');
    assert.match(sm, /Una guida appassionata!/);
    assert.match(sm, /Very good/);
    const gh = await s.get('/it/tours/cannaregio-ghetto');
    assert.doesNotMatch(gh, /Una guida appassionata|class="quotes"/, 'quello del Ghetto non c’è ancora');
    await s.adminPost(`/admin/feedback/${f5.id}/featured`, { on: '1' });
    const gh2 = await s.get('/it/tours/cannaregio-ghetto');
    assert.match(gh2, /<blockquote lang="es"><p>Il Ghetto raccontato benissimo<\/p><\/blockquote>/);
    assert.match(gh2, /<strong>Carmen<\/strong> · Cannaregio e il Ghetto/);
    assert.doesNotMatch(gh2, /Una guida appassionata/);
    assert.match(await s.get('/es/tours/cannaregio-ghetto'), /Lo que dicen de este tour/);

    // in home al massimo 3, i più recenti
    await s.adminPost(`/admin/feedback/${f6.id}/featured`, { on: '1' });
    await s.adminPost(`/admin/feedback/${f7.id}/featured`, { on: '1' });
    assert.equal(featuredQuotes(app.db, { limit: 3 }).length, 3);
    h = await home();
    assert.equal((h.match(/<figure class="quote">/g) ?? []).length, 3);
    assert.doesNotMatch(h, /Così così/, 'il più vecchio resta fuori');

    // collegamento a tutte le recensioni, dalle Impostazioni
    assert.doesNotMatch(h, /Leggi tutte le recensioni/);
    app.cfg.reviews.readUrl = 'https://g.page/r/esempio';
    assert.match(await home(), /<a href="https:\/\/g\.page\/r\/esempio" target="_blank" rel="noopener">Leggi tutte le recensioni<\/a>/);
    app.cfg.reviews.readUrl = '';

    // tolto dal pannello: sparisce subito
    await s.adminPost(`/admin/feedback/${f1.id}/featured`, { on: '0' });
    assert.doesNotMatch(await home(), /Una guida appassionata/);
    // prenotazione annullata dopo il commento: non si mostra più
    cancelBooking(app, f6.bookingId, { by: 'admin', refund: 'full' });
    assert.ok(!featuredQuotes(app.db, { limit: 10 }).some((q) => q.id === f6.id));
    // tutto tolto: niente sezione
    for (const id of [f2.id, f5.id, f7.id]) await s.adminPost(`/admin/feedback/${id}/featured`, { on: '0' });
    assert.doesNotMatch(await home(), /class="quotes"/);

    // la pagina del cliente dice che compare il nome di battesimo
    assert.match(await s.get(`/it/feedback/${f1.ref}?t=${getBooking(app.db, f1.bookingId).token}`), /con il mio nome di battesimo \(senza cognome\)/);
    // sotto i 5 voti la media non si mostra
    const few = await start();
    try {
      const a = feedbackFor(few.app, 1, { rating: 5, comment: 'Solo uno', name: 'Mario Rossi' });
      await few.adminPost(`/admin/feedback/${a.id}/featured`, { on: '1' });
      const fh = await few.get('/it/');
      assert.match(fh, /Solo uno/);
      assert.doesNotMatch(fh, /media di \d+ voti/);
    } finally {
      few.close();
    }
  } finally {
    s.close();
  }
});
