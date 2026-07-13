/**
 * Independent post-sanitisation verification for PDFs.
 *
 * This pass deliberately does NOT trust the sanitiser. It re-parses the cleaned
 * output from scratch with pdf-lib, re-runs the scanner over it, and
 * additionally scans the raw output bytes for the original metadata sentinels.
 * `verificationPassed` is only true when every supported metadata surface is
 * proven absent and the document's structure is preserved.
 */

import { PDFDocument, PDFDict, PDFName, PDFRawStream } from 'pdf-lib';
import type { PdfScanData, PdfVerification } from './types';
import { scanPdf } from './scan';

/** Decode bytes as latin1 for substring scanning of the raw output. */
function rawText(buffer: ArrayBuffer): string {
  return new TextDecoder('latin1').decode(new Uint8Array(buffer));
}

function geometryEqual(
  a: PdfScanData['info']['pageGeometry'],
  b: PdfScanData['info']['pageGeometry'],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].width - b[i].width) > 0.5) return false;
    if (Math.abs(a[i].height - b[i].height) > 0.5) return false;
  }
  return true;
}

export async function verifyPdf(
  original: PdfScanData,
  cleanBuffer: ArrayBuffer,
): Promise<PdfVerification> {
  const metadataFoundBefore = original.findings.length;
  const risk = [...original.unsupportedMetadataRisk];

  // 1. Document must still be parseable.
  let doc: PDFDocument;
  let rescan: Awaited<ReturnType<typeof scanPdf>>;
  try {
    doc = await PDFDocument.load(cleanBuffer, { updateMetadata: false });
    rescan = await scanPdf(cleanBuffer);
  } catch {
    return failVerification(metadataFoundBefore, original, ['Очищенный файл не удалось разобрать.']);
  }

  if ('blocked' in rescan) {
    return failVerification(metadataFoundBefore, original, [
      'Очищенный файл неожиданно попал в заблокированную категорию при повторной проверке.',
    ]);
  }

  const after = rescan.data;

  // 2. Structured absence checks against the fresh re-scan.
  const infoDictionaryRemoved =
    !doc.context.trailerInfo.Info && !after.findings.some((f) => f.field.startsWith('Info:'));

  const catalogHasMetadata = doc.catalog.has(PDFName.of('Metadata'));
  const anyObjectMetadata = (() => {
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Metadata'))) return true;
      if (obj instanceof PDFRawStream) {
        const sub = obj.dict.get(PDFName.of('Type'));
        if (sub instanceof PDFName && sub.decodeText() === 'Metadata') return true;
      }
    }
    return false;
  })();

  // 3. Raw-byte sentinel scan: no XMP packet markers, no original values.
  const raw = rawText(cleanBuffer);
  const xmpResidue = /<\?xpacket|<x:xmpmeta|rdf:RDF/i.test(raw);
  const xmpRemoved =
    !catalogHasMetadata && !anyObjectMetadata && !xmpResidue &&
    !after.findings.some((f) => f.category === 'pdf-xmp');

  const annotationAuthorFieldsRemoved = !after.findings.some((f) => f.field === 'Annot:T');

  const documentIdRegeneratedOrRemoved = !!doc.context.trailerInfo.ID;

  const pageCountPreserved = after.info.pageCount === original.info.pageCount;
  const pageGeometryPreserved = geometryEqual(after.info.pageGeometry, original.info.pageGeometry);

  // Sentinel strings from the original metadata must not survive in raw bytes.
  const leakedSentinels: string[] = [];
  for (const value of original.rawMetadataValues) {
    if (value.length >= 4 && raw.includes(value)) {
      leakedSentinels.push(value);
    }
  }
  if (leakedSentinels.length > 0) {
    risk.push('В выходных байтах остались исходные значения метаданных.');
  }

  // Personal metadata still detected (the regenerated random /ID is expected
  // and excluded — it carries no personal information).
  const personalMetadataRemaining = after.findings.filter(
    (f) => f.category !== 'pdf-identifiers',
  ).length;

  const verificationPassed =
    infoDictionaryRemoved &&
    xmpRemoved &&
    annotationAuthorFieldsRemoved &&
    documentIdRegeneratedOrRemoved &&
    pageCountPreserved &&
    pageGeometryPreserved &&
    personalMetadataRemaining === 0 &&
    leakedSentinels.length === 0;

  return {
    metadataFoundBefore,
    personalMetadataRemaining,
    infoDictionaryRemoved,
    xmpRemoved,
    annotationAuthorFieldsRemoved,
    documentIdRegeneratedOrRemoved,
    pageCountPreserved,
    pageGeometryPreserved,
    verificationPassed,
    remainingUnsupportedMetadataRisk: risk,
  };
}

function failVerification(
  metadataFoundBefore: number,
  original: PdfScanData,
  extraRisk: string[],
): PdfVerification {
  return {
    metadataFoundBefore,
    personalMetadataRemaining: metadataFoundBefore,
    infoDictionaryRemoved: false,
    xmpRemoved: false,
    annotationAuthorFieldsRemoved: false,
    documentIdRegeneratedOrRemoved: false,
    pageCountPreserved: false,
    pageGeometryPreserved: false,
    verificationPassed: false,
    remainingUnsupportedMetadataRisk: [...original.unsupportedMetadataRisk, ...extraRisk],
  };
}
