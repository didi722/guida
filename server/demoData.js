// Dati d'esempio della demo per le agenzie (vedi demo.js): un'agenzia finta con prenotazioni in tutti gli stati, opzioni, fatture emesse, pagate e scadute,
// tre preventivi (da inviare, inviato, accettato), una nota di credito, un pacchetto in opzione, un collaboratore e un programma di più giorni. Si crea tutto con le funzioni vere del sito (come in sandbox), quindi ciò che l'agenzia
// vede è esattamente ciò che vedrebbe un'agenzia vera. Tour e tariffe sono quelli del catalogo copiato dal sito, perciò ogni passo prova e salta se non
// c'è (per esempio un servizio che la guida ha spento): la demo si accende comunque con ciò che c'è.
import crypto from 'node:crypto';
import { daySlots } from './availability.js';
import { hashPassword } from './auth.js';
import { cancelBooking, confirmPaid, createBooking, markRefund } from './bookings.js';
import { createCreditNote, createDrafts, issueInvoice, setSdiStatus } from './invoices.js';
import { markInvoicePaid } from './invoicePayments.js';
import { cartAdd, createPackage, resolveLine } from './packages.js';
import { createProgramRequest, saveProposal } from './programs.js';
import { createQuote, decide, markViewed, recordSent } from './quotes.js';
import { openTo } from './rates.js';
import { activateMember, inviteMember } from './team.js';
import { addDays, localToInstant, nowRome } from './time.js';

const DAY = 86_400_000;

/** I dati dell'agenzia finta. Nessuno è vero: indirizzo e partita IVA hanno solo la forma giusta. */
export const DEMO_AGENCY = {
  email: 'giulia@laguna-viaggi.example',
  company: 'Laguna Viaggi (demo)',
  contact_name: 'Giulia Bianchi',
  phone: '+39 041 000000',
  vat: '01234567897',
  tax_code: '01234567897',
  sdi_code: 'ABC1234',
  address: 'Fondamenta Test 1',
  zip: '30121',
  city: 'Venezia',
  province: 'VE',
  country: 'IT',
  lang: 'it',
};
const COLLEAGUE = { name: 'Marco Verdi', email: 'marco@laguna-viaggi.example' };

/**
 * Crea l'agenzia e tutto ciò che c'è dentro.
 * @returns {Promise<{ account: object, report: string[] }>} `report`: una riga per ogni passo, con ✓ o ✗ (serve ai test e al log)
 */
