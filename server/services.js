// Orchestrazione: collega DB, pagamenti ed email.
import { BookingError, bookingDue, cancelBooking, confirmOption, confirmPaid, createBooking, expireBooking, expireHolds, expireOptions, extendOption, getBooking, getBookingByRef, markRefund, optionsDueForReminder, releaseOption } from './bookings.js';
import { notifyGuideOption, sendBookingCancelled, sendBookingConfirmed, sendOptionCreated, sendOptionExpired, sendOptionExtended, sendOptionReleased, sendOptionReminder, sendSlotLostRefund } from './emails.js';
import { resolveExtensions } from './changes.js';
import { onlinePaymentsOpen } from './opening.js';
import { fmtDate, localToInstant } from './time.js';

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
    /** Rimborsa `cents` di una prenotazione pagata con carta (e ne segna l'esito). */
    refundBooking: doRefund,

    /** Crea la sessione di pagamento per una prenotazione "held". Ritorna l'URL a cui mandare il cliente. */
    async startCheckout(booking, lang, nowMs = Date.now(), attempt = 0) {
      const tour = content.tour(booking.tour_slug);
      const ti = tour.i18n[booking.lang];
      const session = await payments.createCheckout({
        ref: booking.ref,
        email: booking.email,
        amountCents: bookingDue(booking),
        currency: booking.currency,
        title: ti.title,
        description: `${fmtDate(booking.date, booking.lang, 'short')} ${booking.start_time} · ${booking.participants}`,
        lang: booking.lang,
        successUrl: `${cfg.baseUrl}/${lang}/booking/${booking.ref}?t=${booking.token}&paid=1`,
        cancelUrl: `${cfg.baseUrl}/${lang}/booking/${booking.ref}?t=${booking.token}&canceled=1`,
        demoUrl: `${cfg.baseUrl}/pay/demo/${booking.ref}?t=${booking.token}&lang=${lang}`,
        nowMs,
        attempt,
      });
      db.prepare('UPDATE bookings SET stripe_session_id = ? WHERE id = ?').run(session.id, booking.id);
      return session.url;
    },

    /** Prenota e, se si paga con carta, prepara il pagamento. Ritorna { booking, redirect }. */
    async book(input, lang, nowMs = Date.now()) {
      const booking = createBooking(app, input, nowMs);
      if (booking.status === 'option') {
        // opzione: la data resta trattenuta senza pagare; l'agenzia conferma (o rilascia) dal suo account
        await sendOptionCreated(app, booking, nowMs);
        await notifyGuideOption(app, booking, 'created');
        return { booking, redirect: `/${lang}/booking/${booking.ref}?t=${booking.token}&new=1` };
      }
      if (booking.payment_method !== 'card') {
        await sendBookingConfirmed(app, booking, nowMs);
        return { booking, redirect: `/${lang}/booking/${booking.ref}?t=${booking.token}&new=1` };
      }
      try {
        const url = await svc.startCheckout(booking, lang, nowMs);
        return { booking: getBooking(db, booking.id), redirect: url, external: true };
      } catch (err) {
        // se Stripe non risponde non lasciamo lo slot bloccato
        expireBooking(db, booking.id);
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
          await payments.refund({ paymentIntent, cents: bookingDue(res.booking), ref: `${res.booking.ref}-dup` });
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
        await doRefund(fresh, bookingDue(fresh));
        await sendSlotLostRefund(app, getBooking(db, b.id));
      }
      return res;
    },

    /** Annulla; rimborsa se dovuto. by: 'customer' | 'admin'. Con `quiet` non manda le email. */
    async cancel(bookingId, { by, reason, refund = 'auto', quiet = false }, nowMs = Date.now()) {
      const res = cancelBooking(app, bookingId, { by, reason, refund }, nowMs);
      if (res.already) return res;
      if (res.option) {
        // un'opzione non ha incassato nulla: «annullarla» la rilascia (nessun rimborso, nessuna penale); l'agenzia lo sa se l'ha fatto la guida
        if (quiet) return res;
        if (by === 'admin') await sendOptionReleased(app, res.booking);
        else await notifyGuideOption(app, res.booking, 'released');
        return res;
      }
      let refunded = 0;
      if (res.refundCents) refunded = (await doRefund(res.booking, res.refundCents)) ? res.refundCents : 0;
      if (!quiet) await sendBookingCancelled(app, getBooking(db, bookingId), refunded); // (`quiet`: lo riassume chi chiama, per esempio l'annullo di un pacchetto)
      return { ...res, refundCents: refunded, booking: getBooking(db, bookingId) };
    },

    /**
     * L'agenzia conferma un'opzione: a fattura è subito confermata (voucher compreso); con la carta si passa al pagamento.
     * @returns {Promise<{outcome: string, booking: object, redirect?: string}>}
     */
    async confirmOption(bookingId, lang, { method = null } = {}, nowMs = Date.now()) {
      const res = confirmOption(app, bookingId, { method }, nowMs);
      if (res.outcome === 'confirmed') {
        await sendBookingConfirmed(app, res.booking, nowMs);
      } else if (res.outcome === 'pay') {
        try {
          res.redirect = await svc.startCheckout(res.booking, lang, nowMs);
          res.booking = getBooking(db, res.booking.id);
        } catch (err) {
          // se Stripe non risponde l'opzione resta com'era: si può riprovare
          expireBooking(db, res.booking.id, nowMs);
          console.error('[opzione] errore Stripe:', err.message);
          return { outcome: 'payment', booking: getBooking(db, res.booking.id) };
        }
      } else if (res.outcome === 'expired') {
        await sendOptionExpired(app, res.booking);
        await notifyGuideOption(app, res.booking, 'expired');
      }
      return res;
    },

    /** Rilascia un'opzione (la data torna libera). `by`: 'customer' (l'agenzia) | 'admin'. @returns {Promise<object|null>} */
    async releaseOption(bookingId, { by, reason }, nowMs = Date.now()) {
      const b = releaseOption(app, bookingId, { by, reason }, nowMs);
      if (!b) return null;
      if (by === 'admin') await sendOptionReleased(app, b);
      else await notifyGuideOption(app, b, 'released');
      return b;
    },

    /** La guida prolunga un'opzione di qualche giorno e avvisa l'agenzia. @returns {Promise<object|null>} */
    async extendOption(bookingId, days, nowMs = Date.now()) {
      const current = getBooking(db, bookingId);
      if (current?.group_id) {
        // le date di un pacchetto hanno una scadenza sola: si prolungano tutte insieme, con un solo avviso
        const done = await app.packages.extend(current.group_id, days, nowMs);
        if (done) resolveExtensions(db, current, Math.round(Number(days)), nowMs); // la richiesta di proroga dell'agenzia, se c'era, è esaudita
        return done ? getBooking(db, bookingId) : null;
      }
      const b = extendOption(app, bookingId, days, nowMs);
      if (b) {
        resolveExtensions(db, b, Math.round(Number(days)), nowMs);
        await sendOptionExtended(app, b);
      }
      return b;
    },

    /** Lavoro periodico: libera le opzioni scadute (avvisando agenzia e guida) e manda i promemoria di scadenza. */
    async sweepOptions(nowMs = Date.now()) {
      let n = 0;
      const expiredGroups = new Set();
      for (const b of expireOptions(db, nowMs)) {
        n++;
        if (b.group_id) {
          expiredGroups.add(b.group_id); // i servizi di un pacchetto scadono insieme: un solo avviso
          continue;
        }
        await sendOptionExpired(app, b);
        await notifyGuideOption(app, b, 'expired');
      }
      for (const id of expiredGroups) await app.packages.optionExpired(id);
      const remindedGroups = new Set();
      for (const b of optionsDueForReminder(app, nowMs)) {
        const claimed = db.prepare(`UPDATE bookings SET option_reminded_at = ? WHERE id = ? AND status = 'option' AND option_reminded_at IS NULL`).run(new Date(nowMs).toISOString(), b.id).changes;
        if (claimed !== 1) continue;
        if (b.group_id) {
          if (!remindedGroups.has(b.group_id)) {
            remindedGroups.add(b.group_id);
            await app.packages.optionReminder(b.group_id);
          }
          continue;
        }
        await sendOptionReminder(app, getBooking(db, b.id), nowMs);
      }
      return n;
    },

    /** Il cliente è tornato da Stripe prima del webhook: verifichiamo noi lo stato. */
    async syncStripe(booking) {
      return (await app.payables.sync(booking.ref)) ?? booking;
    },

    sweep(nowMs = Date.now()) {
      return expireHolds(db, nowMs);
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));
  app.jobs.push((nowMs) => svc.sweepOptions(nowMs));

  /** Prenotazione confermata ma ancora da pagare (pagamento il giorno del servizio, o prenotata prima dell'apertura degli incassi): si può pagare online dalla sua pagina. */
  const payableLater = (b, nowMs = Date.now()) => b.status === 'confirmed' && b.channel === 'b2c' && b.payment_status === 'unpaid' && b.payment_method === 'onsite' && bookingDue(b) > 0 && onlinePaymentsOpen(app, nowMs) && localToInstant(b.date, b.start_time) > nowMs;
  svc.payableLater = payableLater;

  // Le prenotazioni si pagano con lo stesso meccanismo (webhook, ripresa, pagina demo) di gift card e acconti.
  app.payables.register('booking', {
    find: (ref) => getBookingByRef(db, ref),
    dueCents: bookingDue,
    isOpen: (b) => (b.status === 'held' && Date.parse(b.hold_expires_at) > Date.now()) || payableLater(b),
    title: (b, lang) => content.tour(b.tour_slug)?.i18n[lang]?.title ?? b.ref,
    onPaid: (b, pi, nowMs) => svc.handlePaid(b.id, pi, nowMs),
    onExpired: (b) => expireBooking(db, b.id),
    startCheckout: (b, lang, nowMs, attempt) => svc.startCheckout(b, lang, nowMs, attempt),
    statusUrl: (b, lang) => `/${lang}/booking/${b.ref}?t=${b.token}`,
  });
  return svc;
}

