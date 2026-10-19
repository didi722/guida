// Accesso a due passaggi del pannello: attivazione, secondo passo del login, codici di emergenza, blocco dopo troppi errori,
// «esci da tutti i dispositivi», e il fatto che la chiave non esca mai in una copia di sicurezza né un ripristino la tocchi.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { LOCK_BASE_MS, LOCK_MAX_MS, MAX_FAILS, PENDING_MS, createAdminSecurity } from '../server/adminSecurity.js';
import { backupEntries, writeZip } from '../server/backup.js';
import { createConfig, ROOT } from '../server/config.js';
import { getSetting, openDb, setSetting } from '../server/db.js';
import { transfer } from '../server/restore.js';
import { base32Decode, hotp, normalizeRecovery, stepOf } from '../server/totp.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-admin-security-' + crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(tmp, { recursive: true });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PW = 'segreto-admin';
const NOW = 1_800_000_000_000;
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const text = (res) => res.text();
const codeAt = (secret, shift = 0, now = Date.now()) => hotp(secret, stepOf(now) + shift);
/** Un codice a 6 cifre che NON vale adesso (le tre finestre accettate sono escluse). */
const wrongCode = (secret, now = Date.now()) => {
  const valid = new Set([-1, 0, 1].map((n) => hotp(secret, stepOf(now) + n)));
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, '0');
    if (!valid.has(c)) return c;
  }
};
const keyOf = (page) => /id="otp-key">([^<]+)</.exec(page)?.[1].replace(/\s/g, '');
const codesIn = (page) => [...page.matchAll(/<li><code>([A-Z2-9]{5}-[A-Z2-9]{5})<\/code><\/li>/g)].map((m) => m[1]);

// ───────────── il servizio, senza HTTP ─────────────
function service(password = PW) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: password, baseUrl: 'https://www.example.it' });
  const db = openDb(':memory:');
  return { cfg, db, sec: createAdminSecurity({ cfg, db }) };
}
/** Attiva i due passaggi come farebbe la pagina: chiave, codice dell'app, conferma. */
function activate(sec, now = NOW) {
  const setup = sec.beginSetup(now);
  const secret = base32Decode(setup.key);
  const out = sec.confirmSetup(hotp(secret, stepOf(now)), now);
  assert.ok(out.ok, 'attivazione');
  return { secret, key: setup.key, codes: out.recoveryCodes };
}

test('attivazione: la chiave resta la stessa finché non scade, si conferma solo con il codice giusto, dà dieci codici e scollega le sessioni', () => {
  const { sec, db } = service();
  assert.equal(sec.enabled(), false);
  const tag0 = sec.sessionTag();
  const a = sec.beginSetup(NOW);
  assert.match(a.key, /^[A-Z2-7]{32}$/);
  assert.match(a.uri, /^otpauth:\/\/totp\/.+secret=/);
  assert.equal(sec.beginSetup(NOW + 60_000).key, a.key, 'ricaricare la pagina non cambia la chiave');
  assert.equal(sec.pendingSetup(NOW + 60_000).key, a.key);
  const b = sec.beginSetup(NOW + PENDING_MS + 1);
  assert.notEqual(b.key, a.key, 'scaduta: se ne mostra una nuova');
  assert.equal(sec.pendingSetup(NOW + 2 * PENDING_MS + 2), null);
  // da qui si lavora a un altro istante, perché la chiave di prima è scaduta
  const t = NOW + 10 * PENDING_MS;
  const secret = base32Decode(sec.beginSetup(t).key);
  assert.deepEqual(sec.confirmSetup(wrongCode(secret, t), t), { ok: false, reason: 'code' });
  assert.equal(sec.enabled(), false);
  assert.deepEqual(sec.confirmSetup('', t), { ok: false, reason: 'code' });
  assert.deepEqual(sec.confirmSetup(hotp(secret, stepOf(t + PENDING_MS + 1)), t + PENDING_MS + 1), { ok: false, reason: 'nopending' }, 'dopo mezz’ora si ricomincia');

  const secret2 = base32Decode(sec.beginSetup(t + PENDING_MS + 2).key);
  assert.notDeepEqual(secret2, secret);
  const out = sec.confirmSetup(hotp(secret2, stepOf(t + PENDING_MS + 2)), t + PENDING_MS + 3000);
  assert.equal(out.ok, true);
  assert.equal(out.recoveryCodes.length, 10);
  assert.equal(new Set(out.recoveryCodes).size, 10);
  assert.ok(out.recoveryCodes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)));
  assert.equal(sec.enabled(), true);
  assert.notEqual(sec.sessionTag(), tag0, 'chi era già dentro deve rientrare con il secondo passaggio');
  assert.equal(sec.pendingSetup(t), null);
  assert.equal(sec.beginSetup(t), null, 'già attivo');
  assert.deepEqual(sec.confirmSetup(hotp(secret2, stepOf(t)), t), { ok: false, reason: 'enabled' });
  assert.deepEqual({ ...sec.status(t), enabledAt: undefined }, { enabled: true, enabledAt: undefined, recoveryLeft: 10, locked: false, lockedUntil: 0 });
  // quello che resta nel database: la chiave sì (serve al server), i codici di emergenza mai in chiaro
  const stored = JSON.stringify(getSetting(db, 'admin_security'));
  for (const c of out.recoveryCodes) assert.ok(!stored.includes(normalizeRecovery(c)) && !stored.includes(c), 'nessun codice di emergenza in chiaro');
});

