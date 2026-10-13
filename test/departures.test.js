import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDepartures } from '../server/availability.js';
import { addAccount, base, FIXTURE_TOURS, makeApp, NOW, tour } from './helpers.js';

const key = (d) => `${d.date} ${d.time}`;

test('prossime partenze: solo tour a partenza fissa, in ordine, con i posti rimasti', async () => {
  const app = makeApp();
  try {
    const list = nextDepartures(app.db, app.cfg, FIXTURE_TOURS, '2027-01-04', { nowMs: NOW, limit: 5 });
    assert.equal(list.length, 5);
    assert.ok(list.every((d) => d.tour.slug === 'shared'), 'i servizi privati a orario libero non compaiono');
    assert.deepEqual(list.map(key), list.map(key).sort(), 'in ordine di data e ora');
    assert.deepEqual([list[0].left, list[0].joined], [10, false]);
    assert.ok(list.every((d) => d.date >= '2027-01-04'));
    // il preavviso minimo vale anche qui: alle 10:00 la partenza delle 09:30 è già passata
    assert.ok(!list.some((d) => d.date === '2027-01-04' && d.time === '09:30'));

    // 8 persone sulla prima partenza: restano 2 posti e la partenza è «confermata»
    const first = list[0];
    await app.services.book(base({ date: first.date, time: first.time, pax: 8 }), 'it', NOW);
    const after = nextDepartures(app.db, app.cfg, FIXTURE_TOURS, '2027-01-04', { nowMs: NOW, limit: 5 });
    assert.deepEqual([key(after[0]), after[0].left, after[0].joined], [key(first), 2, true]);
    // per 3 persone quella partenza non è più un'opzione
    const three = nextDepartures(app.db, app.cfg, FIXTURE_TOURS, '2027-01-04', { nowMs: NOW, limit: 5, pax: 3 });
    assert.ok(!three.some((d) => key(d) === key(first)));
    // limiti e casi vuoti
    assert.equal(nextDepartures(app.db, app.cfg, FIXTURE_TOURS, '2027-01-04', { nowMs: NOW, limit: 2 }).length, 2);
    assert.deepEqual(nextDepartures(app.db, app.cfg, [FIXTURE_TOURS[1], FIXTURE_TOURS[2]], '2027-01-04', { nowMs: NOW }), []);
    assert.deepEqual(nextDepartures(app.db, app.cfg, [], '2027-01-04', { nowMs: NOW }), []);
  } finally {
    app.cleanup();
  }
});

test('prossime partenze: giorni della settimana del tour e blocchi di calendario', async () => {
  const app = makeApp();
  try {
    const mondays = tour({ slug: 'lunedi', weekdays: [1], times: ['10:00'] });
    const list = nextDepartures(app.db, app.cfg, [mondays], '2027-01-04', { nowMs: NOW, limit: 3, channel: 'b2b' });
    assert.deepEqual(list.map((d) => d.date), ['2027-01-11', '2027-01-18', '2027-01-25'], 'oggi alle 10:00 è già troppo tardi: si parte dal lunedì dopo');
    addAccount(app.db); // (un account non cambia l'elenco)
    // un'indisponibilità tolta dal pannello (blocco) nasconde quel giorno
    app.db.prepare("INSERT INTO blocks(date, start_time, end_time, note, created_at) VALUES('2027-01-11','00:00','23:59','ferie',?)").run(new Date(NOW).toISOString());
    const without = nextDepartures(app.db, app.cfg, [mondays], '2027-01-04', { nowMs: NOW, limit: 3 });
    assert.deepEqual(without.map((d) => d.date), ['2027-01-18', '2027-01-25', '2027-02-01']);
  } finally {
    app.cleanup();
  }
});
