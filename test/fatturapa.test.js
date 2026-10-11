import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOLLO_CENTS, amt, buildInvoiceXml, buyerProblems, causaleChunks, computeDocument, invoiceFileName, latin1, recipientRouting, sellerProblems, splitNet, validItalianVat, validPersonTaxCode } from '../server/fatturapa.js';
import { validateInvoiceXml } from './xsd.js';

// Partita IVA e codice fiscale di prova (validi dal punto di vista formale)
export const SELLER_VAT = '12345678903';
export const SELLER_CF = 'RSSMRA80A01H501U';
const BUYER_CF = 'MRTMTT91D08F205J';
const BUYER_VAT = '00743110157';

const seller = (over = {}) => ({
  vatNumber: `IT${SELLER_VAT}`, fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', name: '', regime: 'RF19', phone: '+39 333 1234567', email: 'info@example.com',
  address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' }, ...over,
});
const person = (over = {}) => ({ kind: 'person', firstName: 'Matteo', lastName: 'Moretti', country: 'IT', vat: '', taxCode: BUYER_CF, address: 'Via Roma 1', zip: '20100', city: 'Milano', province: 'MI', sdiCode: '', pec: '', ...over });
const company = (over = {}) => ({ kind: 'company', name: 'Venice DMC S.r.l.', country: 'IT', vat: BUYER_VAT, taxCode: '', address: 'Fondamenta Nuove 10', zip: '30121', city: 'Venezia', province: 'VE', sdiCode: 'ABCDEFG', pec: '', ...over });

const FORFETTARIO = { vatBp: 0, nature: 'N2.2', vatIncluded: false, bolloMode: 'auto' };
const NOTES_RF19 = ['Operazione effettuata ai sensi dell’art. 1, commi 54-89, L. 190/2014 – Regime forfettario.', 'Compenso non assoggettato a ritenuta d’acconto ai sensi dell’art. 1, comma 67, L. 190/2014.'];

function xmlFor({ s = seller(), buyer = person(), calc, type = 'TD01', number = '1/2027', date = '2027-01-20', payments, related, causali = NOTES_RF19, legalReference = 'Regime forfettario - art. 1, commi 54-89, L. 190/2014' } = {}) {
  return buildInvoiceXml({ progressive: '00001', seller: s, buyer, type, date, number, currency: 'EUR', calc, causali, payments, related, legalReference });
}
async function assertValid(xml, label = '') {
  const r = await validateInvoiceXml(xml);
  assert.ok(r.valid, `${label} XML non valido:\n${r.errors.join('\n')}\n${xml}`);
}
const count = (xml, re) => (xml.match(re) ?? []).length;

test('partita IVA e codice fiscale: cifre di controllo', () => {
  assert.equal(validItalianVat('12345678903'), true);
  assert.equal(validItalianVat('00743110157'), true);
  assert.equal(validItalianVat('12345678900'), false);
  assert.equal(validItalianVat('1234567890'), false);
  assert.equal(validItalianVat('ABCDEFGHILM'), false);
  assert.equal(validPersonTaxCode('RSSMRA80A01H501U'), true);
  assert.equal(validPersonTaxCode('rssmra80a01h501u'), true, 'minuscole accettate');
  assert.equal(validPersonTaxCode('MRTMTT91D08F205J'), true);
  assert.equal(validPersonTaxCode('RSSMRA80A01H501V'), false, 'carattere di controllo errato');
  assert.equal(validPersonTaxCode('RSSMRA80A01H501'), false);
  assert.equal(validPersonTaxCode('12345678903'), false, 'la partita IVA non è un codice fiscale di persona');
});

test('latin1: solo i caratteri ammessi dallo schema', () => {
  assert.equal(latin1('Łukasz Dvořák – “ciao” …'), 'Lukasz Dvorák - "ciao" ...');
  assert.equal(latin1('  a\tb\nc   d  '), 'a b c d');
  assert.equal(latin1('Prezzo 10 €'), 'Prezzo 10 EUR');
  assert.equal(latin1('Иван 🎉'), '????');
  assert.equal(latin1('abcdef', 3), 'abc');
  assert.equal(latin1(null), '');
  assert.equal(amt(105), '1.05');
  assert.equal(amt(10500), '105.00');
  assert.equal(amt(-1), '-0.01');
  assert.equal(amt(0), '0.00');
});

