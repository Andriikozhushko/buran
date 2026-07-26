/**
 * Wave-3 formats: MP3, FLAC, WAV, MP4/M4A/MOV.
 * Contract per format: scan finds planted metadata → clean removes it with
 * the audio/video bitstream byte-identical → verify passes → re-scan clean.
 */
import { describe, it, expect } from 'vitest';
import { detectFormat } from '../../src/lib/formats/registry';
import { scanMp3, cleanMp3, verifyMp3, mp3AudioRegion } from '../../src/lib/formats/mp3';
import { scanFlac, cleanFlac, verifyFlac, flacAudioRegion } from '../../src/lib/formats/flac';
import { scanWav, cleanWav, verifyWav, wavAudioRegion } from '../../src/lib/formats/wav';
import { scanMp4, cleanMp4, verifyMp4, mp4MediaRegion } from '../../src/lib/formats/mp4';

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// --------------------------------------------------------------------- MP3

/** MPEG frame header (MPEG1 Layer3 128kbps 44.1kHz) + fake payload. */
const MP3_AUDIO = concat([new Uint8Array([0xff, 0xfb, 0x90, 0x00]), ascii('FAKE_MP3_AUDIO_PAYLOAD_BYTES')]);

function id3v2Frame(id: string, text: string): Uint8Array {
  const payload = concat([new Uint8Array([3]), ascii(text)]); // UTF-8 encoding byte
  const out = new Uint8Array(10 + payload.length);
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length, false);
  out.set(payload, 10);
  return out;
}

function makeMp3(): ArrayBuffer {
  const frames = concat([
    id3v2Frame('TPE1', 'BURAN_MP3_ARTIST_LEAK'),
    id3v2Frame('TENC', 'BURAN_MP3_ENCODER_LEAK'),
    id3v2Frame('TDRC', '2024-05-06T07:08:09'),
    id3v2Frame('COMM', 'engBURAN_MP3_COMMENT_LEAK'),
  ]);
  const header = new Uint8Array(10);
  header.set(ascii('ID3'), 0);
  header[3] = 4; // v2.4
  // syncsafe size
  header[6] = (frames.length >> 21) & 0x7f;
  header[7] = (frames.length >> 14) & 0x7f;
  header[8] = (frames.length >> 7) & 0x7f;
  header[9] = frames.length & 0x7f;

  const id3v1 = new Uint8Array(128);
  id3v1.set(ascii('TAG'), 0);
  id3v1.set(ascii('BURAN_V1_TITLE'), 3);
  id3v1.set(ascii('BURAN_V1_ARTIST'), 33);

  return concat([header, frames, MP3_AUDIO, id3v1]).buffer;
}

describe('MP3 handler', () => {
  it('detects, scans ID3v2 + ID3v1, cleans, audio bytes identical', () => {
    const input = makeMp3();
    expect(detectFormat(input)).toBe('mp3');

    const scan = scanMp3(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('MP3:TPE1');
    expect(fields).toContain('MP3:TENC');
    expect(fields).toContain('MP3:ID3v1');
    expect(scan.findings.find((f) => f.field === 'MP3:TPE1')?.value).toBe('BURAN_MP3_ARTIST_LEAK');

    const clean = cleanMp3(input);
    expect(verifyMp3(scan, clean).passed).toBe(true);
    expect(scanMp3(clean).findings).toEqual([]);

    expect(Buffer.from(mp3AudioRegion(clean)).equals(Buffer.from(mp3AudioRegion(input)))).toBe(true);
    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).toContain('FAKE_MP3_AUDIO_PAYLOAD_BYTES');
  });

  it('detects a bare MPEG stream without tags and cleans to identity', () => {
    const input = MP3_AUDIO.slice().buffer as ArrayBuffer;
    expect(detectFormat(input)).toBe('mp3');
    expect(scanMp3(input).findings).toEqual([]);
    expect(new Uint8Array(cleanMp3(input)).length).toBe(MP3_AUDIO.length);
  });
});

// --------------------------------------------------------------------- FLAC

