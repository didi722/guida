// Inviti alle agenzie: la guida scrive un indirizzo email e il sito manda un collegamento personale che apre la registrazione
// con l'account già approvato. Del collegamento si conserva solo l'impronta (SHA-256): chi legge il database non può usarlo.
// Vale 14 giorni e una volta sola. Funzioni sul database, senza rete né email.
import crypto from 'node:crypto';
import { tx } from './db.js';
import { normLang } from './langs.js';
import { emailInUse } from './team.js';
import { cleanText, isEmail } from './util.js';

export const INVITE_DAYS = 14;
const DAY = 86_400_000;
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newToken = () => crypto.randomBytes(24).toString('base64url');

export class InviteError extends Error {
  /** @param {'email'|'exists'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** open: si può usare · used: ha già creato l'account · expired: scaduto · cancelled: annullato dalla guida */
export const stateOf = (invite, nowMs = Date.now()) => (invite.used_at ? 'used' : invite.cancelled_at ? 'cancelled' : Date.parse(invite.expires_at) <= nowMs ? 'expired' : 'open');

const fields = (input) => ({
  company: cleanText(input.company, 160) || null,
  contactName: cleanText(input.contactName, 120) || null,
  lang: normLang(input.lang),
  note: cleanText(input.note, 600) || null,
});

/**
 * Un invito nuovo, oppure — se per lo stesso indirizzo ce n'è già uno aperto — lo stesso con un collegamento nuovo e una scadenza nuova
 * (il collegamento di prima smette di valere).
 * @returns {{ invite: object, token: string, reused: boolean }} `token` si vede solo adesso: va messo nell'email
 * @throws {InviteError} email non valida, o esiste già un account con quell'indirizzo
 */
export function createInvite(db, input, nowMs = Date.now()) {
  const email = cleanText(input.email, 254).toLowerCase();
  if (!isEmail(email)) throw new InviteError('email');
  if (emailInUse(db, email)) throw new InviteError('exists');
  const f = fields(input);
  return tx(db, () => {
    const token = newToken();
    const expires = new Date(nowMs + INVITE_DAYS * DAY).toISOString();
    const open = db.prepare('SELECT * FROM partner_invites WHERE email = ? AND used_at IS NULL AND cancelled_at IS NULL ORDER BY id DESC').get(email);
    if (open) {
      db.prepare('UPDATE partner_invites SET token_hash = ?, expires_at = ?, company = ?, contact_name = ?, lang = ?, note = ?, sent_at = NULL WHERE id = ?').run(hash(token), expires, f.company, f.contactName, f.lang, f.note, open.id);
      return { invite: db.prepare('SELECT * FROM partner_invites WHERE id = ?').get(open.id), token, reused: true };
    }
    const row = db
      .prepare('INSERT INTO partner_invites(email, company, contact_name, lang, note, token_hash, created_at, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .run(email, f.company, f.contactName, f.lang, f.note, hash(token), new Date(nowMs).toISOString(), expires);
    return { invite: db.prepare('SELECT * FROM partner_invites WHERE id = ?').get(Number(row.lastInsertRowid)), token, reused: false };
  });
}

/** L'invito che corrisponde al collegamento, con il suo stato (`unknown` se non c'è). */
export function inviteByToken(db, token, nowMs = Date.now()) {
  const t = typeof token === 'string' && token.length >= 20 && token.length <= 80 ? token : '';
  const invite = t ? db.prepare('SELECT * FROM partner_invites WHERE token_hash = ?').get(hash(t)) : null;
  return invite ? { state: stateOf(invite, nowMs), invite } : { state: 'unknown', invite: null };
}

/** Segna l'invito come usato (una volta sola, anche se due richieste arrivano insieme). @returns {boolean} false se non era più aperto */
export function markUsed(db, id, accountId, nowMs = Date.now()) {
  const when = new Date(nowMs).toISOString();
  return db.prepare('UPDATE partner_invites SET used_at = ?, account_id = ? WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > ?').run(when, accountId, id, when).changes === 1;
}

export const markSent = (db, id, nowMs = Date.now()) => db.prepare('UPDATE partner_invites SET sent_at = ? WHERE id = ?').run(new Date(nowMs).toISOString(), id);

export const getInvite = (db, id) => db.prepare('SELECT * FROM partner_invites WHERE id = ?').get(id) ?? null;

/** Tutti gli inviti, dal più recente, con lo stato e (se si sono registrati) l'agenzia. */
export function listInvites(db, nowMs = Date.now()) {
  return db
    .prepare('SELECT i.*, a.company AS account_company, a.status AS account_status FROM partner_invites i LEFT JOIN accounts a ON a.id = i.account_id ORDER BY i.id DESC')
    .all()
    .map((i) => ({ ...i, state: stateOf(i, nowMs) }));
}

/** La guida annulla un invito ancora aperto: il collegamento smette di valere. @returns {boolean} */
export function cancelInvite(db, id, nowMs = Date.now()) {
  return db.prepare('UPDATE partner_invites SET cancelled_at = ? WHERE id = ? AND used_at IS NULL AND cancelled_at IS NULL').run(new Date(nowMs).toISOString(), id).changes === 1;
}

/**
 * Un collegamento nuovo per un invito aperto o scaduto (non per uno usato o annullato), con una scadenza nuova.
 * @returns {{ invite: object, token: string } | null}
 */
export function renewInvite(db, id, nowMs = Date.now()) {
  return tx(db, () => {
    const i = getInvite(db, id);
    if (!i || i.used_at || i.cancelled_at) return null;
    if (emailInUse(db, i.email)) return null; // nel frattempo si è registrata da sola
    const token = newToken();
    db.prepare('UPDATE partner_invites SET token_hash = ?, expires_at = ?, sent_at = NULL WHERE id = ?').run(hash(token), new Date(nowMs + INVITE_DAYS * DAY).toISOString(), id);
    return { invite: getInvite(db, id), token };
  });
}
