// Periodi con regole particolari (alta stagione, Carnevale…): opzioni più brevi o spente e preavviso minimo diverso, solo per le date del servizio che cadono dentro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext } from '../server/context.js';
import { BookingError, cancellationState, createBooking, getBooking } from '../server/bookings.js';
import { cancelPeriodFor, policyFor } from '../server/policy.js';
import { loadAvailabilityContext, minNoticeHours, slotsForDay } from '../server/availability.js';
import { DEFAULT_OPTION_TIERS, optionWindow } from '../server/optionPolicy.js';
import { listPeriods, normalizePeriod, periodOn, rulesText, savePeriod, spanDays } from '../server/periods.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OPTIONS = { enabled: true, tiers: DEFAULT_OPTION_TIERS, minReleaseHours: 48, maxActive: 5, reminderHours: 24 };
const at = (date, time = '10:00') => localToInstant(date, time);
const period = (over = {}) => ({ id: 1, name: 'Carnevale', from: '2027-02-04', to: '2027-02-16', optionsMode: 'normal', optionMaxDays: null, optionReleaseHours: null, noticeB2cHours: null, noticeB2bHours: null, ...over });

test('quale periodo contiene una data: estremi compresi, fuori nulla', () => {
  const list = [period({ id: 1, from: '2027-02-04', to: '2027-02-16' }), period({ id: 2, name: 'Estate', from: '2027-06-01', to: '2027-09-15' })];
  assert.equal(periodOn(list, '2027-02-04').name, 'Carnevale', 'il primo giorno è dentro');
  assert.equal(periodOn(list, '2027-02-16').name, 'Carnevale', 'e l’ultimo');
  assert.equal(periodOn(list, '2027-02-03'), null);
  assert.equal(periodOn(list, '2027-02-17'), null);
  assert.equal(periodOn(list, '2027-07-01').name, 'Estate');
  assert.equal(periodOn([], '2027-02-10'), null);
  assert.equal(periodOn(undefined, '2027-02-10'), null);
  assert.equal(periodOn(list, ''), null);
  assert.equal(spanDays('2027-02-04', '2027-02-16'), 13);
  assert.equal(spanDays('2027-02-04', '2027-02-04'), 1);
});

