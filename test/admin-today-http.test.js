// Pannello: «Da fare» con il numero nel menu, scheda del giorno (pagina, PDF, «invia a me») e le impostazioni della scheda serale.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { addDays, nowRome } from '../server/time.js';
import { addAccount, isPdf } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = path.join(ROOT, 'data', 'test-admin-today-http-' + crypto.randomBytes(3).toString('hex'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const form = (obj) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(obj)).toString() });
const loc = (res) => res.headers.get('location');
const day = (n) => addDays(nowRome().date, n);
const text = async (res) => (await res.text()).replace(/ /g, ' ');
const SHARED = 'cannaregio-ghetto-agenzie';

async function start(over = {}) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, crypto.randomBytes(3).toString('hex')), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, mail: { notifyTo: 'guida@example.com' }, policy: { allowPayOnSite: true }, ...over });
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
  assert.equal((await admin('/admin/login', form({ password: 'segreto-admin' }))).status, 303);
  return { app, cfg, admin, anon: jar(), close: () => { app.close(); http.close(); fs.rmSync(cfg.dataDir, { recursive: true, force: true }); } };
}

test('da fare: solo per la guida, voci che compaiono e spariscono, numero nel menu che segue le modifiche', async () => {
  const s = await start();
  try {
    const { app, admin, anon } = s;
    assert.equal((await anon('/admin/todo')).status, 302);
    assert.equal((await anon('/admin/day')).status, 302);
    assert.match(await text(await admin('/admin/todo')), /Tutto a posto/);
    const quiet = await text(await admin('/admin'));
    assert.match(quiet, /<a href="\/admin\/todo" >Da fare<\/a>/, 'nessun numero se non c’è nulla');

    const partner = addAccount(app.db, { email: 'nuova@example.com', company: 'Nuova DMC', status: 'pending' });
    const page = await text(await admin('/admin/todo'));
    assert.match(page, /<h1>Da fare<\/h1>/);
    assert.match(page, /1 cosa da fare\./);
    assert.match(page, /<h2 class="h-sub spaced">Da decidere<\/h2>/);
    assert.match(page, /<a class="todo-item" href="\/admin\/partners"><span class="chip chip-warn">Da fare<\/span><span class="todo-main"><strong>1 partner da approvare<\/strong>/);
    assert.match(await text(await admin('/admin')), /Da fare <span class="tab-n">1<\/span>/, 'il numero nel menu');
    assert.match(await text(await admin('/admin/bookings')), /Da fare <span class="tab-n">1<\/span>/, 'in tutte le pagine dell’Agenda');

    // approvo il partner: il numero si azzera subito, senza aspettare
    const ok = await admin(`/admin/partners/${partner.id}`, form({ status: 'approved', discount_percent: '0', allow_invoice: '1' }));
    assert.equal(ok.status, 303);
    assert.match(await text(await admin('/admin/bookings')), /<a href="\/admin\/todo" >Da fare<\/a>/);
    assert.match(await text(await admin('/admin/todo')), /Tutto a posto/);
  } finally {
    s.close();
  }
});

