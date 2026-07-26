/**
 * OpenDocument (ODT/ODS/ODP/ODG) metadata scanning and sanitisation.
 *
 * Structurally a sibling of OOXML: a ZIP package with XML parts, classified
 * from the STORED `mimetype` entry — never the filename. Reuses the Office
 * package machinery (limits, rebuild with neutral timestamps).
 *
 * Removed and disclosed: the whole office:meta surface (authors, dates,
 * generator, keywords, user-defined fields, statistics), the document
 * thumbnail (a rendered preview of page one — a real leak), printer identity
 * in settings.xml, annotation author/date identity in content.xml, and
 * metadata inside embedded images (via the image cores). Encrypted or
 * macro-carrying documents are refused, never guessed at.
 */

import type JSZip from 'jszip';
import type { MetadataFinding } from './types';
import { personalFindingCount } from './types';
import type { FormatHandler } from './types';
import { jpegHandler } from './jpeg';
import { pngHandler } from './png';
import { webpHandler } from './webp';
import { tiffHandler } from './tiff';
import { gifHandler } from './gif';
import { bmpHandler } from './bmp';
import type { OfficeBlock } from './office/types';
import {
  isNeutralDate,
  loadPackage,
  officeBlock,
  readBytes,
  readText,
  rebuildPackage,
} from './office/package';

export type OdfFormat = 'odt' | 'ods' | 'odp' | 'odg';

const MIMETYPE_TO_FORMAT: Array<[string, OdfFormat]> = [
  ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['application/vnd.oasis.opendocument.presentation', 'odp'],
  ['application/vnd.oasis.opendocument.graphics', 'odg'],
];

const ANON_AUTHOR = 'Anonymous';

/** Map an ODF package mimetype (incl. -template variants) to its format. */
export function classifyOdfMimetype(mimetype: string): OdfFormat | null {
  const trimmed = mimetype.trim();
  for (const [prefix, format] of MIMETYPE_TO_FORMAT) {
    if (trimmed === prefix || trimmed === `${prefix}-template`) return format;
  }
  return null;
}

const IMAGE_HANDLERS: Record<string, FormatHandler> = {
  jpg: jpegHandler,
  jpeg: jpegHandler,
  png: pngHandler,
  webp: webpHandler,
  tif: tiffHandler,
  tiff: tiffHandler,
  gif: gifHandler,
  bmp: bmpHandler,
};

function embeddedImages(entryNames: string[]): Array<{ path: string; handler: FormatHandler }> {
  const out: Array<{ path: string; handler: FormatHandler }> = [];
  for (const name of entryNames) {
    if (!/(^|\/)(Pictures|media)\//i.test(name)) continue;
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const handler = IMAGE_HANDLERS[ext];
    if (handler) out.push({ path: name, handler });
  }
  return out;
}

/** Personal meta.xml elements: tag → [label, category, severity]. */
const META_FIELDS: Array<[string, string, MetadataFinding['category'], MetadataFinding['severity']]> = [
  ['dc:creator', 'Document author', 'author', 'high'],
  ['meta:initial-creator', 'Initial author', 'author', 'high'],
  ['meta:printed-by', 'Printed by', 'author', 'high'],
  ['dc:title', 'Document title', 'other', 'medium'],
  ['dc:subject', 'Document subject', 'other', 'medium'],
  ['dc:description', 'Description', 'other', 'low'],
  ['meta:keyword', 'Keyword', 'other', 'medium'],
  ['meta:generator', 'Generator application', 'software', 'medium'],
  ['meta:creation-date', 'Creation date', 'dates', 'high'],
  ['dc:date', 'Modification date', 'dates', 'high'],
  ['meta:print-date', 'Last printed date', 'dates', 'medium'],
  ['meta:editing-cycles', 'Editing cycles', 'dates', 'low'],
  ['meta:editing-duration', 'Editing duration', 'dates', 'low'],
];

function tagValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const value = m[1].replace(/<[^>]+>/g, '').trim();
    if (value) out.push(value);
  }
  return out;
}

