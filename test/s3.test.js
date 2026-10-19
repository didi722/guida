// Client S3: la firma AWS Signature V4 provata sugli esempi della documentazione di Amazon, e il client contro un finto servizio
// che ricalcola la firma di ogni richiesta (così si controlla che ciò che si firma è ciò che si invia).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';
import { EMPTY_SHA256, S3Error, amzDateOf, createS3, explain, explainNetwork, presignUrl, sha256File, signRequest } from '../server/s3.js';
import { fakeS3 } from './fake-s3.js';

const tmp = path.join(ROOT, 'data', 'test-s3-' + crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(tmp, { recursive: true });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ───────────── gli esempi della documentazione di Amazon (Signature Version 4, bucket «examplebucket») ─────────────
const AWS = { accessKey: 'AKIAIOSFODNN7EXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', amzDate: '20130524T000000Z', host: 'examplebucket.s3.amazonaws.com' };

test('firma V4: GET di un file con intervallo (esempio di Amazon)', () => {
  const r = signRequest({ ...AWS, method: 'GET', path: '/test.txt', headers: { range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256 });
  assert.equal(
    r.canonicalRequest,
    ['GET', '/test.txt', '', 'host:examplebucket.s3.amazonaws.com', 'range:bytes=0-9', `x-amz-content-sha256:${EMPTY_SHA256}`, 'x-amz-date:20130524T000000Z', '', 'host;range;x-amz-content-sha256;x-amz-date', EMPTY_SHA256].join('\n'),
  );
  assert.equal(r.stringToSign.split('\n')[3], '7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972', 'hash della richiesta canonica');
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(r.authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('firma V4: PUT con il «$» nel nome e intestazioni in più (esempio di Amazon)', () => {
  const r = signRequest({ ...AWS, method: 'PUT', path: '/test$file.text', headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, payloadHash: crypto.createHash('sha256').update('Welcome to Amazon S3.').digest('hex') });
  assert.match(r.canonicalRequest, /^PUT\n\/test%24file\.text\n\n/);
  assert.equal(r.signedHeaders, 'date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class');
  assert.equal(r.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('firma V4: parametri senza valore e parametri ordinati (esempi di Amazon)', () => {
  assert.equal(signRequest({ ...AWS, method: 'GET', path: '/', query: { lifecycle: '' }, payloadHash: EMPTY_SHA256 }).signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  const list = signRequest({ ...AWS, method: 'GET', path: '/', query: { prefix: 'J', 'max-keys': '2' }, payloadHash: EMPTY_SHA256 });
  assert.match(list.canonicalRequest, /^GET\n\/\nmax-keys=2&prefix=J\n/, 'in ordine alfabetico anche se dati in disordine');
  assert.equal(list.signature, '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

test('indirizzo firmato (esempio di Amazon)', () => {
  const url = presignUrl({ ...AWS, method: 'GET', path: '/test.txt', expires: 86400 });
  assert.equal(
    url,
    'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
});

test('codifica: spazi, accenti e simboli nei nomi, valori doppi con spazi nelle intestazioni', () => {
  const r = signRequest({ ...AWS, method: 'GET', path: '/cartella/è un file (1)!.zip', headers: { 'x-amz-meta-nome': '  due   spazi  ' }, payloadHash: EMPTY_SHA256 });
  assert.match(r.canonicalRequest, /^GET\n\/cartella\/%C3%A8%20un%20file%20%281%29%21\.zip\n/);
  assert.match(r.canonicalRequest, /x-amz-meta-nome:due spazi\n/, 'spazi attorno tolti e ripetuti ridotti a uno');
  assert.equal(amzDateOf(Date.UTC(2013, 4, 24, 0, 0, 0)), '20130524T000000Z');
  assert.equal(amzDateOf(Date.UTC(2027, 0, 4, 9, 5, 7, 123)), '20270104T090507Z');
});

// ───────────── il client contro il finto servizio ─────────────
const make = (s3, extra = {}) => createS3({ ...s3.config(), ...extra });
const tmpFile = (name, size) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, crypto.randomBytes(size));
  return file;
};

test('scrivere, controllare, elencare e cancellare: il servizio ricalcola le firme e le accetta', async () => {
  const s3srv = await fakeS3({ pageSize: 2 });
  try {
    const s3 = make(s3srv);
    const file = tmpFile('tre-mega.bin', 3 * 1024 * 1024 + 17);
    const expected = fs.readFileSync(file);
    assert.deepEqual(await s3.putFile('guida-backup-2027-01-04.zip', file), { size: expected.length });
    assert.ok(s3srv.objects.get('guida/guida-backup-2027-01-04.zip').body.equals(expected), 'il file arriva intero, uguale, dentro la cartella del prefisso');
    assert.equal((await s3.head('guida-backup-2027-01-04.zip')).size, expected.length);
    assert.equal(await s3.head('non-esiste.zip'), null);
    // nomi con caratteri strani
    await s3.putBuffer('è un file (1)!.txt', Buffer.from('ciao'));
    assert.equal((await s3.head('è un file (1)!.txt')).size, 4);
    // l'elenco su più pagine (due per volta), solo sotto il prefisso
    s3srv.objects.set('altra-cartella/estraneo.zip', { body: Buffer.from('x'), modified: new Date() });
    for (const d of ['2027-01-05', '2027-01-06', '2027-01-07']) await s3.putBuffer(`guida-backup-${d}.zip`, Buffer.from(d));
    const list = await s3.list();
    assert.deepEqual(list.map((o) => o.name), ['guida-backup-2027-01-04.zip', 'guida-backup-2027-01-05.zip', 'guida-backup-2027-01-06.zip', 'guida-backup-2027-01-07.zip', 'è un file (1)!.txt']);
    assert.ok(list.every((o) => o.key === `guida/${o.name}` && o.size > 0 && !Number.isNaN(Date.parse(o.modified))));
    assert.ok(s3srv.log.filter((l) => l.method === 'GET' && l.query['list-type']).length >= 3, 'più pagine di risultati');
    await s3.delete('guida-backup-2027-01-05.zip');
    assert.equal(await s3.head('guida-backup-2027-01-05.zip'), null);
    assert.ok(s3srv.objects.has('altra-cartella/estraneo.zip'), 'ciò che sta fuori dal prefisso non si tocca');
    assert.equal(await sha256File(file), crypto.createHash('sha256').update(expected).digest('hex'));
    // la prova di connessione scrive, ritrova e cancella
    const before = s3srv.objects.size;
    await s3.check();
    assert.equal(s3srv.objects.size, before, 'non lascia nulla');
  } finally {
    await s3srv.close();
  }
});

test('indirizzo temporaneo per scaricare: il servizio lo accetta, e senza la firma giusta no', async () => {
  const s3srv = await fakeS3();
  try {
    const s3 = make(s3srv);
    await s3.putBuffer('guida-backup-2027-01-04.zip', Buffer.from('contenuto della copia'));
    const url = s3.presign('guida-backup-2027-01-04.zip', { expires: 120, filename: 'guida-backup-2027-01-04.zip' });
    assert.match(url, /X-Amz-Expires=120/);
    assert.match(url, /response-content-disposition=attachment%3B%20filename%3D%22guida-backup-2027-01-04\.zip%22/);
    assert.doesNotMatch(url, new RegExp(s3srv.secretKey.replace(/[/]/g, '\\/')), 'la chiave segreta non compare nell’indirizzo');
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'contenuto della copia');
    const tampered = await fetch(url.replace('guida-backup-2027-01-04.zip?', 'altro.zip?'));
    assert.equal(tampered.status, 403);
    const wrongSig = await fetch(url.replace(/X-Amz-Signature=[0-9a-f]{4}/, 'X-Amz-Signature=0000'));
    assert.equal(wrongSig.status, 403);
  } finally {
    await s3srv.close();
  }
});

test('errori: chiavi sbagliate, bucket che non c’è, servizio in avaria, rete assente: parole chiare e mai le chiavi', async () => {
  const s3srv = await fakeS3();
  try {
    const wrongSecret = make(s3srv, { secretKey: 'un-altro-segreto' });
    await assert.rejects(() => wrongSecret.putBuffer('a.txt', Buffer.from('x')), (err) => {
      assert.ok(err instanceof S3Error);
      assert.equal(err.status, 403);
      assert.equal(err.code, 'SignatureDoesNotMatch');
      assert.match(err.message, /chiave segreta non corrisponde/);
      assert.ok(!err.message.includes('un-altro-segreto') && !err.message.includes(s3srv.secretKey));
      return true;
    });
    await assert.rejects(() => make(s3srv, { accessKey: 'AKIAALTRA' }).head('a.txt'), (err) => err.status === 403 && /Accesso negato/.test(err.message));
    await assert.rejects(() => make(s3srv, { bucket: 'non-esiste' }).list(), (err) => err.status === 404 && err.code === 'NoSuchBucket' && /bucket non esiste/.test(err.message));
    await assert.rejects(() => make(s3srv, { region: 'altra-regione' }).putBuffer('a.txt', Buffer.from('x')), (err) => err.status === 403);
    s3srv.hooks.fail = () => ({ status: 503, code: 'SlowDown' });
    await assert.rejects(() => make(s3srv).delete('a.txt'), (err) => err.status === 503 && /rallentare/.test(err.message));
    s3srv.hooks.fail = () => ({ status: 500, code: 'InternalError' });
    await assert.rejects(() => make(s3srv).delete('a.txt'), (err) => /problema \(500\)/.test(err.message));
    s3srv.hooks.fail = null;
    // la rete: porta chiusa e indirizzo che non esiste
    const refused = createS3({ ...s3srv.config(), endpoint: 'http://127.0.0.1:9' });
    await assert.rejects(() => refused.head('a.txt'), (err) => err instanceof S3Error && /rifiuta la connessione|collegarmi/.test(err.message));
    const nowhere = createS3({ ...s3srv.config(), endpoint: 'http://questo-indirizzo-non-esiste.invalid' });
    await assert.rejects(() => nowhere.head('a.txt'), (err) => err instanceof S3Error && /Non trovo l’indirizzo|collegarmi/.test(err.message));
  } finally {
    await s3srv.close();
  }
  assert.match(explain(403, 'AccessDenied'), /non può scrivere in questo bucket/);
  assert.match(explain(403, ''), /Accesso negato/);
  assert.match(explain(404, ''), /Non trovato/);
  assert.match(explain(418, 'Teapot', 'sono una teiera'), /418.*Teapot.*teiera/);
  assert.match(explainNetwork({ name: 'TimeoutError' }), /non ha risposto in tempo/);
  assert.match(explainNetwork({ cause: { code: 'ENOTFOUND' } }), /Non trovo l’indirizzo/);
  assert.match(explainNetwork({ cause: { code: 'CERT_HAS_EXPIRED' } }), /certificato/);
  assert.match(explainNetwork(new Error('boh')), /Non riesco a collegarmi/);
});

test('indirizzi: stile «percorso» e stile «bucket.servizio», prefisso normalizzato, porta nell’intestazione Host', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return new Response('', { status: 200, headers: { 'content-length': '5' } });
  };
  const base = { bucket: 'miobucket', region: 'eu-central-003', accessKey: 'AK', secretKey: 'SK', fetchImpl, now: () => Date.UTC(2027, 0, 4, 9, 0, 0) };
  await createS3({ ...base, endpoint: 'https://s3.eu-central-003.backblazeb2.com', prefix: 'guida', pathStyle: true }).head('a b.zip');
  assert.equal(seen[0].url, 'https://s3.eu-central-003.backblazeb2.com/miobucket/guida/a%20b.zip');
  await createS3({ ...base, endpoint: 's3.example.com:9000', prefix: '/guida/sito//', pathStyle: false }).head('x.zip');
  assert.equal(seen[1].url, 'https://miobucket.s3.example.com:9000/guida/sito/x.zip');
  await createS3({ ...base, endpoint: 'http://localhost:9000', prefix: '', pathStyle: true }).head('x.zip');
  assert.equal(seen[2].url, 'http://localhost:9000/miobucket/x.zip');
  assert.ok(/^AWS4-HMAC-SHA256 Credential=AK\/20270104\/eu-central-003\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(seen[0].headers.authorization));
  assert.equal(seen[0].headers['x-amz-date'], '20270104T090000Z');
  assert.equal(seen[0].headers.host, undefined, 'l’intestazione Host la mette fetch');
  // senza prefisso l'elenco guarda tutto il bucket
  await createS3({ ...base, endpoint: 'http://localhost:9000', prefix: '' }).list().catch(() => {});
  assert.match(seen.at(-1).url, /\?list-type=2&prefix=$/);
});
