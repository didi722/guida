// Commerciale › Email: i modelli di presentazione (modificabili, in italiano, inglese, spagnolo e giapponese), come si compongono e si
// firmano, il link per non riceverne altre e la coda d'invio. Funzioni su database e configurazione, senza rete: l'invio è in leadServices.js.
import { signToken, verifyToken } from './auth.js';
import { getSetting, setSetting } from './db.js';
import { esc } from './html.js';
import { LANGS, normLang, pick } from './langs.js';
import { LeadError, firstName, getLead, isSuppressed } from './leads.js';
import { addDays, dayOfWeek, localToInstant } from './time.js';
import { cleanText, isEmail } from './util.js';

export const TEMPLATE_KEYS = ['presentation', 'followup', 'thanks'];
export const TEMPLATE_LABEL = { presentation: 'Presentazione', followup: 'Sollecito', thanks: 'Dopo un incontro', custom: 'Scritta a mano' };
export const TEMPLATE_HINT = {
  presentation: 'La prima email: chi sei, cosa fai per le agenzie e dove vedere come lavori.',
  followup: 'Un solo promemoria gentile, se non rispondono (parte da solo, se lo scegli).',
  thanks: 'Dopo una telefonata, una videochiamata o una visita.',
};
/** I segnaposto che si possono scrivere nei modelli, tra doppie graffe: {{agenzia}}. */
export const VARIABLES = [
  ['saluto', 'il saluto nella lingua dell’email («Buongiorno Anna,» oppure «Buongiorno,»)'],
  ['nome', 'il nome di battesimo del referente (vuoto se non lo conosci)'],
  ['referente', 'nome e cognome del referente (vuoto se non lo conosci)'],
  ['agenzia', 'il nome dell’agenzia'],
  ['guida', 'il tuo nome, come sul sito'],
  ['firma', 'la tua firma: nome, abilitazione, recapiti'],
  ['link_agenzie', 'il collegamento alla pagina del sito per le agenzie, nella lingua dell’email'],
  ['link_registrazione', 'il collegamento al modulo di richiesta d’accesso'],
];
const VAR_NAMES = new Set(VARIABLES.map(([k]) => k));

// ───────────── i modelli di partenza ─────────────
const BULLETS = {
  it: ['visite guidate private e tour a piccoli gruppi', 'assistenza in loco e accompagnamento dei gruppi (assistente, tour leader)', 'accoglienza e meet & greet', 'programmi di più giorni, su misura'],
  en: ['private guided tours and small-group tours', 'on-site assistance and group escorting (local assistant, tour leader)', 'greeting and meet & greet', 'tailor-made multi-day programmes'],
  es: ['visitas guiadas privadas y tours en grupos reducidos', 'asistencia en destino y acompañamiento de grupos (asistente, tour leader)', 'recepción y meet & greet', 'programas de varios días a medida'],
  ja: ['プライベートガイド、少人数グループツアー', '現地アシスタント、ツアーリーダー（添乗）', 'お出迎え（ミート＆グリート）', '複数日にわたるプログラムのご相談'],
};
const list = (lang) => BULLETS[lang].map((b) => `• ${b}`).join('\n');

