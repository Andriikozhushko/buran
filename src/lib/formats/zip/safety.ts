import JSZip from 'jszip';
import type { ZipBlock, ZipBlockReason } from './types';

export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
export const MAX_ENTRY_COUNT = 10_000;
export const MAX_COMPRESSION_RATIO = 200;
export const MAX_NESTED_DEPTH = 1;
export const NEUTRAL_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
export const ZIP_OUTPUT_FILENAME = 'buran-clean.zip';

const MAX_NESTED_SUPPORTED_BYTES: Record<string, number> = {
  jpeg: 50 * 1024 * 1024,
  png: 50 * 1024 * 1024,
  webp: 50 * 1024 * 1024,
  pdf: 100 * 1024 * 1024,
  docx: 100 * 1024 * 1024,
  xlsx: 100 * 1024 * 1024,
  pptx: 100 * 1024 * 1024,
  zip: 100 * 1024 * 1024,
};

interface JSZipInternal {
  _data?: { uncompressedSize?: number; compressedSize?: number };
  _dataBinary?: boolean;
  _dataCompressed?: unknown;
  comment?: string;
  unixPermissions?: number | string | null;
  dosPermissions?: number | null;
  extraFields?: Record<string, unknown>;
}

export interface LoadedZip {
  zip: JSZip;
  entryNames: string[];
  fileNames: string[];
  entryCount: number;
  uncompressedSize: number;
  compressedEntrySize: number;
}

export function zipBlock(reason: ZipBlockReason, message: string, entryPath?: string): ZipBlock {
  return { blocked: true, reason, message, entryPath };
}

export function isZipMagic(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2]);
}

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function canonicalPath(name: string): string | ZipBlock {
  const normal = name.replace(/\\/g, '/');
  if (/^[a-z]:\//i.test(normal) || normal.startsWith('/') || normal.startsWith('\\')) {
    return zipBlock('path-traversal', `Архив содержит абсолютный путь: ${name}. BURAN не обрабатывает такие архивы.`, name);
  }
  const parts = normal.split('/');
  if (parts.some((p) => p === '..')) {
    return zipBlock('path-traversal', `Архив содержит путь с выходом из папки: ${name}. BURAN не обрабатывает такие архивы.`, name);
  }
  return parts.filter((p) => p.length > 0 && p !== '.').join('/');
}

export function maxBytesForFormat(format: string): number {
  return MAX_NESTED_SUPPORTED_BYTES[format] ?? 50 * 1024 * 1024;
}

export async function loadZip(buffer: ArrayBuffer): Promise<LoadedZip | ZipBlock> {
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    return zipBlock('too-large', 'Архив больше 100 МБ. BURAN не распаковывает и не изменяет такие ZIP-файлы.');
  }
  if (!isZipMagic(buffer)) {
    return zipBlock('unsupported-package', 'Файл не является обычным ZIP-архивом.');
  }

  const raw = new Uint8Array(buffer);
  if (raw[2] === 0x07 && raw[3] === 0x08) {
    return zipBlock('multi-volume', 'Архив похож на split/multi-volume ZIP. BURAN не обрабатывает такие архивы.');
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return zipBlock('malformed', 'ZIP-архив повреждён или имеет неподдерживаемую структуру. BURAN не создал очищенную копию.');
  }

  const entryNames = Object.keys(zip.files);
  const fileNames: string[] = [];
  const seen = new Set<string>();
  let uncompressedSize = 0;
  let compressedEntrySize = 0;

  for (const name of entryNames) {
    const file = zip.files[name];
    const canonical = canonicalPath(name);
    if (typeof canonical !== 'string') return canonical;
    const key = canonical.toLowerCase();
    if (seen.has(key)) {
      return zipBlock('duplicate-path', `Архив содержит конфликтующие пути: ${name}. BURAN не обрабатывает неоднозначные архивы.`, name);
    }
    seen.add(key);

    const internal = file as unknown as JSZipInternal;
    if (internal._dataCompressed && (file as unknown as { _data?: { compressedContent?: Uint8Array } })._data?.compressedContent) {
      // JSZip hides flags, so encrypted entries are additionally caught during read.
    }
    const size = internal._data?.uncompressedSize ?? 0;
    const compressed = internal._data?.compressedSize ?? 0;
    uncompressedSize += size;
    compressedEntrySize += compressed;
    if (!file.dir) fileNames.push(name);
  }

  if (entryNames.length > MAX_ENTRY_COUNT) {
    return zipBlock('too-many-entries', `В архиве больше ${MAX_ENTRY_COUNT} элементов. BURAN не обрабатывает такие ZIP-файлы.`);
  }
  if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
    return zipBlock('too-large', 'Распакованный размер архива превышает 250 МБ. BURAN не обрабатывает такие ZIP-файлы.');
  }
  if (buffer.byteLength > 0 && uncompressedSize / buffer.byteLength > MAX_COMPRESSION_RATIO) {
    return zipBlock('zip-bomb', 'Подозрительно высокая степень сжатия (возможная zip-бомба). BURAN не обрабатывает архив.');
  }

  return { zip, entryNames, fileNames, entryCount: entryNames.length, uncompressedSize, compressedEntrySize };
}

export async function readEntryBytes(zip: JSZip, name: string): Promise<Uint8Array | ZipBlock> {
  try {
    return await zip.files[name].async('uint8array');
  } catch {
    return zipBlock('encrypted', `Не удалось прочитать элемент архива: ${name}. Вероятно, он зашифрован или повреждён.`, name);
  }
}

export function entryHasExternalAttributes(file: JSZip.JSZipObject): boolean {
  const f = file as unknown as JSZipInternal;
  // JSZip may expose non-identifying DOS directory/archive bits on freshly
  // generated archives. The identifying surface we can reliably neutralise is
  // Unix/host permission metadata; DOS date/time is verified separately via the
  // neutral timestamp check.
  return !!f.unixPermissions;
}

export function entryExtraFieldCount(file: JSZip.JSZipObject): number {
  const f = file as unknown as JSZipInternal;
  return f.extraFields ? Object.keys(f.extraFields).length : 0;
}

export function archiveComment(zip: JSZip): string {
  return (zip as unknown as { comment?: string }).comment ?? '';
}
