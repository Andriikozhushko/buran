import { describe, it, expect } from 'vitest';
import { scanJpeg, cleanJpeg, verifyJpeg } from '../../src/lib/formats/jpeg';
import { join } from 'node:path';
import { readFixture } from '../helpers';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

function loadFixture(name: string): ArrayBuffer {
  return readFixture(join(FIXTURES, name));
}

describe('JPEG scanner', () => {
  it('detects EXIF metadata including GPS', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    expect(result.format).toBe('jpeg');
    expect(result.findings.length).toBeGreaterThan(0);

    // GPS IFD should be detected as a container
    const gpsContainer = result.findings.find((f) => f.field === 'EXIF:GPS IFD pointer');
    expect(gpsContainer).toBeDefined();
    expect(gpsContainer!.severity).toBe('high');
  });

  it('detects camera/device info', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    const make = result.findings.find((f) => f.field === 'EXIF:Camera manufacturer');
    expect(make).toBeDefined();
    expect(make!.value).toBe('Apple');

    const model = result.findings.find((f) => f.field === 'EXIF:Camera model');
    expect(model).toBeDefined();
    expect(model!.value).toContain('iPhone');
  });

  it('detects author/copyright', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    const artist = result.findings.find((f) => f.field === 'EXIF:Artist');
    expect(artist).toBeDefined();
    expect(artist!.value).toBe('Test Photographer');

    const copyright = result.findings.find((f) => f.field === 'EXIF:Copyright');
    expect(copyright).toBeDefined();
    expect(copyright!.value).toContain('Copyright');
  });

  it('detects XMP metadata', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    const xmp = result.findings.find((f) => f.field === 'XMP');
    expect(xmp).toBeDefined();
    expect(xmp!.category).toBe('containers');
  });

  it('detects IPTC metadata', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    const iptc = result.findings.find((f) => f.field === 'IPTC');
    expect(iptc).toBeDefined();
  });

  it('detects comment segment', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    const comment = result.findings.find((f) => f.field === 'JPEG:Comment');
    expect(comment).toBeDefined();
    expect(comment!.value).toContain('BURAN');
  });

  it('detects ICC profile in preserved info', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    expect(result.preservedInfo.hasIccProfile).toBe(true);
    expect(result.preservedInfo.colourChunks).toContain('ICC Profile (APP2)');
  });

  it('detects image dimensions', () => {
    const buffer = loadFixture('sample.jpg');
    const result = scanJpeg(buffer);

    expect(result.preservedInfo.dimensions).toBeDefined();
    expect(result.preservedInfo.dimensions!.width).toBe(2);
    expect(result.preservedInfo.dimensions!.height).toBe(2);
  });
});

describe('JPEG cleaner', () => {
  it('removes personal metadata', () => {
    const buffer = loadFixture('sample.jpg');
    const scanBefore = scanJpeg(buffer);
    const personalBefore = scanBefore.findings.filter(
      (f) => !['EXIF:ICC цветовой профиль'].includes(f.field),
    ).length;
    expect(personalBefore).toBeGreaterThan(0);

    const cleanBuffer = cleanJpeg(buffer);
    const scanAfter = scanJpeg(cleanBuffer);
    const personalAfter = scanAfter.findings.filter(
      (f) => !['EXIF:ICC цветовой профиль'].includes(f.field),
    ).length;

    // After cleaning, there should be fewer or no personal metadata findings
    expect(personalAfter).toBeLessThan(personalBefore);
  });

  it('preserves ICC profile', () => {
    const buffer = loadFixture('sample.jpg');
    const cleanBuffer = cleanJpeg(buffer);
    const scanAfter = scanJpeg(cleanBuffer);

    expect(scanAfter.preservedInfo.hasIccProfile).toBe(true);
  });

  it('preserves valid JPEG structure', () => {
    const buffer = loadFixture('sample.jpg');
    const cleanBuffer = cleanJpeg(buffer);
    const bytes = new Uint8Array(cleanBuffer);

    // JPEG must start with SOI (FF D8 FF)
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    expect(bytes[2]).toBe(0xff);
  });
});

describe('JPEG verifier', () => {
  it('passes verification on clean output', () => {
    const buffer = loadFixture('sample.jpg');
    const scan = scanJpeg(buffer);
    const cleanBuffer = cleanJpeg(buffer);
    const verification = verifyJpeg(scan, cleanBuffer);

    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);
    expect(verification.processedLocally).toBe(true);
  });

  it('reports technical data preserved', () => {
    const buffer = loadFixture('sample.jpg');
    const scan = scanJpeg(buffer);
    const cleanBuffer = cleanJpeg(buffer);
    const verification = verifyJpeg(scan, cleanBuffer);

    expect(verification.technicalDataPreserved.length).toBeGreaterThan(0);
  });
});
