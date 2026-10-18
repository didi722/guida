// Modifiche dell'agenzia e richieste di proroga: collega regole, database ed email.
import { getBooking } from './bookings.js';
import { ChangeError, denyExtension, modifyBooking, requestExtension } from './changes.js';
import { notifyGuideBookingChanged, notifyGuideExtensionRequest, sendBookingChanged, sendExtensionDenied } from './emails.js';

export function createChangeServices(app) {
  const { db } = app;
  return {
    /** L'agenzia cambia persone, data od ore: si applica, e si avvisano agenzia (con voucher e calendario nuovi) e guida. */
    async modify(bookingId, input, { by = 'customer' } = {}, nowMs = Date.now()) {
      const res = modifyBooking(app, bookingId, input, { by }, nowMs);
      await sendBookingChanged(app, res.before, res.after, nowMs);
      await notifyGuideBookingChanged(app, res.before, res.after);
      return res;
    },

    /** L'agenzia chiede più tempo per un'opzione: la guida riceve la richiesta e decide dal pannello. */
    async requestExtension(bookingId, { days, note }, nowMs = Date.now()) {
      const b = getBooking(db, bookingId);
      if (!b) throw new ChangeError('invalid');
      const request = requestExtension(app, b, { days, note }, nowMs);
      await notifyGuideExtensionRequest(app, b, request);
      return request;
    },

    /** La guida concede la proroga (i giorni li sceglie lei): prolunga (tutto il pacchetto, se c'è) e avvisa l'agenzia. @returns {Promise<boolean>} */
    async approveExtension(requestId, days, nowMs = Date.now()) {
      const r = db.prepare(`SELECT * FROM extension_requests WHERE id = ? AND status = 'pending'`).get(requestId);
      if (!r) return false;
      return !!(await app.services.extendOption(r.booking_id, days ?? r.days, nowMs)); // chiude anche la richiesta (vedi services.extendOption)
    },

    /** La guida non concede la proroga: l'agenzia lo sa e la scadenza resta quella. @returns {Promise<boolean>} */
    async denyExtension(requestId, nowMs = Date.now()) {
      const r = denyExtension(db, requestId, nowMs);
      if (!r) return false;
      await sendExtensionDenied(app, getBooking(db, r.booking_id));
      return true;
    },
  };
}
