// Estratto conto in PDF (per l'agenzia, nella sua lingua): riepilogo, movimenti del mese, fatture ancora da pagare con come pagare e servizi del mese.
import { makeT } from './i18n.js';
import { payInstructions } from './invoicePayments.js';
import { normLang, pick } from './langs.js';
import { COLORS as C, CW, PAGE, box, createDoc, ensure, finishDoc, fold, keyValueRows, sectionTitle, title as titleBlock } from './pdf.js';
import { movementLabel, monthTitle, serviceStateText } from './statementText.js';
import { fmtDate, fmtMonth } from './time.js';
import { formatMoney } from './util.js';

const PAD = 4;

/**
 * Una tabella a righe con il filetto: `cols` = [{ label, w, align? }] (w in punti; la somma deve fare CW), `rows` = [{ cells: string[], bold?, color?, muted? }].
 * Alla pagina nuova ripete l'intestazione.
 */
function table(doc, cols, rows) {
  const header = () => {
    ensure(doc, 34);
    const y = doc.y;
    let x = PAGE.m;
    doc.font('B').fontSize(7.5).fillColor(C.bronze);
    for (const col of cols) {
      doc.text(fold(String(col.label).toUpperCase()), x + PAD, y, { width: col.w - PAD * 2, align: col.align ?? 'left', characterSpacing: 0.7, lineBreak: false });
      x += col.w;
    }
    doc.moveTo(PAGE.m, y + 13).lineTo(PAGE.m + CW, y + 13).lineWidth(0.8).strokeColor(C.bronze).stroke();
    doc.x = PAGE.m;
    doc.y = y + 18;
  };
  header();
  for (const row of rows) {
    const font = row.bold ? 'B' : 'R';
    doc.font(font).fontSize(9.5);
    const h = Math.max(...row.cells.map((c, i) => doc.heightOfString(fold(c || ' '), { width: cols[i].w - PAD * 2 }))) + 7;
    if (doc.y + h > PAGE.h - doc.page.margins.bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    let x = PAGE.m;
    row.cells.forEach((c, i) => {
      doc.font(font).fontSize(9.5).fillColor(row.color ?? (row.muted ? C.muted : C.text)).text(fold(c), x + PAD, y + 2, { width: cols[i].w - PAD * 2, align: cols[i].align ?? 'left' });
      x += cols[i].w;
    });
    doc.moveTo(PAGE.m, y + h).lineTo(PAGE.m + CW, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.x = PAGE.m;
    doc.y = y + h + 2;
  }
  doc.moveDown(0.6);
}

/** Una riga «etichetta ........ importo» del riepilogo. */
function summaryRow(doc, label, value, { bold = false, color = C.ink, size = 11 } = {}) {
  ensure(doc, 22);
  const y = doc.y;
  doc.font(bold ? 'B' : 'R').fontSize(size).fillColor(color);
  doc.text(fold(label), PAGE.m, y, { width: CW - 130, lineBreak: false });
  doc.text(fold(value), PAGE.m + CW - 130, y, { width: 130, align: 'right', lineBreak: false });
  const end = y + size + 7;
  doc.moveTo(PAGE.m, end).lineTo(PAGE.m + CW, end).lineWidth(0.5).strokeColor(C.line).stroke();
  doc.x = PAGE.m;
  doc.y = end + 4;
}

/**
 * @param {ReturnType<import('./statement.js').statementOf>} st
 * @param {{ account: object, lang?: string }} o
 */
export async function renderStatementPdf(app, st, { account, lang: wanted }) {
  const lang = normLang(wanted ?? account.lang);
  const t = makeT(lang);
  const money = (c) => formatMoney(c, lang);
  const signed = (c) => (c > 0 ? `+ ${money(c)}` : c < 0 ? `− ${money(-c)}` : money(0));
  const monthName = fmtMonth(st.month, lang);
  const heading = monthTitle(monthName, lang);
  const doc = createDoc(app, { title: `${t('stmt.title')} ${monthName}`, subject: account.company, lang, label: t('stmt.title') });

  titleBlock(doc, t('stmt.title'), heading, account.company);
  keyValueRows(doc, [
    [t('pdf.agency'), account.company],
    [t('stmt.vat'), account.vat],
    [t('stmt.period'), `${fmtDate(st.from, lang, 'date')} – ${fmtDate(st.to, lang, 'date')}`],
    [t('stmt.issued'), fmtDate(st.today, lang, 'date')],
  ]);

  // riepilogo
  sectionTitle(doc, t('stmt.summary'));
  summaryRow(doc, `${t('stmt.opening')} (${fmtDate(st.from, lang, 'short')})`, money(st.opening));
  summaryRow(doc, t('stmt.invoiced'), signed(st.invoiced));
  summaryRow(doc, t('stmt.credited'), signed(-st.credited));
  summaryRow(doc, t('stmt.paid'), signed(-st.paid));
  summaryRow(doc, t('stmt.balanceAt', { date: fmtDate(st.asOf, lang, 'short') }), st.closing < 0 ? `${money(st.closing)} (${t('stmt.credit')})` : money(st.closing), { bold: true, size: 13 });
  if (st.overdueCents) summaryRow(doc, t('stmt.overdue'), money(st.overdueCents), { bold: true, color: C.err });
  if (st.unbilled.count) {
    doc.moveDown(0.3);
    doc.font('R').fontSize(9.5).fillColor(C.muted).text(fold(t('stmt.unbilled', { count: st.unbilled.count, amount: money(st.unbilled.cents), date: fmtDate(st.today, lang, 'short') })), PAGE.m, doc.y, { width: CW });
  }

  // movimenti del mese
  ensure(doc, 100);
  sectionTitle(doc, t('stmt.moves'));
  if (!st.movements.length) {
    doc.font('R').fontSize(10).fillColor(C.muted).text(fold(t('stmt.noMoves')), PAGE.m, doc.y, { width: CW });
    doc.moveDown(0.6);
  } else {
    table(
      doc,
      [
        { label: t('s.date'), w: 84 },
        { label: t('stmt.col.doc'), w: 140 },
        { label: t('stmt.col.detail'), w: 101 },
        { label: t('stmt.col.amount'), w: 87, align: 'right' },
        { label: t('stmt.col.balance'), w: CW - 412, align: 'right' },
      ],
      st.movements.map((m) => {
        const [d, detail] = movementLabel(t, lang, m);
        return { cells: [fmtDate(m.date, lang, 'short'), d, detail, signed(m.cents), money(m.balance)] };
      }),
    );
  }

  // da pagare
  ensure(doc, 100);
  sectionTitle(doc, t('stmt.open', { date: fmtDate(st.asOf, lang, 'short') }));
  if (!st.open.length && !st.creditCents) {
    doc.font('R').fontSize(10).fillColor(C.muted).text(fold(t('stmt.openNone')), PAGE.m, doc.y, { width: CW });
    doc.moveDown(0.6);
  } else {
    table(
      doc,
      [
        { label: t('stmt.col.doc'), w: 160 },
        { label: t('invpay.dueBy'), w: 110 },
        { label: t('stmt.col.late'), w: 100 },
        { label: t('stmt.col.amount'), w: CW - 370, align: 'right' },
      ],
      [
        ...st.open.map((o) => ({
          cells: [`${t('stmt.doc.invoice', { number: o.invoice.number })} · ${fmtDate(o.invoice.issue_date, lang, 'short')}`, o.dueDate ? fmtDate(o.dueDate, lang, 'short') : t('stmt.noDue'), o.daysLate ? t('stmt.late', { days: o.daysLate }) : '', money(o.cents)],
          color: o.daysLate ? C.err : undefined,
        })),
        ...(st.creditCents ? [{ cells: [t('stmt.creditLine'), '', '', `− ${money(st.creditCents)}`], muted: true }] : []),
      ],
    );
    const first = st.open[0]?.invoice;
    const how = first ? payInstructions(app, first) : null;
    if (how?.iban) {
      box(doc, {
        label: t('invpay.how'),
        text: [`${t('invpay.beneficiary')}: ${how.beneficiary}`, `${t('invpay.iban')}: ${how.iban}`, how.bank ? `${t('invpay.bank')}: ${how.bank}` : '', t('stmt.payHint', { number: first.number })].filter(Boolean).join('\n'),
        size: 10,
      });
    }
  }

  // servizi del mese
  if (st.services.length) {
    ensure(doc, 100);
    sectionTitle(doc, t('stmt.services'));
    table(
      doc,
      [
        { label: t('s.date'), w: 84 },
        { label: t('s.service'), w: 171 },
        { label: t('s.guests'), w: 58, align: 'right' },
        { label: t('s.total'), w: 78, align: 'right' },
        { label: t('b2b.state'), w: CW - 391 },
      ],
      st.services.map((s) => [s, pick(s.i18n ?? {}, lang)?.title ?? s.slug]).map(([s, title]) => ({
        cells: [fmtDate(s.date, lang, 'short'), `${title}${s.clientRef ? ` · ${s.clientRef}` : ''}`, String(s.people), money(s.cents), serviceStateText(t, s)],
      })),
    );
  }

  doc.font('R').fontSize(8.5).fillColor(C.muted).text(fold(t('stmt.footnote')), PAGE.m, doc.y + 4, { width: CW });
  doc.moveDown(0.4);
  doc.font('R').fontSize(8).fillColor(C.muted).text(fold(t('pdf.generated', { date: fmtDate(st.today, lang, 'short') })), PAGE.m, doc.y, { width: CW });
  return finishDoc(doc, app, lang);
}
