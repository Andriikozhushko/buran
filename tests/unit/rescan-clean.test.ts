/**
 * Systemic regression net for the honest-scan principle: a file BURAN has
 * just cleaned, when dropped back in, must scan as CLEAN — zero personal
 * findings, so the UI shows "nothing found" instead of promising to remove
 * things that are already gone (or that only exist because BURAN wrote a
 * neutral placeholder there).
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readFixture } from '../helpers';
import { personalFindingCount } from '../../src/lib/formats/types';
import { jpegHandler } from '../../src/lib/formats/jpeg';
import { pngHandler } from '../../src/lib/formats/png';
import { webpHandler } from '../../src/lib/formats/webp';
import { scanPdf } from '../../src/lib/formats/pdf/scan';
import { sanitizePdf } from '../../src/lib/formats/pdf/sanitize';
import { scanOffice } from '../../src/lib/formats/office/scan';
import { sanitizeOffice } from '../../src/lib/formats/office/sanitize';
import { scanZip } from '../../src/lib/formats/zip/scan';
import { sanitizeZip } from '../../src/lib/formats/zip/sanitize';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');
const load = (name: string): ArrayBuffer => readFixture(join(FIXTURES, name));

describe('cleaned files re-scan as clean', () => {
  const imageHandlers = [
    ['sample.jpg', jpegHandler],
    ['orientation-6.jpg', jpegHandler],
    ['sample.png', pngHandler],
    ['sample.webp', webpHandler],
  ] as const;

  for (const [fixture, handler] of imageHandlers) {
    it(`${fixture}: clean → re-scan → zero personal findings`, () => {
      const clean = handler.clean(load(fixture));
      const rescan = handler.scan(clean);
      expect(personalFindingCount(rescan.findings)).toBe(0);
    });
  }

  for (const fixture of ['pdf-info.pdf', 'pdf-xmp.pdf', 'pdf-annotation.pdf']) {
    it(`${fixture}: clean → re-scan → zero findings`, async () => {
      const clean = await sanitizePdf(load(fixture));
      const rescan = await scanPdf(clean);
      if ('blocked' in rescan) throw new Error(`${fixture}: cleaned PDF unexpectedly blocked`);
      expect(rescan.data.findings).toEqual([]);
    });
  }

  for (const fixture of ['office-sample.docx', 'office-sample.xlsx', 'office-sample.pptx', 'office-customxml.docx']) {
    it(`${fixture}: clean → re-scan → zero personal findings`, async () => {
      const clean = await sanitizeOffice(load(fixture));
      const rescan = await scanOffice(clean);
      if ('blocked' in rescan) throw new Error(`${fixture}: cleaned package unexpectedly blocked`);
      expect(personalFindingCount(rescan.data.findings)).toBe(0);
    });
  }

  it('zip archive: clean → re-scan → zero personal findings', async () => {
    const zip = new JSZip();
    zip.file('photo.jpg', new Uint8Array(load('sample.jpg')), { date: new Date('2024-05-06T12:34:00Z') });
    zip.file('image.png', new Uint8Array(load('sample.png')), { date: new Date('2023-01-01T00:00:00Z') });
    zip.file('notes.txt', 'plain text', { date: new Date('2022-02-02T02:02:02Z') });
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment: 'PRIVATE_COMMENT' });
    const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const scan = await scanZip(input);
    if ('blocked' in scan) throw new Error(scan.message);
    expect(personalFindingCount(scan.data.findings)).toBeGreaterThan(0);

    const clean = await sanitizeZip(input, scan.data);
    if ('blocked' in clean) throw new Error('cleaned archive unexpectedly blocked');

    const rescan = await scanZip(clean);
    if ('blocked' in rescan) throw new Error('cleaned archive unexpectedly blocked on re-scan');
    expect(personalFindingCount(rescan.data.findings)).toBe(0);
    expect(rescan.data.supportedEntries.every((e) => e.findingsCount === 0)).toBe(true);
  });
});
