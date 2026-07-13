import { describe, it, expect } from 'vitest';
import { detectFormat, formatToMimeType, formatToExtension, formatToDisplayName } from '../../src/lib/formats/detector';
import { join } from 'node:path';
import { readFixture } from '../helpers';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

describe('detectFormat', () => {
  it('detects JPEG format from magic bytes', () => {
    const buffer = readFixture(join(FIXTURES, 'sample.jpg'));
    expect(detectFormat(buffer)).toBe('jpeg');
  });

  it('detects PNG format from magic bytes', () => {
    const buffer = readFixture(join(FIXTURES, 'sample.png'));
    expect(detectFormat(buffer)).toBe('png');
  });

  it('detects WebP format from magic bytes', () => {
    const buffer = readFixture(join(FIXTURES, 'sample.webp'));
    expect(detectFormat(buffer)).toBe('webp');
  });

  it('returns null for unsupported format', () => {
    const buffer = readFixture(join(FIXTURES, 'unsupported.txt'));
    expect(detectFormat(buffer)).toBeNull();
  });

  it('returns null for empty buffer', () => {
    const buffer = new ArrayBuffer(0);
    expect(detectFormat(buffer)).toBeNull();
  });

  it('returns null for buffer smaller than 12 bytes', () => {
    const buffer = new Uint8Array([0xff, 0xd8]).buffer;
    expect(detectFormat(buffer)).toBeNull();
  });
});

describe('formatToMimeType', () => {
  it('returns correct MIME types', () => {
    expect(formatToMimeType('jpeg')).toBe('image/jpeg');
    expect(formatToMimeType('png')).toBe('image/png');
    expect(formatToMimeType('webp')).toBe('image/webp');
  });
});

describe('formatToExtension', () => {
  it('returns correct extensions', () => {
    expect(formatToExtension('jpeg')).toBe('jpg');
    expect(formatToExtension('png')).toBe('png');
    expect(formatToExtension('webp')).toBe('webp');
  });
});

describe('formatToDisplayName', () => {
  it('returns display names', () => {
    expect(formatToDisplayName('jpeg')).toBe('JPEG');
    expect(formatToDisplayName('png')).toBe('PNG');
    expect(formatToDisplayName('webp')).toBe('WebP');
  });
});
