// Commerciale: agenzie e tour operator da conquistare («contatti»), i loro referenti, il registro di ciò che è successo, gli appuntamenti
// e le regole per non scrivere due volte alla stessa agenzia. Funzioni sul database, senza rete né email (le email stanno in leadMail.js
// e leadServices.js).
import { splitCsv } from './bankMatch.js';
import { LIVE_BOOKING_SQL } from './availability.js';
import { countries, isCountry, normalizePhone } from './countries.js';
import { tx } from './db.js';
import { LANGS, normLang } from './langs.js';
import { addDays, fmtDate, isDate, isTime, localToInstant, nowRome, toMin } from './time.js';
import { cleanText, isEmail } from './util.js';

// ───────────── vocabolario ─────────────
export const STATUS_LABEL = { new: 'Da contattare', contacted: 'Contattata', talking: 'In dialogo', invited: 'Invitata sul sito', client: 'Cliente', lost: 'Non interessata' };
export const STATUSES = Object.keys(STATUS_LABEL);
export const KIND_LABEL = { agency: 'Agenzia di viaggi', operator: 'Tour operator', dmc: 'DMC / agenzia incoming', events: 'Eventi e congressi', other: 'Altro' };
export const PRIORITY_LABEL = { 1: 'Alta', 2: 'Media', 3: 'Bassa' };
export const APPT_LABEL = { visit: 'Visita in azienda', video: 'Videochiamata', call: 'Telefonata', other: 'Altro incontro' };
/** Le ore di un appuntamento tolgono la disponibilità del sito? Predefinito per tipo (si cambia caso per caso): una telefonata breve no. */
export const APPT_BLOCKS = { visit: true, video: true, call: false, other: true };
export const ACTIVITY_LABEL = {
  call: 'Telefonata', no_answer: 'Non ha risposto', email_out: 'Email inviata', message: 'Messaggio inviato', reply: 'Ha risposto', meeting: 'Incontro o visita', video: 'Videochiamata', note: 'Nota',
  status: 'Cambio di stato', invite: 'Invito al sito', profile: 'Profilo B2B', appointment: 'Appuntamento', optout: 'Non vuole più email', import: 'Importato',
};
/** Quelle che la guida registra a mano (le altre le scrive il sito). */
export const MANUAL_ACTIVITIES = ['call', 'no_answer', 'message', 'reply', 'meeting', 'video', 'note'];
const CONTACT_KINDS = new Set(['call', 'no_answer', 'email_out', 'message', 'reply', 'meeting', 'video']); // «ci siamo sentiti»: aggiornano l'ultimo contatto
const OUTBOUND = new Set(['no_answer', 'email_out', 'message']); // ho scritto o chiamato io: da «Da contattare» a «Contattata»
const CONVERSATION = new Set(['call', 'reply', 'meeting', 'video']); // c'è stato uno scambio: «In dialogo»
/** Gli stati in cui un'agenzia è ancora «fredda»: i solleciti automatici partono solo qui. */
export const COLD_STATUSES = ['new', 'contacted'];

export class LeadError extends Error {
  /** @param {'company'|'email'|'website'|'phone'|'country'|'date'|'time'|'notfound'|'name'|'contact'} code */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// ───────────── pulizia dei dati ─────────────
const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Un indirizzo web ripulito (https:// davanti se manca); vuoto se non è un indirizzo web (niente `javascript:` e simili). */
export function normalizeWebsite(raw) {
  let s = cleanText(raw, 300).replace(/\s+/g, '');
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || u.username || u.password) return '';
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'hotmail.es', 'hotmail.fr', 'hotmail.de', 'outlook.com', 'outlook.it', 'outlook.es', 'live.com', 'live.it', 'msn.com',
  'yahoo.com', 'yahoo.it', 'yahoo.es', 'yahoo.fr', 'yahoo.de', 'yahoo.co.jp', 'ymail.com', 'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tin.it', 'fastwebnet.it', 'pec.it', 'legalmail.it',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 't-online.de', 'proton.me', 'protonmail.com', 'posteo.net', 'posteo.de', 'mail.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'telefonica.net', 'movistar.es', 'docomo.ne.jp', 'ezweb.ne.jp', 'softbank.ne.jp', 'qq.com', '163.com', 'mail.ru', 'yandex.ru',
]);

/** Il nome di dominio di un sito o di un indirizzo email («www.lagoon.it» → «lagoon.it»), anche se è di un servizio di posta gratuito. */
function hostOf(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return '';
  let host = '';
  if (s.includes('@')) host = s.split('@').pop();
  else {
    try {
      host = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname;
    } catch {
      host = '';
    }
  }
  host = host.replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');
  return host.includes('.') ? host : '';
}

/** Il dominio che identifica un'azienda; vuoto per i servizi di posta gratuiti, che non dicono a quale azienda appartiene l'indirizzo. */
export function domainOf(value) {
  const host = hostOf(value);
  return FREE_MAIL.has(host) ? '' : host;
}

const LEGAL_FORMS = new Set(['srl', 'srls', 'spa', 'snc', 'sas', 'sa', 'sl', 'ltd', 'llc', 'inc', 'gmbh', 'ag', 'bv', 'kk', 'co', 'corp', 'the']);
/** Il nome di un'azienda ridotto a ciò che la distingue («Lagoon Travel S.r.l.» e «LAGOON TRAVEL» sono la stessa): per trovare i doppioni. */
export function companyKey(name) {
  return fold(name)
    .replace(/\./g, '')
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ')
    .split(' ')
    .filter((w) => w && !LEGAL_FORMS.has(w))
    .join(' ');
}

const ES_COUNTRIES = new Set(['ES', 'MX', 'AR', 'CL', 'CO', 'PE', 'UY', 'VE', 'EC', 'BO', 'PY', 'CR', 'PA', 'GT', 'HN', 'SV', 'NI', 'DO', 'CU']);
/** La lingua in cui scrivere a un'agenzia di quel paese (italiano, spagnolo, giapponese; per gli altri paesi l'inglese). */
export function langForCountry(country) {
  const c = String(country ?? '').toUpperCase();
  if (['IT', 'SM', 'VA'].includes(c)) return 'it';
  if (ES_COUNTRIES.has(c)) return 'es';
  if (c === 'JP') return 'ja';
  return 'en';
}

/** La lingua in cui scrivere a un'agenzia: quella del paese e, se il paese non c'è, quella del dominio del sito o dell'email («.it», «.es», «.jp»…); altrimenti l'inglese. */
export function deduceLang({ country = '', website = '', email = '' } = {}) {
  if (country) return langForCountry(country);
  const tld = (hostOf(website) || hostOf(email)).split('.').pop().toUpperCase();
  return tld.length === 2 ? langForCountry(tld) : 'en';
}

const COUNTRY_ALIASES = {
  usa: 'US', 'u s a': 'US', 'stati uniti d america': 'US', 'united states of america': 'US', uk: 'GB', 'u k': 'GB', 'gran bretagna': 'GB', inghilterra: 'GB', england: 'GB', 'great britain': 'GB',
  uae: 'AE', 'emirati arabi uniti': 'AE', korea: 'KR', corea: 'KR', 'south korea': 'KR', 'czech republic': 'CZ', 'repubblica ceca': 'CZ', olanda: 'NL', holland: 'NL', 'paesi bassi': 'NL',
};
let countryByName;
/** «Giappone», «Japan», «jp», «日本» → «JP»; vuoto se non si riconosce. */
export function countryFromText(text) {
  const t = fold(text).replace(/\./g, '').replace(/\s+/g, ' ');
  if (!t) return '';
  if (/^[a-z]{2}$/.test(t) && isCountry(t)) return t.toUpperCase();
  if (!countryByName) {
    countryByName = new Map();
    for (const l of LANGS) for (const c of countries(l)) countryByName.set(fold(c.name).replace(/\./g, ''), c.code);
    for (const [name, code] of Object.entries(COUNTRY_ALIASES)) countryByName.set(name, code);
  }
  return countryByName.get(t) ?? '';
}

