/**
 * PSD metadata scanning and sanitisation.
 *
 * A PSD is: header (26) + colour mode data + Image Resources section (8BIM
 * blocks) + layers + composite image data. Metadata lives in specific 8BIM
 * resource IDs: IPTC, EXIF, XMP, thumbnails, URLs, version-info (writer
 * name). Cleaning rebuilds only the resources section — known metadata
 * blocks are dropped and disclosed, the ICC profile and every structural
 * resource are kept, and the layer/pixel sections are copied byte-for-byte.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/** 8BIM resource ids that are metadata: id → [label, category, severity]. */
const METADATA_RESOURCES: Record<number, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  0x0404: ['IPTC metadata', 'containers', 'high'],
  0x0409: ['Thumbnail (Photoshop 4)', 'thumbnails', 'medium'],
  0x040b: ['URL', 'other', 'high'],
  0x040c: ['Thumbnail', 'thumbnails', 'medium'],
  0x0421: ['Version info (writer)', 'software', 'medium'],
  0x0422: ['EXIF data', 'containers', 'high'],
  0x0423: ['EXIF data (3)', 'containers', 'high'],
  0x0424: ['XMP metadata', 'containers', 'high'],
  0x0425: ['Caption digest', 'other', 'low'],
  0x043a: ['URL list', 'other', 'high'],
};

const ICC_RESOURCE = 0x040f;

interface PsdResource {
  id: number;
  start: number;
  end: number;
}

interface ParsedPsd {
  /** Offset of the resources section length field. */
  resourcesLengthAt: number;
  resourcesStart: number;
  resourcesEnd: number;
  resources: PsdResource[];
  width: number;
  height: number;
}

function parsePsd(buffer: ArrayBuffer): ParsedPsd | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 30) return null;
  if (bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) return null; // '8BPS'
  const version = view.getUint16(4, false);
  if (version !== 1 && version !== 2) return null;

  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);

  const colourDataLength = view.getUint32(26, false);
  const resourcesLengthAt = 26 + 4 + colourDataLength;
  if (resourcesLengthAt + 4 > bytes.length) return null;
  const resourcesLength = view.getUint32(resourcesLengthAt, false);
  const resourcesStart = resourcesLengthAt + 4;
  const resourcesEnd = resourcesStart + resourcesLength;
  if (resourcesEnd > bytes.length) return null;

  const resources: PsdResource[] = [];
  let at = resourcesStart;
  while (at + 12 <= resourcesEnd) {
    if (!(bytes[at] === 0x38 && bytes[at + 1] === 0x42 && bytes[at + 2] === 0x49 && bytes[at + 3] === 0x4d)) break; // '8BIM'
    const id = view.getUint16(at + 4, false);
    // Pascal name: length byte + name, padded to even.
    const nameLength = bytes[at + 6];
    let p = at + 6 + 1 + nameLength;
    if ((1 + nameLength) % 2 === 1) p += 1;
    if (p + 4 > resourcesEnd) break;
    const size = view.getUint32(p, false);
    let end = p + 4 + size;
    if (end % 2 === 1) end += 1;
    if (end > resourcesEnd) break;
    resources.push({ id, start: at, end });
    at = end;
  }

  return { resourcesLengthAt, resourcesStart, resourcesEnd, resources, width, height };
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

export function scanPsd(buffer: ArrayBuffer): ScanResult {
  const parsed = parsePsd(buffer);
  const findings: MetadataFinding[] = [];
  let hasIccProfile = false;

  if (parsed) {
    for (const resource of parsed.resources) {
      if (resource.id === ICC_RESOURCE) {
        hasIccProfile = true;
        continue;
      }
      const info = METADATA_RESOURCES[resource.id];
      if (info) findings.push(mk(`PSD:0x${resource.id.toString(16)}`, info[0], 'Present', info[1], info[2]));
    }
  }

  return {
    format: 'psd',
    findings,
    preservedInfo: {
      hasIccProfile,
      iccDescription: hasIccProfile ? 'ICC profile' : null,
      hasTransparency: false,
      dimensions: parsed && parsed.width > 0 && parsed.height > 0 ? { width: parsed.width, height: parsed.height } : null,
      colourChunks: hasIccProfile ? ['ICC profile'] : [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

export function cleanPsd(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parsePsd(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру PSD.');
  const bytes = new Uint8Array(buffer);

  const kept = parsed.resources.filter((r) => !METADATA_RESOURCES[r.id]);
  const keptSize = kept.reduce((sum, r) => sum + (r.end - r.start), 0);

  const head = bytes.slice(0, parsed.resourcesLengthAt);
  const tail = bytes.slice(parsed.resourcesEnd);
  const out = new Uint8Array(head.length + 4 + keptSize + tail.length);
  out.set(head, 0);
  new DataView(out.buffer).setUint32(head.length, keptSize, false);
  let at = head.length + 4;
  for (const resource of kept) {
    out.set(bytes.slice(resource.start, resource.end), at);
    at += resource.end - resource.start;
  }
  out.set(tail, at);
  return out.buffer;
}

/** Layer + image data bytes (everything after the resources section). */
export function psdImageRegion(buffer: ArrayBuffer): Uint8Array {
  const parsed = parsePsd(buffer);
  if (!parsed) return new Uint8Array(0);
  return new Uint8Array(buffer).slice(parsed.resourcesEnd);
}

export function verifyPsd(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanPsd(cleanBuffer);
  const metadataRemaining = rescan.findings.length;

  const dimensionsPreserved =
    !original.preservedInfo.dimensions ||
    (rescan.preservedInfo.dimensions?.width === original.preservedInfo.dimensions.width &&
      rescan.preservedInfo.dimensions?.height === original.preservedInfo.dimensions.height);
  const iccPreserved = !original.preservedInfo.hasIccProfile || rescan.preservedInfo.hasIccProfile;

  const technicalDataPreserved: string[] = [];
  if (rescan.preservedInfo.dimensions) {
    const d = rescan.preservedInfo.dimensions;
    technicalDataPreserved.push(`Dimensions: ${d.width}×${d.height}`);
  }
  if (rescan.preservedInfo.hasIccProfile) technicalDataPreserved.push('ICC profile');

  return {
    passed: metadataRemaining === 0 && dimensionsPreserved && iccPreserved,
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

export const psdHandler: FormatHandler = {
  format: 'psd',
  scan: scanPsd,
  clean: cleanPsd,
  verify: verifyPsd,
};
