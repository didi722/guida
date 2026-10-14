// Contenuti nel database: tour, articoli, pagine e testi del sito si modificano dal pannello admin.
// Al primo avvio si importano i file di `content/` (contenuto iniziale); da quel momento vale ciò che è nel database.
import { getSetting, setSetting, tx } from './db.js';
import { ContentError, PAGE_NAMES, SLUG, buildContent, makeContent, normalizePage, normalizePost, normalizeTour, readContentFiles, splitLegacyTour } from './content.js';
import { defaultText, setTextOverrides, textOverrideKey } from './i18n.js';
import { LANGS } from './langs.js';

const nowIso = () => new Date().toISOString();

const HOURLY_KEY = 'content_hourly_seeded'; // data in cui si sono controllati i servizi a ore
const TERMS_KEY = 'content_terms_invite'; // data in cui si sono aggiunte alle condizioni la clausola «porta un amico» e il punto d'incontro
const LANGS_KEY = 'content_langs_filled'; // lingue per cui si sono già completate le traduzioni mancanti

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
    // il contenuto iniziale è completo: non c'è nulla da recuperare
    setSetting(db, HOURLY_KEY, nowIso());
    setSetting(db, LANGS_KEY, [...LANGS]);
    setSetting(db, TERMS_KEY, nowIso());
  }
  setSetting(db, 'content_seeded', nowIso());
  return imported;
}

/**
 * Il contenuto iniziale si importa una volta sola: un sito creato con una versione più vecchia del codice non riceverebbe
 * mai ciò che è arrivato dopo. Qui si recupera, una volta per ciascuna cosa e SENZA mai toccare ciò che c'è già:
 *  - i servizi a ore (guida, assistente, tour leader, meet & greet): senza di essi «Calcola un preventivo» non ha nulla da mostrare;
 *  - le traduzioni di una lingua arrivata dopo (blocchi di testo che nel database mancano del tutto: spagnolo, giapponese…).
 * Ritorna cosa è stato aggiunto (utile ai test e al log).
 */
export function catchUpContent(db, root) {
  const added = { tours: [], translations: [] };
  const langsDone = new Set(getSetting(db, LANGS_KEY, ['it', 'en']));
  const todoLangs = LANGS.filter((l) => !langsDone.has(l));
  const needHourly = !getSetting(db, HOURLY_KEY);
  if (!needHourly && !todoLangs.length) return added;
  let raw;
  try {
    raw = readContentFiles(root);
  } catch (err) {
    console.error('[contenuti] aggiornamento del contenuto iniziale non riuscito:', err.message);
    return added;
  }
  tx(db, () => {
    const at = nowIso();
    // «guida a ore con durata a scelta», «itinerario a durata fissa»…: un servizio dello stesso tipo che c'è già, con un altro indirizzo, non si duplica
    const kind = (d) => `${d.service}:${d.chooseHours ? 'choose' : 'fixed'}`;
    const hourlyHave = new Set(db.prepare('SELECT data_json FROM content_tours').all().map((r) => JSON.parse(r.data_json)).filter((d) => d.pricing === 'hourly').map(kind));
    if (needHourly) {
      for (const [slug, d] of Object.entries(raw.tours)) {
        if (d.pricing !== 'hourly' || hourlyHave.has(kind(d)) || db.prepare('SELECT 1 FROM content_tours WHERE slug = ?').get(slug)) continue;
        db.prepare('INSERT INTO content_tours(slug, data_json, updated_at) VALUES(?,?,?)').run(slug, JSON.stringify(d), at);
        added.tours.push(slug);
      }
      setSetting(db, HOURLY_KEY, at);
    }
    if (todoLangs.length) {
      const fill = (table, keyCol, seeds, withLanguages = false) => {
        for (const [key, seed] of Object.entries(seeds)) {
          const row = db.prepare(`SELECT data_json FROM ${table} WHERE ${keyCol} = ?`).get(key);
          if (!row) continue;
          const data = JSON.parse(row.data_json);
          const filled = [];
          for (const l of todoLangs) {
            if (data[l] || !seed[l]) continue; // c'è già (anche se modificato dal pannello) o non c'è una traduzione da dare
            data[l] = seed[l];
            filled.push(l);
            if (withLanguages && Array.isArray(data.languages) && !data.languages.includes(l) && Array.isArray(seed.languages) && seed.languages.includes(l)) data.languages.push(l);
          }
          if (!filled.length) continue;
          db.prepare(`UPDATE ${table} SET data_json = ?, updated_at = ? WHERE ${keyCol} = ?`).run(JSON.stringify(data), at, key);
          added.translations.push(...filled.map((l) => `${key}:${l}`));
        }
      };
      fill('content_tours', 'slug', raw.tours, true);
      fill('content_posts', 'slug', raw.posts);
      fill('content_pages', 'name', raw.pages);
      setSetting(db, LANGS_KEY, [...new Set([...langsDone, ...todoLangs])]);
    }
  });
  return added;
}

