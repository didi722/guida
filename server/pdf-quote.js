// Preventivo PDF che l'agenzia gira al suo cliente finale: intestazione con il suo logo e i suoi recapiti, i servizi con i prezzi per il cliente
// (la tariffa dell'agenzia più il suo ricarico: la tariffa non compare mai), validità e note. Si ricava da opzioni, prenotazioni e pacchetti.
import { brandOf, buildQuote } from './agencyDocs.js';
import { meetingOf } from './choices.js';
import { makeT } from './i18n.js';
import { normLang, pick } from './langs.js';
import { COLORS as C, CW, PAGE, box, createDoc, ensure, finishDoc, fold, keyValueRows, title as titleBlock } from './pdf.js';
import { quoteBookings } from './quotes.js';
import { partyExtra, partyOfBooking } from './party.js';
import { timeRange } from './rates.js';
import { fmtDate, nowRome } from './time.js';
import { formatMoney } from './util.js';

const PRICE_W = 110;

/** Un servizio: titolo e prezzo sulla stessa riga, sotto data, orario e persone, punto d'incontro e cosa è incluso. */
function serviceBlock(doc, { name, price, details, meeting, included }) {
  const w = CW - PRICE_W - 12;
  doc.font('B').fontSize(12.5);
  const hName = doc.heightOfString(fold(name), { width: w });
  doc.font('R').fontSize(10);
  const hDetails = doc.heightOfString(fold(details), { width: w });
  const hMeeting = meeting ? doc.heightOfString(fold(meeting), { width: w }) + 2 : 0;
  doc.font('R').fontSize(9);
  const hIncluded = included ? doc.heightOfString(fold(included), { width: w }) + 3 : 0;
  const h = hName + hDetails + hMeeting + hIncluded + 8;
  ensure(doc, h + 18);
  const y = doc.y;
  doc.font('B').fontSize(12.5).fillColor(C.ink).text(fold(name), PAGE.m, y, { width: w });
  doc.font('B').fontSize(13).fillColor(C.ink).text(fold(price), PAGE.m + CW - PRICE_W, y, { width: PRICE_W, align: 'right', lineBreak: false });
  let cy = y + hName + 2;
  doc.font('R').fontSize(10).fillColor(C.text).text(fold(details), PAGE.m, cy, { width: w });
  cy += hDetails;
  if (meeting) {
    doc.font('R').fontSize(10).fillColor(C.muted).text(fold(meeting), PAGE.m, cy + 2, { width: w });
    cy += hMeeting;
  }
  if (included) {
    doc.font('R').fontSize(9).fillColor(C.muted).text(fold(included), PAGE.m, cy + 3, { width: w });
    cy += hIncluded;
  }
  const end = cy + 8;
  doc.moveTo(PAGE.m, end).lineTo(PAGE.m + CW, end).lineWidth(0.5).strokeColor(C.line).stroke();
  doc.x = PAGE.m;
  doc.y = end + 10;
}

/**
 * Il preventivo.
 * @param {object} o
 * @param {object} o.account l'agenzia (riga di accounts)
 * @param {object[]} o.bookings le prenotazioni da includere (solo opzioni e confermate)
 * @param {number} o.markup ricarico % · @param {number} o.round arrotondamento (euro)
 * @param {string} [o.client] a chi è intestato · @param {string} [o.until] AAAA-MM-GG di validità · @param {string} [o.note] note per il cliente
 * @param {string} [o.lang] lingua del documento · @param {string} [o.ref] numero del preventivo salvato (QT-…)
 */
export async function renderQuotePdf(app, { account, bookings, markup = 0, round = 5, client = '', until = '', note = '', lang: wanted, ref = '', nowDate = nowRome().date }) {
  const lang = normLang(wanted ?? account.lang);
  const t = makeT(lang);
  const { cfg } = app;
  const brand = brandOf(app, account.id);
  const quote = buildQuote(bookings, { markup, round });
  const currency = quote.lines[0]?.booking.currency ?? 'EUR';
  const money = (cents) => formatMoney(cents, lang, currency);
  const doc = createDoc(app, { title: t('quote.title'), subject: client ? t('quote.forClient', { name: client }) : t('quote.heading'), lang, label: t('quote.title'), brand: { mode: 'agency', name: brand.name, contact: brand.contact, logo: brand.logo } });

  titleBlock(doc, t('quote.title'), client ? t('quote.forClient', { name: client }) : t('quote.heading'));
  const refs = [...new Set(quote.lines.map((l) => l.booking.client_ref).filter(Boolean))].join(', ');
  keyValueRows(doc, [
    [t('quote.ref'), ref],
    [t('quote.issued'), nowDate ? fmtDate(nowDate, lang) : ''],
    [t('quote.valid'), until ? fmtDate(until, lang) : '', { bold: true }],
    [t('f.clientRef'), refs],
  ]);
  doc.moveDown(0.6);

  for (const { booking: b, cents } of quote.lines) {
    const tour = app.content.tour(b.tour_slug);
    const ti = pick(tour.i18n, lang);
    const meet = meetingOf(tour, b, lang);
    const included = (ti.includes ?? []).slice(0, 5);
    serviceBlock(doc, {
      name: ti.title,
      price: money(cents),
      details: `${fmtDate(b.date, lang)}  ·  ${timeRange(b, lang).replace('–', ' – ')}  ·  ${t('quote.pax', { n: b.participants })}${partyExtra(partyOfBooking(b), lang)}`,
      meeting: meet.text ? `${t('s.meeting')}: ${meet.text}` : '',
      included: included.length ? `${t('pdf.included')}: ${included.join('  ·  ')}` : '',
    });
  }

  // totale
  ensure(doc, 60);
  const y = doc.y + 2;
  doc.roundedRect(PAGE.m, y, CW, 44, 8).fillAndStroke(C.soft, C.line);
  doc.font('B').fontSize(9).fillColor(C.bronze).text(fold(t('quote.total').toUpperCase()), PAGE.m + 16, y + 17, { characterSpacing: 1.4, lineBreak: false });
  doc.font('B').fontSize(18).fillColor(C.ink).text(fold(money(quote.totalCents)), PAGE.m + 16, y + 12, { width: CW - 32, align: 'right', lineBreak: false });
  doc.x = PAGE.m;
  doc.y = y + 44 + 16;

  if (note) box(doc, { label: t('quote.notes'), text: note, size: 10 });
  if (brand.footer) {
    ensure(doc, 40);
    doc.font('R').fontSize(9).fillColor(C.muted).text(fold(brand.footer), PAGE.m, doc.y, { width: CW });
  }
  return finishDoc(doc, app, lang, { lines: [[brand.name, brand.contact].filter(Boolean).join('  ·  '), t('quote.operator', { name: cfg.site.name })] });
}

/** Il PDF di un preventivo salvato (con i servizi e i prezzi com'erano quando è stato preparato). */
export async function renderSavedQuotePdf(app, q, { lang } = {}) {
  const account = app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(q.account_id);
  return renderQuotePdf(app, { account, bookings: quoteBookings(q), markup: q.markup_percent, round: q.markup_round, client: q.client_name, until: q.valid_until, note: q.note ?? '', lang: lang ?? q.lang, ref: q.ref, nowDate: nowRome(Date.parse(q.created_at)).date });
}
