/**
 * OGG (Vorbis / Opus / FLAC-in-Ogg) metadata scanning and sanitisation.
 *
 * Metadata lives in the comment header packet (Vorbis comment structure:
 * vendor string + user comment list) inside an early page. OGG pages are
 * self-contained — nothing references absolute file offsets — so the page
 * holding the comment packet can be rebuilt smaller: the packet is replaced
 * with an emptied one (blank vendor, zero comments), the segment lacing is
 * recomputed, and the page CRC is recalculated with the OGG CRC-32.
 * Audio pages are copied byte-for-byte. A comment packet that spans pages
 * is refused honestly rather than guessed at.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/** Vorbis-comment field labels (same vocabulary as FLAC). */
const COMMENT_LABELS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  TITLE: ['Title', 'other', 'medium'],
  ARTIST: ['Artist', 'author', 'medium'],
  ALBUM: ['Album', 'other', 'medium'],
  DATE: ['Date', 'dates', 'medium'],
  COMMENT: ['Comment', 'other', 'medium'],
  ENCODER: ['Encoder', 'software', 'medium'],
  ENCODED_BY: ['Encoded by', 'author', 'high'],
  LOCATION: ['Location', 'geolocation', 'high'],
  CONTACT: ['Contact', 'author', 'high'],
};

// OGG CRC-32: polynomial 0x04c11db7, no reflection, init 0, xorout 0.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = ((r << 1) ^ (r & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
    table[i] = r;
  }
  return table;
})();

function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = (((crc << 8) >>> 0) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  }
  return crc;
}

interface OggPage {
  start: number;
  end: number;
  headerType: number;
  segmentTable: number[];
  bodyStart: number;
  /** Packet spans within the body (incomplete final packet marked). */
  packets: Array<{ start: number; end: number; complete: boolean }>;
}

function parsePages(buffer: ArrayBuffer): OggPage[] | null {
  const bytes = new Uint8Array(buffer);
  const pages: OggPage[] = [];
  let at = 0;
  while (at + 27 <= bytes.length) {
    if (bytes[at] !== 0x4f || bytes[at + 1] !== 0x67 || bytes[at + 2] !== 0x67 || bytes[at + 3] !== 0x53) return null;
    const headerType = bytes[at + 5];
    const segmentCount = bytes[at + 26];
    const headerEnd = at + 27 + segmentCount;
    if (headerEnd > bytes.length) return null;
    const segmentTable = Array.from(bytes.slice(at + 27, headerEnd));
    const bodySize = segmentTable.reduce((sum, s) => sum + s, 0);
    if (headerEnd + bodySize > bytes.length) return null;

    const packets: OggPage['packets'] = [];
    let packetStart = headerEnd;
    let cursor = headerEnd;
    for (let i = 0; i < segmentTable.length; i++) {
      cursor += segmentTable[i];
      if (segmentTable[i] < 255) {
        packets.push({ start: packetStart, end: cursor, complete: true });
        packetStart = cursor;
      }
    }
    if (packetStart < cursor) packets.push({ start: packetStart, end: cursor, complete: false });

    pages.push({ start: at, end: headerEnd + bodySize, headerType, segmentTable, bodyStart: headerEnd, packets });
    at = headerEnd + bodySize;
  }
  return pages.length > 0 ? pages : null;
}

/** Locate the comment packet: returns page index, packet index, and the
 * offset of the vorbis-comment structure inside the packet. */
function findCommentPacket(
  bytes: Uint8Array,
  pages: OggPage[],
): { pageIndex: number; packetIndex: number; commentOffset: number; magic: Uint8Array } | null {
  const text = (at: number, len: number) => new TextDecoder('latin1').decode(bytes.slice(at, at + len));
  for (let p = 0; p < Math.min(pages.length, 4); p++) {
    for (const [i, packet] of pages[p].packets.entries()) {
      if (text(packet.start, 8) === 'OpusTags') {
        return { pageIndex: p, packetIndex: i, commentOffset: 8, magic: bytes.slice(packet.start, packet.start + 8) };
      }
      if (bytes[packet.start] === 3 && text(packet.start + 1, 6) === 'vorbis') {
        return { pageIndex: p, packetIndex: i, commentOffset: 7, magic: bytes.slice(packet.start, packet.start + 7) };
      }
    }
  }
  return null;
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

function scanComments(bytes: Uint8Array, at: number, end: number, findings: MetadataFinding[]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  if (at + 4 > end) return;
  const vendorLength = view.getUint32(at, true);
  const vendor = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(at + 4, at + 4 + Math.min(vendorLength, 256))).trim();
  at += 4 + vendorLength;
  if (vendor) findings.push(mk('OGG:vendor', 'Encoder vendor', vendor, 'software', 'medium'));
  if (at + 4 > end) return;
  const count = view.getUint32(at, true);
  at += 4;
  for (let i = 0; i < count && at + 4 <= end; i++) {
    const length = view.getUint32(at, true);
    at += 4;
    if (at + length > end) break;
    const entry = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(at, at + Math.min(length, 512)));
    at += length;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const name = entry.slice(0, eq).toUpperCase();
    const value = entry.slice(eq + 1).trim() || null;
    const info = COMMENT_LABELS[name];
    if (info) findings.push(mk(`OGG:${name}`, info[0], value, info[1], info[2]));
    else findings.push(mk(`OGG:${name}`, `Tag (${name})`, value, 'other', 'medium'));
  }
}

