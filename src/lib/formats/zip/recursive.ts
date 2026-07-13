import { detectFormat } from '../detector';
import { jpegHandler } from '../jpeg';
import { pngHandler } from '../png';
import { webpHandler } from '../webp';
import { scanPdf, sanitizePdf, verifyPdf } from '../pdf';
import { detectOfficeContainer, scanOffice, sanitizeOffice, verifyOffice } from '../office';
import type { ScanResult, SupportedFormat, VerificationResult } from '../types';
import type { ZipBlock } from './types';
import { extensionOf, maxBytesForFormat, zipBlock } from './safety';

const imageHandlers = { jpeg: jpegHandler, png: pngHandler, webp: webpHandler };

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export function detectNestedFormat(buffer: ArrayBuffer, path: string): SupportedFormat | 'zip' | null {
  const magic = detectFormat(buffer);
  if (magic === 'heic') return null;
  if (magic) return magic;
  const office = detectOfficeContainer(buffer);
  const ext = extensionOf(path);
  if (office && (ext === 'docx' || ext === 'xlsx' || ext === 'pptx')) return ext;
  const b = new Uint8Array(buffer);
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b) return 'zip';
  return null;
}

export async function scanNestedSupported(
  buffer: ArrayBuffer,
  path: string,
  fileSize: number,
): Promise<{ scan: ScanResult; rawMetadataValues: string[] } | ZipBlock> {
  const format = detectNestedFormat(buffer, path);
  if (!format || format === 'zip') {
    return zipBlock('unsupported-package', `Файл ${path} не является поддерживаемым вложенным форматом.`, path);
  }
  if (fileSize > maxBytesForFormat(format)) {
    return zipBlock('entry-too-large', `Файл ${path} больше лимита для формата ${format.toUpperCase()}. Архив не был изменён.`, path);
  }

  if (format === 'pdf') {
    const outcome = await scanPdf(buffer);
    if ('blocked' in outcome) {
      return zipBlock('nested-clean-failed', `PDF внутри архива заблокирован: ${outcome.message}`, path);
    }
    return {
      scan: {
        format: 'pdf',
        findings: outcome.data.findings,
        preservedInfo: { hasIccProfile: false, iccDescription: null, hasTransparency: false, dimensions: null, colourChunks: [] },
        fileName: path,
        fileSize,
        orientation: null,
        pdf: {
          pageCount: outcome.data.info.pageCount,
          pageGeometry: outcome.data.info.pageGeometry,
          hasAnnotations: outcome.data.info.hasAnnotations,
          hasOutlines: outcome.data.info.hasOutlines,
          hasAcroForm: outcome.data.info.hasAcroForm,
          rawMetadataValues: outcome.data.rawMetadataValues,
          unsupportedMetadataRisk: outcome.data.unsupportedMetadataRisk,
        },
      },
      rawMetadataValues: outcome.data.rawMetadataValues,
    };
  }

  if (format === 'docx' || format === 'xlsx' || format === 'pptx') {
    const outcome = await scanOffice(buffer);
    if ('blocked' in outcome) {
      return zipBlock('nested-clean-failed', `Office-файл внутри архива заблокирован: ${outcome.message}`, path);
    }
    return {
      scan: {
        format: outcome.data.format,
        findings: outcome.data.findings,
        preservedInfo: { hasIccProfile: false, iccDescription: null, hasTransparency: false, dimensions: null, colourChunks: [] },
        fileName: path,
        fileSize,
        orientation: null,
        office: outcome.data,
      },
      rawMetadataValues: outcome.data.rawMetadataValues,
    };
  }

  if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
    return zipBlock('unsupported-package', `Файл ${path} не является поддерживаемым вложенным форматом.`, path);
  }
  const scan = imageHandlers[format].scan(buffer);
  scan.fileName = path;
  scan.fileSize = fileSize;
  const rawMetadataValues = scan.findings.map((f) => f.value).filter((v): v is string => !!v && v.length >= 3);
  return { scan, rawMetadataValues };
}

export async function cleanNestedSupported(
  buffer: ArrayBuffer,
  scan: ScanResult,
): Promise<{ cleanBuffer: ArrayBuffer; verification: VerificationResult } | ZipBlock> {
  if (scan.format === 'pdf') {
    if (!scan.pdf) return zipBlock('nested-clean-failed', `Нет данных сканирования PDF: ${scan.fileName}`, scan.fileName);
    const cleanBuffer = await sanitizePdf(buffer);
    const pv = await verifyPdf({
      findings: scan.findings,
      info: {
        pageCount: scan.pdf.pageCount,
        pageGeometry: scan.pdf.pageGeometry,
        hasAnnotations: scan.pdf.hasAnnotations,
        hasOutlines: scan.pdf.hasOutlines,
        hasAcroForm: scan.pdf.hasAcroForm,
      },
      rawMetadataValues: scan.pdf.rawMetadataValues,
      unsupportedMetadataRisk: scan.pdf.unsupportedMetadataRisk,
    }, cleanBuffer);
    if (!pv.verificationPassed) {
      return zipBlock('verification-failed', `PDF ${scan.fileName} не прошёл независимую проверку после очистки.`, scan.fileName);
    }
    return { cleanBuffer, verification: baseVerification(pv.metadataFoundBefore, pv.personalMetadataRemaining, pv.verificationPassed, pv.remainingUnsupportedMetadataRisk) };
  }

  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') {
    if (!scan.office) return zipBlock('nested-clean-failed', `Нет данных сканирования Office: ${scan.fileName}`, scan.fileName);
    const cleanBuffer = await sanitizeOffice(buffer);
    const ov = await verifyOffice(scan.office, cleanBuffer);
    if (!ov.verificationPassed) {
      return zipBlock('verification-failed', `Office-файл ${scan.fileName} не прошёл независимую проверку после очистки.`, scan.fileName);
    }
    return { cleanBuffer, verification: baseVerification(ov.metadataFoundBefore, ov.personalMetadataRemaining, ov.verificationPassed, ov.remainingUnsupportedMetadataRisk) };
  }

  if (scan.format !== 'jpeg' && scan.format !== 'png' && scan.format !== 'webp') {
    return zipBlock('unsupported-package', `Нет обработчика для ${scan.fileName}.`, scan.fileName);
  }
  const handler = imageHandlers[scan.format];
  const cleanBuffer = handler.clean(buffer);
  const verification = handler.verify(scan, cleanBuffer);
  if (!verification.passed || verification.metadataRemaining > 0) {
    return zipBlock('verification-failed', `Файл ${scan.fileName} не прошёл независимую проверку после очистки.`, scan.fileName);
  }
  return { cleanBuffer, verification };
}

function baseVerification(found: number, remaining: number, passed: boolean, risk: string[]): VerificationResult {
  return {
    passed,
    metadataFoundBefore: found,
    metadataRemaining: remaining,
    technicalDataPreserved: [],
    cleanHash: '',
    processedLocally: true,
    limitations: risk,
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: risk.join('; '),
  };
}
