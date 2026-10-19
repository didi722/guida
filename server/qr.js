// Codice QR (ISO/IEC 18004) disegnato in SVG, senza librerie: modalità «byte», correzione d'errore M, versioni 1–10 (fino a 213 byte).
// Serve a mostrare la chiave dell'accesso a due passaggi: l'app di autenticazione la inquadra dallo schermo.

const MAX_VERSION = 10;
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; // parole di correzione per blocco, livello M
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // numero di blocchi, livello M

/** I moduli che portano dati (e correzione): tutto tranne i disegni fissi. */
function rawModules(version) {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}
const dataWords = (version) => Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];

// ───────────── Reed–Solomon su GF(256), polinomio 0x11D ─────────────
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisorOf(degree) {
  const poly = new Array(degree).fill(0);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = mul(poly[j], root);
      if (j + 1 < degree) poly[j] ^= poly[j + 1];
    }
    root = mul(root, 2);
  }
  return poly;
}

function remainderOf(data, divisor) {
  const rest = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ rest.shift();
    rest.push(0);
    divisor.forEach((coef, i) => {
      rest[i] ^= mul(coef, factor);
    });
  }
  return rest;
}

// ───────────── dati → parole di codice ─────────────
function encodeData(bytes, version) {
  const bits = [];
  const push = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // modalità «byte»
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataWords(version) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminatore
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  return words;
}

/** Spezza in blocchi, aggiunge la correzione a ciascuno e li intreccia. */
function withEcc(data, version) {
  const blocks = BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = divisorOf(eccLen);
  const list = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const part = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += part.length;
    const ecc = remainderOf(part, divisor);
    if (i < shortBlocks) part.push(0); // allinea ai blocchi lunghi
    list.push(part.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < list[0].length; i++) {
    list.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
    });
  }
  return out;
}

// ───────────── la matrice ─────────────
function alignmentPositions(version) {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const pos = [6];
  for (let p = version * 4 + 10; pos.length < n; p -= step) pos.splice(1, 0, p);
  return pos;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const bit = (value, i) => ((value >>> i) & 1) === 1;

/** Le penalità della norma (righe uguali, blocchi 2×2, disegni simili ai tre quadrati, equilibrio chiaro/scuro): si sceglie la maschera che ne ha meno. */
function penalty(m, size) {
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 11 <= size; i++) {
      const w = line.slice(i, i + 11).map(Number).join('');
      if (w === '10111010000' || w === '00001011101') score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
  score += (Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1) * 10;
  return score;
}

function matrixFor(bytes, version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => {
    m[y][x] = dark;
    fixed[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0); // linee di sincronismo
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = alignmentPositions(version);
  pos.forEach((cy, i) =>
    pos.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return; // sotto i tre quadrati
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );

  const formatBits = (mask) => {
    const data = mask; // livello M = 00, poi i tre bit della maschera
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  };
  const drawFormat = (mask) => {
    const bits = formatBits(mask);
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i));
    set(8, 7, bit(bits, 6));
    set(8, 8, bit(bits, 7));
    set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
    set(8, size - 8, true); // il modulo sempre scuro
  };
  drawFormat(0); // intanto si riservano le zone del formato
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }

  // i dati, a zig-zag da destra a sinistra, due colonne alla volta
  const words = withEcc(encodeData(bytes, version), version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < words.length * 8) {
          m[y][x] = bit(words[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const apply = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    apply(mask);
    drawFormat(mask);
    const score = penalty(m, size);
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    apply(mask); // si toglie: è uno XOR
  }
  apply(best);
  drawFormat(best);
  return m;
}

/** I moduli del codice (true = scuro) per un testo, con la versione più piccola che lo contiene. */
export function qrMatrix(text) {
  const bytes = [...Buffer.from(String(text), 'utf8')];
  for (let version = 1; version <= MAX_VERSION; version++) {
    const ccBits = version <= 9 ? 8 : 16;
    if (4 + ccBits + bytes.length * 8 <= dataWords(version) * 8) return matrixFor(bytes, version);
  }
  throw new RangeError('Testo troppo lungo per il codice QR');
}

/**
 * Il codice come immagine SVG: scuro su bianco con il bordo bianco di quattro moduli richiesto dalla norma
 * (anche nel tema scuro: i lettori vogliono il contrasto giusto).
 */
export function qrSvg(text, { label = 'Codice QR', size = 232 } = {}) {
  const m = qrMatrix(text);
  const n = m.length;
  const quiet = 4;
  let path = '';
  m.forEach((row, y) => {
    for (let x = 0; x < n; ) {
      if (!row[x]) {
        x++;
        continue;
      }
      let len = 1;
      while (x + len < n && row[x + len]) len++;
      path += `M${x + quiet} ${y + quiet}h${len}v1h-${len}z`;
      x += len;
    }
  });
  const total = n + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" role="img" aria-label="${label.replace(/[&<>"]/g, '')}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
