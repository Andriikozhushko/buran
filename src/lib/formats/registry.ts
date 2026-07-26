/**
 * Format registry — the single place a supported format is described.
 *
 * One descriptor per format: identity (display name, extensions, MIME type),
 * size limit, magic-byte detection, and the async scan/clean pipelines the
 * workers dispatch to. Registry order resolves detection ambiguity (first
 * match wins), so more specific sniffs come first.
 *
 * Heavy per-format modules (pdf-lib, jszip, the image cores) are loaded with
 * dynamic import() inside the pipelines so worker bundles stay code-split;
 * this module itself must remain light enough for the main thread.
 *
 * Detection is content-based, never extension-based: a renamed OOXML package
 * still routes through the ZIP pipeline, which classifies it from the package
 * content and hands it to the Office machinery.
 */

import type { FormatHandler, ScanResult, SupportedFormat, VerificationResult } from './types';
import { detectHeic } from './heic/detect';
import { readFourCC } from './heic/detect';
import {
  dimensionsExceedPixelLimit,
  MALFORMED_MESSAGE,
  RESOURCE_LIMIT_MESSAGE,
} from '../processing-limits';

export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type ScanOutcome =
  | { result: ScanResult }
  | { blocked: { reason: string; message: string } }
  | { error: string };

export type CleanOutcome =
  | { cleanBuffer: ArrayBuffer; verification: VerificationResult }
  | { error: string };

export interface CleanOptions {
  preserveJpegOrientation?: boolean;
  removeCustomXml?: boolean;
}

export interface FormatDescriptor {
  id: SupportedFormat;
  displayName: string;
  /** First entry is the canonical output extension. */
  extensions: readonly string[];
  mimeType: string;
  maxBytes: number;
  /** Magic-byte sniff over the first bytes. Never reads the filename. */
  detect(bytes: Uint8Array, buffer: ArrayBuffer): boolean;
  scan(buffer: ArrayBuffer, fileName: string, fileSize: number): Promise<ScanOutcome>;
  clean(buffer: ArrayBuffer, scanResult: ScanResult, opts: CleanOptions): Promise<CleanOutcome>;
}

function emptyPreservedInfo(): ScanResult['preservedInfo'] {
  return { hasIccProfile: false, iccDescription: null, hasTransparency: false, dimensions: null, colourChunks: [] };
}

/**
 * Shared pipeline for in-place image formats built on the synchronous
 * {@link FormatHandler} interface (scan/clean/verify over raw bytes).
 */
function imageDescriptor(opts: {
  id: SupportedFormat;
  displayName: string;
  extensions: readonly string[];
  mimeType: string;
  detect(bytes: Uint8Array, buffer: ArrayBuffer): boolean;
  load(): Promise<FormatHandler>;
  /** Vector/container formats have no single pixel grid to bound-check. */
  requireDimensions?: boolean;
  /** Defaults to the image cap; audio/video formats override with a larger one. */
  maxBytes?: number;
}): FormatDescriptor {
  const requireDimensions = opts.requireDimensions ?? true;
  return {
    id: opts.id,
    displayName: opts.displayName,
    extensions: opts.extensions,
    mimeType: opts.mimeType,
    maxBytes: opts.maxBytes ?? MAX_IMAGE_BYTES,
    detect: opts.detect,
    async scan(buffer, fileName, fileSize) {
      const handler = await opts.load();
      const result = handler.scan(buffer);
      result.fileName = fileName;
      result.fileSize = fileSize;
      if (requireDimensions && !result.preservedInfo.dimensions) return { error: MALFORMED_MESSAGE };
      if (dimensionsExceedPixelLimit(result.preservedInfo.dimensions)) return { error: RESOURCE_LIMIT_MESSAGE };
      return { result };
    },
    async clean(buffer, scanResult) {
      const handler = await opts.load();
      const cleanBuffer = handler.clean(buffer);
      const verification = handler.verify(scanResult, cleanBuffer);
      return { cleanBuffer, verification };
    },
  };
}

