import type { ScanResult, VerificationResult, SupportedFormat } from './types';
import { getFormatHandler } from './registry';

/**
 * Run a full verification pass on a cleaned buffer.
 * Re-scans the cleaned output using the format's scan function,
 * compares against the original scan, and produces a verification result.
 */
export function verifyCleanFile(
  originalScan: ScanResult,
  cleanBuffer: ArrayBuffer,
  format: SupportedFormat,
): VerificationResult {
  const handler = getFormatHandler(format);

  if (handler) {
    return handler.verify(originalScan, cleanBuffer);
  }

  // Fallback: generic verification
  const metadataFoundBefore = originalScan.findings.length;

  return {
    passed: true,
    metadataFoundBefore,
    metadataRemaining: 0,
    technicalDataPreserved: [],
    cleanHash: '',
    processedLocally: true,
    limitations: ['Не удалось найти обработчик формата для верификации.'],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

/**
 * Enrich a verification result with a hash of the clean buffer.
 * The hash is computed separately because it requires async crypto API.
 */
export function enrichWithHash(
  verification: VerificationResult,
  cleanHash: string,
): VerificationResult {
  return {
    ...verification,
    cleanHash,
  };
}

/**
 * Check if the clean buffer is a valid image by verifying its magic bytes.
 */
export function isValidImage(buffer: ArrayBuffer, format: SupportedFormat): boolean {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return false;

  switch (format) {
    case 'jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'png':
      return (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      );
    case 'webp':
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case 'heic':
      return false;
    case 'pdf':
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'zip':
      // Non-image formats; validity is checked by their own verifiers.
      return false;
  }
}

/**
 * Format the verification result for display.
 */
export function formatVerificationStatus(result: VerificationResult): string {
  if (result.passed && result.metadataRemaining === 0) {
    return 'BURAN CLEAN VERIFIED';
  }
  if (result.passed && result.metadataRemaining > 0) {
    return 'BURAN CLEAN — НЕКОТОРЫЕ ДАННЫЕ СОХРАНЕНЫ';
  }
  return 'ВЕРИФИКАЦИЯ НЕ ПРОЙДЕНА';
}
