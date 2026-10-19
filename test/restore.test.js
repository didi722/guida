// Ripristino da una copia di sicurezza: controllo del file, anteprima, due modi (contenuti / tutto),
// copia di sicurezza automatica con «torna indietro», e tutti i casi in cui NON deve cambiare nulla.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { backupEntries, markBackup, lastBackup, writeZip } from '../server/backup.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { setTextOverrides } from '../server/i18n.js';
import { MIGRATIONS } from '../server/migrations.js';
import { KEEP_SNAPSHOTS, transfer } from '../server/restore.js';
import { ZipError, openZip } from '../server/zipread.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-restore-' + crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(tmp, { recursive: true });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' };
const post = (fields = {}) => ({ method: 'POST', headers: urlencoded, body: new URLSearchParams(fields).toString() });
const loc = (res) => res.headers.get('location');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const dataUrl = (buf) => `data:image/jpeg;base64,${buf.toString('base64')}`;

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true });
  const { app, server } = createApp({ cfg, db: openDb(cfg.dbFile) });
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
  await admin('/admin/login', post({ password: 'segreto-admin' }));
  return {
    app,
    cfg,
    base,
    jar,
    admin,
    close: () => { app.close(); http.close(); app.db.close(); setTextOverrides(new Map()); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); },
  };
}

async function zipBuffer(entries) {
  const chunks = [];
  await writeZip({ write: (b, cb) => { chunks.push(Buffer.from(b)); cb(); } }, entries);
  return Buffer.concat(chunks);
}
/** Lo zip della copia di sicurezza di adesso (quello che scarica il pannello). */
const backupOf = (app) => zipBuffer(backupEntries(app));
/** Rifà uno zip dopo averne modificato i file ({ nome: Buffer }). */
async function rezip(buf, mutate) {
  const file = path.join(tmp, `rz-${crypto.randomBytes(3).toString('hex')}.zip`);
  fs.writeFileSync(file, buf);
  const zip = await openZip(file);
  const files = {};
  for (const e of zip.entries) files[e.name] = await zip.read(e, 1 << 30);
  await zip.close();
  fs.rmSync(file);
  const next = (await mutate(files)) ?? files;
  return zipBuffer(Object.entries(next).map(([name, data]) => ({ name, data })));
}
/** Esegue SQL sul database dentro uno zip. */
const editDb = (sql) => (files) => {
  const f = path.join(tmp, `db-${crypto.randomBytes(3).toString('hex')}.sqlite`);
  fs.writeFileSync(f, files['guida.sqlite']);
  const db = new DatabaseSync(f);
  db.exec(sql);
  db.close();
  files['guida.sqlite'] = fs.readFileSync(f);
  fs.rmSync(f);
};

const upload = (s, buf) => s.admin('/admin/backup/restore/upload', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: buf });
const tokenOf = (reply) => reply.url.split('/').pop();
const addBooking = (db, ref, { tour = 'cannaregio-ghetto', createdAt = '2029-01-01T00:00:00Z' } = {}) =>
  db.prepare(`INSERT INTO bookings(ref, token, tour_slug, date, start_time, end_time, participants, channel, name, email, total_cents, status, payment_method, payment_status, free_cancel_until, created_at) VALUES(?, 't', ?, '2030-01-01', '10:00', '12:30', 2, 'b2c', 'A', 'a@example.com', 7000, 'confirmed', 'card', 'paid', '2030-01-01T00:00:00Z', ?)`).run(ref, tour, createdAt);
const refs = (db) => db.prepare('SELECT ref FROM bookings ORDER BY ref').all().map((r) => r.ref);
const setName = (s, name) => s.admin('/admin/settings/business', post({ 'site.name': name, 'site.email': 'prova@example.com', 'mail.notifyTo': '' }));
const NEW_TOUR = (app, title) => ({ ...structuredClone(app.content.rawTour('cannaregio-ghetto')), it: { ...app.content.rawTour('cannaregio-ghetto').it, title } });

