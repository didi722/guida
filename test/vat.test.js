// Partita IVA delle agenzie: lettura del numero, controllo formale per paese (con la cifra di controllo italiana), servizio VIES (risposte simulate),
// confronto del nome e salvataggio dell'esito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormat, createVies, formalSummary, parseVat, sameCompany, vatLabel, vatWithoutPrefix } from '../server/vat.js';
import { addAccount, makeApp, NOW } from './helpers.js';

test('lettura del numero: con o senza prefisso, con spazi e simboli, e il paese scelto nel modulo quando manca', () => {
  const p = (raw, hint) => {
    const r = parseVat(raw, hint);
    return [r.id, r.country, r.number, r.eu];
  };
  assert.deepEqual(p('IT 012.345.678-97'), ['IT01234567897', 'IT', '01234567897', true]);
  assert.deepEqual(p('it01234567897', 'DE'), ['IT01234567897', 'IT', '01234567897', true], 'il prefisso scritto vale più del paese scelto');
  assert.deepEqual(p('01234567897', 'IT'), ['IT01234567897', 'IT', '01234567897', true], 'senza prefisso vale il paese scelto');
  assert.deepEqual(p('01234567897', 'it'), ['IT01234567897', 'IT', '01234567897', true]);
  assert.deepEqual(p('DE 123 456 789'), ['DE123456789', 'DE', '123456789', true]);
  assert.deepEqual(p('B12345678', 'ES'), ['ESB12345678', 'ES', 'B12345678', true], 'un NIF spagnolo senza prefisso');
  assert.deepEqual(p('123456789', 'GR'), ['EL123456789', 'EL', '123456789', true], 'la Grecia usa EL');
  assert.deepEqual(p('EL123456789'), ['EL123456789', 'EL', '123456789', true]);
  assert.deepEqual(p('XI123456789'), ['XI123456789', 'XI', '123456789', true], 'Irlanda del Nord');
  assert.deepEqual(p('IE6388047V'), ['IE6388047V', 'IE', '6388047V', true]);
  assert.deepEqual(p('NL123456789B01'), ['NL123456789B01', 'NL', '123456789B01', true]);
  // prefisso giusto ma il resto non torna: si dice di quale paese è, il controllo formale dirà che non va
  assert.deepEqual(p('IT0123456789', 'IT'), ['IT0123456789', 'IT', '0123456789', true]);
  // fuori dall'UE o sconosciuto
  assert.deepEqual(p('123456789', 'US'), ['123456789', null, '123456789', false]);
  assert.deepEqual(p('GB123456789', 'GB'), ['GB123456789', null, 'GB123456789', false], 'il Regno Unito non è in VIES');
  assert.deepEqual(p('CHE-123.456.789 MWST', 'CH'), ['CHE123456789MWST', null, 'CHE123456789MWST', false]);
  assert.deepEqual(p('', 'IT'), ['', 'IT', '', true]);
  assert.deepEqual(p(null, ''), ['', null, '', false]);
});

