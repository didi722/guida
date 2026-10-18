// Scelta tematica del cliente in un tour (per esempio «Classici imperdibili» / «Angoli nascosti» / «Altro, con un testo per la guida»).
// Le voci stanno nel tour (una per riga, in ogni lingua, nello stesso ordine); nella prenotazione se ne conserva una copia in tutte le lingue,
// così la guida la legge in italiano e il cliente nella sua anche se poi il tour cambia.
import { makeT } from './i18n.js';
import { LANGS } from './langs.js';
import { cleanText } from './util.js';

export const hasThemes = (tour) => (tour?.i18n?.it?.themes?.length ?? 0) > 0;

/**
 * Dalla scelta del modulo (`theme`: indice della voce oppure «other») ai dati da salvare.
 * @returns {{ json: string, note: string|null } | null}  null se il tour non ha scelte; lancia un errore con `reason` se la scelta manca o non vale
 */
export function themeChoice(tour, theme, note) {
  if (!hasThemes(tour)) return null;
  const fail = () => Object.assign(new Error('theme'), { reason: 'theme' });
  const raw = String(theme ?? '');
  if (raw === 'other') {
    const text = cleanText(note, 500);
    if (!tour.themeOther || text.length < 3) throw fail();
    return { json: JSON.stringify({ other: true }), note: text };
  }
  const i = /^\d+$/.test(raw) ? Number(raw) : -1;
  if (i < 0 || i >= tour.i18n.it.themes.length) throw fail();
  return { json: JSON.stringify({ labels: Object.fromEntries(LANGS.map((l) => [l, tour.i18n[l]?.themes?.[i] ?? tour.i18n.it.themes[i]])) }), note: null };
}

/** La scelta di una prenotazione, leggibile: «Angoli nascosti» oppure «Altro: voglio vedere i ponti». null se non c'è. */
export function themeText(b, lang = 'it') {
  if (!b.theme_json) return null;
  let rec;
  try { rec = JSON.parse(b.theme_json); } catch { return null; }
  if (rec.other) return `${makeT(lang)('f.themeOther')}${b.theme_note ? `: ${b.theme_note}` : ''}`;
  return rec.labels?.[lang] ?? rec.labels?.it ?? null;
}

/** Il punto d'incontro standard, quando il cliente non ne indica uno. */
export const DEFAULT_MEETING = {
  text: { it: 'Campo San Luca', en: 'Campo San Luca', es: 'Campo San Luca', ja: 'サン・ルカ広場（Campo San Luca）' },
  url: 'https://www.google.com/maps/search/?api=1&query=Campo+San+Luca+Venezia',
};

/** Il testo da conservare: quello scritto dal cliente (solo nei tour in cui sceglie lui), altrimenti null. */
export const pickupText = (tour, value) => (tour?.meetingChoice ? cleanText(value, 200) || null : null);

/** Dove ci si incontra per questa prenotazione: l'indicazione del cliente, il punto standard o quello del tour. */
export function meetingOf(tour, b, lang = 'it') {
  const ti = tour?.i18n?.[lang] ?? tour?.i18n?.it ?? { meetingPoint: '', meetingUrl: '' };
  if (!tour?.meetingChoice) return { text: ti.meetingPoint, url: ti.meetingUrl };
  if (b?.pickup) return { text: b.pickup, url: '' };
  if (b?.channel === 'b2b') return { text: ti.meetingPoint, url: ti.meetingUrl }; // le agenzie lo comunicano dopo, dalla prenotazione: nel frattempo vale il testo del servizio
  return { text: DEFAULT_MEETING.text[lang] ?? DEFAULT_MEETING.text.it, url: DEFAULT_MEETING.url };
}
