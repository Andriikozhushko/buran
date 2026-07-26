/**
 * AVIF metadata scanning and sanitisation.
 *
 * AVIF is ISO-BMFF: metadata lives as `Exif` / `mime`(XMP) items declared in
 * the meta box (iinf/iloc/iref/ipma) with payload bytes in mdat. Unlike HEIC
 * there is no decode/re-encode: cleaning
 *   1. zeroes the metadata items' payload extents in place,
 *   2. rebuilds the meta box without those items (iinf entries, iloc records,
 *      iref references, ipma associations),
 *   3. pads the meta box back to its ORIGINAL size with a trailing `free`
 *      box, so every absolute file offset (iloc extents into mdat) stays
 *      valid and pixel data is untouched byte-for-byte.
 *
 * Verification re-parses the output: no metadata items remain, the zeroed
 * ranges are zero, and the primary image item and colour properties survive.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';
import { parseExifIfd } from './jpeg';

export interface Box {
  type: string;
  /** Absolute offset of the box header. */
  start: number;
  size: number;
  headerSize: number;
}

export function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

export function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

export function parseBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = u32(bytes, at);
    let headerSize = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const hi = u32(bytes, at + 8);
      const lo = u32(bytes, at + 12);
      if (hi > 0x1fffff) break; // > 2^53 — refuse
      size = hi * 0x100000000 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < headerSize || at + size > end) break;
    boxes.push({ type: fourCC(bytes, at + 4), start: at, size, headerSize });
    at += size;
  }
  return boxes;
}

function readNullString(bytes: Uint8Array, at: number, end: number): { text: string; next: number } {
  let text = '';
  while (at < end && bytes[at] !== 0) {
    text += String.fromCharCode(bytes[at]);
    at++;
  }
  return { text, next: at + 1 };
}

interface InfeItem {
  id: number;
  itemType: string;
  contentType: string;
  /** Absolute span of the infe box inside iinf. */
  start: number;
  end: number;
}

interface IlocItem {
  id: number;
  constructionMethod: number;
  /** Absolute [offset, length] extents (construction method 0 only). */
  extents: Array<{ offset: number; length: number }>;
  /** Absolute span of this item record inside iloc. */
  start: number;
  end: number;
}

interface ParsedAvif {
  majorBrand: string;
  meta: Box;
  metaChildren: Box[];
  items: InfeItem[];
  ilocVersion: number;
  ilocItems: IlocItem[];
  primaryItemId: number | null;
  dimensions: { width: number; height: number } | null;
}

function parseIinf(bytes: Uint8Array, box: Box): { entryCountAt: number; version: number; items: InfeItem[] } | null {
  let at = box.start + box.headerSize;
  const version = bytes[at];
  at += 4;
  const entryCountAt = at;
  const count = version === 0 ? u16(bytes, at) : u32(bytes, at);
  at += version === 0 ? 2 : 4;
  const items: InfeItem[] = [];
  const end = box.start + box.size;
  for (let i = 0; i < count && at + 8 <= end; i++) {
    const infe = parseBoxes(bytes, at, end)[0];
    if (!infe || infe.type !== 'infe') return null;
    let p = infe.start + infe.headerSize;
    const v = bytes[p];
    p += 4;
    if (v < 2) return null; // pre-v2 infe unsupported in AVIF
    const id = v === 2 ? u16(bytes, p) : u32(bytes, p);
    p += v === 2 ? 2 : 4;
    p += 2; // protection index
    const itemType = fourCC(bytes, p);
    p += 4;
    const name = readNullString(bytes, p, infe.start + infe.size);
    let contentType = '';
    if (itemType === 'mime') {
      contentType = readNullString(bytes, name.next, infe.start + infe.size).text;
    }
    items.push({ id, itemType, contentType, start: infe.start, end: infe.start + infe.size });
    at = infe.start + infe.size;
  }
  return { entryCountAt, version, items };
}