/** Un telefono scritto come capita: con il prefisso internazionale diventa «+39 …»; altrimenti resta com'è (ripulito), purché sembri un numero. */
export function cleanPhone(raw, country = '') {
  const s = cleanText(raw, 40).replace(/\s+/g, ' ');
  if (!s) return '';
  const n = normalizePhone(s, country);
  if (n.ok) return n.value;
  return s.replace(/\D/g, '').length >= 5 && /^[+\d][\d\s().+/-]*$/.test(s) ? s : '';
}

/** Le cifre di un telefono, per i collegamenti WhatsApp (wa.me vuole il prefisso internazionale, senza + né spazi). */
export const waDigits = (phone) => (/^\+/.test(String(phone ?? '').trim()) ? String(phone).replace(/\D/g, '') : '');

const SYNONYMS = {
  kind: { agency: ['agenzia', 'agenzia di viaggi', 'agenzia viaggi', 'travel agency', 'agency', 'adv', 'agencia'], operator: ['tour operator', 'operator', 'to', 'tour operators'], dmc: ['dmc', 'incoming', 'agenzia incoming', 'destination management', 'dmc incoming'], events: ['eventi', 'congressi', 'eventi e congressi', 'mice', 'events', 'meeting'] },
  status: { new: ['nuovo', 'nuova', 'da contattare', 'new', 'lead'], contacted: ['contattata', 'contattato', 'contacted'], talking: ['in dialogo', 'interessata', 'interessato', 'talking', 'in trattativa'], invited: ['invitata', 'invitato', 'invited'], client: ['cliente', 'client', 'attiva'], lost: ['persa', 'perso', 'non interessata', 'non interessato', 'lost', 'no'] },
  priority: { 1: ['1', 'alta', 'high', 'a'], 2: ['2', 'media', 'medium', 'm', 'normale'], 3: ['3', 'bassa', 'low', 'b'] },
};
function pickKey(raw, map, fallback) {
  const t = fold(raw);
  if (!t) return fallback;
  for (const [key, words] of Object.entries(map)) if (key === t || words.includes(t)) return Number.isNaN(Number(key)) ? key : Number(key);
  return null;
}

/**
 * I dati di un contatto commerciale scritti in un modulo o in una riga di CSV, ripuliti.
 * Rigoroso (modulo): un campo sbagliato è un errore (`LeadError`). Tollerante (importazione): il campo sbagliato si scarta e si segnala in `warnings`.
 * @returns {{ value: object, warnings: string[] }}
 */
export function cleanLead(input, { lenient = false } = {}) {
  const warnings = [];
  const drop = (code) => {
    if (!lenient) throw new LeadError(code);
    warnings.push(code);
    return '';
  };
  const company = cleanText(input.company, 160).replace(/\s+/g, ' ');
  if (!company) throw new LeadError('company');
  const email = cleanEmail(input.email);
  const websiteRaw = cleanText(input.website, 300);
  const website = websiteRaw ? normalizeWebsite(websiteRaw) || drop('website') : '';
  const countryRaw = cleanText(input.country, 80);
  const country = countryRaw ? countryFromText(countryRaw) || drop('country') : '';
  const phoneRaw = cleanText(input.phone, 40);
  const phone = phoneRaw ? cleanPhone(phoneRaw, country) || drop('phone') : '';
  const on = cleanText(input.nextActionOn, 10);
  return {
    warnings,
    value: {
      company,
      kind: pickKey(input.kind, SYNONYMS.kind, 'agency') ?? (KIND_LABEL[input.kind] ? input.kind : 'other'),
      status: pickKey(input.status, SYNONYMS.status, 'new') ?? 'new',
      priority: pickKey(input.priority, SYNONYMS.priority, 2) ?? 2,
      source: cleanText(input.source, 120).replace(/\s+/g, ' '),
      website,
      email: email ? (isEmail(email) ? email : drop('email')) : '',
      phone,
      country,
      city: cleanText(input.city, 80).replace(/\s+/g, ' '),
      lang: LANGS.includes(String(input.lang ?? '').toLowerCase()) ? String(input.lang).toLowerCase() : deduceLang({ country, website, email: email || cleanText(input.hintEmail, 254).toLowerCase() }),
      notes: cleanText(input.notes, 2000),
      nextAction: cleanText(input.nextAction, 160),
      nextActionOn: on ? (isDate(on) ? on : drop('date')) : '',
    },
  };
}

/**
 * Un indirizzo email com'è scritto da chi lo copia da un sito, da un PDF o da una firma: toglie i caratteri invisibili (spazio senza interruzione,
 * larghezza zero, segni di direzione), «mailto:», le parentesi angolari e la punteggiatura in fondo, e lo scrive in minuscolo.
 */
export function cleanEmail(s, max = 254) {
  const t = cleanText(
    String(s ?? '')
      .replace(/[​-‏‪-‮⁠﻿­]/g, '')
      .replace(/[  -  　]/g, ' '),
    max,
  );
  return t.replace(/^mailto:/i, '').replace(/^<(.*)>$/, '$1').replace(/[.,;:]+$/, '').trim().toLowerCase();
}

/** Un referente scritto in un modulo o in una riga di CSV. Serve almeno un nome o un'email. @returns {{ value: object, warnings: string[] }} */
export function cleanContact(input, { lenient = false, country = '' } = {}) {
  const warnings = [];
  const drop = (code) => {
    if (!lenient) throw new LeadError(code);
    warnings.push(`contact-${code}`);
    return '';
  };
  const emailRaw = cleanEmail(input.email);
  const email = emailRaw ? (isEmail(emailRaw) ? emailRaw : drop('email')) : '';
  const name = cleanText(input.name, 120).replace(/\s+/g, ' ') || email;
  if (!name) throw new LeadError('name');
  const phoneRaw = cleanText(input.phone, 40);
  const lang = String(input.lang ?? '').toLowerCase();
  return {
    warnings,
    value: { name, role: cleanText(input.role, 80), email, phone: phoneRaw ? cleanPhone(phoneRaw, country) || drop('phone') : '', lang: LANGS.includes(lang) ? lang : '', notes: cleanText(input.notes, 600) },
  };
}

/** Il nome di battesimo di un referente per il saluto («Anna Rossi» → «Anna»); niente se «il nome» è un indirizzo email. */
export const firstName = (name) => (String(name ?? '').includes('@') ? '' : String(name ?? '').trim().split(/\s+/)[0] ?? '');

// ───────────── contatti ─────────────
export const getLead = (db, id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id)) ?? null;
export const listContacts = (db, leadId) => db.prepare('SELECT * FROM lead_contacts WHERE lead_id = ? ORDER BY is_main DESC, id').all(leadId);
export const getContact = (db, leadId, id) => db.prepare('SELECT * FROM lead_contacts WHERE id = ? AND lead_id = ?').get(Number(id), leadId) ?? null;
export const mainContact = (db, leadId) => db.prepare('SELECT * FROM lead_contacts WHERE lead_id = ? ORDER BY is_main DESC, id LIMIT 1').get(leadId) ?? null;
const iso = (nowMs) => new Date(nowMs).toISOString();

