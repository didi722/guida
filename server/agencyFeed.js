// Calendario in abbonamento (.ics) dell'agenzia: le sue opzioni (con la scadenza) e le sue prenotazioni confermate,
// da aggiungere a Google Calendar, Apple Calendar o Outlook. L'indirizzo è privato: contiene una chiave che l'agenzia può rigenerare.
import crypto from 'node:crypto';
import { meetingOf } from './choices.js';
import { calendar, eventLines } from './ics.js';
import { makeT } from './i18n.js';
import { normLang, pick } from './langs.js';
import { addDays, fmtInstant, fromMin, nowRome, toMin } from './time.js';

const newKey = () => crypto.randomBytes(24).toString('base64url');

/** La chiave dell'agenzia (la crea al primo bisogno). */
export function ensureIcsKey(db, account) {
  if (account.ics_key) return account.ics_key;
  const key = newKey();
  db.prepare('UPDATE accounts SET ics_key = ? WHERE id = ? AND ics_key IS NULL').run(key, account.id);
  return db.prepare('SELECT ics_key FROM accounts WHERE id = ?').get(account.id).ics_key;
}

/** Una chiave nuova: quella vecchia smette di funzionare. */
export function rotateIcsKey(db, accountId) {
  const key = newKey();
  db.prepare('UPDATE accounts SET ics_key = ? WHERE id = ?').run(key, accountId);
  return key;
}

/** L'agenzia approvata che ha questa chiave, oppure null. */
export function accountByIcsKey(db, key) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 64) return null;
  const a = db.prepare('SELECT * FROM accounts WHERE ics_key = ?').get(key);
  return a?.status === 'approved' ? a : null;
}

/** L'indirizzo da incollare nell'app calendario (nella lingua dell'agenzia). */
export const feedUrl = (app, account, lang = normLang(account.lang)) => `${app.cfg.baseUrl}/${lang}/b2b/calendar.ics?k=${ensureIcsKey(app.db, account)}`;

/**
 * Il calendario dell'agenzia: un evento per ogni prenotazione confermata o opzione aperta (da 30 giorni fa in avanti),
 * e per ogni opzione un promemoria alla scadenza. Un'opzione di un pacchetto ha una sola scadenza.
 */
export function agencyFeed(app, account, nowMs = Date.now()) {
  const { db, cfg } = app;
  const lang = normLang(account.lang);
  const t = makeT(lang);
  const host = new URL(cfg.baseUrl).hostname;
  const since = addDays(nowRome(nowMs).date, -30);
  const nowIso = new Date(nowMs).toISOString();
  const rows = db
    .prepare(`SELECT * FROM bookings WHERE account_id = ? AND date >= ? AND (status = 'confirmed' OR (status = 'option' AND option_expires_at > ?)) ORDER BY date, start_time, id`)
    .all(account.id, since, nowIso);
  const events = [];
  const expiries = new Map();
  for (const b of rows) {
    const tour = app.content.tour(b.tour_slug);
    const title = pick(tour?.i18n ?? {}, lang)?.title ?? b.tour_slug;
    const option = b.status === 'option';
    const url = `${cfg.baseUrl}/${lang}/b2b/bookings/${b.ref}`;
    events.push(
      eventLines({
        uid: `${b.ref}@${host}`,
        date: b.date,
        start: b.start_time,
        end: b.end_time,
        summary: `${option ? `${t('feed.option')} · ` : ''}${title} · ${b.participants}${b.client_ref ? ` · ${b.client_ref}` : ''}`,
        description: [b.ref, `${t('feed.client')}: ${[b.name, b.phone].filter(Boolean).join(' · ')}`, option ? t('feed.optionHold', { until: fmtInstant(Date.parse(b.option_expires_at), lang) }) : t('feed.confirmed'), b.notes].filter(Boolean).join('\n'),
        location: meetingOf(tour, b, lang).text,
        url,
        status: option ? 'TENTATIVE' : 'CONFIRMED',
      }),
    );
    if (option) {
      const key = b.group_id ? `g${b.group_id}` : `b${b.id}`;
      const e = expiries.get(key) ?? { at: Date.parse(b.option_expires_at), titles: [], url };
      e.titles.push(title);
      expiries.set(key, e);
    }
  }
  for (const [key, e] of expiries) {
    const local = nowRome(e.at);
    const start = local.time;
    const end = fromMin(Math.min(23 * 60 + 59, toMin(start) + 15));
    events.push(eventLines({ uid: `${key}-scadenza@${host}`, date: local.date, start, end, summary: `⏰ ${t('feed.optionEnds')} · ${[...new Set(e.titles)].join(', ')}`, description: t('feed.optionEndsText'), url: e.url, status: 'CONFIRMED' }));
  }
  return calendar(t('feed.calName', { name: cfg.site.name }), events, { refreshHours: 1 });
}
