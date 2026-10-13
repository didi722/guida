// Buoni regalo: collega acquisto, pagamento ed email.
import { notifyGuideGift, sendGiftToBuyer, sendGiftToRecipient } from './emails.js';
import { GiftError, activateGift, claimDelivery, createAdminGift, createGiftOrder, getGift, getGiftByRef, giftsDueForDelivery, voidAbandonedGifts } from './gifts.js';
import { normLang, pick } from './langs.js';

// Nome del prodotto per Stripe e per la pagina di pagamento, nella lingua del cliente
const PRODUCT = { it: 'Buono regalo', en: 'Gift card', es: 'Tarjeta regalo', ja: 'ギフトカード' };

export function createGiftServices(app) {
  const { db, cfg, payments } = app;

  const svc = {
    /** Può pagare online chi ha Stripe configurato (o la modalità demo in sviluppo). */
    get available() {
      return payments.live || payments.demo;
    },

    async startCheckout(card, lang, nowMs = Date.now(), attempt = 0) {
      const cardLang = normLang(card.lang);
      const product = pick(PRODUCT, cardLang);
      const session = await payments.createCheckout({
        ref: card.ref,
        email: card.buyer_email,
        amountCents: card.initial_cents,
        currency: card.currency,
        title: `${product} — ${cfg.site.name}`,
        description: card.recipient_name ? `${product} · ${card.recipient_name}` : product,
        lang: cardLang,
        successUrl: `${cfg.baseUrl}/${lang}/gift/${card.ref}?t=${card.token}&paid=1`,
        cancelUrl: `${cfg.baseUrl}/${lang}/gift/${card.ref}?t=${card.token}&canceled=1`,
        demoUrl: `${cfg.baseUrl}/pay/demo/${card.ref}?t=${card.token}&lang=${lang}`,
        nowMs,
        attempt,
      });
      db.prepare('UPDATE gift_cards SET stripe_session_id = ? WHERE id = ?').run(session.id, card.id);
      return session.url;
    },

    /** Crea l'ordine e prepara il pagamento. Ritorna { card, redirect }. */
    async buy(input, lang, nowMs = Date.now()) {
      if (!svc.available) throw new GiftError('payment', 'payments unavailable');
      const card = createGiftOrder(app, input, nowMs);
      try {
        return { card: getGift(db, card.id), redirect: await svc.startCheckout(card, lang, nowMs) };
      } catch (err) {
        db.prepare(`UPDATE gift_cards SET status = 'void' WHERE id = ? AND status = 'pending'`).run(card.id);
        console.error('[gift] errore Stripe:', err.message);
        throw new GiftError('payment', 'checkout failed');
      }
    },

    /** Pagamento ricevuto (webhook, ritorno da Stripe, demo). */
    async handlePaid(id, paymentIntent = null, nowMs = Date.now()) {
      const res = activateGift(app, id, paymentIntent, nowMs);
      if (res.outcome === 'activated') {
        await svc.deliverDue(nowMs); // se la data di consegna è già arrivata, parte subito
        await sendGiftToBuyer(app, getGift(db, id));
        await notifyGuideGift(app, getGift(db, id));
      } else if (res.outcome === 'void' && paymentIntent) {
        // il buono era stato annullato prima del pagamento: rimborsiamo
        try {
          await payments.refund({ paymentIntent, cents: res.card.initial_cents, ref: res.card.ref });
        } catch (err) {
          console.error(`[gift] rimborso di ${res.card.ref} fallito:`, err.message);
        }
      }
      return res;
    },

    /** Invia al destinatario (una sola volta). */
    async deliver(card, nowMs = Date.now(), { toRecipient = true } = {}) {
      if (!toRecipient || !card.recipient_email || !card.deliver_on) return false;
      if (!claimDelivery(db, card.id, nowMs)) return false;
      const ok = await sendGiftToRecipient(app, getGift(db, card.id));
      if (!ok) db.prepare('UPDATE gift_cards SET delivered_at = NULL WHERE id = ?').run(card.id); // riprova al prossimo giro
      return ok;
    },

    /** Consegna i buoni la cui data è arrivata. */
    async deliverDue(nowMs = Date.now()) {
      let n = 0;
      for (const card of giftsDueForDelivery(db, nowMs)) if (await svc.deliver(card, nowMs)) n++;
      return n;
    },

    /** Buono creato dall'admin. notify: 'none' | 'buyer' | 'recipient' */
    async createByAdmin(input, { notify = 'none' } = {}, nowMs = Date.now()) {
      const card = createAdminGift(app, input, nowMs);
      if (notify === 'buyer') await sendGiftToBuyer(app, card);
      if (notify === 'recipient' && card.recipient_email) {
        db.prepare('UPDATE gift_cards SET deliver_on = COALESCE(deliver_on, ?) WHERE id = ?').run(new Date(nowMs).toISOString().slice(0, 10), card.id);
        await svc.deliver(getGift(db, card.id), nowMs);
      }
      return getGift(db, card.id);
    },

    async sweep(nowMs = Date.now()) {
      voidAbandonedGifts(db, nowMs);
      return svc.deliverDue(nowMs);
    },
  };

  app.jobs.push((nowMs) => svc.sweep(nowMs));

  app.payables.register('gift', {
    find: (ref) => getGiftByRef(db, ref),
    dueCents: (c) => c.initial_cents,
    isOpen: (c) => c.status === 'pending',
    title: (c, lang) => pick(PRODUCT, normLang(lang)),
    onPaid: (c, pi, nowMs) => svc.handlePaid(c.id, pi, nowMs),
    onExpired: () => {}, // l'ordine resta in attesa: il cliente può riprovare dal link
    startCheckout: (c, lang, nowMs, attempt) => svc.startCheckout(c, lang, nowMs, attempt),
    statusUrl: (c, lang) => `/${lang}/gift/${c.ref}?t=${c.token}`,
  });
  return svc;
}
