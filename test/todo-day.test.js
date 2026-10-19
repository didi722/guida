// «Da fare» (tutto ciò che aspetta la guida), scheda operativa del giorno e scheda serale per email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../server/bookings.js';
import { requestExtension } from '../server/changes.js';
import { daySheet } from '../server/daySheet.js';
import { createDrafts, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { renderDaySheetPdf } from '../server/pdf-day.js';
import { createProgramRequest } from '../server/programs.js';
import { localToInstant } from '../server/time.js';
import { todoBadge, todoList } from '../server/todo.js';
import { joinWaitlist } from '../server/waitlist.js';
import { addAccount, base, HAS_PDFTOTEXT, isPdf, makeApp, NOW, pdfPages, pdfText } from './helpers.js';

const GUIDE = 'guida@example.com';
const HOUR = 3_600_000;
const at = (date, time = '10:00') => localToInstant(date, time);
const find = (todo, id) => todo.sections.find((s) => s.id === id);
const texts = (todo, id) => (find(todo, id)?.items ?? []).map((i) => i.text);

function appFor(over = {}) {
  return makeApp({
    mail: { notifyTo: GUIDE },
    site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' },
    invoice: { iban: 'IT60X0542811101000000123456', bank: 'Banca di Prova', seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } },
    ...over,
  });
}
const agency = (app, over = {}) => addAccount(app.db, { email: 'dmc@example.com', company: 'Lagoon DMC', contact_name: 'Anna', phone: '+39 041 000000', vat: '01234567897', sdi_code: 'ABC1234', country: 'IT', lang: 'it', ...over });
const b2b = (app, acct, over = {}) => createBooking(app, base({ channel: 'b2b', account: acct, email: acct.email, name: 'Anna', paymentMethod: 'invoice', clientRef: 'Gruppo Rossi', ...over }), NOW);

test('da fare: senza nulla in sospeso non c’è niente; il numero del menu conta solo ciò che è urgente o da fare', () => {
  const app = appFor();
  assert.deepEqual(todoList(app, NOW), { sections: [], count: 0, today: '2027-01-04' });
  assert.equal(todoBadge(app, NOW), 0);
  app.cleanup();
});

