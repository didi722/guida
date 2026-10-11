// Spagnolo come terza lingua: email transazionali, PDF allegati e ripiego di una lingua sconosciuta sull'italiano.
// I testi che vengono da server/strings.json (voucher, buono, fattura nei PDF) si confrontano con makeT('es'), non con frasi scritte qui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBooking } from '../server/bookings.js';
import { ROOT } from '../server/config.js';
import { EMAIL_TEXTS, programIcs, sendBookingCancelled, sendBookingConfirmed, sendGiftToBuyer, sendGiftToRecipient, sendInvoiceCopy, sendPartnerApproved, sendPartnerRegistered, sendProgramAccepted, sendProgramConfirmed, sendProgramReceived, sendProposalEmail, sendReviewRequest, sendSlotLostRefund } from '../server/emails.js';
import { makeT } from '../server/i18n.js';
import { createManualDraft, issueInvoice, saveDraft } from '../server/invoices.js';
import { LANGS } from '../server/langs.js';
import { createDoc, finishDoc, fold, keyValueRows, renderGiftCardPdf, renderProposalPdf, renderVoucherPdf, title } from '../server/pdf.js';
import { renderInvoicePdf } from '../server/pdf-invoice.js';
import { formatGiftCode } from '../server/pricing.js';
import { createProgramRequest, markQuoted, saveProposal } from '../server/programs.js';
import { localToInstant } from '../server/time.js';
import { HAS_PDFTOTEXT, NOW, addGift, base, isPdf, makeApp, pdfText } from './helpers.js';

const LATER = localToInstant('2027-01-20', '10:00'); // dopo i servizi di metà gennaio
const t_es = makeT('es');
const needText = { skip: HAS_PDFTOTEXT ? false : 'pdftotext (poppler) non installato: i controlli sul testo dei PDF vengono saltati' };

// pdftotext separa le lettere dei titoletti spaziati: si confronta senza spazi e senza maiuscole
const squash = (x) => x.replace(/\s+/g, '').toLowerCase();
const has = (text, ...needles) => needles.forEach((n) => assert.ok(squash(text).includes(squash(n)), `nel PDF manca «${n}»\n${text}`));
const hasNot = (text, ...needles) => needles.forEach((n) => assert.ok(!squash(text).includes(squash(n)), `nel PDF non dovrebbe esserci «${n}»`));
const flat = (s) => String(s).replace(/ /g, ' '); // Intl mette uno spazio unificatore tra importo e «€»
const unfold = (ics) => ics.replace(/\r\n /g, ''); // le righe lunghe di un .ics vanno a capo con uno spazio
const pdfsOf = (m) => m.attachments.filter((a) => a.contentType === 'application/pdf');
const lang = (pdf) => /\/Lang \(([\w-]+)\)/.exec(Buffer.from(pdf).toString('latin1'))?.[1];
const bookingRow = (app, id) => app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
const programRow = (app, id) => app.db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
const mailsTo = (app, to) => app.mail.sent.filter((m) => m.to === to);
const includesAll = (text, lines) => lines.forEach((l) => assert.ok(text.includes(l), `manca «${l}» in\n${text}`));

