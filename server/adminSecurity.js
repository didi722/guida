// Sicurezza del pannello: accesso a due passaggi (codice a tempo dell'app di autenticazione), codici di emergenza,
// blocco dopo troppi codici sbagliati e «esci da tutti i dispositivi». Lo stato sta in una sola impostazione riservata
// (`admin_security`, vedi privateSettings.js): niente di tutto questo esce dal server con una copia di sicurezza.
import crypto from 'node:crypto';
import { getSetting, setSetting, tx } from './db.js';
import { PRIVATE_SETTINGS } from './privateSettings.js';
import { base32Decode, base32Encode, generateRecoveryCodes, generateSecret, groupKey, hashRecovery, looksLikeRecovery, otpauthUri, showRecovery, verifyTotp } from './totp.js';

const KEY = PRIVATE_SETTINGS[0];
/** Codici sbagliati di fila prima del blocco. */
export const MAX_FAILS = 5;
/** Il primo blocco dura un quarto d'ora; ogni blocco successivo raddoppia, fino a un massimo di sei ore. */
export const LOCK_BASE_MS = 15 * 60_000;
export const LOCK_MAX_MS = 6 * 3600_000;
/** Dopo quanto la chiave mostrata durante l'attivazione non vale più (se non si conferma). */
export const PENDING_MS = 30 * 60_000;