test('controllo del modulo: nome, date, tipo di opzioni, numeri, e un periodo che non cambia nulla è rifiutato', () => {
  const ok = (input) => {
    const r = normalizePeriod(input);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return r.values;
  };
  const bad = (input) => {
    const r = normalizePeriod(input);
    assert.equal(r.ok, false);
    return r.errors;
  };
  const dates = { from: '2027-02-04', to: '2027-02-16' };
  assert.deepEqual(ok({ name: '  Carnevale   2027 ', ...dates, mode: 'short', maxDays: '3', releaseHours: '', noticeB2c: '', noticeB2b: '' }), { name: 'Carnevale 2027', ...dates, mode: 'short', maxDays: 3, releaseHours: null, noticeB2c: null, noticeB2b: null, cancelB2c: null, cancelB2b: null, cancelPartners: false });
  assert.deepEqual(ok({ name: 'Natale', ...dates, mode: 'off' }), { name: 'Natale', ...dates, mode: 'off', maxDays: null, releaseHours: null, noticeB2c: null, noticeB2b: null, cancelB2c: null, cancelB2b: null, cancelPartners: false });
  assert.deepEqual(ok({ name: 'Solo preavviso', ...dates, mode: 'normal', noticeB2c: '72', noticeB2b: '0' }).noticeB2b, 0, 'zero ore è un valore valido: nessun preavviso');
  assert.equal(ok({ name: 'x', ...dates, mode: 'off', maxDays: '5', releaseHours: '9' }).maxDays, null, 'i numeri delle opzioni brevi contano solo per «Più brevi»');
  assert.equal(ok({ name: 'x', ...dates, mode: 'strano', noticeB2b: '5' }).mode, 'normal', 'un tipo che non esiste vale «come sempre»');
  assert.equal(ok({ name: 'Una notte', from: '2027-12-31', to: '2027-12-31', mode: 'off' }).from, '2027-12-31', 'anche un giorno solo');
  assert.equal(ok({ name: 'Anno', from: '2027-01-01', to: '2027-12-31', mode: 'off' }).to, '2027-12-31', '365 giorni stanno');
  // sbagliato
  assert.match(bad({ name: '', ...dates, mode: 'off' }).name, /Scrivi un nome/);
  assert.match(bad({ name: 'x'.repeat(61), ...dates, mode: 'off' }).name, /troppo lungo/);
  assert.match(bad({ name: 'x', from: '', to: '2027-02-16', mode: 'off' }).from, /primo giorno/);
  assert.match(bad({ name: 'x', from: '2027-02-04', to: 'boh', mode: 'off' }).to, /ultimo giorno/);
  assert.match(bad({ name: 'x', from: '2027-02-31', to: '2027-03-01', mode: 'off' }).from, /primo giorno/, 'il 31 febbraio non esiste');
  assert.match(bad({ name: 'x', from: '2027-02-16', to: '2027-02-04', mode: 'off' }).to, /non può venire prima/);
  assert.match(bad({ name: 'x', from: '2027-01-01', to: '2028-01-02', mode: 'off' }).to, /più di un anno/);
  assert.match(bad({ name: 'x', ...dates, mode: 'short' }).maxDays, /indica la durata massima/, 'più brevi senza dire di quanto');
  assert.match(bad({ name: 'x', ...dates, mode: 'short', maxDays: '0' }).maxDays, /da 1 a 90/);
  assert.match(bad({ name: 'x', ...dates, mode: 'short', maxDays: '91' }).maxDays, /da 1 a 90/);
  assert.match(bad({ name: 'x', ...dates, mode: 'short', maxDays: '2,5' }).maxDays, /intero/);
  assert.match(bad({ name: 'x', ...dates, mode: 'short', releaseHours: '-1' }).releaseHours, /da 0 a 720/);
  assert.match(bad({ name: 'x', ...dates, mode: 'short', releaseHours: '721' }).releaseHours, /da 0 a 720/);
  assert.match(bad({ name: 'x', ...dates, mode: 'normal', noticeB2c: '721' }).noticeB2c, /Preavviso per i privati/);
  assert.match(bad({ name: 'x', ...dates, mode: 'normal', noticeB2b: 'abc' }).noticeB2b, /Preavviso per le agenzie/);
  assert.match(bad({ name: 'x', ...dates, mode: 'normal' }).mode, /non cambia nessuna regola/);
  assert.match(bad({ name: 'x', ...dates, mode: 'normal', noticeB2c: '', noticeB2b: '  ' }).mode, /non cambia nessuna regola/);
  assert.deepEqual(Object.keys(bad({ name: '', from: '', to: '', mode: 'short', maxDays: '0' })).sort(), ['from', 'maxDays', 'name', 'to']);
});

test('salvare, cambiare, eliminare: un giorno sta in un solo periodo, e la lista in uso segue il database', () => {
  const app = makeApp();
  try {
    assert.deepEqual(app.periods.list(), []);
    const list = app.periods.list(); // la stessa lista deve restare quella viva
    const carnival = app.periods.save({ name: 'Carnevale', from: '2027-02-04', to: '2027-02-16', mode: 'short', maxDays: '3' }, null, NOW);
    assert.equal(carnival.ok, true);
    assert.equal(app.periods.list(), list, 'stessa lista, aggiornata sul posto');
    assert.equal(list.length, 1);
    assert.equal(list[0].optionsMode, 'short');
    assert.equal(app.cfg.options.periods, list, 'le regole delle opzioni leggono proprio questa');
    // sovrapposizioni: anche di un giorno solo, e il messaggio dice con chi
    const clash = app.periods.save({ name: 'Marzo', from: '2027-02-16', to: '2027-03-10', mode: 'off' });
    assert.equal(clash.ok, false);
    assert.match(clash.errors.from, /si sovrappongono a «Carnevale» \(4 feb 2027 – 16 feb 2027\)/);
    assert.equal(app.periods.save({ name: 'Dentro', from: '2027-02-08', to: '2027-02-09', mode: 'off' }).ok, false);
    assert.equal(app.periods.save({ name: 'Intorno', from: '2027-01-01', to: '2027-12-31', mode: 'off' }).ok, false);
    const next = app.periods.save({ name: 'Marzo', from: '2027-02-17', to: '2027-03-10', mode: 'off' });
    assert.equal(next.ok, true, 'il giorno dopo va bene');
    assert.deepEqual(list.map((p) => p.name), ['Carnevale', 'Marzo'], 'in ordine di data');
    // cambiare uno non confligge con se stesso, ma con gli altri sì
    assert.equal(app.periods.save({ name: 'Carnevale lungo', from: '2027-02-04', to: '2027-02-16', mode: 'short', maxDays: '2' }, carnival.id).ok, true);
    assert.equal(list[0].optionMaxDays, 2);
    assert.equal(app.periods.save({ name: 'Carnevale', from: '2027-02-04', to: '2027-02-17', mode: 'short', maxDays: '2' }, carnival.id).ok, false, 'invade Marzo');
    assert.equal(list[0].name, 'Carnevale lungo', 'un salvataggio rifiutato non cambia nulla');
    assert.equal(app.periods.save({ name: 'x', from: '2027-02-04', to: '2027-02-16', mode: 'off' }, 999).ok, false, 'un periodo che non c’è');
    // eliminare
    assert.equal(app.periods.remove(next.id), true);
    assert.equal(app.periods.remove(next.id), false);
    assert.deepEqual(list.map((p) => p.name), ['Carnevale lungo']);
    // un'altra applicazione sullo stesso database li ritrova
    const again = createContext({ cfg: app.cfg, db: app.db, content: app.content });
    assert.deepEqual(again.periods.list().map((p) => p.name), ['Carnevale lungo']);
    assert.deepEqual(listPeriods(app.db).map((p) => p.id), [carnival.id]);
    // direttamente nel database un tipo strano non entra (CHECK della tabella)
    assert.throws(() => app.db.prepare(`INSERT INTO periods(name, date_from, date_to, options_mode, created_at) VALUES('x', '2027-05-01', '2027-05-02', 'strano', 'ora')`).run());
    assert.equal(savePeriod(app.db, { name: 'Diretto', from: '2027-05-01', to: '2027-05-02', mode: 'off' }, null, NOW).ok, true);
    app.periods.reload();
    assert.equal(list.length, 2, 'dopo un cambio fatto fuori dal servizio basta rileggere');
  } finally {
    app.cleanup();
  }
});

