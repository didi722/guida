// Documenti per il cliente finale: profilo e logo dell'agenzia, prezzi del preventivo (tariffa + ricarico), voucher con logo e preventivo in PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocsError, LOGO_MAX_BYTES, brandOf, buildQuote, clientPrice, getLogo, parseLogo, parseMarkup, parseRound, readProfile, removeLogo, saveProfile, setLogo } from '../server/agencyDocs.js';
import { cancelBooking, createBooking } from '../server/bookings.js';
import { encodePng } from '../server/png.js';
import { renderQuotePdf } from '../server/pdf-quote.js';
import { renderVoucherPdf } from '../server/pdf.js';
import { addAccount, base, HAS_PDFTOTEXT, isPdf, makeApp, NOW, pdfPages, pdfText } from './helpers.js';

// un JPEG vero di 120×48 px (1,3 KB), fatto con Pillow
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAwAHgDASIAAhEBAxEB/8QAGwAAAwEAAwEAAAAAAAAAAAAAAAQGBQECAwf/xAA6EAAABAMEBwcBBgcAAAAAAAAAAQIDBAUREhYh0QYVMUFUVZM1UXSSo7LSExQiMjZhgiRSYnGBkaH/xAAZAQEBAQEBAQAAAAAAAAAAAAAAAgEDBAX/xAAnEQACAgADCAIDAAAAAAAAAAAAAQIRAxKhISIjMkFRUmETMTNxgf/aAAwDAQACEQMRAD8ArAAHz7RvRuFnMqeiHXnm3kuKbTZMrJfdIyMypjifeQ+TCCkm26o9bbTpH0EAiLmHDro6l6LbNVLcO6ltZFT+RZU24fi37ByjR7R40JU/GR0IaiI7MUZMn/YrSSI6b6VF/HDpLQnM+xbAExcaV8RGedPxBcaV8RGedPxE5cPy0NuXYpwCYuNK+IjPOn4guNK+IjPOn4hlw/LQXLsU4BMXGlfERnnT8QXGl8RGedPxDLh+WgqXYpwCYuNK+IjPOn4guNK+IjPOn4hlw/LQXLsU4BMXGlfERnnT8QXGlfERnnT8Qy4floLl2KcAmLjSviIzzp+ILjSviIzzp+IZcPy0Fy7FOATFxpXxEZ50/EZ8+0UgJbJn4xh6JU43ZoS1JMsVEW4v1GqEG6UtA5SW2i3AEpL2HAeGb9pAHJqnRSHRMaAdhveJV7UinExoB2G94lXtSOkfxy/hL5kU44WhDiFNuJSpCiMlJUVSMj3GOQDkWZ+p4ZtduCW9BKtWjKHXRBnSn4Dqnu3bgOa2h6m19mjUEk6JVVlwzLZjikzPHckq9w0ACsz6mUIpmrKTUUWzEQdk6Gp9uiNhHW2VUb6bduAbZeaiGidYdQ62rYtCiUR/5Idwi/KIJ5a3UNqh31Eojeh1G0s67TM00riVcahusbR4ARWzMmS/hotqIxIzTEt0M8cSJSKEWH9J4/8AOqZk62okR0viWVHa++0k30HQ9xp+9iWOKS3hl7CzQAPGGjIWLtfZYll6xS19NwlUrsrQewxqgAxdMPyxGfs96RtDF0w/LEZ+z3pFYfOv2ZLlY7Jew4DwzftIAJL2HAeGb9pAGS5mavodERohO5bLZU6zGxP0nFPmsisKVhZSW4v0MW4S1PK+WwfQTkLhKKTUupjTu0JXskXHekvIF7JFx3pLyDup5Xy2D6CcganlfLYPoJyDhezN4SvZIuO9JeQL2SLjvSXkHdTyvlsH0E5A1PK+WwfQTkHC9jeEr2SLjvSXkC9ki470l5B3U8r5bB9BOQNTyvlsH0E5BwvY3hK9ki470l5AvZIuO9JeQd1PK+WwfQTkDU8r5bB9BOQcL2N4yIud6LRiiXEPIU4mllwmXErTQ6lRRFUse4x5In0shypCz50yqdExLC3SSRnXA6Er/ajwG5qeV8tg+gnIGp5Xy2D6CchWbD+tuhlSMNjTSDStDUYSTqSauw9pSK76kokmXfhXaPPSTSGVR0iiYaFivqPLs2U/TWVaKIzxMu4hQanlfLYPoJyBqeV8tg+gnIFPCTTSYqVUEl7DgPDN+0gBphpuHYbZaTZbbSSElWtCIqEAcW7dlo//2Q==';
const jpegUrl = () => `data:image/jpeg;base64,${JPEG_B64}`;

