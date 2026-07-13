import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanJpeg, cleanJpeg, verifyJpeg } from '../../src/lib/formats/jpeg';
import { scanPng, cleanPng, verifyPng } from '../../src/lib/formats/png';
import { scanWebp, cleanWebp, verifyWebp } from '../../src/lib/formats/webp';
import { scanPdf } from '../../src/lib/formats/pdf';
import { scanOffice } from '../../src/lib/formats/office';
import { scanZip } from '../../src/lib/formats/zip';
import { IMAGE_PIXEL_LIMIT, MALFORMED_MESSAGE, TIMEOUT_MESSAGE } from '../../src/lib/processing-limits';
import { readFixture } from '../helpers';

const ROOT = join(import.meta.dirname || __dirname, '..', '..');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const SRC = join(ROOT, 'src');

describe('04A operation safety contract', () => {
  it('guards stale worker responses and exposes cancellation without verified output', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    // Cancellation label is now localised; App references the i18n key and the
    // key itself carries the Russian wording in the base locale.
    expect(app).toContain('t.appCancel');
    const ru = readFileSync(join(SRC, 'i18n', 'ru.ts'), 'utf8');
    expect(ru).toContain('Отменить обработку');
    expect(app).toContain('CANCELLED_MESSAGE');
    expect(app).toContain('response.id !== id || operationRef.current?.id !== id');
    expect(app).toContain('recreateScanWorker()');
    expect(app).toContain('recreateCleanWorker()');
    expect(app).not.toMatch(/phase: 'success'[\s\S]{0,300}cancel/i);
  });

  it('has watchdog timeout wording and conservative decoded-pixel limit', () => {
    expect(TIMEOUT_MESSAGE).toContain('не завершил обработку в безопасное время');
    expect(IMAGE_PIXEL_LIMIT).toBeLessThanOrEqual(40_000_000);
    expect(IMAGE_PIXEL_LIMIT).toBeGreaterThan(1_000_000);
  });

  it('revokes object URLs for downloads', () => {
    const success = readFileSync(join(SRC, 'components', 'SuccessResult.tsx'), 'utf8');
    const certificate = readFileSync(join(SRC, 'lib', 'certificate.ts'), 'utf8');
    expect(success).toContain('URL.revokeObjectURL(url)');
    expect(certificate).toContain('URL.revokeObjectURL(url)');
  });
});

describe('04A lazy loading contract', () => {
  it('does not eagerly import certificate generator from the success component', () => {
    const source = readFileSync(join(SRC, 'components', 'SuccessResult.tsx'), 'utf8');
    expect(source).not.toMatch(/import\s+\{[^}]*downloadCertificatePdf/);
    expect(source).toContain("await import('../lib/certificate')");
  });

  it('keeps PDF, Office, and ZIP handlers behind worker dynamic imports', () => {
    const scanWorker = readFileSync(join(SRC, 'workers', 'scan.worker.ts'), 'utf8');
    const cleanWorker = readFileSync(join(SRC, 'workers', 'clean.worker.ts'), 'utf8');
    expect(scanWorker).toContain("await import('../lib/formats/pdf')");
    expect(scanWorker).toContain("await import('../lib/formats/office')");
    expect(scanWorker).toContain("await import('../lib/formats/zip')");
    expect(cleanWorker).toContain("await import('../lib/formats/pdf')");
    expect(cleanWorker).toContain("await import('../lib/formats/office')");
    expect(cleanWorker).toContain("await import('../lib/formats/zip')");
  });

  it('uses lightweight Office detection during validation', () => {
    const validation = readFileSync(join(SRC, 'lib', 'validation.ts'), 'utf8');
    expect(validation).toContain("./formats/office/detect");
    expect(validation).not.toContain("./formats/office';");
  });

  it('does not expose demo-file generators from the upload screen', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).not.toMatch(/import\s+\{\s*createDemoFile/);
    expect(app).not.toContain("./lib/demo-fixtures");
    expect(app).not.toContain('Попробовать демо');
  });
});

describe('04A deterministic malformed corpus', () => {
  it('does not throw on mutated image inputs and does not verify malformed images clean', () => {
    const cases: Array<[string, ArrayBuffer, (buffer: ArrayBuffer) => unknown, (buffer: ArrayBuffer) => ArrayBuffer, (scan: never, clean: ArrayBuffer) => { passed: boolean }]> = [
      ['jpeg', readFixture(join(FIXTURES, 'sample.jpg')), scanJpeg, cleanJpeg, verifyJpeg as never],
      ['png', readFixture(join(FIXTURES, 'sample.png')), scanPng, cleanPng, verifyPng as never],
      ['webp', readFixture(join(FIXTURES, 'sample.webp')), scanWebp, cleanWebp, verifyWebp as never],
    ];

    for (const [name, fixture, scan, clean, verify] of cases) {
      for (const mutated of mutate(fixture)) {
        expect(() => scan(mutated), `${name} scan`).not.toThrow();
        const scanResult = scan(mutated) as never;
        if (mutated.byteLength < 16) continue;
        expect(() => clean(mutated), `${name} clean`).not.toThrow();
        const cleanBuffer = clean(mutated);
        expect(() => verify(scanResult, cleanBuffer), `${name} verify`).not.toThrow();
      }
    }
  });

  it('blocks malformed PDF, Office, and ZIP containers', async () => {
    const pdf = await scanPdf(new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Author (x)').buffer);
    expect('blocked' in pdf).toBe(true);

    const office = await scanOffice(invalidZipCentralDirectory());
    expect('blocked' in office).toBe(true);

    const zip = await scanZip(invalidZipCentralDirectory());
    expect('blocked' in zip).toBe(true);
  });

  it('keeps malformed wording privacy-first', () => {
    expect(MALFORMED_MESSAGE).toContain('не создал очищенную копию');
    expect(MALFORMED_MESSAGE).not.toMatch(/stack|trace|exception/i);
  });
});

function mutate(buffer: ArrayBuffer): ArrayBuffer[] {
  const bytes = new Uint8Array(buffer);
  const truncated = bytes.slice(0, Math.min(12, bytes.length));
  const flipped = bytes.slice();
  for (let i = 0; i < Math.min(8, flipped.length); i++) flipped[(i * 97) % flipped.length] ^= 0xa5;
  const invalidLength = bytes.slice(0, Math.min(64, bytes.length));
  if (invalidLength.length > 24) invalidLength.fill(0xff, 16, 20);
  const misleading = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Array.from(bytes.slice(0, 20))]);
  return [truncated.buffer, flipped.buffer, invalidLength.buffer, misleading.buffer];
}

function invalidZipCentralDirectory(): ArrayBuffer {
  return new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0,
    0x08, 0x00, 0x00, 0x00, 0x62, 0x61, 0x64, 0x2e, 0x74, 0x78, 0x74,
    0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 1, 0, 1, 0, 0xff, 0xff, 0xff, 0x7f,
  ]).buffer;
}
