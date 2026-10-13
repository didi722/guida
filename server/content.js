// Contenuti editabili: tour, articoli del blog, pagine.
// - `content/` contiene il contenuto iniziale (file di testo, nel repository);
// - il sito li legge dal database (vedi contentStore.js) e li si modifica dal pannello admin.
// Qui: lettura dei file, controlli e preparazione (markdown → html) comuni ai due casi.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { marked } from 'marked';
import { LANGS } from './langs.js';
import { MAX_HOURS, SERVICES, minHours } from './rates.js';

marked.use({ gfm: true, breaks: false });
export const md = (s) => marked.parse(String(s ?? ''), { async: false });

const FILE_LANG = new RegExp(`^(.+)\\.(${LANGS.join('|')})\\.md$`);
export const PAGE_NAMES = ['about', 'privacy', 'terms', 'cookies'];
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ContentError extends Error {
  /** `detail`: il messaggio senza il nome del file/tour davanti (per mostrarlo nel pannello). */
  constructor(message, detail = message) {
    super(message);
    this.name = 'ContentError';
    this.detail = detail;
  }
}

const cents = (euro) => (euro == null || euro === '' ? null : Math.round(Number(euro) * 100));
const list = (v) => (Array.isArray(v) ? v.map(String) : []);
const fail = (where, msg) => {
  throw new ContentError(`${where}: ${msg}`, msg);
};

function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

// ───────────── domande frequenti di un tour ─────────────
export const MAX_FAQ = 20;

/**
 * Le domande frequenti si scrivono a blocchi separati da una riga vuota: la prima riga è la domanda, le righe seguenti la risposta
 * (che può usare il markdown). Nei file di contenuto iniziale si può anche scrivere una lista di coppie { q, a }.
 * @returns {{q: string, a: string}[]}
 */
export function parseFaq(src, fail = (msg) => { throw new ContentError(msg); }) {
  let items;
  if (Array.isArray(src)) items = src.map((x) => ({ q: String(x?.q ?? '').trim(), a: String(x?.a ?? '').trim() }));
  else {
    items = String(src ?? '')
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n+/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const [first, ...rest] = block.split('\n');
        return { q: first.trim(), a: rest.join('\n').trim() };
      });
  }
  items = items.filter((x) => x.q || x.a);
  if (items.length > MAX_FAQ) fail(`troppe domande frequenti (al massimo ${MAX_FAQ})`);
  for (const x of items) {
    if (!x.q) fail('una risposta delle domande frequenti non ha la domanda');
    if (!x.a) fail(`la domanda «${x.q.slice(0, 60)}» non ha la risposta (scrivila nelle righe sotto la domanda)`);
    if (x.q.length > 200) fail(`una domanda frequente è troppo lunga (al massimo 200 caratteri): «${x.q.slice(0, 40)}…»`);
    if (x.a.length > 3000) fail(`la risposta alla domanda «${x.q.slice(0, 40)}» è troppo lunga (al massimo 3000 caratteri)`);
  }
  return items;
}

/** Le domande frequenti come testo da modificare (l'inverso di parseFaq). */
export const faqToText = (src) => (Array.isArray(src) ? src.map((x) => `${x.q}\n${x.a}`).join('\n\n') : String(src ?? ''));

// ───────────── tour ─────────────
/** Blocco di una lingua: la sua traduzione se c'è, altrimenti l'inglese, poi l'italiano (il sito non resta mai senza testo). */
const tourBlock = (d, lang) => {
  const ok = (x) => x?.title && x?.summary;
  if (ok(d[lang])) return { x: d[lang], fallback: false };
  const alt = ok(d.en) ? d.en : d.it;
  return { x: alt, fallback: true };
};

/**
 * `d` ha la forma dei file .yml (e di ciò che si salva nel database): dati generali + un blocco per lingua (it, en, es…).
 * Restituisce il tour pronto per il sito; se qualcosa non va lancia ContentError (il messaggio è in italiano, leggibile nel pannello).
 */