/** Nessun segnaposto rimasto a metà nel messaggio. */
function assertClean(m) {
  for (const f of ['subject', 'text', 'html']) if (m[f]) assert.ok(!/\b(undefined|null|NaN)\b|\[object|\$\{/.test(m[f]), `${f} di «${m.subject}» contiene un valore non risolto:\n${m[f]}`);
}

function appEs(t, over = {}) {
  const app = makeApp({
    site: { vatNumber: 'IT01234567890', guideLicense: 'Guía turístico habilitado n.º 1234', address: 'Calle del Test 1, Venecia', phone: '+39 333 1234567' },
    mail: { notifyTo: 'guida@example.com' },
    reviews: { googleUrl: 'https://reviews.example/google', tripadvisorUrl: 'https://reviews.example/tripadvisor' },
    ...over,
  });
  t.after(() => app.cleanup());
  const tour = app.content.tour('shared');
  tour.i18n.it = { ...tour.i18n.it, title: 'Cannaregio e il Ghetto', meetingPoint: 'Ponte delle Guglie, Cannaregio' };
  tour.i18n.es = { title: 'Cannaregio y el Gueto', subtitle: 'La Venecia de las comunidades', meetingPoint: 'Puente de las Guglie, Cannaregio', meetingUrl: 'https://maps.example/guglie', includes: ['Guía turístico habilitado'], excludes: ['Entradas a los museos'], notes: 'Te pedimos una vestimenta respetuosa: ¿vale?' };
  return app;
}

/** App con i dati fiscali del cedente, per le fatture. */
function appInvoices(t) {
  const app = makeApp({
    site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
  });
  t.after(() => app.cleanup());
  return app;
}
const issue = (app, buyer, description, amountCents) => {
  const d = createManualDraft(app, LATER);
  saveDraft(app, d.id, { buyer, lines: [{ description, amountCents }], issueDate: '2027-01-20', options: {} }, LATER);
  return issueInvoice(app, d.id, LATER);
};

// ───────────── dizionari ─────────────
/** Una voce può essere un testo, una funzione o un piccolo oggetto di testi: la si riduce a [percorso, testo] con dei segnaposto «§n§» al posto degli argomenti. */
const flatten = (name, v) => (typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => flatten(`${name}.${k}`, x)) : [[name, typeof v === 'function' ? v(...Array.from({ length: v.length }, (_, i) => `§${i}§`)) : v]]);

test('dizionari delle email: ogni lingua ha le stesse chiavi, gli stessi parametri e gli stessi segnaposto, nessun testo vuoto', () => {
  const marks = (s) => [...String(s).matchAll(/§\d§/g)].map((m) => m[0]).sort().join('');
  for (const [name, dict] of Object.entries(EMAIL_TEXTS)) {
    assert.deepEqual(Object.keys(dict).sort(), [...LANGS].sort(), `${name}: una voce per ogni lingua`);
    for (const l of LANGS) {
      assert.deepEqual(Object.keys(dict[l]).sort(), Object.keys(dict.it).sort(), `${name}.${l}: stesse chiavi dell'italiano`);
      for (const key of Object.keys(dict.it)) {
        const [it, other] = [dict.it[key], dict[l][key]];
        assert.equal(typeof other, typeof it, `${name}.${l}.${key}: stesso tipo dell'italiano`);
        if (typeof it === 'function') assert.equal(other.length, it.length, `${name}.${l}.${key}: stessi parametri`);
        const [mine, ref] = [flatten(`${name}.${l}.${key}`, other), flatten(`${name}.it.${key}`, it)];
        assert.equal(mine.length, ref.length, `${name}.${l}.${key}: stesse voci`);
        mine.forEach(([where, text], i) => {
          assert.ok(typeof text === 'string' && text.trim(), `${where}: testo vuoto`);
          assert.ok(!/\b(undefined|null)\b|\$\{/.test(text), `${where}: segnaposto non risolto`);
          assert.equal(marks(text), marks(ref[i][1]), `${where}: i segnaposto non coincidono con l'italiano`);
        });
      }
    }
  }
});

test('testi spagnoli delle email: «tú» (mai vosotros/ustedes), ¿…? e ¡…! bilanciati, «Venecia» e non «Venezia»', () => {
  const texts = Object.entries(EMAIL_TEXTS).flatMap(([name, dict]) => Object.entries(dict.es).flatMap(([key, v]) => flatten(`${name}.es.${key}`, v)));
  assert.ok(texts.length > 80, `${texts.length} testi`);
  for (const [where, s] of texts) {
    assert.ok(!/\b(vosotros|vosotras|vuestr[oa]s?|ustedes?|usted|habéis|podéis|queréis|tenéis|sois|vais|tenés|querés|podés)\b/i.test(s), `${where}: forma diversa dal «tú»: ${s}`);
    assert.equal((s.match(/¿/g) ?? []).length, (s.match(/\?/g) ?? []).length, `${where}: ¿ ? non bilanciati: ${s}`);
    assert.equal((s.match(/¡/g) ?? []).length, (s.match(/!/g) ?? []).length, `${where}: ¡ ! non bilanciati: ${s}`);
    assert.ok(!/ {2}|\s[,.;:]|\bVenezia\b/.test(s), `${where}: spazi doppi o «Venezia» al posto di «Venecia»: ${s}`);
  }
});

// ───────────── prenotazione ─────────────
test('prenotazione con lang es: conferma in spagnolo (oggetto, saluto, riepilogo, link /es/), .ics e voucher PDF validi; la guida riceve l’avviso in italiano', async (t) => {
  const app = appEs(t);
  const { booking } = await app.services.book(base({ lang: 'es', date: '2027-01-12', name: 'Íñigo Muñoz', phone: '+34 600 000 000', notes: '¿Podemos llevar un cochecito? ¡Gracias!' }), 'es', NOW);
  assert.equal(booking.lang, 'es', 'la prenotazione conserva la lingua');
  const [m] = mailsTo(app, 'mario@example.com');
  assertClean(m);
  assert.match(m.subject, /^Reserva confirmada VE-[A-Z0-9]+ — Cannaregio y el Gueto, 12 ene\.? 2027$/);
  const text = flat(m.text);
  assert.ok(text.startsWith('Hola Íñigo Muñoz,\n\ntu reserva está confirmada. Aquí tienes el resumen.\n'), text);
  includesAll(text, [`Código: ${booking.ref}`, 'Servicio: Cannaregio y el Gueto', 'Fecha: martes, 12 de enero de 2027', 'Hora: 09:30–12:00', 'Participantes: 2', 'Punto de encuentro: Puente de las Guglie, Cannaregio', 'Total: 70 € (a pagar el día del servicio)', 'Cancelación gratuita hasta el 10 ene', 'Pasado ese plazo no se prevé reembolso.', 'El archivo adjunto añade el servicio a tu calendario.', `Gestiona o cancela la reserva: http://localhost:3000/es/booking/${booking.ref}?t=${booking.token}`, 'Para cualquier cosa, responde a este correo.']);
  assert.ok(text.trimEnd().endsWith('Hasta pronto, Davide Tomio'), 'congedo');
  assert.ok(app.cfg.site.tagline.es && app.cfg.site.tagline.es !== app.cfg.site.tagline.en, 'la configurazione ha lo slogan spagnolo');
  assert.ok(m.html.includes('Hola Íñigo Muñoz,') && m.html.includes(app.cfg.site.tagline.es) && m.html.includes('/es/booking/') && m.html.includes('Gestiona o cancela la reserva'), 'anche l’HTML è in spagnolo');

  // allegati: calendario e voucher
  const ics = unfold(m.attachments.find((a) => a.filename === `${booking.ref}.ics`).content);
  includesAll(ics, ['SUMMARY:Cannaregio y el Gueto (Davide Tomio)', `DESCRIPTION:${booking.ref} — 2 participantes`, 'LOCATION:Puente de las Guglie\\, Cannaregio', `/es/booking/${booking.ref}`]);
  const [pdf] = pdfsOf(m);
  assert.equal(pdf.filename, `voucher-${booking.ref}.pdf`);
  assert.ok(isPdf(pdf.content));
  assert.equal(lang(pdf.content), 'es-ES', 'il PDF dichiara la lingua');
  if (HAS_PDFTOTEXT) {
    const pt = pdfText(pdf.content);
    has(pt, 'Íñigo Muñoz', '¿Podemos llevar un cochecito? ¡Gracias!', 'martes, 12 de enero de 2027', '09:30 – 12:00', 'Cannaregio y el Gueto', 'La Venecia de las comunidades', 'Puente de las Guglie', 'Entradas a los museos', 'vestimenta respetuosa: ¿vale?', 'GUÍA TURÍSTICO · VENECIA', 'Guía turístico habilitado n.º 1234', 'N.º IVA IT01234567890', '70 €', `/es/booking/${booking.ref}?t=${booking.token}`, t_es('voucher.title'), t_es('pdf.bookingRef'), t_es('voucher.note'));
    hasNot(pt, 'P.IVA', 'VAT no.');
  }

  // la guida riceve l'avviso in italiano (con il titolo italiano del tour)
  const [notice] = mailsTo(app, 'guida@example.com');
  assert.equal(notice.subject, 'Nuova prenotazione: Cannaregio e il Ghetto — 2027-01-12 09:30');
  assert.ok(/Totale: 70\s€/.test(notice.text) && notice.text.includes('martedì 12 gennaio 2027'), notice.text);
});

test('annullo, slot perso e richiesta di recensione in spagnolo', async (t) => {
  const app = appEs(t);
  const { booking } = await app.services.book(base({ lang: 'es', date: '2027-01-12' }), 'es', NOW);
  const b = bookingRow(app, booking.id);
  app.mail.sent.length = 0;
  const lastToClient = () => mailsTo(app, 'mario@example.com').at(-1);

  await sendBookingCancelled(app, b, 3500);
  let m = lastToClient();
  assertClean(m);
  assert.equal(m.subject, `Reserva cancelada ${b.ref}`);
  includesAll(flat(m.text), ['la reserva ha sido cancelada.', 'Reembolso: 35 €, abonado en el método de pago original (normalmente entre 5 y 10 días hábiles).']);
  assert.match(mailsTo(app, 'guida@example.com')[0].subject, /^Prenotazione annullata:/, 'avviso alla guida in italiano');

  await sendBookingCancelled(app, { ...b, payment_method: 'card' }, 0);
  assert.ok(lastToClient().text.includes('Esta cancelación no da derecho a reembolso.'), lastToClient().text);

  await sendSlotLostRefund(app, b);
  m = lastToClient();
  assertClean(m);
  assert.equal(m.subject, `Reserva ${b.ref}: horario ya no disponible, reembolso en curso`);
  assert.ok(m.text.startsWith('Hola Mario Rossi,\n\npor desgracia, el pago llegó'), m.text);
  assert.ok(m.text.includes('Disculpa las molestias: puedes elegir otro horario en la web o escribirme.') && m.text.trimEnd().endsWith('Hasta pronto, Davide Tomio'));

  await sendReviewRequest(app, b);
  m = lastToClient();
  assertClean(m);
  assert.equal(m.subject, '¿Qué tal ha ido? Tu tour por Venecia con Davide Tomio');
  includesAll(flat(m.text), ['Hola Mario Rossi,', 'gracias por haber elegido «Cannaregio y el Gueto» (12 ene', 'Escribe una reseña en Google: https://reviews.example/google', 'Escribe una reseña en Tripadvisor: https://reviews.example/tripadvisor', '¿Prefieres contármelo en privado (qué ha ido bien, qué se podría mejorar)?', `Deja un comentario privado: http://localhost:3000/es/feedback/${b.ref}?t=${b.token}`, 'Gracias de nuevo y hasta pronto en Venecia,', 'Este es el único correo que te envío después del tour.']);
  assert.ok(m.html.includes('Escribe una reseña en Google') && m.html.includes('Deja un comentario privado'));
});

// ───────────── buoni regalo ─────────────
test('buono regalo in spagnolo: nome del prodotto nel pagamento, email all’acquirente e al destinatario, PDF allegato', async (t) => {
  const app = appEs(t);
  const checkouts = [];
  const realCheckout = app.payments.createCheckout.bind(app.payments);
  t.mock.method(app.payments, 'createCheckout', async (args) => {
    checkouts.push(args);
    return realCheckout(args);
  });
  const message = '¡Feliz cumpleaños, Lucía! Un paseo para descubrir Venecia juntas.';
  const { card } = await app.gifts.buy({ amountCents: 5000, buyerName: 'Ana García', buyerEmail: 'ana@example.com', delivery: 'recipient', recipientName: 'Lucía Peña', recipientEmail: 'lucia@example.com', deliverOn: '2027-01-04', message, lang: 'es' }, 'es', NOW);
  assert.equal(card.lang, 'es');
  assert.deepEqual([checkouts[0].title, checkouts[0].description, checkouts[0].lang], ['Tarjeta regalo — Davide Tomio', 'Tarjeta regalo · Lucía Peña', 'es']);
  const { handler, row: pending } = app.payables.lookup(card.ref);
  assert.deepEqual(['it', 'en', 'es', 'xx', undefined].map((l) => handler.title(pending, l)), ['Buono regalo', 'Gift card', 'Tarjeta regalo', 'Buono regalo', 'Buono regalo']);

  await app.gifts.handlePaid(card.id, null, NOW);
  const code = formatGiftCode(app.db.prepare('SELECT code FROM gift_cards WHERE id = ?').get(card.id).code);

  const [buyer] = mailsTo(app, 'ana@example.com');
  assertClean(buyer);
  assert.equal(flat(buyer.subject), 'Tu tarjeta regalo de 50 €');
  const bt = flat(buyer.text);
  assert.ok(bt.startsWith('Hola Ana García,\n\n¡gracias! Tu tarjeta regalo está lista.\nLa hemos enviado a lucia@example.com.\n'), bt);
  includesAll(bt, ['Importe: 50 €', `Código: ${code}`, 'Válida hasta: 4 de enero de 2029', 'Cómo se usa: elige un tour en la web', 'campo «Tarjeta regalo»', 'http://localhost:3000/es/tours']);
  assert.ok(bt.trimEnd().endsWith('Hasta pronto, Davide Tomio'));
  assert.ok(buyer.html.includes('Hola Ana García,') && buyer.html.includes('Elige tu tour') && buyer.html.includes(code) && buyer.html.includes('/es/tours'));
  assert.ok(!buyer.html.includes(message), 'l’acquirente non vede il messaggio per il destinatario');

  const [recipient] = mailsTo(app, 'lucia@example.com');
  assertClean(recipient);
  assert.equal(recipient.subject, 'Ana García te ha regalado una experiencia en Venecia');
  const rt = flat(recipient.text);
  assert.ok(rt.startsWith('Hola Lucía Peña, has recibido una tarjeta regalo para descubrir Venecia con un guía turístico habilitado.\nDe parte de Ana García\n'), rt);
  includesAll(rt, [`«${message}»`, `Código: ${code}`, 'Válida hasta: 4 de enero de 2029']);
  assert.ok(recipient.html.includes('Elige tu tour') && recipient.html.includes(message));

  for (const m of [buyer, recipient]) {
    const [pdf] = pdfsOf(m);
    assert.match(pdf.filename, /^buono-regalo-GC-\w+\.pdf$/);
    assert.ok(isPdf(pdf.content));
    assert.equal(lang(pdf.content), 'es-ES');
    if (HAS_PDFTOTEXT) has(pdfText(pdf.content), '50 €', 'Lucía Peña', 'Ana García', message, '4 de enero de 2029', code, t_es('pdf.giftTitle'), t_es('gift.code'), 'N.º IVA IT01234567890');
  }
  assert.match(mailsTo(app, 'guida@example.com')[0].subject, /^Buono regalo venduto: 50\s€/, 'avviso alla guida in italiano');
});

// ───────────── partner ─────────────
test('partner in spagnolo: richiesta ricevuta e account attivo, con il link /es/b2b/login; la guida riceve l’avviso in italiano', async (t) => {
  const app = appEs(t);
  const a = { id: 7, lang: 'es', contact_name: 'Lucía Peña', email: 'dmc@example.com', company: 'Madrid DMC', country: 'ES', vat: 'B12345678' };
  await sendPartnerRegistered(app, a);
  await sendPartnerApproved(app, a);
  const [received, notice, approved] = app.mail.sent;
  [received, notice, approved].forEach(assertClean);
  assert.equal(received.subject, 'Solicitud de acceso de partner recibida');
  assert.ok(received.text.startsWith('Hola Lucía Peña,\nhe recibido tu solicitud de acceso al área de partners.') && received.text.trimEnd().endsWith('Hasta pronto, Davide Tomio'), received.text);
  assert.equal(notice.to, 'guida@example.com');
  assert.equal(notice.subject, 'Nuova richiesta partner: Madrid DMC');
  assert.equal(approved.subject, 'Tu cuenta de partner está activa');
  assert.ok(approved.text.includes('Accede aquí: http://localhost:3000/es/b2b/login') && approved.text.startsWith('Hola Lucía Peña,\ntu cuenta de partner ha sido aprobada'), approved.text);
});

// ───────────── programmi di più giorni ─────────────
test('programma in spagnolo: richiesta, proposta con PDF, accettazione con anticipo, conferma con calendario', async (t) => {
  const app = appEs(t);
  const p = await app.programs.submit({ name: 'Marta Ruiz', email: 'marta@example.com', company: 'Madrid Viajes', participants: 4, dateFrom: '2027-02-10', dateTo: '2027-02-12', groupType: 'family', interests: ['art'], lang: 'es' }, NOW);
  assert.equal(p.lang, 'es');
  const last = () => mailsTo(app, 'marta@example.com').at(-1);

  let m = last();
  assertClean(m);
  assert.equal(m.subject, `Solicitud recibida ${p.ref}: programa en Venecia`);
  let text = flat(m.text);
  includesAll(text, ['Hola Marta Ruiz,', 'he recibido tu solicitud de un programa de varios días. Te responderé con una propuesta, normalmente en un plazo de dos días hábiles.', 'Fechas: 10 feb 2027 → 12 feb 2027', 'Personas: 4', `Abre la página del programa: http://localhost:3000/es/programs/${p.ref}?t=${p.token}`, 'Para cualquier cosa, responde a este correo.']);
  assert.ok(text.trimEnd().endsWith('Hasta pronto, Davide Tomio'));
  assert.match(mailsTo(app, 'guida@example.com')[0].subject, /^Nuova richiesta di programma: Marta Ruiz \(PR-/, 'avviso alla guida in italiano');

  const days = [
    { date: '2027-02-10', start: '09:30', end: '13:00', title: 'San Marcos, Rialto y los sestieri', description: 'El corazón de la ciudad.', priceCents: 18000 },
    { date: '2027-02-11', start: '10:00', end: '16:00', title: 'Islas de la laguna', priceCents: 42000 },
  ];
  saveProposal(app, p.id, { title: 'Venecia en tres días', intro: 'Aquí tienes la propuesta.', notes: 'Incluido: guía turístico habilitado.', depositPercent: 30, validUntil: '2027-01-20', holdDates: true, days }, { nowMs: NOW });
  await app.programs.send(p.id, NOW);
  m = last();
  assertClean(m);
  assert.equal(m.subject, `Tu propuesta de programa en Venecia (${p.ref})`);
  text = flat(m.text);
  includesAll(text, ['aquí tienes la propuesta de programa que he preparado para ti.', 'San Marcos, Rialto y los sestieri (180 €)', 'Total: 600 €', 'Anticipo (30%): 180 €', 'Válida hasta el 20 de enero de 2027', `Consulta y acepta la propuesta: http://localhost:3000/es/programs/${p.ref}?t=${p.token}`]);
  assert.ok(m.html.includes('Consulta y acepta la propuesta') && m.html.includes('Anticipo (30%)'));
  const [proposal] = pdfsOf(m);
  assert.equal(proposal.filename, `proposta-${p.ref}.pdf`);
  assert.ok(isPdf(proposal.content));
  assert.equal(lang(proposal.content), 'es-ES');
  if (HAS_PDFTOTEXT) has(pdfText(proposal.content), 'Venecia en tres días', 'Aquí tienes la propuesta.', 'San Marcos, Rialto y los sestieri', 'El corazón de la ciudad.', '600 €', '180 €', '420 €', 'Marta Ruiz, Madrid Viajes', 'mié, 10 feb', '20 de enero de 2027', t_es('pdf.proposal'), t_es('pdf.proposalFor'), 'N.º IVA IT01234567890');

  const res = await app.programs.accept(p.id, 'es', NOW);
  assert.equal(res.outcome, 'accepted');
  m = last();
  assertClean(m);
  assert.equal(m.subject, `Propuesta aceptada ${p.ref}: solo falta el anticipo`);
  includesAll(flat(m.text), ['¡gracias por aceptar la propuesta! Para confirmar el programa hace falta un anticipo de 180 €.', `Paga el anticipo: http://localhost:3000/pay/resume/${p.ref}?t=${p.token}&lang=es`]);

  await app.programs.handleDepositPaid(p.id, null, NOW);
  m = last();
  assertClean(m);
  assert.equal(m.subject, `Programa confirmado ${p.ref}`);
  assert.ok(flat(m.text).includes('tu programa está confirmado: las fechas quedan reservadas para ti y tu grupo.'), m.text);
  const ics = unfold(m.attachments.find((a) => a.filename === `${p.ref}.ics`).content);
  includesAll(ics, ['SUMMARY:Venecia en tres días: San Marcos\\, Rialto y los sestieri', `/es/programs/${p.ref}`]);

  // senza titolo della proposta, il calendario usa il nome della città nella lingua giusta
  const untitled = { ...programRow(app, p.id), proposal_title: null };
  assert.deepEqual(['it', 'en', 'es'].map((l) => /SUMMARY:(\w+):/.exec(unfold(programIcs(app, untitled, l)))[1]), ['Venezia', 'Venice', 'Venecia']);
});

// ───────────── fatture ─────────────
test('fattura a un cliente spagnolo: copia di cortesia con etichette in spagnolo e importi all’uso spagnolo, email in spagnolo', async (t) => {
  const app = appInvoices(t);
  const inv = issue(app, { kind: 'person', firstName: 'Íñigo', lastName: 'Muñoz Núñez', country: 'ES', address: 'Calle de Alcalá 12', zip: '28014', city: 'Madrid', email: 'inigo@example.com', lang: 'es' }, 'Visita guiada privada por Venecia', 123456);
  assert.equal(JSON.parse(inv.buyer_json).lang, 'es');

  const pdf = await renderInvoicePdf(app, inv);
  assert.ok(isPdf(pdf));
  assert.equal(lang(pdf), 'es-ES');
  if (HAS_PDFTOTEXT) {
    const text = pdfText(pdf);
    has(text, 'Íñigo Muñoz Núñez', 'Calle de Alcalá 12', '28014 Madrid – ES', 'Visita guiada privada por Venecia', '1234,56 €', 'N.º IVA IT12345678903', '20 de enero de 2027', t_es('inv.pdf.invoice'), t_es('inv.pdf.seller'), t_es('inv.pdf.buyer'), t_es('inv.pdf.total'), t_es('inv.pdf.footer'));
    hasNot(text, '€1,234.56', '1.234,56');
  }

  assert.equal(await sendInvoiceCopy(app, inv, 'inigo@example.com', {}), true);
  const m = app.mail.sent.at(-1);
  assertClean(m);
  assert.ok(m.text.startsWith('Hola Íñigo,\n\n') && m.text.trimEnd().endsWith('Hasta pronto, Davide Tomio'), m.text);
  assert.ok(m.html.includes(app.cfg.site.tagline.es));
  assert.deepEqual(m.attachments.map((a) => a.filename), ['fattura-1-2027.pdf']);
  assert.ok(isPdf(m.attachments[0].content));
  const kind = t_es('inv.mail.kindInvoice');
  assert.equal(m.subject, `${kind.charAt(0).toUpperCase()}${kind.slice(1)} 1/2027 — Davide Tomio`);
});

// ───────────── caratteri nei PDF ─────────────
const SPANISH_CHARS = 'ñÑáéíóúÁÉÍÓÚüÜ¿¡«»“”‘’–—€ºª';

test('fold: i caratteri dello spagnolo restano intatti; ñ e vocali accentate «scomposte» vengono ricomposte', () => {
  for (const ch of SPANISH_CHARS) assert.equal(fold(ch), ch, `fold perde «${ch}»`);
  const sentence = 'El pingüino Wenceslao hizo kilómetros bajo exhaustiva lluvia y frío. ¿Qué tal? ¡Cuánta alegría! «Hola», “dijo”, ‘eso’ – 12 € — N.º 5, 1.ª y 2.º';
  assert.equal(fold(sentence), sentence);
  assert.equal(fold('Muñoz Núñez, Ángel, José, über'), 'Muñoz Núñez, Ángel, José, über', 'NFD → NFC');
  assert.equal(fold('Łukasz Dvořák – Иван'), 'Lukasz Dvorák – ????', 'le regole per gli altri alfabeti non cambiano');
});

test('font del PDF: Josefin Sans ha tutti i glifi dello spagnolo (controllo sui file dei font, non solo sul testo estratto)', async (t) => {
  let fontkit;
  try {
    fontkit = await import('fontkit');
  } catch {
    return t.skip('fontkit non disponibile');
  }
  const dir = path.join(ROOT, 'node_modules', '@fontsource', 'josefin-sans', 'files');
  for (const f of ['400-normal', '300-normal', '700-normal', '400-italic']) {
    const font = fontkit.create(fs.readFileSync(path.join(dir, `josefin-sans-latin-${f}.woff`)));
    assert.deepEqual([...SPANISH_CHARS].filter((c) => !font.hasGlyphForCodePoint(c.codePointAt(0))), [], `Josefin Sans ${f}: glifi mancanti`);
  }
});

test('PDF reale: un documento con tutti i caratteri spagnoli (anche scomposti) li riporta tutti nel testo', needText, async (t) => {
  const app = appEs(t);
  const doc = createDoc(app, { title: 'Glifos ñ ¿?', subject: 'Prueba', lang: 'es', label: 'Prueba' });
  title(doc, 'Glifos españoles', 'Ñandú, ¿qué tal? ¡Hola!', 'Áé Íó Úü: «sí» “no” ‘tal vez’');
  keyValueRows(doc, [
    ['Caracteres', SPANISH_CHARS, { bold: true }],
    ['Frase', 'El pingüino Wenceslao hizo kilómetros bajo exhaustiva lluvia y frío. N.º 5 · 1.ª y 2.º'],
    ['Nombre', 'Muñoz Núñez'],
  ]);
  const pdf = await finishDoc(doc, app, 'es');
  assert.ok(isPdf(pdf));
  has(pdfText(pdf), SPANISH_CHARS, 'Ñandú, ¿qué tal? ¡Hola!', 'Áé Íó Úü: «sí» “no” ‘tal vez’', 'pingüino', 'kilómetros', 'N.º 5 · 1.ª y 2.º', 'Muñoz Núñez', 'GUÍA TURÍSTICO · VENECIA', 'N.º IVA IT01234567890');
});

test('buono regalo, voucher e proposta con nomi e messaggi spagnoli; una lingua sconosciuta nei PDF ripiega sull’italiano', needText, async (t) => {
  const app = appEs(t);
  const card = addGift(app.db, { initial_cents: 7500, buyer_name: 'Íñigo Muñoz', recipient_name: 'Doña Begoña Peña', message: '¿Vamos juntos? ¡Feliz cumpleaños!', lang: 'es' });
  has(pdfText(await renderGiftCardPdf(app, card, 'es')), '75 €', 'Doña Begoña Peña', 'Íñigo Muñoz', '«¿Vamos juntos? ¡Feliz cumpleaños!»', t_es('pdf.giftTitle'));
  const b = createBooking(app, base({ lang: 'es', name: 'Núria Ibáñez', date: '2027-01-12' }), NOW);
  has(pdfText(await renderVoucherPdf(app, b, { nowMs: NOW })), 'Núria Ibáñez', 'martes, 12 de enero de 2027');
  const xx = await renderVoucherPdf(app, b, { lang: 'xx', nowMs: NOW });
  assert.equal(lang(xx), 'it-IT');
  has(pdfText(xx), 'martedì 12 gennaio 2027', 'P.IVA IT01234567890', 'GUIDA TURISTICA · VENEZIA');
  const p = createProgramRequest(app, { name: 'Marta', email: 'marta@example.com', participants: 2, lang: 'es' }, NOW);
  saveProposal(app, p.id, { title: 'Venecia', depositPercent: 0, validUntil: '2027-01-20', days: [{ date: '2027-02-10', start: '09:30', end: '12:00', title: 'Día único', priceCents: 10000 }] }, { nowMs: NOW });
  markQuoted(app, p.id, NOW);
  const proposal = await renderProposalPdf(app, programRow(app, p.id), 'xx');
  assert.equal(lang(proposal), 'it-IT');
  has(pdfText(proposal), 'Día único', 'P.IVA IT01234567890');
});

// ───────────── lingua sconosciuta ─────────────
test('lingua sconosciuta (xx): prenotazioni, buoni, partner, programmi e fatture ripiegano sull’italiano, senza errori né «undefined»', async (t) => {
  const app = appEs(t);

  // prenotazione: createBooking salva «it»; se nel database c'è comunque un valore strano le email non devono rompersi
  const { booking } = await app.services.book(base({ lang: 'xx', date: '2027-01-12' }), 'it', NOW);
  assert.equal(booking.lang, 'it');
  let [m] = mailsTo(app, 'mario@example.com');
  assertClean(m);
  assert.match(m.subject, /^Prenotazione confermata VE-[A-Z0-9]+ — Cannaregio e il Ghetto, 12 gen 2027$/);
  assert.ok(m.text.startsWith('Ciao Mario Rossi,\n\nla tua prenotazione è confermata.') && m.text.includes('/it/booking/'), m.text);
  assert.ok(isPdf(pdfsOf(m)[0].content));

  app.db.prepare(`UPDATE bookings SET lang = 'xx' WHERE id = ?`).run(booking.id);
  const b = bookingRow(app, booking.id);
  assert.equal(b.lang, 'xx');
  app.mail.sent.length = 0;
  await sendBookingConfirmed(app, b, NOW);
  await sendBookingCancelled(app, b, 1000);
  await sendSlotLostRefund(app, b);
  await sendReviewRequest(app, b);
  const toClient = mailsTo(app, 'mario@example.com');
  assert.equal(toClient.length, 4);
  for (const x of toClient) {
    assertClean(x);
    assert.ok(x.text.startsWith('Ciao Mario Rossi,\n'), `${x.subject}: ${x.text.slice(0, 40)}`);
    assert.ok(!/\/xx\//.test(x.text + x.html), 'nessun link con la lingua sconosciuta');
  }
  assert.deepEqual(toClient.map((x) => x.subject.split(' ')[0]), ['Prenotazione', 'Prenotazione', 'Prenotazione', 'Com’è']);

  // buoni regalo
  const card = addGift(app.db, { initial_cents: 5000, buyer_name: 'Anna', buyer_email: 'anna@example.com', recipient_name: 'Luca', recipient_email: 'luca@example.com', message: 'Auguri!', lang: 'xx', deliver_on: '2027-01-04' });
  app.mail.sent.length = 0;
  await sendGiftToBuyer(app, card);
  await sendGiftToRecipient(app, card);
  const [gb, gr] = app.mail.sent;
  assertClean(gb);
  assertClean(gr);
  assert.match(gb.subject, /^Il tuo buono regalo da 50\s€$/);
  assert.ok(gb.text.startsWith('Ciao Anna,\n') && gr.text.startsWith('Ciao Luca, hai ricevuto un buono regalo'), `${gb.text}\n${gr.text}`);
  assert.ok(isPdf(pdfsOf(gb)[0].content) && isPdf(pdfsOf(gr)[0].content));
  await sendGiftToBuyer(app, { ...card, buyer_name: null }); // buono creato dal pannello, senza nome dell'acquirente: niente «Ciao null,»
  assert.ok(app.mail.sent.at(-1).text.startsWith('Ciao,\n'), app.mail.sent.at(-1).text);

  // partner
  app.mail.sent.length = 0;
  const a = { id: 3, lang: 'xx', contact_name: 'Giulia', email: 'dmc@example.com', company: 'Venice DMC' };
  await sendPartnerRegistered(app, a);
  await sendPartnerApproved(app, a);
  assert.equal(app.mail.sent[0].subject, 'Richiesta di accesso partner ricevuta');
  assert.ok(app.mail.sent[2].text.includes('Accedi qui: http://localhost:3000/it/b2b/login'), app.mail.sent[2].text);

  // programmi
  const p = createProgramRequest(app, { name: 'Marco', email: 'marco@example.com', participants: 2, dateFrom: '2027-02-10', lang: 'xx' }, NOW);
  assert.equal(p.lang, 'it');
  saveProposal(app, p.id, { title: 'Venezia', depositPercent: 30, validUntil: '2027-01-20', days: [{ date: '2027-02-10', start: '09:30', end: '13:00', title: 'Giornata', priceCents: 18000 }] }, { nowMs: NOW });
  markQuoted(app, p.id, NOW);
  const q = { ...programRow(app, p.id), lang: 'xx' };
  app.mail.sent.length = 0;
  await sendProgramReceived(app, q);
  await sendProposalEmail(app, q);
  await sendProgramAccepted(app, q);
  await sendProgramConfirmed(app, q);
  const toMarco = mailsTo(app, 'marco@example.com');
  assert.equal(toMarco.length, 4);
  for (const x of toMarco) {
    assertClean(x);
    assert.ok(x.text.startsWith('Ciao Marco,\n'), x.subject);
    assert.ok(!/\/xx\/|lang=xx/.test(x.text + x.html), 'nessun link con la lingua sconosciuta');
  }
  assert.deepEqual(toMarco.map((x) => x.subject.split(' ')[0]), ['Richiesta', 'La', 'Proposta', 'Programma']);
  assert.ok(isPdf(pdfsOf(toMarco[1])[0].content));
  assert.match(unfold(programIcs(app, q)), /\/it\/programs\//);

  // fattura con la lingua del cliente sconosciuta nei dati salvati
  const app2 = appInvoices(t);
  const inv = issue(app2, { kind: 'person', firstName: 'Matteo', lastName: 'Moretti', country: 'IT', taxCode: 'MRTMTT91D08F205J', address: 'Via Roma 1', zip: '20100', city: 'Milano', province: 'MI', lang: 'xx' }, 'Servizio', 10000);
  const odd = { ...inv, buyer_json: JSON.stringify({ ...JSON.parse(inv.buyer_json), lang: 'xx' }) };
  assert.equal(await sendInvoiceCopy(app2, odd, 'matteo@example.com', {}), true);
  m = app2.mail.sent.at(-1);
  assertClean(m);
  assert.ok(m.text.startsWith('Ciao Matteo,\n\n') && m.text.trimEnd().endsWith('A presto, Davide Tomio'), m.text);
  assert.ok(isPdf(m.attachments[0].content));
  assert.equal(lang(m.attachments[0].content), 'it-IT');
});
