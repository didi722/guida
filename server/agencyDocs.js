// Documenti dell'agenzia per il suo cliente finale: nome, logo e recapiti sui voucher e sui preventivi, e il ricarico dei preventivi.
// Solo regole e database; i PDF stanno in pdf.js (voucher) e pdf-quote.js (preventivo).
//
// Il preventivo mostra al cliente la tariffa dell'agenzia più il suo ricarico (arrotondato per eccesso a 1, 5 o 10 euro, riga per riga):
// la tariffa dell'agenzia non compare mai. Il logo si carica dal browser (già ridimensionato, PNG o JPEG) e si controlla qui.
import PDFDocument from 'pdfkit';
import { cleanText } from './util.js';

export const LOGO_MAX_BYTES = 500 * 1024;
export const LOGO_MIN_SIDE = 24;
export const LOGO_MAX_SIDE = 2000; // il browser lo porta a 700 px: oltre è un file costruito apposta, e decodificarlo a ogni voucher costerebbe memoria
export const MARKUP_MAX = 300; // %
export const ROUNDS = [1, 5, 10];

export class DocsError extends Error {
  /** `code`: logo | markup | invalid */
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

// ───────────── profilo ─────────────
/** Il nome, i recapiti, la nota e il ricarico predefinito dell'agenzia, con i valori di partenza. */
export function readProfile(acct) {
  return {
    name: acct.doc_name ?? '',
    contact: acct.doc_contact ?? '',
    footer: acct.doc_footer ?? '',
    markup: Number(acct.markup_percent) || 0,
    round: ROUNDS.includes(Number(acct.markup_round)) ? Number(acct.markup_round) : 5,
    logoOnVoucher: acct.logo_on_voucher !== 0,
  };
}

/** Un ricarico valido (0–300%, al massimo due decimali) o null. */
export function parseMarkup(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= MARKUP_MAX ? Math.round(n * 100) / 100 : null;
}
export const parseRound = (v) => (ROUNDS.includes(Number(v)) ? Number(v) : null);

/** Salva il profilo dal modulo. @throws {DocsError} markup se il ricarico non è un numero tra 0 e 300 */
export function saveProfile(db, accountId, form = {}) {
  const markup = parseMarkup(form.markup ?? '0');
  if (markup == null) throw new DocsError('markup');
  const round = parseRound(form.round) ?? 5;
  db.prepare('UPDATE accounts SET doc_name = ?, doc_contact = ?, doc_footer = ?, markup_percent = ?, markup_round = ?, logo_on_voucher = ? WHERE id = ?').run(
    cleanText(form.name, 80) || null,
    cleanText(form.contact, 160) || null,
    cleanText(form.footer, 400) || null,
    markup,
    round,
    form.logoOnVoucher ? 1 : 0,
    accountId,
  );
}

// ───────────── logo ─────────────
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Larghezza e altezza di un PNG dall'intestazione; null se non è un PNG normale (non interlacciato). */
function pngSize(buf) {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  if (buf[28] !== 0) return null; // interlacciato: non lo trattiamo
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Larghezza e altezza di un JPEG dal primo marcatore «Start Of Frame»; null se non si trovano. */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** Prova a disegnare l'immagine in un PDF: se PDFKit non la sa leggere, meglio saperlo subito che al momento di un voucher. */
async function embedsFine(data) {
  const doc = new PDFDocument({ size: 'A6' });
  try {
    await new Promise((resolve, reject) => {
      doc.on('data', () => {});
      doc.on('end', resolve);
      doc.on('error', reject);
      try {
        doc.image(data, 10, 10, { fit: [60, 40] });
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Il logo inviato dal browser («data:image/png;base64,…»): PNG o JPEG, fino a 500 KB, lato tra 24 e 2000 px, di forma ragionevole
 * e che PDFKit sappia disegnare.
 * @returns {Promise<{mime: string, data: Buffer, width: number, height: number}>}
 * @throws {DocsError} logo
 */
export async function parseLogo(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new DocsError('logo');
  const data = Buffer.from(m[2], 'base64');
  if (!data.length || data.length > LOGO_MAX_BYTES) throw new DocsError('logo');
  const size = m[1] === 'png' ? pngSize(data) : jpegSize(data);
  if (!size) throw new DocsError('logo');
  const { width, height } = size;
  if (width < LOGO_MIN_SIDE || height < LOGO_MIN_SIDE || width > LOGO_MAX_SIDE || height > LOGO_MAX_SIDE || width / height > 8 || height / width > 6) throw new DocsError('logo');
  if (!(await embedsFine(data))) throw new DocsError('logo');
  return { mime: `image/${m[1]}`, data, width, height };
}

export const getLogo = (db, accountId) => db.prepare('SELECT mime, data, width, height, updated_at FROM account_logos WHERE account_id = ?').get(accountId) ?? null;

export function setLogo(db, accountId, logo, nowMs = Date.now()) {
  db.prepare(
    `INSERT INTO account_logos (account_id, mime, data, width, height, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, width = excluded.width, height = excluded.height, updated_at = excluded.updated_at`,
  ).run(accountId, logo.mime, logo.data, logo.width, logo.height, new Date(nowMs).toISOString());
}

export const removeLogo = (db, accountId) => db.prepare('DELETE FROM account_logos WHERE account_id = ?').run(accountId).changes === 1;

/**
 * Cosa mettere sui documenti dell'agenzia: nome (quello scelto, o la ragione sociale), recapiti, nota, e il logo se c'è.
 * `logo`: { data, width, height } oppure null.
 */
export function brandOf(app, accountId) {
  const acct = app.db.prepare('SELECT company, doc_name, doc_contact, doc_footer, logo_on_voucher FROM accounts WHERE id = ?').get(accountId);
  if (!acct) return null;
  const logo = getLogo(app.db, accountId);
  return { name: acct.doc_name || acct.company, contact: acct.doc_contact ?? '', footer: acct.doc_footer ?? '', logo: logo ? { data: logo.data, width: logo.width, height: logo.height } : null, logoOnVoucher: acct.logo_on_voucher !== 0 };
}

// ───────────── prezzi del preventivo ─────────────
/** Il prezzo al cliente: la tariffa dell'agenzia più il ricarico, arrotondato per eccesso a `round` euro. Con ricarico 0 resta la tariffa. */
export function clientPrice(netCents, markup, round = 5) {
  if (!(markup > 0)) return netCents;
  const step = Math.max(1, round) * 100; // in centesimi
  const basisPoints = Math.round(markup * 100); // il ricarico ha al massimo due decimali: così il calcolo resta tra numeri interi
  return Math.ceil((netCents * (10_000 + basisPoints)) / (step * 10_000)) * step;
}

/**
 * Le righe del preventivo: per ogni prenotazione la tariffa dell'agenzia (`netCents`) e il prezzo al cliente (`cents`), e i totali.
 * Solo opzioni e prenotazioni confermate; le altre non entrano.
 */
export function buildQuote(bookings, { markup = 0, round = 5 } = {}) {
  const lines = bookings
    .filter((b) => b.status === 'option' || b.status === 'confirmed')
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time) || a.id - b.id)
    .map((b) => ({ booking: b, netCents: b.total_cents, cents: clientPrice(b.total_cents, markup, round) }));
  return { lines, netCents: lines.reduce((s, l) => s + l.netCents, 0), totalCents: lines.reduce((s, l) => s + l.cents, 0) };
}
