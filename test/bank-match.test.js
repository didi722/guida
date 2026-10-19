// Estratto conto della banca (CSV): lettura di formati diversi e abbinamento dei bonifici alle fatture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooking } from '../server/bookings.js';
import { createDrafts, getInvoice, invoiceDetail, issueInvoice, saveDraft } from '../server/invoices.js';
import { markInvoicePaid } from '../server/invoicePayments.js';
import { extractRefs, matchStatement, parseAmount, parseDate, readStatement, splitCsv } from '../server/bankMatch.js';
import { localToInstant } from '../server/time.js';
import { addAccount, base, makeApp, NOW } from './helpers.js';

const LATER = localToInstant('2027-01-20', '10:00');

const plain = (t) => t.map((r) => [...r]); // (le righe portano anche il numero di riga del file)

test('CSV: separatore riconosciuto, virgolette con separatori e a capo dentro, BOM e righe vuote', () => {
  assert.deepEqual(plain(splitCsv('\uFEFFa;b;c\r\n1;2;3\r\n\r\n4;5;6\r\n')), [['a', 'b', 'c'], ['1', '2', '3'], ['4', '5', '6']]);
  assert.deepEqual(plain(splitCsv('a,b,c\n1,"x, y",3\n')), [['a', 'b', 'c'], ['1', 'x, y', '3']]);
  assert.deepEqual(plain(splitCsv('a\tb\n1\t2\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(plain(splitCsv('a|b\n1|2\n')), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(plain(splitCsv('d;t\n1;"riga uno\nriga due; con ""virgolette"""\n')), [['d', 't'], ['1', 'riga uno\nriga due; con "virgolette"']]);
  assert.deepEqual(plain(splitCsv('Descrizione;Importo\nBonifico da Rossi, Mario;"1.234,56"\n')), [['Descrizione', 'Importo'], ['Bonifico da Rossi, Mario', '1.234,56']], 'la virgola dei decimali non confonde il separatore «;»');
  assert.deepEqual(plain(splitCsv('')), []);
  assert.deepEqual(plain(splitCsv('solo una colonna\nun’altra riga\n')), [['solo una colonna'], ['un’altra riga']]);
});

test('importi: formati di banche diverse, in centesimi; ciò che non è un importo è null', () => {
  const cases = [
    ['1.234,56', 123456], ['1,234.56', 123456], ['1234,56', 123456], ['1234.56', 123456], ['-45,00', -4500], ['+45,00', 4500], ['(45,00)', -4500],
    ['45,00 DB', -4500], ['45,00 CR', 4500], ['45,00-', -4500], ['€ 1.000,00', 100000], ['1.000.000,00 EUR', 100000000], ['1.234', 123400], ['1,234', 123400],
    ['0,5', 50], ['12,5', 1250], ['7', 700], ['0,00', 0], ['  58,00 ', 5800], ['−45,00'.replace('−', '-'), -4500],
  ];
  for (const [raw, cents] of cases) assert.equal(parseAmount(raw), cents, raw);
  for (const bad of ['', null, undefined, 'abc', '12/01/2027', '--', 'EUR', '1,2,3x', ',']) assert.equal(parseAmount(bad), null, String(bad));
});

test('date: giorno/mese/anno con / - . e anno a due cifre, anno/mese/giorno; date impossibili sono null', () => {
  for (const [raw, iso] of [['20/01/2027', '2027-01-20'], ['20-01-2027', '2027-01-20'], ['20.01.2027', '2027-01-20'], ['2027-01-20', '2027-01-20'], ['2027/01/20', '2027-01-20'], ['5/1/27', '2027-01-05'], ['20/01/2027 10:35:00', '2027-01-20'], ['2027-01-20T10:35', '2027-01-20']]) assert.equal(parseDate(raw), iso, raw);
  for (const bad of ['31/02/2027', '13/13/2027', 'x', '', '2027', '20 gennaio 2027']) assert.equal(parseDate(bad), null, bad);
});

test('estratti di formati diversi: colonne riconosciute, accrediti e uscite col segno giusto', () => {
  // Intesa-like: importo con segno, virgola decimale, una colonna «Valuta» che è la divisa
  const a = readStatement([
    'Conto: IT60X0542811101000000123456;;;;;;',
    'Periodo: 01/01/2027 - 31/01/2027;;;;;;',
    ';;;;;;',
    'Data;Operazione;Dettagli;Conto o carta;Contabilizzazione;Valuta;Importo',
    '20/01/2027;BONIFICO A VOSTRO FAVORE;LAGOON DMC SRL FATTURA 12/2027;Conto;CONTABILIZZATO;EUR;"1.234,56"',
    '21/01/2027;PAGAMENTO POS;SUPERMERCATO;Conto;CONTABILIZZATO;EUR;-45,00',
    'Totale;;;;;;',
  ].join('\n'));
  assert.deepEqual(a.rows.map((r) => [r.line, r.date, r.cents]), [[5, '2027-01-20', 123456], [6, '2027-01-21', -4500]], 'i numeri di riga sono quelli del file');
  assert.match(a.rows[0].text, /LAGOON DMC SRL FATTURA 12\/2027/);
  assert.match(a.rows[0].text, /BONIFICO A VOSTRO FAVORE/);
  assert.equal(a.columns.date, 'Data');
  assert.equal(a.columns.amount, 'Importo');
  assert.equal(a.skipped, 1, 'la riga dei totali non è un movimento');

  // Fineco-like: Entrate e Uscite in colonne separate, nomi con il trattino basso
  const f = readStatement(['Data_Operazione;Data_Valuta;Entrate;Uscite;Descrizione;Descrizione_Completa;Stato', '22/01/2027;23/01/2027;580,00;;Bonifico;Bonifico da BLUESAIL TOURS Fattura 13-2027;Contabilizzato', '24/01/2027;24/01/2027;;12,50;Commissioni;Commissione bonifico;Contabilizzato'].join('\n'));
  assert.deepEqual(f.rows.map((r) => [r.date, r.cents]), [['2027-01-22', 58000], ['2027-01-24', -1250]]);
  assert.match(f.rows[0].text, /BLUESAIL TOURS Fattura 13-2027/);

  // N26/Revolut-like: virgola come separatore, punto decimale, importi con segno
  const n = readStatement(['Date,Payee,Account number,Transaction type,Payment reference,Amount (EUR)', '2027-01-25,Lagoon DMC,,Income,Invoice 14/2027,"1,000.50"', '2027-01-26,Bar,,Outgoing,caffè,-2.50'].join('\n'));
  assert.deepEqual(n.rows.map((r) => [r.date, r.cents]), [['2027-01-25', 100050], ['2027-01-26', -250]]);
  assert.match(n.rows[0].text, /Invoice 14\/2027/);

  // Dare/Avere
  const d = readStatement(['Data contabile;Data valuta;Dare;Avere;Causale', '27/01/2027;27/01/2027;;300,00;Saldo fattura 15/2027', '28/01/2027;28/01/2027;20,00;;Imposta di bollo'].join('\n'));
  assert.deepEqual(d.rows.map((r) => [r.date, r.cents]), [['2027-01-27', 30000], ['2027-01-28', -2000]]);

  // senza intestazioni: si riconoscono la data, l'importo e il resto è testo
  const h = readStatement(['20/01/2027;Bonifico da Lagoon fattura 12/2027;1.234,56', '21/01/2027;Pagamento carta;-45,00', '22/01/2027;Bonifico Rossi;50,00', '23/01/2027;Altro;10,00'].join('\n'));
  assert.deepEqual(h.rows.map((r) => [r.date, r.cents]), [['2027-01-20', 123456], ['2027-01-21', -4500], ['2027-01-22', 5000], ['2027-01-23', 1000]]);
  assert.match(h.columns.date, /colonna 1/);

  // roba che non è un estratto conto
  assert.match(readStatement('').problem, /vuoto/);
  assert.match(readStatement('nome;cognome\nMario;Rossi\n').problem, /Non riconosco le colonne/);
});

test('numeri di fattura citati nei testi: con barra o trattino, più d’uno, mai dentro una data', () => {
  const refs = (s) => extractRefs(s).map((r) => `${r.seq}/${r.year}`);
  assert.deepEqual(refs('Bonifico fattura 12/2027'), ['12/2027']);
  assert.deepEqual(refs('FATT. N. 7-2027 LAGOON'), ['7/2027']);
  assert.deepEqual(refs('FT 0012/2027 saldo'), ['12/2027']);
  assert.deepEqual(refs('Saldo fatture 12/2027 e 13/2027, 14/2027'), ['12/2027', '13/2027', '14/2027']);
  assert.deepEqual(refs('Invoice nr 21/2028'), ['21/2028']);
  assert.deepEqual(refs('pagamento del 15/01/2027 per servizi'), [], 'una data non è un numero di fattura');
  assert.deepEqual(refs('fattura del 15/01/2027 n. 3/2027'), ['3/2027']);
  assert.deepEqual(refs('rif. 12-2027'), [], 'senza «fattura» il trattino non basta');
  assert.deepEqual(refs('12/1999 e 7/3000'), []);
  assert.deepEqual(refs('fattura 12/2027 fattura 12/2027'), ['12/2027'], 'senza ripetizioni');
});

// ───────────── abbinamento ─────────────
function appFor() {
  return makeApp({ site: { vatNumber: 'IT12345678903', phone: '+39 333 1234567' }, invoice: { seller: { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', address: { street: 'Calle del Test 1', zip: '30100', city: 'Venezia', province: 'VE' } } } });
}
let slot = 0;
function invoiceFor(app, acct, pax) {
  const n = slot++;
  const b = createBooking(app, base({ channel: 'b2b', account: acct, paymentMethod: 'invoice', name: 'Anna', email: acct.email, date: `2027-01-${String(5 + (n % 14)).padStart(2, '0')}`, time: n % 2 ? '14:30' : '09:30', pax }), NOW);
  const [draft] = createDrafts(app, [`booking:${b.id}`], LATER);
  const d = invoiceDetail(app, draft.id);
  saveDraft(app, draft.id, { buyer: { kind: 'company', name: acct.company, country: 'IT', vat: '01234567897', sdiCode: 'ABC1234', address: 'Via Roma 1', zip: '30100', city: 'Venezia', province: 'VE', email: acct.email, lang: 'it' }, lines: d.lines.map((l) => ({ key: `${l.source_type}:${l.source_id}`, description: l.description, amountCents: l.amount_cents })), issueDate: d.inv.issue_date, options: { bolloCharged: d.options.bolloCharged, contributionPercent: 0, withholdingPercent: 0, notes: '', dueDate: d.options.dueDate } }, NOW);
  return issueInvoice(app, draft.id, LATER);
}
const stmt = (...rows) => ({ rows: rows.map((r, i) => ({ line: i + 2, date: '2027-01-25', ...r })), columns: {}, skipped: 0 });

test('abbinamento: numero e importo → sicuro; importo diverso → da controllare; somma di più fatture; nome e importo; ambiguità; già incassate; senza fattura', () => {
  const app = appFor();
  const lagoon = addAccount(app.db, { email: 'anna@lagoon.example', company: 'Lagoon DMC Srl', contact_name: 'Anna Bianchi' });
  const blue = addAccount(app.db, { email: 'bruno@bluesail.example', company: 'BlueSail Tours', contact_name: 'Bruno Neri' });
  const i1 = invoiceFor(app, lagoon, 2); // 56 €
  const i2 = invoiceFor(app, lagoon, 3); // 84 € + 2 € di bollo = 86 €
  const i3 = invoiceFor(app, blue, 1); // 28 €
  const i4 = invoiceFor(app, blue, 1); // 28 € (stesso importo di i3)
  const i5 = invoiceFor(app, lagoon, 4); // 112 € + 2 € di bollo = 114 €
  const i6 = invoiceFor(app, blue, 5); // 140 € + 2 € = 142 €
  const today = '2027-02-01';
  assert.deepEqual([i1, i2, i3, i4, i5, i6].map((i) => i.number), ['1/2027', '2/2027', '3/2027', '4/2027', '5/2027', '6/2027']);

  const m = matchStatement(app.db, stmt(
    { text: 'BONIFICO LAGOON DMC Fattura 1/2027', cents: 5600 }, // sicuro
    { text: 'saldo fatture 2/2027 e 5/2027', cents: 8600 + 11400 }, // un bonifico per due fatture
    { text: 'BlueSail fattura 6/2027 acconto', cents: 10000 }, // importo diverso
    { text: 'BONIFICO BLUESAIL TOURS', cents: 14200 }, // nessun numero: importo e nome (fattura 6, già… no: ancora aperta)
    { text: 'Bonifico da Mario Rossi', cents: 2800 }, // 28 €: coincide con le fatture 3 e 4 → ambiguo
    { text: 'Rimborso spese', cents: 99900 }, // niente
    { text: 'uscita', cents: -500 }, // un'uscita: non conta
  ), { today });
  const by = (n) => m.rows.find((r) => r.text.includes(n));
  const sure = by('Fattura 1/2027');
  assert.equal(sure.status, 'sure');
  assert.deepEqual([sure.selected, sure.candidates.map((c) => c.number)], [[i1.id], ['1/2027']]);
  assert.equal(sure.candidates[0].dueCents, 5600);
  assert.ok(sure.candidates[0].dueDate, 'con la scadenza');

  const two = by('saldo fatture');
  assert.equal(two.status, 'sure');
  assert.deepEqual(two.selected.sort(), [i2.id, i5.id].sort());
  assert.match(two.note, /più fatture/);

  const diff = by('acconto');
  assert.equal(diff.status, 'check');
  assert.deepEqual(diff.selected, [], 'da controllare: non si spunta da sola');
  assert.match(diff.note, /ricevuti 100,00 €, attesi 142,00 €/);

  const likely = by('BONIFICO BLUESAIL');
  assert.equal(likely.status, 'likely');
  assert.deepEqual(likely.candidates.map((c) => c.number), ['6/2027'], 'la 6 è ancora aperta: la 6/2027 citata sopra non è stata «presa» (era da controllare)');
  assert.deepEqual(likely.selected, []);

  const amb = by('Mario Rossi');
  assert.equal(amb.status, 'ambiguous');
  assert.deepEqual(amb.candidates.map((c) => c.number).sort(), ['3/2027', '4/2027']);

  assert.equal(by('Rimborso').status, 'none');
  assert.deepEqual([m.counts.credits, m.counts.debits, m.counts.sure, m.counts.check, m.counts.likely, m.counts.ambiguous, m.counts.none], [6, 1, 2, 1, 1, 1, 1]);
  assert.ok(!m.rows.some((r) => r.text === 'uscita'));

  // già incassata (o già abbinata a un accredito precedente): non si propone due volte
  markInvoicePaid(app, i3.id, { method: 'bank' }, LATER);
  const again = matchStatement(app.db, stmt({ text: 'Fattura 3/2027', cents: 2800 }, { text: 'Fattura 1/2027', cents: 5600, date: '2027-01-26' }, { text: 'Fattura 1/2027 ancora', cents: 5600, date: '2027-01-27' }), { today });
  assert.equal(again.rows[0].status, 'paid');
  assert.match(again.rows[0].note, /già incassata/);
  assert.equal(again.rows[1].status, 'sure');
  assert.equal(again.rows[2].status, 'paid', 'lo stesso accredito citato due volte: la seconda volta la fattura è già «presa»');
  // solo l'importo: «guess»
  const guess = matchStatement(app.db, stmt({ text: 'bonifico generico', cents: 11400 }), { today });
  assert.equal(guess.rows[0].status, 'guess');
  assert.deepEqual(guess.rows[0].candidates.map((c) => c.number), ['5/2027']);
  // una data futura nell'estratto si porta a oggi; le fatture stornate o bozze non si propongono
  const future = matchStatement(app.db, stmt({ text: 'Fattura 1/2027', cents: 5600, date: '2027-03-01' }), { today });
  assert.equal(future.rows[0].date, today);
  assert.equal(future.rows[0].bankDate, '2027-03-01');
  app.db.prepare('UPDATE invoices SET credited = 1 WHERE id = ?').run(i1.id);
  assert.equal(matchStatement(app.db, stmt({ text: 'Fattura 1/2027', cents: 5600 }), { today }).rows[0].status, 'none');
  assert.equal(getInvoice(app.db, i1.id).credited, 1);
  app.cleanup();
});
