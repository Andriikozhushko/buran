/**
 * Format identity helpers, backed by the format registry. Adding a format
 * means registering a descriptor in registry.ts — nothing here changes.
 */

import type { SupportedFormat } from './types';
import { getDescriptor } from './registry';

export { detectFormat, detectScanFormat, isCfbMagic } from './registry';

/** Get a human-readable MIME type for a supported format. */
export function formatToMimeType(format: SupportedFormat): string {
  return getDescriptor(format).mimeType;
}

/** Get the canonical file extension (without dot) for a supported format. */
export function formatToExtension(format: SupportedFormat): string {
  return getDescriptor(format).extensions[0];
}

/** Get a human-readable display name for a supported format. */
export function formatToDisplayName(format: SupportedFormat): string {
  return getDescriptor(format).displayName;
}