test('ripristino «solo i contenuti»: tour, articoli e foto tornano come nella copia, il resto non si tocca', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const original = app.content.tour('cannaregio-ghetto').i18n.it.title;
    const article = app.content.allPosts[0];
    const photo = app.media.save({ large: dataUrl(JPEG), small: dataUrl(JPEG), width: 1600, height: 900 });
    app.siteImages.set('home', photo.name);
    addBooking(app.db, 'VE-AAAAAA');
    await setName(s, 'Nome A');
    const zipA = await backupOf(app);

    // dopo la copia: titolo cambiato, tour nuovi, un articolo in meno, foto tolta, altra prenotazione, altro nome
    app.content.saveTour('cannaregio-ghetto', NEW_TOUR(app, 'Titolo B'));
    app.content.saveTour('tour-senza-prenotazioni', NEW_TOUR(app, 'Senza'), { create: true });
    app.content.saveTour('tour-con-prenotazioni', NEW_TOUR(app, 'Con'), { create: true });
    addBooking(app.db, 'VE-BBBBBB', { tour: 'tour-con-prenotazioni' });
    app.content.deletePost(article.slug);
    app.siteImages.set('home', null);
    app.media.remove(photo.name);
    await setName(s, 'Nome B');
    assert.equal(app.cfg.site.name, 'Nome B');

    const up = await (await upload(s, zipA)).json();
    assert.ok(up.ok, up.error);
    const page = await (await admin(up.url)).text();
    assert.match(page, /Controlla prima di ripristinare/);
    assert.match(page, /Per ora non è cambiato niente/);
    assert.match(page, /Spariscono i tour creati dopo la copia: <strong>Senza<\/strong>/);
    assert.match(page, /Restano come sono adesso[^<]*<strong>Con<\/strong>/);
    assert.match(page, /Sparirebbero dal pannello, perché fatti o creati dopo la copia: <strong>1 prenotazione<\/strong>/);
    assert.equal(app.content.tour('cannaregio-ghetto').i18n.it.title, 'Titolo B', 'l’anteprima non cambia nulla');

    const done = await admin(up.url, post({ mode: 'content', confirm: 'ripristina' }));
    assert.equal(loc(done), '/admin/backup?ok=restored');

    assert.equal(app.content.tour('cannaregio-ghetto').i18n.it.title, original);
    assert.equal(app.content.tour('tour-senza-prenotazioni'), undefined, 'il tour senza prenotazioni sparisce');
    assert.equal(app.content.tour('tour-con-prenotazioni').i18n.it.title, 'Con', 'il tour con prenotazioni resta');
    assert.ok(app.content.postAny(article.slug), 'l’articolo è tornato');
    assert.ok(app.media.get(photo.name) && fs.existsSync(app.media.file(photo.name)), 'la foto è tornata in libreria');
    assert.equal(app.siteImages.get('home'), photo.name, 'la foto della home è quella della copia');
    assert.deepEqual(refs(app.db), ['VE-AAAAAA', 'VE-BBBBBB'], 'le prenotazioni non si toccano');
    assert.equal(app.cfg.site.name, 'Nome B', 'le impostazioni non si toccano');

    // la copia di sicurezza automatica è com’era prima
    const [snap] = app.restore.snapshots();
    assert.ok(snap && snap.mode === 'content');
    const old = new DatabaseSync(snap.dbFile, { readOnly: true });
    assert.equal(JSON.parse(old.prepare("SELECT data_json FROM content_tours WHERE slug = 'cannaregio-ghetto'").get().data_json).it.title, 'Titolo B');
    old.close();
    assert.match(await (await admin('/admin/backup')).text(), /Ultimo ripristino:/);
    // il file caricato non resta sul disco
    assert.deepEqual(fs.readdirSync(path.join(s.cfg.dataDir, 'restore')), []);
    // e un secondo invio dello stesso modulo non rifà nulla
    assert.equal(loc(await admin(up.url, post({ mode: 'content', confirm: 'RIPRISTINA' }))), '/admin/backup?err=expired');
  } finally {
    s.close();
  }
});