export interface OdfScanData {
  format: OdfFormat;
  findings: MetadataFinding[];
  rawMetadataValues: string[];
  hasThumbnail: boolean;
  hasAnnotations: boolean;
  embeddedImageCount: number;
  entryCount: number;
}

function mk(
  field: string,
  label: string,
  value: string | null,
  category: MetadataFinding['category'],
  severity: MetadataFinding['severity'],
): MetadataFinding {
  return { category, field, label, value, severity, description: '' };
}

export async function scanOdf(buffer: ArrayBuffer): Promise<OfficeBlock | { data: OdfScanData }> {
  const loaded = await loadPackage(buffer);
  if ('blocked' in loaded) return loaded;

  const mimetype = (await readText(loaded.zip, 'mimetype')) ?? '';
  const format = classifyOdfMimetype(mimetype);
  if (!format) {
    return officeBlock('unsupported-package', 'Файл не является поддерживаемым OpenDocument-документом.');
  }

  const manifest = (await readText(loaded.zip, 'META-INF/manifest.xml')) ?? '';
  if (/manifest:encryption-data/i.test(manifest)) {
    return officeBlock(
      'encrypted',
      'OpenDocument-файл зашифрован (защищён паролем). BURAN не может прочитать и безопасно изменить такой файл, поэтому он не был изменён.',
    );
  }
  if (loaded.entryNames.some((n) => /^(Basic|Scripts)\//i.test(n))) {
    return officeBlock(
      'macro',
      'Документ содержит макросы/скрипты. BURAN не изменяет такие файлы, чтобы не повредить их и не скрыть исполняемое содержимое.',
    );
  }

  const findings: MetadataFinding[] = [];
  const raw: string[] = [];

  const meta = (await readText(loaded.zip, 'meta.xml')) ?? '';
  for (const [tag, label, category, severity] of META_FIELDS) {
    for (const value of tagValues(meta, tag)) {
      findings.push(mk(`ODF:${tag}`, label, value, category, severity));
      raw.push(value);
    }
  }
  const userDefined = meta.match(/<meta:user-defined\b[^>]*meta:name="([^"]*)"[^>]*>([\s\S]*?)<\/meta:user-defined>/gi) ?? [];
  for (const entry of userDefined) {
    const m = entry.match(/meta:name="([^"]*)"[^>]*>([\s\S]*?)</i);
    if (m) {
      const value = m[2].trim() || null;
      findings.push(mk(`ODF:user:${m[1]}`, `Property "${m[1]}"`, value, 'other', 'medium'));
      if (m[1]) raw.push(m[1]);
      if (value) raw.push(value);
    }
  }
  if (/<meta:document-statistic\b/i.test(meta)) {
    findings.push(mk('ODF:statistics', 'Document statistics', 'Present', 'other', 'low'));
  }

  const hasThumbnail = loaded.entryNames.some((n) => /^Thumbnails\//i.test(n));
  if (hasThumbnail) {
    findings.push(mk('ODF:thumbnail', 'Document preview thumbnail', 'Present', 'thumbnails', 'medium'));
  }

  const settings = (await readText(loaded.zip, 'settings.xml')) ?? '';
  const printer = settings.match(/config:name="PrinterName"[^>]*>([\s\S]*?)</i)?.[1]?.trim();
  if (printer) {
    findings.push(mk('ODF:printer', 'Printer name', printer, 'device', 'high'));
    raw.push(printer);
  }
  if (/config:name="PrinterSetup"/i.test(settings)) {
    findings.push(mk('ODF:printerSetup', 'Printer configuration data', 'Present', 'device', 'medium'));
  }

  const content = (await readText(loaded.zip, 'content.xml')) ?? '';
  const annotationAuthors = [...new Set(tagValues(content, 'dc:creator'))].filter((a) => a !== ANON_AUTHOR);
  const hasAnnotations = annotationAuthors.length > 0;
  if (hasAnnotations) {
    findings.push(mk('ODF:annotationAuthor', 'Annotation author', annotationAuthors.join(', '), 'author', 'high'));
    raw.push(...annotationAuthors);
  }

  const images = embeddedImages(loaded.entryNames);
  let withMeta = 0;
  for (const img of images) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (!bytes) continue;
    try {
      const scan = img.handler.scan(toArrayBuffer(bytes));
      const personal = personalFindingCount(scan.findings);
      if (personal > 0) withMeta++;
      for (const f of scan.findings) if (f.value && f.value.length >= 3) raw.push(f.value);
    } catch {
      // Unreadable embedded image — left as-is; verification will flag residue.
    }
  }
  if (withMeta > 0) {
    findings.push(mk('ODF:embeddedImages', 'Embedded images with metadata', `${withMeta} of ${images.length}`, 'containers', 'medium'));
  }

  const timestampsCarryInfo = loaded.entryNames.some((n) => !isNeutralDate(loaded.zip.files[n].date));
  if (timestampsCarryInfo) {
    findings.push(mk('ODF:zipTimestamps', 'ZIP container timestamps', 'Present', 'containers', 'low'));
  }

  return {
    data: {
      format,
      findings,
      rawMetadataValues: raw.filter((s) => s && s.trim().length >= 3),
      hasThumbnail,
      hasAnnotations,
      embeddedImageCount: images.length,
      entryCount: loaded.entryCount,
    },
  };
}

