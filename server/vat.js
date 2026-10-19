// Partita IVA delle agenzie: controllo formale (paese, formato, cifra di controllo per l'Italia) e verifica sul servizio VIES
// della Commissione europea, che dice se il numero è attivo e, per molti paesi, a quale società e indirizzo appartiene.
// Il risultato aiuta la guida a decidere se approvare un'agenzia: non blocca nessuno da solo (tranne una partita IVA italiana
// con la cifra di controllo sbagliata, che la fattura elettronica non accetterebbe).
import { validItalianVat } from './fatturapa.js';

/** Formato di ciò che segue il prefisso paese dell'IVA (la Grecia usa EL, l'Irlanda del Nord XI). */
export const EU_FORMATS = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  BG: /^\d{9,10}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  EL: /^\d{9}$/,
  ES: /^(?:[A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])$/, // primo e ultimo carattere lettera o cifra, ma non entrambi cifre
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  HR: /^\d{11}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W][A-IW]?|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  LV: /^\d{11}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SE: /^\d{12}$/,
  SI: /^\d{8}$/,
  SK: /^\d{10}$/,
  XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

/** Dal paese (codice ISO, come nel modulo di registrazione) al prefisso dell'IVA. */
const prefixOf = (country) => {
  const c = String(country ?? '').trim().toUpperCase();
  return c === 'GR' ? 'EL' : c;
};

/**
 * Legge una partita IVA scritta come capita: con o senza prefisso paese, con spazi, punti o trattini.
 * @returns {{ id: string, country: string|null, number: string, eu: boolean }} `country`: prefisso IVA se riconosciuto (o dedotto dal paese scelto)
 */
export function parseVat(raw, countryHint = '') {
  const clean = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9+*]/g, '');
  const hint = prefixOf(countryHint);
  const prefix = clean.slice(0, 2);
  const rest = clean.slice(2);
  const hasPrefix = Boolean(EU_FORMATS[prefix]) && rest.length > 0;
  if (hasPrefix && EU_FORMATS[prefix].test(rest)) return { id: clean, country: prefix, number: rest, eu: true };
  if (EU_FORMATS[hint] && EU_FORMATS[hint].test(clean)) return { id: `${hint}${clean}`, country: hint, number: clean, eu: true };
  if (hasPrefix) return { id: clean, country: prefix, number: rest, eu: true }; // il prefisso c'è ma il resto non torna: lo si dirà
  if (EU_FORMATS[hint]) return { id: clean, country: hint, number: clean, eu: true };
  return { id: clean, country: null, number: clean, eu: false };
}

/**
 * La partita IVA senza il prefisso del paese di chi la porta: nella fattura elettronica `IdPaese` e `IdCodice` sono due campi.
 * Toglie il prefisso solo se è quello del paese indicato e il resto ha la forma di quel paese (il resto resta com'è).
 */
export function vatWithoutPrefix(raw, country = '') {
  const clean = String(raw ?? '').replace(/\s+/g, '').toUpperCase().replace(/^IT(?=\d{11}$)/, '');
  const own = prefixOf(country);
  return EU_FORMATS[own] && clean.startsWith(own) && EU_FORMATS[own].test(clean.slice(own.length)) ? clean.slice(own.length) : clean;
}

/** Per le pagine della guida: «IT01234567897» com'è se porta già il prefisso, altrimenti «paese numero» (account vecchi, paesi fuori dall'UE). */
export const vatLabel = (a) => {
  const v = String(a.vat ?? '').trim();
  return /^[A-Z]{2}/i.test(v) ? v : `${a.country ?? ''} ${v}`.trim();
};

/**
 * Controllo formale, senza rete.
 * @returns {{ ok: true } | { ok: false, reason: 'format' | 'checksum' } | { ok: null, reason: 'unsupported' }} `null`: paese fuori dall'UE, non si può dire
 */
export function checkFormat(parsed) {
  if (!parsed.eu || !parsed.country) return { ok: null, reason: 'unsupported' };
  if (!EU_FORMATS[parsed.country].test(parsed.number)) return { ok: false, reason: 'format' };
  if (parsed.country === 'IT' && (/^0+$/.test(parsed.number) || !validItalianVat(parsed.number))) return { ok: false, reason: 'checksum' }; // tutti zeri torna con la cifra di controllo ma non esiste
  return { ok: true };
}

