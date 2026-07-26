/**
 * MKV / WebM metadata scanning and sanitisation.
 *
 * Matroska is EBML: nested elements with variable-length ids and sizes.
 * SeekHead and Cues store byte positions, so elements must never move.
 * Cleaning therefore works IN PLACE:
 *   - Tags, Attachments, Title and DateUTC elements are overwritten with a
 *     Void element of the exact same total size (spec-blessed padding);
 *   - MuxingApp/WritingApp are mandatory elements, so their string payloads
 *     are zeroed instead of removed.
 * Media clusters are untouched byte-for-byte.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TITLE = 0x7ba9;
const ID_MUXING_APP = 0x4d80;
const ID_WRITING_APP = 0x5741;
const ID_DATE_UTC = 0x4461;
const ID_TAGS = 0x1254c367;
const ID_ATTACHMENTS = 0x1941a469;

interface EbmlElement {
  id: number;
  /** Absolute offset of the element (id byte 0). */
  start: number;
  /** Absolute offset of the payload. */
  dataStart: number;
  dataSize: number;
  end: number;
}

function readVint(bytes: Uint8Array, at: number, keepMarker: boolean): { value: number; length: number } | null {
  if (at >= bytes.length) return null;
  const first = bytes[at];
  if (first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    mask >>= 1;
    length++;
    if (length > 8) return null;
  }
  if (at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
  return { value, length };
}

/** Sentinel for "unknown size" payloads (all size bits set). */
function isUnknownSize(bytes: Uint8Array, at: number, length: number): boolean {
  const first = bytes[at];
  const mask = 0x80 >> (length - 1);
  if ((first & (mask - 1)) !== mask - 1) return false;
  for (let i = 1; i < length; i++) if (bytes[at + i] !== 0xff) return false;
  return true;
}

function readElement(bytes: Uint8Array, at: number, end: number): EbmlElement | null {
  const id = readVint(bytes, at, true);
  if (!id) return null;
  const size = readVint(bytes, at + id.length, false);
  if (!size) return null;
  const dataStart = at + id.length + size.length;
  const dataSize = isUnknownSize(bytes, at + id.length, size.length) ? end - dataStart : size.value;
  if (dataStart + dataSize > end) return null;
  return { id: id.value, start: at, dataStart, dataSize, end: dataStart + dataSize };
}

function walkChildren(bytes: Uint8Array, from: number, to: number): EbmlElement[] {
  const out: EbmlElement[] = [];
  let at = from;
  while (at < to) {
    const element = readElement(bytes, at, to);
    if (!element) break;
    out.push(element);
    at = element.end;
  }
  return out;
}

interface ParsedMkv {
  docType: string;
  segment: EbmlElement;
  /** Elements to void entirely: Title, DateUTC, Tags, Attachments. */
  voidTargets: EbmlElement[];
  /** String payloads to zero: MuxingApp, WritingApp. */
  zeroTargets: EbmlElement[];
  info: {
    title: string | null;
    muxingApp: string | null;
    writingApp: string | null;
    hasDate: boolean;
    hasTags: boolean;
    hasAttachments: boolean;
  };
}

function utf8(bytes: Uint8Array, element: EbmlElement): string | null {
  const raw = bytes.slice(element.dataStart, element.dataStart + Math.min(element.dataSize, 256));
  const text = new TextDecoder('utf-8', { fatal: false }).decode(raw).replace(/\0+/g, '').trim();
  return text || null;
}

function parseMkv(buffer: ArrayBuffer): ParsedMkv | null {
  const bytes = new Uint8Array(buffer);
  const header = readElement(bytes, 0, bytes.length);
  if (!header || header.id !== ID_EBML) return null;
  const docTypeElement = walkChildren(bytes, header.dataStart, header.end).find((e) => e.id === 0x4282);
  const docType = docTypeElement ? (utf8(bytes, docTypeElement) ?? '') : '';

  const segment = readElement(bytes, header.end, bytes.length);
  if (!segment || segment.id !== ID_SEGMENT) return null;

  const parsed: ParsedMkv = {
    docType,
    segment,
    voidTargets: [],
    zeroTargets: [],
    info: { title: null, muxingApp: null, writingApp: null, hasDate: false, hasTags: false, hasAttachments: false },
  };

  for (const child of walkChildren(bytes, segment.dataStart, segment.end)) {
    if (child.id === ID_TAGS) {
      parsed.info.hasTags = true;
      parsed.voidTargets.push(child);
    } else if (child.id === ID_ATTACHMENTS) {
      parsed.info.hasAttachments = true;
      parsed.voidTargets.push(child);
    } else if (child.id === ID_INFO) {
      for (const item of walkChildren(bytes, child.dataStart, child.end)) {
        if (item.id === ID_TITLE) {
          parsed.info.title = utf8(bytes, item);
          parsed.voidTargets.push(item);
        } else if (item.id === ID_DATE_UTC) {
          parsed.info.hasDate = true;
          parsed.voidTargets.push(item);
        } else if (item.id === ID_MUXING_APP) {
          parsed.info.muxingApp = utf8(bytes, item);
          if (parsed.info.muxingApp) parsed.zeroTargets.push(item);
        } else if (item.id === ID_WRITING_APP) {
          parsed.info.writingApp = utf8(bytes, item);
          if (parsed.info.writingApp) parsed.zeroTargets.push(item);
        }
      }
    }
  }
  return parsed;
}

function mk(
  field: string,
  label: string,
  value: string | null,
  category: MetadataFinding['category'],
  severity: MetadataFinding['severity'],
): MetadataFinding {
  return { category, field, label, value, severity, description: '' };
}

export function scanMkv(buffer: ArrayBuffer): ScanResult {
  const findings: MetadataFinding[] = [];
  const parsed = parseMkv(buffer);

  if (parsed) {
    if (parsed.info.title) findings.push(mk('MKV:Title', 'Title', parsed.info.title, 'other', 'medium'));
    if (parsed.info.hasDate) findings.push(mk('MKV:DateUTC', 'Creation date', 'Present', 'dates', 'high'));
    if (parsed.info.muxingApp) findings.push(mk('MKV:MuxingApp', 'Muxing application', parsed.info.muxingApp, 'software', 'medium'));
    if (parsed.info.writingApp) findings.push(mk('MKV:WritingApp', 'Writing application', parsed.info.writingApp, 'software', 'medium'));
    if (parsed.info.hasTags) findings.push(mk('MKV:Tags', 'Tags element', 'Present', 'containers', 'medium'));
    if (parsed.info.hasAttachments) findings.push(mk('MKV:Attachments', 'Attached files', 'Present', 'containers', 'high'));
  }

  return {
    format: 'mkv',
    findings,
    preservedInfo: {
      hasIccProfile: false,
      iccDescription: null,
      hasTransparency: false,
      dimensions: null,
      colourChunks: [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

/** Overwrite [start, end) with a Void element of exactly that size. */
function writeVoid(out: Uint8Array, start: number, end: number): void {
  const total = end - start;
  if (total < 2) {
    // Cannot represent a Void element in 1 byte — zero it instead (invalid
    // territory that real elements never occupy: minimum element is 2 bytes).
    out.fill(0, start, end);
    return;
  }
  out[start] = 0xec; // Void id
  // Choose the shortest size-field length that fits the remaining bytes.
  for (let sizeLength = 1; sizeLength <= 8; sizeLength++) {
    const content = total - 1 - sizeLength;
    const max = 2 ** (7 * sizeLength) - 2;
    if (content < 0) break;
    if (content <= max) {
      let value = content;
      for (let i = sizeLength - 1; i >= 1; i--) {
        out[start + 1 + i] = value & 0xff;
        value = Math.floor(value / 256);
      }
      out[start + 1] = (0x80 >> (sizeLength - 1)) | value;
      out.fill(0, start + 1 + sizeLength, end);
      return;
    }
  }
}

export function cleanMkv(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseMkv(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру MKV/WebM.');
  const out = new Uint8Array(buffer.slice(0));

  for (const element of parsed.voidTargets) writeVoid(out, element.start, element.end);
  for (const element of parsed.zeroTargets) out.fill(0, element.dataStart, element.dataStart + element.dataSize);

  return out.buffer;
}

export function verifyMkv(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanMkv(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const parsed = parseMkv(cleanBuffer);
  const structureIntact = parsed !== null;

  return {
    passed: metadataRemaining === 0 && structureIntact,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: structureIntact ? ['Медиапоток сохранён без перекодирования'] : [],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const mkvHandler: FormatHandler = {
  format: 'mkv',
  scan: scanMkv,
  clean: cleanMkv,
  verify: verifyMkv,
};
