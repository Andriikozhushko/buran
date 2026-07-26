/**
 * BMP metadata scanning and sanitisation.
 *
 * BMP has almost no metadata surface: the risks are a LINKED colour profile
 * in a V5 header (a local file path — a real leak) and arbitrary trailing
 * bytes after the pixel data. Cleaning truncates the file to its structural
 * end (header, palette, pixels, and an EMBEDDED ICC profile which is
 * technical colour data), neutralises linked-profile references to sRGB, and
 * never touches pixel bytes.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

const PROFILE_LINKED = 0x4c494e4b; // 'LINK'
const PROFILE_EMBEDDED = 0x4d424544; // 'MBED'
const CS_SRGB = 0x73524742; // 'sRGB'

interface ParsedBmp {
  dataOffset: number;
  dibSize: number;
  width: number;
  height: number;
  bitCount: number;
  compression: number;
  imageSize: number;
  pixelEnd: number;
  /** V5 colour-space type, or null for pre-V5 headers. */
  csType: number | null;
  profileOffsetFromDib: number;
  profileSize: number;
  /** ASCII path when the profile is LINKED. */
  linkedProfilePath: string | null;
  trailingBytes: number;
}

function parseBmp(buffer: ArrayBuffer): ParsedBmp | null {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;

  const dataOffset = view.getUint32(10, true);
  const dibSize = view.getUint32(14, true);
  if (![12, 40, 52, 56, 108, 124].includes(dibSize)) return null;
  if (14 + dibSize > bytes.length || dataOffset > bytes.length) return null;

  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  const bitCount = view.getUint16(28, true);
  const compression = dibSize >= 40 ? view.getUint32(30, true) : 0;
  let imageSize = dibSize >= 40 ? view.getUint32(34, true) : 0;
  if (imageSize === 0 || compression === 0) {
    const rowSize = Math.floor((bitCount * Math.abs(width) + 31) / 32) * 4;
    imageSize = rowSize * Math.abs(height);
  }
  const pixelEnd = Math.min(dataOffset + imageSize, bytes.length);

  let csType: number | null = null;
  let profileOffsetFromDib = 0;
  let profileSize = 0;
  let linkedProfilePath: string | null = null;
  if (dibSize >= 108) {
    csType = view.getUint32(14 + 56, true);
    if (dibSize >= 124) {
      profileOffsetFromDib = view.getUint32(14 + 112, true);
      profileSize = view.getUint32(14 + 116, true);
      if (csType === PROFILE_LINKED && profileOffsetFromDib > 0) {
        const at = 14 + profileOffsetFromDib;
        let path = '';
        for (let i = at; i < Math.min(at + 260, bytes.length); i++) {
          if (!bytes[i]) break;
          path += String.fromCharCode(bytes[i]);
        }
        linkedProfilePath = path || null;
      }
    }
  }

  const embeddedProfileEnd =
    csType === PROFILE_EMBEDDED && profileOffsetFromDib > 0
      ? Math.min(14 + profileOffsetFromDib + profileSize, bytes.length)
      : 0;
  const structuralEnd = Math.max(pixelEnd, embeddedProfileEnd);
  const trailingBytes = Math.max(0, bytes.length - structuralEnd);

  return {
    dataOffset,
    dibSize,
    width: Math.abs(width),
    height: Math.abs(height),
    bitCount,
    compression,
    imageSize,
    pixelEnd,
    csType,
    profileOffsetFromDib,
    profileSize,
    linkedProfilePath,
    trailingBytes,
  };
}

export function scanBmp(buffer: ArrayBuffer): ScanResult {
  const parsed = parseBmp(buffer);
  const findings: MetadataFinding[] = [];

  if (parsed) {
    if (parsed.linkedProfilePath !== null || parsed.csType === PROFILE_LINKED) {
      findings.push({
        category: 'other',
        field: 'BMP:LinkedProfile',
        label: 'Linked colour profile path',
        value: parsed.linkedProfilePath,
        severity: 'high',
        description: '',
      });
    }
    if (parsed.trailingBytes > 0) {
      findings.push({
        category: 'other',
        field: 'BMP:TrailingData',
        label: 'Trailing data after pixel data',
        value: `${parsed.trailingBytes} bytes`,
        severity: 'medium',
        description: '',
      });
    }
  }

  const hasEmbeddedProfile = parsed?.csType === PROFILE_EMBEDDED;
  return {
    format: 'bmp',
    findings,
    preservedInfo: {
      hasIccProfile: hasEmbeddedProfile ?? false,
      iccDescription: hasEmbeddedProfile ? 'ICC profile' : null,
      hasTransparency: false,
      dimensions: parsed ? { width: parsed.width, height: parsed.height } : null,
      colourChunks: hasEmbeddedProfile ? ['ICC profile'] : [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

export function cleanBmp(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseBmp(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру BMP.');
  const bytes = new Uint8Array(buffer);

  const embeddedProfileEnd =
    parsed.csType === PROFILE_EMBEDDED && parsed.profileOffsetFromDib > 0
      ? Math.min(14 + parsed.profileOffsetFromDib + parsed.profileSize, bytes.length)
      : 0;
  const keepEnd = Math.max(parsed.pixelEnd, embeddedProfileEnd);

  const out = bytes.slice(0, keepEnd);
  const view = new DataView(out.buffer);
  view.setUint32(2, out.length, true); // bfSize

  if (parsed.csType === PROFILE_LINKED && parsed.dibSize >= 108) {
    view.setUint32(14 + 56, CS_SRGB, true);
    if (parsed.dibSize >= 124) {
      view.setUint32(14 + 112, 0, true);
      view.setUint32(14 + 116, 0, true);
      // The path bytes lived between the header and pixel data — zero them.
      const at = 14 + parsed.profileOffsetFromDib;
      if (at > 0 && at < parsed.dataOffset) {
        out.fill(0, at, Math.min(at + 260, parsed.dataOffset));
      }
    }
  }
  return out.buffer;
}

export function verifyBmp(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanBmp(cleanBuffer);
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
  if (rescan.preservedInfo.hasIccProfile) technicalDataPreserved.push('ICC profile');

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

export const bmpHandler: FormatHandler = {
  format: 'bmp',
  scan: scanBmp,
  clean: cleanBmp,
  verify: verifyBmp,
};
