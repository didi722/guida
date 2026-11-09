// Un foglio di calcolo .xlsx a una scheda, senza librerie: intestazione in grassetto e bloccata, date e importi veri (non testo),
// colonne larghe quanto serve. Serve dove un CSV si apre male: nel foglio di calcolo le date diventano «####» se la colonna è stretta,
// e un CSV non può dire quanto è larga una colonna.
import { writeZip } from './backup.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Testo adatto a XML: i caratteri speciali si scrivono come entità, quelli di controllo (che l'XML non ammette) si tolgono. */
// eslint-disable-next-line no-control-regex
const esc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** «A», «B»… «AA»: il nome di una colonna (da 0). */
const colName = (i) => {
  let n = '';
  for (let x = i + 1; x > 0; x = Math.floor((x - 1) / 26)) n = String.fromCharCode(65 + ((x - 1) % 26)) + n;
  return n;
};

/** I giorni dal 30/12/1899, come li conta il foglio di calcolo, per una data AAAA-MM-GG (null se non è una data). */
export function dateSerial(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000) : null;
}

// stili: 0 normale, 1 intestazione, 2 data (nel formato del foglio di chi lo apre), 3 importo con due decimali
const STYLES = `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * Il file .xlsx di una tabella.
 * @param {object} o
 * @param {string} o.sheet nome della scheda (al massimo 31 caratteri, senza \ / ? * [ ] :)
 * @param {{title: string, type?: 'text'|'date'|'money'|'int'}[]} o.columns `date`: AAAA-MM-GG (o vuoto); `money`: centesimi (o vuoto); `int`: numero intero
 * @param {any[][]} o.rows una riga per array, nell'ordine delle colonne
 * @returns {Promise<Buffer>}
 */
export async function xlsxBuffer({ sheet = 'Foglio', columns, rows }) {
  const cell = (c, r, value, type) => {
    const ref = `${colName(c)}${r}`;
    if (value === null || value === undefined || value === '') return '';
    if (type === 'date') {
      const n = dateSerial(value);
      return n === null ? `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>` : `<c r="${ref}" s="2"><v>${n}</v></c>`;
    }
    if (type === 'money') return `<c r="${ref}" s="3"><v>${(Number(value) / 100).toFixed(2)}</v></c>`;
    if (type === 'int' && Number.isFinite(Number(value))) return `<c r="${ref}"><v>${Math.trunc(Number(value))}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  };
  // larghezza: il testo più lungo della colonna (intestazione compresa), con un po' d'aria; date e importi hanno un minimo che basta sempre
  const widths = columns.map((col, c) => {
    const longest = Math.max(String(col.title).length, ...rows.map((r) => String(col.type === 'money' ? ((Number(r[c]) || 0) / 100).toFixed(2) : (r[c] ?? '')).length));
    const min = col.type === 'date' ? 13 : col.type === 'money' ? 14 : col.type === 'int' ? 11 : 10;
    return Math.min(70, Math.max(min, longest + 3));
  });
  const head = `<row r="1">${columns.map((col, c) => `<c r="${colName(c)}1" t="inlineStr" s="1"><is><t>${esc(col.title)}</t></is></c>`).join('')}</row>`;
  const body = rows.map((row, i) => `<row r="${i + 2}">${columns.map((col, c) => cell(c, i + 2, row[c], col.type)).join('')}</row>`).join('');
  const sheetXml = `${XML}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
  const files = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${esc(String(sheet).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ];
  const chunks = [];
  await writeZip({ write: (buf, cb) => { chunks.push(Buffer.from(buf)); cb(); } }, files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
  return Buffer.concat(chunks);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
