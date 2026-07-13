import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanPdf } from '../../src/lib/formats/pdf/scan';
import { sanitizePdf } from '../../src/lib/formats/pdf/sanitize';
import { verifyPdf } from '../../src/lib/formats/pdf/verify';
import { rawSecurityScan, detectPdfMagic } from '../../src/lib/formats/pdf/detect';
import { detectFormat } from '../../src/lib/formats/detector';
import { readFixture } from '../helpers';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');
const load = (name: string): ArrayBuffer => readFixture(join(FIXTURES, name));

/** All sentinel strings embedded in the supported fixtures. */
const SENTINELS = [
  'SENTINEL_TITLE',
  'SENTINEL_AUTHOR',
  'SENTINEL_SUBJECT',
  'SENTINEL_KEYWORD_ONE',
  'SENTINEL_CREATOR_APP',
  'SENTINEL_PRODUCER_LIB',
  'SENTINEL_CUSTOM_VALUE',
  'SENTINEL_XMP_CREATOR',
  'SENTINEL_XMP_COMPANY',
  'SENTINEL_XMP_DESCRIPTION',
  'SENTINEL_XMP_CREATORTOOL',
  'SENTINEL_XMP_CUSTOM_NS_VALUE',
  'SENTINEL_ANNOTATION_AUTHOR',
  'SENTINEL_ANNOTATION_ID',
];

function rawIncludes(buffer: ArrayBuffer, needle: string): boolean {
  return new TextDecoder('latin1').decode(new Uint8Array(buffer)).includes(needle);
}

async function expectData(name: string) {
  const result = await scanPdf(load(name));
  if ('blocked' in result) throw new Error(`${name} unexpectedly blocked: ${result.reason}`);
  return result.data;
}

describe('PDF format detection', () => {
  it('recognises the %PDF magic', () => {
    expect(detectPdfMagic(load('pdf-info.pdf'))).toBe(true);
    expect(detectFormat(load('pdf-info.pdf'))).toBe('pdf');
  });
});

describe('PDF scanner — Info dictionary', () => {
  it('finds every standard Info field and the custom property', async () => {
    const data = await expectData('pdf-info.pdf');
    const fields = data.findings.map((f) => f.field);
    expect(fields).toContain('Info:Title');
    expect(fields).toContain('Info:Author');
    expect(fields).toContain('Info:Subject');
    expect(fields).toContain('Info:Keywords');
    expect(fields).toContain('Info:Creator');
    expect(fields).toContain('Info:Producer');
    expect(fields).toContain('Info:CreationDate');
    expect(fields).toContain('Info:ModDate');
    expect(fields).toContain('Info:SENTINELCustomKey'); // custom property
    expect(fields).toContain('Trailer:ID');

    const author = data.findings.find((f) => f.field === 'Info:Author');
    expect(author?.value).toContain('SENTINEL_AUTHOR');
    expect(author?.category).toBe('pdf-author');
  });

  it('records two pages with distinct geometry', async () => {
    const data = await expectData('pdf-info.pdf');
    expect(data.info.pageCount).toBe(2);
    expect(data.info.pageGeometry[0]).toEqual({ width: 612, height: 792 });
    expect(data.info.pageGeometry[1]).toEqual({ width: 595.28, height: 841.89 });
  });
});

describe('PDF scanner — XMP', () => {
  it('extracts Dublin Core, company, creator tool, dates and custom namespaces', async () => {
    const data = await expectData('pdf-xmp.pdf');
    const fields = data.findings.map((f) => f.field);
    expect(fields).toContain('XMP:dc:creator');
    expect(fields).toContain('XMP:dc:description');
    expect(fields).toContain('XMP:Company');
    expect(fields).toContain('XMP:xmp:CreatorTool');
    expect(fields).toContain('XMP:xmp:CreateDate');
    expect(fields).toContain('XMP:custom-namespaces');

    const creator = data.findings.find((f) => f.field === 'XMP:dc:creator');
    expect(creator?.value).toBe('SENTINEL_XMP_CREATOR');
    expect(creator?.category).toBe('pdf-xmp');
  });
});