/** Le due aggiunte alle condizioni di prenotazione, per lingua: la clausola «porta un amico» (dopo la riga delle agenzie) e la frase sul punto d'incontro. */
const TERMS_ADDITIONS = {
  it: {
    has: 'Porta un amico',
    clause: "- **«Porta un amico»:** se chi ha invitato annulla dopo che l'amico ha prenotato con il suo link, dal rimborso si trattiene lo sconto che l'amico ha ottenuto (se la prenotazione non è ancora stata pagata, quell'importo resta dovuto). I link di invito non ancora usati non sono più validi.",
    meetLine: /^Presentati al punto d'incontro/, meet: " Nei servizi in cui indichi tu il punto d'incontro (per esempio il tuo hotel), se non scrivi nulla ci vediamo a Campo San Luca.",
  },
  en: {
    has: 'Bring a friend',
    clause: '- **“Bring a friend”:** if the person who sent the invitation cancels after the friend has booked with their link, the discount the friend received is deducted from the refund (if the booking has not been paid yet, that amount remains due). Invitation links not yet used are no longer valid.',
    meetLine: /^Please arrive at the meeting point/, meet: ' For services where you choose the meeting point (for example your hotel), if you write nothing we meet at Campo San Luca.',
  },
  es: {
    has: 'Trae a un amigo',
    clause: '- **«Trae a un amigo»:** si quien envió la invitación cancela después de que el amigo haya reservado con su enlace, del reembolso se retiene el descuento que recibió el amigo (si la reserva aún no se ha pagado, ese importe sigue siendo debido). Los enlaces de invitación aún no usados dejan de ser válidos.',
    meetLine: /^Preséntate en el punto de encuentro/, meet: ' En los servicios en los que tú indicas el punto de encuentro (por ejemplo tu hotel), si no escribes nada nos vemos en Campo San Luca.',
  },
  ja: {
    has: 'ご友人とご一緒に',
    clause: '- **「ご友人とご一緒に」**：招待したお客様が、ご友人がそのリンクで予約した後にキャンセルされた場合、ご友人が受けた割引額を返金額から差し引きます（未払いの場合は、その金額が請求されます）。未使用の招待リンクは無効になります。',
    meetLine: /^指定された時刻に集合場所へ/, meet: '集合場所をお客様がご指定いただくサービス（例：ホテル）で、記入がない場合は Campo San Luca に集合します。',
  },
};

/**
 * Le pagine di testo si importano una volta sola, quindi un sito già in funzione non riceverebbe le nuove condizioni. Una volta sola,
 * alla pagina «Condizioni» (per ogni lingua) si AGGIUNGONO la clausola «porta un amico» e la frase sul punto d'incontro, senza toccare
 * nient'altro e senza ripetere ciò che c'è già (anche se il testo è stato modificato dal pannello).
 * @returns {string[]} le lingue aggiornate
 */
export function catchUpTerms(db) {
  if (getSetting(db, TERMS_KEY)) return [];
  const done = [];
  const row = db.prepare("SELECT data_json FROM content_pages WHERE name = 'terms'").get();
  if (row) {
    const data = JSON.parse(row.data_json);
    for (const [l, add] of Object.entries(TERMS_ADDITIONS)) {
      const body = data[l]?.body;
      if (typeof body !== 'string') continue;
      const lines = body.split('\n');
      let changed = false;
      if (!body.includes(add.has)) {
        const i = lines.findIndex((x) => x.startsWith('- ') && x.includes('{{b2bHours}}')); // la riga delle agenzie, nelle cancellazioni
        if (i >= 0) { lines.splice(i + 1, 0, add.clause); changed = true; }
      }
      if (!body.includes('Campo San Luca')) {
        const j = lines.findIndex((x) => add.meetLine.test(x));
        if (j >= 0) { lines[j] = lines[j].replace(/\s+$/, '') + add.meet; changed = true; }
      }
      if (changed) { data[l] = { ...data[l], body: lines.join('\n') }; done.push(l); }
    }
    if (done.length) db.prepare("UPDATE content_pages SET data_json = ?, updated_at = ? WHERE name = 'terms'").run(JSON.stringify(data), nowIso());
  }
  setSetting(db, TERMS_KEY, nowIso());
  return done;
}

/**
 * Prima ogni tour aveva due tariffe (privati e agenzie); ora un tour è B2C oppure B2B, con un solo prezzo. Una volta sola, per i tour salvati
 * prima della divisione (senza «audience»), SENZA toccare nient'altro:
 *  - i servizi che esistevano solo per le agenzie (assistente, tour leader, meet & greet) diventano B2B;
 *  - ogni altro tour diventa B2C (con il prezzo al pubblico) e ne nasce una copia B2B «<indirizzo>-agenzie» con la vecchia tariffa agenzie:
 *    le agenzie continuano a trovare gli stessi servizi agli stessi prezzi, e si modificano nella nuova sezione «Tour B2B»;
 *  - il listino dedicato di un partner (prezzi per tour) passa all'indirizzo della copia B2B.
 * Ritorna gli indirizzi delle copie create.
 */
