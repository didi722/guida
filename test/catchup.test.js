// Un sito creato con una versione più vecchia del codice riceve ciò che è arrivato dopo (servizi a ore, traduzioni),
// senza mai toccare ciò che è già nel database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT } from '../server/config.js';
import { catchUpContent, createContentStore, seedContent } from '../server/contentStore.js';
import { getSetting, openDb } from '../server/db.js';
import { hourlyQuote } from '../server/pricing.js';
import { createRates } from '../server/rates.js';

process.env.GUIDA_QUIET = '1';

/** Un database «vecchio»: creato prima dei servizi a ore e del giapponese (niente guida-a-ore & co., niente blocchi ja, nessun promemoria sui controlli già fatti). */
function oldDb() {
  const db = openDb(':memory:');
  seedContent(db, ROOT);
  for (const slug of ['guida-a-ore', 'assistente-a-ore', 'tour-leader', 'meet-and-greet']) db.prepare('DELETE FROM content_tours WHERE slug = ?').run(slug);
  for (const [table, key] of [['content_tours', 'slug'], ['content_posts', 'slug'], ['content_pages', 'name']]) {
    for (const row of db.prepare(`SELECT ${key} AS k, data_json FROM ${table}`).all()) {
      const d = JSON.parse(row.data_json);
      delete d.ja;
      if (Array.isArray(d.languages)) d.languages = d.languages.filter((l) => l !== 'ja');
      db.prepare(`UPDATE ${table} SET data_json = ? WHERE ${key} = ?`).run(JSON.stringify(d), row.k);
    }
  }
  db.prepare("DELETE FROM settings WHERE key IN ('content_hourly_seeded', 'content_langs_filled')").run();
  return db;
}

test('database creato prima dei servizi a ore: al riavvio compaiono guida, assistente, tour leader e meet & greet (e «Calcola un preventivo» funziona)', () => {
  const db = oldDb();
  const slugs = () => db.prepare('SELECT slug FROM content_tours').all().map((r) => r.slug);
  for (const s of ['guida-a-ore', 'assistente-a-ore', 'tour-leader', 'meet-and-greet']) assert.ok(!slugs().includes(s), `prima del recupero ${s} non c’è`);

  const store = createContentStore({ db, root: ROOT });
  for (const [slug, service] of [['guida-a-ore', 'guide'], ['assistente-a-ore', 'assistant'], ['tour-leader', 'leader'], ['meet-and-greet', 'meetgreet']]) {
    assert.equal(store.tour(slug)?.pricing, 'hourly', slug);
    assert.equal(store.tour(slug).service, service);
  }
  assert.ok(getSetting(db, 'content_hourly_seeded'), 'il recupero si segna: non si ripete');

  // la guida a ore è prenotabile dal pubblico e il preventivo si calcola
  const guide = store.tour('guida-a-ore');
  assert.equal(guide.active, true);
  const app = { rates: createRates({ db }) };
  const q = hourlyQuote(app, guide, { pax: 2, channel: 'b2c', hours: 2 });
  assert.equal(q.ok, true);
});

test('recupero dei servizi a ore: una sola volta, senza duplicare un servizio che c’è già e senza far rinascere ciò che si è eliminato', () => {
  const db = oldDb();
  // il sito ha già una sua «guida a ore» con un altro indirizzo: non se ne aggiunge una seconda
  db.prepare("INSERT INTO content_tours(slug, data_json, updated_at) VALUES('la-mia-guida', ?, 'x')").run(JSON.stringify({ model: 'group', pricing: 'hourly', service: 'guide', chooseHours: true, flexible: true, duration: 120, maxParticipants: 25, it: { title: 'La mia guida', summary: 'Su misura.' } }));
  const first = catchUpContent(db, ROOT);
  assert.deepEqual(first.tours.sort(), ['assistente-a-ore', 'meet-and-greet', 'tour-leader'], 'solo i servizi che mancano (la guida a ore c’è già, con un altro indirizzo)');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM content_tours WHERE slug = 'guida-a-ore'").get().n, 0);

  // chi ha eliminato un servizio dopo il recupero non lo vede tornare
  db.prepare("DELETE FROM content_tours WHERE slug = 'meet-and-greet'").run();
  assert.deepEqual(catchUpContent(db, ROOT).tours, []);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM content_tours WHERE slug = 'meet-and-greet'").get().n, 0);
});

test('traduzioni mancanti: si aggiungono i blocchi di una lingua arrivata dopo (tour, articoli, pagine) senza toccare ciò che c’è', () => {
  const db = oldDb();
  // un tour già ritoccato dal pannello in inglese e con un testo giapponese scritto a mano
  const row = JSON.parse(db.prepare("SELECT data_json FROM content_tours WHERE slug = 'cannaregio-ghetto'").get().data_json);
  row.en.title = 'Il mio titolo inglese';
  db.prepare("UPDATE content_tours SET data_json = ? WHERE slug = 'cannaregio-ghetto'").run(JSON.stringify(row));
  const hand = JSON.parse(db.prepare("SELECT data_json FROM content_tours WHERE slug = 'san-marco-rialto'").get().data_json);
  hand.ja = { title: 'マイツアー', summary: '手書き' };
  db.prepare("UPDATE content_tours SET data_json = ? WHERE slug = 'san-marco-rialto'").run(JSON.stringify(hand));

  const added = catchUpContent(db, ROOT);
  assert.ok(added.translations.includes('cannaregio-ghetto:ja'));
  assert.ok(added.translations.some((x) => /^about:ja$/.test(x)), 'anche le pagine');
  assert.ok(added.translations.some((x) => /:ja$/.test(x) && !/^(about|privacy|terms|cookies):/.test(x) && !x.includes('ghetto') && !x.includes('rialto')), 'e gli articoli');

  const store = createContentStore({ db, root: ROOT });
  const ghetto = store.tour('cannaregio-ghetto');
  assert.equal(ghetto.i18n.en.title, 'Il mio titolo inglese', 'ciò che c’era resta com’è');
  assert.equal(ghetto.i18n.ja.fallback, false, 'ora c’è il testo giapponese');
  assert.ok(ghetto.languages.includes('ja'), 'e il tour lo offre come lingua');
  assert.equal(store.tour('san-marco-rialto').i18n.ja.title, 'マイツアー', 'un testo scritto a mano non si sovrascrive');
  assert.ok(store.page('about', 'ja').title);

  // una seconda volta non fa nulla: se poi si toglie un blocco dal pannello non ricompare
  assert.deepEqual(catchUpContent(db, ROOT), { tours: [], translations: [] });
});

test('un database nuovo non ha nulla da recuperare e un database svuotato di proposito resta vuoto', () => {
  const db = openDb(':memory:');
  assert.equal(seedContent(db, ROOT), true);
  assert.deepEqual(catchUpContent(db, ROOT), { tours: [], translations: [] });
  db.exec('DELETE FROM content_tours');
  assert.equal(createContentStore({ db, root: ROOT }).allTours.length, 0);
});
