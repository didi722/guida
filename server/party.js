// Chi partecipa a un servizio: adulti, bambini (fino a 12 anni, metà prezzo) e infanti (fino a 3 anni, gratis).
// «Persone» (`participants` di una prenotazione, `pax` nelle richieste) è il totale: tutti occupano un posto nel gruppo.
// Il prezzo a persona si calcola sulla composizione; per i servizi a gruppo o a ore la composizione serve solo alla guida.
export const CHILD_MAX_AGE = 12;
export const INFANT_MAX_AGE = 3;
export const CHILD_PERCENT = 50;
/** Quanti partecipanti al massimo si possono scrivere in un modulo, qualunque sia il servizio (i servizi hanno il loro massimo). */
export const MAX_PARTY = 99;

/** { adults, children, infants } → totale. */
export const partyTotal = (p) => p.adults + p.children + p.infants;
/** Chi usa gli auricolari (servizio guida a ore): gli infanti no. */
export const partyListeners = (p) => p.adults + p.children;
/** N persone, tutte adulte (come ogni prenotazione fatta prima che esistesse la composizione). */
export const adultsOnly = (n) => ({ adults: n, children: 0, infants: 0 });

/** La composizione di una prenotazione salvata. */
export const partyOfBooking = (b) => ({ adults: b.participants - (b.children ?? 0) - (b.infants ?? 0), children: b.children ?? 0, infants: b.infants ?? 0 });

/** La composizione di una riga già salvata di un preventivo ({ pax, children, infants }). */
export const partyOfLine = (l) => ({ adults: l.pax - (l.children ?? 0) - (l.infants ?? 0), children: l.children ?? 0, infants: l.infants ?? 0 });

/** Prezzo di un bambino, dato quello di un adulto (in centesimi). */
export const childPriceCents = (adultCents) => Math.round((adultCents * CHILD_PERCENT) / 100);
/** Totale a persona: gli adulti pagano il prezzo pieno, i bambini la metà, gli infanti niente. */
export const partyPriceCents = (adultCents, p) => adultCents * p.adults + childPriceCents(adultCents) * p.children;

const count = (v) => (typeof v === 'number' ? v : /^\s*\d{1,3}\s*$/.test(String(v ?? '')) ? Number(v) : Number.NaN);
const given = (src, k) => src?.[k] != null && String(src[k]).trim() !== '';

export function isValidParty(p, max = MAX_PARTY) {
  return !!p && [p.adults, p.children, p.infants].every((n) => Number.isInteger(n) && n >= 0) && p.adults >= 1 && partyTotal(p) <= max;
}

/**
 * Legge la composizione da un modulo o da un indirizzo: `adults`, `children`, `infants` (quelli non scritti valgono 0).
 * Senza nessuno dei tre vale `pax`, il numero di persone, tutte adulte: i vecchi link e le richieste «a numero» continuano a funzionare.
 * Serve almeno un adulto. @returns {{adults: number, children: number, infants: number}|null} null se non è valida
 */
export function readParty(src, { max = MAX_PARTY } = {}) {
  const split = given(src, 'adults') || given(src, 'children') || given(src, 'infants');
  const p = split
    ? { adults: given(src, 'adults') ? count(src.adults) : 0, children: given(src, 'children') ? count(src.children) : 0, infants: given(src, 'infants') ? count(src.infants) : 0 }
    : adultsOnly(count(src?.pax));
  return isValidParty(p, max) ? p : null;
}

/** La composizione scritta in `src` (come `readParty`), oppure `fallback` se non c'è o non è valida. */
export function readPartyOr(src, fallback, opts) {
  const any = ['adults', 'children', 'infants', 'pax'].some((k) => given(src, k));
  return (any ? readParty(src, opts) : null) ?? fallback;
}