export const DEFAULT_TEMPLATES = {
  presentation: {
    it: {
      subject: 'Collaborazione con {{agenzia}} · guida abilitata a Venezia',
      body: `{{saluto}}

mi chiamo {{guida}} e sono una guida turistica abilitata a Venezia: lavoro in italiano, inglese, spagnolo e giapponese.

Scrivo alle agenzie e ai tour operator che portano clienti a Venezia e cercano un professionista affidabile sul posto. Posso occuparmi di:
${list('it')}

Per lavorare con le agenzie ho preparato un’area riservata sul mio sito: tariffe dedicate, calendario delle date libere, prenotazione in autonomia (anche solo «in opzione», senza pagare, finché il vostro cliente decide), voucher senza prezzi con il vostro logo e fatturazione elettronica. Trovate tutto qui:
{{link_agenzie}}

Se vi fa comodo possiamo sentirci per telefono o in videochiamata, oppure incontrarci di persona se siete a Venezia o dintorni: basta rispondere a questa email.

{{firma}}`,
    },
    en: {
      subject: 'Working together with {{agenzia}} · licensed tour guide in Venice',
      body: `{{saluto}}

my name is {{guida}} and I am a licensed tour guide in Venice. I work in Italian, English, Spanish and Japanese.

I am writing to agencies and tour operators who bring clients to Venice and look for a reliable professional on the ground. I can take care of:
${list('en')}

To work with agencies I have set up a reserved area on my website: dedicated rates, a calendar of free dates, self-service booking (even as a free “option” that holds the date while your client decides), vouchers without prices carrying your logo, and electronic invoicing. You will find everything here:
{{link_agenzie}}

If it suits you, we can speak by phone or video call, or meet in person if you are in or near Venice. Just reply to this email.

{{firma}}`,
    },
    es: {
      subject: 'Colaboración con {{agenzia}} · guía turístico habilitado en Venecia',
      body: `{{saluto}}

me llamo {{guida}} y soy guía turístico habilitado en Venecia. Trabajo en italiano, inglés, español y japonés.

Me dirijo a agencias y operadores turísticos que traen clientes a Venecia y buscan un profesional de confianza sobre el terreno. Puedo encargarme de:
${list('es')}

Para trabajar con agencias he preparado un área reservada en mi web: tarifas exclusivas, calendario de fechas libres, reserva autónoma (incluso en «opción», sin pagar, mientras su cliente decide), vouchers sin precios con su logotipo y facturación electrónica. Lo encontrarán todo aquí:
{{link_agenzie}}

Si les viene bien, podemos hablar por teléfono o por videollamada, o vernos en persona si están en Venecia o cerca: basta con responder a este correo.

{{firma}}`,
    },
    ja: {
      subject: 'ヴェネツィアの公認ガイドのご紹介（{{agenzia}}様）',
      body: `{{saluto}}

突然のご連絡失礼いたします。ヴェネツィアで公認ガイドをしております{{guida}}と申します。

旅行会社・ツアーオペレーターの皆様の、ヴェネツィアでの現地サポートをお手伝いしております。日本語・イタリア語・英語・スペイン語に対応しており、以下のサービスをご提供しています。
${list('ja')}

旅行会社様向けの専用ページをご用意しております（専用料金、空き日程の確認、オンライン予約、お支払い前の日程の仮押さえ、ロゴ入りで金額の載らないバウチャー、電子請求書）。詳細は下記をご覧ください。
{{link_agenzie}}

ご興味をお持ちいただけましたら、お電話やオンライン面談など、ご都合のよい形でご説明いたします。本メールにご返信ください。

どうぞよろしくお願いいたします。

{{firma}}`,
    },
  },
  followup: {
    it: {
      subject: 'Un promemoria: collaborazione con {{agenzia}} a Venezia',
      body: `{{saluto}}

vi riscrivo in breve perché non so se la mia email di qualche giorno fa sia arrivata, o se sia finita tra le tante.

Sono {{guida}}, guida turistica abilitata a Venezia, e lavoro con agenzie e tour operator per visite private, gruppi, assistenza in loco e accoglienza. Qui trovate come lavoro con le agenzie:
{{link_agenzie}}

Se oggi non è il momento giusto nessun problema: rispondete pure «no grazie» e non vi scriverò più. Altrimenti sono volentieri a disposizione per una telefonata di dieci minuti, quando vi è comodo.

{{firma}}`,
    },
    en: {
      subject: 'A quick reminder: working together in Venice ({{agenzia}})',
      body: `{{saluto}}

I am following up briefly, as I am not sure my email from a few days ago reached you, or got lost among many others.

I am {{guida}}, a licensed tour guide in Venice, and I work with agencies and tour operators on private tours, groups, on-site assistance and greeting. Here is how I work with agencies:
{{link_agenzie}}

If now is not the right time, no problem: just reply “no thanks” and I will not write again. Otherwise I would be glad to have a ten-minute call whenever it suits you.

{{firma}}`,
    },
    es: {
      subject: 'Un recordatorio: colaboración con {{agenzia}} en Venecia',
      body: `{{saluto}}

les escribo brevemente porque no sé si mi correo de hace unos días les llegó, o si se perdió entre tantos otros.

Soy {{guida}}, guía turístico habilitado en Venecia, y trabajo con agencias y operadores en visitas privadas, grupos, asistencia en destino y recepción. Aquí pueden ver cómo trabajo con las agencias:
{{link_agenzie}}

Si ahora no es el momento, no hay problema: respondan «no, gracias» y no volveré a escribirles. Si no, estaré encantado de hacer una llamada de diez minutos cuando les venga bien.

{{firma}}`,
    },
    ja: {
      subject: '【ご確認】ヴェネツィアでのガイド業務について（{{agenzia}}様）',
      body: `{{saluto}}

先日ご連絡いたしました、ヴェネツィアで公認ガイドをしております{{guida}}です。メールが届いているか気になり、改めてご連絡いたしました。

旅行会社様向けのご案内はこちらです。
{{link_agenzie}}

現在ご不要でしたら、その旨をご返信いただければ、今後のご連絡は控えさせていただきます。ご興味がございましたら、短いお電話やオンライン面談でご説明いたします。

どうぞよろしくお願いいたします。

{{firma}}`,
    },
  },
  thanks: {
    it: {
      subject: 'Grazie per il tempo dedicato · {{guida}}',
      body: `{{saluto}}

grazie per il tempo che mi avete dedicato: è stato un piacere.

Vi lascio il collegamento alla pagina per le agenzie, dove trovate i servizi e come funziona l’area riservata:
{{link_agenzie}}

Se vi fa comodo posso prepararvi un invito personale all’area riservata, così vedete subito tariffe e date libere senza attendere l’approvazione. Basta una risposta a questa email.

Resto a disposizione per qualsiasi domanda.

{{firma}}`,
    },
    en: {
      subject: 'Thank you for your time · {{guida}}',
      body: `{{saluto}}

thank you for the time you gave me: it was a pleasure.

Here is the link to the page for agencies, with my services and how the reserved area works:
{{link_agenzie}}

If it helps, I can prepare a personal invitation to the reserved area, so you can see rates and free dates right away without waiting for approval. Just reply to this email.

I am at your disposal for any question.

{{firma}}`,
    },
    es: {
      subject: 'Gracias por su tiempo · {{guida}}',
      body: `{{saluto}}

gracias por el tiempo que me han dedicado: ha sido un placer.

Les dejo el enlace a la página para agencias, donde encontrarán mis servicios y cómo funciona el área reservada:
{{link_agenzie}}

Si les resulta útil, puedo prepararles una invitación personal al área reservada, para que vean enseguida tarifas y fechas libres sin esperar la aprobación. Basta con responder a este correo.

Quedo a su disposición para cualquier duda.

{{firma}}`,
    },
    ja: {
      subject: 'お時間をいただきありがとうございました（{{guida}}）',
      body: `{{saluto}}

このたびはお時間をいただき、誠にありがとうございました。

旅行会社様向けのご案内ページをお送りします。サービス内容と、専用ページのご利用方法をご確認いただけます。
{{link_agenzie}}

ご希望でしたら、専用ページへの個別のご招待をお送りします（承認をお待ちいただかずに、すぐに料金と空き日程をご確認いただけます）。本メールにご返信ください。

ご不明な点がございましたら、お気軽にご連絡ください。どうぞよろしくお願いいたします。

{{firma}}`,
    },
  },
};

