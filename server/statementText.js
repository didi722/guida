// Le parole dell'estratto conto che servono sia alla pagina sia al PDF: come si chiama un movimento, in che stato è un servizio.
import { dueDateOf } from './invoicePayments.js';
import { fmtDate } from './time.js';

/** Il testo di un movimento: [documento, dettaglio]. */
export function movementLabel(t, lang, m) {
  const doc = t(`stmt.doc.${m.kind}`, { number: m.invoice.number });
  if (m.kind === 'credit') return [doc, t('stmt.detail.credit', { number: m.related.number })];
  if (m.kind === 'payment') return [doc, t(`stmt.method.${['bank', 'card'].includes(m.method) ? m.method : 'other'}`)];
  const due = dueDateOf(m.invoice);
  return [doc, due ? t('stmt.detail.due', { date: fmtDate(due, lang, 'short') }) : ''];
}

/** Lo stato di un servizio, a parole. */
export function serviceStateText(t, s) {
  if (s.state === 'invoiced') return t(s.paid ? 'stmt.svc.invoicedPaid' : 'stmt.svc.invoiced', { number: s.number });
  return s.state === 'other' ? '—' : t(`stmt.svc.${s.state}`);
}

/** «gennaio 2027» con la maiuscola iniziale, per i titoli. */
export const monthTitle = (text, lang) => text.charAt(0).toLocaleUpperCase(lang) + text.slice(1);
