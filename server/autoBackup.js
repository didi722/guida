// Copia automatica: ogni giorno uno zip come quello che si scarica da Aiuto › Backup, messo FUORI dal server
// (un servizio compatibile S3 e/o una cartella: un disco montato, un NAS…), con la rotazione delle copie vecchie.
// Lo stato e i risultati stanno in una impostazione (`auto_backup`) e la pagina Aiuto › Backup li mostra.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backupEntries, backupFileName, writeZip } from './backup.js';
import { getSetting, setSetting } from './db.js';
import { notifyBackupFailed } from './emails.js';
import { S3Error, createS3 } from './s3.js';
import { addDays, nowRome } from './time.js';

export const SETTING = 'auto_backup';
/** Il nome di una copia automatica (e solo di queste: ciò che non lo ha non si tocca mai). */
export const NAME = /^guida-backup-(\d{4}-\d{2}-\d{2})\.zip$/;
const RETRY_MS = 30 * 60_000; // dopo un errore si riprova dopo mezz'ora…
const MAX_ATTEMPTS = 4; // …al massimo quattro volte al giorno
const STALE_RUNNING_MS = 3 * 3600_000; // una copia «in corso» da più di così è rimasta a metà (riavvio del server)
const REMIND_MS = 3 * 86400_000; // l'email di errore si ripete dopo tre giorni, se continua
const MAX_DELETES = 30; // cancellazioni per giro: una configurazione sbagliata non svuota la cartella in un colpo

/**
 * Quali copie tenere: le ultime `keepDays` e, per ciascuno degli ultimi `keepMonths` mesi, la più vecchia di quel mese.
 * @param {string[]} dates date delle copie (AAAA-MM-GG)
 * @returns {{ keep: string[], remove: string[] }} (la copia più recente non si toglie mai)
 */
export function retentionPlan(dates, { keepDays, keepMonths }) {
  const sorted = [...new Set(dates)].sort().reverse(); // dalla più recente
  const keep = new Set(sorted.slice(0, Math.max(1, keepDays)));
  if (keepMonths > 0) {
    const months = [...new Set(sorted.map((d) => d.slice(0, 7)))].slice(0, keepMonths);
    for (const month of months) keep.add(sorted.filter((d) => d.startsWith(month)).at(-1));
  }
  return { keep: [...keep].sort(), remove: sorted.filter((d) => !keep.has(d)) };
}

const messageOf = (err) => (err instanceof S3Error ? err.message : err?.code === 'EACCES' ? 'La cartella non è scrivibile dal sito: controlla i permessi.' : err?.code === 'ENOSPC' ? 'Spazio esaurito.' : err?.code === 'ENOENT' ? 'La cartella non esiste e non riesco a crearla.' : `Errore: ${err?.message ?? err}`);

// ───────────── le destinazioni ─────────────
function dirDestination(dir) {
  const full = (name) => path.join(dir, name);
  return {
    id: 'dir',
    label: 'Cartella',
    where: dir,
    async put(file, name, { size }) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const partial = full(`.${name}.partial`);
      fs.copyFileSync(file, partial);
      fs.renameSync(partial, full(name));
      if (fs.statSync(full(name)).size !== size) throw new Error('La copia nella cartella non ha la dimensione giusta.');
    },
    async list() {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((n) => NAME.test(n))
        .map((name) => ({ name, bytes: fs.statSync(full(name)).size, at: fs.statSync(full(name)).mtime.toISOString() }));
    },
    async remove(name) {
      fs.rmSync(full(name), { force: true });
    },
    async test() {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const probe = full(`.prova-${crypto.randomBytes(4).toString('hex')}`);
      fs.writeFileSync(probe, 'prova');
      fs.rmSync(probe);
    },
    link: (name) => (fs.existsSync(full(name)) ? { file: full(name) } : null),
  };
}

