/**
 * Scan Worker — format detection and metadata scanning off the main thread.
 * A thin dispatch loop over the format registry: detection and every
 * per-format pipeline live in the descriptors.
 *
 * Receives: { id: string, buffer: ArrayBuffer, fileName: string, fileSize: number }
 * Returns:  { id, result: ScanResult }
 *         | { id, blocked: { reason, message } }   (file that must not be modified)
 *         | { id, error: string }
 */

import { detectScanFormat, getDescriptor } from '../lib/formats/registry';
import type { ScanResult } from '../lib/formats/types';

interface ScanRequest {
  id: string;
  buffer: ArrayBuffer;
  fileName: string;
  fileSize: number;
}

interface ScanResponse {
  id: string;
  result?: ScanResult;
  blocked?: { reason: string; message: string };
  error?: string;
}

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { id, buffer, fileName, fileSize } = event.data;

  try {
    const format = detectScanFormat(buffer);
    if (!format) {
      self.postMessage({ id, error: 'Unsupported format: unknown' } satisfies ScanResponse);
      return;
    }

    const outcome = await getDescriptor(format).scan(buffer, fileName, fileSize);
    self.postMessage({ id, ...outcome } satisfies ScanResponse);
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : 'Unknown error during scanning',
    } satisfies ScanResponse);
  }
};
