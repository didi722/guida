// Client minimo per i servizi compatibili con Amazon S3 (Backblaze B2, Cloudflare R2, Wasabi, Scaleway, Hetzner, MinIO, AWS…).
// Fa solo ciò che serve alla copia automatica: scrivere un file, controllarlo, elencare, cancellare e dare un indirizzo temporaneo per scaricarlo.
// La firma è AWS Signature Version 4, scritta a mano (nessuna libreria) e provata sugli esempi della documentazione di Amazon.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
export const EMPTY_SHA256 = sha256('');
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

/** Come lo vuole AWS: tutto tranne A-Z a-z 0-9 - _ . ~ diventa %XX (maiuscolo). */
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p) => p.split('/').map(enc).join('/');

/** 20130524T000000Z */
export const amzDateOf = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, '');

const signingKey = (secret, day, region, service) => hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');
const canonicalQuery = (query) =>
  Object.entries(query)
    .map(([k, v]) => [enc(k), enc(String(v ?? ''))])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

/**
 * Firma una richiesta con l'intestazione Authorization (funzione pura: la data si passa, così si prova con gli esempi di Amazon).
 * @param {object} r
 * @param {string} r.method
 * @param {string} r.host intestazione Host (con la porta, se non è quella normale)
 * @param {string} r.path percorso così com'è (non codificato), per esempio «/bucket/guida/file.zip»
 * @param {Record<string,string>} [r.query]
 * @param {Record<string,string>} [r.headers] altre intestazioni da firmare (nomi in minuscolo)
 * @param {string} r.payloadHash SHA-256 esadecimale del corpo, oppure UNSIGNED-PAYLOAD
 */
export function signRequest({ method, host, path, query = {}, headers = {}, payloadHash, accessKey, secretKey, region, amzDate, service = 's3' }) {
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, encPath(path), canonicalQuery(query), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretKey, day, region, service)).update(stringToSign).digest('hex');
  return {
    signature,
    canonicalRequest,
    stringToSign,
    signedHeaders,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: { ...headers, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
  };
}

/** Un indirizzo che permette di scaricare un file per un po' (firma nell'indirizzo, senza intestazioni). */
export function presignUrl({ method = 'GET', protocol = 'https:', host, path, query = {}, accessKey, secretKey, region, amzDate, expires = 300, service = 's3' }) {
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const q = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKey}/${scope}`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const canonicalRequest = [method, encPath(path), canonicalQuery(q), `host:${host}\n`, 'host', UNSIGNED_PAYLOAD].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secretKey, day, region, service)).update(stringToSign).digest('hex');
  return `${protocol}//${host}${encPath(path)}?${canonicalQuery(q)}&X-Amz-Signature=${signature}`;
}

// ───────────── il client ─────────────
export class S3Error extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
    this.code = code;
  }
}

const decodeXml = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-fA-F]+);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e] ?? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1]) : '';
};

/** Cosa è andato storto, in parole di tutti i giorni (mai con le chiavi dentro). */
export function explain(status, code, message = '') {
  const byCode = {
    SignatureDoesNotMatch: 'La chiave segreta non corrisponde alla chiave di accesso (o la regione è sbagliata): ricontrolla le due chiavi e la regione.',
    InvalidAccessKeyId: 'La chiave di accesso non esiste: ricontrollala.',
    InvalidSecurity: 'Le chiavi non sono valide.',
    NoSuchBucket: 'Il bucket non esiste: ricontrolla il nome (e l’indirizzo del servizio).',
    AccessDenied: 'Accesso negato: la chiave non può scrivere in questo bucket. Servono i permessi di lettura, scrittura ed elenco sul bucket.',
    AccountProblem: 'Il servizio segnala un problema con l’account (pagamento o sospensione).',
    RequestTimeTooSkewed: 'L’orologio del server è sfasato: sistemalo (ora automatica) e riprova.',
    ExpiredToken: 'La chiave temporanea è scaduta.',
    AuthorizationHeaderMalformed: 'La regione non è quella giusta per questo servizio: ricontrollala.',
    PermanentRedirect: 'L’indirizzo non è quello giusto per questo bucket (regione diversa): ricontrolla indirizzo e regione.',
    SlowDown: 'Il servizio ci chiede di rallentare: riprovo più tardi.',
    EntityTooLarge: 'Il file è troppo grande per il servizio.',
    QuotaExceeded: 'Spazio esaurito sul servizio di archiviazione.',
  };
  if (byCode[code]) return `${byCode[code]} (${code})`;
  if (status === 403) return `Accesso negato dal servizio${code ? ` (${code})` : ''}: controlla le chiavi e i permessi.`;
  if (status === 404) return `Non trovato dal servizio${code ? ` (${code})` : ''}: controlla indirizzo, bucket e prefisso.`;
  if (status === 301 || status === 307) return 'L’indirizzo del servizio non è quello giusto per questo bucket: controlla indirizzo e regione.';
  if (status >= 500) return `Il servizio ha avuto un problema (${status}): riproverò più tardi.`;
  return `Il servizio ha risposto ${status}${code ? ` (${code})` : ''}${message ? `: ${message.slice(0, 120)}` : ''}.`;
}

/** Perché una richiesta non è nemmeno arrivata (rete, indirizzo, orologio…). */
export function explainNetwork(err) {
  const code = err?.cause?.code ?? err?.code ?? '';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'Il servizio non ha risposto in tempo.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Non trovo l’indirizzo del servizio: controlla l’endpoint.';
  if (code === 'ECONNREFUSED') return 'Il servizio rifiuta la connessione: controlla indirizzo e porta.';
  if (/CERT|SSL|TLS/i.test(String(code))) return 'Il certificato del servizio non è valido.';
  return `Non riesco a collegarmi al servizio${code ? ` (${code})` : ''}.`;
}