test('splitNet: il netto totale è esatto, qualunque siano le righe', () => {
  assert.deepEqual(splitNet([10500], 2200), [8607]);
  for (let n = 0; n < 300; n++) {
    const gross = Array.from({ length: 1 + (n % 6) }, (_, i) => 100 + ((n * 7919 + i * 104729) % 90000));
    const nets = splitNet(gross, 2200);
    const total = gross.reduce((a, b) => a + b, 0);
    assert.equal(nets.reduce((a, b) => a + b, 0), Math.round((total * 10000) / 12200));
    nets.forEach((v, i) => assert.ok(Math.abs(v - (gross[i] * 10000) / 12200) < 1, 'ogni riga resta entro un centesimo dal valore esatto'));
  }
});

test('computeDocument: forfettario con bollo addebitato o assorbito, sotto soglia nessun bollo', () => {
  const lines = [{ description: 'Tour', amountCents: 10500 }];
  const absorbed = computeDocument({ ...FORFETTARIO, lines, bolloCharged: false });
  assert.equal(absorbed.bolloCents, BOLLO_CENTS);
  assert.equal(absorbed.bolloCharged, false);
  assert.equal(absorbed.totalCents, 10500);
  assert.equal(absorbed.lines.length, 1);
  const charged = computeDocument({ ...FORFETTARIO, lines, bolloCharged: true });
  assert.equal(charged.lines.length, 2);
  assert.equal(charged.lines[1].nature, 'N1');
  assert.equal(charged.totalCents, 10700);
  assert.deepEqual(charged.summary.map((s) => [s.nature, s.taxableCents]), [['N2.2', 10500], ['N1', 200]]);
  const small = computeDocument({ ...FORFETTARIO, lines: [{ description: 'Tour', amountCents: 7747 }], bolloCharged: true });
  assert.equal(small.bolloCents, 0, 'fino a 77,47 € niente bollo');
  assert.equal(computeDocument({ ...FORFETTARIO, lines: [{ description: 'Tour', amountCents: 7748 }] }).bolloCents, 200);
  assert.equal(computeDocument({ ...FORFETTARIO, bolloMode: 'never', lines }).bolloCents, 0);
  assert.equal(computeDocument({ ...FORFETTARIO, isCreditNote: true, lines }).bolloCents, 0, 'niente bollo sulle note di credito');
  const withVat = computeDocument({ vatBp: 2200, vatIncluded: false, lines });
  assert.equal(withVat.bolloCents, 0, 'con IVA non c’è bollo');
  assert.equal(withVat.vatCents, 2310);
  assert.equal(withVat.totalCents, 12810);
});

test('computeDocument: prezzi con IVA inclusa → netto, imposta e arrotondamento al centesimo', () => {
  const c = computeDocument({ vatBp: 2200, vatIncluded: true, lines: [{ description: 'Tour', amountCents: 10500 }], targetTotalCents: 10500 });
  assert.equal(c.lines[0].netCents, 8607);
  assert.equal(c.vatCents, 1894);
  assert.equal(c.roundingCents, -1);
  assert.equal(c.totalCents, 10500);
  const multi = computeDocument({ vatBp: 2200, vatIncluded: true, lines: [{ description: 'a', amountCents: 3333 }, { description: 'b', amountCents: 3333 }, { description: 'c', amountCents: 3334 }], targetTotalCents: 10000 });
  assert.equal(multi.servicesCents, Math.round((10000 * 10000) / 12200));
  assert.ok(Math.abs(multi.roundingCents) <= 1);
  assert.throws(() => computeDocument({ vatBp: 2200, vatIncluded: true, lines: [{ description: 'a', amountCents: 10500 }], targetTotalCents: 12000 }), /discosta troppo/);
});

test('computeDocument: rivalsa INPS e ritenuta su prezzi netti', () => {
  const c = computeDocument({ vatBp: 2200, vatIncluded: false, contributionPercent: 4, withholdingPercent: 20, lines: [{ description: 'a', amountCents: 10000 }, { description: 'b', amountCents: 25000 }, { description: 'c', amountCents: 8050 }] });
  assert.equal(c.servicesCents, 43050);
  assert.equal(c.contributionCents, 1722);
  assert.equal(c.taxableCents, 44772);
  assert.equal(c.vatCents, 9850);
  assert.equal(c.totalCents, 54622);
  assert.equal(c.withholdingCents, 8610, 'la ritenuta non include la rivalsa');
  assert.equal(c.payableCents, 46012);
  assert.throws(() => computeDocument({ vatBp: 2200, vatIncluded: true, contributionPercent: 4, lines: [{ description: 'a', amountCents: 100 }] }), /rivalsa/);
});

