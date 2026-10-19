// Documenti PDF: voucher di prenotazione, buono regalo, proposta di programma (e, in invoice.js, la copia di cortesia della fattura).
// Si usa PDFKit con il Josefin Sans del sito. Il font ha solo i glifi latini di base: i testi dei clienti passano da fold().
// Per il giapponese (e per nomi scritti con ideogrammi o kana) si passa a Noto Sans JP, incorporato nel PDF: vedi server/fonts.
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { brandOf } from './agencyDocs.js';
import { bookingDue, cancellationState } from './bookings.js';
import { ROOT } from './config.js';
import { makeT } from './i18n.js';
import { LANG_META, localeOf, normLang, pick } from './langs.js';
import { timeRange } from './rates.js';
import { isSimplePolicy, tierSentences } from './policyText.js';
import { formatGiftCode } from './pricing.js';
import { fmtDate, fmtInstant, nowRome } from './time.js';
import { formatMoney } from './util.js';
import { meetingOf, themeText } from './choices.js';

export const PAGE = { w: 595.28, h: 841.89, m: 48 };
export const CW = PAGE.w - PAGE.m * 2; // larghezza utile
export const COLORS = { band: '#dfca77', gold: '#d6bb51', bronze: '#af9168', ink: '#1c1c1c', text: '#333333', muted: '#6a6a6a', line: '#e7e2d6', soft: '#fbf8f1', ok: '#2f7d4f', err: '#b3362b' };
const C = COLORS;

// ───────────── font e testo ─────────────
const FONT_DIR = path.join(ROOT, 'node_modules', '@fontsource', 'josefin-sans', 'files');
const FONT_FILES = { R: '400-normal', L: '300-normal', B: '700-normal', I: '400-italic' };
let fontBuffers = null;
const loadFonts = () => (fontBuffers ??= Object.fromEntries(Object.entries(FONT_FILES).map(([k, f]) => [k, fs.readFileSync(path.join(FONT_DIR, `josefin-sans-latin-${f}.woff`))])));

// Glifi presenti nel sottoinsieme latino di Josefin Sans (ASCII, Latin-1, punteggiatura generale, €, ™):
// bastano per italiano, inglese e spagnolo (ñ Ñ á é í ó ú ü ¿ ¡ « » “ ” ‘ ’ – — € º ª).
// Kana, ideogrammi, punteggiatura e forme a larghezza intera si lasciano passare: li disegna Noto Sans JP (vedi useJapaneseFont).
const CJK_RANGES = '\\u2E80-\\u2FDF\\u3000-\\u30FF\\u31F0-\\u31FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFFEF\\u{20000}-\\u{2FFFF}';
const CJK = new RegExp(`[${CJK_RANGES}]`, 'u');
const SUPPORTED = new RegExp(`[\\u0020-\\u007E\\u00A0-\\u00FF\\u0131\\u0152\\u0153\\u2010-\\u2027\\u2030-\\u203A\\u20AC\\u2122\\u2212\\n${CJK_RANGES}]`, 'u');
const REPLACEMENTS = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T', '→': '-', '←': '-', '↔': '-', '✓': '', '✔': '', '★': '*', '☆': '*' };

/**
 * Adatta un testo ai glifi del font: toglie gli accenti non disponibili (ł→l, č→c…), scarta emoji e simboli, mette «?» al posto di alfabeti non latini
 * (tranne giapponese e ideogrammi, che il PDF disegna con Noto Sans JP).
 * Prima compone le lettere accentate (NFC): «ñ» scritta come n + tilde combinata (capita con certe tastiere e con il copia-incolla) resta «ñ».
 */
export function fold(input) {
  let out = '';
  for (const ch of String(input ?? '').normalize('NFC').replace(/\r\n?/g, '\n')) {
    if (SUPPORTED.test(ch)) out += ch;
    else if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
    else {
      const base = ch.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
      if (base && base !== ch && [...base].every((c) => SUPPORTED.test(c))) out += base;
      else if (/\p{L}/u.test(ch)) out += '?';
      // il resto (emoji, simboli, caratteri di controllo e di formattazione) si scarta
    }
  }
  return out.trim();
}

