/**
 * Office package sanitiser (orchestrator).
 *
 * Produces a fresh rebuilt package with:
 *  - docProps/core.xml, app.xml, custom.xml (and any thumbnail) removed, and
 *    their [Content_Types].xml overrides + package relationships detached;
 *  - format-specific comment/revision identity anonymised/stripped;
 *  - embedded JPEG/PNG/WebP images cleaned via the existing image core;
 *  - ZIP entry timestamps normalised (handled by rebuildPackage).
 *
 * BURAN writes no author/creator/producer/fingerprint and no original filename.
 */

import { jpegHandler } from '../jpeg';
import { pngHandler } from '../png';
import { webpHandler } from '../webp';
import { tiffHandler } from '../tiff';
import { gifHandler } from '../gif';
import { bmpHandler } from '../bmp';
import type { OfficeFormat } from './types';
import {
  classifyOffice,
  collectEmbeddedImages,
  detectBlockedStructures,
  detectOfficeContainer,
} from './detect';
import { loadPackage, rebuildPackage, readBytes, readText, type LoadedPackage } from './package';
import {
  APP_PART,
  CORE_PART,
  CUSTOM_PART,
  removeContentTypeOverride,
  removeRelationshipsByTarget,
  removeRelationshipsWithTargetFragment,
  toArrayBuffer,
} from './shared';
import { sanitizeDocx } from './docx';
import { sanitizeXlsx } from './xlsx';
import { sanitizePptx } from './pptx';

const imageHandlers = { jpeg: jpegHandler, png: pngHandler, webp: webpHandler, tiff: tiffHandler, gif: gifHandler, bmp: bmpHandler };

export interface OfficeSanitizeOptions {
  /** Removes arbitrary customXml parts and their package relationships. */
  removeCustomXml?: boolean;
}

export async function sanitizeOffice(
  buffer: ArrayBuffer,
  { removeCustomXml = false }: OfficeSanitizeOptions = {},
): Promise<ArrayBuffer> {
  if (detectOfficeContainer(buffer) !== 'zip') {
    throw new Error('Не Office-пакет (ZIP).');
  }
  const loaded = await loadPackage(buffer);
  if ('blocked' in loaded) {
    throw new Error('Пакет заблокирован и не может быть очищен.');
  }
  const format = classifyOffice(loaded.entryNames);
  if (!format) throw new Error('Неизвестный тип Office-документа.');
  if (detectBlockedStructures(loaded, { allowCustomXmlForInspection: true })) {
    throw new Error('Пакет содержит структуру, которую BURAN не очищает.');
  }

  const drop = new Set<string>();
  const replace = new Map<string, Uint8Array | string>();

  // 1. Remove package property parts (and any thumbnail) entirely.
  const propParts = [CORE_PART, APP_PART, CUSTOM_PART];
  const thumbs = loaded.entryNames.filter((n) => /^docProps\/thumbnail\./i.test(n));
  for (const p of [...propParts, ...thumbs]) {
    if (loaded.entryNames.includes(p)) drop.add(p);
  }
  if (removeCustomXml) {
    for (const part of loaded.entryNames) {
      if (part.startsWith('customXml/')) drop.add(part);
    }
  }

  // 2. Detach from [Content_Types].xml and _rels/.rels.
  const ct = await readText(loaded.zip, '[Content_Types].xml');
  if (ct) {
    let out = ct;
    for (const p of propParts) out = removeContentTypeOverride(out, p);
    if (removeCustomXml) out = out.replace(/<Override\b[^>]*\bPartName="\/customXml\/[^"]*"[^>]*\/>\s*/gi, '');
    replace.set('[Content_Types].xml', out);
  }
  const rootRels = await readText(loaded.zip, '_rels/.rels');
  if (rootRels) {
    let out = removeRelationshipsByTarget(rootRels, [
      'docProps/core.xml',
      'docProps/app.xml',
      'docProps/custom.xml',
      'docProps/thumbnail',
    ]);
    if (removeCustomXml) out = removeRelationshipsWithTargetFragment(out, 'customXml/');
    replace.set('_rels/.rels', out);
  }
  if (removeCustomXml) {
    for (const part of loaded.entryNames) {
      if (!/\.rels$/i.test(part) || part === '_rels/.rels') continue;
      const rels = await readText(loaded.zip, part);
      if (!rels) continue;
      const out = removeRelationshipsWithTargetFragment(rels, 'customXml/');
      if (out !== rels) replace.set(part, out);
    }
  }

  // 3. Format-specific comment/revision anonymisation.
  const formatReplacements = await sanitizeByFormat(loaded, format);
  for (const [name, xml] of formatReplacements) replace.set(name, xml);

  // 4. Clean embedded supported images via the image core.
  for (const img of collectEmbeddedImages(loaded.entryNames)) {
    const bytes = await readBytes(loaded.zip, img.path);
    if (!bytes) continue;
    try {
      const ab = toArrayBuffer(bytes);
      const cleaned = imageHandlers[img.format].clean(ab);
      replace.set(img.path, new Uint8Array(cleaned));
    } catch {
      // Leave the original bytes if the image cannot be cleaned; verification
      // will flag any residual metadata.
    }
  }

  return rebuildPackage(loaded, drop, replace);
}

async function sanitizeByFormat(loaded: LoadedPackage, format: OfficeFormat): Promise<Map<string, string>> {
  if (format === 'docx') return sanitizeDocx(loaded.zip);
  if (format === 'xlsx') return sanitizeXlsx(loaded.zip);
  return sanitizePptx(loaded.zip);
}
