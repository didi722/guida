// Lettura di uno zip caricato dall'utente (quelli prodotti dal backup, ma anche ricompressi a mano):
// l'elenco dei file viene dalla directory centrale, ogni file si legge e si controlla (CRC, dimensioni) solo quando serve.
// Dello zip non ci si fida: niente cifratura né ZIP64, limiti rigidi alle dimensioni e nessuna decompressione oltre il dichiarato.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_DIRECTORY_BYTES = 32 * 1024 * 1024;

/**
 * Apre `file` e ne legge l'elenco: { entries: [{ name, method, crc, csize, usize, offset, flags }], read(entry, maxBytes), close() }.
 * Lancia ZipError se non è uno zip leggibile.
 */
export async function openZip(file, { maxEntries = 20000 } = {}) {
  const fh = await fs.open(file, 'r');
  const readAt = async (length, position) => {
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await fh.read(buf, done, length - done, position + done);
      if (!bytesRead) throw new ZipError('Lo zip è incompleto o danneggiato.');
      done += bytesRead;
    }
    return buf;
  };
  try {
    const { size } = await fh.stat();
    if (size < 22) throw new ZipError('Il file non è uno zip.');
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = await readAt(tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) <= tailLength) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError('Il file non è uno zip.');
    const count = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new ZipError('Lo zip è troppo grande o in un formato non supportato (ZIP64).');
    if (count > maxEntries) throw new ZipError('Lo zip contiene troppi file.');
    if (directoryOffset + directorySize > size || directorySize > MAX_DIRECTORY_BYTES) throw new ZipError('Lo zip è danneggiato.');
    const directory = await readAt(directorySize, directoryOffset);

    const entries = [];
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > directorySize || directory.readUInt32LE(pos) !== CENTRAL) throw new ZipError('Lo zip è danneggiato.');
      const nameLength = directory.readUInt16LE(pos + 28);
      const extraLength = directory.readUInt16LE(pos + 30);
      const commentLength = directory.readUInt16LE(pos + 32);
      if (pos + 46 + nameLength + extraLength + commentLength > directorySize) throw new ZipError('Lo zip è danneggiato.');
      entries.push({
        name: directory.toString('utf8', pos + 46, pos + 46 + nameLength),
        flags: directory.readUInt16LE(pos + 8),
        method: directory.readUInt16LE(pos + 10),
        crc: directory.readUInt32LE(pos + 16),
        csize: directory.readUInt32LE(pos + 20),
        usize: directory.readUInt32LE(pos + 24),
        offset: directory.readUInt32LE(pos + 42),
      });
      pos += 46 + nameLength + extraLength + commentLength;
    }

    return {
      entries,
      /** Contenuto di un file dello zip. `maxBytes` è il limite (anche per ciò che si decomprime). */
      async read(entry, maxBytes) {
        if (entry.flags & 1) throw new ZipError('Lo zip è protetto da password: non posso leggerlo.');
        if (entry.method !== 0 && entry.method !== 8) throw new ZipError('Lo zip usa una compressione non supportata.');
        if (entry.usize > maxBytes) throw new ZipError(`Il file «${entry.name}» è troppo grande.`);
        if (entry.csize > size || entry.offset + 30 > size) throw new ZipError('Lo zip è danneggiato.');
        const local = await readAt(30, entry.offset);
        if (local.readUInt32LE(0) !== LOCAL) throw new ZipError('Lo zip è danneggiato.');
        const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        if (start + entry.csize > size) throw new ZipError('Lo zip è danneggiato.');
        const body = entry.csize ? await readAt(entry.csize, start) : Buffer.alloc(0);
        let data;
        if (entry.method === 0) data = body;
        else if (entry.usize === 0) data = Buffer.alloc(0);
        else {
          try {
            data = zlib.inflateRawSync(body, { maxOutputLength: entry.usize }); // più del dichiarato non esce
          } catch {
            throw new ZipError(`Il file «${entry.name}» nello zip è danneggiato.`);
          }
        }
        if (data.length !== entry.usize || zlib.crc32(data) !== entry.crc) throw new ZipError(`Il file «${entry.name}» nello zip è danneggiato (controllo di integrità non superato).`);
        return data;
      },
      close: () => fh.close(),
    };
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
}
