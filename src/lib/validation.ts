import { detectFormat } from './formats/detector';
import { detectOfficeContainer } from './formats/office/detect';
import type { SupportedFormat } from './formats/types';

const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB for images
const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB for PDFs and Office packages

const OFFICE_EXT: Record<string, SupportedFormat> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
};

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
 * Checks file size, reads the file, and detects the format from magic bytes.
 */
export async function validateFile(file: File): Promise<ValidationResult> {
  const fileName = file.name;
  const fileSize = file.size;

  // Hard upper bound before reading: the largest per-format limit (PDF, 100 MB).
  if (fileSize > MAX_PDF_SIZE) {
    return {
      valid: false,
      error: 'too-large',
      fileName,
      fileSize,
      detectedType: null,
    };
  }

  // Check for empty files
  if (fileSize === 0) {
    return {
      valid: false,
      error: 'unsupported-format',
      fileName,
      fileSize,
      detectedType: null,
    };
  }

  // Read the file
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return {
      valid: false,
      error: 'read-error',
      fileName,
      fileSize,
      detectedType: null,
    };
  }

  // Detect format from magic bytes (images + PDF).
  const format = detectFormat(buffer);

  // Office: OOXML packages are ZIP (PK) or, when encrypted, OLE/CFB compound
  // files. Magic bytes alone cannot tell DOCX/XLSX/PPTX apart, so we take a
  // provisional format from the extension here; the worker authoritatively
  // re-classifies from package CONTENT (and blocks unsupported packages).
  const ext = fileName.split('.').pop()?.toLowerCase() ?? null;
  if (!format || format === 'zip') {
    const container = detectOfficeContainer(buffer);
    if (container && ext && OFFICE_EXT[ext]) {
      if (fileSize > MAX_PDF_SIZE) {
        return { valid: false, error: 'too-large', fileName, fileSize, detectedType: OFFICE_EXT[ext] };
      }
      return { valid: true, format: OFFICE_EXT[ext], buffer, fileName, fileSize };
    }
  }

  // Per-format size limit: PDFs, Office packages, and ZIP archives may exceed the 50 MB image cap. This is
  // checked before the unsupported-format branch so an oversize non-PDF is
  // reported as too-large rather than unsupported.
  if (format !== 'pdf' && format !== 'zip' && fileSize > MAX_IMAGE_SIZE) {
    return {
      valid: false,
      error: 'too-large',
      fileName,
      fileSize,
      detectedType: format,
    };
  }

  if (!format) {
    return {
      valid: false,
      error: 'unsupported-format',
      fileName,
      fileSize,
      detectedType: ext,
    };
  }

  return {
    valid: true,
    format,
    buffer,
    fileName,
    fileSize,
  };
}

/**
 * Get a user-friendly error message for a validation error.
 */
export function getValidationErrorMessage(error: 'too-large' | 'unsupported-format' | 'read-error'): string {
  switch (error) {
    case 'too-large':
      return 'Файл слишком большой. Максимальный размер — 50 МБ для изображений и 100 МБ для PDF/Office/ZIP.';
    case 'unsupported-format':
      return 'Неподдерживаемый формат файла. Пожалуйста, выберите JPG, PNG, WebP, HEIC/HEIF, PDF, Office или ZIP.';
    case 'read-error':
      return 'Не удалось прочитать файл. Попробуйте другой.';
  }
}
