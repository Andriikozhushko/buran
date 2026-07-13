import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

// JPEG marker constants
const EOI = 0xffd9;
const SOS = 0xffda;
const APP1 = 0xffe1; // EXIF
const APP2 = 0xffe2; // ICC / FPXR
const APP13 = 0xffed; // IPTC
const COM = 0xfffe; // Comment
const SOF0 = 0xffc0;
const SOF2 = 0xffc2;

// EXIF tag IDs we care about
const EXIF_TAGS: Record<number, { label: string; category: string; severity: 'low' | 'medium' | 'high' }> = {
  // IFD0
  0x010e: { label: 'Image description', category: 'other', severity: 'low' },
  0x010f: { label: 'Camera manufacturer', category: 'device', severity: 'medium' },
  0x0110: { label: 'Camera model', category: 'device', severity: 'medium' },
  0x0112: { label: 'Orientation', category: 'other', severity: 'low' },
  0x011a: { label: 'X resolution', category: 'other', severity: 'low' },
  0x011b: { label: 'Y resolution', category: 'other', severity: 'low' },
  0x0128: { label: 'Resolution unit', category: 'other', severity: 'low' },
  0x0131: { label: 'Software', category: 'software', severity: 'medium' },
  0x0132: { label: 'Date/time', category: 'dates', severity: 'high' },
  0x013b: { label: 'Artist', category: 'author', severity: 'high' },
  0x013e: { label: 'White point', category: 'other', severity: 'low' },
  0x0213: { label: 'YCbCr positioning', category: 'other', severity: 'low' },
  0x8298: { label: 'Copyright', category: 'author', severity: 'high' },
  0x8769: { label: 'EXIF IFD pointer', category: 'containers', severity: 'medium' },
  0x8825: { label: 'GPS IFD pointer', category: 'containers', severity: 'high' },

  // EXIF SubIFD
  0x829a: { label: 'Exposure time', category: 'device', severity: 'low' },
  0x829d: { label: 'F-number', category: 'device', severity: 'low' },
  0x8822: { label: 'Exposure program', category: 'device', severity: 'low' },
  0x8827: { label: 'ISO speed', category: 'device', severity: 'low' },
  0x9000: { label: 'EXIF version', category: 'other', severity: 'low' },
  0x9003: { label: 'Date/time original', category: 'dates', severity: 'high' },
  0x9004: { label: 'Date/time digitised', category: 'dates', severity: 'high' },
  0x9201: { label: 'Shutter speed value', category: 'device', severity: 'low' },
  0x9202: { label: 'Aperture value', category: 'device', severity: 'low' },
  0x9204: { label: 'Exposure compensation', category: 'device', severity: 'low' },
  0x9207: { label: 'Metering mode', category: 'device', severity: 'low' },
  0x9209: { label: 'Flash', category: 'device', severity: 'low' },
  0x920a: { label: 'Focal length', category: 'device', severity: 'low' },
  0x927c: { label: 'MakerNote', category: 'device', severity: 'medium' },
  0x9286: { label: 'User comment', category: 'other', severity: 'medium' },
  0xa002: { label: 'Pixel X dimension', category: 'other', severity: 'low' },
  0xa003: { label: 'Pixel Y dimension', category: 'other', severity: 'low' },
  0xa004: { label: 'Lens model', category: 'device', severity: 'medium' },
  0xa005: { label: 'Interop IFD pointer', category: 'containers', severity: 'low' },
  0xa420: { label: 'Image unique ID', category: 'device', severity: 'medium' },
  0xa430: { label: 'Camera owner name', category: 'author', severity: 'high' },
  0xa431: { label: 'Camera serial number', category: 'device', severity: 'high' },
  0xa432: { label: 'Lens specification', category: 'device', severity: 'medium' },
  0xa433: { label: 'Lens make', category: 'device', severity: 'high' },
  0xa434: { label: 'Lens model (Exif)', category: 'device', severity: 'medium' },
  0xa435: { label: 'Lens serial number', category: 'device', severity: 'high' },

  // GPS
  0x0000: { label: 'GPS version', category: 'geolocation', severity: 'low' },
  0x0001: { label: 'GPS latitude ref', category: 'geolocation', severity: 'high' },
  0x0002: { label: 'GPS latitude', category: 'geolocation', severity: 'high' },
  0x0003: { label: 'GPS longitude ref', category: 'geolocation', severity: 'high' },
  0x0004: { label: 'GPS longitude', category: 'geolocation', severity: 'high' },
  0x0005: { label: 'GPS altitude ref', category: 'geolocation', severity: 'high' },
  0x0006: { label: 'GPS altitude', category: 'geolocation', severity: 'high' },
  0x0007: { label: 'GPS timestamp', category: 'geolocation', severity: 'high' },
  0x0012: { label: 'GPS measure mode', category: 'geolocation', severity: 'medium' },
  0x001d: { label: 'GPS date', category: 'geolocation', severity: 'high' },
};

