// FatturaPA: la fattura elettronica italiana (formato FPR12, verso imprese e privati).
// Questo file è puro: controlli formali, calcolo degli importi e generazione dell'XML. Niente database, niente rete.
//
// ATTENZIONE: regime fiscale, natura IVA, bollo, rivalsa e ritenuta vanno concordati con il commercialista.
// Il file XML generato qui è controllato dai test contro lo schema FatturaPA, ma solo il Sistema di Interscambio
// (SdI) applica tutti i controlli di merito.

// ───────────── controlli formali ─────────────
/** Partita IVA italiana: 11 cifre con cifra di controllo. */
export function validItalianVat(digits) {
  if (!/^\d{11}$/.test(String(digits))) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const CF_ODD = Object.fromEntries([...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [c, [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23][i]]));
const CF_EVEN = Object.fromEntries([...'0123456789'].map((c, i) => [c, i]).concat([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) => [c, i])));

/** Codice fiscale di persona fisica (16 caratteri con carattere di controllo; ammesse le lettere dell'omocodia). */
export function validPersonTaxCode(code) {
  const cf = String(code).toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? CF_ODD[cf[i]] : CF_EVEN[cf[i]];
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[sum % 26] === cf[15];
}

/** Codice fiscale di un soggetto non persona fisica: coincide con la partita IVA (11 cifre). */
export const validCompanyTaxCode = (code) => validItalianVat(String(code));

// ───────────── testo adatto all'XML ─────────────
const LATIN1_CHAR = /[\x20-\x7E\xA0-\xFF]/;
const SIMPLE = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T', ı: 'i', œ: 'oe', Œ: 'OE', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '€': 'EUR', '→': '-' };