const EMPTY_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:meta/></office:document-meta>';

export async function sanitizeOdf(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const loaded = await loadPackage(buffer);
  if ('blocked' in loaded) throw new Error('Пакет заблокирован и не может быть очищен.');
  const mimetype = (await readText(loaded.zip, 'mimetype')) ?? '';
  if (!classifyOdfMimetype(mimetype)) throw new Error('Неизвестный тип OpenDocument-документа.');

  const drop = new Set<string>();
  const replace = new Map<string, Uint8Array | string>();

  // 1. Thumbnail: drop the files and detach from the manifest.
  for (const name of loaded.entryNames) {
    if (/^Thumbnails\//i.test(name)) drop.add(name);
  }
  const manifest = await readText(loaded.zip, 'META-INF/manifest.xml');
  if (manifest) {
    replace.set(
      'META-INF/manifest.xml',
      manifest.replace(/<manifest:file-entry\b[^>]*manifest:full-path="Thumbnails\/[^"]*"[^>]*\/>\s*/gi, ''),
    );
  }

  // 2. meta.xml: replaced with an empty shell (the part must stay per spec).
  if (loaded.entryNames.includes('meta.xml')) replace.set('meta.xml', EMPTY_META);

  // 3. settings.xml: strip printer identity.
  const settings = await readText(loaded.zip, 'settings.xml');
  if (settings) {
    let out = settings;
    out = out.replace(/<config:config-item\b[^>]*config:name="PrinterName"[^>]*>[\s\S]*?<\/config:config-item>\s*/gi, '');
    out = out.replace(/<config:config-item\b[^>]*config:name="PrinterSetup"[^>]*>[\s\S]*?<\/config:config-item>\s*/gi, '');
    if (out !== settings) replace.set('settings.xml', out);
  }

  // 4. content.xml: anonymise annotation identity, keep annotation text.
  const content = await readText(loaded.zip, 'content.xml');
  if (content) {
    let out = content;
    out = out.replace(/(<dc:creator(?:\s[^>]*)?>)[\s\S]*?(<\/dc:creator>)/gi, `$1${ANON_AUTHOR}$2`);
    out = out.replace(/<dc:date(?:\s[^>]*)?>[\s\S]*?<\/dc:date>\s*/gi, '');
    if (out !== content) replace.set('content.xml', out);
  }

  // 5. Embedded images through the image cores.
  for (const img of embeddedImages(loaded.entryNames)) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (!bytes) continue;
    try {
      replace.set(img.path, new Uint8Array(img.handler.clean(toArrayBuffer(bytes))));
    } catch {
      // Leave original bytes; verification will flag residual metadata.
    }
  }

  return rebuildPackage(loaded, drop, replace, { storeUncompressed: new Set(['mimetype']) });
}

export interface OdfVerification {
  metadataFoundBefore: number;
  personalMetadataRemaining: number;
  metaCleared: boolean;
  thumbnailRemoved: boolean;
  printerRemoved: boolean;
  annotationsAnonymised: boolean;
  timestampsNormalised: boolean;
  mimetypePreserved: boolean;
  embeddedImagesVerified: number;
  verificationPassed: boolean;
  remainingRisk: string[];
}

