// Commerciale: contatti, referenti, registro, appuntamenti, doppioni, disiscrizione, importazione e aggancio ai profili B2B — senza rete né email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots } from '../server/availability.js';
import * as L from '../server/leads.js';
import { createInvite, markUsed } from '../server/partnerInvites.js';
import { addAccount, makeApp, NOW } from './helpers.js';

const TODAY = '2027-01-04'; // lunedì, come NOW
const code = (fn) => {
  try {
    fn();
  } catch (err) {
    return err instanceof L.LeadError ? err.code : `altro: ${err.message}`;
  }
  return null;
};
/** Un contatto di prova, con un referente se si dà `contact`. */
const mk = (db, over = {}) => {
  const { contact, ...rest } = over;
  return L.insertLead(db, L.cleanLead({ company: 'Lagoon Travel', ...rest }).value, { contact: contact ? L.cleanContact(contact).value : null, nowMs: NOW });
};
const times = (slots) => slots.map((s) => s.time);

test('un contatto: dati ripuliti, sito sicuro, paese e lingua dedotti; il modulo segnala l’errore, l’importazione scarta il campo', () => {
  const { value } = L.cleanLead({ company: '  Lagoon   Travel  ', country: 'Giappone', website: 'www.lagoon.jp/', phone: '03 1234 5678', email: 'INFO@Lagoon.JP', priority: 'alta', kind: 'tour operator' });
  assert.deepEqual([value.company, value.country, value.lang, value.website, value.email, value.priority, value.kind, value.phone], ['Lagoon Travel', 'JP', 'ja', 'https://www.lagoon.jp', 'info@lagoon.jp', 1, 'operator', '+81 312345678']);
  assert.equal(L.cleanLead({ company: 'A', country: 'Spain' }).value.lang, 'es');
  assert.equal(L.cleanLead({ company: 'A', country: 'DE' }).value.lang, 'en', 'per gli altri paesi si scrive in inglese');
  assert.equal(L.cleanLead({ company: 'A', country: 'Italia', lang: 'es' }).value.lang, 'es', 'la lingua scelta vince');
  // senza paese, la lingua si deduce dal dominio del sito o dell'email (la posta gratuita non dice nulla: inglese)
  const lang = (over) => L.cleanLead({ company: 'A', ...over }).value.lang;
  assert.deepEqual([lang({ email: 'info@agenzia.it' }), lang({ website: 'www.agencia.es' }), lang({ website: 'tours.co.jp' }), lang({ email: 'info@agency.com' }), lang({ email: 'anna@gmail.com' }), lang({})], ['it', 'es', 'ja', 'en', 'en', 'en']);
  assert.equal(lang({ country: 'DE', email: 'info@agenzia.it' }), 'en', 'il paese vince sul dominio');
  assert.equal(L.deduceLang({ website: 'https://www.libero.it' }), 'it');

  for (const [field, bad, expected] of [['email', 'x@', 'email'], ['website', 'javascript:alert(1)', 'website'], ['country', 'Narnia', 'country'], ['nextActionOn', '2027-13-45', 'date']]) {
    assert.equal(code(() => L.cleanLead({ company: 'A', [field]: bad })), expected, field);
  }
  assert.equal(code(() => L.cleanLead({ company: '   ' })), 'company');

  const lenient = L.cleanLead({ company: 'A', email: 'x@', website: 'javascript:alert(1)', country: 'Narnia' }, { lenient: true });
  assert.deepEqual(lenient.warnings.sort(), ['country', 'email', 'website']);
  assert.deepEqual([lenient.value.email, lenient.value.website, lenient.value.country], ['', '', '']);

  // l'indirizzo web: solo http(s), mai con nome utente e password
  assert.equal(L.normalizeWebsite('HTTP://Esempio.it/Pagina/'), 'http://esempio.it/Pagina');
  for (const bad of ['ftp://x.it', 'https://user:pw@x.it', 'mailto:a@b.it', 'senzapunto', '<script>']) assert.equal(L.normalizeWebsite(bad), '', bad);
  // un referente ha almeno un nome o un'email
  assert.equal(L.cleanContact({ email: 'Anna@X.it' }).value.name, 'anna@x.it');
  assert.equal(code(() => L.cleanContact({})), 'name');
  assert.equal(L.firstName('Anna Rossi'), 'Anna');
  assert.equal(L.firstName('anna@x.it'), '', 'un indirizzo non è un nome da salutare');
});

