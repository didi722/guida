// Pacchetti: collega prenotazione, pagamento ed email.
import { bookingDue, cancellationState, confirmPaid, expireBooking, extendOption, markRefund } from './bookings.js';
import { tx } from './db.js';
import { notifyGuidePackage, sendPackageCancelled, sendPackageConfirmed, sendPackageOptionCreated, sendPackageOptionExpired, sendPackageOptionExtended, sendPackageOptionReminder, sendPackageSlotLost } from './emails.js';
import { makeT } from './i18n.js';
import { normLang } from './langs.js';
import { onlinePaymentsOpen } from './opening.js';
import { PackageError, confirmPackage, createPackage, getPackage, getPackageByRef, packageBookings, payableLines, releasePackage, setCardDue } from './packages.js';

class Conflict extends Error {}

export function createPackageServices(app) {
  const { db, cfg, payments } = app;
  const pagePath = (group, lang) => `/${lang}/packages/${group.ref}?t=${group.token}`;
  const confirmedOf = (bookings) => bookings.filter((b) => b.status === 'confirmed');

  const svc = {
    /** La pagina del pacchetto (per chi ha il link). */
    pagePath,

    /** Crea la sessione di pagamento con carta per ciò che il pacchetto deve ancora (una sola, per tutti i servizi). Ritorna l'URL a cui mandare l'agenzia. */
    async startCheckout(group, lang, nowMs = Date.now(), attempt = 0) {
      const lines = payableLines(db, group.id, nowMs);
      if (!lines.length) throw new Error('nulla da pagare');
      setCardDue(db, group.id, lines);
      const fresh = getPackage(db, group.id);
      const glang = normLang(group.lang);
      const session = await payments.createCheckout({
        ref: group.ref,
        email: group.email,
        amountCents: fresh.due_cents,
        currency: group.currency,
        title: makeT(glang)('pkg.payTitle', { n: lines.length }),
        description: group.client_ref ? `${group.ref} · ${group.client_ref}` : group.ref,
        lang: glang,
        successUrl: `${cfg.baseUrl}${pagePath(group, lang)}&paid=1`,
        cancelUrl: `${cfg.baseUrl}${pagePath(group, lang)}&canceled=1`,
        demoUrl: `${cfg.baseUrl}/pay/demo/${group.ref}?t=${group.token}&lang=${lang}`,
        nowMs,
        attempt,
      });
      db.prepare('UPDATE booking_groups SET stripe_session_id = ? WHERE id = ?').run(session.id, group.id);
      return session.url;
    },

    /**
     * Prenota il pacchetto (tutti i servizi o nessuno). Con la carta prepara un solo pagamento.
     * @returns {Promise<{group: object, bookings: object[], redirect: string, external?: boolean}>}
     */
    async book(account, lines, common, lang, nowMs = Date.now()) {
      const { group, bookings } = createPackage(app, account, lines, common, nowMs);
      if (common.option) {
        await sendPackageOptionCreated(app, group, bookings);
        await notifyGuidePackage(app, group, bookings, 'option');
        return { group, bookings, redirect: `${pagePath(group, lang)}&new=1` };
      }
      const confirmed = confirmedOf(bookings);
      if (confirmed.length) {
        await sendPackageConfirmed(app, group, confirmed, nowMs); // a fattura (o senza nulla da pagare): confermato subito
        await notifyGuidePackage(app, group, confirmed, 'new');
      }
      const held = bookings.filter((b) => b.status === 'held');
      if (!held.length) return { group, bookings, redirect: `${pagePath(group, lang)}&new=1` };
      try {
        const url = await svc.startCheckout(group, lang, nowMs);
        return { group: getPackage(db, group.id), bookings: packageBookings(db, group.id), redirect: url, external: true };
      } catch (err) {
        for (const b of held) expireBooking(db, b.id, nowMs); // se Stripe non risponde non lasciamo le date bloccate
        console.error('[pacchetto] errore Stripe:', err.message);
        throw new PackageError('payment', 'checkout failed');
      }
    },

    /**
     * L'agenzia conferma l'opzione dell'intero pacchetto: a fattura è subito confermato (voucher compresi); con la carta si passa al pagamento.
     * @returns {Promise<{outcome: string, bookings: object[], redirect?: string}>}
     */
    async confirm(groupId, lang, { method = null } = {}, nowMs = Date.now()) {
      const res = confirmPackage(app, groupId, { method }, nowMs);
      const group = getPackage(db, groupId);
      if (res.outcome === 'confirmed') {
        const confirmed = confirmedOf(res.bookings);
        await sendPackageConfirmed(app, group, confirmed, nowMs);
        await notifyGuidePackage(app, group, confirmed, 'new');
      } else if (res.outcome === 'pay') {
        try {
          res.redirect = await svc.startCheckout(group, lang, nowMs);
        } catch (err) {
          // se Stripe non risponde il pacchetto resta com'era (in opzione): si può riprovare
          for (const b of payableLines(db, groupId, nowMs)) expireBooking(db, b.id, nowMs);
          console.error('[pacchetto] errore Stripe:', err.message);
          return { outcome: 'payment', bookings: packageBookings(db, groupId) };
        }
      }
      return res;
    },

    /** Rilascia i servizi ancora in opzione (le date tornano libere). `by`: 'customer' (l'agenzia) | 'admin'. @returns {Promise<object[]>} */
    async release(groupId, { by, reason }, nowMs = Date.now()) {
      const released = releasePackage(app, groupId, { by, reason }, nowMs);
      if (released.length && by !== 'admin') await notifyGuidePackage(app, getPackage(db, groupId), released, 'released');
      return released;
    },

    /** Prolunga l'opzione di tutti i servizi del pacchetto (stessa scadenza per tutti) e avvisa l'agenzia. @returns {Promise<object[]|null>} */
    async extend(groupId, days, nowMs = Date.now()) {
      const ids = db.prepare(`SELECT id FROM bookings WHERE group_id = ? AND status = 'option'`).all(groupId).map((r) => r.id);
      const done = tx(db, () => ids.map((id) => extendOption(app, id, days, nowMs)).filter(Boolean));
      if (!done.length) return null;
      await sendPackageOptionExtended(app, getPackage(db, groupId), done);
      return done;
    },

    /**
     * Annulla i servizi confermati del pacchetto per cui c'è ancora qualcosa da rimborsare, con un solo riepilogo all'agenzia.
     * Quelli oltre il termine non si annullano da qui (si scrive alla guida).
     * @returns {Promise<{cancelled: number, kept: number, results: object[]}>}
     */
    async cancel(groupId, { by = 'customer' } = {}, nowMs = Date.now()) {
      const bookings = packageBookings(db, groupId);
      const results = [];
      for (const b of bookings.filter((x) => x.status === 'confirmed' && cancellationState(x, nowMs).percent > 0)) results.push(await app.services.cancel(b.id, { by, quiet: true }, nowMs));
      const done = results.filter((r) => !r.already);
      const group = getPackage(db, groupId);
      if (done.length) {
        await sendPackageCancelled(app, group, done);
        await notifyGuidePackage(app, group, done.map((r) => r.booking), 'cancelled');
      }
      const kept = packageBookings(db, groupId).filter((b) => b.status === 'confirmed').length;
      return { cancelled: done.length, kept, results: done };
    },

    /** Pagamento ricevuto (webhook, ritorno da Stripe, demo): conferma tutti i servizi pagati, o nessuno se uno non c'è più (e rimborsa tutto). */
    async handlePaid(groupId, paymentIntent = null, nowMs = Date.now()) {
      const group = getPackage(db, groupId);
      const lines = payableLines(db, groupId, nowMs, { late: true });
      if (!lines.length) {
        // già tutto pagato: un secondo pagamento (due sessioni aperte) va rimborsato
        if (paymentIntent && group.stripe_payment_intent && paymentIntent !== group.stripe_payment_intent && group.due_cents > 0) {
          try {
            await payments.refund({ paymentIntent, cents: group.due_cents, ref: `${group.ref}-dup` });
          } catch (err) {
            console.error(`[rimborso doppio pagamento] ${group.ref}:`, err.message);
          }
        }
        return { outcome: 'already', bookings: packageBookings(db, groupId) };
      }
      let results;
      try {
        results = tx(db, () =>
          lines.map((l) => {
            const res = confirmPaid(app, l.id, paymentIntent, nowMs);
            if (res.outcome === 'conflict' || res.outcome === 'cancelled') throw Object.assign(new Conflict(), { res });
            return res;
          }),
        );
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        // un servizio non c'è più: il pacchetto non si conferma a metà, si rimborsa l'intero importo pagato
        const now = new Date(nowMs).toISOString();
        const dropped = lines.filter((l) => l.status === 'held' || l.status === 'expired'); // (i servizi già confermati a fattura restano com'erano)
        for (const l of dropped) {
          db.prepare(`UPDATE bookings SET payment_status = 'paid', status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', cancel_reason = 'slot non più disponibile al momento del pagamento', stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?`).run(now, paymentIntent, l.id);
        }
        let refunded = true;
        if (paymentIntent) {
          try {
            await payments.refund({ paymentIntent, cents: group.due_cents, ref: group.ref });
          } catch (err) {
            refunded = false;
            console.error(`[pacchetto] rimborso ${group.ref} fallito:`, err.message);
          }
        }
        for (const l of dropped) markRefund(db, l.id, { ok: refunded, cents: bookingDue(l) });
        const lost = packageBookings(db, groupId).filter((b) => dropped.some((l) => l.id === b.id));
        await sendPackageSlotLost(app, group, lost);
        await notifyGuidePackage(app, group, lost, 'cancelled', 'Pagamento tardivo: un servizio non era più disponibile, rimborsato tutto.');
        return { outcome: 'conflict', bookings: packageBookings(db, groupId) };
      }
      db.prepare('UPDATE booking_groups SET stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?').run(paymentIntent, groupId);
      const now = packageBookings(db, groupId);
      const covered = lines.reduce((s, l) => s + bookingDue(l), 0);
      if (paymentIntent && group.due_cents > covered) {
        // nel frattempo un servizio è stato tolto: si restituisce la differenza
        try {
          await payments.refund({ paymentIntent, cents: group.due_cents - covered, ref: `${group.ref}-diff` });
        } catch (err) {
          console.error(`[pacchetto] rimborso differenza ${group.ref} fallito:`, err.message);
        }
      }
      const newlyConfirmed = results.filter((r) => r.outcome === 'confirmed').map((r) => r.booking.id);
      if (newlyConfirmed.length) {
        await sendPackageConfirmed(app, group, now.filter((b) => newlyConfirmed.includes(b.id)), nowMs);
        await notifyGuidePackage(app, group, now.filter((b) => newlyConfirmed.includes(b.id)), 'new');
      }
      return { outcome: 'paid', bookings: now };
    },

    /** Opzioni scadute senza conferma (da `sweepOptions`): un solo avviso per pacchetto, all'agenzia e alla guida. */
    async optionExpired(groupId) {
      const group = getPackage(db, groupId);
      const lines = packageBookings(db, groupId).filter((b) => b.status === 'expired' && b.option_expires_at);
      if (!lines.length) return;
      await sendPackageOptionExpired(app, group, lines);
      await notifyGuidePackage(app, group, lines, 'expired');
    },

    /** Promemoria di scadenza (da `sweepOptions`): un solo messaggio per pacchetto. */
    async optionReminder(groupId) {
      const lines = packageBookings(db, groupId).filter((b) => b.status === 'option');
      if (lines.length) await sendPackageOptionReminder(app, getPackage(db, groupId), lines);
    },
  };

  // I pacchetti si pagano con lo stesso meccanismo (webhook, ripresa, pagina demo) di prenotazioni, gift card e acconti.
  app.payables.register('group', {
    find: (ref) => getPackageByRef(db, ref),
    dueCents: (g) => g.due_cents,
    isOpen: (g) => payableLines(db, g.id).some((b) => b.status === 'held' || onlinePaymentsOpen(app)),
    title: (g, lang) => makeT(lang)('pkg.payTitle', { n: payableLines(db, g.id).length || packageBookings(db, g.id).length }),
    onPaid: (g, pi, nowMs) => svc.handlePaid(g.id, pi, nowMs),
    onExpired: (g) => {
      for (const b of payableLines(db, g.id).filter((x) => x.status === 'held')) expireBooking(db, b.id);
    },
    startCheckout: (g, lang, nowMs, attempt) => svc.startCheckout(g, lang, nowMs, attempt),
    statusUrl: (g, lang) => pagePath(g, lang),
  });
  return svc;
}
