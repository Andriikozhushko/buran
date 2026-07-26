/**
 * FLAC metadata scanning and sanitisation.
 *
 * FLAC is `fLaC` + a chain of explicitly delimited metadata blocks, then
 * audio frames. Cleaning keeps the structural blocks (STREAMINFO, SEEKTABLE,
 * CUESHEET, PADDING), drops the metadata-bearing ones (VORBIS_COMMENT with
 * its tag fields and encoder vendor string, PICTURE cover art, APPLICATION
 * data), fixes the last-block flag, and copies the audio frames
 * byte-for-byte. The safest format in the roadmap: nothing is re-encoded.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

const BLOCK_STREAMINFO = 0;
const BLOCK_APPLICATION = 2;
const BLOCK_VORBIS_COMMENT = 4;
const BLOCK_PICTURE = 6;

/** Block types preserved by the rebuild. */
const KEEP_BLOCKS = new Set([0, 1, 3, 5]); // STREAMINFO, PADDING, SEEKTABLE, CUESHEET

interface FlacBlock {
  type: number;
  start: number; // absolute, includes 4-byte block header
  end: number;
}

interface ParsedFlac {
  blocks: FlacBlock[];
  audioStart: number;
}

function parseFlac(buffer: ArrayBuffer): ParsedFlac | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) return null;

  const blocks: FlacBlock[] = [];
  let at = 4;
  for (;;) {
    if (at + 4 > bytes.length) return null;
    const header = bytes[at];
    const type = header & 0x7f;
    const last = (header & 0x80) !== 0;
    const size = (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 4 + size;
    if (end > bytes.length) return null;
    blocks.push({ type, start: at, end });
    at = end;
    if (last) break;
  }
  if (blocks.length === 0 || blocks[0].type !== BLOCK_STREAMINFO) return null;
  return { blocks, audioStart: at };
}

/** Vorbis-comment field names whose values identify people/tools/dates. */
const COMMENT_LABELS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  TITLE: ['Title', 'other', 'medium'],
  ARTIST: ['Artist', 'author', 'medium'],
  ALBUM: ['Album', 'other', 'medium'],
  DATE: ['Date', 'dates', 'medium'],
  COMMENT: ['Comment', 'other', 'medium'],
  ENCODER: ['Encoder', 'software', 'medium'],
  ENCODED_BY: ['Encoded by', 'author', 'high'],
  COPYRIGHT: ['Copyright', 'author', 'medium'],
  CONTACT: ['Contact', 'author', 'high'],
  LOCATION: ['Location', 'geolocation', 'high'],
};

function mk(
  field: string,
  label: string,
  value: string | null,
  category: MetadataFinding['category'],
  severity: MetadataFinding['severity'],
): MetadataFinding {
  return { category, field, label, value, severity, description: '' };
}

function scanVorbisComment(bytes: Uint8Array, block: FlacBlock, findings: MetadataFinding[]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let at = block.start + 4;
  if (at + 4 > block.end) return;
  const vendorLength = view.getUint32(at, true);
  const vendor = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(at + 4, at + 4 + Math.min(vendorLength, 256)));
  at += 4 + vendorLength;
  if (vendor.trim()) findings.push(mk('FLAC:vendor', 'Encoder vendor', vendor.trim(), 'software', 'medium'));
  if (at + 4 > block.end) return;
  const count = view.getUint32(at, true);
  at += 4;
  for (let i = 0; i < count && at + 4 <= block.end; i++) {
    const length = view.getUint32(at, true);
    at += 4;
    if (at + length > block.end) break;
    const entry = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(at, at + Math.min(length, 512)));
    at += length;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1).trim() || null;
    const info = COMMENT_LABELS[name];
    if (info) findings.push(mk(`FLAC:${name}`, info[0], value, info[1], info[2]));
    else findings.push(mk(`FLAC:${name}`, `Tag (${name})`, value, 'other', 'medium'));
  }
}

export function scanFlac(buffer: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buffer);
  const findings: MetadataFinding[] = [];
  const parsed = parseFlac(buffer);

  if (parsed) {
    for (const block of parsed.blocks) {
      if (block.type === BLOCK_VORBIS_COMMENT) scanVorbisComment(bytes, block, findings);
      else if (block.type === BLOCK_PICTURE) findings.push(mk('FLAC:picture', 'Cover art image', 'Present', 'thumbnails', 'medium'));
      else if (block.type === BLOCK_APPLICATION) findings.push(mk('FLAC:application', 'Application data block', 'Present', 'containers', 'medium'));
    }
  }

  return {
    format: 'flac',
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

export function cleanFlac(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseFlac(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру FLAC.');
  const bytes = new Uint8Array(buffer);

  const kept = parsed.blocks.filter((b) => KEEP_BLOCKS.has(b.type));
  const parts: Uint8Array[] = [bytes.slice(0, 4)];
  kept.forEach((block, index) => {
    const raw = bytes.slice(block.start, block.end);
    // Last-block flag: set on the final kept block only.
    raw[0] = (raw[0] & 0x7f) | (index === kept.length - 1 ? 0x80 : 0);
    parts.push(raw);
  });
  parts.push(bytes.slice(parsed.audioStart));

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

/** The audio frame region, for byte-identity checks. */
export function flacAudioRegion(buffer: ArrayBuffer): Uint8Array {
  const parsed = parseFlac(buffer);
  if (!parsed) return new Uint8Array(0);
  return new Uint8Array(buffer).slice(parsed.audioStart);
}

export function verifyFlac(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanFlac(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const structureIntact = parseFlac(cleanBuffer) !== null;

  return {
    passed: metadataRemaining === 0 && structureIntact,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: structureIntact ? ['Аудиопоток сохранён без перекодирования'] : [],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const flacHandler: FormatHandler = {
  format: 'flac',
  scan: scanFlac,
  clean: cleanFlac,
  verify: verifyFlac,
};
