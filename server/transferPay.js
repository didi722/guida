// Bonifico anticipato di un'agenzia: come si paga (a chi, IBAN, causale, importo, entro quando).
// La prenotazione resta «in attesa» (il posto è trattenuto) e diventa definitiva quando il bonifico arriva (vedi services.js › transferReceived).
import { bookingDue } from './bookings.js';
import { groupIban } from './invoicePayments.js';
import { settingsOf } from './invoices.js';

/** I dati del bonifico per una prenotazione: la causale è il suo codice, così si riconosce subito. */
export function transferInstructions(app, b) {
  const s = settingsOf(app.cfg);
  const beneficiary = s.seller.name || [s.seller.firstName, s.seller.lastName].filter(Boolean).join(' ') || app.cfg.site.legalName;
  return { beneficiary, iban: groupIban(s.iban), bank: s.bank || '', reference: b.ref, amountCents: bookingDue(b), deadlineMs: b.hold_expires_at ? Date.parse(b.hold_expires_at) : null };
}

/** Una prenotazione in attesa di un bonifico (il posto è trattenuto). */
export const awaitsTransfer = (b) => b.status === 'held' && b.payment_method === 'transfer';