test('doppioni: stesso nome (senza S.r.l. e maiuscole), stesso sito o dominio, stessa email; la posta gratuita non conta come dominio', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  assert.equal(L.companyKey('Lagoon Travel S.r.l.'), L.companyKey('LAGOON  travel'));
  assert.notEqual(L.companyKey('Lagoon Travel'), L.companyKey('Lagoon DMC'));
  assert.equal(L.domainOf('https://www.Lagoon.it/x'), 'lagoon.it');
  assert.equal(L.domainOf('anna@lagoon.it'), 'lagoon.it');
  assert.equal(L.domainOf('anna@gmail.com'), '', 'un indirizzo gmail non dice a quale azienda appartiene');

  const a = mk(db, { company: 'Lagoon Travel S.r.l.', website: 'lagoon.it', email: 'info@lagoon.it', contact: { name: 'Anna', email: 'anna@gmail.com' } });
  const idx = L.duplicateIndex(db);
  assert.deepEqual(idx.find({ company: 'LAGOON TRAVEL' }).map((d) => [d.id, d.why]), [[a.id, 'stesso nome']]);
  assert.equal(idx.find({ website: 'https://www.lagoon.it/chi-siamo' })[0].why, 'stesso sito o dominio');
  assert.equal(idx.find({ email: 'ufficio@lagoon.it' })[0].why, 'stesso sito o dominio', 'un collega della stessa azienda');
  assert.equal(idx.find({ email: 'INFO@lagoon.it' })[0].why, 'stesso indirizzo email');
  assert.equal(idx.find({ contactEmail: 'Anna@gmail.com' })[0].why, 'stesso indirizzo email', 'anche l’indirizzo di un referente');
  assert.deepEqual(idx.find({ company: 'Altra', email: 'altra@gmail.com' }), [], 'un altro gmail non è lo stesso');
  assert.deepEqual(idx.find({}), []);
  // un contatto appena inserito entra nell'indice
  const b = mk(db, { company: 'Nuova Agenzia' });
  idx.remember(b);
  assert.equal(idx.find({ company: 'nuova agenzia srl' })[0].id, b.id);
});

test('referenti: il primo è il principale, si può cambiare, se si toglie il principale ne subentra un altro', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const lead = mk(db, { email: 'info@lagoon.it', contact: { name: 'Anna Rossi', role: 'Titolare', email: 'anna@lagoon.it', phone: '+39 333 1234567' } });
  const bob = L.addContact(db, lead.id, L.cleanContact({ name: 'Bob', email: 'bob@lagoon.it' }).value, NOW);
  const carla = L.addContact(db, lead.id, L.cleanContact({ name: 'Carla' }).value, NOW);
  assert.deepEqual(L.listContacts(db, lead.id).map((c) => [c.name, c.is_main]), [['Anna Rossi', 1], ['Bob', 0], ['Carla', 0]]);
  assert.equal(L.mainContact(db, lead.id).name, 'Anna Rossi');
  assert.equal(L.setMainContact(db, lead.id, carla.id), true);
  assert.deepEqual(L.listContacts(db, lead.id).map((c) => c.name), ['Carla', 'Anna Rossi', 'Bob']);
  assert.equal(L.setMainContact(db, lead.id, 9999), false);
  assert.equal(L.removeContact(db, lead.id, carla.id), true);
  assert.equal(L.mainContact(db, lead.id).name, 'Anna Rossi', 'subentra il primo rimasto');
  assert.equal(L.removeContact(db, lead.id, carla.id), false);
  assert.equal(L.updateContact(db, lead.id, bob.id, L.cleanContact({ name: 'Roberto', role: 'Booking', email: 'bob@lagoon.it' }).value, NOW), true);
  assert.equal(L.getContact(db, lead.id, bob.id).role, 'Booking');
  assert.equal(L.getContact(db, 999, bob.id), null, 'un referente è di una sola agenzia');
  // gli indirizzi a cui scrivere: prima i referenti, poi quello generale
  assert.deepEqual(L.recipients(db, L.getLead(db, lead.id)).map((r) => [r.name, r.email]), [['Anna Rossi', 'anna@lagoon.it'], ['Roberto', 'bob@lagoon.it'], ['', 'info@lagoon.it']]);
});

