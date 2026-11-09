// Impostazioni che restano sul server: non finiscono in una copia scaricata e un ripristino non le tocca.
// Oggi sono la sicurezza del pannello (chiave dell'accesso a due passaggi, codici di emergenza, sessioni) e la chiave del collegamento alla demo per le
// agenzie: chi trova uno zip dimenticato non deve ricavarne nulla per entrare, e ripristinare una copia vecchia non deve spegnere la protezione.
import { DatabaseSync } from 'node:sqlite';

export const PRIVATE_SETTINGS = ['admin_security', 'demo_key'];

/** Toglie le impostazioni riservate da una copia del database (un file) e le cancella davvero dal file, non solo dall'indice. */
export function scrubPrivateSettings(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA secure_delete = ON');
    db.prepare(`DELETE FROM settings WHERE key IN (${PRIVATE_SETTINGS.map(() => '?').join(', ')})`).run(...PRIVATE_SETTINGS);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}
