// «Segnala un'agenzia collega»: ogni agenzia ha un codice (non personale) che sta nel collegamento al modulo di richiesta accesso.
// Serve solo a sapere chi porta nuove agenzie: l'approvazione resta sempre manuale e il codice non dà nessun vantaggio automatico.
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // senza lettere e cifre che si confondono (i, l, o, 0, 1)
const newCode = () => Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');

export const isRefCode = (s) => /^[a-z2-9]{6,12}$/.test(String(s ?? ''));

/** Il codice dell'agenzia (lo crea la prima volta che serve). */
export function refCodeOf(db, acct) {
  if (acct.ref_code) return acct.ref_code;
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    try {
      db.prepare('UPDATE accounts SET ref_code = ? WHERE id = ? AND ref_code IS NULL').run(code, acct.id);
    } catch {
      continue; // codice già preso (improbabile): se ne prova un altro
    }
    const row = db.prepare('SELECT ref_code FROM accounts WHERE id = ?').get(acct.id);
    if (row?.ref_code) return row.ref_code;
  }
  throw new Error('codice di segnalazione non creato');
}

/** L'agenzia (approvata) a cui appartiene il codice, oppure null: un codice sbagliato o di un'agenzia sospesa si ignora. */
export function findReferrer(db, code) {
  const c = String(code ?? '').trim().toLowerCase();
  if (!isRefCode(c)) return null;
  const a = db.prepare("SELECT id, company, email, ref_code FROM accounts WHERE ref_code = ? AND status = 'approved'").get(c);
  return a ? { id: a.id, company: a.company, email: a.email, code: a.ref_code } : null;
}

/** Il collegamento da condividere, nella lingua dell'agenzia che lo manda. */
export const referralUrl = (cfg, lang, code) => `${cfg.baseUrl}/${lang}/b2b/register?ref=${code}`;

/** Chi ha segnalato questa agenzia (o null). */
export function referrerOf(db, acct) {
  if (!acct.referred_by) return null;
  return db.prepare('SELECT id, company, email FROM accounts WHERE id = ?').get(acct.referred_by) ?? null;
}

/** Le agenzie segnalate da questa. */
export const referralsOf = (db, id) => db.prepare('SELECT id, company, status FROM accounts WHERE referred_by = ? ORDER BY created_at').all(id);
