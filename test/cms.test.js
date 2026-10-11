// Contenuti modificabili dal pannello: tour, listino, immagini (e, più avanti nel file, articoli, pagine e testi).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { ContentError, loadContent } from '../server/content.js';
import { createContentStore, seedContent } from '../server/contentStore.js';
import { openDb } from '../server/db.js';
import { setTextOverrides } from '../server/i18n.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-cms-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, policy: { allowPayOnSite: true } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') }); // senza `content`: il sito legge il database
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
  const admin = jar();
  await admin('/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=segreto-admin' });
  return { app, base, jar, admin, close: () => { app.close(); http.close(); setTextOverrides(new Map()); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString() });
const json = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
const loc = (res) => res.headers.get('location');

// una piccola immagine JPEG valida (1×1) come data URL
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const dataUrl = (buf = JPEG, mime = 'image/jpeg') => `data:${mime};base64,${buf.toString('base64')}`;

const TOUR = {
  slug: 'gondola-al-tramonto', title_it: 'Gondola al tramonto', summary_it: 'Un’ora in gondola nel canale.', description_it: 'Una **bella** esperienza.\n\nCon vista sul Canal Grande.',
  title_en: 'Gondola at sunset', summary_en: 'An hour by gondola.',
  model: 'group', times: '', flexible: '1', wd: ['0', '1', '2', '3', '4', '5', '6'], durH: '1', durM: '0', maxParticipants: '5', price: '120', b2bPrice: '90', active: '1', payOnSite: '1', langs: ['it', 'en'], art: 'bridge', image: '', order: '3',
  highlights_it: 'Canali stretti\nPonte dei Sospiri', includes_it: 'Gondoliere',
};

test('primo avvio: i file di content/ finiscono nel database e il sito li legge da lì; nuovi avvii non li reimportano', async (t) => {
  const db = openDb(':memory:');
  assert.equal(seedContent(db, ROOT), true);
  assert.equal(seedContent(db, ROOT), false, 'una seconda volta non importa nulla');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_tours').get().n, 7);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_posts').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_pages').get().n, 4);
  const store = createContentStore({ db, root: ROOT });
  const files = loadContent(ROOT);
  assert.deepEqual(store.tours.map((x) => x.slug), files.tours.map((x) => x.slug), 'stessi tour, stesso ordine');
  assert.equal(store.tour('cannaregio-ghetto').priceCents, 3500);
  assert.equal(store.page('about', 'es').title, files.page('about', 'es').title);
  assert.equal(store.problems.length, 0);
  // se si eliminano tutti i contenuti, non si reimportano al riavvio (è una scelta di chi gestisce il sito)
  db.exec('DELETE FROM content_tours');
  assert.equal(createContentStore({ db, root: ROOT }).tours.length, 0);
  // una voce rovinata non ferma il sito: si salta e si segnala
  db.prepare("INSERT INTO content_tours(slug, data_json, updated_at) VALUES('rotto', '{\"model\":\"boh\"}', 'x')").run();
  const broken = createContentStore({ db, root: ROOT });
  assert.equal(broken.tours.length, 0);
  assert.match(broken.problems[0], /rotto/);
  db.close?.();
});

