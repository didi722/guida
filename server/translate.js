// Traduzione automatica dei commenti dei clienti mostrati sul sito, nella lingua di chi guarda (con «Vedi originale»).
//
// Come funziona, in breve:
//  - serve una chiave di un servizio di traduzione (TRANSLATE_PROVIDER=deepl|google e TRANSLATE_API_KEY): senza, il modulo è spento
//    e i commenti restano come li ha scritti il cliente;
//  - si traducono SOLO i commenti che il cliente ha permesso di citare e che hai scelto di mostrare sul sito (mai il feedback privato);
//  - la traduzione si fa una volta, in background, e si conserva nel database: la pagina non aspetta mai un servizio esterno;
//  - se il commento è già nella lingua di chi guarda (lo riconosce il servizio), non c'è nulla da tradurre;
//  - se il servizio non risponde, si fa una pausa e si riprova: nel frattempo il sito mostra l'originale.
import crypto from 'node:crypto';
import { LANGS } from './langs.js';

const PAUSE_MS = 15 * 60_000;
const MAX_PER_SWEEP = 12; // chiamate al servizio per ogni passaggio (ogni minuto): poche, per non consumare la quota gratuita
const TIMEOUT_MS = 15_000;

/** Impronta del commento: se cambia, le traduzioni vecchie non si usano più. */
export const hashOf = (comment) => crypto.createHash('sha256').update(String(comment).trim()).digest('hex').slice(0, 16);

// Il solo SQL che decide quali commenti compaiono sul sito: lo condividono l'elenco pubblico e il lavoro di traduzione.
export const FEATURED_WHERE = `f.featured = 1 AND f.may_publish = 1 AND TRIM(COALESCE(f.comment, '')) <> '' AND b.status = 'confirmed' AND b.channel = 'b2c'`;

const DEEPL_TARGET = { it: 'IT', en: 'EN-GB', es: 'ES', ja: 'JA' };

export class TranslateError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

/**
 * I due servizi supportati. Ognuno riceve il testo e la lingua di arrivo e restituisce `{ text, detected }`
 * (`detected` = lingua del testo originale, due lettere minuscole).
 */
const PROVIDERS = {
  deepl: {
    label: 'DeepL',
    async call(fetchImpl, key, text, target) {
      const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'; // le chiavi del piano gratuito finiscono con «:fx»
      const res = await fetchImpl(`${host}/v2/translate`, {
        method: 'POST',
        headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'guida-venezia/1.0' },
        body: JSON.stringify({ text: [text], target_lang: DEEPL_TARGET[target], preserve_formatting: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new TranslateError(`DeepL ${res.status}`, res.status);
      const t = (await res.json()).translations?.[0];
      if (!t || typeof t.text !== 'string') throw new TranslateError('risposta di DeepL non valida');
      return { text: t.text, detected: String(t.detected_source_language ?? '').toLowerCase().slice(0, 2) };
    },
  },
  google: {
    label: 'Google Traduttore',
    async call(fetchImpl, key, text, target) {
      const res = await fetchImpl(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'guida-venezia/1.0' },
        body: JSON.stringify({ q: text, target, format: 'text' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new TranslateError(`Google Traduttore ${res.status}`, res.status);
      const t = (await res.json()).data?.translations?.[0];
      if (!t || typeof t.translatedText !== 'string') throw new TranslateError('risposta di Google non valida');
      return { text: t.translatedText, detected: String(t.detectedSourceLanguage ?? '').toLowerCase().slice(0, 2) };
    },
  },
};

export function createTranslator(app, fetchImpl = globalThis.fetch) {
  const { db, cfg } = app;
  const { provider: name, apiKey } = cfg.translate;
  const provider = PROVIDERS[name];
  let pausedUntil = 0;
  let lastError = null;

  const svc = {
    /** Spenta senza servizio e chiave. */
    enabled: !!(provider && apiKey),
    label: provider?.label ?? '',
    get lastError() {
      return lastError;
    },

    /** Traduce un testo. @returns {Promise<{text: string, detected: string}>} */
    async translate(text, target) {
      if (!svc.enabled) throw new TranslateError('traduzione non configurata');
      if (!LANGS.includes(target)) throw new TranslateError(`lingua non prevista: ${target}`);
      return provider.call(fetchImpl, apiKey, text, target);
    },

    /**
     * Traduce i commenti in evidenza nelle lingue del sito (le mancanti, qualche chiamata alla volta).
     * @returns {Promise<number>} quante traduzioni ha fatto
     */
    async sweep(nowMs = Date.now()) {
      if (!svc.enabled || nowMs < pausedUntil) return 0;
      const rows = db
        .prepare(`SELECT f.id, f.comment FROM feedback f JOIN bookings b ON b.id = f.booking_id WHERE ${FEATURED_WHERE} ORDER BY f.id DESC LIMIT 60`)
        .all();
      let done = 0;
      for (const row of rows) {
        const comment = row.comment.trim();
        const hash = hashOf(comment);
        db.prepare('DELETE FROM feedback_translations WHERE feedback_id = ? AND src_hash <> ?').run(row.id, hash); // il cliente ha cambiato il commento
        const have = new Set(db.prepare('SELECT lang FROM feedback_translations WHERE feedback_id = ?').all(row.id).map((r) => r.lang));
        for (const lang of LANGS) {
          if (have.has(lang)) continue;
          if (done >= MAX_PER_SWEEP) return done;
          try {
            const r = await svc.translate(comment, lang);
            const same = r.detected === lang; // già scritto in questa lingua
            db.prepare(`INSERT OR REPLACE INTO feedback_translations(feedback_id, lang, src_hash, src_lang, same, text, provider, created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
              row.id, lang, hash, r.detected || null, same ? 1 : 0, same ? null : r.text.slice(0, 4000), name, new Date(nowMs).toISOString(),
            );
            lastError = null;
            done++;
          } catch (err) {
            lastError = `${err.message}`;
            pausedUntil = nowMs + (err.status === 456 ? 6 * PAUSE_MS : PAUSE_MS); // 456 = quota del mese esaurita (DeepL)
            console.error('[traduzione] sospesa:', err.message);
            return done;
          }
        }
      }
      return done;
    },
  };
  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}

/**
 * Aggiunge ai commenti la traduzione nella lingua di chi guarda, se c'è:
 *  - `translation: { text, from }` quando il commento è in un'altra lingua e la traduzione è pronta;
 *  - `lang` corretta (la lingua in cui è davvero scritto) quando coincide con quella di chi guarda.
 * Senza traduzione il commento resta com'è.
 */
export function attachTranslations(db, quotes, lang) {
  if (!quotes.length) return quotes;
  const rows = db
    .prepare(`SELECT feedback_id, src_hash, src_lang, same, text FROM feedback_translations WHERE lang = ? AND feedback_id IN (${quotes.map(() => '?').join(',')})`)
    .all(lang, ...quotes.map((q) => q.id));
  const byId = new Map(rows.map((r) => [r.feedback_id, r]));
  for (const q of quotes) {
    const r = byId.get(q.id);
    if (!r || r.src_hash !== hashOf(q.comment)) continue; // nessuna traduzione, oppure di un commento che nel frattempo è cambiato
    if (r.same) q.lang = lang;
    else if (r.text) q.translation = { text: r.text, from: r.src_lang || q.lang };
  }
  return quotes;
}