// ───────────── VIES ─────────────
const BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api';
/** Errori del servizio che non dicono nulla sul numero: il paese non risponde, troppe richieste… */
const SERVICE_ERRORS = new Set(['MS_UNAVAILABLE', 'MS_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'VOW_NOT_AVAILABLE', 'MS_ONLY_ONE_REQUEST', 'GLOBAL_ONLY_ONE_REQUEST']);
/** VIES scrive «---» dove non ha il dato. */
const known = (s) => {
  const v = String(s ?? '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
  return v && !/^-+$/.test(v) ? v : '';
};

/**
 * Il servizio VIES (REST). Non lancia mai: un guasto di rete o del paese è «unavailable», non un'IVA non valida.
 * @returns {{ check: (country: string, number: string) => Promise<{ status: 'valid'|'invalid'|'unavailable', name: string, address: string, requestId: string, message: string }> }}
 */
export function createVies({ fetchImpl = fetch, timeoutMs = 8000, baseUrl = BASE } = {}) {
  const parse = (status, body) => {
    const errors = [body?.userError, ...(Array.isArray(body?.errorWrappers) ? body.errorWrappers.map((e) => e?.error) : [])].filter((e) => e && e !== 'VALID' && e !== 'INVALID');
    const valid = body?.valid ?? body?.isValid;
    if (errors.some((e) => SERVICE_ERRORS.has(e)) || (body?.actionSucceed === false && valid !== true && valid !== false)) return { status: 'unavailable', message: errors.join(', ') || 'servizio non disponibile' };
    if (status >= 500 || status === 429) return { status: 'unavailable', message: `errore ${status}` };
    if (errors.includes('INVALID_INPUT')) return { status: 'invalid', message: 'numero non accettato dal servizio' };
    if (valid === true) return { status: 'valid', name: known(body.name), address: known(body.address), requestId: String(body.requestIdentifier ?? '') };
    if (valid === false) return { status: 'invalid' };
    return { status: 'unavailable', message: 'risposta non comprensibile' };
  };
  const call = async (url, init = {}) => {
    const res = await fetchImpl(url, { ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
  return {
    async check(country, number) {
      const empty = { name: '', address: '', requestId: '', message: '' };
      try {
        let r = await call(`${baseUrl}/check-vat-number`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ countryCode: country, vatNumber: number }) });
        if ([404, 405, 415].includes(r.status)) r = await call(`${baseUrl}/ms/${encodeURIComponent(country)}/vat/${encodeURIComponent(number)}`); // la forma più vecchia dell'indirizzo
        return { ...empty, ...parse(r.status, r.body) };
      } catch (err) {
        const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        return { ...empty, status: 'unavailable', message: timeout ? 'il servizio non ha risposto in tempo' : 'servizio non raggiungibile' };
      }
    },
  };
}

// ───────────── confronto del nome ─────────────
const LEGAL = new Set(['srl', 'spa', 'sas', 'snc', 'sapa', 'ss', 'scarl', 'gmbh', 'ag', 'kg', 'ohg', 'ug', 'ltd', 'llc', 'inc', 'plc', 'sa', 'sl', 'slu', 'sarl', 'eurl', 'bv', 'nv', 'ab', 'oy', 'as', 'aps', 'sp', 'zoo', 'srls', 'di', 'e', 'and', 'et', 'und', 'the', 'of', 'del', 'della', 'dei', 'delle', 'la', 'il', 'le', 'los', 'las', 'el']);
const tokens = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !LEGAL.has(w));

/** Il nome scritto dall'agenzia e quello del registro hanno almeno una parola importante in comune? (null se il registro non lo dice) */
export function sameCompany(declared, registered) {
  const b = tokens(registered);
  if (!b.length) return null;
  const a = tokens(declared);
  return a.some((w) => b.includes(w) || b.some((x) => x.includes(w) || w.includes(x)));
}

/** Cosa si sa di una partita IVA appena scritta, prima di interrogare VIES: per l'email alla guida. */
export function formalSummary(parsed) {
  const f = checkFormat(parsed);
  const base = { name: '', address: '', sameName: null };
  if (f.ok === false) return { ...base, status: 'format', label: STATUS.format, message: f.reason === 'checksum' ? 'la cifra di controllo non torna' : 'formato non valido per il paese' };
  if (f.ok === null) return { ...base, status: 'unsupported', label: STATUS.unsupported, message: 'paese fuori dall’UE: il servizio VIES non lo copre' };
  return { ...base, status: null, label: 'formato corretto; il controllo su VIES parte a momenti', message: '' };
}

// ───────────── il servizio, con il database ─────────────
const STATUS = {
  valid: 'Valida',
  invalid: 'Non valida',
  format: 'Formato non valido',
  unavailable: 'Non verificata',
  unsupported: 'Fuori dall’UE',
};
export const VAT_LABEL = STATUS;

/**
 * Verifica la partita IVA di un'agenzia e salva l'esito sul suo account (vat_status, vat_checked_at, vat_name, vat_address).
 * `fetchImpl` e `timeoutMs` servono ai test e a chi vuole un'attesa più breve (la registrazione non aspetta più di qualche secondo).
 */
export function createVat(app, { fetchImpl = fetch } = {}) {
  const { db } = app;
  const save = db.prepare('UPDATE accounts SET vat_status = ?, vat_checked_at = ?, vat_name = ?, vat_address = ? WHERE id = ?');
  const svc = {
    parse: parseVat,
    checkFormat,

    /**
     * Controlla la partita IVA dell'agenzia (formato, poi VIES) e salva l'esito sul suo account.
     * @returns {Promise<{ status: string, label: string, name: string, address: string, message: string, sameName: boolean|null, id: string }>}
     */
    async verify(accountId, { nowMs = Date.now(), timeoutMs = 8000 } = {}) {
      const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (!a) return { status: 'unavailable', label: STATUS.unavailable, name: '', address: '', message: 'agenzia non trovata', sameName: null, id: '' };
      const parsed = parseVat(a.vat, a.country);
      const formal = checkFormat(parsed);
      let out;
      if (formal.ok === false) out = { status: 'format', name: '', address: '', message: formal.reason === 'checksum' ? 'la cifra di controllo non torna' : 'formato non valido per il paese' };
      else if (formal.ok === null) out = { status: 'unsupported', name: '', address: '', message: 'paese fuori dall’UE: il servizio VIES non lo copre' };
      else out = await createVies({ fetchImpl, timeoutMs }).check(parsed.country, parsed.number);
      save.run(out.status, new Date(nowMs).toISOString(), out.name || null, out.address || null, accountId);
      return { status: out.status, label: STATUS[out.status], name: out.name, address: out.address, message: out.message ?? '', sameName: out.status === 'valid' ? sameCompany(a.company, out.name) : null, id: parsed.id };
    },

    /**
     * Lavoro periodico (ogni minuto): controlla su VIES le agenzie nuove — da approvare o registrate da poco — che non hanno ancora un esito,
     * e riprova dopo un'ora quelle per cui il servizio non rispondeva. Poche per volta: VIES non ama le raffiche.
     * @returns {Promise<number>} quante ne ha controllate
     */
    async sweep(nowMs = Date.now()) {
      const hourAgo = new Date(nowMs - 3600_000).toISOString();
      const recent = new Date(nowMs - 2 * 86400_000).toISOString();
      const rows = db
        .prepare(
          `SELECT id FROM accounts WHERE vat IS NOT NULL AND vat != '' AND (status = 'pending' OR created_at >= ?)
             AND (vat_status IS NULL OR (vat_status = 'unavailable' AND (vat_checked_at IS NULL OR vat_checked_at < ?))) ORDER BY id LIMIT 3`,
        )
        .all(recent, hourAgo);
      for (const r of rows) await svc.verify(r.id, { nowMs });
      return rows.length;
    },

    /** L'esito già salvato, per le pagine: stato, a parole, nome e indirizzo del registro e se il nome coincide con quello scritto. */
    summary(a) {
      if (!a.vat_status) return { status: null, label: 'Non ancora verificata', checkedAt: null, name: '', address: '', sameName: null };
      return { status: a.vat_status, label: STATUS[a.vat_status] ?? a.vat_status, checkedAt: a.vat_checked_at, name: a.vat_name ?? '', address: a.vat_address ?? '', sameName: a.vat_status === 'valid' ? sameCompany(a.company, a.vat_name) : null };
    },
  };
  app.jobs?.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
