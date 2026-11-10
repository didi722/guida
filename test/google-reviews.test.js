// Recensioni di Google nella home: lettura (Places API, una volta al giorno, quattro lingue), copia che scade, e il carosello con i commenti del sito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlace } from '../server/googleReviews.js';
import { makeApp } from './helpers.js';

const DAY = 86_400_000;
const NOW = Date.parse('2027-01-04T10:00:00Z');

const place = (over = {}) => ({
  id: 'ChIJtest',
  rating: 4.86,
  userRatingCount: 37,
  googleMapsUri: 'https://maps.google.com/?cid=123',
  reviews: [
    { rating: 5, text: { text: 'Guida splendida, ci ha raccontato la storia di Venezia.', languageCode: 'it' }, originalText: { text: 'Guida splendida, ci ha raccontato la storia di Venezia.', languageCode: 'it' }, authorAttribution: { displayName: 'Anna Rossi', uri: 'https://www.google.com/maps/contrib/1' }, publishTime: '2026-12-10T08:00:00Z', googleMapsUri: 'https://maps.google.com/?cid=123&review=1' },
    { rating: 4, text: { text: 'Un giro bellissimo.', languageCode: 'it' }, originalText: { text: 'A lovely tour.', languageCode: 'en' }, authorAttribution: { displayName: 'John', uri: 'javascript:alert(1)' }, publishTime: '2026-11-02T08:00:00Z' },
    { rating: 5, authorAttribution: { displayName: 'Senza testo' } }, // solo il voto: non si mostra
  ],
  ...over,
});

/** Un finto «fetch» di Google che ricorda le richieste. */
function fakeGoogle(handler = () => ({ status: 200, body: place() })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    const r = handler(String(url), calls.length);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetchImpl, calls };
}
const appWith = (fetchImpl, google = { placeId: 'ChIJtest', apiKey: 'chiave-di-prova' }) => makeApp({ reviews: { google } }, { fetchImpl });

test('parsePlace: solo recensioni con parole, indirizzi https, voto da 1 a 5', () => {
  const p = parsePlace(place());
  assert.equal(p.rating, 4.9);
  assert.equal(p.count, 37);
  assert.equal(p.uri, 'https://maps.google.com/?cid=123');
  assert.equal(p.reviews.length, 2, 'la valutazione senza testo non conta');
  assert.deepEqual([p.reviews[0].author, p.reviews[0].rating, p.reviews[0].when, p.reviews[0].original], ['Anna Rossi', 5, '2026-12-10', ''], 'testo uguale all’originale: nessun «originale» a parte');
  assert.equal(p.reviews[1].original, 'A lovely tour.');
  assert.equal(p.reviews[1].originalLang, 'en');
  assert.equal(p.reviews[1].authorUrl, '', 'un indirizzo non https si scarta');
  assert.deepEqual(parsePlace({}), { rating: null, count: null, uri: '', reviews: [] });
  assert.deepEqual(parsePlace(null).reviews, []);
});

test('spento senza codice del profilo o senza chiave: nessuna richiesta a Google', async (t) => {
  for (const google of [{ placeId: '', apiKey: 'k' }, { placeId: 'ChIJtest', apiKey: '' }, { placeId: '', apiKey: '' }]) {
    const g = fakeGoogle();
    const app = appWith(g.fetchImpl, google);
    t.after(app.cleanup);
    assert.equal(app.googleReviews.enabled, false);
    assert.equal(await app.googleReviews.sweep(NOW), 0);
    assert.equal(app.googleReviews.forLang('it', NOW), null);
    assert.equal(g.calls.length, 0);
  }
});

test('una lettura al giorno, una richiesta per lingua, con la chiave nell’intestazione', async (t) => {
  const g = fakeGoogle();
  const app = appWith(g.fetchImpl);
  t.after(app.cleanup);
  assert.equal(app.googleReviews.enabled, true);
  assert.equal(await app.googleReviews.sweep(NOW), 4);
  assert.deepEqual(g.calls.map((c) => /languageCode=(\w+)/.exec(c.url)[1]).sort(), ['en', 'es', 'it', 'ja']);
  assert.ok(g.calls.every((c) => c.url.startsWith('https://places.googleapis.com/v1/places/ChIJtest?') && c.headers['X-Goog-Api-Key'] === 'chiave-di-prova' && /reviews/.test(c.headers['X-Goog-FieldMask'])));
  assert.ok(g.calls.every((c) => !c.url.includes('chiave-di-prova')), 'la chiave non sta nell’indirizzo');
  const it = app.googleReviews.forLang('it', NOW + 1000);
  assert.deepEqual([it.rating, it.count, it.reviews.length], [4.9, 37, 2]);
  // un'ora dopo non si richiede nulla; dopo un giorno sì
  assert.equal(await app.googleReviews.sweep(NOW + 3_600_000), 0);
  assert.equal(g.calls.length, 4);
  assert.equal(await app.googleReviews.sweep(NOW + DAY + 1000), 4);
  assert.equal(g.calls.length, 8);
});

test('se Google non risponde: pausa, errore ricordato, la copia di ieri resta ma non oltre due giorni', async (t) => {
  let fail = false;
  const g = fakeGoogle(() => (fail ? { status: 403, body: { error: { message: 'API key not valid' } } } : { status: 200, body: place() }));
  const app = appWith(g.fetchImpl);
  t.after(app.cleanup);
  const log = console.error;
  console.error = () => {};
  t.after(() => { console.error = log; });
  await app.googleReviews.sweep(NOW);
  fail = true;
  assert.equal(await app.googleReviews.sweep(NOW + DAY + 1000), 0);
  assert.match(app.googleReviews.lastError, /Google 403: API key not valid/);
  const calls = g.calls.length;
  assert.equal(await app.googleReviews.sweep(NOW + DAY + 5 * 60_000), 0);
  assert.equal(g.calls.length, calls, 'in pausa: nessun altro tentativo subito');
  assert.ok(app.googleReviews.forLang('it', NOW + DAY + 2000), 'la copia di ieri si mostra ancora');
  assert.equal(app.googleReviews.forLang('it', NOW + 2 * DAY + 1000), null, 'oltre due giorni non si mostra più');
  fail = false;
  assert.equal(await app.googleReviews.sweep(NOW + DAY + 40 * 60_000), 4, 'finita la pausa riparte');
  assert.equal(app.googleReviews.lastError, null);
});

test('cambiando il codice del profilo la copia vecchia non vale più', async (t) => {
  const g = fakeGoogle();
  const app = appWith(g.fetchImpl);
  t.after(app.cleanup);
  await app.googleReviews.sweep(NOW);
  assert.ok(app.googleReviews.forLang('en', NOW));
  app.cfg.reviews.google.placeId = 'ChIJaltro';
  assert.equal(app.googleReviews.forLang('en', NOW), null);
  assert.equal(await app.googleReviews.sweep(NOW + 1000), 4, 'e si rilegge per il nuovo profilo');
});
