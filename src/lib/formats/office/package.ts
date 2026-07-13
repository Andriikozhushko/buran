/**
 * OOXML ZIP package helpers built on JSZip.
 *
 * Responsible for loading a package, enforcing safety limits (size, entry
 * count, zip-bomb ratio), and rebuilding a FRESH package whose ZIP entry
 * timestamps are normalised to a neutral fixed value (so the original
 * filesystem timestamps and extra fields are not preserved).
 */

import JSZip from 'jszip';
import type { OfficeBlock, OfficeBlockReason } from './types';

/** Hard limits for the 02B milestone. */
export const MAX_PACKAGE_BYTES = 100 * 1024 * 1024; // 100 MB compressed input
export const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // 250 MB uncompressed
export const MAX_ENTRY_COUNT = 10_000;
/** Reject suspicious overall compression ratios (zip-bomb-like). */
export const MAX_COMPRESSION_RATIO = 200;

/** Neutral fixed timestamp for all rebuilt entries (DOS epoch, 1980-01-01). */
export const NEUTRAL_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

export interface LoadedPackage {
  zip: JSZip;
  /** File entry names (excludes directory entries), in load order. */
  entryNames: string[];
  entryCount: number;
  uncompressedSize: number;
}

interface JSZipInternal {
  _data?: { uncompressedSize?: number };
}

export function officeBlock(reason: OfficeBlockReason, message: string): OfficeBlock {
  return { blocked: true, reason, message };
}

/**
 * Load an OOXML package. Returns a {@link LoadedPackage} or an {@link OfficeBlock}
 * for oversize / zip-bomb / malformed inputs.
 */
export async function loadPackage(buffer: ArrayBuffer): Promise<LoadedPackage | OfficeBlock> {
  if (buffer.byteLength > MAX_PACKAGE_BYTES) {
    return officeBlock(
      'too-large',
      'Файл больше 100 МБ. В этой версии BURAN ограничивает размер Office-документов, поэтому файл не был изменён.',
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return officeBlock(
      'malformed',
      'Не удалось разобрать структуру Office-документа (повреждённый ZIP/XML). BURAN не изменил файл, чтобы не повредить его.',
    );
  }

  const entryNames: string[] = [];
  let uncompressedSize = 0;
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir) continue;
    entryNames.push(name);
    const size = (f as unknown as JSZipInternal)._data?.uncompressedSize ?? 0;
    uncompressedSize += size;
  }

  const entryCount = entryNames.length;

  if (entryCount > MAX_ENTRY_COUNT) {
    return officeBlock(
      'too-many-entries',
      `В пакете больше ${MAX_ENTRY_COUNT} элементов. BURAN ограничивает количество элементов, поэтому файл не был изменён.`,
    );
  }

  if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
    return officeBlock(
      'too-large',
      'Распакованный размер документа превышает 250 МБ. BURAN не обрабатывает такие пакеты, поэтому файл не был изменён.',
    );
  }

  if (buffer.byteLength > 0 && uncompressedSize / buffer.byteLength > MAX_COMPRESSION_RATIO) {
    return officeBlock(
      'zip-bomb',
      'Подозрительно высокая степень сжатия (возможная zip-бомба). BURAN не обрабатывает такие пакеты, поэтому файл не был изменён.',
    );
  }

  return { zip, entryNames, entryCount, uncompressedSize };
}

/**
 * Rebuild a fresh package from a loaded one, dropping entries in `drop` and
 * substituting entries present in `replace`. All entry timestamps are
 * normalised to {@link NEUTRAL_DATE}; original extra fields/permissions are not
 * carried over (JSZip writes fresh minimal headers).
 */
export async function rebuildPackage(
  loaded: LoadedPackage,
  drop: Set<string>,
  replace: Map<string, Uint8Array | string>,
): Promise<ArrayBuffer> {
  const out = new JSZip();

  for (const name of loaded.entryNames) {
    if (drop.has(name)) continue;
    const replacement = replace.get(name);
    if (replacement !== undefined) {
      out.file(name, replacement, { date: NEUTRAL_DATE });
    } else {
      const data = await loaded.zip.files[name].async('uint8array');
      out.file(name, data, { date: NEUTRAL_DATE });
    }
  }

  // Normalise every entry's date, including any directory objects JSZip created
  // implicitly (those would otherwise carry the current time).
  for (const name of Object.keys(out.files)) {
    out.files[name].date = NEUTRAL_DATE;
  }

  const bytes = await out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    // [Content_Types].xml must be stored first ideally, but OOXML readers do not
    // require it; JSZip preserves our insertion order which keeps it first.
  });

  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/** Read a package entry as text, or null if absent. */
export async function readText(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  if (!f) return null;
  return f.async('string');
}

/** Read a package entry as bytes, or null if absent. */
export async function readBytes(zip: JSZip, name: string): Promise<Uint8Array | null> {
  const f = zip.file(name);
  if (!f) return null;
  return f.async('uint8array');
}