export function normalizeTour(slug, d, where = slug) {
  if (!SLUG.test(slug)) fail(where, 'l’indirizzo (slug) può contenere solo lettere minuscole, numeri e trattini');
  if (!['person', 'group'].includes(d.model)) fail(where, 'scegli il tipo: a persona (partenze fisse) o a gruppo (servizio privato)');
  // servizi a ore: il prezzo non sta nel tour ma nelle tariffe a ore (Sito › Tariffe a ore)
  const hourly = d.pricing === 'hourly';
  if (hourly) {
    if (d.model !== 'group') fail(where, 'un servizio a ore è privato (a gruppo), non a persona');
    if (!SERVICES.includes(d.service)) fail(where, 'scegli il servizio: guida, assistente, tour leader o meet & greet');
  }
  if (!d.flexible && !(Array.isArray(d.times) && d.times.length)) fail(where, 'indica gli orari di partenza oppure scegli «orario libero»');
  for (const t of list(d.times)) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail(where, `orario non valido: «${t}» (usa il formato 09:30)`);
  if (!(Number(d.duration) > 0)) fail(where, 'la durata deve essere maggiore di zero');
  if (hourly) {
    const hours = Number(d.duration) / 60;
    if (!(hours >= minHours(d.service) && hours <= MAX_HOURS && Number.isInteger(hours * 2))) fail(where, `la durata di un servizio a ore va da ${minHours(d.service)} a ${MAX_HOURS} ore, di mezz’ora in mezz’ora`);
  }
  if (!(Number.isInteger(Number(d.maxParticipants)) && Number(d.maxParticipants) > 0)) fail(where, 'il numero massimo di persone deve essere un intero maggiore di zero');
  if (!hourly && (!(Number(d.price) >= 0) || d.price === '' || d.price == null)) fail(where, 'il prezzo al pubblico non è valido');
  if (!hourly && d.b2bPrice != null && d.b2bPrice !== '' && !(Number(d.b2bPrice) >= 0)) fail(where, 'la tariffa B2B non è valida');
  if (d.cancelHours != null && d.cancelHours !== '' && !(Number(d.cancelHours) >= 0)) fail(where, 'le ore di cancellazione non sono valide');
  if (!d.it?.title || !d.it?.summary) fail(where, 'servono almeno titolo e riassunto in italiano');
  const i18n = {};
  // le domande frequenti ripiegano come i testi: spagnolo → inglese → italiano
  const faqOf = (l) => {
    for (const k of new Set([l, ...(l === 'it' ? [] : ['en', 'it'])])) {
      const items = parseFaq(d[k]?.faq, (msg) => fail(where, `domande frequenti (${k}): ${msg}`));
      if (items.length) return items;
    }
    return [];
  };
  for (const l of LANGS) {
    const { x, fallback } = tourBlock(d, l);
    i18n[l] = {
      title: x.title,
      subtitle: x.subtitle ?? '',
      summary: x.summary,
      meetingPoint: x.meetingPoint ?? '',
      meetingUrl: x.meetingUrl ?? '',
      descriptionHtml: md(x.description),
      highlights: list(x.highlights),
      includes: list(x.includes),
      excludes: list(x.excludes),
      notes: x.notes ?? '',
      languagesLabel: x.languagesLabel ?? '',
      faq: faqOf(l).map((f) => ({ q: f.q, html: md(f.a) })),
      fallback, // senza traduzione propria
    };
  }
  const languages = list(d.languages).filter((l) => LANGS.includes(l));
  return {
    slug,
    order: Number(d.order ?? 100),
    active: d.active !== false,
    featured: !!d.featured,
    model: d.model,
    flexible: !!d.flexible,
    times: list(d.times),
    weekdays: Array.isArray(d.weekdays) && d.weekdays.length ? d.weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6],
    durationMin: Number(d.duration),
    maxParticipants: Number(d.maxParticipants),
    pricing: hourly ? 'hourly' : 'fixed', // 'hourly': il prezzo viene dalle tariffe a ore
    service: hourly ? d.service : null, // guide | assistant | leader | meetgreet
    audience: d.audience === 'b2b' ? 'b2b' : 'all', // 'b2b': solo per i partner approvati
    chooseHours: hourly && !!d.chooseHours, // il cliente sceglie quante ore; altrimenti la durata è quella del tour
    priceCents: hourly ? 0 : cents(d.price),
    b2bPriceCents: hourly ? 0 : cents(d.b2bPrice ?? d.price) ?? cents(d.price),
    cancelHours: d.cancelHours == null || d.cancelHours === '' ? null : Number(d.cancelHours),
    payOnSite: d.payOnSite !== false,
    art: d.art ?? 'dome',
    image: d.image || null,
    languages: languages.length ? languages : [...LANGS],
    category: d.category ?? (hourly ? 'hourly' : d.model === 'person' ? 'group' : 'private'),
    i18n,
  };
}