test('il registro: un contatto vero porta lo stato avanti (mai indietro), aggiorna l’ultimo contatto e chiude il richiamo (scaduto, o qualunque se c’è stato uno scambio)', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const lead = mk(db, { contact: { name: 'Anna' } });
  const status = () => L.getLead(db, lead.id).status;
  assert.equal(status(), 'new');
  L.logActivity(db, lead.id, { kind: 'note', title: 'Trovata su Google', nowMs: NOW });
  assert.equal(status(), 'new', 'una nota non cambia nulla');
  assert.equal(L.getLead(db, lead.id).last_contact_on, null);
  L.logActivity(db, lead.id, { kind: 'no_answer', nowMs: NOW });
  assert.equal(status(), 'contacted');
  assert.equal(L.getLead(db, lead.id).last_contact_on, TODAY);
  L.logActivity(db, lead.id, { kind: 'call', title: 'Ha risposto Anna', body: 'Interessata a Murano e Burano', nowMs: NOW });
  assert.equal(status(), 'talking');
  L.logActivity(db, lead.id, { kind: 'email_out', nowMs: NOW });
  assert.equal(status(), 'talking', 'non si torna indietro');
  assert.equal(code(() => L.logActivity(db, lead.id, { kind: 'inventato', nowMs: NOW })), 'kind');
  assert.equal(code(() => L.logActivity(db, 999, { kind: 'note', nowMs: NOW })), 'notfound');
  assert.deepEqual(L.timeline(db, lead.id).map((a) => a.kind), ['email_out', 'call', 'no_answer', 'note']);

  // il richiamo: scaduto → si chiude da solo con un contatto vero; futuro → resta; uno nuovo lo sostituisce
  L.setNextAction(db, lead.id, { on: TODAY, text: 'Richiamare Anna' }, NOW);
  L.logActivity(db, lead.id, { kind: 'call', nowMs: NOW });
  assert.equal(L.getLead(db, lead.id).next_action_on, null);
  L.setNextAction(db, lead.id, { on: '2027-02-01', text: 'Scrivere a febbraio' }, NOW);
  L.logActivity(db, lead.id, { kind: 'email_out', nowMs: NOW });
  L.logActivity(db, lead.id, { kind: 'no_answer', nowMs: NOW });
  assert.equal(L.getLead(db, lead.id).next_action_on, '2027-02-01', 'scrivere o non trovarlo non cancella un richiamo futuro');
  L.logActivity(db, lead.id, { kind: 'reply', title: 'Mi hanno risposto', nowMs: NOW });
  assert.deepEqual([L.getLead(db, lead.id).next_action_on, L.getLead(db, lead.id).next_action], [null, null], 'se hanno risposto il vecchio richiamo non serve più, anche se era fissato più avanti');
  L.setNextAction(db, lead.id, { on: '2027-02-01', text: 'Scrivere a febbraio' }, NOW);
  L.logActivity(db, lead.id, { kind: 'call', nowMs: NOW });
  assert.equal(L.getLead(db, lead.id).next_action_on, null, 'vale anche per una telefonata');
  L.setNextAction(db, lead.id, { on: '2027-02-01', text: 'Scrivere a febbraio' }, NOW);
  L.logActivity(db, lead.id, { kind: 'call', nextOn: '2027-01-20', nextAction: 'Mandare il listino', nowMs: NOW });
  assert.deepEqual([L.getLead(db, lead.id).next_action_on, L.getLead(db, lead.id).next_action], ['2027-01-20', 'Mandare il listino']);
  assert.equal(code(() => L.setNextAction(db, lead.id, { on: 'domani' }, NOW)), 'date');
  assert.equal(L.snooze(db, lead.id, 7, NOW), true);
  assert.equal(L.getLead(db, lead.id).next_action_on, '2027-01-11', 'si rimanda da oggi');
  assert.equal(L.getLead(db, lead.id).next_action, 'Mandare il listino', 'il testo resta');

  // chi aveva detto di no e poi risponde è di nuovo in dialogo
  L.setStatus(db, lead.id, 'lost', { nowMs: NOW });
  assert.equal(L.getLead(db, lead.id).next_action_on, null, 'chi non è interessato non ha richiami');
  L.logActivity(db, lead.id, { kind: 'email_out', nowMs: NOW });
  assert.equal(status(), 'lost');
  L.logActivity(db, lead.id, { kind: 'reply', nowMs: NOW });
  assert.equal(status(), 'talking');
  assert.equal(L.setStatus(db, lead.id, 'talking', { nowMs: NOW }), false, 'nessun cambiamento');
  assert.equal(code(() => L.setStatus(db, lead.id, 'boh', { nowMs: NOW })), 'status');
  assert.ok(L.timeline(db, lead.id).some((a) => a.kind === 'status' && a.title === 'In dialogo → Non interessata'));
});

