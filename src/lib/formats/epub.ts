/**
 * EPUB metadata scanning and sanitisation.
 *
 * An EPUB is a ZIP with a STORED `application/epub+zip` mimetype entry and an
 * OPF package document. The book's own bibliography (title, author,
 * identifier, publication date) is CONTENT and is never touched — what leaks
 * is the reader/library fingerprint: `calibre:*` fields (library IDs, custom
 * columns, timestamps), `dcterms:modified`, ZIP entry timestamps, and
 * metadata inside embedded images. DRM'd books (encryption.xml) are refused.
 */

import type { MetadataFinding, FormatHandler } from './types';
import { personalFindingCount } from './types';
import { jpegHandler } from './jpeg';
import { pngHandler } from './png';
import { webpHandler } from './webp';
import { gifHandler } from './gif';
import type { OfficeBlock } from './office/types';
import {
  isNeutralDate,
  loadPackage,
  officeBlock,
  readBytes,
  readText,
  rebuildPackage,
} from './office/package';

const IMAGE_HANDLERS: Record<string, FormatHandler> = {
  jpg: jpegHandler,
  jpeg: jpegHandler,
  png: pngHandler,
  webp: webpHandler,
  gif: gifHandler,
};

function embeddedImages(entryNames: string[]): Array<{ path: string; handler: FormatHandler }> {
  const out: Array<{ path: string; handler: FormatHandler }> = [];
  for (const name of entryNames) {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const handler = IMAGE_HANDLERS[ext];
    if (handler) out.push({ path: name, handler });
  }
  return out;
}

export interface EpubScanData {
  findings: MetadataFinding[];
  rawMetadataValues: string[];
  opfPath: string | null;
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

async function findOpfPath(zipText: (name: string) => Promise<string | null>): Promise<string | null> {
  const container = await zipText('META-INF/container.xml');
  return container?.match(/full-path="([^"]+\.opf)"/i)?.[1] ?? null;
}

export async function scanEpub(buffer: ArrayBuffer): Promise<OfficeBlock | { data: EpubScanData }> {
  const loaded = await loadPackage(buffer);
  if ('blocked' in loaded) return loaded;

  const mimetype = ((await readText(loaded.zip, 'mimetype')) ?? '').trim();
  if (mimetype !== 'application/epub+zip') {
    return officeBlock('unsupported-package', 'Файл не является поддерживаемой электронной книгой EPUB.');
  }
  if (loaded.entryNames.includes('META-INF/encryption.xml')) {
    return officeBlock(
      'encrypted',
      'EPUB защищён DRM/шифрованием (META-INF/encryption.xml). BURAN не может безопасно изменить такую книгу, поэтому файл не был изменён.',
    );
  }

  const findings: MetadataFinding[] = [];
  const raw: string[] = [];

  const opfPath = await findOpfPath((name) => readText(loaded.zip, name));
  const opf = opfPath ? ((await readText(loaded.zip, opfPath)) ?? '') : '';

  // Library/reader fingerprints — the book's own bibliography stays.
  const calibreMetas = opf.match(/<meta\b[^>]*name="calibre:[^"]*"[^>]*\/?>/gi) ?? [];
  for (const entry of calibreMetas) {
    const name = entry.match(/name="calibre:([^"]*)"/i)?.[1] ?? 'field';
    const value = entry.match(/content="([^"]*)"/i)?.[1] ?? null;
    findings.push(mk(`EPUB:calibre:${name}`, `Calibre field (${name})`, value, 'software', 'medium'));
    if (value) raw.push(value);
  }
  const modified = opf.match(/<meta\b[^>]*property="dcterms:modified"[^>]*>([\s\S]*?)<\/meta>/i);
  if (modified) {
    const value = modified[1].trim();
    findings.push(mk('EPUB:modified', 'Last modified date', value || null, 'dates', 'medium'));
    if (value) raw.push(value);
  }
  const contributorTools = opf.match(/<dc:contributor\b[^>]*opf:role="bkp"[^>]*>([\s\S]*?)<\/dc:contributor>/gi) ?? [];
  for (const entry of contributorTools) {
    const value = entry.replace(/<[^>]+>/g, '').trim();
    findings.push(mk('EPUB:producer', 'Producing tool', value || null, 'software', 'medium'));
    if (value) raw.push(value);
  }

  const images = embeddedImages(loaded.entryNames);
  let withMeta = 0;
  for (const img of images) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (!bytes) continue;
    try {
      const scan = img.handler.scan(toArrayBuffer(bytes));
      if (personalFindingCount(scan.findings) > 0) withMeta++;
      for (const f of scan.findings) if (f.value && f.value.length >= 3) raw.push(f.value);
    } catch {
      // Unreadable image — left as-is; verification will flag residue.
    }
  }
  if (withMeta > 0) {
    findings.push(mk('EPUB:embeddedImages', 'Embedded images with metadata', `${withMeta} of ${images.length}`, 'containers', 'medium'));
  }

  const timestampsCarryInfo = loaded.entryNames.some((n) => !isNeutralDate(loaded.zip.files[n].date));
  if (timestampsCarryInfo) {
    findings.push(mk('EPUB:zipTimestamps', 'ZIP container timestamps', 'Present', 'containers', 'low'));
  }

  return {
    data: {
      findings,
      rawMetadataValues: raw.filter((s) => s && s.trim().length >= 3),
      opfPath,
      embeddedImageCount: images.length,
      entryCount: loaded.entryCount,
    },
  };
}