test('da fare: tutte le voci, ognuna con tono, testo e collegamento', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = agency(app);
  addAccount(app.db, { email: 'nuova@example.com', company: 'Nuova DMC', status: 'pending' });
  createProgramRequest(app, { name: 'Giulia Bianchi', email: 'g@example.com', participants: 4, dateFrom: '2027-02-10', dateTo: '2027-02-12', lang: 'it' }, NOW);
  const opt = b2b(app, acct, { date: '2027-02-20', time: '09:30', pax: 2, option: true, paymentMethod: undefined });
  requestExtension(app, opt, { days: 3, note: 'il cliente decide giovedì' }, NOW);
  const done = b2b(app, acct, { date: '2027-01-12', time: '09:30', pax: 3 });
  const [draft] = createDrafts(app, [`booking:${done.id}`], at('2027-01-20'));
  const d = invoiceDetail(app, draft.id);
  saveDraft(app, draft.id, { buyer: { kind: 'company', name: 'Lagoon DMC', country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: acct.email, lang: 'it' }, lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } });
  const inv = issueInvoice(app, draft.id, at('2027-01-20'));
  createBooking(app, base({ tourSlug: 'shared', date: '2027-01-14', time: '09:30', pax: 2, paymentMethod: 'onsite' }), NOW); // svolto, non incassato
  const failed = createBooking(app, base({ tourSlug: 'shared', date: '2027-02-01', time: '09:30', pax: 1, paymentMethod: 'onsite', email: 'b@example.com' }), NOW);
  app.db.prepare(`UPDATE bookings SET payment_status = 'refund_failed' WHERE id = ?`).run(failed.id);
  app.calendars.problems = () => [{ name: 'Google Calendar' }];

  // 10 marzo: la fattura (scadenza 19 febbraio) è scaduta, i servizi sono svolti, la proroga è ancora lì
  const todo = todoList(app, at('2027-02-12', '09:00'));
  assert.deepEqual(todo.sections.map((s) => s.id), ['decide', 'money', 'check']);
  const d1 = find(todo, 'decide').items;
  assert.match(d1[0].text, /^Proroga richiesta: Lagoon DMC · Tour di prova, 20 feb 2027$/);
  assert.match(d1[0].meta, /chiede 3 giorni; l’opzione scade il/);
  assert.equal(d1[0].href, `/admin/bookings/${opt.id}`);
  assert.deepEqual(d1.slice(1).map((i) => i.text), ['1 partner da approvare', '1 richiesta di programma da preparare']);
  assert.ok(d1.every((i) => i.tone === 'warn'));
  const money = find(todo, 'money').items;
  const byText = (re) => money.find((i) => re.test(i.text));
  assert.equal(byText(/Rimborso non riuscito/).tone, 'err');
  assert.equal(byText(/Rimborso non riuscito/).href, `/admin/bookings/${failed.id}`);
  assert.equal(byText(/fattura emessa da trasmettere a SdI/).tone, 'warn');
  assert.equal(byText(/servizio svolto ancora da incassare/).tone, 'warn');
  assert.match(byText(/servizio svolto ancora da incassare/).text, /\(70 €\)$/, 'il privato: 2 × 35 €');
  assert.equal(byText(/fattura scaduta e non incassata/), undefined, 'il 12 febbraio non è ancora scaduta');
  assert.equal(texts(todo, 'check')[0], 'Il calendario «Google Calendar» non si aggiorna');
  assert.ok(texts(todo, 'soon').every((x) => !/scadenza/.test(x)) || true);

  // dopo la scadenza (19 febbraio) la fattura diventa «scaduta e non incassata»
  const late = todoList(app, at('2027-02-25', '09:00'));
  const lateMoney = find(late, 'money').items.find((i) => /fattura scaduta e non incassata/.test(i.text));
  assert.equal(lateMoney.tone, 'err');
  assert.match(lateMoney.meta, /in tutto \d+ €/);
  assert.equal(lateMoney.href, '/admin/invoices?tab=issued');
  void inv;
  // il conteggio non include le voci «in arrivo»
  const nonInfo = todo.sections.flatMap((s) => s.items).filter((i) => i.tone !== 'info').length;
  assert.equal(todo.count, nonInfo);
  assert.ok(todo.count >= 7);
});

test('da fare: in arrivo (servizi di oggi e domani, opzioni in scadenza, lista d’attesa) non conta nel numero', (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = agency(app);
  const other = agency(app, { email: 'altra@example.com', company: 'Altra DMC' });
  app.db.prepare('UPDATE accounts SET option_max = 0').run();
  b2b(app, acct, { date: '2027-01-14', time: '09:30', pax: 4 });
  createBooking(app, base({ tourSlug: 'shared', date: '2027-01-14', time: '14:30', pax: 2, paymentMethod: 'onsite' }), NOW); // 70 € sul posto
  const o1 = b2b(app, acct, { date: '2027-02-20', time: '09:30', pax: 10, option: true, paymentMethod: undefined });
  b2b(app, acct, { date: '2027-02-20', time: '14:30', pax: 10, option: true, paymentMethod: undefined });
  joinWaitlist(app, other, { tour: 'shared-agenzie', pax: 2, date: '2027-02-20' }, NOW);
  assert.equal(Date.parse(o1.option_expires_at), at('2027-01-14'), 'le opzioni di 47 giorni durano 10 giorni');
  // 30 ore prima della scadenza delle opzioni (le 04:00 del 13): domani, il 14, ci sono due servizi
  const todo = todoList(app, at('2027-01-14') - 30 * HOUR);
  const soon = find(todo, 'soon').items;
  assert.ok(soon.every((i) => i.tone === 'info'));
  assert.equal(todo.count, 0);
  const options = soon.filter((i) => /^Opzione in scadenza/.test(i.text));
  assert.equal(options.length, 2, 'un’opzione per servizio');
  assert.match(options[0].text, /^Opzione in scadenza: Lagoon DMC · Tour di prova, 20 feb 2027$/);
  assert.match(options[0].meta, /scade il .*; se non conferma, la data si libera da sola/);
  assert.ok(soon.some((i) => /1 agenzia aspetta una data libera/.test(i.text)));
  const tomorrow = soon.find((i) => i.text.startsWith('Domani'));
  assert.equal(tomorrow.text, 'Domani: 2 servizi, 6 persone');
  assert.equal(tomorrow.meta, 'da incassare sul posto: 70 €');
  assert.equal(tomorrow.href, '/admin/day');
  // il giorno stesso la voce è «Oggi» e porta alla scheda di quel giorno
  const today = find(todoList(app, at('2027-01-14', '08:00')), 'soon').items.find((i) => i.text.startsWith('Oggi'));
  assert.equal(today.href, '/admin/day?date=2027-01-14');
  // fuori dalle 48 ore non compare nulla sulle opzioni; due opzioni di uno stesso pacchetto sono una voce sola
  assert.equal(find(todoList(app, at('2027-01-05')), 'soon')?.items.some((i) => /^Opzione in scadenza/.test(i.text)), false);
});

