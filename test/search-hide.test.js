// «Nascondi il sito ai motori di ricerca»: meta noindex, robots.txt, mappa vuota e intestazione, accesi e spenti dal pannello.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-hide-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const form = (obj = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');

async function start(over = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'https://davidetomiovenice.example', demoPayments: false, ...over });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${http.address().port}`;
  let cookie = '';
  const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
  const login = await fetch(`${base}/admin/login`, { redirect: 'manual', ...form({ password: 'segreto-admin' }) });
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { app, cfg, get, close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('sito nascosto: noindex ovunque, robots.txt chiuso, mappa vuota; acceso e spento dal pannello senza riavvio', async () => {
  const s = await start();
  try {
    // di partenza il sito è indicizzabile (produzione, senza pagamenti di prova)
    let home = await (await s.get('/it/')).text();
    assert.doesNotMatch(home, /name="robots"/);
    assert.match(await (await s.get('/robots.txt')).text(), /Sitemap: https:\/\/davidetomiovenice\.example\/sitemap\.xml/);
    assert.match(await (await s.get('/sitemap.xml')).text(), /<loc>https:\/\/davidetomiovenice\.example\/it\/tours<\/loc>/);
    assert.equal((await s.get('/it/')).headers.get('x-robots-tag'), null);
    assert.doesNotMatch(await (await s.get('/admin')).text(), /Sito nascosto ai motori di ricerca/);

    // si accende dal pannello (Impostazioni › Attività e contatti)
    assert.match(await (await s.get('/admin/settings?s=business')).text(), /name="site\.hideFromSearch"/);
    const base = { 'site.name': 'Davide Tomio', 'site.email': 'info@davidetomiovenice.example', 'site.hideFromSearch': '1' };
    assert.equal(loc(await s.get('/admin/settings/business', form(base))), '/admin/settings?ok=saved&s=business#business');
    assert.equal(s.cfg.site.hideFromSearch, true, 'vale subito');
    for (const p of ['/it/', '/en/tours', '/it/blog', '/it/b2b']) {
      const res = await s.get(p);
      assert.match(await res.text(), /<meta name="robots" content="noindex, nofollow">/, p);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
      assert.doesNotMatch(await (await s.get(p)).text(), /hreflang="x-default"/, 'niente alternative per i motori di ricerca');
    }
    assert.equal(await (await s.get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
    const map = await (await s.get('/sitemap.xml')).text();
    assert.doesNotMatch(map, /<url>/);
    assert.match(await (await s.get('/admin')).text(), /Sito nascosto ai motori di ricerca/, 'la guida lo vede nell’Agenda');
    assert.equal((await s.get('/media/inesistente.jpg')).headers.get('x-robots-tag'), 'noindex, nofollow', 'anche per i file');

    // si spegne al lancio
    assert.equal(loc(await s.get('/admin/settings/business', form({ 'site.name': 'Davide Tomio', 'site.email': 'info@davidetomiovenice.example' }))), '/admin/settings?ok=saved&s=business#business');
    assert.equal(s.cfg.site.hideFromSearch, false);
    home = await (await s.get('/it/')).text();
    assert.doesNotMatch(home, /name="robots"/);
    assert.match(await (await s.get('/sitemap.xml')).text(), /<url>/);
    assert.match(await (await s.get('/robots.txt')).text(), /Sitemap:/);
    assert.doesNotMatch(await (await s.get('/admin')).text(), /Sito nascosto ai motori di ricerca/);
  } finally {
    s.close();
  }
});

test('acceso dalla configurazione del server (HIDE_FROM_SEARCH) e nelle istanze di prova', async () => {
  const s = await start({ site: { hideFromSearch: true } });
  try {
    assert.match(await (await s.get('/it/')).text(), /name="robots" content="noindex, nofollow"/);
    assert.equal(await (await s.get('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
  } finally {
    s.close();
  }
  const demo = await start({ demoPayments: true });
  try {
    assert.match(await (await demo.get('/it/')).text(), /name="robots" content="noindex, nofollow"/, 'la sandbox resta nascosta come prima');
  } finally {
    demo.close();
  }
});