/** I campi di un modulo o di un indirizzo che descrivono la composizione (sempre tutti e tre: il link si legge da solo). */
export const partyParams = (p) => ({ adults: String(p.adults), children: String(p.children), infants: String(p.infants) });
/** Composizione identica? */
export const sameParty = (a, b) => a.adults === b.adults && a.children === b.children && a.infants === b.infants;

// ───────────── testi ─────────────
const WORDS = {
  it: { adults: ['adulto', 'adulti'], children: ['bambino', 'bambini'], infants: ['infante', 'infanti'], person: ['persona', 'persone'] },
  en: { adults: ['adult', 'adults'], children: ['child', 'children'], infants: ['infant', 'infants'], person: ['guest', 'guests'] }, // «guests», come in tutto il sito
  es: { adults: ['adulto', 'adultos'], children: ['niño', 'niños'], infants: ['bebé', 'bebés'], person: ['persona', 'personas'] },
  ja: { adults: ['大人', '大人'], children: ['子ども', '子ども'], infants: ['乳幼児', '乳幼児'], person: ['名', '名'] },
};
const sayCount = (lang, kind, n) => {
  const w = WORDS[lang] ?? WORDS.en;
  if (lang === 'ja') return `${w[kind][0]}${n}名`;
  return `${n} ${w[kind][n === 1 ? 0 : 1]}`;
};

/** «2 adulti», «1 bambino», «1 infante» (kind: adults | children | infants). */
export const partyWord = (kind, n, lang = 'it') => sayCount(lang, kind, n);

/** «2 adulti, 1 bambino, 1 infante»: solo le categorie presenti. */
export function partyText(p, lang = 'it') {
  const parts = [['adults', p.adults], ['children', p.children], ['infants', p.infants]].filter(([, n]) => n > 0).map(([k, n]) => sayCount(lang, k, n));
  return parts.join(lang === 'ja' ? '、' : ', ');
}

/**
 * «3 persone», e se ci sono bambini o infanti «4 persone (2 adulti, 1 bambino, 1 infante)». `noun`: la parola da usare al posto di «persone»
 * (le email dicono «partecipanti»), uguale per uno e per molti.
 */
export function peopleText(p, lang = 'it', { noun = null } = {}) {
  const total = partyTotal(p);
  const w = (WORDS[lang] ?? WORDS.en).person;
  const n = noun ? `${total} ${noun}` : lang === 'ja' ? `${total}名` : `${total} ${w[total === 1 ? 0 : 1]}`;
  return p.children || p.infants ? (lang === 'ja' ? `${n}（${partyText(p, lang)}）` : `${n} (${partyText(p, lang)})`) : n;
}

/** « (2 adulti, 1 bambino)» da accodare a un numero di persone, se ci sono bambini o infanti; altrimenti niente. */
export const partyExtra = (p, lang = 'it') => (p.children || p.infants ? ` (${partyText(p, lang)})` : '');

/** Come sopra, ma per una prenotazione salvata. */
export const bookingPeople = (b, lang = 'it', opts) => peopleText(partyOfBooking(b), lang, opts);

const shortList = (p) => [p.adults && `${p.adults} ad.`, p.children && `${p.children} bamb.`, p.infants && `${p.infants} inf.`].filter(Boolean).join(' + ');
/** Versione breve, in italiano, per elenchi e righe del pannello e delle email alla guida: «4 pers.», o con bambini e infanti «4 pers. (2 ad. + 1 bamb. + 1 inf.)». */
export const peopleShort = (p) => (p.children || p.infants ? `${partyTotal(p)} pers. (${shortList(p)})` : `${partyTotal(p)} pers.`);
/** Come sopra, ma solo il numero davanti a un'etichetta già scritta: «4» o «4 (2 ad. + 1 bamb. + 1 inf.)». */
export const partyCompact = (p) => (p.children || p.infants ? `${partyTotal(p)} (${shortList(p)})` : String(partyTotal(p)));
export const bookingPeopleShort = (b) => peopleShort(partyOfBooking(b));
