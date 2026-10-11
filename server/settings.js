// Impostazioni dell'attività modificabili dal pannello (Sito › Impostazioni).
// Sovrascrivono i valori letti dalla configurazione del server (variabili d'ambiente): si salvano nel database come
// { "percorso.nella.configurazione": valore }. I valori uguali a quelli del server non si memorizzano, così una
// modifica successiva della configurazione continua ad avere effetto. I segreti (chiavi di pagamento, password,
// posta) non passano di qui: restano nella configurazione del server.
import { validItalianVat } from './fatturapa.js';
import { getSetting, setSetting } from './db.js';
import { cleanText, isEmail } from './util.js';

const SETTING = 'config_overrides';

const ok = (value) => ({ value });
const bad = (error) => ({ error });
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** «12,5» o «12.5» → 12.5; altrimenti NaN. */
const toNumber = (raw) => {
  const s = String(raw ?? '').trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
};
const decimal = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
const range = (f) => `tra ${f.min} e ${f.max}`;

/** Ogni tipo: `parse` (testo del modulo → valore o errore) e `show` (valore → testo del modulo). */
const TYPES = {
  text: {
    parse: (raw, f) => {
      const v = cleanText(raw, f.max ?? 200).replace(/\s+/g, ' ');
      return !v && f.required ? bad('Campo obbligatorio.') : ok(v);
    },
    show: (v) => v ?? '',
  },
  textarea: {
    parse: (raw, f) => ok(cleanText(raw, f.max ?? 1000)),
    show: (v) => v ?? '',
  },
  email: {
    parse: (raw, f) => {
      const v = cleanText(raw, 254);
      if (!v) return f.required ? bad('Campo obbligatorio.') : ok('');
      return isEmail(v) ? ok(v) : bad('Indirizzo email non valido.');
    },
    show: (v) => v ?? '',
  },
  phone: {
    parse: (raw) => {
      const v = cleanText(raw, 30);
      return !v || /^\+?[0-9 ()./-]{5,30}$/.test(v) ? ok(v) : bad('Numero non valido: usa cifre e spazi, con il prefisso se vuoi (es. +39 333 123 4567).');
    },
    show: (v) => v ?? '',
  },
  digits: {
    parse: (raw) => {
      const v = String(raw ?? '').replace(/[\s+().-]/g, '');
      return !v || /^\d{8,15}$/.test(v) ? ok(v) : bad('Solo cifre, con il prefisso internazionale e senza + (es. 393331234567).');
    },
    show: (v) => v ?? '',
  },
  url: {
    parse: (raw) => {
      const v = cleanText(raw, 300);
      if (!v) return ok('');
      try {
        return /^https?:$/.test(new URL(v).protocol) ? ok(v) : bad('Indirizzo non valido: deve iniziare con https://');
      } catch {
        return bad('Indirizzo non valido: deve iniziare con https://');
      }
    },
    show: (v) => v ?? '',
  },
  vat: {
    parse: (raw) => {
      const v = cleanText(raw, 20).replace(/\s+/g, '').toUpperCase();
      if (!v) return ok('');
      return /^(IT)?\d{11}$/.test(v) && validItalianVat(v.replace(/^IT/, '')) ? ok(v) : bad('Partita IVA non valida: sono 11 cifre (con o senza IT davanti).');
    },
    show: (v) => v ?? '',
  },
  upper: {
    parse: (raw, f) => {
      const v = cleanText(raw, 200).replace(/\s+/g, '').toUpperCase();
      if (!v) return f.required ? bad('Campo obbligatorio.') : ok('');
      return v.length <= (f.max ?? 40) && f.pattern.test(v) ? ok(v) : bad(f.error ?? 'Formato non valido.');
    },
    show: (v) => v ?? '',
  },
  iban: {
    parse: (raw) => {
      const v = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
      return !v || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v) ? ok(v) : bad('IBAN non valido.');
    },
    show: (v) => v ?? '',
  },
  date: {
    parse: (raw) => {
      const v = String(raw ?? '').trim();
      if (!v) return ok('');
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? ok(v) : bad('Data non valida.');
    },
    show: (v) => v ?? '',
  },
  int: {
    parse: (raw, f) => {
      const n = toNumber(raw);
      return Number.isInteger(n) && n >= f.min && n <= f.max ? ok(n) : bad(`Inserisci un numero intero ${range(f)}.`);
    },
    show: (v) => String(v ?? ''),
  },
  eur: {
    parse: (raw, f) => {
      const n = toNumber(raw);
      return Number.isFinite(n) && n >= f.min && n <= f.max ? ok(Math.round(n * 100)) : bad(`Inserisci un importo in euro ${range(f)}.`);
    },
    show: (v) => decimal((v ?? 0) / 100),
  },
  pct: {
    parse: (raw, f) => {
      const n = toNumber(raw);
      return Number.isFinite(n) && n >= f.min && n <= f.max ? ok(Math.round(n * (f.factor ?? 1) * 100) / 100) : bad(`Inserisci una percentuale ${range(f)}.`);
    },
    show: (v, f) => decimal((v ?? 0) / (f.factor ?? 1)),
  },
  bool: {
    parse: (raw) => ok(raw === '1' || raw === 'on' || raw === true),
    show: (v) => !!v,
  },
  select: {
    parse: (raw, f) => (f.options.some(([value]) => value === String(raw ?? '')) ? ok(String(raw ?? '')) : bad('Scegli una delle opzioni.')),
    show: (v) => String(v ?? ''),
  },
};

