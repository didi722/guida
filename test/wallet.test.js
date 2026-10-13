// «Aggiungi al wallet»: link di Google Wallet (JWT firmato), file .pkpass di Apple (zip con firma PKCS#7), pulsanti solo quando servono.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { createApp } from '../server/app.js';
import { confirmPaid, createBooking, getBooking } from '../server/bookings.js';
import { createConfig, ROOT } from '../server/config.js';
import { openDb } from '../server/db.js';
import { encodePng } from '../server/png.js';
import { applePass, googleSaveUrl, loadWallet, walletOptions } from '../server/wallet.js';
import { openZip } from '../server/zipread.js';
import { addDays, nowRome } from '../server/time.js';
import { NOW, addAccount, base, makeApp } from './helpers.js';

process.env.GUIDA_QUIET = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const HAS_OPENSSL = !spawnSync('openssl', ['version']).error;
const openssl = (args, opts = {}) => {
  const r = spawnSync('openssl', args, { cwd: tmp, encoding: 'utf8', ...opts });
  assert.equal(r.status, 0, `openssl ${args.join(' ')}\n${r.stderr}`);
  return r;
};

// ───── credenziali di prova ─────
const google = (() => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicKey, cfg: { issuerId: '3388000000012345678', serviceAccount: 'wallet@progetto.iam.gserviceaccount.com', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) } };
})();

/** Una piccola «autorità» e un certificato per il Pass Type ID, come li darebbe Apple (la chiave si può proteggere con una frase). */
function appleFiles(passphrase = '') {
  const dir = path.join(tmp, `apple-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir);
  const run = (args) => openssl(args, { cwd: dir });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wwdr.key', '-out', 'wwdr.pem', '-subj', '/CN=Apple Worldwide Developer Relations (prova)/O=Prova', '-days', '30']);
  if (passphrase) run(['genrsa', '-aes256', '-passout', `pass:${passphrase}`, '-out', 'pass.key', '2048']);
  else run(['genrsa', '-out', 'pass.key', '2048']);
  run(['req', '-new', '-key', 'pass.key', ...(passphrase ? ['-passin', `pass:${passphrase}`] : []), '-out', 'pass.csr', '-subj', '/CN=Pass Type ID: pass.it.prova.prenotazione/UID=pass.it.prova.prenotazione/OU=ABCDE12345/O=Prova']);
  run(['x509', '-req', '-in', 'pass.csr', '-CA', 'wwdr.pem', '-CAkey', 'wwdr.key', '-CAcreateserial', '-out', 'pass.pem', '-days', '30']);
  return { dir, cfg: { passTypeId: 'pass.it.prova.prenotazione', teamId: 'ABCDE12345', certFile: path.join(dir, 'pass.pem'), keyFile: path.join(dir, 'pass.key'), wwdrFile: path.join(dir, 'wwdr.pem'), keyPassphrase: passphrase } };
}

const confirmed = (app, over = {}) => {
  const b = createBooking(app, base({ date: '2027-01-12', time: '09:30', paymentMethod: 'card', ...over }), NOW);
  confirmPaid(app, b.id, `pi_${b.ref}`, NOW);
  return getBooking(app.db, b.id);
};
const decodeJwt = (jwt) => {
  const [h, p, s] = jwt.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')), signed: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
};

test('Google Wallet: link di salvataggio con pass firmato (RS256), nella lingua della pagina; verificabile con la chiave pubblica', () => {
  const app = makeApp({ wallet: { google: google.cfg }, baseUrl: 'https://guida.example' });
  const b = confirmed(app, { name: 'Mario Rossi' });
  const url = googleSaveUrl(app, b, 'it', NOW);
  assert.match(url, /^https:\/\/pay\.google\.com\/gp\/v\/save\/[\w-]+\.[\w-]+\.[\w-]+$/);
  const { header, claims, signed, signature } = decodeJwt(url.split('/save/')[1]);
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(signed), google.publicKey, signature), true, 'la firma torna con la chiave pubblica');
  assert.equal(claims.iss, 'wallet@progetto.iam.gserviceaccount.com');
  assert.equal(claims.aud, 'google');
  assert.equal(claims.typ, 'savetowallet');
  assert.equal(claims.iat, Math.floor(NOW / 1000));
  assert.deepEqual(claims.origins, ['https://guida.example']);
  const [cls] = claims.payload.genericClasses;
  const [obj] = claims.payload.genericObjects;
  assert.equal(cls.id, '3388000000012345678.guida_booking_v1');
  assert.equal(obj.classId, cls.id);
  assert.equal(obj.id, `3388000000012345678.${b.ref}`);
  assert.equal(obj.state, 'ACTIVE');
  assert.equal(obj.header.defaultValue.value, 'Tour di prova');
  assert.equal(obj.header.defaultValue.language, 'it');
  assert.match(obj.subheader.defaultValue.value, /12 gennaio 2027 · 09:30/);
  assert.deepEqual(obj.barcode, { type: 'QR_CODE', value: b.ref, alternateText: b.ref });
  assert.equal(obj.logo.sourceUri.uri, 'https://guida.example/wallet/logo.png');
  assert.deepEqual(obj.textModulesData.map((x) => x.id), ['meeting', 'guests', 'ref']);
  assert.equal(obj.textModulesData.find((x) => x.id === 'guests').body, '2');
  assert.equal(obj.linksModuleData.uris[0].uri, `https://guida.example/it/booking/${b.ref}?t=${b.token}`);
  assert.ok(Date.parse(obj.validTimeInterval.end.date) > Date.parse(obj.validTimeInterval.start.date));
  // un’altra lingua: tutto nella lingua della pagina
  const en = decodeJwt(googleSaveUrl(app, b, 'en', NOW).split('/save/')[1]).claims.payload.genericObjects[0];
  assert.equal(en.header.defaultValue.value, 'Test tour');
  assert.equal(en.header.defaultValue.language, 'en');
  assert.match(en.subheader.defaultValue.value, /January 2027/);
  assert.equal(en.textModulesData[0].header, 'Meeting point');
  // la stessa prenotazione dà sempre lo stesso identificativo (salvare due volte non crea due pass)
  assert.equal(decodeJwt(googleSaveUrl(app, b, 'it', NOW + 5000).split('/save/')[1]).claims.payload.genericObjects[0].id, obj.id);
  // senza configurazione non c'è nulla da offrire
  assert.equal(googleSaveUrl(makeApp(), b, 'it', NOW), null);
});

