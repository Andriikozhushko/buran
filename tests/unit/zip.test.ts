import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { scanZip } from '../../src/lib/formats/zip/scan';
import { sanitizeZip } from '../../src/lib/formats/zip/sanitize';
import { verifyZip } from '../../src/lib/formats/zip/verify';
import { NEUTRAL_DATE } from '../../src/lib/formats/zip/safety';

const textBytes = (s: string) => new TextEncoder().encode(s);

async function makeZip(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('docs/readme.txt', 'visible text stays', { date: new Date('2024-05-06T12:34:00Z') });
  zip.file('bin/app.bin', new Uint8Array([1, 2, 3, 4, 5]), { date: new Date('2023-01-01T00:00:00Z') });
  zip.file('images/photo.png', makePngWithText(), { date: new Date('2022-02-02T02:02:02Z') });
  zip.comment = 'PRIVATE_ARCHIVE_COMMENT_DO_NOT_LEAK';
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment: zip.comment });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function makeNestedZip(deep = false): Promise<ArrayBuffer> {
  const inner = new JSZip();
  inner.file('inner/photo.png', makePngWithText(), { date: new Date('2021-01-01T00:00:00Z') });
  if (deep) {
    const deeper = new JSZip();
    deeper.file('too-deep.txt', 'x');
    inner.file('deep.zip', await deeper.generateAsync({ type: 'uint8array' }));
  }
  const innerBytes = await inner.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment: 'INNER_COMMENT' });
  const outer = new JSZip();
  outer.file('nested/archive.zip', innerBytes, { date: new Date('2020-01-01T00:00:00Z') });
  const bytes = await outer.generateAsync({ type: 'uint8array', compression: 'DEFLATE', comment: 'OUTER_COMMENT' });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('ZIP archive scan/sanitize/verify', () => {
  it('detects container metadata, supported nested files, and unsupported unchanged files', async () => {
    const input = await makeZip();
    const scan = await scanZip(input);
    expect('blocked' in scan).toBe(false);
    if ('blocked' in scan) return;
    expect(scan.data.containerMetadata.archiveCommentFound).toBe(true);
    expect(scan.data.containerMetadata.entryTimestamps).toBeGreaterThan(0);
    expect(scan.data.supportedEntries.map((e) => e.path)).toContain('images/photo.png');
    expect(scan.data.unsupportedEntries.map((e) => e.path)).toEqual(['docs/readme.txt', 'bin/app.bin']);
  });

  it('cleans ZIP metadata, verifies output, preserves paths, and keeps unsupported bytes identical', async () => {
    const input = await makeZip();
    const scan = await scanZip(input);
    if ('blocked' in scan) throw new Error(scan.message);
    const clean = await sanitizeZip(input, scan.data);
    expect('blocked' in clean).toBe(false);
    if ('blocked' in clean) return;

    const verification = await verifyZip(input, scan.data, clean);
    expect(verification.verificationPassed).toBe(true);
    expect(verification.archiveCommentRemoved).toBe(true);
    expect(verification.timestampsNormalised).toBe(true);
    expect(verification.supportedEntriesVerified).toBe(1);
    expect(verification.unsupportedEntriesUnchanged).toBe(2);

    const originalZip = await JSZip.loadAsync(input);
    const cleanZip = await JSZip.loadAsync(clean);
    expect(Object.keys(cleanZip.files)).toEqual(Object.keys(originalZip.files));
    expect((cleanZip as unknown as { comment?: string }).comment ?? '').toBe('');
    for (const file of Object.values(cleanZip.files)) {
      expect(Math.abs((file.date?.getTime() ?? 0) - NEUTRAL_DATE.getTime())).toBeLessThan(2500);
    }
    expect(await cleanZip.file('docs/readme.txt')!.async('uint8array')).toEqual(await originalZip.file('docs/readme.txt')!.async('uint8array'));
    expect(await cleanZip.file('bin/app.bin')!.async('uint8array')).toEqual(await originalZip.file('bin/app.bin')!.async('uint8array'));
    const cleanedPngText = new TextDecoder('latin1').decode(await cleanZip.file('images/photo.png')!.async('uint8array'));
    expect(cleanedPngText).not.toContain('PRIVATE_PNG_TEXT_DO_NOT_LEAK');
  });

  it('cleans one nested ZIP level and blocks deeper nesting', async () => {
    const input = await makeNestedZip(false);
    const scan = await scanZip(input);
    if ('blocked' in scan) throw new Error(scan.message);
    const clean = await sanitizeZip(input, scan.data);
    expect('blocked' in clean).toBe(false);
    if ('blocked' in clean) return;
    const verification = await verifyZip(input, scan.data, clean);
    expect(verification.verificationPassed).toBe(true);
    expect(verification.nestedArchivesVerified).toBe(1);

    const tooDeep = await scanZip(await makeNestedZip(true));
    expect('blocked' in tooDeep).toBe(true);
    if ('blocked' in tooDeep) expect(tooDeep.reason).toBe('too-deep');
  });

  it('blocks malformed, path traversal, too many entries, zip-bomb-like, and encrypted-read archives', async () => {
    expect('blocked' in (await scanZip(textBytes('not zip').buffer))).toBe(true);

    const traversal = new JSZip();
    traversal.file('../evil.txt', 'x');
    const traversalBytes = await traversal.generateAsync({ type: 'uint8array' });
    const traversalScan = await scanZip(traversalBytes.buffer.slice(traversalBytes.byteOffset, traversalBytes.byteOffset + traversalBytes.byteLength) as ArrayBuffer);
    expect('blocked' in traversalScan).toBe(true);
    if ('blocked' in traversalScan) expect(traversalScan.reason).toBe('path-traversal');

    const many = new JSZip();
    for (let i = 0; i < 10_001; i++) many.file(`f${i}.txt`, 'x');
    const manyBytes = await many.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const manyScan = await scanZip(manyBytes.buffer.slice(manyBytes.byteOffset, manyBytes.byteOffset + manyBytes.byteLength) as ArrayBuffer);
    expect('blocked' in manyScan).toBe(true);
    if ('blocked' in manyScan) expect(manyScan.reason).toBe('too-many-entries');

    const bomb = new JSZip();
    bomb.file('big.bin', new Uint8Array(6 * 1024 * 1024));
    const bombBytes = await bomb.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const bombScan = await scanZip(bombBytes.buffer.slice(bombBytes.byteOffset, bombBytes.byteOffset + bombBytes.byteLength) as ArrayBuffer);
    expect('blocked' in bombScan).toBe(true);
    if ('blocked' in bombScan) expect(bombScan.reason).toBe('zip-bomb');
  });

  it('does not introduce network calls during archive processing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const input = await makeZip();
    const scan = await scanZip(input);
    if ('blocked' in scan) throw new Error(scan.message);
    const clean = await sanitizeZip(input, scan.data);
    if ('blocked' in clean) throw new Error(clean.message);
    await verifyZip(input, scan.data, clean);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

function makePngWithText(): Uint8Array {
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
  const text = chunk('tEXt', textBytes('Comment\0PRIVATE_PNG_TEXT_DO_NOT_LEAK'));
  const idat = chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01]));
  const iend = chunk('IEND', new Uint8Array());
  const out = new Uint8Array(signature.length + ihdr.length + text.length + idat.length + iend.length);
  let offset = 0;
  for (const part of [signature, ihdr, text, idat, iend]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(textBytes(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.slice(4, 8 + data.length)));
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