test('secondo passaggio: il codice dell’app vale una volta, quello di emergenza si consuma, un errore di battitura non conta', () => {
  const { sec } = service();
  const { secret, codes } = activate(sec);
  const step = stepOf(NOW);
  // il codice con cui si è attivato è già stato usato; quello del periodo dopo vale, una volta sola
  assert.deepEqual(sec.verify(hotp(secret, step), NOW), { ok: false, reason: 'wrong' });
  const next = sec.verify(hotp(secret, step + 1), NOW);
  assert.deepEqual(next, { ok: true, kind: 'totp', recoveryLeft: 10 });
  assert.equal(sec.verify(hotp(secret, step + 1), NOW).ok, false, 'lo stesso codice due volte');
  assert.equal(sec.verify(hotp(secret, step + 2), NOW + 30_000).ok, true, 'trascorso un periodo vale il successivo');
  // emergenza: maiuscole e trattino non contano, si consuma
  const first = sec.verify(codes[0].toLowerCase(), NOW);
  assert.deepEqual(first, { ok: true, kind: 'recovery', recoveryLeft: 9 });
  assert.equal(sec.verify(codes[0], NOW).ok, false, 'un codice di emergenza vale una volta');
  assert.deepEqual(sec.verify(codes[1].replace('-', ' '), NOW), { ok: true, kind: 'recovery', recoveryLeft: 8 });
  assert.equal(sec.status(NOW).recoveryLeft, 8);
  // un codice incompleto non è un tentativo: ne servono MAX_FAILS sbagliati veri per bloccare
  for (let i = 0; i < 30; i++) assert.deepEqual(sec.verify('123', NOW), { ok: false, reason: 'format' });
  assert.deepEqual(sec.verify('', NOW), { ok: false, reason: 'format' });
  assert.deepEqual(sec.verify(null, NOW), { ok: false, reason: 'format' });
  for (let i = 1; i < MAX_FAILS; i++) assert.equal(sec.verify('ABCDE-ABCDE', NOW).reason, 'wrong');
  assert.equal(sec.status(NOW).locked, false, 'quattro errori veri: non ancora');
});

test('blocco: dopo cinque errori di fila nemmeno il codice giusto passa; ogni blocco dura il doppio, fino a sei ore; un successo azzera', () => {
  const { sec } = service();
  const { secret } = activate(sec);
  let now = NOW;
  const minutes = [];
  for (let burst = 0; burst < 7; burst++) {
    const bad = wrongCode(secret, now);
    for (let i = 1; i < MAX_FAILS; i++) assert.deepEqual(sec.verify(bad, now), { ok: false, reason: 'wrong' });
    const last = sec.verify(bad, now);
    assert.equal(last.ok, false);
    assert.equal(last.locked, true);
    minutes.push(last.retryAfterMs / 60_000);
    // bloccato: il codice giusto non passa, e lo dice
    const good = hotp(secret, stepOf(now) + 1);
    assert.deepEqual(sec.verify(good, now + 1000), { ok: false, reason: 'locked', retryAfterMs: last.retryAfterMs - 1000 });
    assert.equal(sec.status(now + 1000).locked, true);
    now += last.retryAfterMs + 1;
    assert.equal(sec.status(now).locked, false);
  }
  assert.deepEqual(minutes, [15, 30, 60, 120, 240, 360, 360], 'raddoppia fino al tetto di sei ore');
  assert.equal(LOCK_MAX_MS / 60_000, 360);
  assert.equal(LOCK_BASE_MS / 60_000, 15);
  // finito il blocco, il codice giusto entra e la serie riparte da capo
  assert.equal(sec.verify(hotp(secret, stepOf(now)), now).ok, true);
  const bad = wrongCode(secret, now);
  for (let i = 1; i < MAX_FAILS; i++) sec.verify(bad, now);
  assert.equal(sec.verify(bad, now).retryAfterMs, LOCK_BASE_MS, 'dopo un successo si riparte da quindici minuti');
});