test('riga di riepilogo delle regole', () => {
  assert.equal(rulesText(period({ optionsMode: 'off' })), 'niente opzioni (le agenzie prenotano direttamente)');
  assert.equal(rulesText(period({ optionsMode: 'short', optionMaxDays: 3, optionReleaseHours: 72 })), 'opzioni più brevi: al massimo 3 giorni, scadenza almeno 72 ore prima del servizio');
  assert.equal(rulesText(period({ optionsMode: 'short', optionMaxDays: 1 })), 'opzioni più brevi: al massimo 1 giorno');
  assert.equal(rulesText(period({ optionsMode: 'short', optionReleaseHours: 1 })), 'opzioni più brevi: scadenza almeno 1 ora prima del servizio');
  assert.equal(rulesText(period({ noticeB2cHours: 48, noticeB2bHours: 0 })), 'preavviso minimo: privati 48 ore, agenzie 0 ore');
  assert.equal(rulesText(period({ optionsMode: 'off', noticeB2bHours: 6 })), 'niente opzioni (le agenzie prenotano direttamente) · preavviso minimo: agenzie 6 ore');
  assert.equal(rulesText(period()), '');
});

// ───────────── le opzioni ─────────────
const win = (startMs, { options = OPTIONS, account = null, nowMs = NOW } = {}) => optionWindow({ options, account, startMs, nowMs });

test('opzioni più brevi: la durata si accorcia solo per le date dentro il periodo, e dice quale periodo è stato', () => {
  const options = { ...OPTIONS, periods: [period({ optionsMode: 'short', optionMaxDays: 3 })] };
  const inside = win(at('2027-02-10'), { options }); // 37 giorni: di solito 10 giorni
  assert.equal(inside.ok, true);
  assert.equal(inside.days, 3);
  assert.equal(inside.expiresMs, NOW + 3 * DAY);
  assert.equal(inside.capped, true);
  assert.deepEqual(inside.period, { id: 1, name: 'Carnevale', mode: 'short' });
  const outside = win(at('2027-02-20'), { options }); // 47 giorni, fuori dal periodo
  assert.equal(outside.days, 10);
  assert.equal(outside.period, null);
  assert.equal(outside.capped, false);
  // un'opzione già più corta del limite non si allunga
  assert.equal(win(at('2027-02-05'), { options: { ...options, periods: [period({ optionsMode: 'short', optionMaxDays: 30 })] } }).days, 10, '32 giorni: 10 giorni, il limite di 30 non c’entra');
  assert.equal(win(at('2027-02-05'), { options: { ...options, periods: [period({ optionsMode: 'short', optionMaxDays: 30 })] } }).capped, false);
  // l'estremo del periodo e il giorno dopo: si conta il giorno del servizio a Venezia, non a Greenwich
  assert.equal(win(at('2027-02-04', '00:30'), { options }).days, 3, 'le 00:30 del primo giorno (le 23:30 del giorno prima in UTC) sono dentro');
  assert.equal(win(at('2027-02-16', '23:30'), { options }).days, 3, 'le 23:30 dell’ultimo giorno sono dentro');
  assert.equal(win(at('2027-02-17', '00:10'), { options }).days, 10, 'dopo mezzanotte si è fuori');
  assert.equal(win(at('2027-02-03', '23:50'), { options }).days, 10, 'e prima dell’inizio pure');
});

