/**
 * Clean Worker — metadata sanitisation and verification off the main thread.
 * A thin dispatch loop over the format registry: every per-format pipeline
 * lives in the descriptors.
 *
 * Receives: { id: string, buffer: ArrayBuffer, scanResult: ScanResult, ... }
 * Returns:  { id, cleanBuffer?, verification?, error? }
 */

import { getDescriptor } from '../lib/formats/registry';
import type { ScanResult, VerificationResult } from '../lib/formats/types';

interface CleanRequest {
  id: string;
  buffer: ArrayBuffer;
  scanResult: ScanResult;
  preserveJpegOrientation?: boolean;
  removeCustomXml?: boolean;
}

interface CleanResponse {
  id: string;
  cleanBuffer?: ArrayBuffer;
  verification?: VerificationResult;
  error?: string;
}

self.onmessage = async (event: MessageEvent<CleanRequest>) => {
  const { id, buffer, scanResult, preserveJpegOrientation, removeCustomXml } = event.data;

  try {
    const outcome = await getDescriptor(scanResult.format).clean(buffer, scanResult, {
      preserveJpegOrientation,
      removeCustomXml,
    });
    if ('error' in outcome) {
      self.postMessage({ id, error: outcome.error } satisfies CleanResponse);
      return;
    }
    self.postMessage({ id, ...outcome } satisfies CleanResponse, { transfer: [outcome.cleanBuffer] });
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : 'Unknown error during cleaning',
    } satisfies CleanResponse);
  }
};