export async function seedDemoData(app, { nowMs = Date.now() } = {}) {
  const { db, cfg, content } = app;
  const report = [];
  const today = nowRome(nowMs).date;
  const iso = new Date(nowMs).toISOString();
  const noon = (date) => localToInstant(date, '12:00');
  const step = async (label, fn) => {
    try {
      const out = await fn();
      report.push(`✓ ${label}`);
      return out;
    } catch (err) {
      report.push(`✗ ${label}: ${err?.message ?? err}`);
      return null;
    }
  };

  // ───── l'agenzia: approvata, con sconto, un prezzo dedicato e annullo a scaglioni ─────
  const rates = app.rates.get();
  const tours = content.tours.filter((t) => t.active && openTo(rates, t, 'b2b'));
  const fixed = tours.filter((t) => t.pricing !== 'hourly');
  const perPerson = fixed.filter((t) => t.model === 'person');
  const hourlyChoose = tours.filter((t) => t.pricing === 'hourly' && t.chooseHours);
  const hourlyFixed = tours.filter((t) => t.pricing === 'hourly' && !t.chooseHours);
  const dedicated = perPerson[0] ?? fixed[0];
  const password = await hashPassword(crypto.randomBytes(24).toString('hex')); // nessuno la conosce: si entra solo dal link riservato
  const row = {
    ...DEMO_AGENCY,
    password_hash: password,
    status: 'approved',
    approved_at: iso,
    allow_invoice: 1,
    discount_percent: 10,
    prices_json: dedicated ? JSON.stringify({ [dedicated.slug]: Math.round((dedicated.priceCents * 0.85) / 100) * 100 }) : null,
    cancel_policy_json: JSON.stringify([{ hours: 168, refund: 100 }, { hours: 72, refund: 50 }]),
    admin_notes: 'Agenzia dimostrativa: tutti i dati sono inventati.',
    tutorial_done_at: iso,
    created_at: new Date(nowMs - 120 * DAY).toISOString(),
  };
  const cols = Object.keys(row);
  const id = Number(db.prepare(`INSERT INTO accounts(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  report.push('✓ Agenzia «Laguna Viaggi (demo)»');

  // ───── un collaboratore (le sue prenotazioni portano il suo nome) ─────
  const colleague = await step('Collaboratore Marco Verdi', async () => {
    const { user } = inviteMember(db, account, { ...COLLEAGUE, lang: 'it' }, nowMs - 60 * DAY);
    activateMember(db, user.id, await hashPassword(crypto.randomBytes(24).toString('hex')), nowMs - 59 * DAY);
    return db.prepare('SELECT * FROM account_users WHERE id = ?').get(user.id);
  });
  const byOwner = { userId: null, name: account.contact_name };
  const byColleague = colleague ? { userId: colleague.id, name: colleague.name } : byOwner;

  // ───── prenotazioni ─────
  const take = (...lists) => lists.flat().find(Boolean) ?? tours[0];
  const pick = (i) => tours[i % tours.length];
  /** Prenota il primo orario libero dal giorno indicato (avanti, o indietro se `past`). @returns {object|null} la prenotazione */
  const book = (label, spec) => {
    const tour = spec.tour;
    if (!tour) {
      report.push(`✗ ${label}: nessun servizio adatto nel catalogo`);
      return null;
    }
    const hours = tour.pricing === 'hourly' ? (tour.chooseHours ? spec.hours ?? 4 : tour.durationMin / 60) : null;
    const durationMin = hours ? Math.round(hours * 60) : null;
    const party = spec.party && tour.model === 'person' ? spec.party : null;
    const pax = party ? party.adults + party.children + party.infants : Math.min(spec.pax ?? 4, tour.maxParticipants);
    let failure = null; // l'ultimo motivo per cui una data non andava bene (per dirlo, se nessuna va)
    for (let i = 0; i < 60; i++) {
      const date = addDays(today, spec.day + (spec.day >= 0 ? i : -i));
      const at = spec.day >= 0 ? nowMs - (spec.ago ?? 2) * DAY : noon(addDays(date, -(spec.lead ?? 14)));
      const slots = daySlots(db, cfg, tour, date, { pax, channel: 'b2b', nowMs: at, durationMin });
      const slot = spec.time ? slots.find((s) => s.time === spec.time) : slots[spec.late ? slots.length - 1 : 0];
      if (!slot) continue;
      try {
        const b = createBooking(
          app,
          {
            tourSlug: tour.slug, date, time: slot.time, ...(party ? { party } : { pax }), ...(hours ? { hours, earpieces: !!spec.earpieces } : {}),
            channel: 'b2b', account, name: account.contact_name, email: account.email, lang: 'it', clientRef: spec.client, bookedBy: spec.by ?? byOwner,
            ...(spec.option ? { option: true } : { paymentMethod: spec.pay }),
          },
          at,
        );
        if (!spec.option && spec.pay === 'card') confirmPaid(app, b.id, `pi_demo_${b.ref}`, at);
        report.push(`✓ ${label}`);
        return { ...b, at };
      } catch (err) {
        failure = err;
        if (err.code === 'option' && err.message === 'disabled') break; // le opzioni sono spente: inutile provare altre date
      }
    }
    report.push(`✗ ${label}: ${failure ? failure.message : 'nessuna data libera'}`);
    return null;
  };

  // le prossime (confermate)
  book('Prossima: servizio a persona, pagato con carta', { tour: take(perPerson, fixed), day: 6, pax: 6, pay: 'card', client: 'Gruppo Rossi', ago: 3 });
  book('Prossima: famiglia (adulti, bambini e un infante), a fattura', { tour: take(perPerson.slice(1), perPerson, fixed), day: 9, party: { adults: 3, children: 2, infants: 1 }, pax: 6, pay: 'invoice', client: 'Famiglia Conti', ago: 4, by: byColleague });
  book('Prossima: guida a ore con auricolari, a fattura', { tour: take(hourlyChoose, hourlyFixed, tours), day: 12, hours: 4, earpieces: true, pax: 14, pay: 'invoice', client: 'Gruppo Miller (USA)', ago: 2, by: byColleague });
  book('Prossima: servizio per agenzie (assistente o meet & greet), con carta', { tour: take(hourlyFixed, hourlyChoose, tours), day: 5, pax: 12, pay: 'card', client: 'Arrivo gruppo Kessler', ago: 1 });
  book('Prossima: tra pochi giorni, a fattura (dentro i giorni di penale)', { tour: take(fixed, tours), day: 3, pax: 4, pay: 'invoice', client: 'Coppia Ferrari', ago: 1, late: true });
  // opzioni: date trattenute senza pagare
  book('Opzione su una data lontana', { tour: take(perPerson, fixed, tours), day: 42, pax: 10, option: true, client: 'Gruppo Verdi (preventivo inviato)', ago: 1 });
  book('Opzione più vicina', { tour: take(hourlyChoose, pick(1)), day: 25, hours: 3, pax: 8, option: true, client: 'Tour operator nordico (in attesa del cliente)', ago: 1 });
  // appena svolte (ancora da fatturare)
  book('Svolta pochi giorni fa, a fattura (da fatturare)', { tour: take(fixed, tours), day: -4, pax: 5, pay: 'invoice', client: 'Gruppo Neri', lead: 12 });
  book('Svolta pochi giorni fa, pagata con carta', { tour: take(perPerson.slice(1), perPerson, fixed), day: -6, pax: 3, pay: 'card', client: 'Coppia Smith', lead: 9, by: byColleague });

  // annullate: una rimborsata per intero, una dentro i giorni di penale (resta una penale da fatturare)
  const toCancel = book('Annullata: servizio con carta (verrà rimborsato)', { tour: take(perPerson, fixed, tours), day: 22, pax: 4, pay: 'card', client: 'Gruppo Lombardi', ago: 6 });
  if (toCancel) {
    const r = cancelBooking(app, toCancel.id, { by: 'customer', refund: 'auto' }, nowMs - DAY);
    if (r.refundCents > 0) markRefund(db, toCancel.id, { ok: true, cents: r.refundCents });
  }
  const penalty = book('Annullata dentro i giorni di penale (a fattura)', { tour: take(fixed, tours), day: 4, pax: 6, pay: 'invoice', client: 'Gruppo Bellini', ago: 5, late: true });
  if (penalty) cancelBooking(app, penalty.id, { by: 'customer', refund: 'auto' }, nowMs - 3600_000);

  // ───── fatture: una pagata, due scadute (così si prova «Paga tutto lo scaduto»), una stornata, una ancora da pagare ─────
  const old = (label, day, spec) => book(label, { day, lead: 20, by: byOwner, ...spec });
  const t1 = take(fixed, tours);
  const t2 = take(perPerson.slice(1), perPerson, fixed);
  const h1 = old('Storico: servizio di due mesi fa, a fattura', -70, { tour: t1, pax: 8, pay: 'invoice', client: 'Gruppo Marchetti' });
  const h2 = old('Storico: servizio con carta di due mesi fa', -66, { tour: t2, pax: 5, pay: 'card', client: 'Coppia Dubois' });
  const h3 = old('Storico: servizio di due mesi fa, a fattura', -64, { tour: take(hourlyChoose, tours), hours: 3, pax: 10, pay: 'invoice', client: 'Gruppo Schmidt' });
  const h4 = old('Storico: servizio di cinque settimane fa, a fattura', -40, { tour: t1, pax: 7, pay: 'invoice', client: 'Famiglia Greco' });
  const h5 = old('Storico: servizio di cinque settimane fa, a fattura', -37, { tour: t2, pax: 9, pay: 'invoice', client: 'Gruppo Pellegrini' });
  const h6 = old('Storico: servizio di due settimane fa, a fattura', -13, { tour: t1, pax: 6, pay: 'invoice', client: 'Gruppo Fontana' });
  const h7 = old('Storico: servizio con carta di due settimane fa', -11, { tour: t2, pax: 4, pay: 'card', client: 'Coppia Walker' });
  const h9 = old('Storico: servizio di sei settimane fa, a fattura', -52, { tour: take(fixed, tours), pax: 4, pay: 'invoice', client: 'Famiglia Ricci' });

  const invoice = async (label, items, issuedDaysAgo, { paidDaysAgo = null, creditedDaysAgo = null } = {}) => {
    const keys = items.filter(Boolean).map((b) => `booking:${b.id}`);
    if (!keys.length) return report.push(`✗ ${label}: nessuna prenotazione`);
    await step(label, async () => {
      const at = noon(addDays(today, -issuedDaysAgo));
      const [draft] = createDrafts(app, keys, at);
      const inv = issueInvoice(app, draft.id, at);
      setSdiStatus(app, inv.id, 'delivered', '', at + 3600_000);
      if (paidDaysAgo != null) markInvoicePaid(app, inv.id, { method: 'bank', paidAt: new Date(noon(addDays(today, -paidDaysAgo))).toISOString() }, noon(addDays(today, -paidDaysAgo)));
      if (creditedDaysAgo != null) {
        const when = noon(addDays(today, -creditedDaysAgo));
        const credit = issueInvoice(app, createCreditNote(app, inv.id, when).id, when);
        setSdiStatus(app, credit.id, 'delivered', '', when + 3600_000);
      }
    });
  };
  await invoice('Fattura pagata (bonifico arrivato)', [h1, h2, h3], 60, { paidDaysAgo: 44 });
  await invoice('Fattura scaduta da più tempo, ancora da pagare', [h9], 38);
  await invoice('Fattura scaduta, ancora da pagare', [h4, h5], 34);
  const h8 = old('Storico: servizio di tre settimane fa, a fattura (poi stornato)', -21, { tour: take(fixed, tours), pax: 5, pay: 'invoice', client: 'Gruppo Romano' });
  await invoice('Fattura stornata per intero da una nota di credito', [h8], 18, { creditedDaysAgo: 10 });
  await invoice('Fattura emessa da poco, non ancora scaduta', [h6, h7], 8);

  // ───── preventivo per un cliente dell'agenzia, con il pacchetto ancora aperto ─────
  await step('Preventivo per un cliente, con il pacchetto in preparazione', async () => {
    const lines = [
      { tour: take(perPerson, fixed, tours), day: 32, pax: 6 },
      { tour: take(hourlyChoose, tours), day: 33, pax: 6, hours: 4 },
    ];
    let added = 0;
    for (const l of lines) {
      if (!l.tour) continue;
      for (let i = 0; i < 40; i++) {
        const date = addDays(today, l.day + i);
        const hours = l.tour.pricing === 'hourly' ? (l.tour.chooseHours ? l.hours : l.tour.durationMin / 60) : null;
        const slot = daySlots(db, cfg, l.tour, date, { pax: l.pax, channel: 'b2b', nowMs, durationMin: hours ? Math.round(hours * 60) : null })[0];
        if (!slot) continue;
        try {
          cartAdd(app, account, { tour: l.tour.slug, date, time: slot.time, pax: String(l.pax), ...(hours ? { hours: String(hours) } : {}), name: account.contact_name, email: account.email, lang: 'it' }, nowMs);
          added += 1;
          break;
        } catch {
          /* si prova il giorno dopo */
        }
      }
    }
    if (!added) throw new Error('nessun servizio da mettere nel pacchetto');
    // uno già mandato e aperto dal cliente, uno accettato: l'elenco mostra tutti gli stati
    // (si creano con la data di oggi, così la validità cade sempre nel futuro; poi si retrodata solo il giorno di creazione)
    const back = (q, days) => db.prepare('UPDATE quotes SET created_at = ? WHERE id = ?').run(new Date(nowMs - days * DAY).toISOString(), q.id);
    const sent = createQuote(app, account, byOwner, { client: 'Famiglia Wilson', email: 'wilson@example.com', clientRef: 'Viaggio di nozze, ottobre', markup: 20, round: 5 }, nowMs);
    back(sent, 2);
    recordSent(db, sent.id, 'wilson@example.com', nowMs - 2 * DAY);
    markViewed(db, sent.id, nowMs - DAY);
    const accepted = createQuote(app, account, byOwner, { client: 'Gruppo Schneider', email: 'schneider@example.com', clientRef: 'Gita aziendale', markup: 12, round: 5 }, nowMs);
    back(accepted, 5);
    recordSent(db, accepted.id, 'schneider@example.com', nowMs - 5 * DAY);
    markViewed(db, accepted.id, nowMs - 4 * DAY);
    decide(db, accepted.id, 'approved', 'Perfetto, procediamo!', nowMs - 3 * DAY);
    createQuote(app, account, byOwner, { client: 'Famiglia Esposito', email: '', clientRef: 'Da rivedere con il cliente', markup: 15, round: 5 }, nowMs);
  });

  // ───── un pacchetto già prenotato: due servizi in opzione, con una sola scadenza (si confermano o si rilasciano insieme, o si toglie un servizio solo) ─────
  await step('Pacchetto di due servizi tenuto in opzione', async () => {
    const wanted = [{ tour: take(perPerson, fixed, tours), from: 58, pax: 8 }, { tour: take(hourlyChoose, tours), from: 59, pax: 8, hours: 3 }];
    const lines = [];
    for (const w of wanted) {
      for (let i = 0; i < 40 && lines.length < wanted.indexOf(w) + 1; i++) {
        const date = addDays(today, w.from + i);
        const hrs = w.tour.pricing === 'hourly' ? (w.tour.chooseHours ? w.hours : w.tour.durationMin / 60) : null;
        const slot = daySlots(db, cfg, w.tour, date, { pax: w.pax, channel: 'b2b', nowMs, durationMin: hrs ? Math.round(hrs * 60) : null })[0];
        const line = slot && resolveLine(app, { tour: w.tour.slug, date, time: slot.time, pax: String(w.pax), ...(hrs ? { hours: String(hrs) } : {}) });
        if (line) lines.push(line);
      }
    }
    if (lines.length < 2) throw new Error('servono due servizi liberi');
    createPackage(app, account, lines, { name: account.contact_name, email: account.email, lang: 'it', clientRef: 'Gruppo Hoffmann (pacchetto in opzione)', option: true, bookedBy: byOwner }, nowMs - DAY);
  });

  // ───── un programma di più giorni con la proposta già inviata ─────
  await step('Programma «Venezia in tre giorni» con proposta inviata', async () => {
    const p = createProgramRequest(app, { name: account.contact_name, email: account.email, company: account.company, channel: 'b2b', account, participants: 8, dateFrom: addDays(today, 52), dateTo: addDays(today, 54), interests: ['art', 'food'], lang: 'it', message: 'Tre giorni a Venezia per un gruppo di clienti: arte, storia e un po’ di buona cucina.' }, nowMs);
    saveProposal(app, p.id, {
      title: 'Venezia in tre giorni',
      intro: 'Ecco la proposta per il vostro gruppo.',
      notes: 'Incluso: guida abilitata. Esclusi: ingressi, trasporti e pasti.',
      depositPercent: 30,
      validUntil: addDays(today, 20),
      holdDates: true,
      days: [
        { date: addDays(today, 52), start: '09:30', end: '13:00', title: 'San Marco e Rialto', priceCents: 15000 },
        { date: addDays(today, 53), start: '10:00', end: '16:00', title: 'Le isole della laguna', description: 'Murano, Burano, Torcello', priceCents: 30000 },
        { date: addDays(today, 54), start: '09:30', end: '12:30', title: 'Cannaregio e il Ghetto', priceCents: 12000 },
      ],
    }, { nowMs });
    await app.programs.send(p.id, nowMs);
  });

  return { account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(id), report };
}