const REGIMES = [['RF19', 'Regime forfettario (RF19)'], ['RF01', 'Regime ordinario (RF01)'], ['RF02', 'Contribuenti minimi (RF02)']];

export const SECTIONS = [
  {
    id: 'business',
    title: 'Attività e contatti',
    intro: 'Compaiono nel sito, nelle email, nei voucher e nei PDF.',
    fields: [
      { key: 'site.name', type: 'text', max: 80, required: true, label: 'Nome mostrato sul sito', hint: 'anche nelle email e nei voucher' },
      { key: 'site.legalName', type: 'text', max: 120, label: 'Nome per i documenti', hint: 'ragione sociale oppure nome e cognome: piè di pagina e PDF' },
      { key: 'site.email', type: 'email', required: true, label: 'Email di contatto' },
      { key: 'mail.notifyTo', type: 'email', label: 'Email che riceve le notifiche', hint: 'nuove prenotazioni, richieste, messaggi; vuota = nessuna notifica' },
      { key: 'site.phone', type: 'phone', label: 'Telefono' },
      { key: 'site.whatsapp', type: 'digits', label: 'WhatsApp', hint: 'solo cifre con prefisso, es. 393331234567; vuoto = nascosto' },
      { key: 'site.instagram', type: 'url', label: 'Pagina Instagram', hint: 'indirizzo completo; vuoto = nascosto' },
      { key: 'site.vatNumber', type: 'vat', label: 'Partita IVA', hint: 'compare nel piè di pagina e nelle fatture' },
      { key: 'site.guideLicense', type: 'text', max: 120, label: 'Abilitazione di guida turistica', hint: 'es. n. 1234, Città metropolitana di Venezia' },
      { key: 'site.address', type: 'text', max: 200, label: 'Indirizzo della sede', hint: 'piè di pagina e PDF' },
    ],
  },
  {
    id: 'rules',
    title: 'Regole di prenotazione',
    intro: 'Valgono per le nuove prenotazioni. Le prenotazioni già fatte conservano le condizioni di quando sono state fatte.',
    fields: [
      { key: 'policy.b2cFreeCancelHours', type: 'int', min: 0, max: 2000, unit: 'ore', label: 'Cancellazione gratuita: privati', hint: 'fino a quante ore prima dell’inizio (0 = fino all’inizio)' },
      { key: 'policy.b2bFreeCancelHours', type: 'int', min: 0, max: 2000, unit: 'ore', label: 'Cancellazione gratuita: partner', hint: 'valore predefinito: ogni partner può averne uno suo nella sua scheda' },
      { key: 'policy.b2cMinNoticeHours', type: 'int', min: 0, max: 720, unit: 'ore', label: 'Preavviso minimo: privati', hint: 'quanto prima dell’inizio si può ancora prenotare' },
      { key: 'policy.b2bMinNoticeHours', type: 'int', min: 0, max: 720, unit: 'ore', label: 'Preavviso minimo: partner' },
      { key: 'policy.maxAdvanceDays', type: 'int', min: 1, max: 730, unit: 'giorni', label: 'Prenotazioni aperte fino a', hint: 'quanti giorni in avanti si può prenotare' },
      { key: 'policy.bufferMin', type: 'int', min: 0, max: 240, unit: 'minuti', label: 'Pausa tra due servizi' },
      { key: 'policy.slotStepMin', type: 'int', min: 5, max: 180, unit: 'minuti', label: 'Passo degli orari liberi', hint: 'per i servizi a orario libero: ogni quanti minuti si può iniziare' },
      { key: 'policy.holdMinutes', type: 'int', min: 10, max: 180, unit: 'minuti', label: 'Blocco dell’orario durante il pagamento', hint: 'se non si paga entro questo tempo l’orario si libera' },
      { key: 'policy.allowPayOnSite', type: 'bool', label: 'Consenti di pagare il giorno del servizio', hint: 'i privati prenotano senza pagare online: più comodo per loro, più rischio di assenze' },
    ],
  },
  {
    id: 'extras',
    title: 'Buoni regalo, programmi e recensioni',
    fields: [
      { key: 'gift.validityMonths', type: 'int', min: 1, max: 60, unit: 'mesi', label: 'Validità dei buoni regalo' },
      { key: 'gift.minCents', type: 'eur', min: 5, max: 1000, unit: '€', label: 'Buono regalo: importo minimo' },
      { key: 'gift.maxCents', type: 'eur', min: 20, max: 5000, unit: '€', label: 'Buono regalo: importo massimo' },
      { key: 'program.depositPercent', type: 'pct', min: 0, max: 100, unit: '%', label: 'Acconto sui programmi di più giorni', hint: 'proposto nei preventivi' },
      { key: 'program.validityDays', type: 'int', min: 1, max: 90, unit: 'giorni', label: 'Validità di una proposta', hint: 'quanto resta valido un preventivo' },
      { key: 'reviews.enabled', type: 'bool', label: 'Chiedi una recensione dopo il tour', hint: 'email automatica il giorno dopo' },
      { key: 'reviews.googleUrl', type: 'url', label: 'Link per recensire su Google' },
      { key: 'reviews.tripadvisorUrl', type: 'url', label: 'Link per recensire su Tripadvisor' },
      { key: 'reviews.sendHour', type: 'int', min: 0, max: 23, unit: 'h', label: 'Ora di invio della richiesta', hint: 'ora di Venezia, il giorno dopo il tour' },
    ],
    check(v, errors) {
      if (!errors['gift.minCents'] && !errors['gift.maxCents'] && v['gift.minCents'] > v['gift.maxCents']) errors['gift.maxCents'] = 'Il massimo deve essere almeno pari al minimo.';
    },
  },
  {
    id: 'invoice',
    title: 'Fatturazione elettronica',
    intro: 'I dati fiscali vanno concordati con il commercialista: il sito non verifica la correttezza delle scelte (regime, IVA, natura, bollo, ritenuta). Le credenziali della PEC restano nella configurazione del server.',
    fields: [
      { group: 'Intestatario', key: 'invoice.seller.name', type: 'text', max: 80, label: 'Denominazione', hint: 'solo se emetti come società; altrimenti lascia vuoto' },
      { key: 'invoice.seller.firstName', type: 'text', max: 60, label: 'Nome' },
      { key: 'invoice.seller.lastName', type: 'text', max: 60, label: 'Cognome' },
      { key: 'invoice.seller.fiscalCode', type: 'upper', max: 16, pattern: /^([A-Z0-9]{16}|\d{11})$/, error: 'Codice fiscale non valido (16 caratteri, o 11 cifre per le società).', label: 'Codice fiscale' },
      { key: 'invoice.seller.regime', type: 'select', options: REGIMES, label: 'Regime fiscale', hint: 'se lo cambi controlla anche IVA, natura e diciture qui sotto' },
      { key: 'invoice.seller.address.street', type: 'text', max: 100, label: 'Indirizzo (via e numero)' },
      { key: 'invoice.seller.address.zip', type: 'upper', max: 5, pattern: /^\d{5}$/, error: 'Il CAP ha 5 cifre.', label: 'CAP' },
      { key: 'invoice.seller.address.city', type: 'text', max: 60, label: 'Comune' },
      { key: 'invoice.seller.address.province', type: 'upper', max: 2, pattern: /^[A-Z]{2}$/, error: 'La provincia è di 2 lettere (es. VE).', label: 'Provincia' },

      { group: 'IVA e imposte', key: 'invoice.vatBp', type: 'pct', min: 0, max: 30, factor: 100, unit: '%', label: 'Aliquota IVA', hint: '0 per il regime forfettario' },
      { key: 'invoice.nature', type: 'upper', max: 5, pattern: /^(N1|N2\.[12]|N3\.[1-6]|N4|N5|N6\.[1-9]|N7)$/, error: 'Natura non valida (es. N2.2).', label: 'Natura dell’operazione', hint: 'solo se l’IVA è zero (es. N2.2 per il forfettario)' },
      { key: 'invoice.vatIncluded.b2c', type: 'bool', label: 'Prezzi ai privati comprensivi di IVA', hint: 'conta solo se l’IVA è maggiore di zero' },
      { key: 'invoice.vatIncluded.b2b', type: 'bool', label: 'Tariffe ai partner comprensive di IVA', hint: 'conta solo se l’IVA è maggiore di zero' },
      { key: 'invoice.bollo', type: 'select', options: [['auto', 'Automatico: 2 € sulle operazioni senza IVA oltre 77,47 €'], ['never', 'Mai']], label: 'Bollo virtuale' },
      { key: 'invoice.contributionPercent', type: 'pct', min: 0, max: 10, unit: '%', label: 'Rivalsa INPS', hint: '0 = nessuna; proposta nelle fatture alle imprese' },
      { key: 'invoice.withholdingPercent', type: 'pct', min: 0, max: 30, unit: '%', label: 'Ritenuta d’acconto', hint: '0 = nessuna; proposta nelle fatture alle imprese italiane' },
      { key: 'invoice.withholdingCause', type: 'upper', max: 2, pattern: /^[A-Z]{1,2}$/, error: 'Causale non valida (es. A).', label: 'Causale della ritenuta', hint: 'A = lavoro autonomo' },
      { key: 'invoice.notes', type: 'textarea', max: 800, label: 'Diciture in fattura', hint: 'più diciture separate da |' },
      { key: 'invoice.legalReference', type: 'text', max: 200, label: 'Riferimento normativo' },

      { group: 'Pagamenti e tempi', key: 'invoice.iban', type: 'iban', label: 'IBAN per i bonifici', hint: 'compare nelle fatture pagate a bonifico' },
      { key: 'invoice.bank', type: 'text', max: 80, label: 'Banca' },
      { key: 'invoice.b2bDueDays', type: 'int', min: 0, max: 180, unit: 'giorni', label: 'Scadenza delle fatture ai partner' },
      { key: 'invoice.giftInvoiceAt', type: 'select', options: [['sale', 'Alla vendita (buono monouso)'], ['redemption', 'All’utilizzo (buono multiuso)']], label: 'Buoni regalo: quando fatturare' },
      { key: 'invoice.startDate', type: 'date', label: 'Prima data fatturabile', hint: 'es. il giorno di apertura della partita IVA: prima non si fattura nulla' },
    ],
  },
];