test('computeDocument: controlli di coerenza', () => {
  const line = [{ description: 'a', amountCents: 100 }];
  assert.throws(() => computeDocument({ vatBp: 0, nature: null, lines: line }), /natura/);
  assert.throws(() => computeDocument({ vatBp: 2200, nature: 'N2.2', lines: line }), /natura/);
  assert.throws(() => computeDocument({ vatBp: 0, nature: 'N2.2', lines: [] }), /nessuna riga/);
  assert.throws(() => computeDocument({ vatBp: 0, nature: 'N2.2', lines: [{ description: 'a', amountCents: 0 }] }), /positivi/);
  assert.throws(() => computeDocument({ vatBp: 0, nature: 'N2.2', lines: [{ description: 'a', amountCents: -5 }] }), /positivi/);
});

test('XML forfettario verso privato italiano: valido, codice destinatario 0000000, bollo assorbito', async () => {
  const calc = computeDocument({ ...FORFETTARIO, lines: [{ description: 'Tour “Cannaregio e il Ghetto” – 12/01/2027 (3 persone)', amountCents: 10500 }], bolloCharged: false });
  const xml = xmlFor({ calc, payments: [{ method: 'MP08', cents: calc.payableCents }] });
  await assertValid(xml, 'privato');
  assert.match(xml, /<RegimeFiscale>RF19<\/RegimeFiscale>/);
  assert.match(xml, /<Natura>N2\.2<\/Natura>/);
  assert.match(xml, /<CodiceDestinatario>0000000<\/CodiceDestinatario>/);
  assert.match(xml, /<CodiceFiscale>MRTMTT91D08F205J<\/CodiceFiscale>/);
  assert.ok(!/<IdFiscaleIVA>[^]*?<IdCodice>(?!12345678903)/.test(xml.split('CessionarioCommittente')[1] ?? ''), 'il privato senza P.IVA non ha IdFiscaleIVA');
  assert.match(xml, /<BolloVirtuale>SI<\/BolloVirtuale>\s*<ImportoBollo>2\.00<\/ImportoBollo>/);
  assert.equal(count(xml, /<DettaglioLinee>/g), 1, 'bollo assorbito: nessuna riga per il bollo');
  assert.match(xml, /<ImportoTotaleDocumento>105\.00<\/ImportoTotaleDocumento>/);
  assert.match(xml, /<ModalitaPagamento>MP08<\/ModalitaPagamento>\s*<ImportoPagamento>105\.00<\/ImportoPagamento>/);
  assert.match(xml, /Numero>1\/2027</);
  assert.match(xml, /Provincia>MI</);
  assert.equal(invoiceFileName(`IT${SELLER_VAT}`, '00001'), 'IT12345678903_00001.xml');
});

test('XML forfettario verso azienda con codice SdI, bollo addebitato, bonifico con IBAN e scadenza', async () => {
  const calc = computeDocument({ ...FORFETTARIO, lines: [{ description: 'Servizio mezza giornata – PRATICA 42', amountCents: 19000 }, { description: 'Servizio giornata – PRATICA 43', amountCents: 32000 }], bolloCharged: true });
  const xml = xmlFor({ buyer: company(), calc, payments: [{ method: 'MP05', cents: calc.payableCents, dueDate: '2027-02-19', iban: 'IT60 X054 2811 1010 0000 0123 456', bank: 'Banca di Prova' }] });
  await assertValid(xml, 'azienda');
  assert.match(xml, /<CodiceDestinatario>ABCDEFG<\/CodiceDestinatario>/);
  assert.match(xml, /<IdFiscaleIVA>\s*<IdPaese>IT<\/IdPaese>\s*<IdCodice>00743110157<\/IdCodice>/);
  assert.equal(count(xml, /<DettaglioLinee>/g), 3, 'due servizi più il bollo');
  assert.equal(count(xml, /<DatiRiepilogo>/g), 2);
  assert.match(xml, /<ImportoTotaleDocumento>512\.00<\/ImportoTotaleDocumento>/);
  assert.match(xml, /<IBAN>IT60X0542811101000000123456<\/IBAN>/);
  assert.match(xml, /<DataScadenzaPagamento>2027-02-19<\/DataScadenzaPagamento>/);
});

test('XML con PEC invece del codice SdI, e senza né l’uno né l’altro', async () => {
  const calc = computeDocument({ ...FORFETTARIO, lines: [{ description: 'Tour', amountCents: 5000 }] });
  const pec = xmlFor({ buyer: company({ sdiCode: '', pec: 'dmc@pec.example.it' }), calc });
  await assertValid(pec, 'pec');
  assert.match(pec, /<CodiceDestinatario>0000000<\/CodiceDestinatario>\s*<PECDestinatario>dmc@pec\.example\.it<\/PECDestinatario>/);
  const none = xmlFor({ buyer: company({ sdiCode: '', pec: '' }), calc });
  await assertValid(none, 'senza canale');
  assert.ok(!/PECDestinatario/.test(none));
  assert.deepEqual(recipientRouting(company({ sdiCode: '0000000', pec: 'x@pec.it' })), { code: '0000000', pec: 'x@pec.it' });
});

