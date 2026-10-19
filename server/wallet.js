// «Aggiungi al wallet» del telefono (Google Wallet e Apple Wallet) dalla pagina della prenotazione, solo per i clienti privati.
//
// Nessun servizio esterno viene chiamato dal sito:
//  - Google Wallet: il pulsante apre un link di salvataggio che contiene il pass firmato (JWT RS256) con la chiave del tuo «service account»;
//  - Apple Wallet: il sito costruisce il file .pkpass (zip con pass.json, immagini, manifest e firma PKCS#7) con il tuo certificato Pass Type ID.
// Ogni piattaforma si accende da sola quando ha tutti i dati (vedi docs/GUIDA.md › «Wallet del telefono»); senza, il pulsante non compare.
// Il pass è «fotografia» della prenotazione al momento del salvataggio: se poi viene annullata, il pass sul telefono non cambia da solo.
import { meetingOf } from './choices.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { writeZip } from './backup.js';
import { makeT } from './i18n.js';
import { partyExtra, partyOfBooking } from './party.js';
import { brandIcon } from './png.js';
import { fmtDate, localToInstant } from './time.js';

// ───────────── configurazione ─────────────
/** Esegue `fn`; se OpenSSL protesta con un messaggio tecnico, lo sostituisce con uno comprensibile. */
const friendly = (fn, message) => {
  try {
    return fn();
  } catch {
    throw new Error(message);
  }
};
const read = (inline, file) => (inline ? Buffer.from(String(inline).replace(/\\n/g, '\n')) : file ? fs.readFileSync(file) : null);

function loadGoogle(g) {
  if (!g.issuerId) return null;
  let email = g.serviceAccount;
  let pem = g.privateKey ? String(g.privateKey).replace(/\\n/g, '\n') : '';
  if (g.keyFile) {
    const json = JSON.parse(fs.readFileSync(g.keyFile, 'utf8')); // il file JSON scaricato da Google Cloud per il service account
    email ||= json.client_email;
    pem ||= json.private_key;
  }
  if (!email || !pem) throw new Error('servono l’indirizzo e la chiave privata del service account (GOOGLE_WALLET_KEY_FILE)');
  const key = friendly(() => crypto.createPrivateKey(pem), 'la chiave privata del service account non è leggibile: va copiata per intero, da «-----BEGIN PRIVATE KEY-----» a «-----END PRIVATE KEY-----»');
  if (key.asymmetricKeyType !== 'rsa') throw new Error('la chiave del service account deve essere RSA');
  return { issuerId: String(g.issuerId), email, key };
}

function loadApple(a) {
  if (!a.passTypeId) return null;
  if (!a.teamId) throw new Error('manca l’identificativo del team (APPLE_WALLET_TEAM_ID)');
  const certData = read(a.certPem, a.certFile);
  const keyData = read(a.keyPem, a.keyFile);
  const wwdrData = read(a.wwdrPem, a.wwdrFile);
  if (!certData || !keyData || !wwdrData) throw new Error('servono il certificato, la chiave privata e il certificato intermedio Apple (APPLE_WALLET_CERT_FILE, _KEY_FILE, _WWDR_FILE)');
  const cert = friendly(() => new crypto.X509Certificate(certData), 'il certificato del pass non è leggibile (serve il formato PEM: vedi la guida per convertirlo)');
  const wwdr = friendly(() => new crypto.X509Certificate(wwdrData), 'il certificato intermedio di Apple (WWDR) non è leggibile');
  const key = friendly(() => crypto.createPrivateKey({ key: keyData, passphrase: a.keyPassphrase || undefined }), 'la chiave privata non è leggibile: controlla il file e la frase di protezione (APPLE_WALLET_KEY_PASSPHRASE)');
  if (key.asymmetricKeyType !== 'rsa') throw new Error('la chiave del certificato deve essere RSA');
  if (!cert.checkPrivateKey(key)) throw new Error('la chiave privata non corrisponde al certificato');
  if (Date.parse(cert.validTo) < Date.now()) throw new Error(`il certificato è scaduto il ${cert.validTo}: va rinnovato dal tuo account Apple Developer`);
  return { passTypeId: a.passTypeId, teamId: a.teamId, cert, wwdr, key };
}

const loaded = new WeakMap();
/** Le piattaforme configurate e funzionanti, più i motivi per cui una non lo è. Si legge una volta sola per configurazione. */
export function loadWallet(cfg) {
  if (!loaded.has(cfg)) {
    const out = { google: null, apple: null, problems: [] };
    for (const [name, load, conf] of [['Google Wallet', loadGoogle, cfg.wallet?.google ?? {}], ['Apple Wallet', loadApple, cfg.wallet?.apple ?? {}]]) {
      try {
        out[name === 'Google Wallet' ? 'google' : 'apple'] = load(conf);
      } catch (err) {
        out.problems.push(`${name} non attivo: ${err.message}`);
      }
    }
    for (const p of out.problems) console.warn(`[wallet] ${p}`);
    loaded.set(cfg, out);
  }
  return loaded.get(cfg);
}

