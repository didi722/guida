// Copia automatica fuori dal server: rotazione, cartella e servizio S3, esiti ed errori, avvisi, orari e tentativi.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NAME, retentionPlan } from '../server/autoBackup.js';
import { ROOT } from '../server/config.js';
import { getSetting, setSetting } from '../server/db.js';
import { todoList } from '../server/todo.js';
import { localToInstant } from '../server/time.js';
import { openZip } from '../server/zipread.js';
import { fakeS3 } from './fake-s3.js';
import { makeApp } from './helpers.js';

const tmp = path.join(ROOT, 'data', 'test-auto-backup-' + crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(tmp, { recursive: true });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const MON = localToInstant('2027-01-04', '10:00'); // lunedì 4 gennaio 2027, 10:00 a Venezia
const day = (n, time = '10:00') => localToInstant(`2027-01-${String(4 + n).padStart(2, '0')}`, time);
const NAME_OF = (date) => `guida-backup-${date}.zip`;
const sh = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Un sito di prova con la copia automatica verso una cartella e/o un finto S3. */
async function world({ dir = true, s3 = false, auto = {}, ...over } = {}) {
  const folder = path.join(tmp, 'dest-' + crypto.randomBytes(3).toString('hex'));
  const srv = s3 ? await fakeS3() : null;
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' }, backup: { dir: dir ? folder : '', s3: srv ? srv.config() : {}, auto: { enabled: true, hour: 3, keepDays: 14, keepMonths: 6, ...auto } }, ...over });
  const stored = () => (srv ? [...srv.objects.keys()].sort() : []);
  const files = () => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);
  return { app, srv, folder, stored, files, close: async () => { await srv?.close(); app.cleanup(); } };
}
const readZip = async (file) => {
  const zip = await openZip(file);
  const out = {};
  for (const e of zip.entries) out[e.name] = await zip.read(e, 1 << 30);
  await zip.close();
  return out;
};
const stateOf = (app) => getSetting(app.db, 'auto_backup');

// ───────────── la rotazione ─────────────
test('rotazione: le ultime N copie più la più vecchia di ogni mese, mai la più recente tolta', () => {
  const dates = ['2026-10-01', '2026-10-15', '2026-11-03', '2026-11-30', '2026-12-02', '2026-12-30', '2027-01-01', '2027-01-02', '2027-01-03'];
  assert.deepEqual(retentionPlan(dates, { keepDays: 2, keepMonths: 0 }), { keep: ['2027-01-02', '2027-01-03'], remove: ['2027-01-01', '2026-12-30', '2026-12-02', '2026-11-30', '2026-11-03', '2026-10-15', '2026-10-01'] });
  const withMonths = retentionPlan(dates, { keepDays: 2, keepMonths: 3 });
  assert.deepEqual(withMonths.keep, ['2026-11-03', '2026-12-02', '2027-01-01', '2027-01-02', '2027-01-03'], 'gennaio, dicembre e novembre: la più vecchia di ciascuno, più le ultime due');
  assert.deepEqual(withMonths.remove, ['2026-12-30', '2026-11-30', '2026-10-15', '2026-10-01']);
  assert.deepEqual(retentionPlan(dates, { keepDays: 100, keepMonths: 0 }).remove, [], 'con molte copie da tenere non si toglie nulla');
  assert.deepEqual(retentionPlan(['2027-01-03'], { keepDays: 0, keepMonths: 0 }), { keep: ['2027-01-03'], remove: [] }, 'anche con 0, l’ultima resta');
  assert.deepEqual(retentionPlan([], { keepDays: 3, keepMonths: 3 }), { keep: [], remove: [] });
  assert.deepEqual(retentionPlan(['2027-01-03', '2027-01-03', '2027-01-02'], { keepDays: 5, keepMonths: 0 }).keep, ['2027-01-02', '2027-01-03'], 'date doppie contate una volta');
  assert.ok(NAME.test('guida-backup-2027-01-04.zip'));
  for (const bad of ['guida-backup-2027-1-4.zip', 'guida-backup-2027-01-04.zip.partial', 'altro-2027-01-04.zip', '../guida-backup-2027-01-04.zip', 'guida-backup-2027-01-04.zipx']) assert.ok(!NAME.test(bad), bad);
});