interface ExifFinding {
  tagId: number;
  tagName: string;
  value: string | null;
  category: string;
  severity: 'low' | 'medium' | 'high';
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    const b = bytes[offset + i];
    if (b === 0) break;
    str += String.fromCharCode(b);
  }
  return str;
}

function readUint16(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint16(offset, littleEndian);
}

function readUint32(view: DataView, offset: number, littleEndian: boolean): number {
  return view.getUint32(offset, littleEndian);
}

function gpsToDecimal(
  ref: string,
  degrees: number,
  minutes: number,
  seconds: number,
): number | null {
  if (!ref) return null;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return Math.round(decimal * 10_000) / 10_000;
}

function parseRational(view: DataView, offset: number, littleEndian: boolean): number {
  const num = readUint32(view, offset, littleEndian);
  const den = readUint32(view, offset + 4, littleEndian);
  if (den === 0) return 0;
  return num / den;
}

function parseExifTagValue(
  view: DataView,
  tiffStart: number,
  _tagId: number,
  type: number,
  count: number,
  valueOffset: number,
  littleEndian: boolean,
): string | null {
  const totalBytes = typeSizes[type] !== undefined ? typeSizes[type] * count : 0;
  let dataOffset: number;
  if (totalBytes <= 4) {
    // Value is inlined
    dataOffset = valueOffset;
  } else {
    dataOffset = tiffStart + readUint32(view, valueOffset, littleEndian);
  }

  // Ensure dataOffset is within bounds
  if (dataOffset < 0 || dataOffset >= view.byteLength) return null;

  switch (type) {
    case 1: // BYTE
    case 7: // UNDEFINED
      if (totalBytes > 256) return '[data]';
      return `[${count} bytes]`;
    case 2: // ASCII
      return readString(
        new Uint8Array(view.buffer),
        dataOffset,
        Math.min(count, 256),
      );
    case 3: // SHORT
      if (count === 1) return String(readUint16(view, dataOffset, littleEndian));
      return `[${count} values]`;
    case 4: // LONG
      if (count === 1) return String(readUint32(view, dataOffset, littleEndian));
      return `[${count} values]`;
    case 5: // RATIONAL
      if (count === 1) return String(parseRational(view, dataOffset, littleEndian));
      return `[${count} values]`;
    case 9: // SLONG
      if (count === 1) return String(view.getInt32(dataOffset, littleEndian));
      return `[${count} values]`;
    case 10: // SRATIONAL
      if (count === 1) {
        const num = view.getInt32(dataOffset, littleEndian);
        const den = view.getInt32(dataOffset + 4, littleEndian);
        return den === 0 ? '0' : String(num / den);
      }
      return `[${count} values]`;
    default:
      return `[type ${type}]`;
  }
}

const typeSizes: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

function parseExifIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean,
  tagPrefix: string,
): ExifFinding[] {
  const findings: ExifFinding[] = [];

  // Safety check
  if (ifdOffset < 0 || ifdOffset >= view.byteLength - 2) return findings;

  try {
    const numEntries = readUint16(view, ifdOffset, littleEndian);
    if (ifdOffset + 2 + numEntries * 12 > view.byteLength) return findings;

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tagId = readUint16(view, entryOffset, littleEndian);
      const type = readUint16(view, entryOffset + 2, littleEndian);
      const count = readUint32(view, entryOffset + 4, littleEndian);
      const valueOffset = entryOffset + 8;

      const tagInfo = EXIF_TAGS[tagId];

      if (tagInfo) {
        const value = parseExifTagValue(view, tiffStart, tagId, type, count, valueOffset, littleEndian);
        findings.push({
          tagId,
          tagName: tagInfo.label,
          value,
          category: tagInfo.category,
          severity: tagInfo.severity,
        });
      }

      // Recursively parse sub-IFDs for EXIF and GPS
      if (tagId === 0x8769 && type === 4 && tagPrefix === 'IFD0') {
        // EXIF SubIFD
        const subOffset = readUint32(view, valueOffset, littleEndian);
        const subFindings = parseExifIfd(view, tiffStart, tiffStart + subOffset, littleEndian, 'EXIF');
        findings.push(...subFindings);
      }

      if (tagId === 0x8825 && type === 4 && tagPrefix === 'IFD0') {
        // GPS IFD
        const gpsOffset = readUint32(view, valueOffset, littleEndian);
        const gpsFindings = parseGpsIfd(view, tiffStart, tiffStart + gpsOffset, littleEndian);
        findings.push(...gpsFindings);
      }
    }
  } catch {
    // Gracefully handle binary parsing errors
  }

  return findings;
}

function parseGpsIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean,
): ExifFinding[] {
  const findings: ExifFinding[] = [];

  if (ifdOffset < 0 || ifdOffset >= view.byteLength - 2) return findings;

  try {
    const numEntries = readUint16(view, ifdOffset, littleEndian);
    if (ifdOffset + 2 + numEntries * 12 > view.byteLength) return findings;

    // Collect raw GPS values for coordinate computation
    let latRef: string | null = null;
    let latDeg: number | null = null;
    let latMin: number | null = null;
    let latSec: number | null = null;
    let lonRef: string | null = null;
    let lonDeg: number | null = null;
    let lonMin: number | null = null;
    let lonSec: number | null = null;
    let altVal: number | null = null;

    for (let i = 0; i < numEntries; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tagId = readUint16(view, entryOffset, littleEndian);
      const type = readUint16(view, entryOffset + 2, littleEndian);
      const count = readUint32(view, entryOffset + 4, littleEndian);
      const valueOffset = entryOffset + 8;

      const totalBytes = typeSizes[type] !== undefined ? typeSizes[type] * count : 0;
      let dataOffset: number;
      if (totalBytes <= 4) {
        dataOffset = valueOffset;
      } else {
        dataOffset = tiffStart + readUint32(view, valueOffset, littleEndian);
      }

      if (dataOffset < 0 || dataOffset >= view.byteLength) continue;

      const tagInfo = EXIF_TAGS[tagId] || {
        label: `GPS tag 0x${tagId.toString(16)}`,
        category: 'geolocation',
        severity: 'medium' as const,
      };

      switch (tagId) {
        case 0x0001:
          latRef = readString(new Uint8Array(view.buffer), dataOffset, 2);
          break;
        case 0x0002:
          if (count === 3 && type === 5) {
            latDeg = parseRational(view, dataOffset, littleEndian);
            latMin = parseRational(view, dataOffset + 8, littleEndian);
            latSec = parseRational(view, dataOffset + 16, littleEndian);
          }
          break;
        case 0x0003:
          lonRef = readString(new Uint8Array(view.buffer), dataOffset, 2);
          break;
        case 0x0004:
          if (count === 3 && type === 5) {
            lonDeg = parseRational(view, dataOffset, littleEndian);
            lonMin = parseRational(view, dataOffset + 8, littleEndian);
            lonSec = parseRational(view, dataOffset + 16, littleEndian);
          }
          break;
        case 0x0005:
          // Altitude reference (above/below sea level) — used in GPS calculation
          break;
        case 0x0006:
          if (type === 5) altVal = parseRational(view, dataOffset, littleEndian);
          break;
      }

      const value = parseExifTagValue(view, tiffStart, tagId, type, count, valueOffset, littleEndian);
      findings.push({
        tagId,
        tagName: tagInfo.label,
        value,
        category: tagInfo.category,
        severity: tagInfo.severity,
      });
    }

    // Add computed GPS coordinates
    if (latRef && latDeg !== null && latMin !== null && latSec !== null && lonRef && lonDeg !== null && lonMin !== null && lonSec !== null) {
      const lat = gpsToDecimal(latRef, latDeg, latMin, latSec);
      const lon = gpsToDecimal(lonRef, lonDeg, lonMin, lonSec);
      if (lat !== null && lon !== null) {
        findings.push({
          tagId: 0xffff,
          tagName: 'GPS coordinates',
          value: `${lat}, ${lon}`,
          category: 'geolocation',
          severity: 'high',
        });
        if (altVal !== null) {
          findings.push({
            tagId: 0xfffe,
            tagName: 'GPS altitude',
            value: `${altVal} m`,
            category: 'geolocation',
            severity: 'high',
          });
        }
      }
    }
  } catch {
    // Gracefully handle binary parsing errors
  }

  return findings;
}

