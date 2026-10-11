// Testi dell'interfaccia: [italiano, inglese]. I contenuti lunghi (tour, blog, pagine) stanno in /content.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const DICT = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'strings.json'), 'utf8'));

export const LANGS = ['it', 'en'];
export const isLang = (l) => LANGS.includes(l);

export function makeT(lang) {
  const i = lang === 'en' ? 1 : 0;
  return (key, vars) => {
    const entry = DICT[key];
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] chiave mancante: ${key}`);
      return key;
    }
    let s = entry[i] ?? entry[0];
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export const allKeys = () => Object.keys(DICT);
