// Pannello › Prenotazione › Modifica: la guida cambia persone, data, orario, ore e prezzo di una prenotazione (o di un'opzione).
import express from 'express';
import { AdminChangeError, evaluateAdminChange } from '../adminChanges.js';
import { getBooking } from '../bookings.js';
import { currentParams } from '../changes.js';
import { send } from '../http.js';
import { bookingEditPage, EDIT_ERRORS, editValues } from '../views/admin-booking-edit.js';
import { cleanText, parseEuros } from '../util.js';

const one = (v) => (Array.isArray(v) ? v[0] : v);

/** Il modulo (o l'indirizzo dell'anteprima) come ingresso per le regole: i campi non scritti restano quelli della prenotazione. */
export function readEdit(src) {
  const input = {};
  for (const k of ['adults', 'children', 'infants', 'pax', 'date', 'time', 'hours', 'extra']) if (one(src[k]) != null) input[k] = String(one(src[k])).trim();
  input.priceMode = one(src.priceMode) === 'custom' ? 'custom' : one(src.priceMode) === 'auto' ? 'auto' : undefined;
  if (input.priceMode === 'custom') {
    const raw = String(one(src.price) ?? '').trim();
    if (raw !== '') input.priceCents = parseEuros(raw) ?? Number.NaN; // un importo che non si capisce non vale «come adesso»
  }
  input.force = one(src.force) === '1';
  input.keepTerms = one(src.keepTerms) === '1';
  return input;
}

export function adminBookingEditRouter(app) {
  const r = express.Router();
  const { db } = app;
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  const ctxOf = (req) => ({ app, req });
  const valuesOf = (b, src) => {
    const over = Object.fromEntries(['adults', 'children', 'infants', 'pax', 'date', 'time', 'hours', 'extra', 'priceMode', 'price', 'force', 'keepTerms', 'note'].filter((k) => one(src[k]) != null).map((k) => [k, String(one(src[k]))]));
    if (over.pax != null && !['adults', 'children', 'infants'].some((k) => over[k] != null)) Object.assign(over, { adults: over.pax, children: '0', infants: '0' }); // il solo «pax» vale tante persone adulte
    return editValues(app, b, currentParams(app, b), over);
  };

  r.get('/bookings/:id/edit', (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    const asked = one(req.query.preview) === '1';
    const src = asked ? req.query : {};
    const values = { ...valuesOf(b, src), ...(asked ? { notify: one(req.query.notify) === '1' ? '1' : '' } : {}) };
    send(res, bookingEditPage(ctxOf(req), b, { values, preview: asked ? evaluateAdminChange(app, b, readEdit(req.query)) : null }));
  });

  r.post('/bookings/:id/edit', form, async (req, res, next) => {
    const b = getBooking(db, Number(req.params.id));
    if (!b) return next();
    try {
      const notify = one(req.body.notify) === '1';
      const out = await app.changes.modifyAdmin(b.id, readEdit(req.body), { note: cleanText(req.body.note, 500), notify });
      const mail = out.mailed ? '&mail=sent' : notify ? '&mail=failed' : '';
      const refund = out.refunded === false ? '&refund=pending' : out.refunded ? '&refund=done' : '';
      res.redirect(303, `/admin/bookings/${b.id}?ok=edited${mail}${refund}`);
    } catch (e) {
      if (!(e instanceof AdminChangeError)) throw e;
      const values = { ...valuesOf(b, req.body), notify: one(req.body.notify) === '1' ? '1' : '' };
      send(res, bookingEditPage(ctxOf(req), b, { values, error: `${EDIT_ERRORS[e.code === 'option' && e.reason === 'period' ? 'optionPeriod' : e.code] ?? 'Modifica non riuscita.'}${e.reason && e.reason !== 'period' ? ` (${e.reason})` : ''}` }), 400);
    }
  });

  return r;
}
