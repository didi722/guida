// Tutte le date/ore del sito sono "ora locale di Venezia" (Europe/Rome).
// Le date sono stringhe 'YYYY-MM-DD', le ore 'HH:MM'; gli istanti sono millisecondi UTC.

export const TZ = 'Europe/Rome';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const pad = (n) => String(n).padStart(2, '0');

function tzParts(ms) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

/** Differenza (ms) tra l'ora locale di Venezia e UTC nell'istante dato. */
function tzOffset(ms) {
  const p = tzParts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

export function nowRome(ms = Date.now()) {
  const p = tzParts(ms);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Converte data+ora locali di Venezia nell'istante UTC corrispondente (gestisce l'ora legale). */
export function localToInstant(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let inst = guess - tzOffset(guess);
  const off2 = tzOffset(inst);
  inst = guess - off2;
  return inst;
}

export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const isMonth = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** 0 = domenica … 6 = sabato */
export const dayOfWeek = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthDates(month) {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);
}

export const instantToIso = (ms) => new Date(ms).toISOString();

const dateFmtCache = new Map();
function dtf(lang, opts) {
  const key = lang + JSON.stringify(opts);
  if (!dateFmtCache.has(key)) dateFmtCache.set(key, new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', { timeZone: 'UTC', ...opts }));
  return dateFmtCache.get(key);
}

export function fmtDate(date, lang, style = 'long') {
  const d = new Date(date + 'T12:00:00Z');
  if (style === 'short') return dtf(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  if (style === 'weekday') return dtf(lang, { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
  return dtf(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function fmtMonth(month, lang) {
  return dtf(lang, { month: 'long', year: 'numeric' }).format(new Date(month + '-15T12:00:00Z'));
}

/** Istante UTC → "gg mese, HH:MM" in ora di Venezia. */
export function fmtInstant(ms, lang) {
  const { date, time } = nowRome(ms);
  return `${fmtDate(date, lang, 'short')}, ${time}`;
}
