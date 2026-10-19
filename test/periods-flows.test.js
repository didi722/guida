// I periodi dentro i percorsi veri: spostare la data di un'opzione, pacchetti, richieste dell'agenzia e modifiche dal pannello.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createBooking, getBooking } from '../server/bookings.js';
import { ChangeError, evaluateChange, modifyBooking } from '../server/changes.js';
import { evaluateAdminChange, modifyBookingAdmin } from '../server/adminChanges.js';
import { createConfig, ROOT } from '../server/config.js';
import { createContentStore } from '../server/contentStore.js';
import { createContext } from '../server/context.js';
import { openDb } from '../server/db.js';
import { PackageError, cartAdd, cartSummary, createPackage, resolveLine } from '../server/packages.js';
import { addAccount, NOW } from './helpers.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const SHARED = 'cannaregio-ghetto-agenzie'; // visita condivisa: 10:00 e 15:00

function setup() {
  const dir = path.join(ROOT, 'data', 'test-periods-flows-' + crypto.randomBytes(3).toString('hex'));
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const db = openDb(':memory:');
  const app = createContext({ cfg, db, content: createContentStore({ db, root: ROOT }) });
  const acct = addAccount(db, { email: 'dmc@example.com', lang: 'it' });
  // Carnevale: opzioni di al massimo 2 giorni; maggio: niente opzioni
  app.periods.save({ name: 'Carnevale', from: '2027-04-01', to: '2027-04-30', mode: 'short', maxDays: '2' }, null, NOW);
  app.periods.save({ name: 'Giugno', from: '2027-06-01', to: '2027-06-30', mode: 'off' }, null, NOW);
  return { app, acct, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const book = (app, acct, over = {}) =>
  createBooking(app, { tourSlug: SHARED, date: '2027-03-10', time: '10:00', pax: 4, channel: 'b2b', account: acct, name: 'Anna', email: acct.email, lang: 'it', clientRef: 'Gruppo Rossi', paymentMethod: 'invoice', ...over }, NOW);
const option = (app, acct, over = {}) => book(app, acct, { option: true, paymentMethod: undefined, ...over });
const caught = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

test('spostare la data di un’opzione: dentro un periodo con opzioni brevi la scadenza si accorcia, in uno senza opzioni non si può (e lo dice)', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const o = option(app, acct, { date: '2027-03-10' }); // 65 giorni: 14 giorni di opzione
  assert.equal(Date.parse(o.option_expires_at), NOW + 14 * DAY);
  const preview = evaluateChange(app, o, { date: '2027-04-10', time: '10:00' }, NOW);
  assert.equal(preview.ok, true);
  assert.equal(preview.expiresMs, NOW + 2 * DAY, 'in anteprima si vede già la scadenza accorciata');
  const moved = modifyBooking(app, o.id, { date: '2027-04-10', time: '10:00' }, {}, NOW);
  assert.equal(Date.parse(moved.after.option_expires_at), NOW + 2 * DAY);
  assert.equal(moved.after.status, 'option');
  // verso una data senza opzioni: l'errore porta il motivo «period»
  const blocked = evaluateChange(app, getBooking(app.db, o.id), { date: '2027-06-10', time: '10:00' }, NOW);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'option');
  assert.equal(blocked.reason, 'period');
  const err = caught(() => modifyBooking(app, o.id, { date: '2027-06-10', time: '10:00' }, {}, NOW));
  assert.ok(err instanceof ChangeError);
  assert.deepEqual([err.code, err.reason], ['option', 'period']);
  assert.equal(getBooking(app.db, o.id).date, '2027-04-10', 'nulla è cambiato');
});

test('pacchetto con opzione: una scadenza sola, la più corta; un servizio in un periodo senza opzioni blocca l’opzione ma non la prenotazione diretta', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const lines = (...dates) => dates.map((d) => resolveLine(app, { tour: SHARED, date: d, time: '10:00', pax: '3' }));
  const pkg = createPackage(app, acct, lines('2027-03-12', '2027-04-14'), { name: 'Anna', email: acct.email, lang: 'it', option: true }, NOW);
  assert.equal(new Set(pkg.bookings.map((b) => b.option_expires_at)).size, 1);
  assert.equal(Date.parse(pkg.bookings[0].option_expires_at), NOW + 2 * DAY, 'la riga di aprile limita tutto il pacchetto a 2 giorni');
  const bad = caught(() => createPackage(app, acct, lines('2027-03-20', '2027-06-14'), { name: 'Anna', email: acct.email, lang: 'it', option: true }, NOW));
  assert.ok(bad instanceof PackageError);
  assert.deepEqual([bad.code, bad.message], ['option', 'period']);
  // lo stesso pacchetto, prenotato direttamente (a fattura): va
  const direct = createPackage(app, acct, lines('2027-03-22', '2027-06-16'), { name: 'Anna', email: acct.email, lang: 'it', paymentMethod: 'invoice' }, NOW);
  assert.equal(direct.bookings.length, 2);
  assert.ok(direct.bookings.every((b) => b.status === 'confirmed'));
});

test('carrello del pacchetto: la proposta di opzione cambia con le date aggiunte', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const add = (date) => cartAdd(app, acct, { tour: SHARED, date, time: '10:00', pax: '3' }, NOW);
  add('2027-03-12');
  const before = cartSummary(app, acct, NOW);
  assert.equal(before.option.ok, true);
  assert.equal(before.option.period, null, 'una data fuori dai periodi: opzione come sempre');
  assert.equal(before.option.days, 14);
  add('2027-04-14');
  const withShort = cartSummary(app, acct, NOW);
  assert.equal(withShort.option.ok, true);
  assert.equal(withShort.option.days, 2);
  assert.deepEqual(withShort.option.period, { id: 1, name: 'Carnevale', mode: 'short' });
  add('2027-06-14');
  const withOff = cartSummary(app, acct, NOW);
  assert.deepEqual([withOff.option.ok, withOff.option.reason], [false, 'period']);
});

test('modifica dal pannello: la guida non porta un’opzione dentro un periodo senza opzioni, e il messaggio è quello del periodo', (t) => {
  const { app, acct, cleanup } = setup();
  t.after(cleanup);
  const o = option(app, acct, { date: '2027-03-10' });
  const preview = evaluateAdminChange(app, getBooking(app.db, o.id), { date: '2027-06-10', time: '10:00' }, NOW);
  assert.deepEqual([preview.ok, preview.error, preview.reason], [false, 'option', 'period']);
  const err = caught(() => modifyBookingAdmin(app, o.id, { date: '2027-06-10', time: '10:00' }, {}, NOW));
  assert.deepEqual([err.code, err.reason], ['option', 'period']);
  const ok = modifyBookingAdmin(app, o.id, { date: '2027-04-10', time: '10:00' }, {}, NOW);
  assert.equal(Date.parse(ok.after.option_expires_at), NOW + 2 * DAY);
});