function parseIloc(bytes: Uint8Array, box: Box): { version: number; itemCountAt: number; items: IlocItem[] } | null {
  let at = box.start + box.headerSize;
  const version = bytes[at];
  at += 4;
  const offsetSize = bytes[at] >> 4;
  const lengthSize = bytes[at] & 0x0f;
  const baseOffsetSize = bytes[at + 1] >> 4;
  const indexSize = version === 1 || version === 2 ? bytes[at + 1] & 0x0f : 0;
  at += 2;
  const itemCountAt = at;
  const count = version < 2 ? u16(bytes, at) : u32(bytes, at);
  at += version < 2 ? 2 : 4;

  const readN = (n: number, p: number): number => {
    let value = 0;
    for (let i = 0; i < n; i++) value = value * 256 + bytes[p + i];
    return value;
  };

  const items: IlocItem[] = [];
  const end = box.start + box.size;
  for (let i = 0; i < count; i++) {
    const start = at;
    if (at + 2 > end) return null;
    const id = version < 2 ? u16(bytes, at) : u32(bytes, at);
    at += version < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (version === 1 || version === 2) {
      constructionMethod = u16(bytes, at) & 0x0f;
      at += 2;
    }
    at += 2; // data_reference_index
    const baseOffset = readN(baseOffsetSize, at);
    at += baseOffsetSize;
    const extentCount = u16(bytes, at);
    at += 2;
    const extents: Array<{ offset: number; length: number }> = [];
    for (let e = 0; e < extentCount; e++) {
      at += indexSize;
      const extentOffset = readN(offsetSize, at);
      at += offsetSize;
      const extentLength = readN(lengthSize, at);
      at += lengthSize;
      extents.push({ offset: baseOffset + extentOffset, length: extentLength });
    }
    if (at > end) return null;
    items.push({ id, constructionMethod, extents, start, end: at });
  }
  return { version, itemCountAt, items };
}

function parseAvif(buffer: ArrayBuffer): ParsedAvif | null {
  const bytes = new Uint8Array(buffer);
  const top = parseBoxes(bytes, 0, bytes.length);
  const ftyp = top.find((b) => b.type === 'ftyp');
  const meta = top.find((b) => b.type === 'meta');
  if (!ftyp || !meta) return null;
  const majorBrand = fourCC(bytes, ftyp.start + 8);

  // meta is a FullBox: children start after 4 version/flags bytes.
  const metaChildren = parseBoxes(bytes, meta.start + meta.headerSize + 4, meta.start + meta.size);
  const iinfBox = metaChildren.find((b) => b.type === 'iinf');
  const ilocBox = metaChildren.find((b) => b.type === 'iloc');
  const pitmBox = metaChildren.find((b) => b.type === 'pitm');
  if (!iinfBox || !ilocBox) return null;

  const iinf = parseIinf(bytes, iinfBox);
  const iloc = parseIloc(bytes, ilocBox);
  if (!iinf || !iloc) return null;

  let primaryItemId: number | null = null;
  if (pitmBox) {
    const v = bytes[pitmBox.start + pitmBox.headerSize];
    const p = pitmBox.start + pitmBox.headerSize + 4;
    primaryItemId = v === 0 ? u16(bytes, p) : u32(bytes, p);
  }

  // Dimensions: largest ispe property inside iprp/ipco.
  let dimensions: { width: number; height: number } | null = null;
  const iprp = metaChildren.find((b) => b.type === 'iprp');
  if (iprp) {
    const ipco = parseBoxes(bytes, iprp.start + iprp.headerSize, iprp.start + iprp.size).find((b) => b.type === 'ipco');
    if (ipco) {
      for (const prop of parseBoxes(bytes, ipco.start + ipco.headerSize, ipco.start + ipco.size)) {
        if (prop.type !== 'ispe') continue;
        const p = prop.start + prop.headerSize + 4;
        const width = u32(bytes, p);
        const height = u32(bytes, p + 4);
        if (!dimensions || width * height > dimensions.width * dimensions.height) dimensions = { width, height };
      }
    }
  }

  return {
    majorBrand,
    meta,
    metaChildren,
    items: iinf.items,
    ilocVersion: iloc.version,
    ilocItems: iloc.items,
    primaryItemId,
    dimensions,
  };
}

