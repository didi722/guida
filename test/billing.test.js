// Dati di fatturazione dei partner, elenco dei paesi e telefono con prefisso: le regole, senza pagine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_LABEL, billingGaps, billingProblem, billingProblems, readBilling } from '../server/billing.js';
import { countries, countryName, dialOf, isCountry, normalizePhone, readPhone, splitPhone } from '../server/countries.js';
import { createBooking } from '../server/bookings.js';
import { describeSource } from '../server/invoices.js';
import { LANGS } from '../server/langs.js';
import { addAccount, base, BILLING_IT, makeApp, NOW } from './helpers.js';

const IT = { country: 'IT', tax_code: '12345678903', address: 'Fondamenta Nuove 10', zip: '30121', city: 'Venezia', province: 'VE', sdi_code: 'ABCDEFG', pec: '' };

test('dati di fatturazione italiani: servono indirizzo, CAP di 5 cifre, città, provincia, codice fiscale valido e SDI o PEC', () => {
  assert.deepEqual(billingProblems(IT), []);
  assert.equal(billingProblem(IT), null);
  assert.deepEqual(billingProblems({ ...IT, pec: 'amministrazione@pec.example.it', sdi_code: '' }), [], 'la PEC basta al posto dell’SDI');
  assert.deepEqual(billingProblems({ ...IT, address: '', zip: '3012', city: ' ', province: 'V', tax_code: '', sdi_code: '', pec: '' }), ['address', 'zip', 'city', 'province', 'taxCode', 'sdi']);
  assert.deepEqual(billingProblems({ ...IT, tax_code: '12345678901' }), ['taxCode'], 'cifra di controllo sbagliata');
  assert.deepEqual(billingProblems({ ...IT, tax_code: 'RSSMRA80A01H501U' }), [], 'un codice fiscale di persona va bene (ditta individuale)');
  assert.deepEqual(billingProblems({ ...IT, sdi_code: 'ABC', pec: '' }), ['sdi'], 'SDI di 7 caratteri');
  assert.deepEqual(billingProblems({ ...IT, pec: 'non-un-indirizzo' }), ['pec']);
  assert.ok(billingProblems({ ...IT, country: 'OTHER' }).includes('country'), 'paese sconosciuto (come nei partner registrati con il vecchio modulo)');
  assert.ok(billingProblems({ ...IT, country: '' }).includes('country'));
  assert.ok(Object.keys(BILLING_LABEL).every((k) => typeof BILLING_LABEL[k] === 'string'));
});

test('dati di fatturazione esteri: bastano indirizzo, codice postale (di qualsiasi forma) e città', () => {
  const de = { country: 'DE', tax_code: '', address: 'Unter den Linden 1', zip: '10115', city: 'Berlin', province: '', sdi_code: '', pec: '' };
  assert.deepEqual(billingProblems(de), []);
  assert.deepEqual(billingProblems({ ...de, zip: 'SW1A 1AA' }), [], 'codice postale britannico');
  assert.deepEqual(billingProblems({ ...de, zip: '' }), ['zip']);
  assert.deepEqual(billingProblems({ ...de, address: 'x' }), ['address']);
  assert.deepEqual(billingGaps({ ...de, country: 'US' }), []);
  assert.deepEqual(billingGaps({ company: 'Vecchia DMC', country: 'IT', address: 'Via Roma 1' }), ['zip', 'city', 'province', 'taxCode', 'sdi'], 'un partner registrato prima: mancano i dati nuovi');
});

test('lettura del modulo: maiuscole, spazi e lunghezze', () => {
  const v = readBilling({ country: ' it ', tax_code: '1234 5678 903', address: '  Via   Roma 1 ', zip: ' 30121 ', city: 'Venezia', province: 've', sdi_code: 'abcdefg', pec: ' Pec@Esempio.IT ' });
  assert.deepEqual(v, { country: 'IT', tax_code: '12345678903', address: 'Via   Roma 1', zip: '30121', city: 'Venezia', province: 'VE', sdi_code: 'ABCDEFG', pec: 'pec@esempio.it' }, 'spazi ai bordi tolti, maiuscole dove servono');
  assert.equal(readBilling({ province: 'VENEZIA' }).province.length, 3, 'la sigla è lunga al massimo tre caratteri (poi non passa il controllo)');
});

