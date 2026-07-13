/**
 * Scan Worker — runs format detection and metadata scanning off the main thread.
 *
 * Receives: { id: string, buffer: ArrayBuffer, fileName: string, fileSize: number }
 * Returns:  { id, result: ScanResult }
 *         | { id, blocked: { reason, message } }   (PDF that must not be modified)
 *         | { id, error: string }
 */

import { detectFormat } from '../lib/formats/detector';
import { jpegHandler } from '../lib/formats/jpeg';
import { pngHandler } from '../lib/formats/png';
import { webpHandler } from '../lib/formats/webp';
import type { PdfBlockReason } from '../lib/formats/pdf/types';
import { detectOfficeContainer } from '../lib/formats/office/detect';
import type { OfficeBlockReason } from '../lib/formats/office/types';
import type { ZipBlockReason } from '../lib/formats/zip/types';
import type { HeicBlockReason } from '../lib/formats/heic/types';
import type { ScanResult } from '../lib/formats/types';
import { dimensionsExceedPixelLimit, MALFORMED_MESSAGE, RESOURCE_LIMIT_MESSAGE } from '../lib/processing-limits';

const imageHandlers = {
  jpeg: jpegHandler,
  png: pngHandler,
  webp: webpHandler,
};

interface ScanRequest {
  id: string;
  buffer: ArrayBuffer;
  fileName: string;
  fileSize: number;
}

interface ScanResponse {
  id: string;
  result?: ScanResult;
  blocked?: { reason: PdfBlockReason | OfficeBlockReason | ZipBlockReason | HeicBlockReason; message: string };
  error?: string;
}

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { id, buffer, fileName, fileSize } = event.data;

  try {
    const format = detectFormat(buffer);

    if (format === 'pdf') {
      const { scanPdf } = await import('../lib/formats/pdf');
      const outcome = await scanPdf(buffer);
      if ('blocked' in outcome) {
        const response: ScanResponse = {
          id,
          blocked: { reason: outcome.reason, message: outcome.message },
        };
        self.postMessage(response);
        return;
      }

      const { data } = outcome;
      const scanResult: ScanResult = {
        format: 'pdf',
        findings: data.findings,
        preservedInfo: {
          hasIccProfile: false,
          iccDescription: null,
          hasTransparency: false,
          dimensions: null,
          colourChunks: [],
        },
        fileName,
        fileSize,
        orientation: null,
        pdf: {
          pageCount: data.info.pageCount,
          pageGeometry: data.info.pageGeometry,
          hasAnnotations: data.info.hasAnnotations,
          hasOutlines: data.info.hasOutlines,
          hasAcroForm: data.info.hasAcroForm,
          rawMetadataValues: data.rawMetadataValues,
          unsupportedMetadataRisk: data.unsupportedMetadataRisk,
        },
      };

      self.postMessage({ id, result: scanResult } satisfies ScanResponse);
      return;
    }

    // Office (OOXML) packages: magic is ZIP (PK) or, when encrypted, OLE/CFB.
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    const isOfficeName = ext === 'docx' || ext === 'xlsx' || ext === 'pptx';
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp' && isOfficeName && detectOfficeContainer(buffer)) {
      const { scanOffice } = await import('../lib/formats/office');
      const outcome = await scanOffice(buffer);
      if ('blocked' in outcome) {
        self.postMessage({
          id,
          blocked: { reason: outcome.reason, message: outcome.message },
        } satisfies ScanResponse);
        return;
      }

      const { data } = outcome;
      const scanResult: ScanResult = {
        format: data.format,
        findings: data.findings,
        preservedInfo: {
          hasIccProfile: false,
          iccDescription: null,
          hasTransparency: false,
          dimensions: null,
          colourChunks: [],
        },
        fileName,
        fileSize,
        orientation: null,
        office: data,
      };
      self.postMessage({ id, result: scanResult } satisfies ScanResponse);
      return;
    }

    if (format === 'zip') {
      const { scanZip } = await import('../lib/formats/zip');
      const outcome = await scanZip(buffer);
      if ('blocked' in outcome) {
        self.postMessage({
          id,
          blocked: { reason: outcome.reason, message: outcome.message },
        } satisfies ScanResponse);
        return;
      }

      const scanResult: ScanResult = {
        format: 'zip',
        findings: outcome.data.findings,
        preservedInfo: {
          hasIccProfile: false,
          iccDescription: null,
          hasTransparency: false,
          dimensions: null,
          colourChunks: [],
        },
        fileName,
        fileSize,
        orientation: null,
        zip: outcome.data,
      };
      self.postMessage({ id, result: scanResult } satisfies ScanResponse);
      return;
    }

    if (format === 'heic') {
      const { scanHeic } = await import('../lib/formats/heic');
      const outcome = await scanHeic(buffer);
      if ('blocked' in outcome) {
        self.postMessage({ id, blocked: { reason: outcome.reason, message: outcome.message } } satisfies ScanResponse);
        return;
      }
      const scanResult: ScanResult = {
        format: 'heic',
        findings: outcome.data.findings,
        preservedInfo: {
          hasIccProfile: outcome.data.metadataContainers.some((item) => /ICC|colour|color|NCLX/i.test(item)),
          iccDescription: outcome.data.metadataContainers.find((item) => /ICC|colour|color|NCLX/i.test(item)) ?? null,
          hasTransparency: outcome.data.hasAlpha,
          dimensions: outcome.data.dimensions,
          colourChunks: outcome.data.metadataContainers.filter((item) => /ICC|colour|color|NCLX/i.test(item)),
        },
        fileName,
        fileSize,
        orientation: outcome.data.orientation,
        heic: outcome.data,
      };
      self.postMessage({ id, result: scanResult } satisfies ScanResponse);
      return;
    }

    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
      self.postMessage({
        id,
        error: `Unsupported format: ${format || 'unknown'}`,
      } satisfies ScanResponse);
      return;
    }

    const handler = imageHandlers[format];
    const scanResult = handler.scan(buffer);
    scanResult.fileName = fileName;
    scanResult.fileSize = fileSize;
    if (!scanResult.preservedInfo.dimensions) {
      self.postMessage({ id, error: MALFORMED_MESSAGE } satisfies ScanResponse);
      return;
    }
    if (dimensionsExceedPixelLimit(scanResult.preservedInfo.dimensions)) {
      self.postMessage({ id, error: RESOURCE_LIMIT_MESSAGE } satisfies ScanResponse);
      return;
    }

    self.postMessage({ id, result: scanResult } satisfies ScanResponse);
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : 'Unknown error during scanning',
    } satisfies ScanResponse);
  }
};