// ───────────── impostazioni d'invio e modelli modificati ─────────────
export const SEND_DEFAULTS = {
  paused: false, // l'invio automatico è fermo (la coda resta com'è)
  dailyCap: 15, // al massimo tante email al giorno dalla coda
  fromHour: 9, // finestra d'invio, ora di Venezia, dal lunedì al venerdì
  toHour: 17,
  minGapMin: 4, // pausa minima tra un invio e il successivo
  followUpDays: 7, // tra quanti giorni parte il sollecito
  autoFollowUp: true, // proposto già spuntato quando scrivi una presentazione
  signature: '', // vuota = la firma si compone dai dati del sito
};
const SEND_LIMITS = { dailyCap: [1, 100], fromHour: [0, 23], toHour: [1, 24], minGapMin: [1, 120], followUpDays: [2, 60] };

export function sendSettings(db) {
  const s = { ...SEND_DEFAULTS, ...(getSetting(db, 'lead_send', {}) ?? {}) };
  for (const [k, [min, max]] of Object.entries(SEND_LIMITS)) s[k] = Number.isInteger(s[k]) && s[k] >= min && s[k] <= max ? s[k] : SEND_DEFAULTS[k];
  if (s.toHour <= s.fromHour) Object.assign(s, { fromHour: SEND_DEFAULTS.fromHour, toHour: SEND_DEFAULTS.toHour });
  return s;
}

