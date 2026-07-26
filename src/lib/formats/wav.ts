/**
 * WAV metadata scanning and sanitisation.
 *
 * WAV is RIFF: chunks in a flat list. Audio lives in `fmt `/`data` (plus a
 * few functional chunks); metadata rides along in LIST-INFO (artist, name,
 * software, dates…), `bext` (Broadcast WAV originator/description/date),
 * `id3 `, `iXML`, and XMP (`_PMX`). Cleaning rebuilds the file from an
 * explicit keep-list — everything else is dropped and disclosed, including
 * unknown chunks (unknown bytes are a place to hide data). Audio samples
 * are copied byte-for-byte.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/** Structural/functional chunks preserved verbatim. */
const KEEP_CHUNKS = new Set(['fmt ', 'data', 'fact', 'cue ', 'smpl', 'inst', 'plst', 'ds64']);

/** LIST-INFO field labels: id → [label, category, severity]. */
const INFO_FIELDS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  IART: ['Artist', 'author', 'high'],
  INAM: ['Title', 'other', 'medium'],
  ICMT: ['Comment', 'other', 'medium'],
  ISFT: ['Software', 'software', 'medium'],
  ICRD: ['Creation date', 'dates', 'high'],
  IENG: ['Engineer', 'author', 'high'],
  ICOP: ['Copyright', 'author', 'medium'],
  IGNR: ['Genre', 'other', 'low'],
  IPRD: ['Product/album', 'other', 'medium'],
  ITCH: ['Technician', 'author', 'high'],
  ISBJ: ['Subject', 'other', 'medium'],
  ISRC: ['Source', 'other', 'medium'],
};

interface WavChunk {
  id: string;
  start: number; // absolute, includes 8-byte chunk header
  end: number; // includes padding byte if odd
  dataStart: number;
  dataSize: number;
}

function parseWav(buffer: ArrayBuffer): WavChunk[] | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 12) return null;
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

  const chunks: WavChunk[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const dataSize = view.getUint32(at + 4, true);
    const dataStart = at + 8;
    let end = dataStart + dataSize;
    if (end > bytes.length) return null;
    if (end % 2 === 1 && end < bytes.length) end += 1; // RIFF word padding
    chunks.push({ id, start: at, end, dataStart, dataSize });
    at = end;
  }
  if (!chunks.some((c) => c.id === 'fmt ') || !chunks.some((c) => c.id === 'data')) return null;
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

function chunkText(bytes: Uint8Array, at: number, length: number): string {
  return new TextDecoder('latin1')
    .decode(bytes.slice(at, at + Math.min(length, 256)))
    .replace(/\0+/g, '')
    .trim();
}

function listType(bytes: Uint8Array, chunk: WavChunk): string {
  return chunk.dataSize >= 4
    ? String.fromCharCode(bytes[chunk.dataStart], bytes[chunk.dataStart + 1], bytes[chunk.dataStart + 2], bytes[chunk.dataStart + 3])
    : '';
}

function scanListInfo(bytes: Uint8Array, view: DataView, chunk: WavChunk, findings: MetadataFinding[]): void {
  let at = chunk.dataStart + 4;
  const end = chunk.dataStart + chunk.dataSize;
  while (at + 8 <= end) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > end) break;
    const value = chunkText(bytes, at + 8, size) || null;
    const info = INFO_FIELDS[id];
    if (info) findings.push(mk(`WAV:${id}`, info[0], value, info[1], info[2]));
    else findings.push(mk(`WAV:${id}`, `INFO field (${id})`, value, 'other', 'medium'));
    at += 8 + size + (size % 2);
  }
}

export function scanWav(buffer: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const findings: MetadataFinding[] = [];
  const chunks = parseWav(buffer);

  if (chunks) {
    for (const chunk of chunks) {
      if (KEEP_CHUNKS.has(chunk.id)) continue;
      if (chunk.id === 'LIST') {
        const type = listType(bytes, chunk);
        if (type === 'INFO') scanListInfo(bytes, view, chunk, findings);
        else findings.push(mk(`WAV:LIST:${type}`, `LIST chunk (${type.trim() || 'unknown'})`, 'Present', 'containers', 'medium'));
      } else if (chunk.id === 'bext') {
        const description = chunkText(bytes, chunk.dataStart, 256);
        const originator = chunkText(bytes, chunk.dataStart + 256, 32);
        const date = chunk.dataSize >= 330 ? chunkText(bytes, chunk.dataStart + 320, 10) : '';
        findings.push(
          mk('WAV:bext', 'Broadcast WAV metadata', [description, originator, date].filter(Boolean).join(' — ') || 'Present', 'containers', 'high'),
        );
      } else if (chunk.id === 'id3 ' || chunk.id === 'ID3 ') {
        findings.push(mk('WAV:id3', 'ID3 tag', 'Present', 'containers', 'medium'));
      } else if (chunk.id === 'iXML') {
        findings.push(mk('WAV:iXML', 'iXML production metadata', 'Present', 'containers', 'high'));
      } else if (chunk.id === '_PMX') {
        findings.push(mk('WAV:xmp', 'XMP metadata', 'Present', 'containers', 'medium'));
      } else {
        findings.push(mk(`WAV:${chunk.id}`, `Chunk (${chunk.id.trim()})`, `${chunk.dataSize} bytes`, 'other', 'medium'));
      }
    }
  }

  return {
    format: 'wav',
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

export function cleanWav(buffer: ArrayBuffer): ArrayBuffer {
  const chunks = parseWav(buffer);
  if (!chunks) throw new Error('Не удалось безопасно разобрать структуру WAV.');
  const bytes = new Uint8Array(buffer);

  const kept = chunks.filter((c) => KEEP_CHUNKS.has(c.id));
  const body = kept.reduce((sum, c) => sum + (c.end - c.start), 0);

  const out = new Uint8Array(12 + body);
  const view = new DataView(out.buffer);
  out.set(bytes.slice(0, 12));
  view.setUint32(4, 4 + body, true); // RIFF size
  let at = 12;
  for (const chunk of kept) {
    out.set(bytes.slice(chunk.start, chunk.end), at);
    at += chunk.end - chunk.start;
  }
  return out.buffer;
}

/** Raw audio sample bytes (the data chunk), for byte-identity checks. */
export function wavAudioRegion(buffer: ArrayBuffer): Uint8Array {
  const chunks = parseWav(buffer);
  const data = chunks?.find((c) => c.id === 'data');
  if (!data) return new Uint8Array(0);
  return new Uint8Array(buffer).slice(data.dataStart, data.dataStart + data.dataSize);
}

export function verifyWav(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanWav(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const structureIntact = parseWav(cleanBuffer) !== null;

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

export const wavHandler: FormatHandler = {
  format: 'wav',
  scan: scanWav,
  clean: cleanWav,
  verify: verifyWav,
};