/** Un PNG a due colori (con trasparenza) della misura voluta. */
function png(w, h, { noise = false } = {}) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const on = (i % w) % 8 < 4;
    rgba.set(noise ? [Math.random() * 256, Math.random() * 256, Math.random() * 256, 255] : on ? [175, 145, 104, 255] : [255, 255, 255, 0], i * 4);
  }
  return encodePng(w, h, rgba);
}
const pngUrl = (buf) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;

function setup(over = {}) {
  const app = makeApp({ mail: { notifyTo: 'guida@example.com' } });
  const acct = addAccount(app.db, { email: 'anna@dmc.example', company: 'Lagoon DMC S.r.l.', contact_name: 'Anna', lang: 'it', ...over });
  return { app, acct };
}
const book = (app, acct, over = {}) => createBooking(app, base({ tourSlug: 'shared', channel: 'b2b', account: acct, email: acct.email, name: 'Anna Conti', date: '2027-02-20', time: '09:30', pax: 2, paymentMethod: 'invoice', clientRef: 'Gruppo Rossi', ...over }), NOW);

test('prezzo al cliente: tariffa più ricarico, arrotondato per eccesso; con ricarico 0 resta la tariffa', () => {
  assert.equal(clientPrice(28000, 25, 5), 35000);
  assert.equal(clientPrice(28000, 20, 5), 34000, '33.600 → 340 €');
  assert.equal(clientPrice(8400, 20, 5), 10500, '100,80 → 105 €');
  assert.equal(clientPrice(8400, 20, 1), 10100, 'all’euro: 100,80 → 101');
  assert.equal(clientPrice(8400, 20, 10), 11000);
  assert.equal(clientPrice(28000, 12.5, 5), 31500, 'niente errori di virgola mobile sui valori esatti');
  assert.equal(clientPrice(5600, 7.5, 1), 6100, '60,20 → 61');
  assert.equal(clientPrice(5600, 0, 5), 5600, 'senza ricarico non si tocca nemmeno con l’arrotondamento');
  assert.equal(clientPrice(5600, -5, 5), 5600);
  assert.equal(clientPrice(0, 30, 5), 0);
});

test('profilo: valori di partenza, controlli del ricarico e salvataggio', () => {
  const { app, acct } = setup();
  assert.deepEqual(readProfile(acct), { name: '', contact: '', footer: '', markup: 0, round: 5, logoOnVoucher: true });
  assert.equal(parseMarkup('12,5'), 12.5);
  assert.equal(parseMarkup('0'), 0);
  assert.equal(parseMarkup('300'), 300);
  assert.equal(parseMarkup(' 7.256 '), 7.26);
  for (const bad of ['', null, undefined, '-1', '301', 'abc', 'NaN', 'Infinity']) assert.equal(parseMarkup(bad), null, String(bad));
  assert.equal(parseRound('10'), 10);
  assert.equal(parseRound('7'), null);

  saveProfile(app.db, acct.id, { name: '  Lagoon Travel  ', contact: 'info@lagoon.example · +39 041 000000', footer: 'Prezzi IVA esclusa.\nValido 7 giorni.', markup: '22,5', round: '10', logoOnVoucher: '' });
  const after = readProfile(app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id));
  assert.deepEqual(after, { name: 'Lagoon Travel', contact: 'info@lagoon.example · +39 041 000000', footer: 'Prezzi IVA esclusa.\nValido 7 giorni.', markup: 22.5, round: 10, logoOnVoucher: false });
  assert.throws(() => saveProfile(app.db, acct.id, { markup: '500' }), (e) => e instanceof DocsError && e.code === 'markup');
  assert.equal(readProfile(app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id)).markup, 22.5, 'un modulo sbagliato non cambia nulla');
  saveProfile(app.db, acct.id, { name: '', markup: '0', round: 'boh' });
  const cleared = readProfile(app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id));
  assert.equal(cleared.name, '');
  assert.equal(cleared.round, 5);
  assert.equal(brandOf(app, acct.id).name, 'Lagoon DMC S.r.l.', 'senza nome scelto: la ragione sociale');
});

