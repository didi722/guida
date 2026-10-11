// Mini sistema di template con escaping automatico: ogni valore interpolato viene
// escapato, salvo che sia già "raw" (cioè output di un altro template).

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => new Safe(String(s));
export const isSafe = (v) => v instanceof Safe;

function render(v) {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}

/** JSON sicuro da inserire dentro un attributo HTML. */
export const jsonAttr = (obj) => esc(JSON.stringify(obj));

/** JSON sicuro da inserire dentro <script type="application/ld+json">. */
export const jsonLd = (obj) => raw(JSON.stringify(obj).replace(/</g, '\\u003c'));
