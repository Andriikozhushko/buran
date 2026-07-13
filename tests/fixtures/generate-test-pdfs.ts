/**
 * Synthetic PDF fixture generator for BURAN (milestone 02A).
 *
 * Every fixture contains ONLY fake metadata with `SENTINEL_*` markers — never
 * any private document. PDFs are hand-built as raw text; pdf-lib's parser
 * tolerates the missing cross-reference table, which keeps the fixtures small
 * and the embedded metadata as literal, scannable ASCII.
 *
 * Usage: npx tsx tests/fixtures/generate-test-pdfs.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname || __dirname);

/** Assemble a PDF body from object strings, a root ref, and trailer entries. */
function buildPdf(objects: string[], trailer: string): Buffer {
  let body = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  for (const obj of objects) {
    body += obj.trimStart();
    if (!body.endsWith('\n')) body += '\n';
  }
  body += `trailer\n${trailer}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

/** A stream object with an accurately computed /Length. */
function streamObj(num: number, dictExtra: string, content: string): string {
  const len = Buffer.byteLength(content, 'latin1');
  return `${num} 0 obj\n<< ${dictExtra} /Length ${len} >>\nstream\n${content}\nendstream\nendobj\n`;
}

const PAGE_CONTENT = 'BT /F1 18 Tf 72 700 Td (SENTINEL_VISIBLE_BODY_TEXT) Tj ET';

// ---------------------------------------------------------------------------
// 1. Standard Info dictionary metadata
// ---------------------------------------------------------------------------
function pdfInfo(): Buffer {
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 5 0 R >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
    `6 0 obj\n<< /Title (SENTINEL_TITLE) /Author (SENTINEL_AUTHOR Andrii) /Subject (SENTINEL_SUBJECT) ` +
      `/Keywords (SENTINEL_KEYWORD_ONE SENTINEL_KEYWORD_TWO) /Creator (SENTINEL_CREATOR_APP) ` +
      `/Producer (SENTINEL_PRODUCER_LIB) /CreationDate (D:20200102030405Z) /ModDate (D:20210304050607Z) ` +
      `/SENTINELCustomKey (SENTINEL_CUSTOM_VALUE) >>\nendobj\n`,
  ];
  return buildPdf(objects, `<< /Root 1 0 R /Info 6 0 R /ID [<aa11> <bb22>] >>`);
}

// ---------------------------------------------------------------------------
// 2. XMP metadata stream
// ---------------------------------------------------------------------------
function pdfXmp(): Buffer {
  const xmp =
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:xmp="http://ns.adobe.com/xap/1.0/" ` +
    `xmlns:pdf="http://ns.adobe.com/pdf/1.3/" ` +
    `xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" ` +
    `xmlns:sentinelns="http://example.com/sentinel/1.0/">` +
    `<dc:creator><rdf:Seq><rdf:li>SENTINEL_XMP_CREATOR</rdf:li></rdf:Seq></dc:creator>` +
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">SENTINEL_XMP_DESCRIPTION</rdf:li></rdf:Alt></dc:description>` +
    `<photoshop:Company>SENTINEL_XMP_COMPANY</photoshop:Company>` +
    `<xmp:CreatorTool>SENTINEL_XMP_CREATORTOOL</xmp:CreatorTool>` +
    `<xmp:CreateDate>2020-01-02T03:04:05Z</xmp:CreateDate>` +
    `<xmp:ModifyDate>2021-03-04T05:06:07Z</xmp:ModifyDate>` +
    `<sentinelns:CustomField>SENTINEL_XMP_CUSTOM_NS_VALUE</sentinelns:CustomField>` +
    `</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
    streamObj(6, '/Type /Metadata /Subtype /XML', xmp),
    `7 0 obj\n<< /Producer (SENTINEL_PRODUCER_LIB) >>\nendobj\n`,
  ];
  return buildPdf(objects, `<< /Root 1 0 R /Info 7 0 R /ID [<cc33> <dd44>] >>`);
}

// ---------------------------------------------------------------------------
// 3. Annotation with author field + visible content
// ---------------------------------------------------------------------------
function pdfAnnotation(): Buffer {
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Annots [6 0 R] >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
    `6 0 obj\n<< /Type /Annot /Subtype /Text /Rect [72 700 92 720] ` +
      `/Contents (SENTINEL_ANNOTATION_BODY_VISIBLE) /T (SENTINEL_ANNOTATION_AUTHOR) ` +
      `/M (D:20210101000000Z) /NM (SENTINEL_ANNOTATION_ID) >>\nendobj\n`,
  ];
  return buildPdf(objects, `<< /Root 1 0 R /ID [<ee55> <ff66>] >>`);
}

// ---------------------------------------------------------------------------
// 4. Signed PDF (mock signature structure) — must be BLOCKED
// ---------------------------------------------------------------------------
function pdfSigned(): Buffer {
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /SigFlags 3 >> >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
    `6 0 obj\n<< /FT /Sig /T (Signature1) /V 7 0 R >>\nendobj\n`,
    `7 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached ` +
      `/ByteRange [0 100 200 300] /Contents <30820> >>\nendobj\n`,
  ];
  return buildPdf(objects, `<< /Root 1 0 R /ID [<11aa> <22bb>] >>`);
}

// ---------------------------------------------------------------------------
// 5. Encrypted PDF (mock /Encrypt) — must be BLOCKED
// ---------------------------------------------------------------------------
function pdfEncrypted(): Buffer {
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
    `6 0 obj\n<< /Filter /Standard /V 2 /R 3 /O <abcd> /U <ef01> /P -44 >>\nendobj\n`,
  ];
  return buildPdf(objects, `<< /Root 1 0 R /Encrypt 6 0 R /ID [<33cc> <44dd>] >>`);
}

// ---------------------------------------------------------------------------
// 6. Embedded attachment / portfolio-like structure — must be BLOCKED
// ---------------------------------------------------------------------------
function pdfAttachment(): Buffer {
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 6 0 R >> >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
    `6 0 obj\n<< /Names [(secret.txt) 7 0 R] >>\nendobj\n`,
    `7 0 obj\n<< /Type /Filespec /F (secret.txt) /EF << /F 8 0 R >> >>\nendobj\n`,
    streamObj(8, '/Type /EmbeddedFile', 'SENTINEL_ATTACHMENT_CONTENT'),
  ];
  return buildPdf(objects, `<< /Root 1 0 R /ID [<55ee> <66ff>] >>`);
}

function pdfPortfolio(): Buffer {
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Collection << /View /D >> >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n`,
    streamObj(5, '', PAGE_CONTENT),
  ];
  return buildPdf(objects, `<< /Root 1 0 R /ID [<77aa> <88bb>] >>`);
}

function main() {
  mkdirSync(DIR, { recursive: true });
  const fixtures: Array<[string, Buffer]> = [
    ['pdf-info.pdf', pdfInfo()],
    ['pdf-xmp.pdf', pdfXmp()],
    ['pdf-annotation.pdf', pdfAnnotation()],
    ['pdf-signed.pdf', pdfSigned()],
    ['pdf-encrypted.pdf', pdfEncrypted()],
    ['pdf-attachment.pdf', pdfAttachment()],
    ['pdf-portfolio.pdf', pdfPortfolio()],
  ];
  for (const [name, buf] of fixtures) {
    writeFileSync(join(DIR, name), buf);
    console.log(`✓ ${name} (${buf.length} bytes)`);
  }
  console.log(`\nPDF fixtures generated in ${DIR}`);
}

main();
