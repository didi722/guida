import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots } from '../server/availability.js';
import { createBooking } from '../server/bookings.js';
import { maskUrl, normalizeIcsUrl } from '../server/calendars.js';
import { base, makeApp, NOW } from './helpers.js';

const ROME = `BEGIN:VTIMEZONE
TZID:Europe/Rome
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`;
const event = (uid, start, end, title, extra = []) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;TZID=Europe/Rome:${start}`, `DTEND;TZID=Europe/Rome:${end}`, `SUMMARY:${title}`, ...extra, 'END:VEVENT'].join('\n');
const ics = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ROME, ...events, 'END:VCALENDAR'].join('\n');

/** Un finto server di calendari: cambia `state.body` per simulare modifiche dell'utente. */
function fakeCalendar(body) {
  const state = { body, status: 200, calls: 0, hang: false };
  const fetchImpl = async () => {
    state.calls++;
    if (state.hang) return new Promise(() => {});
    if (state.status === 'throw') throw new Error('rete non raggiungibile');
    return new Response(state.body, { status: state.status, headers: { 'content-type': 'text/calendar' } });
  };
  return { state, fetchImpl };
}

const times = (app, tour, date, now = NOW) => daySlots(app.db, app.cfg, app.content.tour(tour), date, { nowMs: now }).map((s) => s.time);

test('indirizzi iCal: webcal:// diventa https, schemi pericolosi rifiutati, URL mascherato', () => {
  assert.equal(normalizeIcsUrl('webcal://calendar.google.com/x/basic.ics'), 'https://calendar.google.com/x/basic.ics');
  assert.equal(normalizeIcsUrl('  https://example.com/a.ics '), 'https://example.com/a.ics');
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x/y.ics', 'non un url', '']) assert.equal(normalizeIcsUrl(bad), null, bad);
  const masked = maskUrl('https://calendar.google.com/calendar/ical/me%40gmail.com/private-abcdef123456/basic.ics');
  assert.ok(!masked.includes('private-abcdef123456') && masked.startsWith('calendar.google.com'));
});

test('gli impegni del calendario personale bloccano le disponibilità (fusi, giorno intero, libero ignorato)', async (t) => {
  const cal = fakeCalendar(
    ics(
      event('a', '20270112T143000', '20270112T153000', 'Dentista'), // si sovrappone al tour delle 14:30
      event('b', '20270113T090000', '20270113T100000', 'Libero', ['TRANSP:TRANSPARENT']),
      ['BEGIN:VEVENT', 'UID:c', 'DTSTART;VALUE=DATE:20270114', 'DTEND;VALUE=DATE:20270115', 'TRANSP:OPAQUE', 'SUMMARY:Ferie', 'END:VEVENT'].join('\n'),
    ),
  );
  const app = makeApp({}, { fetchImpl: cal.fetchImpl });
  t.after(app.cleanup);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['09:30', '14:30']);
  const source = app.calendars.add({ name: 'Personale', url: 'webcal://calendar.example/private-xyz/basic.ics' }, NOW);
  const res = await app.calendars.syncSource(source, NOW);
  assert.equal(res.ok, true);

  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['09:30'], '14:30 sovrapposto al dentista');
  assert.deepEqual(times(app, 'shared', '2027-01-13'), ['09:30', '14:30'], 'evento libero ignorato');
  assert.deepEqual(times(app, 'shared', '2027-01-14'), [], 'ferie: giorno intero');
  assert.deepEqual(times(app, 'private', '2027-01-14'), []);
  // il servizio privato a orario libero evita la pausa prima dell'impegno (14:30 − 30' − 2h = 12:00)
  const priv = times(app, 'private', '2027-01-12');
  assert.ok(priv.includes('12:00') && !priv.includes('12:30') && !priv.includes('15:00') && priv.includes('15:30'));
  // un cliente non può nemmeno prenotare quell'orario a mano
  assert.throws(() => createBooking(app, base({ date: '2027-01-12', time: '14:30', paymentMethod: 'onsite' }), NOW), (e) => e.code === 'unavailable');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM calendar_sources').get().n, 1);
  assert.equal(app.calendars.list()[0].url, 'https://calendar.example/private-xyz/basic.ics');
});

test('sincronizzazione: eventi spostati o eliminati, errori di rete, disattivazione, scollegamento', async (t) => {
  const cal = fakeCalendar(ics(event('a', '20270112T143000', '20270112T153000', 'Dentista')));
  const app = makeApp({}, { fetchImpl: cal.fetchImpl });
  t.after(app.cleanup);
  const source = app.calendars.add({ name: 'Personale', url: 'https://calendar.example/p.ics' }, NOW);
  await app.calendars.syncSource(source, NOW);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['09:30']);

  // l'utente sposta l'evento: la sincronizzazione sostituisce i dati vecchi
  cal.state.body = ics(event('a', '20270112T090000', '20270112T100000', 'Dentista (spostato)'));
  await app.calendars.syncSource(app.calendars.get(source.id), NOW + 60_000);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['14:30']);

  // errore di rete / risposta non valida: i dati precedenti restano, l'errore è registrato
  cal.state.status = 'throw';
  const failed = await app.calendars.syncSource(app.calendars.get(source.id), NOW + 120_000);
  assert.equal(failed.ok, false);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['14:30'], 'meglio dati vecchi che nessuno');
  assert.match(app.calendars.get(source.id).last_error, /rete non raggiungibile/);
  cal.state.status = 200;
  cal.state.body = '<html>Accesso negato</html>';
  assert.equal((await app.calendars.syncSource(app.calendars.get(source.id), NOW + 180_000)).ok, false);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['14:30']);
  cal.state.status = 404;
  cal.state.body = '';
  assert.match((await app.calendars.syncSource(app.calendars.get(source.id), NOW + 240_000)).error, /404/);

  // avviso se l'ultima lettura riuscita è troppo vecchia
  assert.equal(app.calendars.problems(NOW + 30 * 60_000).length, 0);
  assert.equal(app.calendars.problems(NOW + 90 * 60_000).length, 1);

  // disattivato: non blocca più; riattivato: torna a bloccare
  app.calendars.setEnabled(source.id, false);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['09:30', '14:30']);
  app.calendars.setEnabled(source.id, true);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['14:30']);
  // scollegato: sparisce tutto (anche le righe)
  assert.equal(app.calendars.remove(source.id), true);
  assert.deepEqual(times(app, 'shared', '2027-01-12'), ['09:30', '14:30']);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM external_busy').get().n, 0);
});

test('prima di confermare una prenotazione il calendario si riallinea (impegno appena inserito)', async (t) => {
  const cal = fakeCalendar(ics());
  const app = makeApp({ calendar: { freshSeconds: 120 } }, { fetchImpl: cal.fetchImpl });
  t.after(app.cleanup);
  const source = app.calendars.add({ name: 'Personale', url: 'https://calendar.example/p.ics' }, NOW);
  await app.calendars.syncSource(source, NOW);
  assert.equal(cal.state.calls, 1);

  assert.equal(await app.calendars.ensureFresh(NOW + 30_000), false, 'dati recenti: nessuna richiesta');
  assert.equal(cal.state.calls, 1);

  // l'utente aggiunge un impegno; passano più di 2 minuti → ensureFresh lo legge
  cal.state.body = ics(event('n', '20270112T143000', '20270112T153000', 'Appena aggiunto'));
  assert.equal(await app.calendars.ensureFresh(NOW + 5 * 60_000), true);
  assert.equal(cal.state.calls, 2);
  assert.deepEqual(times(app, 'shared', '2027-01-12', NOW + 5 * 60_000), ['09:30']);

  // se il server del calendario non risponde, la prenotazione non resta appesa
  cal.state.hang = true;
  const t0 = Date.now();
  await app.calendars.ensureFresh(NOW + 20 * 60_000, 150);
  assert.ok(Date.now() - t0 < 1500, 'timeout rispettato');
});

test('il job periodico rilegge i calendari solo quando è ora', async (t) => {
  const cal = fakeCalendar(ics());
  const app = makeApp({ calendar: { syncMinutes: 10 } }, { fetchImpl: cal.fetchImpl });
  t.after(app.cleanup);
  app.calendars.add({ name: 'P', url: 'https://calendar.example/p.ics' }, NOW);
  assert.equal(await app.calendars.syncDue(NOW), 1);
  assert.equal(await app.calendars.syncDue(NOW + 5 * 60_000), 0, 'troppo presto');
  assert.equal(await app.calendars.syncDue(NOW + 11 * 60_000), 1);
  assert.equal(await app.calendars.syncDue(NOW + 12 * 60_000, { force: true }), 1);
  assert.equal(cal.state.calls, 3);
});
