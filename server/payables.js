// Oggetti pagabili con Stripe (o con la pagina demo): prenotazioni, gift card, acconti dei programmi, pacchetti di più servizi.
// Ognuno si registra con un "handler"; webhook, ripresa del pagamento e pagina demo sono generici.
//
// Handler: { find(ref), dueCents(row), isOpen(row), title(row, lang), onPaid(row, paymentIntent, nowMs),
//            onExpired(row), startCheckout(row, lang, nowMs, attempt), statusUrl(row, lang) }

const PREFIX = { VE: 'booking', GC: 'gift', PR: 'program', PT: 'group' };

export function kindOfRef(ref) {
  const m = /^([A-Z]{2})-/.exec(String(ref ?? ''));
  return m ? (PREFIX[m[1]] ?? null) : null;
}

export function createPayables(app) {
  const handlers = new Map();
  const api = {
    register(kind, handler) {
      handlers.set(kind, handler);
    },
    /** { kind, handler, row } per un riferimento (es. "VE-AB12CD"), oppure null. */
    lookup(ref) {
      const kind = kindOfRef(ref);
      const handler = kind && handlers.get(kind);
      const row = handler?.find(ref);
      return row ? { kind, handler, row } : null;
    },
    /** Il cliente è tornato da Stripe prima del webhook: verifichiamo noi lo stato della sessione. */
    async sync(ref) {
      const found = api.lookup(ref);
      if (!found) return null;
      const { handler, row } = found;
      const { payments } = app;
      if (!handler.isOpen(row) || !row.stripe_session_id || !payments.live) return row;
      try {
        const s = await payments.retrieveSession(row.stripe_session_id);
        const pi = typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null);
        if (s.payment_status === 'paid' && s.amount_total === handler.dueCents(row)) await handler.onPaid(row, pi, Date.now());
        else if (s.status === 'expired') handler.onExpired(row);
      } catch (err) {
        console.error('[stripe] verifica sessione fallita:', err.message);
      }
      return handler.find(ref);
    },
  };
  return api;
}