test('Google Wallet: la chiave si legge anche dal file JSON del service account; dati incompleti o sbagliati lo spengono con un motivo chiaro', () => {
  const file = path.join(tmp, 'service-account.json');
  fs.writeFileSync(file, JSON.stringify({ client_email: 'sa@progetto.iam.gserviceaccount.com', private_key: google.cfg.privateKey }));
  const ok = makeApp({ wallet: { google: { issuerId: '123', keyFile: file } } });
  assert.equal(loadWallet(ok.cfg).google.email, 'sa@progetto.iam.gserviceaccount.com');
  assert.deepEqual(loadWallet(ok.cfg).problems, []);
  // la chiave può arrivare con «\n» al posto degli a capo (come si incolla in una variabile d'ambiente)
  const inline = makeApp({ wallet: { google: { ...google.cfg, privateKey: google.cfg.privateKey.replace(/\n/g, '\\n') } } });
  assert.ok(loadWallet(inline.cfg).google);
  const noKey = makeApp({ wallet: { google: { issuerId: '123', serviceAccount: 'x@y' } } });
  assert.equal(loadWallet(noKey.cfg).google, null);
  assert.match(loadWallet(noKey.cfg).problems.join(), /Google Wallet non attivo: servono l’indirizzo e la chiave/);
  const bad = makeApp({ wallet: { google: { issuerId: '123', serviceAccount: 'x@y', privateKey: 'non è una chiave' } } });
  assert.match(loadWallet(bad.cfg).problems.join(), /Google Wallet non attivo/);
  assert.equal(loadWallet(makeApp().cfg).problems.length, 0, 'se non hai configurato nulla non c’è nessun problema da segnalare');
});

