import { describe, it, expect } from 'vitest';
import { scanPng, cleanPng, verifyPng } from '../../src/lib/formats/png';
import { join } from 'node:path';
import { readFixture } from '../helpers';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

function loadFixture(name: string): ArrayBuffer {
  return readFixture(join(FIXTURES, name));
}

describe('PNG scanner', () => {
  it('detects eXIf chunk', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    expect(result.format).toBe('png');

    const exif = result.findings.find((f) => f.field === 'PNG:eXIf');
    expect(exif).toBeDefined();
    expect(exif!.severity).toBe('high');
  });

  it('detects textual metadata (tEXt chunks)', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    const author = result.findings.find((f) => f.field === 'PNG:tEXt:Author');
    expect(author).toBeDefined();
    expect(author!.value).toContain('Photographer');

    const software = result.findings.find((f) => f.field === 'PNG:tEXt:Software');
    expect(software).toBeDefined();
    expect(software!.value).toContain('Photoshop');
  });

  it('detects compressed text metadata (zTXt)', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    const ztxt = result.findings.find((f) => f.field === 'PNG:zTXt:Copyright');
    expect(ztxt).toBeDefined();
  });

  it('detects international text metadata (iTXt)', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    const itxt = result.findings.find((f) => f.field === 'PNG:iTXt:Description');
    expect(itxt).toBeDefined();
    expect(itxt!.value).toContain('Test');
  });

  it('detects tIME chunk', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    const time = result.findings.find((f) => f.field === 'PNG:tIME');
    expect(time).toBeDefined();
    expect(time!.severity).toBe('high');
  });

  it('detects colour chunks in preserved info', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    expect(result.preservedInfo.hasIccProfile).toBe(true);
    expect(result.preservedInfo.colourChunks).toContain('iCCP');
    expect(result.preservedInfo.colourChunks).toContain('sRGB');
    expect(result.preservedInfo.colourChunks).toContain('gAMA');
  });

  it('detects image dimensions', () => {
    const buffer = loadFixture('sample.png');
    const result = scanPng(buffer);

    expect(result.preservedInfo.dimensions).toBeDefined();
    expect(result.preservedInfo.dimensions!.width).toBe(2);
    expect(result.preservedInfo.dimensions!.height).toBe(2);
  });
});

describe('PNG cleaner', () => {
  it('removes privacy-relevant metadata chunks', () => {
    const buffer = loadFixture('sample.png');
    const scanBefore = scanPng(buffer);
    const personalBefore = scanBefore.findings.filter(
      (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM'].includes(f.field),
    ).length;
    expect(personalBefore).toBeGreaterThan(0);

    const cleanBuffer = cleanPng(buffer);
    const scanAfter = scanPng(cleanBuffer);
    const personalAfter = scanAfter.findings.filter(
      (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM'].includes(f.field),
    ).length;

    expect(personalAfter).toBe(0);
  });

  it('preserves colour-related chunks', () => {
    const buffer = loadFixture('sample.png');
    const cleanBuffer = cleanPng(buffer);
    const scanAfter = scanPng(cleanBuffer);

    expect(scanAfter.preservedInfo.hasIccProfile).toBe(true);
    expect(scanAfter.preservedInfo.colourChunks.length).toBeGreaterThan(0);
  });

  it('preserves valid PNG structure', () => {
    const buffer = loadFixture('sample.png');
    const cleanBuffer = cleanPng(buffer);
    const bytes = new Uint8Array(cleanBuffer);

    // PNG must start with signature
    expect(bytes[0]).toBe(137);
    expect(bytes[1]).toBe(80);
    expect(bytes[2]).toBe(78);
    expect(bytes[3]).toBe(71);
  });
});

describe('PNG verifier', () => {
  it('passes verification on clean output', () => {
    const buffer = loadFixture('sample.png');
    const scan = scanPng(buffer);
    const cleanBuffer = cleanPng(buffer);
    const verification = verifyPng(scan, cleanBuffer);

    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);
  });

  it('reports technical colour data preserved', () => {
    const buffer = loadFixture('sample.png');
    const scan = scanPng(buffer);
    const cleanBuffer = cleanPng(buffer);
    const verification = verifyPng(scan, cleanBuffer);

    expect(verification.technicalDataPreserved.length).toBeGreaterThan(0);
  });
});