function flacBlock(type: number, payload: Uint8Array, last = false): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out[0] = type | (last ? 0x80 : 0);
  out[1] = (payload.length >> 16) & 0xff;
  out[2] = (payload.length >> 8) & 0xff;
  out[3] = payload.length & 0xff;
  out.set(payload, 4);
  return out;
}

function vorbisComment(): Uint8Array {
  const vendor = ascii('SecretEncoder 1.0');
  const fields = ['ARTIST=BURAN_FLAC_ARTIST_LEAK', 'LOCATION=Kyiv, Ukraine', 'ENCODED_BY=BURAN_FLAC_ENCODER_LEAK'];
  const parts: Uint8Array[] = [];
  const le32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return b;
  };
  parts.push(le32(vendor.length), vendor, le32(fields.length));
  for (const field of fields) {
    const bytes = ascii(field);
    parts.push(le32(bytes.length), bytes);
  }
  return concat(parts);
}

function makeFlac(): ArrayBuffer {
  const streaminfo = new Uint8Array(34); // zeros are fine structurally for tests
  const audio = ascii('FAKE_FLAC_FRAMES_PAYLOAD');
  return concat([
    ascii('fLaC'),
    flacBlock(0, streaminfo),
    flacBlock(4, vorbisComment()),
    flacBlock(6, ascii('fake-picture-block'), true),
    audio,
  ]).buffer;
}

describe('FLAC handler', () => {
  it('detects, scans vorbis comments + picture, cleans, audio identical', () => {
    const input = makeFlac();
    expect(detectFormat(input)).toBe('flac');

    const scan = scanFlac(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('FLAC:ARTIST');
    expect(fields).toContain('FLAC:LOCATION');
    expect(fields).toContain('FLAC:vendor');
    expect(fields).toContain('FLAC:picture');
    expect(scan.findings.find((f) => f.field === 'FLAC:LOCATION')?.value).toContain('Kyiv');

    const clean = cleanFlac(input);
    expect(verifyFlac(scan, clean).passed).toBe(true);
    expect(scanFlac(clean).findings).toEqual([]);
    expect(Buffer.from(flacAudioRegion(clean)).equals(Buffer.from(flacAudioRegion(input)))).toBe(true);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).not.toContain('Kyiv');
  });
});

// --------------------------------------------------------------------- WAV

function wavChunk(id: string, payload: Uint8Array): Uint8Array {
  const padded = payload.length % 2 === 1 ? concat([payload, new Uint8Array(1)]) : payload;
  const out = new Uint8Array(8 + padded.length);
  out.set(ascii(id), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(padded, 8);
  return out;
}

function makeWav(): ArrayBuffer {
  const fmt = new Uint8Array(16);
  new DataView(fmt.buffer).setUint16(0, 1, true); // PCM
  const data = ascii('FAKE_WAV_SAMPLES');
  const info = concat([
    ascii('INFO'),
    wavChunk('IART', ascii('BURAN_WAV_ARTIST_LEAK\0')),
    wavChunk('ISFT', ascii('SecretRecorder 2.0\0')),
    wavChunk('ICRD', ascii('2024-05-06\0')),
  ]);
  const bext = new Uint8Array(602);
  bext.set(ascii('Recorded at BURAN_WAV_STUDIO_LEAK'), 0);
  bext.set(ascii('OriginatorX'), 256);

  const body = concat([
    ascii('WAVE'),
    wavChunk('fmt ', fmt),
    wavChunk('bext', bext),
    wavChunk('data', data),
    wavChunk('LIST', info),
  ]);
  const out = new Uint8Array(8 + body.length);
  out.set(ascii('RIFF'), 0);
  new DataView(out.buffer).setUint32(4, body.length, true);
  out.set(body, 8);
  return out.buffer;
}

describe('WAV handler', () => {
  it('detects, scans INFO + bext, cleans, samples identical', () => {
    const input = makeWav();
    expect(detectFormat(input)).toBe('wav');

    const scan = scanWav(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('WAV:IART');
    expect(fields).toContain('WAV:ISFT');
    expect(fields).toContain('WAV:bext');
    expect(scan.findings.find((f) => f.field === 'WAV:bext')?.value).toContain('STUDIO');

    const clean = cleanWav(input);
    expect(verifyWav(scan, clean).passed).toBe(true);
    expect(scanWav(clean).findings).toEqual([]);
    expect(Buffer.from(wavAudioRegion(clean)).equals(Buffer.from(wavAudioRegion(input)))).toBe(true);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('LEAK');
    expect(raw).toContain('FAKE_WAV_SAMPLES');
  });
});

// --------------------------------------------------------------------- MP4

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const content = concat(parts);
  const out = new Uint8Array(8 + content.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  out.set(ascii(type), 4);
  out.set(content, 8);
  return out;
}

function be32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, false);
  return b;
}