test('Apple Wallet: file .pkpass con tutti i file, manifest corretto e firma PKCS#7 che OpenSSL verifica (anche con la chiave protetta da frase)', { skip: !HAS_OPENSSL && 'serve il comando openssl' }, async () => {
  for (const passphrase of ['', 'frase-segreta']) {
    const files = appleFiles(passphrase);
    const app = makeApp({ wallet: { apple: files.cfg }, baseUrl: 'https://guida.example', site: { email: 'info@example.com', phone: '+39 041 000', whatsapp: '39333' } });
    assert.deepEqual(loadWallet(app.cfg).problems, [], passphrase ? 'chiave con frase' : 'chiave senza frase');
    const b = confirmed(app, { name: 'Mario Rossi', pax: 3 });
    const buf = await applePass(app, b, 'it', NOW);
    assert.equal(buf.subarray(0, 2).toString(), 'PK');

    // il contenuto dello zip
    const file = path.join(files.dir, 'prova.pkpass');
    fs.writeFileSync(file, buf);
    const zip = await openZip(file);
    const read = async (name) => zip.read(zip.entries.find((e) => e.name === name), 1_000_000);
    try {
      assert.deepEqual(zip.entries.map((e) => e.name).sort(), ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'manifest.json', 'pass.json', 'signature']);
      const manifest = JSON.parse(await read('manifest.json'));
      assert.deepEqual(Object.keys(manifest).sort(), ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'pass.json']);
      for (const [name, sha1] of Object.entries(manifest)) assert.equal(crypto.createHash('sha1').update(await read(name)).digest('hex'), sha1, `impronta di ${name}`);
      for (const [name, size] of [['icon.png', 29], ['icon@2x.png', 58], ['icon@3x.png', 87], ['logo.png', 50], ['logo@2x.png', 100]]) {
        const png = await read(name);
        assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name} è un PNG`);
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
      }
      const pass = JSON.parse(await read('pass.json'));
      assert.equal(pass.formatVersion, 1);
      assert.equal(pass.passTypeIdentifier, 'pass.it.prova.prenotazione');
      assert.equal(pass.teamIdentifier, 'ABCDE12345');
      assert.equal(pass.serialNumber, b.ref);
      assert.ok(pass.organizationName && pass.description);
      assert.deepEqual(pass.barcodes, [{ format: 'PKBarcodeFormatQR', message: b.ref, messageEncoding: 'iso-8859-1', altText: b.ref }]);
      assert.equal(pass.eventTicket.primaryFields[0].value, 'Tour di prova');
      assert.match(pass.eventTicket.secondaryFields[0].value, /12 gennaio 2027 · 09:30/);
      assert.equal(pass.eventTicket.auxiliaryFields.find((f) => f.key === 'guests').value, '3');
      assert.equal(pass.eventTicket.backFields.find((f) => f.key === 'manage').value, `https://guida.example/it/booking/${b.ref}?t=${b.token}`);
      assert.match(pass.eventTicket.backFields.find((f) => f.key === 'contact').value, /info@example.com\n\+39 041 000\nhttps:\/\/wa.me\/39333/);
      assert.equal(pass.relevantDate, '2027-01-12T08:30:00.000Z', '09:30 a Venezia');
      assert.ok(Date.parse(pass.expirationDate) > Date.parse(pass.relevantDate));
      for (const key of Object.keys(pass.eventTicket)) assert.ok(['primaryFields', 'secondaryFields', 'auxiliaryFields', 'backFields'].includes(key));
      assert.equal((await openZip(file).then(async (z) => { const e = z.entries.length; await z.close(); return e; })), 8);

      // la firma: staccata, PKCS#7 in DER, verificata da OpenSSL sul manifest; con un manifest alterato non torna
      fs.writeFileSync(path.join(files.dir, 'manifest.json'), await read('manifest.json'));
      fs.writeFileSync(path.join(files.dir, 'signature'), await read('signature'));
      const ok = spawnSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-binary', '-noverify', '-out', os.devNull], { cwd: files.dir, encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stderr, /Verification successful/);
      fs.writeFileSync(path.join(files.dir, 'manifest-alterato.json'), Buffer.concat([await read('manifest.json'), Buffer.from(' ')]));
      const bad = spawnSync('openssl', ['smime', '-verify', '-inform', 'DER', '-in', 'signature', '-content', 'manifest-alterato.json', '-binary', '-noverify', '-out', os.devNull], { cwd: files.dir, encoding: 'utf8' });
      assert.notEqual(bad.status, 0, 'un manifest diverso non deve passare');
      // dentro la firma ci sono il certificato del pass e quello intermedio, e la struttura è ASN.1 valida
      const certs = openssl(['pkcs7', '-inform', 'DER', '-in', 'signature', '-print_certs', '-noout'], { cwd: files.dir }).stdout;
      assert.match(certs, /subject=.*Pass Type ID: pass\.it\.prova\.prenotazione/);
      assert.match(certs, /subject=.*Apple Worldwide Developer Relations/);
      const asn1 = openssl(['asn1parse', '-inform', 'DER', '-in', 'signature'], { cwd: files.dir }).stdout;
      assert.match(asn1, /signedData/);
      assert.match(asn1, /sha256/);
      assert.match(asn1, /messageDigest/);
    } finally {
      await zip.close();
    }
    assert.equal(await applePass(makeApp(), b, 'it', NOW), null, 'senza configurazione non si genera nulla');
  }
});

