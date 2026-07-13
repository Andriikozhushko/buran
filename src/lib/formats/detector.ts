import type { SupportedFormat } from './types';
import { detectHeic } from './heic/detect';

/**
 * Detect file format from magic bytes at the beginning of the buffer.
 * We look at the first 12 bytes to identify JPEG, PNG, WebP, PDF, and ZIP.
 */
export function detectFormat(buffer: ArrayBuffer): SupportedFormat | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 12) return null;

  if (detectHeic(buffer)) return 'heic';

  // JPEG: starts with FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: RIFF .... WEBP (52 49 46 46 xx xx xx xx 57 45 42 50)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }

  // PDF: "%PDF-" (25 50 44 46 2D)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'pdf';
  }

  // ZIP: local file header, empty archive, or spanning marker. Office packages
  // are ZIP too; callers that need DOCX/XLSX/PPTX classify those by content.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2])) {
    return 'zip';
  }

  return null;
}

/**
 * Get a human-readable MIME type for a supported format.
 */
export function formatToMimeType(format: SupportedFormat): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
      return 'image/heic';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'zip':
      return 'application/zip';
  }
}

/**
 * Get the file extension (without dot) for a supported format.
 */
export function formatToExtension(format: SupportedFormat): string {
  switch (format) {
    case 'jpeg':
      return 'jpg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'heic':
      return 'heic';
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'xlsx';
    case 'pptx':
      return 'pptx';
    case 'zip':
      return 'zip';
  }
}

/**
 * Get a human-readable display name for a supported format.
 */
export function formatToDisplayName(format: SupportedFormat): string {
  switch (format) {
    case 'jpeg':
      return 'JPEG';
    case 'png':
      return 'PNG';
    case 'webp':
      return 'WebP';
    case 'heic':
      return 'HEIC / HEIF';
    case 'pdf':
      return 'PDF';
    case 'docx':
      return 'DOCX';
    case 'xlsx':
      return 'XLSX';
    case 'pptx':
      return 'PPTX';
    case 'zip':
      return 'ZIP archive';
  }
}
