import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, migrate } from '../server/migrations.js';

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const tables = (db) => db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name);

test('un database appena creato arriva all’ultima versione e ripetere la migrazione non cambia nulla', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.equal(version(db), MIGRATIONS.length);
  const before = tables(db);
  migrate(db);
  assert.equal(version(db), MIGRATIONS.length);
  assert.deepEqual(tables(db), before);
  for (const t of ['bookings', 'accounts', 'promo_codes', 'gift_cards', 'feedback', 'calendar_sources', 'programs', 'invoices', 'invoice_lines']) assert.ok(before.includes(t), `manca la tabella ${t}`);
});

test('un database di una versione precedente si aggiorna senza perdere i dati', () => {
  const db = new DatabaseSync(':memory:');
  // come l'avrebbe lasciato la versione con i programmi (v5)
  for (let i = 0; i < 5; i++) {
    db.exec(MIGRATIONS[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
  }
  assert.equal(version(db), 5);
  db.prepare(`INSERT INTO accounts(email, password_hash, company, contact_name, created_at) VALUES('dmc@example.com', 'x', 'Test DMC', 'Anna', '2026-01-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO programs(ref, token, name, email, participants, created_at, updated_at) VALUES('PR-AAAAAA', 't', 'Giulia', 'g@example.com', 4, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).run();
  assert.ok(!tables(db).includes('invoices'));

  migrate(db);
  assert.equal(version(db), MIGRATIONS.length);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts').get().n, 1, 'i partner restano');
  assert.equal(db.prepare('SELECT ref FROM programs').get().ref, 'PR-AAAAAA', 'i programmi restano');
  assert.equal(db.prepare('SELECT billing_json FROM accounts').get().billing_json, null, 'nuova colonna sui partner');
  assert.ok(tables(db).includes('invoices'));

  // un indice univoco impedisce che la stessa voce finisca in due fatture non stornate
  db.prepare(`INSERT INTO invoices(buyer_json, created_at, updated_at) VALUES('{}', 'x', 'x')`).run();
  db.prepare(`INSERT INTO invoices(buyer_json, created_at, updated_at) VALUES('{}', 'x', 'x')`).run();
  const line = db.prepare(`INSERT INTO invoice_lines(invoice_id, position, description, amount_cents, source_type, source_id) VALUES(?, 0, 'x', 100, 'booking', 7)`);
  line.run(1);
  assert.throws(() => line.run(2), /UNIQUE/);
  db.prepare('UPDATE invoice_lines SET released = 1 WHERE invoice_id = 1').run();
  assert.doesNotThrow(() => line.run(2), 'una voce stornata torna fatturabile');
  // la numerazione è unica per anno
  db.prepare(`UPDATE invoices SET year = 2027, seq = 1 WHERE id = 1`).run();
  assert.throws(() => db.prepare(`UPDATE invoices SET year = 2027, seq = 1 WHERE id = 2`).run(), /UNIQUE/);
});

test('una migrazione che fallisce non lascia il database a metà', () => {
  const db = new DatabaseSync(':memory:');
  for (let i = 0; i < 5; i++) {
    db.exec(MIGRATIONS[i]);
    db.exec(`PRAGMA user_version = ${i + 1}`);
  }
  db.exec('CREATE TABLE invoices (id INTEGER)'); // ostacolo: la v6 non può creare la tabella
  assert.throws(() => migrate(db), /Migrazione 6 fallita/);
  assert.equal(version(db), 5);
  assert.ok(!tables(db).includes('invoice_lines'), 'nessuna tabella creata a metà');
  const cols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  assert.ok(!cols.includes('billing_json'));
});