test('scheda del giorno: servizi in ordine d’orario con contatti, incontro, note e cosa incassare; opzioni a parte; totali', (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = agency(app);
  const priv = createBooking(app, base({ tourSlug: 'shared', date: '2027-01-12', time: '14:30', pax: 2, paymentMethod: 'onsite', name: 'Mario Rossi', phone: '+39 333 111 2222', notes: 'Una persona usa la sedia a rotelle', lang: 'en' }), NOW);
  const ag = b2b(app, acct, { date: '2027-01-12', time: '09:30', pax: 3, clientRef: 'Gruppo Verdi', phone: '+39 320 000 0000', name: 'Luisa Verdi' });
  app.db.prepare('UPDATE bookings SET admin_notes = ? WHERE id = ?').run('Chiedere il biglietto del vaporetto', ag.id);
  const opt = b2b(app, acct, { tourSlug: 'private', date: '2027-01-12', time: '17:30', pax: 5, option: true, paymentMethod: undefined });
  const cancelled = b2b(app, acct, { date: '2027-01-14', time: '14:30', pax: 1 });
  app.db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(cancelled.id);
  // un impegno fuori dal sito e un programma
  app.db.prepare(`INSERT INTO blocks(date, start_time, end_time, note, title, details, kind, created_at) VALUES('2027-01-12', '18:00', '19:00', 'Cena', 'Cena con l’agenzia X', 'al Ponte', 'private', ?)`).run(new Date(NOW).toISOString());
  const prog = createProgramRequest(app, { name: 'Giulia Bianchi', email: 'g@example.com', participants: 4, dateFrom: '2027-01-12', dateTo: '2027-01-12', lang: 'it' }, NOW);
  app.db.prepare(`UPDATE programs SET status = 'confirmed' WHERE id = ?`).run(prog.id);
  app.db.prepare(`INSERT INTO program_days(program_id, position, date, start_time, end_time, title, price_cents) VALUES(?, 0, '2027-01-12', '15:30', '18:00', 'Isole della laguna', 30000)`).run(prog.id);

  const sheet = daySheet(app, '2027-01-12', NOW);
  assert.deepEqual(sheet.services.map((s) => [s.start, s.title, s.confirmed]), [['09:30', 'Tour di prova', true], ['14:30', 'Tour di prova', true], ['17:30', 'Tour di prova', false]], 'orari in ordine; l’annullata non c’è');
  assert.deepEqual(sheet.totals, { services: 2, people: 5, options: 1, collectCents: 7000 });
  const [first, third, second] = sheet.services;
  assert.equal(first.agency, 'Lagoon DMC');
  assert.equal(first.agencyContact, 'Anna · +39 041 000000 · dmc@example.com');
  assert.equal(first.clientRef, 'Gruppo Verdi');
  assert.equal(first.name, 'Luisa Verdi');
  assert.equal(first.phone, '+39 320 000 0000');
  assert.equal(first.adminNotes, 'Chiedere il biglietto del vaporetto');
  assert.equal(first.pay, 'a fattura (agenzia)');
  assert.equal(first.collectCents, 0);
  assert.equal(first.meeting, 'Piazza');
  assert.match(second.pay, /^opzione: scade il /);
  assert.equal(third.collectCents, 7000, '2 × 35 € da incassare sul posto');
  assert.equal(third.notes, 'Una persona usa la sedia a rotelle');
  assert.equal(third.b2b, false);
  assert.equal(third.email, 'mario@example.com');
  assert.deepEqual(sheet.programs.map((p) => [p.start, p.end, p.title, p.ref]), [['15:30', '18:00', 'Isole della laguna', prog.ref]]);
  assert.deepEqual(sheet.blocks, [{ start: '18:00', end: '19:00', title: 'Cena con l’agenzia X', details: 'al Ponte' }]);
  // quando l'opzione scade non compare più
  assert.equal(daySheet(app, '2027-01-12', Date.parse(opt.option_expires_at) + 1000).services.length, 2);
  assert.deepEqual(daySheet(app, '2027-01-13', NOW), { date: '2027-01-13', services: [], programs: [], blocks: [], totals: { services: 0, people: 0, options: 0, collectCents: 0 } });
  void priv;
});

