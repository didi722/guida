// Contenuti nel database: tour, articoli, pagine e testi del sito si modificano dal pannello admin.
// Al primo avvio si importano i file di `content/` (contenuto iniziale); da quel momento vale ciò che è nel database.
import { getSetting, setSetting, tx } from './db.js';
import { ContentError, PAGE_NAMES, SLUG, buildContent, makeContent, normalizePage, normalizePost, normalizeTour, readContentFiles } from './content.js';
import { defaultText, setTextOverrides, textOverrideKey } from './i18n.js';
import { LANGS } from './langs.js';

const nowIso = () => new Date().toISOString();

/** Importa i file di `content/` la prima volta (database senza contenuti). Restituisce true se ha importato. */
export function seedContent(db, root) {
  if (getSetting(db, 'content_seeded')) return false;
  const empty = db.prepare('SELECT (SELECT COUNT(*) FROM content_tours) + (SELECT COUNT(*) FROM content_posts) + (SELECT COUNT(*) FROM content_pages) AS n').get().n === 0;
  let imported = false;
  if (empty) {
    const raw = readContentFiles(root);
    buildContent(raw); // se i file hanno un errore lo si vede subito, non a metà importazione
    tx(db, () => {
      const at = nowIso();
      for (const [slug, d] of Object.entries(raw.tours)) db.prepare('INSERT INTO content_tours(slug, data_json, updated_at) VALUES(?,?,?)').run(slug, JSON.stringify(d), at);
      for (const [slug, p] of Object.entries(raw.posts)) db.prepare('INSERT INTO content_posts(slug, data_json, updated_at) VALUES(?,?,?)').run(slug, JSON.stringify(p), at);
      for (const [name, p] of Object.entries(raw.pages)) db.prepare('INSERT INTO content_pages(name, data_json, updated_at) VALUES(?,?,?)').run(name, JSON.stringify(p), at);
    });
    imported = true;
  }
  setSetting(db, 'content_seeded', nowIso());
  return imported;
}

const parse = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], JSON.parse(r.data_json)]));

