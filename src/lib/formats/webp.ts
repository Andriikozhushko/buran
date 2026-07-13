import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

/**
 * WebP format handler.
 *
 * WebP uses the RIFF container:
 * - RIFF header: "RIFF" (4) + file_size (4) + "WEBP" (4)
 * - Then one of: VP8 (lossy), VP8L (lossless), VP8X (extended)
 * - VP8X contains sub-chunks: ICCP, EXIF, XMP, ALPH, ANIM, ANMF
 */

function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset]) | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
}

function readFourCC(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset],
    data[offset + 1],
    data[offset + 2],
    data[offset + 3],
  );
}

interface RiffChunk {
  fourCC: string;
  dataOffset: number;
  dataLength: number;
  startOffset: number;
  totalLength: number; // 8 bytes header + data (padded to even)
}

function parseRiffChunks(buffer: ArrayBuffer): RiffChunk[] | null {
  const data = new Uint8Array(buffer);

  if (data.length < 12) return null;

  const riffSig = readFourCC(data, 0);
  if (riffSig !== 'RIFF') return null;

  const webpSig = readFourCC(data, 8);
  if (webpSig !== 'WEBP') return null;

  const chunks: RiffChunk[] = [];

  let offset = 12;
  while (offset + 8 <= data.length) {
    const fourCC = readFourCC(data, offset);
    offset += 4;
    const chunkSize = readUint32(data, offset);
    offset += 4;

    const dataOffset = offset;
    const paddedSize = chunkSize + (chunkSize % 2); // RIFF chunks are padded to even byte boundaries
    if (paddedSize > data.length - offset) break;

    chunks.push({
      fourCC,
      dataOffset,
      dataLength: chunkSize,
      startOffset: offset - 8,
      totalLength: 8 + paddedSize,
    });

    offset += paddedSize;

    if (fourCC === 'VP8' || fourCC === 'VP8L') break; // No sub-chunks
    if (fourCC === 'VP8X' && chunkSize >= 8) {
      // VP8X contains sub-chunks; parse them
      // VP8X header: 4 bytes flags + 3 bytes width + 3 bytes height = 10 bytes
      const subChunkStart = dataOffset + 10;
      let subOffset = subChunkStart;
      while (subOffset + 8 <= dataOffset + chunkSize) {
        const subCC = readFourCC(data, subOffset);
        subOffset += 4;
        const subSize = readUint32(data, subOffset);
        subOffset += 4;

        const subPaddedSize = subSize + (subSize % 2);
        if (subPaddedSize > dataOffset + chunkSize - subOffset) break;

        chunks.push({
          fourCC: `VP8X:${subCC.trim()}`,
          dataOffset: subOffset,
          dataLength: subSize,
          startOffset: subOffset - 8,
          totalLength: 8 + subPaddedSize,
        });

        subOffset += subPaddedSize;
      }
      break;
    }
  }

  return chunks;
}

function parseVp8xFlags(data: Uint8Array, vp8xOffset: number): { hasIcc: boolean; hasExif: boolean; hasXmp: boolean; hasAlpha: boolean; hasAnim: boolean } {
  if (vp8xOffset + 4 > data.length) {
    return { hasIcc: false, hasExif: false, hasXmp: false, hasAlpha: false, hasAnim: false };
  }
  const flags = data[vp8xOffset];
  return {
    hasIcc: !!(flags & 0x20),
    hasExif: !!(flags & 0x08),
    hasXmp: !!(flags & 0x04),
    hasAlpha: !!(flags & 0x10),
    hasAnim: !!(flags & 0x02),
  };
}

