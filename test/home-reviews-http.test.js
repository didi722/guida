// Home: la fascia «Perché…» resta, «Guida abilitata…» e «Come funziona» non ci sono più; i commenti dei clienti del sito scorrono in una fila.
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

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true });
  const { app, server } = createApp({ cfg, db: openDb(':memory:'), content });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  const get = async (p, lang = 'it') => (await fetch(url + p, { headers: { 'accept-language': lang } })).text();
  return { app, url, get, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

function featured(app, comment, name, i) {
  const date = addDays(nowRome().date, -10 - i);
  const at = localToInstant(addDays(date, -4), '12:00');
  const b = createBooking(app, { tourSlug: 'san-marco-rialto', date, time: '09:30', pax: 2, name, email: `c${i}@example.com`, lang: 'it', paymentMethod: 'card' }, at);
  confirmPaid(app, b.id, `pi_${i}`, at);
  saveFeedback(app.db, getBooking(app.db, b.id), { rating: 5, comment, mayPublish: true });
  setFeatured(app.db, app.db.prepare('SELECT id FROM feedback WHERE booking_id = ?').get(b.id).id, true);
}

test('home: tolte la fascia «Guida abilitata…» e la sezione «Come funziona», resta «Perché»; senza commenti la sezione non compare', async () => {
  const s = await start();
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

test('home: i commenti dei clienti in una fila che scorre, solo quelli lasciati sul sito', async () => {
  const s = await start();
  try {
    featured(s.app, 'Una guida appassionata!', 'Laura Bianchi', 1);
    featured(s.app, 'Giro bellissimo <b>davvero</b>', 'Marco Neri', 2);
    const h = await s.get('/it/');
    assert.match(h, /<h2>Cosa dicono i clienti<\/h2>/);
    assert.match(h, /data-reviews[^>]*role="region" aria-roledescription="carousel"/);
    assert.equal((h.match(/<figure class="quote rv-card"/g) ?? []).length, 2);
    assert.match(h, /<strong>Laura<\/strong> · San Marco e Rialto/);
    assert.doesNotMatch(h, /Bianchi|Neri/, 'solo il nome di battesimo');
    assert.match(h, /Giro bellissimo &lt;b&gt;davvero&lt;\/b&gt;/);
    assert.doesNotMatch(h, /rv-google|Leggi su Google|su Google ·/, 'nessuna recensione di Google');
    assert.match(h, /<div class="rv-nav" data-reviews-nav hidden>/);
    assert.match(h, /src="\/js\/reviews\.js\?v=/);
    assert.equal((await fetch(`${s.url}/js/reviews.js`)).status, 200);
  } finally {
    s.close();
  }
});
