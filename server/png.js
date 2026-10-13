// Un minuscolo codificatore PNG e il disegno del logo del sito (lo stesso di public/img/favicon.svg) a qualsiasi misura.
// Serve ai pass per il wallet del telefono, che vogliono immagini PNG: così non c'è nessun file binario da tenere nel repository.
import zlib from 'node:zlib';

/** PNG a colori con trasparenza (8 bit per canale) da un buffer RGBA. */
export function encodePng(width, height, rgba) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8 bit, RGBA, nessuna interlacciatura
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro «nessuno»
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Il disegno, in uno spazio 64 × 64: quadrato arrotondato dorato con onda, arco e puntino (vedi favicon.svg)
const GOLD = [214, 187, 81];
const INK = [28, 28, 28];
const bezier = (p0, p1, p2, p3, n = 24) => Array.from({ length: n + 1 }, (_, i) => {
  const t = i / n;
  const u = 1 - t;
  return [u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0], u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]];
});
const WAVE = [...bezier([14, 44], [22, 44], [24, 40], [32, 40]), ...bezier([32, 40], [40, 40], [42, 44], [50, 44]).slice(1)];
const ARCH = [[24, 36], [24, 22], ...Array.from({ length: 25 }, (_, i) => { const a = (i / 24) * Math.PI; return [32 - 8 * Math.cos(a), 22 - 8 * Math.sin(a)]; }).slice(1), [40, 36]];
const STROKE = 1.75; // metà dello spessore (3,5)

/** Il punto è a meno di `r` dalla spezzata? (con un controllo veloce sul riquadro che la contiene: quasi tutti i punti sono lontani) */
function near(x, y, line, r) {
  const { pts, box } = line;
  if (x < box[0] - r || x > box[2] + r || y < box[1] - r || y > box[3] + r) return false;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= r) return true;
  }
  return false;
}
const line = (pts) => ({ pts, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] });
const LINES = [line(WAVE), line(ARCH)];
function insideRoundedSquare(x, y, r = 14) {
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

const cache = new Map();
/** Il logo del sito come PNG quadrato di `size` pixel (con i bordi sfumati); si disegna una volta per misura. */
export function brandIcon(size) {
  if (!cache.has(size)) cache.set(size, drawIcon(size));
  return cache.get(size);
}

function drawIcon(size) {
  const N = 3; // campioni per lato di pixel
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = ((px + (sx + 0.5) / N) * 64) / size;
          const y = ((py + (sy + 0.5) / N) * 64) / size;
          if (!insideRoundedSquare(x, y)) continue;
          const ink = LINES.some((l) => near(x, y, l, STROKE)) || Math.hypot(x - 32, y - 14) <= 2.5;
          const c = ink ? INK : GOLD;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
        rgba[i + 3] = Math.round((a / (N * N)) * 255);
      }
    }
  }
  return encodePng(size, size, rgba);
}
