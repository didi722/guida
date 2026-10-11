// Pagamenti con Stripe Checkout (chiamate HTTP dirette, nessun SDK) + modalità demo.
import crypto from 'node:crypto';

const API = 'https://api.stripe.com/v1';

export function createPayments(cfg, fetchImpl = globalThis.fetch) {
  const key = cfg.stripe.secretKey;
  const live = !!key;

  async function call(method, path, params = {}, idempotencyKey) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetchImpl(API + path + (method === 'GET' && qs ? `?${qs}` : ''), {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: method === 'GET' ? undefined : qs,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Stripe ${res.status}: ${json.error?.message ?? 'errore sconosciuto'}`);
    return json;
  }

  return {
    live,
    demo: !live && cfg.demoPayments,

    /**
     * Crea la sessione di pagamento e restituisce { id, url }.
     * `ref` identifica l'ordine (VE-… prenotazione, GC-… gift card, PR-… acconto programma);
     * `demoUrl` è la pagina di pagamento simulata usata quando non c'è Stripe.
     */
    async createCheckout({ ref, email, amountCents, currency = 'EUR', title, description, lang, successUrl, cancelUrl, demoUrl, nowMs = Date.now(), attempt = 0 }) {
      if (!live) {
        if (!cfg.demoPayments) throw new Error('Pagamenti con carta non configurati');
        return { id: `demo_${ref}`, url: demoUrl };
      }
      const s = await call(
        'POST',
        '/checkout/sessions',
        {
          mode: 'payment',
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': currency.toLowerCase(),
          'line_items[0][price_data][unit_amount]': String(amountCents),
          'line_items[0][price_data][product_data][name]': title,
          'line_items[0][price_data][product_data][description]': description,
          client_reference_id: ref,
          customer_email: email,
          'metadata[ref]': ref,
          'payment_intent_data[description]': `${ref} — ${title}`,
          'payment_intent_data[metadata][ref]': ref,
          success_url: successUrl,
          cancel_url: cancelUrl,
          locale: lang === 'it' ? 'it' : 'en',
          // Stripe richiede almeno 30 minuti: la sessione scade poco prima della "hold" interna
          expires_at: String(Math.floor(nowMs / 1000) + 31 * 60),
        },
        `checkout-${ref}-${attempt}`,
      );
      return { id: s.id, url: s.url };
    },

    async retrieveSession(id) {
      return call('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
    },

    async refund({ paymentIntent, cents, ref }) {
      if (!live) return { id: `demo_refund_${ref}`, demo: true };
      return call('POST', '/refunds', { payment_intent: paymentIntent, amount: String(cents), 'metadata[ref]': ref }, `refund-${ref}`);
    },

    /** Verifica la firma del webhook (header Stripe-Signature) e restituisce l'evento. */
    verifyWebhook(rawBody, header, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300) {
      const secret = cfg.stripe.webhookSecret;
      if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET non configurata');
      const parts = Object.fromEntries(String(header ?? '').split(',').map((kv) => kv.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
      const sigs = String(header ?? '').split(',').map((kv) => kv.trim()).filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
      if (!parts.t || !sigs.length) throw new Error('firma mancante');
      if (Math.abs(nowSec - Number(parts.t)) > toleranceSec) throw new Error('firma scaduta');
      const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.`).update(rawBody).digest('hex');
      const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
      if (!ok) throw new Error('firma non valida');
      return JSON.parse(rawBody.toString('utf8'));
    },
  };
}