test('XML verso cliente estero: IdCodice 0000000, destinatario XXXXXXX, CAP 00000, nomi traslitterati', async () => {
  const calc = computeDocument({ ...FORFETTARIO, lines: [{ description: 'Tour per Łukasz & famiglia <3', amountCents: 9000 }], bolloCharged: false });
  const buyer = person({ firstName: 'Łukasz', lastName: 'Kowalski', country: 'PL', taxCode: '', address: 'ul. Długa 5/7', zip: '', city: 'Kraków', province: '' });
  assert.deepEqual(buyerProblems(buyer), []);
  const xml = xmlFor({ buyer, calc, payments: [{ method: 'MP08', cents: calc.payableCents }] });
  await assertValid(xml, 'estero');
  const buyerXml = xml.split('<CessionarioCommittente>')[1].split('</CessionarioCommittente>')[0];
  assert.match(buyerXml, /<IdPaese>PL<\/IdPaese>\s*<IdCodice>0000000<\/IdCodice>/);
  assert.match(buyerXml, /<Nome>Lukasz<\/Nome>/);
  assert.match(buyerXml, /<CAP>00000<\/CAP>/);
  assert.match(buyerXml, /<Comune>Kraków<\/Comune>/, 'ó è nel Latin-1');
  assert.ok(!/Provincia/.test(buyerXml));
  assert.match(xml, /<CodiceDestinatario>XXXXXXX<\/CodiceDestinatario>/);
  assert.match(xml, /Tour per Lukasz &amp; famiglia &lt;3/, 'escape dei caratteri speciali');
  const vat = xmlFor({ buyer: company({ country: 'DE', vat: 'DE123456789', sdiCode: '', zip: '', province: '', city: 'Berlin' }), calc });
  await assertValid(vat, 'azienda estera');
  assert.match(vat, /<IdPaese>DE<\/IdPaese>\s*<IdCodice>DE123456789<\/IdCodice>/);
});

test('XML regime ordinario con IVA 22% inclusa: Arrotondamento e esigibilità immediata', async () => {
  const calc = computeDocument({ vatBp: 2200, vatIncluded: true, lines: [{ description: 'Tour', amountCents: 10500 }], targetTotalCents: 10500 });
  const xml = xmlFor({ s: seller({ regime: 'RF01' }), calc, causali: [], payments: [{ method: 'MP08', cents: 10500 }] });
  await assertValid(xml, 'ordinario');
  assert.match(xml, /<RegimeFiscale>RF01<\/RegimeFiscale>/);
  assert.match(xml, /<PrezzoTotale>86\.07<\/PrezzoTotale>\s*<AliquotaIVA>22\.00<\/AliquotaIVA>/);
  assert.ok(!/<Natura>/.test(xml));
  assert.match(xml, /<ImponibileImporto>86\.07<\/ImponibileImporto>\s*<Imposta>18\.94<\/Imposta>\s*<EsigibilitaIVA>I<\/EsigibilitaIVA>/);
  assert.match(xml, /<ImportoTotaleDocumento>105\.00<\/ImportoTotaleDocumento>\s*<Arrotondamento>-0\.01<\/Arrotondamento>/);
  assert.ok(!/DatiBollo/.test(xml));
});

test('XML con rivalsa INPS e ritenuta d’acconto', async () => {
  const calc = computeDocument({ vatBp: 2200, vatIncluded: false, contributionPercent: 4, withholdingPercent: 20, lines: [{ description: 'a', amountCents: 10000 }, { description: 'b', amountCents: 25000 }, { description: 'c', amountCents: 8050 }] });
  const xml = xmlFor({ s: seller({ regime: 'RF01' }), buyer: company(), calc, causali: [], payments: [{ method: 'MP05', cents: calc.payableCents, dueDate: '2027-02-19' }] });
  await assertValid(xml, 'rivalsa e ritenuta');
  assert.match(xml, /<DatiRitenuta>\s*<TipoRitenuta>RT01<\/TipoRitenuta>\s*<ImportoRitenuta>86\.10<\/ImportoRitenuta>\s*<AliquotaRitenuta>20\.00<\/AliquotaRitenuta>\s*<CausalePagamento>A<\/CausalePagamento>/);
  assert.match(xml, /<DatiCassaPrevidenziale>\s*<TipoCassa>TC22<\/TipoCassa>\s*<AlCassa>4\.00<\/AlCassa>\s*<ImportoContributoCassa>17\.22<\/ImportoContributoCassa>\s*<ImponibileCassa>430\.50<\/ImponibileCassa>\s*<AliquotaIVA>22\.00<\/AliquotaIVA>/);
  assert.equal(count(xml, /<Ritenuta>SI<\/Ritenuta>/g), 3);
  assert.match(xml, /<ImponibileImporto>447\.72<\/ImponibileImporto>\s*<Imposta>98\.50<\/Imposta>/);
  assert.match(xml, /<ImportoTotaleDocumento>546\.22<\/ImportoTotaleDocumento>/);
  assert.match(xml, /<ImportoPagamento>460\.12<\/ImportoPagamento>/);
});

