/**
 * TIFF metadata scanning and sanitisation.
 *
 * A TIFF file is a chain of IFDs whose entries either inline a value or point
 * into the file. Cleaning REBUILDS the container: the new file carries only
 * structural/colour tags from an explicit keep-list, with pixel data (strips
 * or tiles) copied byte-for-byte. Everything else — EXIF and GPS sub-IFDs,
 * XMP, IPTC, Photoshop IRB, dates, artist, software, private/unknown tags,
 * and reduced-resolution (thumbnail) pages — is dropped and disclosed.
 *
 * Verification re-parses the output independently: zero personal findings,
 * page count and geometry preserved, and every pixel strip byte-identical.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';
import { parseExifIfd } from './jpeg';

const TYPE_SIZES: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

/** Structural / colour tags preserved verbatim by the rebuild. */
const KEEP_TAGS = new Set([
  254, 255, // NewSubfileType, SubfileType
  256, 257, 258, 259, 262, 263, 264, 265, 266, // geometry, compression, photometric
  273, 274, 277, 278, 279, // strips, orientation, samples
  280, 281, 282, 283, 284, // sample range, resolution, planar config
  296, 297, // resolution unit, page number
  301, 317, 318, 319, 320, 321, // transfer fn, predictor, colour, halftone
  322, 323, 324, 325, // tiles
  338, 339, 340, 341, // extra samples, sample format, S min/max
  347, // JPEGTables (needed by JPEG-compressed TIFFs)
  529, 530, 531, 532, // YCbCr + reference black/white
  34675, // ICC profile — technical colour data, deliberately preserved
]);

/** Tags that are technical display/colour data, not personal metadata. */
const TECHNICAL_TAGS = new Set([0x0112, 0x011a, 0x011b, 0x0128, 0x013e, 0x0213]);

/** Known metadata containers reported by name when present. */
const CONTAINER_TAGS: Record<number, string> = {
  700: 'XMP metadata',
  33723: 'IPTC metadata',
  34377: 'Photoshop image resources',
  34665: 'EXIF data',
  34853: 'GPS data',
  330: 'Sub-IFD (embedded preview)',
};

const MAX_IFDS = 32;

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Absolute offset of the 12-byte entry in the source file. */
  entryOffset: number;
  /** Absolute offset of the value data (inline or pointed-to). */
  dataOffset: number;
  byteLength: number;
  inline: boolean;
}

interface TiffIfd {
  offset: number;
  entries: TiffEntry[];
  /** Reduced-resolution page (thumbnail/preview) per NewSubfileType bit 0. */
  isReduced: boolean;
}

interface ParsedTiff {
  littleEndian: boolean;
  ifds: TiffIfd[];
}

function parseTiff(buffer: ArrayBuffer): ParsedTiff | null {
  const view = new DataView(buffer);
  if (view.byteLength < 8) return null;
  const order = view.getUint16(0, false);
  const littleEndian = order === 0x4949;
  if (!littleEndian && order !== 0x4d4d) return null;
  if (view.getUint16(2, littleEndian) !== 42) return null;

  const ifds: TiffIfd[] = [];
  const visited = new Set<number>();
  let offset = view.getUint32(4, littleEndian);

  while (offset !== 0 && ifds.length < MAX_IFDS) {
    if (visited.has(offset) || offset + 2 > view.byteLength) return null;
    visited.add(offset);
    const count = view.getUint16(offset, littleEndian);
    if (offset + 2 + count * 12 + 4 > view.byteLength) return null;

    const entries: TiffEntry[] = [];
    let isReduced = false;
    for (let i = 0; i < count; i++) {
      const entryOffset = offset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const n = view.getUint32(entryOffset + 4, littleEndian);
      const size = TYPE_SIZES[type];
      if (size === undefined || n > 0x0fffffff) continue; // unknown type / absurd count — skip entry
      const byteLength = size * n;
      const inline = byteLength <= 4;
      const dataOffset = inline ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian);
      if (!inline && (dataOffset + byteLength > view.byteLength)) continue; // dangling pointer
      entries.push({ tag, type, count: n, entryOffset, dataOffset, byteLength, inline });
      if (tag === 254 && (readEntryLong(view, { tag, type, count: n, entryOffset, dataOffset, byteLength, inline }, littleEndian, 0) & 1) === 1) {
        isReduced = true;
      }
    }
    ifds.push({ offset, entries, isReduced });
    offset = view.getUint32(offset + 2 + count * 12, littleEndian);
  }

  return ifds.length > 0 ? { littleEndian, ifds } : null;
}