/** Office scan pipeline, shared by the CFB route and the ZIP content route. */
async function officeScan(buffer: ArrayBuffer, fileName: string, fileSize: number): Promise<ScanOutcome> {
  const { scanOffice } = await import('./office');
  const outcome = await scanOffice(buffer);
  if ('blocked' in outcome) return { blocked: { reason: outcome.reason, message: outcome.message } };
  const { data } = outcome;
  return {
    result: {
      format: data.format,
      findings: data.findings,
      preservedInfo: emptyPreservedInfo(),
      fileName,
      fileSize,
      orientation: null,
      office: data,
    },
  };
}

async function officeClean(buffer: ArrayBuffer, scanResult: ScanResult, opts: CleanOptions): Promise<CleanOutcome> {
  const { sanitizeOffice, verifyOffice } = await import('./office');
  if (!scanResult.office) return { error: 'Отсутствуют данные сканирования Office.' };

  const cleanBuffer = await sanitizeOffice(buffer, { removeCustomXml: opts.removeCustomXml });
  const ov = await verifyOffice(scanResult.office, cleanBuffer, { removeCustomXml: opts.removeCustomXml });

  const verification: VerificationResult = {
    passed: ov.verificationPassed,
    metadataFoundBefore: ov.metadataFoundBefore,
    metadataRemaining: ov.personalMetadataRemaining,
    technicalDataPreserved: [
      'Структура Office-документа: проверена',
      `Встроенные изображения: ${ov.embeddedImagesVerified} проверены`,
    ],
    cleanHash: '',
    processedLocally: true,
    limitations: ov.remainingUnsupportedMetadataRisk,
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk:
      ov.remainingUnsupportedMetadataRisk.length > 0 ? ov.remainingUnsupportedMetadataRisk.join('; ') : '',
    office: ov,
  };
  return { cleanBuffer, verification };
}

function officeDescriptor(id: 'docx' | 'xlsx' | 'pptx', displayName: string, mimeType: string): FormatDescriptor {
  return {
    id,
    displayName,
    extensions: [id],
    mimeType,
    maxBytes: MAX_DOCUMENT_BYTES,
    // Never chosen by magic: OOXML is classified from ZIP content and
    // encrypted/legacy CFB routes through detectScanFormat below.
    detect: () => false,
    scan: officeScan,
    clean: officeClean,
  };
}

/** OpenDocument scan/clean, shared by the four ODF descriptors. */
async function odfScan(buffer: ArrayBuffer, fileName: string, fileSize: number): Promise<ScanOutcome> {
  const { scanOdf } = await import('./odf');
  const outcome = await scanOdf(buffer);
  if ('blocked' in outcome) return { blocked: { reason: outcome.reason, message: outcome.message } };
  return {
    result: {
      format: outcome.data.format,
      findings: outcome.data.findings,
      preservedInfo: emptyPreservedInfo(),
      fileName,
      fileSize,
      orientation: null,
      odf: outcome.data,
    },
  };
}

async function odfClean(buffer: ArrayBuffer, scanResult: ScanResult): Promise<CleanOutcome> {
  const { sanitizeOdf, verifyOdf } = await import('./odf');
  if (!scanResult.odf) return { error: 'Отсутствуют данные сканирования OpenDocument.' };
  const cleanBuffer = await sanitizeOdf(buffer);
  const v = await verifyOdf(scanResult.odf, cleanBuffer);
  const verification: VerificationResult = {
    passed: v.verificationPassed,
    metadataFoundBefore: v.metadataFoundBefore,
    metadataRemaining: v.personalMetadataRemaining,
    technicalDataPreserved: [
      'Структура документа: проверена',
      `Встроенные изображения: ${v.embeddedImagesVerified} проверены`,
    ],
    cleanHash: '',
    processedLocally: true,
    limitations: v.remainingRisk,
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: v.remainingRisk.length > 0 ? v.remainingRisk.join('; ') : '',
  };
  return { cleanBuffer, verification };
}

function odfDescriptor(id: 'odt' | 'ods' | 'odp' | 'odg', displayName: string, mimeType: string): FormatDescriptor {
  return {
    id,
    displayName,
    extensions: [id],
    mimeType,
    maxBytes: MAX_DOCUMENT_BYTES,
    // Never chosen by magic: classified from the package mimetype entry.
    detect: () => false,
    scan: odfScan,
    clean: odfClean,
  };
}

