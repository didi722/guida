import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';
import { allKeys, makeT } from '../server/i18n.js';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

test('ogni chiave t(...) usata nel codice esiste in italiano e in inglese', () => {
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
    'b2b.bst.{}': ['confirmed', 'held', 'cancelled', 'expired'], 'pay.{}.title': ['card', 'onsite', 'invoice'], 'pay.{}.desc': ['card', 'onsite', 'invoice'], 'pay.{}.cta': ['card', 'onsite', 'invoice'],
    'lang.{}': ['it', 'en'], 'booking.flash.{}': ['cancelled', 'cancel-error'],
  };
  for (const [pattern, values] of Object.entries(families)) for (const v of values) assert.ok(keys.has(pattern.replace('{}', v)), `manca ${pattern.replace('{}', v)}`);
});

test('segnaposto {x} coerenti tra italiano e inglese', () => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'strings.json'), 'utf8'));
  for (const [k, [it, en]] of Object.entries(dict)) {
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(ph(it), ph(en), `segnaposto diversi in ${k}`);
    assert.ok(it && en, `traduzione vuota in ${k}`);
  }
  assert.equal(makeT('en')('tour.upTo', { n: 12 }), 'up to 12 guests');
  assert.equal(makeT('it')('tour.upTo', { n: 12 }), 'fino a 12 persone');
});
