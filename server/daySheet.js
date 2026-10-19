// Scheda operativa di un giorno, per la guida: ogni servizio in ordine d'orario con tutto ciò che serve per farlo
// (punto d'incontro, persone, lingua, contatti del cliente o dell'agenzia, note, cosa incassare sul posto).
import { bookingDue } from './bookings.js';
import { meetingOf, themeText } from './choices.js';
import { LANG_META } from './langs.js';
import { parseServiceRecord, serviceNote } from './rates.js';
import { fmtInstant } from './time.js';

const PAY_LABEL = { card: 'pagata online', invoice: 'a fattura (agenzia)', giftcard: 'pagata con buono regalo', free: 'nessun pagamento dovuto', onsite: 'pagamento sul posto' };

/**
 * @returns {{ date: string, services: object[], programs: object[], blocks: object[], totals: {services: number, people: number, options: number, collectCents: number} }}
 *   `services`: confermati e opzioni ancora aperte, per orario
 */
export function daySheet(app, date, nowMs = Date.now()) {
  const { db, content } = app;
  const nowIso = new Date(nowMs).toISOString();
  const rows = db
    .prepare(
      `SELECT b.*, a.company AS acct_company, a.contact_name AS acct_contact, a.phone AS acct_phone, a.email AS acct_email FROM bookings b LEFT JOIN accounts a ON a.id = b.account_id
       WHERE b.date = ? AND (b.status = 'confirmed' OR (b.status = 'option' AND b.option_expires_at > ?)) ORDER BY b.start_time, b.id`,
    )
    .all(date, nowIso);
  const services = rows.map((b) => {
    const tour = content.tour(b.tour_slug);
    const meet = meetingOf(tour, b, 'it');
    const confirmed = b.status === 'confirmed';
    const collect = confirmed && b.payment_method === 'onsite' && b.payment_status === 'unpaid' ? bookingDue(b) : 0;
    return {
      id: b.id,
      ref: b.ref,
      confirmed,
      start: b.start_time,
      end: b.end_time,
      title: tour?.i18n.it.title ?? b.tour_slug,
      people: b.participants,
      tourLang: b.tour_lang && LANG_META[b.tour_lang] ? LANG_META[b.tour_lang].name : '',
      b2b: b.channel === 'b2b',
      name: b.name,
      phone: b.phone ?? '',
      email: b.email ?? '',
      agency: b.acct_company ?? '',
      agencyContact: [b.acct_contact, b.acct_phone, b.acct_email].filter(Boolean).join(' · '),
      clientRef: b.client_ref ?? '',
      meeting: meet.text ?? '',
      meetingUrl: meet.url ?? '',
      theme: themeText(b, 'it') ?? '',
      service: serviceNote(parseServiceRecord(b.service_json)),
      notes: b.notes ?? '',
      adminNotes: b.admin_notes ?? '',
      collectCents: collect,
      pay: confirmed ? (b.payment_method === 'onsite' && b.payment_status === 'paid' ? 'già incassata' : PAY_LABEL[b.payment_method] ?? '') : `opzione: scade il ${fmtInstant(Date.parse(b.option_expires_at), 'it')}`,
    };
  });
  const programs = db
    .prepare(`SELECT d.start_time, d.end_time, d.title, p.id AS pid, p.ref, p.name, p.company, p.participants, p.proposal_title FROM program_days d JOIN programs p ON p.id = d.program_id WHERE d.date = ? AND p.status IN ('accepted', 'confirmed') ORDER BY d.start_time`)
    .all(date)
    .map((x) => ({ start: x.start_time, end: x.end_time, title: x.title || x.proposal_title || 'Programma', ref: x.ref, id: x.pid, people: x.participants, who: x.company || x.name }));
  const blocks = db.prepare(`SELECT start_time, end_time, title, details FROM blocks WHERE date = ? AND kind = 'private' ORDER BY start_time`).all(date).map((x) => ({ start: x.start_time, end: x.end_time, title: x.title ?? 'Impegno', details: x.details ?? '' }));
  const confirmed = services.filter((s) => s.confirmed);
  return {
    date,
    services,
    programs,
    blocks,
    totals: { services: confirmed.length, people: confirmed.reduce((n, s) => n + s.people, 0), options: services.length - confirmed.length, collectCents: services.reduce((n, s) => n + s.collectCents, 0) },
  };
}