/**
 * Find all JPEG markers and their byte ranges in the file.
 * Returns array of {marker, start, dataStart, dataLength, totalLength}
 * where start is the marker's FF byte, dataStart is after the length field,
 * and totalLength includes the marker, length field, and data.
 */
function findJpegSegments(buffer: ArrayBuffer): Array<{
  marker: number;
  start: number;
  dataStart: number;
  dataLength: number;
  totalLength: number;
}> {
  const segments: Array<{
    marker: number;
    start: number;
    dataStart: number;
    dataLength: number;
    totalLength: number;
  }> = [];

  const view = new DataView(buffer);
  let offset = 2; // Skip SOI (FF D8)

  while (offset < view.byteLength - 1) {
    const b = view.getUint8(offset);
    if (b !== 0xff) {
      offset++;
      continue;
    }

    const marker = view.getUint16(offset);
    const markerByte = marker & 0xff;

    // SOS — rest is image data until EOI
    if (markerByte >= 0xd0 && markerByte <= 0xd7) {
      // RST markers — skip
      offset += 2;
      continue;
    }

    if (markerByte === 0xd8) {
      // Another SOI — skip
      offset += 2;
      continue;
    }

    if (markerByte === 0xd9) {
      // EOI
      segments.push({
        marker: EOI,
        start: offset,
        dataStart: offset + 2,
        dataLength: 0,
        totalLength: 2,
      });
      break;
    }

    if (markerByte === 0xda) {
      // SOS — scan data follows
      const segStart = offset;
      offset += 2;
      if (offset + 2 > view.byteLength) break;
      const headerLen = view.getUint16(offset);
      if (headerLen < 2 || offset + headerLen > view.byteLength) break;
      offset += headerLen;

      // Now we're in entropy-coded data. Scan for next marker.
      while (offset < view.byteLength - 1) {
        if (view.getUint8(offset) === 0xff) {
          const next = view.getUint8(offset + 1);

          // Byte-stuffed FF bytes and restart markers belong to the compressed
          // image data. Dropping restart markers corrupts many phone JPEGs.
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            offset += 2;
            continue;
          }
          if (next === 0xff) {
            offset++;
            continue;
          }

          break;
        }
        offset++;
      }

      segments.push({
        marker: SOS,
        start: segStart,
        dataStart: segStart + 2 + headerLen,
        dataLength: offset - segStart - 2 - headerLen,
        totalLength: offset - segStart,
      });
      continue;
    }

    // All other markers have a 2-byte length field
    if (offset + 4 > view.byteLength) break;

    const segStart = offset;
    offset += 2;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > view.byteLength) break;
    const dataLength = length - 2;
    offset += 2;

    segments.push({
      marker,
      start: segStart,
      dataStart: offset,
      dataLength,
      totalLength: 2 + 2 + dataLength,
    });

    offset += dataLength;
  }

  return segments;
}

function findExifOrientation(view: DataView, tiffStart: number, littleEndian: boolean): number {
  try {
    const numEntries = view.getUint16(tiffStart + 8, littleEndian);
    for (let i = 0; i < numEntries; i++) {
      const entryOffset = tiffStart + 10 + i * 12;
      const tagId = view.getUint16(entryOffset, littleEndian);
      if (tagId === 0x0112) {
        const type = view.getUint16(entryOffset + 2, littleEndian);
        const valueOffset = entryOffset + 8;
        if (type === 3) {
          return view.getUint16(valueOffset, littleEndian);
        }
        break;
      }
    }
  } catch {
    // ignore
  }
  return 1;
}