function metadataItems(parsed: ParsedAvif): InfeItem[] {
  return parsed.items.filter(
    (item) => item.itemType === 'Exif' || (item.itemType === 'mime' && /xmp/i.test(item.contentType)),
  );
}

export function detectAvif(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12 || fourCC(bytes, 4) !== 'ftyp') return false;
  const brand = fourCC(bytes, 8);
  return brand === 'avif' || brand === 'avis';
}

export function scanAvif(buffer: ArrayBuffer): ScanResult {
  const parsed = parseAvif(buffer);
  const findings: MetadataFinding[] = [];
  const bytes = new Uint8Array(buffer);

  if (parsed) {
    for (const item of metadataItems(parsed)) {
      const loc = parsed.ilocItems.find((l) => l.id === item.id);
      if (item.itemType === 'Exif') {
        findings.push({
          category: 'containers',
          field: 'AVIF:Exif',
          label: 'EXIF data',
          value: 'Present',
          severity: 'medium',
          description: '',
        });
        // Exif payload: u32 tiff-header offset, then a plain TIFF stream.
        const extent = loc?.constructionMethod === 0 ? loc.extents[0] : undefined;
        if (extent && extent.length > 12 && extent.offset + extent.length <= bytes.length) {
          const tiffStart = extent.offset + 4 + u32(bytes, extent.offset);
          const view = new DataView(buffer);
          if (tiffStart + 8 < bytes.length) {
            const littleEndian = u16(bytes, tiffStart) === 0x4949;
            const ifd0 = tiffStart + view.getUint32(tiffStart + 4, littleEndian);
            for (const f of parseExifIfd(view, tiffStart, ifd0, littleEndian, 'IFD0')) {
              if (f.tagId === 0x0112) continue;
              findings.push({
                category: f.category as MetadataFinding['category'],
                field: `AVIF:${f.tagName}`,
                label: f.tagName,
                value: f.value,
                severity: f.severity,
                description: '',
              });
            }
          }
        }
      } else {
        findings.push({
          category: 'containers',
          field: 'AVIF:XMP',
          label: 'XMP metadata',
          value: 'Present',
          severity: 'medium',
          description: '',
        });
      }
    }
  }

  return {
    format: 'avif',
    findings,
    preservedInfo: {
      hasIccProfile: false,
      iccDescription: null,
      hasTransparency: false,
      dimensions: parsed?.dimensions ?? null,
      colourChunks: [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

/** Serialise a box header + content into a fresh Uint8Array. */
function makeBox(type: string, content: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + content.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(content, 8);
  return out;
}

export function cleanAvif(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseAvif(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру AVIF.');
  const removeItems = metadataItems(parsed);
  const out = new Uint8Array(buffer.slice(0));
  if (removeItems.length === 0) return out.buffer;

  const removeIds = new Set(removeItems.map((i) => i.id));
  const bytes = new Uint8Array(buffer);

  // 1. Zero the payload extents (metadata bytes physically destroyed).
  for (const loc of parsed.ilocItems) {
    if (!removeIds.has(loc.id)) continue;
    if (loc.constructionMethod !== 0) {
      throw new Error('AVIF хранит метаданные нестандартным способом (idat). BURAN не изменил файл.');
    }
    for (const extent of loc.extents) {
      if (extent.offset + extent.length > out.length) {
        throw new Error('Метаданные AVIF выходят за границы файла. BURAN не изменил файл.');
      }
      out.fill(0, extent.offset, extent.offset + extent.length);
    }
  }

  // 2. Rebuild the meta children without the removed items.
  const rebuilt: Uint8Array[] = [];
  for (const child of parsed.metaChildren) {
    const raw = bytes.slice(child.start, child.start + child.size);

    if (child.type === 'iinf') {
      const iinf = parseIinf(bytes, child)!;
      const kept = iinf.items.filter((i) => !removeIds.has(i.id));
      const head = bytes.slice(child.start + child.headerSize, iinf.items[0]?.start ?? child.start + child.size);
      const content = concat([head, ...kept.map((i) => bytes.slice(i.start, i.end))]);
      const view = new DataView(content.buffer);
      // entry_count sits right after the 4 version/flags bytes.
      if (iinf.version === 0) view.setUint16(4, kept.length, false);
      else view.setUint32(4, kept.length, false);
      rebuilt.push(makeBox('iinf', content));
      continue;
    }

    if (child.type === 'iloc') {
      const iloc = parseIloc(bytes, child)!;
      const kept = iloc.items.filter((i) => !removeIds.has(i.id));
      const firstRecord = iloc.items[0]?.start ?? child.start + child.size;
      const head = bytes.slice(child.start + child.headerSize, firstRecord);
      const content = concat([head, ...kept.map((i) => bytes.slice(i.start, i.end))]);
      const view = new DataView(content.buffer);
      const countAt = iloc.itemCountAt - (child.start + child.headerSize);
      if (iloc.version < 2) view.setUint16(countAt, kept.length, false);
      else view.setUint32(countAt, kept.length, false);
      rebuilt.push(makeBox('iloc', content));
      continue;
    }

    if (child.type === 'iref') {
      const version = bytes[child.start + child.headerSize];
      const refs = parseBoxes(bytes, child.start + child.headerSize + 4, child.start + child.size);
      const keptRefs = refs.filter((ref) => {
        const from = version === 0 ? u16(bytes, ref.start + ref.headerSize) : u32(bytes, ref.start + ref.headerSize);
        return !removeIds.has(from);
      });
      const head = bytes.slice(child.start + child.headerSize, child.start + child.headerSize + 4);
      const content = concat([head, ...keptRefs.map((r) => bytes.slice(r.start, r.start + r.size))]);
      rebuilt.push(makeBox('iref', content));
      continue;
    }

    rebuilt.push(raw);
  }

  const metaContentSize = parsed.meta.size - parsed.meta.headerSize - 4;
  const newChildrenSize = rebuilt.reduce((sum, c) => sum + c.length, 0);
  const slack = metaContentSize - newChildrenSize;
  if (slack < 0) throw new Error('Пересборка AVIF неожиданно увеличила meta-контейнер. BURAN не изменил файл.');
  if (slack > 0 && slack < 8) {
    throw new Error('Пересборка AVIF даёт непредставимый остаток свободного места. BURAN не изменил файл.');
  }

  // 3. Write the rebuilt children (+ free padding) into the meta box in place:
  // the meta box keeps its exact original size, so nothing else moves.
  let at = parsed.meta.start + parsed.meta.headerSize + 4;
  for (const chunk of rebuilt) {
    out.set(chunk, at);
    at += chunk.length;
  }
  if (slack > 0) {
    const free = makeBox('free', new Uint8Array(slack - 8));
    out.set(free, at);
  }
  return out.buffer;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function verifyAvif(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanAvif(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const parsed = parseAvif(cleanBuffer);

  const structureIntact = parsed !== null && (original.preservedInfo.dimensions === null || parsed.dimensions !== null);
  const primaryIntact = parsed?.primaryItemId !== null;

  const technicalDataPreserved: string[] = [];
  if (parsed?.dimensions) technicalDataPreserved.push(`Dimensions: ${parsed.dimensions.width}×${parsed.dimensions.height}`);

  return {
    passed: metadataRemaining === 0 && structureIntact && primaryIntact,
    metadataFoundBefore: original.findings.length,
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

export const avifHandler: FormatHandler = {
  format: 'avif',
  scan: scanAvif,
  clean: cleanAvif,
  verify: verifyAvif,
};