test('scheda del giorno in PDF: orari, contatti, note e incasso sul posto in evidenza', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = agency(app);
  createBooking(app, base({ tourSlug: 'shared', date: '2027-01-12', time: '14:30', pax: 2, paymentMethod: 'onsite', name: 'Mario Rossi', phone: '+39 333 111 2222', notes: 'Sedia a rotelle' }), NOW);
  b2b(app, acct, { date: '2027-01-12', time: '09:30', pax: 3, clientRef: 'Gruppo Verdi' });
  const pdf = await renderDaySheetPdf(app, daySheet(app, '2027-01-12', NOW));
  assert.ok(isPdf(pdf));
  assert.equal(pdfPages(pdf), 1);
  if (HAS_PDFTOTEXT) {
    const text = pdfText(pdf);
    assert.match(text, /martedì 12 gennaio 2027/);
    assert.match(text, /2 servizi · 5 persone · da incassare sul posto: 70 €/);
    assert.match(text, /09:30–12:00/);
    assert.match(text, /Lagoon DMC/);
    assert.match(text, /Gruppo Verdi/);
    assert.match(text, /DA INCASSARE SUL POSTO: 70 €/);
    assert.match(text, /Sedia a rotelle/);
    assert.ok(text.indexOf('09:30') < text.indexOf('14:30'));
  }
  const empty = await renderDaySheetPdf(app, daySheet(app, '2027-01-13', NOW));
  assert.ok(isPdf(empty));
  if (HAS_PDFTOTEXT) assert.match(pdfText(empty), /Nessun servizio in questo giorno\./);
  // tanti impegni vanno a capo su più pagine, con l'intestazione compatta
  for (let i = 0; i < 16; i++) app.db.prepare(`INSERT INTO blocks(date, start_time, end_time, note, title, details, kind, created_at) VALUES('2027-01-12', ?, ?, 'x', ?, 'Una nota abbastanza lunga da occupare almeno una riga intera nella scheda del giorno per la guida, con indicazioni sul luogo.', 'private', ?)`).run(`${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '50' : '20'}`, `Impegno ${i + 1}`, new Date(NOW).toISOString());
  const long = await renderDaySheetPdf(app, daySheet(app, '2027-01-12', NOW));
  assert.ok(pdfPages(long) >= 2);
  if (HAS_PDFTOTEXT) assert.match(pdfText(long), /Pagina 2 di/);
});

