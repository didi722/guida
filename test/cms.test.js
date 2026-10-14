// Contenuti modificabili dal pannello: tour, listino, immagini (e, più avanti nel file, articoli, pagine e testi).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { ContentError, faqToText, loadContent, normalizeTour, parseFaq } from '../server/content.js';
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
  model: 'group', times: '', flexible: '1', wd: ['0', '1', '2', '3', '4', '5', '6'], durH: '1', durM: '0', maxParticipants: '5', audience: 'b2c', price: '120', active: '1', payOnSite: '1', langs: ['it', 'en'], art: 'bridge', image: '', order: '3',
  highlights_it: 'Canali stretti\nPonte dei Sospiri', includes_it: 'Gondoliere',
};

test('primo avvio: i file di content/ finiscono nel database e il sito li legge da lì; nuovi avvii non li reimportano', async (t) => {
  const db = openDb(':memory:');
  assert.equal(seedContent(db, ROOT), true);
  assert.equal(seedContent(db, ROOT), false, 'una seconda volta non importa nulla');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_tours').get().n, 8);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_posts').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_pages').get().n, 4);
  const store = createContentStore({ db, root: ROOT });
  const files = loadContent(ROOT);
  // i tour dei file (con due tariffe) diventano B2C; i servizi che le agenzie potevano prenotare hanno anche la loro copia B2B, «<indirizzo>-agenzie»
  const own = store.tours.filter((x) => !x.slug.endsWith('-agenzie'));
  assert.deepEqual(own.map((x) => x.slug), files.tours.map((x) => x.slug), 'stessi tour, stesso ordine');
  assert.equal(store.tour('cannaregio-ghetto').priceCents, 3500);
  assert.equal(store.tour('cannaregio-ghetto').audience, 'b2c');
  assert.equal(store.tour('cannaregio-ghetto-agenzie').audience, 'b2b');
  assert.equal(store.tour('cannaregio-ghetto-agenzie').priceCents, 2800, 'la vecchia tariffa agenzie');
  assert.equal(store.tour('guida-a-ore').audience, 'b2c');
  assert.equal(store.tour('guida-a-ore-agenzie').audience, 'b2b');
  assert.equal(store.tour('assistente-a-ore').audience, 'b2b', 'nato solo per le agenzie');
  assert.equal(store.tour('assistente-a-ore-agenzie'), undefined);
  assert.equal(store.tours.length, 13);
  assert.ok(store.tours.every((x) => x.audience === 'b2c' || x.audience === 'b2b') && store.tours.every((x) => !('b2bPriceCents' in x)));
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
    assert.match(list, /Nuovo tour B2C/);
    assert.ok(!list.includes('/admin/tours/assistente-a-ore"'), 'i tour B2B non sono in questa sezione');
    const listB2b = await (await admin('/admin/tours-b2b')).text();
    assert.match(listB2b, /Nuovo tour B2B/);
    assert.match(listB2b, /\/admin\/tours\/assistente-a-ore"/);
    assert.match(listB2b, /\/admin\/tours\/cannaregio-ghetto-agenzie"/);
    assert.ok(!listB2b.includes('/admin/tours/cannaregio-ghetto"'), 'e quelli B2C non sono in questa');

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
    assert.equal(tour.audience, 'b2c');
    assert.ok(!(await (await s.jar()('/it/b2b')).text()).includes('Gondola al tramonto'));
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
    assert.match(decodeURIComponent(loc(await admin('/admin/tours/cannaregio-ghetto/delete', form({})))), /ha 1 prenotazione nello storico \(1 future\)[^]*Nascondilo/);
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

test('ordine dei tour: si trascina nell’elenco e si salva; un tour nuovo va in fondo; il modulo di modifica non lo tocca', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const before = s.app.content.allTours.map((t) => t.slug);
    const list = await (await admin('/admin/tours')).text();
    assert.match(list, /data-sortable/);
    assert.match(list, /admin-tours-order\.js/);
    const b2cCount = s.app.content.allTours.filter((t) => t.audience === 'b2c').length;
    assert.equal((list.match(/class="drag-handle"/g) ?? []).length, b2cCount, 'una maniglia per ogni tour B2C (i B2B sono nell’altra sezione)');
    assert.equal((list.match(/data-move="-1"/g) ?? []).length, b2cCount, 'e le frecce');

    // l'ultimo passa in cima: lo salva il pannello, lo vede subito il sito
    const next = [before.at(-1), ...before.slice(0, -1)];
    const res = await admin('/admin/tours/order', json({ slugs: next }));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).order, next);
    assert.deepEqual(s.app.content.allTours.map((t) => t.slug), next);
    const tours = await (await s.jar()('/it/tours')).text();
    const shown = next.filter((slug) => tours.includes(`/it/tours/${slug}"`) && s.app.content.tour(slug).model === 'person'); // i tour di gruppo, nella loro categoria
    assert.ok(shown.length >= 2, 'la pagina Tour mostra i tour di gruppo B2C');
    assert.deepEqual(shown, [...shown].sort((a, b) => tours.indexOf(`/it/tours/${a}"`) - tours.indexOf(`/it/tours/${b}"`)), 'la pagina Tour segue l’ordine');
    assert.deepEqual(s.app.content.allTours.map((t) => t.order), next.map((_, i) => (i + 1) * 10), 'numerati di 10 in 10');

    // una lista parziale e indirizzi sconosciuti: quelli citati vanno in cima, gli altri seguono nel loro ordine
    await admin('/admin/tours/order', json({ slugs: [next[3], 'non-esiste', next[1]] }));
    assert.deepEqual(s.app.content.allTours.map((t) => t.slug).slice(0, 2), [next[3], next[1]]);
    assert.equal(s.app.content.allTours.length, before.length, 'nessun tour perso');

    // dati sbagliati o senza accesso
    assert.equal((await admin('/admin/tours/order', json({ slugs: 'x' }))).status, 400);
    assert.equal((await admin('/admin/tours/order', json({ slugs: [1, 2] }))).status, 400);
    const anon = await fetch(`${s.base}/admin/tours/order`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slugs: before.slice().reverse() }) });
    assert.equal(anon.status, 302, 'senza accesso non si cambia nulla');
    assert.equal(s.app.content.allTours[0].slug, next[3]);

    // il modulo non ha più il campo «ordine»: un tour nuovo va in fondo, e modificarlo non lo sposta
    assert.ok(!(await (await admin('/admin/tours/new')).text()).includes('name="order"'));
    assert.equal((await admin('/admin/tours', form({ ...TOUR, order: '1' }))).status, 303);
    assert.equal(s.app.content.allTours.at(-1).slug, 'gondola-al-tramonto', 'in fondo, anche se il modulo diceva «1»');
    await admin('/admin/tours/order', json({ slugs: ['gondola-al-tramonto'] }));
    assert.equal(s.app.content.allTours[0].slug, 'gondola-al-tramonto');
    await admin('/admin/tours/gondola-al-tramonto', form({ ...TOUR, order: '9999', price: '125' }));
    assert.equal(s.app.content.allTours[0].slug, 'gondola-al-tramonto', 'salvare il modulo non cambia la posizione');
    assert.equal(s.app.content.tour('gondola-al-tramonto').priceCents, 12500);
  } finally {
    s.close();
  }
});

