// Lingue del sito. Per aggiungerne una: voce qui, una colonna in più in strings.json,
// blocco della lingua nei tour (content/tours), file .xx.md per blog e pagine, e le voci nei dizionari delle email.
export const LANG_META = {
  it: { name: 'Italiano', short: 'IT', locale: 'it-IT', og: 'it_IT', stripe: 'it' },
  en: { name: 'English', short: 'EN', locale: 'en-GB', og: 'en_GB', stripe: 'en' },
  es: { name: 'Español', short: 'ES', locale: 'es-ES', og: 'es_ES', stripe: 'es' },
  ja: { name: '日本語', short: 'JA', locale: 'ja-JP', og: 'ja_JP', stripe: 'ja' },
};
export const LANGS = Object.keys(LANG_META);
export const isLang = (l) => Object.hasOwn(LANG_META, l);
/** Una lingua valida (o quella di ripiego): per ciò che arriva da form, database o URL. */
export const normLang = (l, fallback = 'it') => (isLang(l) ? l : fallback);
export const localeOf = (lang) => LANG_META[normLang(lang)].locale;
export const langName = (lang) => LANG_META[normLang(lang)].name;
/** Sceglie il testo nella lingua richiesta da una mappa {it, en, es, ja}; se manca ripiega sull'inglese, poi sull'italiano. */
export const pick = (map, lang) => map[lang] ?? map.en ?? map.it;
