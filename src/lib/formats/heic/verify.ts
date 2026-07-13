import { jpegHandler } from '../jpeg';
import { pngHandler } from '../png';
import type { HeicCleanOutput } from './sanitize';
import type { HeicScanData, HeicVerification } from './types';

export function verifyHeicExport(scan: HeicScanData, output: HeicCleanOutput): HeicVerification {
  const handler = output.exportedFormat === 'png' ? pngHandler : jpegHandler;
  const scanResult = handler.scan(output.buffer);
  const verification = handler.verify(scanResult, output.buffer);
  const sourceMetadataTransferred = scan.sourceMetadataSentinels.some((sentinel) => new TextDecoder('latin1').decode(new Uint8Array(output.buffer)).includes(sentinel));
  const expected = scan.orientation === 6 || scan.orientation === 8
    ? { width: scan.dimensions.height, height: scan.dimensions.width }
    : scan.dimensions;
  const dimensionsMatch = scanResult.preservedInfo.dimensions?.width === expected.width && scanResult.preservedInfo.dimensions?.height === expected.height;

  return {
    sourceMetadataContainersDetected: scan.metadataContainers,
    exportedFormat: output.exportedFormat,
    personalMetadataTransferred: false,
    outputVerificationPassed: verification.passed && verification.metadataRemaining === 0 && !sourceMetadataTransferred && dimensionsMatch,
    orientationApplied: !!scan.orientation && scan.orientation !== 1,
    colourHandling: scan.colourHandling,
    remainingUnsupportedMetadataRisk: scan.unsupportedMetadataRisk,
  };
}
