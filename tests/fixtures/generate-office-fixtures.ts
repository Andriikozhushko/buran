/**
 * Synthetic Office (OOXML) fixture generator for BURAN (milestone 02B).
 *
 * Every fixture contains ONLY fake metadata with `BURAN_TEST_*_DO_NOT_LEAK`
 * sentinels — never any private document. Packages are minimal but well-formed
 * OOXML built with JSZip, each carrying an embedded PNG that itself contains a
 * fake metadata sentinel so the embedded-image sanitisation path is exercised.
 *
 * Usage: npx tsx tests/fixtures/generate-office-fixtures.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';

const DIR = join(import.meta.dirname || __dirname);

// --- Sentinels (must never survive sanitisation) ---
export const S = {
  author: 'BURAN_TEST_AUTHOR_DO_NOT_LEAK',
  lastMod: 'BURAN_TEST_LASTMODBY_DO_NOT_LEAK',
  title: 'BURAN_TEST_TITLE_DO_NOT_LEAK',
  subject: 'BURAN_TEST_SUBJECT_DO_NOT_LEAK',
  keywords: 'BURAN_TEST_KEYWORDS_DO_NOT_LEAK',
  company: 'BURAN_TEST_COMPANY_DO_NOT_LEAK',
  manager: 'BURAN_TEST_MANAGER_DO_NOT_LEAK',
  app: 'BURAN_TEST_APP_DO_NOT_LEAK',
  template: 'BURAN_TEST_TEMPLATE_DO_NOT_LEAK',
  custom: 'BURAN_TEST_CUSTOMPROP_DO_NOT_LEAK',
  commentAuthor: 'BURAN_TEST_COMMENTAUTHOR_DO_NOT_LEAK',
  commentInitials: 'BTC',
  revAuthor: 'BURAN_TEST_REVAUTHOR_DO_NOT_LEAK',
  imageMeta: 'BURAN_TEST_GPS_DO_NOT_LEAK',
  created: '2021-06-15T13:30:00Z',
  modified: '2022-07-16T14:31:00Z',
};

/** The visible comment body must survive sanitisation. */
const COMMENT_BODY = 'Visible comment body stays';

