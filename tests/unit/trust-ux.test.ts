import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildTrustResult, buildSuccessBeforeAfter } from '../../src/lib/trust-result';
import { generateCertificatePdfBytes, certificatePdfFilename } from '../../src/lib/certificate';
import type { ScanResult, VerificationResult } from '../../src/lib/formats/types';
import ru from '../../src/i18n/ru';
import type { Strings } from '../../src/i18n';

const t = ru as Strings;

const baseScan: ScanResult = {
  format: 'png',
  findings: [],
  preservedInfo: { hasIccProfile: false, iccDescription: null, hasTransparency: true, dimensions: { width: 1, height: 1 }, colourChunks: [] },
  fileName: 'demo.png',
  fileSize: 1024,
  orientation: null,
};

const baseVerification: VerificationResult = {
  passed: true,
  metadataFoundBefore: 0,
  metadataRemaining: 0,
  technicalDataPreserved: [],
  cleanHash: 'abc123',
  processedLocally: true,
  limitations: [],
  orientationApplied: false,
  pixelDataReencoded: false,
  remainingUnsupportedMetadataRisk: null,
};

describe('trust UX wording model', () => {
  it('uses honest no-metadata wording', () => {
    const model = buildTrustResult(baseScan, t);
    expect(model.summaryTitle).toContain('не найдено');
    expect(model.summaryText).toContain('очистка не нужна');
  });

  it('mentions Office Anonymous placeholder honestly', () => {
    const model = buildTrustResult({ ...baseScan, format: 'docx' }, t);
    expect(model.limitations.join(' ')).toContain('Anonymous');
  });

  it('marks ZIP with unsupported files as partially supported', () => {
    const model = buildTrustResult({
      ...baseScan,
      format: 'zip',
      zip: {
        findings: [],
        totalEntries: 2,
        totalFiles: 2,
        uncompressedSize: 10,
        supportedEntries: [],
        unsupportedEntries: [{ path: 'app.exe', extension: 'exe', size: 4, status: 'unchanged', message: 'x', nestedDepth: 0 }],
        nestedArchiveCount: 0,
        containerMetadata: { entryTimestamps: 2, unixPermissionFields: 0, externalAttributeFields: 0, extraFields: 0, archiveCommentFound: false, hostPlatformFields: 0 },
        rawMetadataValues: [],
        unsupportedMetadataRisk: ['unsupported'],
      },
    }, t);
    expect(model.supportState).toBe('partially-supported');
    expect(model.limitations.join(' ')).toContain('Неподдерживаемые файлы');
  });

  it('builds before/after comparison for verification failure without claiming success', () => {
    const comparison = buildSuccessBeforeAfter(baseScan, { ...baseVerification, passed: false, metadataFoundBefore: 3, metadataRemaining: 1 }, t);
    expect(comparison.after[0]).toContain('1');
  });
});

describe('certificate PDF generation', () => {
  it('uses deterministic generic filename', () => {
    expect(certificatePdfFilename()).toBe('buran-clean-certificate.pdf');
  });

  it('generates local PDF bytes without private values', async () => {
    const bytes = await generateCertificatePdfBytes({
      locale: 'ru',
      fileType: 'JPEG',
      scanDateTime: '26 июня 2026 г., 15:30',
      metadataFound: 2,
      metadataRemoved: 2,
      metadataRemaining: 0,
      verificationPassed: true,
      colourProfile: null,
      cleanHash: 'cleanhash',
      shortHash: 'cleanhash',
      processedLocally: true,
      orientationApplied: false,
      pixelDataReencoded: false,
      pdfPages: null,
      pdfStructureVerified: null,
      office: null,
      zip: null,
      heic: null,
    }, t);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('/ToUnicode');
    expect(text).toContain('Roboto');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getSubject()).toBe('Сертификат локальной очистки метаданных');
    expect(text).not.toContain('49.4521');
    expect(text).not.toContain('DEMO_FAKE_AUTHOR');
    expect(text).not.toContain('demo.png');
  }, 15_000);
});
