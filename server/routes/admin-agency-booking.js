// Prenotazione fatta da un'agenzia fuori dal sito (telefono, email, di persona): la registri tu, con il prezzo concordato.
// Compare nell'agenda, nelle prenotazioni dell'agenzia e nelle fatture, come se l'avesse fatta online.
import crypto from 'node:crypto';
import express from 'express';
import { BookingError, createBooking } from '../bookings.js';
import { hashPassword } from '../auth.js';
import { sendBookingConfirmed } from '../emails.js';
import { agencyBookingDonePage, agencyBookingPage } from '../views/admin-agency-booking.js';
import { send } from '../http.js';
import { emailInUse } from '../team.js';
import { isDate, isTime, nowRome } from '../time.js';
import { cleanText, isEmail, parseEuros } from '../util.js';

const ERRORS = {
  tour: 'Scegli un servizio per le agenzie.',
  datetime: 'Controlla data e orario.',
  participants: 'Il numero di persone non è valido per questo servizio.',
  price: 'Il prezzo non è valido (scrivi un importo in euro, per esempio 350 o 350,50).',
  agency: 'Scegli un’agenzia, oppure scegli «Nuova agenzia» e compila i suoi dati.',
  newAgency: 'Per una nuova agenzia servono nome, referente e un’email valida.',
  exists: 'Esiste già un’agenzia con questa email: sceglila dall’elenco.',
  hours: 'Per questo servizio indica quante ore (da 4 a 8 per il tour leader, in mezze ore).',
};

export function adminAgencyBookingRouter(app) {
  const r = express.Router();
  const { db, content } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ctxOf = (req) => ({ app, req });
  const agencies = () => db.prepare("SELECT id, company, contact_name, email, discount_percent FROM accounts WHERE status = 'approved' ORDER BY company COLLATE NOCASE").all();
  const tours = () => content.tours.filter((x) => x.active && x.audience === 'b2b');
  const page = (req, res, values = {}, error = '', status = 200) =>
    send(res, agencyBookingPage(ctxOf(req), { agencies: agencies(), tours: tours(), values, error, today: nowRome(Date.now()).date }), status);

  r.get('/agenda/agency', (req, res) => page(req, res, { date: isDate(req.query.date) ? req.query.date : '', agency: String(req.query.agency ?? '') }));

  r.post('/agenda/agency', form, async (req, res) => {
    const b = req.body;
    const v = { ...b };
    const fail = (key) => page(req, res, v, ERRORS[key] ?? key, 400);
    const tour = tours().find((x) => x.slug === String(b.tour ?? ''));
    if (!tour) return fail('tour');
    if (!isDate(b.date) || !isTime(b.time)) return fail('datetime');
    const pax = Number.parseInt(b.pax, 10);
    const price = String(b.price ?? '').trim() === '' ? null : parseEuros(b.price);
    if (String(b.price ?? '').trim() !== '' && (price === null || price < 0)) return fail('price');

    // l'agenzia: una già registrata, oppure una nuova (account approvato, con una password provvisoria da comunicarle)
    let account;
    let tempPassword = null;
    if (b.agency === 'new') {
      const company = cleanText(b.company, 160);
      const contact = cleanText(b.contact_name, 120);
      const email = cleanText(b.email, 200).toLowerCase();
      if (!company || !contact || !isEmail(email)) return fail('newAgency');
      if (emailInUse(db, email)) return fail('exists');
      tempPassword = crypto.randomBytes(9).toString('base64url');
      const discount = Math.min(100, Math.max(0, Number(String(b.discount ?? '0').replace(',', '.')) || 0));
      const info = db
        .prepare("INSERT INTO accounts(email, password_hash, company, vat, country, contact_name, phone, lang, status, discount_percent, allow_invoice, created_at, approved_at) VALUES(?,?,?,?,?,?,?,?, 'approved', ?, 1, ?, ?)")
        .run(email, await hashPassword(tempPassword), company, cleanText(b.vat, 40) || null, 'IT', contact, cleanText(b.phone, 40) || null, 'it', discount, new Date().toISOString(), new Date().toISOString());
      account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(info.lastInsertRowid));
    } else {
      account = db.prepare("SELECT * FROM accounts WHERE id = ? AND status = 'approved'").get(Number(b.agency));
      if (!account) return fail('agency');
    }

    try {
      const booking = createBooking(app, {
        tourSlug: tour.slug, date: b.date, time: b.time, pax, hours: b.hours === '' || b.hours == null ? null : Number(b.hours),
        channel: 'b2b', account, name: account.contact_name, email: account.email, phone: account.phone, lang: account.lang,
        clientRef: cleanText(b.clientRef, 120), notes: cleanText(b.notes, 1000),
        manual: { totalCents: price, paid: b.paid === '1' },
      });
      if (b.sendMail === '1') await sendBookingConfirmed(app, booking);
      send(res, agencyBookingDonePage(ctxOf(req), { booking, account, tour, tempPassword, mailed: b.sendMail === '1' }));
    } catch (e) {
      if (!(e instanceof BookingError)) throw e;
      if (tempPassword) db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id); // la nuova agenzia non si crea se la prenotazione non va a buon fine
      return fail(e.message.startsWith('hours') ? 'hours' : e.code === 'invalid' && e.message === 'participants' ? 'participants' : ERRORS[e.message] ? e.message : `Prenotazione non registrata (${e.message}).`);
    }
  });
  return r;
}