test('elenco: filtri (stato, ricerca anche nei referenti, paese, priorità, richiami), ordine, pagine e numeri; i caratteri speciali della ricerca valgono come testo', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const a = mk(db, { company: 'Alfa Viaggi', country: 'IT', city: 'Padova', priority: 1, source: 'Fiera BIT', contact: { name: 'Anna Rossi', email: 'anna@alfa.it' } });
  const b = mk(db, { company: 'Beta Tours', country: 'JP', priority: 3, nextActionOn: '2027-01-02', nextAction: 'Richiamare' });
  mk(db, { company: 'Gamma 100% Italia', country: 'IT', nextActionOn: TODAY });
  const d = mk(db, { company: 'Delta DMC', kind: 'dmc', country: 'ES', nextActionOn: '2027-01-08' });
  L.setStatus(db, d.id, 'talking', { nowMs: NOW });
  const e = mk(db, { company: 'Epsilon', nextActionOn: '2027-03-01' });
  L.setStatus(db, e.id, 'lost', { nowMs: NOW });
  const names = (f, o) => L.searchLeads(db, f, { today: TODAY, ...o }).rows.map((r) => r.company);

  assert.deepEqual(names({}), ['Beta Tours', 'Gamma 100% Italia', 'Delta DMC', 'Alfa Viaggi', 'Epsilon'], 'prima chi ha il richiamo più vicino, poi per priorità e nome');
  assert.deepEqual(names({ status: 'talking' }), ['Delta DMC']);
  assert.deepEqual(names({ status: 'open' }).sort(), ['Alfa Viaggi', 'Beta Tours', 'Delta DMC', 'Gamma 100% Italia']);
  assert.deepEqual(names({ q: 'anna@alfa' }), ['Alfa Viaggi'], 'si cerca anche nei referenti');
  assert.deepEqual(names({ q: 'padova' }), ['Alfa Viaggi']);
  assert.deepEqual(names({ q: '100%' }), ['Gamma 100% Italia'], 'il % è un carattere come gli altri');
  assert.deepEqual(names({ q: '%' }), ['Gamma 100% Italia']);
  assert.deepEqual(names({ q: '_lfa' }), [], 'il _ non è un jolly');
  assert.deepEqual(names({ country: 'jp' }), ['Beta Tours']);
  assert.deepEqual(names({ priority: 1 }), ['Alfa Viaggi']);
  assert.deepEqual(names({ kind: 'dmc' }), ['Delta DMC']);
  assert.deepEqual(names({ source: 'Fiera BIT' }), ['Alfa Viaggi']);
  assert.deepEqual(names({ due: 'overdue' }), ['Beta Tours']);
  assert.deepEqual(names({ due: 'today' }), ['Beta Tours', 'Gamma 100% Italia'], 'oggi comprende gli scaduti');
  assert.deepEqual(names({ due: 'week' }), ['Beta Tours', 'Gamma 100% Italia', 'Delta DMC']);
  assert.deepEqual(names({ due: 'none' }), ['Alfa Viaggi']);
  assert.deepEqual(names({ email: 'none' }), ['Beta Tours', 'Gamma 100% Italia', 'Delta DMC', 'Epsilon'], 'senza nessun indirizzo a cui scrivere');
  assert.deepEqual(names({ sort: 'company' }), ['Alfa Viaggi', 'Beta Tours', 'Delta DMC', 'Epsilon', 'Gamma 100% Italia']);
  assert.deepEqual(names({ sort: 'company' }, { limit: 2, offset: 2 }), ['Delta DMC', 'Epsilon']);
  assert.equal(L.searchLeads(db, { sort: 'company' }, { today: TODAY, limit: 2 }).total, 5);

  const row = L.searchLeads(db, { q: 'alfa' }, { today: TODAY }).rows[0];
  assert.deepEqual([row.contact_name, row.contact_email, row.id], ['Anna Rossi', 'anna@alfa.it', a.id]);
  assert.equal(L.leadRow(db, b.id, TODAY).company, 'Beta Tours');
  const counts = L.leadCounts(db, TODAY);
  assert.deepEqual([counts.total, counts.by.new, counts.by.talking, counts.by.lost, counts.overdue, counts.today, counts.due], [5, 3, 1, 1, 1, 1, 2], 'i non interessati non hanno richiami');
  assert.deepEqual(L.dueLeads(db, TODAY, 7).map((l) => l.company), ['Beta Tours', 'Gamma 100% Italia', 'Delta DMC']);
  assert.deepEqual(L.toContact(db, 5).map((l) => l.company), ['Alfa Viaggi', 'Gamma 100% Italia', 'Beta Tours'], 'prima la priorità alta');
  assert.deepEqual(L.sourcesUsed(db).map((s) => s.source), ['Fiera BIT']);
});

