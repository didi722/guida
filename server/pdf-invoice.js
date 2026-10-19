// Copia di cortesia (PDF) di una fattura elettronica emessa. L'originale è il file XML trasmesso a SdI.
import { COLORS as C, CW, PAGE, createDoc, ensure, finishDoc, fold, sectionTitle, title } from './pdf.js';
import { invoiceLines, optionsOf, parseJson } from './invoices.js';
import { makeT } from './i18n.js';
import { localeOf, normLang } from './langs.js';
import { fmtDate } from './time.js';

// Importi e date seguono la lingua del cliente; le percentuali restano all'italiana (è un documento fiscale italiano).
const C2 = (cents, lang) => new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency: 'EUR' }).format(cents / 100);
const pct = (bp) => (bp / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 });

function partyLines(p, t, { isSeller = false, routing = null } = {}) {
  const country = String(p.country ?? 'IT').toUpperCase();
  const name = p.kind === 'person' ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : (p.name || `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim());
  const lines = [{ text: name, bold: true }];
  const street = p.address?.street ?? p.address;
  if (street) lines.push({ text: street });
  const a = p.address?.street !== undefined ? p.address : p;
  lines.push({ text: `${[a.zip, a.city].filter(Boolean).join(' ')}${a.province ? ` (${String(a.province).toUpperCase()})` : ''}${country !== 'IT' ? ` – ${country}` : ''}` });
  const vat = String(p.vat ?? p.vatNumber ?? '').replace(/^IT(?=\d{11}$)/, '');
  if (vat) lines.push({ text: `${t('inv.pdf.vat')} ${country === 'IT' || isSeller ? 'IT' : ''}${vat}` });
  if (p.taxCode ?? p.fiscalCode) lines.push({ text: `${t('inv.pdf.taxCode')} ${p.taxCode ?? p.fiscalCode}` });
  if (isSeller) {
    const regime = p.regime ? (t(`inv.pdf.regime.${p.regime}`) !== `inv.pdf.regime.${p.regime}` ? `${t(`inv.pdf.regime.${p.regime}`)} (${p.regime})` : p.regime) : '';
    if (regime) lines.push({ text: `${t('inv.pdf.regime')}: ${regime}`, muted: true });
    const contacts = [p.phone, p.email].filter(Boolean).join('  ·  ');
    if (contacts) lines.push({ text: contacts, muted: true });
  } else if (routing) {
    if (routing.code && routing.code !== '0000000' && routing.code !== 'XXXXXXX') lines.push({ text: `${t('inv.pdf.sdi')}: ${routing.code}`, muted: true });
    if (routing.pec) lines.push({ text: `${t('inv.pdf.pec')}: ${routing.pec}`, muted: true });
  }
  return lines;
}

function partyBox(doc, x, y, w, heading, lines) {
  const pad = 11;
  let h = pad * 2 + 14;
  for (const l of lines) {
    doc.font(l.bold ? 'B' : 'R').fontSize(l.bold ? 11 : 9.5);
    h += doc.heightOfString(fold(l.text), { width: w - pad * 2 }) + 2;
  }
  doc.roundedRect(x, y, w, h, 8).fillAndStroke(C.soft, C.line);
  doc.font('B').fontSize(7.5).fillColor(C.bronze).text(fold(heading.toUpperCase()), x + pad, y + pad, { width: w - pad * 2, characterSpacing: 1.1 });
  let yy = y + pad + 14;
  for (const l of lines) {
    doc.font(l.bold ? 'B' : 'R').fontSize(l.bold ? 11 : 9.5).fillColor(l.muted ? C.muted : C.ink);
    const text = fold(l.text);
    doc.text(text, x + pad, yy, { width: w - pad * 2 });
    yy += doc.heightOfString(text, { width: w - pad * 2 }) + 2;
  }
  return h;
}

/** Copia di cortesia della fattura (o nota di credito) emessa. */
export async function renderInvoicePdf(app, inv) {
  const buyer = parseJson(inv.buyer_json);
  const lang = normLang(buyer.lang);
  const t = makeT(lang);
  const cfgSnap = parseJson(inv.config_json);
  const seller = cfgSnap.seller ?? { ...app.cfg.invoice.seller, vatNumber: app.cfg.site.vatNumber, phone: app.cfg.site.phone, email: app.cfg.site.email };
  const lines = invoiceLines(app.db, inv.id);
  const options = optionsOf(inv);
  const payments = parseJson(inv.payments_json, []);
  const credit = inv.doc_type === 'TD04';
  const kind = t(credit ? 'inv.pdf.credit' : 'inv.pdf.invoice');
  const related = inv.related_id ? app.db.prepare('SELECT number, issue_date FROM invoices WHERE id = ?').get(inv.related_id) : null;

  const doc = createDoc(app, { title: `${kind} ${inv.number}`, subject: kind, lang, label: `${kind} · ${t('inv.pdf.courtesy')}` });
  title(doc, t('inv.pdf.courtesy'), kind, t('inv.pdf.number', { number: inv.number, date: fmtDate(inv.issue_date, lang, 'date') }));

  // cedente e cessionario affiancati
  const gap = 16;
  const w = (CW - gap) / 2;
  const sellerBox = partyLines({ ...seller, address: seller.address, kind: seller.name ? 'company' : 'person', name: seller.name || `${seller.firstName} ${seller.lastName}`, country: 'IT' }, t, { isSeller: true });
  const routing = buyer.country && String(buyer.country).toUpperCase() === 'IT' ? { code: buyer.sdiCode, pec: buyer.pec } : null;
  const buyerBox = partyLines(buyer, t, { routing });
  const y0 = doc.y;
  const h1 = partyBox(doc, PAGE.m, y0, w, t('inv.pdf.seller'), sellerBox);
  const h2 = partyBox(doc, PAGE.m + w + gap, y0, w, t('inv.pdf.buyer'), buyerBox);
  doc.x = PAGE.m;
  doc.y = y0 + Math.max(h1, h2) + 20;

  // righe
  const col = { desc: PAGE.m, amount: PAGE.m + CW - 150, vat: PAGE.m + CW - 60 };
  const descW = col.amount - col.desc - 14;
  const header = () => {
    doc.font('B').fontSize(7.5).fillColor(C.muted);
    const y = doc.y;
    doc.text(fold(t('inv.pdf.desc').toUpperCase()), col.desc, y, { characterSpacing: 0.9, lineBreak: false });
    doc.text(fold(t('inv.pdf.amount').toUpperCase()), col.amount, y, { width: 84, align: 'right', characterSpacing: 0.9, lineBreak: false });
    doc.text(fold(t('inv.pdf.vatCol').toUpperCase()), col.vat, y, { width: 60, align: 'right', characterSpacing: 0.9, lineBreak: false });
    const ly = y + 13;
    doc.moveTo(PAGE.m, ly).lineTo(PAGE.m + CW, ly).lineWidth(0.8).strokeColor(C.bronze).stroke();
    doc.y = ly + 8;
  };
  header();
  // il bollo addebitato è una riga della fattura (natura N1), calcolata al momento dell'emissione
  const rows = [...lines.map((l) => ({ description: l.description, net: l.net_cents, label: l.vat_bp ? `${pct(l.vat_bp)}%` : (l.nature ?? '') }))];
  if (inv.bollo_charged) rows.push({ description: t('inv.pdf.bollo'), net: inv.bollo_cents, label: 'N1' });
  for (const l of rows) {
    const text = fold(l.description);
    doc.font('R').fontSize(10);
    const h = Math.max(doc.heightOfString(text, { width: descW }), 14);
    if (doc.y + h + 14 > PAGE.h - doc.page.margins.bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    doc.fillColor(C.ink).text(text, col.desc, y, { width: descW });
    doc.font('B').fontSize(10).text(C2(l.net, lang), col.amount, y, { width: 84, align: 'right', lineBreak: false });
    doc.font('R').fontSize(9.5).fillColor(C.muted).text(l.label, col.vat, y, { width: 60, align: 'right', lineBreak: false });
    const end = y + h + 6;
    doc.moveTo(PAGE.m, end).lineTo(PAGE.m + CW, end).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.x = PAGE.m;
    doc.y = end + 7;
  }

  // totali
  ensure(doc, 150);
  doc.moveDown(0.4);
  const row = (label, value, { big = false, muted = false } = {}) => {
    const y = doc.y;
    // la colonna delle etichette è larga: in spagnolo alcune («Impuesto de timbre (bollo) pagado de forma virtual») sono molto più lunghe che in italiano e, con una larghezza fissa, andrebbero a capo sulla riga successiva
    doc.font(big ? 'B' : 'R').fontSize(big ? 13 : 10).fillColor(muted ? C.muted : C.ink).text(fold(label), PAGE.m + CW - 440, y, { width: 310, align: 'right', lineBreak: false });
    doc.font('B').fontSize(big ? 13 : 10).text(value, PAGE.m + CW - 120, y, { width: 120, align: 'right', lineBreak: false });
    doc.x = PAGE.m;
    doc.y = y + (big ? 22 : 16);
  };
  const main = lines[0];
  row(t('inv.pdf.taxable'), C2(lines.reduce((a, l) => a + l.net_cents, 0), lang));
  if (inv.contribution_cents) row(t('inv.pdf.contribution', { percent: pct(Math.round((options.contributionPercent ?? 4) * 100)) }), C2(inv.contribution_cents, lang));
  if (main?.vat_bp) row(t('inv.pdf.vatAmount', { rate: pct(main.vat_bp) }), C2(inv.vat_cents, lang));
  if (inv.bollo_charged) row(t('inv.pdf.bollo'), C2(inv.bollo_cents, lang));
  if (inv.rounding_cents) row(t('inv.pdf.rounding'), C2(inv.rounding_cents, lang), { muted: true });
  row(t('inv.pdf.total'), C2(inv.total_cents, lang), { big: true });
  if (inv.withholding_cents) {
    row(t('inv.pdf.withholding', { percent: pct(Math.round((options.withholdingPercent ?? 20) * 100)) }), `-${C2(inv.withholding_cents, lang)}`);
    row(t('inv.pdf.payable'), C2(inv.payable_cents, lang), { big: true });
  }
  if (inv.bollo_cents && !inv.bollo_charged) {
    doc.font('L').fontSize(9).fillColor(C.muted).text(fold(`${t('inv.pdf.bollo')}: ${C2(inv.bollo_cents, lang)}`), PAGE.m, doc.y + 2, { width: CW, align: 'right' });
    doc.moveDown(0.6);
  }

  // pagamento
  if (payments.length) {
    sectionTitle(doc, t('inv.pdf.payment'));
    for (const p of payments) {
      const label = t(`inv.pdf.pay.${p.method}`);
      const when = p.paid ? t('inv.pdf.paid') : p.dueDate ? t('inv.pdf.dueOn', { date: fmtDate(p.dueDate, lang, 'date') }) : '';
      ensure(doc, 34);
      doc.font('R').fontSize(10).fillColor(C.ink).text(fold(`${label}${when ? ` – ${when}` : ''}: ${C2(p.cents, lang)}`), PAGE.m, doc.y, { width: CW });
      if (p.method === 'MP05' && p.iban && !p.paid) doc.font('R').fontSize(9.5).fillColor(C.muted).text(fold(`${t('inv.pdf.iban')}: ${p.iban}${p.bank ? ` · ${p.bank}` : ''} · ${t('inv.pdf.reference')}: ${t('inv.pdf.referenceText', { number: inv.number })}`), PAGE.m, doc.y, { width: CW });
      doc.moveDown(0.3);
    }
  }

  // causali e note di legge
  const notes = [];
  if (related) notes.push(t('inv.pdf.related', { number: related.number, date: fmtDate(related.issue_date, lang, 'date') }));
  for (const c of String(cfgSnap.notes ?? app.cfg.invoice.notes ?? '').split('|').map((x) => x.trim()).filter(Boolean)) notes.push(c);
  if (options.notes) notes.push(options.notes);
  if (notes.length) {
    sectionTitle(doc, t('inv.pdf.notes'));
    for (const n of notes) {
      ensure(doc, 30);
      doc.font('R').fontSize(9.5).fillColor(C.text).text(fold(n), PAGE.m, doc.y, { width: CW });
      doc.moveDown(0.25);
    }
  }
  ensure(doc, 50);
  doc.moveDown(0.8);
  doc.font('L').fontSize(8).fillColor(C.muted).text(fold(t('inv.pdf.footer')), PAGE.m, doc.y, { width: CW });
  return finishDoc(doc, app, lang);
}