// ───────────── giapponese ─────────────
// Noto Sans JP (Regular e Bold, licenza OFL), ridotto ai caratteri che servono: kana, punteggiatura, latino e circa 8.800 ideogrammi
// (JIS X 0213, livelli 1-3). Si legge e si incorpora solo se un testo lo richiede; il PDF contiene solo i glifi usati.
const JP_FILES = { JR: 'NotoSansJP-Regular.subset.ttf', JB: 'NotoSansJP-Bold.subset.ttf' };
let jpBuffers = null;
const loadJapanese = () => (jpBuffers ??= Object.fromEntries(Object.entries(JP_FILES).map(([name, file]) => [name, fs.readFileSync(path.join(ROOT, 'server', 'fonts', file))])));

/**
 * Per ogni testo con kana o ideogrammi usa Noto Sans JP al posto del font scelto (grassetto resta grassetto), solo per quella chiamata;
 * tutto il resto continua con Josefin Sans. Vale per text(), widthOfString() e heightOfString(), così le misure restano coerenti.
 */
function useJapaneseFont(doc) {
  let current = 'R';
  let inside = false;
  let registered = false;
  const setFont = doc.font.bind(doc);
  doc.font = (name, ...rest) => {
    if (typeof name === 'string') current = name;
    return setFont(name, ...rest);
  };
  for (const method of ['text', 'widthOfString', 'heightOfString']) {
    const original = doc[method].bind(doc);
    doc[method] = (str, ...args) => {
      if (inside || typeof str !== 'string' || !CJK.test(str)) return original(str, ...args);
      if (!registered) {
        for (const [name, buf] of Object.entries(loadJapanese())) doc.registerFont(name, buf);
        registered = true;
      }
      const previous = current;
      inside = true;
      try {
        setFont(previous === 'B' ? 'JB' : 'JR');
        // la spaziatura larga tra le lettere (etichette in maiuscolo) non ha senso con i caratteri giapponesi
        return original(str, ...args.map((a) => (a && typeof a === 'object' && a.characterSpacing > 0.5 ? { ...a, characterSpacing: 0.5 } : a)));
      } finally {
        setFont(previous);
        inside = false;
      }
    };
  }
}

// ───────────── documento ─────────────
/**
 * `brand` (facoltativo) è il marchio di un'agenzia: { mode, name, contact, logo: {data, width, height} | null }.
 *  - mode 'cobrand' (voucher): l'intestazione resta quella della guida e il logo dell'agenzia prende il posto dell'etichetta, a destra;
 *  - mode 'agency' (preventivo): l'intestazione è dell'agenzia (logo, nome e recapiti) e a destra c'è l'etichetta del documento.
 */
export function createDoc(app, { title, subject, lang, label, brand = null }) {
  const { site } = app.cfg;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.m, bottom: 66, left: PAGE.m, right: PAGE.m },
    bufferPages: true,
    lang: localeOf(lang),
    info: { Title: fold(title), Author: fold(brand?.mode === 'agency' ? brand.name : site.legalName || site.name), Subject: fold(subject ?? title), Creator: fold(site.name) },
  });
  for (const [name, buf] of Object.entries(loadFonts())) doc.registerFont(name, buf);
  useJapaneseFont(doc);
  doc.page.margins.top = PAGE.m;
  drawHeader(doc, app, lang, label, { brand });
  // le pagine successive hanno un'intestazione compatta
  doc.on('pageAdded', () => {
    drawHeader(doc, app, lang, label, { compact: true, brand });
  });
  return doc;
}

/** Il logo dell'agenzia in un riquadro bianco con gli angoli arrotondati; restituisce le misure del riquadro. */
function drawLogoBox(doc, logo, x, y, { maxW, maxH, right = false }) {
  const k = Math.min(maxW / logo.width, maxH / logo.height, 1.5);
  const w = logo.width * k;
  const h = logo.height * k;
  const pad = 7;
  const bx = right ? x - w - pad * 2 : x;
  try {
    doc.save();
    doc.roundedRect(bx, y, w + pad * 2, h + pad * 2, 7).fill('#ffffff');
    doc.image(logo.data, bx + pad, y + pad, { width: w, height: h });
    doc.restore();
  } catch {
    doc.restore(); // un logo che non si legge non deve impedire di stampare il documento
  }
  return { w: w + pad * 2, h: h + pad * 2 };
}

