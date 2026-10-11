// L'istanza di prova (npm run sandbox): si avvia, crea i dati d'esempio senza errori e i percorsi descritti in docs/SIMULAZIONI.md funzionano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('sandbox: dati d’esempio creati senza errori, sito di prova, partner con condizioni dedicate, email leggibili dal pannello', async (t) => {
  const dir = path.join(ROOT, 'data', 'test-sandbox-' + crypto.randomBytes(3).toString('hex'));
  const port = 3300 + Math.floor(Math.random() * 600);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/sandbox.mjs'], { cwd: ROOT, env: { ...process.env, SANDBOX_DIR: dir, SANDBOX_PORT: String(port), GUIDA_QUIET: '1' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  t.after(() => {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !out.includes('Ctrl+C per fermare'); i++) await wait(200);
  assert.ok(out.includes('Ctrl+C per fermare'), `la sandbox non è partita:\n${out}`);
  assert.ok(!out.includes('✗'), `errori nei dati d'esempio:\n${out}`);
  for (const what of ['Anna Verdi', 'Carmen Ruiz', 'Lagoon DMC', 'Blue Sail Tours', 'Laura Bianchi', 'Buono regalo', 'PROVA10', 'Venezia in tre giorni']) assert.ok(out.includes(what), `manca «${what}» nel riepilogo`);

  const base = `http://localhost:${port}`;
  const home = await (await fetch(`${base}/it/`)).text();
  assert.match(home, /Sito di prova/);
  assert.match(home, /noindex/);

  // pannello: accesso con la password di prova
  let cookie = '';
  const login = await fetch(`${base}/admin/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: 'password=admin' });
  assert.equal(login.status, 303);
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const admin = async (p) => (await fetch(base + p, { headers: { cookie } })).text();
  const partners = await admin('/admin/partners');
  for (const name of ['Lagoon DMC', 'Blue Sail Tours', 'Rialto Travel']) assert.ok(partners.includes(name), name);
  assert.match(await admin('/admin/partners?f=pending'), /Rialto Travel/);
  assert.match(await admin('/admin/mail'), /La tua proposta di programma/);

  // il partner d'esempio entra con la password indicata e vede la tariffa dedicata (28 € − 15% = 23,80 €)
  const pl = await fetch(`${base}/it/b2b/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base }, body: new URLSearchParams({ email: 'giulia@lagoon-dmc.example', password: 'prova-prova-1' }).toString() });
  assert.equal(pl.status, 303);
  const pcookie = pl.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const tour = await (await fetch(`${base}/it/tours/cannaregio-ghetto`, { headers: { cookie: pcookie } })).text();
  assert.match(tour, /23,80\s*€/);
  assert.match(tour, /Tariffa partner/);
});