test('ripristino «tutto»: prenotazioni e impostazioni tornano com’erano, e si può tornare indietro', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    addBooking(app.db, 'VE-AAAAAA');
    await setName(s, 'Nome A');
    const zipA = await backupOf(app);

    app.content.saveTour('cannaregio-ghetto', NEW_TOUR(app, 'Titolo B'));
    addBooking(app.db, 'VE-BBBBBB');
    await setName(s, 'Nome B');
    markBackup(app.db, Date.parse('2030-05-05T10:00:00Z'));

    const up = await (await upload(s, zipA)).json();
    assert.ok(up.ok, up.error);
    assert.equal(loc(await admin(up.url, post({ mode: 'all', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
    assert.deepEqual(refs(app.db), ['VE-AAAAAA']);
    assert.equal(app.cfg.site.name, 'Nome A', 'le impostazioni sono applicate subito');
    assert.match(await (await admin('/it/contact')).text(), /Nome A/);
    assert.notEqual(app.content.tour('cannaregio-ghetto').i18n.it.title, 'Titolo B');
    assert.equal(lastBackup(app.db), '2030-05-05T10:00:00.000Z', 'l’ultima copia scaricata resta quella vera');
    assert.equal(app.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'i collegamenti tra tabelle sono di nuovo controllati');
    assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(app.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');

    // «Torna a questa versione»: stessa strada, con anteprima e conferma
    const [snap] = app.restore.snapshots();
    const staged = await admin(`/admin/backup/snapshots/${snap.id}/stage`, post());
    assert.match(loc(staged), /^\/admin\/backup\/restore\/[a-f0-9]{24}$/);
    const preview = await (await admin(loc(staged))).text();
    assert.match(preview, /Copia di sicurezza automatica/);
    assert.equal(loc(await admin(loc(staged), post({ mode: 'all', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
    assert.deepEqual(refs(app.db), ['VE-AAAAAA', 'VE-BBBBBB']);
    assert.equal(app.cfg.site.name, 'Nome B');
    assert.equal(app.content.tour('cannaregio-ghetto').i18n.it.title, 'Titolo B');

    // la copia di sicurezza si può anche scaricare come zip normale, ed è un backup valido
    const [latest] = app.restore.snapshots();
    const dl = await admin(`/admin/backup/snapshots/${latest.id}/download`, post());
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /guida-prima-del-ripristino-\d{4}-\d{2}-\d{2}\.zip/);
    const again = await (await upload(s, Buffer.from(await dl.arrayBuffer()))).json();
    assert.ok(again.ok, again.error);
  } finally {
    s.close();
  }
});

test('ripristino: se qualcosa non va non cambia nulla (file sbagliati, parola di conferma, accesso, scadenza)', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    addBooking(app.db, 'VE-AAAAAA');
    const zipA = await backupOf(app);
    addBooking(app.db, 'VE-BBBBBB');
    const before = JSON.stringify(app.db.prepare('SELECT * FROM bookings ORDER BY id').all());
    const unchanged = () => assert.equal(JSON.stringify(app.db.prepare('SELECT * FROM bookings ORDER BY id').all()), before);
    const rejected = async (buf, pattern) => {
      const res = await upload(s, buf);
      const reply = await res.json();
      assert.equal(res.status, 400, JSON.stringify(reply));
      assert.equal(reply.ok, false);
      assert.match(reply.error, pattern);
      assert.deepEqual(fs.existsSync(path.join(s.cfg.dataDir, 'restore')) ? fs.readdirSync(path.join(s.cfg.dataDir, 'restore')) : [], [], 'nessun file resta sul disco');
      unchanged();
    };

    // senza accesso
    const anon = s.jar();
    for (const [method, p] of [['POST', '/admin/backup/restore/upload'], ['GET', '/admin/backup/restore/' + 'a'.repeat(24)], ['POST', '/admin/backup/restore/' + 'a'.repeat(24)], ['POST', '/admin/backup/restore/' + 'a'.repeat(24) + '/cancel'], ['POST', '/admin/backup/snapshots/20300101000000-abcdef/stage'], ['POST', '/admin/backup/snapshots/20300101000000-abcdef/download']]) {
      assert.equal(loc(await anon(p, { method, headers: { 'content-type': 'application/zip' }, body: method === 'POST' ? 'x' : undefined })), '/admin/login', `${method} ${p}`);
    }

    // file che non sono la copia
    await rejected(Buffer.from('questo non è uno zip, ma un testo qualunque lungo abbastanza'), /non è uno zip/);
    await rejected(Buffer.alloc(0), /non è uno zip/);
    await rejected(await zipBuffer([{ name: 'foto.jpg', data: JPEG }]), /manca|non c’è guida\.sqlite/i);
    await rejected(await rezip(zipA, (f) => { f['guida.sqlite'] = Buffer.from('SQLite format 3\0' + 'x'.repeat(4000)); }), /danneggiat|non è un database/);
    await rejected(await rezip(zipA, (f) => { f['guida.sqlite'] = crypto.randomBytes(8192); }), /danneggiat|non è un database/);
    await rejected(await rezip(zipA, editDb('PRAGMA user_version = 999')), /versione del sito più recente/);
    await rejected(await rezip(zipA, editDb('DROP TABLE bookings; CREATE TABLE bookings(x)')), /non corrisponde|non è quello di questo sito/);
    await rejected(await rezip(zipA, editDb('DROP TABLE settings')), /non è quello di questo sito/);
    // un byte rovinato dentro lo zip: il controllo di integrità lo prende
    const flipped = Buffer.from(zipA);
    flipped[Math.floor(flipped.length / 3)] ^= 0xff;
    await rejected(flipped, /danneggiat|non è un database|non è uno zip/);

    // una copia buona, poi tutti gli errori del passaggio di conferma
    const up = await (await upload(s, zipA)).json();
    assert.ok(up.ok, up.error);
    const token = tokenOf(up);
    for (const body of [{ mode: 'all' }, { mode: 'all', confirm: '' }, { mode: 'all', confirm: 'si' }, { mode: 'tutto', confirm: 'RIPRISTINA' }, { confirm: 'RIPRISTINA' }]) {
      const res = await admin(up.url, post(body));
      assert.equal(res.status, 400);
      assert.match(await res.text(), /Scegli cosa ripristinare|Per confermare scrivi RIPRISTINA/);
      unchanged();
    }
    assert.ok(app.restore.get(token), 'la copia resta in attesa dopo un errore');
    assert.deepEqual(app.restore.snapshots(), [], 'nessuna copia di sicurezza se non si è ripristinato nulla');

    // annulla: toglie il file e non cambia nulla
    assert.equal(loc(await admin(`${up.url}/cancel`, post())), '/admin/backup?ok=cancelled');
    assert.equal(app.restore.get(token), null);
    assert.equal(loc(await admin(up.url)), '/admin/backup?err=expired');
    unchanged();

    // scaduta: dopo un’ora il file non vale più e viene cancellato
    const up2 = await (await upload(s, zipA)).json();
    const dir = path.join(s.cfg.dataDir, 'restore', tokenOf(up2));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    meta.createdAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    assert.equal(app.restore.get(tokenOf(up2)), null);
    assert.equal(loc(await admin(up2.url, post({ mode: 'all', confirm: 'RIPRISTINA' }))), '/admin/backup?err=expired');
    app.restore.cleanup();
    assert.equal(fs.existsSync(dir), false, 'il file scaduto viene cancellato');
    // identificativi strani non portano fuori dalla cartella
    assert.equal(app.restore.get('../../etc'), null);
    assert.equal(app.restore.snapshotInfo('../../etc'), null);
    assert.equal(loc(await admin('/admin/backup/snapshots/20300101000000-abcdef/stage', post())), '/admin/backup?err=snapshot');
    unchanged();
  } finally {
    s.close();
  }
});

test('ripristino: se i collegamenti tra i dati sono spezzati si torna indietro senza cambiare nulla', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    addBooking(app.db, 'VE-AAAAAA');
    const zipA = await backupOf(app);
    addBooking(app.db, 'VE-BBBBBB');
    const before = JSON.stringify(app.db.prepare('SELECT ref FROM bookings ORDER BY id').all());
    // una prenotazione che cita un partner inesistente
    const broken = await rezip(zipA, editDb("PRAGMA foreign_keys = OFF; UPDATE bookings SET account_id = 999 WHERE ref = 'VE-AAAAAA'"));
    const up = await (await upload(s, broken)).json();
    assert.ok(up.ok, up.error);
    const res = await admin(up.url, post({ mode: 'all', confirm: 'RIPRISTINA' }));
    assert.equal(res.status, 400);
    assert.match(await res.text(), /collegamenti spezzati/);
    assert.equal(JSON.stringify(app.db.prepare('SELECT ref FROM bookings ORDER BY id').all()), before, 'i dati di adesso sono intatti');
    assert.equal(app.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(app.restore.snapshots(), [], 'la copia di sicurezza inutile viene tolta');
    // il sito funziona ancora normalmente
    addBooking(app.db, 'VE-CCCCCC');
    assert.equal((await admin('/admin/bookings')).status, 200);
  } finally {
    s.close();
  }
});

test('ripristino: le immagini sono controllate, uno zip rifatto a mano in una cartella si legge lo stesso', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const photo = app.media.save({ large: dataUrl(JPEG), small: dataUrl(JPEG), width: 1600, height: 900 });
    const zipA = await backupOf(app);
    app.media.remove(photo.name);
    assert.equal(fs.existsSync(app.media.file(photo.name)), false);

    // lo zip rifatto con Finder/Esplora risorse ha una cartella davanti, e i file di sistema in più
    const foldered = await rezip(zipA, (files) => {
      const out = {};
      for (const [name, data] of Object.entries(files)) out[`guida-backup-2027-01-04/${name}`] = data;
      out['__MACOSX/guida-backup-2027-01-04/._guida.sqlite'] = Buffer.from('x');
      out['guida-backup-2027-01-04/media/finto.jpg'] = JPEG; // nome non valido: ignorato
      out['guida-backup-2027-01-04/media/' + 'a'.repeat(24) + '.jpg'] = JPEG; // nome valido ma l’impronta non corrisponde: scartata
      return out;
    });
    const up = await (await upload(s, foldered)).json();
    assert.ok(up.ok, up.error);
    const meta = app.restore.get(tokenOf(up));
    assert.equal(meta.media.files, 1);
    assert.equal(meta.media.skipped, 1);
    const page = await (await admin(up.url)).text();
    assert.match(page, /1 file dello zip non era un’immagine valida e lo ho ignorato/);
    assert.equal(loc(await admin(up.url, post({ mode: 'content', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
    assert.ok(fs.readFileSync(app.media.file(photo.name)).equals(JPEG), 'la foto è tornata sul disco, identica');
    assert.ok(fs.existsSync(app.media.file(photo.small_name)));
    const served = await fetch(`${s.base}/media/${photo.name}`);
    assert.equal(served.status, 200, 'e il sito la serve');
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(JPEG));
    assert.ok(!fs.existsSync(app.media.file('a'.repeat(24) + '.jpg')), 'l’immagine con l’impronta sbagliata non è entrata');

    // una copia a cui mancano delle immagini lo dice
    const holes = await rezip(zipA, (files) => { for (const n of Object.keys(files)) if (n.startsWith('media/')) delete files[n]; });
    app.media.remove(photo.name);
    const up2 = await (await upload(s, holes)).json();
    assert.ok(up2.ok, up2.error);
    assert.match(await (await admin(up2.url)).text(), /2 immagini citate dalla copia non sono nello zip/);
  } finally {
    s.close();
  }
});

test('ripristino: una copia di una versione precedente si aggiorna da sola, e le fatture più recenti vengono segnalate', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const zipA = await backupOf(app);
    // una fattura emessa dopo la copia
    app.db.prepare(`INSERT INTO invoices(status, year, seq, number, issue_date, buyer_json, created_at, updated_at) VALUES('issued', 2027, 1, '1/2027', '2027-01-05', '{}', '2027-01-05T10:00:00Z', '2027-01-05T10:00:00Z')`).run();
    addBooking(app.db, 'VE-BBBBBB');

    // la copia è di quando lo schema era alla versione 10: manca la colonna dei commenti in evidenza
    const old = path.join(tmp, `v10-${crypto.randomBytes(3).toString('hex')}.sqlite`);
    const odb = new DatabaseSync(old);
    for (let i = 0; i < 10; i++) odb.exec(MIGRATIONS[i]);
    odb.exec('PRAGMA user_version = 10');
    odb.close();
    const upgraded = await rezip(zipA, (files) => { files['guida.sqlite'] = fs.readFileSync(old); fs.rmSync(old); });
    const up = await (await upload(s, upgraded)).json();
    assert.ok(up.ok, up.error);
    const meta = app.restore.get(tokenOf(up));
    assert.equal(meta.version, 10);
    assert.equal(meta.upgraded, true);
    const page = await (await admin(up.url)).text();
    assert.match(page, /La copia è di una versione precedente del sito: la aggiorno io/);
    assert.match(page, /<strong>Fatture:<\/strong> con «Tutto» sparirebbero dal sito/);
    assert.match(page, /1 fattura emessa/);
    assert.match(page, /1 prenotazione/);
    // ripristinando tutto, la struttura di adesso resta quella di adesso
    assert.equal(loc(await admin(up.url, post({ mode: 'all', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
    assert.ok(app.db.prepare('PRAGMA table_info(feedback)').all().some((c) => c.name === 'featured'));
    assert.equal(app.db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n, 0, 'la fattura più recente della copia non c’è più');
  } finally {
    s.close();
  }
});

test('ripristino: si tengono solo le ultime copie di sicurezza e la pagina Backup le elenca', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const zipA = await backupOf(app);
    for (let i = 0; i < KEEP_SNAPSHOTS + 2; i++) {
      const up = await (await upload(s, zipA)).json();
      assert.ok(up.ok, up.error);
      assert.equal(loc(await admin(up.url, post({ mode: i % 2 ? 'all' : 'content', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
    }
    const snaps = app.restore.snapshots();
    assert.equal(snaps.length, KEEP_SNAPSHOTS);
    assert.deepEqual(snaps.map((x) => x.id), [...snaps.map((x) => x.id)].sort().reverse(), 'dalla più recente');
    assert.equal(fs.readdirSync(path.join(s.cfg.dataDir, 'restore-backups')).length, KEEP_SNAPSHOTS);
    const page = await (await admin('/admin/backup')).text();
    assert.match(page, /Copie salvate prima di un ripristino/);
    assert.equal((page.match(/Torna a questa versione/g) ?? []).length, KEEP_SNAPSHOTS + 1, 'un pulsante per ogni copia (più il richiamo nel testo)');
    assert.match(page, /Carica e controlla/);
    assert.match(page, /\/js\/admin-restore\.js/);
  } finally {
    s.close();
  }
});

test('zip: lettura di file memorizzati e compressi, e rifiuto di zip sospetti', async () => {
  const file = path.join(tmp, `z-${crypto.randomBytes(3).toString('hex')}.zip`);
  const open = async (buf) => { fs.writeFileSync(file, buf); return openZip(file); };
  const random = crypto.randomBytes(2048);

  const zip = await open(await zipBuffer([{ name: 'vuoto.txt', data: Buffer.alloc(0) }, { name: 'è/già.txt', data: Buffer.from('testo '.repeat(400)) }, { name: 'casuale.bin', data: random }]));
  const byName = Object.fromEntries(zip.entries.map((e) => [e.name, e]));
  assert.equal((await zip.read(byName['vuoto.txt'], 10)).length, 0);
  assert.equal((await zip.read(byName['è/già.txt'], 1 << 20)).toString(), 'testo '.repeat(400));
  assert.ok((await zip.read(byName['casuale.bin'], 1 << 20)).equals(random));
  await assert.rejects(zip.read(byName['casuale.bin'], 100), /troppo grande/, 'il limite vale');
  await zip.close();

  const whole = await zipBuffer([{ name: 'a.txt', data: Buffer.from('a'.repeat(100000)) }]);
  await assert.rejects(open(Buffer.from('non zip')), ZipError);
  await assert.rejects(open(whole.subarray(0, whole.length - 10)), ZipError, 'tagliato');

  // un file che dichiara meno di quello che contiene non si espande oltre il dichiarato
  const z = await open(whole);
  await assert.rejects(z.read({ ...z.entries[0], usize: 10 }, 1 << 20), ZipError);
  // CRC sbagliato, cifrato, compressione sconosciuta
  await assert.rejects(z.read({ ...z.entries[0], crc: 1 }, 1 << 20), /integrità/);
  await assert.rejects(z.read({ ...z.entries[0], flags: 1 }, 1 << 20), /password/);
  await assert.rejects(z.read({ ...z.entries[0], method: 99 }, 1 << 20), /compressione/);
  await z.close();

  // ZIP64
  const big = Buffer.from(await zipBuffer([{ name: 'c.txt', data: Buffer.from('x') }]));
  big.writeUInt16LE(0xffff, big.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10);
  await assert.rejects(open(big), /ZIP64/);
});

test('impostazioni: reload() rilegge le scelte dal database e le applica subito', async () => {
  const s = await start();
  try {
    const { app } = s;
    await setName(s, 'Nome salvato');
    assert.equal(app.cfg.site.name, 'Nome salvato');
    const saved = app.db.prepare("SELECT value FROM settings WHERE key = 'config_overrides'").get().value;
    app.db.prepare("DELETE FROM settings WHERE key = 'config_overrides'").run();
    app.settings.reload();
    assert.notEqual(app.cfg.site.name, 'Nome salvato', 'senza scelte salvate torna il valore del server');
    app.db.prepare("INSERT INTO settings(key, value) VALUES('config_overrides', ?)").run(saved);
    app.settings.reload();
    assert.equal(app.cfg.site.name, 'Nome salvato');
  } finally {
    s.close();
  }
});

test('ripristino: un guasto a metà strada non lascia il sito senza controlli sui collegamenti né con database collegati a metà', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    addBooking(app.db, 'VE-AAAAAA');
    const zipA = await backupOf(app);
    addBooking(app.db, 'VE-BBBBBB');
    const keep = JSON.stringify(app.db.prepare('SELECT ref FROM bookings ORDER BY id').all());
    const healthy = () => {
      assert.equal(app.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'collegamenti di nuovo controllati');
      assert.deepEqual(app.db.prepare('PRAGMA database_list').all().map((d) => d.name), ['main'], 'nessun database rimasto collegato');
      assert.equal(JSON.stringify(app.db.prepare('SELECT ref FROM bookings ORDER BY id').all()), keep, 'dati intatti');
      assert.deepEqual(app.db.prepare('PRAGMA main.foreign_key_check').all(), []);
    };

    // il collegamento al database della copia non riesce
    assert.throws(() => transfer(app.db, path.join(tmp, 'non-esiste', 'guida.sqlite'), 'all'));
    healthy();

    // il database della copia si rovina dopo il controllo (disco, altro processo…): la transazione non parte a metà
    const up = await (await upload(s, zipA)).json();
    assert.ok(up.ok, up.error);
    const staged = path.join(s.cfg.dataDir, 'restore', tokenOf(up), 'guida.sqlite');
    const bytes = fs.readFileSync(staged);
    fs.writeFileSync(staged, Buffer.concat([bytes.subarray(0, 4096), crypto.randomBytes(bytes.length - 4096)]));
    const res = await admin(up.url, post({ mode: 'all', confirm: 'RIPRISTINA' }));
    assert.ok([400, 500].includes(res.status), String(res.status));
    assert.match(await res.text(), /non ho cambiato nulla/);
    healthy();
    assert.deepEqual(app.restore.snapshots(), [], 'la copia di sicurezza inutile viene tolta');
    // e il sito continua a lavorare: si può ripristinare con un file buono
    const again = await (await upload(s, zipA)).json();
    assert.equal(loc(await admin(again.url, post({ mode: 'all', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
    assert.deepEqual(refs(app.db), ['VE-AAAAAA']);
  } finally {
    s.close();
  }
});

test('ripristino: un caricamento lento non viene ripulito a metà e un secondo caricamento in contemporanea viene rifiutato', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const zipA = await backupOf(app);
    const login = await fetch(`${s.base}/admin/login`, { ...post({ password: 'segreto-admin' }), redirect: 'manual' });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    // invio a pezzi, con una pausa in mezzo
    const half = Math.floor(zipA.length / 2);
    const slow = await new Promise((resolve, reject) => {
      const req = http.request(`${s.base}/admin/backup/restore/upload`, { method: 'POST', headers: { cookie, 'content-type': 'application/zip', 'content-length': String(zipA.length) } }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject);
      req.write(zipA.subarray(0, half));
      setTimeout(async () => {
        try {
          const dir = path.join(s.cfg.dataDir, 'restore');
          assert.equal(fs.readdirSync(dir).length, 1, 'la cartella di appoggio c’è');
          app.restore.cleanup(Date.now() + 3 * 3600_000); // anche a distanza di ore, finché il caricamento è in corso non si tocca nulla
          assert.equal(fs.readdirSync(dir).length, 1, 'non è stata cancellata a metà');
          const second = await upload(s, zipA);
          assert.equal(second.status, 409);
          assert.match((await second.json()).error, /già un ripristino in corso/);
          req.end(zipA.subarray(half));
        } catch (err) {
          req.destroy();
          reject(err);
        }
      }, 200);
    });
    assert.ok(slow.ok, slow.error);
    assert.equal(loc(await admin(slow.url, post({ mode: 'content', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');
  } finally {
    s.close();
  }
});

test('ripristino su un server nuovo: una copia fatta altrove rimette in piedi tutto, foto comprese', async () => {
  const a = await start(); // il sito «vecchio»
  const b = await start(); // il server «nuovo»: vuoto, con il solo contenuto iniziale
  try {
    const photo = a.app.media.save({ large: dataUrl(JPEG), small: dataUrl(JPEG), width: 1600, height: 900 });
    a.app.siteImages.set('home', photo.name);
    a.app.content.saveTour('cannaregio-ghetto', NEW_TOUR(a.app, 'Titolo del vecchio sito'));
    addBooking(a.app.db, 'VE-VECCHIO');
    await setName(a, 'Sito vecchio');
    const zip = await backupOf(a.app);

    assert.deepEqual(refs(b.app.db), []);
    assert.equal(fs.existsSync(b.app.media.file(photo.name)), false);
    const up = await (await upload(b, zip)).json();
    assert.ok(up.ok, up.error);
    assert.equal(loc(await b.admin(up.url, post({ mode: 'all', confirm: 'RIPRISTINA' }))), '/admin/backup?ok=restored');

    assert.deepEqual(refs(b.app.db), ['VE-VECCHIO']);
    assert.equal(b.app.content.tour('cannaregio-ghetto').i18n.it.title, 'Titolo del vecchio sito');
    assert.equal(b.app.cfg.site.name, 'Sito vecchio');
    assert.equal(b.app.siteImages.get('home'), photo.name);
    const served = await fetch(`${b.base}/media/${photo.name}`);
    assert.equal(served.status, 200, 'il server nuovo serve la foto');
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(JPEG));
    assert.match(await (await fetch(`${b.base}/it/tours/cannaregio-ghetto`)).text(), /Titolo del vecchio sito/);
    assert.equal((await b.admin('/admin/bookings')).status, 200, 'il pannello funziona, e l’accesso resta valido');
    // e il vecchio sito non è stato toccato
    assert.deepEqual(refs(a.app.db), ['VE-VECCHIO']);
  } finally {
    a.close();
    b.close();
  }
});