function drawHeader(doc, app, lang, label, { compact = false, brand = null } = {}) {
  const { site } = app.cfg;
  const h = compact ? 52 : 86;
  const agency = brand?.mode === 'agency';
  doc.save();
  doc.rect(0, 0, PAGE.w, h).fill(C.band);
  if (agency) {
    // intestazione dell'agenzia: logo (solo sulla prima pagina), nome e recapiti
    let x = PAGE.m;
    if (!compact && brand.logo) x += drawLogoBox(doc, brand.logo, PAGE.m, 14, { maxW: 150, maxH: 44 }).w + 14;
    doc.fillColor(C.ink).font('B').fontSize(compact ? 14 : 18).text(fold(brand.name), x, compact ? 18 : 25, { width: CW - (x - PAGE.m) - 130, lineBreak: false, ellipsis: true });
    if (!compact && brand.contact) doc.font('R').fontSize(8.5).text(fold(brand.contact), x, 52, { width: CW - (x - PAGE.m) - 130, lineBreak: false, ellipsis: true });
    doc.fillColor(C.ink).font('B').fontSize(compact ? 8 : 9).text(fold(String(label).toUpperCase()), PAGE.m, compact ? 21 : 37, { width: CW, align: 'right', characterSpacing: 1.4, lineBreak: false });
  } else {
    doc.fillColor(C.ink).font('B').fontSize(compact ? 14 : 21).text(fold(site.name), PAGE.m, compact ? 18 : 26, { lineBreak: false });
    if (!compact) doc.font('R').fontSize(8.5).text(fold(pick(site.tagline, lang).toUpperCase()), PAGE.m, 54, { characterSpacing: 1.2, lineBreak: false });
    if (!compact && brand?.logo) drawLogoBox(doc, brand.logo, PAGE.w - PAGE.m, 14, { maxW: 150, maxH: 44, right: true });
    else doc.font('B').fontSize(compact ? 8 : 9).text(fold(String(label).toUpperCase()), PAGE.m, compact ? 21 : 37, { width: CW, align: 'right', characterSpacing: 1.4, lineBreak: false });
  }
  doc.restore();
  doc.x = PAGE.m;
  doc.y = h + (compact ? 24 : 30);
}

