// Carica i contenuti editabili (tour, articoli del blog, pagine) dalla cartella /content.
// Sono file di testo: si modificano con un editor e si pubblicano con un commit.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { marked } from 'marked';

marked.use({ gfm: true, breaks: false });
const md = (s) => marked.parse(String(s ?? ''), { async: false });

const LANGS = ['it', 'en'];

function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: YAML.parse(m[1]) ?? {}, body: m[2] };
}

const cents = (euro) => (euro == null ? null : Math.round(Number(euro) * 100));
const list = (v) => (Array.isArray(v) ? v.map(String) : []);

function fail(file, msg) {
  throw new Error(`Contenuto non valido (${file}): ${msg}`);
}

function loadTours(dir) {
  const tours = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()) {
    const d = YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const slug = path.basename(f, '.yml');
    if (!['person', 'group'].includes(d.model)) fail(f, "model deve essere 'person' o 'group'");
    if (!d.flexible && !(Array.isArray(d.times) && d.times.length)) fail(f, 'servono `times` (partenze fisse) oppure `flexible: true`');
    for (const k of ['duration', 'maxParticipants', 'price']) if (!(Number(d[k]) > 0)) fail(f, `${k} mancante o non valido`);
    const i18n = {};
    for (const l of LANGS) {
      const x = d[l];
      if (!x?.title || !x?.summary) fail(f, `manca la traduzione '${l}' (title, summary)`);
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
      };
    }
    tours.push({
      slug,
      order: Number(d.order ?? 100),
      active: d.active !== false,
      featured: !!d.featured,
      model: d.model,
      flexible: !!d.flexible,
      times: list(d.times),
      weekdays: Array.isArray(d.weekdays) ? d.weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6],
      durationMin: Number(d.duration),
      maxParticipants: Number(d.maxParticipants),
      priceCents: cents(d.price),
      b2bPriceCents: cents(d.b2bPrice ?? d.price),
      cancelHours: d.cancelHours == null ? null : Number(d.cancelHours),
      payOnSite: d.payOnSite !== false,
      art: d.art ?? 'dome',
      image: d.image ?? null,
      languages: list(d.languages).length ? list(d.languages) : ['it', 'en'],
      category: d.category ?? (d.model === 'person' ? 'group' : 'private'),
      i18n,
    });
  }
  return tours.sort((a, b) => a.order - b.order);
}

function loadBlog(dir) {
  const posts = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const m = /^(.+)\.(it|en)\.md$/.exec(f);
    if (!m) continue;
    const [, slug, lang] = m;
    const { data, body } = splitFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!data.title || !data.date) fail(f, 'servono title e date nel front matter');
    const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date);
    const p = posts.get(slug) ?? { slug, date, tags: [], art: 'dome', tours: [], i18n: {} };
    p.date = date;
    p.art = data.art ?? p.art;
    p.tours = list(data.tours).length ? list(data.tours) : p.tours;
    p.i18n[lang] = {
      title: data.title,
      summary: data.summary ?? '',
      tags: list(data.tags),
      html: md(body),
      minutes: Math.max(1, Math.round(body.split(/\s+/).length / 200)),
    };
    posts.set(slug, p);
  }
  return [...posts.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function loadPages(dir) {
  const pages = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const m = /^(.+)\.(it|en)\.md$/.exec(f);
    if (!m) continue;
    const { data, body } = splitFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    (pages[m[1]] ??= {})[m[2]] = { title: data.title ?? m[1], description: data.description ?? '', html: md(body) };
  }
  return pages;
}

export function loadContent(root) {
  const dir = path.join(root, 'content');
  const tours = loadTours(path.join(dir, 'tours'));
  const posts = loadBlog(path.join(dir, 'blog'));
  const pages = loadPages(path.join(dir, 'pages'));
  const bySlug = new Map(tours.map((t) => [t.slug, t]));
  for (const p of posts) for (const s of p.tours) if (!bySlug.has(s)) throw new Error(`Articolo ${p.slug}: tour inesistente '${s}'`);

  return {
    tours: tours.filter((t) => t.active), // solo i tour attivi (visibili e prenotabili)
    tour: (slug) => bySlug.get(slug), // anche quelli nascosti: servono allo storico delle prenotazioni
    postsFor: (lang) => posts.filter((p) => p.i18n[lang]),
    post: (slug) => posts.find((p) => p.slug === slug),
    page: (name, lang) => pages[name]?.[lang] ?? pages[name]?.it,
  };
}
