/**
 * Clean Worker — runs metadata sanitisation and verification off the main thread.
 *
 * Receives: { id: string, buffer: ArrayBuffer, scanResult: ScanResult }
 * Returns:  { id, cleanBuffer?, verification?, error? }
 */

import { cleanJpeg, jpegHandler } from '../lib/formats/jpeg';
import { pngHandler } from '../lib/formats/png';
import { webpHandler } from '../lib/formats/webp';
import type { PdfScanData } from '../lib/formats/pdf/types';
import type { ScanResult, VerificationResult } from '../lib/formats/types';

const imageHandlers = {
  jpeg: jpegHandler,
  png: pngHandler,
  webp: webpHandler,
};

interface CleanRequest {
  id: string;
  buffer: ArrayBuffer;
  scanResult: ScanResult;
  preserveJpegOrientation?: boolean;
}

interface CleanResponse {
  id: string;
  cleanBuffer?: ArrayBuffer;
  verification?: VerificationResult;
  error?: string;
}

self.onmessage = async (event: MessageEvent<CleanRequest>) => {
  const { id, buffer, scanResult, preserveJpegOrientation } = event.data;

  try {
    if (scanResult.format === 'pdf') {
      const { sanitizePdf, verifyPdf } = await import('../lib/formats/pdf');
      if (!scanResult.pdf) {
        self.postMessage({ id, error: 'Отсутствуют данные сканирования PDF.' } satisfies CleanResponse);
        return;
      }

      const cleanBuffer = await sanitizePdf(buffer);

      // Reconstruct the independent scan data for the verification pass.
      const originalData: PdfScanData = {
        findings: scanResult.findings,
        info: {
          pageCount: scanResult.pdf.pageCount,
          pageGeometry: scanResult.pdf.pageGeometry,
          hasAnnotations: scanResult.pdf.hasAnnotations,
          hasOutlines: scanResult.pdf.hasOutlines,
          hasAcroForm: scanResult.pdf.hasAcroForm,
        },
        rawMetadataValues: scanResult.pdf.rawMetadataValues,
        unsupportedMetadataRisk: scanResult.pdf.unsupportedMetadataRisk,
      };

      const pv = await verifyPdf(originalData, cleanBuffer);

      const verification: VerificationResult = {
        passed: pv.verificationPassed,
        metadataFoundBefore: pv.metadataFoundBefore,
        metadataRemaining: pv.personalMetadataRemaining,
        technicalDataPreserved: [
          `Страниц: ${scanResult.pdf.pageCount}`,
          'Структура документа: проверена',
        ],
        cleanHash: '',
        processedLocally: true,
        limitations: pv.remainingUnsupportedMetadataRisk,
        orientationApplied: false,
        pixelDataReencoded: false,
        remainingUnsupportedMetadataRisk:
          pv.remainingUnsupportedMetadataRisk.length > 0
            ? pv.remainingUnsupportedMetadataRisk.join('; ')
            : '',
        pdf: pv,
      };

      self.postMessage({ id, cleanBuffer, verification } satisfies CleanResponse, {
        transfer: [cleanBuffer],
      });
      return;
    }

    if (scanResult.format === 'docx' || scanResult.format === 'xlsx' || scanResult.format === 'pptx') {
      const { sanitizeOffice, verifyOffice } = await import('../lib/formats/office');
      if (!scanResult.office) {
        self.postMessage({ id, error: 'Отсутствуют данные сканирования Office.' } satisfies CleanResponse);
        return;
      }

      const cleanBuffer = await sanitizeOffice(buffer);
      const ov = await verifyOffice(scanResult.office, cleanBuffer);

      const verification: VerificationResult = {
        passed: ov.verificationPassed,
        metadataFoundBefore: ov.metadataFoundBefore,
        metadataRemaining: ov.personalMetadataRemaining,
        technicalDataPreserved: [
          'Структура Office-документа: проверена',
          `Встроенные изображения: ${ov.embeddedImagesVerified} проверены`,
        ],
        cleanHash: '',
        processedLocally: true,
        limitations: ov.remainingUnsupportedMetadataRisk,
        orientationApplied: false,
        pixelDataReencoded: false,
        remainingUnsupportedMetadataRisk:
          ov.remainingUnsupportedMetadataRisk.length > 0
            ? ov.remainingUnsupportedMetadataRisk.join('; ')
            : '',
        office: ov,
      };

      self.postMessage({ id, cleanBuffer, verification } satisfies CleanResponse, {
        transfer: [cleanBuffer],
      });
      return;
    }

    if (scanResult.format === 'zip') {
      const { sanitizeZip, verifyZip } = await import('../lib/formats/zip');
      if (!scanResult.zip) {
        self.postMessage({ id, error: 'Отсутствуют данные сканирования ZIP.' } satisfies CleanResponse);
        return;
      }
      const cleanOutcome = await sanitizeZip(buffer, scanResult.zip);
      if ('blocked' in cleanOutcome) {
        self.postMessage({ id, error: cleanOutcome.entryPath ? `${cleanOutcome.message} (${cleanOutcome.entryPath})` : cleanOutcome.message } satisfies CleanResponse);
        return;
      }
      const zv = await verifyZip(buffer, scanResult.zip, cleanOutcome);
      if (!zv.verificationPassed) {
        self.postMessage({ id, error: 'ZIP-архив не прошёл независимую проверку. Очищенная копия не создана.' } satisfies CleanResponse);
        return;
      }
      const verification: VerificationResult = {
        passed: zv.verificationPassed,
        metadataFoundBefore: scanResult.findings.length,
        metadataRemaining: 0,
        technicalDataPreserved: [
          'Структура архива: проверена',
          `Поддерживаемые файлы: ${zv.supportedEntriesVerified} проверены`,
          `Неподдерживаемые файлы: ${zv.unsupportedEntriesUnchanged} сохранены без изменений`,
        ],
        cleanHash: '',
        processedLocally: true,
        limitations: zv.remainingUnsupportedMetadataRisk,
        orientationApplied: false,
        pixelDataReencoded: false,
        remainingUnsupportedMetadataRisk: zv.remainingUnsupportedMetadataRisk.join('; '),
        zip: zv,
      };
      self.postMessage({ id, cleanBuffer: cleanOutcome, verification } satisfies CleanResponse, {
        transfer: [cleanOutcome],
      });
      return;
    }

    if (scanResult.format === 'heic') {
      if (!scanResult.heic) {
        self.postMessage({ id, error: 'Отсутствуют данные сканирования HEIC/HEIF.' } satisfies CleanResponse);
        return;
      }
      const { sanitizeHeic, verifyHeicExport } = await import('../lib/formats/heic');
      const cleanOutcome = await sanitizeHeic(buffer, scanResult.heic);
      if ('blocked' in cleanOutcome) {
        self.postMessage({ id, error: cleanOutcome.message } satisfies CleanResponse);
        return;
      }
      const hv = verifyHeicExport(scanResult.heic, cleanOutcome);
      if (!hv.outputVerificationPassed) {
        self.postMessage({ id, error: 'HEIC/HEIF экспорт не прошёл независимую проверку. Очищенная копия не создана.' } satisfies CleanResponse);
        return;
      }
      const verification: VerificationResult = {
        passed: hv.outputVerificationPassed,
        metadataFoundBefore: scanResult.findings.length,
        metadataRemaining: 0,
        technicalDataPreserved: [
          `Экспорт: ${hv.exportedFormat === 'png' ? 'PNG' : 'JPEG'}`,
          `Размеры: ${cleanOutcome.width}×${cleanOutcome.height}`,
          hv.colourHandling,
        ],
        cleanHash: '',
        processedLocally: true,
        limitations: hv.remainingUnsupportedMetadataRisk,
        orientationApplied: hv.orientationApplied,
        pixelDataReencoded: true,
        remainingUnsupportedMetadataRisk: hv.remainingUnsupportedMetadataRisk.join('; '),
        heic: hv,
      };
      self.postMessage({ id, cleanBuffer: cleanOutcome.buffer, verification } satisfies CleanResponse, {
        transfer: [cleanOutcome.buffer],
      });
      return;
    }

    if (scanResult.format !== 'jpeg' && scanResult.format !== 'png' && scanResult.format !== 'webp') {
      self.postMessage({ id, error: `No handler for format: ${scanResult.format}` } satisfies CleanResponse);
      return;
    }

    const handler = imageHandlers[scanResult.format];
    const cleanBuffer =
      scanResult.format === 'jpeg' && preserveJpegOrientation
        ? cleanJpeg(buffer, scanResult.orientation ?? undefined)
        : handler.clean(buffer);
    const verification = handler.verify(scanResult, cleanBuffer);

    self.postMessage({ id, cleanBuffer, verification } satisfies CleanResponse, {
      transfer: [cleanBuffer],
    });
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : 'Unknown error during cleaning',
    } satisfies CleanResponse);
  }
};
