// Ripristino da una copia di sicurezza (Aiuto › Backup).
// Tre tempi: 1) si carica lo zip e lo si controlla in una cartella di appoggio, senza toccare i dati veri;
// 2) si mostra cosa cambierebbe; 3) solo dopo la conferma si salva una copia di sicurezza automatica e si sostituiscono i dati.
// I dati si sostituiscono dentro una sola transazione, senza cambiare il file del database: o passa tutto o non cambia nulla.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting } from './db.js';
import { splitLegacyAudiences } from './contentStore.js';
import { MAX_LARGE_BYTES, MAX_SMALL_BYTES, MEDIA_NAME, detectImage } from './media.js';
import { MIGRATIONS, migrate } from './migrations.js';
import { PRIVATE_SETTINGS, scrubPrivateSettings } from './privateSettings.js';
import { ZipError, openZip } from './zipread.js';

export class RestoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const RESTORE_WORD = 'RIPRISTINA';
export const MAX_UPLOAD_BYTES = 1024 ** 3; // lo zip caricato
const MAX_DB_BYTES = 256 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_MEDIA_BYTES = 1024 ** 3;
const MAX_MEDIA_FILES = 10000;
const STAGE_TTL_MS = 60 * 60_000; // un file caricato e non confermato si cancella dopo un'ora
export const KEEP_SNAPSHOTS = 3;
const TOKEN = /^[a-f0-9]{24}$/;
const SNAPSHOT_ID = /^\d{14}-[a-f0-9]{6}$/;

/** Cosa si può ripristinare. «content» non tocca prenotazioni, clienti, partner, fatture e simili. */
export const MODES = {
  content: { label: 'Solo i contenuti' },
  all: { label: 'Tutto' },
};
const CONTENT_PLAN = [
  // un tour con prenotazioni non sparisce mai (le prenotazioni lo citano): resta com'è adesso se la copia non lo conosce
  { table: 'content_tours', keepLive: 'slug IN (SELECT tour_slug FROM main.bookings)' },
  { table: 'content_posts' },
  { table: 'content_pages' },
  { table: 'content_texts' },
  { table: 'media', merge: true }, // la libreria delle immagini si unisce: non si perde nessuna foto
];
const CONTENT_SETTINGS = ['site_images', 'rate_card']; // le foto del sito e le tariffe a ore tornano con i contenuti
const KEEP_SETTINGS = ['last_backup_at', 'last_restore', 'auto_backup', ...PRIVATE_SETTINGS]; // restano quelli di adesso anche se si ripristina tutto (compresa la sicurezza del pannello)

const COUNTS = [
  ['tours', 'SELECT COUNT(*) AS n FROM content_tours'],
  ['posts', 'SELECT COUNT(*) AS n FROM content_posts'],
  ['pages', 'SELECT COUNT(*) AS n FROM content_pages'],
  ['texts', 'SELECT COUNT(*) AS n FROM content_texts'],
  ['media', 'SELECT COUNT(*) AS n FROM media'],
  ['bookings', 'SELECT COUNT(*) AS n FROM bookings'],
  ['accounts', 'SELECT COUNT(*) AS n FROM accounts'],
  ['gifts', 'SELECT COUNT(*) AS n FROM gift_cards'],
  ['programs', 'SELECT COUNT(*) AS n FROM programs'],
  ['invoices', 'SELECT COUNT(*) AS n FROM invoices WHERE number IS NOT NULL'],
  ['feedback', 'SELECT COUNT(*) AS n FROM feedback'],
];
/** Cose che esistono adesso e che «Tutto» farebbe sparire se la copia non le contiene (chiave naturale di ciascuna). */
const LOSS_KEYS = [
  ['bookings', 'SELECT ref AS k FROM bookings'],
  ['gifts', 'SELECT ref AS k FROM gift_cards'],
  ['programs', 'SELECT ref AS k FROM programs'],
  ['accounts', 'SELECT LOWER(email) AS k FROM accounts'],
  ['invoices', 'SELECT number AS k FROM invoices WHERE number IS NOT NULL'],
  ['feedback', 'SELECT booking_id AS k FROM feedback'],
  ['promos', 'SELECT LOWER(code) AS k FROM promo_codes'],
];

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;
const tablesOf = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const columnsOf = (db, schema, table) => db.prepare(`PRAGMA ${schema}.table_info(${q(table)})`).all().map((c) => c.name);
const keysOf = (db, sql) => new Set(db.prepare(sql).all().map((r) => r.k));