export function splitLegacyAudiences(db) {
  const created = [];
  tx(db, () => {
    const at = nowIso();
    const rows = db.prepare('SELECT slug, data_json FROM content_tours').all();
    const taken = new Set(rows.map((r) => r.slug));
    const moved = {};
    for (const r of rows) {
      const split = splitLegacyTour(r.slug, JSON.parse(r.data_json));
      if (!split) continue;
      if (split.twin && !taken.has(split.twin.slug)) {
        db.prepare('INSERT INTO content_tours(slug, data_json, updated_at) VALUES(?,?,?)').run(split.twin.slug, JSON.stringify(split.twin.def), at);
        taken.add(split.twin.slug);
        created.push(split.twin.slug);
        moved[r.slug] = split.twin.slug;
      }
      db.prepare('UPDATE content_tours SET data_json = ?, updated_at = ? WHERE slug = ?').run(JSON.stringify(split.def), at, r.slug);
    }
    if (Object.keys(moved).length) {
      for (const a of db.prepare('SELECT id, prices_json FROM accounts WHERE prices_json IS NOT NULL').all()) {
        let list;
        try { list = JSON.parse(a.prices_json); } catch { continue; }
        if (!list || typeof list !== 'object') continue;
        let changed = false;
        for (const [slug, twin] of Object.entries(moved)) if (slug in list) { list[twin] = list[slug]; delete list[slug]; changed = true; }
        if (changed) db.prepare('UPDATE accounts SET prices_json = ? WHERE id = ?').run(JSON.stringify(list), a.id);
      }
    }
  });
  return created;
}

const parse = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], JSON.parse(r.data_json)]));

export function createContentStore({ db, root }) {
  seedContent(db, root);
  const caught = catchUpContent(db, root);
  const termsLangs = catchUpTerms(db);
  if (termsLangs.length) console.log(`[contenuti] condizioni di prenotazione aggiornate (porta un amico, punto d'incontro): ${termsLangs.join(', ')}`);
  const split = splitLegacyAudiences(db);
  if (split.length) console.log(`[contenuti] tour divisi in B2C e B2B: create le copie per le agenzie (${split.join(', ')})`);
  if (caught.tours.length || caught.translations.length) console.log(`[contenuti] aggiunti dal contenuto iniziale: ${[...caught.tours.map((t) => `servizio ${t}`), ...(caught.translations.length ? [`${caught.translations.length} traduzioni`] : [])].join(', ')}`);
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
    /**
     * Ordine dei tour nell'elenco (home, pagina Tour, pannello): il primo della lista passa in cima. Gli indirizzi sconosciuti si ignorano;
     * i tour che non sono nella lista seguono, nel loro ordine attuale. Si numerano di 10 in 10, così resta spazio per inserirne altri.
     * @returns {number} quanti tour hanno cambiato posto
     */
    setTourOrder(slugs) {
      let changed = 0;
      tx(db, () => {
        const bySlug = new Map(db.prepare('SELECT slug, data_json FROM content_tours').all().map((r) => [r.slug, JSON.parse(r.data_json)]));
        const first = [...new Set((Array.isArray(slugs) ? slugs : []).map(String))].filter((s) => bySlug.has(s));
        const rest = [...bySlug.keys()].filter((s) => !first.includes(s)).sort((a, b) => Number(bySlug.get(a).order ?? 100) - Number(bySlug.get(b).order ?? 100) || a.localeCompare(b));
        [...first, ...rest].forEach((slug, i) => {
          const d = bySlug.get(slug);
          const order = (i + 1) * 10;
          if (d.order === order) return;
          d.order = order;
          db.prepare('UPDATE content_tours SET data_json = ?, updated_at = ? WHERE slug = ?').run(JSON.stringify(d), nowIso(), slug);
          changed++;
        });
      });
      if (changed) reload();
      return changed;
    },
    deleteTour(slug) {
      const rows = db.prepare('SELECT channel, status, date >= ? AS upcoming, COUNT(*) AS n FROM bookings WHERE tour_slug = ? GROUP BY channel, status, upcoming').all(nowIso().slice(0, 10), slug);
      if (rows.length) {
        const n = (f) => rows.filter(f).reduce((t, r) => t + r.n, 0);
        const parts = [
          [n((r) => ['confirmed', 'held', 'option'].includes(r.status) && r.upcoming), 'future'],
          [n((r) => ['confirmed', 'held', 'option'].includes(r.status) && !r.upcoming), 'passate'],
          [n((r) => ['cancelled', 'expired'].includes(r.status)), 'annullate o scadute'],
        ].filter(([c]) => c);
        const b2b = n((r) => r.channel === 'b2b');
        throw new ContentError(`Il tour ha ${n(() => true) === 1 ? '1 prenotazione' : `${n(() => true)} prenotazioni`} nello storico (${parts.map(([c, l]) => `${c} ${l}`).join(', ')}${b2b ? `; ${b2b} di agenzie` : ''}): se lo eliminassi, resterebbero senza tour. Nascondilo: sparisce dal sito e lo storico resta intatto.`);
      }
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