test('scheda del giorno: servizi del giorno (domani se non si dice), date strane ripiegano, PDF e «invia a me»', async () => {
  const s = await start();
  try {
    const { app, admin, anon } = s;
    const acct = addAccount(app.db, { email: 'dmc@example.com', company: 'Lagoon DMC', contact_name: 'Anna', phone: '+39 041 000000', lang: 'it' });
    const D = day(3);
    createBooking(app, { tourSlug: SHARED, date: D, time: '10:00', pax: 4, channel: 'b2b', account: acct, name: 'Luisa Verdi', email: acct.email, lang: 'it', paymentMethod: 'invoice', clientRef: 'Gruppo Verdi', phone: '+39 320 000 0000' });
    createBooking(app, { tourSlug: 'cannaregio-ghetto', date: D, time: '15:00', pax: 2, channel: 'b2c', name: 'Mario Rossi', email: 'mario@example.com', phone: '+39 333 111 2222', lang: 'it', paymentMethod: 'onsite', notes: 'Una persona usa la sedia a rotelle' });

    const page = await text(await admin(`/admin/day?date=${D}`));
    assert.match(page, /<h1>Scheda del giorno<\/h1>/);
    assert.match(page, /<input type="date" name="date" value="[\d-]+" data-autosubmit/);
    assert.match(page, /data-print/);
    assert.match(page, /<script src="\/js\/admin-day\.js" defer>/);
    assert.match(page, /Servizi<\/span><strong>2<\/strong>/);
    assert.match(page, /Persone<\/span><strong>6<\/strong>/);
    assert.match(page, /Da incassare sul posto<\/span><strong>70 €<\/strong>/);
    assert.match(page, /Cannaregio e il Ghetto/);
    assert.match(page, /Lagoon DMC · Anna · \+39 041 000000 · dmc@example\.com/);
    assert.match(page, /Gruppo Verdi · Luisa Verdi · \+39 320 000 0000/);
    assert.match(page, /Mario Rossi · \+39 333 111 2222 · mario@example\.com/);
    assert.match(page, /Una persona usa la sedia a rotelle/);
    assert.match(page, /<span class="chip chip-err">Da incassare 70 €<\/span>/);
    assert.ok(page.indexOf('Gruppo Verdi') < page.indexOf('Mario Rossi'), 'in ordine d’orario');
    assert.match(page, /Ponte delle Guglie/);
    assert.match(page, /href="\/admin\/bookings\/\d+">Apri la prenotazione VE-/);

    // senza data: domani (nessun servizio); data strana: lo stesso
    for (const q of ['', '?date=ieri', '?date=2027-13-45', '?date[]=1']) {
      const res = await admin(`/admin/day${q}`);
      assert.equal(res.status, 200, q);
      assert.match(await text(res), /Nessun servizio in questo giorno\./);
    }
    // PDF
    const pdf = await admin(`/admin/day.pdf?date=${D}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), new RegExp(`scheda-${D}\\.pdf`));
    assert.ok(isPdf(Buffer.from(await pdf.arrayBuffer())));
    assert.equal((await admin('/admin/day.pdf?date=boh')).status, 200);
    assert.equal((await anon(`/admin/day.pdf?date=${D}`)).status, 302);

    // «invia a me»
    const before = app.mail.sent.length;
    const send = await admin('/admin/day/send', form({ date: D }));
    assert.equal(loc(send), `/admin/day?date=${D}&ok=sent`);
    assert.match(await text(await admin(loc(send))), /Scheda inviata alla tua email\./);
    const mail = app.mail.sent.at(-1);
    assert.equal(app.mail.sent.length, before + 1);
    assert.equal(mail.to, 'guida@example.com');
    assert.match(mail.subject, /^Domani: 2 servizi, 6 persone/);
    assert.equal(mail.attachments[0].filename, `scheda-${D}.pdf`);
    assert.equal(loc(await admin('/admin/day/send', form({ date: day(40) }))), `/admin/day?date=${day(40)}&ok=empty`);
    assert.match(await text(await admin(`/admin/day?date=${day(40)}&ok=empty`)), /in quel giorno non ci sono servizi/);
    app.cfg.mail.notifyTo = '';
    assert.equal(loc(await admin('/admin/day/send', form({ date: D }))), `/admin/day?date=${D}&ok=nomail`);
    assert.equal((await anon('/admin/day/send', form({ date: D }))).status, 302);
  } finally {
    s.close();
  }
});

test('impostazioni: ora e interruttore della scheda del giorno dopo, con i loro limiti', async () => {
  const s = await start();
  try {
    const { admin, app } = s;
    const settings = await text(await admin('/admin/settings'));
    assert.match(settings, /Scheda del giorno dopo, per te/);
    assert.match(settings, /Ora della scheda del giorno dopo/);
    assert.deepEqual([app.cfg.reminders.briefing.enabled, app.cfg.reminders.briefing.hour], [true, 18]);
  } finally {
    s.close();
  }
});
