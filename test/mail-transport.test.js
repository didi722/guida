// Il mailer: mittente per messaggio, copia nascosta, posta separata per le email commerciali e il motivo di un invio fallito — con trasporti finti, senza connessioni vere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createConfig, ROOT } from '../server/config.js';
import { createMailer } from '../server/mail.js';

process.env.GUIDA_QUIET = '1';

/** Una configurazione di prova e i trasporti finti che ricordano cosa hanno ricevuto. */
function setup(mail = {}) {
  const dataDir = path.join(ROOT, 'data', 'test-mail-' + crypto.randomBytes(3).toString('hex'));
  const cfg = createConfig({ __skipDotEnv: true, dataDir, mail });
  const made = [];
  const createTransport = (opts) => {
    const t = { opts, got: [], fail: null, async sendMail(msg) { if (t.fail) throw t.fail; t.got.push(msg); } };
    made.push(t);
    return t;
  };
  return { cfg, made, mailer: createMailer(cfg, { createTransport }), cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('di base un solo trasporto e il mittente delle conferme; il mittente di un messaggio vince; la copia nascosta arriva al trasporto', async (t) => {
  const s = setup({ host: 'smtp.example', user: 'conferme', pass: 'x', from: 'Davide <tours@example.it>' });
  t.after(s.cleanup);
  assert.equal(s.made.length, 1, 'senza SALES_SMTP_* si apre una sola connessione');
  assert.deepEqual([s.mailer.live, s.mailer.salesLive], [true, false]);
  assert.equal(await s.mailer.send({ to: 'a@x.it', subject: 'Ciao', text: 'x' }), true);
  const [first] = s.made[0].got;
  assert.deepEqual([first.from, first.bcc, first.to], ['Davide <tours@example.it>', undefined, 'a@x.it']);
  // un messaggio con il suo mittente e la copia nascosta
  await s.mailer.send({ to: 'b@x.it', subject: 'Ciao', text: 'x', from: { name: 'Davide Tomio', address: 'info@example.it' }, bcc: 'me@example.it' });
  assert.deepEqual([s.made[0].got[1].from, s.made[0].got[1].bcc], [{ name: 'Davide Tomio', address: 'info@example.it' }, 'me@example.it']);
  // «transport: sales» senza posta separata: si usa quella di tutti
  await s.mailer.send({ to: 'c@x.it', subject: 'Ciao', text: 'x', transport: 'sales' });
  assert.equal(s.made[0].got.length, 3);
  // il registro ricorda da chi è partito
  const log = s.mailer.sent.at(-1);
  assert.deepEqual([log.from, log.via], ['Davide <tours@example.it>', 'main']);
  assert.deepEqual(s.mailer.sent.map((m) => m.to), ['a@x.it', 'b@x.it', 'c@x.it']);
});

test('con SALES_SMTP_* le email commerciali usano la loro posta; le altre no', async (t) => {
  const s = setup({ host: 'smtp.example', user: 'conferme', pass: 'x', sales: { host: 'smtp.hosting.example', port: 465, user: 'info@example.it', pass: 'segreta', secure: true } });
  t.after(s.cleanup);
  assert.equal(s.made.length, 2);
  assert.deepEqual([s.mailer.live, s.mailer.salesLive], [true, true]);
  assert.deepEqual(s.made[1].opts, { host: 'smtp.hosting.example', port: 465, secure: true, auth: { user: 'info@example.it', pass: 'segreta' } });
  await s.mailer.send({ to: 'a@x.it', subject: 'Commerciale', text: 'x', transport: 'sales', from: 'info@example.it' });
  await s.mailer.send({ to: 'b@x.it', subject: 'Conferma', text: 'x' });
  assert.deepEqual(s.made[1].got.map((m) => m.to), ['a@x.it'], 'la posta commerciale ha solo le commerciali');
  assert.deepEqual(s.made[0].got.map((m) => m.to), ['b@x.it'], 'le conferme restano sulla posta di sempre');
  assert.deepEqual(s.mailer.sent.map((m) => m.via), ['sales', 'main']);
  // una posta commerciale senza password (come una porta aperta in rete interna): nessuna autenticazione
  const open = setup({ sales: { host: 'relay.interno', user: '' } });
  t.after(open.cleanup);
  assert.equal(open.made[0].opts.auth, undefined);
});

test('se l’invio non riesce si sa perché; il messaggio dopo, se riesce, cancella l’errore', async (t) => {
  const s = setup({ host: 'smtp.example', user: 'u', pass: 'p' });
  t.after(s.cleanup);
  assert.equal(s.mailer.lastError, '');
  s.made[0].fail = Object.assign(new Error('Message failed'), { response: '553 5.7.1 Sender address rejected: not owned by user' });
  assert.equal(await s.mailer.send({ to: 'a@x.it', subject: 'S', text: 'x' }), false);
  assert.equal(s.mailer.lastError, '553 5.7.1 Sender address rejected: not owned by user');
  s.made[0].fail = new Error('connect ECONNREFUSED 127.0.0.1:587');
  assert.equal(await s.mailer.send({ to: 'a@x.it', subject: 'S', text: 'x' }), false);
  assert.match(s.mailer.lastError, /ECONNREFUSED/);
  assert.equal(s.mailer.sent.length, 2, 'i tentativi restano nel registro');
  s.made[0].fail = null;
  assert.equal(await s.mailer.send({ to: 'a@x.it', subject: 'S', text: 'x' }), true);
  assert.equal(s.mailer.lastError, '');
  assert.equal(await s.mailer.send({ to: '', subject: 'S', text: 'x' }), false, 'senza destinatario non parte');
});

test('senza SMTP (sviluppo e prove) le email non partono ma risultano nel registro, con il loro mittente', async (t) => {
  const s = setup({ host: '', from: 'Prova <prova@example.it>' });
  t.after(s.cleanup);
  assert.equal(s.made.length, 0);
  assert.deepEqual([s.mailer.live, s.mailer.salesLive], [false, false]);
  assert.equal(await s.mailer.send({ to: 'a@x.it', subject: 'S', text: 'x', transport: 'sales' }), true);
  assert.deepEqual([s.mailer.sent[0].from, s.mailer.sent[0].via], ['Prova <prova@example.it>', 'main']);
});
