// Un finto servizio S3 per le prove: tiene i file in memoria e, come quello vero, RICALCOLA la firma di ogni richiesta
// dai dati che gli arrivano (metodo, indirizzo, percorso, parametri, intestazioni firmate, hash del corpo) e rifiuta se non coincide.
// La funzione di firma è la stessa del sito, ma è provata contro gli esempi della documentazione di Amazon (test/s3.test.js):
// qui si controlla che ciò che il sito FIRMA sia davvero ciò che INVIA.
import crypto from 'node:crypto';
import http from 'node:http';
import { presignUrl, signRequest } from '../server/s3.js';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const xmlError = (code, message) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * @param {{ bucket?: string, accessKey?: string, secretKey?: string, region?: string, pageSize?: number }} [o]
 */
export async function fakeS3({ bucket = 'bucket-prova', accessKey = 'AKIAPROVA', secretKey = 'segreto-di-prova/abc123', region = 'eu-test-1', pageSize = 1000 } = {}) {
  const objects = new Map(); // chiave → { body, modified }
  const log = []; // { method, key, status, query }
  const hooks = { fail: null }; // fail(method, key) → { status, code } per simulare un guasto
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const rawPath = url.pathname;
      const done = (status, text = '', headers = {}) => {
        log.push({ method: req.method, key, status, query: Object.fromEntries(url.searchParams) });
        res.writeHead(status, { 'content-type': 'application/xml', ...headers });
        res.end(req.method === 'HEAD' ? undefined : text);
      };
      const segments = rawPath.split('/').filter(Boolean).map(decodeURIComponent);
      const key = segments.slice(1).join('/');
      if (segments[0] !== bucket) return done(404, xmlError('NoSuchBucket', 'The specified bucket does not exist'));

      const q = Object.fromEntries(url.searchParams);
      let authorized = false;
      if (q['X-Amz-Signature']) {
        // indirizzo firmato per scaricare
        const { 'X-Amz-Signature': given, ...rest } = q;
        const again = new URL(
          presignUrl({ method: req.method, host: req.headers.host, path: rawPath.split('/').map(decodeURIComponent).join('/'), query: Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith('X-Amz-'))), accessKey, secretKey, region, amzDate: q['X-Amz-Date'], expires: Number(q['X-Amz-Expires']) }),
        );
        authorized = again.searchParams.get('X-Amz-Signature') === given;
      } else {
        const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(req.headers.authorization ?? '');
        if (m) {
          const [, ak, , rg, signed, signature] = m;
          const headers = {};
          for (const name of signed.split(';')) if (!['host', 'x-amz-content-sha256', 'x-amz-date'].includes(name)) headers[name] = req.headers[name];
          const expected = signRequest({
            method: req.method,
            host: req.headers.host,
            path: rawPath.split('/').map(decodeURIComponent).join('/'),
            query: q,
            headers,
            payloadHash: req.headers['x-amz-content-sha256'],
            accessKey,
            secretKey,
            region,
            amzDate: req.headers['x-amz-date'],
          });
          authorized = ak === accessKey && rg === region && expected.signature === signature && expected.signedHeaders === signed;
          if (authorized && !['UNSIGNED-PAYLOAD'].includes(req.headers['x-amz-content-sha256']) && sha(body) !== req.headers['x-amz-content-sha256']) return done(400, xmlError('XAmzContentSHA256Mismatch', 'The provided x-amz-content-sha256 header does not match what was computed.'));
        }
      }
      if (!authorized) return done(403, xmlError('SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided.'));
      const forced = hooks.fail?.(req.method, key);
      if (forced) return done(forced.status, xmlError(forced.code, 'forced'));

      if (req.method === 'PUT') {
        objects.set(key, { body, modified: new Date() });
        return done(200, '', { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` });
      }
      if (req.method === 'HEAD') {
        const o = objects.get(key);
        return o ? done(200, '', { 'content-length': String(o.body.length), 'last-modified': o.modified.toUTCString() }) : done(404);
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        return done(204);
      }
      if (req.method === 'GET' && key === '' && q['list-type'] === '2') {
        const keys = [...objects.keys()].filter((k) => k.startsWith(q.prefix ?? '')).sort();
        const start = q['continuation-token'] ? keys.findIndex((k) => k > q['continuation-token']) : 0;
        const page = start < 0 ? [] : keys.slice(start, start + pageSize);
        const more = start >= 0 && start + pageSize < keys.length;
        return done(200, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${esc(q.prefix ?? '')}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${esc(page.at(-1))}</NextContinuationToken>` : ''}${page.map((k) => `<Contents><Key>${esc(k)}</Key><LastModified>${objects.get(k).modified.toISOString()}</LastModified><Size>${objects.get(k).body.length}</Size></Contents>`).join('')}</ListBucketResult>`);
      }
      if (req.method === 'GET') {
        const o = objects.get(key);
        return o ? done(200, o.body, { 'content-type': 'application/zip' }) : done(404, xmlError('NoSuchKey', 'not found'));
      }
      return done(405, xmlError('MethodNotAllowed', 'no'));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  return {
    endpoint,
    bucket,
    accessKey,
    secretKey,
    region,
    objects,
    log,
    hooks,
    /** Le impostazioni da dare al sito per usare questo servizio. */
    config: (extra = {}) => ({ endpoint, bucket, region, accessKey, secretKey, prefix: 'guida/', pathStyle: true, ...extra }),
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