// ───────────── scheda serale per email ─────────────
test('scheda serale: parte all’ora scelta, una volta per giorno, solo se domani ci sono servizi e c’è chi la riceve', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  const acct = agency(app);
  b2b(app, acct, { date: '2027-01-12', time: '09:30', pax: 3, clientRef: 'Gruppo Verdi' });
  createBooking(app, base({ tourSlug: 'shared', date: '2027-01-12', time: '14:30', pax: 2, paymentMethod: 'onsite', name: 'Mario Rossi', phone: '+39 333 111 2222' }), NOW);
  const evening = (time, day = '2027-01-11') => at(day, time);
  const sent = () => app.mail.sent.filter((m) => m.to === GUIDE && /^Domani/.test(m.subject));

  assert.equal(app.briefing.due(evening('17:59')), null, 'prima delle 18');
  assert.equal(app.briefing.due(evening('18:00')), '2027-01-12', 'alle 18 si prepara quella di domani');
  assert.equal(await app.briefing.sweep(evening('17:59')), false);
  assert.equal(sent().length, 0);
  assert.equal(await app.briefing.sweep(evening('18:00')), true);
  assert.equal(sent().length, 1);
  const mail = sent()[0];
  assert.equal(mail.subject, 'Domani: 2 servizi, 5 persone · da incassare 70 € — 12 gen 2027');
  assert.match(mail.text, /^martedì 12 gennaio 2027: 2 servizi, 5 persone · da incassare sul posto 70 €/);
  assert.match(mail.text, /09:30–12:00  Tour di prova/);
  assert.match(mail.text, /Agenzia: Lagoon DMC · Gruppo Verdi · Anna/);
  assert.match(mail.text, /DA INCASSARE SUL POSTO: 70 €/);
  assert.match(mail.text, /\/admin\/day\?date=2027-01-12/);
  assert.equal(mail.attachments.length, 1);
  assert.equal(mail.attachments[0].filename, 'scheda-2027-01-12.pdf');
  assert.ok(isPdf(mail.attachments[0].content));
  assert.equal(await app.briefing.sweep(evening('18:01')), false, 'una sola volta');
  assert.equal(await app.briefing.sweep(evening('23:30')), false);
  assert.equal(sent().length, 1);
  // il giorno dopo non ci sono servizi per il 13: niente email, e non si ricontrolla ogni minuto
  assert.equal(await app.briefing.sweep(evening('18:00', '2027-01-12')), false);
  assert.equal(app.briefing.due(evening('18:30', '2027-01-12')), null);
  assert.equal(sent().length, 1);
  // l'ora si sceglie dalle impostazioni; spenta o senza destinatario non parte
  app.cfg.reminders.briefing.hour = 20;
  assert.equal(app.briefing.due(evening('19:59', '2027-01-13')), null);
  assert.equal(app.briefing.due(evening('20:00', '2027-01-13')), '2027-01-14');
  app.cfg.reminders.briefing.enabled = false;
  assert.equal(app.briefing.due(evening('21:00', '2027-01-13')), null);
  app.cfg.reminders.briefing.enabled = true;
  app.cfg.mail.notifyTo = '';
  assert.equal(app.briefing.due(evening('21:00', '2027-01-13')), null);
});

test('scheda serale: se l’email non parte si riprova dopo mezz’ora, non ogni minuto', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  b2b(app, agency(app), { date: '2027-01-12', time: '09:30', pax: 3 });
  const evening = (time) => at('2027-01-11', time);
  const real = app.mail.send;
  let calls = 0;
  app.mail.send = async () => {
    calls++;
    return false;
  };
  assert.equal(await app.briefing.sweep(at('2027-01-11', '18:00')), false);
  assert.equal(calls, 1);
  assert.equal(await app.briefing.sweep(at('2027-01-11', '18:05')), false);
  assert.equal(calls, 1, 'nessun nuovo tentativo subito');
  app.mail.send = real;
  assert.equal(await app.briefing.sweep(at('2027-01-11', '18:31')), true);
  assert.equal(app.mail.sent.filter((m) => /^Domani/.test(m.subject)).length, 1);
  void evening;
});

test('scheda serale: «invia a me» a mano non segna nulla e non parte da sola se non c’è niente', async (t) => {
  const app = appFor();
  t.after(app.cleanup);
  assert.equal(await app.briefing.send('2027-01-12', NOW), false, 'nessun servizio: niente email');
  b2b(app, agency(app), { date: '2027-01-12', time: '09:30', pax: 3 });
  assert.equal(await app.briefing.send('2027-01-12', NOW), true);
  assert.equal(await app.briefing.send('2027-01-12', NOW), true, 'a mano si può ripetere');
  assert.equal(app.briefing.due(at('2027-01-11', '18:00')), '2027-01-12', 'la scheda serale parte lo stesso');
});
