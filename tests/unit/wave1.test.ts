/**
 * Wave-1 formats: GIF, BMP, ICO, AVIF, SVG.
 * Each format: scan finds the planted metadata → clean removes it →
 * independent verify passes → re-scan of the cleaned file is clean.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFixture } from '../helpers';
import { detectFormat } from '../../src/lib/formats/registry';
import { scanGif, cleanGif, verifyGif } from '../../src/lib/formats/gif';
import { scanBmp, cleanBmp, verifyBmp } from '../../src/lib/formats/bmp';
import { scanIco, cleanIco, verifyIco } from '../../src/lib/formats/ico';
import { scanAvif, cleanAvif, verifyAvif } from '../../src/lib/formats/avif';
import { scanSvg, cleanSvg, verifySvg } from '../../src/lib/formats/svg';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');

// --------------------------------------------------------------------- GIF

function makeGif(): ArrayBuffer {
  const parts: number[] = [];
  const push = (...b: number[]) => parts.push(...b);
  const pushText = (s: string) => push(...[...s].map((c) => c.charCodeAt(0)));

  pushText('GIF89a');
  push(4, 0, 3, 0, 0x00, 0, 0); // LSD 4×3, no GCT

  // Comment extension with a secret
  const comment = 'BURAN_GIF_COMMENT_DO_NOT_LEAK';
  push(0x21, 0xfe, comment.length);
  pushText(comment);
  push(0);

  // XMP application extension
  push(0x21, 0xff, 11);
  pushText('XMP DataXMP');
  const xmp = '<x:xmpmeta>BURAN_GIF_XMP</x:xmpmeta>';
  push(xmp.length);
  pushText(xmp);
  push(0);

  // NETSCAPE looping extension (functional — must survive)
  push(0x21, 0xff, 11);
  pushText('NETSCAPE2.0');
  push(3, 1, 0, 0, 0);

  // Graphic control + image
  push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
  push(0x2c, 0, 0, 0, 0, 4, 0, 3, 0, 0x00); // image descriptor, no LCT
  push(2, 2, 0x4c, 0x01, 0); // LZW min code + one data sub-block + terminator
  push(0x3b);

  return new Uint8Array(parts).buffer;
}

describe('GIF handler', () => {
  it('detects, scans comment + XMP, keeps NETSCAPE, cleans, verifies', () => {
    const input = makeGif();
    expect(detectFormat(input)).toBe('gif');

    const scan = scanGif(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('GIF:Comment');
    expect(fields).toContain('GIF:XMP');
    expect(scan.findings.find((f) => f.field === 'GIF:Comment')?.value).toContain('DO_NOT_LEAK');
    expect(scan.preservedInfo.dimensions).toEqual({ width: 4, height: 3 });

    const clean = cleanGif(input);
    const verification = verifyGif(scan, clean);
    expect(verification.passed).toBe(true);
    expect(verification.metadataRemaining).toBe(0);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('DO_NOT_LEAK');
    expect(raw).not.toContain('xmpmeta');
    expect(raw).toContain('NETSCAPE2.0'); // loop extension preserved
    expect(scanGif(clean).findings).toEqual([]);
  });

  it('does not throw on malformed input', () => {
    expect(() => scanGif(new Uint8Array([0x47, 0x49]).buffer)).not.toThrow();
    expect(scanGif(new TextEncoder().encode('GIF89a').buffer).preservedInfo.dimensions).toBeNull();
  });
});

// --------------------------------------------------------------------- BMP

function makeBmpV5Linked(): ArrayBuffer {
  const path = 'C:\\Users\\victim\\profile.icc';
  const headerSize = 14 + 124;
  const pathAt = headerSize;
  const dataOffset = pathAt + path.length + 1;
  const pixels = new Uint8Array([0, 0, 255, 0, 255, 0, 0, 0]); // 2×1 24bpp padded
  const trailing = new TextEncoder().encode('BURAN_BMP_TRAILING_SECRET');

  const out = new Uint8Array(dataOffset + pixels.length + trailing.length);
  const view = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, dataOffset, true);
  view.setUint32(14, 124, true); // BITMAPV5HEADER
  view.setInt32(18, 2, true); // width
  view.setInt32(22, 1, true); // height
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 24, true); // bpp
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixels.length, true);
  view.setUint32(14 + 56, 0x4c494e4b, true); // 'LINK'
  view.setUint32(14 + 112, pathAt - 14, true); // profile offset from DIB start
  view.setUint32(14 + 116, path.length, true);
  for (let i = 0; i < path.length; i++) out[pathAt + i] = path.charCodeAt(i);
  out.set(pixels, dataOffset);
  out.set(trailing, dataOffset + pixels.length);
  return out.buffer;
}

describe('BMP handler', () => {
  it('detects, finds linked profile path + trailing data, cleans both', () => {
    const input = makeBmpV5Linked();
    expect(detectFormat(input)).toBe('bmp');

    const scan = scanBmp(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('BMP:LinkedProfile');
    expect(fields).toContain('BMP:TrailingData');
    expect(scan.findings.find((f) => f.field === 'BMP:LinkedProfile')?.value).toContain('victim');
    expect(scan.preservedInfo.dimensions).toEqual({ width: 2, height: 1 });

    const clean = cleanBmp(input);
    const verification = verifyBmp(scan, clean);
    expect(verification.passed).toBe(true);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('victim');
    expect(raw).not.toContain('TRAILING_SECRET');
    expect(scanBmp(clean).findings).toEqual([]);
  });

  it('does not throw on malformed input', () => {
    expect(() => scanBmp(new Uint8Array([0x42, 0x4d, 0, 0]).buffer)).not.toThrow();
  });
});

// --------------------------------------------------------------------- ICO

function makeIco(pngBytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(6 + 16 + pngBytes.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  out[6] = 16; out[7] = 16; // 16×16
  view.setUint16(6 + 4, 1, true);
  view.setUint16(6 + 6, 32, true);
  view.setUint32(6 + 8, pngBytes.length, true);
  view.setUint32(6 + 12, 22, true);
  out.set(pngBytes, 22);
  return out.buffer;
}

describe('ICO handler', () => {
  it('detects, scans PNG payload metadata, cleans through the PNG core', () => {
    const png = new Uint8Array(readFixture(join(FIXTURES, 'sample.png')));
    const input = makeIco(png);
    expect(detectFormat(input)).toBe('ico');

    const scan = scanIco(input);
    expect(scan.findings.length).toBeGreaterThan(0); // sample.png carries text metadata

    const clean = cleanIco(input);
    const verification = verifyIco(scan, clean);
    expect(verification.passed).toBe(true);
    expect(scanIco(clean).findings).toEqual([]);
  });

  it('does not throw on malformed input', () => {
    expect(() => scanIco(new Uint8Array([0, 0, 1, 0, 1, 0]).buffer)).not.toThrow();
  });
});

// --------------------------------------------------------------------- AVIF

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const content = concat(parts);
  const out = new Uint8Array(8 + content.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(content, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function be16(v: number): Uint8Array { return new Uint8Array([v >> 8, v & 0xff]); }
function be32(v: number): Uint8Array { return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]); }
function ascii(s: string): Uint8Array { return new Uint8Array([...s].map((c) => c.charCodeAt(0))); }

/** Minimal AVIF: av01 primary item (id 1) + Exif item (id 2) with a Make tag. */
function makeAvif(): ArrayBuffer {
  const av01Payload = ascii('AV01PIXELDATA');
  // Exif payload: u32 tiff offset (0) + LE TIFF, 1 entry: Make (0x010f) ASCII "Spy\0" inline.
  const tiff = concat([
    ascii('II'), new Uint8Array([42, 0]), new Uint8Array([8, 0, 0, 0]),
    new Uint8Array([1, 0]), // 1 entry
    new Uint8Array([0x0f, 0x01, 2, 0]), new Uint8Array([4, 0, 0, 0]), ascii('Spy\0'),
    new Uint8Array([0, 0, 0, 0]), // next IFD
  ]);
  const exifPayload = concat([be32(0), tiff]);

  const build = (av01At: number, exifAt: number) => {
    const hdlr = box('hdlr', be32(0), be32(0), ascii('pict'), be32(0), be32(0), be32(0), new Uint8Array(1));
    const pitm = box('pitm', be32(0), be16(1));
    const iloc = box('iloc', be32(0), new Uint8Array([0x44, 0x00]), be16(2),
      be16(1), be16(0), be16(1), be32(av01At), be32(av01Payload.length),
      be16(2), be16(0), be16(1), be32(exifAt), be32(exifPayload.length));
    const infe1 = box('infe', new Uint8Array([2, 0, 0, 0]), be16(1), be16(0), ascii('av01'), new Uint8Array(1));
    const infe2 = box('infe', new Uint8Array([2, 0, 0, 0]), be16(2), be16(0), ascii('Exif'), new Uint8Array(1));
    const iinf = box('iinf', be32(0), be16(2), infe1, infe2);
    const iref = box('iref', be32(0), box('cdsc', be16(2), be16(1), be16(1)));
    const ispe = box('ispe', be32(0), be32(4), be32(3));
    const iprp = box('iprp', box('ipco', ispe));
    const metaContent = concat([be32(0), hdlr, pitm, iloc, iinf, iref, iprp]);
    const meta = box('meta', metaContent.subarray(4)); // box() adds header; version/flags already in content
    // rebuild properly: meta content starts with version/flags
    const metaBox = new Uint8Array(8 + metaContent.length);
    new DataView(metaBox.buffer).setUint32(0, metaBox.length, false);
    metaBox.set(ascii('meta'), 4);
    metaBox.set(metaContent, 8);
    void meta;
    const ftyp = box('ftyp', ascii('avif'), be32(0), ascii('avif'), ascii('mif1'));
    const mdat = box('mdat', av01Payload, exifPayload);
    return { file: concat([ftyp, metaBox, mdat]), ftypSize: ftyp.length, metaSize: metaBox.length };
  };

  // Two-pass: compute layout with dummy offsets, then rebuild with real ones.
  const dummy = build(0, 0);
  const mdatContentAt = dummy.ftypSize + dummy.metaSize + 8;
  const real = build(mdatContentAt, mdatContentAt + av01Payload.length);
  return real.file.buffer;
}