test('Apple Wallet: certificato che non corrisponde alla chiave o file mancanti lo spengono con un motivo chiaro', { skip: !HAS_OPENSSL && 'serve il comando openssl' }, () => {
  const a = appleFiles();
  const other = appleFiles();
  const mismatch = makeApp({ wallet: { apple: { ...a.cfg, keyFile: other.cfg.keyFile } } });
  assert.equal(loadWallet(mismatch.cfg).apple, null);
  assert.match(loadWallet(mismatch.cfg).problems.join(), /Apple Wallet non attivo: la chiave privata non corrisponde al certificato/);
  assert.match(loadWallet(makeApp({ wallet: { apple: { ...a.cfg, teamId: '' } } }).cfg).problems.join(), /manca l’identificativo del team/);
  assert.match(loadWallet(makeApp({ wallet: { apple: { passTypeId: 'pass.x', teamId: 'T' } } }).cfg).problems.join(), /servono il certificato, la chiave privata e il certificato intermedio/);
  assert.match(loadWallet(makeApp({ wallet: { apple: { ...a.cfg, certFile: path.join(a.dir, 'non-esiste.pem') } } }).cfg).problems.join(), /Apple Wallet non attivo/);
  assert.ok(loadWallet(makeApp({ wallet: { apple: a.cfg } }).cfg).apple, 'la configurazione giusta funziona');
});

test('pulsanti del wallet: solo per clienti privati con prenotazione confermata e servizio non finito, e solo se la piattaforma è configurata', () => {
  const app = makeApp({ wallet: { google: google.cfg } });
  const b2c = confirmed(app);
  assert.deepEqual(walletOptions(app, b2c, NOW), { google: true, apple: false });
  assert.deepEqual(walletOptions(app, b2c, NOW + 30 * 86_400_000), { google: false, apple: false }, 'servizio già finito');
  assert.deepEqual(walletOptions(app, { ...b2c, status: 'cancelled' }, NOW), { google: false, apple: false });
  assert.deepEqual(walletOptions(app, { ...b2c, status: 'held' }, NOW), { google: false, apple: false });
  assert.deepEqual(walletOptions(app, { ...b2c, channel: 'b2b' }, NOW), { google: false, apple: false }, 'le agenzie non lo usano');
  assert.deepEqual(walletOptions(makeApp(), b2c, NOW), { google: false, apple: false });
});

test('PNG: il codificatore produce file validi (intestazione, dimensioni, CRC)', () => {
  const rgba = Buffer.alloc(4 * 3 * 2, 255);
  const png = encodePng(3, 2, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 3);
  assert.equal(png.readUInt32BE(20), 2);
  // ogni blocco ha il suo controllo CRC
  let pos = 8;
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.subarray(pos + 4, pos + 8);
    assert.equal(png.readUInt32BE(pos + 8 + len), zlib.crc32(Buffer.concat([type, png.subarray(pos + 8, pos + 8 + len)])), `CRC di ${type}`);
    pos += 12 + len;
  }
});