test('appuntamenti: validazione, ore tolte dalle disponibilità solo se scelto, avvisi di sovrapposizione, chiusura con esito', (t) => {
  const { db, cfg, cleanup } = makeApp();
  t.after(cleanup);
  const lead = mk(db, { company: 'Alfa Viaggi', contact: { name: 'Anna' } });
  const anna = L.mainContact(db, lead.id);

  assert.equal(code(() => L.addAppointment(db, lead.id, { kind: 'visit', date: 'ieri', start: '10:00', end: '11:00' }, NOW)), 'date');
  assert.equal(code(() => L.addAppointment(db, lead.id, { kind: 'visit', date: '2027-01-06', start: '11:00', end: '10:00' }, NOW)), 'time');
  assert.equal(code(() => L.addAppointment(db, 999, { kind: 'visit', date: '2027-01-06', start: '10:00', end: '11:00' }, NOW)), 'notfound');
  const visit = L.addAppointment(db, lead.id, { kind: 'visit', date: '2027-01-06', start: '09:00', end: '12:00', place: 'Via Roma 1, Padova', contactId: anna.id }, NOW);
  assert.deepEqual([visit.kind, visit.blocks, visit.status, visit.contact_name, visit.company], ['visit', 1, 'planned', 'Anna', 'Alfa Viaggi']);
  const call = L.addAppointment(db, lead.id, { kind: 'call', date: '2027-01-07', start: '15:00', end: '15:30' }, NOW);
  assert.equal(call.blocks, 0, 'una telefonata breve non toglie ore, di solito');
  const day = L.addAppointment(db, lead.id, { kind: 'visit', date: '2027-01-12', allDay: true, blocks: true, contactId: 9999 }, NOW);
  assert.deepEqual([day.start_time, day.end_time, day.contact_id], ['00:00', '23:59', null], 'tutto il giorno; un referente di un’altra agenzia non vale');
  assert.equal(L.addAppointment(db, lead.id, { kind: 'strano', date: '2027-01-08', start: '10:00', end: '11:00', blocks: false }, NOW).kind, 'other');
  assert.ok(L.timeline(db, lead.id).some((a) => a.kind === 'appointment' && /^Fissato: Visita in azienda/.test(a.title)));

  // le ore tolte dalle disponibilità: il tour condiviso di mercoledì 6 ha le partenze 09:30 e 14:30
  const t1 = { slug: 'shared', active: true, order: 1, model: 'person', flexible: false, times: ['09:30', '14:30'], weekdays: [0, 1, 2, 3, 4, 5, 6], durationMin: 150, maxParticipants: 10, audience: 'b2c', priceCents: 3500, cancelHours: null, payOnSite: true, art: 'dome', languages: ['it'], i18n: { it: { title: 'T' } } };
  assert.deepEqual(times(daySlots(db, cfg, t1, '2027-01-06', { nowMs: NOW })), ['14:30'], 'la visita 09:00–12:00 toglie la partenza delle 09:30');
  assert.deepEqual(times(daySlots(db, cfg, t1, '2027-01-07', { nowMs: NOW })), ['09:30', '14:30'], 'la telefonata non toglie nulla');
  assert.deepEqual(times(daySlots(db, cfg, t1, '2027-01-12', { nowMs: NOW })), [], 'una giornata fuori sede toglie tutto');
  assert.equal(L.overlapCount(db, '2027-01-06', '10:00', '11:00', NOW), 1, 'si sovrappone a un altro impegno');
  assert.equal(L.overlapCount(db, '2027-01-06', '10:00', '11:00', NOW, { ignoreAppointment: visit.id }), 0);
  assert.equal(L.overlapCount(db, '2027-01-06', '13:00', '14:00', NOW), 0);

  // spostare, chiudere, annullare
  const moved = L.updateAppointment(db, visit.id, { kind: 'video', date: '2027-01-06', start: '18:00', end: '19:00', place: 'https://meet.example/abc' }, NOW);
  assert.deepEqual([moved.kind, moved.start_time, moved.place], ['video', '18:00', 'https://meet.example/abc']);
  assert.deepEqual(times(daySlots(db, cfg, t1, '2027-01-06', { nowMs: NOW })), ['09:30', '14:30'], 'le ore tornano libere dopo lo spostamento (alle 18:00 non c’entra con le partenze)');
  assert.equal(L.completeAppointment(db, moved.id, { outcome: 'Interessata ai tour di Burano', nextOn: '2027-01-20', nextAction: 'Mandare il listino' }, NOW), true);
  const lead2 = L.getLead(db, lead.id);
  assert.deepEqual([lead2.status, lead2.next_action_on], ['talking', '2027-01-20'], 'una videochiamata fatta porta in dialogo e fissa il seguito');
  assert.equal(L.getAppointment(db, moved.id).status, 'done');
  assert.equal(L.completeAppointment(db, moved.id, {}, NOW), false, 'si chiude una volta sola');
  assert.equal(L.updateAppointment(db, moved.id, { kind: 'visit', date: '2027-01-06', start: '10:00', end: '11:00' }, NOW), null, 'uno già fatto non si cambia');
  assert.equal(L.cancelAppointment(db, day.id, NOW), true);
  assert.deepEqual(times(daySlots(db, cfg, t1, '2027-01-12', { nowMs: NOW })), ['09:30', '14:30'], 'annullata: le ore tornano libere');
  const agenda = L.appointmentsBetween(db, '2027-01-01', '2027-01-31');
  assert.equal(agenda.length, 3, 'in agenda ci sono i fissati e i fatti, non l’annullato');
  assert.deepEqual(agenda.slice(0, 2).map((a) => a.id), [moved.id, call.id]);
  assert.ok(agenda.every((a) => a.id !== day.id));
  assert.deepEqual(L.plannedAppointments(db, { before: '2027-01-08' }).map((a) => a.id), [call.id], 'da chiudere: quelli passati ancora fissati');
  assert.ok(L.timeline(db, lead.id).some((a) => a.kind === 'video' && a.body === 'Interessata ai tour di Burano'));
});

