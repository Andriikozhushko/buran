/**
 * MP3 metadata scanning and sanitisation.
 *
 * An MP3 file is a stream of MPEG audio frames with tag blocks bolted on:
 * ID3v2 at the start, and ID3v1 / APEv2 / Lyrics3 at the end. Cleaning
 * strips every tag block and keeps the audio frame region byte-for-byte —
 * no re-encoding is possible or needed. Cover art (APIC) is inside ID3v2
 * and is removed with it.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/** ID3v2 text frames reported with values: id → [label, category, severity]. */
const ID3_FRAMES: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  TIT2: ['Title', 'other', 'medium'],
  TPE1: ['Artist', 'author', 'medium'],
  TPE2: ['Album artist', 'author', 'medium'],
  TALB: ['Album', 'other', 'medium'],
  TYER: ['Year', 'dates', 'medium'],
  TDRC: ['Recording date', 'dates', 'high'],
  TDEN: ['Encoding date', 'dates', 'medium'],
  TCON: ['Genre', 'other', 'low'],
  TENC: ['Encoded by', 'author', 'high'],
  TSSE: ['Encoder settings', 'software', 'medium'],
  TCOM: ['Composer', 'author', 'medium'],
  TCOP: ['Copyright', 'author', 'medium'],
  TPUB: ['Publisher', 'other', 'medium'],
  TOFN: ['Original filename', 'other', 'high'],
  COMM: ['Comment', 'other', 'medium'],
  USLT: ['Lyrics', 'other', 'low'],
  TXXX: ['Custom text field', 'other', 'medium'],
  WXXX: ['Custom URL', 'other', 'medium'],
  POPM: ['Popularimeter (rater e-mail)', 'author', 'high'],
  UFID: ['Unique file identifier', 'other', 'high'],
  PRIV: ['Private application data', 'other', 'medium'],
  GEOB: ['Embedded object', 'containers', 'medium'],
  APIC: ['Cover art image', 'thumbnails', 'medium'],
};

/** v2.2 three-letter equivalents of the frames above. */
const ID3V22_MAP: Record<string, string> = {
  TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TYE: 'TYER',
  TCO: 'TCON', TEN: 'TENC', TSS: 'TSSE', TCM: 'TCOM', TCR: 'TCOP',
  COM: 'COMM', ULT: 'USLT', TXX: 'TXXX', WXX: 'WXXX', POP: 'POPM',
  UFI: 'UFID', GEO: 'GEOB', PIC: 'APIC',
};

function syncsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f);
}

function u32be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/** Total size of the ID3v2 block at the start of the file, or 0. */
function id3v2Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = 10 + syncsafe(bytes, 6);
  const footer = (bytes[5] & 0x10) !== 0 ? 10 : 0;
  return Math.min(size + footer, bytes.length);
}

function decodeText(bytes: Uint8Array, at: number, length: number): string {
  if (length <= 1) return '';
  const encoding = bytes[at];
  const body = bytes.slice(at + 1, at + length);
  try {
    if (encoding === 1 || encoding === 2) {
      return new TextDecoder(encoding === 1 ? 'utf-16' : 'utf-16be').decode(body).replace(/\0+/g, ' ').trim();
    }
    return new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(body).replace(/\0+/g, ' ').trim();
  } catch {
    return '';
  }
}

interface TagRegions {
  /** Audio region [start, end) after stripping leading/trailing tag blocks. */
  audioStart: number;
  audioEnd: number;
  hasId3v2: boolean;
  hasId3v1: boolean;
  hasApe: boolean;
  hasLyrics3: boolean;
}