const sameHex = (a, b) => {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

export function createAdminSecurity(app) {
  const { cfg, db } = app;
  const read = () => ({ epoch: 0, pending: null, totp: null, ...getSetting(db, KEY, {}) });
  const write = (state) => setSetting(db, KEY, state);
  // cambiare la password del pannello scollega tutti: il suo impronta entra nel segno delle sessioni
  const passwordTag = () => crypto.createHmac('sha256', cfg.sessionSecret).update(`admin-password|${cfg.admin.password}`).digest('base64url').slice(0, 12);
  const label = () => {
    let host = 'sito';
    try {
      host = new URL(cfg.baseUrl).hostname;
    } catch {
      /* resta «sito» */
    }
    return { issuer: cfg.site.name, account: `Pannello@${host}` };
  };
  const setupInfo = (secretB32) => ({ key: secretB32, grouped: groupKey(base32Decode(secretB32)), uri: otpauthUri({ secret: base32Decode(secretB32), ...label() }) });

  return {
    enabled: () => Boolean(read().totp),

    /** Il segno scritto nei cookie di sessione: cambia con «esci da tutti i dispositivi», con l'attivazione del secondo passaggio e con la password. */
    sessionTag: () => `${read().epoch}.${passwordTag()}`,

    status(nowMs = Date.now()) {
      const { totp } = read();
      return {
        enabled: Boolean(totp),
        enabledAt: totp?.at ?? null,
        recoveryLeft: totp?.recovery.length ?? 0,
        locked: Boolean(totp && totp.lockedUntil > nowMs),
        lockedUntil: totp?.lockedUntil ?? 0,
      };
    },

    /** Prepara una chiave nuova da mostrare (o riprende quella già mostrata da poco, così il codice QR non cambia a ogni ricarica). */
    beginSetup(nowMs = Date.now()) {
      return tx(db, () => {
        const state = read();
        if (state.totp) return null;
        if (!state.pending || nowMs - state.pending.at > PENDING_MS) {
          state.pending = { secret: base32Encode(generateSecret()), at: nowMs };
          write(state);
        }
        return setupInfo(state.pending.secret);
      });
    },

    pendingSetup(nowMs = Date.now()) {
      const { pending, totp } = read();
      return !totp && pending && nowMs - pending.at <= PENDING_MS ? setupInfo(pending.secret) : null;
    },

    /** Chiude l'attivazione: il codice digitato dev'essere quello della chiave mostrata. Dà i codici di emergenza (si vedono solo ora). */
    confirmSetup(code, nowMs = Date.now()) {
      return tx(db, () => {
        const state = read();
        if (state.totp) return { ok: false, reason: 'enabled' };
        if (!state.pending || nowMs - state.pending.at > PENDING_MS) return { ok: false, reason: 'nopending' };
        const found = verifyTotp(base32Decode(state.pending.secret), code, nowMs);
        if (!found.ok) return { ok: false, reason: 'code' };
        const codes = generateRecoveryCodes();
        const salt = crypto.randomBytes(16).toString('hex');
        state.totp = { secret: state.pending.secret, at: new Date(nowMs).toISOString(), lastStep: found.step, salt, recovery: codes.map((c) => hashRecovery(c, salt)), fails: 0, bursts: 0, lockedUntil: 0 };
        state.pending = null;
        state.epoch += 1; // chi era già dentro (anche altrove) rientra con il secondo passaggio
        write(state);
        return { ok: true, recoveryCodes: codes.map(showRecovery) };
      });
    },

    /**
     * Controlla il secondo passaggio: il codice a 6 cifre dell'app (vale una volta sola) oppure un codice di emergenza (si consuma).
     * Dopo MAX_FAILS errori di fila blocca ogni tentativo per un po', anche quelli giusti.
     * @returns {{ok: true, kind: 'totp'|'recovery', recoveryLeft: number} | {ok: false, reason: 'off'|'format'|'wrong'|'locked', retryAfterMs?: number, locked?: boolean}}
     */
    verify(code, nowMs = Date.now()) {
      return tx(db, () => {
        const state = read();
        const t = state.totp;
        if (!t) return { ok: false, reason: 'off' };
        if (t.lockedUntil > nowMs) return { ok: false, reason: 'locked', retryAfterMs: t.lockedUntil - nowMs };
        const text = String(code ?? '');
        const digits = text.replace(/[\s-]/g, '');
        let result;
        if (/^\d{6}$/.test(digits)) {
          const found = verifyTotp(base32Decode(t.secret), digits, nowMs, { after: t.lastStep });
          if (found.ok) t.lastStep = found.step;
          result = found.ok ? { ok: true, kind: 'totp' } : { ok: false, reason: 'wrong' };
        } else if (looksLikeRecovery(text)) {
          const hash = hashRecovery(text, t.salt);
          const at = t.recovery.findIndex((h) => sameHex(h, hash));
          if (at >= 0) t.recovery.splice(at, 1);
          result = at >= 0 ? { ok: true, kind: 'recovery' } : { ok: false, reason: 'wrong' };
        } else {
          return { ok: false, reason: 'format' }; // un errore di battitura (cifre in meno) non conta come tentativo
        }
        if (result.ok) {
          t.fails = 0;
          t.bursts = 0;
          t.lockedUntil = 0;
          result.recoveryLeft = t.recovery.length;
        } else {
          t.fails += 1;
          if (t.fails >= MAX_FAILS) {
            t.lockedUntil = nowMs + Math.min(LOCK_BASE_MS * 2 ** t.bursts, LOCK_MAX_MS);
            t.bursts += 1;
            t.fails = 0;
            result.locked = true;
            result.retryAfterMs = t.lockedUntil - nowMs;
          }
        }
        write(state);
        return result;
      });
    },

    /** Spegne il secondo passaggio (la richiesta controlla prima un codice). */
    disable() {
      tx(db, () => {
        const state = read();
        state.totp = null;
        state.pending = null;
        write(state);
      });
    },

    /** Nuovi codici di emergenza: i vecchi non valgono più. */
    regenerateRecovery() {
      return tx(db, () => {
        const state = read();
        if (!state.totp) return null;
        const codes = generateRecoveryCodes();
        state.totp.salt = crypto.randomBytes(16).toString('hex');
        state.totp.recovery = codes.map((c) => hashRecovery(c, state.totp.salt));
        write(state);
        return codes.map(showRecovery);
      });
    },

    /** «Esci da tutti i dispositivi»: i cookie emessi finora smettono di valere. */
    revokeSessions() {
      tx(db, () => {
        const state = read();
        state.epoch += 1;
        write(state);
      });
    },

    /** Dal terminale del server, se si perdono telefono e codici di emergenza (npm run admin:2fa-off, scripts/admin-2fa-off.mjs). */
    reset() {
      tx(db, () => {
        const state = read();
        state.totp = null;
        state.pending = null;
        state.epoch += 1;
        write(state);
      });
    },
  };
}