test('non scrivere più: vale per tutti i suoi indirizzi, anche dopo la cancellazione e una nuova importazione; la guida può riabilitare', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const lead = mk(db, { email: 'info@lagoon.it', contact: { name: 'Anna', email: 'anna@lagoon.it' } });
  assert.equal(L.optOut(db, lead.id, { nowMs: NOW }), true);
  const after = L.getLead(db, lead.id);
  assert.deepEqual([after.email_ok, after.optout_at], [0, new Date(NOW).toISOString()]);
  assert.ok(L.isSuppressed(db, 'ANNA@lagoon.it'));
  assert.ok(L.isSuppressed(db, 'info@lagoon.it'));
  assert.equal(L.isSuppressed(db, 'altro@lagoon.it'), null);
  assert.equal(L.timeline(db, lead.id).filter((a) => a.kind === 'optout').length, 1);
  L.optOut(db, lead.id, { nowMs: NOW + 1000 });
  assert.equal(L.timeline(db, lead.id).filter((a) => a.kind === 'optout').length, 1, 'una volta sola nel registro');
  assert.equal(L.optOut(db, 999, { nowMs: NOW }), false);

  // cancellato e riportato da un elenco: nasce già senza email
  L.deleteLead(db, lead.id);
  assert.equal(L.getLead(db, lead.id), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_contacts').get().n, 0, 'i referenti vanno con il contatto');
  const again = mk(db, { company: 'Lagoon di nuovo', email: 'info@lagoon.it' });
  assert.equal(again.email_ok, 0);
  const viaContact = mk(db, { company: 'Un’altra', contact: { name: 'Anna', email: 'anna@lagoon.it' } });
  assert.equal(viaContact.email_ok, 0, 'vale anche per l’indirizzo di un referente');

  assert.equal(L.allowEmail(db, again.id, NOW), true);
  assert.deepEqual([L.getLead(db, again.id).email_ok, L.isSuppressed(db, 'info@lagoon.it')], [1, null]);
});

test('importazione: intestazioni riconosciute, senza intestazione l’ordine è fisso, doppioni saltati (anche dentro lo stesso elenco), il referente prende l’email personale', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  mk(db, { company: 'Già Presente Srl', email: 'info@gia.it' });
  const text = [
    'Azienda;Tipo;Paese;Città;Sito;Email;Telefono;Referente;Ruolo;Fonte;Priorità;Note',
    'Alfa Viaggi srl;Tour operator;Italia;Padova;alfa.it;anna@alfa.it;+39 049 123456;Anna Rossi;Titolare;;alta;Vuole Murano',
    'Beta;;Narnia;;javascript:alert(1);non-una-email;;;;Fiera BIT;;',
    ';x@y.it;;;;;;;;;;',
    'GIÀ presente;;;;;info@gia.it;;;;;;',
    'Alfa Viaggi;;;;;;;;;;;',
    '"Gamma; Tours";DMC;Giappone;;;;;;;;;',
  ].join('\n');
  const parsed = L.parseImport(text);
  assert.deepEqual(parsed.columns.slice(0, 4), ['company', 'kind', 'country', 'city']);
  assert.equal(parsed.rows.length, 6);
  const alfa = parsed.rows[0];
  assert.deepEqual([alfa.lead.company, alfa.lead.kind, alfa.lead.country, alfa.lead.priority, alfa.lead.website, alfa.lead.notes], ['Alfa Viaggi srl', 'operator', 'IT', 1, 'https://alfa.it', 'Vuole Murano']);
  assert.deepEqual([alfa.contact.name, alfa.contact.role, alfa.contact.email, alfa.lead.email], ['Anna Rossi', 'Titolare', 'anna@alfa.it', ''], 'l’email va al referente, non si ripete come indirizzo dell’agenzia');
  assert.deepEqual(parsed.rows[1].warnings.sort(), ['country', 'email', 'website']);
  assert.equal(parsed.rows[2].error, 'senza nome');
  assert.equal(parsed.rows[5].lead.company, 'Gamma; Tours', 'le virgolette proteggono il separatore');

  const done = L.importLeads(db, parsed.rows, { source: 'Elenco ENIT', nowMs: NOW });
  assert.equal(done.created, 3, 'Alfa, Beta e Gamma');
  assert.equal(done.skipped, 1);
  assert.deepEqual(done.duplicates.map((d) => [d.company, d.of.company, d.of.why]), [['GIÀ presente', 'Già Presente Srl', 'stesso indirizzo email'], ['Alfa Viaggi', 'Alfa Viaggi srl', 'stesso nome']]);
  const beta = L.searchLeads(db, { q: 'Beta' }).rows[0];
  assert.equal(beta.source, 'Fiera BIT', 'la fonte della riga vince su quella dell’elenco');
  assert.equal(L.searchLeads(db, { q: 'Gamma' }).rows[0].source, 'Elenco ENIT');
  assert.ok(L.timeline(db, beta.id).some((a) => a.kind === 'import'));
  // di nuovo lo stesso elenco: tutto doppione
  assert.equal(L.importLeads(db, L.parseImport(text).rows, { nowMs: NOW }).created, 0);

  // senza intestazione: azienda, referente, email, telefono, sito, paese, città
  const bare = L.parseImport('Delta Viaggi;Carla Bianchi;carla@delta.it;+34 91 123 4567;delta.es;Spagna;Madrid');
  assert.deepEqual([bare.rows[0].lead.company, bare.rows[0].contact.name, bare.rows[0].contact.email, bare.rows[0].lead.country, bare.rows[0].lead.city, bare.rows[0].lead.lang], ['Delta Viaggi', 'Carla Bianchi', 'carla@delta.it', 'ES', 'Madrid', 'es']);
  // separatori diversi e celle copiate da un foglio di calcolo (tabulazioni)
  assert.equal(L.parseImport('Azienda\tEmail\nEpsilon\te@e.it').rows[0].lead.email, 'e@e.it');
  assert.deepEqual(L.parseImport('').rows, []);
  assert.equal(L.parseImport(`Azienda\n${Array.from({ length: 1200 }, (_, i) => `A${i}`).join('\n')}`).tooMany, true);
});

