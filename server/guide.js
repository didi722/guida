// La guida d'uso (docs/GUIDA.md) mostrata nel pannello: Aiuto › Guida.
import fs from 'node:fs';
import path from 'node:path';
import { Marked, Renderer } from 'marked';
import { ROOT } from './config.js';

export const GUIDE_FILE = path.join(ROOT, 'docs', 'GUIDA.md');

/** Identificativo di un titolo, come lo calcola anche GitHub: minuscolo, senza punteggiatura, spazi → trattini (le lettere accentate restano). */
export const slugify = (text) =>
  String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

const guideMd = new Marked({ gfm: true });
guideMd.use({
  renderer: {
    // titoli con identificativo, per i collegamenti dell'indice
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    // le tabelle scorrono di lato sui telefoni invece di sforare la pagina
    table(token) {
      const base = new Renderer(this.options);
      base.parser = this.parser;
      return `<div class="table-wrap">${base.table(token)}</div>\n`;
    },
  },
});

export const readGuide = () => fs.readFileSync(GUIDE_FILE, 'utf8');

/** Il testo della guida come HTML (senza il titolo principale: lo mostra già il pannello). */
export function renderGuide(src = readGuide()) {
  return guideMd.parse(src.replace(/^# .*\r?\n/, ''), { async: false });
}

/** Gli identificativi dei titoli e i collegamenti interni (#...) di un testo markdown: servono a controllare che l'indice non si rompa. */
export function guideAnchors(src = readGuide()) {
  const ids = [...src.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slugify(m[1]));
  const links = [...src.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => decodeURIComponent(m[1]));
  return { ids, links };
}
