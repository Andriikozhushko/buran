import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readFixture } from '../helpers';
import { scanOffice } from '../../src/lib/formats/office/scan';
import { sanitizeOffice } from '../../src/lib/formats/office/sanitize';
import { verifyOffice } from '../../src/lib/formats/office/verify';
import {
  detectOfficeContainer,
  classifyOffice,
  loadPackage,
} from '../../src/lib/formats/office';
import { detectFormat } from '../../src/lib/formats/detector';
import { NEUTRAL_DATE } from '../../src/lib/formats/office/package';
import { readTagText } from '../../src/lib/formats/office/shared';
import type { OfficeScanData } from '../../src/lib/formats/office/types';

const FIXTURES = join(import.meta.dirname || __dirname, '..', 'fixtures');
const load = (name: string): ArrayBuffer => readFixture(join(FIXTURES, name));

/** Sentinels embedded only in metadata surfaces — must never survive. */
const SENTINELS = [
  'BURAN_TEST_AUTHOR_DO_NOT_LEAK',
  'BURAN_TEST_LASTMODBY_DO_NOT_LEAK',
  'BURAN_TEST_TITLE_DO_NOT_LEAK',
  'BURAN_TEST_SUBJECT_DO_NOT_LEAK',
  'BURAN_TEST_KEYWORDS_DO_NOT_LEAK',
  'BURAN_TEST_COMPANY_DO_NOT_LEAK',
  'BURAN_TEST_MANAGER_DO_NOT_LEAK',
  'BURAN_TEST_APP_DO_NOT_LEAK',
  'BURAN_TEST_TEMPLATE_DO_NOT_LEAK',
  'BURAN_TEST_CUSTOMPROP_DO_NOT_LEAK',
  'BURAN_TEST_COMMENTAUTHOR_DO_NOT_LEAK',
  'BURAN_TEST_REVAUTHOR_DO_NOT_LEAK',
  'BURAN_TEST_GPS_DO_NOT_LEAK',
];

async function expectData(name: string): Promise<OfficeScanData> {
  const r = await scanOffice(load(name));
  if ('blocked' in r) throw new Error(`${name} unexpectedly blocked: ${r.reason}`);
  return r.data;
}