// ───────────── la copia su una cartella ─────────────
test('cartella: la copia è uno zip completo come quello del pannello, senza segreti, e non lascia file temporanei', async () => {
  const w = await world();
  try {
    const { app } = w;
    app.adminSecurity.beginSetup(MON);
    const secret = app.adminSecurity.pendingSetup(MON).key;
    setSetting(app.db, 'prova_visibile', { valore: 'NELLA-COPIA' });
    const out = await app.autoBackup.run({ nowMs: MON });
    assert.equal(out.ok, true);
    assert.deepEqual(w.files(), [NAME_OF('2027-01-04')], 'solo la copia: niente .partial');
    assert.deepEqual(fs.readdirSync(app.cfg.dataDir).filter((n) => n.startsWith('.auto-backup')), [], 'il file temporaneo è stato tolto');
    const entries = await readZip(path.join(w.folder, NAME_OF('2027-01-04')));
    assert.ok(entries['LEGGIMI.txt'] && entries['guida.sqlite']);
    const dbFile = path.join(tmp, 'letto.sqlite');
    fs.writeFileSync(dbFile, entries['guida.sqlite']);
    const db = new DatabaseSync(dbFile);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'prova_visibile'`).get().n, 1, 'il database c’è');
    db.close();
    assert.ok(!entries['guida.sqlite'].includes(Buffer.from(secret)), 'la chiave dei due passaggi non è nella copia');
    const st = stateOf(app);
    assert.equal(st.running, null);
    assert.deepEqual({ date: st.lastOk.date, name: st.lastOk.name, dests: st.lastOk.dests, bytes: st.lastOk.bytes }, { date: '2027-01-04', name: NAME_OF('2027-01-04'), dests: ['dir'], bytes: fs.statSync(path.join(w.folder, NAME_OF('2027-01-04'))).size });
    assert.equal(st.lastError, null);
    assert.deepEqual(st.copies.dir.list.map((c) => c.name), [NAME_OF('2027-01-04')]);
    // lo stesso giorno, di nuovo: la stessa copia, riscritta
    assert.equal((await app.autoBackup.run({ nowMs: MON + 3600_000, trigger: 'manual' })).ok, true);
    assert.deepEqual(w.files(), [NAME_OF('2027-01-04')]);
  } finally {
    await w.close();
  }
});

test('cartella: le copie vecchie si tolgono secondo la rotazione e quello che non è una copia non si tocca', async () => {
  const w = await world({ auto: { keepDays: 2, keepMonths: 2 } });
  try {
    fs.mkdirSync(w.folder, { recursive: true });
    for (const d of ['2026-11-02', '2026-11-20', '2026-12-05', '2026-12-20', '2027-01-01', '2027-01-02', '2027-01-03']) fs.writeFileSync(path.join(w.folder, NAME_OF(d)), d);
    for (const other of ['note.txt', 'guida-backup-2027-01-01.zip.partial', 'guida-backup-vecchio.zip', 'foto.jpg']) fs.writeFileSync(path.join(w.folder, other), 'non mio');
    assert.equal((await w.app.autoBackup.run({ nowMs: MON })).ok, true);
    assert.deepEqual(w.files(), ['foto.jpg', NAME_OF('2026-12-05'), NAME_OF('2027-01-01'), NAME_OF('2027-01-03'), NAME_OF('2027-01-04'), 'guida-backup-2027-01-01.zip.partial', 'guida-backup-vecchio.zip', 'note.txt'].sort(), 'ultime due (3 e 4 gennaio) + la più vecchia di gennaio e dicembre; il resto fuori');
    assert.equal(stateOf(w.app).lastOk.warnings.length, 0);
  } finally {
    await w.close();
  }
});

test('cartella: se non si può scrivere la copia non riesce, con un messaggio chiaro, e il resto non si rompe', async () => {
  const w = await world();
  try {
    fs.writeFileSync(w.folder, 'sono un file, non una cartella');
    const out = await w.app.autoBackup.run({ nowMs: MON });
    assert.equal(out.ok, false);
    const st = stateOf(w.app);
    assert.match(st.lastError.message, /Cartella/);
    assert.equal(st.lastOk, null);
    assert.equal(st.running, null, 'la copia non resta «in corso»');
    assert.deepEqual(fs.readdirSync(w.app.cfg.dataDir).filter((n) => n.startsWith('.auto-backup')), []);
  } finally {
    await w.close();
  }
});

// ───────────── la copia su S3 ─────────────
test('S3: lo zip arriva intero dentro la cartella del bucket, la rotazione toglie solo le copie vecchie sue', async () => {
  const w = await world({ dir: false, s3: true, auto: { keepDays: 2, keepMonths: 0 } });
  try {
    const { app, srv } = w;
    for (const d of ['2026-12-30', '2027-01-01', '2027-01-03']) srv.objects.set(`guida/${NAME_OF(d)}`, { body: Buffer.from(d), modified: new Date(`${d}T03:00:00Z`) });
    srv.objects.set('altra/guida-backup-2020-01-01.zip', { body: Buffer.from('x'), modified: new Date() });
    srv.objects.set('guida/note.txt', { body: Buffer.from('mia'), modified: new Date() });
    const out = await app.autoBackup.run({ nowMs: MON });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(w.stored(), ['altra/guida-backup-2020-01-01.zip', 'guida/guida-backup-2027-01-03.zip', 'guida/guida-backup-2027-01-04.zip', 'guida/note.txt']);
    const body = srv.objects.get('guida/guida-backup-2027-01-04.zip').body;
    const file = path.join(tmp, 'da-s3.zip');
    fs.writeFileSync(file, body);
    const entries = await readZip(file);
    assert.ok(entries['LEGGIMI.txt'] && entries['guida.sqlite']);
    const st = stateOf(app);
    assert.equal(st.lastOk.bytes, body.length);
    assert.deepEqual(st.lastOk.dests, ['s3']);
    assert.deepEqual(st.copies.s3.list.map((c) => c.name), [NAME_OF('2027-01-03'), NAME_OF('2027-01-04')]);
    assert.ok(srv.log.every((l) => l.status < 400), 'tutte le richieste firmate bene');
    // nessun segreto nello stato salvato
    const raw = JSON.stringify(st);
    for (const secret of [srv.secretKey, srv.accessKey]) assert.ok(!raw.includes(secret));
  } finally {
    await w.close();
  }
});

test('due destinazioni: se una fallisce l’altra ha comunque la copia, e l’errore dice quale (senza le chiavi)', async () => {
  const w = await world({ dir: true, s3: true });
  try {
    const { app, srv } = w;
    srv.hooks.fail = (method) => (method === 'PUT' ? { status: 403, code: 'AccessDenied' } : null);
    const out = await app.autoBackup.run({ nowMs: MON, trigger: 'manual' });
    assert.equal(out.ok, false);
    assert.deepEqual(w.files(), [NAME_OF('2027-01-04')], 'la cartella ha la copia');
    assert.deepEqual(w.stored(), []);
    const st = stateOf(app);
    assert.match(st.lastError.message, /Servizio S3 \(127\.0\.0\.1:\d+ · bucket bucket-prova · cartella guida\/\): Accesso negato: la chiave non può scrivere in questo bucket/);
    assert.ok(!st.lastError.message.includes(srv.secretKey) && !st.lastError.message.includes(srv.accessKey));
    assert.equal(st.lastOk, null, 'non è «riuscita» finché una destinazione manca');
    // appena il servizio torna a funzionare, la prossima va a buon fine e l'errore sparisce
    srv.hooks.fail = null;
    assert.equal((await app.autoBackup.run({ nowMs: MON + 3600_000, trigger: 'manual' })).ok, true);
    assert.equal(stateOf(app).lastError, null);
    assert.deepEqual(w.stored(), [`guida/${NAME_OF('2027-01-04')}`]);
  } finally {
    await w.close();
  }
});

test('S3: un file caricato che sul servizio risulta di un’altra dimensione non vale come copia', async () => {
  const w = await world({ dir: false, s3: true });
  try {
    const { app, srv } = w;
    const real = srv.objects.set.bind(srv.objects);
    srv.objects.set = (key, v) => real(key, { ...v, body: v.body.subarray(0, v.body.length - 1) }); // il servizio «perde» un byte
    const out = await app.autoBackup.run({ nowMs: MON });
    assert.equal(out.ok, false);
    assert.match(stateOf(app).lastError.message, /dimensione diversa/);
  } finally {
    await w.close();
  }
});

// ───────────── gli avvisi ─────────────
test('avviso per email: una volta quando le copie notturne smettono di riuscire, poi ogni tre giorni; mai per le prove a mano', async () => {
  const w = await world({ dir: false, s3: true });
  try {
    const { app, srv } = w;
    srv.hooks.fail = () => ({ status: 403, code: 'AccessDenied' });
    const mails = () => app.mail.sent.filter((m) => /Copia automatica non riuscita/.test(m.subject));
    await app.autoBackup.run({ nowMs: day(0), trigger: 'manual' });
    assert.equal(mails().length, 0, 'una prova a mano la vedi già sullo schermo');
    await app.autoBackup.run({ nowMs: day(0, '11:00') });
    assert.equal(mails().length, 1);
    assert.equal(mails()[0].to, 'guida@example.com');
    assert.match(mails()[0].text, /non è riuscita/);
    assert.match(mails()[0].text, /Accesso negato/);
    assert.match(mails()[0].text, /\/admin\/backup/);
    assert.ok(!mails()[0].text.includes(srv.secretKey));
    await app.autoBackup.run({ nowMs: day(1) });
    await app.autoBackup.run({ nowMs: day(2) });
    assert.equal(mails().length, 1, 'finché dura il guasto non si ripete ogni giorno');
    await app.autoBackup.run({ nowMs: day(3, '12:00') });
    assert.equal(mails().length, 2, 'dopo tre giorni un promemoria');
    // un successo azzera: se si rompe di nuovo, si avvisa subito
    srv.hooks.fail = null;
    assert.equal((await app.autoBackup.run({ nowMs: day(4) })).ok, true);
    srv.hooks.fail = () => ({ status: 403, code: 'AccessDenied' });
    await app.autoBackup.run({ nowMs: day(5) });
    assert.equal(mails().length, 3);
  } finally {
    await w.close();
  }
});

test('«Da fare»: compare se l’ultima copia non è riuscita o se sono tre giorni che non ne parte una; sparisce quando torna a funzionare', async () => {
  const w = await world({ dir: false, s3: true });
  try {
    const { app, srv } = w;
    const items = (nowMs) => todoList(app, nowMs).sections.flatMap((s) => s.items).filter((i) => /copia automatica/i.test(i.text));
    assert.deepEqual(items(day(0)), [], 'niente da dire finché non è successo nulla');
    srv.hooks.fail = () => ({ status: 403, code: 'AccessDenied' });
    await app.autoBackup.run({ nowMs: day(0) });
    const [bad] = items(day(0));
    assert.equal(bad.tone, 'err');
    assert.equal(bad.href, '/admin/backup');
    assert.match(bad.meta, /Accesso negato/);
    srv.hooks.fail = null;
    await app.autoBackup.run({ nowMs: day(1) });
    assert.deepEqual(items(day(1)), []);
    assert.deepEqual(items(day(3, '10:00')), [], 'due giorni senza copie: ancora ok');
    const [late] = items(day(4, '10:00'));
    assert.equal(late.tone, 'warn');
    assert.match(late.text, /Nessuna copia automatica da 3 giorni/);
    // spenta: niente richiami
    app.cfg.backup.auto.enabled = false;
    assert.deepEqual(items(day(4, '10:00')), []);
  } finally {
    await w.close();
  }
});

// ───────────── quando parte ─────────────
test('orari: dall’ora scelta in poi, una volta al giorno; dopo un errore si riprova ogni mezz’ora, al massimo quattro volte', async () => {
  const w = await world({ auto: { hour: 3 } });
  try {
    const { app } = w;
    const due = (nowMs) => app.autoBackup.due(nowMs);
    assert.equal(due(day(0, '02:59')), false, 'prima dell’ora');
    assert.equal(due(day(0, '03:00')), true);
    assert.equal(due(day(0, '15:00')), true, 'se il server era spento alle 3, parte appena può');
    assert.equal((await app.autoBackup.run({ nowMs: day(0, '03:00') })).ok, true);
    assert.equal(due(day(0, '03:01')), false, 'già fatta oggi');
    assert.equal(due(day(0, '23:59')), false);
    assert.equal(due(day(1, '02:59')), false);
    assert.equal(due(day(1, '03:00')), true, 'domani di nuovo');
    // errori: la cartella è un file
    fs.rmSync(w.folder, { recursive: true, force: true });
    fs.writeFileSync(w.folder, 'file');
    assert.equal((await app.autoBackup.run({ nowMs: day(1, '03:00') })).ok, false);
    assert.equal(due(day(1, '03:10')), false, 'si aspetta mezz’ora');
    assert.equal(due(day(1, '03:30')), true);
    assert.equal((await app.autoBackup.run({ nowMs: day(1, '03:30') })).ok, false);
    assert.equal((await app.autoBackup.run({ nowMs: day(1, '04:00') })).ok, false);
    assert.equal(due(day(1, '04:30')), true, 'quarto tentativo');
    assert.equal((await app.autoBackup.run({ nowMs: day(1, '04:30') })).ok, false);
    assert.equal(due(day(1, '09:00')), false, 'quattro tentativi al giorno bastano');
    assert.equal(due(day(2, '03:00')), true, 'domani si riprova');
    // spenta o senza destinazione: mai
    app.cfg.backup.auto.enabled = false;
    assert.equal(due(day(2, '03:00')), false);
    app.cfg.backup.auto.enabled = true;
    app.cfg.backup.dir = '';
    assert.equal(due(day(2, '03:00')), false);
    assert.deepEqual(await app.autoBackup.run({ nowMs: day(2) }), { ok: false, none: true });
    assert.deepEqual(app.autoBackup.start(), { none: true });
  } finally {
    await w.close();
  }
});

test('lavoro periodico: il giro di ogni minuto fa la copia una volta, all’ora giusta', async () => {
  const w = await world({ auto: { hour: 3 } });
  try {
    const { app } = w;
    await app.runJobs(day(0, '02:30'));
    assert.deepEqual(w.files(), []);
    await app.runJobs(day(0, '03:00'));
    assert.deepEqual(w.files(), [NAME_OF('2027-01-04')]);
    const before = fs.statSync(path.join(w.folder, NAME_OF('2027-01-04'))).mtimeMs;
    await app.runJobs(day(0, '03:01'));
    await app.runJobs(day(0, '12:00'));
    assert.equal(fs.statSync(path.join(w.folder, NAME_OF('2027-01-04'))).mtimeMs, before, 'non la rifà');
    await app.runJobs(day(1, '03:00'));
    assert.deepEqual(w.files(), [NAME_OF('2027-01-04'), NAME_OF('2027-01-05')]);
  } finally {
    await w.close();
  }
});

test('una copia alla volta; una «in corso» rimasta a metà dopo un riavvio non blocca per sempre', async () => {
  const w = await world();
  try {
    const { app } = w;
    const first = app.autoBackup.run({ nowMs: MON });
    assert.equal(app.autoBackup.running(MON), true);
    assert.deepEqual(await app.autoBackup.run({ nowMs: MON }), { ok: false, busy: true });
    assert.deepEqual(app.autoBackup.start(), { busy: true });
    assert.equal(app.autoBackup.due(day(5)), false, 'né parte da sola mentre un’altra è in corso');
    assert.equal((await first).ok, true);
    assert.equal(app.autoBackup.running(MON), false);
    // il server si è fermato a metà di una copia: lo stato dice «in corso», ma da ore
    setSetting(app.db, 'auto_backup', { ...stateOf(app), running: { at: new Date(MON - 4 * 3600_000).toISOString(), trigger: 'auto' } });
    assert.equal(app.autoBackup.running(MON), false, 'dopo qualche ora non conta più');
    assert.equal((await app.autoBackup.run({ nowMs: MON + 1000 })).ok, true);
    setSetting(app.db, 'auto_backup', { ...stateOf(app), running: { at: new Date(MON - 60_000).toISOString(), trigger: 'auto' } });
    assert.equal(app.autoBackup.running(MON), true, 'ma una di un minuto fa sì');
  } finally {
    await w.close();
  }
});

// ───────────── prove e elenco ─────────────
test('prova della connessione: dice cosa funziona e cosa no, per ogni destinazione, senza fare la copia', async () => {
  const w = await world({ dir: true, s3: true });
  try {
    const { app, srv } = w;
    const ok = await app.autoBackup.test(MON);
    assert.deepEqual(ok.map((r) => [r.id, r.ok]), [['dir', true], ['s3', true]]);
    assert.deepEqual(w.files(), [], 'nessuna copia, nessun file di prova rimasto');
    assert.deepEqual(w.stored(), []);
    srv.hooks.fail = () => ({ status: 403, code: 'SignatureDoesNotMatch' });
    const bad = await app.autoBackup.test(MON + 1000);
    assert.equal(bad.find((r) => r.id === 's3').ok, false);
    assert.match(bad.find((r) => r.id === 's3').error, /chiave segreta non corrisponde/);
    assert.equal(bad.find((r) => r.id === 'dir').ok, true);
    assert.deepEqual(stateOf(app).lastTest.results.map((r) => r.ok), [true, false], 'l’esito resta per la pagina');
    assert.equal(stateOf(app).lastTest.at, new Date(MON + 1000).toISOString());
  } finally {
    await w.close();
  }
});

test('elenco delle copie e indirizzi per scaricarle: solo nomi di copie automatiche, da destinazioni che esistono', async () => {
  const w = await world({ dir: true, s3: true });
  try {
    const { app, srv } = w;
    assert.equal((await app.autoBackup.run({ nowMs: MON })).ok, true);
    const refreshed = await app.autoBackup.refreshCopies(MON + 5000);
    assert.deepEqual(refreshed.errors, {});
    assert.deepEqual(refreshed.copies.dir.list.map((c) => c.name), [NAME_OF('2027-01-04')]);
    assert.deepEqual(refreshed.copies.s3.list.map((c) => c.name), [NAME_OF('2027-01-04')]);
    const file = app.autoBackup.link('dir', NAME_OF('2027-01-04'));
    assert.equal(file.file, path.join(w.folder, NAME_OF('2027-01-04')));
    const url = app.autoBackup.link('s3', NAME_OF('2027-01-04')).url;
    assert.equal((await fetch(url)).status, 200);
    // quello che non è una copia, o non esiste, non si scarica
    for (const bad of ['../etc/passwd', 'note.txt', 'guida-backup-2027-01-04.zip/../x', '', NAME_OF('2027-01-04') + '.partial', undefined]) {
      assert.equal(app.autoBackup.link('dir', bad), null, String(bad));
      assert.equal(app.autoBackup.link('s3', bad), null, String(bad));
    }
    assert.equal(app.autoBackup.link('dir', NAME_OF('2020-01-01')), null, 'una copia che non c’è');
    assert.equal(app.autoBackup.link('ftp', NAME_OF('2027-01-04')), null, 'una destinazione che non c’è');
    // il servizio non risponde: l'errore si vede, l'elenco di prima resta
    srv.hooks.fail = () => ({ status: 500, code: 'InternalError' });
    const down = await app.autoBackup.refreshCopies(MON + 9000);
    assert.match(down.errors.s3, /problema \(500\)/);
    assert.ok(stateOf(app).copies.s3.list.length === 1 && stateOf(app).copiesError.s3);
    srv.hooks.fail = null;
    await app.autoBackup.refreshCopies(MON + 10_000);
    assert.deepEqual(stateOf(app).copiesError, {});
  } finally {
    await w.close();
  }
});

test('stato per la pagina: quando e come, prossima copia, destinazioni senza chiavi', async () => {
  const w = await world({ dir: true, s3: true, auto: { hour: 3, keepDays: 10, keepMonths: 4 } });
  try {
    const { app, srv } = w;
    const before = app.autoBackup.status(day(0, '01:00'));
    assert.equal(before.configured, true);
    assert.deepEqual(before.next, { date: '2027-01-04', hour: 3, soon: false });
    assert.deepEqual(app.autoBackup.status(day(0, '05:00')).next, { date: '2027-01-04', hour: 3, soon: true }, 'l’ora è passata e manca la copia: a momenti');
    assert.deepEqual(before.destinations.map((d) => [d.id, d.label]), [['dir', 'Cartella'], ['s3', 'Servizio S3']]);
    assert.match(before.destinations[1].where, /^127\.0\.0\.1:\d+ · bucket bucket-prova · cartella guida\/$/);
    assert.ok(!JSON.stringify(before).includes(srv.secretKey) && !JSON.stringify(before).includes(srv.accessKey));
    assert.equal(before.lastOk, null);
    await app.autoBackup.run({ nowMs: day(0, '03:00') });
    const after = app.autoBackup.status(day(0, '09:00'));
    assert.deepEqual(after.next, { date: '2027-01-05', hour: 3, soon: false });
    assert.equal(after.lastOk.date, '2027-01-04');
    assert.deepEqual([after.keepDays, after.keepMonths, after.hour, after.enabled], [10, 4, 3, true]);
    app.cfg.backup.auto.enabled = false;
    assert.equal(app.autoBackup.status(day(0, '09:00')).next, null);
    const none = makeApp({});
    assert.deepEqual([none.autoBackup.status().configured, none.autoBackup.destinations()], [false, []]);
    none.cleanup();
  } finally {
    await w.close();
  }
});