async function epubScan(buffer: ArrayBuffer, fileName: string, fileSize: number): Promise<ScanOutcome> {
  const { scanEpub } = await import('./epub');
  const outcome = await scanEpub(buffer);
  if ('blocked' in outcome) return { blocked: { reason: outcome.reason, message: outcome.message } };
  return {
    result: {
      format: 'epub',
      findings: outcome.data.findings,
      preservedInfo: emptyPreservedInfo(),
      fileName,
      fileSize,
      orientation: null,
      epub: outcome.data,
    },
  };
}

async function epubClean(buffer: ArrayBuffer, scanResult: ScanResult): Promise<CleanOutcome> {
  const { sanitizeEpub, verifyEpub } = await import('./epub');
  if (!scanResult.epub) return { error: 'Отсутствуют данные сканирования EPUB.' };
  const cleanBuffer = await sanitizeEpub(buffer);
  const v = await verifyEpub(scanResult.epub, cleanBuffer);
  const verification: VerificationResult = {
    passed: v.verificationPassed,
    metadataFoundBefore: v.metadataFoundBefore,
    metadataRemaining: v.personalMetadataRemaining,
    technicalDataPreserved: [
      'Структура книги: проверена',
      `Встроенные изображения: ${v.embeddedImagesVerified} проверены`,
    ],
    cleanHash: '',
    processedLocally: true,
    limitations: v.remainingRisk,
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: v.remainingRisk.length > 0 ? v.remainingRisk.join('; ') : '',
  };
  return { cleanBuffer, verification };
}

const jpegDescriptor: FormatDescriptor = {
  ...imageDescriptor({
    id: 'jpeg',
    displayName: 'JPEG',
    extensions: ['jpg', 'jpeg'],
    mimeType: 'image/jpeg',
    detect: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    load: async () => (await import('./jpeg')).jpegHandler,
  }),
  // JPEG is the one image format with a clean-time option: physically keeping
  // the display orientation tag when the original relied on it.
  async clean(buffer, scanResult, opts) {
    const { cleanJpeg, jpegHandler } = await import('./jpeg');
    const cleanBuffer =
      opts.preserveJpegOrientation
        ? cleanJpeg(buffer, scanResult.orientation ?? undefined)
        : jpegHandler.clean(buffer);
    const verification = jpegHandler.verify(scanResult, cleanBuffer);
    return { cleanBuffer, verification };
  },
};

const heicDescriptor: FormatDescriptor = {
  id: 'heic',
  displayName: 'HEIC / HEIF',
  extensions: ['heic', 'heif'],
  mimeType: 'image/heic',
  maxBytes: MAX_IMAGE_BYTES,
  detect: (_b, buffer) => detectHeic(buffer),
  async scan(buffer, fileName, fileSize) {
    const { scanHeic } = await import('./heic');
    const outcome = await scanHeic(buffer);
    if ('blocked' in outcome) return { blocked: { reason: outcome.reason, message: outcome.message } };
    const { data } = outcome;
    return {
      result: {
        format: 'heic',
        findings: data.findings,
        preservedInfo: {
          hasIccProfile: data.metadataContainers.some((item) => /ICC|colour|color|NCLX/i.test(item)),
          iccDescription: data.metadataContainers.find((item) => /ICC|colour|color|NCLX/i.test(item)) ?? null,
          hasTransparency: data.hasAlpha,
          dimensions: data.dimensions,
          colourChunks: data.metadataContainers.filter((item) => /ICC|colour|color|NCLX/i.test(item)),
        },
        fileName,
        fileSize,
        orientation: data.orientation,
        heic: data,
      },
    };
  },
  async clean(buffer, scanResult) {
    if (!scanResult.heic) return { error: 'Отсутствуют данные сканирования HEIC/HEIF.' };
    const { sanitizeHeic, verifyHeicExport } = await import('./heic');
    const cleanOutcome = await sanitizeHeic(buffer, scanResult.heic);
    if ('blocked' in cleanOutcome) return { error: cleanOutcome.message };
    const hv = verifyHeicExport(scanResult.heic, cleanOutcome);
    if (!hv.outputVerificationPassed) {
      return { error: 'HEIC/HEIF экспорт не прошёл независимую проверку. Очищенная копия не создана.' };
    }
    const verification: VerificationResult = {
      passed: hv.outputVerificationPassed,
      metadataFoundBefore: scanResult.findings.length,
      metadataRemaining: 0,
      technicalDataPreserved: [
        `Экспорт: ${hv.exportedFormat === 'png' ? 'PNG' : 'JPEG'}`,
        `Размеры: ${cleanOutcome.width}×${cleanOutcome.height}`,
        hv.colourHandling,
      ],
      cleanHash: '',
      processedLocally: true,
      limitations: hv.remainingUnsupportedMetadataRisk,
      orientationApplied: hv.orientationApplied,
      pixelDataReencoded: true,
      remainingUnsupportedMetadataRisk: hv.remainingUnsupportedMetadataRisk.join('; '),
      heic: hv,
    };
    return { cleanBuffer: cleanOutcome.buffer, verification };
  },
};

