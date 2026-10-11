// Legge un file iCalendar (.ics) e ne ricava gli intervalli "occupato".
//
// Gestisce: fusi orari (VTIMEZONE e nomi IANA), ora legale, eventi in UTC o "floating" (letti come
// ora di Venezia), eventi di un giorno intero, ricorrenze (RRULE, EXDATE, RDATE) con istanze spostate
// o cancellate. Gli eventi "liberi" (TRANSP:TRANSPARENT) e cancellati non bloccano nulla.
import ICAL from 'ical.js';
import { addDays, isTimeZone, localToInstant, nowRome } from './time.js';

const unfold = (text) => text.replace(/\r?\n[ \t]/g, ''); // RFC 5545: le righe lunghe vanno a capo con uno spazio
const ymd = (ms) => nowRome(ms).date.replaceAll('-', '');

/**
 * I feed di Google contengono tutta la storia del calendario. Teniamo solo i fusi orari e gli eventi
 * che toccano la finestra [fromMs, toMs], così il parsing resta veloce anche con migliaia di eventi.
 * @returns {{zones: string[][], events: {lines: string[], uid: string}[]}}
 */
export function filterParts(text, fromMs, toMs) {
  const lines = unfold(text).split(/\r?\n/);
  const zones = [];
  const events = [];
  let cur = null;
  let kind = null;
  for (const line of lines) {
    if (!cur) {
      if (/^BEGIN:VTIMEZONE/i.test(line)) [cur, kind] = [[line], 'tz'];
      else if (/^BEGIN:VEVENT/i.test(line)) [cur, kind] = [[line], 'ev'];
      continue;
    }
    cur.push(line);
    if (kind === 'tz' && /^END:VTIMEZONE/i.test(line)) zones.push(cur), (cur = null);
    else if (kind === 'ev' && /^END:VEVENT/i.test(line)) events.push(cur), (cur = null);
  }

  const from = ymd(fromMs - 2 * 86400_000);
  const to = ymd(toMs + 2 * 86400_000);
  const info = (lines2) => {
    const get = (re) => lines2.map((l) => re.exec(l)).find(Boolean)?.[1];
    const start = get(/^DTSTART[^:]*:(\d{8})/i);
    return {
      lines: lines2,
      uid: get(/^UID[^:]*:(.*)$/i) ?? '',
      start,
      end: get(/^DTEND[^:]*:(\d{8})/i) ?? start,
      rrule: get(/^RRULE[^:]*:(.*)$/i),
      rdate: lines2.some((l) => /^RDATE/i.test(l)),
      isException: lines2.some((l) => /^RECURRENCE-ID/i.test(l)),
    };
  };
  const all = events.map(info);
  const inWindow = (e) => e.start && e.start <= to && e.end >= from;

  const keptUids = new Set();
  const kept = [];
  for (const e of all.filter((x) => !x.isException)) {
    let keep;
    if (e.rrule || e.rdate) {
      const until = /UNTIL=(\d{8})/i.exec(e.rrule ?? '')?.[1];
      keep = !(until && until < from) && !(e.start && e.start > to);
    } else keep = inWindow(e);
    if (keep) {
      kept.push(e);
      keptUids.add(e.uid);
    }
  }
  for (const e of all.filter((x) => x.isException)) if (keptUids.has(e.uid) || inWindow(e)) kept.push(e);
  return { zones, events: kept };
}

const toText = (zones, events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...zones.flat(), ...events.flatMap((e) => e.lines), 'END:VCALENDAR'].join('\r\n');

/** Testo ICS ridotto alla finestra (vedi filterParts). */
export function prefilter(text, fromMs, toMs) {
  const { zones, events } = filterParts(text, fromMs, toMs);
  return toText(zones, events);
}

const cleanTitle = (s) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 80);

/**
 * @param {string} text contenuto del file .ics
 * @param {{fromMs: number, toMs: number, ownUidSuffix?: string, maxOccurrences?: number}} opts
 * @returns {{busy: {startMs: number, endMs: number, title: string, uid: string}[], skipped: number, events: number}}
 */