test('esportazione CSV: tutte le colonne, separatore «;», nessuna formula eseguibile', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  mk(db, { company: '=HYPERLINK("http://x")', country: 'IT', phone: '+39 041 123456', notes: 'a;b\nc', contact: { name: 'Anna', email: 'anna@x.it' } });
  const csv = L.leadsCsv(db);
  assert.equal(csv.charCodeAt(0), 0xfeff, 'il BOM fa aprire gli accenti giusti a Excel');
  assert.ok(csv.slice(1).startsWith('Azienda;Tipo;Stato'));
  const [head, row] = csv.trim().split('\r\n');
  assert.equal(head.split(';').length, 21);
  assert.ok(row.startsWith(`"'=HYPERLINK(""http://x"")";`), 'la formula è neutralizzata');
  assert.ok(row.includes(';+39 041123456;'), 'un numero con il prefisso resta leggibile');
  assert.ok(row.includes('"a;b\nc"'), 'le celle con separatori sono tra virgolette');
});

test('profili B2B: un contatto si aggancia all’account con la stessa email (o dall’invito) e lo stato segue; le agenzie registrate si possono portare tra i contatti', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const byMail = mk(db, { company: 'Dalla mail', contact: { name: 'Anna', email: 'anna@dmc.it' } });
  const byInvite = mk(db, { company: 'Dall’invito', email: 'info@invitata.it' });
  const pending = mk(db, { company: 'In attesa', email: 'info@attesa.it' });
  const lonely = mk(db, { company: 'Senza profilo', email: 'info@sola.it' });
  assert.equal(L.syncAccounts(db, NOW), 0, 'nessun profilo, niente da fare');

  addAccount(db, { email: 'anna@dmc.it', company: 'DMC Srl', status: 'approved' });
  addAccount(db, { email: 'info@attesa.it', company: 'Attesa', status: 'pending' });
  const invited = createInvite(db, { email: 'info@invitata.it', lang: 'it' }, NOW);
  db.prepare('UPDATE partner_invites SET lead_id = ? WHERE id = ?').run(byInvite.id, invited.invite.id);
  const acct = addAccount(db, { email: 'altra-mail@invitata.it', company: 'Invitata', status: 'approved' }); // si è registrata con un altro indirizzo
  markUsed(db, invited.invite.id, acct.id, NOW);

  assert.equal(L.syncAccounts(db, NOW), 3, 'tre contatti cambiati (agganciati e, se serve, con lo stato nuovo)');
  const st = (l) => L.getLead(db, l.id);
  assert.deepEqual([st(byMail).status, st(byMail).account_id !== null], ['client', true]);
  assert.deepEqual([st(byInvite).status, st(byInvite).account_id], ['client', acct.id], 'agganciata dall’invito anche con un indirizzo diverso');
  assert.equal(st(pending).status, 'talking', 'registrata ma da approvare: almeno in dialogo');
  assert.equal(st(lonely).account_id, null);
  assert.ok(L.timeline(db, byMail.id).some((a) => a.kind === 'profile'));
  assert.equal(L.syncAccounts(db, NOW), 0, 'si può ripetere');
  assert.equal(L.leadOfAccount(db, acct.id).id, byInvite.id);
  assert.equal(L.accountOf(db, st(byInvite)).company, 'Invitata');

  // l'agenzia in attesa viene approvata: il contatto diventa cliente
  db.prepare("UPDATE accounts SET status = 'approved' WHERE email = 'info@attesa.it'").run();
  assert.equal(L.syncAccounts(db, NOW), 1);
  assert.equal(st(pending).status, 'client');

  // le agenzie già registrate che non sono tra i contatti
  addAccount(db, { email: 'solo-sito@x.it', company: 'Registrata da sola', contact_name: 'Gigi', status: 'approved', country: 'ES', lang: 'es', website: 'https://solosito.es' });
  addAccount(db, { email: 'rifiutata@x.it', company: 'Rifiutata', status: 'rejected' });
  assert.equal(L.addRegistered(db, NOW), 2);
  const mine = L.searchLeads(db, { q: 'Registrata da sola' }).rows[0];
  assert.deepEqual([mine.status, mine.country, mine.lang, mine.contact_name, mine.contact_email, mine.source, mine.website], ['client', 'ES', 'es', 'Gigi', 'solo-sito@x.it', 'Registrata sul sito', 'https://solosito.es']);
  assert.equal(L.searchLeads(db, { q: 'Rifiutata' }).rows[0].status, 'lost');
  assert.equal(L.addRegistered(db, NOW), 0, 'una volta sola');
  assert.equal(L.accountStats(db, acct.id).bookings, 0);
});

