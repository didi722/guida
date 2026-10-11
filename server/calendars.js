// Calendari esterni: legge gli impegni personali (es. Google Calendar) e li usa come "occupato".
//
// Si incolla l'indirizzo segreto in formato iCal del calendario; il sito lo rilegge ogni pochi minuti
// e, prima di confermare una prenotazione, si riallinea se i dati sono vecchi.
import { parseBusy, splitIntoDays } from './ics-parse.js';
import { addDays, nowRome, localToInstant } from './time.js';
import { cleanText } from './util.js';
import { tx } from './db.js';

const MAX_BYTES = 15 * 1024 * 1024;

/** webcal:// → https://; accetta solo http(s). Ritorna null se non valido. */
export function normalizeIcsUrl(raw) {
  let s = String(raw ?? '').trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Indirizzo mascherato per la visualizzazione: l'URL segreto non va mostrato per intero. */
export function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}/…${url.slice(-6)}`;
  } catch {
    return '…';
  }
}

export function createCalendars(app, fetchImpl = globalThis.fetch) {
  const { db, cfg } = app;
  const ownSuffix = `@${new URL(cfg.baseUrl).hostname}`;
  let inflight = null;

  function windowFor(nowMs) {
    const today = nowRome(nowMs).date;
    return { fromMs: localToInstant(addDays(today, -1), '00:00'), toMs: localToInstant(addDays(today, cfg.policy.maxAdvanceDays + 2), '00:00') };
  }

  async function download(url) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'guida-venezia-calendar-sync/1.0', Accept: 'text/calendar, text/plain, */*' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`il server del calendario ha risposto ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error('il file del calendario è troppo grande');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('il file del calendario è troppo grande');
    return buf.toString('utf8');
  }

  const svc = {
    list: () => db.prepare('SELECT * FROM calendar_sources ORDER BY id').all(),
    get: (id) => db.prepare('SELECT * FROM calendar_sources WHERE id = ?').get(id),

    add({ name, url }, nowMs = Date.now()) {
      const clean = normalizeIcsUrl(url);
      const label = cleanText(name, 80);
      if (!clean || !label) return null;
      const info = db.prepare('INSERT INTO calendar_sources(name, url, created_at) VALUES(?,?,?)').run(label, clean, new Date(nowMs).toISOString());
      return svc.get(Number(info.lastInsertRowid));
    },
    remove: (id) => db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(id).changes === 1,
    setEnabled: (id, enabled) => db.prepare('UPDATE calendar_sources SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes === 1,

    /** Rilegge una sorgente. Se fallisce i dati precedenti restano (meglio vecchi che nessuno). */
    async syncSource(source, nowMs = Date.now()) {
      const attempt = new Date(nowMs).toISOString();
      try {
        const text = await download(source.url);
        const { fromMs, toMs } = windowFor(nowMs);
        const { busy, skipped, events } = parseBusy(text, { fromMs, toMs, ownUidSuffix: ownSuffix });
        const rows = busy.flatMap((b) => splitIntoDays(Math.max(b.startMs, fromMs), Math.min(b.endMs, toMs)).map((seg) => [source.id, seg.date, seg.start, seg.end, b.title || null, b.uid || null]));
        tx(db, () => {
          db.prepare('DELETE FROM external_busy WHERE source_id = ?').run(source.id);
          const ins = db.prepare('INSERT INTO external_busy(source_id, date, start_time, end_time, title, uid) VALUES(?,?,?,?,?,?)');
          for (const r of rows.slice(0, 50_000)) ins.run(...r);
          db.prepare('UPDATE calendar_sources SET last_attempt_at = ?, last_ok_at = ?, last_error = ?, event_count = ? WHERE id = ?').run(attempt, attempt, skipped ? `${skipped} eventi non leggibili ignorati` : null, events, source.id);
        });
        return { ok: true, events, busy: busy.length, skipped };
      } catch (err) {
        db.prepare('UPDATE calendar_sources SET last_attempt_at = ?, last_error = ? WHERE id = ?').run(attempt, cleanText(err.message, 200), source.id);
        console.error(`[calendario] sincronizzazione di "${source.name}" fallita: ${err.message}`);
        return { ok: false, error: err.message };
      }
    },

    /** Rilegge le sorgenti attive "scadute" (o tutte con force). */
    async syncDue(nowMs = Date.now(), { force = false, maxAgeMs = cfg.calendar.syncMinutes * 60_000 } = {}) {
      if (inflight) return inflight; // una sincronizzazione alla volta
      inflight = (async () => {
        let n = 0;
        for (const s of db.prepare('SELECT * FROM calendar_sources WHERE enabled = 1').all()) {
          if (!force && s.last_attempt_at && nowMs - Date.parse(s.last_attempt_at) < maxAgeMs) continue;
          if ((await svc.syncSource(s, nowMs)).ok) n++;
        }
        return n;
      })().finally(() => {
        inflight = null;
      });
      return inflight;
    },

    /**
     * Da chiamare subito prima di confermare una prenotazione: se i dati del calendario sono vecchi
     * li rilegge (al massimo `timeoutMs`), così un impegno appena inserito non viene sovrapposto.
     */
    async ensureFresh(nowMs = Date.now(), timeoutMs = 4000) {
      const stale = db
        .prepare('SELECT 1 FROM calendar_sources WHERE enabled = 1 AND (last_ok_at IS NULL OR last_ok_at < ?) AND (last_attempt_at IS NULL OR last_attempt_at < ?)')
        .get(new Date(nowMs - cfg.calendar.freshSeconds * 1000).toISOString(), new Date(nowMs - 20_000).toISOString());
      if (!stale && !inflight) return false;
      let timer;
      await Promise.race([svc.syncDue(nowMs, { maxAgeMs: cfg.calendar.freshSeconds * 1000 }), new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]).catch(() => {});
      clearTimeout(timer);
      return true;
    },

    /** Sorgenti attive la cui ultima lettura riuscita è troppo vecchia (o non è mai riuscita). */
    problems(nowMs = Date.now()) {
      const limit = nowMs - cfg.calendar.staleWarnMinutes * 60_000;
      return svc.list().filter((s) => s.enabled && (!s.last_ok_at || Date.parse(s.last_ok_at) < limit));
    },

    /** Impegni esterni di un intervallo di date, per mostrarli nell'admin. */
    busyBetween(fromDate, toDate) {
      return db
        .prepare(`SELECT e.date, e.start_time, e.end_time, e.title, s.name AS source FROM external_busy e JOIN calendar_sources s ON s.id = e.source_id WHERE s.enabled = 1 AND e.date BETWEEN ? AND ? ORDER BY e.date, e.start_time`)
        .all(fromDate, toDate);
    },
  };

  app.jobs.push((nowMs) => svc.syncDue(nowMs));
  return svc;
}
