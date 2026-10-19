// Periodi con regole particolari: intervalli di date del SERVIZIO (l'alta stagione, il Carnevale, Natale…) in cui cambiano le regole
// delle opzioni delle agenzie e il preavviso minimo. Un giorno appartiene a un solo periodo. Fuori dai periodi valgono le regole di
// Impostazioni; dentro, quelle del periodo, qualunque sia il giorno in cui si prenota.
import { isDate } from './time.js';

export const MODES = ['normal', 'short', 'off'];
export const MODE_LABEL = { normal: 'Come sempre', short: 'Più brevi', off: 'Niente opzioni' };
export const MAX_SPAN_DAYS = 366;
const DAY = 86_400_000;

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
/** Un numero scritto nel modulo; vuoto (anche solo spazi) = non indicato. */
const int = (v) => {
  const t = String(v ?? '').trim();
  return t === '' ? null : Number(t);
};

/** Un periodo come lo usano le regole (camelCase). */
export const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  from: r.date_from,
  to: r.date_to,
  optionsMode: r.options_mode,
  optionMaxDays: r.option_max_days ?? null,
  optionReleaseHours: r.option_release_hours ?? null,
  noticeB2cHours: r.notice_b2c_hours ?? null,
  noticeB2bHours: r.notice_b2b_hours ?? null,
});

/** Il periodo che contiene una data (AAAA-MM-GG), o null. */
export function periodOn(periods, date) {
  if (!Array.isArray(periods) || !date) return null;
  return periods.find((p) => p.from <= date && date <= p.to) ?? null;
}

/** Quali giorni durano: «dal 4 febbraio al 16 febbraio» → 13. */
export const spanDays = (from, to) => Math.round((dayMs(to) - dayMs(from)) / DAY) + 1;

/**
 * Controlla ciò che arriva dal modulo. Restituisce i valori puliti o, per ogni campo sbagliato, un messaggio.
 * (La sovrapposizione con altri periodi la controlla `savePeriod`, che conosce quelli esistenti.)
 * @returns {{ ok: true, values: object } | { ok: false, errors: Record<string,string> }}
 */
export function normalizePeriod(input) {
  const errors = {};
  const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) errors.name = 'Scrivi un nome (per esempio «Carnevale» o «Alta stagione»).';
  else if (name.length > 60) errors.name = 'Il nome è troppo lungo (al massimo 60 lettere).';

  const from = String(input.from ?? '').trim();
  const to = String(input.to ?? '').trim();
  if (!isDate(from)) errors.from = 'Scegli il primo giorno del periodo.';
  if (!isDate(to)) errors.to = 'Scegli l’ultimo giorno del periodo.';
  if (!errors.from && !errors.to) {
    if (to < from) errors.to = 'L’ultimo giorno non può venire prima del primo.';
    else if (spanDays(from, to) > MAX_SPAN_DAYS) errors.to = 'Un periodo non può durare più di un anno: spezzalo in due.';
  }

  const mode = MODES.includes(input.mode) ? input.mode : 'normal';
  const check = (key, label, max, min = 0) => {
    const v = int(input[key]);
    if (v === null) return null;
    if (!Number.isInteger(v) || v < min || v > max) {
      errors[key] = `${label}: un numero intero da ${min} a ${max}.`;
      return null;
    }
    return v;
  };
  let maxDays = null;
  let release = null;
  if (mode === 'short') {
    maxDays = check('maxDays', 'Durata massima', 90, 1);
    release = check('releaseHours', 'Scadenza', 720, 0);
    if (!errors.maxDays && !errors.releaseHours && maxDays === null && release === null) errors.maxDays = 'Per le opzioni più brevi indica la durata massima, la scadenza prima del servizio, o tutte e due.';
  }
  const noticeB2c = check('noticeB2c', 'Preavviso per i privati', 720);
  const noticeB2b = check('noticeB2b', 'Preavviso per le agenzie', 720);
  if (!Object.keys(errors).length && mode === 'normal' && noticeB2c === null && noticeB2b === null) errors.mode = 'Questo periodo non cambia nessuna regola: scegli opzioni più brevi o senza opzioni, oppure un preavviso diverso.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { name, from, to, mode, maxDays, releaseHours: release, noticeB2c, noticeB2b } };
}

const ROW = 'SELECT * FROM periods ORDER BY date_from, id';

