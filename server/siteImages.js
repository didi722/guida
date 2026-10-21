// Immagini «fisse» del sito (oggi illustrazioni): si scelgono dalla libreria del pannello.
// Si salvano nelle impostazioni come { slot: nome-del-file }; senza scelta il sito usa l'illustrazione.
import { getSetting, setSetting } from './db.js';
import { MEDIA_NAME, MediaError } from './media.js';

export const IMAGE_SLOTS = [
  { key: 'home', label: 'Home', hint: 'La foto in cima alla pagina iniziale. Meglio orizzontale, con il soggetto al centro.' },
  { key: 'home-private', label: 'Home · scheda «Guida privata»', hint: 'La foto della scheda «Guida privata» nella pagina iniziale. Se la lasci vuota si usa la foto del tour privato in evidenza (o del primo).' },
  { key: 'home-group', label: 'Home · scheda «Tour di gruppo»', hint: 'La foto della scheda «Tour di gruppo» nella pagina iniziale. Se la lasci vuota si usa la foto del tour di gruppo in evidenza (o del primo).' },
  { key: 'about', label: 'Chi sono', hint: 'Il tuo ritratto, o una foto mentre accompagni un gruppo: chi prenota vuole vedere con chi starà due ore e mezza.' },
  { key: 'b2b', label: 'Pagina agenzie', hint: 'La foto in cima alla pagina per agenzie e tour operator.' },
  { key: 'gift', label: 'Buono regalo', hint: 'L’immagine accanto al modulo del buono regalo.' },
  { key: 'og', label: 'Anteprima social', hint: 'Compare quando qualcuno condivide il sito su WhatsApp, Facebook, Instagram… Meglio orizzontale (1200×630). Se la lasci vuota si usa la foto della home.' },
];
const KEYS = new Set(IMAGE_SLOTS.map((s) => s.key));
const SETTING = 'site_images';

export function createSiteImages({ db, media }) {
  const read = () => {
    const v = getSetting(db, SETTING, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  /** Nome del file scelto per lo slot, oppure null (illustrazione). Se il file non esiste più, null. */
  const get = (slot) => {
    const name = read()[slot];
    return typeof name === 'string' && MEDIA_NAME.test(name) && media.get(name) ? name : null;
  };
  return {
    slots: IMAGE_SLOTS,
    get,
    all: () => Object.fromEntries(IMAGE_SLOTS.map((s) => [s.key, get(s.key)])),
    /** Imposta (o toglie, con name vuoto) l'immagine di uno slot. */
    set(slot, name) {
      if (!KEYS.has(slot)) throw new MediaError('Posizione non valida.');
      const next = { ...read() };
      if (!name) delete next[slot];
      else {
        if (!MEDIA_NAME.test(name) || !media.get(name)) throw new MediaError('Immagine non trovata nella libreria.');
        next[slot] = name;
      }
      setSetting(db, SETTING, next);
    },
    /** Nomi dei file in uso (non si possono eliminare dalla libreria). */
    used: () => new Set(Object.values(read()).filter((n) => typeof n === 'string')),
  };
}