// ───────────── articoli ─────────────
/** `raw`: { date, art, image, published, tours, it: { title, summary, tags, body }, en: {...}, ... } */
export function normalizePost(slug, raw, where = slug) {
  if (!SLUG.test(slug)) fail(where, 'l’indirizzo (slug) può contenere solo lettere minuscole, numeri e trattini');
  const date = raw.date instanceof Date ? raw.date.toISOString().slice(0, 10) : String(raw.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail(where, 'la data non è valida (usa gg/mm/aaaa)');
  const i18n = {};
  for (const l of LANGS) {
    const x = raw[l];
    if (!x?.title) continue;
    const body = String(x.body ?? '');
    i18n[l] = { title: x.title, summary: x.summary ?? '', tags: list(x.tags), html: md(body), minutes: Math.max(1, Math.round(body.split(/\s+/).length / 200)) };
  }
  if (!Object.keys(i18n).length) fail(where, 'serve almeno il titolo in una lingua');
  return { slug, date, published: raw.published !== false, tags: [], art: raw.art ?? 'dome', image: raw.image || null, tours: list(raw.tours), i18n };
}

// ───────────── pagine ─────────────
/** `raw`: { it: { title, description, body }, en: {...}, ... } → { it: { title, description, html }, ... } */
export function normalizePage(name, raw) {
  const out = {};
  for (const l of LANGS) {
    const x = raw[l];
    if (!x || !(x.title || x.body)) continue;
    out[l] = { title: x.title || name, description: x.description ?? '', html: md(x.body) };
  }
  if (!Object.keys(out).length) fail(name, 'la pagina è vuota');
  return out;
}

// ───────────── file ─────────────
/** Legge la cartella `content/` nella forma «grezza» (quella che si salva nel database). */
export function readContentFiles(root) {
  const dir = path.join(root, 'content');
  const out = { tours: {}, posts: {}, pages: {} };
  const tdir = path.join(dir, 'tours');
  if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir).filter((f) => f.endsWith('.yml')).sort()) out.tours[path.basename(f, '.yml')] = YAML.parse(fs.readFileSync(path.join(tdir, f), 'utf8'));
  const bdir = path.join(dir, 'blog');
  if (fs.existsSync(bdir)) {
    for (const f of fs.readdirSync(bdir).filter((f) => f.endsWith('.md')).sort()) {
      const m = FILE_LANG.exec(f);
      if (!m) continue;
      const [, slug, lang] = m;
      const { data, body } = splitFrontMatter(fs.readFileSync(path.join(bdir, f), 'utf8'));
      if (!data.title || !data.date) fail(f, 'servono title e date nel front matter');
      const p = (out.posts[slug] ??= { date: null, art: 'dome', tours: [] });
      p.date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date);
      p.art = data.art ?? p.art;
      p.image = data.image ?? p.image;
      p.tours = list(data.tours).length ? list(data.tours) : p.tours;
      p[lang] = { title: data.title, summary: data.summary ?? '', tags: list(data.tags), body };
    }
  }
  const pdir = path.join(dir, 'pages');
  if (fs.existsSync(pdir)) {
    for (const f of fs.readdirSync(pdir).filter((f) => f.endsWith('.md'))) {
      const m = FILE_LANG.exec(f);
      if (!m) continue;
      const { data, body } = splitFrontMatter(fs.readFileSync(path.join(pdir, f), 'utf8'));
      (out.pages[m[1]] ??= {})[m[2]] = { title: data.title ?? m[1], description: data.description ?? '', body };
    }
  }
  return out;
}

// ───────────── l'oggetto che usa il sito ─────────────
/** tours/posts: elenchi normalizzati; pages: { nome: { lingua: { title, description, html } } } */
export function makeContent({ tours, posts, pages }) {
  const allTours = [...tours].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const bySlug = new Map(allTours.map((t) => [t.slug, t]));
  const allPosts = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const published = allPosts.filter((p) => p.published);
  return {
    tours: allTours.filter((t) => t.active), // solo i tour visibili e prenotabili
    allTours, // anche quelli nascosti (pannello)
    tour: (slug) => bySlug.get(slug), // anche quelli nascosti: servono allo storico delle prenotazioni
    posts: published, // gli articoli pubblicati, con le lingue in cui sono tradotti
    allPosts, // anche le bozze (pannello)
    postsFor: (lang) => published.filter((p) => p.i18n[lang]),
    post: (slug) => published.find((p) => p.slug === slug),
    postAny: (slug) => allPosts.find((p) => p.slug === slug),
    page: (name, lang) => pages[name]?.[lang] ?? pages[name]?.en ?? pages[name]?.it,
    pageNames: Object.keys(pages),
  };
}

/** Prepara tutto in una volta (e controlla che gli articoli citino tour esistenti). */
export function buildContent(raw) {
  const tours = Object.entries(raw.tours).map(([slug, d]) => normalizeTour(slug, d, `${slug}.yml`));
  const posts = Object.entries(raw.posts).map(([slug, p]) => normalizePost(slug, p, slug));
  const pages = Object.fromEntries(Object.entries(raw.pages).map(([name, p]) => [name, normalizePage(name, p)]));
  const known = new Set(tours.map((t) => t.slug));
  for (const p of posts) for (const s of p.tours) if (!known.has(s)) throw new ContentError(`Articolo ${p.slug}: tour inesistente '${s}'`);
  return makeContent({ tours, posts, pages });
}

/** Legge i file di `content/` (senza database): lo usano i test e l'importazione iniziale. */
export function loadContent(root) {
  return buildContent(readContentFiles(root));
}
