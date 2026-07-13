/**
 * BURAN Office (OOXML) metadata sanitisation (milestone 02B) — public surface.
 *
 * Office processing is asynchronous (JSZip) and has a blocked outcome, so it
 * does not implement the synchronous image `FormatHandler`. The scan/clean
 * workers route Office packages through these functions directly.
 */

export { scanOffice } from './scan';
export { sanitizeOffice } from './sanitize';
export { verifyOffice } from './verify';
export {
  detectOfficeContainer,
  classifyOffice,
  detectBlockedStructures,
  collectEmbeddedImages,
} from './detect';
export {
  loadPackage,
  MAX_PACKAGE_BYTES,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ENTRY_COUNT,
  MAX_COMPRESSION_RATIO,
  NEUTRAL_DATE,
} from './package';
export type {
  OfficeFormat,
  OfficeBlock,
  OfficeBlockReason,
  OfficeScanData,
  OfficeVerification,
  EmbeddedImage,
} from './types';
