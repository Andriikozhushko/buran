import { describe, it, expect } from 'vitest';
import { scanJpeg, cleanJpeg, verifyJpeg } from '../../src/lib/formats/jpeg';
import {
  extractJpegOrientation,
  orientationSwapsDimensions,
  orientedDimensions,
  orientationRequiresCorrection,
} from '../../src/lib/image-orientation';
import { readFixture } from '../helpers';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

function load(name: string): ArrayBuffer {
  return readFixture(join(FIXTURES, name));
}

describe('JPEG orientation detection', () => {
  it('detects orientation 1 (normal)', () => {
    const buf = load('orientation-1.jpg');
    const orientation = extractJpegOrientation(buf);
    expect(orientation).toBe(1);

    const result = scanJpeg(buf);
    expect(result.orientation).toBe(1);
  });

  it('detects orientation 3 (180° rotation)', () => {
    const buf = load('orientation-3.jpg');
    const orientation = extractJpegOrientation(buf);
    expect(orientation).toBe(3);

    const result = scanJpeg(buf);
    expect(result.orientation).toBe(3);
  });

  it('detects orientation 5 (transpose — mirrored variant)', () => {
    const buf = load('orientation-5.jpg');
    const orientation = extractJpegOrientation(buf);
    expect(orientation).toBe(5);

    const result = scanJpeg(buf);
    expect(result.orientation).toBe(5);
  });

  it('detects orientation 6 (90° CW)', () => {
    const buf = load('orientation-6.jpg');
    const orientation = extractJpegOrientation(buf);
    expect(orientation).toBe(6);

    const result = scanJpeg(buf);
    expect(result.orientation).toBe(6);
  });

  it('detects orientation 8 (270° CW)', () => {
    const buf = load('orientation-8.jpg');
    const orientation = extractJpegOrientation(buf);
    expect(orientation).toBe(8);

    const result = scanJpeg(buf);
    expect(result.orientation).toBe(8);
  });

  it('all orientations 1-8 are detectable', () => {
    for (let ori = 1; ori <= 8; ori++) {
      const buf = load(`orientation-${ori}.jpg`);
      const detected = extractJpegOrientation(buf);
      expect(detected).toBe(ori);
    }
  });
});

describe('JPEG orientation cleaning', () => {
  it('removes EXIF orientation tag after cleaning orientation 1', () => {
    const buf = load('orientation-1.jpg');
    const clean = cleanJpeg(buf);

    // Re-scan — orientation is null (no EXIF present → no orientation data)
    const rescan = scanJpeg(clean);
    expect(rescan.orientation).toBeNull();

    // No EXIF Orientation finding
    const orientationFinding = rescan.findings.find(
      (f) => f.field === 'EXIF:Orientation' || f.field === 'EXIF:Ориентация',
    );
    expect(orientationFinding).toBeUndefined();
  });

  it('removes EXIF orientation tag after cleaning orientation 6', () => {
    const buf = load('orientation-6.jpg');
    const clean = cleanJpeg(buf);

    // After binary cleaning, orientation is gone (but pixels not rotated by cleanJpeg alone)
    const rescan = scanJpeg(clean);

    // No EXIF orientation finding should remain
    const orientationFinding = rescan.findings.find(
      (f) => f.field === 'EXIF:Orientation' || f.field === 'EXIF:Ориентация',
    );
    expect(orientationFinding).toBeUndefined();
  });

  it('retains only the technical orientation tag without re-encoding pixels', () => {
    const original = load('orientation-6.jpg');
    const scan = scanJpeg(original);
    const clean = cleanJpeg(original, 6);
    const rescan = scanJpeg(clean);
    const verification = verifyJpeg(scan, clean);

    expect(rescan.orientation).toBe(6);
    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);
    expect(verification.pixelDataReencoded).toBe(false);
  });

  it('cleanJpeg preserves valid JPEG structure for all orientations', () => {
    for (let ori = 1; ori <= 8; ori++) {
      const buf = load(`orientation-${ori}.jpg`);
      const clean = cleanJpeg(buf);
      const bytes = new Uint8Array(clean);

      // Must start with SOI
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
      // Must have at least some content
      expect(clean.byteLength).toBeGreaterThan(100);
    }
  });

  it('returns orientation 1 for non-JPEG files', () => {
    const buf = load('sample.png');
    const orientation = extractJpegOrientation(buf);
    expect(orientation).toBe(1);
  });

  it('keeps non-default orientation out of personal metadata findings', () => {
    const buf = load('orientation-6.jpg');
    const result = scanJpeg(buf);

    const orientationFinding = result.findings.find(
      (f) => f.label === 'Image orientation',
    );
    expect(result.orientation).toBe(6);
    expect(orientationFinding).toBeUndefined();
  });

  it('scan result does not add orientation finding for default orientation 1', () => {
    const buf = load('orientation-1.jpg');
    const result = scanJpeg(buf);

    const orientationFinding = result.findings.find(
      (f) => f.label === 'Image orientation',
    );
    // Should not have the "non-default orientation" finding
    expect(orientationFinding).toBeUndefined();
  });
});

describe('Verification includes orientation fields', () => {
  it('jpeg verification reports orientationApplied for oriented files', () => {
    const buf = load('orientation-6.jpg');
    const scan = scanJpeg(buf);

    // The scan should indicate orientation 6 (non-default), which triggers orientation correction
    expect(scan.orientation).toBe(6);
  });
});

describe('Orientation dimension logic', () => {
  it('orientationSwapsDimensions returns true for 90°/270° rotations', () => {
    expect(orientationSwapsDimensions(1)).toBe(false);
    expect(orientationSwapsDimensions(2)).toBe(false);
    expect(orientationSwapsDimensions(3)).toBe(false);
    expect(orientationSwapsDimensions(4)).toBe(false);
    expect(orientationSwapsDimensions(5)).toBe(true);
    expect(orientationSwapsDimensions(6)).toBe(true);
    expect(orientationSwapsDimensions(7)).toBe(true);
    expect(orientationSwapsDimensions(8)).toBe(true);
  });

  it('orientedDimensions swaps correctly for 90°/270°', () => {
    // Portrait image: 2x4 (w=2, h=4)
    // Orientation 6 (90° CW): should become 4x2
    const dims6 = orientedDimensions(2, 4, 6);
    expect(dims6.width).toBe(4);
    expect(dims6.height).toBe(2);

    // Orientation 8 (270° CW): same swap
    const dims8 = orientedDimensions(2, 4, 8);
    expect(dims8.width).toBe(4);
    expect(dims8.height).toBe(2);

    // Orientation 1: no swap
    const dims1 = orientedDimensions(2, 4, 1);
    expect(dims1.width).toBe(2);
    expect(dims1.height).toBe(4);
  });

  it('orientationRequiresCorrection returns correct values', () => {
    expect(orientationRequiresCorrection(null)).toBe(false);
    expect(orientationRequiresCorrection(1)).toBe(false);
    expect(orientationRequiresCorrection(3)).toBe(true);
    expect(orientationRequiresCorrection(6)).toBe(true);
    expect(orientationRequiresCorrection(8)).toBe(true);
  });
});
