/**
 * Office package detection & safety gating.
 *
 * Classification and blocking rely on magic bytes and package contents, never
 * on the file extension alone. When a structure cannot be sanitised without
 * risking the document's integrity (encryption, signatures, macros, OLE/ActiveX
 * objects, custom XML, threaded comments, unsupported media), BURAN blocks it.
 */

import type { LoadedPackage } from './package';
import type { EmbeddedImage, OfficeBlock, OfficeFormat } from './types';

/** Supported embedded raster image extensions (cleaned via the image core). */
const SUPPORTED_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
/** Metadata-bearing image formats BURAN cannot yet verify-clean → block. */
const BLOCK_IMAGE_EXT = new Set(['tif', 'tiff', 'bmp', 'gif', 'heic', 'heif', 'jp2', 'j2k']);

/** "zip" = OOXML (PK), "cfb" = OLE compound (encrypted/legacy), null = neither. */
export function detectOfficeContainer(buffer: ArrayBuffer): 'zip' | 'cfb' | null {
  const b = new Uint8Array(buffer);
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) {
    return 'zip';
  }
  if (
    b.length >= 8 &&
    b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 &&
    b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1
  ) {
    return 'cfb';
  }
  return null;
}

function officeBlock(reason: OfficeBlock['reason'], message: string): OfficeBlock {
  return { blocked: true, reason, message };
}

/** Identify the OOXML application type from the package parts. */
export function classifyOffice(entryNames: string[]): OfficeFormat | null {
  const set = new Set(entryNames);
  if (set.has('word/document.xml')) return 'docx';
  if (set.has('xl/workbook.xml')) return 'xlsx';
  if (set.has('ppt/presentation.xml')) return 'pptx';
  // Looser fallbacks for unusual layouts.
  if (entryNames.some((n) => n.startsWith('word/'))) return 'docx';
  if (entryNames.some((n) => n.startsWith('xl/'))) return 'xlsx';
  if (entryNames.some((n) => n.startsWith('ppt/'))) return 'pptx';
  return null;
}

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Collect supported embedded raster images from the package media folders. */
export function collectEmbeddedImages(entryNames: string[]): EmbeddedImage[] {
  const images: EmbeddedImage[] = [];
  for (const name of entryNames) {
    if (!/\/media\//.test(name)) continue;
    const e = ext(name);
    if (e === 'png') images.push({ path: name, format: 'png' });
    else if (e === 'jpg' || e === 'jpeg') images.push({ path: name, format: 'jpeg' });
    else if (e === 'webp') images.push({ path: name, format: 'webp' });
  }
  return images;
}

/**
 * Detect blocked structures in a loaded package. Returns the first matching
 * {@link OfficeBlock}, or null if the package is safe to sanitise.
 */
export function detectBlockedStructures(loaded: LoadedPackage): OfficeBlock | null {
  const names = loaded.entryNames;
  const has = (pred: (n: string) => boolean) => names.some(pred);

  // Macro-enabled (vbaProject.bin) → DOCM/XLSM/PPTM territory.
  if (has((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /vbaData\.xml$/i.test(n))) {
    return officeBlock(
      'macro',
      'Документ содержит макросы (vbaProject). BURAN не обрабатывает макросодержащие файлы, поэтому файл не был изменён.',
    );
  }

  // Digital signatures.
  if (has((n) => n.startsWith('_xmlsignatures/') || n.startsWith('_signatures/'))) {
    return officeBlock(
      'signed',
      'Пакет содержит цифровую подпись. Любое изменение метаданных сделает подпись недействительной, поэтому BURAN не изменил файл.',
    );
  }

  // Embedded OLE objects / ActiveX / arbitrary embedded packages.
  if (
    has(
      (n) =>
        /\/embeddings\//i.test(n) ||
        /oleObject\d*\.bin$/i.test(n) ||
        /\/activeX\//i.test(n) ||
        /\.(ole|emf\.bin)$/i.test(n),
    )
  ) {
    return officeBlock(
      'embedded-object',
      'В документе обнаружены встроенные OLE-объекты. Они могут содержать собственные метаданные, которые BURAN пока не умеет проверять без риска изменить содержимое. Файл не был изменён.',
    );
  }

  // Custom XML parts that cannot be classified as metadata-only.
  if (has((n) => n.startsWith('customXml/'))) {
    return officeBlock(
      'custom-xml',
      'Документ содержит пользовательские XML-данные (customXml). BURAN не может безопасно классифицировать их как метаданные, поэтому файл не был изменён.',
    );
  }

  // Word threaded comments / People metadata.
  if (has((n) => n === 'word/commentsExtended.xml' || n === 'word/people.xml' || n === 'word/commentsIds.xml')) {
    return officeBlock(
      'threaded-comments',
      'Документ Word использует расширенные/потоковые комментарии (people/commentsExtended). BURAN пока не умеет безопасно анонимизировать их, поэтому файл не был изменён.',
    );
  }

  // Excel threaded comments / Persons metadata.
  if (has((n) => n.startsWith('xl/threadedComments/') || n.startsWith('xl/persons/'))) {
    return officeBlock(
      'threaded-comments',
      'Книга Excel использует потоковые комментарии (threadedComments/persons). BURAN пока не умеет безопасно анонимизировать их, поэтому файл не был изменён.',
    );
  }

  // Unsupported, potentially metadata-bearing embedded media.
  const badMedia = names.find((n) => /\/media\//.test(n) && BLOCK_IMAGE_EXT.has(ext(n)));
  if (badMedia) {
    return officeBlock(
      'unsupported-media',
      'В документе есть встроенное изображение в формате, который BURAN пока не умеет очищать (например, TIFF/GIF/HEIC). Чтобы не давать ложных гарантий, файл не был изменён.',
    );
  }

  return null;
}

export { SUPPORTED_IMAGE_EXT };