test('tour dal pannello: creare, modificare, nascondere, duplicare, eliminare; il sito cambia subito', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const list = await (await admin('/admin/tours')).text();
    assert.match(list, /Cannaregio e il Ghetto/);
    assert.match(list, /Nuovo tour/);

    // creazione: errori mostrati senza perdere ciò che si è scritto
    const bad = await admin('/admin/tours', form({ ...TOUR, price: 'abc' }));
    assert.equal(bad.status, 400);
    const badHtml = await bad.text();
    assert.match(badHtml, /Prezzo al pubblico: «abc» non è un importo valido/);
    assert.match(badHtml, /value="gondola-al-tramonto"/, 'il modulo conserva i dati');
    assert.equal((await admin('/admin/tours', form({ ...TOUR, wd: [] }))).status, 400);
    assert.equal((await admin('/admin/tours', form({ ...TOUR, slug: 'Con Spazi' }))).status, 400);
    assert.equal((await admin('/admin/tours', form({ ...TOUR, title_it: '' }))).status, 400, 'serve il titolo in italiano');

    const ok = await admin('/admin/tours', form(TOUR));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), '/admin/tours/gondola-al-tramonto?ok=created');
    assert.equal((await admin('/admin/tours', form(TOUR))).status, 400, 'l’indirizzo è già usato');

    // il sito lo mostra subito, nelle tre lingue (en dalla sua traduzione, es ripiega sull'inglese)
    const anon = s.jar();
    const itPage = await (await anon('/it/tours/gondola-al-tramonto')).text();
    assert.match(itPage, /Gondola al tramonto/);
    assert.match(itPage, /<strong>bella<\/strong>/, 'markdown della descrizione');
    assert.match(itPage, /120\s*€/);
    assert.match(await (await anon('/en/tours/gondola-al-tramonto')).text(), /Gondola at sunset/);
    assert.match(await (await anon('/es/tours/gondola-al-tramonto')).text(), /Gondola at sunset/, 'senza traduzione spagnola ripiega sull’inglese');
    assert.match(await (await anon('/it/tours')).text(), /Gondola al tramonto/);
    const tour = s.app.content.tour('gondola-al-tramonto');
    assert.equal(tour.priceCents, 12000);
    assert.equal(tour.b2bPriceCents, 9000);
    assert.equal(tour.durationMin, 60);
    assert.equal(tour.i18n.es.fallback, true);
    // si può prenotare
    const slots = await (await anon(`/api/slots?tour=gondola-al-tramonto&date=${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}&pax=2`)).json();
    assert.ok(slots.slots?.length > 0, 'orario libero: ci sono slot');
    assert.equal(slots.slots[0].totalCents, 12000);

    // modifica: nuovo prezzo e titolo; le prenotazioni già fatte non cambiano (hanno il loro totale)
    const edit = await admin('/admin/tours/gondola-al-tramonto', form({ ...TOUR, price: '130,50', title_it: 'Gondola all’imbrunire', title_es: 'Góndola al atardecer', summary_es: 'Una hora en góndola.' }));
    assert.equal(loc(edit), '/admin/tours/gondola-al-tramonto?ok=saved');
    assert.match(await (await anon('/it/tours/gondola-al-tramonto')).text(), /130,50\s*€/);
    assert.match(await (await anon('/es/tours/gondola-al-tramonto')).text(), /Góndola al atardecer/);
    assert.equal(s.app.content.tour('gondola-al-tramonto').i18n.es.fallback, false);
    const form1 = await (await admin('/admin/tours/gondola-al-tramonto')).text();
    assert.match(form1, /name="title_it" value="Gondola all’imbrunire"/);
    assert.match(form1, /Canali stretti\nPonte dei Sospiri/, 'le liste tornano una per riga');

    // nascondere / mostrare
    assert.equal(loc(await admin('/admin/tours/gondola-al-tramonto/toggle', form({}))), '/admin/tours?ok=toggled');
    assert.equal((await anon('/it/tours/gondola-al-tramonto')).status, 404, 'nascosto: non si vede');
    assert.ok(s.app.content.tour('gondola-al-tramonto'), 'ma resta nello storico');
    assert.ok(!(await (await anon('/it/tours')).text()).includes('imbrunire'));
    await admin('/admin/tours/gondola-al-tramonto/toggle', form({}));
    assert.equal((await anon('/it/tours/gondola-al-tramonto')).status, 200);

    // duplica: modulo precompilato (nuovo indirizzo)
    const dup = await (await admin('/admin/tours/new?from=gondola-al-tramonto')).text();
    assert.match(dup, /Gondola all’imbrunire \(copia\)/);
    assert.match(dup, /name="slug" value=""/);

    // eliminazione: impossibile con prenotazioni, possibile senza
    s.app.db.prepare(`INSERT INTO bookings(ref, token, tour_slug, date, start_time, end_time, participants, channel, name, email, total_cents, status, payment_method, payment_status, free_cancel_until, created_at) VALUES('VE-TESTXX','t','cannaregio-ghetto','2030-01-01','10:00','12:30',2,'b2c','A','a@example.com',7000,'confirmed','card','paid','2030-01-01T00:00:00Z','2029-01-01T00:00:00Z')`).run();
    assert.match(decodeURIComponent(loc(await admin('/admin/tours/cannaregio-ghetto/delete', form({})))), /ha delle prenotazioni/);
    assert.ok(s.app.content.tour('cannaregio-ghetto'));
    assert.equal(loc(await admin('/admin/tours/gondola-al-tramonto/delete', form({}))), '/admin/tours?ok=deleted');
    assert.equal(s.app.content.tour('gondola-al-tramonto'), undefined);
    assert.equal((await anon('/it/tours/gondola-al-tramonto')).status, 404);

    // senza login non si entra
    assert.equal(loc(await anon('/admin/tours')), '/admin/login');
    assert.equal(loc(await anon('/admin/tours', form(TOUR))), '/admin/login');
  } finally {
    s.close();
  }
});

