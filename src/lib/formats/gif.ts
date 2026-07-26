/**
 * GIF metadata scanning and sanitisation.
 *
 * GIF is a linear sequence of blocks. Metadata lives in extensions:
 * Comment Extensions (0xFE) and Application Extensions (0xFF, including
 * XMP-in-GIF). Cleaning copies the file block-by-block, dropping metadata
 * extensions while keeping everything functional or visible verbatim:
 * image descriptors and pixel data, Graphic Control (animation timing),
 * Plain Text (visible content), the NETSCAPE/ANIMEXTS looping extension,
 * and the ICC colour profile extension. No pixel re-encoding.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/** Functional or colour application-extension identifiers preserved verbatim. */
const KEEP_APP_IDS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0', 'ICCRGBG1012']);

interface GifBlock {
  kind: 'image' | 'graphic-control' | 'plain-text' | 'comment' | 'application' | 'trailer';
  start: number;
  end: number;
  /** Application identifier (11 chars) for application extensions. */
  appId?: string;
  /** Decoded text for comment extensions. */
  text?: string;
}

interface ParsedGif {
  /** Header + LSD + GCT: copied verbatim to the output. */
  prefixEnd: number;
  width: number;
  height: number;
  blocks: GifBlock[];
}

/** Walk data sub-blocks starting at `at`; returns the offset after the 0 terminator. */
function skipSubBlocks(bytes: Uint8Array, at: number): number {
  while (at < bytes.length) {
    const len = bytes[at];
    at += 1;
    if (len === 0) return at;
    at += len;
  }
  return at;
}

function readSubBlockText(bytes: Uint8Array, at: number, maxChars: number): string {
  let text = '';
  while (at < bytes.length && text.length < maxChars) {
    const len = bytes[at];
    at += 1;
    if (len === 0) break;
    for (let i = 0; i < len && text.length < maxChars; i++) {
      const b = bytes[at + i];
      text += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·';
    }
    at += len;
  }
  return text;
}

function parseGif(buffer: ArrayBuffer): ParsedGif | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 13) return null;
  const header = String.fromCharCode(...bytes.slice(0, 6));
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;

  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const flags = bytes[10];
  let at = 13;
  if (flags & 0x80) at += 3 * 2 ** ((flags & 0x07) + 1); // Global Color Table
  const prefixEnd = at;
  if (prefixEnd > bytes.length) return null;

  const blocks: GifBlock[] = [];
  while (at < bytes.length) {
    const start = at;
    const introducer = bytes[at];

    if (introducer === 0x3b) {
      blocks.push({ kind: 'trailer', start, end: at + 1 });
      break;
    }

    if (introducer === 0x2c) {
      // Image Descriptor: 10 bytes, optional Local Color Table, LZW min code, data.
      if (at + 10 > bytes.length) return null;
      const localFlags = bytes[at + 9];
      at += 10;
      if (localFlags & 0x80) at += 3 * 2 ** ((localFlags & 0x07) + 1);
      at += 1; // LZW minimum code size
      at = skipSubBlocks(bytes, at);
      blocks.push({ kind: 'image', start, end: at });
      continue;
    }

    if (introducer === 0x21) {
      if (at + 2 > bytes.length) return null;
      const label = bytes[at + 1];
      at += 2;
      if (label === 0xfe) {
        const text = readSubBlockText(bytes, at, 180);
        at = skipSubBlocks(bytes, at);
        blocks.push({ kind: 'comment', start, end: at, text });
      } else if (label === 0xff) {
        const idLen = bytes[at];
        const appId = String.fromCharCode(...bytes.slice(at + 1, at + 1 + Math.min(idLen, 11)));
        at = skipSubBlocks(bytes, at);
        blocks.push({ kind: 'application', start, end: at, appId });
      } else if (label === 0xf9) {
        at = skipSubBlocks(bytes, at);
        blocks.push({ kind: 'graphic-control', start, end: at });
      } else if (label === 0x01) {
        at = skipSubBlocks(bytes, at);
        blocks.push({ kind: 'plain-text', start, end: at });
      } else {
        // Unknown extension label: structurally skippable, treated as metadata.
        at = skipSubBlocks(bytes, at);
        blocks.push({ kind: 'application', start, end: at, appId: `label 0x${label.toString(16)}` });
      }
      continue;
    }

    return null; // unknown introducer — refuse to guess
  }

  return { prefixEnd, width, height, blocks };
}

export function scanGif(buffer: ArrayBuffer): ScanResult {
  const parsed = parseGif(buffer);
  const findings: MetadataFinding[] = [];

  if (parsed) {
    for (const block of parsed.blocks) {
      if (block.kind === 'comment') {
        findings.push({
          category: 'other',
          field: 'GIF:Comment',
          label: 'GIF comment',
          value: block.text || null,
          severity: 'medium',
          description: '',
        });
      }
      if (block.kind === 'application' && block.appId && !KEEP_APP_IDS.has(block.appId)) {
        const isXmp = block.appId.startsWith('XMP Data');
        findings.push({
          category: isXmp ? 'containers' : 'software',
          field: isXmp ? 'GIF:XMP' : `GIF:App:${block.appId}`,
          label: isXmp ? 'XMP metadata' : `Application extension (${block.appId.trim() || 'unknown'})`,
          value: 'Present',
          severity: 'medium',
          description: '',
        });
      }
    }
  }

  return {
    format: 'gif',
    findings,
    preservedInfo: {
      hasIccProfile: parsed?.blocks.some((b) => b.kind === 'application' && b.appId === 'ICCRGBG1012') ?? false,
      iccDescription: null,
      hasTransparency: false,
      dimensions: parsed ? { width: parsed.width, height: parsed.height } : null,
      colourChunks: [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

export function cleanGif(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseGif(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру GIF.');
  const bytes = new Uint8Array(buffer);

  const parts: Uint8Array[] = [bytes.slice(0, parsed.prefixEnd)];
  let sawTrailer = false;
  for (const block of parsed.blocks) {
    if (block.kind === 'comment') continue;
    if (block.kind === 'application' && block.appId && !KEEP_APP_IDS.has(block.appId)) continue;
    if (block.kind === 'trailer') sawTrailer = true;
    parts.push(bytes.slice(block.start, block.end));
  }
  if (!sawTrailer) parts.push(new Uint8Array([0x3b]));

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out.buffer;
}

export function verifyGif(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanGif(cleanBuffer);
  const metadataRemaining = rescan.findings.length;

  const dimensionsPreserved =
    !!original.preservedInfo.dimensions &&
    !!rescan.preservedInfo.dimensions &&
    original.preservedInfo.dimensions.width === rescan.preservedInfo.dimensions.width &&
    original.preservedInfo.dimensions.height === rescan.preservedInfo.dimensions.height;

  const technicalDataPreserved: string[] = [];
  if (rescan.preservedInfo.dimensions) {
    const d = rescan.preservedInfo.dimensions;
    technicalDataPreserved.push(`Dimensions: ${d.width}×${d.height}`);
  }

  return {
    passed: metadataRemaining === 0 && dimensionsPreserved,
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

export const gifHandler: FormatHandler = {
  format: 'gif',
  scan: scanGif,
  clean: cleanGif,
  verify: verifyGif,
};
