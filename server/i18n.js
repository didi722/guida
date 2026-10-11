// Testi dell'interfaccia: [italiano, inglese, spagnolo]. I contenuti lunghi (tour, blog, pagine) stanno in /content.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { LANGS, isLang } from './langs.js';
export { LANGS, isLang };

const DICT = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'strings.json'), 'utf8'));

export function makeT(lang) {
  const i = Math.max(0, LANGS.indexOf(lang));
  return (key, vars) => {
    const entry = DICT[key];
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] chiave mancante: ${key}`);
      return key;
    }
    let s = entry[i] ?? entry[1] ?? entry[0]; // senza traduzione: inglese, poi italiano
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export const allKeys = () => Object.keys(DICT);