async function startHttp(wallet) {
  const cfg = createConfig({ __skipDotEnv: true, dataDir: path.join(tmp, `data-${crypto.randomBytes(3).toString('hex')}`), adminPassword: 'segreto-admin', baseUrl: 'http://localhost', demoPayments: true, wallet });
  const { app, server } = createApp({ cfg, db: openDb(':memory:') });
  const http = await new Promise((resolve) => { const s = server.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${http.address().port}`;
  return { app, get: (p, init = {}) => fetch(url + p, { redirect: 'manual', ...init }), close: () => { app.close(); http.close(); } };
}
const tomorrowBooking = (app, over = {}) => {
  const date = addDays(nowRome().date, 5);
  const b = createBooking(app, { tourSlug: 'san-marco-rialto', date, time: '09:30', pax: 2, name: 'Mario Rossi', email: 'mario@example.com', lang: 'it', paymentMethod: 'card', ...over });
  if (!over.channel) confirmPaid(app, b.id, `pi_${b.ref}`);
  return getBooking(app.db, b.id);
};

test('wallet sulla pagina della prenotazione: pulsanti e percorsi solo per chi ne ha diritto; il logo per Google è disegnato dal sito', async () => {
  const a = HAS_OPENSSL ? appleFiles() : null;
  const s = await startHttp({ google: google.cfg, ...(a ? { apple: a.cfg } : {}) });
  try {
    const b = tomorrowBooking(s.app);
    const page = await (await s.get(`/it/booking/${b.ref}?t=${b.token}`)).text();
    assert.match(page, /Aggiungi a Google Wallet/);
    assert.ok(page.includes(`href="/it/booking/${b.ref}/wallet/google?t=${b.token}"`));
    if (a) assert.ok(page.includes(`href="/it/booking/${b.ref}/wallet/apple.pkpass?t=${b.token}"`) && page.includes('Aggiungi ad Apple Wallet'));
    assert.match(await (await s.get(`/ja/booking/${b.ref}?t=${b.token}`)).text(), /Google ウォレットに追加/);

    // Google: rimanda al link di salvataggio; token sbagliato o assente = pagina inesistente
    const g = await s.get(`/it/booking/${b.ref}/wallet/google?t=${b.token}`);
    assert.equal(g.status, 302);
    assert.match(g.headers.get('location'), /^https:\/\/pay\.google\.com\/gp\/v\/save\//);
    assert.equal((await s.get(`/it/booking/${b.ref}/wallet/google?t=sbagliato`)).status, 404);
    assert.equal((await s.get(`/it/booking/${b.ref}/wallet/google`)).status, 404);
    // Apple: il file .pkpass
    if (a) {
      const p = await s.get(`/it/booking/${b.ref}/wallet/apple.pkpass?t=${b.token}`);
      assert.equal(p.status, 200);
      assert.equal(p.headers.get('content-type'), 'application/vnd.apple.pkpass');
      assert.match(p.headers.get('content-disposition'), new RegExp(`attachment; filename="${b.ref}.pkpass"`));
      assert.equal(p.headers.get('cache-control'), 'private, no-store');
      assert.equal(Buffer.from(await p.arrayBuffer()).subarray(0, 2).toString(), 'PK');
      assert.equal((await s.get(`/it/booking/${b.ref}/wallet/apple.pkpass?t=no`)).status, 404);
    }
    // non per le agenzie, non per le prenotazioni non confermate o annullate
    const held = tomorrowBooking(s.app, { email: 'altro@example.com', channel: undefined, paymentMethod: 'card', date: addDays(nowRome().date, 6) });
    await s.app.services.cancel(held.id, { by: 'admin', refund: 'full' });
    assert.equal((await s.get(`/it/booking/${held.ref}/wallet/google?t=${held.token}`)).status, 404, 'annullata');
    assert.ok(!(await (await s.get(`/it/booking/${held.ref}?t=${held.token}`)).text()).includes('Wallet'));
    const acct = addAccount(s.app.db, { email: 'agenzia@example.com' });
    const b2b = createBooking(s.app, { tourSlug: 'san-marco-rialto-agenzie', date: addDays(nowRome().date, 7), time: '09:30', pax: 2, channel: 'b2b', account: acct, name: 'Anna', email: acct.email, lang: 'it', paymentMethod: 'invoice' });
    assert.equal((await s.get(`/it/booking/${b2b.ref}/wallet/google?t=${b2b.token}`)).status, 404);
    assert.ok(!(await (await s.get(`/it/booking/${b2b.ref}?t=${b2b.token}`)).text()).includes('Wallet'));

    // il logo per Google Wallet
    const logo = await s.get('/wallet/logo.png');
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await logo.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 192);
  } finally {
    s.close();
  }

  // senza configurazione: nessun pulsante e nessun percorso
  const off = await startHttp({});
  try {
    const b = tomorrowBooking(off.app);
    const page = await (await off.get(`/it/booking/${b.ref}?t=${b.token}`)).text();
    assert.ok(!page.includes('Wallet') && !page.includes('wallet'));
    assert.equal((await off.get(`/it/booking/${b.ref}/wallet/google?t=${b.token}`)).status, 404);
    assert.equal((await off.get(`/it/booking/${b.ref}/wallet/apple.pkpass?t=${b.token}`)).status, 404);
  } finally {
    off.close();
  }
});