export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * @param {object} o
 * @param {string} o.endpoint indirizzo del servizio, per esempio https://s3.eu-central-003.backblazeb2.com
 * @param {string} o.bucket
 * @param {string} o.region
 * @param {string} o.accessKey
 * @param {string} o.secretKey
 * @param {string} [o.prefix] «cartella» nel bucket, per esempio guida/
 * @param {boolean} [o.pathStyle] true: https://servizio/bucket/file; false: https://bucket.servizio/file
 */
export function createS3({ endpoint, bucket, region, accessKey, secretKey, prefix = '', pathStyle = true, fetchImpl = fetch, now = () => Date.now() }) {
  const base = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
  const cleanPrefix = String(prefix ?? '').replace(/\/{2,}/g, '/').replace(/^\//, '').replace(/([^/])$/, '$1/'); // «guida», «/guida/» e «guida//» sono la stessa cartella
  const target = (key) => {
    const full = key === '' ? '' : `${cleanPrefix}${key}`;
    return pathStyle ? { host: base.host, path: `/${bucket}${full ? `/${full}` : ''}` } : { host: `${bucket}.${base.host}`, path: `/${full}` };
  };

  async function request(method, key, { query = {}, body = null, size = 0, payloadHash = EMPTY_SHA256, headers = {}, timeoutMs = 30_000 } = {}) {
    const { host, path } = target(key);
    const signed = signRequest({ method, host, path, query, headers, payloadHash, accessKey, secretKey, region, amzDate: amzDateOf(now()) });
    const qs = canonicalQuery(query);
    const init = { method, headers: { ...signed.headers, authorization: signed.authorization }, signal: AbortSignal.timeout(timeoutMs) };
    delete init.headers.host; // la imposta fetch dall'indirizzo
    if (body) {
      init.body = body;
      init.duplex = 'half';
      init.headers['content-length'] = String(size);
    }
    let res;
    try {
      res = await fetchImpl(`${base.protocol}//${host}${encPath(path)}${qs ? `?${qs}` : ''}`, init);
    } catch (err) {
      throw new S3Error(explainNetwork(err));
    }
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    const code = tag(text, 'Code');
    throw new S3Error(explain(res.status, code, tag(text, 'Message')), { status: res.status, code });
  }

  return {
    /** Carica un file dal disco (letto a pezzi, non in memoria). */
    async putFile(key, file, { sha256: hash = null, timeoutMs = 15 * 60_000 } = {}) {
      const size = fs.statSync(file).size;
      const payloadHash = hash ?? (await sha256File(file));
      await request('PUT', key, { body: Readable.toWeb(fs.createReadStream(file)), size, payloadHash, headers: { 'content-type': 'application/zip' }, timeoutMs });
      return { size };
    },

    /** Carica un contenuto breve (in memoria). */
    async putBuffer(key, buffer, { contentType = 'text/plain' } = {}) {
      await request('PUT', key, { body: buffer, size: buffer.length, payloadHash: sha256(buffer), headers: { 'content-type': contentType } });
    },

    /** Dimensione e data di un file, o null se non c'è. */
    async head(key) {
      try {
        const res = await request('HEAD', key);
        return { size: Number(res.headers.get('content-length') ?? 0), etag: res.headers.get('etag') ?? '', modified: res.headers.get('last-modified') ?? '' };
      } catch (err) {
        if (err instanceof S3Error && err.status === 404) return null;
        throw err;
      }
    },

    async delete(key) {
      await request('DELETE', key);
    },

    /** Tutti i file sotto il prefisso (anche su più pagine di risultati): [{ key, name, size, modified }]. */
    async list() {
      const out = [];
      let token = '';
      do {
        const query = { 'list-type': '2', prefix: cleanPrefix, ...(token ? { 'continuation-token': token } : {}) };
        const xml = await (await request('GET', '', { query })).text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = tag(m[1], 'Key');
          out.push({ key, name: key.slice(cleanPrefix.length), size: Number(tag(m[1], 'Size')), modified: tag(m[1], 'LastModified') });
        }
        token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : '';
      } while (token);
      return out;
    },

    /** Un indirizzo per scaricare un file (vale pochi minuti). `filename` lo fa scaricare invece di aprirlo. */
    presign(key, { expires = 300, filename = '' } = {}) {
      const { host, path } = target(key);
      return presignUrl({
        protocol: base.protocol,
        host,
        path,
        query: filename ? { 'response-content-disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"` } : {},
        accessKey,
        secretKey,
        region,
        amzDate: amzDateOf(now()),
        expires,
      });
    },

    /** Prova la connessione come la userà la copia: scrive un file piccolo, lo ritrova e lo cancella. */
    async check() {
      const key = `prova-connessione-${crypto.randomBytes(4).toString('hex')}.txt`;
      const body = Buffer.from(`Prova di connessione ${new Date(now()).toISOString()}\n`);
      await this.putBuffer(key, body);
      let seen;
      try {
        seen = await this.head(key);
      } finally {
        await this.delete(key).catch(() => {});
      }
      if (!seen || seen.size !== body.length) throw new S3Error('Il file di prova è stato scritto ma non lo ritrovo uguale: il servizio non sembra compatibile.');
    },
  };
}