test('listino prezzi: tutti i prezzi insieme, validazione, effetto sulle nuove prenotazioni', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const page = await (await admin('/admin/prices')).text();
    assert.match(page, /name="price_cannaregio-ghetto" inputmode="decimal" value="35"/);
    const all = Object.fromEntries(s.app.content.allTours.flatMap((t) => [[`price_${t.slug}`, String(t.priceCents / 100)], [`b2b_${t.slug}`, String(t.b2bPriceCents / 100)]]));
    assert.equal((await admin('/admin/prices', form({ ...all, 'price_cannaregio-ghetto': 'x' }))).status, 400);
    assert.equal(s.app.content.tour('cannaregio-ghetto').priceCents, 3500, 'un errore non salva nulla');
    assert.equal(loc(await admin('/admin/prices', form({ ...all, 'price_cannaregio-ghetto': '38', 'b2b_cannaregio-ghetto': '30,5' }))), '/admin/prices?ok=prices');
    const t = s.app.content.tour('cannaregio-ghetto');
    assert.equal(t.priceCents, 3800);
    assert.equal(t.b2bPriceCents, 3050);
    assert.match(await (await s.jar()('/it/tours/cannaregio-ghetto')).text(), /38\s*€/);
  } finally {
    s.close();
  }
});

test('immagini: caricamento (validato lato server), copertina del tour, servite con cache lunga, eliminazione solo se non in uso', async () => {
  const s = await start();
  try {
    const { admin } = s;
    // formati e contenuti non ammessi
    for (const body of [{}, { large: 'ciao', small: 'ciao' }, { large: dataUrl(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml'), small: dataUrl() }, { large: dataUrl(Buffer.from('non sono un jpeg')), small: dataUrl() }, { large: dataUrl(), small: dataUrl(Buffer.from('xx')) }]) {
      const res = await admin('/admin/media', json(body));
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal((await res.json()).ok, false);
    }
    assert.equal((await admin('/admin/media', json({ large: dataUrl(Buffer.alloc(4.5 * 1024 * 1024, 0xff).fill(Buffer.from([0xff, 0xd8, 0xff]), 0, 3)), small: dataUrl() }))).status, 400, 'oltre 4 MB');
    const up = await admin('/admin/media', json({ large: dataUrl(), small: dataUrl(), width: 1600, height: 900 }));
    assert.equal(up.status, 200);
    const { name, small } = await up.json();
    assert.match(name, /^[a-f0-9]{24}\.jpg$/);
    assert.equal(small, name.replace('.jpg', '-s.jpg'));
    assert.equal((await (await admin('/admin/media', json({ large: dataUrl(), small: dataUrl() }))).json()).name, name, 'la stessa foto resta una sola');
    assert.equal(s.app.media.list().length, 1);

    // si serve a chiunque, con cache lunga e senza sniffing
    const anon = s.jar();
    const img = await anon(`/media/${name}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.match(img.headers.get('cache-control'), /immutable/);
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await anon(`/media/${small}`)).status, 200);
    assert.equal((await anon('/media/../../etc/passwd')).status, 404);
    assert.equal((await anon('/media/AAAAAAAAAAAAAAAAAAAAAAAA.jpg')).status, 404);
    assert.equal((await anon('/media/nome-qualsiasi.jpg')).status, 404);
    // caricare richiede il login
    assert.equal(loc(await anon('/admin/media', json({ large: dataUrl(), small: dataUrl() }))), '/admin/login');

    // libreria e selettore nel modulo del tour
    assert.match(await (await admin('/admin/media')).text(), new RegExp(small));
    const def = s.app.content.rawTour('cannaregio-ghetto');
    assert.equal(def.image, undefined);
    const v = await (await admin('/admin/tours/cannaregio-ghetto')).text();
    assert.match(v, new RegExp(`name="image" value="${name}"`));
    // copertina: il sito usa la foto (srcset) e l'anteprima social
    const save = await admin('/admin/tours/cannaregio-ghetto', form({ ...tourFormFromDef(def), image: name }));
    assert.equal(loc(save), '/admin/tours/cannaregio-ghetto?ok=saved');
    const page = await (await anon('/it/tours/cannaregio-ghetto')).text();
    assert.match(page, new RegExp(`<img src="/media/${name}" srcset="/media/${small} 640w, /media/${name} 1600w"`));
    assert.match(page, new RegExp(`og:image" content="http://localhost/media/${name}"`));
    assert.match(await (await anon('/it/tours')).text(), new RegExp(`/media/${small} 640w`));
    // in uso: non si elimina; tolta dal tour sì
    const row = s.app.media.list()[0];
    assert.equal(loc(await admin(`/admin/media/${row.id}/delete`, form({}))), '/admin/media?err=used');
    await admin('/admin/tours/cannaregio-ghetto', form({ ...tourFormFromDef(def), image: '' }));
    assert.equal(loc(await admin(`/admin/media/${row.id}/delete`, form({}))), '/admin/media?ok=deleted');
    assert.equal((await anon(`/media/${name}`)).status, 404);
  } finally {
    s.close();
  }
});

/** I campi del modulo di un tour, a partire dalla definizione salvata (per modificarne uno solo). */
import { defToValues } from '../server/views/admin-tours.js';
function tourFormFromDef(def) {
  const v = defToValues(def, '');
  const out = {};
  for (const [k, val] of Object.entries(v)) if (k !== 'slug') out[k] = val;
  return out;
}

const POST = { slug: 'una-passeggiata-a-castello', date: '2027-03-01', published: '1', art: 'walk', tours: ['cannaregio-ghetto'], title_it: 'Una passeggiata a Castello', summary_it: 'Il sestiere meno turistico.', tags_it: 'castello, quartieri', body_it: '## Tra le calli\n\nUn **testo** di prova con [un link](/it/tours).', title_es: 'Un paseo por Castello', body_es: 'Texto de prueba.' };

test('blog dal pannello: nuovo articolo, lingue, bozza, tour collegati, modifica, eliminazione', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    assert.match(await (await admin('/admin/blog')).text(), /Cicchetti e bacari|cicchetti/i);
    // errori
    assert.equal((await admin('/admin/blog', form({ ...POST, date: 'ieri' }))).status, 400);
    assert.equal((await admin('/admin/blog', form({ ...POST, title_it: '', body_it: '', title_es: '', body_es: '' }))).status, 400, 'serve almeno una lingua');
    assert.equal((await admin('/admin/blog', form({ ...POST, tours: ['non-esiste'] }))).status, 400);
    // creazione (con lo slug dal titolo se vuoto)
    const made = await admin('/admin/blog', form({ ...POST, slug: '' }));
    assert.equal(loc(made), '/admin/blog/una-passeggiata-a-castello?ok=created');
    assert.equal((await admin('/admin/blog', form(POST))).status, 400, 'indirizzo già usato');
    const it = await (await anon('/it/blog/una-passeggiata-a-castello')).text();
    assert.match(it, /Una passeggiata a Castello/);
    assert.match(it, /<h2[^>]*>Tra le calli<\/h2>/);
    assert.match(it, /<strong>testo<\/strong>/);
    assert.match(it, /Cannaregio e il Ghetto/, 'tour collegato in fondo');
    assert.match(await (await anon('/it/blog')).text(), /Una passeggiata a Castello/);
    assert.match(await (await anon('/es/blog/una-passeggiata-a-castello')).text(), /Un paseo por Castello/);
    assert.equal((await anon('/en/blog/una-passeggiata-a-castello')).status, 404, 'non scritto in inglese: non compare');
    assert.ok(!(await (await anon('/en/blog')).text()).includes('Castello'));
    const sm = await (await anon('/sitemap.xml')).text();
    assert.match(sm, /\/it\/blog\/una-passeggiata-a-castello/);
    assert.ok(!sm.includes('/en/blog/una-passeggiata-a-castello'));
    // bozza: sparisce dal sito e dalla sitemap
    assert.equal(loc(await admin('/admin/blog/una-passeggiata-a-castello', form({ ...POST, published: '' }))), '/admin/blog/una-passeggiata-a-castello?ok=saved');
    assert.equal((await anon('/it/blog/una-passeggiata-a-castello')).status, 404);
    assert.ok(!(await (await anon('/sitemap.xml')).text()).includes('una-passeggiata-a-castello'));
    assert.match(await (await admin('/admin/blog')).text(), /bozza/);
    // modifica e riedizione del modulo
    await admin('/admin/blog/una-passeggiata-a-castello', form({ ...POST, title_it: 'Castello, la passeggiata' }));
    assert.match(await (await anon('/it/blog/una-passeggiata-a-castello')).text(), /Castello, la passeggiata/);
    assert.match(await (await admin('/admin/blog/una-passeggiata-a-castello')).text(), /name="title_it" value="Castello, la passeggiata"/);
    // eliminazione
    assert.equal(loc(await admin('/admin/blog/una-passeggiata-a-castello/delete', form({}))), '/admin/blog?ok=deleted');
    assert.equal((await anon('/it/blog/una-passeggiata-a-castello')).status, 404);
    // senza login nulla
    assert.equal(loc(await anon('/admin/blog', form(POST))), '/admin/login');
  } finally {
    s.close();
  }
});

test('pagine fisse dal pannello: modifica del testo con i dati dell’attività, lingue, validazioni', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    assert.match(await (await admin('/admin/pages')).text(), /Chi sono/);
    const form1 = await (await admin('/admin/pages/about')).text();
    assert.match(form1, /name="title_it" value="Chi sono"/);
    assert.match(form1, /\{\{license\}\}/, 'le variabili sono elencate');
    assert.equal((await admin('/admin/pages/inventata')).status, 404);
    assert.equal((await admin('/admin/pages/inventata', form({ title_it: 'x', body_it: 'y' }))).status, 404);
    assert.equal((await admin('/admin/pages/about', form({ title_it: '', body_it: '' }))).status, 400, 'una pagina vuota non si salva');
    const ok = await admin('/admin/pages/about', form({ title_it: 'Chi sono davvero', description_it: 'Descrizione', body_it: 'Ciao, sono **Davide**. Contatto: {{email}}', title_en: 'About me', body_en: 'Hi, I am Davide.' }));
    assert.equal(loc(ok), '/admin/pages/about?ok=saved');
    const page = await (await anon('/it/about')).text();
    assert.match(page, /Chi sono davvero/);
    assert.match(page, /<strong>Davide<\/strong>/);
    assert.match(page, /info@example\.com/, 'la variabile {{email}} è sostituita');
    assert.match(await (await anon('/en/about')).text(), /Hi, I am Davide/);
    assert.match(await (await anon('/es/about')).text(), /Hi, I am Davide/, 'senza spagnolo ripiega sull’inglese');
  } finally {
    s.close();
  }
});

