import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

// PNG signature
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Chunks to always preserve (critical for image display)
const CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

// Colour-related chunks to preserve
const COLOUR_CHUNKS = new Set(['iCCP', 'sRGB', 'gAMA', 'cHRM']);

// Transparency chunk
const TRANSPARENCY_CHUNK = 'tRNS';

// Physical dimensions chunk (not privacy-sensitive, technical)
const PHYSICAL_CHUNKS = new Set(['pHYs']);

// Privacy-relevant metadata chunks we strip
const METADATA_CHUNKS = new Set([
  'eXIf', // EXIF in PNG
  'tEXt', // Textual data
  'zTXt', // Compressed textual data
  'iTXt', // International textual data
  'tIME', // Last modification time
  'vpAg', // Virtual page
  'offS', // Offset
  'pCAL', // Calibration
  'sCAL', // Scale
  'gIFg', // GIF graphic control
  'gIFx', // GIF application extension
  'sTER', // Stereo image
]);

function readChunkType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

interface PngChunk {
  type: string;
  dataOffset: number;
  dataLength: number;
  crcOffset: number;
  totalLength: number; // From length field start to end of CRC
  startOffset: number; // Offset of the length field
}

function parsePngChunks(buffer: ArrayBuffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  const data = new Uint8Array(buffer);

  // Skip 8-byte signature
  let offset = 8;

  while (offset + 12 <= data.length) {
    const length = readUint32(data, offset);
    const startOffset = offset;
    offset += 4;
    const type = readChunkType(data, offset);
    offset += 4;
    const dataOffset = offset;
    const dataLength = length;
    if (length > data.length - offset - 4) break;
    offset += length;
    const crcOffset = offset;
    offset += 4;

    chunks.push({
      type,
      dataOffset,
      dataLength,
      crcOffset,
      totalLength: 4 + 4 + length + 4,
      startOffset,
    });

    if (type === 'IEND') break;
  }

  return chunks;
}

function readPngText(data: Uint8Array, offset: number, length: number): { keyword: string; value: string } {
  let nullPos = -1;
  for (let i = 0; i < length; i++) {
    if (data[offset + i] === 0) {
      nullPos = i;
      break;
    }
  }

  const keyword = nullPos >= 0 ? new TextDecoder().decode(data.slice(offset, offset + nullPos)) : '';
  const valueStart = offset + nullPos + 1;
  const valueLen = length - nullPos - 1;
  const value = valueLen > 0 ? new TextDecoder().decode(data.slice(valueStart, valueStart + valueLen)) : '';

  return { keyword, value };
}

function readCompressedPngText(data: Uint8Array, offset: number, length: number): { keyword: string; value: string } {
  let nullPos = -1;
  for (let i = 0; i < Math.min(length, 256); i++) {
    if (data[offset + i] === 0) {
      nullPos = i;
      break;
    }
  }

  const keyword = nullPos >= 0 ? new TextDecoder().decode(data.slice(offset, offset + nullPos)) : '';

  // Compressed data follows the null separator and compression method byte
  // We consider it compressed and don't attempt decompression here
  return { keyword, value: '[compressed data]' };
}