export function scanOgg(buffer: ArrayBuffer): ScanResult {
  const bytes = new Uint8Array(buffer);
  const findings: MetadataFinding[] = [];
  const pages = parsePages(buffer);

  if (pages) {
    const comment = findCommentPacket(bytes, pages);
    if (comment) {
      const packet = pages[comment.pageIndex].packets[comment.packetIndex];
      if (packet.complete) {
        scanComments(bytes, packet.start + comment.commentOffset, packet.end, findings);
      } else {
        findings.push(mk('OGG:comments', 'Comment header (spans pages)', 'Present', 'containers', 'medium'));
      }
    }
  }

  return {
    format: 'ogg',
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

export function cleanOgg(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const pages = parsePages(buffer);
  if (!pages) throw new Error('Не удалось безопасно разобрать структуру OGG.');

  const comment = findCommentPacket(bytes, pages);
  if (!comment) return bytes.slice().buffer; // nothing to remove

  const page = pages[comment.pageIndex];
  const packet = page.packets[comment.packetIndex];
  if (!packet.complete) {
    throw new Error('Комментарии OGG растянуты на несколько страниц. BURAN пока не пересобирает такие файлы, поэтому файл не был изменён.');
  }

  // Emptied comment packet: magic + blank vendor + zero user comments
  // (+ framing bit for Vorbis).
  const isVorbis = comment.commentOffset === 7;
  const emptied = new Uint8Array(comment.magic.length + 8 + (isVorbis ? 1 : 0));
  emptied.set(comment.magic, 0);
  if (isVorbis) emptied[emptied.length - 1] = 1; // framing bit

  // Rebuild the page: same packets, comment packet replaced.
  const bodies: Uint8Array[] = page.packets.map((p, i) =>
    i === comment.packetIndex ? emptied : bytes.slice(p.start, p.end),
  );
  const segmentTable: number[] = [];
  for (const body of bodies) {
    let remaining = body.length;
    for (;;) {
      if (remaining >= 255) {
        segmentTable.push(255);
        remaining -= 255;
      } else {
        segmentTable.push(remaining);
        break;
      }
    }
  }
  if (segmentTable.length > 255) {
    throw new Error('Страница OGG после пересборки превышает лимит сегментов. BURAN не изменил файл.');
  }

  const body = new Uint8Array(bodies.reduce((sum, b) => sum + b.length, 0));
  {
    let at = 0;
    for (const b of bodies) {
      body.set(b, at);
      at += b.length;
    }
  }

  const header = bytes.slice(page.start, page.start + 27 + segmentTable.length);
  header.set(bytes.slice(page.start, page.start + 27), 0);
  header[26] = segmentTable.length;
  header.set(segmentTable, 27);

  const newPage = new Uint8Array(header.length + body.length);
  newPage.set(header, 0);
  newPage.set(body, header.length);
  // CRC is computed with its own field zeroed.
  newPage.fill(0, 22, 26);
  const crc = oggCrc(newPage);
  new DataView(newPage.buffer).setUint32(22, crc, true);

  const before = bytes.slice(0, page.start);
  const after = bytes.slice(page.end);
  const out = new Uint8Array(before.length + newPage.length + after.length);
  out.set(before, 0);
  out.set(newPage, before.length);
  out.set(after, before.length + newPage.length);
  return out.buffer;
}

export function verifyOgg(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanOgg(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const structureIntact = parsePages(cleanBuffer) !== null;

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

export const oggHandler: FormatHandler = {
  format: 'ogg',
  scan: scanOgg,
  clean: cleanOgg,
  verify: verifyOgg,
};
