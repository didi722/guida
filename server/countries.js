// Elenco dei paesi per i moduli (paese dell'azienda, prefisso del telefono): nomi nella lingua di chi legge (dall'ICU di Node, nessuna traduzione
// da tenere a mano), in ordine alfabetico, con la bandiera (emoji) e il prefisso internazionale. Solo dati e regole, niente pagine.
import { LANGS } from './langs.js';

/** Codici ISO 3166-1 (più il Kosovo, XK, che non è ISO ma ha prefisso e bandiera). Senza i territori disabitati o solo scientifici (AQ BV HM UM TF GS IO). */
const CODES = `AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(/\s+/);

/** Prefisso internazionale (senza «+»). I paesi con prefisso +1 condiviso hanno il loro numero d'area, così «+1 876…» è la Giamaica. */
const DIAL = {
  AD: '376', AE: '971', AF: '93', AG: '1268', AI: '1264', AL: '355', AM: '374', AO: '244', AR: '54', AS: '1684', AT: '43', AU: '61', AW: '297', AX: '358', AZ: '994',
  BA: '387', BB: '1246', BD: '880', BE: '32', BF: '226', BG: '359', BH: '973', BI: '257', BJ: '229', BL: '590', BM: '1441', BN: '673', BO: '591', BQ: '599', BR: '55', BS: '1242', BT: '975', BW: '267', BY: '375', BZ: '501',
  CA: '1', CC: '61', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225', CK: '682', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238', CW: '599', CX: '61', CY: '357', CZ: '420',
  DE: '49', DJ: '253', DK: '45', DM: '1767', DO: '1809', DZ: '213', EC: '593', EE: '372', EG: '20', EH: '212', ER: '291', ES: '34', ET: '251',
  FI: '358', FJ: '679', FK: '500', FM: '691', FO: '298', FR: '33', GA: '241', GB: '44', GD: '1473', GE: '995', GF: '594', GG: '44', GH: '233', GI: '350', GL: '299', GM: '220', GN: '224', GP: '590', GQ: '240', GR: '30', GT: '502', GU: '1671', GW: '245', GY: '592',
  HK: '852', HN: '504', HR: '385', HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IM: '44', IN: '91', IQ: '964', IR: '98', IS: '354', IT: '39',
  JE: '44', JM: '1876', JO: '962', JP: '81', KE: '254', KG: '996', KH: '855', KI: '686', KM: '269', KN: '1869', KP: '850', KR: '82', KW: '965', KY: '1345', KZ: '7',
  LA: '856', LB: '961', LC: '1758', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370', LU: '352', LV: '371', LY: '218',
  MA: '212', MC: '377', MD: '373', ME: '382', MF: '590', MG: '261', MH: '692', MK: '389', ML: '223', MM: '95', MN: '976', MO: '853', MP: '1670', MQ: '596', MR: '222', MS: '1664', MT: '356', MU: '230', MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258',
  NA: '264', NC: '687', NE: '227', NF: '672', NG: '234', NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NU: '683', NZ: '64', OM: '968',
  PA: '507', PE: '51', PF: '689', PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PN: '64', PR: '1787', PS: '970', PT: '351', PW: '680', PY: '595', QA: '974',
  RE: '262', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677', SC: '248', SD: '249', SE: '46', SG: '65', SH: '290', SI: '386', SJ: '47', SK: '421', SL: '232', SM: '378', SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SX: '1721', SY: '963', SZ: '268',
  TC: '1649', TD: '235', TG: '228', TH: '66', TJ: '992', TK: '690', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90', TT: '1868', TV: '688', TW: '886', TZ: '255',
  UA: '380', UG: '256', US: '1', UY: '598', UZ: '998', VA: '379', VC: '1784', VE: '58', VG: '1284', VI: '1340', VN: '84', VU: '678', WF: '681', WS: '685', XK: '383', YE: '967', YT: '262', ZA: '27', ZM: '260', ZW: '263',
};

/** Quando più paesi hanno lo stesso prefisso, «+44…» scritto per esteso è il Regno Unito, «+39…» l'Italia, ecc. */
const PRIMARY = { 1: 'US', 7: 'RU', 39: 'IT', 44: 'GB', 47: 'NO', 61: 'AU', 212: 'MA', 262: 'RE', 358: 'FI', 590: 'GP', 599: 'CW' };
/** Dove lo «0» iniziale fa parte del numero anche chiamando dall'estero (+39 06…): altrove è la cifra «interurbana» da togliere. */
const KEEPS_ZERO = new Set(['IT', 'SM', 'VA']);
/** Parole in più con cui si cerca un paese (nomi comuni che non sono quelli ufficiali). */
const ALIASES = {
  US: 'usa america united states stati uniti', GB: 'uk england britain great britain scotland wales inghilterra scozia', AE: 'uae emirates dubai abu dhabi', KR: 'korea', KP: 'korea', CZ: 'czech republic repubblica ceca',
  NL: 'holland olanda paesi bassi', MK: 'macedonia', MM: 'burma birmania', SZ: 'swaziland', CI: 'ivory coast costa avorio', TL: 'east timor', CD: 'drc', RU: 'russia', VA: 'vatican holy see vaticano', CH: 'switzerland svizzera suisse schweiz',
  DE: 'germany deutschland alemania germania', ES: 'spain espana spagna', FR: 'france francia', IT: 'italy italia', JP: 'japan giappone nihon nippon', CN: 'china cina', GR: 'greece grecia', AT: 'austria osterreich',
};

const flagOf = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const plain = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const names = new Map(); // lingua → { code → nome }
const SHORT = new Set(['HK', 'MO', 'PS']); // i nomi ufficiali sono lunghissimi («RAS di Hong Kong della Cina»)
function namesIn(lang) {
  if (!names.has(lang)) {
    const long = new Intl.DisplayNames([lang], { type: 'region' });
    const short = new Intl.DisplayNames([lang], { type: 'region', style: 'short' });
    names.set(lang, Object.fromEntries(CODES.map((c) => [c, (SHORT.has(c) ? short : long).of(c) ?? c])));
  }
  return names.get(lang);
}

export const isCountry = (code) => CODES.includes(String(code ?? '').toUpperCase());
export const countryName = (code, lang = 'it') => namesIn(LANGS.includes(lang) ? lang : 'en')[String(code ?? '').toUpperCase()] ?? String(code ?? '');
export const dialOf = (code) => DIAL[String(code ?? '').toUpperCase()] ?? '';
/** Fra i paesi con lo stesso prefisso, quello che si sceglie scrivendo «+44…» per esteso. */
export const isMainOfDial = (code) => { const c = String(code ?? '').toUpperCase(); return !!DIAL[c] && countryOfDial(DIAL[c]) === c; };

const lists = new Map();
/**
 * Tutti i paesi in ordine alfabetico nella lingua data: [{ code, name, flag, dial, search }].
 * `search` è ciò che si digita per trovarli: il nome in tutte le lingue del sito, la sigla, il prefisso, qualche nome comune (senza maiuscole né accenti).
 */
export function countries(lang = 'it') {
  const l = LANGS.includes(lang) ? lang : 'en';
  if (!lists.has(l)) {
    const collator = new Intl.Collator(l);
    const rows = CODES.map((code) => ({
      code,
      name: namesIn(l)[code],
      flag: flagOf(code),
      dial: DIAL[code] ?? '',
      search: plain([...LANGS.map((x) => namesIn(x)[code]), code, DIAL[code] ? `+${DIAL[code]} ${DIAL[code]}` : '', ALIASES[code] ?? ''].join(' ')),
    }));
    lists.set(l, rows.sort((a, b) => collator.compare(a.name, b.name)));
  }
  return lists.get(l);
}

// ───────────── telefono ─────────────
const DIAL_CODES = [...new Set(Object.values(DIAL))].sort((a, b) => b.length - a.length); // dal più lungo: «1876» prima di «1»
function countryOfDial(dial) {
  return PRIMARY[dial] ?? Object.keys(DIAL).find((c) => DIAL[c] === dial);
}

/**
 * Un numero di telefono scritto in un modulo, con il paese scelto a parte (`cc`, sigla ISO). Lo riduce a «+prefisso cifre».
 * Se è scritto per esteso («+39 …», «0039 …») conta il prefisso scritto, non il paese scelto.
 * @returns {{ empty: true } | { error: 'prefix'|'invalid' } | { ok: true, value: string, dial: string, national: string, country: string }}
 */
export function normalizePhone(input, cc = '') {
  const raw = String(input ?? '').trim();
  if (!raw) return { empty: true };
  const digits = raw.replace(/[^\d+]/g, '');
  const intl = digits.startsWith('+') || digits.startsWith('00');
  const all = digits.replace(/\D/g, '').slice(digits.startsWith('+') ? 0 : intl ? 2 : 0);
  let dial;
  let country;
  let national;
  if (intl) {
    dial = DIAL_CODES.find((d) => all.startsWith(d) && all.length - d.length >= 4);
    if (!dial) return { error: 'prefix' };
    country = countryOfDial(dial);
    national = all.slice(dial.length);
  } else {
    country = String(cc ?? '').toUpperCase();
    dial = DIAL[country];
    if (!dial) return { error: 'prefix' };
    national = all;
  }
  if (!KEEPS_ZERO.has(country)) national = national.replace(/^0+/, ''); // +44 (0)7911… e 07911… sono +44 7911…
  if (country === 'IT' && national.length === 12 && national.startsWith('39')) national = national.slice(2); // «393331234567» con l'Italia scelta: il 39 c'era già
  if (national.length < 4 || dial.length + national.length > 15) return { error: 'invalid' };
  const shown = dial.length === 4 && dial.startsWith('1') ? `+1 ${dial.slice(1)}` : `+${dial}`; // +1 876 5551234 (numero d'area dei Caraibi)
  return { ok: true, value: `${shown} ${national}`, dial, national, country };
}

/** Un telefono salvato, per rimetterlo nel modulo: paese scelto e resto del numero. Un numero vecchio, senza prefisso, resta com'è (con il paese di partenza). */
export function splitPhone(value, fallbackCc = '') {
  const raw = String(value ?? '').trim();
  if (/^(\+|00)/.test(raw)) {
    const r = normalizePhone(raw);
    if (r.ok) return { cc: r.country, national: r.national };
  }
  return { cc: fallbackCc, national: raw };
}

/** Il numero e il suo paese, dai campi del modulo (`phone` e `phone_cc`). */
export const readPhone = (body, key = 'phone') => normalizePhone(body?.[key], body?.[`${key}_cc`]);

/**
 * Un telefono facoltativo del modulo: vuoto va bene (`value: ''`), scritto va bene solo se ha il prefisso (`error: true` altrimenti).
 * @returns {{ value: string, error?: true }}
 */
export function optionalPhone(body, key = 'phone') {
  const r = readPhone(body, key);
  return r.ok ? { value: r.value } : r.empty ? { value: '' } : { value: '', error: true };
}

/** Il paese suggerito in un modulo secondo la lingua della pagina (per l'inglese non si indovina: si sceglie). */
export const LANG_COUNTRY = { it: 'IT', es: 'ES', ja: 'JP' };
