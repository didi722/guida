import crypto from 'node:crypto';

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // niente 0/O/1/I/L
const randomChars = (n) => Array.from(crypto.randomBytes(n), (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join('');

/** Riferimento breve e leggibile: VE-… prenotazioni, GC-… gift card, PR-… programmi. */
export function newRef(prefix = 'VE') {
  return `${prefix}-${randomChars(6)}`;
}

/** Codice di una gift card: 12 caratteri senza simboli ambigui (si mostra come XXXX-XXXX-XXXX). */
export const newGiftCode = () => randomChars(12);
export const newToken = () => crypto.randomBytes(18).toString('base64url');

export function formatMoney(cents, lang, currency = 'EUR') {
  return new Intl.NumberFormat(lang === 'it' ? 'it-IT' : 'en-GB', { style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(s);

/** Ripulisce un testo libero inserito da un utente (lunghezza massima, niente caratteri di controllo). */
export function cleanText(s, max = 500) {
  if (s == null) return '';
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