export function createContentStore({ db, root }) {
  seedContent(db, root);
  let current = makeContent({ tours: [], posts: [], pages: {} });
  let problems = [];

  const rawAll = () => ({
    tours: parse(db.prepare('SELECT slug, data_json FROM content_tours').all(), 'slug'),
    posts: parse(db.prepare('SELECT slug, data_json FROM content_posts').all(), 'slug'),
    pages: parse(db.prepare('SELECT name, data_json FROM content_pages').all(), 'name'),
  });

  function loadTexts() {
    const map = new Map();
    for (const r of db.prepare('SELECT key, lang, value FROM content_texts').all()) map.set(textOverrideKey(r.lang, r.key), r.value);
    setTextOverrides(map);
  }

  /** Ricostruisce ciò che vede il sito. Una voce rovinata si salta (e si segnala nel pannello) invece di fermare tutto il sito. */
  function reload() {
    const raw = rawAll();
    problems = [];
    const tours = [];
    for (const [slug, d] of Object.entries(raw.tours)) {
      try {
        tours.push(normalizeTour(slug, d, slug));
      } catch (err) {
        problems.push(`Tour «${slug}»: ${err.message}`);
      }
    }
    const posts = [];
    for (const [slug, p] of Object.entries(raw.posts)) {
      try {
        const post = normalizePost(slug, p, slug);
        post.tours = post.tours.filter((s) => tours.some((t) => t.slug === s)); // un tour cancellato sparisce dagli articoli
        posts.push(post);
      } catch (err) {
        problems.push(`Articolo «${slug}»: ${err.message}`);
      }
    }
    const pages = {};
    for (const [name, p] of Object.entries(raw.pages)) {
      try {
        pages[name] = normalizePage(name, p);
      } catch (err) {
        problems.push(`Pagina «${name}»: ${err.message}`);
      }
    }
    for (const p of problems) console.error(`[contenuti] ${p}`);
    current = makeContent({ tours, posts, pages });
    loadTexts();
  }
  reload();

  const upsert = (table, keyCol, key, data) =>
    db.prepare(`INSERT INTO ${table}(${keyCol}, data_json, updated_at) VALUES(?,?,?) ON CONFLICT(${keyCol}) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`).run(key, JSON.stringify(data), nowIso());

  const store = {
    // ── ciò che usa il sito (stessa forma di loadContent) ──
    get tours() { return current.tours; },
    get allTours() { return current.allTours; },
    tour: (slug) => current.tour(slug),
    get posts() { return current.posts; },
    get allPosts() { return current.allPosts; },
    postsFor: (lang) => current.postsFor(lang),
    post: (slug) => current.post(slug),
    postAny: (slug) => current.postAny(slug),
    page: (name, lang) => current.page(name, lang),
    get pageNames() { return current.pageNames; },
    get problems() { return problems; },
    reload,

    // ── forma «grezza», quella dei moduli di modifica ──
    rawTour: (slug) => { const r = db.prepare('SELECT data_json FROM content_tours WHERE slug = ?').get(slug); return r ? JSON.parse(r.data_json) : null; },
    rawPost: (slug) => { const r = db.prepare('SELECT data_json FROM content_posts WHERE slug = ?').get(slug); return r ? JSON.parse(r.data_json) : null; },
    rawPage: (name) => { const r = db.prepare('SELECT data_json FROM content_pages WHERE name = ?').get(name); return r ? JSON.parse(r.data_json) : null; },

    /** Salva (o crea) un tour. Lancia ContentError se i dati non vanno bene. */
    saveTour(slug, def, { create = false } = {}) {
      if (create && db.prepare('SELECT 1 FROM content_tours WHERE slug = ?').get(slug)) throw new ContentError(`Esiste già un tour con l'indirizzo «${slug}»`);
      normalizeTour(slug, def, slug);
      upsert('content_tours', 'slug', slug, def);
      reload();
    },
    deleteTour(slug) {
      if (db.prepare('SELECT 1 FROM bookings WHERE tour_slug = ? LIMIT 1').get(slug)) throw new ContentError('Il tour ha delle prenotazioni: nascondilo invece di eliminarlo (resta nello storico).');
      if (db.prepare(`SELECT 1 FROM promo_codes WHERE tours LIKE ? LIMIT 1`).get(`%"${slug}"%`)) throw new ContentError('Il tour è citato in un codice sconto: modifica o elimina prima il codice.');
      db.prepare('DELETE FROM content_tours WHERE slug = ?').run(slug);
      reload();
    },
    savePost(slug, raw, { create = false } = {}) {
      if (create && db.prepare('SELECT 1 FROM content_posts WHERE slug = ?').get(slug)) throw new ContentError(`Esiste già un articolo con l'indirizzo «${slug}»`);
      const post = normalizePost(slug, raw, slug);
      for (const s of post.tours) if (!current.tour(s)) throw new ContentError(`Tour inesistente: «${s}»`);
      upsert('content_posts', 'slug', slug, raw);
      reload();
    },
    deletePost(slug) {
      db.prepare('DELETE FROM content_posts WHERE slug = ?').run(slug);
      reload();
    },
    savePage(name, raw) {
      if (!PAGE_NAMES.includes(name)) throw new ContentError('Pagina sconosciuta');
      normalizePage(name, raw);
      upsert('content_pages', 'name', name, raw);
      reload();
    },

    // ── testi dell'interfaccia modificati ──
    textOverrides: () => db.prepare('SELECT key, lang, value FROM content_texts').all(),
    /** Salva i testi di una chiave: un valore uguale all'originale (o vuoto) toglie la modifica. */
    setTexts(key, values) {
      const original = defaultText(key);
      if (!original) throw new ContentError(`Testo sconosciuto: ${key}`);
      tx(db, () => {
        LANGS.forEach((lang, i) => {
          const v = values[lang];
          if (v == null) return;
          const text = String(v).trim();
          if (!text || text === original[i]) db.prepare('DELETE FROM content_texts WHERE key = ? AND lang = ?').run(key, lang);
          else db.prepare('INSERT INTO content_texts(key, lang, value, updated_at) VALUES(?,?,?,?) ON CONFLICT(key, lang) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, lang, text, nowIso());
        });
      });
      loadTexts();
    },
    resetTexts(key) {
      db.prepare('DELETE FROM content_texts WHERE key = ?').run(key);
      loadTexts();
    },

    /** Nomi dei file immagine usati da tour e articoli (per non cancellare ciò che è in uso). */
    usedImages() {
      const used = new Set();
      for (const t of current.allTours) if (t.image) used.add(t.image);
      for (const p of current.allPosts) if (p.image) used.add(p.image);
      return used;
    },

    /** Copia di sicurezza di tutti i contenuti (JSON). */
    export() {
      return { version: 1, exportedAt: nowIso(), ...rawAll(), texts: store.textOverrides() };
    },
  };
  return store;
}

export { SLUG };
