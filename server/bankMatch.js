// Estratto conto della banca (CSV) → bonifici riconosciuti → fatture da segnare come incassate.
// Si legge il file così com'è lo esporta la banca (separatore, decimali, date e nomi delle colonne cambiano da una banca all'altra), si cercano
// gli accrediti che citano il numero di una fattura («Fattura 12/2027») e si propone l'abbinamento. Qui solo lettura e regole:
// nulla viene segnato finché la guida non conferma (vedi routes/admin-bank.js).
import { CREDITABLE_STATUS, buyerOf } from './invoices.js';
import { dueDateOf, invoiceDue, isPayable } from './invoicePayments.js';
import { isDate } from './time.js';

export const MAX_CSV_CHARS = 2_000_000;

const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ───────────── lettura del CSV ─────────────
/** Il separatore usato dal file: quello che divide in modo più regolare le prime righe. */
function detectDelimiter(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 25);
  let best = { d: ';', score: 0 };
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((n) => n > 0);
    if (!counts.length) continue;
    const freq = new Map();
    for (const n of counts) freq.set(n, (freq.get(n) ?? 0) + 1);
    const [mode, times] = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = times * 100 + mode; // prima la regolarità (quante righe hanno lo stesso numero di colonne), poi il numero di colonne
    if (score > best.score) best = { d, score };
  }
  return best.d;
}

/** Il testo del CSV come righe di celle (gestisce virgolette, virgolette doppie e a capo dentro le celle). */
export function splitCsv(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const d = detectDelimiter(s);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let line = 1; // la riga del file da cui parte quella in lettura (le celle con a capo dentro occupano più righe)
  let start = 1;
  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(Object.assign(row, { line: start }));
    row = [];
    start = line;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n' || (ch === '\r' && s[i + 1] !== '\n')) line++; // (un «\r\n» si conta una volta sola)
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') {
        i++;
        line++;
      }
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

/** Un importo scritto come lo scrive una banca (1.234,56 · 1,234.56 · -45,00 · (45,00) · 45,00 DB) in centesimi, o null. */
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/ /g, ' ').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.+\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  const tail = /\s*\b(CR|DB|DR)$/i.exec(s);
  if (tail) {
    if (/^d/i.test(tail[1])) neg = true;
    s = s.slice(0, tail.index);
  }
  s = s.replace(/EUR|€|\$|£/gi, '').replace(/\s/g, '');
  if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let int;
  let frac = '';
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    int = s.slice(0, dec).replace(/[.,]/g, '');
    frac = s.slice(dec + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const idx = s.lastIndexOf(sep);
    const after = s.slice(idx + 1);
    const count = s.split(sep).length - 1;
    if (count === 1 && after.length >= 1 && after.length <= 2) {
      int = s.slice(0, idx);
      frac = after;
    } else int = s.replace(/[.,]/g, ''); // separatore delle migliaia
  } else int = s;
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac)) return null;
  const cents = Number(int || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

/** Una data come la scrive una banca (20/01/2027, 20-01-27, 2027-01-20, 20.01.2027) in AAAA-MM-GG, o null. */
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s);
  let y;
  let mo;
  let d;
  if (m) [y, mo, d] = [m[1], m[2], m[3]];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s))) [d, mo, y] = [m[1], m[2], m[3].length === 2 ? `20${m[3]}` : m[3]];
  else return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isDate(iso) ? iso : null;
}

const HEADER_WORDS = {
  date: ['data contabile', 'data operazione', 'data registrazione', 'data movimento', 'booking date', 'transaction date', 'data', 'date', 'data valuta', 'value date', 'valuta'],
  amount: ['importo', 'amount', 'ammontare', 'valore', 'movimento'],
  credit: ['avere', 'entrate', 'accrediti', 'accredito', 'credit', 'crediti', 'incassi'],
  debit: ['dare', 'uscite', 'addebiti', 'addebito', 'debit', 'debiti'],
  text: ['descrizione completa', 'descrizione operazione', 'descrizione', 'causale', 'dettagli', 'dettaglio', 'operazione', 'motivo', 'note', 'description', 'payment reference', 'reference', 'riferimento', 'beneficiario', 'ordinante', 'controparte', 'payee', 'memo', 'testo', 'details', 'narrative', 'remittance'],
};