test('logo: si accettano PNG e JPEG veri; il resto no', async () => {
  const ok = await parseLogo(pngUrl(png(160, 64)));
  assert.deepEqual({ mime: ok.mime, width: ok.width, height: ok.height }, { mime: 'image/png', width: 160, height: 64 });
  const jpg = await parseLogo(jpegUrl());
  assert.deepEqual({ mime: jpg.mime, width: jpg.width, height: jpg.height }, { mime: 'image/jpeg', width: 120, height: 48 });

  const rejects = async (value, why) => await assert.rejects(() => parseLogo(value), (e) => e instanceof DocsError && e.code === 'logo', why);
  await rejects(undefined, 'niente');
  await rejects('', 'vuoto');
  await rejects('data:image/gif;base64,R0lGODlhAQABAAAAACw=', 'GIF non ammesso');
  await rejects('data:image/svg+xml;base64,PHN2Zy8+', 'SVG non ammesso');
  await rejects('data:image/png;base64,@@@@', 'base64 non valido');
  await rejects(`data:image/png;base64,${Buffer.from('non sono un PNG, solo testo lungo abbastanza').toString('base64')}`, 'testo travestito da PNG');
  await rejects(`data:image/jpeg;base64,${Buffer.from(png(40, 40)).toString('base64')}`, 'un PNG dichiarato JPEG');
  await rejects(pngUrl(png(10, 10)), 'troppo piccolo');
  await rejects(pngUrl(png(400, 20)), 'forma troppo allungata');
  await rejects(pngUrl(png(20, 400)), 'forma troppo alta');
  const big = png(400, 400, { noise: true });
  assert.ok(big.length > LOGO_MAX_BYTES);
  await rejects(pngUrl(big), 'troppo pesante');
  const huge = Buffer.from(png(100, 40));
  huge.writeUInt32BE(5000, 16);
  await rejects(pngUrl(huge), 'lato oltre i 2000 px');
  const interlaced = Buffer.from(png(100, 40));
  interlaced[28] = 1;
  await rejects(pngUrl(interlaced), 'interlacciato');
  await rejects(pngUrl(png(100, 40).subarray(0, 60)), 'intestazione giusta ma immagine rotta: PDFKit non la legge');
});