export const listPeriods = (db) => db.prepare(ROW).all().map(fromRow);
export const getPeriod = (db, id) => {
  const r = db.prepare('SELECT * FROM periods WHERE id = ?').get(id);
  return r ? fromRow(r) : null;
};

/** Il periodo (se c'è) che si sovrappone alle date indicate, ignorando `exceptId`. */
export const overlapping = (periods, from, to, exceptId = null) => periods.find((p) => p.id !== exceptId && p.from <= to && from <= p.to) ?? null;

const showDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', year: 'numeric' });
export const showRange = (p) => `${showDate(p.from)} – ${showDate(p.to)}`;

/**
 * Salva un periodo nuovo (`id` nullo) o ne cambia uno.
 * @returns {{ ok: true, id: number } | { ok: false, errors: Record<string,string> }}
 */
export function savePeriod(db, input, id = null, nowMs = Date.now()) {
  const parsed = normalizePeriod(input);
  if (!parsed.ok) return parsed;
  const v = parsed.values;
  const clash = overlapping(listPeriods(db), v.from, v.to, id);
  if (clash) return { ok: false, errors: { from: `Queste date si sovrappongono a «${clash.name}» (${showRange(clash)}): un giorno può stare in un solo periodo.` } };
  if (id) {
    const done = db
      .prepare('UPDATE periods SET name = ?, date_from = ?, date_to = ?, options_mode = ?, option_max_days = ?, option_release_hours = ?, notice_b2c_hours = ?, notice_b2b_hours = ? WHERE id = ?')
      .run(v.name, v.from, v.to, v.mode, v.maxDays, v.releaseHours, v.noticeB2c, v.noticeB2b, id);
    return done.changes ? { ok: true, id } : { ok: false, errors: { name: 'Questo periodo non esiste più.' } };
  }
  const row = db
    .prepare('INSERT INTO periods(name, date_from, date_to, options_mode, option_max_days, option_release_hours, notice_b2c_hours, notice_b2b_hours, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(v.name, v.from, v.to, v.mode, v.maxDays, v.releaseHours, v.noticeB2c, v.noticeB2b, new Date(nowMs).toISOString());
  return { ok: true, id: Number(row.lastInsertRowid) };
}

export const deletePeriod = (db, id) => db.prepare('DELETE FROM periods WHERE id = ?').run(id).changes > 0;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Le regole di un periodo in una riga, per il pannello. */
export function rulesText(p) {
  const parts = [];
  if (p.optionsMode === 'off') parts.push('niente opzioni (le agenzie prenotano direttamente)');
  else if (p.optionsMode === 'short') {
    const bits = [];
    if (p.optionMaxDays != null) bits.push(`al massimo ${plural(p.optionMaxDays, 'giorno', 'giorni')}`);
    if (p.optionReleaseHours != null) bits.push(`scadenza almeno ${plural(p.optionReleaseHours, 'ora', 'ore')} prima del servizio`);
    parts.push(`opzioni più brevi: ${bits.join(', ')}`);
  }
  const notice = [];
  if (p.noticeB2cHours != null) notice.push(`privati ${plural(p.noticeB2cHours, 'ora', 'ore')}`);
  if (p.noticeB2bHours != null) notice.push(`agenzie ${plural(p.noticeB2bHours, 'ora', 'ore')}`);
  if (notice.length) parts.push(`preavviso minimo: ${notice.join(', ')}`);
  return parts.join(' · ');
}

/**
 * Tiene in memoria i periodi, dentro la configurazione (`cfg.options.periods`, la stessa lista letta dalle regole delle opzioni
 * e del preavviso). Si rilegge dopo ogni modifica e dopo un ripristino.
 */
export function createPeriods(app) {
  const { cfg, db } = app;
  cfg.options.periods ??= [];
  const svc = {
    reload() {
      const rows = listPeriods(db);
      cfg.options.periods.length = 0;
      cfg.options.periods.push(...rows); // la stessa lista (non una nuova): chi l'ha già in mano vede i cambi
      return rows;
    },
    list: () => cfg.options.periods,
    on: (date) => periodOn(cfg.options.periods, date),
    save(input, id = null, nowMs = Date.now()) {
      const out = savePeriod(db, input, id, nowMs);
      if (out.ok) svc.reload();
      return out;
    },
    remove(id) {
      const done = deletePeriod(db, id);
      if (done) svc.reload();
      return done;
    },
  };
  svc.reload();
  return svc;
}
