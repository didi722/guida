import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';
import YAML from 'yaml';
import { allKeys, makeT } from '../server/i18n.js';
import { LANGS, LANG_META, localeOf, normLang, pick } from '../server/langs.js';
import { loadContent } from '../server/content.js';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

test('ogni chiave t(...) usata nel codice esiste nel dizionario', () => {
  const keys = new Set(allKeys());
  const used = new Set();
  for (const f of walk(path.join(ROOT, 'server'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !keys.has(k));
  assert.deepEqual(missing, []);
  // famiglie di chiavi costruite dinamicamente (t(`prefisso.${x}`))
  const families = {
    'faq.{}.q': ['how', 'cancel', 'pay', 'meet', 'rain', 'access'], 'faq.{}.a': ['how', 'cancel', 'pay', 'meet', 'rain', 'access'],
    'why.{}.t': [1, 2, 3], 'why.{}.p': [1, 2, 3], 'how.{}.t': [1, 2, 3], 'how.{}.p': [1, 2, 3], 'home.b2b.{}': [1, 2, 3, 4],
    'b2b.b{}.t': [1, 2, 3, 4, 5, 6], 'b2b.b{}.p': [1, 2, 3, 4, 5, 6], 'b2b.s{}.t': [1, 2, 3, 4], 'b2b.s{}.p': [1, 2, 3, 4],
    'b2b.faq{}.q': [1, 2, 3, 4], 'b2b.faq{}.a': [1, 2, 3, 4], 'b2b.st.{}': ['pending', 'approved', 'rejected', 'suspended'], 'b2b.st.{}.text': ['pending', 'approved', 'rejected', 'suspended'],
    'b2b.bst.{}': ['confirmed', 'held', 'cancelled', 'expired', 'option', 'optionExpired'], 'partner.tab.{}': ['upcoming', 'options', 'past', 'cancelled', 'all'], 'option.err.{}': ['disabled', 'tooClose', 'limit'], 'pay.{}.title': ['card', 'onsite', 'invoice'], 'pay.{}.desc': ['card', 'onsite', 'invoice'], 'pay.{}.cta': ['card', 'onsite', 'invoice'],
    'lang.{}': LANGS, 'booking.flash.{}': ['cancelled', 'cancel-error', 'option-confirmed', 'option-released', 'option-expired', 'option-error', 'edited', 'edit-error', 'edit-locked'],
  };
  for (const [pattern, values] of Object.entries(families)) for (const v of values) assert.ok(keys.has(pattern.replace('{}', v)), `manca ${pattern.replace('{}', v)}`);
});

test('ogni testo ha una traduzione per ogni lingua e i segnaposto {x} coincidono', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'strings.json'), 'utf8'));
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const tags = (s) => [...s.matchAll(/<\/?[a-z][^>]*>|&[a-z]+;/gi)].map((m) => m[0]).join('');
  for (const [k, cols] of Object.entries(dict)) {
    assert.equal(cols.length, LANGS.length, `${k}: servono ${LANGS.length} lingue`);
    cols.forEach((c, i) => assert.ok(typeof c === 'string' && c.trim(), `traduzione vuota in ${k} (${LANGS[i]})`));
    cols.forEach((c, i) => {
      assert.equal(ph(c), ph(cols[0]), `segnaposto diversi in ${k} (${LANGS[i]})`);
      assert.equal(tags(c), tags(cols[0]), `tag HTML diversi in ${k} (${LANGS[i]})`);
    });
  }
  assert.equal(makeT('en')('tour.upTo', { n: 12 }), 'up to 12 guests');
  assert.equal(makeT('it')('tour.upTo', { n: 12 }), 'fino a 12 persone');
  assert.match(makeT('es')('tour.upTo', { n: 12 }), /12/);
  assert.notEqual(makeT('es')('tour.upTo', { n: 12 }), makeT('en')('tour.upTo', { n: 12 }));
});

test('lingue: ripiego su inglese e italiano, lingua non valida → italiano', () => {
  assert.deepEqual(LANGS, ['it', 'en', 'es', 'ja']);
  assert.equal(normLang('es'), 'es');
  assert.equal(normLang('xx'), 'it');
  assert.equal(normLang(undefined), 'it');
  assert.equal(normLang('constructor'), 'it', 'niente chiavi ereditate dall’oggetto');
  assert.equal(localeOf('es'), 'es-ES');
  assert.equal(LANG_META.es.stripe, 'es');
  assert.equal(localeOf('ja'), 'ja-JP');
  assert.equal(LANG_META.ja.stripe, 'ja');
  assert.equal(normLang('ja'), 'ja');
  assert.equal(pick({ it: 'a', en: 'b' }, 'ja'), 'b');
  assert.equal(pick({ it: 'a', en: 'b', ja: 'd' }, 'ja'), 'd');
  assert.equal(makeT('ja')('nav.tours'), 'ツアー');
  assert.equal(makeT('ja')('tour.upTo', { n: 12 }), '12名まで');
  assert.equal(pick({ it: 'a', en: 'b' }, 'es'), 'b');
  assert.equal(pick({ it: 'a' }, 'es'), 'a');
  assert.equal(pick({ it: 'a', en: 'b', es: 'c' }, 'es'), 'c');
  assert.equal(makeT('xx')('nav.tours'), makeT('it')('nav.tours'), 'lingua sconosciuta: italiano');
});

test('contenuti: ogni tour, articolo e pagina esiste anche in spagnolo e in giapponese (e i tour li offrono come lingue)', () => {
  const c = loadContent(ROOT);
  for (const t of c.tours) {
    for (const l of ['es', 'ja']) {
      assert.ok(t.languages.includes(l), `${t.slug}: lingue del tour (${l})`);
      assert.notEqual(t.i18n[l].summary, t.i18n.en.summary, `${t.slug}: riassunto ${l} uguale all'inglese (traduzione mancante?)`);
    }
    assert.match(t.i18n.ja.summary, /[\u3040-\u30ff\u4e00-\u9fff]/, `${t.slug}: il riassunto giapponese contiene giapponese`);
  }
  const rawTours = fs.readdirSync(path.join(ROOT, 'content', 'tours')).filter((f) => f.endsWith('.yml'));
  for (const f of rawTours) {
    const y = YAML.parse(fs.readFileSync(path.join(ROOT, 'content', 'tours', f), 'utf8'));
    for (const l of ['es', 'ja']) assert.ok(y[l]?.title, `${f}: manca il blocco ${l}`);
    assert.deepEqual(Object.keys(y.ja ?? {}).sort(), Object.keys(y.it).sort(), `${f}: il blocco ja ha le stesse chiavi dell'italiano`);
  }
  for (const p of c.posts) assert.deepEqual(Object.keys(p.i18n).sort(), [...LANGS].sort(), `articolo ${p.slug}`);
  for (const name of ['about', 'cookies', 'privacy', 'terms']) {
    for (const l of LANGS) assert.ok(c.page(name, l)?.html, `pagina ${name} (${l})`);
    const ph = (l) => [...fs.readFileSync(path.join(ROOT, 'content', 'pages', `${name}.${l}.md`), 'utf8').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(ph('es'), ph('it'), `${name}: segnaposto {{…}} diversi in spagnolo`);
    assert.equal(ph('ja'), ph('it'), `${name}: segnaposto {{…}} diversi in giapponese`);
  }
});