function facts(db) {
  const counts = {};
  for (const [key, sql] of COUNTS) counts[key] = db.prepare(sql).get().n;
  return {
    counts,
    lastBooking: db.prepare('SELECT MAX(created_at) AS v FROM bookings').get().v ?? null,
    lastInvoice: db.prepare('SELECT number AS v FROM invoices WHERE number IS NOT NULL ORDER BY year DESC, seq DESC LIMIT 1').get()?.v ?? null,
  };
}

/** Il confronto tra i dati di adesso e quelli della copia (database della copia già pronto). */
function analyze(live, stagedFile) {
  const st = new DatabaseSync(stagedFile, { readOnly: true });
  try {
    const now = facts(live);
    const then = facts(st);
    const lost = {};
    for (const [key, sql] of LOSS_KEYS) {
      const inCopy = keysOf(st, sql);
      lost[key] = [...keysOf(live, sql)].filter((k) => !inCopy.has(k)).length;
    }
    const slugsOf = (db, table, col) => new Set(db.prepare(`SELECT ${col} AS k FROM ${table}`).all().map((r) => r.k));
    const copyTours = slugsOf(st, 'content_tours', 'slug');
    const withBookings = new Set(live.prepare('SELECT DISTINCT tour_slug AS k FROM bookings').all().map((r) => r.k));
    const goneTours = [...slugsOf(live, 'content_tours', 'slug')].filter((s) => !copyTours.has(s));
    const copyPosts = slugsOf(st, 'content_posts', 'slug');
    const copyMedia = slugsOf(st, 'media', 'name');
    return {
      now,
      then,
      all: { lost },
      content: {
        keptTours: goneTours.filter((s) => withBookings.has(s)),
        lostTours: goneTours.filter((s) => !withBookings.has(s)),
        lostPosts: [...slugsOf(live, 'content_posts', 'slug')].filter((s) => !copyPosts.has(s)),
        mediaNotInCopy: [...slugsOf(live, 'media', 'name')].filter((n) => !copyMedia.has(n)).length,
      },
    };
  } finally {
    st.close();
  }
}

const stamp = (nowMs) => new Date(nowMs).toISOString().replace(/[-:T]/g, '').slice(0, 14);