/** Salva le impostazioni d'invio dal modulo. @returns {{ ok: true } | { error: string }} */
export function saveSendSettings(db, input) {
  const next = { ...sendSettings(db) };
  for (const [k, [min, max]] of Object.entries(SEND_LIMITS)) {
    const n = Number(String(input[k] ?? '').trim());
    if (!Number.isInteger(n) || n < min || n > max) return { error: `${SEND_LABEL[k]}: un numero intero tra ${min} e ${max}.` };
    next[k] = n;
  }
  if (next.toHour <= next.fromHour) return { error: 'L’orario di fine deve essere dopo quello di inizio.' };
  next.autoFollowUp = !!input.autoFollowUp;
  next.signature = String(input.signature ?? '').replace(/\r\n/g, '\n').trim().slice(0, 600);
  setSetting(db, 'lead_send', { ...next, paused: sendSettings(db).paused });
  return { ok: true };
}
export const SEND_LABEL = { dailyCap: 'Email al giorno', fromHour: 'Dalle ore', toHour: 'Alle ore', minGapMin: 'Pausa tra un invio e l’altro', followUpDays: 'Giorni prima del sollecito' };

export function setPaused(db, paused) {
  setSetting(db, 'lead_send', { ...getSetting(db, 'lead_send', {}), ...sendSettings(db), paused: !!paused });
}

/** Tutti i modelli: quelli modificati dalla guida e, dove non ce ne sono, quelli di partenza. @returns {Record<string, Record<string, {subject: string, body: string, custom: boolean}>>} */
export function templates(db) {
  const saved = getSetting(db, 'lead_templates', {}) ?? {};
  const out = {};
  for (const key of TEMPLATE_KEYS) {
    out[key] = {};
    for (const lang of LANGS) {
      const mine = saved[key]?.[lang];
      out[key][lang] = mine?.subject && mine?.body ? { subject: mine.subject, body: mine.body, custom: true } : { ...DEFAULT_TEMPLATES[key][lang], custom: false };
    }
  }
  return out;
}

