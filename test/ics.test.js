import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBusy, prefilter, splitIntoDays } from '../server/ics-parse.js';
import { localToInstant } from '../server/time.js';

const TZ_ROME = `BEGIN:VTIMEZONE
TZID:Europe/Rome
X-LIC-LOCATION:Europe/Rome
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

const ev = (lines) => `BEGIN:VEVENT\n${lines.join('\n')}\nEND:VEVENT`;
const cal = (...events) => ['BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0', 'X-WR-CALNAME:Personale', TZ_ROME, ...events, 'END:VCALENDAR'].join('\n');

const window = { fromMs: localToInstant('2027-01-01', '00:00'), toMs: localToInstant('2028-01-01', '00:00') };
const z = (s) => Date.parse(s);
const byTitle = (busy) => Object.fromEntries(busy.reduce((m, b) => m.set(b.title, [...(m.get(b.title) ?? []), [new Date(b.startMs).toISOString().slice(0, 16) + 'Z', new Date(b.endMs).toISOString().slice(0, 16) + 'Z']]), new Map()));

test('eventi singoli: fusi orari con ora legale, UTC, floating, TZID senza definizione', () => {
  const { busy } = parseBusy(
    cal(
      ev(['UID:1', 'DTSTART;TZID=Europe/Rome:20270112T150000', 'DTEND;TZID=Europe/Rome:20270112T160000', 'SUMMARY:Inverno']),
      ev(['UID:2', 'DTSTART;TZID=Europe/Rome:20270713T150000', 'DTEND;TZID=Europe/Rome:20270713T160000', 'SUMMARY:Estate']),
      ev(['UID:3', 'DTSTART:20270112T090000Z', 'DTEND:20270112T100000Z', 'SUMMARY:UTC']),
      ev(['UID:4', 'DTSTART:20270112T090000', 'DTEND:20270112T100000', 'SUMMARY:Floating']),
      ev(['UID:5', 'DTSTART;TZID=America/New_York:20270112T090000', 'DTEND;TZID=America/New_York:20270112T100000', 'SUMMARY:NewYork senza VTIMEZONE']),
      ev(['UID:6', 'DTSTART;TZID=Fuso/Inventato:20270112T090000', 'DTEND;TZID=Fuso/Inventato:20270112T100000', 'SUMMARY:Fuso sconosciuto']),
    ),
    window,
  );
  assert.deepEqual(byTitle(busy), {
    Inverno: [['2027-01-12T14:00Z', '2027-01-12T15:00Z']],
    Estate: [['2027-07-13T13:00Z', '2027-07-13T14:00Z']],
    UTC: [['2027-01-12T09:00Z', '2027-01-12T10:00Z']],
    Floating: [['2027-01-12T08:00Z', '2027-01-12T09:00Z']], // letto come ora di Venezia
    'NewYork senza VTIMEZONE': [['2027-01-12T14:00Z', '2027-01-12T15:00Z']],
    'Fuso sconosciuto': [['2027-01-12T08:00Z', '2027-01-12T09:00Z']], // ripiega sull'ora di Venezia
  });
});

test('occupato / libero: TRANSP, eventi cancellati e giorno intero', () => {
  const { busy } = parseBusy(
    cal(
      ev(['UID:a', 'DTSTART;VALUE=DATE:20270120', 'DTEND;VALUE=DATE:20270122', 'TRANSP:OPAQUE', 'SUMMARY:Ferie']),
      ev(['UID:b', 'DTSTART;VALUE=DATE:20270125', 'DTEND;VALUE=DATE:20270126', 'TRANSP:TRANSPARENT', 'SUMMARY:Compleanno (libero)']),
      ev(['UID:c', 'DTSTART;VALUE=DATE:20270127', 'SUMMARY:Senza TRANSP (occupato)']),
      ev(['UID:d', 'DTSTART;TZID=Europe/Rome:20270112T100000', 'DTEND;TZID=Europe/Rome:20270112T110000', 'TRANSP:TRANSPARENT', 'SUMMARY:Segnato libero']),
      ev(['UID:e', 'DTSTART;TZID=Europe/Rome:20270112T120000', 'DTEND;TZID=Europe/Rome:20270112T130000', 'STATUS:CANCELLED', 'SUMMARY:Annullato']),
      ev(['UID:f', 'DTSTART;TZID=Europe/Rome:20270112T140000', 'DTEND;TZID=Europe/Rome:20270112T140000', 'SUMMARY:Durata zero']),
    ),
    window,
  );
  assert.deepEqual(byTitle(busy), {
    Ferie: [['2027-01-19T23:00Z', '2027-01-21T23:00Z']], // 20 e 21 gennaio, mezzanotte-mezzanotte a Venezia
    'Senza TRANSP (occupato)': [['2027-01-26T23:00Z', '2027-01-27T23:00Z']],
  });
});

test('ricorrenze: EXDATE, istanza spostata, UNTIL, ora legale', () => {
  const { busy } = parseBusy(
    cal(
      ev(['UID:w', 'DTSTART;TZID=Europe/Rome:20261201T100000', 'DTEND;TZID=Europe/Rome:20261201T110000', 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270201T000000Z', 'EXDATE;TZID=Europe/Rome:20270112T100000', 'SUMMARY:Settimanale']),
      ev(['UID:w', 'RECURRENCE-ID;TZID=Europe/Rome:20270119T100000', 'DTSTART;TZID=Europe/Rome:20270119T170000', 'DTEND;TZID=Europe/Rome:20270119T180000', 'SUMMARY:Settimanale spostato']),
      ev(['UID:dst', 'DTSTART;TZID=Europe/Rome:20270314T100000', 'DTEND;TZID=Europe/Rome:20270314T110000', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Domenica']),
    ),
    window,
  );
  const t = byTitle(busy);
  assert.deepEqual(t.Settimanale, [['2027-01-05T09:00Z', '2027-01-05T10:00Z'], ['2027-01-26T09:00Z', '2027-01-26T10:00Z']], '12 gennaio escluso, 19 spostato, 2 febbraio oltre UNTIL');
  assert.deepEqual(t['Settimanale spostato'], [['2027-01-19T16:00Z', '2027-01-19T17:00Z']]);
  assert.deepEqual(t.Domenica, [['2027-03-14T09:00Z', '2027-03-14T10:00Z'], ['2027-03-21T09:00Z', '2027-03-21T10:00Z'], ['2027-03-28T08:00Z', '2027-03-28T09:00Z']], 'dal 28 marzo scatta l\'ora legale');
});

test('eventi a cavallo della mezzanotte, titoli piegati su più righe, UID nostri ignorati', () => {
  const folded = ['UID:long', 'DTSTART;TZID=Europe/Rome:20270115T100000', 'DTEND;TZID=Europe/Rome:20270115T110000', 'SUMMARY:Titolo che il calendario ha dovuto spezzare ', ' su due righe'];
  const { busy } = parseBusy(
    cal(
      ev(['UID:night', 'DTSTART;TZID=Europe/Rome:20270116T220000', 'DTEND;TZID=Europe/Rome:20270117T020000', 'SUMMARY:Notte']),
      ev(folded),
      ev(['UID:VE-ABC123@guida.example', 'DTSTART;TZID=Europe/Rome:20270118T100000', 'DTEND;TZID=Europe/Rome:20270118T120000', 'SUMMARY:Una nostra prenotazione']),
    ),
    { ...window, ownUidSuffix: '@guida.example' },
  );
  assert.equal(busy.length, 2);
  assert.equal(busy.find((b) => b.uid === 'long').title, 'Titolo che il calendario ha dovuto spezzare su due righe');
  const night = busy.find((b) => b.uid === 'night');
  assert.deepEqual(splitIntoDays(night.startMs, night.endMs), [
    { date: '2027-01-16', start: '22:00', end: '24:00' },
    { date: '2027-01-17', start: '00:00', end: '02:00' },
  ]);
});

test('storia vecchia scartata prima del parsing, eventi malformati non rompono il resto', () => {
  const old = [ev(['UID:o1', 'DTSTART;TZID=Europe/Rome:20190112T100000', 'DTEND;TZID=Europe/Rome:20190112T110000', 'SUMMARY:Vecchio']), ev(['UID:o2', 'DTSTART;TZID=Europe/Rome:20150112T100000', 'DTEND;TZID=Europe/Rome:20150112T110000', 'RRULE:FREQ=DAILY;UNTIL=20200101T000000Z', 'SUMMARY:Vecchia serie'])];
  const text = cal(...old, ev(['UID:n', 'DTSTART;TZID=Europe/Rome:20270112T100000', 'DTEND;TZID=Europe/Rome:20270112T110000', 'SUMMARY:Nuovo']), ev(['UID:bad', 'DTSTART;TZID=Europe/Rome:20270113T100000', 'DTEND;TZID=Europe/Rome:20270113T110000', 'RRULE:FREQ=BANANA', 'SUMMARY:Rotto']));
  const filtered = prefilter(text, window.fromMs, window.toMs);
  assert.ok(!filtered.includes('Vecchio') && !filtered.includes('Vecchia serie'));
  assert.ok(filtered.includes('VTIMEZONE') && filtered.includes('Nuovo'));
  const { busy, skipped } = parseBusy(text, window);
  assert.deepEqual(busy.map((b) => b.title), ['Nuovo']);
  assert.ok(skipped >= 1);
  assert.throws(() => parseBusy('questo non è un calendario', window));
});

test('splitIntoDays: un giorno solo, più giorni, termina a mezzanotte', () => {
  const s = localToInstant('2027-01-10', '09:00');
  assert.deepEqual(splitIntoDays(s, localToInstant('2027-01-10', '11:30')), [{ date: '2027-01-10', start: '09:00', end: '11:30' }]);
  assert.deepEqual(splitIntoDays(s, localToInstant('2027-01-12', '10:00')), [
    { date: '2027-01-10', start: '09:00', end: '24:00' },
    { date: '2027-01-11', start: '00:00', end: '24:00' },
    { date: '2027-01-12', start: '00:00', end: '10:00' },
  ]);
  assert.deepEqual(splitIntoDays(s, localToInstant('2027-01-11', '00:00')), [{ date: '2027-01-10', start: '09:00', end: '24:00' }]);
});