/** Quale colonna è questa? (la parola che compare nell'intestazione, in ordine di preferenza) */
function kindOf(header) {
  const h = fold(header);
  for (const kind of ['credit', 'debit', 'date', 'amount', 'text']) {
    const idx = HEADER_WORDS[kind].findIndex((w) => h === w || h.startsWith(`${w} `) || h.endsWith(` ${w}`) || h.includes(` ${w} `) || (w.length >= 5 && h.includes(w)));
    if (idx >= 0) return { kind, rank: idx };
  }
  return null;
}

/**
 * I movimenti di un estratto conto CSV.
 * @returns {{ rows: {line: number, date: string, cents: number, text: string}[], columns: {date: string, amount: string, text: string[]}, skipped: number, problem?: string }}
 *   `cents` ha il segno (positivo = accredito); `line` è il numero di riga nel file; `skipped` le righe senza data o importo (intestazioni, saldi)
 */
export function readStatement(text) {
  const table = splitCsv(text);
  if (!table.length) return { rows: [], columns: { date: '', amount: '', text: [] }, skipped: 0, problem: 'Il file è vuoto.' };

  // la riga delle intestazioni: ha una colonna di data e una di importo (le prime righe possono essere i dati del conto)
  let headerAt = -1;
  let map = null;
  for (let i = 0; i < Math.min(table.length, 40) && headerAt < 0; i++) {
    const kinds = table[i].map(kindOf);
    const col = (k) => kinds.map((x, c) => (x?.kind === k ? { c, rank: x.rank } : null)).filter(Boolean).sort((a, b) => a.rank - b.rank || a.c - b.c);
    const date = col('date');
    const amount = col('amount');
    const credit = col('credit');
    const debit = col('debit');
    if (date.length && (amount.length || credit.length)) {
      headerAt = i;
      map = { date: date[0].c, amount: amount[0]?.c ?? null, credit: credit[0]?.c ?? null, debit: debit[0]?.c ?? null, text: col('text').map((x) => x.c) };
    }
  }

  let columns;
  let from;
  if (map) {
    const used = new Set([map.date, map.amount, map.credit, map.debit]);
    if (!map.text.length) map.text = table[headerAt].map((_, c) => c).filter((c) => !used.has(c));
    columns = { date: table[headerAt][map.date], amount: table[headerAt][map.amount ?? map.credit], text: map.text.map((c) => table[headerAt][c]) };
    from = headerAt + 1;
  } else {
    // senza intestazioni: la colonna delle date, la prima colonna di importi dopo di essa, il resto è testo
    const width = Math.max(...table.map((r) => r.length));
    const sample = table.slice(0, 60);
    const share = (test) => Array.from({ length: width }, (_, c) => sample.filter((r) => r[c] && test(r[c])).length / Math.max(1, sample.filter((r) => r[c]).length));
    const dates = share((v) => parseDate(v));
    const amounts = share((v) => parseAmount(v) !== null && !parseDate(v));
    const dateCol = dates.findIndex((x) => x >= 0.6);
    const amountCol = amounts.findIndex((x, c) => c > dateCol && x >= 0.6);
    if (dateCol < 0 || amountCol < 0) return { rows: [], columns: { date: '', amount: '', text: [] }, skipped: table.length, problem: 'Non riconosco le colonne: servono almeno la data e l’importo di ogni movimento (e di solito la descrizione, con la causale).' };
    map = { date: dateCol, amount: amountCol, credit: null, debit: null, text: Array.from({ length: width }, (_, c) => c).filter((c) => c !== dateCol && c !== amountCol) };
    columns = { date: `colonna ${dateCol + 1}`, amount: `colonna ${amountCol + 1}`, text: map.text.map((c) => `colonna ${c + 1}`) };
    from = 0;
  }

  const rows = [];
  let skipped = 0;
  for (let i = from; i < table.length; i++) {
    const r = table[i];
    const date = parseDate(r[map.date]);
    let cents = null;
    if (map.amount != null) cents = parseAmount(r[map.amount]);
    if (cents == null && (map.credit != null || map.debit != null)) {
      const credit = map.credit != null ? parseAmount(r[map.credit]) : null;
      const debit = map.debit != null ? parseAmount(r[map.debit]) : null;
      if (credit != null || debit != null) cents = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date || cents == null) {
      skipped++;
      continue;
    }
    rows.push({ line: r.line ?? i + 1, date, cents, text: map.text.map((c) => r[c]).filter(Boolean).join(' · ') });
  }
  return { rows, columns, skipped };
}

