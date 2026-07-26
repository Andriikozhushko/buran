/**
 * MP4 / M4A / M4V / MOV metadata scanning and sanitisation.
 *
 * Phone video is the richest privacy leak most users own: GPS in the `©xyz`
 * atom, device make/model, and creation timestamps in three separate headers
 * (mvhd/tkhd/mdhd). All of it lives in fixed positions or in dedicated
 * boxes (udta, meta/ilst, XMP uuid), so cleaning works IN PLACE:
 *   - metadata boxes are retyped to `free` and their content zeroed —
 *     box sizes never change, so every stco/co64 chunk offset stays valid
 *     and the audio/video bitstream in mdat is untouched byte-for-byte;
 *   - creation/modification timestamps are zeroed in place.
 * No moov rewrite, no offset math, no re-encoding.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';
import { parseBoxes, u16, u32, type Box } from './avif';

/** Containers whose children we descend into. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);

/** Boxes that are pure metadata: retyped to `free` and zeroed. */
const METADATA_BOXES = new Set(['udta', 'meta', 'uuid', 'Xtra']);

/** Known iTunes/QuickTime metadata atoms: type → [label, category, severity]. */
const ATOM_LABELS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  '©xyz': ['GPS coordinates', 'geolocation', 'high'],
  '©nam': ['Title', 'other', 'medium'],
  '©ART': ['Artist', 'author', 'medium'],
  '©alb': ['Album', 'other', 'medium'],
  '©day': ['Date', 'dates', 'high'],
  '©too': ['Encoding tool', 'software', 'medium'],
  '©cmt': ['Comment', 'other', 'medium'],
  '©aut': ['Author', 'author', 'high'],
  '©cpy': ['Copyright', 'author', 'medium'],
  '©mak': ['Device make', 'device', 'high'],
  '©mod': ['Device model', 'device', 'high'],
  '©swr': ['Software', 'software', 'medium'],
  '©enc': ['Encoded by', 'author', 'high'],
  aART: ['Album artist', 'author', 'medium'],
  cprt: ['Copyright', 'author', 'medium'],
  desc: ['Description', 'other', 'medium'],
  ldes: ['Long description', 'other', 'medium'],
  keyw: ['Keywords', 'other', 'medium'],
  auth: ['Author', 'author', 'high'],
};

/** Apple epoch (1904-01-01) → Unix epoch offset in seconds. */
const APPLE_EPOCH_OFFSET = 2082844800;

interface TimestampSite {
  /** Absolute offset of the FullBox version byte. */
  at: number;
  version: number;
  boxType: string;
  creation: number;
  modification: number;
}

interface ParsedMp4 {
  topLevel: Box[];
  /** Every metadata box (udta/meta/uuid) found at any level. */
  metadataBoxes: Box[];
  timestampSites: TimestampSite[];
  trakCount: number;
  hasMoov: boolean;
  hasMdat: boolean;
}

function walk(bytes: Uint8Array, boxes: Box[], parsed: ParsedMp4, depth: number): void {
  if (depth > 8) return;
  for (const box of boxes) {
    if (box.type === 'trak') parsed.trakCount++;

    if (METADATA_BOXES.has(box.type)) {
      parsed.metadataBoxes.push(box);
      continue; // no need to descend — the whole box is destroyed
    }

    if (box.type === 'mvhd' || box.type === 'tkhd' || box.type === 'mdhd') {
      const at = box.start + box.headerSize;
      const version = bytes[at];
      const creation = version === 1 ? u32(bytes, at + 8) : u32(bytes, at + 4);
      const modification = version === 1 ? u32(bytes, at + 16) : u32(bytes, at + 8);
      parsed.timestampSites.push({ at, version, boxType: box.type, creation, modification });
      continue;
    }

    if (CONTAINERS.has(box.type)) {
      walk(bytes, parseBoxes(bytes, box.start + box.headerSize, box.start + box.size), parsed, depth + 1);
    }
  }
}

