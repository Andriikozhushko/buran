import { describe, it, expect } from 'vitest';
import { scanTiff, cleanTiff, verifyTiff, tiffPixelDataIdentical } from '../../src/lib/formats/tiff';
import { detectFormat } from '../../src/lib/formats/registry';
import { personalFindingCount } from '../../src/lib/formats/types';

/**
 * Build a little-endian TIFF: 2×2 grayscale, one strip, with personal
 * metadata (Artist, Software, DateTime, ImageDescription, GPS IFD, XMP).
 */
function makeTiff(): ArrayBuffer {
  let cursor = 8;

  const data: Uint8Array[] = [];
  const append = (bytes: Uint8Array): number => {
    const at = cursor;
    data.push(bytes);
    cursor += bytes.length;
    if (cursor % 2) {
      data.push(new Uint8Array(1));
      cursor += 1;
    }
    return at;
  };

  const ascii = (s: string) => new TextEncoder().encode(s + '\0');
  const pixels = new Uint8Array([10, 20, 30, 40]);
  const pixelsAt = append(pixels);
  const artistAt = append(ascii('BURAN_TIFF_ARTIST_DO_NOT_LEAK'));
  const softwareAt = append(ascii('SecretEditor 9.1'));
  const dateAt = append(ascii('2024:05:06 12:34:56'));
  const descAt = append(ascii('BURAN_TIFF_DESC_DO_NOT_LEAK'));
  const xmpAt = append(new TextEncoder().encode('<x:xmpmeta>BURAN_TIFF_XMP</x:xmpmeta>'));
  const xmpLen = 37;

  // GPS IFD: version + latitude ref (inline values only, 2 entries)
  const gpsIfd = new Uint8Array(2 + 2 * 12 + 4);
  {
    const v = new DataView(gpsIfd.buffer);
    v.setUint16(0, 2, true);
    // 0x0000 GPSVersionID BYTE ×4
    v.setUint16(2, 0x0000, true); v.setUint16(4, 1, true); v.setUint32(6, 4, true); v.setUint32(10, 0x00000202, true);
    // 0x0001 GPSLatitudeRef ASCII "N\0"
    v.setUint16(14, 0x0001, true); v.setUint16(16, 2, true); v.setUint32(18, 2, true);
    gpsIfd[22] = 0x4e; gpsIfd[23] = 0;
  }
  const gpsAt = append(gpsIfd);

  // IFD0
  const entries: Array<[number, number, number, (v: DataView, at: number) => void]> = [
    [256, 3, 1, (v, at) => v.setUint16(at, 2, true)], // ImageWidth
    [257, 3, 1, (v, at) => v.setUint16(at, 2, true)], // ImageLength
    [258, 3, 1, (v, at) => v.setUint16(at, 8, true)], // BitsPerSample
    [259, 3, 1, (v, at) => v.setUint16(at, 1, true)], // Compression: none
    [262, 3, 1, (v, at) => v.setUint16(at, 1, true)], // Photometric: BlackIsZero
    [270, 2, 28, (v, at) => v.setUint32(at, descAt, true)], // ImageDescription
    [273, 4, 1, (v, at) => v.setUint32(at, pixelsAt, true)], // StripOffsets
    [277, 3, 1, (v, at) => v.setUint16(at, 1, true)], // SamplesPerPixel
    [278, 3, 1, (v, at) => v.setUint16(at, 2, true)], // RowsPerStrip
    [279, 4, 1, (v, at) => v.setUint32(at, 4, true)], // StripByteCounts
    [305, 2, 17, (v, at) => v.setUint32(at, softwareAt, true)], // Software
    [306, 2, 20, (v, at) => v.setUint32(at, dateAt, true)], // DateTime
    [315, 2, 30, (v, at) => v.setUint32(at, artistAt, true)], // Artist
    [700, 1, xmpLen, (v, at) => v.setUint32(at, xmpAt, true)], // XMP
    [34853, 4, 1, (v, at) => v.setUint32(at, gpsAt, true)], // GPS IFD
  ];
  const ifd = new Uint8Array(2 + entries.length * 12 + 4);
  const ifdView = new DataView(ifd.buffer);
  ifdView.setUint16(0, entries.length, true);
  entries.forEach(([tag, type, count, write], i) => {
    const at = 2 + i * 12;
    ifdView.setUint16(at, tag, true);
    ifdView.setUint16(at + 2, type, true);
    ifdView.setUint32(at + 4, count, true);
    write(ifdView, at + 8);
  });
  const ifdAt = cursor;

  const header = new Uint8Array(8);
  const hv = new DataView(header.buffer);
  hv.setUint16(0, 0x4949, false);
  hv.setUint16(2, 42, true);
  hv.setUint32(4, ifdAt, true);

  const total = 8 + data.reduce((s, d) => s + d.length, 0) + ifd.length;
  const out = new Uint8Array(total);
  out.set(header, 0);
  let pos = 8;
  for (const d of data) {
    out.set(d, pos);
    pos += d.length;
  }
  out.set(ifd, pos);
  return out.buffer;
}