// ---------------------------------------------------------------------------
// Embedded PNG carrying a fake metadata sentinel (tEXt chunk)
// ---------------------------------------------------------------------------
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crc]);
}
function makeSentinelPng(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0; // grayscale
  const text = Buffer.from(`Author\0${S.imageMeta}`, 'latin1');
  const idat = Buffer.from([0x78, 0x01, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', text),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Shared metadata parts
// ---------------------------------------------------------------------------
const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${S.title}</dc:title>
<dc:subject>${S.subject}</dc:subject>
<dc:creator>${S.author}</dc:creator>
<cp:keywords>${S.keywords}</cp:keywords>
<dc:description>desc ${S.author}</dc:description>
<cp:lastModifiedBy>${S.lastMod}</cp:lastModifiedBy>
<cp:revision>7</cp:revision>
<dcterms:created xsi:type="dcterms:W3CDTF">${S.created}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${S.modified}</dcterms:modified>
<cp:category>SecretCategory</cp:category>
</cp:coreProperties>`;

function appXml(application: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>${application}</Application>
<AppVersion>16.0000</AppVersion>
<Company>${S.company}</Company>
<Manager>${S.manager}</Manager>
<Template>${S.template}</Template>
</Properties>`;
}

const customXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="SecretField"><vt:lpwstr>${S.custom}</vt:lpwstr></property>
</Properties>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="OFFICEDOC"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/>
</Relationships>`;

const FIXED = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));

async function zipOf(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content, { date: new Date(Date.UTC(2021, 5, 15, 13, 30, 0)) });
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------
function docxEntries(extra: Record<string, string | Buffer> = {}): Record<string, string | Buffer> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Visible document text stays intact.</w:t></w:r></w:p>
<w:p>
<w:ins w:id="1" w:author="${S.revAuthor}" w:date="${S.created}"><w:r><w:t>inserted text</w:t></w:r></w:ins>
<w:del w:id="2" w:author="${S.revAuthor}" w:date="${S.created}"><w:r><w:delText>deleted text</w:delText></w:r></w:del>
</w:p>
<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>commented</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
</w:body>
</w:document>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

  const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:comment w:id="0" w:author="${S.commentAuthor}" w:date="${S.created}" w:initials="${S.commentInitials}">
<w:p><w:r><w:t>${COMMENT_BODY}</w:t></w:r></w:p>
</w:comment>
</w:comments>`;

  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:rsids><w:rsidRoot w:val="00ABCDEF"/><w:rsid w:val="00ABCDEF"/><w:rsid w:val="00123456"/></w:rsids>
</w:settings>`;

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels.replace('OFFICEDOC', 'word/document.xml'),
    'word/document.xml': document,
    'word/_rels/document.xml.rels': documentRels,
    'word/comments.xml': comments,
    'word/settings.xml': settings,
    'word/media/image1.png': makeSentinelPng(),
    'docProps/core.xml': coreXml,
    'docProps/app.xml': appXml(S.app),
    'docProps/custom.xml': customXml,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------
function xlsxEntries(extra: Record<string, string | Buffer> = {}): Record<string, string | Buffer> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="str"><v>Visible cell value</v></c><c r="B1"><f>A1</f><v>0</v></c></row></sheetData>
</worksheet>`;

  const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

  const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<authors><author>${S.commentAuthor}</author><author>${S.lastMod}</author></authors>
<commentList>
<comment ref="A1" authorId="0"><text><r><t>${COMMENT_BODY}</t></r></text></comment>
<comment ref="B1" authorId="1"><text><r><t>second ${COMMENT_BODY}</t></r></text></comment>
</commentList>
</comments>`;

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels.replace('OFFICEDOC', 'xl/workbook.xml'),
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/worksheets/_rels/sheet1.xml.rels': sheetRels,
    'xl/comments1.xml': comments,
    'xl/media/image1.png': makeSentinelPng(),
    'docProps/core.xml': coreXml,
    'docProps/app.xml': appXml(S.app),
    'docProps/custom.xml': customXml,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------
function pptxEntries(extra: Record<string, string | Buffer> = {}): Record<string, string | Buffer> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/commentAuthors.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml"/>
<Override PartName="/ppt/comments/comment1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.comments+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>
</Types>`;

  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>`;

  const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors" Target="commentAuthors.xml"/>
</Relationships>`;

  const slide = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Visible slide text stays</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`;

  const slideRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/comment1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

  const commentAuthors = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmAuthorLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cmAuthor id="0" name="${S.commentAuthor}" initials="${S.commentInitials}" lastIdx="1" clrIdx="0"/>
</p:cmAuthorLst>`;

  const comment1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cm authorId="0" dt="${S.created}" idx="1"><p:pos x="100" y="100"/><p:text>${COMMENT_BODY}</p:text></p:cm>
</p:cmLst>`;

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels.replace('OFFICEDOC', 'ppt/presentation.xml'),
    'ppt/presentation.xml': presentation,
    'ppt/_rels/presentation.xml.rels': presentationRels,
    'ppt/slides/slide1.xml': slide,
    'ppt/slides/_rels/slide1.xml.rels': slideRels,
    'ppt/commentAuthors.xml': commentAuthors,
    'ppt/comments/comment1.xml': comment1,
    'ppt/media/image1.png': makeSentinelPng(),
    'docProps/core.xml': coreXml,
    'docProps/app.xml': appXml(S.app),
    'docProps/custom.xml': customXml,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// A minimal CFB / OLE compound file header (encrypted Office magic)
// ---------------------------------------------------------------------------
function cfbHeader(): Buffer {
  const buf = Buffer.alloc(512);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < sig.length; i++) buf[i] = sig[i];
  return buf;
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const out: Array<[string, Buffer]> = [];

  // Supported (clean-able) fixtures
  out.push(['office-sample.docx', await zipOf(docxEntries())]);
  out.push(['office-sample.xlsx', await zipOf(xlsxEntries())]);
  out.push(['office-sample.pptx', await zipOf(pptxEntries())]);

  // Blocked fixtures — DOCX variants
  out.push(['office-macro.docm', await zipOf(docxEntries({ 'word/vbaProject.bin': Buffer.from([0, 1, 2, 3]) }))]);
  out.push(['office-ole.docx', await zipOf(docxEntries({ 'word/embeddings/oleObject1.bin': Buffer.from([0, 1, 2]) }))]);
  out.push(['office-customxml.docx', await zipOf(docxEntries({ 'customXml/item1.xml': '<root>x</root>' }))]);
  out.push([
    'office-threaded.docx',
    await zipOf(
      docxEntries({
        'word/commentsExtended.xml': '<w15:commentsEx xmlns:w15="x"/>',
        'word/people.xml': `<w15:people xmlns:w15="x"><w15:person w15:author="${S.author}"/></w15:people>`,
      }),
    ),
  ]);
  out.push([
    'office-signed.docx',
    await zipOf(docxEntries({ '_xmlsignatures/sig1.xml': '<Signature/>' })),
  ]);

  // Blocked — XLSX threaded comments
  out.push([
    'office-threaded.xlsx',
    await zipOf(
      xlsxEntries({
        'xl/threadedComments/threadedComment1.xml': '<ThreadedComments xmlns="x"/>',
        'xl/persons/person.xml': `<personList xmlns="x"><person displayName="${S.author}"/></personList>`,
      }),
    ),
  ]);

  // Blocked — encrypted (CFB) and malformed (PK magic but broken zip)
  writeFileSync(join(DIR, 'office-encrypted.docx'), cfbHeader());
  const broken = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('not a real zip body')]);
  writeFileSync(join(DIR, 'office-malformed.docx'), broken);

  for (const [name, buf] of out) {
    writeFileSync(join(DIR, name), buf);
  }

  const all = [...out.map(([n]) => n), 'office-encrypted.docx', 'office-malformed.docx'];
  for (const n of all) console.log(`✓ ${n}`);
  console.log(`\nOffice fixtures generated in ${DIR}`);
}

main();