/** Aggiunge il piè di pagina (dati d'impresa, numero di pagina) a tutte le pagine e restituisce il PDF. `lines`: le due righe da usare al posto dei dati della guida. */
export function finishDoc(doc, app, lang, { lines = null } = {}) {
  const t = makeT(lang);
  const { site } = app.cfg;
  const vat = site.vatNumber ? `${pick({ it: 'P.IVA', en: 'VAT no.', es: 'N.º IVA', ja: 'VAT番号' }, lang)} ${site.vatNumber}` : '';
  const line1 = lines ? lines[0] : [site.legalName || site.name, vat, site.guideLicense].filter(Boolean).join('  ·  ');
  const line2 = lines ? lines[1] : [site.address, site.email, site.phone].filter(Boolean).join('  ·  ');
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = PAGE.h - 60;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // senza questo scrivere nel margine inferiore aggiungerebbe una pagina
    doc.save();
    doc.moveTo(PAGE.m, y).lineTo(PAGE.w - PAGE.m, y).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font('R').fontSize(8).fillColor(C.muted);
    doc.text(fold(line1), PAGE.m, y + 9, { width: CW - 90, lineBreak: false });
    doc.text(fold(line2), PAGE.m, y + 21, { width: CW - 90, lineBreak: false });
    if (range.count > 1) doc.text(t('pdf.page', { n: i + 1, total: range.count }), PAGE.m, y + 9, { width: CW, align: 'right', lineBreak: false });
    doc.restore();
    doc.page.margins.bottom = bottom;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ───────────── componenti ─────────────
export const ensure = (doc, h) => {
  if (doc.y + h > PAGE.h - doc.page.margins.bottom) doc.addPage();
};

/** Occhiello (bronzo, spaziato) + titolo + sottotitolo. */
export function title(doc, eyebrow, text, subtitle) {
  doc.font('R').fontSize(9).fillColor(C.bronze).text(fold(String(eyebrow).toUpperCase()), PAGE.m, doc.y, { width: CW, characterSpacing: 1.6 });
  doc.moveDown(0.35);
  doc.font('B').fontSize(24).fillColor(C.ink).text(fold(text), PAGE.m, doc.y, { width: CW, lineGap: 1 });
  if (subtitle) {
    doc.moveDown(0.15);
    doc.font('L').fontSize(12.5).fillColor(C.muted).text(fold(subtitle), PAGE.m, doc.y, { width: CW });
  }
  doc.moveDown(0.7);
}

export function sectionTitle(doc, text) {
  ensure(doc, 40);
  doc.moveDown(0.4);
  doc.font('B').fontSize(9).fillColor(C.bronze).text(fold(String(text).toUpperCase()), PAGE.m, doc.y, { width: CW, characterSpacing: 1.4 });
  doc.moveDown(0.45);
}

/**
 * Righe «etichetta / valore» con filetto. items: [label, value, {bold?, color?, sub?: {text, url}}]
 * (`sub` aggiunge sotto il valore un collegamento cliccabile con un testo breve).
 */
export function keyValueRows(doc, items, { labelW = 138, pad = 6 } = {}) {
  for (const [label, value, o = {}] of items) {
    if (value == null || value === '') continue;
    const text = fold(value);
    doc.font(o.bold ? 'B' : 'R').fontSize(11);
    const hText = Math.max(doc.heightOfString(text, { width: CW - labelW }), 14);
    // un'etichetta lunga (in spagnolo capita) va a capo: la riga deve essere alta abbastanza da contenerla
    const hLabel = doc.font('R').fontSize(7.5).heightOfString(fold(String(label).toUpperCase()), { width: labelW - 12, characterSpacing: 0.8 }) + 3.5;
    const h = Math.max(hText, hLabel) + (o.sub ? 15 : 0);
    ensure(doc, h + pad * 2 + 4);
    const y = doc.y;
    doc.font('R').fontSize(7.5).fillColor(C.muted).text(fold(String(label).toUpperCase()), PAGE.m, y + 3.5, { width: labelW - 12, characterSpacing: 0.8 });
    doc.font(o.bold ? 'B' : 'R').fontSize(11).fillColor(o.color ?? C.ink).text(text, PAGE.m + labelW, y, { width: CW - labelW });
    if (o.sub) doc.font('R').fontSize(9.5).fillColor(C.bronze).text(fold(o.sub.text), PAGE.m + labelW, y + hText + 2, { width: CW - labelW, link: o.sub.url, underline: true });
    const end = y + h + pad;
    doc.moveTo(PAGE.m, end).lineTo(PAGE.m + CW, end).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.x = PAGE.m;
    doc.y = end + pad;
  }
}

/** Riquadro con fondo chiaro e testo. */
export function box(doc, { label, text, bold = false, color = C.ink, size = 11 }) {
  const pad = 12;
  doc.font(bold ? 'B' : 'R').fontSize(size);
  const body = fold(text);
  const h = doc.heightOfString(body, { width: CW - pad * 2 });
  const labelH = label ? 14 : 0;
  ensure(doc, h + labelH + pad * 2 + 6);
  const y = doc.y;
  doc.roundedRect(PAGE.m, y, CW, h + labelH + pad * 2, 8).fillAndStroke(C.soft, C.line);
  if (label) doc.font('B').fontSize(7.5).fillColor(C.bronze).text(fold(String(label).toUpperCase()), PAGE.m + pad, y + pad, { width: CW - pad * 2, characterSpacing: 1.1 });
  doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color).text(body, PAGE.m + pad, y + pad + labelH, { width: CW - pad * 2 });
  doc.x = PAGE.m;
  doc.y = y + h + labelH + pad * 2 + 10;
}

function bulletColumns(doc, left, right) {
  const gap = 24;
  const w = (CW - gap) / 2;
  const colHeight = (col) => {
    if (!col?.items?.length) return 0;
    doc.font('R').fontSize(10);
    return 18 + col.items.reduce((a, s) => a + doc.heightOfString(`•  ${fold(s)}`, { width: w }) + 3, 0);
  };
  const h = Math.max(colHeight(left), colHeight(right));
  if (!h) return;
  ensure(doc, Math.min(h, 140));
  const y0 = doc.y;
  [[left, PAGE.m], [right, PAGE.m + w + gap]].forEach(([col, x]) => {
    if (!col?.items?.length) return;
    let y = y0;
    doc.font('B').fontSize(8).fillColor(C.bronze).text(fold(col.title.toUpperCase()), x, y, { width: w, characterSpacing: 1.1 });
    y += 18;
    doc.font('R').fontSize(10).fillColor(C.text);
    for (const s of col.items) {
      const t = `•  ${fold(s)}`;
      doc.text(t, x, y, { width: w });
      y += doc.heightOfString(t, { width: w }) + 3;
    }
  });
  doc.x = PAGE.m;
  doc.y = y0 + h + 8;
}

const link = (doc, url, y = doc.y, size = 10) => {
  doc.font('R').fontSize(size).fillColor(C.bronze).text(url, PAGE.m, y, { width: CW, link: url, underline: true });
  doc.x = PAGE.m;
};

