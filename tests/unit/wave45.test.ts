/**
 * Wave-4/5 formats: AVI, MKV/WebM, OGG/Opus, RTF, PSD, EML.
 * Contract per format: scan finds planted metadata → clean removes it with
 * the payload byte-identical → verify passes → re-scan clean.
 */
import { describe, it, expect } from 'vitest';
import { detectFormat } from '../../src/lib/formats/registry';
import { scanAvi, cleanAvi, verifyAvi, aviMediaRegion } from '../../src/lib/formats/avi';
import { scanMkv, cleanMkv, verifyMkv } from '../../src/lib/formats/mkv';
import { scanOgg, cleanOgg, verifyOgg } from '../../src/lib/formats/ogg';
import { scanRtf, cleanRtf, verifyRtf } from '../../src/lib/formats/rtf';
import { scanPsd, cleanPsd, verifyPsd, psdImageRegion } from '../../src/lib/formats/psd';
import { scanEml, cleanEml, verifyEml } from '../../src/lib/formats/eml';

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// --------------------------------------------------------------------- AVI

function riffChunk(id: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length % 2 === 1 ? concat([payload, new Uint8Array(1)]) : payload;
  const out = new Uint8Array(8 + padded.length);
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(padded, 8);
  return out;
}

function makeAvi(): ArrayBuffer {
  const hdrl = riffChunk('LIST', concat([ascii('hdrl'), riffChunk('avih', new Uint8Array(56))]));
  const info = riffChunk('LIST', concat([
    ascii('INFO'),
    riffChunk('ISFT', ascii('SecretCam Studio 5\0')),
    riffChunk('IART', ascii('BURAN_AVI_ARTIST_LEAK\0')),
  ]));
  const idit = riffChunk('IDIT', ascii('SAT MAY 04 12:34:56 2024\0'));
  const movi = riffChunk('LIST', concat([ascii('movi'), riffChunk('00dc', ascii('FAKE_VIDEO_FRAME'))]));
  const idx1 = riffChunk('idx1', new Uint8Array(16));
  const body = concat([ascii('AVI '), hdrl, info, idit, movi, idx1]);
  const out = new Uint8Array(8 + body.length);
  out.set(ascii('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out.buffer;
}

describe('AVI handler', () => {
  it('detects, scans INFO + capture date, cleans in place, movi untouched', () => {
    const input = makeAvi();
    expect(detectFormat(input)).toBe('avi');

    const scan = scanAvi(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('AVI:ISFT');
    expect(fields).toContain('AVI:IART');
    expect(fields).toContain('AVI:IDIT');

    const clean = cleanAvi(input);
    expect(clean.byteLength).toBe(input.byteLength); // in-place JUNK-ing
    expect(verifyAvi(scan, clean).passed).toBe(true);
    expect(scanAvi(clean).findings).toEqual([]);
    expect(Buffer.from(aviMediaRegion(clean)).equals(Buffer.from(aviMediaRegion(input)))).toBe(true);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).not.toContain('SecretCam');
    expect(raw).toContain('FAKE_VIDEO_FRAME');
  });
});

// --------------------------------------------------------------------- MKV

/** EBML element with a known-width id and 1- or 2-byte size varint. */
function ebml(id: number[], payload: Uint8Array): Uint8Array {
  const size =
    payload.length <= 126
      ? new Uint8Array([0x80 | payload.length])
      : new Uint8Array([0x40 | (payload.length >> 8), payload.length & 0xff]);
  if (payload.length > 16382) throw new Error('test element too large');
  return concat([new Uint8Array(id), size, payload]);
}

function makeMkv(): ArrayBuffer {
  const header = ebml([0x1a, 0x45, 0xdf, 0xa3], concat([
    ebml([0x42, 0x82], ascii('matroska')), // DocType
  ]));
  const info = ebml([0x15, 0x49, 0xa9, 0x66], concat([
    ebml([0x7b, 0xa9], ascii('BURAN_MKV_TITLE_LEAK')), // Title
    ebml([0x4d, 0x80], ascii('SecretMuxer 1.0')), // MuxingApp
    ebml([0x57, 0x41], ascii('SecretWriter 2.0')), // WritingApp
    ebml([0x44, 0x61], new Uint8Array(8)), // DateUTC
  ]));
  const tags = ebml([0x12, 0x54, 0xc3, 0x67], ascii('faketags-BURAN_MKV_TAG_LEAK'));
  const cluster = ebml([0x1f, 0x43, 0xb6, 0x75], ascii('FAKE_CLUSTER_MEDIA'));
  const segment = ebml([0x18, 0x53, 0x80, 0x67], concat([info, tags, cluster]));
  return concat([header, segment]).buffer;
}

describe('MKV/WebM handler', () => {
  it('detects, scans title/apps/date/tags, voids in place, clusters untouched', () => {
    const input = makeMkv();
    expect(detectFormat(input)).toBe('mkv');

    const scan = scanMkv(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('MKV:Title');
    expect(fields).toContain('MKV:MuxingApp');
    expect(fields).toContain('MKV:DateUTC');
    expect(fields).toContain('MKV:Tags');

    const clean = cleanMkv(input);
    expect(clean.byteLength).toBe(input.byteLength); // voiding keeps sizes
    expect(verifyMkv(scan, clean).passed).toBe(true);
    expect(scanMkv(clean).findings).toEqual([]);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).not.toContain('Secret');
    expect(raw).toContain('FAKE_CLUSTER_MEDIA');
  });
});

// --------------------------------------------------------------------- OGG

function oggPage(headerType: number, pageNo: number, packets: Uint8Array[]): Uint8Array {
  const segmentTable: number[] = [];
  for (const p of packets) {
    let remaining = p.length;
    for (;;) {
      if (remaining >= 255) { segmentTable.push(255); remaining -= 255; }
      else { segmentTable.push(remaining); break; }
    }
  }
  const body = concat(packets);
  const page = new Uint8Array(27 + segmentTable.length + body.length);
  page.set(ascii('OggS'), 0);
  page[5] = headerType;
  new DataView(page.buffer).setUint32(18, pageNo, true);
  page[26] = segmentTable.length;
  page.set(segmentTable, 27);
  page.set(body, 27 + segmentTable.length);
  // CRC left zero in fixtures; the parser does not validate it.
  return page;
}

function makeOpus(): ArrayBuffer {
  const head = concat([ascii('OpusHead'), new Uint8Array([1, 2, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0])]);
  const le32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
  const vendor = ascii('SecretOpusEncoder');
  const fields = ['ARTIST=BURAN_OGG_ARTIST_LEAK', 'LOCATION=Lviv'];
  const tags = concat([
    ascii('OpusTags'), le32(vendor.length), vendor, le32(fields.length),
    ...fields.flatMap((f) => [le32(f.length), ascii(f)]),
  ]);
  const audio = ascii('FAKE_OPUS_AUDIO_PACKET');
  return concat([
    oggPage(0x02, 0, [head]),
    oggPage(0x00, 1, [tags]),
    oggPage(0x04, 2, [audio]),
  ]).buffer;
}

describe('OGG/Opus handler', () => {
  it('detects, scans comments, cleans with recomputed CRC, audio untouched', () => {
    const input = makeOpus();
    expect(detectFormat(input)).toBe('ogg');

    const scan = scanOgg(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('OGG:ARTIST');
    expect(fields).toContain('OGG:LOCATION');
    expect(fields).toContain('OGG:vendor');

    const clean = cleanOgg(input);
    expect(verifyOgg(scan, clean).passed).toBe(true);
    expect(scanOgg(clean).findings).toEqual([]);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).not.toContain('SecretOpus');
    expect(raw).not.toContain('Lviv');
    expect(raw).toContain('FAKE_OPUS_AUDIO_PACKET');
    expect(raw).toContain('OpusTags'); // emptied header packet still present
  });
});

// --------------------------------------------------------------------- RTF

const DIRTY_RTF = String.raw`{\rtf1\ansi\deff0
{\info{\author BURAN_RTF_AUTHOR_LEAK}{\operator BURAN_RTF_OPERATOR_LEAK}{\company Secret Corp}
{\creatim\yr2024\mo5\dy6\hr12\min34}{\revtim\yr2024\mo6\dy7}\edmins42}
{\*\generator SecretWriter 11.0.123;}
\pard Visible {\b bold} document text.\par
}`;

describe('RTF handler', () => {
  it('detects, scans info group + generator, cleans, keeps visible text', () => {
    const input = new TextEncoder().encode(DIRTY_RTF).buffer as ArrayBuffer;
    expect(detectFormat(input)).toBe('rtf');

    const scan = scanRtf(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('RTF:author');
    expect(fields).toContain('RTF:company');
    expect(fields).toContain('RTF:creatim');
    expect(fields).toContain('RTF:generator');
    expect(scan.findings.find((f) => f.field === 'RTF:creatim')?.value).toBe('2024-05-06');

    const clean = cleanRtf(input);
    expect(verifyRtf(scan, clean).passed).toBe(true);
    expect(scanRtf(clean).findings).toEqual([]);

    const text = new TextDecoder().decode(clean);
    expect(text).not.toContain('LEAK');
    expect(text).not.toContain('Secret');
    expect(text).toContain('Visible {\\b bold} document text.');
  });
});

// --------------------------------------------------------------------- PSD

function psdResource(id: number, payload: Uint8Array): Uint8Array {
  const padded = payload.length % 2 === 1 ? concat([payload, new Uint8Array(1)]) : payload;
  const out = new Uint8Array(4 + 2 + 2 + 4 + padded.length);
  out.set(ascii('8BIM'), 0);
  const view = new DataView(out.buffer);
  view.setUint16(4, id, false);
  // empty pascal name: length 0 + pad → 2 bytes
  view.setUint32(8, payload.length, false);
  out.set(padded, 12);
  return out;
}

function makePsd(): ArrayBuffer {
  const header = new Uint8Array(26);
  header.set(ascii('8BPS'), 0);
  const view = new DataView(header.buffer);
  view.setUint16(4, 1, false); // version
  view.setUint16(12, 3, false); // channels
  view.setUint32(14, 10, false); // height
  view.setUint32(18, 20, false); // width
  view.setUint16(22, 8, false); // depth
  view.setUint16(24, 3, false); // RGB

  const resources = concat([
    psdResource(0x0404, ascii('BURAN_PSD_IPTC_LEAK')),
    psdResource(0x0424, ascii('<x:xmpmeta>BURAN_PSD_XMP_LEAK</x:xmpmeta>')),
    psdResource(0x040f, ascii('FAKE_ICC_PROFILE')), // kept
    psdResource(0x03ed, new Uint8Array(16)), // resolution info, kept
  ]);
  const colourData = new Uint8Array(4); // length 0
  const resHeader = new Uint8Array(4);
  new DataView(resHeader.buffer).setUint32(0, resources.length, false);
  const layers = new Uint8Array(4); // empty layers section
  const pixels = ascii('FAKE_PSD_PIXEL_DATA');
  return concat([header, colourData, resHeader, resources, layers, pixels]).buffer;
}

describe('PSD handler', () => {
  it('detects, scans IPTC/XMP, cleans keeping ICC + pixels', () => {
    const input = makePsd();
    expect(detectFormat(input)).toBe('psd');

    const scan = scanPsd(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('PSD:0x404');
    expect(fields).toContain('PSD:0x424');
    expect(scan.preservedInfo.hasIccProfile).toBe(true);
    expect(scan.preservedInfo.dimensions).toEqual({ width: 20, height: 10 });

    const clean = cleanPsd(input);
    expect(verifyPsd(scan, clean).passed).toBe(true);
    expect(scanPsd(clean).findings).toEqual([]);
    expect(Buffer.from(psdImageRegion(clean)).equals(Buffer.from(psdImageRegion(input)))).toBe(true);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).toContain('FAKE_ICC_PROFILE');
    expect(raw).toContain('FAKE_PSD_PIXEL_DATA');
  });
});

// --------------------------------------------------------------------- EML

const DIRTY_EML = [
  'Return-Path: <sender@example.com>',
  'Received: from mail-relay1.example.com (mail-relay1.example.com [203.0.113.7])',
  '\tby mx.example.net with ESMTPS id abc123',
  '\tfor <receiver@example.net>; Mon, 06 May 2024 12:34:56 +0000',
  'Received: from [192.168.1.42] (home-router.example [198.51.100.9])',
  '\tby mail-relay1.example.com; Mon, 06 May 2024 12:34:50 +0000',
  'X-Originating-IP: [198.51.100.9]',
  'Message-ID: <BURAN-UNIQUE-CORRELATION-ID@example.com>',
  'X-Mailer: SecretMail Client 7.2',
  'From: Sender <sender@example.com>',
  'To: Receiver <receiver@example.net>',
  'Subject: Quarterly report',
  'Date: Mon, 06 May 2024 12:34:45 +0000',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hello! The report is attached.',
  '',
].join('\r\n');

describe('EML handler', () => {
  it('detects, scans relay IPs + client + Message-ID, cleans, keeps the message', () => {
    const input = new TextEncoder().encode(DIRTY_EML).buffer as ArrayBuffer;
    expect(detectFormat(input)).toBe('eml');

    const scan = scanEml(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('EML:received');
    expect(fields).toContain('EML:x-originating-ip');
    expect(fields).toContain('EML:x-mailer');
    expect(fields).toContain('EML:message-id');
    expect(scan.findings.find((f) => f.field === 'EML:received')?.value).toContain('198.51.100.9');

    const clean = cleanEml(input);
    expect(verifyEml(scan, clean).passed).toBe(true);
    expect(scanEml(clean).findings).toEqual([]);

    const text = new TextDecoder().decode(clean);
    expect(text).not.toContain('Received:');
    expect(text).not.toContain('198.51.100.9');
    expect(text).not.toContain('SecretMail');
    expect(text).not.toContain('BURAN-UNIQUE-CORRELATION-ID');
    expect(text).toContain('From: Sender <sender@example.com>');
    expect(text).toContain('Subject: Quarterly report');
    expect(text).toContain('Hello! The report is attached.');
  });

  it('does not misdetect plain text as EML', () => {
    const plain = new TextEncoder().encode('just a note\nabout things\nnothing more').buffer as ArrayBuffer;
    expect(detectFormat(plain)).toBeNull();
  });
});
