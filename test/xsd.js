// Controllo di un file FatturaPA contro lo schema (copia di lavoro in test/fixtures/fatturapa).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { validateXML } = createRequire(import.meta.url)('xmllint-wasm');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fatturapa');
const schema = [{ fileName: 'Schema_FatturaPA_1.2.xsd', contents: fs.readFileSync(path.join(dir, 'Schema_FatturaPA_1.2.xsd'), 'utf8') }];
const preload = [{ fileName: 'xmldsig-core-schema.xsd', contents: fs.readFileSync(path.join(dir, 'xmldsig-core-schema.xsd'), 'utf8') }];

/** @returns {Promise<{valid: boolean, errors: string[]}>} */
export async function validateInvoiceXml(xml) {
  const r = await validateXML({ xml: [{ fileName: 'fattura.xml', contents: xml }], schema, preload });
  return { valid: r.valid, errors: r.errors.map((e) => e.message ?? e.rawMessage ?? String(e)) };
}