test('opzioni più brevi: la scadenza si allontana dal servizio, e vale il maggiore tra il margine del sito e quello del periodo', () => {
  const options = (over) => ({ ...OPTIONS, periods: [period({ optionsMode: 'short', ...over })] });
  // tour fra 37 giorni: opzione di 10 giorni, scadenza il giorno 10: con 120 ore di margine il limite è a 32 giorni dal servizio, che non stringe
  assert.equal(win(at('2027-02-10'), { options: options({ optionReleaseHours: 120 }) }).days, 10);
  // tour fra 9 giorni (2027-01-13 non è in periodo: uso un periodo che lo contiene)
  const near = (opts) => win(at('2027-01-13'), { options: { ...OPTIONS, periods: [period({ from: '2027-01-10', to: '2027-01-20', optionsMode: 'short', ...opts })] } });
  assert.equal(near({ optionMaxDays: 30 }).days, 3, '9 giorni: la tabella dà 3 giorni');
  assert.equal(near({ optionReleaseHours: 144 }).days, 3, '144 ore = 6 giorni prima del servizio: 9 − 6 = 3, ancora dentro');
  const tight = near({ optionReleaseHours: 192 }); // 8 giorni prima: restano 1 giorno
  assert.equal(tight.ok, true);
  assert.equal(tight.days, 1);
  assert.equal(tight.capped, true);
  assert.equal(tight.expiresMs, at('2027-01-13') - 192 * HOUR);
  assert.deepEqual(near({ optionReleaseHours: 216 }), { ok: false, reason: 'tooClose' }, 'con 9 giorni di margine non resta nulla da trattenere');
  assert.equal(near({ optionReleaseHours: 12 }).expiresMs, NOW + 3 * DAY, 'un margine più piccolo di quello del sito (48 ore) non conta: vale il maggiore');
  // tutte e due le regole insieme
  const both = near({ optionMaxDays: 2, optionReleaseHours: 168 });
  assert.equal(both.days, 2);
  assert.equal(both.expiresMs, NOW + 2 * DAY);
});

test('niente opzioni nel periodo; le durate fisse dei partner non scavalcano il limite; «spente» per il sito o per l’agenzia vengono prima', () => {
  const off = { ...OPTIONS, periods: [period({ optionsMode: 'off' })] };
  assert.deepEqual(win(at('2027-02-10'), { options: off }), { ok: false, reason: 'period', period: { id: 1, name: 'Carnevale', mode: 'off' } });
  assert.equal(win(at('2027-02-20'), { options: off }).ok, true, 'fuori dal periodo tutto come prima');
  assert.equal(win(at('2027-02-10'), { options: off, account: { options_enabled: 1, option_days: 4 } }).reason, 'period', 'nemmeno con una durata fissa');
  // limite breve e partner con durata fissa di 10 giorni: vale il limite del periodo
  const short = { ...OPTIONS, periods: [period({ optionsMode: 'short', optionMaxDays: 2 })] };
  assert.equal(win(at('2027-02-10'), { options: short, account: { options_enabled: 1, option_days: 10 } }).days, 2);
  assert.equal(win(at('2027-02-20'), { options: short, account: { options_enabled: 1, option_days: 10 } }).days, 10, 'fuori dal periodo la durata concordata vale');
  // se le opzioni sono spente (sito o agenzia) la ragione resta «spente», non «periodo»
  assert.equal(win(at('2027-02-10'), { options: { ...off, enabled: false } }).reason, 'disabled');
  assert.equal(win(at('2027-02-10'), { options: off, account: { options_enabled: 0 } }).reason, 'disabled');
  // senza l'elenco dei periodi (configurazioni vecchie) nulla cambia
  assert.equal(win(at('2027-02-10')).days, 10);
  assert.equal(win(at('2027-02-10')).period, null);
  // «più brevi» senza numeri (non può uscire dal modulo) non cambia nulla
  assert.equal(win(at('2027-02-10'), { options: { ...OPTIONS, periods: [period({ optionsMode: 'short' })] } }).days, 10);
});

