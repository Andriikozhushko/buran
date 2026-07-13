/**
 * BURAN PDF metadata sanitisation (milestone 02A) — public surface.
 *
 * PDF processing is async (pdf-lib) and has a blocked/unsupported outcome, so it
 * does not implement the synchronous image `FormatHandler`. The scan/clean
 * workers route PDFs through these functions directly.
 */

export { scanPdf } from './scan';
export { sanitizePdf } from './sanitize';
export { verifyPdf } from './verify';
export {
  detectPdfMagic,
  rawSecurityScan,
  blockMessage,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
} from './detect';
export type {
  PdfBlock,
  PdfBlockReason,
  PdfDocumentInfo,
  PdfScanData,
  PdfVerification,
} from './types';
