import { describe, it, expect } from 'vitest';
import { validateFile, getValidationErrorMessage } from '../../src/lib/validation';
import { readFixture } from '../helpers';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

describe('validateFile', () => {
  it('validates a valid JPEG file', async () => {
    const buffer = readFixture(join(FIXTURES, 'sample.jpg'));
    const file = new File([buffer], 'test.jpg', { type: 'image/jpeg' });
    const result = await validateFile(file);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.format).toBe('jpeg');
    }
  });

  it('validates a valid PNG file', async () => {
    const buffer = readFixture(join(FIXTURES, 'sample.png'));
    const file = new File([buffer], 'test.png', { type: 'image/png' });
    const result = await validateFile(file);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.format).toBe('png');
    }
  });

  it('validates a valid WebP file', async () => {
    const buffer = readFixture(join(FIXTURES, 'sample.webp'));
    const file = new File([buffer], 'test.webp', { type: 'image/webp' });
    const result = await validateFile(file);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.format).toBe('webp');
    }
  });

  it('rejects unsupported format', async () => {
    const buffer = Buffer.from('not an image');
    const file = new File([buffer], 'test.txt', { type: 'text/plain' });
    const result = await validateFile(file);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('unsupported-format');
    }
  });

  it('rejects files over 50 MB', async () => {
    // Create a file with a file size > 50MB (use a large enough buffer)
    // Note: this tests the size check, not actual file creation
    const largeBuffer = Buffer.alloc(51 * 1024 * 1024);
    const file = new File([largeBuffer], 'large.jpg', { type: 'image/jpeg' });
    const result = await validateFile(file);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('too-large');
    }
  });

  it('rejects empty files', async () => {
    const file = new File([], 'empty.jpg', { type: 'image/jpeg' });
    const result = await validateFile(file);

    expect(result.valid).toBe(false);
  });

  it('detects correct file format regardless of extension', async () => {
    // JPEG content with .txt extension — should still detect as JPEG
    const jpegBytes = readFixture(join(FIXTURES, 'sample.jpg'));
    const file = new File([jpegBytes], 'renamed.txt', { type: 'text/plain' });
    const result = await validateFile(file);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.format).toBe('jpeg');
    }
  });
});

describe('getValidationErrorMessage', () => {
  it('returns user-friendly messages', () => {
    expect(getValidationErrorMessage('too-large')).toContain('50');
    expect(getValidationErrorMessage('unsupported-format')).toContain('JPG');
    expect(getValidationErrorMessage('read-error')).toContain('прочитать');
  });
});
