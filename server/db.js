import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';


export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

const depths = new WeakMap(); // transazioni aperte, per database: dentro una transazione si usano i punti di salvataggio

/**
 * Esegue `fn` in una transazione (BEGIN IMMEDIATE: nessun altro scrittore nel frattempo).
 * Si può annidare: la transazione interna è un punto di salvataggio, e se `fn` fallisce si annulla solo quanto ha fatto lei
 * (serve per creare più prenotazioni tutte insieme: o ci sono tutte, o nessuna).
 */
export function tx(db, fn) {
  const depth = depths.get(db) ?? 0;
  if (depth > 0) {
    const name = `sp${depth}`;
    db.exec(`SAVEPOINT ${name}`);
    depths.set(db, depth + 1);
    try {
      const r = fn();
      db.exec(`RELEASE ${name}`);
      return r;
    } catch (e) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw e;
    } finally {
      depths.set(db, depth);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  depths.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depths.set(db, 0);
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}