export function createRestoreServices(app) {
  const { cfg, db } = app;
  const stageRoot = path.join(cfg.dataDir, 'restore');
  const snapRoot = path.join(cfg.dataDir, 'restore-backups');
  let busy = false;

  const stageDir = (token) => path.join(stageRoot, token);
  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };

  /** Toglie dal disco i file caricati e non confermati (e quelli rimasti a metà). */
  function cleanup(nowMs = Date.now()) {
    if (busy || !fs.existsSync(stageRoot)) return; // durante un caricamento lento la cartella è «a metà»: non si tocca
    for (const name of fs.readdirSync(stageRoot)) {
      const dir = path.join(stageRoot, name);
      try {
        const meta = readJson(path.join(dir, 'meta.json'));
        const created = meta?.createdAt ? Date.parse(meta.createdAt) : fs.statSync(dir).mtimeMs;
        if (nowMs - created > (meta ? STAGE_TTL_MS : 10 * 60_000)) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* sparita nel frattempo */
      }
    }
  }
  app.jobs.push(async (nowMs) => cleanup(nowMs));

  /** Apre il database della copia, lo controlla e lo porta alla versione di questo sito. Ritorna { version, upgraded }. */
  function prepareDb(file) {
    let st;
    try {
      st = new DatabaseSync(file);
      st.exec('PRAGMA trusted_schema = OFF');
      const check = st.prepare('PRAGMA integrity_check(3)').all();
      if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new RestoreError('Il database dentro lo zip è danneggiato (controllo di integrità non superato): usa un’altra copia.');
      const have = new Set(tablesOf(st));
      if (!['settings', 'bookings'].every((t) => have.has(t))) throw new RestoreError('Il database dentro lo zip non è quello di questo sito: scegli una copia scaricata da Aiuto › Backup.');
      const version = st.prepare('PRAGMA user_version').get().user_version;
      if (version > MIGRATIONS.length) throw new RestoreError('Questa copia è stata fatta da una versione del sito più recente di quella installata: aggiorna prima il sito, poi riprova.');
      if (version < 1) throw new RestoreError('Il database dentro lo zip non è quello di questo sito: scegli una copia scaricata da Aiuto › Backup.');
      try {
        migrate(st); // una copia di una versione precedente si aggiorna prima di confrontarla
      } catch (err) {
        throw new RestoreError(`Non riesco ad aggiornare la copia a questa versione del sito (${err.message}).`);
      }
      // ogni tabella e colonna di adesso deve esserci anche nella copia
      for (const t of tablesOf(db)) {
        const theirs = new Set(tablesOf(st).includes(t) ? columnsOf(st, 'main', t) : []);
        if (!columnsOf(db, 'main', t).every((c) => theirs.has(c))) throw new RestoreError('La struttura del database nello zip non corrisponde a quella di questo sito: scegli una copia fatta da questo sito.');
      }
      st.exec('PRAGMA journal_mode = DELETE');
      return { version, upgraded: version < MIGRATIONS.length };
    } catch (err) {
      if (err instanceof RestoreError) throw err;
      throw new RestoreError('Il file guida.sqlite nello zip non è un database leggibile: la copia è danneggiata.');
    } finally {
      try {
        st?.close();
      } catch {
        /* già chiuso */
      }
    }
  }

  /** Estrae dallo zip il database, i contenuti e le immagini nella cartella di appoggio. */
  async function extract(zipFile, dir) {
    let zip;
    try {
      zip = await openZip(zipFile);
    } catch (err) {
      if (err instanceof ZipError) throw new RestoreError(err.message === 'Il file non è uno zip.' ? 'Questo file non è uno zip: scegli il file «guida-backup-….zip» scaricato da Aiuto › Backup.' : err.message);
      throw err;
    }
    try {
      const files = zip.entries.filter((e) => !e.name.endsWith('/'));
      const dbEntries = files.filter((e) => /^(?:[^/\\]+\/)?guida\.sqlite$/.test(e.name));
      if (!dbEntries.length) throw new RestoreError('Nello zip non c’è guida.sqlite: non sembra una copia fatta da questo sito (Aiuto › Backup).');
      if (dbEntries.length > 1) throw new RestoreError('Nello zip ci sono più copie del database: usa lo zip originale.');
      const prefix = dbEntries[0].name.slice(0, -'guida.sqlite'.length); // «» oppure «cartella/» se lo zip è stato rifatto a mano
      await fsp.writeFile(path.join(dir, 'guida.sqlite'), await zip.read(dbEntries[0], MAX_DB_BYTES), { mode: 0o600 });

      let backupAt = null;
      const json = files.find((e) => e.name === `${prefix}contenuti.json`);
      if (json) {
        try {
          const exported = JSON.parse((await zip.read(json, MAX_JSON_BYTES)).toString('utf8'));
          if (typeof exported?.exportedAt === 'string' && !Number.isNaN(Date.parse(exported.exportedAt))) backupAt = new Date(exported.exportedAt).toISOString();
        } catch (err) {
          if (err instanceof ZipError) throw err;
          /* contenuti.json serve solo per la data: se è illeggibile si va avanti senza */
        }
      }

      await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
      const media = { files: 0, bytes: 0, skipped: 0 };
      const seen = new Set();
      let total = 0;
      for (const entry of files) {
        if (!entry.name.startsWith(`${prefix}media/`)) continue;
        const name = entry.name.slice(`${prefix}media/`.length);
        if (!MEDIA_NAME.test(name) || seen.has(name)) continue; // altri file nello zip (anteprime del sistema, cartelle…) si ignorano
        seen.add(name);
        if (seen.size > MAX_MEDIA_FILES) throw new RestoreError('Lo zip contiene troppe immagini.');
        const small = /-s\.[a-z]+$/.test(name);
        const buf = await zip.read(entry, small ? MAX_SMALL_BYTES : MAX_LARGE_BYTES);
        total += buf.length;
        if (total > MAX_MEDIA_BYTES) throw new RestoreError('Le immagini nello zip pesano troppo.');
        const kind = detectImage(buf);
        const genuine = kind && name.endsWith(`.${kind.ext}`) && (small || crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) === name.slice(0, 24));
        if (!genuine) {
          media.skipped += 1; // non è l'immagine che dice di essere: non la importo
          continue;
        }
        await fsp.writeFile(path.join(dir, 'media', name), buf, { mode: 0o644 });
        if (!small) media.files += 1;
        media.bytes += buf.length;
      }
      return { backupAt, media };
    } catch (err) {
      if (err instanceof ZipError) throw new RestoreError(err.message);
      throw err;
    } finally {
      await zip.close().catch(() => {});
    }
  }

  /** Immagini citate dal database della copia che non ci sono né nello zip né già sul disco. */
  function missingMedia(dir) {
    const st = new DatabaseSync(path.join(dir, 'guida.sqlite'), { readOnly: true });
    try {
      let missing = 0;
      for (const r of st.prepare('SELECT name, small_name FROM media').all()) {
        for (const n of [r.name, r.small_name]) if (n && !fs.existsSync(path.join(dir, 'media', n)) && !fs.existsSync(app.media.file(n))) missing += 1;
      }
      return missing;
    } finally {
      st.close();
    }
  }

  function finishStage(token, dir, extra) {
    const prepared = prepareDb(path.join(dir, 'guida.sqlite'));
    const media = extra.media ?? { files: 0, bytes: 0, skipped: 0 };
    const meta = { token, createdAt: new Date().toISOString(), source: extra.source, snapshotId: extra.snapshotId ?? null, backupAt: extra.backupAt ?? null, version: prepared.version, upgraded: prepared.upgraded, media: { ...media, missing: missingMedia(dir) } };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta), { mode: 0o600 });
    return meta;
  }

  const newStage = () => {
    cleanup();
    for (const name of fs.existsSync(stageRoot) ? fs.readdirSync(stageRoot) : []) fs.rmSync(path.join(stageRoot, name), { recursive: true, force: true }); // un solo file in attesa alla volta
    const token = crypto.randomBytes(12).toString('hex');
    const dir = stageDir(token);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { token, dir };
  };

  const exclusive = async (fn) => {
    if (busy) throw new RestoreError('C’è già un ripristino in corso: riprova tra un minuto.', 409);
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };

  const failureOf = (err) => {
    if (err instanceof RestoreError) return err;
    if (err?.code === 'ENOSPC') return new RestoreError('Non c’è abbastanza spazio sul disco del server per controllare la copia.', 507);
    return err;
  };

  return {
    cleanup,

    /** Riceve lo zip dal corpo della richiesta, lo controlla e lo mette da parte. Ritorna { token, meta }. */
    stageUpload: (req) =>
      exclusive(async () => {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) throw new RestoreError('Il file è troppo grande (massimo 1 GB).', 413);
        const { token, dir } = newStage();
        try {
          const zipFile = path.join(dir, 'upload.zip');
          let received = 0;
          await pipeline(
            req,
            async function* (source) {
              for await (const chunk of source) {
                received += chunk.length;
                if (received > MAX_UPLOAD_BYTES) throw new RestoreError('Il file è troppo grande (massimo 1 GB).', 413);
                yield chunk;
              }
            },
            fs.createWriteStream(zipFile, { mode: 0o600 }),
          );
          const extracted = await extract(zipFile, dir);
          fs.rmSync(zipFile, { force: true }); // lo zip non serve più: i dati personali non restano due volte sul disco
          return { token, meta: finishStage(token, dir, { source: 'upload', ...extracted }) };
        } catch (err) {
          fs.rmSync(dir, { recursive: true, force: true });
          throw failureOf(err);
        }
      }),

    /** Mette da parte una copia di sicurezza automatica per tornare indietro («Torna a questa versione»). */
    stageSnapshot: (id) =>
      exclusive(async () => {
        const snap = snapshotInfo(id);
        if (!snap) throw new RestoreError('Copia di sicurezza non trovata.', 404);
        const { token, dir } = newStage();
        try {
          fs.copyFileSync(path.join(snapRoot, id, 'guida.sqlite'), path.join(dir, 'guida.sqlite'));
          return { token, meta: finishStage(token, dir, { source: 'snapshot', snapshotId: id, backupAt: snap.at }) };
        } catch (err) {
          fs.rmSync(dir, { recursive: true, force: true });
          throw failureOf(err);
        }
      }),

    /** La copia in attesa di conferma, oppure null se non c'è più. */
    get(token) {
      if (!TOKEN.test(String(token))) return null;
      const meta = readJson(path.join(stageDir(token), 'meta.json'));
      if (!meta || Date.now() - Date.parse(meta.createdAt) > STAGE_TTL_MS || !fs.existsSync(path.join(stageDir(token), 'guida.sqlite'))) return null;
      return meta;
    },

    /** Cosa cambierebbe: i numeri di adesso e quelli della copia. */
    preview(token) {
      const meta = this.get(token);
      if (!meta) return null;
      return { meta, ...analyze(db, path.join(stageDir(token), 'guida.sqlite')) };
    },

    discard(token) {
      if (TOKEN.test(String(token))) fs.rmSync(stageDir(token), { recursive: true, force: true });
    },

    snapshots,
    snapshotInfo,
    lastRestore: () => getSetting(db, 'last_restore', null),

    /**
     * Sostituisce i dati con quelli della copia in attesa. Prima salva la copia di sicurezza automatica (database di adesso).
     * Tutto avviene in modo sincrono: nessuna richiesta può inserirsi tra la copia di sicurezza e la sostituzione.
     */
    apply(token, mode, nowMs = Date.now()) {
      if (!MODES[mode]) throw new RestoreError('Scegli cosa ripristinare.');
      if (busy) throw new RestoreError('C’è già un ripristino in corso: riprova tra un minuto.', 409);
      const meta = this.get(token);
      if (!meta) throw new RestoreError('Il file caricato non c’è più (dopo un’ora si cancella): caricalo di nuovo.', 404);
      busy = true;
      const dir = stageDir(token);
      const id = `${stamp(nowMs)}-${crypto.randomBytes(3).toString('hex')}`;
      const snapDir = path.join(snapRoot, id);
      try {
        // 1. le immagini della copia vanno sul disco prima del database (nome = impronta del contenuto: non si sovrascrive nulla di diverso)
        const mediaDir = path.join(dir, 'media');
        if (fs.existsSync(mediaDir)) {
          for (const name of fs.readdirSync(mediaDir)) {
            if (!MEDIA_NAME.test(name)) continue;
            const target = app.media.file(name);
            if (fs.existsSync(target)) continue;
            try {
              fs.renameSync(path.join(mediaDir, name), target);
            } catch {
              fs.copyFileSync(path.join(mediaDir, name), target);
            }
          }
        }

        // 2. copia di sicurezza automatica: se non riesce, non si cambia nulla
        fs.mkdirSync(snapDir, { recursive: true, mode: 0o700 });
        try {
          db.prepare('VACUUM INTO ?').run(path.join(snapDir, 'guida.sqlite'));
          scrubPrivateSettings(path.join(snapDir, 'guida.sqlite'));
          const exported = app.content.export?.();
          if (exported) fs.writeFileSync(path.join(snapDir, 'contenuti.json'), JSON.stringify(exported, null, 2), { mode: 0o600 });
          fs.writeFileSync(path.join(snapDir, 'meta.json'), JSON.stringify({ id, at: new Date(nowMs).toISOString(), mode, backupAt: meta.backupAt, source: meta.source }), { mode: 0o600 });
        } catch (err) {
          fs.rmSync(snapDir, { recursive: true, force: true });
          throw err?.code === 'ENOSPC' ? new RestoreError('Non c’è abbastanza spazio sul disco per la copia di sicurezza: non ho cambiato nulla.', 507) : new RestoreError(`Non sono riuscito a salvare la copia di sicurezza (${err.message}): non ho cambiato nulla.`, 500);
        }

        // 3. la sostituzione, in una transazione
        try {
          transfer(db, path.join(dir, 'guida.sqlite'), mode);
        } catch (err) {
          fs.rmSync(snapDir, { recursive: true, force: true });
          throw err instanceof RestoreError ? err : new RestoreError(`Il ripristino non è riuscito e non ho cambiato nulla (${err.message}).`, 500);
        }

        // 4. il sito rilegge i dati
        setSetting(db, 'last_restore', { at: new Date(nowMs).toISOString(), mode, backupAt: meta.backupAt, source: meta.source, snapshot: id });
        app.settings.reload();
        splitLegacyAudiences(db); // un backup di prima della divisione B2C/B2B ha tour con due tariffe
        app.content.reload?.();
        pruneSnapshots();
        fs.rmSync(dir, { recursive: true, force: true });
        return { snapshot: id, mode };
      } finally {
        busy = false;
      }
    },
  };

  function snapshotInfo(id) {
    if (!SNAPSHOT_ID.test(String(id))) return null;
    const dir = path.join(snapRoot, id);
    const meta = readJson(path.join(dir, 'meta.json'));
    if (!meta || !fs.existsSync(path.join(dir, 'guida.sqlite'))) return null;
    return { ...meta, id, dir, dbFile: path.join(dir, 'guida.sqlite'), contentFile: fs.existsSync(path.join(dir, 'contenuti.json')) ? path.join(dir, 'contenuti.json') : null };
  }

  /** Le copie di sicurezza automatiche, dalla più recente. */
  function snapshots() {
    if (!fs.existsSync(snapRoot)) return [];
    return fs
      .readdirSync(snapRoot)
      .filter((n) => SNAPSHOT_ID.test(n))
      .sort()
      .reverse()
      .map(snapshotInfo)
      .filter(Boolean);
  }

  function pruneSnapshots() {
    for (const old of snapshots().slice(KEEP_SNAPSHOTS)) fs.rmSync(old.dir, { recursive: true, force: true });
  }
}