test('domande frequenti del tour: formato a blocchi, markdown, ripiego fra le lingue, errori chiari', async () => {
  // formato: blocchi separati da una riga vuota; prima riga = domanda, il resto = risposta
  assert.deepEqual(parseFaq('Si entra?\nNo, solo dall’esterno.\n\n\nQuanto dura?\nDue ore.\nEmezza.'), [{ q: 'Si entra?', a: 'No, solo dall’esterno.' }, { q: 'Quanto dura?', a: 'Due ore.\nEmezza.' }]);
  assert.deepEqual(parseFaq('  \n\n'), []);
  assert.deepEqual(parseFaq([{ q: 'A?', a: 'B' }]), [{ q: 'A?', a: 'B' }], 'anche come lista, nei file iniziali');
  assert.equal(faqToText([{ q: 'A?', a: 'B' }, { q: 'C?', a: 'D' }]), 'A?\nB\n\nC?\nD', 'e di nuovo in testo per il modulo');
  assert.throws(() => parseFaq('Solo la domanda?'), /non ha la risposta/);
  assert.throws(() => parseFaq('D?\nR\n\nSenza risposta'), /«Senza risposta» non ha la risposta/);
  assert.throws(() => parseFaq(Array.from({ length: 21 }, (_, i) => `D${i}?\nR`).join('\n\n')), /al massimo 20/);
  assert.throws(() => parseFaq(`${'x'.repeat(201)}\nR`), /troppo lunga/);

  const def = (extra = {}) => ({ model: 'group', flexible: true, duration: 120, maxParticipants: 5, price: 100, it: { title: 'Tour', summary: 'Riassunto', ...extra.it }, ...(extra.en ? { en: { title: 'Tour', summary: 'Summary', ...extra.en } } : {}), ...(extra.es ? { es: { title: 'Tour', summary: 'Resumen', ...extra.es } } : {}) });
  // solo italiano: inglese e spagnolo ripiegano sull'italiano; l'inglese proprio vince sullo spagnolo che manca
  let t = normalizeTour('prova', def({ it: { faq: 'Domanda IT?\nRisposta con **grassetto**.' }, en: {} }));
  assert.deepEqual(['it', 'en', 'es'].map((l) => t.i18n[l].faq.length), [1, 1, 1]);
  assert.match(t.i18n.it.faq[0].html, /<strong>grassetto<\/strong>/);
  t = normalizeTour('prova', def({ it: { faq: 'Domanda IT?\nRisposta IT.' }, en: { faq: 'Question EN?\nAnswer EN.' } }));
  assert.deepEqual([t.i18n.it.faq[0].q, t.i18n.en.faq[0].q, t.i18n.es.faq[0].q], ['Domanda IT?', 'Question EN?', 'Question EN?'], 'spagnolo → inglese');
  t = normalizeTour('prova', def({ it: { faq: 'Domanda IT?\nRisposta IT.' }, en: { faq: 'Question EN?\nAnswer EN.' }, es: { faq: '¿Pregunta ES?\nRespuesta ES.' } }));
  assert.equal(t.i18n.es.faq[0].q, '¿Pregunta ES?');
  assert.deepEqual(normalizeTour('prova', def()).i18n.it.faq, [], 'nessuna domanda: nessuna sezione');
  // l'errore dice in che lingua e con che parole
  assert.throws(() => normalizeTour('prova', def({ it: { faq: 'Ok?\nSì.' }, en: { faq: 'Senza risposta' } })), (e) => e instanceof ContentError && /domande frequenti \(en\): .*non ha la risposta/.test(e.message));

  // dal pannello: si scrive, si ritrova nel modulo e compare sulla pagina (con ripiego), un errore non perde il testo
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    const slug = 'cannaregio-ghetto';
    const base = tourFormFromDef(s.app.content.rawTour(slug));
    assert.match(base.faq_it, /^Si entra nelle sinagoghe/, 'le domande dei contenuti iniziali ci sono');
    const ghetto = await (await anon(`/it/tours/${slug}`)).text();
    assert.match(ghetto, /<h2 class="h-sub">Domande frequenti<\/h2><div class="faq tour-faq"><details class="faq-item"><summary>Si entra nelle sinagoghe e nel Museo Ebraico\?<\/summary>/);
    assert.equal((ghetto.match(/<details class="faq-item"/g) ?? []).length >= 3, true);

    const mine = 'Posso portare il cane?\nSì, al guinzaglio.\n\nC’è il bagno?\nNei bar lungo il percorso, **consumando qualcosa**.';
    const saved = await admin(`/admin/tours/${slug}`, form({ ...base, faq_it: mine, faq_es: '' }));
    assert.equal(saved.headers.get('location'), `/admin/tours/${slug}?ok=saved`);
    const it = await (await anon(`/it/tours/${slug}`)).text();
    assert.match(it, /<summary>Posso portare il cane\?<\/summary><div class="faq-a prose"><p>Sì, al guinzaglio\.<\/p>/);
    assert.match(it, /<strong>consumando qualcosa<\/strong>/);
    assert.doesNotMatch(it, /Si entra nelle sinagoghe/, 'sostituite, non sommate');
    // nessuna domanda in inglese né in spagnolo propria? l'inglese ha le sue (iniziali), lo spagnolo ripiega sull'inglese
    assert.match(await (await anon(`/es/tours/${slug}`)).text(), /<summary>Do we go inside the synagogues/);
    // il modulo restituisce il testo com'era
    assert.match(await (await admin(`/admin/tours/${slug}`)).text(), /Posso portare il cane\?\nSì, al guinzaglio\./);
    // errore: domanda senza risposta → il modulo si riapre con il messaggio e il testo scritto
    const bad = await admin(`/admin/tours/${slug}`, form({ ...base, faq_it: 'Domanda senza risposta' }));
    assert.equal(bad.status, 400);
    const badHtml = await bad.text();
    assert.match(badHtml, /domande frequenti \(it\): la domanda «Domanda senza risposta» non ha la risposta/);
    assert.match(badHtml, /Domanda senza risposta<\/textarea>/);
    // le domande non finiscono in un tour senza (la home non le mostra)
    assert.doesNotMatch(await (await anon('/it/')).text(), /tour-faq/);
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
    assert.match(page, /Tour B2C/);
    assert.match(page, /name="price_cannaregio-ghetto-agenzie" inputmode="decimal" value="28"/, 'anche i tour B2B, con la loro tariffa');
    assert.ok(!page.includes('name="b2b_'), 'un solo prezzo per tour');
    const all = Object.fromEntries(s.app.content.allTours.filter((t) => t.pricing !== 'hourly').map((t) => [`price_${t.slug}`, String(t.priceCents / 100)]));
    assert.equal((await admin('/admin/prices', form({ ...all, 'price_cannaregio-ghetto': 'x' }))).status, 400);
    assert.equal(s.app.content.tour('cannaregio-ghetto').priceCents, 3500, 'un errore non salva nulla');
    assert.equal(loc(await admin('/admin/prices', form({ ...all, 'price_cannaregio-ghetto': '38', 'price_cannaregio-ghetto-agenzie': '30,5' }))), '/admin/prices?ok=prices');
    assert.equal(s.app.content.tour('cannaregio-ghetto').priceCents, 3800);
    assert.equal(s.app.content.tour('cannaregio-ghetto-agenzie').priceCents, 3050);
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
test('immagini del sito: home, chi sono, agenzie, regalo e anteprima social si scelgono dalla libreria', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    const upload = async (buf) => (await (await admin('/admin/media', json({ large: dataUrl(buf), small: dataUrl(buf), width: 1600, height: 900 }))).json()).name;
    const photoA = await upload(JPEG);
    const photoB = await upload(Buffer.concat([JPEG, Buffer.from('b')]));
    assert.notEqual(photoA, photoB);

    // senza scelta: illustrazioni e nessuna anteprima social
    let home = await (await anon('/it/')).text();
    assert.match(home, /class="art art-dome"/);
    assert.doesNotMatch(home, /og:image/);
    assert.match(await (await admin('/admin/media')).text(), /Immagini del sito/);

    // la foto della home sostituisce l'illustrazione e diventa l'anteprima di tutte le pagine senza copertina
    assert.equal(loc(await admin('/admin/media/slots', form({ slot: 'home', name: photoA }))), '/admin/media?ok=slot');
    home = await (await anon('/it/')).text();
    assert.match(home, new RegExp(`<div class="hero-art"><img src="/media/${photoA}" srcset="/media/${photoA.replace('.jpg', '-s.jpg')} 640w`));
    assert.match(home, new RegExp(`og:image" content="http://localhost/media/${photoA}"`));
    assert.match(home, /twitter:card" content="summary_large_image"/);
    assert.match(await (await anon('/en/blog')).text(), new RegExp(`og:image" content="http://localhost/media/${photoA}"`));

    // le altre posizioni
    await admin('/admin/media/slots', form({ slot: 'about', name: photoB }));
    await admin('/admin/media/slots', form({ slot: 'b2b', name: photoB }));
    await admin('/admin/media/slots', form({ slot: 'gift', name: photoB }));
    assert.match(await (await anon('/it/about')).text(), new RegExp(`<figure class="portrait"><img src="/media/${photoB}"`));
    assert.match(await (await anon('/it/b2b')).text(), new RegExp(`<div class="hero-art"><img src="/media/${photoB}"`));
    assert.match(await (await anon('/it/gift')).text(), new RegExp(`<div class="gift-art"><img src="/media/${photoB}"`));
    assert.doesNotMatch(await (await anon('/it/privacy')).text(), /class="portrait"/, 'il ritratto è solo in «Chi sono»');
    // l'anteprima social dedicata vince sulla foto della home
    await admin('/admin/media/slots', form({ slot: 'og', name: photoB }));
    assert.match(await (await anon('/it/')).text(), new RegExp(`og:image" content="http://localhost/media/${photoB}"`));

    // controlli
    assert.equal(loc(await admin('/admin/media/slots', form({ slot: 'inesistente', name: photoA }))), '/admin/media?err=slot');
    assert.equal(loc(await admin('/admin/media/slots', form({ slot: 'home', name: 'ffffffffffffffffffffffff.jpg' }))), '/admin/media?err=missing');
    assert.equal(loc(await admin('/admin/media/slots', form({ slot: 'home', name: '../../etc/passwd' }))), '/admin/media?err=missing');
    assert.equal(loc(await anon('/admin/media/slots', form({ slot: 'home', name: photoA }))), '/admin/login');
    // in uso: non si elimina; tolta la foto, sì
    const rowA = s.app.media.list().find((m) => m.name === photoA);
    assert.equal(loc(await admin(`/admin/media/${rowA.id}/delete`, form({}))), '/admin/media?err=used');
    assert.equal(loc(await admin('/admin/media/slots', form({ slot: 'home', clear: '1' }))), '/admin/media?ok=slot');
    home = await (await anon('/it/')).text();
    assert.match(home, /class="art art-dome"/);
    assert.equal(loc(await admin(`/admin/media/${rowA.id}/delete`, form({}))), '/admin/media?ok=deleted');
    // se un file sparisce dalla libreria, il sito torna all'illustrazione senza rompersi
    s.app.media.remove(photoB);
    assert.match(await (await anon('/it/')).text(), /class="art art-dome"/);
    assert.match(await (await anon('/it/about')).text(), /Chi sono/);
  } finally {
    s.close();
  }
});

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

test('editor di testo: l’etichetta non avvolge i pulsanti, c’è l’anteprima dal vivo e lo script non assegna `value` (farebbe scappare la pagina)', async () => {
  const s = await start();
  try {
    for (const url of ['/admin/blog/new', '/admin/tours/new']) {
      const page = await (await s.admin(url)).text();
      assert.match(page, /<label class="label" for="md-(body|description)_it">/, `${url}: l’etichetta guarda il campo`);
      assert.match(page, /<textarea id="md-(body|description)_it" name="(body|description)_it"/);
      const labels = [...page.matchAll(/<label\b[^>]*>[^]*?<\/label>/g)].map((m) => m[0]);
      assert.ok(!labels.some((l) => l.includes('data-md-toolbar')), `${url}: i pulsanti non stanno dentro un’etichetta (toccare la scritta premerebbe «Grassetto»)`);
      assert.match(page, /data-md-panes/);
      assert.match(page, /<em>Corsivo<\/em>/);
    }
    const js = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin-content.js'), 'utf8');
    assert.ok(!/\b(ta|source)\.value\s*=[^=]/.test(js), 'nessuna assegnazione diretta di value: porta il cursore in fondo e sposta la pagina');
    assert.match(js, /execCommand\('insertText'/, 'si usa l’inserimento che conserva «annulla»');
    assert.match(js, /preventScroll: true/);
    assert.ok(!/touchstart/.test(js.replace(/\/\/.*$/gm, '')), 'annullare touchstart cancellerebbe anche il tocco sul telefono');
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

test('tour dei privati e tour delle agenzie: due sezioni, un solo prezzo, ognuno visibile solo al suo pubblico', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    // «Nuovo tour B2B» parte già come B2B; il modulo non ha più due tariffe
    const form0 = await (await admin('/admin/tours/new?audience=b2b')).text();
    assert.match(form0, /<option value="b2b" selected>/);
    assert.match(form0, /Tariffa agenzie \(€ a persona\)/);
    assert.ok(!form0.includes('name="b2bPrice"') && !form0.includes('Tariffa partner B2B'));
    const B2B = { ...TOUR, slug: 'gondola-agenzie', title_it: 'Gondola per gruppi', audience: 'b2b', price: '90' };
    assert.equal(loc(await admin('/admin/tours', form(B2B))), '/admin/tours/gondola-agenzie?ok=created');
    const t = s.app.content.tour('gondola-agenzie');
    assert.equal(t.audience, 'b2b');
    assert.equal(t.priceCents, 9000);
    // sta nella sua sezione, non nell'altra; ai privati non si vede da nessuna parte
    assert.match(await (await admin('/admin/tours-b2b')).text(), /Gondola per gruppi/);
    assert.ok(!(await (await admin('/admin/tours')).text()).includes('Gondola per gruppi'));
    assert.equal((await anon('/it/tours/gondola-agenzie')).status, 404);
    assert.ok(!(await (await anon('/it/tours')).text()).includes('Gondola per gruppi'));
    assert.ok(!(await (await anon('/sitemap.xml')).text()).includes('gondola-agenzie'));
    assert.equal((await anon(`/api/slots?tour=gondola-agenzie&date=${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}&pax=2`)).status, 400);
    // e un tour B2C non è un tour B2B: cambiare il pubblico lo sposta nell'altra sezione
    assert.equal(loc(await admin('/admin/tours/gondola-agenzie', form({ ...B2B, audience: 'b2c' }))), '/admin/tours/gondola-agenzie?ok=saved');
    assert.equal(s.app.content.tour('gondola-agenzie').audience, 'b2c');
    assert.match(await (await admin('/admin/tours')).text(), /Gondola per gruppi/);
    assert.equal((await anon('/it/tours/gondola-agenzie')).status, 200);
    // «Duplica come tour B2B» parte dall'altro pubblico
    const dup = await (await admin('/admin/tours/new?from=gondola-agenzie&audience=b2b')).text();
    assert.match(dup, /<option value="b2b" selected>/);
    assert.match(dup, /Gondola per gruppi \(copia\)/);
    assert.match(await (await admin('/admin/tours/gondola-agenzie')).text(), /Duplica come tour B2B/);
    // nascondere e eliminare riportano alla sezione giusta
    await admin('/admin/tours/gondola-agenzie', form({ ...B2B, audience: 'b2b' }));
    assert.equal(loc(await admin('/admin/tours/gondola-agenzie/toggle', form({}))), '/admin/tours-b2b?ok=toggled');
    assert.equal(loc(await admin('/admin/tours/gondola-agenzie/delete', form({}))), '/admin/tours-b2b?ok=deleted');
    // la scheda del partner propone il listino dedicato solo per i tour B2B
    s.app.db.prepare("INSERT INTO accounts(email, password_hash, company, contact_name, status, created_at) VALUES('x@example.com','x','X','X','approved','2027-01-01')").run();
    const id = s.app.db.prepare("SELECT id FROM accounts WHERE email = 'x@example.com'").get().id;
    const partnerPage = await (await admin(`/admin/partners/${id}`)).text();
    assert.match(partnerPage, /name="price_cannaregio-ghetto-agenzie"/);
    assert.ok(!partnerPage.includes('name="price_cannaregio-ghetto"'));
  } finally {
    s.close();
  }
});

test('migrazione: i tour di prima (due tariffe) diventano B2C più una copia B2B; il listino dedicato dei partner la segue; si fa una volta sola', () => {
  const db = openDb(':memory:');
  const at = '2027-01-01T00:00:00.000Z';
  const put = (slug, d) => db.prepare('INSERT INTO content_tours(slug, data_json, updated_at) VALUES(?,?,?)').run(slug, JSON.stringify(d), at);
  const base = (over) => ({ order: 10, model: 'person', times: ['10:00'], duration: 120, maxParticipants: 8, price: 35, b2bPrice: 28, it: { title: 'Prova', summary: 'Una prova.' }, ...over });
  put('vecchio', base({}));
  put('guida', base({ model: 'group', pricing: 'hourly', service: 'guide', chooseHours: true, price: undefined, b2bPrice: undefined }));
  put('assistente', base({ model: 'group', pricing: 'hourly', service: 'assistant', price: undefined, b2bPrice: undefined }));
  put('nuovo', base({ audience: 'b2c', b2bPrice: undefined }));
  put('occupato', base({}));
  put('occupato-agenzie', base({ audience: 'b2c' }));
  db.prepare("INSERT INTO accounts(email, password_hash, company, contact_name, status, created_at, prices_json) VALUES('a@example.com','x','A','A','approved',?,?)").run(at, JSON.stringify({ vecchio: 2250, nuovo: 3000 }));
  const store = createContentStore({ db, root: ROOT });
  assert.equal(store.tour('vecchio').audience, 'b2c');
  assert.equal(store.tour('vecchio').priceCents, 3500);
  assert.equal(store.tour('vecchio-agenzie').audience, 'b2b');
  assert.equal(store.tour('vecchio-agenzie').priceCents, 2800, 'la vecchia tariffa agenzie');
  assert.equal(store.tour('vecchio-agenzie').featured, false);
  assert.equal(store.tour('guida').audience, 'b2c');
  assert.equal(store.tour('guida-agenzie').audience, 'b2b');
  assert.equal(store.tour('guida-agenzie').pricing, 'hourly');
  assert.equal(store.tour('assistente').audience, 'b2b', 'nato solo per le agenzie');
  assert.equal(store.tour('assistente-agenzie'), undefined);
  assert.equal(store.tour('nuovo').audience, 'b2c');
  assert.equal(store.tour('nuovo-agenzie'), undefined, 'un tour già B2C non si tocca');
  assert.equal(store.tour('occupato-agenzie').audience, 'b2c', 'un indirizzo già usato non si sovrascrive');
  assert.deepEqual(JSON.parse(db.prepare("SELECT prices_json FROM accounts WHERE email = 'a@example.com'").get().prices_json), { 'vecchio-agenzie': 2250, nuovo: 3000 }, 'il prezzo dedicato passa alla copia B2B');
  assert.ok(!('b2bPrice' in JSON.parse(db.prepare("SELECT data_json FROM content_tours WHERE slug = 'vecchio'").get().data_json)));
  const n = db.prepare('SELECT COUNT(*) n FROM content_tours').get().n;
  createContentStore({ db, root: ROOT });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM content_tours').get().n, n, 'al riavvio non si crea altro');
});

test('agenda: un tour preso fuori dal sito (email, di persona) toglie le ore dalle disponibilità; si vede in agenda e si può togliere', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const anon = s.jar();
    const d0 = new Date(Date.now() + 20 * 86400000);
    const iso = (n) => new Date(d0.getTime() + n * 86400000).toISOString().slice(0, 10);
    const slots = async (date) => (await (await anon(`/api/slots?tour=san-marco-rialto&date=${date}&pax=1`)).json()).slots.map((x) => x.time);
    const before = await slots(iso(0));
    assert.ok(before.length > 0, 'prima c’è disponibilità');

    // più giorni, tutto il giorno
    const ok = await admin('/admin/agenda/private', form({ title: 'Tour privato, famiglia Rossi', from: iso(0), to: iso(2), allDay: '1', details: 'tel. 333 000 000' }));
    assert.equal(ok.status, 303);
    assert.match(loc(ok), /ok=private#giorno/);
    const rows = s.app.db.prepare("SELECT * FROM blocks WHERE kind = 'private' ORDER BY date").all();
    assert.deepEqual(rows.map((r) => [r.date, r.start_time, r.end_time, r.title]), [0, 1, 2].map((n) => [iso(n), '00:00', '23:59', 'Tour privato, famiglia Rossi']));
    assert.ok(rows[0].series && rows.every((r) => r.series === rows[0].series), 'una serie');
    for (const n of [0, 1, 2]) assert.deepEqual(await slots(iso(n)), [], `giorno ${n}: niente più orari`);
    assert.ok((await slots(iso(3))).length > 0, 'il giorno dopo è libero');

    // si vede in agenda (calendario e giorno), con i pulsanti per toglierlo
    const month = iso(0).slice(0, 7);
    const page = await (await admin(`/admin?v=cal&m=${month}&d=${iso(0)}`)).text();
    assert.match(page, /Tour privato, famiglia Rossi/);
    assert.match(page, /Tour privato fuori dal sito · tel\. 333 000 000/);
    assert.match(page, /Elimina tutti i giorni/);
    assert.match(page, /Un tour preso fuori dal sito\?/);
    assert.match(await (await admin(`/admin/availability?m=${month}`)).text(), /Tour privato, famiglia Rossi/, 'anche fra gli impegni esterni');

    // solo alcune ore: le altre restano prenotabili
    const day = iso(5);
    const all = await slots(day);
    assert.equal(loc(await admin('/admin/agenda/private', form({ title: 'Visita', from: day, start: '09:00', end: '12:00' }))).includes('ok=private'), true);
    const after = await slots(day);
    assert.deepEqual([all, after], [['09:30', '14:30'], ['14:30']], 'la partenza delle 09:30 cade nell’impegno, quella del pomeriggio resta');

    // chi ha già una prenotazione in quelle ore viene avvisato
    const bday = iso(8);
    s.app.db.prepare(`INSERT INTO bookings(ref, token, tour_slug, date, start_time, end_time, participants, channel, name, email, total_cents, status, payment_method, payment_status, free_cancel_until, created_at) VALUES('VE-PRIV01','t1','san-marco-rialto',?,'09:30','12:00',2,'b2c','Anna','anna@example.com',7000,'confirmed','onsite','unpaid','2020-01-01','2020-01-01')`).run(bday);
    const over = await admin('/admin/agenda/private', form({ title: 'Sovrapposto', from: bday, allDay: '1' }));
    assert.match(loc(over), /ok=privateOver/);
    assert.match(await (await admin(loc(over))).text(), /si sovrappone a prenotazioni già presenti/);

    // dati sbagliati: non si aggiunge nulla
    const n = s.app.db.prepare('SELECT COUNT(*) n FROM blocks').get().n;
    for (const bad of [{ title: '', from: iso(10), allDay: '1' }, { title: 'x', from: 'boh', allDay: '1' }, { title: 'x', from: iso(10), to: iso(9), allDay: '1' }, { title: 'x', from: iso(10), start: '12:00', end: '10:00' }, { title: 'x', from: iso(10), to: iso(200), allDay: '1' }]) {
      assert.match(loc(await admin('/admin/agenda/private', form(bad))), /ok=privateBad/, JSON.stringify(bad));
    }
    assert.equal(s.app.db.prepare('SELECT COUNT(*) n FROM blocks').get().n, n);
    assert.equal(loc(await anon('/admin/agenda/private', form({ title: 'x', from: iso(10), allDay: '1' }))), '/admin/login');

    // toglierne uno solo, poi tutta la serie
    const mid = rows[1];
    assert.match(loc(await admin(`/admin/agenda/block/${mid.id}/delete`, form({ d: mid.date }))), /ok=privateDeleted/);
    assert.ok((await slots(iso(1))).length > 0, 'quel giorno torna libero');
    assert.deepEqual(await slots(iso(0)), []);
    await admin(`/admin/agenda/block/${rows[0].id}/delete`, form({ all: '1', d: rows[0].date }));
    assert.deepEqual(await slots(iso(0)), before, 'tutta la serie tolta: tutto com’era');
    assert.equal(s.app.db.prepare("SELECT COUNT(*) n FROM blocks WHERE series = ?").get(rows[0].series).n, 0);
  } finally {
    s.close();
  }
});

test('tour condiviso dal pannello: invito amico acceso/spento e sconto per quel tour', async () => {
  const s = await start();
  try {
    const { admin } = s;
    const page = await (await admin('/admin/tours/san-marco-rialto')).text();
    assert.match(page, /name="inviteEnabled" value="1" checked/);
    assert.match(page, /name="invitePercent"/);
    const raw = s.app.content.rawTour('san-marco-rialto');
    const form1 = (over) => form({ slug: 'san-marco-rialto', title_it: 'San Marco', summary_it: 'Un giro.', audience: 'b2c', model: 'person', times: '09:30', wd: ['1'], durH: '2', durM: '30', maxParticipants: '10', price: '35', active: '1', payOnSite: '1', langs: ['it'], ...over });
    assert.equal(loc(await admin('/admin/tours/san-marco-rialto', form1({ inviteEnabled: '1', invitePercent: '20' }))), '/admin/tours/san-marco-rialto?ok=saved');
    let t = s.app.content.tour('san-marco-rialto');
    assert.deepEqual([t.inviteEnabled, t.invitePercent], [true, 20]);
    assert.equal(loc(await admin('/admin/tours/san-marco-rialto', form1({ invitePercent: '' }))), '/admin/tours/san-marco-rialto?ok=saved');
    t = s.app.content.tour('san-marco-rialto');
    assert.deepEqual([t.inviteEnabled, t.invitePercent], [false, null]);
    assert.ok(!(await (await admin('/admin/tours/san-marco-rialto')).text()).includes('name="inviteEnabled" value="1" checked'));
    assert.equal((await admin('/admin/tours/san-marco-rialto', form1({ inviteEnabled: '1', invitePercent: '95' }))).status, 400, 'oltre il 90%');
    // un tour privato non ha l'invito
    assert.ok(!(await (await admin('/admin/tours/guida-a-ore')).text()).includes('name="inviteEnabled"'));
    assert.ok(raw);
  } finally {
    s.close();
  }
});
