// Scheda del giorno in PDF (per la guida, da stampare o tenere sul telefono): i servizi in ordine d'orario con contatti, punto d'incontro, note e incassi.
import { COLORS as C, CW, PAGE, createDoc, ensure, finishDoc, fold, title as titleBlock } from './pdf.js';
import { fmtDate } from './time.js';

const TIME_W = 78;
const eur = (cents) => `${(cents / 100).toLocaleString('it-IT', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Righe di dettaglio di un servizio: [etichetta, testo, {strong?, color?}]. */
function detailLines(s) {
  const lines = [];
  lines.push(['Persone', [s.peopleLine, s.tourLang, s.service].filter(Boolean).join(' · ')]);
  if (s.meeting) lines.push(['Incontro', s.meeting]);
  if (s.theme) lines.push(['Tema', s.theme]);
  if (s.b2b) {
    lines.push(['Agenzia', [s.agency, s.agencyContact].filter(Boolean).join(' · ')]);
    lines.push(['Cliente', [s.clientRef, s.name, s.phone].filter(Boolean).join(' · ')]);
  } else {
    lines.push(['Cliente', [s.name, s.phone, s.email].filter(Boolean).join(' · ')]);
  }
  if (s.notes) lines.push(['Note', s.notes]);
  if (s.adminNotes) lines.push(['Tue note', s.adminNotes]);
  lines.push(['Pagamento', s.collectCents ? `DA INCASSARE SUL POSTO: ${eur(s.collectCents)}` : s.pay, s.collectCents ? { strong: true, color: C.err } : {}]);
  return lines.filter(([, text]) => text);
}

/** Il PDF della scheda. @param {ReturnType<import('./daySheet.js').daySheet>} sheet */
export async function renderDaySheetPdf(app, sheet) {
  const doc = createDoc(app, { title: `Scheda del ${sheet.date}`, subject: 'Scheda del giorno', lang: 'it', label: 'Scheda del giorno' });
  const t = sheet.totals;
  titleBlock(doc, 'Scheda del giorno', fmtDate(sheet.date, 'it'), `${plural(t.services, 'servizio', 'servizi')} · ${plural(t.people, 'persona', 'persone')}${t.options ? ` · ${plural(t.options, 'opzione aperta', 'opzioni aperte')}` : ''}${t.collectCents ? ` · da incassare sul posto: ${eur(t.collectCents)}` : ''}`);

  if (!sheet.services.length && !sheet.programs.length && !sheet.blocks.length) {
    doc.font('R').fontSize(11).fillColor(C.muted).text('Nessun servizio in questo giorno.', PAGE.m, doc.y, { width: CW });
  }

  /** Un blocco: orario a sinistra, titolo e righe a destra, filetto sotto. */
  const block = ({ time, heading, tag, tagColor, lines }) => {
    const w = CW - TIME_W;
    doc.font('B').fontSize(12.5);
    const hHeading = doc.heightOfString(fold(heading), { width: w - 90 });
    let h = hHeading + 6;
    for (const [, text] of lines) {
      doc.font('R').fontSize(10);
      h += doc.heightOfString(fold(text), { width: w - 66 }) + 2;
    }
    ensure(doc, h + 16);
    const y = doc.y;
    doc.font('B').fontSize(12).fillColor(C.ink).text(fold(time), PAGE.m, y, { width: TIME_W - 8, lineBreak: false });
    doc.font('B').fontSize(12.5).fillColor(C.ink).text(fold(heading), PAGE.m + TIME_W, y, { width: w - 90 });
    if (tag) doc.font('B').fontSize(7.5).fillColor(tagColor ?? C.bronze).text(fold(tag.toUpperCase()), PAGE.m + TIME_W, y + 3, { width: w, align: 'right', characterSpacing: 1, lineBreak: false });
    let cy = y + hHeading + 4;
    for (const [label, text, o = {}] of lines) {
      doc.font('R').fontSize(7.5).fillColor(C.muted).text(fold(label.toUpperCase()), PAGE.m + TIME_W, cy + 1.5, { width: 60, characterSpacing: 0.6, lineBreak: false });
      doc.font(o.strong ? 'B' : 'R').fontSize(10).fillColor(o.color ?? C.text).text(fold(text), PAGE.m + TIME_W + 66, cy, { width: w - 66 });
      cy += doc.heightOfString(fold(text), { width: w - 66 }) + 2;
    }
    const end = cy + 6;
    doc.moveTo(PAGE.m, end).lineTo(PAGE.m + CW, end).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.x = PAGE.m;
    doc.y = end + 10;
  };

  const timeline = [
    ...sheet.services.map((s) => ({ at: s.start, run: () => block({ time: `${s.start}–${s.end}`, heading: s.title, tag: s.confirmed ? '' : 'Opzione', tagColor: C.bronze, lines: detailLines(s) }) })),
    ...sheet.programs.map((p) => ({ at: p.start, run: () => block({ time: `${p.start}–${p.end}`, heading: p.title, tag: 'Programma', lines: [['Per', [p.who, plural(p.people, 'persona', 'persone')].filter(Boolean).join(' · ')], ['Pratica', p.ref]] }) })),
    ...sheet.blocks.map((b) => ({ at: b.start, run: () => block({ time: `${b.start}–${b.end}`, heading: b.title, tag: 'Fuori dal sito', lines: b.details ? [['Note', b.details]] : [] }) })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  for (const item of timeline) item.run();
  return finishDoc(doc, app, 'it');
}