test('controllo formale: l’Italia con la cifra di controllo, gli altri paesi con la loro forma; fuori dall’UE non si può dire', () => {
  const f = (raw, hint) => checkFormat(parseVat(raw, hint));
  assert.deepEqual(f('IT12345678903'), { ok: true });
  assert.deepEqual(f('01234567897', 'IT'), { ok: true });
  assert.deepEqual(f('IT12345678901'), { ok: false, reason: 'checksum' }, '11 cifre ma la cifra di controllo non torna');
  assert.deepEqual(f('IT00000000000'), { ok: false, reason: 'checksum' }, 'tutti zeri: torna con il calcolo ma non esiste');
  assert.deepEqual(f('IT123'), { ok: false, reason: 'format' });
  assert.deepEqual(f('IT1234567890A'), { ok: false, reason: 'format' });
  const good = ['AT U12345678', 'BE 0123456789', 'BG 123456789', 'BG 1234567890', 'CY 12345678X', 'CZ 12345678', 'CZ 1234567890', 'DE 123456789', 'DK 12345678', 'EE 123456789', 'EL 123456789', 'ES B12345678', 'ES 12345678Z', 'FI 12345678', 'FR 40303265045', 'FR AB123456789', 'HR 12345678901', 'HU 12345678', 'IE 6388047V', 'IE 1A23456B', 'IE 1234567FA', 'LT 123456789', 'LT 123456789012', 'LU 12345678', 'LV 12345678901', 'MT 12345678', 'NL 123456789B01', 'PL 1234567890', 'PT 123456789', 'RO 12', 'RO 1234567890', 'SE 123456789001', 'SI 12345678', 'SK 1234567890', 'XI 123456789', 'XI GD123'];
  for (const v of good) assert.equal(f(v.replace(' ', '')).ok, true, v);
  const bad = ['AT 12345678', 'BE 2123456789', 'DE 12345678', 'DE 1234567890', 'DK 1234567', 'ES 123456789', 'FR 1234567890', 'HR 1234567890', 'NL 123456789B1', 'NL 123456789001', 'PL 123456789', 'PT 12345678', 'SE 12345678901', 'SI 1234567', 'SK 123456789'];
  for (const v of bad) assert.deepEqual(f(v.replace(' ', '')), { ok: false, reason: 'format' }, v);
  assert.deepEqual(f('123456789', 'US'), { ok: null, reason: 'unsupported' });
  assert.deepEqual(f('GB123456789', 'GB'), { ok: null, reason: 'unsupported' });
  assert.deepEqual(f('', ''), { ok: null, reason: 'unsupported' });
  // il riassunto per l'email alla guida, prima di VIES
  assert.deepEqual(formalSummary(parseVat('IT12345678901')), { name: '', address: '', sameName: null, status: 'format', label: 'Formato non valido', message: 'la cifra di controllo non torna' });
  assert.equal(formalSummary(parseVat('IT123')).message, 'formato non valido per il paese');
  assert.equal(formalSummary(parseVat('123456789', 'US')).status, 'unsupported');
  assert.equal(formalSummary(parseVat('IT12345678903')).status, null);
  assert.match(formalSummary(parseVat('IT12345678903')).label, /controllo su VIES parte a momenti/);
});

// ───────────── VIES, con risposte simulate ─────────────
/** Una fetch finta: risponde con le risposte indicate in ordine e ricorda le richieste. */
function fakeFetch(...replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers, body: init?.body ? JSON.parse(init.body) : null });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r(init);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

test('VIES: valida con nome e indirizzo (a capo e spazi ripuliti), non valida, e «---» vuol dire che il dato non c’è', async () => {
  const f = fakeFetch(
    { body: { countryCode: 'IT', vatNumber: '12345678903', valid: true, requestIdentifier: 'WAPIAAAAZ', name: 'ACME  S.R.L.', address: 'VIA ROMA 1\n30100 VENEZIA VE' } },
    { body: { valid: false, name: '---', address: '---' } },
    { body: { isValid: true, userError: 'VALID', name: '---', address: '---', requestIdentifier: '' } },
  );
  const vies = createVies({ fetchImpl: f });
  assert.deepEqual(await vies.check('IT', '12345678903'), { status: 'valid', name: 'ACME S.R.L.', address: 'VIA ROMA 1, 30100 VENEZIA VE', requestId: 'WAPIAAAAZ', message: '' });
  assert.deepEqual(await vies.check('IT', '12345678901'), { status: 'invalid', name: '', address: '', requestId: '', message: '' });
  assert.deepEqual(await vies.check('DE', '123456789'), { status: 'valid', name: '', address: '', requestId: '', message: '' }, 'valida ma il paese non dice a chi appartiene');
  // la richiesta: POST con i due dati nel corpo
  assert.equal(f.calls[0].url, 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number');
  assert.equal(f.calls[0].method, 'POST');
  assert.deepEqual(f.calls[0].body, { countryCode: 'IT', vatNumber: '12345678903' });
  assert.equal(f.calls[0].headers['content-type'], 'application/json');
  assert.equal(f.calls[0].headers.accept, 'application/json');
});

test('VIES: guasti e risposte strane sono «non verificata», mai «non valida»', async () => {
  const check = async (reply, opts) => (await createVies({ fetchImpl: fakeFetch(reply), ...opts }).check('IT', '12345678903'));
  assert.deepEqual([(await check({ status: 500, body: 'boom' })).status, (await check({ status: 503, body: {} })).status, (await check({ status: 429, body: {} })).status], ['unavailable', 'unavailable', 'unavailable']);
  for (const code of ['MS_UNAVAILABLE', 'MS_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ', 'SERVICE_UNAVAILABLE', 'TIMEOUT']) {
    const r = await check({ body: { userError: code } });
    assert.equal(r.status, 'unavailable', code);
    assert.match(r.message, new RegExp(code));
  }
  assert.equal((await check({ body: { errorWrappers: [{ error: 'MS_UNAVAILABLE' }], actionSucceed: false } })).status, 'unavailable');
  assert.equal((await check({ body: { actionSucceed: false } })).status, 'unavailable');
  assert.equal((await check({ body: 'non è json' })).status, 'unavailable');
  assert.equal((await check({ body: {} })).status, 'unavailable', 'una risposta senza esito');
  assert.equal((await check({ body: { userError: 'INVALID_INPUT' } })).status, 'invalid', 'il servizio rifiuta il numero');
  assert.equal((await check({ body: { userError: 'INVALID', valid: false } })).status, 'invalid');
  // rete assente e attesa troppo lunga
  const down = await createVies({ fetchImpl: fakeFetch(new TypeError('fetch failed')) }).check('IT', '12345678903');
  assert.deepEqual([down.status, down.message], ['unavailable', 'servizio non raggiungibile']);
  const keepAlive = setTimeout(() => {}, 2000); // il timer di AbortSignal.timeout non tiene vivo il processo
  const slow = await createVies({ timeoutMs: 20, fetchImpl: (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))) }).check('IT', '12345678903');
  clearTimeout(keepAlive);
  assert.deepEqual([slow.status, slow.message], ['unavailable', 'il servizio non ha risposto in tempo']);
});