test('logo: si salva, si sostituisce, si toglie; sparisce con l’agenzia', async () => {
  const { app, acct } = setup();
  assert.equal(getLogo(app.db, acct.id), null);
  assert.equal(brandOf(app, acct.id).logo, null);
  setLogo(app.db, acct.id, await parseLogo(pngUrl(png(160, 64))), NOW);
  const first = getLogo(app.db, acct.id);
  assert.deepEqual([first.mime, first.width, first.height], ['image/png', 160, 64]);
  assert.ok(Buffer.from(first.data).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  setLogo(app.db, acct.id, await parseLogo(jpegUrl()), NOW + 1000);
  assert.equal(getLogo(app.db, acct.id).mime, 'image/jpeg', 'un solo logo per agenzia: il nuovo prende il posto del vecchio');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM account_logos').get().n, 1);
  assert.equal(brandOf(app, acct.id).logo.width, 120);
  assert.equal(removeLogo(app.db, acct.id), true);
  assert.equal(removeLogo(app.db, acct.id), false);
  setLogo(app.db, acct.id, await parseLogo(pngUrl(png(160, 64))), NOW);
  app.db.prepare('DELETE FROM accounts WHERE id = ?').run(acct.id);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM account_logos').get().n, 0, 'il logo non resta orfano');
});

test('righe del preventivo: ordinate per data, solo opzioni e confermate, con tariffa e prezzo al cliente', () => {
  const { app, acct } = setup();
  const a = book(app, acct, { date: '2027-02-22', time: '14:30', pax: 3 }); // 3 × 28 = 84
  const b = book(app, acct, { date: '2027-02-20', time: '09:30', pax: 2 }); // 56
  const c = book(app, acct, { date: '2027-02-21', time: '09:30', pax: 1 });
  cancelBooking(app, c.id, { by: 'customer' }, NOW);
  const rows = [a, b, c].map((x) => app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(x.id));
  const q = buildQuote(rows, { markup: 25, round: 5 });
  assert.deepEqual(q.lines.map((l) => [l.booking.id, l.netCents, l.cents]), [[b.id, 5600, 7000], [a.id, 8400, 10500]]);
  assert.equal(q.netCents, 14000);
  assert.equal(q.totalCents, 17500);
  assert.equal(buildQuote(rows, { markup: 0 }).totalCents, 14000);
  assert.deepEqual(buildQuote([], {}), { lines: [], netCents: 0, totalCents: 0 });
});

test('voucher dell’agenzia: il suo logo e il suo nome, ancora senza prezzi; senza logo (o spento) resta come prima', async () => {
  const { app, acct } = setup();
  const b = book(app, acct);
  const row = () => app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id);
  const plain = await renderVoucherPdf(app, row(), { lang: 'it', nowMs: NOW });
  assert.ok(isPdf(plain));
  assert.ok(!Buffer.from(plain).toString('latin1').includes('/Subtype /Image'), 'senza logo nessuna immagine');

  saveProfile(app.db, acct.id, { name: 'Lagoon Travel', contact: 'info@lagoon.example · +39 041 000000', markup: '20', round: '5', logoOnVoucher: '1' });
  setLogo(app.db, acct.id, await parseLogo(pngUrl(png(240, 80))), NOW);
  const branded = await renderVoucherPdf(app, row(), { lang: 'it', nowMs: NOW });
  assert.ok(isPdf(branded));
  assert.equal(pdfPages(branded), 1);
  assert.ok(Buffer.from(branded).toString('latin1').includes('/Subtype /Image'), 'il logo è nel PDF');
  if (HAS_PDFTOTEXT) {
    const text = pdfText(branded);
    assert.match(text, /Lagoon Travel/);
    assert.match(text, /info@lagoon\.example · \+39 041 000000/);
    assert.ok(!/€/.test(text), 'ancora nessun prezzo');
    assert.ok(!/Ricarico|ricarico/.test(text));
  }

  saveProfile(app.db, acct.id, { name: 'Lagoon Travel', markup: '20', logoOnVoucher: '' });
  assert.ok(!Buffer.from(await renderVoucherPdf(app, row(), { lang: 'it', nowMs: NOW })).toString('latin1').includes('/Subtype /Image'), 'logo spento sui voucher');
  // un JPEG si disegna come un PNG; e il voucher di un privato non porta mai il marchio di un'agenzia
  saveProfile(app.db, acct.id, { markup: '20', logoOnVoucher: '1' });
  setLogo(app.db, acct.id, await parseLogo(jpegUrl()), NOW);
  assert.ok(Buffer.from(await renderVoucherPdf(app, row(), { lang: 'en', nowMs: NOW })).toString('latin1').includes('/Subtype /Image'));
  const priv = createBooking(app, base({ tourSlug: 'shared', date: '2027-03-02', time: '09:30', paymentMethod: 'onsite' }), NOW);
  assert.ok(!Buffer.from(await renderVoucherPdf(app, app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(priv.id), { lang: 'it', nowMs: NOW })).toString('latin1').includes('/Subtype /Image'));
});

