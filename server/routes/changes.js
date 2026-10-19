// Modifica autonoma di persone, data e ore di una prenotazione (area agenzie) e richiesta di proroga di un'opzione (dal link, anche del pacchetto).
import express from 'express';
import { getBookingByRef } from '../bookings.js';
import { ChangeError, changeRules, changeSlots } from '../changes.js';
import { send, tooMany } from '../http.js';
import { getPackageByRef, packageBookings } from '../packages.js';
import { isDate, isTime } from '../time.js';
import { safeEqual } from '../util.js';
import { changePage } from '../views/changes.js';
import { needPartner, safeNext } from './guards.js';

const intOr = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : undefined;
};
const numOr = (v) => {
  const n = Number(v);
  return v !== '' && v != null && Number.isFinite(n) ? n : undefined;
};
/** Dal modulo ai soli campi che si possono cambiare (quelli non validi o assenti restano come sono). Le persone: adulti, bambini e infanti, oppure solo `pax` (tutte adulte). */
const readChange = (src = {}) => {
  const out = { date: isDate(src.date) ? src.date : undefined, time: isTime(src.time) ? src.time : undefined, hours: numOr(src.hours), extra: numOr(src.extra) };
  if (['adults', 'children', 'infants'].some((k) => src[k] != null && src[k] !== '')) Object.assign(out, { adults: String(src.adults ?? ''), children: String(src.children ?? ''), infants: String(src.infants ?? '') });
  else out.pax = intOr(src.pax);
  return out;
};

export function changesRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '50kb' });
  const ip = (req) => req.ip ?? 'ip';

  r.use(['/b2b/bookings'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  /** La prenotazione indicata nell'URL, solo se è di questa agenzia. */
  const own = (req) => {
    const b = getBookingByRef(db, req.params.ref);
    return b && b.account_id === req.acct.id ? b : null;
  };

  // ───── cambia persone, data o ore ─────
  const show = (req, res, b, input, { error = '', reason = '', status = 200 } = {}) => {
    const rules = changeRules(app, b);
    send(res, changePage(res.locals.ctx, b, { rules, form: input, slots: rules.allowed ? changeSlots(app, b, input) : [], error, errorReason: reason }), status);
  };

  r.get('/b2b/bookings/:ref/change', needPartner, (req, res, next) => {
    const b = own(req);
    if (!b) return next();
    show(req, res, b, readChange(req.query));
  });

  r.post('/b2b/bookings/:ref/change', needPartner, form, async (req, res, next) => {
    const b = own(req);
    if (!b) return next();
    if (!app.limits.booking(ip(req))) return tooMany(res);
    const input = readChange(req.body);
    try {
      await app.changes.modify(b.id, input, { by: 'customer' });
    } catch (e) {
      if (!(e instanceof ChangeError)) throw e;
      return show(req, res, getBookingByRef(db, b.ref), input, { error: e.code, reason: e.reason ?? '', status: e.code === 'unavailable' ? 409 : 400 });
    }
    res.redirect(303, `/${req.lang}/b2b/bookings/${b.ref}?flash=changed`);
  });

  // ───── «Chiedi una proroga» (con il link della prenotazione o del pacchetto) ─────
  const back = (req, url, flash) => {
    const next = safeNext(req.body?.next);
    return next ? `${next}${next.includes('?') ? '&' : '?'}flash=${flash}` : `${url}&flash=${flash}`;
  };
  const request = async (req, res, b, url) => {
    if (!app.limits.booking(ip(req))) return tooMany(res);
    try {
      await app.changes.requestExtension(b.id, { days: req.body.days, note: req.body.note });
      res.redirect(303, back(req, url, 'extension-sent'));
    } catch (e) {
      if (!(e instanceof ChangeError)) throw e;
      res.redirect(303, back(req, url, 'extension-error'));
    }
  };

  r.post('/booking/:ref/option/extend-request', form, async (req, res, next) => {
    const b = getBookingByRef(db, req.params.ref);
    const token = String(req.body?.t ?? '');
    if (!b || !token || !safeEqual(token, b.token) || b.status !== 'option') return next();
    await request(req, res, b, `/${req.lang}/booking/${b.ref}?t=${b.token}`);
  });

  r.post('/packages/:ref/extend-request', form, async (req, res, next) => {
    const g = getPackageByRef(db, req.params.ref);
    const token = String(req.body?.t ?? '');
    if (!g || !token || !safeEqual(token, g.token)) return next();
    const line = packageBookings(db, g.id).find((x) => x.status === 'option');
    if (!line) return res.redirect(303, back(req, `/${req.lang}/packages/${g.ref}?t=${g.token}`, 'extension-error'));
    await request(req, res, line, `/${req.lang}/packages/${g.ref}?t=${g.token}`);
  });

  return r;
}
