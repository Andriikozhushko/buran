/**
 * Type definitions for BURAN's browser-only PDF metadata sanitisation (milestone 02A).
 *
 * Scope: metadata-only. BURAN inspects and removes personal/identifying metadata
 * while preserving visible and functional document content. It is NOT a flattener,
 * rasteriser, redactor, or document editor.
 */

import type { MetadataFinding } from '../types';

/**
 * Reasons a PDF is blocked from sanitisation. For every blocked reason BURAN
 * must show an honest explanation and produce no output.
 */
export type PdfBlockReason =
  | 'encrypted'
  | 'signed'
  | 'xfa'
  | 'portfolio'
  | 'attachments'
  | 'too-many-pages'
  | 'too-large'
  | 'malformed';

export interface PdfBlock {
  blocked: true;
  reason: PdfBlockReason;
  /** Human-language explanation shown to the user (Russian). */
  message: string;
}

/**
 * Lightweight structural facts about a PDF that are preserved by sanitisation.
 * These are surfaced honestly in the UI and certificate.
 */
export interface PdfDocumentInfo {
  pageCount: number;
  /** Page sizes in PDF units (points), one entry per page. */
  pageGeometry: Array<{ width: number; height: number }>;
  hasAnnotations: boolean;
  hasOutlines: boolean;
  hasAcroForm: boolean;
}

/**
 * Result of scanning a supported (non-blocked) PDF. Mirrors the image
 * `ScanResult` surface so it can flow through the same UI, while carrying
 * PDF-specific structure under `pdf`.
 */
export interface PdfScanData {
  findings: MetadataFinding[];
  info: PdfDocumentInfo;
  /**
   * Raw metadata sentinels (actual string values found) used only for the
   * independent raw-byte verification pass. Never shown verbatim in the main UI.
   */
  rawMetadataValues: string[];
  /**
   * Honest list of metadata surfaces BURAN detected but cannot fully guarantee
   * removal of. Empty when none.
   */
  unsupportedMetadataRisk: string[];
}

/**
 * Independent post-sanitisation verification status for PDFs.
 * `verificationPassed` is only true when every supported metadata surface is
 * proven absent in a fresh second pass over the output bytes.
 */
export interface PdfVerification {
  metadataFoundBefore: number;
  personalMetadataRemaining: number;
  infoDictionaryRemoved: boolean;
  xmpRemoved: boolean;
  annotationAuthorFieldsRemoved: boolean;
  documentIdRegeneratedOrRemoved: boolean;
  pageCountPreserved: boolean;
  pageGeometryPreserved: boolean;
  verificationPassed: boolean;
  remainingUnsupportedMetadataRisk: string[];
}
