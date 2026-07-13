import { describe, it, expect } from 'vitest';
import { sha256, shortHash } from '../../src/lib/hash';

describe('sha256', () => {
  it('computes SHA-256 hash of a buffer', async () => {
    const buffer = new TextEncoder().encode('BURAN test data').buffer;
    const hash = await sha256(buffer);

    expect(hash).toBeDefined();
    expect(hash.length).toBe(64); // 32 bytes = 64 hex chars
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different data', async () => {
    const hash1 = await sha256(new TextEncoder().encode('data 1').buffer);
    const hash2 = await sha256(new TextEncoder().encode('data 2').buffer);

    expect(hash1).not.toBe(hash2);
  });

  it('produces same hash for same data', async () => {
    const data = new TextEncoder().encode('consistent').buffer;
    const hash1 = await sha256(data);
    const hash2 = await sha256(data);

    expect(hash1).toBe(hash2);
  });

  it('handles empty buffer', async () => {
    const hash = await sha256(new ArrayBuffer(0));
    expect(hash.length).toBe(64);
  });
});

describe('shortHash', () => {
  it('truncates long hashes', () => {
    const hash = 'a'.repeat(64);
    const result = shortHash(hash, 16);

    expect(result.length).toBeLessThan(64);
    expect(result).toContain('…');
  });

  it('does not truncate short hashes', () => {
    const hash = 'abc';
    const result = shortHash(hash, 16);
    expect(result).toBe('abc');
  });
});
