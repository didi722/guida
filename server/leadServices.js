// Commerciale: ciò che ha effetti fuori dal database — spedire le email di presentazione (subito o dalla coda, con un tetto al giorno),
// invitare un'agenzia sul sito e creare il suo profilo B2B. La logica dei dati sta in leads.js e leadMail.js.
import crypto from 'node:crypto';
import { hashPassword, passwordFingerprint, signToken } from './auth.js';
import { tx } from './db.js';
import { sendPartnerInvite, sendPartnerWelcome } from './emails.js';
import { COLD_STATUSES, LeadError, STATUS_LABEL, getContact, getLead, isSuppressed, listContacts, logActivity, setNextAction, setStatus, syncAccounts } from './leads.js';
import { COLD_TEMPLATES, composeEmail, getEmail, inWindow, lastSentAt, queueEmail, renderOutgoing, sendSettings, sentOn } from './leadMail.js';
import { normLang } from './langs.js';
import { InviteError, createInvite, inviteUrl, markSent } from './partnerInvites.js';
import { emailInUse } from './team.js';
import { addDays, nowRome } from './time.js';
import { cleanText } from './util.js';

export const PROFILE_LINK_DAYS = 7;
const DAY = 86_400_000;
const RETRY_MS = 30 * 60_000; // se la posta non risponde si riprova dopo mezz'ora…
const MAX_ATTEMPTS = 3; // …al massimo tre volte
const NEXT_TEXT = { presentation: 'Ricontattare se non risponde', followup: 'Dopo il sollecito: telefonare o chiudere', thanks: 'Sentirsi per il seguito', custom: 'Ricontattare se non risponde' };
const iso = (ms) => new Date(ms).toISOString();

