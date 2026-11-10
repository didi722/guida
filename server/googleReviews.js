// Recensioni di Google nella home, accanto ai commenti dei clienti del sito.
//
// Come funziona, in breve:
//  - serve il codice del profilo (Place ID, in Impostazioni) e una chiave della Places API (GOOGLE_PLACES_API_KEY, sul server): senza, il modulo è spento;
//  - il sito chiede a Google le recensioni del profilo UNA volta al giorno, in ognuna delle quattro lingue (Google le restituisce già tradotte, con il testo
//    originale a parte), e ne tiene una copia nel database: la pagina non aspetta mai Google;
//  - Google restituisce al massimo cinque recensioni e non permette di archiviarle: la copia si rinnova ogni giorno e, se Google non risponde,
//    smette di comparire dopo due giorni;
//  - se Google non risponde si fa una pausa e si riprova; nel frattempo il sito mostra la copia di ieri (o i soli commenti dei clienti).
import { LANGS } from './langs.js';
import { cleanText } from './util.js';

const REFRESH_MS = 24 * 3_600_000; // si chiede a Google una volta al giorno
const MAX_AGE_MS = 48 * 3_600_000; // oltre questo una copia non si mostra più
const PAUSE_MS = 30 * 60_000;
const TIMEOUT_MS = 15_000;
const FIELDS = 'id,rating,userRatingCount,googleMapsUri,reviews';

/** Un indirizzo https (quelli di Google), altrimenti vuoto. */
const httpsUrl = (u) => {
  try {
    const x = new URL(String(u ?? ''));
    return x.protocol === 'https:' ? x.href.slice(0, 500) : '';
  } catch {
    return '';
  }
};

/** Le recensioni di Google in una forma sicura da mostrare (testi puliti, indirizzi https, voto da 1 a 5). */
export function parsePlace(json) {
  const reviews = (Array.isArray(json?.reviews) ? json.reviews : [])
    .map((r) => {
      const rating = Math.round(Number(r?.rating));
      const text = cleanText(r?.text?.text, 2000);
      const original = cleanText(r?.originalText?.text, 2000);
      return {
        author: cleanText(r?.authorAttribution?.displayName, 80),
        authorUrl: httpsUrl(r?.authorAttribution?.uri),
        rating,
        text: text || original,
        lang: String(r?.text?.languageCode ?? '').slice(0, 8).toLowerCase(),
        original: original && original !== text ? original : '',
        originalLang: String(r?.originalText?.languageCode ?? '').slice(0, 8).toLowerCase(),
        when: /^\d{4}-\d{2}-\d{2}/.test(String(r?.publishTime ?? '')) ? String(r.publishTime).slice(0, 10) : '',
        url: httpsUrl(r?.googleMapsUri),
      };
    })
    .filter((r) => r.rating >= 1 && r.rating <= 5 && r.text); // una valutazione senza parole non fa una recensione da leggere
  const rating = Number(json?.rating);
  const count = Number(json?.userRatingCount);
  return {
    rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : null,
    count: Number.isInteger(count) && count > 0 ? count : null,
    uri: httpsUrl(json?.googleMapsUri),
    reviews,
  };
}

export class GoogleReviewsError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export function createGoogleReviews(app, fetchImpl = globalThis.fetch) {
  const { db, cfg } = app;
  let pausedUntil = 0;
  let lastError = null;
  const conf = () => ({ placeId: String(cfg.reviews.google?.placeId ?? '').trim(), apiKey: cfg.reviews.google?.apiKey ?? '' });

  /** Chiede a Google il profilo nella lingua `lang`. @returns {Promise<object>} vedi parsePlace */
  async function fetchLang(lang) {
    const { placeId, apiKey } = conf();
    const res = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=${lang}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELDS, 'User-Agent': 'guida-venezia/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      let why = '';
      try {
        why = cleanText((await res.json())?.error?.message, 200);
      } catch {
        // la risposta non era JSON
      }
      throw new GoogleReviewsError(`Google ${res.status}${why ? `: ${why}` : ''}`, res.status);
    }
    return parsePlace(await res.json());
  }

  const save = (lang, placeId, p, nowMs) =>
    db.prepare(`INSERT OR REPLACE INTO google_reviews(lang, place_id, rating, count, uri, reviews_json, fetched_at) VALUES(?,?,?,?,?,?,?)`).run(
      lang, placeId, p.rating, p.count, p.uri || null, JSON.stringify(p.reviews), new Date(nowMs).toISOString(),
    );

  const svc = {
    /** Spento senza codice del profilo e chiave. */
    get enabled() {
      const c = conf();
      return !!(c.placeId && c.apiKey);
    },
    get lastError() {
      return lastError;
    },

    /** Le recensioni da mostrare nella lingua `lang`, o null (spento, mai lette, o copia troppo vecchia). */
    forLang(lang, nowMs = Date.now()) {
      if (!svc.enabled) return null;
      const row = db.prepare('SELECT * FROM google_reviews WHERE lang = ?').get(lang);
      if (!row || row.place_id !== conf().placeId || nowMs - Date.parse(row.fetched_at) > MAX_AGE_MS) return null;
      return { rating: row.rating, count: row.count, uri: row.uri, reviews: JSON.parse(row.reviews_json), fetchedAt: row.fetched_at };
    },

    /** Quando è stata letta l'ultima copia valida (per dirlo nel pannello), o null. */
    lastFetch(nowMs = Date.now()) {
      const row = svc.enabled ? db.prepare('SELECT MAX(fetched_at) AS at FROM google_reviews WHERE place_id = ?').get(conf().placeId) : null;
      return row?.at && nowMs - Date.parse(row.at) <= MAX_AGE_MS ? row.at : null;
    },

    /**
     * Rinnova le copie che hanno più di un giorno (o mancano), una lingua dopo l'altra. Con `force` (il pulsante «Aggiorna adesso») le rinnova tutte, senza pause.
     * @returns {Promise<number>} quante lingue ha rinnovato
     */
    async sweep(nowMs = Date.now(), { force = false } = {}) {
      if (!svc.enabled || (!force && nowMs < pausedUntil)) return 0;
      const { placeId } = conf();
      const have = new Map(db.prepare('SELECT lang, place_id, fetched_at FROM google_reviews').all().map((r) => [r.lang, r]));
      let done = 0;
      for (const lang of LANGS) {
        const row = have.get(lang);
        if (!force && row && row.place_id === placeId && nowMs - Date.parse(row.fetched_at) < REFRESH_MS) continue;
        try {
          save(lang, placeId, await fetchLang(lang), nowMs);
          lastError = null;
          done++;
        } catch (err) {
          lastError = `${err.message}`;
          pausedUntil = nowMs + PAUSE_MS;
          console.error('[recensioni google] non aggiornate:', err.message);
          if (force) throw err;
          return done;
        }
      }
      return done;
    },
  };
  app.jobs.push((nowMs) => svc.sweep(nowMs));
  return svc;
}
