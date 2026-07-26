/**
 * Wave-2 formats: OpenDocument (ODT/ODS/ODP) and EPUB.
 * Fixtures are built in-memory with JSZip; each format is verified through
 * the full contract: content-based routing, scan, sanitize, independent
 * verify, and the honest-rescan guarantee.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { scanOdf, sanitizeOdf, verifyOdf } from '../../src/lib/formats/odf';
import { scanEpub, sanitizeEpub, verifyEpub } from '../../src/lib/formats/epub';
import { getDescriptor } from '../../src/lib/formats/registry';

const S = {
  author: 'BURAN_ODF_AUTHOR_DO_NOT_LEAK',
  generator: 'SecretOffice/9.9',
  keyword: 'BURAN_ODF_KEYWORD_LEAK',
  printer: 'HP-Accounting-Floor3',
  annotator: 'BURAN_ODF_ANNOTATOR_LEAK',
  calibre: 'BURAN_CALIBRE_LIBRARY_ID',
};

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function makeOdt(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const date = new Date('2024-03-04T05:06:07Z');
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE', date });
  zip.file('META-INF/manifest.xml',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">' +
    '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/>' +
    '</manifest:manifest>', { date });
  zip.file('meta.xml',
    '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<office:meta><dc:creator>${S.author}</dc:creator><meta:initial-creator>${S.author}</meta:initial-creator>` +
    `<meta:generator>${S.generator}</meta:generator><meta:keyword>${S.keyword}</meta:keyword>` +
    '<meta:creation-date>2021-01-02T03:04:05</meta:creation-date><dc:date>2022-02-03T04:05:06</dc:date>' +
    '<meta:editing-cycles>42</meta:editing-cycles>' +
    '<meta:user-defined meta:name="Secret">custom-value-123</meta:user-defined>' +
    '<meta:document-statistic meta:page-count="1" meta:word-count="2"/></office:meta></office:document-meta>', { date });
  zip.file('settings.xml',
    '<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><office:settings><config:config-item-set>' +
    `<config:config-item config:name="PrinterName" config:type="string">${S.printer}</config:config-item>` +
    '<config:config-item config:name="PrinterSetup" config:type="base64Binary">AAECAw==</config:config-item>' +
    '</config:config-item-set></office:settings></office:document-settings>', { date });
  zip.file('content.xml',
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<office:body><office:text><text:p>Visible text stays.</text:p>' +
    `<office:annotation><dc:creator>${S.annotator}</dc:creator><dc:date>2023-05-06T07:08:09</dc:date>` +
    '<text:p>Comment body stays.</text:p></office:annotation></office:text></office:body></office:document-content>', { date });
  zip.file('Thumbnails/thumbnail.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), { date });
  return toBuffer(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

async function makeEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const date = new Date('2024-03-04T05:06:07Z');
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', date });
  zip.file('META-INF/container.xml',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', { date });
  zip.file('OEBPS/content.opf',
    '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:opf="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata>' +
    '<dc:title>A Public Book Title</dc:title><dc:creator>Famous Author</dc:creator>' +
    '<dc:identifier id="id">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>' +
    `<meta name="calibre:library_id" content="${S.calibre}"/>` +
    '<meta name="calibre:timestamp" content="2023-09-08T07:06:05+00:00"/>' +
    '<meta property="dcterms:modified">2023-10-11T12:13:14Z</meta>' +
    '<dc:contributor opf:role="bkp">calibre (7.0.0)</dc:contributor>' +
    '</metadata><manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>' +
    '<spine><itemref idref="c1"/></spine></package>', { date });
  zip.file('OEBPS/chapter1.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>The story itself stays.</p></body></html>', { date });
  return toBuffer(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

describe('OpenDocument handler', () => {
  it('routes by package mimetype from the ZIP descriptor (never the filename)', async () => {
    const input = await makeOdt();
    const outcome = await getDescriptor('zip').scan(input, 'renamed-to-archive.zip', input.byteLength);
    if (!('result' in outcome)) throw new Error('ODT unexpectedly blocked or errored');
    expect(outcome.result.format).toBe('odt');
    expect(outcome.result.odf).toBeDefined();
  });

  it('scans authors, generator, printer, annotations, thumbnail, dates', async () => {
    const outcome = await scanOdf(await makeOdt());
    if ('blocked' in outcome) throw new Error(outcome.message);
    const fields = outcome.data.findings.map((f) => f.field);
    expect(fields).toContain('ODF:dc:creator');
    expect(fields).toContain('ODF:meta:generator');
    expect(fields).toContain('ODF:printer');
    expect(fields).toContain('ODF:annotationAuthor');
    expect(fields).toContain('ODF:thumbnail');
    expect(fields).toContain('ODF:meta:creation-date');
    expect(fields).toContain('ODF:user:Secret');
    expect(fields).toContain('ODF:zipTimestamps');
  });

  it('cleans, passes independent verification, and re-scans clean', async () => {
    const input = await makeOdt();
    const scan = await scanOdf(input);
    if ('blocked' in scan) throw new Error(scan.message);

    const clean = await sanitizeOdf(input);
    const v = await verifyOdf(scan.data, clean);
    expect(v.verificationPassed).toBe(true);
    expect(v.metaCleared).toBe(true);
    expect(v.thumbnailRemoved).toBe(true);
    expect(v.printerRemoved).toBe(true);
    expect(v.mimetypePreserved).toBe(true);
    expect(v.personalMetadataRemaining).toBe(0);

    // The visible document and annotation bodies survive.
    const zip = await JSZip.loadAsync(clean);
    const content = await zip.file('content.xml')!.async('string');
    expect(content).toContain('Visible text stays.');
    expect(content).toContain('Comment body stays.');
    expect(content).toContain('Anonymous');

    // Honest re-scan: nothing left to remove.
    const rescan = await scanOdf(clean);
    if ('blocked' in rescan) throw new Error(rescan.message);
    expect(rescan.data.findings).toEqual([]);
  });

  it('blocks encrypted and macro documents honestly', async () => {
    const encrypted = new JSZip();
    encrypted.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    encrypted.file('META-INF/manifest.xml', '<manifest:manifest><manifest:encryption-data/></manifest:manifest>');
    encrypted.file('content.xml', '<x/>');
    const e = await scanOdf(toBuffer(await encrypted.generateAsync({ type: 'uint8array' })));
    expect('blocked' in e && e.reason).toBe('encrypted');

    const macro = new JSZip();
    macro.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    macro.file('META-INF/manifest.xml', '<manifest:manifest/>');
    macro.file('content.xml', '<x/>');
    macro.file('Basic/Standard/Module1.xml', '<script/>');
    const m = await scanOdf(toBuffer(await macro.generateAsync({ type: 'uint8array' })));
    expect('blocked' in m && m.reason).toBe('macro');
  });
});

describe('EPUB handler', () => {
  it('routes by package mimetype from the ZIP descriptor', async () => {
    const input = await makeEpub();
    const outcome = await getDescriptor('zip').scan(input, 'book.zip', input.byteLength);
    if (!('result' in outcome)) throw new Error('EPUB unexpectedly blocked or errored');
    expect(outcome.result.format).toBe('epub');
  });

  it('scans library fingerprints but leaves the bibliography alone', async () => {
    const outcome = await scanEpub(await makeEpub());
    if ('blocked' in outcome) throw new Error(outcome.message);
    const fields = outcome.data.findings.map((f) => f.field);
    expect(fields).toContain('EPUB:calibre:library_id');
    expect(fields).toContain('EPUB:modified');
    expect(fields).toContain('EPUB:producer');
    // Title/author/identifier are the book's content, not leaked metadata.
    expect(fields.join()).not.toMatch(/title|creator|identifier/i);
  });

  it('cleans fingerprints, keeps the book, verifies, re-scans clean', async () => {
    const input = await makeEpub();
    const scan = await scanEpub(input);
    if ('blocked' in scan) throw new Error(scan.message);

    const clean = await sanitizeEpub(input);
    const v = await verifyEpub(scan.data, clean);
    expect(v.verificationPassed).toBe(true);
    expect(v.fingerprintsRemoved).toBe(true);
    expect(v.mimetypePreserved).toBe(true);

    const zip = await JSZip.loadAsync(clean);
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('A Public Book Title');
    expect(opf).toContain('Famous Author');
    expect(opf).toContain('urn:uuid:11111111');
    expect(opf).not.toContain('calibre');
    expect(opf).not.toContain('dcterms:modified');

    const rescan = await scanEpub(clean);
    if ('blocked' in rescan) throw new Error(rescan.message);
    expect(rescan.data.findings).toEqual([]);
  });

  it('blocks DRM-protected books honestly', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<container/>');
    zip.file('META-INF/encryption.xml', '<encryption/>');
    const outcome = await scanEpub(toBuffer(await zip.generateAsync({ type: 'uint8array' })));
    expect('blocked' in outcome && outcome.reason).toBe('encrypted');
  });
});