function scanPng(buffer: ArrayBuffer): ScanResult {
  const data = new Uint8Array(buffer);
  const chunks = parsePngChunks(buffer);
  const findings: MetadataFinding[] = [];
  let hasIccProfile = false;
  let iccDescription: string | null = null;
  let hasTransparency = false;
  let dimensions: { width: number; height: number } | null = null;
  const colourChunks: string[] = [];

  // Parse IHDR for dimensions
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (ihdr && ihdr.dataLength >= 8) {
    const w = readUint32(data, ihdr.dataOffset);
    const h = readUint32(data, ihdr.dataOffset + 4);
    dimensions = { width: w, height: h };
  }

  for (const chunk of chunks) {
    // Colour profile chunks — detect and preserve
    if (chunk.type === 'iCCP') {
      hasIccProfile = true;
      colourChunks.push('iCCP');
      if (chunk.dataLength > 0) {
        const profileName = readPngText(data, chunk.dataOffset, Math.min(chunk.dataLength, 128));
        iccDescription = profileName.keyword || 'ICC profile';
      }
      findings.push({
        category: 'other',
        field: 'PNG:iCCP',
        label: 'ICC profile',
        value: iccDescription,
        severity: 'low',
        description: 'Технические данные для точной цветопередачи. Сохраняются при очистке.',
      });
    }

    if (chunk.type === 'sRGB') {
      colourChunks.push('sRGB');
      const renderingIntent = chunk.dataLength > 0 ? data[chunk.dataOffset] : 0;
      const intents = ['Perceptual', 'Relative colorimetric', 'Saturation', 'Absolute colorimetric'];
      findings.push({
        category: 'other',
        field: 'PNG:sRGB',
        label: 'sRGB profile',
        value: intents[renderingIntent] || `Mode ${renderingIntent}`,
        severity: 'low',
        description: 'Технические данные цветопередачи sRGB. Сохраняются при очистке.',
      });
    }

    if (chunk.type === 'gAMA') {
      colourChunks.push('gAMA');
      if (chunk.dataLength >= 4) {
        const gamma = readUint32(data, chunk.dataOffset) / 100000;
        findings.push({
          category: 'other',
          field: 'PNG:gAMA',
          label: 'Gamma',
          value: gamma.toFixed(1),
          severity: 'low',
          description: 'Технические данные гамма-коррекции. Сохраняются при очистке.',
        });
      }
    }

    if (chunk.type === 'cHRM') {
      colourChunks.push('cHRM');
      findings.push({
        category: 'other',
        field: 'PNG:cHRM',
        label: 'Chromaticity (cHRM)',
        value: 'Present',
        severity: 'low',
        description: 'Технические данные цветности. Сохраняются при очистке.',
      });
    }

    // Transparency
    if (chunk.type === TRANSPARENCY_CHUNK) {
      hasTransparency = true;
    }

    // eXIf chunk
    if (chunk.type === 'eXIf') {
      findings.push({
        category: 'containers',
        field: 'PNG:eXIf',
        label: 'EXIF in PNG (eXIf)',
        value: `${chunk.dataLength} bytes`,
        severity: 'high',
        description: 'EXIF-метаданные, встроенные в PNG. Могут содержать GPS, данные камеры, автора.',
      });
    }

    // tEXt chunks
    if (chunk.type === 'tEXt') {
      const { keyword, value } = readPngText(data, chunk.dataOffset, chunk.dataLength);
      const category = classifyTextKeyword(keyword);
      findings.push({
        category,
        field: `PNG:tEXt:${keyword}`,
        label: keyword || 'Text field',
        value: value.substring(0, 200),
        severity: category === 'author' || category === 'dates' ? 'high' : 'medium',
        description: `Текстовые метаданные PNG (${keyword || 'без названия'}).`,
      });
    }

    // zTXt chunks (compressed text)
    if (chunk.type === 'zTXt') {
      const { keyword, value } = readCompressedPngText(data, chunk.dataOffset, chunk.dataLength);
      const category = classifyTextKeyword(keyword);
      findings.push({
        category,
        field: `PNG:zTXt:${keyword}`,
        label: `${keyword || 'Compressed text field'} (compressed)`,
        value: value,
        severity: category === 'author' || category === 'dates' ? 'high' : 'medium',
        description: `Сжатые текстовые метаданные PNG (${keyword || 'без названия'}).`,
      });
    }

    // iTXt chunks (international text)
    if (chunk.type === 'iTXt') {
      const { keyword, value } = readPngText(data, chunk.dataOffset, chunk.dataLength);
      const category = classifyTextKeyword(keyword);
      findings.push({
        category,
        field: `PNG:iTXt:${keyword}`,
        label: `${keyword || 'International text field'}`,
        value: value.substring(0, 200),
        severity: category === 'author' || category === 'dates' ? 'high' : 'medium',
        description: `Международные текстовые метаданные PNG (${keyword || 'без названия'}).`,
      });
    }

    // tIME chunk
    if (chunk.type === 'tIME') {
      if (chunk.dataLength >= 7) {
        const year = (data[chunk.dataOffset] << 8) | data[chunk.dataOffset + 1];
        const month = data[chunk.dataOffset + 2];
        const day = data[chunk.dataOffset + 3];
        const hour = data[chunk.dataOffset + 4];
        const min = data[chunk.dataOffset + 5];
        const sec = data[chunk.dataOffset + 6];
        findings.push({
          category: 'dates',
          field: 'PNG:tIME',
          label: 'Last modification time',
          value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`,
          severity: 'high',
          description: 'Временная метка последнего изменения PNG-файла.',
        });
      }
    }

    // Detect other metadata chunks
    if (METADATA_CHUNKS.has(chunk.type) && !['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME', 'iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(chunk.type)) {
      findings.push({
        category: 'other',
        field: `PNG:${chunk.type}`,
        label: `Ancillary chunk ${chunk.type}`,
        value: `${chunk.dataLength} bytes`,
        severity: 'low',
        description: 'Служебный блок метаданных PNG. Может содержать дополнительную информацию о файле.',
      });
    }
  }

  return {
    format: 'png',
    findings,
    preservedInfo: {
      hasIccProfile,
      iccDescription,
      hasTransparency,
      dimensions,
      colourChunks,
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

function classifyTextKeyword(keyword: string): MetadataFinding['category'] {
  const lower = keyword.toLowerCase();
  if (lower.includes('author') || lower.includes('creator') || lower.includes('artist') || lower.includes('copyright') || lower.includes('owner')) {
    return 'author';
  }
  if (lower.includes('date') || lower.includes('time') || lower.includes('create') || lower.includes('modif')) {
    return 'dates';
  }
  if (lower.includes('software') || lower.includes('editor') || lower.includes('generator') || lower.includes('producer') || lower.includes('photoshop') || lower.includes('gimp')) {
    return 'software';
  }
  if (lower.includes('camera') || lower.includes('device') || lower.includes('model') || lower.includes('make')) {
    return 'device';
  }
  if (lower.includes('location') || lower.includes('gps')) {
    return 'geolocation';
  }
  if (lower.includes('comment') || lower.includes('description') || lower.includes('title') || lower.includes('subject')) {
    return 'other';
  }
  return 'other';
}

function cleanPng(buffer: ArrayBuffer): ArrayBuffer {
  const chunks = parsePngChunks(buffer);

  // Build a new buffer keeping only safe chunks
  const keptChunks: PngChunk[] = [];

  for (const chunk of chunks) {
    if (
      CRITICAL_CHUNKS.has(chunk.type) ||
      COLOUR_CHUNKS.has(chunk.type) ||
      TRANSPARENCY_CHUNK === chunk.type ||
      PHYSICAL_CHUNKS.has(chunk.type)
    ) {
      keptChunks.push(chunk);
    }
    // All other chunks (metadata) are silently dropped
  }

  // Calculate total output size: 8 (signature) + sum of chunk lengths
  let totalSize = 8;
  for (const chunk of keptChunks) {
    totalSize += chunk.totalLength;
  }

  const output = new Uint8Array(totalSize);

  // Write signature
  output.set(PNG_SIGNATURE, 0);
  let outOffset = 8;

  // Write kept chunks verbatim
  for (const chunk of keptChunks) {
    output.set(
      new Uint8Array(buffer, chunk.startOffset, chunk.totalLength),
      outOffset,
    );
    outOffset += chunk.totalLength;
  }

  return output.buffer;
}

function verifyPng(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanPng(cleanBuffer);

  const metadataFoundBefore = original.findings.filter(
    (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM'].includes(f.field),
  ).length;

  const metadataRemaining = rescan.findings.filter(
    (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM'].includes(f.field),
  ).length;

  const technicalDataPreserved: string[] = [];
  if (rescan.preservedInfo.hasIccProfile) {
    technicalDataPreserved.push(rescan.preservedInfo.iccDescription || 'ICC Profile (iCCP)');
  }
  for (const chunk of rescan.preservedInfo.colourChunks) {
    if (chunk !== 'iCCP') {
      technicalDataPreserved.push(chunk);
    }
  }
  if (rescan.preservedInfo.hasTransparency) {
    technicalDataPreserved.push('Прозрачность (tRNS)');
  }
  if (rescan.preservedInfo.dimensions) {
    const d = rescan.preservedInfo.dimensions;
    technicalDataPreserved.push(`Размеры: ${d.width}×${d.height}`);
  }

  const limitations: string[] = [];

  return {
    passed: metadataRemaining === 0,
    metadataFoundBefore,
    metadataRemaining,
    technicalDataPreserved,
    cleanHash: '',
    processedLocally: true,
    limitations,
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const pngHandler: FormatHandler = {
  format: 'png',
  scan(buffer: ArrayBuffer): ScanResult {
    return scanPng(buffer);
  },
  clean(buffer: ArrayBuffer): ArrayBuffer {
    return cleanPng(buffer);
  },
  verify(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
    return verifyPng(original, cleanBuffer);
  },
};

export { parsePngChunks, scanPng, cleanPng, verifyPng };