/** Quanti indirizzi tra cui scegliere per scrivere a questo contatto: i referenti con un'email, poi l'indirizzo generale dell'agenzia. */
export function recipients(db, lead) {
  const out = listContacts(db, lead.id)
    .filter((c) => c.email)
    .map((c) => ({ contactId: c.id, name: c.name, role: c.role, email: c.email, lang: c.lang || lead.lang }));
  if (lead.email && !out.some((r) => r.email === lead.email)) out.push({ contactId: null, name: '', role: '', email: lead.email, lang: lead.lang });
  return out;
}

/**
 * Registra un contatto nuovo (e, se c'è, il suo primo referente).
 * @returns {object} il contatto
 */
export function insertLead(db, value, { contact = null, nowMs = Date.now(), activity = null } = {}) {
  return tx(db, () => {
    const now = iso(nowMs);
    const blocked = [value.email, contact?.email].filter(Boolean).map((e) => isSuppressed(db, e)).find(Boolean) ?? null;
    const row = db
      .prepare(
        `INSERT INTO leads(company, kind, status, priority, source, website, email, phone, country, city, lang, notes, next_action, next_action_on, email_ok, optout_at, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(value.company, value.kind, value.status, value.priority, value.source || null, value.website || null, value.email || null, value.phone || null, value.country || null, value.city || null, value.lang, value.notes || null, value.nextAction || null, value.nextActionOn || null, blocked ? 0 : 1, blocked?.at ?? null, now, now);
    const id = Number(row.lastInsertRowid);
    if (contact) addContact(db, id, contact, nowMs);
    if (activity) logActivity(db, id, { kind: 'import', title: activity, nowMs });
    return getLead(db, id);
  });
}

/** Cambia i dati anagrafici di un contatto (stato e prossima azione hanno le loro funzioni). */
export function updateLead(db, id, value, nowMs = Date.now()) {
  db.prepare('UPDATE leads SET company = ?, kind = ?, priority = ?, source = ?, website = ?, email = ?, phone = ?, country = ?, city = ?, lang = ?, notes = ?, updated_at = ? WHERE id = ?').run(
    value.company, value.kind, value.priority, value.source || null, value.website || null, value.email || null, value.phone || null, value.country || null, value.city || null, value.lang, value.notes || null, iso(nowMs), id,
  );
  return getLead(db, id);
}

export const deleteLead = (db, id) => db.prepare('DELETE FROM leads WHERE id = ?').run(Number(id)).changes === 1;

/** Aggiunge un referente; il primo di un'agenzia (o quello richiesto con `main`) diventa il principale. */
export function addContact(db, leadId, value, nowMs = Date.now()) {
  return tx(db, () => {
    const main = value.main || !db.prepare('SELECT 1 FROM lead_contacts WHERE lead_id = ?').get(leadId);
    if (main) db.prepare('UPDATE lead_contacts SET is_main = 0 WHERE lead_id = ?').run(leadId);
    const row = db.prepare('INSERT INTO lead_contacts(lead_id, name, role, email, phone, lang, notes, is_main, created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(leadId, value.name, value.role || null, value.email || null, value.phone || null, value.lang || null, value.notes || null, main ? 1 : 0, iso(nowMs));
    db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(iso(nowMs), leadId);
    return db.prepare('SELECT * FROM lead_contacts WHERE id = ?').get(Number(row.lastInsertRowid));
  });
}

export function updateContact(db, leadId, id, value, nowMs = Date.now()) {
  const changed = db.prepare('UPDATE lead_contacts SET name = ?, role = ?, email = ?, phone = ?, lang = ?, notes = ? WHERE id = ? AND lead_id = ?').run(value.name, value.role || null, value.email || null, value.phone || null, value.lang || null, value.notes || null, id, leadId).changes === 1;
  if (changed) db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(iso(nowMs), leadId);
  return changed;
}

export function setMainContact(db, leadId, id) {
  return tx(db, () => {
    if (!getContact(db, leadId, id)) return false;
    db.prepare('UPDATE lead_contacts SET is_main = (id = ?) WHERE lead_id = ?').run(id, leadId);
    return true;
  });
}

/** Toglie un referente; se era il principale, lo diventa il primo rimasto. */
export function removeContact(db, leadId, id) {
  return tx(db, () => {
    const c = getContact(db, leadId, id);
    if (!c) return false;
    db.prepare('DELETE FROM lead_contacts WHERE id = ?').run(id);
    if (c.is_main) db.prepare('UPDATE lead_contacts SET is_main = 1 WHERE id = (SELECT id FROM lead_contacts WHERE lead_id = ? ORDER BY id LIMIT 1)').run(leadId);
    return true;
  });
}

// ───────────── registro, stato e prossima azione ─────────────
/**
 * Scrive una riga nel registro. Se è un contatto vero («ci siamo sentiti») aggiorna l'ultimo contatto, porta l'agenzia allo stato giusto
 * (mai indietro) e chiude il richiamo: quello già scaduto, e qualunque richiamo se c'è stato uno scambio (risposta, telefonata, incontro, videochiamata),
 * a meno che non se ne indichi uno nuovo con `nextOn`.
 * @returns {object} la riga del registro
 */
export function logActivity(db, leadId, { kind, contactId = null, title = '', body = '', at = null, nextOn = '', nextAction = '', nowMs = Date.now() } = {}) {
  if (!ACTIVITY_LABEL[kind]) throw new LeadError('kind');
  return tx(db, () => {
    const lead = getLead(db, leadId);
    if (!lead) throw new LeadError('notfound');
    const today = nowRome(nowMs).date;
    const when = at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : iso(nowMs);
    const contact = contactId && getContact(db, leadId, contactId) ? contactId : null;
    const row = db.prepare('INSERT INTO lead_activities(lead_id, contact_id, kind, title, body, at, created_at) VALUES(?,?,?,?,?,?,?)').run(leadId, contact, kind, cleanText(title, 200) || null, cleanText(body, 4000) || null, when, iso(nowMs));
    const sets = ['updated_at = ?'];
    const args = [iso(nowMs)];
    if (CONTACT_KINDS.has(kind)) {
      const day = nowRome(Date.parse(when)).date;
      if (!lead.last_contact_on || day > lead.last_contact_on) {
        sets.push('last_contact_on = ?');
        args.push(day);
      }
      let status = lead.status;
      if (OUTBOUND.has(kind) && status === 'new') status = 'contacted';
      if (CONVERSATION.has(kind) && ['new', 'contacted', 'lost'].includes(status)) status = 'talking';
      if (status !== lead.status) {
        sets.push('status = ?');
        args.push(status);
      }
      const on = cleanText(nextOn, 10);
      if (on && isDate(on)) {
        sets.push('next_action_on = ?', 'next_action = ?');
        args.push(on, cleanText(nextAction, 160) || null);
      } else if (lead.next_action_on && (CONVERSATION.has(kind) || lead.next_action_on <= today)) {
        sets.push('next_action_on = NULL', 'next_action = NULL'); // il richiamo scaduto è stato fatto; e se c'è stato uno scambio («mi hanno risposto», una telefonata, un incontro) il vecchio richiamo non serve più
      }
    } else if (nextOn && isDate(cleanText(nextOn, 10))) {
      sets.push('next_action_on = ?', 'next_action = ?');
      args.push(cleanText(nextOn, 10), cleanText(nextAction, 160) || null);
    }
    db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...args, leadId);
    return db.prepare('SELECT * FROM lead_activities WHERE id = ?').get(Number(row.lastInsertRowid));
  });
}

export const timeline = (db, leadId, limit = 100) =>
  db.prepare('SELECT a.*, c.name AS contact_name FROM lead_activities a LEFT JOIN lead_contacts c ON c.id = a.contact_id WHERE a.lead_id = ? ORDER BY a.at DESC, a.id DESC LIMIT ?').all(leadId, limit);

/** Cambia lo stato (e lo scrive nel registro). Passando a «non interessata» o «cliente» il richiamo si toglie e le email di presentazione in coda si annullano. @returns {boolean} false se non è cambiato nulla */
export function setStatus(db, leadId, status, { nowMs = Date.now(), why = '' } = {}) {
  if (!STATUSES.includes(status)) throw new LeadError('status');
  return tx(db, () => {
    const lead = getLead(db, leadId);
    if (!lead || lead.status === status) return false;
    db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(status, iso(nowMs), leadId);
    if (status === 'lost' || status === 'client') {
      db.prepare('UPDATE leads SET next_action_on = NULL, next_action = NULL WHERE id = ?').run(leadId);
      cancelQueued(db, leadId, status === 'lost' ? 'Segnata come non interessata' : 'È già cliente', { cold: true });
    }
    logActivity(db, leadId, { kind: 'status', title: `${STATUS_LABEL[lead.status]} → ${STATUS_LABEL[status]}`, body: why, nowMs });
    return true;
  });
}

/** Imposta (o toglie, con data vuota) la prossima azione. */
export function setNextAction(db, leadId, { on = '', text = '' } = {}, nowMs = Date.now()) {
  const d = cleanText(on, 10);
  if (d && !isDate(d)) throw new LeadError('date');
  return db.prepare('UPDATE leads SET next_action_on = ?, next_action = ?, updated_at = ? WHERE id = ?').run(d || null, d ? cleanText(text, 160) || null : null, iso(nowMs), leadId).changes === 1;
}

/** Rimanda il richiamo di N giorni da oggi (o dal giorno in cui era fissato, se è nel futuro). */
export function snooze(db, leadId, days, nowMs = Date.now()) {
  const lead = getLead(db, leadId);
  if (!lead || !(days > 0)) return false;
  const today = nowRome(nowMs).date;
  return setNextAction(db, leadId, { on: addDays(today, Math.min(365, Math.floor(days))), text: lead.next_action ?? '' }, nowMs);
}

/** Annulla le email ancora in coda per un contatto (tutte, o solo quelle «a freddo»: presentazione e solleciti). @returns {number} quante */
export function cancelQueued(db, leadId, note, { cold = false } = {}) {
  return db.prepare(`UPDATE lead_emails SET status = 'cancelled', note = ? WHERE lead_id = ? AND status = 'queued' ${cold ? "AND template IN ('presentation', 'followup')" : ''}`).run(note, leadId).changes;
}

// ───────────── chi non vuole più email ─────────────
export function isSuppressed(db, email) {
  const e = String(email ?? '').trim().toLowerCase();
  return e ? db.prepare('SELECT * FROM email_optouts WHERE email = ?').get(e) ?? null : null;
}

/** L'agenzia (o chi per lei) chiede di non ricevere più email: da adesso nessuna email parte, né subito né dalla coda, nemmeno se il contatto viene cancellato e importato di nuovo. */
export function optOut(db, leadId, { source = 'link', nowMs = Date.now() } = {}) {
  return tx(db, () => {
    const lead = getLead(db, leadId);
    if (!lead) return false;
    const now = iso(nowMs);
    for (const e of new Set([lead.email, ...listContacts(db, leadId).map((c) => c.email)].filter(Boolean))) db.prepare('INSERT OR IGNORE INTO email_optouts(email, at, source) VALUES(?,?,?)').run(e.toLowerCase(), now, source);
    const first = lead.email_ok === 1;
    db.prepare('UPDATE leads SET email_ok = 0, optout_at = COALESCE(optout_at, ?), updated_at = ? WHERE id = ?').run(now, now, leadId);
    const cancelled = cancelQueued(db, leadId, 'Non vuole più ricevere email');
    if (first) logActivity(db, leadId, { kind: 'optout', title: source === 'link' ? 'Ha chiesto di non ricevere più email (dal link)' : 'Segnata come «non scrivere»', body: cancelled ? `${cancelled} email in coda annullate.` : '', nowMs });
    return true;
  });
}

/** La guida riabilita le email per un contatto (per esempio perché è stata l'agenzia a rifarsi viva). */
export function allowEmail(db, leadId, nowMs = Date.now()) {
  return tx(db, () => {
    const lead = getLead(db, leadId);
    if (!lead) return false;
    for (const e of [lead.email, ...listContacts(db, leadId).map((c) => c.email)].filter(Boolean)) db.prepare('DELETE FROM email_optouts WHERE email = ?').run(e.toLowerCase());
    db.prepare('UPDATE leads SET email_ok = 1, optout_at = NULL, updated_at = ? WHERE id = ?').run(iso(nowMs), leadId);
    logActivity(db, leadId, { kind: 'note', title: 'Email di nuovo consentite', body: 'La guida ha tolto il blocco «non scrivere».', nowMs });
    return true;
  });
}

// ───────────── doppioni ─────────────
/**
 * Un indice per trovare in fretta se un'agenzia è già nell'elenco: per indirizzo email (dell'agenzia o di un referente), per sito/dominio e per nome.
 * Si costruisce una volta e si interroga molte volte (l'importazione controlla centinaia di righe).
 */
export function duplicateIndex(db) {
  const byEmail = new Map();
  const byDomain = new Map();
  const byName = new Map();
  const add = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  const names = new Map();
  const remember = (l, contactEmail = '') => {
    names.set(l.id, l.company);
    add(byEmail, l.email, l.id);
    add(byEmail, contactEmail ? String(contactEmail).toLowerCase() : '', l.id);
    add(byDomain, domainOf(l.website), l.id);
    add(byDomain, domainOf(l.email), l.id);
    add(byDomain, domainOf(contactEmail), l.id);
    add(byName, companyKey(l.company), l.id);
  };
  for (const l of db.prepare('SELECT id, company, email, website FROM leads').all()) remember(l);
  for (const c of db.prepare('SELECT lead_id, email FROM lead_contacts WHERE email IS NOT NULL').all()) {
    add(byEmail, c.email.toLowerCase(), c.lead_id);
    add(byDomain, domainOf(c.email), c.lead_id);
  }
  return {
    /** Un contatto appena inserito entra nell'indice (così un doppione dentro lo stesso elenco si riconosce). */
    remember,
    /** @returns {{ id: number, company: string, why: string }[]} */
    find({ company = '', email = '', contactEmail = '', website = '' } = {}) {
      const found = new Map();
      const hit = (set, why) => {
        for (const id of set ?? []) if (!found.has(id)) found.set(id, why);
      };
      for (const e of [email, contactEmail].filter(Boolean)) hit(byEmail.get(e.toLowerCase()), 'stesso indirizzo email');
      for (const d of new Set([domainOf(website), domainOf(email), domainOf(contactEmail)].filter(Boolean))) hit(byDomain.get(d), 'stesso sito o dominio');
      hit(byName.get(companyKey(company)), 'stesso nome');
      return [...found].map(([id, why]) => ({ id, company: names.get(id), why }));
    },
  };
}

// ───────────── elenchi e numeri ─────────────
const MAIN = 'LEFT JOIN lead_contacts mc ON mc.id = (SELECT id FROM lead_contacts WHERE lead_id = l.id ORDER BY is_main DESC, id LIMIT 1) LEFT JOIN accounts a ON a.id = l.account_id';
const COLS = 'l.*, mc.name AS contact_name, mc.role AS contact_role, mc.email AS contact_email, mc.phone AS contact_phone, a.status AS account_status';
const SORTS = {
  next: '(l.next_action_on IS NULL), l.next_action_on, l.priority, l.company COLLATE NOCASE',
  company: 'l.company COLLATE NOCASE',
  recent: 'l.updated_at DESC, l.id DESC',
  created: 'l.created_at DESC, l.id DESC',
  priority: 'l.priority, l.company COLLATE NOCASE',
  last: '(l.last_contact_on IS NULL), l.last_contact_on DESC, l.company COLLATE NOCASE',
};
export const SORT_LABEL = { next: 'Da richiamare', company: 'Nome', priority: 'Priorità', recent: 'Modificate di recente', created: 'Aggiunte di recente', last: 'Ultimo contatto' };
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Il filtro dell'elenco. `status` può essere uno stato oppure `open` (quelle in lavorazione: né perse né clienti).
 * @returns {{ rows: object[], total: number }}
 */
export function searchLeads(db, f = {}, { today = nowRome().date, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (STATUSES.includes(f.status)) {
    where.push('l.status = ?');
    args.push(f.status);
  } else if (f.status === 'open') where.push("l.status NOT IN ('lost', 'client')");
  if (KIND_LABEL[f.kind]) {
    where.push('l.kind = ?');
    args.push(f.kind);
  }
  if (f.country) {
    where.push('l.country = ?');
    args.push(String(f.country).toUpperCase());
  }
  if ([1, 2, 3].includes(Number(f.priority))) {
    where.push('l.priority = ?');
    args.push(Number(f.priority));
  }
  if (f.source) {
    where.push('l.source = ?');
    args.push(f.source);
  }
  if (f.due === 'overdue') {
    where.push("l.next_action_on < ? AND l.status != 'lost'");
    args.push(today);
  } else if (f.due === 'today') {
    where.push("l.next_action_on <= ? AND l.status != 'lost'");
    args.push(today);
  } else if (f.due === 'week') {
    where.push("l.next_action_on <= ? AND l.status != 'lost'");
    args.push(addDays(today, 7));
  } else if (f.due === 'none') where.push("l.next_action_on IS NULL AND l.status NOT IN ('lost', 'client')");
  if (f.email === 'none') where.push("l.email IS NULL AND NOT EXISTS (SELECT 1 FROM lead_contacts c WHERE c.lead_id = l.id AND c.email IS NOT NULL)");
  if (f.email === 'blocked') where.push('l.email_ok = 0');
  if (f.account === 'yes') where.push('l.account_id IS NOT NULL');
  const q = String(f.q ?? '').trim().slice(0, 80);
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push(`(l.company LIKE ? ESCAPE '\\' OR l.city LIKE ? ESCAPE '\\' OR l.email LIKE ? ESCAPE '\\' OR l.phone LIKE ? ESCAPE '\\' OR l.website LIKE ? ESCAPE '\\' OR l.notes LIKE ? ESCAPE '\\' OR l.source LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM lead_contacts c WHERE c.lead_id = l.id AND (c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')))`);
    args.push(...Array(10).fill(like));
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM leads l ${w}`).get(...args).n);
  const rows = db
    .prepare(`SELECT ${COLS}, (SELECT MIN(p.date) FROM lead_appointments p WHERE p.lead_id = l.id AND p.status = 'planned' AND p.date >= ?) AS next_appointment FROM leads l ${MAIN} ${w} ORDER BY ${SORTS[f.sort] ?? SORTS.next} LIMIT ? OFFSET ?`)
    .all(today, ...args, limit, offset);
  return { rows, total };
}

export const leadRow = (db, id, today = nowRome().date) =>
  db.prepare(`SELECT ${COLS}, (SELECT MIN(p.date) FROM lead_appointments p WHERE p.lead_id = l.id AND p.status = 'planned' AND p.date >= ?) AS next_appointment FROM leads l ${MAIN} WHERE l.id = ?`).get(today, Number(id)) ?? null;

/** I numeri della testata: quanti per stato e quanti richiami sono scaduti o per oggi. */
export function leadCounts(db, today = nowRome().date) {
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all()) by[r.status] = Number(r.n);
  const due = db.prepare("SELECT COALESCE(SUM(next_action_on < ?), 0) AS overdue, COALESCE(SUM(next_action_on = ?), 0) AS today FROM leads WHERE next_action_on IS NOT NULL AND status != 'lost'").get(today, today);
  return { total: Object.values(by).reduce((a, b) => a + b, 0), by, overdue: Number(due.overdue), today: Number(due.today), due: Number(due.overdue) + Number(due.today) };
}

/** I richiami da fare entro `days` giorni (compresi quelli scaduti), dal più urgente. */
export function dueLeads(db, today = nowRome().date, days = 7) {
  return db.prepare(`SELECT ${COLS} FROM leads l ${MAIN} WHERE l.next_action_on IS NOT NULL AND l.next_action_on <= ? AND l.status != 'lost' ORDER BY l.next_action_on, l.priority, l.company COLLATE NOCASE`).all(addDays(today, days));
}

/** Da dove vengono i contatti (per il filtro «fonte»). */
export const sourcesUsed = (db) => db.prepare("SELECT source, COUNT(*) AS n FROM leads WHERE source IS NOT NULL AND source != '' GROUP BY source ORDER BY n DESC, source COLLATE NOCASE LIMIT 60").all();
export const countriesUsed = (db) => db.prepare("SELECT country, COUNT(*) AS n FROM leads WHERE country IS NOT NULL AND country != '' GROUP BY country ORDER BY n DESC").all();

/** I prossimi da contattare per la prima volta: con un indirizzo a cui scrivere, in ordine di priorità. */
export function toContact(db, limit = 8) {
  return db
    .prepare(`SELECT ${COLS} FROM leads l ${MAIN} WHERE l.status = 'new' AND l.email_ok = 1 ORDER BY l.priority, l.created_at, l.id LIMIT ?`)
    .all(limit);
}

// ───────────── appuntamenti ─────────────
const APPT_COLS = 'p.*, l.company, l.status AS lead_status, c.name AS contact_name, c.phone AS contact_phone, l.phone AS lead_phone';
const APPT_JOIN = 'FROM lead_appointments p JOIN leads l ON l.id = p.lead_id LEFT JOIN lead_contacts c ON c.id = p.contact_id';
export const getAppointment = (db, id) => db.prepare(`SELECT ${APPT_COLS} ${APPT_JOIN} WHERE p.id = ?`).get(Number(id)) ?? null;
export const leadAppointments = (db, leadId) => db.prepare(`SELECT ${APPT_COLS} ${APPT_JOIN} WHERE p.lead_id = ? ORDER BY p.date DESC, p.start_time DESC`).all(leadId);
/** Per l'agenda: quelli fissati o già fatti tra due date (gli annullati non compaiono). */
export const appointmentsBetween = (db, from, to) => db.prepare(`SELECT ${APPT_COLS} ${APPT_JOIN} WHERE p.date BETWEEN ? AND ? AND p.status != 'cancelled' ORDER BY p.date, p.start_time`).all(from, to);
/** Fissati e non ancora chiusi: i prossimi, e quelli passati da chiudere (com'è andata?). */
export const plannedAppointments = (db, { from = null, to = null, before = null } = {}) =>
  db.prepare(`SELECT ${APPT_COLS} ${APPT_JOIN} WHERE p.status = 'planned' ${from ? 'AND p.date >= ?' : ''} ${to ? 'AND p.date <= ?' : ''} ${before ? 'AND p.date < ?' : ''} ORDER BY p.date, p.start_time`).all(...[from, to, before].filter(Boolean));

/** Quante prenotazioni vere si sovrappongono a una fascia: l'avviso quando si fissa un appuntamento sopra un servizio. */
export function overlapCount(db, date, start, end, nowMs = Date.now(), { ignoreAppointment = null } = {}) {
  const nowIso = iso(nowMs);
  const bookings = Number(db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND ${LIVE_BOOKING_SQL} AND start_time < ? AND end_time > ?`).get(date, nowIso, nowIso, end, start).n);
  const days = Number(db.prepare("SELECT COUNT(*) AS n FROM program_days d JOIN programs p ON p.id = d.program_id WHERE d.date = ? AND p.status IN ('accepted', 'confirmed') AND d.start_time < ? AND d.end_time > ?").get(date, end, start).n);
  const others = Number(db.prepare("SELECT COUNT(*) AS n FROM lead_appointments WHERE date = ? AND status = 'planned' AND blocks = 1 AND start_time < ? AND end_time > ? AND id != ?").get(date, end, start, ignoreAppointment ?? -1).n);
  return bookings + days + others;
}

function readAppointment(db, leadId, input) {
  const kind = APPT_LABEL[input.kind] ? input.kind : 'other';
  const date = String(input.date ?? '').trim();
  if (!isDate(date)) throw new LeadError('date');
  const allDay = !!input.allDay;
  const start = allDay ? '00:00' : String(input.start ?? '').trim();
  const end = allDay ? '23:59' : String(input.end ?? '').trim();
  if (!isTime(start) || !isTime(end) || toMin(start) >= toMin(end)) throw new LeadError('time');
  const contactId = input.contactId && getContact(db, leadId, input.contactId) ? Number(input.contactId) : null;
  return { kind, date, start, end, contactId, place: cleanText(input.place, 300) || null, notes: cleanText(input.notes, 1000) || null, blocks: input.blocks === undefined || input.blocks === null ? (APPT_BLOCKS[kind] ? 1 : 0) : input.blocks ? 1 : 0 };
}

const apptTitle = (a) => `${APPT_LABEL[a.kind]}, ${fmtDate(a.date, 'it', 'weekday')}${a.start_time === '00:00' && a.end_time === '23:59' ? ' (tutto il giorno)' : ` alle ${a.start_time}`}`;

/**
 * Il richiamo segue gli appuntamenti: «Visita, lunedì alle 15:00» è la prossima cosa da fare. Si mette sul primo appuntamento ancora da fare (da oggi in poi) se `force`,
 * se il richiamo era proprio quell'appuntamento (`was`: prima che fosse spostato, annullato o fatto) o se non c'è nessun richiamo; non tocca un richiamo scritto a mano.
 * Se `was` era il richiamo e non resta nessun appuntamento, il richiamo si toglie.
 */
function followAppointments(db, leadId, nowMs, { was = null, force = false } = {}) {
  const lead = getLead(db, leadId);
  if (!lead) return;
  const mine = !!was && lead.next_action_on === was.date && lead.next_action === apptTitle(was);
  if (!(force || mine || !lead.next_action_on)) return;
  const next = db.prepare("SELECT * FROM lead_appointments WHERE lead_id = ? AND status = 'planned' AND date >= ? ORDER BY date, start_time, id LIMIT 1").get(leadId, nowRome(nowMs).date);
  if (next) setNextAction(db, leadId, { on: next.date, text: apptTitle(next) }, nowMs);
  else if (mine) setNextAction(db, leadId, {}, nowMs);
}


/** Fissa un appuntamento (visita in azienda, videochiamata, telefonata…). @throws {LeadError} 'date' | 'time' | 'notfound' */
export function addAppointment(db, leadId, input, nowMs = Date.now()) {
  return tx(db, () => {
    if (!getLead(db, leadId)) throw new LeadError('notfound');
    const v = readAppointment(db, leadId, input);
    const row = db
      .prepare('INSERT INTO lead_appointments(lead_id, contact_id, kind, date, start_time, end_time, place, notes, blocks, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(leadId, v.contactId, v.kind, v.date, v.start, v.end, v.place, v.notes, v.blocks, iso(nowMs));
    const appt = getAppointment(db, Number(row.lastInsertRowid));
    logActivity(db, leadId, { kind: 'appointment', contactId: v.contactId, title: `Fissato: ${apptTitle(appt)}`, body: [appt.place, appt.notes].filter(Boolean).join('\n'), nowMs });
    followAppointments(db, leadId, nowMs, { force: true }); // ha un appuntamento: il vecchio richiamo non serve più
    return appt;
  });
}

/** Cambia un appuntamento ancora da fare. */
export function updateAppointment(db, id, input, nowMs = Date.now()) {
  return tx(db, () => {
    const cur = getAppointment(db, id);
    if (!cur || cur.status !== 'planned') return null;
    const v = readAppointment(db, cur.lead_id, input);
    db.prepare('UPDATE lead_appointments SET contact_id = ?, kind = ?, date = ?, start_time = ?, end_time = ?, place = ?, notes = ?, blocks = ? WHERE id = ?').run(v.contactId, v.kind, v.date, v.start, v.end, v.place, v.notes, v.blocks, id);
    const next = getAppointment(db, id);
    if (cur.date !== next.date || cur.start_time !== next.start_time) logActivity(db, cur.lead_id, { kind: 'appointment', contactId: v.contactId, title: `Spostato: ${apptTitle(next)}`, nowMs });
    followAppointments(db, cur.lead_id, nowMs, { was: cur });
    return next;
  });
}

/** L'appuntamento c'è stato: si scrive com'è andata (finisce nel registro come contatto vero) e, se serve, quando riscrivere. */
export function completeAppointment(db, id, { outcome = '', nextOn = '', nextAction = '' } = {}, nowMs = Date.now()) {
  return tx(db, () => {
    const a = getAppointment(db, id);
    if (!a || a.status !== 'planned') return false;
    db.prepare("UPDATE lead_appointments SET status = 'done', outcome = ? WHERE id = ?").run(cleanText(outcome, 2000) || null, id);
    const at = Math.min(nowMs, localToInstant(a.date, a.start_time));
    logActivity(db, a.lead_id, { kind: a.kind === 'video' ? 'video' : a.kind === 'call' ? 'call' : 'meeting', contactId: a.contact_id, title: `${APPT_LABEL[a.kind]} fatta`, body: outcome, at: new Date(at).toISOString(), nextOn, nextAction, nowMs });
    followAppointments(db, a.lead_id, nowMs, { was: a }); // senza un nuovo richiamo, resta il prossimo appuntamento (se c'è)
    return true;
  });
}

export function cancelAppointment(db, id, nowMs = Date.now()) {
  return tx(db, () => {
    const a = getAppointment(db, id);
    if (!a || a.status !== 'planned') return false;
    db.prepare("UPDATE lead_appointments SET status = 'cancelled' WHERE id = ?").run(id);
    logActivity(db, a.lead_id, { kind: 'appointment', contactId: a.contact_id, title: `Annullato: ${apptTitle(a)}`, nowMs });
    followAppointments(db, a.lead_id, nowMs, { was: a });
    return true;
  });
}

// ───────────── profilo B2B ─────────────
export const accountOf = (db, lead) => (lead.account_id ? db.prepare('SELECT * FROM accounts WHERE id = ?').get(lead.account_id) ?? null : null);

/** Quanto lavora già con te: prenotazioni confermate e l'ultima. */
export function accountStats(db, accountId) {
  const r = db.prepare("SELECT COUNT(*) AS n, MAX(date) AS last FROM bookings WHERE account_id = ? AND status = 'confirmed'").get(accountId);
  return { bookings: Number(r.n), lastDate: r.last ?? null };
}

/** Il contatto commerciale di un'agenzia registrata, se c'è (per la scheda del partner). */
export const leadOfAccount = (db, accountId) => db.prepare('SELECT * FROM leads WHERE account_id = ? ORDER BY id LIMIT 1').get(accountId) ?? null;

/**
 * Aggancia ai contatti le agenzie che si sono registrate: dall'invito mandato da qui, oppure perché l'email è la stessa (dell'agenzia o di un
 * referente; anche di un collaboratore). Chi ha un profilo approvato è «Cliente»; chi aspetta l'approvazione è almeno «In dialogo».
 * Si può ripetere quando si vuole: non fa nulla se è già tutto allineato.
 * @returns {number} quanti contatti sono cambiati
 */
export function syncAccounts(db, nowMs = Date.now()) {
  const pairs = [
    ...db.prepare('SELECT i.lead_id, i.account_id FROM partner_invites i JOIN leads l ON l.id = i.lead_id WHERE i.account_id IS NOT NULL AND l.account_id IS NULL').all(),
    ...db.prepare('SELECT l.id AS lead_id, a.id AS account_id FROM leads l JOIN accounts a ON a.email = l.email WHERE l.account_id IS NULL AND l.email IS NOT NULL').all(),
    ...db.prepare('SELECT c.lead_id, a.id AS account_id FROM lead_contacts c JOIN accounts a ON a.email = c.email JOIN leads l ON l.id = c.lead_id WHERE l.account_id IS NULL').all(),
    ...db.prepare('SELECT c.lead_id, u.account_id FROM lead_contacts c JOIN account_users u ON u.email = c.email JOIN leads l ON l.id = c.lead_id WHERE l.account_id IS NULL').all(),
  ];
  const follow = db.prepare("SELECT 1 FROM leads l JOIN accounts a ON a.id = l.account_id WHERE (a.status = 'approved' AND l.status != 'client') OR (a.status = 'pending' AND l.status IN ('new', 'contacted')) LIMIT 1").get();
  if (!pairs.length && !follow) return 0; // (si chiama ogni minuto: se non c'è nulla da allineare non si apre nemmeno una scrittura)
  return tx(db, () => {
    const touched = new Set(); // (un contatto che si aggancia e cambia stato conta una volta)
    for (const { lead_id: leadId, account_id: accountId } of pairs) {
      const lead = getLead(db, leadId);
      if (!lead || lead.account_id) continue;
      const acct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
      if (!acct) continue;
      db.prepare('UPDATE leads SET account_id = ?, updated_at = ? WHERE id = ?').run(accountId, iso(nowMs), leadId);
      logActivity(db, leadId, { kind: 'profile', title: `Profilo B2B collegato: ${acct.company}`, body: acct.status === 'approved' ? 'Può prenotare dall’area agenzie.' : 'Aspetta la tua approvazione.', at: acct.created_at, nowMs });
      touched.add(leadId);
    }
    // lo stato segue il profilo
    for (const r of db.prepare("SELECT l.id, l.status, a.status AS account_status FROM leads l JOIN accounts a ON a.id = l.account_id WHERE l.status != 'client' AND a.status IN ('approved', 'pending')").all()) {
      if (r.account_status === 'approved') {
        setStatus(db, r.id, 'client', { nowMs, why: 'Il profilo B2B è approvato.' });
        touched.add(r.id);
      } else if (['new', 'contacted'].includes(r.status)) {
        setStatus(db, r.id, 'talking', { nowMs, why: 'Si è registrata sul sito: aspetta la tua approvazione.' });
        touched.add(r.id);
      }
    }
    return touched.size;
  });
}

/** Quante agenzie registrate sul sito non sono ancora tra i contatti (né agganciate per email). */
export const unlinkedAccounts = (db) => Number(db.prepare('SELECT COUNT(*) AS n FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.account_id = a.id)').get().n);

/**
 * Il contatto commerciale di un'agenzia già registrata sul sito (lo crea se non c'è): «Cliente» se è approvata, «In dialogo» se aspetta l'approvazione,
 * «Non interessata» se rifiutata o sospesa. Il profilo B2B è agganciato.
 * @returns {{ lead: object, created: boolean } | null} null se l'agenzia non esiste
 */
export function leadFromAccount(db, accountId, nowMs = Date.now()) {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(accountId));
  if (!a) return null;
  const existing = leadOfAccount(db, a.id);
  if (existing) return { lead: existing, created: false };
  return tx(db, () => {
    syncAccounts(db, nowMs); // se c'è già un contatto con la stessa email, lo si aggancia invece di farne un altro
    const linked = leadOfAccount(db, a.id);
    if (linked) return { lead: linked, created: false };
    const country = a.country && isCountry(a.country) ? a.country.toUpperCase() : '';
    const lead = insertLead(
      db,
      {
        company: a.company, kind: 'agency', status: a.status === 'approved' ? 'client' : a.status === 'pending' ? 'talking' : 'lost', priority: 2, source: 'Registrata sul sito',
        website: normalizeWebsite(a.website), email: '', phone: '', country, city: a.city ?? '', lang: normLang(a.lang), notes: a.message ? `Messaggio alla richiesta: ${a.message}` : '', nextAction: '', nextActionOn: '',
      },
      { contact: { name: a.contact_name, role: '', email: a.email, phone: a.phone ?? '', lang: '', notes: '' }, nowMs },
    );
    db.prepare('UPDATE leads SET account_id = ? WHERE id = ?').run(a.id, lead.id);
    logActivity(db, lead.id, { kind: 'profile', title: 'Agenzia già registrata sul sito', body: `Profilo B2B: ${{ approved: 'approvato', pending: 'da approvare' }[a.status] ?? a.status}.`, at: a.created_at, nowMs });
    return { lead: getLead(db, lead.id), created: true };
  });
}

/** Mette tra i contatti tutte le agenzie già registrate sul sito che non ci sono ancora. @returns {number} quante ne ha aggiunte */
export function addRegistered(db, nowMs = Date.now()) {
  syncAccounts(db, nowMs); // prima si agganciano quelle che hanno già un contatto con la stessa email
  let n = 0;
  for (const a of db.prepare('SELECT a.id FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM leads l WHERE l.account_id = a.id) ORDER BY a.id').all()) if (leadFromAccount(db, a.id, nowMs)?.created) n++;
  return n;
}

// ───────────── importazione ed esportazione ─────────────
export const MAX_IMPORT_CHARS = 600_000;
export const MAX_IMPORT_ROWS = 1000;
const HEADERS = {
  company: ['azienda', 'agenzia', 'ragione sociale', 'nome agenzia', 'nome azienda', 'company', 'agency', 'denominazione', 'societa', 'name', 'nome', 'tour operator'],
  kind: ['tipo', 'tipologia', 'categoria', 'type', 'kind', 'category'],
  country: ['paese', 'nazione', 'country', 'nation'],
  city: ['citta', 'city', 'localita', 'comune', 'town'],
  website: ['sito', 'sito web', 'sito internet', 'website', 'web', 'url', 'www'],
  email: ['email', 'e-mail', 'mail', 'indirizzo email', 'email generale', 'email agenzia', 'posta elettronica'],
  phone: ['telefono', 'tel', 'phone', 'telephone', 'telefono agenzia', 'centralino', 'cellulare'],
  contact: ['referente', 'contatto', 'persona', 'contact', 'contact name', 'nome referente', 'responsabile', 'titolare', 'nome e cognome'],
  role: ['ruolo', 'qualifica', 'funzione', 'role', 'title', 'posizione'],
  contactEmail: ['email referente', 'mail referente', 'email contatto', 'contact email', 'email persona'],
  contactPhone: ['telefono referente', 'cellulare referente', 'tel referente', 'contact phone', 'cellulare contatto'],
  lang: ['lingua', 'language', 'lang'],
  source: ['fonte', 'origine', 'source', 'provenienza'],
  priority: ['priorita', 'priority'],
  status: ['stato', 'status'],
  notes: ['note', 'notes', 'annotazioni', 'commenti', 'nota'],
};
const POSITIONAL = ['company', 'contact', 'email', 'phone', 'website', 'country', 'city'];
export const IMPORT_COLUMNS = { company: 'Azienda', kind: 'Tipo', country: 'Paese', city: 'Città', website: 'Sito', email: 'Email', phone: 'Telefono', contact: 'Referente', role: 'Ruolo', contactEmail: 'Email referente', contactPhone: 'Telefono referente', lang: 'Lingua', source: 'Fonte', priority: 'Priorità', status: 'Stato', notes: 'Note' };
export const IMPORT_WARNING = { website: 'sito non valido (scartato)', email: 'email non valida (scartata)', phone: 'telefono non valido (scartato)', country: 'paese non riconosciuto (scartato)', date: 'data non valida (scartata)', 'contact-email': 'email del referente non valida (scartata)', 'contact-phone': 'telefono del referente non valido (scartato)' };

/**
 * Legge un elenco incollato o caricato (CSV, oppure celle copiate da un foglio di calcolo). Riconosce le colonne dall'intestazione
 * («Azienda», «Email», «Referente»…); senza intestazione l'ordine è: azienda, referente, email, telefono, sito, paese, città.
 * @returns {{ columns: string[], rows: { line: number, lead: object|null, contact: object|null, warnings: string[], error?: string }[], tooMany: boolean }}
 */
export function parseImport(text) {
  const table = splitCsv(String(text ?? '').slice(0, MAX_IMPORT_CHARS));
  if (!table.length) return { columns: [], rows: [], tooMany: false };
  const names = new Map();
  for (const [field, words] of Object.entries(HEADERS)) for (const w of words) names.set(w, field);
  const first = table[0].map((c) => names.get(fold(c).replace(/_/g, ' ')) ?? null);
  const hasHeader = first.includes('company');
  const map = hasHeader ? first : POSITIONAL.slice(0, table[0].length);
  const body = hasHeader ? table.slice(1) : table;
  const columns = [...new Set(map.filter(Boolean))];
  const rows = [];
  for (const cells of body.slice(0, MAX_IMPORT_ROWS)) {
    const get = Object.fromEntries(map.map((f, i) => (f ? [f, cells[i] ?? ''] : null)).filter(Boolean));
    const line = cells.line ?? 0;
    try {
      const personal = get.contactEmail || (get.contact ? get.email : '');
      const { value, warnings } = cleanLead({ ...get, nextAction: '', hintEmail: personal }, { lenient: true });
      let contact = null;
      if (get.contact || get.contactEmail || get.contactPhone) {
        const c = cleanContact({ name: get.contact, role: get.role, email: personal, phone: get.contactPhone, lang: '' }, { lenient: true, country: value.country });
        contact = c.value;
        warnings.push(...c.warnings);
        if (get.contact && !get.contactEmail && value.email === contact.email) value.email = ''; // l'indirizzo è del referente: non si ripete come indirizzo dell'agenzia
      }
      rows.push({ line, lead: value, contact, warnings });
    } catch (err) {
      if (!(err instanceof LeadError)) throw err;
      rows.push({ line, lead: null, contact: null, warnings: [], error: 'senza nome' });
    }
  }
  return { columns, rows, tooMany: body.length > MAX_IMPORT_ROWS };
}

/**
 * Mette ciascuna riga letta da `parseImport` nell'elenco, saltando i doppioni (un'agenzia già presente non si tocca).
 * @returns {{ created: number, duplicates: { line: number, company: string, of: { id: number, company: string, why: string } }[], skipped: number }}
 */
export function importLeads(db, rows, { source = '', nowMs = Date.now() } = {}) {
  const index = duplicateIndex(db);
  const out = { created: 0, duplicates: [], skipped: 0 };
  tx(db, () => {
    for (const r of rows) {
      if (!r.lead) {
        out.skipped++;
        continue;
      }
      const dup = index.find({ company: r.lead.company, email: r.lead.email, contactEmail: r.contact?.email, website: r.lead.website })[0];
      if (dup) {
        out.duplicates.push({ line: r.line, company: r.lead.company, of: dup });
        continue;
      }
      const lead = insertLead(db, { ...r.lead, source: r.lead.source || cleanText(source, 120) }, { contact: r.contact, nowMs, activity: 'Importato da un elenco' });
      index.remember(lead, r.contact?.email);
      out.created++;
    }
  });
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Testo libero (nomi inseriti da chiunque): un apice davanti impedisce che Excel o Sheets lo eseguano come formula. Un numero «+39 041 …» non può contenere una formula: resta com'è. */
const csvText = (v) => (/^[=+\-@\t\r]/.test(String(v ?? '')) && !/^\+\d[\d\s().-]*$/.test(String(v)) ? `'${v}` : v);

/** Tutti i contatti in un foglio di calcolo (separatore «;», aperto da Excel senza passaggi). */
export function leadsCsv(db) {
  const head = ['Azienda', 'Tipo', 'Stato', 'Priorità', 'Paese', 'Città', 'Sito', 'Email', 'Telefono', 'Referente', 'Ruolo', 'Email referente', 'Telefono referente', 'Lingua', 'Fonte', 'Prossima azione', 'Data prossima azione', 'Ultimo contatto', 'Non scrivere', 'Profilo B2B', 'Note'];
  const lines = db
    .prepare(`SELECT ${COLS} FROM leads l ${MAIN} ORDER BY l.company COLLATE NOCASE`)
    .all()
    .map((l) =>
      [l.company, KIND_LABEL[l.kind], STATUS_LABEL[l.status], PRIORITY_LABEL[l.priority], l.country, l.city, l.website, l.email, l.phone, l.contact_name, l.contact_role, l.contact_email, l.contact_phone, l.lang, l.source, l.next_action, l.next_action_on, l.last_contact_on, l.email_ok ? '' : 'sì', l.account_id ? 'sì' : '', l.notes]
        .map((v) => csvCell(csvText(v)))
        .join(';'),
    );
  return String.fromCharCode(0xfeff) + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}