/** Copia i dati dal database della copia in quello vivo, in una sola transazione. */
export function transfer(db, stagedFile, mode) {
  db.exec('PRAGMA foreign_keys = OFF'); // l'ordine delle tabelle non conta: i collegamenti si controllano alla fine
  try {
    try {
      db.exec('DETACH DATABASE restore'); // un tentativo precedente finito male non deve bloccare questo
    } catch {
      /* non era collegato: normale */
    }
    db.prepare('ATTACH DATABASE ? AS restore').run(stagedFile);
    try {
      const before = db.prepare('PRAGMA main.foreign_key_check').all().length;
      db.exec('BEGIN IMMEDIATE');
      try {
        const copy = (table, { keepLive, merge } = {}) => {
          const theirs = new Set(columnsOf(db, 'restore', table));
          const cols = columnsOf(db, 'main', table).filter((c) => theirs.has(c) && !(merge && c === 'id'));
          const list = cols.map(q).join(', ');
          if (keepLive) db.exec(`DELETE FROM main.${q(table)} WHERE NOT (${keepLive})`);
          else if (!merge) db.exec(`DELETE FROM main.${q(table)}`);
          db.exec(`INSERT OR ${keepLive ? 'REPLACE' : merge ? 'IGNORE' : 'ABORT'} INTO main.${q(table)} (${list}) SELECT ${list} FROM restore.${q(table)}`);
        };
        if (mode === 'all') {
          const keep = KEEP_SETTINGS.map(sqlString).join(', ');
          for (const table of tablesOf(db).filter((t) => t !== 'settings')) copy(table);
          db.exec(`DELETE FROM main.settings WHERE key NOT IN (${keep})`);
          db.exec(`INSERT OR REPLACE INTO main.settings (key, value) SELECT key, value FROM restore.settings WHERE key NOT IN (${keep})`);
        } else {
          for (const step of CONTENT_PLAN) copy(step.table, step);
          const keys = CONTENT_SETTINGS.map(sqlString).join(', ');
          db.exec(`DELETE FROM main.settings WHERE key IN (${keys})`);
          db.exec(`INSERT INTO main.settings (key, value) SELECT key, value FROM restore.settings WHERE key IN (${keys})`);
        }
        if (db.prepare('PRAGMA main.foreign_key_check').all().length > before) throw new RestoreError('I dati della copia hanno dei collegamenti spezzati (per esempio prenotazioni di un partner che non c’è): non ho cambiato nulla.');
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* SQLite l'ha già annullata (disco pieno, errore di scrittura) */
        }
        throw err;
      }
    } finally {
      db.exec('DETACH DATABASE restore');
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON'); // qualunque cosa sia successa, i collegamenti tra le tabelle tornano controllati
  }
}
