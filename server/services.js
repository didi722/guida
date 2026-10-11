// Orchestrazione: collega DB, pagamenti ed email.
import { BookingError, cancelBooking, confirmPaid, createBooking, expireHolds, getBooking, markRefund } from './bookings.js';
import { sendBookingCancelled, sendBookingConfirmed, sendSlotLostRefund } from './emails.js';
import { fmtDate } from './time.js';

export function createServices(app) {
  const { db, cfg, content, payments } = app;

  async function doRefund(b, cents) {
    try {
      if (b.payment_method === 'card' && b.stripe_payment_intent) await payments.refund({ paymentIntent: b.stripe_payment_intent, cents, ref: b.ref });
      markRefund(db, b.id, { ok: true, cents });
      return true;
    } catch (err) {
      console.error(`[rimborso] ${b.ref} fallito:`, err.message);
      markRefund(db, b.id, { ok: false });
      return false;
    }
  }

  const svc = {
    /** Crea la sessione di pagamento per una prenotazione "held". Ritorna l'URL a cui mandare il cliente. */
    async startCheckout(booking, lang, nowMs = Date.now(), attempt = 0) {
      const tour = content.tour(booking.tour_slug);
      const ti = tour.i18n[booking.lang];
      const session = await payments.createCheckout({
        booking,
        title: ti.title,
        description: `${fmtDate(booking.date, booking.lang, 'short')} ${booking.start_time} · ${booking.participants}`,
        lang: booking.lang,
        successUrl: `${cfg.baseUrl}/${lang}/booking/${booking.ref}?t=${booking.token}&paid=1`,
        cancelUrl: `${cfg.baseUrl}/${lang}/booking/${booking.ref}?t=${booking.token}&canceled=1`,
        nowMs,
        attempt,
      });
      db.prepare('UPDATE bookings SET stripe_session_id = ? WHERE id = ?').run(session.id, booking.id);
      return session.url;
    },

    /** Prenota e, se si paga con carta, prepara il pagamento. Ritorna { booking, redirect }. */
    async book(input, lang, nowMs = Date.now()) {
      const booking = createBooking(app, input, nowMs);
      if (booking.payment_method !== 'card') {
        await sendBookingConfirmed(app, booking, nowMs);
        return { booking, redirect: `/${lang}/booking/${booking.ref}?t=${booking.token}&new=1` };
      }
      try {
        const url = await svc.startCheckout(booking, lang, nowMs);
        return { booking: getBooking(db, booking.id), redirect: url, external: true };
      } catch (err) {
        // se Stripe non risponde non lasciamo lo slot bloccato
        db.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ?`).run(booking.id);
        console.error('[checkout] errore Stripe:', err.message);
        throw new BookingError('payment', 'checkout failed');
      }
    },

    /** Da chiamare quando si sa che il pagamento è andato a buon fine (webhook, ritorno da Stripe, demo). */
    async handlePaid(bookingId, paymentIntent = null, nowMs = Date.now()) {
      const res = confirmPaid(app, bookingId, paymentIntent, nowMs);
      if (res.outcome === 'already' && paymentIntent && res.booking.stripe_payment_intent && paymentIntent !== res.booking.stripe_payment_intent) {
        // doppio pagamento (es. due sessioni aperte): rimborsiamo il secondo
        try {
          await payments.refund({ paymentIntent, cents: res.booking.total_cents, ref: `${res.booking.ref}-dup` });
        } catch (err) {
          console.error(`[rimborso doppio pagamento] ${res.booking.ref}:`, err.message);
        }
      }
      if (res.outcome === 'confirmed') {
        await sendBookingConfirmed(app, res.booking, nowMs);
      } else if (res.outcome === 'conflict' || res.outcome === 'cancelled') {
        // il cliente ha pagato ma lo slot non c'è più: rimborso completo
        const b = res.booking;
        db.prepare(`UPDATE bookings SET payment_status = 'paid', status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', cancel_reason = 'slot non più disponibile al momento del pagamento', stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?`).run(
          new Date(nowMs).toISOString(),
          paymentIntent,
          b.id,
        );
        const fresh = getBooking(db, b.id);
        await doRefund(fresh, fresh.total_cents);
        await sendSlotLostRefund(app, getBooking(db, b.id));
      }
      return res;
    },

    /** Annulla; rimborsa se dovuto. by: 'customer' | 'admin'. */
    async cancel(bookingId, { by, reason, refund = 'auto' }, nowMs = Date.now()) {
      const res = cancelBooking(app, bookingId, { by, reason, refund }, nowMs);
      if (res.already) return res;
      let refunded = 0;
      if (res.refundCents) refunded = (await doRefund(res.booking, res.refundCents)) ? res.refundCents : 0;
      await sendBookingCancelled(app, getBooking(db, bookingId), refunded);
      return { ...res, refundCents: refunded, booking: getBooking(db, bookingId) };
    },

    /** Il cliente è tornato da Stripe prima del webhook: verifichiamo noi lo stato. */
    async syncStripe(booking) {
      if (booking.status !== 'held' || !booking.stripe_session_id || !payments.live) return booking;
      try {
        const s = await payments.retrieveSession(booking.stripe_session_id);
        if (s.payment_status === 'paid') await svc.handlePaid(booking.id, typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id);
        else if (s.status === 'expired') db.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'held'`).run(booking.id);
      } catch (err) {
        console.error('[stripe] verifica sessione fallita:', err.message);
      }
      return getBooking(db, booking.id);
    },

    sweep(nowMs = Date.now()) {
      return expireHolds(db, nowMs);
    },
  };
  return svc;
}