function scanWebp(buffer: ArrayBuffer): ScanResult {
  const data = new Uint8Array(buffer);
  const chunks = parseRiffChunks(buffer);
  const findings: MetadataFinding[] = [];
  let hasIccProfile = false;
  let iccDescription: string | null = null;
  let hasTransparency = false;
  let dimensions: { width: number; height: number } | null = null;

  if (!chunks) {
    return {
      format: 'webp',
      findings: [],
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

  // Check for VP8X flags
  const vp8xChunk = chunks.find((c) => c.fourCC === 'VP8X');
  if (vp8xChunk && vp8xChunk.dataLength >= 8) {
    const flags = parseVp8xFlags(data, vp8xChunk.dataOffset);
    hasTransparency = flags.hasAlpha;

    // Dimensions from VP8X header: 4 bytes flags + 3 bytes width + 3 bytes height
    if (vp8xChunk.dataLength >= 10) {
      const w0 = data[vp8xChunk.dataOffset + 4];
      const w1 = data[vp8xChunk.dataOffset + 5];
      const w2 = data[vp8xChunk.dataOffset + 6];
      const h0 = data[vp8xChunk.dataOffset + 7];
      const h1 = data[vp8xChunk.dataOffset + 8];
      const h2 = data[vp8xChunk.dataOffset + 9];
      const width = (w0 | (w1 << 8) | (w2 << 16)) + 1;
      const height = (h0 | (h1 << 8) | (h2 << 16)) + 1;
      dimensions = { width, height };
    }
  }

  // Get dimensions from VP8 or VP8L if not already found
  if (!dimensions) {
    const vp8Chunk = chunks.find((c) => c.fourCC === 'VP8');
    if (vp8Chunk && vp8Chunk.dataLength >= 10) {
      const frameTag = readUint32(data, vp8Chunk.dataOffset);
      if (frameTag === 0x019d012a) {
        // VP8 keyframe
        const w1 = data[vp8Chunk.dataOffset + 6];
        const w2 = data[vp8Chunk.dataOffset + 7];
        const h1 = data[vp8Chunk.dataOffset + 8];
        const h2 = data[vp8Chunk.dataOffset + 9];
        dimensions = { width: w1 | (w2 << 8), height: h1 | (h2 << 8) };
      }
    }

    const vp8lChunk = chunks.find((c) => c.fourCC === 'VP8L');
    if (vp8lChunk && vp8lChunk.dataLength >= 5) {
      const sig = data[vp8lChunk.dataOffset];
      if (sig === 0x2f) {
        const b0 = data[vp8lChunk.dataOffset + 1];
        const b1 = data[vp8lChunk.dataOffset + 2];
        const b2 = data[vp8lChunk.dataOffset + 3];
        const b3 = data[vp8lChunk.dataOffset + 4];
        const width = ((b1 & 0x3f) << 8) | b0 + 1;
        const height = ((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6) + 1;
        dimensions = { width, height };
      }
    }
  }

  // Scan for EXIF
  const exifChunk = chunks.find((c) => c.fourCC === 'VP8X:EXIF');
  if (exifChunk) {
    findings.push({
      category: 'containers',
      field: 'WebP:EXIF',
      label: 'EXIF metadata',
      value: `${exifChunk.dataLength} bytes`,
      severity: 'high',
      description: 'EXIF-метаданные в WebP. Могут содержать GPS, данные камеры, автора, дату съёмки.',
    });

    // Try to extract some EXIF data
    if (exifChunk.dataLength > 6) {
      const exifData = new Uint8Array(buffer, exifChunk.dataOffset, exifChunk.dataLength);
      // EXIF in WebP starts directly with the TIFF header (no "Exif\0\0" prefix)
      if (exifData.length > 8) {
        // Try to find basic IFD0 entries from TIFF-structured EXIF data
        tryExtractExifData(exifData, findings);
      }
    }
  }

  // Scan for XMP
  const xmpChunk = chunks.find((c) => c.fourCC === 'VP8X:XMP');
  if (xmpChunk) {
    const xmpData = new Uint8Array(buffer, xmpChunk.dataOffset, Math.min(xmpChunk.dataLength, 500));
    const xmpStr = new TextDecoder().decode(xmpData);
    findings.push({
      category: 'containers',
      field: 'WebP:XMP',
      label: 'XMP metadata',
      value: `${xmpChunk.dataLength} bytes`,
      severity: 'medium',
      description: 'Расширяемая платформа метаданных Adobe. Может содержать автора, описание, историю.',
    });

    // Try to extract Creator tool from XMP
    const creatorMatch = xmpStr.match(/<dc:creator>\s*<rdf:Seq>\s*<rdf:li>(.*?)<\/rdf:li>/s);
    if (creatorMatch) {
      findings.push({
        category: 'author',
        field: 'WebP:XMP:Creator',
        label: 'Author (XMP)',
        value: creatorMatch[1].trim(),
        severity: 'high',
        description: 'Имя автора изображения из XMP-метаданных.',
      });
    }
  }

  // Scan for ICC
  const iccChunk = chunks.find((c) => c.fourCC === 'VP8X:ICCP');
  if (iccChunk) {
    hasIccProfile = true;
    iccDescription = 'ICC profile (WebP)';

    // Try to read ICC description
    if (iccChunk.dataLength >= 132) {
      const iccData = new Uint8Array(buffer, iccChunk.dataOffset, Math.min(iccChunk.dataLength, 256));
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

    findings.push({
      category: 'other',
      field: 'WebP:ICCP',
      label: 'ICC profile',
      value: iccDescription,
      severity: 'low',
      description: 'Технические данные цветопередачи. Сохраняются при очистке.',
    });
  }

  return {
    format: 'webp',
    findings,
    preservedInfo: {
      hasIccProfile,
      iccDescription,
      hasTransparency,
      dimensions,
      colourChunks: hasIccProfile ? ['ICCP'] : [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

function tryExtractExifData(exifData: Uint8Array, findings: MetadataFinding[]): void {
  try {
    const view = new DataView(exifData.buffer, exifData.byteOffset, exifData.byteLength);
    const byteOrder = view.getUint16(0, true);
    const littleEndian = byteOrder === 0x4949;
    const ifdOffset = view.getUint32(4, littleEndian);
    if (ifdOffset + 2 > view.byteLength) return;

    const numEntries = view.getUint16(8 + ifdOffset, littleEndian);

    const knownTags: Record<number, { label: string; category: string }> = {
      0x010f: { label: 'Camera manufacturer', category: 'device' },
      0x0110: { label: 'Camera model', category: 'device' },
      0x0132: { label: 'Date/time', category: 'dates' },
      0x013b: { label: 'Artist', category: 'author' },
      0x8298: { label: 'Copyright', category: 'author' },
    };

    for (let i = 0; i < Math.min(numEntries, 20); i++) {
      const entryOffset = 8 + ifdOffset + 2 + i * 12;
      if (entryOffset + 12 > view.byteLength) break;
      const tagId = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      const valueOffset = entryOffset + 8;

      const tag = knownTags[tagId];
      if (tag && type === 2) {
        // ASCII string
        let value = '';
        if (count <= 4) {
          for (let j = 0; j < count && view.getUint8(valueOffset + j) !== 0; j++) {
            value += String.fromCharCode(view.getUint8(valueOffset + j));
          }
        }
        if (value) {
          findings.push({
            category: tag.category as MetadataFinding['category'],
            field: `WebP:EXIF:${tag.label}`,
            label: tag.label,
            value,
            severity: 'high',
            description: `Обнаружено в EXIF-данных WebP.`,
          });
        }
      }
    }
  } catch {
    // Silently handle parsing errors in EXIF extraction
  }
}

function cleanWebp(buffer: ArrayBuffer): ArrayBuffer {
  const data = new Uint8Array(buffer);
  const chunks = parseRiffChunks(buffer);

  if (!chunks) return buffer; // Should not happen for valid WebP

  // If there are no VP8X sub-chunks with metadata, return original
  const hasMetadata = chunks.some(
    (c) => c.fourCC === 'VP8X:EXIF' || c.fourCC === 'VP8X:XMP',
  );
  if (!hasMetadata) return buffer;

  const vp8xChunk = chunks.find((c) => c.fourCC === 'VP8X');
  if (!vp8xChunk) return buffer;

  // Build new VP8X data: keep only non-metadata sub-chunks
  const keptSubChunks: RiffChunk[] = [];
  const currentFlags = parseVp8xFlags(data, vp8xChunk.dataOffset);

  for (const chunk of chunks) {
    if (chunk.fourCC === 'VP8X:ICCP') {
      keptSubChunks.push(chunk);
    }
    if (chunk.fourCC === 'VP8X:ALPH') {
      keptSubChunks.push(chunk);
    }
    if (chunk.fourCC === 'VP8X:ANIM' || chunk.fourCC === 'VP8X:ANMF') {
      keptSubChunks.push(chunk);
    }
    // VP8X:EXIF and VP8X:XMP are dropped
  }

  // Compute new VP8X flags
  let newFlags = currentFlags.hasIcc ? 0x20 : 0;
  if (currentFlags.hasAlpha) newFlags |= 0x10;
  if (currentFlags.hasAnim) newFlags |= 0x02;
  // EXIF (0x08) and XMP (0x04) are cleared

  // Get original VP8X header data (10 bytes: 4 flags + 3 width + 3 height)
  const vp8xHeaderData = new Uint8Array(buffer, vp8xChunk.dataOffset, Math.min(vp8xChunk.dataLength, 10));
  vp8xHeaderData[0] = newFlags;

  // Calculate new VP8X chunk size
  let newVp8xDataSize = 10; // header (4 flags + 3 width + 3 height)
  for (const sub of keptSubChunks) {
    newVp8xDataSize += sub.totalLength;
  }

  // Calculate total file size
  let totalFileSize = 12; // RIFF header + WEBP
  for (const chunk of chunks) {
    if (chunk.fourCC === 'VP8X') {
      totalFileSize += 8 + newVp8xDataSize + (newVp8xDataSize % 2);
    } else if (!chunk.fourCC.startsWith('VP8X:')) {
      totalFileSize += chunk.totalLength;
    }
  }

  // Build output buffer
  const output = new Uint8Array(totalFileSize);

  // Write RIFF header
  output.set(data.slice(0, 4), 0); // "RIFF"
  let outOffset = 4;
  // File size (totalFileSize - 8)
  output[outOffset] = (totalFileSize - 8) & 0xff;
  output[outOffset + 1] = ((totalFileSize - 8) >> 8) & 0xff;
  output[outOffset + 2] = ((totalFileSize - 8) >> 16) & 0xff;
  output[outOffset + 3] = ((totalFileSize - 8) >> 24) & 0xff;
  // "WEBP"
  output.set(data.slice(8, 12), 8);
  outOffset = 12;

  // Write chunks
  for (const chunk of chunks) {
    if (chunk.fourCC === 'VP8X') {
      // Write modified VP8X
      output.set(data.slice(chunk.startOffset, chunk.startOffset + 4), outOffset); // "VP8X"
      outOffset += 4;
      // Write new chunk size
      const newSize = newVp8xDataSize;
      output[outOffset] = newSize & 0xff;
      output[outOffset + 1] = (newSize >> 8) & 0xff;
      output[outOffset + 2] = (newSize >> 16) & 0xff;
      output[outOffset + 3] = (newSize >> 24) & 0xff;
      outOffset += 4;
      // Write VP8X header (with updated flags) — 10 bytes
      output.set(vp8xHeaderData.slice(0, 10), outOffset);
      outOffset += 10;
      // Write kept sub-chunks
      for (const sub of keptSubChunks) {
        output.set(new Uint8Array(buffer, sub.startOffset, sub.totalLength), outOffset);
        outOffset += sub.totalLength;
      }
      // Pad if needed
      if (newVp8xDataSize % 2 !== 0) {
        output[outOffset] = 0;
        outOffset++;
      }
    } else if (!chunk.fourCC.startsWith('VP8X:')) {
      // Copy non-VP8X-sub chunks verbatim
      output.set(new Uint8Array(buffer, chunk.startOffset, chunk.totalLength), outOffset);
      outOffset += chunk.totalLength;
    }
    // Skip VP8X sub-chunks (they're handled as part of VP8X)
  }

  return output.buffer;
}

function verifyWebp(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanWebp(cleanBuffer);

  const metadataFoundBefore = original.findings.filter(
    (f) => !['WebP:ICCP'].includes(f.field),
  ).length;

  const metadataRemaining = rescan.findings.filter(
    (f) => !['WebP:ICCP'].includes(f.field),
  ).length;

  const technicalDataPreserved: string[] = [];
  if (rescan.preservedInfo.hasIccProfile) {
    technicalDataPreserved.push(rescan.preservedInfo.iccDescription || 'ICC Profile');
  }
  if (rescan.preservedInfo.hasTransparency) {
    technicalDataPreserved.push('Прозрачность (Alpha)');
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

export const webpHandler: FormatHandler = {
  format: 'webp',
  scan(buffer: ArrayBuffer): ScanResult {
    return scanWebp(buffer);
  },
  clean(buffer: ArrayBuffer): ArrayBuffer {
    return cleanWebp(buffer);
  },
  verify(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
    return verifyWebp(original, cleanBuffer);
  },
};

export { parseRiffChunks, scanWebp, cleanWebp, verifyWebp };