test('indirizzi email copiati da un sito o da un PDF: caratteri invisibili, «mailto:» e punteggiatura finale non rendono l’indirizzo non valido', () => {
  const dirty = ['management@bassanigroup.com', '​management@bassani­group.com​', ' mailto:Management@BassaniGroup.com. ', '<management@bassanigroup.com>', 'management@bassanigroup.com;'];
  for (const raw of dirty) {
    assert.equal(L.cleanEmail(raw), 'management@bassanigroup.com', JSON.stringify(raw));
    assert.equal(L.cleanLead({ company: 'Bassani Group', email: raw }).value.email, 'management@bassanigroup.com');
    assert.equal(L.cleanContact({ name: 'Ufficio', email: raw }).value.email, 'management@bassanigroup.com');
  }
  assert.throws(() => L.cleanLead({ company: 'X', email: 'non-una-email' }), (e) => e.code === 'email');
});

test('appuntamenti e richiamo: il richiamo segue il primo appuntamento; spostando, annullando o chiudendo si aggiorna; un richiamo scritto a mano non si perde', (t) => {
  const { db, cleanup } = makeApp();
  t.after(cleanup);
  const lead = mk(db, {});
  const next = () => [L.getLead(db, lead.id).next_action_on, L.getLead(db, lead.id).next_action];
  L.setNextAction(db, lead.id, { on: '2027-01-07', text: 'Richiamare tra tre giorni' }, NOW);
  const visit = L.addAppointment(db, lead.id, { kind: 'visit', date: '2027-01-12', start: '15:00', end: '16:00' }, NOW);
  assert.equal(next()[0], '2027-01-12', 'fissato un appuntamento, il vecchio richiamo passa all’appuntamento');
  assert.match(next()[1], /^Visita in azienda, .* alle 15:00$/);
  // un secondo, più lontano: il richiamo resta sul primo
  const video = L.addAppointment(db, lead.id, { kind: 'video', date: '2027-01-20', start: '10:00', end: '10:30' }, NOW);
  assert.equal(next()[0], '2027-01-12');
  // spostato: il richiamo lo segue
  L.updateAppointment(db, visit.id, { kind: 'visit', date: '2027-01-14', start: '11:00', end: '12:00' }, NOW);
  assert.equal(next()[0], '2027-01-14');
  assert.match(next()[1], /alle 11:00$/);
  // annullato: passa al successivo
  assert.equal(L.cancelAppointment(db, visit.id, NOW), true);
  assert.equal(next()[0], '2027-01-20');
  // fatto senza un nuovo richiamo: non resta nulla; con un nuovo richiamo vale quello
  L.completeAppointment(db, video.id, { outcome: 'Ci mandano le date' }, NOW);
  assert.deepEqual(next(), [null, null]);
  const call = L.addAppointment(db, lead.id, { kind: 'call', date: '2027-01-25', start: '09:00', end: '09:15', blocks: false }, NOW);
  L.completeAppointment(db, call.id, { outcome: 'Da risentire', nextOn: '2027-02-10', nextAction: 'Mandare il listino' }, NOW);
  assert.deepEqual(next(), ['2027-02-10', 'Mandare il listino']);
  // un richiamo scritto a mano non si tocca quando un appuntamento si sposta o si annulla
  const other = L.addAppointment(db, lead.id, { kind: 'visit', date: '2027-03-01', start: '15:00', end: '16:00' }, NOW);
  L.setNextAction(db, lead.id, { on: '2027-02-20', text: 'Mandare il contratto' }, NOW);
  L.updateAppointment(db, other.id, { kind: 'visit', date: '2027-03-02', start: '15:00', end: '16:00' }, NOW);
  L.cancelAppointment(db, other.id, NOW);
  assert.deepEqual(next(), ['2027-02-20', 'Mandare il contratto']);
  // un appuntamento già passato non diventa un richiamo
  const lead2 = mk(db, { company: 'Altra Agenzia', email: 'info@altra.it' });
  L.addAppointment(db, lead2.id, { kind: 'visit', date: '2027-01-02', start: '15:00', end: '16:00' }, NOW);
  assert.equal(L.getLead(db, lead2.id).next_action_on, null);
});