// ───────────── abbinamento ─────────────
/** I numeri di fattura citati in un testo, come {seq, year}: «Fattura 12/2027», «fatt. n. 7-2027», «FT 0012/2027», «fatture 12/2027 e 13/2027». */
export function extractRefs(text) {
  const out = [];
  const seen = new Set();
  const add = (seq, year) => {
    const key = `${Number(seq)}/${year}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ seq: Number(seq), year: Number(year) });
    }
  };
  const s = String(text ?? '');
  // con la parola «fattura» davanti si accetta anche il trattino; senza, solo la barra, e mai dentro una data (15/01/2027)
  for (const m of s.matchAll(/(?<![\d/.\-])(\d{1,6})\s*\/\s*(20\d{2})(?!\d)/g)) add(m[1], m[2]);
  for (const m of s.matchAll(/\b(?:fatt(?:ura|ure)?|fattur|inv(?:oice)?s?|ft|fa)\.?\s*(?:n(?:r|o|\.|°)?\.?\s*)?[:#]?\s*(\d{1,6})\s*[-/]\s*(20\d{2})(?!\d)/gi)) add(m[1], m[2]);
  return out;
}

const STOP = new Set(['tours', 'tour', 'travel', 'viaggi', 'agency', 'agenzia', 'group', 'italia', 'italy', 'company', 'services', 'service', 'venezia', 'venice', 'holidays', 'vacanze', 'turismo', 'trade', 'operator', 'destination', 'management', 'dmc', 'srl', 'spa', 'snc', 'sas', 'ltd', 'gmbh', 'bank', 'bonifico', 'sepa', 'pagamento', 'fattura', 'saldo', 'conto']);
const nameTokens = (name) => fold(name).split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP.has(t));
const buyerName = (inv) => {
  const b = buyerOf(inv);
  return (b.kind === 'person' ? `${b.firstName ?? ''} ${b.lastName ?? ''}`.trim() : b.name) || '';
};

/**
 * Abbina gli accrediti alle fatture ancora da pagare.
 * stato di ogni accredito:
 *  - sure: cita il numero di una fattura (o di più) e l'importo coincide con ciò che resta da pagare → proposto e già spuntato
 *  - check: cita una fattura ma l'importo è diverso (acconto, differenza, commissioni): da controllare
 *  - likely: nessun numero, ma l'importo coincide con una sola fattura e nel testo c'è il nome dell'agenzia
 *  - guess: nessun numero né nome, ma l'importo coincide con una sola fattura
 *  - ambiguous: l'importo coincide con più fatture (la guida sceglie)
 *  - paid: cita una fattura già incassata (o già abbinata a un accredito precedente)
 *  - none: nessuna fattura riconosciuta
 * @returns {{ rows: object[], counts: object }}
 */
export function matchStatement(db, statement, { today }) {
  const invoices = db.prepare(`SELECT * FROM invoices WHERE doc_type = 'TD01' AND number IS NOT NULL AND credited = 0 AND status IN (${CREDITABLE_STATUS.map(() => '?').join(',')})`).all(...CREDITABLE_STATUS);
  const info = invoices.map((inv) => ({ inv, open: isPayable(inv) && invoiceDue(inv) > 0, due: invoiceDue(inv), company: buyerName(inv) }));
  const byNumber = new Map(info.map((x) => [`${x.inv.seq}/${x.inv.year}`, x]));
  const summary = (x) => ({ id: x.inv.id, number: x.inv.number, company: x.company, dueCents: x.due, dueDate: dueDateOf(x.inv), issueDate: x.inv.issue_date, open: x.open });
  const claimed = new Set();
  const named = (text, x) => {
    const hay = fold(text);
    return nameTokens(x.company).some((t) => hay.includes(t));
  };

  const credits = statement.rows.filter((r) => r.cents > 0).sort((a, b) => a.date.localeCompare(b.date) || a.line - b.line);
  const out = [];
  for (const row of credits) {
    const base = { line: row.line, date: row.date > today ? today : row.date, bankDate: row.date, cents: row.cents, text: row.text, candidates: [], selected: [], note: '' };
    const refs = extractRefs(row.text);
    const found = [...new Set(refs.map((r) => byNumber.get(`${r.seq}/${r.year}`)).filter(Boolean))];
    if (found.length) {
      const open = found.filter((x) => x.open && !claimed.has(x.inv.id));
      if (!open.length) {
        out.push({ ...base, status: 'paid', candidates: found.map(summary), note: 'La fattura risulta già incassata.' });
        continue;
      }
      const sum = open.reduce((n, x) => n + x.due, 0);
      if (row.cents === sum) {
        for (const x of open) claimed.add(x.inv.id);
        out.push({ ...base, status: 'sure', candidates: open.map(summary), selected: open.map((x) => x.inv.id), note: open.length > 1 ? 'Un solo bonifico per più fatture: la somma coincide.' : 'Numero di fattura e importo coincidono.' });
        continue;
      }
      const single = open.length > 1 ? open.find((x) => x.due === row.cents) : null;
      out.push({ ...base, status: 'check', candidates: open.map(summary), selected: [], note: single ? `L’importo coincide solo con la fattura ${single.inv.number}.` : `Importo diverso: ricevuti ${eur(row.cents)}, attesi ${eur(sum)}.` });
      continue;
    }
    const byAmount = info.filter((x) => x.open && !claimed.has(x.inv.id) && x.due === row.cents);
    if (byAmount.length === 1) {
      const x = byAmount[0];
      out.push({ ...base, status: named(row.text, x) ? 'likely' : 'guess', candidates: [summary(x)], note: named(row.text, x) ? 'Manca il numero di fattura, ma importo e nome dell’agenzia coincidono.' : 'Nessun numero di fattura: coincide solo l’importo.' });
    } else if (byAmount.length > 1) {
      const narrowed = byAmount.filter((x) => named(row.text, x));
      if (narrowed.length === 1) out.push({ ...base, status: 'likely', candidates: [summary(narrowed[0])], note: 'Manca il numero di fattura, ma importo e nome dell’agenzia coincidono.' });
      else out.push({ ...base, status: 'ambiguous', candidates: (narrowed.length ? narrowed : byAmount).map(summary), note: 'L’importo coincide con più fatture: scegli quale.' });
    } else out.push({ ...base, status: 'none' });
  }
  const counts = { credits: credits.length, debits: statement.rows.length - credits.length };
  for (const s of ['sure', 'check', 'likely', 'guess', 'ambiguous', 'paid', 'none']) counts[s] = out.filter((x) => x.status === s).length;
  return { rows: out, counts };
}

const eur = (c) => `${(c / 100).toFixed(2).replace('.', ',')} €`;
