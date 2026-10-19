// Codici a tempo (TOTP, RFC 6238) per l'accesso a due passaggi del pannello: funzioni pure, senza database.
// Compatibili con Google Authenticator, Microsoft Authenticator, Authy, 1Password e simili (SHA-1, 6 cifre, 30 secondi).
import crypto from 'node:crypto';

export const STEP_SECONDS = 30;
export const DIGITS = 6;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648) senza riempimento: è il formato che le app di autenticazione si aspettano. */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Il contrario; ignora spazi, trattini, «=» e le minuscole (le chiavi si copiano a gruppi di quattro). Null se ci sono altri caratteri. */
export function base32Decode(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Una chiave nuova: 160 bit casuali, come consiglia la RFC. */
export const generateSecret = () => crypto.randomBytes(20);

/** HOTP (RFC 4226): il codice per un contatore. */
export function hotp(secret, counter, { digits = DIGITS, algorithm = 'sha1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Il periodo (da 30 secondi) in cui cade un istante. */
export const stepOf = (timeMs, stepSeconds = STEP_SECONDS) => Math.floor(timeMs / 1000 / stepSeconds);

/** Il codice di un istante. */
export const totp = (secret, timeMs, opts = {}) => hotp(secret, stepOf(timeMs, opts.stepSeconds), opts);

/** Confronto che non rivela da dove differiscono le due stringhe. */
function sameCode(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Controlla un codice a 6 cifre: vale quello del periodo in corso e quello subito prima o dopo (l'orologio del telefono
 * non è mai preciso al secondo). Con `after` (l'ultimo periodo già usato) un codice già accettato non vale una seconda volta.
 * @returns {{ok: true, step: number} | {ok: false}}
 */
export function verifyTotp(secret, code, timeMs, { window = 1, after = -1 } = {}) {
  const text = String(code ?? '').replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(text)) return { ok: false };
  const now = stepOf(timeMs);
  let found = -1;
  for (let step = now - window; step <= now + window; step++) {
    // si provano tutti i periodi senza fermarsi al primo: il tempo di risposta non dice quale era quello giusto
    if (sameCode(hotp(secret, step), text) && step > after && step > found) found = step;
  }
  return found >= 0 ? { ok: true, step: found } : { ok: false };
}

/** L'indirizzo `otpauth://` che le app leggono (dal codice QR o toccandolo sul telefono). */
export function otpauthUri({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`;
}

/** La chiave scritta a gruppi di quattro, più comoda da ricopiare a mano. */
export const groupKey = (secret) => base32Encode(secret).replace(/(.{4})(?=.)/g, '$1 ');

// ───────────── codici di emergenza ─────────────
// Dieci codici da usare una volta sola se si perde il telefono: 10 caratteri senza quelli che si confondono (0/O, 1/I).
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_COUNT = 10;

const recoveryCode = () => Array.from({ length: 10 }, () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]).join('');
/** «abcde fghij» e «ABCDE-FGHIJ» sono lo stesso codice. */
export const normalizeRecovery = (text) => String(text ?? '').toUpperCase().replace(/[\s-]/g, '');
/** Ha la forma di un codice di emergenza? (non dice se esiste) */
export const looksLikeRecovery = (text) => new RegExp(`^[${RECOVERY_ALPHABET}]{10}$`).test(normalizeRecovery(text));
/** Come si mostra: ABCDE-FGHIJ. */
export const showRecovery = (code) => `${code.slice(0, 5)}-${code.slice(5)}`;
export const generateRecoveryCodes = (n = RECOVERY_COUNT) => Array.from({ length: n }, recoveryCode);

/**
 * L'impronta con cui si conserva un codice di emergenza (mai il codice): scrypt con un sale per installazione,
 * così nemmeno chi legge il database può provare tutte le combinazioni.
 */
export const hashRecovery = (code, salt) => crypto.scryptSync(normalizeRecovery(code), salt, 32).toString('hex');
