// Immagini caricate dal pannello (copertine di tour e articoli).
// Il browser ridimensiona e ricodifica la foto prima dell'invio (JPEG, due misure): qui si controlla che sia davvero un'immagine,
// si salva con un nome derivato dal contenuto (mai dal nome del file dell'utente) e la si serve con cache lunga.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_LARGE_BYTES = 4 * 1024 * 1024;
export const MAX_SMALL_BYTES = 1024 * 1024;
export const MEDIA_NAME = /^[a-f0-9]{24}(-s)?\.(jpg|png|webp)$/;

const KINDS = [
  { mime: 'image/jpeg', ext: 'jpg', is: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', is: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', is: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/** Il tipo di immagine dai primi byte (non ci si fida dell'estensione né del tipo dichiarato). */
export const detectImage = (buf) => KINDS.find((k) => k.is(buf)) ?? null;
export const MIME_BY_EXT = Object.fromEntries(KINDS.map((k) => [k.ext, k.mime]));
export const smallName = (name) => name.replace(/(\.[a-z]+)$/, '-s$1');

/** «data:image/jpeg;base64,…» → Buffer (solo immagini di tipo ammesso). */
export function parseDataUrl(s) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(s ?? ''));
  return m ? Buffer.from(m[1], 'base64') : null;
}

export class MediaError extends Error {}

export function createMedia({ db, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (name) => path.join(dir, name);
  const clamp = (n) => (Number.isInteger(n) && n > 0 && n <= 20000 ? n : null);

  return {
    dir,
    file,
    /** Salva le due versioni (grande e piccola). Restituisce la riga del database. */
    save({ large, small, width = null, height = null }, nowMs = Date.now()) {
      const big = parseDataUrl(large);
      const sm = parseDataUrl(small);
      if (!big || !sm) throw new MediaError('Immagine non valida: servono un JPEG, PNG o WebP.');
      if (big.length > MAX_LARGE_BYTES || sm.length > MAX_SMALL_BYTES) throw new MediaError('Immagine troppo pesante (massimo 4 MB): riduci la foto.');
      const kind = detectImage(big);
      const kindSmall = detectImage(sm);
      if (!kind || !kindSmall || kind.ext !== kindSmall.ext) throw new MediaError('Il file non è un’immagine riconosciuta.');
      const name = `${crypto.createHash('sha256').update(big).digest('hex').slice(0, 24)}.${kind.ext}`;
      const existing = db.prepare('SELECT * FROM media WHERE name = ?').get(name);
      if (existing) return existing; // la stessa foto caricata due volte resta una sola
      const small_name = smallName(name);
      fs.writeFileSync(file(name), big, { mode: 0o644 });
      fs.writeFileSync(file(small_name), sm, { mode: 0o644 });
      db.prepare('INSERT INTO media(name, small_name, mime, bytes, width, height, created_at) VALUES(?,?,?,?,?,?,?)').run(name, small_name, kind.mime, big.length, clamp(width), clamp(height), new Date(nowMs).toISOString());
      return db.prepare('SELECT * FROM media WHERE name = ?').get(name);
    },
    list: () => db.prepare('SELECT * FROM media ORDER BY id DESC').all(),
    get: (name) => db.prepare('SELECT * FROM media WHERE name = ?').get(name),
    remove(name) {
      const row = db.prepare('SELECT * FROM media WHERE name = ?').get(name);
      if (!row) return false;
      for (const n of [row.name, row.small_name]) if (n && MEDIA_NAME.test(n)) fs.rmSync(file(n), { force: true });
      db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
      return true;
    },
  };
}