function extractExifSegment(
  buffer: ArrayBuffer,
  segments: ReturnType<typeof findJpegSegments>,
): { tiffStart: number; littleEndian: boolean; orientation: number } | null {
  for (const seg of segments) {
    if (seg.marker === APP1 && seg.dataLength >= 6) {
      const header = new Uint8Array(buffer, seg.dataStart, 6);
      if (
        header[0] === 0x45 && // E
        header[1] === 0x78 && // x
        header[2] === 0x69 && // i
        header[3] === 0x66 && // f
        header[4] === 0x00 &&
        header[5] === 0x00
      ) {
        const tiffStart = seg.dataStart + 6;
        const view = new DataView(buffer);
        if (tiffStart + 2 > view.byteLength) return null;
        const byteOrder = view.getUint16(tiffStart);
        const littleEndian = byteOrder === 0x4949;
        const orientation = findExifOrientation(view, tiffStart, littleEndian);
        return { tiffStart, littleEndian, orientation };
      }
    }
  }
  return null;
}

function scanJpeg(buffer: ArrayBuffer): ScanResult {
  const view = new DataView(buffer);
  const segments = findJpegSegments(buffer);
  const findings: MetadataFinding[] = [];
  let hasIccProfile = false;
  let iccDescription: string | null = null;
  let dimensions: { width: number; height: number } | null = null;
  let orientation: number | null = null;

  // Parse EXIF
  const exifSeg = segments.find((s) => s.marker === APP1);
  if (exifSeg && exifSeg.dataLength >= 6) {
    const header = new Uint8Array(buffer, exifSeg.dataStart, 6);
    if (header[0] === 0x45 && header[1] === 0x78 && header[2] === 0x69 && header[3] === 0x66) {
      const tiffStart = exifSeg.dataStart + 6;
      if (tiffStart < view.byteLength - 2) {
        const byteOrder = view.getUint16(tiffStart);
        const littleEndian = byteOrder === 0x4949;
        const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);

        // Extract orientation before we push findings
        orientation = findExifOrientation(view, tiffStart, littleEndian);

        const exifFindings = parseExifIfd(view, tiffStart, tiffStart + ifdOffset, littleEndian, 'IFD0');
        for (const f of exifFindings) {
          findings.push({
            category: f.category as MetadataFinding['category'],
            field: `EXIF:${f.tagName}`,
            label: f.tagName,
            value: f.value,
            severity: f.severity,
            description: severityDescription(f.severity),
          });
        }
      }
    }
  }

  // If orientation is non-default, add a prominent finding
  if (orientation && orientation !== 1) {
    findings.push({
      category: 'other',
      field: 'EXIF:Orientation',
      label: 'Image orientation',
      value: `Value ${orientation}`,
      severity: 'medium',
      description: '',
    });
  }

  // Detect XMP
  for (const seg of segments) {
    if (seg.marker === APP1 && seg.dataLength > 28) {
      const data = new Uint8Array(buffer, seg.dataStart, Math.min(seg.dataLength, 64));
      const str = new TextDecoder().decode(data);
      if (str.includes('http://ns.adobe.com/xap/1.0/') || str.includes('<?xpacket')) {
        findings.push({
          category: 'containers',
          field: 'XMP',
          label: 'XMP metadata',
          value: 'Present',
          severity: 'medium',
          description: '',
        });
        break;
      }
    }
  }

  // Detect IPTC
  for (const seg of segments) {
    if (seg.marker === APP13) {
      const data = new Uint8Array(buffer, seg.dataStart, Math.min(seg.dataLength, 64));
      // Check for "Photoshop" IPTC marker
      if (
        data[0] === 0x50 &&
        data[1] === 0x68 &&
        data[2] === 0x6f &&
        data[3] === 0x74 &&
        data[4] === 0x6f &&
        data[5] === 0x73 &&
        data[6] === 0x68 &&
        data[7] === 0x6f &&
        data[8] === 0x70
      ) {
        findings.push({
          category: 'containers',
          field: 'IPTC',
          label: 'IPTC metadata',
          value: 'Present',
          severity: 'medium',
          description: '',
        });
        break;
      }
    }
  }

  // Detect COM (comments)
  for (const seg of segments) {
    if (seg.marker === COM) {
      const commentBytes = new Uint8Array(buffer, seg.dataStart, Math.min(seg.dataLength, 500));
      const comment = new TextDecoder().decode(commentBytes);
      findings.push({
        category: 'other',
        field: 'JPEG:Comment',
        label: 'JPEG comment',
        value: comment || '[binary data]',
        severity: 'medium',
        description: '',
      });
    }
  }

  // Detect ICC profile
  const iccSeg = segments.find((s) => s.marker === APP2 && s.dataLength > 12);
  if (iccSeg) {
    const iccData = new Uint8Array(buffer, iccSeg.dataStart, Math.min(iccSeg.dataLength, 132));
    // ICC profile signature: "ICC_PROFILE\0"
    let isIcc = false;
    const iccSig = 'ICC_PROFILE';
    if (iccData.length >= 12) {
      isIcc = true;
      for (let i = 0; i < 11; i++) {
        if (iccData[i] !== iccSig.charCodeAt(i)) {
          isIcc = false;
          break;
        }
      }
    }
    if (isIcc) {
      hasIccProfile = true;
      // Try to extract ICC description tag (tag 'desc', 0x64657363)
      // ICC profile header is 128 bytes; tags follow
      if (iccData.length >= 132) {
        const tagCount = (iccData[128] << 24) | (iccData[129] << 16) | (iccData[130] << 8) | iccData[131];
        for (let t = 0; t < tagCount && 132 + t * 12 + 12 <= iccData.length; t++) {
          const tagOffset = 132 + t * 12;
          const tagSig = String.fromCharCode(
            iccData[tagOffset], iccData[tagOffset + 1],
            iccData[tagOffset + 2], iccData[tagOffset + 3],
          );
          if (tagSig === 'desc') {
            const descOffset = (iccData[tagOffset + 4] << 24) | (iccData[tagOffset + 5] << 16) | (iccData[tagOffset + 6] << 8) | iccData[tagOffset + 7];
            const descLen = (iccData[tagOffset + 8] << 24) | (iccData[tagOffset + 9] << 16) | (iccData[tagOffset + 10] << 8) | iccData[tagOffset + 11];
            if (descOffset + descLen <= iccData.length && descLen > 0) {
              iccDescription = new TextDecoder().decode(iccData.slice(descOffset, descOffset + descLen)).replace(/\0/g, '').trim();
            }
            break;
          }
        }
      }
      if (!iccDescription) iccDescription = 'ICC profile';
    }
  }

  // Detect embedded thumbnail
  for (const seg of segments) {
    if (seg.marker === APP1 && seg.dataLength > 6) {
      // We already checked EXIF above; thumbnails in EXIF may contain a second JPEG
      // Look for another SOI within the EXIF data
      const exifData = new Uint8Array(buffer, seg.dataStart, seg.dataLength);
      for (let i = 6; i < exifData.length - 1; i++) {
        if (exifData[i] === 0xff && exifData[i + 1] === 0xd8) {
          findings.push({
            category: 'thumbnails',
            field: 'EXIF:Thumbnail',
            label: 'Embedded thumbnail',
            value: `~${Math.round((exifData.length - i) / 1024)} KB`,
            severity: 'medium',
            description: '',
          });
          break;
        }
      }
    }
  }

  // Try to get dimensions from SOF segment
  for (const seg of segments) {
    if (seg.marker === SOF0 || seg.marker === SOF2) {
      if (seg.dataLength >= 5) {
        const sofData = new Uint8Array(buffer, seg.dataStart, 5);
        const height = (sofData[1] << 8) | sofData[2];
        const width = (sofData[3] << 8) | sofData[4];
        dimensions = { width, height };
      }
      break;
    }
  }

  return {
    format: 'jpeg',
    findings,
    preservedInfo: {
      hasIccProfile,
      iccDescription,
      hasTransparency: false,
      dimensions,
      colourChunks: hasIccProfile ? ['ICC Profile (APP2)'] : [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation,
  };
}

function cleanJpeg(buffer: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return buffer.slice(0);

  const kept: Uint8Array[] = [bytes.slice(0, 2)];
  let offset = 2;

  // JPEG metadata lives in header segments. Once SOS is reached, preserve the
  // entire encoded stream verbatim: it may contain restart markers, multiple
  // scans, and marker-like byte sequences that must not be parsed or rebuilt.
  while (offset < bytes.length - 1) {
    // Some camera files contain malformed metadata length fields. Keep looking
    // for the next header marker instead of treating metadata bytes as image data.
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    const start = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return buffer.slice(0);

    const markerByte = bytes[offset++];
    if (markerByte === 0x00) continue;
    if (markerByte === 0xda) {
      kept.push(bytes.slice(start));
      return joinJpegSegments(kept);
    }
    if (markerByte === 0xd9) {
      kept.push(bytes.slice(start, offset));
      return joinJpegSegments(kept);
    }

    if ((markerByte >= 0xd0 && markerByte <= 0xd8) || markerByte === 0x01) {
      kept.push(bytes.slice(start, offset));
      continue;
    }

    if (offset + 2 > bytes.length) return buffer.slice(0);
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    const end = offset + length;
    if (length < 2 || end > bytes.length) return buffer.slice(0);

    const isIccProfile = markerByte === 0xe2 && hasIccProfileHeader(bytes, offset + 2);
    const isRemovableMetadata = markerByte === 0xfe || (markerByte >= 0xe1 && markerByte <= 0xef);

    if (!isRemovableMetadata || isIccProfile) {
      kept.push(bytes.slice(start, end));
    }
    offset = end;
  }

  // Do not fabricate a partial JPEG if the header never reaches SOS/EOI.
  return buffer.slice(0);
}

function hasIccProfileHeader(bytes: Uint8Array, offset: number): boolean {
  const signature = 'ICC_PROFILE\0';
  if (offset + signature.length > bytes.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature.charCodeAt(i)) return false;
  }
  return true;
}

