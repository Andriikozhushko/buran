/**
 * AVI metadata scanning and sanitisation.
 *
 * AVI is RIFF with an index (idx1) whose entries reference offsets inside
 * the movi list — so chunks must never move. Cleaning therefore works IN
 * PLACE: metadata chunks (LIST-INFO with artist/software/dates, and the
 * IDIT capture-date chunk) are retyped to JUNK and their content zeroed.
 * Sizes never change; video/audio chunks and the index are untouched.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/** LIST-INFO field labels (shared vocabulary with WAV). */
const INFO_FIELDS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  IART: ['Artist', 'author', 'high'],
  INAM: ['Title', 'other', 'medium'],
  ICMT: ['Comment', 'other', 'medium'],
  ISFT: ['Software', 'software', 'medium'],
  ICRD: ['Creation date', 'dates', 'high'],
  IENG: ['Engineer', 'author', 'high'],
  ICOP: ['Copyright', 'author', 'medium'],
  IGNR: ['Genre', 'other', 'low'],
  ITCH: ['Technician', 'author', 'high'],
  ISRC: ['Source', 'other', 'medium'],
  IDIT: ['Capture date', 'dates', 'high'],
};

interface AviChunk {
  id: string;
  listType: string;
  start: number;
  end: number;
  dataStart: number;
  dataSize: number;
}

/** Flat walk of top-level and one nested level of LIST chunks. */
function parseAvi(buffer: ArrayBuffer): AviChunk[] | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'AVI ') return null;

  const chunks: AviChunk[] = [];
  const walk = (from: number, to: number, depth: number): boolean => {
    let at = from;
    while (at + 8 <= to) {
      const id = tag(at);
      const dataSize = view.getUint32(at + 4, true);
      const dataStart = at + 8;
      let end = dataStart + dataSize;
      if (end > to) return false;
      if (end % 2 === 1 && end < to) end += 1;
      const listType = id === 'LIST' && dataSize >= 4 ? tag(dataStart) : '';
      chunks.push({ id, listType, start: at, end, dataStart, dataSize });
      // Descend into header lists to find nested INFO, but never into movi.
      if (id === 'LIST' && depth < 2 && listType !== 'movi' && listType !== 'INFO') {
        if (!walk(dataStart + 4, dataStart + dataSize, depth + 1)) return false;
      }
      at = end;
    }
    return true;
  };
  if (!walk(12, bytes.length, 0)) return null;
  if (!chunks.some((c) => c.listType === 'hdrl')) return null;
  return chunks;
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

function isMetadataChunk(chunk: AviChunk): boolean {
  return (chunk.id === 'LIST' && chunk.listType === 'INFO') || chunk.id === 'IDIT';
}

export function scanAvi(buffer: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const findings: MetadataFinding[] = [];
  const chunks = parseAvi(buffer);

  if (chunks) {
    for (const chunk of chunks) {
      if (chunk.id === 'IDIT') {
        const value = new TextDecoder('latin1').decode(bytes.slice(chunk.dataStart, chunk.dataStart + Math.min(chunk.dataSize, 64))).replace(/\0+/g, '').trim();
        if (value) findings.push(mk('AVI:IDIT', 'Capture date', value, 'dates', 'high'));
        continue;
      }
      if (chunk.id === 'LIST' && chunk.listType === 'INFO') {
        let at = chunk.dataStart + 4;
        const end = chunk.dataStart + chunk.dataSize;
        while (at + 8 <= end) {
          const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
          const size = view.getUint32(at + 4, true);
          if (at + 8 + size > end) break;
          const value = new TextDecoder('latin1').decode(bytes.slice(at + 8, at + 8 + Math.min(size, 256))).replace(/\0+/g, '').trim() || null;
          const info = INFO_FIELDS[id];
          if (info) findings.push(mk(`AVI:${id}`, info[0], value, info[1], info[2]));
          else findings.push(mk(`AVI:${id}`, `INFO field (${id})`, value, 'other', 'medium'));
          at += 8 + size + (size % 2);
        }
      }
    }
  }

  return {
    format: 'avi',
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

export function cleanAvi(buffer: ArrayBuffer): ArrayBuffer {
  const chunks = parseAvi(buffer);
  if (!chunks) throw new Error('Не удалось безопасно разобрать структуру AVI.');
  const out = new Uint8Array(buffer.slice(0));

  for (const chunk of chunks) {
    if (!isMetadataChunk(chunk)) continue;
    // Retype to JUNK and physically zero the payload. Size stays intact, so
    // idx1 offsets and every media chunk position remain valid.
    out.set([0x4a, 0x55, 0x4e, 0x4b], chunk.start); // 'JUNK'
    out.fill(0, chunk.dataStart, chunk.dataStart + chunk.dataSize);
  }
  return out.buffer;
}

/** movi payload bytes, for byte-identity checks. */
export function aviMediaRegion(buffer: ArrayBuffer): Uint8Array {
  const chunks = parseAvi(buffer);
  const movi = chunks?.find((c) => c.listType === 'movi');
  if (!movi) return new Uint8Array(0);
  return new Uint8Array(buffer).slice(movi.dataStart, movi.dataStart + movi.dataSize);
}

export function verifyAvi(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanAvi(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const chunks = parseAvi(cleanBuffer);
  const structureIntact = chunks !== null && !chunks.some(isMetadataChunk);

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

export const aviHandler: FormatHandler = {
  format: 'avi',
  scan: scanAvi,
  clean: cleanAvi,
  verify: verifyAvi,
};