export function createSettings({ cfg, db }) {
  const fields = SECTIONS.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.id })));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const base = Object.fromEntries(fields.map((f) => [f.key, structuredClone(getPath(cfg, f.key))]));
  let overrides = {};

  /** Il valore salvato ha il tipo giusto per il suo campo? (il database lo scriviamo noi, ma non ci si fida a occhi chiusi) */
  const sane = (f, v) => {
    if (f.type === 'bool') return typeof v === 'boolean';
    if (['int', 'eur', 'pct'].includes(f.type)) return typeof v === 'number' && Number.isFinite(v);
    if (f.type === 'select') return f.options.some(([o]) => o === v);
    return typeof v === 'string';
  };
  /** Il valore scelto per un campo: quello del pannello se c'è, altrimenti quello della configurazione del server. */
  const value = (key) => (key in overrides ? overrides[key] : structuredClone(base[key]));
  const load = () => {
    const stored = getSetting(db, SETTING, {});
    overrides = {};
    for (const [k, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) if (byKey.has(k) && sane(byKey.get(k), v)) overrides[k] = v;
  };
  const apply = () => {
    for (const f of fields) setPath(cfg, f.key, value(f.key));
  };
  const persist = () => {
    setSetting(db, SETTING, overrides);
    apply();
  };
  load();
  apply();

  const optionsOf = (f) => (f.key === 'invoice.seller.regime' && !f.options.some(([o]) => o === value(f.key)) ? [...f.options, [value(f.key), `Altro regime (${value(f.key)})`]] : f.options);

  return {
    sections: SECTIONS,
    /** Le sezioni con i valori in uso, pronti per il modulo. `posted` sono i valori scritti a mano in un salvataggio non riuscito. */
    describe({ posted = {}, errors = {} } = {}) {
      return SECTIONS.map((s) => ({
        ...s,
        fields: s.fields.map((f) => {
          const type = TYPES[f.type];
          const shown = f.key in posted ? posted[f.key] : type.show(value(f.key), f);
          return { ...f, options: f.options ? optionsOf(f) : undefined, value: shown, error: errors[f.key] ?? '', changed: !same(value(f.key), base[f.key]), base: type.show(base[f.key], f) };
        }),
        changed: s.fields.some((f) => !same(value(f.key), base[f.key])),
      }));
    },
    /** Salva una sezione. Ritorna { ok: true } oppure { ok: false, errors } senza modificare nulla. Cambiano solo i campi toccati. */
    save(sectionId, body = {}) {
      const section = SECTIONS.find((s) => s.id === sectionId);
      if (!section) return { ok: false, errors: {}, unknown: true };
      const errors = {};
      const parsed = {};
      for (const f of section.fields) {
        const raw = f.type === 'bool' ? (body[f.key] ? '1' : '') : body[f.key];
        const r = TYPES[f.type].parse(raw ?? '', f);
        if (r.error) errors[f.key] = r.error;
        else parsed[f.key] = r.value;
      }
      section.check?.(parsed, errors);
      if (Object.keys(errors).length) return { ok: false, errors };
      // se le notifiche andavano all'email di contatto e si cambia solo questa, le notifiche la seguono
      const linked = value('mail.notifyTo') && value('mail.notifyTo') === value('site.email');
      if (linked && 'site.email' in parsed && parsed['site.email'] !== value('site.email') && parsed['mail.notifyTo'] === value('mail.notifyTo')) parsed['mail.notifyTo'] = parsed['site.email'];
      const next = { ...overrides };
      for (const f of section.fields) {
        const v = parsed[f.key];
        if (same(v, value(f.key))) continue; // non toccato
        if (same(v, base[f.key])) delete next[f.key];
        else next[f.key] = v;
      }
      overrides = next;
      persist();
      return { ok: true };
    },
    /** Torna ai valori della configurazione del server per tutta la sezione. */
    reset(sectionId) {
      const section = SECTIONS.find((s) => s.id === sectionId);
      if (!section) return false;
      for (const f of section.fields) delete overrides[f.key];
      persist();
      return true;
    },
  };
}
