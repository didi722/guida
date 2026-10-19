// Più persone per agenzia: il titolare (l'account stesso) e i collaboratori. Ognuno entra con la sua email e la sua password e lavora
// sulle prenotazioni dell'agenzia; il titolare invita e toglie i collaboratori. Del collegamento dell'invito si conserva solo l'impronta
// (SHA-256). Funzioni sul database, senza rete né email.
import crypto from 'node:crypto';
import { tx } from './db.js';
import { normLang } from './langs.js';
import { cleanText, isEmail } from './util.js';

export const MAX_MEMBERS = 10;
export const TEAM_INVITE_DAYS = 7;
const DAY = 86_400_000;
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');

export class TeamError extends Error {
  /** @param {'name'|'email'|'exists'|'limit'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** L'indirizzo è già di un account o di un collaboratore? (L'email decide chi entra: non può essere di due persone.) */
export function emailInUse(db, email) {
  const e = String(email ?? '').trim().toLowerCase();
  return !!(db.prepare('SELECT 1 FROM accounts WHERE email = ?').get(e) || db.prepare('SELECT 1 FROM account_users WHERE email = ?').get(e));
}

/**
 * Chi sta lavorando: il titolare (l'account) o un collaboratore. `userId` è vuoto per il titolare, come nelle prenotazioni fatte da lui.
 * @returns {{ userId: number|null, name: string, email: string, lang: string, owner: boolean }}
 */
export const actorOf = (acct, user = null) =>
  user ? { userId: user.id, name: user.name, email: user.email, lang: normLang(user.lang), owner: false } : { userId: null, name: acct.contact_name, email: acct.email, lang: normLang(acct.lang), owner: true };

/** Chi ha fatto una prenotazione, da mettere nei dati della prenotazione (vuoto se non è nessuno in particolare). */
export const bookedBy = (actor) => (actor ? { userId: actor.userId ?? null, name: actor.name } : null);

export const listMembers = (db, accountId) => db.prepare('SELECT * FROM account_users WHERE account_id = ? ORDER BY id').all(accountId);
export const teamSize = (db, accountId) => db.prepare('SELECT COUNT(*) AS n FROM account_users WHERE account_id = ?').get(accountId).n;
export const getMember = (db, accountId, id) => db.prepare('SELECT * FROM account_users WHERE id = ? AND account_id = ?').get(Number(id), accountId) ?? null;

/** Un collaboratore con la password già scelta, dal suo indirizzo (per entrare o per chiedere una nuova password). */
export const activeMemberByEmail = (db, email) => db.prepare('SELECT * FROM account_users WHERE email = ? AND password_hash IS NOT NULL').get(String(email ?? '').trim().toLowerCase()) ?? null;

/**
 * Chi può entrare con questo indirizzo: il titolare di un account o un collaboratore con la password scelta.
 * @returns {{ acct: object, user: object|null } | null}
 */
export function loginTarget(db, email) {
  const e = String(email ?? '').trim().toLowerCase();
  const acct = db.prepare('SELECT * FROM accounts WHERE email = ?').get(e);
  if (acct) return { acct, user: null };
  const user = activeMemberByEmail(db, e);
  const owner = user ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(user.account_id) : null;
  return owner ? { acct: owner, user } : null;
}

/**
 * Invita un collaboratore: nasce senza password, con un collegamento personale (vale 7 giorni) per sceglierla.
 * @returns {{ user: object, token: string }} `token` si vede solo adesso: va messo nell'email
 * @throws {TeamError} nome o email non validi, indirizzo già in uso, troppi collaboratori
 */
export function inviteMember(db, account, input, nowMs = Date.now()) {
  const name = cleanText(input.name, 120);
  const email = cleanText(input.email, 254).toLowerCase();
  if (name.length < 2) throw new TeamError('name');
  if (!isEmail(email)) throw new TeamError('email');
  return tx(db, () => {
    if (emailInUse(db, email)) throw new TeamError('exists');
    if (teamSize(db, account.id) >= MAX_MEMBERS) throw new TeamError('limit');
    const token = newToken();
    const info = db
      .prepare('INSERT INTO account_users(account_id, email, name, lang, token_hash, token_expires_at, invited_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(account.id, email, name, normLang(input.lang), hash(token), new Date(nowMs + TEAM_INVITE_DAYS * DAY).toISOString(), new Date(nowMs).toISOString());
    return { user: db.prepare('SELECT * FROM account_users WHERE id = ?').get(Number(info.lastInsertRowid)), token };
  });
}

/** Un collegamento nuovo (e una scadenza nuova) per un collaboratore che non ha ancora scelto la password; il vecchio smette di valere. */
export function renewMemberInvite(db, accountId, id, nowMs = Date.now()) {
  return tx(db, () => {
    const user = getMember(db, accountId, id);
    if (!user || user.activated_at) return null;
    const token = newToken();
    db.prepare('UPDATE account_users SET token_hash = ?, token_expires_at = ?, invited_at = ? WHERE id = ?').run(hash(token), new Date(nowMs + TEAM_INVITE_DAYS * DAY).toISOString(), new Date(nowMs).toISOString(), user.id);
    return { user: db.prepare('SELECT * FROM account_users WHERE id = ?').get(user.id), token };
  });
}

/**
 * L'invito che corrisponde al collegamento. open: si può usare · expired: scaduto · used: la password è già stata scelta · unknown: non c'è.
 * @returns {{ state: 'open'|'expired'|'used'|'unknown', user: object|null, account: object|null }}
 */
export function memberByToken(db, token, nowMs = Date.now()) {
  const t = typeof token === 'string' && token.length >= 20 && token.length <= 80 ? token : '';
  const user = t ? db.prepare('SELECT * FROM account_users WHERE token_hash = ?').get(hash(t)) : null;
  if (!user) return { state: 'unknown', user: null, account: null };
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(user.account_id);
  const state = user.activated_at ? 'used' : Date.parse(user.token_expires_at) <= nowMs ? 'expired' : 'open';
  return { state, user, account };
}

/** Il collaboratore sceglie la password (una volta sola, anche se due richieste arrivano insieme). @returns {boolean} false se non era più aperto */
export function activateMember(db, id, passwordHash, nowMs = Date.now()) {
  const when = new Date(nowMs).toISOString();
  return db.prepare('UPDATE account_users SET password_hash = ?, activated_at = ?, last_login_at = ? WHERE id = ? AND activated_at IS NULL AND token_expires_at > ?').run(passwordHash, when, when, id, when).changes === 1;
}

export const touchLogin = (db, id, nowMs = Date.now()) => db.prepare('UPDATE account_users SET last_login_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), id);

/**
 * Toglie un collaboratore: non può più entrare (le sessioni aperte smettono di valere subito), il suo carrello sparisce e gli avvisi
 * della lista d'attesa che aveva chiesto passano al titolare. Le prenotazioni restano, con il suo nome.
 * @returns {boolean}
 */
export function removeMember(db, accountId, id) {
  return tx(db, () => {
    const user = getMember(db, accountId, id);
    if (!user) return false;
    db.prepare('DELETE FROM cart_items WHERE account_id = ? AND user_id = ?').run(accountId, user.id);
    db.prepare('UPDATE waitlist SET user_id = NULL WHERE account_id = ? AND user_id = ?').run(accountId, user.id);
    db.prepare('DELETE FROM account_users WHERE id = ?').run(user.id);
    return true;
  });
}