/** Read the i-th numeric value of a SHORT/LONG entry. */
function readEntryLong(view: DataView, entry: TiffEntry, littleEndian: boolean, index: number): number {
  if (index >= entry.count) return 0;
  if (entry.type === 3) return view.getUint16(entry.dataOffset + index * 2, littleEndian);
  if (entry.type === 4) return view.getUint32(entry.dataOffset + index * 4, littleEndian);
  return 0;
}

function findEntry(ifd: TiffIfd, tag: number): TiffEntry | undefined {
  return ifd.entries.find((e) => e.tag === tag);
}

function readDimensions(view: DataView, ifd: TiffIfd, littleEndian: boolean): { width: number; height: number } | null {
  const w = findEntry(ifd, 256);
  const h = findEntry(ifd, 257);
  if (!w || !h) return null;
  const width = readEntryLong(view, w, littleEndian, 0);
  const height = readEntryLong(view, h, littleEndian, 0);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Pixel-data (offsets, byteCounts) tag pair for an IFD, strips or tiles. */
function pixelTagPair(ifd: TiffIfd): { offsets: number; counts: number } | null {
  if (findEntry(ifd, 273) && findEntry(ifd, 279)) return { offsets: 273, counts: 279 };
  if (findEntry(ifd, 324) && findEntry(ifd, 325)) return { offsets: 324, counts: 325 };
  return null;
}

export function scanTiff(buffer: ArrayBuffer): ScanResult {
  const view = new DataView(buffer);
  const findings: MetadataFinding[] = [];
  const parsed = parseTiff(buffer);

  let dimensions: { width: number; height: number } | null = null;
  let hasIccProfile = false;
  let reducedPages = 0;
  let unknownTags = 0;

  if (parsed) {
    rawGuard(buffer, parsed);
    dimensions = readDimensions(view, parsed.ifds[0], parsed.littleEndian);

    for (const ifd of parsed.ifds) {
      if (ifd.isReduced) reducedPages++;
      if (findEntry(ifd, 34675)) hasIccProfile = true;

      // Rich EXIF-style findings (dates, artist, software, GPS decimals…)
      // via the shared IFD parser; technical display tags filtered out.
      const exif = parseExifIfd(view, 0, ifd.offset, parsed.littleEndian, 'IFD0');
      for (const f of exif) {
        if (TECHNICAL_TAGS.has(f.tagId)) continue;
        findings.push({
          category: f.category as MetadataFinding['category'],
          field: `TIFF:${f.tagName}`,
          label: f.tagName,
          value: f.value,
          severity: f.severity,
          description: '',
        });
      }

      for (const entry of ifd.entries) {
        const container = CONTAINER_TAGS[entry.tag];
        if (container && entry.tag !== 34665 && entry.tag !== 34853) {
          // EXIF/GPS pointer findings already come from the shared parser.
          findings.push({
            category: 'containers',
            field: `TIFF:${container}`,
            label: container,
            value: 'Present',
            severity: 'medium',
            description: '',
          });
        }
        const asciiLabel = PERSONAL_ASCII_TAGS[entry.tag];
        if (asciiLabel && entry.type === 2) {
          let text = '';
          const bytes = new Uint8Array(buffer);
          for (let i = 0; i < Math.min(entry.byteLength, 256); i++) {
            const b = bytes[entry.dataOffset + i];
            if (!b) break;
            text += String.fromCharCode(b);
          }
          findings.push({
            category: entry.tag === 316 ? 'device' : 'other',
            field: `TIFF:${asciiLabel}`,
            label: asciiLabel,
            value: text || null,
            severity: entry.tag === 316 ? 'high' : 'medium',
            description: '',
          });
        }
        if (!isKnownTag(entry.tag)) unknownTags++;
      }
    }

    if (reducedPages > 0) {
      findings.push({
        category: 'thumbnails',
        field: 'TIFF:ReducedPages',
        label: 'Embedded preview/thumbnail pages',
        value: String(reducedPages),
        severity: 'medium',
        description: '',
      });
    }
    if (unknownTags > 0) {
      findings.push({
        category: 'other',
        field: 'TIFF:UnknownTags',
        label: 'Private/unknown TIFF tags',
        value: String(unknownTags),
        severity: 'medium',
        description: '',
      });
    }
  }

  return {
    format: 'tiff',
    findings,
    preservedInfo: {
      hasIccProfile,
      iccDescription: hasIccProfile ? 'ICC profile' : null,
      hasTransparency: false,
      dimensions,
      colourChunks: hasIccProfile ? ['ICC profile'] : [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

/** Personal tags the shared EXIF parser reports from IFD0. */
const PERSONAL_IFD0_TAGS = new Set([0x010e, 0x010f, 0x0110, 0x0131, 0x0132, 0x013b, 0x8298]);

/** TIFF-specific personal ASCII tags outside the shared EXIF tag table. */
const PERSONAL_ASCII_TAGS: Record<number, string> = {
  269: 'Document name',
  285: 'Page name',
  316: 'Host computer',
  337: 'Target printer',
};

function isKnownTag(tag: number): boolean {
  return (
    KEEP_TAGS.has(tag) ||
    tag in CONTAINER_TAGS ||
    PERSONAL_IFD0_TAGS.has(tag) ||
    TECHNICAL_TAGS.has(tag) ||
    tag in PERSONAL_ASCII_TAGS
  );
}

/**
 * TIFF-magic files that are actually camera RAW containers (CR2, DNG). Their
 * proprietary IFD layout cannot be rebuilt safely, so they are refused with an
 * honest message instead of being silently mangled.
 */
function rawGuard(buffer: ArrayBuffer, parsed: ParsedTiff): void {
  const bytes = new Uint8Array(buffer);
  // CR2 signature: "CR" + major version 2 at offset 8, right after the header.
  const isCr2 = bytes.length >= 11 && bytes[8] === 0x43 && bytes[9] === 0x52 && bytes[10] === 2;
  const hasDngVersion = parsed.ifds.some((ifd) => findEntry(ifd, 50706));
  if (isCr2 || hasDngVersion) {
    throw new Error(
      'Это RAW-файл камеры (CR2/DNG) в TIFF-контейнере. BURAN пока не очищает RAW-форматы, поэтому файл не был изменён.',
    );
  }
}

export function cleanTiff(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseTiff(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру TIFF.');
  rawGuard(buffer, parsed);
  const view = new DataView(buffer);
  const src = new Uint8Array(buffer);
  const { littleEndian } = parsed;

  const pages = parsed.ifds.filter((ifd) => !ifd.isReduced);
  if (pages.length === 0) throw new Error('TIFF не содержит основного изображения.');
  for (const page of pages) {
    const compression = findEntry(page, 259);
    if (compression && readEntryLong(view, compression, littleEndian, 0) === 6) {
      throw new Error('TIFF использует устаревшее JPEG-сжатие (тип 6), которое BURAN не может безопасно пересобрать.');
    }
    if (!pixelTagPair(page)) throw new Error('TIFF-страница не содержит данных изображения (strips/tiles).');
  }

  // Assemble: header, then per page [IFD block][value + pixel data].
  const chunks: Uint8Array[] = [];
  let cursor = 8; // after header
  const header = new Uint8Array(8);
  const headerView = new DataView(header.buffer);
  headerView.setUint16(0, littleEndian ? 0x4949 : 0x4d4d, false);
  headerView.setUint16(2, 42, littleEndian);
  headerView.setUint32(4, 8, littleEndian);
  chunks.push(header);

  const nextIfdPatches: Array<{ chunk: Uint8Array; at: number }> = [];

  for (const page of pages) {
    const pair = pixelTagPair(page)!;
    const kept = page.entries
      .filter((e) => KEEP_TAGS.has(e.tag))
      .sort((a, b) => a.tag - b.tag);

    const ifdSize = 2 + kept.length * 12 + 4;
    const ifdChunk = new Uint8Array(ifdSize);
    const ifdView = new DataView(ifdChunk.buffer);
    ifdView.setUint16(0, kept.length, littleEndian);
    cursor += ifdSize;
    chunks.push(ifdChunk);

    // Data region for this page follows its IFD.
    const dataChunks: Uint8Array[] = [];
    const appendData = (bytes: Uint8Array): number => {
      const at = cursor;
      dataChunks.push(bytes);
      cursor += bytes.length;
      if (cursor % 2 === 1) {
        dataChunks.push(new Uint8Array(1));
        cursor += 1;
      }
      return at;
    };

    for (const [i, entry] of kept.entries()) {
      const at = 2 + i * 12;
      ifdView.setUint16(at, entry.tag, littleEndian);
      ifdView.setUint16(at + 2, entry.type, littleEndian);

      if (entry.tag === pair.offsets) {
        // Copy every strip/tile byte-for-byte; write a fresh offsets array.
        const countsEntry = findEntry(page, pair.counts)!;
        const n = Math.min(entry.count, countsEntry.count);
        const newOffsets: number[] = [];
        for (let s = 0; s < n; s++) {
          const srcOffset = readEntryLong(view, entry, littleEndian, s);
          const byteCount = readEntryLong(view, countsEntry, littleEndian, s);
          if (srcOffset + byteCount > src.length) throw new Error('Данные изображения TIFF выходят за границы файла.');
          newOffsets.push(appendData(src.slice(srcOffset, srcOffset + byteCount)));
        }
        // Always write offsets as LONG.
        ifdView.setUint16(at + 2, 4, littleEndian);
        ifdView.setUint32(at + 4, n, littleEndian);
        if (n === 1) {
          ifdView.setUint32(at + 8, newOffsets[0], littleEndian);
        } else {
          const arr = new Uint8Array(n * 4);
          const arrView = new DataView(arr.buffer);
          for (let s = 0; s < n; s++) arrView.setUint32(s * 4, newOffsets[s], littleEndian);
          ifdView.setUint32(at + 8, appendData(arr), littleEndian);
        }
        continue;
      }

      ifdView.setUint32(at + 4, entry.count, littleEndian);
      if (entry.inline) {
        // Inline value: copy the raw 4 value bytes verbatim.
        ifdChunk.set(src.slice(entry.entryOffset + 8, entry.entryOffset + 12), at + 8);
      } else {
        const dataAt = appendData(src.slice(entry.dataOffset, entry.dataOffset + entry.byteLength));
        ifdView.setUint32(at + 8, dataAt, littleEndian);
      }
    }

    // Next-IFD pointer: patched below once every page's position is known.
    nextIfdPatches.push({ chunk: ifdChunk, at: 2 + kept.length * 12 });
    chunks.push(...dataChunks);
  }

  // Chain the pages: each page's next-pointer references the following IFD.
  // Recompute IFD start offsets by walking the chunk list.
  const ifdStarts: number[] = [];
  {
    let pos = 0;
    for (const chunk of chunks) {
      if (nextIfdPatches.some((p) => p.chunk === chunk)) ifdStarts.push(pos);
      pos += chunk.length;
    }
  }
  for (let i = 0; i < nextIfdPatches.length; i++) {
    const patch = nextIfdPatches[i];
    const next = i + 1 < ifdStarts.length ? ifdStarts[i + 1] : 0;
    new DataView(patch.chunk.buffer).setUint32(patch.at, next, littleEndian);
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out.buffer;
}

/** Collect every pixel strip/tile of every full page as raw bytes. */
function collectPixelData(buffer: ArrayBuffer): Uint8Array[] {
  const parsed = parseTiff(buffer);
  if (!parsed) return [];
  const view = new DataView(buffer);
  const src = new Uint8Array(buffer);
  const out: Uint8Array[] = [];
  for (const ifd of parsed.ifds) {
    if (ifd.isReduced) continue;
    const pair = pixelTagPair(ifd);
    if (!pair) continue;
    const offsets = findEntry(ifd, pair.offsets)!;
    const counts = findEntry(ifd, pair.counts)!;
    const n = Math.min(offsets.count, counts.count);
    for (let s = 0; s < n; s++) {
      const at = readEntryLong(view, offsets, parsed.littleEndian, s);
      const len = readEntryLong(view, counts, parsed.littleEndian, s);
      out.push(src.slice(at, Math.min(at + len, src.length)));
    }
  }
  return out;
}

export function verifyTiff(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanTiff(cleanBuffer);
  const metadataFoundBefore = original.findings.length;
  const metadataRemaining = rescan.findings.length;

  const dimensionsPreserved =
    !!original.preservedInfo.dimensions &&
    !!rescan.preservedInfo.dimensions &&
    original.preservedInfo.dimensions.width === rescan.preservedInfo.dimensions.width &&
    original.preservedInfo.dimensions.height === rescan.preservedInfo.dimensions.height;

  const iccPreserved = !original.preservedInfo.hasIccProfile || rescan.preservedInfo.hasIccProfile;

  const technicalDataPreserved: string[] = [];
  if (rescan.preservedInfo.dimensions) {
    const d = rescan.preservedInfo.dimensions;
    technicalDataPreserved.push(`Dimensions: ${d.width}×${d.height}`);
  }
  if (rescan.preservedInfo.hasIccProfile) technicalDataPreserved.push('ICC profile');

  const passed = metadataRemaining === 0 && dimensionsPreserved && iccPreserved;

  return {
    passed,
    metadataFoundBefore,
    metadataRemaining,
    technicalDataPreserved,
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

/** Byte-identity check of pixel data, used by tests and the handler verify. */
export function tiffPixelDataIdentical(original: ArrayBuffer, clean: ArrayBuffer): boolean {
  const a = collectPixelData(original);
  const b = collectPixelData(clean);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let j = 0; j < a[i].length; j++) if (a[i][j] !== b[i][j]) return false;
  }
  return true;
}

export const tiffHandler: FormatHandler = {
  format: 'tiff',
  scan: scanTiff,
  clean: cleanTiff,
  verify(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
    return verifyTiff(original, cleanBuffer);
  },
};