describe('AVIF handler', () => {
  it('detects, scans EXIF item (with parsed tags), cleans in place, offsets survive', () => {
    const input = makeAvif();
    expect(detectFormat(input)).toBe('avif');

    const scan = scanAvif(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('AVIF:Exif');
    expect(fields).toContain('AVIF:Camera manufacturer');
    expect(scan.preservedInfo.dimensions).toEqual({ width: 4, height: 3 });

    const clean = cleanAvif(input);
    expect(clean.byteLength).toBe(input.byteLength); // free-box padding keeps size

    const verification = verifyAvif(scan, clean);
    expect(verification.passed).toBe(true);
    expect(scanAvif(clean).findings).toEqual([]);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('Spy');
    expect(raw).toContain('AV01PIXELDATA'); // pixel payload untouched at its offset
  });

  it('does not throw on malformed input', () => {
    expect(() => scanAvif(new Uint8Array([0, 0, 0, 8]).buffer)).not.toThrow();
  });
});

// --------------------------------------------------------------------- SVG

const DIRTY_SVG = `<?xml version="1.0"?>
<!-- Made by BURAN_SVG_SECRET_AUTHOR -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd"
     width="100" height="50" inkscape:version="1.3 (secret-build)">
  <title>BURAN_SVG_TITLE</title>
  <desc>Drawn on victim-laptop</desc>
  <metadata id="m"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Secret Person</dc:creator></rdf:RDF></metadata>
  <sodipodi:namedview inkscape:window-width="1920"/>
  <rect x="1" y="1" width="98" height="48" fill="red" inkscape:label="layer1"/>
</svg>`;

describe('SVG handler', () => {
  it('detects, scans metadata/comments/editor traces, cleans, keeps drawing', () => {
    const input = new TextEncoder().encode(DIRTY_SVG).buffer as ArrayBuffer;
    expect(detectFormat(input)).toBe('svg');

    const scan = scanSvg(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('SVG:Comments');
    expect(fields).toContain('SVG:Metadata');
    expect(fields).toContain('SVG:Editor:inkscape');
    expect(fields).toContain('SVG:Title');
    expect(scan.preservedInfo.dimensions).toEqual({ width: 100, height: 50 });

    const clean = cleanSvg(input);
    const verification = verifySvg(scan, clean);
    expect(verification.passed).toBe(true);

    const text = new TextDecoder().decode(clean);
    expect(text).not.toContain('SECRET_AUTHOR');
    expect(text).not.toContain('Secret Person');
    expect(text).not.toContain('victim-laptop');
    expect(text).not.toContain('inkscape');
    expect(text).toContain('<rect'); // visible content preserved
    expect(scanSvg(clean).findings).toEqual([]);
  });

  it('refuses active content: scripts, handlers, foreignObject, entities, external refs', () => {
    const hostile = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><rect/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:evil()">x</a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.example/x.png"/></svg>',
    ];
    for (const source of hostile) {
      const buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
      expect(() => scanSvg(buffer), source.slice(0, 60)).toThrow(/активное содержимое/);
      expect(() => cleanSvg(buffer), source.slice(0, 60)).toThrow(/активное содержимое/);
    }
  });

  it('does not throw on non-SVG text', () => {
    const buffer = new TextEncoder().encode('just some text').buffer as ArrayBuffer;
    expect(() => scanSvg(buffer)).not.toThrow();
    expect(scanSvg(buffer).findings).toEqual([]);
  });
});