/** I segnaposto scritti in un testo che non esistono (un refuso in `{{agenzzia}}` farebbe partire un'email sbagliata). */
export const unknownVariables = (text) => [...new Set([...String(text ?? '').matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((m) => m[1]).filter((k) => !VAR_NAMES.has(k)))];

/** Salva un modello modificato. Testo vuoto = si torna a quello di partenza. @throws {LeadError} 'template' | 'placeholder' */
export function saveTemplate(db, key, lang, { subject, body }) {
  if (!TEMPLATE_KEYS.includes(key) || !LANGS.includes(lang)) throw new LeadError('template');
  const saved = getSetting(db, 'lead_templates', {}) ?? {};
  const s = cleanText(subject, 200).replace(/\s+/g, ' ');
  const b = String(body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 6000);
  if (!s && !b) {
    if (saved[key]) delete saved[key][lang];
  } else {
    if (!s || !b) throw new LeadError('empty');
    const bad = unknownVariables(`${s} ${b}`);
    if (bad.length) throw Object.assign(new LeadError('placeholder'), { names: bad });
    saved[key] = { ...(saved[key] ?? {}), [lang]: { subject: s, body: b } };
  }
  setSetting(db, 'lead_templates', saved);
}

// ───────────── comporre un'email ─────────────
const GREETING = {
  it: (n) => (n ? `Buongiorno ${n},` : 'Buongiorno,'),
  en: (n) => (n ? `Hello ${n},` : 'Hello,'),
  es: (n) => (n ? `Hola ${n},` : 'Hola,'),
  ja: (n, company, full) => `${company}\n${full ? `${full} 様` : 'ご担当者様'}`,
};

/** La firma in fondo all'email: quella scelta dalla guida, oppure nome, abilitazione e recapiti del sito. */
export function signature(app, lang) {
  const custom = sendSettings(app.db).signature;
  if (custom) return custom;
  const { site } = app.cfg;
  return [site.name, pick(site.tagline, lang), site.guideLicense, site.phone && `Tel. ${site.phone}`, site.email, app.cfg.baseUrl].filter(Boolean).join('\n');
}

export const b2bLink = (app, lang) => `${app.cfg.baseUrl}/${lang}/b2b`;

export function variablesFor(app, lead, contact, lang) {
  const l = normLang(lang);
  const full = contact && !contact.name.includes('@') ? contact.name : '';
  const name = firstName(contact?.name);
  return {
    saluto: GREETING[l](name, lead.company, full),
    nome: name,
    referente: full,
    agenzia: lead.company,
    guida: app.cfg.site.name,
    firma: signature(app, l),
    link_agenzie: b2bLink(app, l),
    link_registrazione: `${b2bLink(app, l)}/register`,
  };
}

/** Sostituisce i segnaposto; quelli che non si conoscono restano scritti (il controllo prima dell'invio li ferma). */
export const fillTemplate = (text, vars) => String(text ?? '').replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : m));

/**
 * L'email pronta da rivedere: destinatario, lingua, oggetto e testo (senza il piede con il link per non ricevere più email, che si aggiunge all'invio).
 * @returns {{ to: string, lang: string, subject: string, body: string }}
 */
export function composeEmail(app, { lead, contact = null, template = 'presentation', lang = null }) {
  const l = normLang(lang ?? contact?.lang ?? lead.lang);
  const tpl = templates(app.db)[template]?.[l] ?? templates(app.db).presentation[l];
  const vars = variablesFor(app, lead, contact, l);
  return {
    to: contact?.email || lead.email || '',
    lang: l,
    subject: fillTemplate(tpl.subject, vars).replace(/\s+/g, ' ').trim(),
    body: fillTemplate(tpl.body, vars).replace(/\n{3,}/g, '\n\n').trim(),
  };
}

// ───────────── link per non ricevere più email ─────────────
const TEN_YEARS = 10 * 365 * 24 * 3600_000;
/** Il collegamento nel piede di ogni email: firmato, senza nulla da conservare nel database; vale anni (una vecchia email deve poter ancora disiscriversi). */
export const unsubscribeToken = (cfg, leadId, nowMs = Date.now()) => signToken(cfg.sessionSecret, { k: 'lead-out', id: Number(leadId), exp: nowMs + TEN_YEARS });
export const unsubscribeUrl = (app, leadId, lang, nowMs = Date.now()) => `${app.cfg.baseUrl}/${normLang(lang)}/b2b/unsubscribe/${unsubscribeToken(app.cfg, leadId, nowMs)}`;
/** @returns {number|null} il contatto a cui si riferisce il collegamento */
export function leadOfToken(cfg, token) {
  const p = verifyToken(cfg.sessionSecret, token);
  return p?.k === 'lead-out' && Number.isInteger(p.id) ? p.id : null;
}