test('preventivo PDF: prezzi per il cliente con il ricarico, la tariffa dell’agenzia non compare; logo, validità, note e piè di pagina', async () => {
  const { app, acct } = setup();
  const a = book(app, acct, { date: '2027-02-22', time: '14:30', pax: 3 }); // tariffa 84 → con +25% e arrotondo a 5: 105
  const b = book(app, acct, { date: '2027-02-20', time: '09:30', pax: 2 }); // tariffa 56 → 70
  saveProfile(app.db, acct.id, { name: 'Lagoon Travel', contact: 'info@lagoon.example', footer: 'Prezzi IVA compresa. Annullo gratuito fino a 7 giorni prima.', markup: '25', round: '5', logoOnVoucher: '1' });
  setLogo(app.db, acct.id, await parseLogo(pngUrl(png(240, 80))), NOW);
  const account = app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id);
  const rows = [a, b].map((x) => app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(x.id));
  const pdf = await renderQuotePdf(app, { account, bookings: rows, markup: 25, round: 5, client: 'Famiglia Rossi', until: '2027-02-10', note: 'Include il trasferimento dal porto.', lang: 'it', nowDate: '2027-01-04' });
  assert.ok(isPdf(pdf));
  assert.equal(pdfPages(pdf), 1);
  assert.ok(Buffer.from(pdf).toString('latin1').includes('/Subtype /Image'), 'il logo dell’agenzia');
  if (HAS_PDFTOTEXT) {
    const text = pdfText(pdf);
    assert.match(text, /P\s?R\s?E\s?V\s?E\s?N\s?T\s?I\s?V\s?O/, 'il titolo (spaziato)');
    assert.match(text, /Per Famiglia Rossi/);
    assert.match(text, /Lagoon Travel/);
    assert.match(text, /info@lagoon\.example/);
    assert.match(text, /105 €/);
    assert.match(text, /70 €/);
    assert.match(text, /175 €/, 'totale al cliente');
    assert.ok(!/\b(56|84|140)(,00)? €/.test(text), 'la tariffa dell’agenzia non compare mai');
    assert.match(text, /10 febbraio 2027/, 'validità');
    assert.match(text, /Include il trasferimento dal porto\./);
    assert.match(text, /Prezzi IVA compresa\. Annullo gratuito fino a 7 giorni prima\./);
    assert.match(text, /Gruppo Rossi/, 'il riferimento della pratica');
    assert.ok(text.indexOf('20 febbraio 2027') < text.indexOf('22 febbraio 2027'), 'in ordine di data');
    assert.match(text, /Servizi svolti da/);
  }
  // altre lingue e un nome non latino non rompono nulla; senza logo e senza ricarico va lo stesso
  for (const lang of ['en', 'es', 'ja']) assert.ok(isPdf(await renderQuotePdf(app, { account, bookings: rows, markup: 10, round: 1, client: lang === 'ja' ? '山田 太郎' : 'Mr Smith', lang })), lang);
  removeLogo(app.db, acct.id);
  const bare = await renderQuotePdf(app, { account: app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id), bookings: [rows[0]], markup: 0, round: 5, lang: 'it', nowDate: '2027-01-04' });
  assert.ok(isPdf(bare));
  assert.ok(!Buffer.from(bare).toString('latin1').includes('/Subtype /Image'));
  if (HAS_PDFTOTEXT) assert.match(pdfText(bare), /84 €/, 'ricarico zero: il prezzo è la tariffa');
});

test('preventivo PDF: tanti servizi vanno a capo su più pagine con l’intestazione compatta', async () => {
  const { app, acct } = setup();
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push(app.db.prepare('SELECT * FROM bookings WHERE id = ?').get(book(app, acct, { date: `2027-03-${String(1 + i).padStart(2, '0')}`, time: '09:30', pax: 2 + (i % 3) }).id));
  const pdf = await renderQuotePdf(app, { account: app.db.prepare('SELECT * FROM accounts WHERE id = ?').get(acct.id), bookings: rows, markup: 30, round: 5, lang: 'en', nowDate: '2027-01-04' });
  assert.ok(pdfPages(pdf) >= 2);
  if (HAS_PDFTOTEXT) assert.match(pdfText(pdf), /Page 2 of/i);
});
