/**
 * Type definitions for BURAN's browser-only Office (OOXML) metadata
 * sanitisation (milestone 02B) for DOCX / XLSX / PPTX.
 *
 * Scope: metadata-only. BURAN inspects and removes personal/identifying,
 * authorship, history, and application metadata while preserving the actual
 * document content (text, tables, formulas, charts, images, slides, comment
 * bodies, layout). It is NOT a converter, flattener, redactor, or editor.
 */

import type { MetadataFinding } from '../types';

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx';

/** Reasons an Office package is blocked from sanitisation. */
export type OfficeBlockReason =
  | 'encrypted'
  | 'signed'
  | 'macro'
  | 'embedded-object'
  | 'custom-xml'
  | 'threaded-comments'
  | 'unsupported-media'
  | 'malformed'
  | 'too-large'
  | 'too-many-entries'
  | 'zip-bomb'
  | 'unsupported-package';

export interface OfficeBlock {
  blocked: true;
  reason: OfficeBlockReason;
  /** Human-language explanation shown to the user (Russian). */
  message: string;
}

/** A supported embedded raster image found in the package media folder. */
export interface EmbeddedImage {
  path: string;
  format: 'jpeg' | 'png' | 'webp';
}

/** Result of scanning a supported (non-blocked) Office package. */
export interface OfficeScanData {
  format: OfficeFormat;
  findings: MetadataFinding[];
  /** Original metadata values used only for the raw-byte verification pass. */
  rawMetadataValues: string[];
  embeddedImages: EmbeddedImage[];
  hasCoreProps: boolean;
  hasAppProps: boolean;
  hasCustomProps: boolean;
  hasComments: boolean;
  hasRevisions: boolean;
  entryCount: number;
  uncompressedSize: number;
  /** Honest list of metadata surfaces BURAN cannot fully guarantee removal of. */
  unsupportedMetadataRisk: string[];
}

/** Independent post-sanitisation verification status for Office packages. */
export interface OfficeVerification {
  format: OfficeFormat;
  metadataFoundBefore: number;
  personalMetadataRemaining: number;
  corePropertiesRemoved: boolean;
  appPropertiesRemoved: boolean;
  customPropertiesRemoved: boolean;
  commentAuthorsAnonymised: boolean;
  revisionMetadataRemoved: boolean;
  embeddedImagesVerified: number;
  zipTimestampsNormalised: boolean;
  verificationPassed: boolean;
  remainingUnsupportedMetadataRisk: string[];
}

/** Neutral, non-personal author value used where OOXML requires one. */
export const ANON_AUTHOR = 'Anonymous';
export const ANON_INITIALS = 'A';