const pdfDescriptor: FormatDescriptor = {
  id: 'pdf',
  displayName: 'PDF',
  extensions: ['pdf'],
  mimeType: 'application/pdf',
  maxBytes: MAX_DOCUMENT_BYTES,
  detect: (b) =>
    b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  async scan(buffer, fileName, fileSize) {
    const { scanPdf } = await import('./pdf');
    const outcome = await scanPdf(buffer);
    if ('blocked' in outcome) return { blocked: { reason: outcome.reason, message: outcome.message } };
    const { data } = outcome;
    return {
      result: {
        format: 'pdf',
        findings: data.findings,
        preservedInfo: emptyPreservedInfo(),
        fileName,
        fileSize,
        orientation: null,
        pdf: {
          pageCount: data.info.pageCount,
          pageGeometry: data.info.pageGeometry,
          hasAnnotations: data.info.hasAnnotations,
          hasOutlines: data.info.hasOutlines,
          hasAcroForm: data.info.hasAcroForm,
          rawMetadataValues: data.rawMetadataValues,
          unsupportedMetadataRisk: data.unsupportedMetadataRisk,
        },
      },
    };
  },
  async clean(buffer, scanResult) {
    const { sanitizePdf, verifyPdf } = await import('./pdf');
    if (!scanResult.pdf) return { error: 'Отсутствуют данные сканирования PDF.' };

    const cleanBuffer = await sanitizePdf(buffer);
    const pv = await verifyPdf(
      {
        findings: scanResult.findings,
        info: {
          pageCount: scanResult.pdf.pageCount,
          pageGeometry: scanResult.pdf.pageGeometry,
          hasAnnotations: scanResult.pdf.hasAnnotations,
          hasOutlines: scanResult.pdf.hasOutlines,
          hasAcroForm: scanResult.pdf.hasAcroForm,
        },
        rawMetadataValues: scanResult.pdf.rawMetadataValues,
        unsupportedMetadataRisk: scanResult.pdf.unsupportedMetadataRisk,
      },
      cleanBuffer,
    );

    const verification: VerificationResult = {
      passed: pv.verificationPassed,
      metadataFoundBefore: pv.metadataFoundBefore,
      metadataRemaining: pv.personalMetadataRemaining,
      technicalDataPreserved: [`Страниц: ${scanResult.pdf.pageCount}`, 'Структура документа: проверена'],
      cleanHash: '',
      processedLocally: true,
      limitations: pv.remainingUnsupportedMetadataRisk,
      orientationApplied: false,
      pixelDataReencoded: false,
      remainingUnsupportedMetadataRisk:
        pv.remainingUnsupportedMetadataRisk.length > 0 ? pv.remainingUnsupportedMetadataRisk.join('; ') : '',
      pdf: pv,
    };
    return { cleanBuffer, verification };
  },
};

