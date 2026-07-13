/**
 * Orientation test fixtures for BURAN 01B.
 *
 * Creates minimal JPEG files with specific EXIF orientation values.
 * Each file is a 4x2 pixel JPEG with the orientation tag embedded.
 *
 * Usage: npx tsx tests/fixtures/generate-orientation-fixtures.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(import.meta.dirname || __dirname);

/**
 * Build a minimal JPEG with a specific EXIF orientation value.
 * Uses a tiny 4x2 image (portrait: h > w, so 90° rotations swap to 2x4).
 */
function makeOrientedJpeg(orientation: number): Buffer {
  const chunks: Buffer[] = [];

  // SOI
  chunks.push(Buffer.from([0xff, 0xd8]));

  // APP0 (JFIF)
  const jfif = Buffer.alloc(18);
  jfif[0] = 0xff; jfif[1] = 0xe0;
  jfif[2] = 0x00; jfif[3] = 0x10;
  jfif.write('JFIF\0', 4, 'ascii');
  jfif[9] = 0x01; jfif[10] = 0x02;
  jfif[11] = 0x01;
  jfif[12] = 0x00; jfif[13] = 0x48;
  jfif[14] = 0x00; jfif[15] = 0x48;
  chunks.push(jfif);

  // APP1 (EXIF) with only orientation + basic IFD0 tags
  const exifChunk = makeExifWithOrientation(orientation);
  chunks.push(exifChunk);

  // DQT
  const dqt = Buffer.alloc(67);
  dqt[0] = 0xff; dqt[1] = 0xdb;
  dqt[2] = 0x00; dqt[3] = 65;
  dqt[4] = 0x00;
  for (let i = 0; i < 64; i++) dqt[5 + i] = 8;
  chunks.push(dqt);

  // SOF0 (4x2 pixels, YCbCr 4:2:0)
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof[2] = 0x00; sof[3] = 17;
  sof[4] = 0x08;
  sof[5] = 0x00; sof[6] = 0x04; // Height = 4
  sof[7] = 0x00; sof[8] = 0x02; // Width = 2
  sof[9] = 0x01;
  sof[10] = 0x01; sof[11] = 0x11; sof[12] = 0x00;
  chunks.push(sof);

  // DHT
  const dht = Buffer.alloc(32);
  dht[0] = 0xff; dht[1] = 0xc4;
  dht[2] = 0x00; dht[3] = 28;
  dht[4] = 0x00;
  dht[5] = 0; dht[6] = 1;
  for (let i = 7; i < 21; i++) dht[i] = 0;
  dht[21] = 0x00;
  chunks.push(dht);

  // SOS
  const sos = Buffer.alloc(14);
  sos[0] = 0xff; sos[1] = 0xda;
  sos[2] = 0x00; sos[3] = 12;
  sos[4] = 0x01;
  sos[5] = 0x01; sos[6] = 0x00;
  sos[7] = 0x00; sos[8] = 0x3f; sos[9] = 0x00;
  chunks.push(sos);

  // Encoded data (8 bytes of flat gray)
  chunks.push(Buffer.from([0x7f, 0xf0, 0x7f, 0xf0, 0x7f, 0xf0, 0x7f, 0xf0]));

  // EOI
  chunks.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(chunks);
}

function makeExifWithOrientation(orientation: number): Buffer {
  const parts: Buffer[] = [];

  // "Exif\0\0" header
  parts.push(Buffer.from('Exif\0\0', 'ascii'));

  // TIFF header: little-endian, offset 8
  const tiffHeader = Buffer.alloc(8);
  tiffHeader[0] = 0x49; tiffHeader[1] = 0x49; // II
  tiffHeader.writeUInt16LE(42, 2); // TIFF version
  tiffHeader.writeUInt32LE(8, 4); // offset to IFD0
  parts.push(tiffHeader);

  // IFD0: 1 entry (orientation only)
  const numEntries = 1;
  const ifdEntrySize = 12;
  const ifdEnd = 8 + 2 + numEntries * ifdEntrySize + 4; // = 26

  // Build IFD
  const ifdData = Buffer.alloc(2 + numEntries * 12 + 4);
  ifdData.writeUInt16LE(numEntries, 0);

  // Entry: Orientation (0x0112), type SHORT (3), count 1, value <orientation>
  const entryOffset = 2;
  ifdData.writeUInt16LE(0x0112, entryOffset); // Tag
  ifdData.writeUInt16LE(3, entryOffset + 2); // Type = SHORT
  ifdData.writeUInt32LE(1, entryOffset + 4); // Count = 1
  ifdData.writeUInt16LE(orientation, entryOffset + 8); // Inline value

  // Next IFD = 0
  ifdData.writeUInt32LE(0, 14);

  parts.push(ifdData);

  // Build APP1
  const app1Data = Buffer.concat(parts);
  const app1Header = Buffer.alloc(4);
  app1Header[0] = 0xff; app1Header[1] = 0xe1;
  const app1Len = app1Data.length + 2;
  app1Header.writeUInt16BE(app1Len, 2);

  return Buffer.concat([app1Header, app1Data]);
}

function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  const orientations = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const ori of orientations) {
    const buf = makeOrientedJpeg(ori);
    writeFileSync(join(FIXTURES_DIR, `orientation-${ori}.jpg`), buf);
    console.log(`✓ orientation-${ori}.jpg`);
  }

  console.log('\nOrientation fixtures generated in ' + FIXTURES_DIR);
}

main();