/** Un'agenzia e l'input di un'opzione per una data. */
function setup() {
  const app = makeApp();
  const acct = addAccount(app.db, {});
  return { app, acct };
}
const optionInput = (acct, over = {}) => base({ channel: 'b2b', account: acct, option: true, email: acct.email, name: 'Anna', clientRef: 'Gruppo Rossi', tourSlug: 'private', time: '10:00', pax: 5, ...over });

test('prenotare un’opzione: dentro il periodo scade prima oppure non si può, fuori no', () => {
  const { app, acct } = setup();
  try {
    app.periods.save({ name: 'Carnevale', from: '2027-02-04', to: '2027-02-16', mode: 'short', maxDays: '3' }, null, NOW);
    app.periods.save({ name: 'Natale', from: '2027-12-20', to: '2028-01-06', mode: 'off' }, null, NOW);
    const inside = createBooking(app, optionInput(acct, { date: '2027-02-10' }), NOW);
    assert.equal(inside.status, 'option');
    assert.equal(Date.parse(inside.option_expires_at), NOW + 3 * DAY, 'tre giorni invece di dieci');
    const outside = createBooking(app, optionInput(acct, { date: '2027-02-24' }), NOW);
    assert.equal(Date.parse(outside.option_expires_at), NOW + 10 * DAY, 'fuori dal periodo, come sempre');
    assert.throws(() => createBooking(app, optionInput(acct, { date: '2027-12-28' }), NOW), (e) => e instanceof BookingError && e.code === 'option' && e.message === 'period');
    // la prenotazione diretta, invece, nel periodo «senza opzioni» si fa normalmente
    const direct = createBooking(app, optionInput(acct, { date: '2027-12-28', option: false, paymentMethod: 'card' }), NOW);
    assert.notEqual(direct.status, 'option');
    assert.equal(getBooking(app.db, direct.id).date, '2027-12-28');
  } finally {
    app.cleanup();
  }
});

// ───────────── il preavviso ─────────────
test('preavviso minimo: il periodo ha il suo (diverso per privati e agenzie), fuori vale quello del sito', () => {
  const app = makeApp({ policy: { b2cMinNoticeHours: 24, b2bMinNoticeHours: 12 } });
  try {
    assert.equal(minNoticeHours(app.cfg, 'b2c'), 24);
    assert.equal(minNoticeHours(app.cfg, 'b2b'), 12);
    assert.equal(minNoticeHours(app.cfg, 'b2c', '2027-02-10'), 24, 'senza periodi vale quello del sito');
    app.periods.save({ name: 'Carnevale', from: '2027-02-04', to: '2027-02-16', mode: 'normal', noticeB2c: '72', noticeB2b: '0' }, null, NOW);
    app.periods.save({ name: 'Solo agenzie', from: '2027-03-01', to: '2027-03-10', mode: 'normal', noticeB2b: '48' }, null, NOW);
    assert.equal(minNoticeHours(app.cfg, 'b2c', '2027-02-10'), 72);
    assert.equal(minNoticeHours(app.cfg, 'b2b', '2027-02-10'), 0, 'zero: nessun preavviso, non «come il sito»');
    assert.equal(minNoticeHours(app.cfg, 'b2c', '2027-03-05'), 24, 'il periodo dice solo il preavviso delle agenzie: i privati restano come il sito');
    assert.equal(minNoticeHours(app.cfg, 'b2b', '2027-03-05'), 48);
    assert.equal(minNoticeHours(app.cfg, 'b2c', '2027-02-17'), 24, 'il giorno dopo il periodo');
    assert.equal(minNoticeHours(app.cfg, 'b2c'), 24, 'senza data non si sa in che periodo cade');
  } finally {
    app.cleanup();
  }
});