function qtAtom(type: string, text: string): Uint8Array {
  const payload = ascii(text);
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint16(0, payload.length, false);
  return box(type, head, payload);
}

function makeMp4(): ArrayBuffer {
  const creation = 3800000000; // seconds since 1904 → some 2024 date
  const mvhd = box('mvhd', new Uint8Array(4), be32(creation), be32(creation), be32(1000), be32(5000), new Uint8Array(80));
  const tkhd = box('tkhd', new Uint8Array(4), be32(creation), be32(creation), new Uint8Array(72));
  const mdhd = box('mdhd', new Uint8Array(4), be32(creation), be32(creation), be32(1000), be32(5000), new Uint8Array(4));
  const udta = box('udta', qtAtom('©xyz', '+50.4501+030.5234/'), qtAtom('©too', 'SecretPhone Camera 12'));
  const trak = box('trak', tkhd, box('mdia', mdhd));
  const moov = box('moov', mvhd, trak, udta);
  const ftyp = box('ftyp', ascii('isom'), be32(0), ascii('isom'), ascii('mp41'));
  const mdat = box('mdat', ascii('FAKE_H264_BITSTREAM_PAYLOAD'));
  return concat([ftyp, moov, mdat]).buffer;
}

describe('MP4/M4A/MOV handler', () => {
  it('detects, scans GPS + tool + dates, cleans in place, mdat untouched', () => {
    const input = makeMp4();
    expect(detectFormat(input)).toBe('mp4');

    const scan = scanMp4(input);
    const fields = scan.findings.map((f) => f.field);
    expect(fields).toContain('MP4:cxyz');
    expect(fields).toContain('MP4:ctoo');
    expect(fields).toContain('MP4:created');
    expect(scan.findings.find((f) => f.field === 'MP4:cxyz')?.value).toContain('+50.4501');

    const clean = cleanMp4(input);
    expect(clean.byteLength).toBe(input.byteLength); // in-place: size never changes

    expect(verifyMp4(scan, clean).passed).toBe(true);
    expect(scanMp4(clean).findings).toEqual([]);

    const cleanMedia = mp4MediaRegion(clean);
    const origMedia = mp4MediaRegion(input);
    expect(cleanMedia.length).toBe(origMedia.length);
    expect(Buffer.from(cleanMedia[0]).equals(Buffer.from(origMedia[0]))).toBe(true);

    const raw = new TextDecoder('latin1').decode(new Uint8Array(clean));
    expect(raw).not.toContain('+50.4501');
    expect(raw).not.toContain('SecretPhone');
    expect(raw).toContain('FAKE_H264_BITSTREAM_PAYLOAD');
  });

  it('does not throw on malformed input', () => {
    expect(() => scanMp4(new Uint8Array([0, 0, 0, 8]).buffer)).not.toThrow();
    expect(() => scanMp3(new Uint8Array([0x49, 0x44]).buffer)).not.toThrow();
    expect(() => scanFlac(new Uint8Array([0x66, 0x4c]).buffer)).not.toThrow();
    expect(() => scanWav(new Uint8Array([0x52, 0x49]).buffer)).not.toThrow();
  });
});
