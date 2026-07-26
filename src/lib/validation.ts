import { detectScanFormat, getDescriptor, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES } from './formats/registry';
import type { SupportedFormat } from './formats/types';

export interface ValidationSuccess {
  valid: true;
  format: SupportedFormat;
  buffer: ArrayBuffer;
  fileName: string;
  fileSize: number;
}

export interface ValidationError {
  valid: false;
  error: 'too-large' | 'unsupported-format' | 'read-error';
  fileName: string;
  fileSize: number;
  detectedType: string | null;
}

export type ValidationResult = ValidationSuccess | ValidationError;

/**
 * Validate a File object for BURAN processing.
 * Checks file size, reads the file, and detects the format from magic bytes —
 * never from the filename. OOXML packages surface here as 'zip' (or 'docx'
 * for OLE/CFB containers); the worker classifies them from package content.
 */
export async function validateFile(file: File): Promise<ValidationResult> {
  const fileName = file.name;
  const fileSize = file.size;

  // Hard upper bound before reading: the largest per-format limit.
  if (fileSize > MAX_DOCUMENT_BYTES) {
    return { valid: false, error: 'too-large', fileName, fileSize, detectedType: null };
  }

  if (fileSize === 0) {
    return { valid: false, error: 'unsupported-format', fileName, fileSize, detectedType: null };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { valid: false, error: 'read-error', fileName, fileSize, detectedType: null };
  }

  const format = detectScanFormat(buffer);

  if (!format) {
    // Oversize unrecognised content is reported as too-large, not unsupported —
    // the size problem is actionable, the sniff result of a huge file is not.
    if (fileSize > MAX_IMAGE_BYTES) {
      return { valid: false, error: 'too-large', fileName, fileSize, detectedType: null };
    }
    const ext = fileName.split('.').pop()?.toLowerCase() ?? null;
    return { valid: false, error: 'unsupported-format', fileName, fileSize, detectedType: ext };
  }

  // Per-format size limit from the registry (checked after detection so an
  // oversize supported file is reported as too-large, not unsupported).
  if (fileSize > getDescriptor(format).maxBytes) {
    return { valid: false, error: 'too-large', fileName, fileSize, detectedType: format };
  }

  return { valid: true, format, buffer, fileName, fileSize };
}
