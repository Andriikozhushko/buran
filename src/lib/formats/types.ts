import type { PdfVerification, PdfBlockReason } from './pdf/types';
import type { OfficeScanData, OfficeVerification, OfficeBlockReason } from './office/types';
import type { ZipScanData, ZipVerification, ZipBlockReason } from './zip/types';
import type { HeicScanData, HeicVerification } from './heic/types';

export type MetadataCategory =
  | 'geolocation'
  | 'device'
  | 'author'
  | 'dates'
  | 'software'
  | 'thumbnails'
  | 'containers'
  | 'other'
  // PDF-specific categories (milestone 02A)
  | 'pdf-author'
  | 'pdf-title'
  | 'pdf-dates'
  | 'pdf-software'
  | 'pdf-custom'
  | 'pdf-xmp'
  | 'pdf-identifiers'
  | 'pdf-annotations'
  // Office-specific categories (milestone 02B)
  | 'office-author'
  | 'office-app'
  | 'office-dates'
  | 'office-custom'
  | 'office-comment-authors'
  | 'office-revisions'
  | 'office-embedded-images'
  | 'office-container'
  // ZIP archive categories (milestone 02C)
  | 'zip-container';

export interface MetadataFinding {
  category: MetadataCategory;
  field: string;
  label: string;
  value: string | null;
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export type SupportedFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'zip';

export interface PreservedInfo {
  hasIccProfile: boolean;
  iccDescription: string | null;
  hasTransparency: boolean;
  dimensions: { width: number; height: number } | null;
  colourChunks: string[];
}

/** PDF-specific scan payload carried alongside the common scan surface. */
export interface PdfScanMeta {
  pageCount: number;
  pageGeometry: Array<{ width: number; height: number }>;
  hasAnnotations: boolean;
  hasOutlines: boolean;
  hasAcroForm: boolean;
  /** Original metadata values, used only for the raw-byte verification pass. */
  rawMetadataValues: string[];
  /** Honest list of metadata surfaces BURAN cannot fully guarantee removal of. */
  unsupportedMetadataRisk: string[];
}

export interface ScanResult {
  format: SupportedFormat;
  findings: MetadataFinding[];
  preservedInfo: PreservedInfo;
  fileName: string;
  fileSize: number;
  /** JPEG EXIF orientation value (1-8), or null if not applicable/absent */
  orientation: number | null;
  /** Present only for PDF scans. */
  pdf?: PdfScanMeta;
  /** Present only for Office (DOCX/XLSX/PPTX) scans. */
  office?: OfficeScanData;
  /** Present only for ZIP archive scans. */
  zip?: ZipScanData;
  /** Present only for HEIC/HEIF clean-export scans. */
  heic?: HeicScanData;
}

export interface CleanResult {
  cleanBuffer: ArrayBuffer;
  originalHash: string;
  cleanHash: string;
  metadataFound: number;
  metadataRemoved: number;
}

export interface VerificationResult {
  passed: boolean;
  metadataFoundBefore: number;
  metadataRemaining: number;
  technicalDataPreserved: string[];
  cleanHash: string;
  processedLocally: true;
  limitations: string[];
  /** Whether EXIF orientation was physically applied to pixel data */
  orientationApplied: boolean;
  /** Whether pixel data was re-encoded (true when orientation or canvas was used) */
  pixelDataReencoded: boolean;
  /**
   * Honest note about remaining risk from formats/fields BURAN cannot yet parse.
   * Empty string means no known unsupported risk. Null means unknown.
   */
  remainingUnsupportedMetadataRisk: string | null;
  /** Rich PDF verification status, present only for PDF results. */
  pdf?: PdfVerification;
  /** Rich Office verification status, present only for Office results. */
  office?: OfficeVerification;
  /** Rich ZIP verification status, present only for archive results. */
  zip?: ZipVerification;
  /** Rich HEIC clean-export verification status. */
  heic?: HeicVerification;
}

export interface FormatHandler {
  readonly format: SupportedFormat;
  scan(buffer: ArrayBuffer): ScanResult;
  clean(buffer: ArrayBuffer): ArrayBuffer;
  verify(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult;
}

export type AppState =
  | { phase: 'idle' }
  | { phase: 'scanning'; fileName: string }
  | { phase: 'scan-done'; scanResult: ScanResult }
  | { phase: 'cleaning'; scanResult: ScanResult }
  | {
      phase: 'success';
      scanResult: ScanResult;
      cleanResult: CleanResult;
      verification: VerificationResult;
    }
  | { phase: 'unsupported'; fileType: string; fileName: string; message: string }
  /** A supported-format PDF/Office file that BURAN must not modify. */
  | { phase: 'blocked'; reason: PdfBlockReason | OfficeBlockReason | ZipBlockReason; fileName: string; message: string }
  | { phase: 'error'; message: string };
