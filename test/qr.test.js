// Codice QR per la chiave dei due passaggi. Gli esempi qui sotto sono stati letti con un decodificatore indipendente (jsQR) per tutte le
// lunghezze da 1 a 213 byte, cioè su tutte le versioni 1–10: i test fissano ciò che è stato verificato e controllano la struttura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { qrMatrix, qrSvg } from '../server/qr.js';

const sha = (m) => crypto.createHash('sha256').update(m.map((row) => row.map((v) => (v ? '1' : '0')).join('')).join('')).digest('hex').slice(0, 16);
const URI = 'otpauth://totp/Davide%20Tomio:Pannello%40www.example.it?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Davide%20Tomio&algorithm=SHA1&digits=6&period=30';

test('la versione è la più piccola che contiene il testo (livello M)', () => {
  // capacità in byte: 14, 26, 42, 62, 84, 106, 122, 152, 180, 213
  const caps = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  caps.forEach((cap, i) => {
    assert.equal(qrMatrix('a'.repeat(cap)).length, 21 + 4 * i, `${cap} byte stanno nella versione ${i + 1}`);
    if (i + 1 < caps.length) assert.equal(qrMatrix('a'.repeat(cap + 1)).length, 21 + 4 * (i + 1), `${cap + 1} byte passano alla versione ${i + 2}`);
  });
  assert.throws(() => qrMatrix('a'.repeat(214)), RangeError);
  assert.equal(qrMatrix('è').length, 21, 'si conta in byte UTF-8, non in lettere');
  assert.equal(qrMatrix('è'.repeat(8)).length, 25, 'sedici byte non stanno più nella versione 1');
});

test('struttura: tre quadrati d’angolo, sincronismo, modulo scuro e informazioni di formato valide', () => {
  for (const text of ['HELLO WORLD', URI, 'x'.repeat(150)]) {
    const m = qrMatrix(text);
    const n = m.length;
    const finder = (x0, y0) => {
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        assert.equal(m[y0 + dy][x0 + dx], ring !== 2, `quadrato in ${x0},${y0} modulo ${dx},${dy}`);
      }
    };
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
    for (let i = 8; i < n - 8; i++) {
      assert.equal(m[6][i], i % 2 === 0, 'sincronismo orizzontale');
      assert.equal(m[i][6], i % 2 === 0, 'sincronismo verticale');
    }
    assert.equal(m[n - 8][8], true, 'il modulo sempre scuro');
    // le informazioni di formato: 15 bit, scritte due volte, che devono essere uno dei 8 codici BCH (livello M) con la maschera
    const first = [...[0, 1, 2, 3, 4, 5].map((i) => m[i][8]), m[7][8], m[8][8], m[8][7], ...[9, 10, 11, 12, 13, 14].map((i) => m[8][14 - i])];
    const second = [...Array.from({ length: 8 }, (_, i) => m[8][n - 1 - i]), ...Array.from({ length: 7 }, (_, i) => m[n - 7 + i][8])];
    const bitsOf = (list) => list.reduce((v, b, i) => v | ((b ? 1 : 0) << i), 0);
    assert.equal(bitsOf(first), bitsOf(second), 'le due copie coincidono');
    const valid = new Set(Array.from({ length: 8 }, (_, mask) => {
      let rem = mask;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      return ((mask << 10) | rem) ^ 0x5412;
    }));
    assert.ok(valid.has(bitsOf(first)), 'formato: livello M e una maschera valida');
  }
});

test('è deterministico e coincide con le matrici lette dal decodificatore', () => {
  assert.equal(sha(qrMatrix('HELLO WORLD')), 'f516d851861750f4');
  assert.equal(sha(qrMatrix(URI)), '36589dfc11f65053');
  assert.equal(sha(qrMatrix('x'.repeat(150))), '1336208e16162851');
  assert.deepEqual(qrMatrix(URI), qrMatrix(URI));
  assert.notEqual(sha(qrMatrix(URI)), sha(qrMatrix(URI.replace('GEZD', 'GEZE'))));
});

test('SVG: scuro su bianco con bordo, senza script né stili, etichetta ripulita', () => {
  const svg = qrSvg(URI, { label: 'Codice <QR> & "chiave"' });
  const n = qrMatrix(URI).length;
  assert.match(svg, new RegExp(`^<svg [^>]*viewBox="0 0 ${n + 8} ${n + 8}"`));
  assert.match(svg, /role="img" aria-label="Codice QR  chiave"/);
  assert.match(svg, /<rect [^>]*fill="#fff"\/>/);
  assert.match(svg, /<path d="M[^"]+" fill="#000"\/>/);
  assert.doesNotMatch(svg, /<script|style=|onload|href/i);
  // i moduli scuri nel tracciato sono tanti quanti nella matrice
  const dark = qrMatrix(URI).flat().filter(Boolean).length;
  const drawn = [...svg.matchAll(/h(\d+)v1h-\1z/g)].reduce((s, m) => s + Number(m[1]), 0);
  assert.equal(drawn, dark);
});
