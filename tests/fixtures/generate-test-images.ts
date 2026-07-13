/**
 * Test fixture generator for BURAN.
 *
 * Creates minimal valid image files with known embedded metadata
 * for testing the scanner, cleaner, and verifier.
 *
 * Usage: npx tsx tests/fixtures/generate-test-images.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname || __dirname);

function createTestJpeg(): Buffer {
  const chunks: Buffer[] = [];

  // SOI
  chunks.push(Buffer.from([0xff, 0xd8]));

  // APP0 (JFIF) — kept for compatibility
  const jfif = Buffer.alloc(18);
  jfif[0] = 0xff; jfif[1] = 0xe0; // APP0
  jfif[2] = 0x00; jfif[3] = 0x10; // Length
  jfif[4] = 0x4a; jfif[5] = 0x46; jfif[6] = 0x49; jfif[7] = 0x46; jfif[8] = 0x00; // "JFIF\0"
  jfif[9] = 0x01; jfif[10] = 0x02; // Version 1.2
  jfif[11] = 0x01; // DPI units
  jfif[12] = 0x00; jfif[13] = 0x48; // 72 DPI X
  jfif[14] = 0x00; jfif[15] = 0x48; // 72 DPI Y
  chunks.push(jfif);

  // APP1 (EXIF) with GPS, camera, author
  const exifData = createExifData();
  const exifLen = exifData.length + 2;
  const exifHeader = Buffer.alloc(4);
  exifHeader[0] = 0xff; exifHeader[1] = 0xe1; // APP1
  exifHeader[2] = (exifLen >> 8) & 0xff;
  exifHeader[3] = exifLen & 0xff;
  chunks.push(exifHeader);
  chunks.push(exifData);

  // APP1 (XMP)
  const xmpXml = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Seq><rdf:li>Test Author</rdf:li></rdf:Seq></dc:creator><dc:description xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Alt><rdf:li xml:lang="x-default">Test image for BURAN</rdf:li></rdf:Alt></dc:description></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const xmpBytes = Buffer.from(xmpXml, 'utf-8');
  const xmpLen = xmpBytes.length + 2;
  const xmpHeader = Buffer.alloc(4);
  xmpHeader[0] = 0xff; xmpHeader[1] = 0xe1; // APP1
  xmpHeader[2] = (xmpLen >> 8) & 0xff;
  xmpHeader[3] = xmpLen & 0xff;
  chunks.push(xmpHeader);
  chunks.push(xmpBytes);

  // APP2 (ICC Profile)
  const iccProfile = createIccProfile();
  const iccLen = iccProfile.length + 2;
  const iccHeader = Buffer.alloc(4);
  iccHeader[0] = 0xff; iccHeader[1] = 0xe2; // APP2
  iccHeader[2] = (iccLen >> 8) & 0xff;
  iccHeader[3] = iccLen & 0xff;
  chunks.push(iccHeader);
  chunks.push(iccProfile);

  // APP13 (IPTC/Photoshop)
  const iptcData = createIptcData();
  const iptcLen = iptcData.length + 2;
  const iptcHeader = Buffer.alloc(4);
  iptcHeader[0] = 0xff; iptcHeader[1] = 0xed; // APP13
  iptcHeader[2] = (iptcLen >> 8) & 0xff;
  iptcHeader[3] = iptcLen & 0xff;
  chunks.push(iptcHeader);
  chunks.push(iptcData);

  // COM (Comment)
  const commentText = 'BURAN test comment with potential PII';
  const commentBytes = Buffer.from(commentText, 'utf-8');
  const commentLen = commentBytes.length + 2;
  const commentHeader = Buffer.alloc(4);
  commentHeader[0] = 0xff; commentHeader[1] = 0xfe; // COM
  commentHeader[2] = (commentLen >> 8) & 0xff;
  commentHeader[3] = commentLen & 0xff;
  chunks.push(commentHeader);
  chunks.push(commentBytes);

  // DQT
  const dqt = Buffer.alloc(67);
  dqt[0] = 0xff; dqt[1] = 0xdb;
  dqt[2] = 0x00; dqt[3] = 67 - 2;
  dqt[4] = 0x00; // Table 0, 8-bit precision
  for (let i = 0; i < 64; i++) dqt[5 + i] = 8; // Flat quantization
  chunks.push(dqt);

  // SOF0 (Baseline DCT, 2x2 image)
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof[2] = 0x00; sof[3] = 17; // Length
  sof[4] = 0x08; // 8-bit
  sof[5] = 0x00; sof[6] = 0x02; // Height = 2
  sof[7] = 0x00; sof[8] = 0x02; // Width = 2
  sof[9] = 0x01; // 1 component
  sof[10] = 0x01; sof[11] = 0x11; sof[12] = 0x00; // Y component
  chunks.push(sof);

  // DHT (minimal Huffman table)
  const dht = createMinimalDht();
  chunks.push(dht);

  // SOS
  const sos = Buffer.alloc(14);
  sos[0] = 0xff; sos[1] = 0xda;
  sos[2] = 0x00; sos[3] = 12; // Length
  sos[4] = 0x01; // 1 component
  sos[5] = 0x01; sos[6] = 0x00; // Y, DC=0, AC=0
  sos[7] = 0x00; sos[8] = 0x3f; sos[9] = 0x00; // Spectral
  chunks.push(sos);

  // Encoded data (minimal 2x2 gray pixels)
  chunks.push(Buffer.from([0x7f, 0xf0, 0x7f, 0xf0]));

  // EOI
  chunks.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(chunks);
}

function createExifData(): Buffer {
  // Build a minimal TIFF with EXIF IFD0 containing:
  // - Make: "Apple"
  // - Model: "iPhone 15 Pro"
  // - DateTime: "2024:06:15 14:30:00"
  // - Artist: "Test Photographer"
  // - Copyright: "Copyright 2024 Test Inc."
  // - GPS IFD with coordinates

  const chunks: Buffer[] = [];

  // "Exif\0\0" header
  chunks.push(Buffer.from('Exif\0\0', 'ascii'));

  // TIFF header: little-endian (II), version 42, offset to IFD0 = 8
  const tiffHeader = Buffer.alloc(8);
  tiffHeader[0] = 0x49; tiffHeader[1] = 0x49; // II
  tiffHeader[2] = 0x2a; tiffHeader[3] = 0x00; // 42
  tiffHeader[4] = 0x08; tiffHeader[5] = 0x00; tiffHeader[6] = 0x00; tiffHeader[7] = 0x00; // offset = 8
  const tiffStart = 6; // Offset of TIFF header within EXIF data

  // Build string values and IFD entries
  const stringValues: { offset: number; value: string }[] = [];
  let stringArea = 0;

  function addString(value: string): number {
    const offset = stringArea;
    stringValues.push({ offset, value: value + '\0' });
    stringArea += value.length + 1;
    return offset;
  }

  const makeOffset = addString('Apple');
  const modelOffset = addString('iPhone 15 Pro');
  const datetimeOffset = addString('2024:06:15 14:30:00');
  const artistOffset = addString('Test Photographer');
  const copyrightOffset = addString('Copyright 2024 Test Inc.');

  // IFD0 entries (12 bytes each)
  // We'll have: Make, Model, DateTime, Artist, Copyright, EXIF IFD ptr, GPS IFD ptr
  const numEntries = 7;
  const ifd0Start = tiffStart + 8; // offset 14 in EXIF data

  // Where string area starts (after IFD entries + next IFD offset)
  const ifd0End = ifd0Start + 2 + numEntries * 12 + 4; // +2 for count, +4 for next IFD ptr
  const stringBase = ifd0End;

  // IFD entries
  const entries: Buffer[] = [];

  function makeEntry(tag: number, type: number, count: number, valueOffset: number): Buffer {
    const buf = Buffer.alloc(12);
    buf.writeUInt16LE(tag, 0);
    buf.writeUInt16LE(type, 2);
    buf.writeUInt32LE(count, 4);
    // For strings (type 2), if length <= 4, value is inline
    if (type === 2 && count <= 4) {
      // Inline — write the actual bytes
      const str = stringValues.find(s => s.offset === valueOffset);
      if (str) {
        const bytes = Buffer.from(str.value, 'ascii');
        for (let i = 0; i < Math.min(bytes.length, 4); i++) {
          buf[8 + i] = bytes[i];
        }
      }
    } else {
      // Offset from start of TIFF header (stringBase is offset in EXIF data, tiffStart is offset of TIFF header within EXIF)
      buf.writeUInt32LE(stringBase + valueOffset - tiffStart, 8);
    }
    return buf;
  }

  // EXIF SubIFD and GPS IFD pointers need actual offsets
  // We'll place EXIF SubIFD right after the string area
  const exifIfdOffset = stringBase + stringArea - tiffStart; // Offset from TIFF start
  const gpsIfdOffset = exifIfdOffset + 2 + 2 * 12 + 4; // 2 EXIF entries + next IFD ptr

  entries.push(makeEntry(0x010f, 2, 6, makeOffset)); // Make
  entries.push(makeEntry(0x0110, 2, 14, modelOffset)); // Model
  entries.push(makeEntry(0x0132, 2, 20, datetimeOffset)); // DateTime
  entries.push(makeEntry(0x013b, 2, 19, artistOffset)); // Artist
  entries.push(makeEntry(0x8298, 2, 22, copyrightOffset)); // Copyright
  // EXIF IFD pointer (type 4 = LONG)
  const exifPtr = Buffer.alloc(12);
  exifPtr.writeUInt16LE(0x8769, 0);
  exifPtr.writeUInt16LE(4, 2);
  exifPtr.writeUInt32LE(1, 4);
  exifPtr.writeUInt32LE(exifIfdOffset, 8);
  entries.push(exifPtr);
  // GPS IFD pointer (type 4 = LONG)
  const gpsPtr = Buffer.alloc(12);
  gpsPtr.writeUInt16LE(0x8825, 0);
  gpsPtr.writeUInt16LE(4, 2);
  gpsPtr.writeUInt32LE(1, 4);
  gpsPtr.writeUInt32LE(gpsIfdOffset, 8);
  entries.push(gpsPtr);

  // IFD0
  chunks.push(tiffHeader); // 8 bytes

  const ifd0Data = Buffer.alloc(2);
  ifd0Data.writeUInt16LE(numEntries, 0);
  chunks.push(ifd0Data);
  for (const entry of entries) {
    chunks.push(entry);
  }
  // Next IFD offset = 0 (no more)
  chunks.push(Buffer.alloc(4, 0));

  // String area
  for (const sv of stringValues) {
    chunks.push(Buffer.from(sv.value, 'ascii'));
  }

  // EXIF SubIFD (2 entries: LensModel, DateTimeOriginal)
  const exifSubIfd = Buffer.alloc(2 + 2 * 12 + 4);
  exifSubIfd.writeUInt16LE(2, 0); // 2 entries

  // DateTimeOriginal
  exifSubIfd.writeUInt16LE(0x9003, 2); // Tag
  exifSubIfd.writeUInt16LE(2, 4); // Type = ASCII
  exifSubIfd.writeUInt32LE(20, 6); // Count
  // Inline value for 20 bytes — won't fit, so we need offset
  // For simplicity, put DateTimeOriginal inline via shorter length
  // Actually, let's keep it simple: just use a known offset

  // LensModel
  exifSubIfd.writeUInt16LE(0xa434, 14);
  exifSubIfd.writeUInt16LE(2, 16);
  exifSubIfd.writeUInt32LE(30, 18);

  // Next IFD = 0
  exifSubIfd.writeUInt32LE(0, 26);

  chunks.push(exifSubIfd);
  // EXIF string values
  chunks.push(Buffer.from('2024:06:15 14:30:00\0', 'ascii'));
  chunks.push(Buffer.from('iPhone 15 Pro back camera\0', 'ascii'));

  // GPS IFD with coordinates (49.4521, 11.0767)
  // GPS version, lat ref, lat, lon ref, lon
  const gpsIfd = Buffer.alloc(2 + 7 * 12 + 4);
  gpsIfd.writeUInt16LE(7, 0); // 7 entries

  function writeGpsEntry(buf: Buffer, offset: number, tag: number, type: number, count: number, value: number): void {
    buf.writeUInt16LE(tag, offset);
    buf.writeUInt16LE(type, offset + 2);
    buf.writeUInt32LE(count, offset + 4);
    buf.writeUInt32LE(value, offset + 8);
  }

  // GPSVersionID [2, 3, 0, 0]
  writeGpsEntry(gpsIfd, 2, 0x0000, 1, 4, 0x02030000); // Inline bytes
  // GPSLatitudeRef "N"
  writeGpsEntry(gpsIfd, 14, 0x0001, 2, 2, 0x4e00); // "N\0"
  // GPSLatitude [49, 27, 7.56] — rationals
  // For simplicity, store as inline if possible, or point to data
  // Actually, rationals need 8 bytes each, so 3 rationals = 24 bytes
  // Let's put them at known offsets
  const gpsLatDataOffset = gpsIfdOffset + gpsIfd.length;
  writeGpsEntry(gpsIfd, 26, 0x0002, 5, 3, gpsLatDataOffset);
  // GPSLongitudeRef "E"
  writeGpsEntry(gpsIfd, 38, 0x0003, 2, 2, 0x4500); // "E\0"
  // GPSLongitude [11, 4, 36.12] — rationals
  const gpsLonDataOffset = gpsLatDataOffset + 24;
  writeGpsEntry(gpsIfd, 50, 0x0004, 5, 3, gpsLonDataOffset);
  // GPSAltitudeRef 0 (above sea level)
  writeGpsEntry(gpsIfd, 62, 0x0005, 1, 1, 0);
  // GPSAltitude 310.5 meters
  const gpsAltDataOffset = gpsLonDataOffset + 24;
  writeGpsEntry(gpsIfd, 74, 0x0006, 5, 1, gpsAltDataOffset);

  // Next IFD = 0
  gpsIfd.writeUInt32LE(0, 86);

  chunks.push(gpsIfd);

  // GPS rational values
  function writeRational(num: number, den: number): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(num, 0);
    buf.writeUInt32LE(den, 4);
    return buf;
  }

  // Lat: 49° 27' 7.56"
  chunks.push(writeRational(49, 1));
  chunks.push(writeRational(27, 1));
  chunks.push(writeRational(756, 100));
  // Lon: 11° 4' 36.12"
  chunks.push(writeRational(11, 1));
  chunks.push(writeRational(4, 1));
  chunks.push(writeRational(3612, 100));
  // Alt: 310.5 m
  chunks.push(writeRational(621, 2));

  return Buffer.concat(chunks);
}

function createIccProfile(): Buffer {
  // Minimal ICC profile with 'desc' tag
  // ICC profile structure:
  // 128-byte header + tag table + tag data
  const profile = Buffer.alloc(132);
  // "ICC_PROFILE\0" + sequence number in APP2
  profile[0] = 0x49; profile[1] = 0x43; profile[2] = 0x43; profile[3] = 0x5f; // ICC_
  profile[4] = 0x50; profile[5] = 0x52; profile[6] = 0x4f; profile[7] = 0x46; // PROF
  profile[8] = 0x49; profile[9] = 0x4c; profile[10] = 0x45; profile[11] = 0x00; // ILE\0
  profile[12] = 0x01; profile[13] = 0x01; // Sequence number

  // Fill rest with enough data for ICC header recognition
  // Version 4.3.0
  profile[16] = 0x04; profile[17] = 0x30; profile[18] = 0x00; profile[19] = 0x00;
  // Device class 'mntr' (display)
  profile[20] = 0x6d; profile[21] = 0x6e; profile[22] = 0x74; profile[23] = 0x72;
  // Color space 'RGB '
  profile[24] = 0x52; profile[25] = 0x47; profile[26] = 0x42; profile[27] = 0x20;
  // Profile description tag at end
  // Minimal 132-byte profile header with zero tag count
  for (let i = 28; i < 132; i++) profile[i] = 0;

  // Tag count = 0 (minimal)
  profile[128] = 0; profile[129] = 0; profile[130] = 0; profile[131] = 0;

  return profile;
}

function createIptcData(): Buffer {
  // Photoshop 3.0 IPTC marker
  const data = Buffer.alloc(20);
  data[0] = 0x50; data[1] = 0x68; data[2] = 0x6f; // Pho
  data[3] = 0x74; data[4] = 0x6f; data[5] = 0x73; // tos
  data[6] = 0x68; data[7] = 0x6f; data[8] = 0x70; // hop
  data[9] = 0x00; data[10] = 0x00; data[11] = 0x00; // version
  return data;
}

function createMinimalDht(): Buffer {
  // Minimal Huffman table for grayscale
  const dht = Buffer.alloc(32);
  dht[0] = 0xff; dht[1] = 0xc4;
  dht[2] = 0x00; dht[3] = 28; // Length
  dht[4] = 0x00; // DC table 0

  // 16 counts
  dht[5] = 0; dht[6] = 1; dht[7] = 0; dht[8] = 0;
  for (let i = 9; i < 21; i++) dht[i] = 0;

  // Values
  dht[21] = 0x00;

  return dht;
}

function createTestPng(): Buffer {
  const chunks: Buffer[] = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR: 2x2, 8-bit grayscale
  chunks.push(createPngChunk('IHDR', createIhdrData()));

  // iCCP: ICC profile
  const iccName = Buffer.from('Display P3\0', 'ascii');
  const iccCompressed = Buffer.from([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]); // Minimal DEFLATE
  chunks.push(createPngChunk('iCCP', Buffer.concat([iccName, Buffer.from([0x00]), iccCompressed])));

  // sRGB
  chunks.push(createPngChunk('sRGB', Buffer.from([0x00]))); // Perceptual

  // gAMA
  const gama = Buffer.alloc(4);
  gama.writeUInt32BE(45455); // 1/2.2
  chunks.push(createPngChunk('gAMA', gama));

  // cHRM
  const chrm = Buffer.alloc(32);
  chunks.push(createPngChunk('cHRM', chrm));

  // eXIf: embedded EXIF
  chunks.push(createPngChunk('eXIf', createExifData()));

  // tEXt: Author
  chunks.push(createPngChunk('tEXt', Buffer.from('Author\0Test Photographer', 'ascii')));

  // tEXt: Software
  chunks.push(createPngChunk('tEXt', Buffer.from('Software\0Adobe Photoshop 2024', 'ascii')));

  // tEXt: Comment
  chunks.push(createPngChunk('tEXt', Buffer.from('Comment\0This is a test comment', 'ascii')));

  // zTXt: Copyright (compressed)
  const ztxtKeyword = Buffer.from('Copyright\0', 'ascii');
  const ztxtData = Buffer.from([0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00]);
  chunks.push(createPngChunk('zTXt', Buffer.concat([ztxtKeyword, Buffer.from([0x00]), ztxtData])));

  // iTXt: Description
  chunks.push(createPngChunk('iTXt', Buffer.from('Description\0\0\0\0en\0\0Test image description', 'ascii')));

  // tIME
  const time = Buffer.from([0x07, 0xe8, 0x06, 0x0f, 0x0e, 0x1e, 0x00]); // 2024-06-15 14:30:00
  chunks.push(createPngChunk('tIME', time));

  // IDAT: minimal pixel data
  const idatCompressed = Buffer.from([0x78, 0x01, 0x63, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01]);
  chunks.push(createPngChunk('IDAT', idatCompressed));

  // IEND
  chunks.push(createPngChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeBytes = Buffer.from(type, 'ascii');

  // CRC computation (simplified — use dummy CRC for test fixtures)
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcInput);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc);

  return Buffer.concat([length, typeBytes, data, crcBytes]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createIhdrData(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // Width
  ihdr.writeUInt32BE(2, 4); // Height
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 0; // Grayscale
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // No interlace
  return ihdr;
}

function createTestWebp(): Buffer {
  // Build a minimal WebP (VP8X) with EXIF, XMP, and ICC

  // EXIF data
  const exifData = createExifData();
  // XMP data
  const xmpData = Buffer.from(
    `<?xpacket begin=""><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Seq><rdf:li>WebP Author</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
    'utf-8',
  );
  // ICC data (minimal)
  const iccData = createIccProfile();

  // VP8X sub-chunks
  const exifChunk = createWebpChunk('EXIF', exifData);
  const xmpChunk = createWebpChunk('XMP ', xmpData);
  const iccChunkW = createWebpChunk('ICCP', iccData);

  // VP8X content: flags (4 bytes) + canvas size (4 + 4) + sub-chunks
  let vp8xFlags = 0;
  vp8xFlags |= 0x08; // EXIF
  vp8xFlags |= 0x04; // XMP
  vp8xFlags |= 0x20; // ICC

  const flagsBuf = Buffer.alloc(4);
  flagsBuf.writeUInt32LE(vp8xFlags, 0);
  // VP8X canvas dimensions: 24-bit little-endian (3 bytes each, value = dimension - 1)
  const canvasW = Buffer.from([0x01, 0x00, 0x00]); // Width = 2
  const canvasH = Buffer.from([0x01, 0x00, 0x00]); // Height = 2

  const vp8xData = Buffer.concat([flagsBuf, canvasW, canvasH, exifChunk, xmpChunk, iccChunkW]);

  const vp8xChunk = createWebpChunk('VP8X', vp8xData);

  // RIFF container
  const webpBody = Buffer.concat([vp8xChunk]);
  const riffHeader = Buffer.from('WEBP', 'ascii');
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + webpBody.length, 0); // WEBP + children

  return Buffer.concat([Buffer.from('RIFF', 'ascii'), riffSize, riffHeader, webpBody]);
}

function createWebpChunk(fourCC: string, data: Buffer): Buffer {
  const cc = Buffer.from(fourCC, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length, 0);

  // Pad to even
  const padding = data.length % 2 === 0 ? Buffer.alloc(0) : Buffer.from([0x00]);

  return Buffer.concat([cc, size, data, padding]);
}

// Generate and write fixtures
function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  writeFileSync(join(FIXTURES_DIR, 'sample.jpg'), createTestJpeg());
  console.log('✓ sample.jpg');

  writeFileSync(join(FIXTURES_DIR, 'sample.png'), createTestPng());
  console.log('✓ sample.png');

  writeFileSync(join(FIXTURES_DIR, 'sample.webp'), createTestWebp());
  console.log('✓ sample.webp');

  writeFileSync(join(FIXTURES_DIR, 'unsupported.txt'), Buffer.from('This is not an image file.\n'));
  console.log('✓ unsupported.txt');

  console.log('\nFixtures generated in ' + FIXTURES_DIR);
}

main();