test('nuovi codici di emergenza, spegnimento e ripristino da terminale', () => {
  const { sec } = service();
  const { secret, codes } = activate(sec);
  const fresh = sec.regenerateRecovery();
  assert.equal(fresh.length, 10);
  assert.ok(fresh.every((c) => !codes.includes(c)));
  assert.equal(sec.verify(codes[0], NOW).ok, false, 'i vecchi non valgono più');
  assert.equal(sec.verify(fresh[0], NOW).ok, true);
  assert.equal(sec.status(NOW).recoveryLeft, 9);
  assert.equal(service().sec.regenerateRecovery(), null, 'senza i due passaggi non c’è nulla da rigenerare');

  const tag = sec.sessionTag();
  sec.disable();
  assert.equal(sec.enabled(), false);
  assert.deepEqual(sec.verify(hotp(secret, stepOf(NOW) + 1), NOW), { ok: false, reason: 'off' });
  assert.equal(sec.sessionTag(), tag, 'spegnere non scollega nessuno');

  activate(sec, NOW + 100_000_000);
  const tag2 = sec.sessionTag();
  sec.reset();
  assert.equal(sec.enabled(), false);
  assert.notEqual(sec.sessionTag(), tag2, 'il ripristino da terminale chiude anche le sessioni');
});

test('il segno delle sessioni cambia con «esci da tutti», con i due passaggi e con la password', () => {
  const a = service('prima');
  const tag = a.sec.sessionTag();
  assert.equal(a.sec.sessionTag(), tag);
  a.sec.revokeSessions();
  const afterRevoke = a.sec.sessionTag();
  assert.notEqual(afterRevoke, tag);
  const sameDbOtherPassword = createAdminSecurity({ cfg: { ...a.cfg, admin: { password: 'seconda' } }, db: a.db });
  assert.notEqual(sameDbOtherPassword.sessionTag(), afterRevoke, 'cambiare la password scollega tutti');
  assert.equal(createAdminSecurity({ cfg: { ...a.cfg, admin: { password: 'prima' } }, db: a.db }).sessionTag(), afterRevoke);
});