function findTagRegions(bytes: Uint8Array): TagRegions {
  const audioStart = id3v2Size(bytes);
  let audioEnd = bytes.length;
  let hasId3v1 = false;
  let hasApe = false;
  let hasLyrics3 = false;

  // ID3v1: fixed 128-byte trailer starting with "TAG".
  if (audioEnd - audioStart >= 128) {
    const at = audioEnd - 128;
    if (bytes[at] === 0x54 && bytes[at + 1] === 0x41 && bytes[at + 2] === 0x47) {
      hasId3v1 = true;
      audioEnd = at;
    }
  }

  // Lyrics3v2: "...LYRICS200" (with 6-digit size) or v1 "LYRICSEND" before ID3v1.
  if (audioEnd - audioStart >= 15) {
    const tail = new TextDecoder('latin1').decode(bytes.slice(audioEnd - 9, audioEnd));
    if (tail === 'LYRICS200') {
      const sizeText = new TextDecoder('latin1').decode(bytes.slice(audioEnd - 15, audioEnd - 9));
      const size = parseInt(sizeText, 10);
      if (!Number.isNaN(size) && size > 0 && audioEnd - 15 - size >= audioStart) {
        hasLyrics3 = true;
        audioEnd = audioEnd - 15 - size;
      }
    } else if (tail === 'LYRICSEND') {
      const window = new TextDecoder('latin1').decode(bytes.slice(Math.max(audioStart, audioEnd - 5100), audioEnd));
      const begin = window.lastIndexOf('LYRICSBEGIN');
      if (begin >= 0) {
        hasLyrics3 = true;
        audioEnd = Math.max(audioStart, audioEnd - 5100) + begin;
      }
    }
  }

  // APEv2/v1: 32-byte footer "APETAGEX" at the (current) end.
  if (audioEnd - audioStart >= 32) {
    const at = audioEnd - 32;
    const magic = new TextDecoder('latin1').decode(bytes.slice(at, at + 8));
    if (magic === 'APETAGEX') {
      const tagSize = bytes[at + 12] | (bytes[at + 13] << 8) | (bytes[at + 14] << 16) | (bytes[at + 15] << 24);
      const flags = u32be(bytes, at + 20);
      const hasHeader = (flags & 0x80) !== 0 || (bytes[at + 23] & 0x80) !== 0;
      const total = tagSize + (hasHeader ? 32 : 0);
      if (total > 0 && audioEnd - total >= audioStart) {
        hasApe = true;
        audioEnd -= total;
      }
    }
  }

  return { audioStart, audioEnd, hasId3v2: audioStart > 0, hasId3v1, hasApe, hasLyrics3 };
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

function scanId3v2Frames(bytes: Uint8Array, findings: MetadataFinding[]): void {
  const version = bytes[3];
  const blockEnd = id3v2Size(bytes);
  let at = 10;
  if ((bytes[5] & 0x40) !== 0 && version >= 3) {
    // Extended header: skip by its own size field.
    at += version === 4 ? syncsafe(bytes, 10) : u32be(bytes, 10) + 4;
  }

  const idLen = version === 2 ? 3 : 4;
  const headerLen = version === 2 ? 6 : 10;
  while (at + headerLen <= blockEnd) {
    const rawId = new TextDecoder('latin1').decode(bytes.slice(at, at + idLen));
    if (!/^[A-Z0-9]+$/.test(rawId)) break; // padding reached
    let size: number;
    if (version === 2) size = (bytes[at + 3] << 16) | (bytes[at + 4] << 8) | bytes[at + 5];
    else if (version === 4) size = syncsafe(bytes, at + idLen);
    else size = u32be(bytes, at + idLen);
    if (size <= 0 || at + headerLen + size > blockEnd) break;

    const id = version === 2 ? (ID3V22_MAP[rawId] ?? rawId) : rawId;
    const info = ID3_FRAMES[id];
    if (info) {
      const [label, category, severity] = info;
      const value =
        id === 'APIC' || id === 'GEOB' || id === 'PRIV' || id === 'UFID'
          ? 'Present'
          : decodeText(bytes, at + headerLen, Math.min(size, 512)) || null;
      findings.push(mk(`MP3:${id}`, label, value, category, severity));
    } else if (rawId !== 'TLEN' && rawId !== 'TRCK' && rawId !== 'TPOS') {
      findings.push(mk(`MP3:${id}`, `ID3 frame (${id})`, null, 'other', 'low'));
    }
    at += headerLen + size;
  }
}

export function scanMp3(buffer: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buffer);
  const findings: MetadataFinding[] = [];
  const regions = findTagRegions(bytes);

  if (regions.hasId3v2) scanId3v2Frames(bytes, findings);
  if (regions.hasId3v1) {
    const trailer = bytes.slice(bytes.length - 128);
    const text = (from: number, len: number) =>
      new TextDecoder('latin1').decode(trailer.slice(from, from + len)).replace(/\0+/g, '').trim();
    const title = text(3, 30);
    const artist = text(33, 30);
    findings.push(mk('MP3:ID3v1', 'ID3v1 tag', [title, artist].filter(Boolean).join(' — ') || 'Present', 'containers', 'medium'));
  }
  if (regions.hasApe) findings.push(mk('MP3:APE', 'APE tag', 'Present', 'containers', 'medium'));
  if (regions.hasLyrics3) findings.push(mk('MP3:Lyrics3', 'Lyrics3 tag', 'Present', 'containers', 'medium'));

  return {
    format: 'mp3',
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

export function cleanMp3(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const regions = findTagRegions(bytes);
  if (regions.audioEnd <= regions.audioStart) {
    throw new Error('MP3 не содержит аудиоданных после тегов.');
  }
  return bytes.slice(regions.audioStart, regions.audioEnd).buffer;
}

/** The audio frame region, for byte-identity checks. */
export function mp3AudioRegion(buffer: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(buffer);
  const regions = findTagRegions(bytes);
  return bytes.slice(regions.audioStart, regions.audioEnd);
}

export function verifyMp3(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanMp3(cleanBuffer);
  const metadataRemaining = rescan.findings.length;

  return {
    passed: metadataRemaining === 0 && cleanBuffer.byteLength > 0,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: ['Аудиопоток сохранён без перекодирования'],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const mp3Handler: FormatHandler = {
  format: 'mp3',
  scan: scanMp3,
  clean: cleanMp3,
  verify: verifyMp3,
};