/** Concatenate the DECOMPRESSED text of all XML/media parts of a package. */
async function corpus(buffer: ArrayBuffer): Promise<{ zip: JSZip; text: string; names: string[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  let text = '';
  for (const n of names) {
    if (/\.(xml|rels)$/i.test(n)) text += (await zip.files[n].async('string')) + '\n';
    else if (/\/media\//.test(n)) text += new TextDecoder('latin1').decode(await zip.files[n].async('uint8array'));
  }
  return { zip, text, names };
}

describe('Office detection', () => {
  it('detects ZIP (OOXML) and CFB (encrypted) containers', () => {
    expect(detectOfficeContainer(load('office-sample.docx'))).toBe('zip');
    expect(detectOfficeContainer(load('office-encrypted.docx'))).toBe('cfb');
    // OOXML packages are ZIP at magic-byte level; Office classification is content-based.
    expect(detectFormat(load('office-sample.docx'))).toBe('zip');
  });

  it('routes a renamed OOXML package to the Office pipeline by content (D3)', async () => {
    const { getDescriptor } = await import('../../src/lib/formats/registry');
    const buffer = load('office-sample.docx');
    // The registry sees only ZIP magic; the filename lies about the format.
    const outcome = await getDescriptor('zip').scan(buffer, 'totally-a-plain-archive.zip', buffer.byteLength);
    if (!('result' in outcome)) throw new Error('renamed OOXML unexpectedly blocked or errored');
    expect(outcome.result.format).toBe('docx');
    expect(outcome.result.office).toBeDefined();
  });

  it('classifies a legacy CFB document honestly, not as encrypted (D1)', async () => {
    const { detectScanFormat } = await import('../../src/lib/formats/registry');
    // Legacy .doc routes to the Office scanner via the CFB sniff...
    expect(detectScanFormat(load('office-legacy.doc'))).toBe('docx');
    // ...which reports it as legacy, while true encrypted stays encrypted.
    const legacy = await scanOffice(load('office-legacy.doc'));
    const encrypted = await scanOffice(load('office-encrypted.docx'));
    if (!('blocked' in legacy) || !('blocked' in encrypted)) throw new Error('CFB fixtures must block');
    expect(legacy.reason).toBe('legacy-office');
    expect(encrypted.reason).toBe('encrypted');
  });

  it('classifies docx/xlsx/pptx from package content', async () => {
    const d = await loadPackage(load('office-sample.docx'));
    const x = await loadPackage(load('office-sample.xlsx'));
    const p = await loadPackage(load('office-sample.pptx'));
    if ('blocked' in d || 'blocked' in x || 'blocked' in p) throw new Error('unexpected block');
    expect(classifyOffice(d.entryNames)).toBe('docx');
    expect(classifyOffice(x.entryNames)).toBe('xlsx');
    expect(classifyOffice(p.entryNames)).toBe('pptx');
  });
});

describe('Office scanner finds metadata', () => {
  it('reads property tags when a valid OOXML producer uses different namespace prefixes', () => {
    const core = '<dublin:creator>Andrii K</dublin:creator><properties:lastModifiedBy>Andrii K</properties:lastModifiedBy>';
    expect(readTagText(core, 'dc:creator')).toBe('Andrii K');
    expect(readTagText(core, 'cp:lastModifiedBy')).toBe('Andrii K');
  });

  it('docx: core/app/custom, comment author, revisions, embedded image', async () => {
    const data = await expectData('office-sample.docx');
    expect(data.format).toBe('docx');
    const fields = data.findings.map((f) => f.field);
    expect(fields).toContain('core:dc:creator');
    expect(fields).toContain('core:cp:lastModifiedBy');
    expect(fields).toContain('app:Company');
    expect(fields).toContain('app:Manager');
    expect(fields.some((f) => f.startsWith('custom:'))).toBe(true);
    expect(fields).toContain('docx:commentAuthor');
    expect(fields).toContain('docx:revisionAuthor');
    expect(fields).toContain('docx:rsid');
    expect(fields).toContain('office:zipTimestamps');
    expect(data.embeddedImages.length).toBe(1);
    expect(data.hasComments).toBe(true);
    expect(data.hasRevisions).toBe(true);
  });

  it('xlsx and pptx find comment authors and props', async () => {
    const x = await expectData('office-sample.xlsx');
    expect(x.findings.map((f) => f.field)).toContain('xlsx:commentAuthor');
    expect(x.findings.map((f) => f.field)).toContain('core:dc:creator');
    const p = await expectData('office-sample.pptx');
    expect(p.findings.map((f) => f.field)).toContain('pptx:commentAuthor');
    expect(p.findings.map((f) => f.field)).toContain('app:Company');
  });
});

describe('Office sanitiser + verifier', () => {
  for (const name of ['office-sample.docx', 'office-sample.xlsx', 'office-sample.pptx']) {
    it(`cleans and verifies ${name}`, async () => {
      const data = await expectData(name);
      const clean = await sanitizeOffice(load(name));
      const v = await verifyOffice(data, clean);

      expect(v.verificationPassed).toBe(true);
      expect(v.personalMetadataRemaining).toBe(0);
      expect(v.corePropertiesRemoved).toBe(true);
      expect(v.appPropertiesRemoved).toBe(true);
      expect(v.customPropertiesRemoved).toBe(true);
      expect(v.commentAuthorsAnonymised).toBe(true);
      expect(v.revisionMetadataRemoved).toBe(true);
      expect(v.embeddedImagesVerified).toBe(1);
      expect(v.zipTimestampsNormalised).toBe(true);
      expect(v.remainingUnsupportedMetadataRisk).toEqual([]);
    });
  }

  it('re-scanning a cleaned package reports no container-timestamp finding', async () => {
    for (const name of ['office-sample.docx', 'office-sample.xlsx', 'office-sample.pptx']) {
      const clean = await sanitizeOffice(load(name));
      const rescan = await scanOffice(clean);
      if ('blocked' in rescan) throw new Error(`${name}: cleaned package unexpectedly blocked`);
      expect(rescan.data.findings.map((f) => f.field)).not.toContain('office:zipTimestamps');
    }
  });

  it('removes core/app/custom parts and their content-type/relationship entries', async () => {
    for (const name of ['office-sample.docx', 'office-sample.xlsx', 'office-sample.pptx']) {
      const clean = await sanitizeOffice(load(name));
      const { zip, names } = await corpus(clean);
      expect(names).not.toContain('docProps/core.xml');
      expect(names).not.toContain('docProps/app.xml');
      expect(names).not.toContain('docProps/custom.xml');
      const ct = await zip.file('[Content_Types].xml')!.async('string');
      expect(ct).not.toContain('docProps/core.xml');
      expect(ct).not.toContain('docProps/app.xml');
      expect(ct).not.toContain('docProps/custom.xml');
      const rels = await zip.file('_rels/.rels')!.async('string');
      expect(rels).not.toContain('docProps/core.xml');
      expect(rels).not.toContain('docProps/app.xml');
      expect(rels).not.toContain('docProps/custom.xml');
    }
  });

  it('leaves no metadata sentinel strings in the decompressed output', async () => {
    for (const name of ['office-sample.docx', 'office-sample.xlsx', 'office-sample.pptx']) {
      const clean = await sanitizeOffice(load(name));
      const { text } = await corpus(clean);
      for (const s of SENTINELS) {
        expect(text.includes(s), `${s} leaked in ${name}`).toBe(false);
      }
    }
  });

  it('preserves comment text and anonymises comment authors', async () => {
    // DOCX
    let clean = await sanitizeOffice(load('office-sample.docx'));
    let zip = await JSZip.loadAsync(clean);
    let comments = await zip.file('word/comments.xml')!.async('string');
    expect(comments).toContain('Visible comment body stays');
    expect(comments).toContain('w:author="Anonymous"');
    expect(comments).not.toContain('BURAN_TEST_COMMENTAUTHOR_DO_NOT_LEAK');
    expect(comments).not.toMatch(/w:date=/);

    // XLSX — authors collapsed to one and authorId remapped to 0.
    clean = await sanitizeOffice(load('office-sample.xlsx'));
    zip = await JSZip.loadAsync(clean);
    comments = await zip.file('xl/comments1.xml')!.async('string');
    expect(comments).toContain('Visible comment body stays');
    expect((comments.match(/<author>/g) || []).length).toBe(1);
    expect(comments).toContain('<author>Anonymous</author>');
    expect(comments).not.toMatch(/authorId="1"/);

    // PPTX
    clean = await sanitizeOffice(load('office-sample.pptx'));
    zip = await JSZip.loadAsync(clean);
    const authors = await zip.file('ppt/commentAuthors.xml')!.async('string');
    expect(authors).toContain('name="Anonymous"');
    expect(authors).not.toContain('BURAN_TEST_COMMENTAUTHOR_DO_NOT_LEAK');
    const comment = await zip.file('ppt/comments/comment1.xml')!.async('string');
    expect(comment).toContain('Visible comment body stays');
    expect(comment).not.toMatch(/\bdt=/);
  });

  it('docx: keeps tracked-change content but removes original author/date', async () => {
    const clean = await sanitizeOffice(load('office-sample.docx'));
    const zip = await JSZip.loadAsync(clean);
    const doc = await zip.file('word/document.xml')!.async('string');
    // Tracked content preserved.
    expect(doc).toContain('inserted text');
    expect(doc).toContain('deleted text');
    expect(doc).toContain('<w:ins');
    expect(doc).toContain('<w:del');
    // Original author/date gone; rsids removed.
    expect(doc).not.toContain('BURAN_TEST_REVAUTHOR_DO_NOT_LEAK');
    expect(doc).not.toMatch(/w:date=/);
    expect(doc).not.toMatch(/w:rsid/);
    const settings = await zip.file('word/settings.xml')!.async('string');
    expect(settings).not.toContain('<w:rsids>');
  });

  it('cleans embedded images (image metadata removed)', async () => {
    const clean = await sanitizeOffice(load('office-sample.docx'));
    const zip = await JSZip.loadAsync(clean);
    const img = await zip.file('word/media/image1.png')!.async('uint8array');
    const txt = new TextDecoder('latin1').decode(img);
    expect(txt).not.toContain('BURAN_TEST_GPS_DO_NOT_LEAK');
    expect(txt).not.toContain('tEXt');
  });

  it('normalises every ZIP entry timestamp to the neutral fixed value', async () => {
    const clean = await sanitizeOffice(load('office-sample.docx'));
    const zip = await JSZip.loadAsync(clean);
    for (const name of Object.keys(zip.files)) {
      const dt = zip.files[name].date?.getTime() ?? 0;
      expect(Math.abs(dt - NEUTRAL_DATE.getTime())).toBeLessThan(2500);
    }
  });

  it('does not embed a BURAN/original-filename fingerprint', async () => {
    const clean = await sanitizeOffice(load('office-sample.docx'));
    const { text } = await corpus(clean);
    expect(text).not.toContain('BURAN');
    expect(text.toLowerCase()).not.toContain('office-sample');
  });

  it('offers normal and aggressive cleanup modes for custom XML documents', async () => {
    const original = await expectData('office-customxml.docx');

    const normal = await sanitizeOffice(load('office-customxml.docx'));
    const normalPackage = await JSZip.loadAsync(normal);
    expect(Object.keys(normalPackage.files)).toContain('customXml/item1.xml');
    const normalVerification = await verifyOffice(original, normal);
    expect(normalVerification.verificationPassed).toBe(true);
    expect(normalVerification.customXmlRemoved).toBe(false);

    const aggressive = await sanitizeOffice(load('office-customxml.docx'), { removeCustomXml: true });
    const aggressivePackage = await JSZip.loadAsync(aggressive);
    expect(Object.keys(aggressivePackage.files).some((name) => name.startsWith('customXml/'))).toBe(false);
    const aggressiveVerification = await verifyOffice(original, aggressive, { removeCustomXml: true });
    expect(aggressiveVerification.verificationPassed).toBe(true);
    expect(aggressiveVerification.customXmlRemoved).toBe(true);
  });
});

describe('Office blocking', () => {
  const cases: Array<[string, string]> = [
    ['office-macro.docm', 'macro'],
    ['office-ole.docx', 'embedded-object'],
    ['office-threaded.docx', 'threaded-comments'],
    ['office-signed.docx', 'signed'],
    ['office-threaded.xlsx', 'threaded-comments'],
    ['office-encrypted.docx', 'encrypted'],
    ['office-legacy.doc', 'legacy-office'],
    ['office-malformed.docx', 'malformed'],
  ];

  for (const [name, reason] of cases) {
    it(`blocks ${name} as "${reason}" with no output`, async () => {
      const r = await scanOffice(load(name));
      expect('blocked' in r).toBe(true);
      if ('blocked' in r) {
        expect(r.reason).toBe(reason);
        expect(r.message.length).toBeGreaterThan(10);
      }
    });
  }

  it('inspects custom XML documents and records their additional cleanup risk', async () => {
    const result = await scanOffice(load('office-customxml.docx'));
    if ('blocked' in result) throw new Error('custom XML document should be available for inspection');
    expect(result.data.hasCustomXml).toBe(true);
    expect(result.data.findings.map((f) => f.field)).toContain('core:dc:creator');
    expect(result.data.unsupportedMetadataRisk).toEqual(['buran:risk/office.custom-xml-preserved']);
  });

  it('blocks zip-bomb-like packages (suspicious compression ratio)', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    zip.file('big.bin', new Uint8Array(6 * 1024 * 1024)); // 6 MB of zeros -> tiny compressed
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const r = await loadPackage(ab);
    expect('blocked' in r).toBe(true);
    if ('blocked' in r) expect(r.reason).toBe('zip-bomb');
  });
});