function joinJpegSegments(segments: Uint8Array[]): ArrayBuffer {
  const length = segments.reduce((total, segment) => total + segment.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const segment of segments) {
    output.set(segment, offset);
    offset += segment.length;
  }
  return output.buffer;
}

function verifyJpeg(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  // Re-scan the cleaned buffer
  const rescan = scanJpeg(cleanBuffer);

  const metadataFoundBefore = original.findings.filter(
    (f) => f.field !== 'EXIF:ICC profile',
  ).length;

  // Count privacy-relevant metadata remaining (exclude ICC mention)
  const metadataRemaining = rescan.findings.filter(
    (f) => f.category !== 'other' || !f.field.includes('ICC'),
  ).length;

  const technicalDataPreserved: string[] = [];
  if (rescan.preservedInfo.hasIccProfile) {
    technicalDataPreserved.push(rescan.preservedInfo.iccDescription || 'ICC Profile');
  }
  if (rescan.preservedInfo.dimensions) {
    const d = rescan.preservedInfo.dimensions;
    technicalDataPreserved.push(`Dimensions: ${d.width}×${d.height}`);
  }

  const limitations: string[] = [];
  if (original.preservedInfo.hasIccProfile && !rescan.preservedInfo.hasIccProfile) {
    limitations.push('ICC profile was not preserved');
  }

  // Determine if orientation correction was applied
  const orientationWasApplied =
    original.orientation !== null && original.orientation !== 1;
  // Pixel data was re-encoded if orientation correction was applied
  const pixelDataReencoded = orientationWasApplied;

  return {
    passed: metadataRemaining === 0,
    metadataFoundBefore,
    metadataRemaining,
    technicalDataPreserved,
    cleanHash: '', // Will be filled by caller
    processedLocally: true,
    limitations,
    orientationApplied: orientationWasApplied,
    pixelDataReencoded,
    remainingUnsupportedMetadataRisk: null,
  };
}

function jpegBufferToHex(buffer: ArrayBuffer, maxLen: number = 64): string {
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, maxLen); i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return parts.join(' ');
}

function severityDescription(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'high':
      return 'Может раскрыть конфиденциальную информацию.';
    case 'medium':
      return 'Может связать файл с источником или устройством.';
    case 'low':
      return 'Техническая информация, маловероятно раскрытие личных данных.';
  }
}

export const jpegHandler: FormatHandler = {
  format: 'jpeg',
  scan(buffer: ArrayBuffer): ScanResult {
    return scanJpeg(buffer);
  },
  clean(buffer: ArrayBuffer): ArrayBuffer {
    // Strip metadata; orientation bytes are part of EXIF which gets removed.
    // Physical orientation rotation is handled by the main thread via canvas when needed.
    return cleanJpeg(buffer);
  },
  verify(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
    return verifyJpeg(original, cleanBuffer);
  },
};

export { findJpegSegments, cleanJpeg, scanJpeg, verifyJpeg };
export { jpegBufferToHex, extractExifSegment };