function parseMp4(buffer: ArrayBuffer): ParsedMp4 | null {
  const bytes = new Uint8Array(buffer);
  const topLevel = parseBoxes(bytes, 0, bytes.length);
  if (topLevel.length === 0 || topLevel[0].type !== 'ftyp') return null;

  const parsed: ParsedMp4 = {
    topLevel,
    metadataBoxes: [],
    timestampSites: [],
    trakCount: 0,
    hasMoov: topLevel.some((b) => b.type === 'moov'),
    hasMdat: topLevel.some((b) => b.type === 'mdat'),
  };
  if (!parsed.hasMoov) return null;

  // Top-level metadata boxes (XMP uuid, stray meta) plus the moov tree.
  for (const box of topLevel) {
    if (METADATA_BOXES.has(box.type)) parsed.metadataBoxes.push(box);
  }
  for (const moov of topLevel.filter((b) => b.type === 'moov')) {
    walk(bytes, parseBoxes(bytes, moov.start + moov.headerSize, moov.start + moov.size), parsed, 0);
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

function atomText(bytes: Uint8Array, box: Box): string | null {
  // iTunes ilst entry: child 'data' box (8 hdr + 4 type + 4 locale + payload).
  const children = parseBoxes(bytes, box.start + box.headerSize, box.start + box.size);
  const data = children.find((c) => c.type === 'data');
  if (data) {
    const payloadAt = data.start + data.headerSize + 8;
    const payload = bytes.slice(payloadAt, Math.min(data.start + data.size, payloadAt + 256));
    return new TextDecoder('utf-8', { fatal: false }).decode(payload).replace(/\0+/g, '').trim() || null;
  }
  // QuickTime udta entry: u16 size + u16 language + text.
  const at = box.start + box.headerSize;
  if (box.size - box.headerSize >= 4) {
    const textSize = u16(bytes, at);
    if (textSize > 0 && at + 4 + textSize <= box.start + box.size) {
      const payload = bytes.slice(at + 4, at + 4 + Math.min(textSize, 256));
      return new TextDecoder('utf-8', { fatal: false }).decode(payload).replace(/\0+/g, '').trim() || null;
    }
  }
  return null;
}

/** Collect labelled atoms inside a metadata box (udta itself or meta/ilst). */
function scanMetadataBox(bytes: Uint8Array, box: Box, findings: MetadataFinding[], depth: number): void {
  if (depth > 4) return;
  // meta is a FullBox — children start after 4 version/flags bytes.
  const contentStart = box.start + box.headerSize + (box.type === 'meta' ? 4 : 0);
  for (const child of parseBoxes(bytes, contentStart, box.start + box.size)) {
    const info = ATOM_LABELS[child.type];
    if (info) {
      findings.push(mk(`MP4:${child.type.replace('©', 'c')}`, info[0], atomText(bytes, child), info[1], info[2]));
    } else if (child.type === 'meta' || child.type === 'ilst' || child.type === 'udta') {
      scanMetadataBox(bytes, child, findings, depth + 1);
    }
  }
}

function appleDate(seconds: number): string {
  return new Date((seconds - APPLE_EPOCH_OFFSET) * 1000).toISOString().slice(0, 19) + 'Z';
}

export function scanMp4(buffer: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buffer);
  const findings: MetadataFinding[] = [];
  const parsed = parseMp4(buffer);

  if (parsed) {
    for (const box of parsed.metadataBoxes) {
      if (box.type === 'uuid') {
        findings.push(mk('MP4:uuid', 'XMP / private metadata (uuid box)', 'Present', 'containers', 'medium'));
      } else {
        const before = findings.length;
        scanMetadataBox(bytes, box, findings, 0);
        // The container is destroyed either way — disclose it even when no
        // individually known atom could be parsed out of it.
        if (findings.length === before) {
          findings.push(mk('MP4:udta', 'User data container (udta/meta)', 'Present', 'containers', 'medium'));
        }
      }
    }

    const created = parsed.timestampSites.find((t) => t.boxType === 'mvhd' && t.creation > 0);
    if (created) {
      findings.push(mk('MP4:created', 'Creation date', appleDate(created.creation), 'dates', 'high'));
    }
    const modified = parsed.timestampSites.find((t) => t.boxType === 'mvhd' && t.modification > 0);
    if (modified && modified.modification !== created?.creation) {
      findings.push(mk('MP4:modified', 'Modification date', appleDate(modified.modification), 'dates', 'medium'));
    }
    const trackDates = parsed.timestampSites.filter((t) => t.boxType !== 'mvhd' && (t.creation > 0 || t.modification > 0)).length;
    if (trackDates > 0) {
      findings.push(mk('MP4:trackDates', 'Track timestamps', String(trackDates), 'dates', 'low'));
    }
  }

  return {
    format: 'mp4',
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

export function cleanMp4(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseMp4(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру MP4/MOV.');
  const out = new Uint8Array(buffer.slice(0));

  // 1. Metadata boxes → `free`, content physically zeroed. Sizes unchanged.
  for (const box of parsed.metadataBoxes) {
    out.set([0x66, 0x72, 0x65, 0x65], box.start + 4); // 'free'
    out.fill(0, box.start + 8, box.start + box.size);
  }

  // 2. Creation/modification timestamps zeroed in place.
  for (const site of parsed.timestampSites) {
    if (site.version === 1) out.fill(0, site.at + 4, site.at + 20);
    else out.fill(0, site.at + 4, site.at + 12);
  }

  return out.buffer;
}

/** Concatenated mdat payloads, for byte-identity checks. */
export function mp4MediaRegion(buffer: ArrayBuffer): Uint8Array[] {
  const bytes = new Uint8Array(buffer);
  const top = parseBoxes(bytes, 0, bytes.length);
  return top.filter((b) => b.type === 'mdat').map((b) => bytes.slice(b.start + b.headerSize, b.start + b.size));
}

export function verifyMp4(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanMp4(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const parsed = parseMp4(cleanBuffer);
  const structureIntact = parsed !== null && parsed.metadataBoxes.length === 0;

  return {
    passed: metadataRemaining === 0 && structureIntact,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: parsed ? [`Дорожек: ${parsed.trakCount}`, 'Медиапоток сохранён без перекодирования'] : [],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const mp4Handler: FormatHandler = {
  format: 'mp4',
  scan: scanMp4,
  clean: cleanMp4,
  verify: verifyMp4,
};
