// Testi dell'interfaccia (strings.json) modificabili dal pannello: le modifiche stanno nel database e hanno la precedenza.
import express from 'express';
import { allKeys, defaultText, textOverrideKey } from '../i18n.js';
import { ContentError } from '../content.js';
import { LANGS } from '../langs.js';
import { send } from '../http.js';
import { labelOf, sectionOf, textsPage } from '../views/admin-texts.js';

const placeholders = (s) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const PAGE_SIZE_LIMIT = 80;

export function adminTextsRouter(app) {
  const r = express.Router();
  const form = express.urlencoded({ extended: false, limit: '600kb' });
  const ctxOf = (req) => ({ app, req });

  const overriddenKeys = () => new Set(app.content.textOverrides?.().map((o) => o.key) ?? []);
  function sections() {
    const counts = new Map();
    for (const k of allKeys()) counts.set(sectionOf(k), (counts.get(sectionOf(k)) ?? 0) + 1);
    return [...counts].map(([name, n]) => ({ name, n, label: labelOf(name) })).sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }
  const rowsFor = (keys, effectiveOf) => keys.slice(0, PAGE_SIZE_LIMIT).map((key) => ({ key, values: LANGS.map((l, i) => effectiveOf(key, l, i)) }));

  function view(req, res, { values = {}, flash = '', error = '', status = 200, section, q = '' } = {}) {
    const secs = sections();
    const current = secs.some((s) => s.name === section) ? section : (secs.find((s) => s.name === 'home') ?? secs[0]).name;
    const overrides = new Map(app.content.textOverrides().map((o) => [textOverrideKey(o.lang, o.key), o.value]));
    const eff = (key, lang, i) => overrides.get(textOverrideKey(lang, key)) ?? defaultText(key)[i];
    let keys = allKeys().filter((k) => sectionOf(k) === current);
    if (q) {
      const needle = q.toLowerCase();
      keys = allKeys().filter((k) => k.toLowerCase().includes(needle) || LANGS.some((l, i) => String(eff(k, l, i)).toLowerCase().includes(needle)));
    }
    send(res, textsPage(ctxOf(req), { sections: secs, current, q, rows: rowsFor(keys, eff), overridden: overriddenKeys(), flash, error, values }), status);
  }

  r.get('/texts', (req, res) => view(req, res, { section: String(req.query.section ?? ''), q: String(req.query.q ?? '').trim().slice(0, 60), flash: req.query.ok === 'saved' ? 'Testi salvati.' : '' }));

  r.post('/texts', form, (req, res) => {
    const keys = String(req.body.keys ?? '').split(/\s+/).filter((k) => defaultText(k));
    const problems = [];
    const changes = [];
    for (const key of keys) {
      const values = {};
      LANGS.forEach((l, i) => {
        const v = req.body[`t__${key}__${l}`];
        if (v === undefined) return;
        const text = String(v).replace(/\r\n/g, '\n').trim();
        // i segnaposto del testo originale si possono togliere (il valore semplicemente non compare), ma non se ne possono inventare
        const allowed = placeholders(defaultText(key)[i]);
        const unknown = placeholders(text).filter((p) => !allowed.includes(p));
        if (text && unknown.length) problems.push(`${key} (${l}): le parti tra graffe {${unknown.join('}, {')}} non esistono in questo testo${allowed.length ? ` (puoi usare solo {${allowed.join('}, {')}})` : ' (questo testo non ne ha)'}`);
        values[l] = text.slice(0, 3000);
      });
      changes.push([key, values]);
    }
    if (problems.length) return view(req, res, { values: req.body, error: problems.join(' · '), status: 400, section: String(req.body.section ?? ''), q: String(req.body.q ?? '') });
    try {
      for (const [key, values] of changes) app.content.setTexts(key, values);
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
      return view(req, res, { values: req.body, error: err.detail, status: 400, section: String(req.body.section ?? ''), q: String(req.body.q ?? '') });
    }
    const q = String(req.body.q ?? '');
    res.redirect(303, `/admin/texts?${q ? `q=${encodeURIComponent(q)}` : `section=${encodeURIComponent(String(req.body.section ?? ''))}`}&ok=saved`);
  });

  return r;
}