/** Testo ammesso dallo schema (solo Basic Latin e Latin-1): toglie gli accenti non ammessi (ł→l, č→c…), scarta emoji e simboli. */
export function latin1(input, max = Number.POSITIVE_INFINITY) {
  let out = '';
  for (const ch of String(input ?? '').normalize('NFC')) {
    if (LATIN1_CHAR.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += ' ';
    else if (SIMPLE[ch] !== undefined) out += SIMPLE[ch];
    else {
      const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
      if (base && [...base].every((c) => LATIN1_CHAR.test(c))) out += base;
      else if (/\p{L}/u.test(ch)) out += '?';
    }
  }
  return out.replace(/ {2,}/g, ' ').trim().slice(0, max).trim();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Importo in centesimi → "1234.50". */
export function amt(cents) {
  const n = Math.round(cents);
  const abs = Math.abs(n);
  return `${n < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
/** Punti base → "22.00". */
export const rate = (bp) => amt(bp);

// ───────────── importi ─────────────
/** Divide il lordo di più righe in netto + IVA: il netto totale è esatto e i centesimi si assegnano col metodo del resto più grande. */
export function splitNet(grossList, vatBp) {
  const gross = grossList.reduce((a, b) => a + b, 0);
  const totalNet = Math.round((gross * 10000) / (10000 + vatBp));
  const raw = grossList.map((g) => (g * 10000) / (10000 + vatBp));
  const nets = raw.map(Math.floor);
  let rest = totalNet - nets.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length, rest--) nets[order[k][1]] += 1;
  return nets;
}

export const BOLLO_CENTS = 200;
export const BOLLO_THRESHOLD_CENTS = 7747; // 77,47 €: sopra questa soglia, sulle operazioni senza IVA va il bollo da 2 €

/**
 * Calcola importi, riepiloghi e totali di un documento.
 * input: {
 *   lines: [{ description, amountCents, [sourceKey] }],       importi positivi (lordi se vatIncluded, altrimenti netti)
 *   vatBp: 2200 | 0, nature: 'N2.2' (se vatBp = 0), vatIncluded: boolean,
 *   bolloMode: 'never' | 'auto', bolloCharged: boolean,        bollo: "auto" lo applica se dovuto
 *   contributionPercent: 0 | 4, contributionType: 'TC22',      rivalsa/cassa previdenziale (solo se importi netti)
 *   withholdingPercent: 0 | 20, withholdingType: 'RT01', withholdingCause: 'A',
 *   targetTotalCents: number | null,                           totale pagato dal cliente: l'eventuale scarto di centesimi va in Arrotondamento
 *   isCreditNote: boolean
 * }
 */
export function computeDocument(input) {
  const { vatBp = 0, nature = null, vatIncluded = false } = input;
  const amounts = input.lines.map((l) => Math.round(l.amountCents));
  if (!amounts.length) throw new Error('nessuna riga');
  if (amounts.some((a) => !Number.isInteger(a) || a <= 0)) throw new Error('gli importi delle righe devono essere positivi');
  if (vatBp > 0 && nature) throw new Error('la natura si indica solo con aliquota 0');
  if (vatBp === 0 && !nature) throw new Error('con aliquota 0 serve la natura dell’operazione');

  const nets = vatBp > 0 && vatIncluded ? splitNet(amounts, vatBp) : amounts;
  const percent = (v) => Math.max(0, Number(v) || 0);
  const contributionPct = percent(input.contributionPercent);
  const withholdingPct = percent(input.withholdingPercent);
  if (vatIncluded && contributionPct) throw new Error('la rivalsa non si applica a importi già comprensivi di IVA');

  const lines = input.lines.map((l, i) => ({ description: l.description, sourceKey: l.sourceKey ?? null, grossCents: amounts[i], netCents: nets[i], vatBp, nature, withholding: withholdingPct > 0 }));
  const servicesCents = nets.reduce((a, b) => a + b, 0);
  const contributionCents = contributionPct ? Math.round((servicesCents * contributionPct) / 100) : 0;
  const contribution = contributionCents ? { type: input.contributionType ?? 'TC22', percent: contributionPct, cents: contributionCents, baseCents: servicesCents, vatBp, nature } : null;

  // bollo virtuale: dovuto sulle operazioni senza IVA oltre 77,47 € (non sulle note di credito)
  const taxableMain = servicesCents + contributionCents;
  const bolloDue = !input.isCreditNote && input.bolloMode !== 'never' && vatBp === 0 && taxableMain > BOLLO_THRESHOLD_CENTS;
  const bolloCents = bolloDue ? BOLLO_CENTS : 0;
  const bolloCharged = bolloDue && !!input.bolloCharged;
  if (bolloCharged) lines.push({ description: 'Imposta di bollo assolta in modo virtuale', sourceKey: null, grossCents: BOLLO_CENTS, netCents: BOLLO_CENTS, vatBp: 0, nature: 'N1', withholding: false, isBollo: true });

  const summary = [{ vatBp, nature, taxableCents: taxableMain, vatCents: vatBp ? Math.round((taxableMain * vatBp) / 10000) : 0 }];
  if (bolloCharged) summary.push({ vatBp: 0, nature: 'N1', taxableCents: BOLLO_CENTS, vatCents: 0 });

  const taxableCents = summary.reduce((a, s) => a + s.taxableCents, 0);
  const vatCents = summary.reduce((a, s) => a + s.vatCents, 0);
  const computedTotal = taxableCents + vatCents;
  let roundingCents = 0;
  let totalCents = computedTotal;
  if (input.targetTotalCents != null) {
    roundingCents = input.targetTotalCents - computedTotal;
    if (Math.abs(roundingCents) > 5) throw new Error(`il totale (${computedTotal}) si discosta troppo da quanto pagato (${input.targetTotalCents})`);
    totalCents = input.targetTotalCents;
  }
  const withholdingCents = withholdingPct ? Math.round((servicesCents * withholdingPct) / 100) : 0;
  const withholding = withholdingCents ? { type: input.withholdingType ?? 'RT01', cause: input.withholdingCause ?? 'A', percent: withholdingPct, cents: withholdingCents } : null;

  return { lines, summary, contribution, bolloCents, bolloCharged, withholding, servicesCents, contributionCents, taxableCents, vatCents, roundingCents, totalCents, withholdingCents, payableCents: totalCents - withholdingCents };
}

// ───────────── controlli sui soggetti ─────────────
/** Problemi formali dei dati dell'intestatario (lista di messaggi in italiano; vuota = a posto). */
export function buyerProblems(b) {
  const out = [];
  const person = b.kind === 'person';
  if (person) {
    if (!latin1(b.firstName) || !latin1(b.lastName)) out.push('Indica nome e cognome.');
  } else if (!latin1(b.name)) out.push('Indica la denominazione.');
  const country = String(b.country ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) out.push('Il paese deve essere un codice di due lettere (es. IT, DE, US).');
  const vat = String(b.vat ?? '').replace(/\s+/g, '').toUpperCase();
  const tax = String(b.taxCode ?? '').replace(/\s+/g, '').toUpperCase();
  if (country === 'IT') {
    if (vat && !validItalianVat(vat)) out.push('La partita IVA italiana non è valida (11 cifre, con cifra di controllo).');
    if (tax && !(validPersonTaxCode(tax) || validCompanyTaxCode(tax))) out.push('Il codice fiscale non è valido.');
    if (person && !tax) out.push('Per un cliente italiano privato serve il codice fiscale.');
    if (!person && !vat) out.push('Per un’azienda italiana serve la partita IVA.');
  } else {
    if (vat && !/^[A-Z0-9]{1,28}$/.test(vat)) out.push('L’identificativo fiscale estero può avere solo lettere e cifre (max 28).');
    if (tax && !/^[A-Z0-9]{1,16}$/.test(tax)) out.push('Il codice fiscale/identificativo può avere solo lettere e cifre (max 16).');
  }
  if (!latin1(b.address)) out.push('Indica l’indirizzo.');
  if (!latin1(b.city)) out.push('Indica il comune/città.');
  if (country === 'IT') {
    if (!/^\d{5}$/.test(String(b.zip ?? '').trim())) out.push('Il CAP italiano ha 5 cifre.');
    if (!/^[A-Za-z]{2}$/.test(String(b.province ?? '').trim())) out.push('Indica la sigla della provincia (es. VE).');
    const sdi = String(b.sdiCode ?? '').trim().toUpperCase();
    if (sdi && !/^[A-Z0-9]{7}$/.test(sdi)) out.push('Il codice destinatario SdI ha 7 caratteri (lettere e cifre).');
    const pec = String(b.pec ?? '').trim();
    if (pec && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(pec)) out.push('L’indirizzo PEC non è valido.');
  }
  return out;
}

/** Problemi dei dati del cedente (te): servono per poter emettere. */
export function sellerProblems(s) {
  const out = [];
  if (!validItalianVat(String(s.vatNumber ?? '').replace(/^IT/i, ''))) out.push('Partita IVA mancante o non valida (VAT_NUMBER).');
  if (!(validPersonTaxCode(s.fiscalCode ?? '') || validCompanyTaxCode(s.fiscalCode ?? ''))) out.push('Codice fiscale mancante o non valido (FISCAL_CODE).');
  if (!latin1(s.name) && !(latin1(s.firstName) && latin1(s.lastName))) out.push('Nome e cognome (INVOICE_FIRST_NAME, INVOICE_LAST_NAME) o denominazione (INVOICE_NAME) mancanti.');
  if (!/^RF\d{2}$/.test(String(s.regime ?? ''))) out.push('Regime fiscale mancante (INVOICE_REGIME, es. RF19 forfettario o RF01 ordinario).');
  const a = s.address ?? {};
  if (!latin1(a.street)) out.push('Indirizzo mancante (INVOICE_ADDRESS).');
  if (!/^\d{5}$/.test(String(a.zip ?? ''))) out.push('CAP mancante o non valido (INVOICE_ZIP).');
  if (!latin1(a.city)) out.push('Comune mancante (INVOICE_CITY).');
  if (!/^[A-Za-z]{2}$/.test(String(a.province ?? ''))) out.push('Provincia mancante (INVOICE_PROVINCE, es. VE).');
  if (s.vatBp > 0 && s.nature) out.push('Con aliquota IVA maggiore di zero non va indicata la natura.');
  if (s.vatBp === 0 && !/^N[1-7](\.[1-9])?$/.test(String(s.nature ?? ''))) out.push('Con IVA a zero serve la natura dell’operazione (INVOICE_NATURE, es. N2.2).');
  return out;
}

// ───────────── destinatario ─────────────
/** CodiceDestinatario / PECDestinatario in base all'intestatario. */
export function recipientRouting(b) {
  const country = String(b.country ?? 'IT').toUpperCase();
  if (country !== 'IT') return { code: 'XXXXXXX', pec: null };
  const sdi = String(b.sdiCode ?? '').trim().toUpperCase();
  if (sdi && sdi !== '0000000') return { code: sdi, pec: null };
  const pec = String(b.pec ?? '').trim();
  return { code: '0000000', pec: pec || null };
}

// ───────────── XML ─────────────
const NS = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';

function tag(name, value, indent) {
  return value == null || value === '' ? '' : `${'  '.repeat(indent)}<${name}>${esc(value)}</${name}>\n`;
}
function open(name, indent) {
  return `${'  '.repeat(indent)}<${name}>\n`;
}
function close(name, indent) {
  return `${'  '.repeat(indent)}</${name}>\n`;
}

function party(p, indent, { isBuyer = false } = {}) {
  const country = String(p.country ?? 'IT').toUpperCase();
  const vat = String(p.vat ?? '').replace(/\s+/g, '').toUpperCase().replace(/^IT(?=\d{11}$)/, '');
  const tax = String(p.taxCode ?? '').replace(/\s+/g, '').toUpperCase();
  let x = open('DatiAnagrafici', indent);
  // intestatario estero senza identificativo fiscale: 0000000
  const idCode = vat || (isBuyer && country !== 'IT' && !tax ? '0000000' : '');
  if (idCode) {
    x += open('IdFiscaleIVA', indent + 1) + tag('IdPaese', country, indent + 2) + tag('IdCodice', idCode, indent + 2) + close('IdFiscaleIVA', indent + 1);
  }
  x += tag('CodiceFiscale', tax, indent + 1);
  x += open('Anagrafica', indent + 1);
  if (p.kind === 'person') x += tag('Nome', latin1(p.firstName, 60), indent + 2) + tag('Cognome', latin1(p.lastName, 60), indent + 2);
  else x += tag('Denominazione', latin1(p.name, 80), indent + 2);
  x += close('Anagrafica', indent + 1);
  if (!isBuyer) x += tag('RegimeFiscale', p.regime, indent + 1);
  x += close('DatiAnagrafici', indent);
  return x;
}

function address(p, indent) {
  const country = String(p.country ?? 'IT').toUpperCase();
  let x = open('Sede', indent);
  x += tag('Indirizzo', latin1(p.address, 60), indent + 1);
  x += tag('CAP', country === 'IT' ? String(p.zip).trim() : '00000', indent + 1);
  x += tag('Comune', latin1(p.city, 60), indent + 1);
  if (country === 'IT') x += tag('Provincia', String(p.province).trim().toUpperCase(), indent + 1);
  x += tag('Nazione', country, indent + 1);
  x += close('Sede', indent);
  return x;
}

/** Spezza un testo in blocchi da al massimo 200 caratteri (limite di ogni Causale), andando a capo sugli spazi. */
export function causaleChunks(text) {
  const out = [];
  let rest = latin1(text);
  while (rest.length > 200) {
    let cut = rest.lastIndexOf(' ', 200);
    if (cut < 100) cut = 200;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Genera il file XML.
 * input: { progressive, seller, buyer, type: 'TD01'|'TD04', date, number, currency, calc (computeDocument), causali: [..],
 *          related?: { number, date }, payments?: [{ method, cents, dueDate, iban, bank }], legalReference? }
 */
export function buildInvoiceXml(input) {
  const { seller, buyer, calc } = input;
  const sellerVat = String(seller.vatNumber).replace(/^IT/i, '');
  const routing = recipientRouting(buyer);
  const sellerParty = { ...seller, country: 'IT', vat: sellerVat, taxCode: seller.fiscalCode, kind: seller.name ? 'company' : 'person', address: seller.address.street, zip: seller.address.zip, city: seller.address.city, province: seller.address.province };

  let x = '<?xml version="1.0" encoding="UTF-8"?>\n';
  x += `<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="${NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${NS} http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">\n`;

  // ── intestazione
  x += open('FatturaElettronicaHeader', 1);
  x += open('DatiTrasmissione', 2);
  x += open('IdTrasmittente', 3) + tag('IdPaese', 'IT', 4) + tag('IdCodice', sellerVat, 4) + close('IdTrasmittente', 3);
  x += tag('ProgressivoInvio', input.progressive, 3) + tag('FormatoTrasmissione', 'FPR12', 3) + tag('CodiceDestinatario', routing.code, 3) + tag('PECDestinatario', routing.pec, 3);
  x += close('DatiTrasmissione', 2);

  x += open('CedentePrestatore', 2) + party(sellerParty, 3);
  x += address({ ...sellerParty, country: 'IT' }, 3);
  const phone = String(seller.phone ?? '').replace(/[^\d+]/g, '');
  if ((phone.length >= 5 && phone.length <= 12) || seller.email) {
    x += open('Contatti', 3) + (phone.length >= 5 && phone.length <= 12 ? tag('Telefono', phone, 4) : '') + (seller.email && String(seller.email).length >= 7 ? tag('Email', seller.email, 4) : '') + close('Contatti', 3);
  }
  x += close('CedentePrestatore', 2);

  x += open('CessionarioCommittente', 2) + party(buyer, 3, { isBuyer: true }) + address(buyer, 3) + close('CessionarioCommittente', 2);
  x += close('FatturaElettronicaHeader', 1);

  // ── corpo
  x += open('FatturaElettronicaBody', 1);
  x += open('DatiGenerali', 2) + open('DatiGeneraliDocumento', 3);
  x += tag('TipoDocumento', input.type, 4) + tag('Divisa', input.currency ?? 'EUR', 4) + tag('Data', input.date, 4) + tag('Numero', input.number, 4);
  if (calc.withholding) {
    const w = calc.withholding;
    x += open('DatiRitenuta', 4) + tag('TipoRitenuta', w.type, 5) + tag('ImportoRitenuta', amt(w.cents), 5) + tag('AliquotaRitenuta', amt(Math.round(w.percent * 100)), 5) + tag('CausalePagamento', w.cause, 5) + close('DatiRitenuta', 4);
  }
  if (calc.bolloCents) x += open('DatiBollo', 4) + tag('BolloVirtuale', 'SI', 5) + tag('ImportoBollo', amt(calc.bolloCents), 5) + close('DatiBollo', 4);
  if (calc.contribution) {
    const c = calc.contribution;
    x += open('DatiCassaPrevidenziale', 4) + tag('TipoCassa', c.type, 5) + tag('AlCassa', amt(Math.round(c.percent * 100)), 5) + tag('ImportoContributoCassa', amt(c.cents), 5) + tag('ImponibileCassa', amt(c.baseCents), 5) + tag('AliquotaIVA', rate(c.vatBp), 5) + (c.nature ? tag('Natura', c.nature, 5) : '') + close('DatiCassaPrevidenziale', 4);
  }
  x += tag('ImportoTotaleDocumento', amt(calc.totalCents), 4);
  if (calc.roundingCents) x += tag('Arrotondamento', amt(calc.roundingCents), 4);
  for (const c of input.causali ?? []) for (const part of causaleChunks(c)) x += tag('Causale', part, 4);
  x += close('DatiGeneraliDocumento', 3);
  if (input.related) x += open('DatiFattureCollegate', 3) + tag('IdDocumento', latin1(input.related.number, 20), 4) + tag('Data', input.related.date, 4) + close('DatiFattureCollegate', 3);
  x += close('DatiGenerali', 2);

  x += open('DatiBeniServizi', 2);
  calc.lines.forEach((l, i) => {
    x += open('DettaglioLinee', 3) + tag('NumeroLinea', i + 1, 4) + tag('Descrizione', latin1(l.description, 1000), 4) + tag('Quantita', '1.00', 4) + tag('PrezzoUnitario', amt(l.netCents), 4) + tag('PrezzoTotale', amt(l.netCents), 4) + tag('AliquotaIVA', rate(l.vatBp), 4);
    if (l.withholding) x += tag('Ritenuta', 'SI', 4);
    if (l.nature) x += tag('Natura', l.nature, 4);
    x += close('DettaglioLinee', 3);
  });
  for (const s of calc.summary) {
    x += open('DatiRiepilogo', 3) + tag('AliquotaIVA', rate(s.vatBp), 4) + (s.nature ? tag('Natura', s.nature, 4) : '') + tag('ImponibileImporto', amt(s.taxableCents), 4) + tag('Imposta', amt(s.vatCents), 4);
    if (!s.nature) x += tag('EsigibilitaIVA', 'I', 4);
    if (s.nature) x += tag('RiferimentoNormativo', latin1(s.nature === 'N1' ? 'Escluse ex art. 15 DPR 633/72' : (input.legalReference ?? 'Operazione non soggetta a IVA'), 100), 4);
    x += close('DatiRiepilogo', 3);
  }
  x += close('DatiBeniServizi', 2);

  if (input.payments?.length) {
    x += open('DatiPagamento', 2) + tag('CondizioniPagamento', 'TP02', 3);
    for (const p of input.payments) {
      x += open('DettaglioPagamento', 3) + tag('ModalitaPagamento', p.method, 4) + tag('DataScadenzaPagamento', p.dueDate, 4) + tag('ImportoPagamento', amt(p.cents), 4);
      if (p.method === 'MP05' && p.iban) x += tag('IstitutoFinanziario', latin1(p.bank, 80), 4) + tag('IBAN', String(p.iban).replace(/\s+/g, '').toUpperCase(), 4);
      x += close('DettaglioPagamento', 3);
    }
    x += close('DatiPagamento', 2);
  }
  x += close('FatturaElettronicaBody', 1);
  x += '</p:FatturaElettronica>\n';
  return x;
}

/** Nome del file da trasmettere: <IdPaese><IdCodice>_<progressivo>.xml */
export const invoiceFileName = (vatNumber, progressive) => `IT${String(vatNumber).replace(/^IT/i, '')}_${progressive}.xml`;