const zipDescriptor: FormatDescriptor = {
  id: 'zip',
  displayName: 'ZIP archive',
  extensions: ['zip'],
  mimeType: 'application/zip',
  maxBytes: MAX_DOCUMENT_BYTES,
  detect: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && [0x03, 0x05, 0x07].includes(b[2]),
  async scan(buffer, fileName, fileSize) {
    // OOXML, OpenDocument, and EPUB are all ZIP at magic level. Classify from
    // package CONTENT — never the filename — and route to their machinery.
    const { loadPackage, classifyOffice } = await import('./office');
    const loaded = await loadPackage(buffer);
    if (!('blocked' in loaded)) {
      if (classifyOffice(loaded.entryNames)) return officeScan(buffer, fileName, fileSize);
      if (loaded.entryNames.includes('mimetype')) {
        const mimetype = ((await loaded.zip.file('mimetype')?.async('string')) ?? '').trim();
        if (mimetype.startsWith('application/vnd.oasis.opendocument')) return odfScan(buffer, fileName, fileSize);
        if (mimetype === 'application/epub+zip') return epubScan(buffer, fileName, fileSize);
      }
    }

    const { scanZip } = await import('./zip');
    const outcome = await scanZip(buffer);
    if ('blocked' in outcome) return { blocked: { reason: outcome.reason, message: outcome.message } };
    return {
      result: {
        format: 'zip',
        findings: outcome.data.findings,
        preservedInfo: emptyPreservedInfo(),
        fileName,
        fileSize,
        orientation: null,
        zip: outcome.data,
      },
    };
  },
  async clean(buffer, scanResult) {
    const { sanitizeZip, verifyZip } = await import('./zip');
    if (!scanResult.zip) return { error: 'Отсутствуют данные сканирования ZIP.' };
    const cleanOutcome = await sanitizeZip(buffer, scanResult.zip);
    if ('blocked' in cleanOutcome) {
      return {
        error: cleanOutcome.entryPath ? `${cleanOutcome.message} (${cleanOutcome.entryPath})` : cleanOutcome.message,
      };
    }
    const zv = await verifyZip(buffer, scanResult.zip, cleanOutcome);
    if (!zv.verificationPassed) {
      return { error: 'ZIP-архив не прошёл независимую проверку. Очищенная копия не создана.' };
    }
    const verification: VerificationResult = {
      passed: zv.verificationPassed,
      metadataFoundBefore: scanResult.findings.length,
      metadataRemaining: 0,
      technicalDataPreserved: [
        'Структура архива: проверена',
        `Поддерживаемые файлы: ${zv.supportedEntriesVerified} проверены`,
        `Неподдерживаемые файлы: ${zv.unsupportedEntriesUnchanged} сохранены без изменений`,
      ],
      cleanHash: '',
      processedLocally: true,
      limitations: zv.remainingUnsupportedMetadataRisk,
      orientationApplied: false,
      pixelDataReencoded: false,
      remainingUnsupportedMetadataRisk: zv.remainingUnsupportedMetadataRisk.join('; '),
      zip: zv,
    };
    return { cleanBuffer: cleanOutcome, verification };
  },
};

/**
 * Registry in detection-priority order: specific sniffs before generic
 * containers, HEIC's ftyp walk after single-magic image formats.
 */
