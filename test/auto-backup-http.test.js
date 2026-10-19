// Aiuto › Backup: la copia giornaliera fuori dal server nel pannello (stato, prove, copia a mano, elenco, scarico) e le sue impostazioni.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { getSetting, openDb, setSetting } from '../server/db.js';
import { nowRome } from '../server/time.js';
import { fakeS3 } from './fake-s3.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-auto-backup-http-' + crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(tmp, { recursive: true });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PW = 'segreto-admin';
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = (res) => res.text();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => nowRome(Date.now()).date;
const TODAY_NAME = () => `guida-backup-${today()}.zip`;

async function start({ dir = true, s3 = false, auto = {} } = {}) {
  const folder = path.join(tmp, 'dest-' + crypto.randomBytes(3).toString('hex'));
  const srv = s3 ? await fakeS3() : null;
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: PW, baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' }, backup: { dir: dir ? folder : '', s3: srv ? srv.config() : {}, auto: { enabled: true, hour: 3, keepDays: 14, keepMonths: 6, ...auto } } });
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
  assert.equal((await admin('/admin/login', form({ password: PW }))).status, 303);
  return { app, srv, folder, admin, anon: jar(), close: async () => { await srv?.close(); app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const finished = async (admin) => {
  for (let i = 0; i < 100; i++) {
    if (!(await (await admin('/admin/backup/auto/status')).json()).running) return;
    await sleep(50);
  }
  throw new Error('la copia non finisce');
};

test('senza destinazione: la pagina spiega come impostarla e nulla si può avviare', async () => {
  const s = await start({ dir: false });
  try {
    const { admin, anon } = s;
    assert.equal(loc(await anon('/admin/backup/auto/status')), '/admin/login');
    assert.equal(loc(await anon('/admin/backup/auto/run', form())), '/admin/login');
    const page = await text(await admin('/admin/backup'));
    assert.match(page, /Copia giornaliera fuori dal server <span class="chip chip-warn">Da configurare<\/span>/);
    for (const v of ['BACKUP_DIR', 'BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_REGION', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY', 'BACKUP_S3_PREFIX', 'BACKUP_S3_PATH_STYLE']) assert.ok(page.includes(`<code>${v}</code>`), v);
    assert.match(page, /<details class="auto-how" open>/, 'le istruzioni sono aperte');
    assert.match(page, /bucket \(<strong>privato<\/strong>\)|<strong>non pubblico<\/strong>/);
    assert.doesNotMatch(page, /<button[^>]*>(Esegui una copia adesso|Prova la connessione)/, 'senza destinazione non ci sono pulsanti da premere');
    assert.match(page, /Scarica la copia completa \(\.zip\)/, 'la copia a mano resta');
    for (const p of ['/admin/backup/auto/run', '/admin/backup/auto/test']) {
      const res = await admin(p, form());
      assert.equal(loc(res), '/admin/backup?err=auto-none#copia-automatica', p);
    }
    assert.match(await text(await admin('/admin/backup?err=auto-none')), /nessuna destinazione per la copia automatica/);
    assert.equal((await (await admin('/admin/backup/auto/status')).json()).running, false);
    assert.equal(loc(await admin('/admin/backup/auto/download?dest=dir&name=guida-backup-2027-01-04.zip')), '/admin/backup?err=auto-gone');
  } finally {
    await s.close();
  }
});

test('con una cartella e un servizio S3: copia a mano dal pannello, esito, elenco e download', async () => {
  const s = await start({ dir: true, s3: true });
  try {
    const { app, srv, admin, folder } = s;
    let page = await text(await admin('/admin/backup'));
    assert.match(page, /<span class="chip chip-ok">Attiva<\/span>/);
    assert.match(page, new RegExp(`Cartella <code>${folder.replace(/[/\\.]/g, '\\$&')}</code>`));
    assert.match(page, /Servizio S3 <code>127\.0\.0\.1:\d+ · bucket bucket-prova · cartella guida\/<\/code>/);
    assert.match(page, /ogni giorno alle <strong>03:00<\/strong> \(ora di Venezia\)/);
    assert.match(page, /le ultime 14 e la più vecchia di ognuno degli ultimi 6 mesi/);
    assert.match(page, /href="\/admin\/settings\?s=backup#backup">Cambia orario e quante copie tenere/);
    assert.match(page, /Esegui una copia adesso/);
    assert.match(page, /Prova la connessione/);
    assert.match(page, /<span class="muted">ancora nessuna<\/span>/);
    assert.match(page, /Nessuna copia nell’elenco/);
    assert.doesNotMatch(page, /<details class="auto-how" open>/, 'con la destinazione impostata le istruzioni restano chiuse');
    for (const secret of [srv.secretKey, srv.accessKey]) assert.ok(!page.includes(secret), 'nessuna chiave nella pagina');

    // parte in secondo piano e la pagina mostra l'esito
    const go = await admin('/admin/backup/auto/run', form());
    assert.equal(go.status, 303);
    assert.equal(loc(go), '/admin/backup?ok=auto-started#copia-automatica');
    await finished(admin);
    page = await text(await admin('/admin/backup?ok=auto-started'));
    assert.match(page, /Ho avviato la copia: può durare qualche minuto/);
    assert.match(page, /<strong>Ultima copia riuscita<\/strong>: [^<]*\d[^<]* · [\d,.]+ (KB|MB) · \d+ s/);
    assert.doesNotMatch(page, /L’ultima copia non è riuscita/);
    assert.doesNotMatch(page, /data-auto-running/);
    assert.match(page, new RegExp(`href="/admin/backup/auto/download\\?dest=dir&amp;name=${TODAY_NAME()}">Scarica`));
    assert.match(page, new RegExp(`href="/admin/backup/auto/download\\?dest=s3&amp;name=${TODAY_NAME()}">Scarica`));
    assert.ok(fs.existsSync(path.join(folder, TODAY_NAME())));
    assert.ok(srv.objects.has(`guida/${TODAY_NAME()}`));
    for (const secret of [srv.secretKey, srv.accessKey]) assert.ok(!page.includes(secret));

    // scarico dalla cartella: il file stesso, come allegato
    const fromDir = await admin(`/admin/backup/auto/download?dest=dir&name=${TODAY_NAME()}`);
    assert.equal(fromDir.status, 200);
    assert.match(fromDir.headers.get('content-disposition'), new RegExp(`^attachment; filename="?${TODAY_NAME()}"?$`));
    assert.equal(fromDir.headers.get('cache-control'), 'private, no-store');
    const bytes = Buffer.from(await fromDir.arrayBuffer());
    assert.ok(bytes.equals(fs.readFileSync(path.join(folder, TODAY_NAME()))));
    assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'è uno zip');
    // scarico dal servizio: un indirizzo temporaneo firmato, che funziona e porta lo stesso file
    const fromS3 = await admin(`/admin/backup/auto/download?dest=s3&name=${TODAY_NAME()}`);
    assert.equal(fromS3.status, 303);
    const url = new URL(loc(fromS3));
    assert.equal(url.host, new URL(srv.endpoint).host);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.match(url.searchParams.get('response-content-disposition'), /^attachment; filename="guida-backup-/);
    const got = await fetch(loc(fromS3));
    assert.equal(got.status, 200);
    assert.ok(Buffer.from(await got.arrayBuffer()).equals(srv.objects.get(`guida/${TODAY_NAME()}`).body));
    // nomi strani o destinazioni che non ci sono: nessun file, tornano alla pagina
    for (const q of ['dest=dir&name=../../etc/passwd', 'dest=dir&name=note.txt', 'dest=ftp&name=' + TODAY_NAME(), 'dest=dir', 'dest=dir&name=guida-backup-2020-01-01.zip']) {
      assert.equal(loc(await admin(`/admin/backup/auto/download?${q}`)), '/admin/backup?err=auto-gone', q);
    }

    // l'elenco si rilegge dal servizio
    await app.autoBackup.refreshCopies();
    const listed = await admin('/admin/backup/auto/refresh', form());
    assert.equal(loc(listed), '/admin/backup?ok=auto-listed#copia-automatica');
    assert.match(await text(await admin('/admin/backup?ok=auto-listed')), /Elenco delle copie aggiornato/);
  } finally {
    await s.close();
  }
});

test('«in corso»: la pagina lo dice, i pulsanti si spengono, parte lo script che attende la fine; una seconda copia non parte', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    setSetting(app.db, 'auto_backup', { ...getSetting(app.db, 'auto_backup', {}), running: { at: new Date().toISOString(), trigger: 'manual' } });
    assert.equal((await (await admin('/admin/backup/auto/status')).json()).running, true);
    assert.equal((await admin('/admin/backup/auto/status')).headers.get('cache-control'), 'no-store');
    const page = await text(await admin('/admin/backup'));
    assert.match(page, /<span class="chip chip-warn">In corso<\/span>/);
    assert.match(page, /Copia in corso: può durare qualche minuto/);
    assert.match(page, /data-auto-running/);
    assert.match(page, /<button class="btn btn-gold" type="submit" disabled>Esegui una copia adesso/);
    assert.match(page, /<script src="\/js\/admin-backup-auto\.js\?v=/);
    const again = await admin('/admin/backup/auto/run', form());
    assert.equal(loc(again), '/admin/backup?err=auto-busy#copia-automatica');
    assert.match(await text(await admin('/admin/backup?err=auto-busy')), /C’è già una copia in corso/);
    // la pagina normale non porta lo script
    setSetting(app.db, 'auto_backup', { ...getSetting(app.db, 'auto_backup', {}), running: null });
    assert.doesNotMatch(await text(await admin('/admin/backup')), /admin-backup-auto\.js/);
  } finally {
    await s.close();
  }
});

test('un errore si vede nella pagina (testo ripulito, senza chiavi), e la prova di connessione dice cosa non va', async () => {
  const s = await start({ dir: false, s3: true });
  try {
    const { srv, admin } = s;
    srv.hooks.fail = () => ({ status: 403, code: 'SignatureDoesNotMatch' });
    assert.equal(loc(await admin('/admin/backup/auto/test', form())), '/admin/backup?ok=auto-tested#copia-automatica');
    let page = await text(await admin('/admin/backup?ok=auto-tested'));
    assert.match(page, /Prova terminata: l’esito è qui sotto/);
    assert.match(page, /<span class="chip chip-err">Non funziona<\/span> Servizio S3/);
    assert.match(page, /chiave segreta non corrisponde alla chiave di accesso/);
    await admin('/admin/backup/auto/run', form());
    await finished(admin);
    page = await text(await admin('/admin/backup'));
    assert.match(page, /<span class="chip chip-err">Non riuscita<\/span>/);
    assert.match(page, /<strong>L’ultima copia non è riuscita<\/strong>/);
    assert.match(page, /Servizio S3 \(127\.0\.0\.1:\d+ · bucket bucket-prova · cartella guida\/\)/);
    assert.match(page, /il sito riprova da solo|Il sito riprova da solo/);
    for (const secret of [srv.secretKey, srv.accessKey]) assert.ok(!page.includes(secret));
    // l'errore finisce anche in «Da fare» (con la scorciatoia alla pagina)
    const todo = await text(await admin('/admin/todo'));
    assert.match(todo, /La copia automatica di sicurezza non è riuscita/);
    // tornato a funzionare: prova verde e copia riuscita
    srv.hooks.fail = null;
    await admin('/admin/backup/auto/test', form());
    assert.match(await text(await admin('/admin/backup')), /<span class="chip chip-ok">Funziona<\/span> Servizio S3/);
    await admin('/admin/backup/auto/run', form());
    await finished(admin);
    page = await text(await admin('/admin/backup'));
    assert.doesNotMatch(page, /L’ultima copia non è riuscita/);
    assert.match(page, /<span class="chip chip-ok">Attiva<\/span>/);
    assert.doesNotMatch(await text(await admin('/admin/todo')), /La copia automatica di sicurezza non è riuscita/);
  } finally {
    await s.close();
  }
});

test('un sito esterno non può far partire copie, prove o scaricare le copie', async () => {
  const s = await start();
  try {
    const { admin } = s;
    for (const p of ['/admin/backup/auto/run', '/admin/backup/auto/test', '/admin/backup/auto/refresh']) {
      const res = await admin(p, { ...form(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } });
      assert.equal(res.status, 403, p);
    }
    assert.equal(s.app.autoBackup.running(), false);
    const anon = s.anon;
    for (const p of ['/admin/backup/auto/status', `/admin/backup/auto/download?dest=dir&name=${TODAY_NAME()}`]) assert.equal(loc(await anon(p)), '/admin/login', p);
  } finally {
    await s.close();
  }
});

test('impostazioni: orario e rotazione si cambiano da Sito › Impostazioni › Copia automatica e valgono subito', async () => {
  const s = await start();
  try {
    const { app, admin } = s;
    const page = await text(await admin('/admin/settings?s=backup'));
    assert.match(page, /<h2>Copia automatica/);
    assert.match(page, /name="backup\.auto\.enabled"[^>]*checked/);
    assert.match(page, /name="backup\.auto\.hour"[^>]*value="3"/);
    assert.match(page, /name="backup\.auto\.keepDays"[^>]*value="14"/);
    assert.match(page, /name="backup\.auto\.keepMonths"[^>]*value="6"/);
    const bad = await admin('/admin/settings/backup', form({ 'backup.auto.enabled': '1', 'backup.auto.hour': '24', 'backup.auto.keepDays': '14', 'backup.auto.keepMonths': '6' }));
    assert.equal(bad.status, 400, 'le 24 non esistono');
    assert.equal(app.cfg.backup.auto.hour, 3);
    const ok = await admin('/admin/settings/backup', form({ 'backup.auto.enabled': '1', 'backup.auto.hour': '5', 'backup.auto.keepDays': '30', 'backup.auto.keepMonths': '0' }));
    assert.equal(ok.status, 303);
    assert.deepEqual(app.cfg.backup.auto, { enabled: true, hour: 5, keepDays: 30, keepMonths: 0 });
    const back = await text(await admin('/admin/backup'));
    assert.match(back, /ogni giorno alle <strong>05:00<\/strong>/);
    assert.match(back, /le ultime 30; le altre si cancellano da sole/, 'senza mesi non si parla dei mesi');
    // spenta
    await admin('/admin/settings/backup', form({ 'backup.auto.hour': '5', 'backup.auto.keepDays': '30', 'backup.auto.keepMonths': '0' }));
    assert.equal(app.cfg.backup.auto.enabled, false);
    const off = await text(await admin('/admin/backup'));
    assert.match(off, /<span class="chip ">Spenta<\/span>|<span class="chip">Spenta<\/span>/);
    assert.match(off, /<strong>spenta<\/strong>/);
    assert.equal(app.autoBackup.due(Date.now() + 86400_000 * 2), false);
  } finally {
    await s.close();
  }
});