export function parseBusy(text, { fromMs, toMs, ownUidSuffix = null, maxOccurrences = 20000 }) {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Il file non è un calendario iCalendar (.ics) valido');
  const busy = [];
  let skipped = 0;
  let events = 0;
  let budget = maxOccurrences;

  const tzidOf = (item, prop) => item.component.getFirstProperty(prop)?.getParameter('tzid') ?? item.component.getFirstProperty('dtstart')?.getParameter('tzid');
  const dateOf = (t) => `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  const timeOf = (t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

  function toInstant(t, tzid) {
    if (t.zone?.tzid !== 'floating') return t.toUnixTime() * 1000; // UTC o fuso definito nel file
    // "floating" o TZID senza definizione: usiamo il nome IANA se valido, altrimenti l'ora di Venezia
    return localToInstant(dateOf(t), timeOf(t), tzid && isTimeZone(tzid) ? tzid : undefined);
  }

  function addInstance(item, start, end) {
    const status = String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase();
    const transp = String(item.component.getFirstPropertyValue('transp') ?? '').toUpperCase();
    if (status === 'CANCELLED' || transp === 'TRANSPARENT') return;
    let startMs;
    let endMs;
    if (start.isDate) {
      startMs = localToInstant(dateOf(start), '00:00');
      endMs = end?.isDate && end.compare(start) > 0 ? localToInstant(dateOf(end), '00:00') : localToInstant(addDays(dateOf(start), 1), '00:00');
    } else {
      startMs = toInstant(start, tzidOf(item, 'dtstart'));
      endMs = end ? toInstant(end, tzidOf(item, 'dtend')) : startMs;
    }
    startMs = Math.floor(startMs / 60000) * 60000;
    endMs = Math.ceil(endMs / 60000) * 60000;
    if (endMs <= startMs || endMs <= fromMs || startMs >= toMs) return;
    busy.push({ startMs, endMs, title: cleanTitle(item.summary), uid: item.uid });
  }

  /** Elabora un testo ICS completo (può lanciare se contiene qualcosa di malformato). */
  function run(calText) {
    const comp = new ICAL.Component(ICAL.parse(calText));
    ICAL.TimezoneService.reset();
    for (const tz of comp.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

    const groups = new Map();
    for (const v of comp.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(v);
      const g = groups.get(ev.uid) ?? { master: null, exceptions: [] };
      if (ev.isRecurrenceException()) g.exceptions.push(ev);
      else g.master = ev;
      groups.set(ev.uid, g);
    }
    events += groups.size;
    for (const [uid, g] of groups) {
      if (ownUidSuffix && String(uid).endsWith(ownUidSuffix)) continue; // le nostre stesse prenotazioni non devono bloccarsi da sole
      try {
        if (!g.master) {
          for (const ex of g.exceptions) addInstance(ex, ex.startDate, ex.endDate);
          continue;
        }
        for (const ex of g.exceptions) g.master.relateException(ex);
        if (!g.master.isRecurring()) {
          addInstance(g.master, g.master.startDate, g.master.endDate);
          continue;
        }
        const it = g.master.iterator();
        for (let n = it.next(); n && budget-- > 0; n = it.next()) {
          const d = g.master.getOccurrenceDetails(n);
          if (!d.startDate.isDate && toInstant(d.startDate, tzidOf(d.item, 'dtstart')) >= toMs) break;
          if (d.startDate.isDate && localToInstant(dateOf(d.startDate), '00:00') >= toMs) break;
          addInstance(d.item, d.startDate, d.endDate);
        }
      } catch {
        skipped++; // un evento malformato non deve far fallire tutto il calendario
      }
    }
  }

  const parts = filterParts(text, fromMs, toMs);
  try {
    run(toText(parts.zones, parts.events)); // percorso veloce: tutto il calendario insieme
  } catch {
    // un evento malformato (es. RRULE non valida) fa fallire l'intero parsing: riproviamo evento per evento
    busy.length = 0;
    skipped = 0;
    events = 0;
    budget = maxOccurrences;
    const groups = new Map();
    for (const e of parts.events) groups.set(e.uid, [...(groups.get(e.uid) ?? []), e]);
    for (const evs of groups.values()) {
      try {
        run(toText(parts.zones, evs));
      } catch {
        skipped++;
      }
    }
  }
  return { busy, skipped, events };
}

/** Spezza un intervallo in segmenti per giorno (ora di Venezia): [{date, start:'HH:MM', end:'HH:MM'|'24:00'}]. */
export function splitIntoDays(startMs, endMs) {
  const s = nowRome(startMs);
  const e = nowRome(endMs);
  const out = [];
  let date = s.date;
  for (let i = 0; i < 400; i++) {
    const last = date === e.date;
    const start = date === s.date ? s.time : '00:00';
    const end = last ? e.time : '24:00';
    if (!(last && end === '00:00')) out.push({ date, start, end });
    if (last) break;
    date = addDays(date, 1);
  }
  return out;
}
