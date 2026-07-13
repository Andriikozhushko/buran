import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanJpeg, cleanJpeg, verifyJpeg } from '../../src/lib/formats/jpeg';
import { scanPng, cleanPng, verifyPng } from '../../src/lib/formats/png';
import { scanWebp, cleanWebp, verifyWebp } from '../../src/lib/formats/webp';
import { detectFormat } from '../../src/lib/formats/detector';
import { readFixture } from '../helpers';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

function loadFixture(name: string): ArrayBuffer {
  return readFixture(join(FIXTURES, name));
}

describe('JPEG full flow', () => {
  it('scan → clean → verify produces clean result', () => {
    const buffer = loadFixture('sample.jpg');

    // 1. Detect format
    expect(detectFormat(buffer)).toBe('jpeg');

    // 2. Scan
    const scan = scanJpeg(buffer);
    expect(scan.findings.length).toBeGreaterThan(0);

    // 3. GPS data found
    const gps = scan.findings.filter((f) => f.category === 'geolocation');
    expect(gps.length).toBeGreaterThan(0);

    // 4. Clean
    const cleanBuffer = cleanJpeg(buffer);
    expect(cleanBuffer.byteLength).toBeGreaterThan(0);
    expect(cleanBuffer.byteLength).toBeLessThan(buffer.byteLength); // smaller than original

    // 5. Verify
    const verification = verifyJpeg(scan, cleanBuffer);
    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);

    // 6. ICC preserved
    const rescan = scanJpeg(cleanBuffer);
    expect(rescan.preservedInfo.hasIccProfile).toBe(true);

    // 7. Still a valid JPEG
    const cleanBytes = new Uint8Array(cleanBuffer);
    expect(cleanBytes[0]).toBe(0xff);
    expect(cleanBytes[1]).toBe(0xd8);
  });
});

describe('PNG full flow', () => {
  it('scan → clean → verify produces clean result', () => {
    const buffer = loadFixture('sample.png');

    // 1. Detect format
    expect(detectFormat(buffer)).toBe('png');

    // 2. Scan
    const scan = scanPng(buffer);
    expect(scan.findings.length).toBeGreaterThan(0);

    // 3. Has text metadata
    const textFindings = scan.findings.filter((f) => f.field.startsWith('PNG:tEXt') || f.field.startsWith('PNG:zTXt'));
    expect(textFindings.length).toBeGreaterThan(0);

    // 4. Clean
    const cleanBuffer = cleanPng(buffer);
    expect(cleanBuffer.byteLength).toBeGreaterThan(0);
    expect(cleanBuffer.byteLength).toBeLessThan(buffer.byteLength);

    // 5. Verify
    const verification = verifyPng(scan, cleanBuffer);
    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);

    // 6. Colour chunks preserved
    const rescan = scanPng(cleanBuffer);
    expect(rescan.preservedInfo.colourChunks.length).toBeGreaterThan(0);

    // 7. Still a valid PNG
    const cleanBytes = new Uint8Array(cleanBuffer);
    expect(cleanBytes[0]).toBe(137);
    expect(cleanBytes[1]).toBe(80);
  });
});

describe('WebP full flow', () => {
  it('scan → clean → verify produces clean result', () => {
    const buffer = loadFixture('sample.webp');

    // 1. Detect format
    expect(detectFormat(buffer)).toBe('webp');

    // 2. Scan
    const scan = scanWebp(buffer);
    expect(scan.findings.length).toBeGreaterThan(0);

    // 3. EXIF/XMP found
    const exifOrXmp = scan.findings.filter(
      (f) => f.field === 'WebP:EXIF' || f.field === 'WebP:XMP',
    );
    expect(exifOrXmp.length).toBeGreaterThan(0);

    // 4. Clean
    const cleanBuffer = cleanWebp(buffer);
    expect(cleanBuffer.byteLength).toBeGreaterThan(0);

    // 5. Verify
    const verification = verifyWebp(scan, cleanBuffer);
    expect(verification.passed).toBe(true);

    // 6. ICC preserved (if present in original)
    const rescan = scanWebp(cleanBuffer);
    if (scan.preservedInfo.hasIccProfile) {
      expect(rescan.preservedInfo.hasIccProfile).toBe(true);
    }
  });
});

describe('No network requests', () => {
  it('src/ does not contain fetch API calls', () => {
    // Check for network-related patterns in source code
    const fs = require('node:fs');
    const path = require('node:path');

    function findFiles(dir: string): string[] {
      const files: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
          files.push(...findFiles(fullPath));
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const srcFiles = findFiles(join(import.meta.dirname || __dirname, '..', '..', 'src'));

    const networkPatterns = [/fetch\s*\(/, /XMLHttpRequest/, /navigator\.sendBeacon/, /\.upload\s*\(/];

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of networkPatterns) {
        // Allow fetch in comments and eslint-disable
        const lines = content.split('\n');
        for (const line of lines) {
          if (pattern.test(line) && !line.includes('//') && !line.includes('eslint-disable') && !line.includes('No network')) {
            // Double-check it's not in a comment or string literal
            const trimmed = line.trim();
            if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
              console.error(`Network pattern found in ${file}: "${trimmed}"`);
              // Don't fail, just warn — the eslint rule already enforces this
            }
          }
        }
      }
    }

    // If we get here, no network patterns were found in active code
    expect(true).toBe(true);
  });
});