test('preavviso nelle partenze prenotabili: più lungo nel periodo (la partenza sparisce), più corto (compare)', () => {
  const app = makeApp({ policy: { b2cMinNoticeHours: 24, b2bMinNoticeHours: 12 } });
  try {
    const tour = app.content.tour('shared'); // 09:30 e 14:30, tutti i giorni
    // «adesso» è lunedì 4 gennaio 2027 alle 10:00: martedì 5 alle 14:30 sono 28 ore e mezza; mercoledì 6 alle 09:30 sono 47 ore e mezza
    const slots = (date, channel) => {
      const ctx = loadAvailabilityContext(app.db, app.cfg, date, date, NOW);
      return slotsForDay(ctx, app.cfg, tour, date, { pax: 1, channel, nowMs: NOW }).map((s) => s.time);
    };
    assert.deepEqual(slots('2027-01-05', 'b2c'), ['14:30'], 'senza periodi: le 09:30 sono troppo vicine (23 ore e mezza), le 14:30 no');
    app.periods.save({ name: 'Alta stagione', from: '2027-01-05', to: '2027-01-06', mode: 'normal', noticeB2c: '48' }, null, NOW);
    assert.deepEqual(slots('2027-01-05', 'b2c'), [], 'con 48 ore di preavviso martedì non si prenota più');
    assert.deepEqual(slots('2027-01-06', 'b2c'), ['14:30'], 'mercoledì alle 09:30 sono 47 ore e mezza (troppo poco), alle 14:30 sono 52 e mezza (va bene)');
    assert.deepEqual(slots('2027-01-07', 'b2c'), ['09:30', '14:30'], 'fuori dal periodo, come sempre');
    assert.deepEqual(slots('2027-01-05', 'b2b'), ['09:30', '14:30'], 'le agenzie hanno il loro preavviso (12 ore): invariato, e quel periodo non dice nulla per loro');
    app.periods.save({ name: 'Last minute', from: '2027-01-08', to: '2027-01-08', mode: 'normal', noticeB2c: '0', noticeB2b: '0' }, null, NOW);
    assert.deepEqual(slots('2027-01-08', 'b2c'), ['09:30', '14:30']);
  } finally {
    app.cleanup();
  }
});

// ───────────── le condizioni di annullo del periodo ─────────────
const rowsOf = (...rows) => [0, 1, 2].map((i) => ({ value: rows[i]?.[0] ?? '', unit: rows[i]?.[1] ?? 'd', refund: rows[i]?.[2] ?? '' }));

test('annullo del periodo: righe come nel modulo del partner; vuote = come il sito; errori con il nome del campo; da solo basta a rendere utile il periodo', () => {
  const dates = { name: 'Natale', from: '2027-12-20', to: '2028-01-06', mode: 'normal' };
  const ok = (input) => {
    const r = normalizePeriod({ ...dates, ...input });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    return r.values;
  };
  const bad = (input) => {
    const r = normalizePeriod({ ...dates, ...input });
    assert.equal(r.ok, false);
    return r.errors;
  };
  const v = ok({ cancelB2c: rowsOf([7, 'd', 100]), cancelB2b: rowsOf([14, 'd', 100], [7, 'd', 50]), cancelPartners: true });
  assert.deepEqual(v.cancelB2c, [{ hours: 168, refund: 100 }]);
  assert.deepEqual(v.cancelB2b, [{ hours: 336, refund: 100 }, { hours: 168, refund: 50 }]);
  assert.equal(v.cancelPartners, true);
  assert.deepEqual(ok({ cancelB2c: rowsOf([36, 'h', 100]) }).cancelB2c, [{ hours: 36, refund: 100 }], 'anche in ore');
  assert.equal(ok({ cancelB2c: rowsOf([7, 'd', 100]), cancelB2b: rowsOf() }).cancelB2b, null, 'righe vuote: come il sito');
  assert.equal(ok({ cancelB2b: rowsOf([7, 'd', 100]), cancelPartners: false }).cancelPartners, false);
  assert.equal(ok({ cancelB2c: rowsOf([7, 'd', 100]), cancelPartners: true }).cancelPartners, false, '«anche per i partner» ha senso solo con un annullo per le agenzie');
  assert.deepEqual(ok({ cancelB2b: rowsOf([14, 'd', 50], [7, 'd', 50]) }).cancelB2b, [{ hours: 168, refund: 50 }], 'due 50% di fila diventano uno solo');
  // errori
  assert.match(bad({ cancelB2c: rowsOf([7, 'd', '']) }).cancelB2c, /Annullo dei privati: Controlla le ore/);
  assert.match(bad({ cancelB2b: rowsOf([14, 'd', 40], [7, 'd', 60]) }).cancelB2b, /Annullo delle agenzie: Il rimborso non può aumentare/);
  assert.match(bad({ cancelB2b: rowsOf([7, 'd', 120]) }).cancelB2b, /percentuale intera da 0 a 100/);
  assert.match(bad({ cancelB2c: rowsOf([7, 'd', 100], [7, 'd', 50]) }).cancelB2c, /stesso preavviso/);
  assert.match(bad({ cancelB2c: rowsOf([100, 'd', 100]) }).cancelB2c, /da 0 a 2000/, 'oltre 2000 ore non si può');
  assert.match(bad({}).mode, /non cambia nessuna regola/, 'senza nessuna regola il periodo è inutile');
  assert.match(bad({ cancelB2c: rowsOf() }).mode, /condizioni di annullo particolari/, 'righe vuote non sono una regola');
});