test('elenco dei paesi: in ordine alfabetico nella lingua, con bandiera e prefisso; ci sono tutti i paesi che servono', () => {
  for (const lang of LANGS) {
    const list = countries(lang);
    assert.ok(list.length > 230, lang);
    const names = list.map((c) => c.name);
    assert.deepEqual(names, [...names].sort(new Intl.Collator(lang).compare), `ordine alfabetico in ${lang}`);
    assert.equal(new Set(list.map((c) => c.code)).size, list.length, 'nessun duplicato');
    assert.ok(list.every((c) => /^[A-Z]{2}$/.test(c.code) && c.flag.length === 4 && c.dial && c.name), 'tutti con bandiera (due simboli), prefisso e nome');
  }
  assert.equal(countryName('IT', 'it'), 'Italia');
  assert.equal(countryName('IT', 'en'), 'Italy');
  assert.equal(countryName('DE', 'es'), 'Alemania');
  assert.equal(countryName('JP', 'ja'), '日本');
  assert.equal(countries('it').find((c) => c.code === 'IT').flag, '🇮🇹');
  assert.equal(countries('it').find((c) => c.code === 'HK').name, 'Hong Kong', 'i nomi lunghissimi sono accorciati');
  assert.ok(isCountry('xk') && isCountry('US') && !isCountry('OTHER') && !isCountry('') && !isCountry('AQ'));
  // la ricerca trova il paese con il nome in qualsiasi lingua, con la sigla, con il prefisso
  const find = (q) => countries('it').filter((c) => c.search.includes(q)).map((c) => c.code);
  assert.ok(find('germany').includes('DE') && find('germania').includes('DE') && find('alemania').includes('DE'));
  assert.ok(find('usa').includes('US') && find('uk').includes('GB') && find('stati uniti').includes('US'));
  assert.ok(find('+39').includes('IT'));
  assert.ok(find('cote d').includes('CI'), 'senza accenti');
});

test('telefono: il prefisso è obbligatorio, si capisce «+39», «0039» e il paese scelto; lo zero dei prefissi urbani cade dove deve', () => {
  const ok = (input, cc = '') => normalizePhone(input, cc);
  assert.equal(ok('333 123 4567', 'IT').value, '+39 3331234567');
  assert.equal(ok('+39 333 123 4567').value, '+39 3331234567');
  assert.equal(ok('0039 333-123-4567').value, '+39 3331234567');
  assert.equal(ok('06 1234567', 'IT').value, '+39 061234567', 'in Italia lo zero fa parte del numero');
  assert.equal(ok('+39 06 1234567').value, '+39 061234567');
  assert.equal(ok('07911 123456', 'GB').value, '+44 7911123456', 'nel Regno Unito lo zero si toglie');
  assert.equal(ok('+44 (0)7911 123456').value, '+44 7911123456');
  assert.equal(ok('+1 212 555 0100').value, '+1 2125550100');
  assert.equal(ok('+1 876 555 1234').value, '+1 876 5551234', 'Giamaica: numero d’area del +1');
  assert.equal(ok('555 1234', 'JM').value, '+1 876 5551234');
  assert.equal(ok('+81 90 1234 5678').value, '+81 9012345678');
  assert.equal(ok('393331234567', 'IT').value, '+39 3331234567', 'il 39 c’era già (12 cifre)');
  assert.equal(ok('+39 333 1234567', 'DE').value, '+39 3331234567', 'se è scritto per esteso conta il prefisso scritto, non il paese scelto');
  assert.deepEqual(ok('  '), { empty: true });
  assert.deepEqual(ok(''), { empty: true });
  assert.deepEqual(ok('333 1234567'), { error: 'prefix' }, 'senza prefisso e senza paese');
  assert.deepEqual(ok('333 1234567', 'XX'), { error: 'prefix' });
  assert.deepEqual(ok('+999 1234567'), { error: 'prefix' }, 'prefisso che non esiste');
  assert.deepEqual(ok('12', 'IT'), { error: 'invalid' }, 'troppo corto');
  assert.deepEqual(ok('1234567890123456', 'IT'), { error: 'invalid' }, 'più di 15 cifre in tutto');
  assert.equal(ok('abc', 'IT').error, 'invalid');
  // dal modulo: numero e paese scelto
  assert.equal(readPhone({ phone: '333 1234567', phone_cc: 'it' }).value, '+39 3331234567');
  assert.deepEqual(readPhone({ phone: '' }), { empty: true });
  assert.equal(dialOf('it'), '39');
});