/** Cosa si può offrire per questa prenotazione: solo clienti privati con prenotazione confermata e servizio non ancora finito. */
export function walletOptions(app, b, nowMs = Date.now()) {
  if (b.channel !== 'b2c' || b.status !== 'confirmed' || localToInstant(b.date, b.end_time || b.start_time) < nowMs) return { google: false, apple: false };
  const w = loadWallet(app.cfg);
  // il certificato di Apple dura un anno: da quando scade il pulsante sparisce (e il pass non verrebbe accettato)
  return { google: !!w.google, apple: !!w.apple && Date.parse(w.apple.cert.validTo) > nowMs };
}

// ───────────── testi e dati del pass ─────────────
function passData(app, b, lang) {
  const { cfg, content } = app;
  const t = makeT(lang);
  const tour = content.tour(b.tour_slug);
  const ti = tour?.i18n[lang] ?? tour?.i18n.it ?? { title: b.tour_slug, meetingPoint: '' };
  const startMs = localToInstant(b.date, b.start_time);
  const endMs = localToInstant(b.date, b.end_time || b.start_time);
  return {
    t, ti, startMs, endMs, name: cfg.site.name, meet: meetingOf(tour, b, lang),
    when: `${fmtDate(b.date, lang)} · ${b.start_time}`,
    bookingUrl: `${cfg.baseUrl}/${lang}/booking/${b.ref}?t=${b.token}`,
  };
}

// ───────────── Google Wallet ─────────────
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Il link «Aggiungi a Google Wallet»: un pass generico (classe condivisa + oggetto della prenotazione) dentro un JWT firmato.
 * @returns {string|null} null se Google Wallet non è configurato
 */
export function googleSaveUrl(app, b, lang, nowMs = Date.now()) {
  const g = loadWallet(app.cfg).google;
  if (!g) return null;
  const { cfg } = app;
  const { t, ti, meet, startMs, endMs, name, when, bookingUrl } = passData(app, b, lang);
  const text = (value) => ({ defaultValue: { language: lang, value: String(value) } });
  const classId = `${g.issuerId}.guida_booking_v1`;
  const object = {
    id: `${g.issuerId}.${b.ref.replace(/[^A-Za-z0-9._-]/g, '_')}`,
    classId,
    state: 'ACTIVE',
    genericType: 'GENERIC_TYPE_UNSPECIFIED',
    hexBackgroundColor: '#d6bb51',
    logo: { sourceUri: { uri: `${cfg.baseUrl}/wallet/logo.png` }, contentDescription: text(name) },
    cardTitle: text(name),
    header: text(ti.title),
    subheader: text(when),
    barcode: { type: 'QR_CODE', value: b.ref, alternateText: b.ref },
    textModulesData: [
      { id: 'meeting', header: t('s.meeting'), body: meet.text },
      { id: 'guests', header: t('s.guests'), body: `${b.participants}${partyExtra(partyOfBooking(b), lang)}` },
      { id: 'ref', header: t('s.ref'), body: b.ref },
    ],
    linksModuleData: { uris: [{ id: 'booking', uri: bookingUrl, description: t('wallet.manage') }] },
    validTimeInterval: { start: { date: new Date(startMs - 3 * 86_400_000).toISOString() }, end: { date: new Date(endMs + 2 * 3_600_000).toISOString() } },
  };
  const claims = { iss: g.email, aud: 'google', typ: 'savetowallet', iat: Math.floor(nowMs / 1000), origins: [cfg.baseUrl], payload: { genericClasses: [{ id: classId }], genericObjects: [object] } };
  const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), g.key);
  return `https://pay.google.com/gp/v/save/${signingInput}.${b64url(signature)}`;
}

// ───────────── Apple Wallet: il file .pkpass ─────────────
// DER (ASN.1) quanto basta per una firma PKCS#7 «staccata» come la vuole Apple.
const derLen = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x82, n >> 8, n & 255]) : Buffer.from([0x83, n >> 16, (n >> 8) & 255, n & 255]));
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
};
const SEQ = (...p) => der(0x30, ...p);
const SET = (...p) => der(0x31, ...p);
const OCTETS = (b) => der(0x04, b);
const NULL = Buffer.from([0x05, 0x00]);
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
};
const OID = { data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', sha256: '2.16.840.1.101.3.4.2.1', sha256Rsa: '1.2.840.113549.1.1.11' };

function readTlv(buf, off) {
  let len = buf[off + 1];
  let hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i];
    hdr = 2 + n;
  }
  return { tag: buf[off], hdr, start: off, end: off + hdr + len };
}
/** L'emittente e il numero di serie di un certificato (così come sono scritti, pronti per «IssuerAndSerialNumber»). */
function issuerAndSerial(certDer) {
  const cert = readTlv(certDer, 0);
  const tbs = readTlv(certDer, cert.start + cert.hdr);
  let pos = tbs.start + tbs.hdr;
  let field = readTlv(certDer, pos);
  if (field.tag === 0xa0) { // versione [0]
    pos = field.end;
    field = readTlv(certDer, pos);
  }
  const serial = certDer.subarray(field.start, field.end);
  const algorithm = readTlv(certDer, field.end);
  const issuer = readTlv(certDer, algorithm.end);
  return SEQ(certDer.subarray(issuer.start, issuer.end), serial);
}