// ───────────── tutto il giro, con il browser ─────────────
async function start() {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: PW, baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' } });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  const jar = () => {
    const cookies = new Map();
    const fn = async (p, init = {}) => {
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
    fn.cookies = cookies;
    return fn;
  };
  return { app, cfg, base, jar, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}
const login = (b, password = PW) => b('/admin/login', form({ password }));
/** Attiva i due passaggi dalla pagina, come farebbe la guida. */
async function enableViaPages(b) {
  assert.equal((await b('/admin/security/2fa/start', form())).status, 303);
  const key = keyOf(await text(await b('/admin/security/2fa')));
  const secret = base32Decode(key);
  const done = await b('/admin/security/2fa/confirm', form({ code: codeAt(secret) }));
  assert.equal(done.status, 200);
  return { key, secret, codes: codesIn(await text(done)) };
}
/** I codici sono ancora validi «oggi»: li si può riusare solo se si azzera l'ultimo periodo usato (il tempo vero non basta a farlo passare). */
const rewind = (app) => {
  const st = getSetting(app.db, 'admin_security');
  st.totp.lastStep = -1;
  setSetting(app.db, 'admin_security', st);
};
const mailsTo = (app, re) => app.mail.sent.filter((m) => re.test(m.subject));

test('senza i due passaggi tutto è come prima, e la pagina Sicurezza propone di accenderli', async () => {
  const s = await start();
  try {
    const b = s.jar();
    assert.equal((await b('/admin/security')).status, 302);
    assert.equal(loc(await b('/admin/security')), '/admin/login');
    const res = await login(b);
    assert.equal(res.status, 303);
    assert.equal(loc(res), '/admin');
    assert.equal((await b('/admin')).status, 200);
    assert.equal((await login(s.jar(), 'sbagliata')).status, 401);
    const page = await text(await b('/admin/security'));
    assert.match(page, /<h1>Sicurezza<\/h1>/);
    assert.match(page, /href="\/admin\/security" aria-current="page">Sicurezza/);
    assert.match(page, /<span class="chip chip-warn">Spento<\/span>/);
    assert.match(page, /Attiva i due passaggi/);
    assert.match(page, /Esci da tutti gli altri dispositivi/);
    assert.match(page, /npm run admin:2fa-off/);
    assert.match(page, /href="\/admin\/guide#sicurezza-del-pannello-due-passaggi-e-dispositivi"/);
    assert.equal(loc(await b('/admin/security/2fa')), '/admin/security', 'senza un’attivazione in corso non c’è nulla da mostrare');
    assert.equal(loc(await b('/admin/login/2fa')), '/admin/login', 'né un secondo passo da fare');
  } finally {
    s.close();
  }
});

test('attivazione dalla pagina: chiave e codice QR, conferma con il codice dell’app, dieci codici di emergenza, avviso per email', async () => {
  const s = await start();
  try {
    const { app } = s;
    const b = s.jar();
    await login(b);
    const other = s.jar();
    await login(other); // un secondo browser già collegato
    const started = await b('/admin/security/2fa/start', form());
    assert.equal(started.status, 303);
    assert.equal(loc(started), '/admin/security/2fa');
    const res = await b('/admin/security/2fa');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const page = await text(res);
    const key = keyOf(page);
    assert.match(key, /^[A-Z2-7]{32}$/);
    assert.match(page, /<svg [^>]*class="qr"[^>]*viewBox="0 0 /, 'il codice QR è nella pagina');
    assert.match(page, new RegExp(`href="otpauth://totp/[^"]*secret=${key}`), 'e anche il collegamento da aprire dal telefono');
    assert.doesNotMatch(page, /<script>|\sstyle=/, 'niente script né stili in linea');
    assert.match(page, /<script src="\/js\/admin-security\.js\?v=/);
    assert.equal(keyOf(await text(await b('/admin/security/2fa'))), key, 'ricaricando la chiave non cambia');
    const secret = base32Decode(key);

    // un codice sbagliato non attiva nulla e riporta alla stessa pagina
    const bad = await b('/admin/security/2fa/confirm', form({ code: wrongCode(secret) }));
    assert.equal(bad.status, 400);
    const badPage = await text(bad);
    assert.match(badPage, /Codice non corretto/);
    assert.equal(keyOf(badPage), key);
    assert.equal(app.adminSecurity.enabled(), false);
    assert.equal(mailsTo(app, /due passaggi/i).length, 0);

    const typed = codeAt(secret);
    const ok = await b('/admin/security/2fa/confirm', form({ code: ` ${typed.slice(0, 3)} ${typed.slice(3)} ` }));
    assert.equal(ok.status, 200, 'gli spazi nel codice si ignorano');
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    const done = await text(ok);
    const codes = codesIn(done);
    assert.equal(codes.length, 10);
    assert.match(done, /<h1>Codici di emergenza<\/h1>/);
    assert.match(done, /per entrare nel pannello servono la password e il codice dell’app/);
    assert.match(done, /data-copy-from="#recovery-codes"/);
    assert.equal(app.adminSecurity.enabled(), true);
    // chi ha attivato resta dentro; l'altro browser va riautenticato
    assert.equal((await b('/admin')).status, 200);
    assert.equal(loc(await other('/admin')), '/admin/login');
    // la pagina Sicurezza ora dice «Attivo» e non rivela chiave né codici
    const st = await text(await b('/admin/security'));
    assert.match(st, /<span class="chip chip-ok">Attivo<\/span>/);
    assert.match(st, /Codici di emergenza rimasti: <strong>10<\/strong> su 10/);
    assert.ok(!st.includes(key) && codes.every((c) => !st.includes(c)));
    assert.equal(loc(await b('/admin/security/2fa')), '/admin/security');
    assert.equal(loc(await b('/admin/security/2fa/start', form())), '/admin/security', 'non si riparte se è già attivo');
    // l'email alla guida dice cosa è successo, senza segreti
    const [mail] = mailsTo(app, /Accesso a due passaggi attivato/);
    assert.equal(mail.to, 'guida@example.com');
    assert.ok(!mail.text.includes(key) && codes.every((c) => !mail.text.includes(c)));
    assert.match(mail.text, /Da: /);
    assert.match(mail.text, /Se non sei stato tu/);
  } finally {
    s.close();
  }
});

test('login con i due passaggi: la password non basta, il codice sbagliato nemmeno, quello giusto entra; un codice non si riusa', async () => {
  const s = await start();
  try {
    const { app } = s;
    const { secret } = (() => { const sec = app.adminSecurity; const setup = sec.beginSetup(); const sc = base32Decode(setup.key); sec.confirmSetup(codeAt(sc)); return { secret: sc }; })();
    const b = s.jar();
    const r1 = await login(b);
    assert.equal(r1.status, 303);
    assert.equal(loc(r1), '/admin/login/2fa');
    assert.ok(b.cookies.has('gp') && !b.cookies.has('ga'), 'solo il cookie breve del secondo passo, non quello del pannello');
    assert.equal(loc(await b('/admin')), '/admin/login', 'il pannello resta chiuso');
    assert.equal(loc(await b('/admin/bookings')), '/admin/login');
    const page = await text(await b('/admin/login/2fa'));
    assert.match(page, /Verifica in due passaggi/);
    assert.match(page, /name="code"[^>]*autocomplete="one-time-code"/);
    assert.match(page, /name="recovery"/);
    assert.doesNotMatch(page, /<script>/);

    // password sbagliata: come prima, nessun cookie
    const wrongPw = s.jar();
    assert.equal((await login(wrongPw, 'no')).status, 401);
    assert.equal(wrongPw.cookies.size, 0);

    const bad = await b('/admin/login/2fa', form({ code: wrongCode(secret) }));
    assert.equal(bad.status, 401);
    assert.match(await text(bad), /Codice non corretto/);
    assert.equal(loc(await b('/admin')), '/admin/login');
    assert.equal((await b('/admin/login/2fa', form({ code: '12' }))).status, 401, 'un codice incompleto non entra');

    rewind(app);
    const code = codeAt(secret);
    const ok = await b('/admin/login/2fa', form({ code }));
    assert.equal(ok.status, 303);
    assert.equal(loc(ok), '/admin');
    assert.ok(b.cookies.has('ga') && !b.cookies.has('gp'), 'ora c’è la sessione e il cookie breve è sparito');
    assert.equal((await b('/admin')).status, 200);

    // lo stesso codice in un altro browser: no (vale una volta sola)
    const b2 = s.jar();
    await login(b2);
    const replay = await b2('/admin/login/2fa', form({ code }));
    assert.equal(replay.status, 401);
    assert.equal(loc(await b2('/admin')), '/admin/login');
    // ma quello del periodo dopo, sì (l'orologio del telefono può essere un po' avanti)
    const next = await b2('/admin/login/2fa', form({ code: codeAt(secret, 1) }));
    assert.equal(next.status, 303);
    assert.equal((await b2('/admin')).status, 200);

    // senza passare dalla password, il secondo passo non esiste
    const direct = s.jar();
    assert.equal(loc(await direct('/admin/login/2fa')), '/admin/login');
    assert.equal(loc(await direct('/admin/login/2fa', form({ code: codeAt(secret, 1) }))), '/admin/login');
    assert.equal(direct.cookies.size, 0);
    // un «cookie del secondo passo» non apre il pannello, nemmeno se lo si manda come cookie di sessione
    const forged = s.jar();
    await login(forged);
    forged.cookies.set('ga', forged.cookies.get('gp'));
    assert.equal(loc(await forged('/admin')), '/admin/login');
    // esci: spariscono entrambi
    await b('/admin/logout', form());
    assert.equal(b.cookies.size, 0);
  } finally {
    s.close();
  }
});

test('codice di emergenza: vale una volta, si scrive anche nel campo principale, avvisa la guida e scala il conteggio', async () => {
  const s = await start();
  try {
    const { app } = s;
    const setup = app.adminSecurity.beginSetup();
    const out = app.adminSecurity.confirmSetup(codeAt(base32Decode(setup.key)));
    const [c1, c2, c3] = out.recoveryCodes;

    const b = s.jar();
    await login(b);
    const ok = await b('/admin/login/2fa', form({ recovery: c1.toLowerCase() }));
    assert.equal(ok.status, 303);
    assert.equal((await b('/admin')).status, 200);
    const [mail] = mailsTo(app, /codice di emergenza/i);
    assert.equal(mail.to, 'guida@example.com');
    assert.match(mail.text, /ne restano 9/);
    assert.ok(!mail.text.includes(c1));
    assert.match(await text(await b('/admin/security')), /Codici di emergenza rimasti: <strong>9<\/strong> su 10/);

    const again = s.jar();
    await login(again);
    assert.equal((await again('/admin/login/2fa', form({ recovery: c1 }))).status, 401, 'già usato');
    assert.equal((await again('/admin/login/2fa', form({ code: c2.replace('-', ' ') }))).status, 303, 'anche scritto nel campo del codice');
    assert.equal(mailsTo(app, /codice di emergenza/i).length, 2);
    assert.equal(app.adminSecurity.status().recoveryLeft, 8);
    assert.ok(c3);
  } finally {
    s.close();
  }
});

test('blocco: cinque codici sbagliati bloccano il secondo passo (anche per quello giusto), la guida riceve un solo avviso, passato il tempo si rientra', async () => {
  const s = await start();
  try {
    const { app } = s;
    const setup = app.adminSecurity.beginSetup();
    const secret = base32Decode(setup.key);
    app.adminSecurity.confirmSetup(codeAt(secret));
    rewind(app);
    const b = s.jar();
    await login(b);
    const statuses = [];
    for (let i = 0; i < MAX_FAILS; i++) statuses.push((await b('/admin/login/2fa', form({ code: wrongCode(secret) }))).status);
    assert.deepEqual(statuses, [401, 401, 401, 401, 429], 'al quinto errore scatta il blocco');
    assert.equal(mailsTo(app, /bloccato/i).length, 1);
    assert.match(mailsTo(app, /bloccato/i)[0].text, /15 minuti/);

    const locked = await b('/admin/login/2fa', form({ code: codeAt(secret) }));
    assert.equal(locked.status, 429, 'nemmeno il codice giusto');
    assert.match(await text(locked), /bloccati per \d+ minuti/);
    assert.equal(loc(await b('/admin')), '/admin/login');
    assert.equal(mailsTo(app, /bloccato/i).length, 1, 'un solo avviso per blocco');
    assert.equal(app.adminSecurity.status().locked, true);

    // passato il blocco si rientra con il codice giusto
    const st = getSetting(app.db, 'admin_security');
    st.totp.lockedUntil = Date.now() - 1;
    setSetting(app.db, 'admin_security', st);
    const ok = await b('/admin/login/2fa', form({ code: codeAt(secret) }));
    assert.equal(ok.status, 303);
    assert.equal((await b('/admin')).status, 200);
    assert.match(await text(await b('/admin/security')), /Attivo/);
  } finally {
    s.close();
  }
});

test('spegnere i due passaggi e rigenerare i codici richiedono un codice; dopo, il pannello torna alla sola password', async () => {
  const s = await start();
  try {
    const { app } = s;
    const b = s.jar();
    await login(b);
    const { secret, codes } = await enableViaPages(b);

    // senza codice giusto non cambia nulla
    const badOff = await b('/admin/security/2fa/disable', form({ code: wrongCode(secret) }));
    assert.equal(badOff.status, 400);
    assert.match(await text(badOff), /Codice non corretto/);
    assert.equal(app.adminSecurity.enabled(), true);
    assert.equal((await b('/admin/security/2fa/recovery', form({ code: '' }))).status, 400);
    assert.equal(app.adminSecurity.status().recoveryLeft, 10);

    // nuovi codici: quelli vecchi smettono di valere
    const regen = await b('/admin/security/2fa/recovery', form({ code: codes[0] }));
    assert.equal(regen.status, 200);
    const fresh = codesIn(await text(regen));
    assert.equal(fresh.length, 10);
    assert.ok(fresh.every((c) => !codes.includes(c)));
    assert.equal(mailsTo(app, /Nuovi codici di emergenza/).length, 1);
    const other = s.jar();
    await login(other);
    assert.equal((await other('/admin/login/2fa', form({ code: codes[1] }))).status, 401, 'il vecchio codice non vale più');

    rewind(app);
    const off = await b('/admin/security/2fa/disable', form({ code: codeAt(secret) }));
    assert.equal(off.status, 303);
    assert.equal(loc(off), '/admin/security?ok=off');
    assert.match(await text(await b(loc(off))), /Due passaggi disattivati/);
    assert.equal(app.adminSecurity.enabled(), false);
    assert.equal(mailsTo(app, /disattivato/i).length, 1);
    // di nuovo la sola password
    const again = s.jar();
    const res = await login(again);
    assert.equal(loc(res), '/admin');
    assert.equal((await again('/admin')).status, 200);
    // e i moduli, senza i due passaggi, non fanno nulla
    assert.equal(loc(await b('/admin/security/2fa/disable', form({ code: '123456' }))), '/admin/security');
  } finally {
    s.close();
  }
});

test('sessioni: «esci da tutti» chiude gli altri e non questo; cambiare la password chiude tutti; gli accessi senza sessione non fanno nulla', async () => {
  const s = await start();
  try {
    const { app } = s;
    const a = s.jar();
    const b = s.jar();
    await login(a);
    await login(b);
    assert.equal((await a('/admin')).status, 200);
    assert.equal((await b('/admin')).status, 200);
    const res = await a('/admin/security/sessions/revoke', form());
    assert.equal(loc(res), '/admin/security?ok=revoked');
    assert.match(await text(await a('/admin/security?ok=revoked')), /tutti gli altri dispositivi sono stati scollegati/);
    assert.equal((await a('/admin')).status, 200, 'questo browser resta collegato');
    assert.equal(loc(await b('/admin')), '/admin/login');
    // la password: un cookie emesso prima del cambio non vale dopo
    assert.equal((await a('/admin')).status, 200);
    app.cfg.admin.password = 'nuova-password';
    assert.equal(loc(await a('/admin')), '/admin/login');
    assert.equal((await login(s.jar(), 'nuova-password')).status, 303);
    // senza sessione: nessuna delle azioni passa
    const anon = s.jar();
    for (const p of ['/admin/security/2fa/start', '/admin/security/2fa/confirm', '/admin/security/2fa/disable', '/admin/security/2fa/recovery', '/admin/security/sessions/revoke']) {
      assert.equal(loc(await anon(p, form({ code: '123456' }))), '/admin/login', p);
    }
    assert.equal(app.adminSecurity.enabled(), false);
    assert.equal(app.adminSecurity.pendingSetup(), null);
  } finally {
    s.close();
  }
});

test('un sito esterno non può spegnere i due passaggi né chiudere le sessioni (richieste da altri indirizzi rifiutate)', async () => {
  const s = await start();
  try {
    const b = s.jar();
    await login(b);
    const { secret } = await enableViaPages(b);
    for (const p of ['/admin/security/2fa/disable', '/admin/security/2fa/recovery', '/admin/security/sessions/revoke', '/admin/security/2fa/start']) {
      const res = await b(p, { ...form({ code: codeAt(secret, 1) }), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } });
      assert.equal(res.status, 403, p);
    }
    assert.equal(s.app.adminSecurity.enabled(), true);
    assert.equal((await b('/admin')).status, 200);
  } finally {
    s.close();
  }
});

// ───────────── copie di sicurezza e ripristino ─────────────
async function zipOf(app) {
  const chunks = [];
  await writeZip({ write: (b, cb) => { chunks.push(Buffer.from(b)); cb(); } }, backupEntries(app));
  return Buffer.concat(chunks);
}

test('la chiave dei due passaggi non esce nelle copie di sicurezza e un ripristino non la tocca', async () => {
  const s = await start();
  try {
    const { app } = s;
    const b = s.jar();
    await login(b);
    setSetting(app.db, 'prova_visibile', { valore: 'PRESENTE-NELLA-COPIA' });
    const zipBefore = await zipOf(app); // fatta prima di attivare i due passaggi
    const { key, codes } = await enableViaPages(b);
    const live = getSetting(app.db, 'admin_security');
    assert.equal(live.totp.secret, key);

    // la copia scaricata ha il database ma non la sicurezza del pannello
    let dbFile = null;
    for await (const e of backupEntries(app)) if (e.name === 'guida.sqlite') dbFile = e.data;
    assert.ok(dbFile);
    assert.ok(!dbFile.includes(Buffer.from(key)), 'la chiave non è nel file');
    assert.ok(!dbFile.includes(Buffer.from(live.totp.salt)), 'nemmeno il sale dei codici di emergenza');
    assert.ok(dbFile.includes(Buffer.from('PRESENTE-NELLA-COPIA')), 'il resto c’è');
    const copy = path.join(tmp, 'copia-controllo.sqlite');
    fs.writeFileSync(copy, dbFile);
    const copyDb = new DatabaseSync(copy);
    assert.equal(copyDb.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'admin_security'`).get().n, 0);
    assert.equal(copyDb.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'prova_visibile'`).get().n, 1);
    copyDb.close();
    assert.equal(app.adminSecurity.enabled(), true, 'e l’originale non è stato toccato');

    // ripristino di tutto da una copia vecchia (senza i due passaggi): restano attivi
    const up = await b('/admin/backup/restore/upload', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zipBefore });
    const reply = await up.json();
    assert.ok(reply.ok, reply.error);
    const done = await b(reply.url, form({ mode: 'all', confirm: 'RIPRISTINA' }));
    assert.equal(loc(done), '/admin/backup?ok=restored');
    assert.equal(app.adminSecurity.enabled(), true, 'il ripristino non spegne la protezione');
    assert.deepEqual(getSetting(app.db, 'admin_security'), live);
    assert.equal(getSetting(app.db, 'prova_visibile').valore, 'PRESENTE-NELLA-COPIA');
    assert.equal((await b('/admin')).status, 200, 'e la sessione resta valida');
    // la copia di sicurezza automatica fatta prima del ripristino non contiene la chiave
    const [snapshot] = app.restore.snapshots();
    const snap = fs.readFileSync(snapshot.dbFile);
    assert.ok(!snap.includes(Buffer.from(key)));
    assert.ok(codes.length === 10);

    // anche con un file «ostile» che porta un altro stato di sicurezza, `transfer` lo ignora
    const staged = path.join(tmp, 'ostile.sqlite');
    app.db.prepare('VACUUM INTO ?').run(staged);
    const hostile = new DatabaseSync(staged);
    hostile.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES('admin_security', ?)`).run(JSON.stringify({ epoch: 99, pending: null, totp: null }));
    hostile.close();
    transfer(app.db, staged, 'all');
    assert.deepEqual(getSetting(app.db, 'admin_security'), live);
    transfer(app.db, staged, 'content');
    assert.deepEqual(getSetting(app.db, 'admin_security'), live);
  } finally {
    s.close();
  }
});

test('da terminale: «npm run admin:2fa-off» spegne i due passaggi e chiude le sessioni, e dice cosa ha fatto', () => {
  const dir = path.join(tmp, 'terminale-' + crypto.randomBytes(3).toString('hex'));
  const env = { ...process.env, DATA_DIR: dir, SESSION_SECRET: 'x'.repeat(40), NODE_ENV: 'test', ADMIN_PASSWORD: PW, GUIDA_QUIET: '1' };
  const cfg = createConfig({ __skipDotEnv: true, dataDir: dir, adminPassword: PW });
  const db = openDb(cfg.dbFile);
  const sec = createAdminSecurity({ cfg: { ...cfg, sessionSecret: env.SESSION_SECRET }, db });
  const { secret } = activate(sec);
  assert.equal(sec.enabled(), true);
  const tag = sec.sessionTag();
  db.close();
  const run = () => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', 'admin-2fa-off.mjs')], { env, encoding: 'utf8', cwd: ROOT });
  assert.match(run(), /i due passaggi sono spenti e le sessioni del pannello sono chiuse/);
  const after = openDb(cfg.dbFile);
  const sec2 = createAdminSecurity({ cfg: { ...cfg, sessionSecret: env.SESSION_SECRET }, db: after });
  assert.equal(sec2.enabled(), false);
  assert.notEqual(sec2.sessionTag(), tag);
  assert.deepEqual(sec2.verify(hotp(secret, stepOf(Date.now())), Date.now()), { ok: false, reason: 'off' });
  after.close();
  assert.match(run(), /non erano attivi: non ho cambiato nulla/);
});
