// Dati di fatturazione di un'azienda partner: si chiedono tutti alla registrazione (e si possono completare o correggere dopo, dall'area dell'agenzia
// e dalla scheda del partner), così in fattura è già tutto compilato. Le regole sono quelle della fattura elettronica (vedi fatturapa.js).
import { isCountry } from './countries.js';
import { validCompanyTaxCode, validPersonTaxCode } from './fatturapa.js';
import { cleanText, isEmail } from './util.js';

/** I campi del modulo, puliti (la partita IVA e il telefono hanno le loro regole e non stanno qui). */
export const readBilling = (b) => ({
  country: String(b.country ?? '').trim().toUpperCase(),
  tax_code: cleanText(b.tax_code, 30).replace(/\s+/g, '').toUpperCase(),
  address: cleanText(b.address, 120),
  zip: cleanText(b.zip, 12).toUpperCase(),
  city: cleanText(b.city, 80),
  province: cleanText(b.province, 3).toUpperCase(),
  sdi_code: cleanText(b.sdi_code, 10).toUpperCase(),
  pec: cleanText(b.pec, 200).toLowerCase(),
});

const sdiOk = (v) => /^[A-Z0-9]{7}$/.test(v.sdi_code);

/**
 * Cosa non va nei dati di fatturazione, come chiavi (le stesse delle frasi `err.<chiave>` e delle etichette di `BILLING_LABEL`), nell'ordine del modulo.
 * Per l'Italia servono anche codice fiscale, provincia e SDI o PEC; fuori dall'Italia bastano indirizzo, codice postale e città.
 */
export function billingProblems(v) {
  const out = [];
  if (!isCountry(v.country)) out.push('country');
  const it = v.country === 'IT';
  if (String(v.address ?? '').trim().length < 3) out.push('address');
  if (it ? !/^\d{5}$/.test(v.zip ?? '') : !/^[A-Z0-9][A-Z0-9 -]{1,10}$/i.test(v.zip ?? '')) out.push('zip');
  if (!String(v.city ?? '').trim()) out.push('city');
  if (it) {
    if (!/^[A-Za-z]{2}$/.test(v.province ?? '')) out.push('province');
    if (!(validPersonTaxCode(v.tax_code ?? '') || validCompanyTaxCode(v.tax_code ?? ''))) out.push('taxCode');
    if (v.pec && !isEmail(v.pec)) out.push('pec');
    if (!sdiOk(v) && !isEmail(v.pec ?? '')) out.push('sdi');
  } else if (v.tax_code && !/^[A-Z0-9]{5,20}$/.test(v.tax_code)) out.push('taxCode');
  return out;
}

/** Il primo problema, o null se i dati vanno bene. */
export const billingProblem = (v) => billingProblems(v)[0] ?? null;

/** Le etichette (in italiano, per il pannello) di ciò che manca. */
export const BILLING_LABEL = { country: 'paese', address: 'indirizzo', zip: 'CAP', city: 'città', province: 'provincia', taxCode: 'codice fiscale', sdi: 'codice SDI o PEC', pec: 'PEC' };

const asValues = (a) => ({ country: a.country ?? '', tax_code: a.tax_code ?? '', address: a.address ?? '', zip: a.zip ?? '', city: a.city ?? '', province: a.province ?? '', sdi_code: a.sdi_code ?? '', pec: a.pec ?? '' });

/** I dati di fatturazione di un account (come stanno nel database) che mancano o non tornano. */
export const billingGaps = (account) => billingProblems(asValues(account));