describe('TIFF handler', () => {
  it('is detected by magic bytes in both byte orders', () => {
    expect(detectFormat(makeTiff())).toBe('tiff');
    const mm = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 0, 0, 0]);
    expect(detectFormat(mm.buffer)).toBe('tiff');
  });

  it('scans personal metadata: artist, software, dates, GPS, XMP', () => {
    const scan = scanTiff(makeTiff());
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('TIFF:Artist');
    expect(fields).toContain('TIFF:Software');
    expect(fields).toContain('TIFF:Date/time');
    expect(fields).toContain('TIFF:Image description');
    expect(fields).toContain('TIFF:XMP metadata');
    expect(fields).toContain('TIFF:GPS IFD pointer');
    expect(scan.preservedInfo.dimensions).toEqual({ width: 2, height: 2 });
    const artist = scan.findings.find((f) => f.field === 'TIFF:Artist');
    expect(artist?.value).toBe('BURAN_TIFF_ARTIST_DO_NOT_LEAK');
  });

  it('cleans all metadata, keeps pixel bytes identical, verification passes', () => {
    const input = makeTiff();
    const scan = scanTiff(input);
    expect(scan.findings.length).toBeGreaterThan(0);

    const clean = cleanTiff(input);
    const verification = verifyTiff(scan, clean);
    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);
    expect(tiffPixelDataIdentical(input, clean)).toBe(true);

    // Original values must not survive anywhere in the output bytes.
    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('BURAN_TIFF_ARTIST_DO_NOT_LEAK');
    expect(raw).not.toContain('BURAN_TIFF_DESC_DO_NOT_LEAK');
    expect(raw).not.toContain('BURAN_TIFF_XMP');
    expect(raw).not.toContain('SecretEditor');
  });

  it('re-scan of a cleaned TIFF reports zero personal findings', () => {
    const clean = cleanTiff(makeTiff());
    const rescan = scanTiff(clean);
    expect(personalFindingCount(rescan.findings)).toBe(0);
  });

  it('refuses camera RAW disguised as TIFF (CR2 marker)', () => {
    const bytes = new Uint8Array(makeTiff().slice(0));
    // CR2: "CR" + version 2 at offset 8 — force it over the fixture's data region.
    bytes[8] = 0x43; bytes[9] = 0x52; bytes[10] = 2;
    expect(() => scanTiff(bytes.buffer)).toThrow(/RAW/);
    expect(() => cleanTiff(bytes.buffer)).toThrow(/RAW/);
  });

  it('does not throw on malformed inputs', () => {
    const truncated = makeTiff().slice(0, 10);
    expect(() => scanTiff(truncated)).not.toThrow();
    expect(scanTiff(truncated).preservedInfo.dimensions).toBeNull();
    const garbage = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0xff, 0xff]).buffer;
    expect(() => scanTiff(garbage)).not.toThrow();
  });
});