function s3Destination(c, fetchImpl) {
  const s3 = createS3({ endpoint: c.endpoint, bucket: c.bucket, region: c.region, accessKey: c.accessKey, secretKey: c.secretKey, prefix: c.prefix, pathStyle: c.pathStyle, fetchImpl });
  return {
    id: 's3',
    label: 'Servizio S3',
    where: `${new URL(/^https?:\/\//i.test(c.endpoint) ? c.endpoint : `https://${c.endpoint}`).host} · bucket ${c.bucket}${c.prefix ? ` · cartella ${c.prefix.replace(/^\/+|\/*$/g, '')}/` : ''}`,
    async put(file, name, { size }) {
      await s3.putFile(name, file);
      const seen = await s3.head(name);
      if (!seen || seen.size !== size) throw new S3Error('Il file è stato caricato ma sul servizio risulta di una dimensione diversa: la copia non è affidabile.');
    },
    async list() {
      return (await s3.list()).filter((o) => NAME.test(o.name)).map((o) => ({ name: o.name, bytes: o.size, at: o.modified }));
    },
    async remove(name) {
      await s3.delete(name);
    },
    test: () => s3.check(),
    link: (name, { filename }) => ({ url: s3.presign(name, { expires: 300, filename }) }),
  };
}

export function createAutoBackup(app, { fetchImpl = fetch } = {}) {
  const { cfg, db } = app;
  let busy = false;
  const read = () => ({ running: null, lastAttemptAt: null, attempts: null, lastOk: null, lastError: null, notifiedAt: null, lastTest: null, copies: {}, copiesError: {}, ...getSetting(db, SETTING, {}) });
  const write = (state) => setSetting(db, SETTING, state);
  const update = (fn) => {
    const state = read();
    fn(state);
    write(state);
    return state;
  };
  const iso = (ms) => new Date(ms).toISOString();

  const destinations = () => {
    const b = cfg.backup;
    const out = [];
    if (b.dir) out.push(dirDestination(b.dir));
    if (b.s3.endpoint && b.s3.bucket && b.s3.accessKey && b.s3.secretKey) out.push(s3Destination(b.s3, fetchImpl));
    return out;
  };

  /** Toglie le copie che non servono più; un errore qui non rovina la copia appena fatta. */
  async function prune(dest) {
    const { keepDays, keepMonths } = cfg.backup.auto;
    const list = await dest.list();
    const { remove } = retentionPlan(list.map((c) => NAME.exec(c.name)[1]), { keepDays, keepMonths });
    for (const date of remove.slice(0, MAX_DELETES)) await dest.remove(`guida-backup-${date}.zip`);
    return remove.length;
  }

  /** Prepara lo zip in un file temporaneo e lo porta su ogni destinazione. Il file si cancella sempre. */
  async function build(dests, nowMs) {
    const started = Date.now();
    const name = backupFileName(nowMs);
    const tmp = path.join(cfg.dataDir, `.auto-backup-${crypto.randomBytes(4).toString('hex')}.zip`);
    const results = {};
    const copies = {};
    let bytes = 0;
    try {
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      try {
        await writeZip(out, backupEntries(app, nowMs), new Date(nowMs));
      } finally {
        await new Promise((resolve) => out.end(resolve));
      }
      bytes = fs.statSync(tmp).size;
      for (const dest of dests) {
        try {
          await dest.put(tmp, name, { size: bytes });
          results[dest.id] = { ok: true };
        } catch (err) {
          results[dest.id] = { ok: false, error: messageOf(err) };
          continue;
        }
        try {
          const removed = await prune(dest);
          if (removed) results[dest.id].removed = removed;
          copies[dest.id] = { at: iso(Date.now()), list: await dest.list() };
        } catch (err) {
          results[dest.id].warning = `La copia c’è, ma non riesco a mettere in ordine le vecchie: ${messageOf(err)}`;
        }
      }
    } catch (err) {
      for (const dest of dests) results[dest.id] = { ok: false, error: `Non sono riuscito a preparare la copia: ${messageOf(err)}` };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return { name, bytes, results, copies, ms: Date.now() - started };
  }

  /** Scrive l'esito nello stato e, se la copia di una notte non è riuscita, avvisa la guida (una volta, poi ogni tre giorni). */
  async function finish(dests, made, nowMs, trigger) {
    const { name, bytes, results, copies, ms } = made;
    const ok = Object.values(results).every((r) => r.ok);
    const failed = dests.filter((d) => !results[d.id].ok).map((d) => `${d.label} (${d.where}): ${results[d.id].error}`);
    const day = nowRome(nowMs).date;
    let notify = false;
    update((s) => {
      s.running = null;
      s.lastAttemptAt = iso(nowMs);
      s.attempts = { date: day, n: (s.attempts?.date === day ? s.attempts.n : 0) + 1 };
      Object.assign(s.copies, copies);
      for (const id of Object.keys(copies)) delete s.copiesError[id];
      if (ok) {
        s.lastOk = { at: iso(nowMs), date: day, name, bytes, ms, dests: dests.map((d) => d.id), warnings: Object.values(results).map((r) => r.warning).filter(Boolean) };
        s.lastError = null;
      } else {
        const first = !s.lastError;
        s.lastError = { at: iso(nowMs), message: failed.join(' · '), trigger };
        notify = trigger === 'auto' && (first || !s.notifiedAt || nowMs - Date.parse(s.notifiedAt) >= REMIND_MS);
        if (notify) s.notifiedAt = iso(nowMs);
      }
    });
    if (notify) await notifyBackupFailed(app, { message: failed.join('\n') }).catch((err) => console.error('[copia automatica] avviso non partito:', err));
    return { ok, results };
  }

  const svc = {
    /** Le destinazioni configurate sul server (cartella e/o S3), senza chiavi. */
    destinations: () => destinations().map(({ id, label, where }) => ({ id, label, where })),

    /** C'è una copia in corso? (anche se il server è stato riavviato a metà: dopo qualche ora non vale più) */
    running(nowMs = Date.now()) {
      if (busy) return true;
      const r = read().running;
      return Boolean(r && nowMs - Date.parse(r.at) < STALE_RUNNING_MS);
    },

    /** È ora di farla? Dall'ora scelta in poi, una volta al giorno; se non riesce si riprova ogni mezz'ora, al massimo quattro volte. */
    due(nowMs = Date.now()) {
      const auto = cfg.backup.auto;
      if (!auto.enabled || !destinations().length || svc.running(nowMs)) return false;
      const now = nowRome(nowMs);
      if (Number(now.time.slice(0, 2)) < auto.hour) return false;
      const state = read();
      if (state.lastOk?.date === now.date) return false;
      if ((state.attempts?.date === now.date ? state.attempts.n : 0) >= MAX_ATTEMPTS) return false;
      return !state.lastAttemptAt || nowMs - Date.parse(state.lastAttemptAt) >= RETRY_MS;
    },

    /**
     * Fa la copia adesso e la porta su tutte le destinazioni. Non lancia mai: il risultato sta nello stato.
     * @returns {Promise<{ok: boolean, busy?: boolean, none?: boolean, results?: object}>}
     */
    async run({ nowMs = Date.now(), trigger = 'auto' } = {}) {
      if (svc.running(nowMs)) return { ok: false, busy: true };
      const dests = destinations();
      if (!dests.length) return { ok: false, none: true };
      busy = true; // da qui fino alla fine nessun'altra copia può partire
      try {
        update((s) => {
          s.running = { at: iso(nowMs), trigger };
        });
        const made = await build(dests, nowMs);
        return await finish(dests, made, nowMs, trigger);
      } finally {
        busy = false;
      }
    },

    /** Dal pannello: la copia parte in secondo piano (può durare qualche minuto) e la pagina mostra l'esito. */
    start(trigger = 'manual') {
      if (svc.running()) return { busy: true };
      if (!destinations().length) return { none: true };
      svc.run({ trigger }).catch((err) => console.error('[copia automatica] errore:', err));
      return { started: true };
    },

    /** Lavoro periodico (ogni minuto). */
    async sweep(nowMs = Date.now()) {
      if (svc.due(nowMs)) await svc.run({ nowMs, trigger: 'auto' });
    },

    /** Prova ogni destinazione senza fare la copia: scrive un file piccolo, lo ritrova e lo cancella. */
    async test(nowMs = Date.now()) {
      const results = [];
      for (const dest of destinations()) {
        try {
          await dest.test();
          results.push({ id: dest.id, label: dest.label, where: dest.where, ok: true });
        } catch (err) {
          results.push({ id: dest.id, label: dest.label, where: dest.where, ok: false, error: messageOf(err) });
        }
      }
      update((s) => {
        s.lastTest = { at: iso(nowMs), results };
      });
      return results;
    },

    /** Rilegge l'elenco delle copie presenti sulle destinazioni. */
    async refreshCopies(nowMs = Date.now()) {
      const copies = {};
      const errors = {};
      for (const dest of destinations()) {
        try {
          copies[dest.id] = { at: iso(nowMs), list: await dest.list() };
        } catch (err) {
          errors[dest.id] = messageOf(err);
        }
      }
      update((s) => {
        Object.assign(s.copies, copies);
        s.copiesError = errors;
      });
      return { copies, errors };
    },

    /** Dove si scarica una copia: un indirizzo temporaneo (S3) o un file (cartella). Solo nomi di copie automatiche. */
    link(destId, name) {
      if (!NAME.test(String(name))) return null;
      const dest = destinations().find((d) => d.id === destId);
      return dest ? dest.link(name, { filename: name }) : null;
    },

    /** Per la pagina del pannello. */
    status(nowMs = Date.now()) {
      const auto = cfg.backup.auto;
      const dests = svc.destinations();
      const state = read();
      const now = nowRome(nowMs);
      const doneToday = state.lastOk?.date === now.date;
      const attempts = state.attempts?.date === now.date ? state.attempts.n : 0;
      let next = null;
      if (auto.enabled && dests.length) {
        const late = !doneToday && Number(now.time.slice(0, 2)) >= auto.hour && attempts < MAX_ATTEMPTS; // l'ora è passata e manca la copia di oggi: parte a momenti
        next = { date: doneToday || attempts >= MAX_ATTEMPTS ? addDays(now.date, 1) : now.date, hour: auto.hour, soon: late };
      }
      return {
        enabled: auto.enabled,
        hour: auto.hour,
        keepDays: auto.keepDays,
        keepMonths: auto.keepMonths,
        destinations: dests,
        configured: dests.length > 0,
        running: svc.running(nowMs),
        lastOk: state.lastOk,
        lastError: state.lastError,
        lastTest: state.lastTest,
        next,
        copies: state.copies,
        copiesError: state.copiesError,
      };
    },

    /** Per «Da fare»: se la copia automatica è accesa e non sta funzionando. */
    problem(nowMs = Date.now()) {
      const auto = cfg.backup.auto;
      if (!auto.enabled || !destinations().length) return null;
      const state = read();
      if (state.lastError) return { tone: 'err', text: 'La copia automatica di sicurezza non è riuscita', meta: state.lastError.message };
      const now = nowRome(nowMs);
      const lastDate = state.lastOk?.date;
      const behind = lastDate ? (Date.parse(`${now.date}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86400_000 : null;
      if (behind !== null && behind >= 3) return { tone: 'warn', text: `Nessuna copia automatica da ${behind} giorni`, meta: 'controlla che il server sia acceso e la destinazione raggiungibile' };
      return null;
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