describe('PDF scanner — annotations', () => {
  it('detects the annotation author without treating body text as metadata', async () => {
    const data = await expectData('pdf-annotation.pdf');
    const annot = data.findings.find((f) => f.field === 'Annot:T');
    expect(annot).toBeDefined();
    expect(annot?.category).toBe('pdf-annotations');
    // The visible body text must NOT be reported as a metadata value.
    expect(data.findings.some((f) => f.value === 'SENTINEL_ANNOTATION_BODY_VISIBLE')).toBe(false);
  });
});

describe('PDF sanitiser + verifier', () => {
  for (const name of ['pdf-info.pdf', 'pdf-xmp.pdf', 'pdf-annotation.pdf']) {
    it(`removes all supported metadata from ${name} and verifies it`, async () => {
      const data = await expectData(name);
      const clean = await sanitizePdf(load(name));
      const v = await verifyPdf(data, clean);

      expect(v.verificationPassed).toBe(true);
      expect(v.personalMetadataRemaining).toBe(0);
      expect(v.infoDictionaryRemoved).toBe(true);
      expect(v.xmpRemoved).toBe(true);
      expect(v.annotationAuthorFieldsRemoved).toBe(true);
      expect(v.documentIdRegeneratedOrRemoved).toBe(true);
      expect(v.pageCountPreserved).toBe(true);
      expect(v.pageGeometryPreserved).toBe(true);
      expect(v.remainingUnsupportedMetadataRisk).toEqual([]);
    });
  }

  it('leaves no sentinel metadata strings in the raw output bytes', async () => {
    for (const name of ['pdf-info.pdf', 'pdf-xmp.pdf', 'pdf-annotation.pdf']) {
      const clean = await sanitizePdf(load(name));
      for (const s of SENTINELS) {
        expect(rawIncludes(clean, s), `${s} leaked in ${name}`).toBe(false);
      }
    }
  });

  it('does not stamp a BURAN/pdf-lib fingerprint into the output', async () => {
    const clean = await sanitizePdf(load('pdf-info.pdf'));
    expect(rawIncludes(clean, 'pdf-lib')).toBe(false);
    expect(rawIncludes(clean, 'BURAN')).toBe(false);
    expect(rawIncludes(clean, 'buran')).toBe(false);
  });

  it('preserves visible body content and annotation content', async () => {
    const infoClean = await sanitizePdf(load('pdf-info.pdf'));
    expect(rawIncludes(infoClean, 'SENTINEL_VISIBLE_BODY_TEXT')).toBe(true);
    const annotClean = await sanitizePdf(load('pdf-annotation.pdf'));
    expect(rawIncludes(annotClean, 'SENTINEL_ANNOTATION_BODY_VISIBLE')).toBe(true);
  });
});

describe('PDF blocking — security-sensitive and unsupported structures', () => {
  const cases: Array<[string, string]> = [
    ['pdf-signed.pdf', 'signed'],
    ['pdf-encrypted.pdf', 'encrypted'],
    ['pdf-attachment.pdf', 'attachments'],
    ['pdf-portfolio.pdf', 'portfolio'],
  ];

  for (const [name, reason] of cases) {
    it(`blocks ${name} as "${reason}" and produces no output`, async () => {
      const result = await scanPdf(load(name));
      expect('blocked' in result).toBe(true);
      if ('blocked' in result) {
        expect(result.reason).toBe(reason);
        expect(result.message.length).toBeGreaterThan(10);
      }
    });
  }

  it('rawSecurityScan flags each category directly', () => {
    expect(rawSecurityScan(load('pdf-signed.pdf'))?.reason).toBe('signed');
    expect(rawSecurityScan(load('pdf-encrypted.pdf'))?.reason).toBe('encrypted');
    expect(rawSecurityScan(load('pdf-attachment.pdf'))?.reason).toBe('attachments');
    expect(rawSecurityScan(load('pdf-portfolio.pdf'))?.reason).toBe('portfolio');
    expect(rawSecurityScan(load('pdf-info.pdf'))).toBeNull();
  });
});
