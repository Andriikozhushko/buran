import JSZip from 'jszip';
import type { ZipBlock, ZipScanData } from './types';
import { loadZip, NEUTRAL_DATE, readEntryBytes, zipBlock } from './safety';
import { cleanNestedSupported, detectNestedFormat, scanNestedSupported, toArrayBuffer } from './recursive';
import { scanZip } from './scan';

export async function sanitizeZip(buffer: ArrayBuffer, scanData: ZipScanData, depth = 0): Promise<ArrayBuffer | ZipBlock> {
  const loaded = await loadZip(buffer);
  if ('blocked' in loaded) return loaded;

  const out = new JSZip();
  const supportedByPath = new Map(scanData.supportedEntries.map((entry) => [entry.path, entry]));

  for (const name of loaded.entryNames) {
    const entry = loaded.zip.files[name];
    if (entry.dir) {
      out.folder(name.replace(/\/$/, ''));
      continue;
    }

    const originalBytes = await readEntryBytes(loaded.zip, name);
    if ('blocked' in originalBytes) return originalBytes;
    const originalBuffer = toArrayBuffer(originalBytes);
    const detected = detectNestedFormat(originalBuffer, name);

    if (detected === 'zip') {
      if (depth >= 1) {
        return zipBlock('too-deep', `Архив ${name} вложен глубже одного уровня. BURAN не создал очищенную копию.`, name);
      }
      const nestedScan = await scanZip(originalBuffer, depth + 1);
      if ('blocked' in nestedScan) return nestedScan;
      const nestedClean = await sanitizeZip(originalBuffer, nestedScan.data, depth + 1);
      if ('blocked' in nestedClean) return nestedClean;
      out.file(name, new Uint8Array(nestedClean), { date: NEUTRAL_DATE, createFolders: true });
      continue;
    }

    if (detected && supportedByPath.has(name)) {
      const nestedScan = await scanNestedSupported(originalBuffer, name, originalBytes.byteLength);
      if ('blocked' in nestedScan) return nestedScan;
      const nestedClean = await cleanNestedSupported(originalBuffer, nestedScan.scan);
      if ('blocked' in nestedClean) return nestedClean;
      out.file(name, new Uint8Array(nestedClean.cleanBuffer), { date: NEUTRAL_DATE, createFolders: true });
      continue;
    }

    out.file(name, originalBytes, { date: NEUTRAL_DATE, createFolders: true });
  }

  for (const name of Object.keys(out.files)) {
    out.files[name].date = NEUTRAL_DATE;
  }

  const bytes = await out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    comment: '',
    platform: 'DOS',
  });
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
