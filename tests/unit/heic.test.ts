import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { detectFormat } from '../../src/lib/formats/detector';
import { preflightHeic } from '../../src/lib/formats/heic/preflight';
import { scanHeic } from '../../src/lib/formats/heic/scan';
import { validateFile } from '../../src/lib/validation';
import { readFixture } from '../helpers';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

describe('HEIC/HEIF detection and preflight', () => {
  it('detects HEIC by content even with a misleading extension', async () => {
    const buffer = readFixture(join(FIXTURES, 'sample.heic'));
    expect(detectFormat(buffer)).toBe('heic');
    const file = new File([buffer], 'misleading.jpg', { type: 'image/jpeg' });
    const validation = await validateFile(file);
    expect(validation.valid).toBe(true);
    if (validation.valid) expect(validation.format).toBe('heic');
  });

  it('preflights a valid still HEIC without decoding pixels', () => {
    const result = preflightHeic(readFixture(join(FIXTURES, 'sample.heic')));
    expect('blocked' in result).toBe(false);
    if ('blocked' in result) return;
    expect(result.brands).toContain('heic');
    expect(result.dimensions?.width).toBeGreaterThan(0);
    expect(result.dimensions?.height).toBeGreaterThan(0);
    expect(result.outputFormat).toMatch(/jpeg|png/);
  });

  it('reports metadata containers honestly without inventing values', async () => {
    const result = await scanHeic(readFixture(join(FIXTURES, 'sample.heic')));
    expect('blocked' in result).toBe(false);
    if ('blocked' in result) return;
    expect(result.data.findings.every((finding) => !/\p{Cc}/u.test(finding.value ?? ''))).toBe(true);
    expect(result.data.unsupportedMetadataRisk.join(' ')).toContain('экспорт');
  });

  it('blocks sequence-style HEIF brands before decode', () => {
    const result = preflightHeic(makeFtyp(['msf1', 'heic', 'mif1']));
    expect('blocked' in result).toBe(true);
    if ('blocked' in result) expect(result.reason).toBe('animation');
  });

  it('blocks malformed ISO-BMFF boxes', () => {
    const result = preflightHeic(new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]).buffer);
    expect('blocked' in result).toBe(true);
  });
});

function makeFtyp(brands: string[]): ArrayBuffer {
  const size = 16 + Math.max(0, brands.length - 1) * 4;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size);
  bytes.set(ascii('ftyp'), 4);
  bytes.set(ascii(brands[0] ?? 'heic'), 8);
  view.setUint32(12, 0);
  let offset = 16;
  for (const brand of brands.slice(1)) {
    bytes.set(ascii(brand), offset);
    offset += 4;
  }
  return bytes.buffer;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value.padEnd(4, ' ').slice(0, 4));
}