export async function sanitizeEpub(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const loaded = await loadPackage(buffer);
  if ('blocked' in loaded) throw new Error('Пакет заблокирован и не может быть очищен.');
  const mimetype = ((await readText(loaded.zip, 'mimetype')) ?? '').trim();
  if (mimetype !== 'application/epub+zip') throw new Error('Файл не является поддерживаемым EPUB.');

  const replace = new Map<string, Uint8Array | string>();

  const opfPath = await findOpfPath((name) => readText(loaded.zip, name));
  if (opfPath) {
    const opf = await readText(loaded.zip, opfPath);
    if (opf) {
      let out = opf;
      out = out.replace(/\s*<meta\b[^>]*name="calibre:[^"]*"[^>]*\/?>(?:<\/meta>)?/gi, '');
      out = out.replace(/\s*<meta\b[^>]*property="dcterms:modified"[^>]*>[\s\S]*?<\/meta>/gi, '');
      out = out.replace(/\s*<dc:contributor\b[^>]*opf:role="bkp"[^>]*>[\s\S]*?<\/dc:contributor>/gi, '');
      if (out !== opf) replace.set(opfPath, out);
    }
  }

  for (const img of embeddedImages(loaded.entryNames)) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (!bytes) continue;
    try {
      replace.set(img.path, new Uint8Array(img.handler.clean(toArrayBuffer(bytes))));
    } catch {
      // Leave original bytes; verification will flag residual metadata.
    }
  }

  return rebuildPackage(loaded, new Set(), replace, { storeUncompressed: new Set(['mimetype']) });
}

export interface EpubVerification {
  metadataFoundBefore: number;
  personalMetadataRemaining: number;
  fingerprintsRemoved: boolean;
  timestampsNormalised: boolean;
  mimetypePreserved: boolean;
  embeddedImagesVerified: number;
  verificationPassed: boolean;
  remainingRisk: string[];
}

export async function verifyEpub(original: EpubScanData, cleanBuffer: ArrayBuffer): Promise<EpubVerification> {
  const metadataFoundBefore = original.findings.length;
  const fail = (risk: string[]): EpubVerification => ({
    metadataFoundBefore,
    personalMetadataRemaining: metadataFoundBefore,
    fingerprintsRemoved: false,
    timestampsNormalised: false,
    mimetypePreserved: false,
    embeddedImagesVerified: 0,
    verificationPassed: false,
    remainingRisk: risk,
  });

  const loaded = await loadPackage(cleanBuffer);
  if ('blocked' in loaded) return fail(['Очищенную книгу не удалось разобрать.']);
  const risk: string[] = [];

  const mimetype = ((await readText(loaded.zip, 'mimetype')) ?? '').trim();
  const head = new Uint8Array(cleanBuffer.slice(30, 38));
  const mimetypePreserved = mimetype === 'application/epub+zip' && String.fromCharCode(...head) === 'mimetype';

  const opfPath = await findOpfPath((name) => readText(loaded.zip, name));
  const opf = opfPath ? ((await readText(loaded.zip, opfPath)) ?? '') : '';
  const fingerprintsRemoved =
    !/name="calibre:/i.test(opf) && !/property="dcterms:modified"/i.test(opf) && !/opf:role="bkp"/i.test(opf);
  if (!opfPath) risk.push('OPF-файл книги не найден после очистки.');

  let corpus = '';
  for (const name of loaded.entryNames) {
    if (/\.(xml|opf|xhtml|html|ncx)$/i.test(name)) corpus += ((await readText(loaded.zip, name)) ?? '') + '\n';
  }
  const imageEntries = embeddedImages(loaded.entryNames);
  for (const img of imageEntries) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (bytes) corpus += new TextDecoder('latin1').decode(bytes);
  }
  const leaked = original.rawMetadataValues.filter((v) => v.length >= 4 && corpus.includes(v));
  const personalMetadataRemaining = new Set(leaked).size;
  if (leaked.length > 0) risk.push('В выходных байтах остались исходные значения метаданных.');

  let embeddedImagesVerified = 0;
  for (const img of imageEntries) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (!bytes) continue;
    try {
      if (personalFindingCount(img.handler.scan(toArrayBuffer(bytes)).findings) === 0) embeddedImagesVerified++;
    } catch {
      // Counts as not verified.
    }
  }
  const allImagesVerified = embeddedImagesVerified === imageEntries.length;

  const timestampsNormalised = loaded.entryNames.every((n) => isNeutralDate(loaded.zip.files[n].date));

  const verificationPassed =
    mimetypePreserved &&
    fingerprintsRemoved &&
    personalMetadataRemaining === 0 &&
    timestampsNormalised &&
    allImagesVerified &&
    opfPath !== null;

  return {
    metadataFoundBefore,
    personalMetadataRemaining,
    fingerprintsRemoved,
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