export function createLeadServices(app) {
  const { db, cfg } = app;

  /** Perché questa email non deve partire (oppure null). Vale al momento dell'invio, anche per quelle messe in coda giorni prima. */
  function blockReason(lead, row) {
    if (!lead) return 'Il contatto non c’è più';
    if (!lead.email_ok || isSuppressed(db, row.to_email)) return 'Non vuole più ricevere email';
    if (COLD_TEMPLATES.includes(row.template) && ['lost', 'client'].includes(lead.status)) return `Il contatto è «${STATUS_LABEL[lead.status]}»`;
    if (row.only_if_quiet && !COLD_STATUSES.includes(lead.status)) return `Nel frattempo il contatto è passato a «${STATUS_LABEL[lead.status]}»`;
    return null;
  }

  /** Dopo un invio riuscito: la riga nel registro, il prossimo richiamo e — se richiesto — il sollecito in coda. */
  function afterSent(row, nowMs) {
    const lead = getLead(db, row.lead_id);
    const today = nowRome(nowMs).date;
    logActivity(db, lead.id, { kind: 'email_out', contactId: row.contact_id, title: row.subject, body: row.body, nowMs });
    const days = row.followup_days ?? sendSettings(db).followUpDays;
    const fresh = getLead(db, lead.id);
    if (!fresh.next_action_on || fresh.next_action_on <= today) setNextAction(db, lead.id, { on: addDays(today, days), text: row.followup_days ? 'Sollecito automatico in coda' : NEXT_TEXT[row.template] ?? NEXT_TEXT.custom }, nowMs);
    if (row.followup_days) {
      try {
        const contact = row.contact_id ? getContact(db, lead.id, row.contact_id) : null;
        const f = composeEmail(app, { lead: fresh, contact, template: 'followup', lang: row.lang });
        queueEmail(db, { leadId: lead.id, contactId: row.contact_id, to: row.to_email, template: 'followup', lang: row.lang, subject: f.subject, body: f.body, sendAfter: nowMs + row.followup_days * DAY, onlyIfQuiet: true }, nowMs);
      } catch (err) {
        if (!(err instanceof LeadError)) throw err; // (ce n'è già uno in coda, o nel frattempo non vuole più email: nessun sollecito)
      }
    }
  }

  const svc = {
    /**
     * Spedisce un'email della coda. Se non deve partire (non vuole più email, nel frattempo ha risposto…) la segna come saltata e dice perché.
     * Parte al più una volta: la riga si «prenota» prima di spedire, come per i promemoria.
     * @returns {Promise<{ sent: boolean, skipped?: string, failed?: boolean }>}
     */
    async deliver(id, { nowMs = Date.now(), retry = true } = {}) {
      const row = getEmail(db, id);
      if (!row || row.status !== 'queued') return { sent: false };
      const lead = getLead(db, row.lead_id);
      const reason = blockReason(lead, row);
      if (reason) {
        db.prepare("UPDATE lead_emails SET status = 'skipped', note = ? WHERE id = ? AND status = 'queued'").run(reason, id);
        return { sent: false, skipped: reason };
      }
      const claimed = db.prepare("UPDATE lead_emails SET status = 'sent', sent_at = ?, attempts = attempts + 1, note = NULL WHERE id = ? AND status = 'queued'").run(iso(nowMs), id).changes;
      if (claimed !== 1) return { sent: false };
      const out = renderOutgoing(app, { lead, lang: row.lang, subject: row.subject, body: row.body }, nowMs);
      let ok = false;
      try {
        ok = await app.mail.send({ to: row.to_email, subject: out.subject, text: out.text, html: out.html, headers: out.headers, replyTo: cfg.mail.notifyTo || undefined });
      } catch (err) {
        console.error('[commerciale] invio non riuscito:', err.message);
      }
      if (!ok) {
        if (!retry || row.attempts + 1 >= MAX_ATTEMPTS) db.prepare("UPDATE lead_emails SET status = 'failed', sent_at = NULL, note = ? WHERE id = ?").run('L’email non è partita: controlla la posta in Aiuto › Email.', id);
        else db.prepare("UPDATE lead_emails SET status = 'queued', sent_at = NULL, send_after = ? WHERE id = ?").run(iso(nowMs + RETRY_MS), id);
        return { sent: false, failed: true };
      }
      afterSent(getEmail(db, id), nowMs);
      return { sent: true };
    },

    /**
     * Scrive a un contatto: subito (`mode: 'now'`) oppure in coda (`'queue'`, parte quando tocca, dentro i limiti d'invio).
     * @param {{ leadId: number, contactId?: number|null, to: string, template: string, lang: string, subject: string, body: string, mode: 'now'|'queue', sendAfter?: number, followupDays?: number|null }} input
     * @throws {LeadError} come `queueEmail`
     */
    async write(input, nowMs = Date.now()) {
      const row = queueEmail(db, { ...input, sendAfter: input.mode === 'now' ? nowMs : input.sendAfter }, nowMs);
      if (input.mode !== 'now') return { row, queued: true };
      const r = await svc.deliver(row.id, { nowMs, retry: false });
      return { row: getEmail(db, row.id), ...r };
    },

    /** Una prova al tuo indirizzo, con il link per non ricevere più email reso inoffensivo. @returns {Promise<boolean>} */
    async preview({ lead, lang, subject, body }, nowMs = Date.now()) {
      const to = cfg.mail.notifyTo;
      if (!to) return false;
      const out = renderOutgoing(app, { lead, lang, subject, body, preview: true }, nowMs);
      return (await app.mail.send({ to, subject: `[Anteprima] ${out.subject}`, text: out.text, html: out.html, replyTo: to })) !== false;
    },

    /** Lavoro periodico: manda l'email che tocca, se siamo dentro la finestra, sotto il tetto del giorno e dopo la pausa dall'ultima. @returns {Promise<number>} quante ne ha spedite */
    async sweep(nowMs = Date.now()) {
      const s = sendSettings(db);
      if (s.paused) return 0;
      const rome = nowRome(nowMs);
      if (!inWindow(s, rome) || sentOn(db, rome.date) >= s.dailyCap) return 0;
      const last = lastSentAt(db);
      if (last && nowMs - Date.parse(last) < s.minGapMin * 60_000) return 0;
      for (let i = 0; i < 50; i++) {
        const next = db.prepare("SELECT id FROM lead_emails WHERE status = 'queued' AND send_after <= ? ORDER BY send_after, id LIMIT 1").get(iso(nowMs));
        if (!next) return 0;
        const r = await svc.deliver(next.id, { nowMs });
        if (r.skipped) continue; // saltata: si passa alla prossima senza aspettare un altro giro
        return r.sent ? 1 : 0;
      }
      return 0;
    },

    /**
     * Invita l'agenzia sul sito: un collegamento personale (l'account nasce già approvato) mandato all'indirizzo del referente.
     * @returns {Promise<{ invite: object, url: string, sent: boolean } | { error: 'email'|'exists'|'blocked' }>}
     */
    async invite(leadId, { contactId = null, lang = null, note = '' } = {}, nowMs = Date.now()) {
      const lead = getLead(db, leadId);
      if (!lead) throw new LeadError('notfound');
      const contacts = listContacts(db, leadId);
      const contact = (contactId ? getContact(db, leadId, contactId) : null) ?? contacts.find((c) => c.email) ?? null; // senza una scelta: il referente principale con un indirizzo
      const email = contact?.email || lead.email;
      if (!email) return { error: 'email' };
      if (!lead.email_ok || isSuppressed(db, email)) return { error: 'blocked' };
      let made;
      try {
        made = createInvite(db, { email, company: lead.company, contactName: contact?.name, lang: normLang(lang ?? contact?.lang ?? lead.lang), note }, nowMs);
      } catch (err) {
        if (err instanceof InviteError && err.code === 'exists') {
          syncAccounts(db, nowMs); // ha già un profilo: lo si aggancia
          return { error: 'exists' };
        }
        throw err;
      }
      db.prepare('UPDATE partner_invites SET lead_id = ? WHERE id = ?').run(leadId, made.invite.id);
      const url = inviteUrl(cfg, made.invite, made.token);
      const sent = (await sendPartnerInvite(app, made.invite, url)) !== false;
      if (sent) markSent(db, made.invite.id, nowMs);
      tx(db, () => {
        logActivity(db, leadId, { kind: 'invite', contactId: contact?.id ?? null, title: `Invito al sito ${sent ? 'mandato a' : 'creato per'} ${email}`, body: sent ? '' : 'L’email non è partita: il collegamento è stato mostrato per mandarlo a mano.', nowMs });
        if (['new', 'contacted', 'talking', 'lost'].includes(lead.status)) setStatus(db, leadId, 'invited', { nowMs });
      });
      return { invite: made.invite, url, sent };
    },

    /**
     * Crea subito il profilo B2B (approvato) con i dati del contatto, senza che l'agenzia compili il modulo. La password non la conosce nessuno:
     * l'agenzia la sceglie da un collegamento (vale 7 giorni, una volta sola), che si può anche mandare per email.
     * Mancano i dati di fatturazione: l'agenzia li completa dalla sua area (compaiono in «Da fare» finché mancano).
     * @returns {Promise<{ account: object, url: string, sent: boolean } | { error: 'email'|'exists'|'blocked' }>}
     */
    async createProfile(leadId, { contactId = null, sendMail = true } = {}, nowMs = Date.now()) {
      const lead = getLead(db, leadId);
      if (!lead) throw new LeadError('notfound');
      if (lead.account_id) return { error: 'exists' };
      const contacts = listContacts(db, leadId);
      const contact = (contactId ? getContact(db, leadId, contactId) : null) ?? contacts.find((c) => c.email) ?? contacts[0] ?? null;
      const email = (contact?.email || lead.email || '').toLowerCase();
      if (!email) return { error: 'email' };
      if (emailInUse(db, email)) {
        syncAccounts(db, nowMs);
        return { error: 'exists' };
      }
      const hash = await hashPassword(crypto.randomBytes(24).toString('base64url')); // una password che non conosce nessuno
      const now = iso(nowMs);
      const lang = normLang(contact?.lang || lead.lang);
      let account;
      try {
        account = tx(db, () => {
          if (emailInUse(db, email)) throw new LeadError('exists'); // (nel frattempo l'agenzia si è registrata da sola)
          const info = db
            .prepare("INSERT INTO accounts(email, password_hash, company, country, contact_name, phone, website, message, lang, status, discount_percent, allow_invoice, created_at, approved_at) VALUES(?,?,?,?,?,?,?,?,?,'approved',0,1,?,?)")
            .run(email, hash, lead.company, lead.country || null, contact?.name || lead.company, contact?.phone || lead.phone || null, lead.website || null, 'Profilo creato dalla guida dal contatto commerciale.', lang, now, now);
          const id = Number(info.lastInsertRowid);
          db.prepare('UPDATE leads SET account_id = ?, updated_at = ? WHERE id = ?').run(id, now, leadId);
          logActivity(db, leadId, { kind: 'profile', contactId: contact?.id ?? null, title: 'Profilo B2B creato dalla guida', body: 'Account approvato: l’agenzia sceglie la password dal collegamento.', nowMs });
          setStatus(db, leadId, 'client', { nowMs });
          return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        });
      } catch (err) {
        if (err instanceof LeadError && err.code === 'exists') return { error: 'exists' };
        throw err;
      }
      const url = svc.passwordLink(account, nowMs);
      const sent = sendMail ? (await sendPartnerWelcome(app, account, url, PROFILE_LINK_DAYS)) !== false : false;
      return { account, url, sent };
    },

    /** Il collegamento con cui un'agenzia scrive la sua password (lo stesso di «password dimenticata», ma valido più a lungo). */
    passwordLink(account, nowMs = Date.now()) {
      const token = signToken(cfg.sessionSecret, { k: 'pwreset', id: account.id, f: passwordFingerprint(account), exp: nowMs + PROFILE_LINK_DAYS * DAY });
      return `${cfg.baseUrl}/${normLang(account.lang)}/b2b/reset/${token}`;
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));
  app.jobs.push((nowMs) => syncAccounts(db, nowMs)); // le agenzie che si registrano diventano «clienti» da sole
  return svc;
}