test('testi dell’interfaccia dal pannello: modifica per lingua, segnaposto protetti, ripristino, ricerca', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    const page = await (await admin('/admin/texts?section=nav')).text();
    assert.match(page, /name="t__nav\.book__it"/);
    assert.match(page, /Menu <small>/);
    // cambiare un testo: solo quella lingua
    const keys = 'nav.book nav.tours';
    const base = { section: 'nav', keys, 't__nav.book__it': 'Prenota ora', 't__nav.book__en': 'Book', 't__nav.book__es': 'Reservar', 't__nav.tours__it': 'Tour', 't__nav.tours__en': 'Tours', 't__nav.tours__es': 'Tours' };
    assert.equal(loc(await admin('/admin/texts', form(base))), '/admin/texts?section=nav&ok=saved');
    assert.match(await (await anon('/it/')).text(), />Prenota ora</);
    assert.match(await (await anon('/en/')).text(), />Book</, 'l’inglese non cambia');
    assert.equal(s.app.content.textOverrides().length, 1, 'solo ciò che è diverso dall’originale si salva');
    assert.match(await (await admin('/admin/texts?section=nav')).text(), /modificato/);
    // i segnaposto vanno mantenuti
    const ph = { section: 'tour', keys: 'tour.upTo', 't__tour.upTo__it': 'fino a tante persone', 't__tour.upTo__en': 'up to {n} guests', 't__tour.upTo__es': 'hasta {n} personas' };
    const bad = await admin('/admin/texts', form(ph));
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /mantieni le parti tra graffe/);
    assert.equal(s.app.content.textOverrides().length, 1, 'niente salvato a metà');
    assert.equal((await admin('/admin/texts', form({ ...ph, 't__tour.upTo__it': 'fino a {n} ospiti' }))).status, 303);
    assert.equal(s.app.content.textOverrides().length, 2);
    // ripristino: svuotare il testo toglie la modifica
    await admin('/admin/texts', form({ ...base, 't__nav.book__it': '' }));
    assert.match(await (await anon('/it/')).text(), />Prenota</);
    assert.equal(s.app.content.textOverrides().length, 1);
    // chiavi inventate ignorate; ricerca
    assert.equal((await admin('/admin/texts', form({ section: 'nav', keys: 'chiave.inventata', 't__chiave.inventata__it': 'x' }))).status, 303);
    assert.match(await (await admin('/admin/texts?q=guests')).text(), /tour\.upTo/);
    assert.equal(loc(await anon('/admin/texts', form(base))), '/admin/login');
  } finally {
    s.close();
  }
});