test('annullo del periodo: si salva, si rilegge, e la riga di riepilogo lo racconta (anche per chi ha condizioni proprie)', () => {
  const app = makeApp();
  try {
    const saved = app.periods.save({ name: 'Natale', from: '2027-12-20', to: '2028-01-06', mode: 'off', cancelB2c: rowsOf([7, 'd', 100]), cancelB2b: rowsOf([14, 'd', 100], [7, 'd', 50]), cancelPartners: true }, null, NOW);
    assert.equal(saved.ok, true);
    const p = app.periods.list()[0];
    assert.deepEqual(p.cancelB2c, [{ hours: 168, refund: 100 }]);
    assert.deepEqual(p.cancelB2b.map((t) => t.refund), [100, 50]);
    assert.equal(p.cancelPartners, true);
    assert.equal(rulesText(p), 'niente opzioni (le agenzie prenotano direttamente) · annullo dei privati: 100% fino a 7 giorni prima, poi nulla · annullo delle agenzie: 100% fino a 14 giorni prima, 50% fino a 7 giorni prima, poi nulla (anche per chi ha condizioni proprie)');
    // si cambia e si toglie
    assert.equal(app.periods.save({ name: 'Natale', from: '2027-12-20', to: '2028-01-06', mode: 'off', cancelB2c: rowsOf(), cancelB2b: rowsOf([48, 'h', 100]) }, p.id).ok, true);
    const q = app.periods.list()[0];
    assert.equal(q.cancelB2c, null);
    assert.deepEqual(q.cancelB2b, [{ hours: 48, refund: 100 }]);
    assert.equal(q.cancelPartners, false);
    assert.equal(rulesText(q), 'niente opzioni (le agenzie prenotano direttamente) · annullo delle agenzie: 100% fino a 2 giorni prima, poi nulla');
  } finally {
    app.cleanup();
  }
});

test('politica in vigore: nel periodo valgono le condizioni del periodo; i privati scavalcano anche il termine del tour; i partner con condizioni proprie le tengono, salvo che il periodo dica di no', () => {
  const app = makeApp();
  try {
    app.periods.save({ name: 'Natale', from: '2027-02-04', to: '2027-02-16', mode: 'normal', cancelB2c: rowsOf([7, 'd', 100]), cancelB2b: rowsOf([14, 'd', 100], [7, 'd', 50]) }, null, NOW);
    const shared = app.content.tour('shared');
    const halfDay = app.content.tour('half-day'); // termine proprio: 72 ore
    const free = addAccount(app.db, { email: 'free@example.com' });
    const own = addAccount(app.db, { email: 'own@example.com', cancel_policy_json: JSON.stringify([{ hours: 24, refund: 100 }]) });
    const inside = '2027-02-10';
    const outside = '2027-02-24';
    const h = (tiers) => tiers.map((t) => `${t.refund}@${t.hours}`).join(' ');
    // privati
    assert.equal(h(policyFor(app.cfg, shared, 'b2c', null, inside)), '100@168');
    assert.equal(h(policyFor(app.cfg, halfDay, 'b2c', null, inside)), '100@168', 'il periodo vince sul termine del tour');
    assert.equal(h(policyFor(app.cfg, shared, 'b2c', null, outside)), `100@${app.cfg.policy.b2cFreeCancelHours}`, 'fuori dal periodo, come sempre');
    assert.equal(h(policyFor(app.cfg, halfDay, 'b2c', null, outside)), '100@72');
    assert.equal(h(policyFor(app.cfg, shared, 'b2c', null)), `100@${app.cfg.policy.b2cFreeCancelHours}`, 'senza data nessun periodo');
    // agenzie
    assert.equal(h(policyFor(app.cfg, shared, 'b2b', free, inside)), '100@336 50@168');
    assert.equal(h(policyFor(app.cfg, shared, 'b2b', free, outside)), `100@${app.cfg.policy.b2bFreeCancelHours}`);
    assert.equal(h(policyFor(app.cfg, shared, 'b2b', own, inside)), '100@24', 'chi ha condizioni proprie le tiene');
    assert.equal(cancelPeriodFor(app.cfg, shared, 'b2b', own, inside), null);
    assert.equal(cancelPeriodFor(app.cfg, shared, 'b2b', free, inside).name, 'Natale');
    assert.equal(cancelPeriodFor(app.cfg, shared, 'b2c', null, inside).name, 'Natale');
    assert.equal(cancelPeriodFor(app.cfg, shared, 'b2c', null, outside), null);
    const p = app.periods.list()[0];
    app.periods.save({ name: 'Natale', from: p.from, to: p.to, mode: 'normal', cancelB2c: rowsOf([7, 'd', 100]), cancelB2b: rowsOf([14, 'd', 100], [7, 'd', 50]), cancelPartners: true }, p.id);
    assert.equal(h(policyFor(app.cfg, shared, 'b2b', own, inside)), '100@336 50@168', 'con «anche per chi ha condizioni proprie» valgono per tutti');
    assert.equal(cancelPeriodFor(app.cfg, shared, 'b2b', own, inside).name, 'Natale');
    // un periodo senza annullo non cambia nulla
    app.periods.save({ name: 'Solo preavviso', from: '2027-03-01', to: '2027-03-10', mode: 'normal', noticeB2c: '72' });
    assert.equal(h(policyFor(app.cfg, shared, 'b2c', null, '2027-03-05')), `100@${app.cfg.policy.b2cFreeCancelHours}`);
  } finally {
    app.cleanup();
  }
});