const nowLabel = (lang) => fmtDate(nowRome().date, lang, 'short');

// ───────────── voucher di prenotazione ─────────────
/**
 * Voucher della prenotazione. Per le prenotazioni B2B non mostra prezzi né il link di gestione
 * (si può girare al cliente finale dell'agenzia).
 */
export async function renderVoucherPdf(app, b, { lang: wanted = b.lang, nowMs = Date.now() } = {}) {
  const lang = normLang(wanted);
  const t = makeT(lang);
  const { cfg } = app;
  const tour = app.content.tour(b.tour_slug);
  const ti = pick(tour.i18n, lang); // senza il blocco della lingua: inglese, poi italiano
  const meet = meetingOf(tour, b, lang);
  const b2b = b.channel === 'b2b';
  const account = b2b && b.account_id ? app.db.prepare('SELECT company FROM accounts WHERE id = ?').get(b.account_id) : null;
  const brand = account ? brandOf(app, b.account_id) : null; // nome, recapiti e logo dell'agenzia (il voucher è per il suo cliente finale)
  const doc = createDoc(app, { title: `${t('voucher.title')} ${b.ref}`, subject: ti.title, lang, label: t('voucher.title'), brand: brand?.logo && brand.logoOnVoucher ? { mode: 'cobrand', logo: brand.logo } : null });

  title(doc, t('voucher.title'), ti.title, ti.subtitle);

  // codice della prenotazione ben visibile
  const y = doc.y;
  doc.roundedRect(PAGE.m, y, CW, 54, 10).lineWidth(1.2).stroke(C.bronze);
  doc.font('R').fontSize(7.5).fillColor(C.muted).text(fold(t('pdf.bookingRef').toUpperCase()), PAGE.m + 16, y + 11, { characterSpacing: 1, lineBreak: false });
  doc.font('B').fontSize(22).fillColor(C.ink).text(b.ref, PAGE.m + 16, y + 24, { characterSpacing: 2, lineBreak: false });
  if (b.status !== 'confirmed') doc.font('B').fontSize(9).fillColor(C.err).text(fold(t(`booking.${b.status}Title`).toUpperCase()), PAGE.m, y + 22, { width: CW - 16, align: 'right', characterSpacing: 1, lineBreak: false });
  doc.x = PAGE.m;
  doc.y = y + 54 + 22;

  const items = [
    [t('s.date'), fmtDate(b.date, lang), { bold: true }],
    [t('s.time'), timeRange(b, lang).replace('–', ' – '), { bold: true }],
    [t('s.guests'), String(b.participants)],
    [t('s.meeting'), meet.text, meet.url ? { sub: { text: t('tour.openMap'), url: meet.url } } : {}],
    ...(themeText(b, lang) ? [[t('f.theme'), themeText(b, lang)]] : []),
    ...(b.tour_lang && LANG_META[b.tour_lang] ? [[t('s.tourLang'), LANG_META[b.tour_lang].name]] : []),
    // sul voucher B2B, che l'agenzia può girare al cliente, non compaiono i recapiti di chi ha prenotato
    [t('s.name'), b2b ? b.name : [b.name, b.email, b.phone].filter(Boolean).join('  ·  ')],
  ];
  if (account) items.push([t('pdf.agency'), brand ? [brand.name, brand.contact].filter(Boolean).join('\n') : account.company]);
  if (b.client_ref) items.push([t('f.clientRef'), b.client_ref]);
  if (b.notes) items.push([t('f.notes'), b.notes]);
  keyValueRows(doc, items);

  // pagamento: solo per i clienti privati
  if (!b2b) {
    const due = bookingDue(b);
    const pay = {
      card: b.payment_status === 'paid' || b.payment_status === 'refunded' ? t('booking.paidOnline') : t('booking.cardPending'),
      onsite: b.payment_status === 'paid' ? t('booking.paidOnline') : t('booking.onsite'),
      invoice: t('booking.invoice'),
      giftcard: t('booking.giftcard'),
      free: t('booking.free'),
    }[b.payment_method];
    sectionTitle(doc, t('pdf.payment'));
    const pricing = [];
    if (b.discount_cents || b.gift_cents) pricing.push([t('s.list'), formatMoney(b.list_cents, lang, b.currency)]);
    if (b.discount_cents) pricing.push([t('booking.discountLine', { code: b.promo_code ?? '' }), `−${formatMoney(b.discount_cents, lang, b.currency)}`]);
    if (b.gift_cents) pricing.push([t('s.giftUsed'), `−${formatMoney(b.gift_cents, lang, b.currency)}`]);
    pricing.push([b.discount_cents || b.gift_cents ? t('s.due') : t('s.total'), `${formatMoney(due, lang, b.currency)}  ·  ${pay}`, { bold: true }]);
    keyValueRows(doc, pricing, { pad: 4 });
    if (b.status === 'confirmed') {
      const st = cancellationState(b, nowMs);
      const policy = !st.everRefundable ? t('checkout.nonRefundable') : isSimplePolicy(st.tiers) ? (st.free ? t('booking.canCancel', { until: fmtInstant(st.until, lang) }) : t('booking.cancelClosed', { until: fmtInstant(st.until, lang) })) : tierSentences(t, lang, st.tiers, st.startsAt).join(' ');
      doc.font('R').fontSize(10).fillColor(C.text).text(fold(policy), PAGE.m, doc.y, { width: CW });
      doc.moveDown(0.6);
    }
  } else {
    doc.moveDown(0.3);
    box(doc, { text: t('pdf.b2bNoPay'), size: 10 });
  }

  sectionTitle(doc, t('pdf.goodToKnow'));
  bulletColumns(doc, { title: t('pdf.included'), items: ti.includes ?? [] }, { title: t('pdf.excluded'), items: ti.excludes ?? [] });
  if (ti.notes) {
    doc.font('R').fontSize(10).fillColor(C.text).text(fold(ti.notes), PAGE.m, doc.y, { width: CW });
    doc.moveDown(0.6);
  }
  box(doc, { text: t('voucher.note'), bold: true, size: 11 });

  const guide = [cfg.site.name, cfg.site.guideLicense].filter(Boolean).join('  ·  ');
  const contact = [cfg.site.email, cfg.site.phone, cfg.site.whatsapp ? `WhatsApp +${cfg.site.whatsapp}` : ''].filter(Boolean).join('  ·  ');
  keyValueRows(doc, [[t('pdf.guideContact'), `${guide}\n${contact}`]]);

  if (!b2b && b.status === 'confirmed') {
    ensure(doc, 26);
    doc.font('R').fontSize(9).fillColor(C.muted).text(fold(t('pdf.manage')), PAGE.m, doc.y, { width: CW });
    link(doc, `${cfg.baseUrl}/${lang}/booking/${b.ref}?t=${b.token}`, doc.y + 1, 8.5);
  }
  return finishDoc(doc, app, lang);
}