test('telefono salvato → modulo: si separano paese e numero; un numero vecchio senza prefisso resta com’è, con il paese di partenza', () => {
  assert.deepEqual(splitPhone('+39 3331234567'), { cc: 'IT', national: '3331234567' });
  assert.deepEqual(splitPhone('+44 7911123456'), { cc: 'GB', national: '7911123456' });
  assert.deepEqual(splitPhone('+1 876 5551234'), { cc: 'JM', national: '5551234' });
  assert.deepEqual(splitPhone('041 5201234', 'IT'), { cc: 'IT', national: '041 5201234' });
  assert.deepEqual(splitPhone('', 'DE'), { cc: 'DE', national: '' });
  assert.deepEqual(splitPhone('+999 12', 'IT'), { cc: 'IT', national: '+999 12' });
});

test('fattura a un partner: l’intestatario è già compilato con i dati della registrazione (CAP, città, provincia, codice fiscale, SDI)', () => {
  const app = makeApp({ site: { vatNumber: 'IT12345678903' } });
  try {
    const acct = addAccount(app.db, { vat: 'IT01234567897', country: 'IT', sdi_code: 'ABCDEFG', address: BILLING_IT.address, zip: BILLING_IT.zip, city: BILLING_IT.city, province: 'VE', tax_code: '01234567897', company: 'Venice DMC S.r.l.' });
    const b = createBooking(app, base({ tourSlug: 'shared-agenzie', date: '2027-01-12', time: '09:30', channel: 'b2b', account: acct, paymentMethod: 'invoice' }), NOW);
    const item = describeSource(app, 'booking', b.id);
    assert.deepEqual(
      { ...item.buyer, email: undefined, lang: undefined },
      { kind: 'company', name: 'Venice DMC S.r.l.', country: 'IT', vat: '01234567897', taxCode: '01234567897', address: 'Fondamenta Nuove 10', zip: '30121', city: 'Venezia', province: 'VE', sdiCode: 'ABCDEFG', pec: '', email: undefined, lang: undefined },
    );

    // un partner registrato prima: l'ultimo intestatario salvato riempie ciò che manca
    const old = addAccount(app.db, { email: 'old@example.com', company: 'Vecchia DMC', vat: 'IT01234567897', country: 'IT', address: 'Via Roma 1', zip: null, city: null, province: null, tax_code: null, sdi_code: null, billing_json: JSON.stringify({ zip: '35100', city: 'Padova', province: 'PD', taxCode: '01234567897', sdiCode: 'ZZZZZZZ' }) });
    const b2 = createBooking(app, base({ tourSlug: 'shared-agenzie', date: '2027-01-12', time: '14:30', channel: 'b2b', account: old, paymentMethod: 'invoice', email: 'old@example.com' }), NOW);
    const buyer = describeSource(app, 'booking', b2.id).buyer;
    assert.deepEqual([buyer.address, buyer.zip, buyer.city, buyer.province, buyer.taxCode, buyer.sdiCode], ['Via Roma 1', '35100', 'Padova', 'PD', '01234567897', 'ZZZZZZZ']);
    // …e i dati della registrazione, se ci sono, vincono su quelli vecchi
    app.db.prepare('UPDATE accounts SET zip = ?, city = ? WHERE id = ?').run('30121', 'Venezia', old.id);
    const fresh = describeSource(app, 'booking', b2.id).buyer;
    assert.deepEqual([fresh.zip, fresh.city, fresh.province], ['30121', 'Venezia', 'PD']);
  } finally {
    app.cleanup();
  }
});