test('prenotare in un periodo con annullo particolare: la prenotazione conserva le condizioni del periodo; spostare la data non le cambia', () => {
  const { app, acct } = setup();
  try {
    app.periods.save({ name: 'Natale', from: '2027-02-04', to: '2027-02-16', mode: 'normal', cancelB2c: rowsOf([7, 'd', 100]), cancelB2b: rowsOf([14, 'd', 100], [7, 'd', 50]) }, null, NOW);
    const priv = createBooking(app, base({ tourSlug: 'shared', date: '2027-02-10', time: '09:30', pax: 2, paymentMethod: 'card' }), NOW);
    assert.deepEqual(JSON.parse(priv.cancel_policy_json ?? 'null') ?? [{ hours: 168, refund: 100 }], [{ hours: 168, refund: 100 }]);
    assert.equal(Date.parse(priv.free_cancel_until), localToInstant('2027-02-10', '09:30') - 168 * HOUR, 'gratis fino a 7 giorni prima');
    const outsidePriv = createBooking(app, base({ tourSlug: 'shared', date: '2027-02-24', time: '09:30', pax: 2, paymentMethod: 'card', email: 'altro@example.com' }), NOW);
    assert.equal(Date.parse(outsidePriv.free_cancel_until), localToInstant('2027-02-24', '09:30') - app.cfg.policy.b2cFreeCancelHours * HOUR, 'fuori dal periodo il termine di sempre');
    // agenzia (senza data lontana): due scaglioni
    app.cfg.options.firmEnabled = false;
    const ag = createBooking(app, base({ tourSlug: 'shared-agenzie', date: '2027-02-10', time: '14:30', pax: 2, channel: 'b2b', account: acct, paymentMethod: 'invoice' }), NOW);
    assert.deepEqual(JSON.parse(ag.cancel_policy_json).map((t) => [t.hours, t.refund]), [[336, 100], [168, 50]]);
    assert.equal(cancellationState(ag, localToInstant('2027-01-20', '14:30')).percent, 100);
    assert.equal(cancellationState(ag, localToInstant('2027-02-01', '14:30')).percent, 50);
    assert.equal(cancellationState(ag, localToInstant('2027-02-05', '14:30')).percent, 0);
    // se il periodo cambia dopo, la prenotazione già fatta tiene ciò che era stato accettato
    const pid = app.periods.list()[0].id;
    app.periods.save({ name: 'Natale', from: '2027-02-04', to: '2027-02-16', mode: 'normal', cancelB2b: rowsOf([30, 'd', 100]) }, pid);
    assert.deepEqual(JSON.parse(getBooking(app.db, ag.id).cancel_policy_json).map((t) => t.hours), [336, 168]);
  } finally {
    app.cleanup();
  }
});
