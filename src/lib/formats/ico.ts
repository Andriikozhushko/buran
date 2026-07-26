/**
 * ICO metadata scanning and sanitisation.
 *
 * An ICO file is a directory of images whose payloads are either PNG files
 * or raw DIB bitmaps. PNG payloads can carry full PNG metadata (tEXt, eXIf…)
 * and are scanned/cleaned through the PNG core; DIB payloads have no
 * metadata surface and are copied verbatim. Cleaning rebuilds the directory
 * with corrected offsets/sizes and drops any trailing bytes after the last
 * payload.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';
import { pngHandler } from './png';
import { TECHNICAL_COLOUR_FIELDS } from './types';

interface IcoEntry {
  header: Uint8Array; // 16-byte directory entry (offsets patched on rebuild)
  size: number;
  offset: number;
  isPng: boolean;
}

interface ParsedIco {
  type: number;
  entries: IcoEntry[];
}

function isPngPayload(bytes: Uint8Array, offset: number): boolean {
  return (
    offset + 8 <= bytes.length &&
    bytes[offset] === 0x89 && bytes[offset + 1] === 0x50 &&
    bytes[offset + 2] === 0x4e && bytes[offset + 3] === 0x47
  );
}

function parseIco(buffer: ArrayBuffer): ParsedIco | null {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 6) return null;
  if (view.getUint16(0, true) !== 0 || ![1, 2].includes(view.getUint16(2, true))) return null;
  const count = view.getUint16(4, true);
  if (count === 0 || count > 64 || 6 + count * 16 > bytes.length) return null;

  const entries: IcoEntry[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    if (offset + size > bytes.length || size === 0) return null;
    entries.push({
      header: bytes.slice(at, at + 16),
      size,
      offset,
      isPng: isPngPayload(bytes, offset),
    });
  }
  return { type: view.getUint16(2, true), entries };
}

export function scanIco(buffer: ArrayBuffer): ScanResult {
  const parsed = parseIco(buffer);
  const findings: MetadataFinding[] = [];
  const bytes = new Uint8Array(buffer);
  let dimensions: { width: number; height: number } | null = null;

  if (parsed) {
    for (const [index, entry] of parsed.entries.entries()) {
      const w = entry.header[0] || 256;
      const h = entry.header[1] || 256;
      if (!dimensions || w * h > dimensions.width * dimensions.height) dimensions = { width: w, height: h };

      if (entry.isPng) {
        const payload = bytes.slice(entry.offset, entry.offset + entry.size);
        try {
          const scan = pngHandler.scan(payload.buffer);
          for (const f of scan.findings) {
            if (TECHNICAL_COLOUR_FIELDS.has(f.field)) continue;
            findings.push({ ...f, field: `ICO:${index}:${f.field}`, label: `${f.label} (icon ${index + 1})` });
          }
        } catch {
          // Unreadable payload: cleaning will refuse; scan stays silent here.
        }
      }
    }

    const lastEnd = Math.max(...parsed.entries.map((e) => e.offset + e.size));
    if (bytes.length > lastEnd) {
      findings.push({
        category: 'other',
        field: 'ICO:TrailingData',
        label: 'Trailing data after icon payloads',
        value: `${bytes.length - lastEnd} bytes`,
        severity: 'medium',
        description: '',
      });
    }
  }

  return {
    format: 'ico',
    findings,
    preservedInfo: {
      hasIccProfile: false,
      iccDescription: null,
      hasTransparency: true,
      dimensions,
      colourChunks: [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

export function cleanIco(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseIco(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру ICO.');
  const bytes = new Uint8Array(buffer);

  const payloads: Uint8Array[] = parsed.entries.map((entry) => {
    const raw = bytes.slice(entry.offset, entry.offset + entry.size);
    if (!entry.isPng) return raw;
    // PNG payloads go through the PNG core (drops tEXt/eXIf, keeps colour).
    return new Uint8Array(pngHandler.clean(raw.buffer));
  });

  const headerSize = 6 + parsed.entries.length * 16;
  const total = headerSize + payloads.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, parsed.type, true);
  view.setUint16(4, parsed.entries.length, true);

  let offset = headerSize;
  parsed.entries.forEach((entry, i) => {
    const at = 6 + i * 16;
    out.set(entry.header, at);
    view.setUint32(at + 8, payloads[i].length, true);
    view.setUint32(at + 12, offset, true);
    out.set(payloads[i], offset);
    offset += payloads[i].length;
  });

  return out.buffer;
}

export function verifyIco(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanIco(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const parsed = parseIco(cleanBuffer);

  const technicalDataPreserved: string[] = [];
  if (parsed) technicalDataPreserved.push(`Icons: ${parsed.entries.length}`);

  return {
    passed: metadataRemaining === 0 && parsed !== null,
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

export const icoHandler: FormatHandler = {
  format: 'ico',
  scan: scanIco,
  clean: cleanIco,
  verify: verifyIco,
};
