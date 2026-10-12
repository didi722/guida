// Copia di sicurezza scaricabile dal pannello: zip valido con database, immagini e contenuti leggibili.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { setTextOverrides } from '../server/i18n.js';
import { writeZip } from '../server/backup.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-backup-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: tmp + '-' + crypto.randomBytes(2).toString('hex'), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
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
  return { app, cfg, jar, admin, close: () => { app.close(); http.close(); setTextOverrides(new Map()); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const form = () => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const dataUrl = (buf) => `data:image/jpeg;base64,${buf.toString('base64')}`;

/** Legge uno zip dalla directory centrale: { nome: Buffer }. Controlla CRC e dimensioni di ogni file. */
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'manca la fine della directory centrale');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014b50, 'voce della directory centrale');
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const csize = buf.readUInt32LE(pos + 20);
    const usize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'intestazione locale');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    assert.ok(method === 0 || method === 8, `metodo ${method}`);
    assert.equal(data.length, usize, `${name}: dimensione`);
    assert.equal(zlib.crc32(data), crc, `${name}: CRC`);
    out[name] = Buffer.from(data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(Object.keys(out).length, count);
  return out;
}

test('backup: lo zip scaricato è valido e contiene database, immagini e contenuti leggibili', async () => {
  const s = await start();
  try {
    const anon = s.jar();
    assert.equal((await anon('/admin/backup')).headers.get('location'), '/admin/login');
    assert.equal((await anon('/admin/backup/download', form())).headers.get('location'), '/admin/login');

    // una foto in libreria e un'impostazione cambiata: devono finire nella copia
    const up = await (await s.admin('/admin/media', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ large: dataUrl(JPEG), small: dataUrl(JPEG), width: 1600, height: 900 }) })).json();
    assert.ok(up.ok);
    await s.admin('/admin/settings/business', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'site.name': 'Nome Di Prova', 'site.email': 'prova@example.com', 'mail.notifyTo': '' }).toString() });

    const page = await (await s.admin('/admin/backup')).text();
    assert.match(page, /Non hai ancora scaricato nessuna copia/);
    assert.match(page, /1 immagine/);

    const res = await s.admin('/admin/backup/download', form());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="guida-backup-\d{4}-\d{2}-\d{2}\.zip"$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), ['LEGGIMI.txt', `media/${up.name}`, `media/${up.small}`, 'contenuti.json', 'guida.sqlite'].sort());
    assert.match(files['LEGGIMI.txt'].toString(), /dati personali dei clienti/);
    assert.ok(files[`media/${up.name}`].equals(JPEG), 'la foto è identica');

    // il database della copia si apre e contiene i contenuti e le impostazioni
    const file = path.join(s.cfg.dataDir, 'copia-ripristinata.sqlite');
    fs.writeFileSync(file, files['guida.sqlite']);
    const copy = new DatabaseSync(file);
    assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM content_tours').get().n >= 1, 'i tour ci sono');
    assert.match(copy.prepare("SELECT value FROM settings WHERE key = 'config_overrides'").get().value, /Nome Di Prova/);
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    copy.close();
    const exported = JSON.parse(files['contenuti.json'].toString());
    assert.ok(Object.keys(exported.tours).length >= 1 && exported.version === 1);

    // nessun file temporaneo resta nella cartella dei dati
    assert.deepEqual(fs.readdirSync(s.cfg.dataDir).filter((f) => f.startsWith('.backup-')), []);
    // la pagina ricorda l'ultima copia
    const after = await (await s.admin('/admin/backup')).text();
    assert.match(after, /Ultima copia scaricata/);
    assert.doesNotMatch(after, /Non hai ancora scaricato/);
  } finally {
    s.close();
  }
});

test('backup: scrittura dello zip con file vuoti, già compressi e nomi con accenti', async () => {
  const chunks = [];
  const out = { write: (b, cb) => { chunks.push(Buffer.from(b)); cb(); } };
  const random = crypto.randomBytes(4096); // non si comprime: va «memorizzato» così com'è
  await writeZip(out, [{ name: 'vuoto.txt', data: Buffer.alloc(0) }, { name: 'è/già.txt', data: Buffer.from('testo '.repeat(500)) }, { name: 'casuale.bin', data: random }], new Date('2027-01-04T10:00:00Z'));
  const files = unzip(Buffer.concat(chunks));
  assert.equal(files['vuoto.txt'].length, 0);
  assert.equal(files['è/già.txt'].toString(), 'testo '.repeat(500));
  assert.ok(files['casuale.bin'].equals(random));
});