const FOOTER = {
  it: (url) => `Ricevi questo messaggio perché il tuo indirizzo professionale è tra quelli a cui presento i miei servizi alle agenzie. Se non desideri riceverne altri puoi dirmelo rispondendo qui, oppure con un clic: ${url}`,
  en: (url) => `You are receiving this message because your business address is among those I contact to present my services to agencies. If you would rather not receive any more, just reply to this email or click here: ${url}`,
  es: (url) => `Recibes este mensaje porque tu dirección profesional figura entre aquellas a las que presento mis servicios para agencias. Si prefieres no recibir más, responde a este correo o haz clic aquí: ${url}`,
  ja: (url) => `このメールは、旅行会社様に当方のサービスをご紹介している業務用アドレス宛にお送りしています。今後のご案内が不要な場合は、本メールにご返信いただくか、こちらをクリックしてください：${url}`,
};
const VAT_WORD = { it: 'P.IVA', en: 'VAT no.', es: 'N.º IVA', ja: 'VAT番号' };

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const linkify = (escaped) =>
  escaped.replace(URL_RE, (m) => {
    const tail = m.match(/(?:[.,;:!?)»”]|&quot;|&#39;|&gt;)+$/)?.[0] ?? '';
    const url = tail ? m.slice(0, -tail.length) : m;
    return `<a href="${url}" style="color:#7a5c2e">${url}</a>${tail}`;
  });
const paragraph = (text, style) => `<p style="${style}">${linkify(esc(text)).replace(/\n/g, '<br>')}</p>`;

/**
 * L'email com'è davvero spedita: il testo approvato, il piede con chi scrive e il link per non riceverne altre (obbligatorio, non si può togliere),
 * una versione HTML semplice (volutamente senza grafica: è una lettera personale) e le intestazioni per il «annulla iscrizione» del programma di posta.
 */
export function renderOutgoing(app, { lead, lang, subject, body, preview = false }, nowMs = Date.now()) {
  const l = normLang(lang);
  const url = preview ? `${app.cfg.baseUrl}/${l}/b2b/unsubscribe/anteprima` : unsubscribeUrl(app, lead.id, l, nowMs); // nell'anteprima il link non disiscrive nessuno
  const { site } = app.cfg;
  const who = [site.legalName || site.name, site.vatNumber && `${VAT_WORD[l]} ${site.vatNumber}`, site.address].filter(Boolean).join(' · ');
  const footer = `${FOOTER[l](url)}\n${who}`;
  const text = `${body}\n\n--\n${footer}\n`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1c1c1c;max-width:600px">${String(body)
    .split(/\n{2,}/)
    .map((p) => paragraph(p, 'margin:0 0 14px'))
    .join('')}<hr style="border:0;border-top:1px solid #ddd;margin:22px 0 10px">${paragraph(footer, 'margin:0;color:#777;font-size:12px;line-height:1.5')}</div>`;
  return { subject: subject.replace(/\s+/g, ' ').trim(), text, html, headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

// ───────────── la coda ─────────────
const iso = (ms) => new Date(ms).toISOString();
export const COLD_TEMPLATES = ['presentation', 'followup'];

/**
 * Mette un'email in coda (o la prepara per partire subito, con `sendAfter` adesso). Non parte da sola finché non è il suo momento.
 * @throws {LeadError} 'notfound' | 'email' | 'blocked' (non vuole email) | 'empty' | 'placeholder' | 'duplicate' (c'è già una uguale in coda)
 */
export function queueEmail(db, { leadId, contactId = null, to, template = 'custom', lang, subject, body, sendAfter, onlyIfQuiet = false, followupDays = null }, nowMs = Date.now()) {
  const lead = getLead(db, leadId);
  if (!lead) throw new LeadError('notfound');
  const email = cleanText(to, 254).toLowerCase();
  if (!isEmail(email)) throw new LeadError('email');
  if (!lead.email_ok || isSuppressed(db, email)) throw new LeadError('blocked');
  const s = cleanText(subject, 200).replace(/\s+/g, ' ');
  const b = String(body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 8000);
  if (!s || !b) throw new LeadError('empty');
  if (unknownVariables(`${s} ${b}`).length) throw new LeadError('placeholder');
  if (COLD_TEMPLATES.includes(template) && db.prepare("SELECT 1 FROM lead_emails WHERE lead_id = ? AND template = ? AND status = 'queued'").get(leadId, template)) throw new LeadError('duplicate');
  const when = Number.isFinite(sendAfter) ? sendAfter : nowMs;
  const days = Number.isInteger(followupDays) && followupDays >= 2 && followupDays <= 60 ? followupDays : null;
  const row = db
    .prepare('INSERT INTO lead_emails(lead_id, contact_id, to_email, template, lang, subject, body, send_after, only_if_quiet, followup_days, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(leadId, contactId && db.prepare('SELECT 1 FROM lead_contacts WHERE id = ? AND lead_id = ?').get(contactId, leadId) ? contactId : null, email, TEMPLATE_LABEL[template] ? template : 'custom', normLang(lang), s, b, iso(when), onlyIfQuiet ? 1 : 0, days, iso(nowMs));
  return getEmail(db, Number(row.lastInsertRowid));
}

export const getEmail = (db, id) => db.prepare('SELECT e.*, l.company FROM lead_emails e JOIN leads l ON l.id = e.lead_id WHERE e.id = ?').get(Number(id)) ?? null;
export const queuedEmails = (db) => db.prepare("SELECT e.*, l.company FROM lead_emails e JOIN leads l ON l.id = e.lead_id WHERE e.status = 'queued' ORDER BY e.send_after, e.id").all();
export const recentEmails = (db, limit = 100) => db.prepare("SELECT e.*, l.company FROM lead_emails e JOIN leads l ON l.id = e.lead_id WHERE e.status != 'queued' ORDER BY COALESCE(e.sent_at, e.created_at) DESC, e.id DESC LIMIT ?").all(limit);
export const leadEmails = (db, leadId) => db.prepare('SELECT * FROM lead_emails WHERE lead_id = ? ORDER BY id DESC LIMIT 50').all(leadId);
export const queuedCount = (db) => Number(db.prepare("SELECT COUNT(*) AS n FROM lead_emails WHERE status = 'queued'").get().n);

/** Annulla un'email ancora in coda. @returns {boolean} */
export function cancelEmail(db, id, note = 'Annullata da te') {
  return db.prepare("UPDATE lead_emails SET status = 'cancelled', note = ? WHERE id = ? AND status = 'queued'").run(note, Number(id)).changes === 1;
}

/** Il giorno di Venezia che contiene l'istante, come intervallo di istanti [da, a). */
export function dayRange(date) {
  return [iso(localToInstant(date, '00:00')), iso(localToInstant(addDays(date, 1), '00:00'))];
}
export const sentOn = (db, date) => {
  const [from, to] = dayRange(date);
  return Number(db.prepare("SELECT COUNT(*) AS n FROM lead_emails WHERE status = 'sent' AND sent_at >= ? AND sent_at < ?").get(from, to).n);
};
export const lastSentAt = (db) => db.prepare("SELECT MAX(sent_at) AS at FROM lead_emails WHERE status = 'sent'").get().at ?? null;

/** Adesso è un momento in cui la coda può partire? (lunedì–venerdì, dentro la finestra scelta; ora di Venezia) */
export function inWindow(s, rome) {
  const dow = dayOfWeek(rome.date);
  if (dow === 0 || dow === 6) return false;
  const [h, m] = rome.time.split(':').map(Number);
  const minutes = h * 60 + m;
  return minutes >= s.fromHour * 60 && minutes < s.toHour * 60;
}
