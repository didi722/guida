// Copia di sicurezza: un unico file .zip con il database (prenotazioni, clienti, fatture, contenuti, impostazioni),
// le immagini caricate e i contenuti in un formato leggibile. Si scarica dal pannello (Aiuto › Backup).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getSetting, setSetting } from './db.js';
import { MEDIA_NAME } from './media.js';
import { nowRome } from './time.js';

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const dosStamp = (d) => [((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xffff, (((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xffff];

/**
 * Scrive uno zip (PKZIP, deflate) su `out`. `entries` è un (async) iterabile di { name, data: Buffer }:
 * i file si leggono uno alla volta, così la memoria non cresce con le dimensioni della libreria.
 */
export async function writeZip(out, entries, now = new Date()) {
  const write = (buf) => new Promise((resolve, reject) => out.write(buf, (err) => (err ? reject(err) : resolve())));
  const [time, date] = dosStamp(now);
  const central = [];
  let offset = 0;
  for await (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const stored = packed.length >= data.length;
    const body = stored ? data : packed;
    const method = stored ? 0 : 8;
    const crc = zlib.crc32(data);
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf]);
    await write(header);
    await write(body);
    central.push(Buffer.concat([u32(0x02014b50), u16(0x031e), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32((0o100644 << 16) >>> 0), u32(offset), nameBuf]));
    offset += header.length + body.length;
  }
  const dir = Buffer.concat(central);
  await write(dir);
  await write(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(dir.length), u32(offset), u16(0)]));
}

const README = (when) => `COPIA DI SICUREZZA — ${when}

Contenuto
  guida.sqlite    il database: prenotazioni, clienti, partner, fatture, buoni regalo, tour, articoli,
                  pagine, testi del sito e impostazioni
  media/          le immagini caricate dal pannello
  contenuti.json  tour, articoli, pagine e testi in formato leggibile (utile per consultarli o copiarli)

ATTENZIONE: contiene dati personali dei clienti. Conservala al sicuro e non inviarla per email.

Come si ripristina (sul server, con il sito spento)
  1. sostituisci il file guida.sqlite nella cartella dei dati (DATA_DIR, di solito «data/»)
     e cancella eventuali file guida.sqlite-wal e guida.sqlite-shm accanto
  2. copia la cartella media/ dentro la cartella dei dati
  3. riavvia il sito
`;

/** Gli elementi della copia: database, immagini, contenuti leggibili e istruzioni. */
export async function* backupEntries(app, nowMs = Date.now()) {
  const { cfg, db } = app;
  yield { name: 'LEGGIMI.txt', data: Buffer.from(README(`${nowRome(nowMs).date} ${nowRome(nowMs).time}`), 'utf8') };
  const tmp = path.join(cfg.dataDir, `.backup-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  try {
    db.prepare('VACUUM INTO ?').run(tmp); // fotografia coerente anche mentre il sito lavora
    yield { name: 'guida.sqlite', data: fs.readFileSync(tmp) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const exported = app.content.export?.();
  if (exported) yield { name: 'contenuti.json', data: Buffer.from(JSON.stringify(exported, null, 2), 'utf8') };
  const mediaDir = path.join(cfg.dataDir, 'media');
  if (fs.existsSync(mediaDir)) {
    for (const f of fs.readdirSync(mediaDir).sort()) if (MEDIA_NAME.test(f)) yield { name: `media/${f}`, data: fs.readFileSync(path.join(mediaDir, f)) };
  }
}

export const backupFileName = (nowMs = Date.now()) => `guida-backup-${nowRome(nowMs).date}.zip`;

const SETTING = 'last_backup_at';
export const lastBackup = (db) => getSetting(db, SETTING, null);
export const markBackup = (db, nowMs = Date.now()) => setSetting(db, SETTING, new Date(nowMs).toISOString());

/** Quanti file e quanto spazio occupano le immagini (per la pagina Backup). */
export function mediaStats(cfg) {
  const dir = path.join(cfg.dataDir, 'media');
  let files = 0;
  let bytes = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (!MEDIA_NAME.test(f)) continue;
      if (!/-s\.[a-z]+$/.test(f)) files += 1; // ogni foto ha una copia piccola: si conta una volta sola
      bytes += fs.statSync(path.join(dir, f)).size;
    }
  }
  return { files, bytes };
}