/** Firma PKCS#7 staccata (formato DER, digest SHA-256) del manifest, con il certificato del pass e quello intermedio di Apple. */
export function signManifest(manifest, { cert, wwdr, key }, nowMs = Date.now()) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  const utc = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const attrs = [
    SEQ(oid(OID.contentType), SET(oid(OID.data))),
    SEQ(oid(OID.signingTime), SET(der(0x17, Buffer.from(utc, 'ascii')))),
    SEQ(oid(OID.messageDigest), SET(OCTETS(crypto.createHash('sha256').update(manifest).digest()))),
  ].sort(Buffer.compare); // in DER gli elementi di un SET stanno in ordine di byte
  const toSign = SET(...attrs); // la firma si calcola sul SET (tag 0x31); nel messaggio lo stesso insieme compare con il tag [0]
  const signature = crypto.sign('sha256', toSign, key);
  const sha256Alg = SEQ(oid(OID.sha256), NULL);
  const signerInfo = SEQ(
    der(0x02, Buffer.from([1])),
    issuerAndSerial(cert.raw),
    sha256Alg,
    der(0xa0, ...attrs),
    SEQ(oid(OID.sha256Rsa), NULL),
    OCTETS(signature),
  );
  const signedData = SEQ(der(0x02, Buffer.from([1])), SET(sha256Alg), SEQ(oid(OID.data)), der(0xa0, cert.raw, wwdr.raw), SET(signerInfo));
  return SEQ(oid(OID.signedData), der(0xa0, signedData));
}

/** Il file .pkpass di una prenotazione. @returns {Promise<Buffer|null>} null se Apple Wallet non è configurato */
export async function applePass(app, b, lang, nowMs = Date.now()) {
  const a = loadWallet(app.cfg).apple;
  if (!a) return null;
  const { cfg } = app;
  const { t, ti, meet, startMs, endMs, name, when, bookingUrl } = passData(app, b, lang);
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: a.passTypeId,
    teamIdentifier: a.teamId,
    serialNumber: b.ref,
    organizationName: name,
    description: t('wallet.passDesc'),
    logoText: name,
    foregroundColor: 'rgb(28, 28, 28)',
    backgroundColor: 'rgb(214, 187, 81)',
    labelColor: 'rgb(86, 68, 20)',
    relevantDate: new Date(startMs).toISOString(),
    expirationDate: new Date(endMs + 24 * 3_600_000).toISOString(),
    barcodes: [{ format: 'PKBarcodeFormatQR', message: b.ref, messageEncoding: 'iso-8859-1', altText: b.ref }],
    eventTicket: {
      primaryFields: [{ key: 'tour', label: t('s.service').toUpperCase(), value: ti.title }],
      secondaryFields: [{ key: 'when', label: t('s.date').toUpperCase(), value: when }],
      auxiliaryFields: [
        { key: 'guests', label: t('s.guests').toUpperCase(), value: `${b.participants}${partyExtra(partyOfBooking(b), lang)}` },
        { key: 'ref', label: t('s.ref').toUpperCase(), value: b.ref },
      ],
      backFields: [
        { key: 'meeting', label: t('s.meeting'), value: meet.text },
        { key: 'manage', label: t('wallet.manage'), value: bookingUrl },
        { key: 'contact', label: t('footer.contact'), value: [cfg.site.email, cfg.site.phone, cfg.site.whatsapp ? `https://wa.me/${cfg.site.whatsapp}` : ''].filter(Boolean).join('\n') },
      ],
    },
  };
  const files = new Map([
    ['pass.json', Buffer.from(JSON.stringify(pass))],
    ['icon.png', brandIcon(29)],
    ['icon@2x.png', brandIcon(58)],
    ['icon@3x.png', brandIcon(87)],
    ['logo.png', brandIcon(50)],
    ['logo@2x.png', brandIcon(100)],
  ]);
  const manifest = Buffer.from(JSON.stringify(Object.fromEntries([...files].map(([n, data]) => [n, crypto.createHash('sha1').update(data).digest('hex')]))));
  const signature = signManifest(manifest, a, nowMs);
  const chunks = [];
  await writeZip({ write: (buf, cb) => (chunks.push(Buffer.from(buf)), cb()) }, [...[...files].map(([n, data]) => ({ name: n, data })), { name: 'manifest.json', data: manifest }, { name: 'signature', data: signature }], new Date(nowMs));
  return Buffer.concat(chunks);
}
