// Registrazione di un'agenzia (richiesta di accesso o invito): legge il modulo e controlla tutto in un posto solo, così le due strade non possono divergere.
import { billingProblem, readBilling } from './billing.js';
import { readPhone } from './countries.js';
import { cleanText, isEmail } from './util.js';

/**
 * @param {object} b corpo del modulo
 * @param {Function} t traduzione nella lingua della pagina (per l'errore)
 * @param {{ email?: string }} [opts] `email`: quella dell'invito (nel modulo non si cambia)
 * @returns {{ v: object, error: string } | { v: object, error: null, vat: object, vatId: string, phone: string }}
 *   `v` sono i valori da rimostrare nel modulo (il telefono com'è stato scritto), il resto serve a salvare l'account
 */
export function readSignup(app, b, t, { email = null } = {}) {
  const v = {
    company: cleanText(b.company, 160),
    vat: cleanText(b.vat, 40),
    website: cleanText(b.website, 200),
    contact_name: cleanText(b.contact_name, 120),
    email: email ?? cleanText(b.email, 200).toLowerCase(),
    message: cleanText(b.message, 1000),
    phone: cleanText(b.phone, 40),
    phone_cc: String(b.phone_cc ?? '').trim().toUpperCase().slice(0, 2),
    ...readBilling(b),
  };
  if (v.country !== 'IT') Object.assign(v, { tax_code: '', province: '', sdi_code: '' }); // codice fiscale, provincia e SDI valgono solo per l'Italia
  const fail = (error) => ({ v, error });
  if (!v.company || !v.vat || !v.contact_name) return fail(t('err.fields'));
  if (!isEmail(v.email)) return fail(t('err.email'));
  if (String(b.password ?? '').length < 10) return fail(t('err.password'));
  const ph = readPhone(b);
  if (!ph.ok) return fail(t('err.phone'));
  const vat = app.vat.parse(v.vat, v.country);
  if (vat.country === 'IT' && app.vat.checkFormat(vat).ok === false) return fail(t('err.vat')); // una partita IVA italiana con la cifra di controllo sbagliata non passa dalla fattura elettronica
  const problem = billingProblem(v);
  if (problem) return fail(t(`err.${problem}`));
  if (v.website && !/^https?:\/\/\S+$/i.test(v.website)) return fail(t('err.fields'));
  if (!b.consent) return fail(t('err.consent'));
  return { v, error: null, vat, vatId: vat.eu && vat.id ? vat.id : v.vat, phone: ph.value }; // dentro l'UE la partita IVA si conserva in forma normale (IT01234567897)
}