test('XML nota di credito TD04 con riferimento alla fattura originale, senza pagamenti', async () => {
  const calc = computeDocument({ ...FORFETTARIO, isCreditNote: true, lines: [{ description: 'Storno Tour 12/01/2027', amountCents: 10500 }] });
  const xml = xmlFor({ calc, type: 'TD04', number: '2/2027', related: { number: '1/2027', date: '2027-01-20' }, date: '2027-01-25' });
  await assertValid(xml, 'nota di credito');
  assert.match(xml, /<TipoDocumento>TD04<\/TipoDocumento>/);
  assert.match(xml, /<DatiFattureCollegate>\s*<IdDocumento>1\/2027<\/IdDocumento>\s*<Data>2027-01-20<\/Data>/);
  assert.ok(!/DatiPagamento/.test(xml));
  assert.ok(!/DatiBollo/.test(xml));
});

test('Causale: testi lunghi spezzati in blocchi da 200 caratteri; persona fisica o denominazione per il cedente', async () => {
  const long = Array.from({ length: 60 }, (_, i) => `parola${i}`).join(' ');
  const chunks = causaleChunks(long);
  assert.ok(chunks.length >= 2 && chunks.every((c) => c.length <= 200 && c.length > 0));
  assert.equal(chunks.join(' '), long);
  const calc = computeDocument({ ...FORFETTARIO, lines: [{ description: 'Tour', amountCents: 5000 }] });
  const company_ = xmlFor({ s: seller({ name: 'Guida Venezia S.r.l.s.', firstName: '', lastName: '' }), calc, causali: [long] });
  await assertValid(company_, 'cedente società');
  assert.match(company_, /<Denominazione>Guida Venezia S\.r\.l\.s\.<\/Denominazione>/);
  assert.equal(count(company_, /<Causale>/g), chunks.length);
  const description = xmlFor({ calc: computeDocument({ ...FORFETTARIO, lines: [{ description: 'x'.repeat(1500), amountCents: 5000 }] }) });
  await assertValid(description, 'descrizione lunga');
});

test('controlli su intestatario e cedente', () => {
  assert.deepEqual(buyerProblems(person()), []);
  assert.deepEqual(buyerProblems(company()), []);
  const has = (b, re) => assert.ok(buyerProblems(b).some((m) => re.test(m)), JSON.stringify(buyerProblems(b)));
  has(person({ taxCode: '' }), /codice fiscale/);
  has(person({ taxCode: 'RSSMRA80A01H501V' }), /codice fiscale non è valido/);
  has(company({ vat: '' }), /partita IVA/);
  has(company({ vat: '12345678900' }), /partita IVA italiana non è valida/);
  has(person({ firstName: '' }), /nome e cognome/i);
  has(company({ name: '' }), /denominazione/i);
  has(person({ country: 'ITA' }), /due lettere/);
  has(person({ address: '' }), /indirizzo/);
  has(person({ zip: '2010' }), /CAP/);
  has(person({ province: '' }), /provincia/);
  has(company({ sdiCode: 'ABC' }), /7 caratteri/);
  has(company({ pec: 'non-una-pec' }), /PEC/);
  assert.deepEqual(buyerProblems(person({ country: 'US', taxCode: '', zip: '', province: '' })), [], 'un privato estero senza identificativo va bene');

  assert.deepEqual(sellerProblems({ vatNumber: `IT${SELLER_VAT}`, fiscalCode: SELLER_CF, firstName: 'Mario', lastName: 'Rossi', regime: 'RF19', vatBp: 0, nature: 'N2.2', address: { street: 'Calle 1', zip: '30100', city: 'Venezia', province: 'VE' } }), []);
  const bad = sellerProblems({ vatNumber: '', fiscalCode: '', regime: '', vatBp: 0, nature: '', address: {} });
  assert.ok(bad.length >= 6, bad.join('\n'));
});