// ───────────── buono regalo ─────────────
export async function renderGiftCardPdf(app, card, wanted = 'it') {
  const lang = normLang(wanted);
  const t = makeT(lang);
  const { cfg } = app;
  const doc = createDoc(app, { title: `${t('pdf.giftTitle')} ${card.ref}`, subject: t('pdf.giftTitle'), lang, label: t('pdf.giftTitle') });
  const mid = PAGE.w / 2;

  // cornice
  doc.save();
  doc.rect(30, 108, PAGE.w - 60, PAGE.h - 108 - 76).lineWidth(2.2).strokeColor(C.gold).stroke();
  doc.rect(37, 115, PAGE.w - 74, PAGE.h - 108 - 76 - 14).lineWidth(0.6).strokeColor(C.bronze).stroke();
  doc.restore();

  const center = (text, y, { font = 'R', size = 12, color = C.ink, spacing = 0, width = CW - 40, lineGap = 0 } = {}) => {
    doc.font(font).fontSize(size).fillColor(color);
    const body = fold(text);
    doc.text(body, mid - width / 2, y, { width, align: 'center', characterSpacing: spacing, lineGap });
    return y + doc.heightOfString(body, { width, characterSpacing: spacing, lineGap });
  };

  let y = 168;
  y = center(t('pdf.giftTitle').toUpperCase(), y, { font: 'B', size: 15, color: C.bronze, spacing: 5 });
  // divisore con rombo
  y += 16;
  doc.save().moveTo(mid - 90, y).lineTo(mid - 10, y).moveTo(mid + 10, y).lineTo(mid + 90, y).lineWidth(0.8).strokeColor(C.gold).stroke();
  doc.polygon([mid, y - 5], [mid + 5, y], [mid, y + 5], [mid - 5, y]).fill(C.gold);
  doc.restore();
  y += 40;
  y = center(formatMoney(card.initial_cents, lang, card.currency ?? 'EUR'), y, { font: 'B', size: 66, color: C.ink });
  y += 18;

  if (card.recipient_name) y = center(`${t('pdf.giftFor')} ${card.recipient_name}`, y, { font: 'B', size: 17 }) + 4;
  if (card.buyer_name) y = center(`${t('pdf.giftFrom')} ${card.buyer_name}`, y, { font: 'L', size: 13, color: C.muted }) + 4;
  if (card.message) {
    y += 10;
    doc.font('I').fontSize(12.5);
    const msg = lang === 'ja' ? `「${fold(card.message)}」` : `«${fold(card.message)}»`;
    const w = 340;
    const h = doc.heightOfString(msg, { width: w - 32, lineGap: 2 });
    doc.roundedRect(mid - w / 2, y, w, h + 28, 8).fillAndStroke(C.soft, C.line);
    doc.fillColor(C.text).text(msg, mid - w / 2 + 16, y + 14, { width: w - 32, align: 'center', lineGap: 2 });
    y += h + 28 + 6;
  }

  // codice
  y = Math.max(y + 26, 470);
  doc.roundedRect(mid - 175, y, 350, 86, 12).lineWidth(1.4).stroke(C.bronze);
  center(t('gift.code').toUpperCase(), y + 14, { font: 'R', size: 8, color: C.muted, spacing: 2 });
  center(formatGiftCode(card.code), y + 34, { font: 'B', size: 30, spacing: 3 });
  y += 86 + 22;

  y = center(`${t('gift.validUntil')} ${fmtDate(card.expires_at, lang, 'date')}`, y, { font: 'B', size: 12 }) + 8;
  if (card.balance_cents != null && card.balance_cents !== card.initial_cents) y = center(`${t('gift.balance')}: ${formatMoney(card.balance_cents, lang, card.currency ?? 'EUR')}`, y, { size: 11, color: C.muted }) + 8;
  y = center(t('gift.useIt'), y + 4, { font: 'L', size: 11, color: C.text, width: 400 }) + 6;
  const url = `${cfg.baseUrl}/${lang}/tours`;
  doc.font('R').fontSize(10).fillColor(C.bronze).text(t('pdf.giftWhere', { url }), mid - 200, y + 2, { width: 400, align: 'center', link: url, underline: true });
  y += 30;
  center(t('gift.terms', { months: cfg.gift.validityMonths }), Math.max(y, 690), { font: 'L', size: 8.5, color: C.muted, width: 420 });
  return finishDoc(doc, app, lang);
}

