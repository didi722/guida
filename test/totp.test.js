// Codici a tempo dell'accesso a due passaggi: i vettori di prova delle norme (RFC 4226, 6238 e 4648), la finestra di tolleranza, l'uso unico e i codici di emergenza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_COUNT, base32Decode, base32Encode, generateRecoveryCodes, generateSecret, groupKey, hashRecovery, hotp, looksLikeRecovery, normalizeRecovery, otpauthUri, showRecovery, stepOf, totp, verifyTotp } from '../server/totp.js';

const KEY = Buffer.from('12345678901234567890'); // la chiave delle appendici delle RFC

test('HOTP: i vettori della RFC 4226 (appendice D)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  assert.deepEqual(expected.map((_, counter) => hotp(KEY, counter)), expected);
});

test('TOTP: i vettori della RFC 6238 (appendice B, SHA-1, 8 cifre)', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [seconds, code] of vectors) assert.equal(totp(KEY, seconds * 1000, { digits: 8 }), code, `a ${seconds} s`);
  // a 6 cifre sono le ultime sei di quelle a 8: è quello che le app mostrano
  assert.equal(totp(KEY, 59_000), '287082');
  assert.equal(stepOf(59_000), 1);
  assert.equal(stepOf(60_000), 2);
});

test('base32: i vettori della RFC 4648 (senza riempimento), lettura tollerante e rifiuto dei caratteri strani', () => {
  const vectors = [['', ''], ['f', 'MY'], ['fo', 'MZXQ'], ['foo', 'MZXW6'], ['foob', 'MZXW6YQ'], ['fooba', 'MZXW6YTB'], ['foobar', 'MZXW6YTBOI']];
  for (const [text, b32] of vectors) {
    assert.equal(base32Encode(Buffer.from(text)), b32);
    if (text) assert.equal(base32Decode(b32).toString(), text);
  }
  assert.equal(base32Decode('mzxw 6ytb-oi==').toString(), 'foobar', 'minuscole, spazi, trattini e «=» si ignorano');
  assert.equal(base32Decode('MZXW1'), null, 'l’«1» non esiste in base32');
  assert.equal(base32Decode(''), null);
  assert.equal(base32Decode(null), null);
  const secret = generateSecret();
  assert.equal(secret.length, 20, '160 bit');
  assert.deepEqual(base32Decode(base32Encode(secret)), secret);
  assert.notDeepEqual(generateSecret(), generateSecret());
});

test('verifica: vale il periodo in corso e quello accanto, non gli altri; un codice vale una volta sola', () => {
  const now = 1_800_000_000_000;
  const step = stepOf(now);
  const at = (n) => hotp(KEY, step + n);
  assert.deepEqual(verifyTotp(KEY, at(0), now), { ok: true, step });
  assert.deepEqual(verifyTotp(KEY, at(-1), now), { ok: true, step: step - 1 }, 'orologio del telefono un po’ indietro');
  assert.deepEqual(verifyTotp(KEY, at(1), now), { ok: true, step: step + 1 }, 'o un po’ avanti');
  assert.equal(verifyTotp(KEY, at(-2), now).ok, false);
  assert.equal(verifyTotp(KEY, at(2), now).ok, false);
  assert.equal(verifyTotp(KEY, at(0), now, { window: 0 }).ok, true);
  assert.equal(verifyTotp(KEY, at(1), now, { window: 0 }).ok, false);
  // uso unico: dopo aver accettato il periodo N non vale più nulla fino al periodo N compreso
  assert.equal(verifyTotp(KEY, at(0), now, { after: step }).ok, false, 'lo stesso codice due volte');
  assert.equal(verifyTotp(KEY, at(-1), now, { after: step }).ok, false, 'e nemmeno uno più vecchio');
  assert.deepEqual(verifyTotp(KEY, at(1), now, { after: step }), { ok: true, step: step + 1 }, 'il successivo sì');
  // forma del codice
  assert.equal(verifyTotp(KEY, ` ${at(0).slice(0, 3)} ${at(0).slice(3)} `, now).ok, true, 'gli spazi si ignorano («123 456»)');
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, 123456789]) assert.equal(verifyTotp(KEY, bad, now).ok, false, String(bad));
  assert.equal(verifyTotp(KEY, '000000', now).ok === (at(0) === '000000' || at(-1) === '000000' || at(1) === '000000'), true);
});

test('indirizzo otpauth: i parametri che le app si aspettano, etichetta con spazi e chiocciola', () => {
  const secret = Buffer.from('12345678901234567890');
  const uri = otpauthUri({ secret, account: 'Pannello@www.example.it', issuer: 'Davide Tomio' });
  assert.match(uri, /^otpauth:\/\/totp\/Davide%20Tomio:Pannello%40www\.example\.it\?/);
  const url = new URL(uri);
  assert.equal(url.hostname, 'totp');
  assert.equal(url.searchParams.get('secret'), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(url.searchParams.get('issuer'), 'Davide Tomio');
  assert.equal(url.searchParams.get('algorithm'), 'SHA1');
  assert.equal(url.searchParams.get('digits'), '6');
  assert.equal(url.searchParams.get('period'), '30');
  assert.doesNotMatch(uri, /\+/, 'gli spazi sono %20, non «+»: alcune app non li capiscono');
  assert.equal(groupKey(secret), 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
});

test('codici di emergenza: forma, unicità, lettura tollerante e impronta con sale', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, RECOVERY_COUNT);
  assert.equal(new Set(codes).size, RECOVERY_COUNT);
  for (const c of codes) {
    assert.match(c, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/, 'niente 0/O e 1/I che si confondono');
    assert.equal(looksLikeRecovery(c), true);
    assert.match(showRecovery(c), /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  }
  const code = codes[0];
  const shown = showRecovery(code);
  for (const typed of [shown, shown.toLowerCase(), ` ${shown.replace('-', ' ')} `, code]) assert.equal(normalizeRecovery(typed), code);
  for (const bad of ['', '123456', 'ABCDE-FGHJ', 'ABCDE-FGHJKL', 'ABCDE-FGHJ0', 'ABCDE-FGHJI', null]) assert.equal(looksLikeRecovery(bad), false, String(bad));
  // l'impronta: stessa per lo stesso codice e sale, diversa col sale diverso, e non contiene il codice
  const a = hashRecovery(shown, 'sale-uno');
  assert.equal(a, hashRecovery(shown.toLowerCase(), 'sale-uno'));
  assert.notEqual(a, hashRecovery(shown, 'sale-due'));
  assert.notEqual(a, hashRecovery(codes[1], 'sale-uno'));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.toUpperCase().includes(code));
});