export async function verifyOdf(original: OdfScanData, cleanBuffer: ArrayBuffer): Promise<OdfVerification> {
  const metadataFoundBefore = original.findings.length;
  const fail = (risk: string[]): OdfVerification => ({
    metadataFoundBefore,
    personalMetadataRemaining: metadataFoundBefore,
    metaCleared: false,
    thumbnailRemoved: false,
    printerRemoved: false,
    annotationsAnonymised: false,
    timestampsNormalised: false,
    mimetypePreserved: false,
    embeddedImagesVerified: 0,
    verificationPassed: false,
    remainingRisk: risk,
  });

  const loaded = await loadPackage(cleanBuffer);
  if ('blocked' in loaded) return fail(['Очищенный документ не удалось разобрать.']);
  const zip: JSZip = loaded.zip;
  const risk: string[] = [];

  const mimetype = (await readText(zip, 'mimetype')) ?? '';
  // ODF requires mimetype to be the FIRST, uncompressed entry: local header of
  // the first entry starts at 0, its filename at byte 30.
  const head = new Uint8Array(cleanBuffer.slice(30, 38));
  const mimetypeFirst = String.fromCharCode(...head) === 'mimetype';
  const mimetypePreserved = classifyOdfMimetype(mimetype) === original.format && mimetypeFirst;

  const meta = (await readText(zip, 'meta.xml')) ?? '';
  const metaCleared = !META_FIELDS.some(([tag]) => tagValues(meta, tag).length > 0) && !/meta:user-defined/i.test(meta);

  const thumbnailRemoved = !loaded.entryNames.some((n) => /^Thumbnails\//i.test(n));

  const settings = (await readText(zip, 'settings.xml')) ?? '';
  const printerRemoved = !/config:name="Printer(Name|Setup)"/i.test(settings);

  // Decompressed sentinel scan across XML parts and embedded media bytes.
  let corpus = '';
  for (const name of loaded.entryNames) {
    if (/\.xml$/i.test(name)) corpus += ((await readText(zip, name)) ?? '') + '\n';
    else if (/(^|\/)(Pictures|media)\//i.test(name)) {
      const bytes = await readBytes(zip, name);
      if (bytes) corpus += new TextDecoder('latin1').decode(bytes);
    }
  }
  const leaked = original.rawMetadataValues.filter((v) => v.length >= 4 && corpus.includes(v));
  const personalMetadataRemaining = new Set(leaked).size;
  if (leaked.length > 0) risk.push('В выходных байтах остались исходные значения метаданных.');

  const annotationsAnonymised = !original.hasAnnotations || leaked.length === 0;

  const images = embeddedImages(loaded.entryNames);
  let embeddedImagesVerified = 0;
  for (const img of images) {
    const bytes = await readBytes(zip, img.path);
    if (!bytes) continue;
    try {
      if (personalFindingCount(img.handler.scan(toArrayBuffer(bytes)).findings) === 0) embeddedImagesVerified++;
    } catch {
      // Counts as not verified.
    }
  }
  const allImagesVerified = embeddedImagesVerified === images.length;

  const timestampsNormalised = loaded.entryNames.every((n) => isNeutralDate(zip.files[n].date));

  const contentPresent = loaded.entryNames.includes('content.xml');
  if (!contentPresent) risk.push('Основная часть документа (content.xml) отсутствует.');

  const verificationPassed =
    mimetypePreserved &&
    metaCleared &&
    thumbnailRemoved &&
    printerRemoved &&
    annotationsAnonymised &&
    personalMetadataRemaining === 0 &&
    timestampsNormalised &&
    allImagesVerified &&
    contentPresent;

  return {
    metadataFoundBefore,
    personalMetadataRemaining,
    metaCleared,
    thumbnailRemoved,
    printerRemoved,
    annotationsAnonymised,
    timestampsNormalised,
    mimetypePreserved,
    embeddedImagesVerified,
    verificationPassed,
    remainingRisk: risk,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
