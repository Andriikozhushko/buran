/**
 * Independent post-sanitisation verification for Office packages.
 *
 * Does not trust the sanitiser: re-loads the cleaned bytes from scratch,
 * re-inspects the package, and scans the raw output for the original metadata
 * sentinels. `verificationPassed` is only true when every supported surface is
 * proven clean and the package remains a valid OOXML container.
 */

import JSZip from 'jszip';
import { jpegHandler } from '../jpeg';
import { pngHandler } from '../png';
import { webpHandler } from '../webp';
import type { OfficeScanData, OfficeVerification } from './types';
import { APP_PART, CORE_PART, CUSTOM_PART, toArrayBuffer } from './shared';
import { NEUTRAL_DATE } from './package';
import { collectEmbeddedImages } from './detect';

const imageHandlers = { jpeg: jpegHandler, png: pngHandler, webp: webpHandler };

const REQUIRED_PART: Record<OfficeScanData['format'], string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};

/**
 * Build a corpus of the package's DECOMPRESSED content. A raw scan of the ZIP
 * bytes is meaningless because DEFLATE would hide any residual metadata inside
 * compressed parts, so we decompress every XML/rels part and include media
 * bytes (as latin1) to catch embedded-image metadata.
 */
async function decompressedCorpus(zip: JSZip, names: string[]): Promise<string> {
  let corpus = '';
  for (const name of names) {
    if (/\.(xml|rels)$/i.test(name)) {
      corpus += (await zip.files[name].async('string')) + '\n';
    } else if (/\/media\//.test(name)) {
      const b = await zip.files[name].async('uint8array');
      corpus += new TextDecoder('latin1').decode(b);
    }
  }
  return corpus;
}

export async function verifyOffice(
  original: OfficeScanData,
  cleanBuffer: ArrayBuffer,
): Promise<OfficeVerification> {
  const metadataFoundBefore = original.findings.length;
  const risk = [...original.unsupportedMetadataRisk];

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(cleanBuffer);
  } catch {
    return fail(original, metadataFoundBefore, ['Очищенный пакет не удалось открыть как ZIP/OOXML.']);
  }

  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const nameSet = new Set(names);

  // Property parts removed (file + content-type override + relationship).
  const ct = (await readMaybe(zip, '[Content_Types].xml')) ?? '';
  const rootRels = (await readMaybe(zip, '_rels/.rels')) ?? '';
  const partGone = (part: string, ctToken: string, relToken: string) =>
    !nameSet.has(part) && !ct.includes(ctToken) && !rootRels.includes(relToken);

  const corePropertiesRemoved = partGone(CORE_PART, '/docProps/core.xml', 'docProps/core.xml');
  const appPropertiesRemoved = partGone(APP_PART, '/docProps/app.xml', 'docProps/app.xml');
  const customPropertiesRemoved = partGone(CUSTOM_PART, '/docProps/custom.xml', 'docProps/custom.xml');

  // Decompressed sentinel scan: no original personal values anywhere in the
  // output's metadata parts or embedded media.
  const corpus = await decompressedCorpus(zip, names);
  const leaked = original.rawMetadataValues.filter((v) => v.length >= 4 && corpus.includes(v));
  const personalMetadataRemaining = new Set(leaked).size;
  if (leaked.length > 0) {
    risk.push('Original metadata values remain in the output bytes.');
  }

  // Comment authors anonymised (no original comment-author sentinel survived).
  const commentAuthorsAnonymised = !original.hasComments || leaked.length === 0;

  // Word revision metadata removed: no dates / rsids / original authors remain.
  let revisionMetadataRemoved = true;
  if (original.format === 'docx' && original.hasRevisions) {
    let dateOrRsid = false;
    for (const name of names) {
      if (!/^word\/.*\.xml$/i.test(name) || /\.rels$/i.test(name)) continue;
      const xml = await zip.files[name].async('string');
      if (/\bw:date="/i.test(xml) || /\bw:rsid\w*="/i.test(xml) || /<w:rsids>/i.test(xml)) {
        dateOrRsid = true;
        break;
      }
    }
    revisionMetadataRemoved = !dateOrRsid && leaked.length === 0;
  }

  // Embedded images independently re-verified.
  const images = collectEmbeddedImages(names);
  let embeddedImagesVerified = 0;
  for (const img of images) {
    try {
      const bytes = await zip.files[img.path].async('uint8array');
      const ab = toArrayBuffer(bytes);
      const scan = imageHandlers[img.format].scan(ab);
      const personal = scan.findings.filter(
        (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM', 'WebP:ICCP'].includes(f.field),
      );
      if (personal.length === 0) embeddedImagesVerified++;
    } catch {
      // Counts as not verified.
    }
  }
  const allImagesVerified = embeddedImagesVerified === images.length;

  // ZIP timestamps normalised to the neutral fixed value.
  const neutral = NEUTRAL_DATE.getTime();
  const zipTimestampsNormalised = Object.values(zip.files).every(
    (f) => Math.abs((f.date?.getTime() ?? 0) - neutral) < 2500,
  );

  // Package validity: required core content part still present.
  const requiredPresent = nameSet.has(REQUIRED_PART[original.format]);
  if (!requiredPresent) risk.push('В выходном пакете отсутствует ожидаемая основная часть документа.');

  const verificationPassed =
    corePropertiesRemoved &&
    appPropertiesRemoved &&
    customPropertiesRemoved &&
    commentAuthorsAnonymised &&
    revisionMetadataRemoved &&
    personalMetadataRemaining === 0 &&
    zipTimestampsNormalised &&
    allImagesVerified &&
    requiredPresent;

  return {
    format: original.format,
    metadataFoundBefore,
    personalMetadataRemaining,
    corePropertiesRemoved,
    appPropertiesRemoved,
    customPropertiesRemoved,
    commentAuthorsAnonymised,
    revisionMetadataRemoved,
    embeddedImagesVerified,
    zipTimestampsNormalised,
    verificationPassed,
    remainingUnsupportedMetadataRisk: risk,
  };
}

async function readMaybe(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  return f ? f.async('string') : null;
}

function fail(
  original: OfficeScanData,
  metadataFoundBefore: number,
  extraRisk: string[],
): OfficeVerification {
  return {
    format: original.format,
    metadataFoundBefore,
    personalMetadataRemaining: metadataFoundBefore,
    corePropertiesRemoved: false,
    appPropertiesRemoved: false,
    customPropertiesRemoved: false,
    commentAuthorsAnonymised: false,
    revisionMetadataRemoved: false,
    embeddedImagesVerified: 0,
    zipTimestampsNormalised: false,
    verificationPassed: false,
    remainingUnsupportedMetadataRisk: [...original.unsupportedMetadataRisk, ...extraRisk],
  };
}