test('VIES: se l’indirizzo nuovo non c’è (404/405/415) si prova quello più vecchio, che risponde con altri nomi', async () => {
  const f = fakeFetch({ status: 404, body: {} }, { body: { isValid: true, userError: 'VALID', name: 'ACME SRL', address: 'VENEZIA', requestIdentifier: 'X1' } });
  const r = await createVies({ fetchImpl: f }).check('EL', '123456789');
  assert.equal(r.status, 'valid');
  assert.equal(r.name, 'ACME SRL');
  assert.equal(f.calls[1].url, 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/EL/vat/123456789');
  assert.equal(f.calls[1].method, 'GET');
  assert.equal(f.calls.length, 2);
  // il 500 non fa cambiare strada
  const g = fakeFetch({ status: 500, body: {} });
  await createVies({ fetchImpl: g }).check('IT', '12345678903');
  assert.equal(g.calls.length, 1);
});

test('il nome scritto dall’agenzia e quello del registro: bastano una o più parole importanti in comune', () => {
  assert.equal(sameCompany('Venice DMC S.r.l.', 'VENICE DMC SRL'), true);
  assert.equal(sameCompany('Lagoon DMC', 'LAGOON DESTINATION MANAGEMENT COMPANY SRL'), true);
  assert.equal(sameCompany('Viaggi Serenissima', 'AGENZIA VIAGGI LA SERENISSIMA DI ROSSI MARIO'), true);
  assert.equal(sameCompany('Café Müller GmbH', 'CAFE MULLER GMBH'), true, 'accenti e maiuscole non contano');
  assert.equal(sameCompany('Venice DMC', 'TRATTORIA DA GIGI SNC'), false);
  assert.equal(sameCompany('S.r.l.', 'ACME SRL'), false, 'una sola sigla legale non basta');
  assert.equal(sameCompany('Venice DMC', ''), null, 'il registro non dice il nome: non si può confrontare');
  assert.equal(sameCompany('Venice DMC', '---'), null);
  assert.equal(sameCompany('Venice DMC', 'DMC'), true, 'anche una sigla di tre lettere basta, se coincide');
});

// ───────────── il servizio, con il database ─────────────
test('verifica e salvataggio: formato e paese fuori dall’UE si dicono senza rete, il resto passa da VIES; l’esito resta sull’account', async (t) => {
  const f = fakeFetch(
    { body: { valid: true, name: 'VENICE DMC SRL', address: 'CALLE 1, VENEZIA' } },
    { body: { valid: false } },
    { body: { userError: 'MS_UNAVAILABLE' } },
  );
  const app = makeApp({}, { fetchImpl: f });
  t.after(app.cleanup);
  const mk = (over) => addAccount(app.db, { company: 'Venice DMC S.r.l.', ...over });
  const ok = mk({ email: 'a@x.it', vat: 'IT12345678903', country: 'IT' });
  const r1 = await app.vat.verify(ok.id, { nowMs: NOW });
  assert.deepEqual([r1.status, r1.label, r1.name, r1.address, r1.sameName, r1.id], ['valid', 'Valida', 'VENICE DMC SRL', 'CALLE 1, VENEZIA', true, 'IT12345678903']);
  const row = () => app.db.prepare('SELECT vat_status, vat_checked_at, vat_name, vat_address FROM accounts WHERE id = ?');
  assert.deepEqual({ ...row().get(ok.id) }, { vat_status: 'valid', vat_checked_at: new Date(NOW).toISOString(), vat_name: 'VENICE DMC SRL', vat_address: 'CALLE 1, VENEZIA' });
  assert.deepEqual(app.vat.summary(app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(ok.id)), { status: 'valid', label: 'Valida', checkedAt: new Date(NOW).toISOString(), name: 'VENICE DMC SRL', address: 'CALLE 1, VENEZIA', sameName: true });

  const bad = mk({ email: 'b@x.it', vat: '12345678901', country: 'IT' });
  assert.equal((await app.vat.verify(bad.id, { nowMs: NOW })).status, 'format', 'cifra di controllo sbagliata: nessuna chiamata');
  assert.equal(f.calls.length, 1);
  const us = mk({ email: 'c@x.com', vat: '12-3456789', country: 'US' });
  const rus = await app.vat.verify(us.id, { nowMs: NOW });
  assert.deepEqual([rus.status, rus.message], ['unsupported', 'paese fuori dall’UE: il servizio VIES non lo copre']);
  assert.equal(f.calls.length, 1, 'neanche per il paese fuori dall’UE');

  const invalid = mk({ email: 'd@x.de', vat: 'DE123456789', country: 'DE' });
  assert.equal((await app.vat.verify(invalid.id, { nowMs: NOW })).status, 'invalid');
  const down = mk({ email: 'e@x.fr', vat: 'FR40303265045', country: 'FR' });
  assert.equal((await app.vat.verify(down.id, { nowMs: NOW })).status, 'unavailable');
  assert.deepEqual(f.calls.map((c) => c.body), [{ countryCode: 'IT', vatNumber: '12345678903' }, { countryCode: 'DE', vatNumber: '123456789' }, { countryCode: 'FR', vatNumber: '40303265045' }]);
  // un nome diverso da quello del registro si vede
  const g = fakeFetch({ body: { valid: true, name: 'VENICE DMC SRL', address: 'VENEZIA' } });
  const app2 = makeApp({}, { fetchImpl: g });
  t.after(app2.cleanup);
  const other = addAccount(app2.db, { email: 'f@x.it', company: 'Trattoria Da Gigi', vat: 'IT12345678903', country: 'IT' });
  assert.equal((await app2.vat.verify(other.id, { nowMs: NOW })).sameName, false);
  // un account che non c'è non rompe nulla
  assert.equal((await app.vat.verify(9999)).status, 'unavailable');
  // senza stato salvato
  assert.deepEqual(app.vat.summary({ company: 'X', vat_status: null }), { status: null, label: 'Non ancora verificata', checkedAt: null, name: '', address: '', sameName: null });
});

test('lavoro periodico: controlla poche agenzie per volta, le nuove o da approvare; riprova dopo un’ora quelle senza risposta; lascia stare le vecchie', async (t) => {
  const f = fakeFetch(
    { body: { valid: true, name: 'A SRL' } }, { body: { valid: true, name: 'B SRL' } }, { body: { valid: true, name: 'C SRL' } },
    { body: { valid: true, name: 'D SRL' } },
    { body: { userError: 'MS_UNAVAILABLE' } },
    { body: { valid: true, name: 'E SRL' } },
  );
  const app = makeApp({}, { fetchImpl: f });
  t.after(app.cleanup);
  const iso = (ms) => new Date(ms).toISOString();
  const mk = (n, over = {}) => addAccount(app.db, { email: `a${n}@x.it`, company: `${String.fromCharCode(64 + n)} srl`, vat: 'IT12345678903', country: 'IT', ...over });
  const fresh = [1, 2, 3, 4].map((n) => mk(n, { status: 'pending', created_at: iso(NOW) }));
  const old = mk(5, { status: 'approved', created_at: iso(NOW - 30 * 86400_000) }); // registrata da un mese: non si tocca
  const noVat = mk(6, { status: 'pending', vat: '' });
  assert.equal(await app.vat.sweep(NOW), 3, 'tre alla volta');
  assert.deepEqual(fresh.map((a) => app.db.prepare('SELECT vat_status FROM accounts WHERE id = ?').get(a.id).vat_status), ['valid', 'valid', 'valid', null]);
  assert.equal(await app.vat.sweep(NOW + 60_000), 1);
  assert.equal(await app.vat.sweep(NOW + 120_000), 0, 'finito');
  assert.equal(app.db.prepare('SELECT vat_status FROM accounts WHERE id = ?').get(old.id).vat_status, null);
  assert.equal(app.db.prepare('SELECT vat_status FROM accounts WHERE id = ?').get(noVat.id).vat_status, null);
  // «non verificata»: si riprova solo dopo un'ora
  const late = mk(7, { email: 'late@x.it', status: 'pending', created_at: iso(NOW) });
  assert.equal(await app.vat.sweep(NOW + 180_000), 1);
  assert.equal(app.db.prepare('SELECT vat_status FROM accounts WHERE id = ?').get(late.id).vat_status, 'unavailable');
  assert.equal(await app.vat.sweep(NOW + 180_000 + 30 * 60_000), 0, 'mezz’ora dopo ancora no');
  assert.equal(await app.vat.sweep(NOW + 180_000 + 61 * 60_000), 1, 'dopo un’ora sì');
  assert.equal(app.db.prepare('SELECT vat_status FROM accounts WHERE id = ?').get(late.id).vat_status, 'valid');
  // il giro periodico del sito (ogni minuto) lo include
  f.calls.length = 0;
  const g = fakeFetch({ body: { valid: true, name: 'H SRL' } });
  const app2 = makeApp({}, { fetchImpl: g });
  t.after(app2.cleanup);
  const h = addAccount(app2.db, { email: 'h@x.it', company: 'H srl', vat: 'IT12345678903', country: 'IT', status: 'pending' });
  await app2.runJobs(NOW);
  assert.equal(app2.db.prepare('SELECT vat_status FROM accounts WHERE id = ?').get(h.id).vat_status, 'valid');
});

test('fattura: la partita IVA dell’agenzia senza il prefisso del suo paese; per le pagine «paese numero» solo se manca il prefisso', () => {
  assert.equal(vatWithoutPrefix('IT12345678903', 'IT'), '12345678903');
  assert.equal(vatWithoutPrefix('it 123 456 789 03', 'IT'), '12345678903');
  assert.equal(vatWithoutPrefix('12345678903', 'IT'), '12345678903');
  assert.equal(vatWithoutPrefix('IT12345678903', ''), '12345678903', 'senza paese vale il vecchio comportamento (Italia)');
  assert.equal(vatWithoutPrefix('DE123456789', 'DE'), '123456789');
  assert.equal(vatWithoutPrefix('EL123456789', 'GR'), '123456789', 'la Grecia: paese GR, prefisso EL');
  assert.equal(vatWithoutPrefix('ESB12345678', 'ES'), 'B12345678');
  assert.equal(vatWithoutPrefix('DE123456789', 'AT'), 'DE123456789', 'il prefisso di un altro paese resta (lo vede chi prepara la fattura)');
  assert.equal(vatWithoutPrefix('DE12345', 'DE'), 'DE12345', 'se il resto non ha la forma del paese non si tocca');
  assert.equal(vatWithoutPrefix('CHE-123.456.789 MWST', 'CH'), 'CHE-123.456.789MWST');
  assert.equal(vatWithoutPrefix(null, 'IT'), '');
  assert.equal(vatLabel({ country: 'IT', vat: 'IT12345678903' }), 'IT12345678903');
  assert.equal(vatLabel({ country: 'IT', vat: '12345678903' }), 'IT 12345678903');
  assert.equal(vatLabel({ country: 'GR', vat: 'EL123456789' }), 'EL123456789');
  assert.equal(vatLabel({ country: 'US', vat: '12-3456789' }), 'US 12-3456789');
  assert.equal(vatLabel({ country: null, vat: null }), '');
});