export const REGISTRY: readonly FormatDescriptor[] = [
  jpegDescriptor,
  imageDescriptor({
    id: 'png',
    displayName: 'PNG',
    extensions: ['png'],
    mimeType: 'image/png',
    detect: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
    load: async () => (await import('./png')).pngHandler,
  }),
  imageDescriptor({
    id: 'webp',
    displayName: 'WebP',
    extensions: ['webp'],
    mimeType: 'image/webp',
    detect: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
    load: async () => (await import('./webp')).webpHandler,
  }),
  imageDescriptor({
    id: 'tiff',
    displayName: 'TIFF',
    extensions: ['tif', 'tiff'],
    mimeType: 'image/tiff',
    detect: (b) =>
      b.length >= 4 &&
      ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
        (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a)),
    load: async () => (await import('./tiff')).tiffHandler,
  }),
  imageDescriptor({
    id: 'gif',
    displayName: 'GIF',
    extensions: ['gif'],
    mimeType: 'image/gif',
    detect: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
      (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
    load: async () => (await import('./gif')).gifHandler,
  }),
  imageDescriptor({
    id: 'bmp',
    displayName: 'BMP',
    extensions: ['bmp'],
    mimeType: 'image/bmp',
    detect: (b, buffer) => {
      if (b.length < 18 || b[0] !== 0x42 || b[1] !== 0x4d) return false;
      const dibSize = new DataView(buffer).getUint32(14, true);
      return [12, 40, 52, 56, 108, 124].includes(dibSize);
    },
    load: async () => (await import('./bmp')).bmpHandler,
  }),
  // AVIF must outrank HEIC: the HEIC ftyp sniff accepts avif brands, but AVIF
  // is cleaned in place with no decode while HEIC goes through clean export.
  imageDescriptor({
    id: 'avif',
    displayName: 'AVIF',
    extensions: ['avif'],
    mimeType: 'image/avif',
    detect: (b) => {
      if (b.length < 12 || readFourCC(b, 4) !== 'ftyp') return false;
      const brand = readFourCC(b, 8);
      return brand === 'avif' || brand === 'avis';
    },
    load: async () => (await import('./avif')).avifHandler,
  }),
  heicDescriptor,
  imageDescriptor({
    id: 'ico',
    displayName: 'ICO',
    extensions: ['ico'],
    mimeType: 'image/x-icon',
    requireDimensions: false,
    detect: (b, buffer) => {
      if (b.length < 22 || b[0] !== 0 || b[1] !== 0 || (b[2] !== 1 && b[2] !== 2) || b[3] !== 0) return false;
      const view = new DataView(buffer);
      const count = view.getUint16(4, true);
      if (count === 0 || count > 64 || 6 + count * 16 > b.length) return false;
      const size = view.getUint32(6 + 8, true);
      const offset = view.getUint32(6 + 12, true);
      return size > 0 && offset >= 6 + count * 16 && offset + size <= b.length;
    },
    load: async () => (await import('./ico')).icoHandler,
  }),
  imageDescriptor({
    id: 'svg',
    displayName: 'SVG',
    extensions: ['svg'],
    mimeType: 'image/svg+xml',
    requireDimensions: false,
    detect: (b) => {
      const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 1024));
      if (head.includes('\0')) return false;
      return /<svg[\s>]/i.test(head) || (/^\s*<\?xml/i.test(head) && head.toLowerCase().includes('<svg'));
    },
    load: async () => (await import('./svg')).svgHandler,
  }),
  imageDescriptor({
    id: 'flac',
    displayName: 'FLAC',
    extensions: ['flac'],
    mimeType: 'audio/flac',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => b.length >= 4 && b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43,
    load: async () => (await import('./flac')).flacHandler,
  }),
  imageDescriptor({
    id: 'ogg',
    displayName: 'OGG / Opus',
    extensions: ['ogg', 'opus', 'oga'],
    mimeType: 'audio/ogg',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53,
    load: async () => (await import('./ogg')).oggHandler,
  }),
  imageDescriptor({
    id: 'mkv',
    displayName: 'MKV / WebM',
    extensions: ['mkv', 'webm'],
    mimeType: 'video/x-matroska',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
    load: async () => (await import('./mkv')).mkvHandler,
  }),
  imageDescriptor({
    id: 'avi',
    displayName: 'AVI',
    extensions: ['avi'],
    mimeType: 'video/x-msvideo',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x41 && b[9] === 0x56 && b[10] === 0x49 && b[11] === 0x20,
    load: async () => (await import('./avi')).aviHandler,
  }),
  imageDescriptor({
    id: 'psd',
    displayName: 'PSD',
    extensions: ['psd', 'psb'],
    mimeType: 'image/vnd.adobe.photoshop',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => b.length >= 6 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53,
    load: async () => (await import('./psd')).psdHandler,
  }),
  imageDescriptor({
    id: 'rtf',
    displayName: 'RTF',
    extensions: ['rtf'],
    mimeType: 'application/rtf',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) =>
      b.length >= 5 && b[0] === 0x7b && b[1] === 0x5c && b[2] === 0x72 && b[3] === 0x74 && b[4] === 0x66, // "{\rtf"
    load: async () => (await import('./rtf')).rtfHandler,
  }),
  imageDescriptor({
    id: 'wav',
    displayName: 'WAV',
    extensions: ['wav'],
    mimeType: 'audio/wav',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45,
    load: async () => (await import('./wav')).wavHandler,
  }),
  // After AVIF/HEIC: those are also ISO-BMFF ftyp files and take priority.
  imageDescriptor({
    id: 'mp4',
    displayName: 'MP4 / M4A / MOV',
    extensions: ['mp4', 'm4a', 'm4v', 'mov'],
    mimeType: 'video/mp4',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => b.length >= 12 && readFourCC(b, 4) === 'ftyp',
    load: async () => (await import('./mp4')).mp4Handler,
  }),
  pdfDescriptor,
  zipDescriptor,
  // MP3 detection (ID3 magic or a bare MPEG frame sync) is the weakest sniff
  // in the registry — it must come after every container format.
  imageDescriptor({
    id: 'mp3',
    displayName: 'MP3',
    extensions: ['mp3'],
    mimeType: 'audio/mpeg',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => {
      if (b.length < 4) return false;
      if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true; // "ID3"
      // Bare MPEG frame sync with sane header fields.
      return (
        b[0] === 0xff &&
        (b[1] & 0xe0) === 0xe0 &&
        ((b[1] >> 3) & 0x03) !== 1 && // version not reserved
        ((b[1] >> 1) & 0x03) !== 0 && // layer not reserved
        (b[2] >> 4) !== 0x0f && (b[2] >> 4) !== 0 && // bitrate valid
        ((b[2] >> 2) & 0x03) !== 3 // sample rate valid
      );
    },
    load: async () => (await import('./mp3')).mp3Handler,
  }),
  // EML is plain text with no magic bytes — the weakest sniff of all, last.
  imageDescriptor({
    id: 'eml',
    displayName: 'EML',
    extensions: ['eml'],
    mimeType: 'message/rfc822',
    requireDimensions: false,
    maxBytes: MAX_DOCUMENT_BYTES,
    detect: (b) => {
      const head = new TextDecoder('utf-8', { fatal: false }).decode(b.slice(0, 2048));
      if (head.includes('\0')) return false;
      const headerLines = head.match(/^[!-9;-~]+:[ \t]/gm) ?? [];
      return headerLines.length >= 3 && /^(from|to|subject|received|return-path|mime-version|date):/im.test(head);
    },
    load: async () => (await import('./eml')).emlHandler,
  }),
  officeDescriptor('docx', 'DOCX', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  officeDescriptor('xlsx', 'XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  officeDescriptor('pptx', 'PPTX', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  odfDescriptor('odt', 'ODT', 'application/vnd.oasis.opendocument.text'),
  odfDescriptor('ods', 'ODS', 'application/vnd.oasis.opendocument.spreadsheet'),
  odfDescriptor('odp', 'ODP', 'application/vnd.oasis.opendocument.presentation'),
  odfDescriptor('odg', 'ODG', 'application/vnd.oasis.opendocument.graphics'),
  {
    id: 'epub',
    displayName: 'EPUB',
    extensions: ['epub'],
    mimeType: 'application/epub+zip',
    maxBytes: MAX_DOCUMENT_BYTES,
    // Never chosen by magic: classified from the package mimetype entry.
    detect: () => false,
    scan: epubScan,
    clean: epubClean,
  },
];

const BY_ID = new Map(REGISTRY.map((d) => [d.id, d]));

export function getDescriptor(format: SupportedFormat): FormatDescriptor {
  const descriptor = BY_ID.get(format);
  if (!descriptor) throw new Error(`No descriptor registered for format: ${format}`);
  return descriptor;
}

/** Every extension BURAN accepts, for the file-picker accept attribute. */
export function acceptedExtensions(): string[] {
  return REGISTRY.flatMap((d) => [...d.extensions]);
}

/**
 * Magic-byte format detection. Returns null for unrecognised content —
 * including OLE/CFB, which only the top-level scan flow routes (via
 * {@link detectScanFormat}) so nested-archive recursion never treats a
 * random CFB file as an Office document.
 */
export function detectFormat(buffer: ArrayBuffer): SupportedFormat | null {
  const bytes = new Uint8Array(buffer);
  for (const descriptor of REGISTRY) {
    if (descriptor.detect(bytes, buffer)) return descriptor.id;
  }
  return null;
}

/** OLE/CFB compound file magic (encrypted OOXML and legacy Office). */
export function isCfbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1
  );
}

/**
 * Top-level detection for the scan flow: magic detection plus the CFB route,
 * which is provisionally classified as Office so the Office scanner can emit
 * its honest encrypted/legacy block message.
 */
export function detectScanFormat(buffer: ArrayBuffer): SupportedFormat | null {
  const format = detectFormat(buffer);
  if (format) return format;
  if (isCfbMagic(new Uint8Array(buffer))) return 'docx';
  return null;
}