// ───────────── proposta di programma ─────────────
export async function renderProposalPdf(app, p, wanted = p.lang) {
  const lang = normLang(wanted);
  const t = makeT(lang);
  const { cfg } = app;
  const days = app.db.prepare('SELECT * FROM program_days WHERE program_id = ? ORDER BY date, start_time, position').all(p.id);
  const doc = createDoc(app, { title: `${p.proposal_title ?? t('pdf.proposal')} ${p.ref}`, subject: t('pdf.proposal'), lang, label: t('pdf.proposal') });

  title(doc, `${t('pdf.proposalFor')} ${p.company ? `${p.name}, ${p.company}` : p.name}`, p.proposal_title ?? t('pdf.proposal'));
  if (p.proposal_intro) {
    doc.font('R').fontSize(11).fillColor(C.text).text(fold(p.proposal_intro), PAGE.m, doc.y - 8, { width: CW, lineGap: 2 });
    doc.moveDown(0.9);
  }

  const meta = [[t('pg.ref'), p.ref], [t('s.guests'), String(p.participants)]];
  if (p.client_ref) meta.push([t('f.clientRef'), p.client_ref]);
  keyValueRows(doc, meta, { labelW: 120, pad: 5 });
  doc.moveDown(0.6);

  // tabella del programma
  const col = { day: PAGE.m, time: PAGE.m + 98, what: PAGE.m + 168, price: PAGE.m + CW - 62 };
  const whatW = col.price - col.what - 14;
  const head = () => {
    doc.font('B').fontSize(7.5).fillColor(C.muted);
    [[t('pdf.colDay'), col.day], [t('pdf.colTime'), col.time], [t('pdf.colWhat'), col.what]].forEach(([s, x]) => doc.text(fold(s.toUpperCase()), x, doc.y, { characterSpacing: 0.9, lineBreak: false }));
    doc.text(fold(t('pdf.colPrice').toUpperCase()), col.price, doc.y, { width: 62, align: 'right', characterSpacing: 0.9, lineBreak: false });
    const y = doc.y + 13;
    doc.moveTo(PAGE.m, y).lineTo(PAGE.m + CW, y).lineWidth(0.8).strokeColor(C.bronze).stroke();
    doc.y = y + 8;
  };
  head();
  for (const d of days) {
    const what = fold(d.title);
    const desc = d.description ? fold(d.description) : '';
    doc.font('B').fontSize(11);
    const hTitle = doc.heightOfString(what, { width: whatW });
    doc.font('R').fontSize(9.5);
    const hDesc = desc ? doc.heightOfString(desc, { width: whatW }) + 2 : 0;
    const h = Math.max(hTitle + hDesc, 28);
    if (doc.y + h + 14 > PAGE.h - doc.page.margins.bottom) {
      doc.addPage();
      head();
    }
    const y = doc.y;
    doc.font('B').fontSize(10.5).fillColor(C.ink).text(fold(fmtDate(d.date, lang, 'weekday')), col.day, y, { width: 92 });
    doc.font('R').fontSize(10).fillColor(C.text).text(`${d.start_time} – ${d.end_time}`, col.time, y + 0.5, { width: 66, lineBreak: false });
    doc.font('B').fontSize(11).fillColor(C.ink).text(what, col.what, y, { width: whatW });
    if (desc) doc.font('R').fontSize(9.5).fillColor(C.muted).text(desc, col.what, y + hTitle + 2, { width: whatW });
    if (d.price_cents) doc.font('B').fontSize(10.5).fillColor(C.ink).text(formatMoney(d.price_cents, lang, p.currency), col.price, y, { width: 62, align: 'right', lineBreak: false });
    const end = y + h + 7;
    doc.moveTo(PAGE.m, end).lineTo(PAGE.m + CW, end).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.x = PAGE.m;
    doc.y = end + 8;
  }

  // totali
  ensure(doc, 110);
  doc.moveDown(0.3);
  const totalRows = [[t('pg.total'), formatMoney(p.total_cents, lang, p.currency), true]];
  if (p.deposit_cents) {
    totalRows.push([t('pg.deposit', { percent: p.deposit_percent }), formatMoney(p.deposit_cents, lang, p.currency), false]);
    totalRows.push([t('pg.balance'), formatMoney(p.total_cents - p.deposit_cents, lang, p.currency), false]);
  }
  for (const [label, value, big] of totalRows) {
    const y = doc.y;
    doc.font(big ? 'B' : 'R').fontSize(big ? 14 : 11).fillColor(C.ink).text(fold(label), PAGE.m + CW - 440, y, { width: 310, align: 'right', lineBreak: false });
    doc.font('B').fontSize(big ? 14 : 11).text(value, PAGE.m + CW - 120, y, { width: 120, align: 'right', lineBreak: false });
    doc.x = PAGE.m;
    doc.y = y + (big ? 24 : 18);
  }
  if (p.valid_until) {
    doc.moveDown(0.5);
    doc.font('R').fontSize(10).fillColor(C.muted).text(fold(t('pg.validUntil', { date: fmtDate(p.valid_until, lang, 'date') })), PAGE.m, doc.y, { width: CW, align: 'right' });
  }
  doc.moveDown(1);

  if (p.proposal_notes) box(doc, { label: t('pg.notes'), text: p.proposal_notes, size: 10 });

  // come accettare
  if (['new', 'quoted', 'accepted'].includes(p.status)) {
    ensure(doc, 70);
    doc.font('R').fontSize(10).fillColor(C.text).text(fold(t('pdf.proposalAccept')), PAGE.m, doc.y, { width: CW });
    link(doc, `${cfg.baseUrl}/${lang}/programs/${p.ref}?t=${p.token}`, doc.y + 2, 9);
    const iban = cfg.invoice?.iban;
    if (iban && p.deposit_cents) {
      doc.moveDown(0.6);
      doc.font('R').fontSize(10).fillColor(C.text).text(fold(`${t('pdf.proposalTransfer')}: ${iban}${cfg.invoice?.bankHolder ? ` (${cfg.invoice.bankHolder})` : ''} — ${p.ref}`), PAGE.m, doc.y, { width: CW });
    }
  }
  doc.font('L').fontSize(8).fillColor(C.muted).text(fold(t('pdf.generated', { date: nowLabel(lang) })), PAGE.m, doc.y + 14, { width: CW });
  return finishDoc(doc, app, lang);
}
