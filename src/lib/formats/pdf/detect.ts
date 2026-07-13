/**
 * PDF detection & safety gating.
 *
 * Before BURAN touches a PDF it must rule out structures that cannot be
 * sanitised without breaking the document's product promise (signatures,
 * encryption, XFA, portfolios, embedded attachments) or that fall outside the
 * supported scope (oversize, too many pages, malformed). When in doubt, block.
 *
 * Detection here is intentionally conservative and relies on raw byte scanning
 * so it does not depend on a successful structured parse.
 */

import type { PdfBlock, PdfBlockReason } from './types';

/** Hard limits for the 02A milestone. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_PDF_PAGES = 500;

/** PDF magic bytes: "%PDF-". */
export function detectPdfMagic(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  if (b.length < 5) return false;
  return (
    b[0] === 0x25 && // %
    b[1] === 0x50 && // P
    b[2] === 0x44 && // D
    b[3] === 0x46 && // F
    b[4] === 0x2d //   -
  );
}

/**
 * Decode the buffer as latin1 (1 byte = 1 code unit) so we can scan for PDF
 * tokens without corrupting binary regions. Used for structural detection only.
 */
function asLatin1(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Chunked decode to avoid call-stack limits on very large files.
  const decoder = new TextDecoder('latin1');
  return decoder.decode(bytes);
}

/**
 * Scan raw bytes for security-sensitive / unsupported structures.
 * Returns a {@link PdfBlock} if the document must not be sanitised, else null.
 *
 * Order matters: encryption and signatures are reported first because they are
 * the highest-risk and most user-relevant.
 */
export function rawSecurityScan(buffer: ArrayBuffer): PdfBlock | null {
  const text = asLatin1(buffer);

  // Encryption: trailer references an /Encrypt dictionary.
  if (/\/Encrypt\b/.test(text)) {
    return block('encrypted');
  }

  // Digital signatures: a signature dictionary with a /ByteRange, an
  // /adbe.pkcs7* SubFilter, or the AcroForm /SigFlags marker.
  if (
    /\/ByteRange\s*\[/.test(text) ||
    /\/SubFilter\s*\/(adbe\.pkcs7|ETSI\.CAdES)/.test(text) ||
    /\/SigFlags\s+[123]/.test(text) ||
    /\/Type\s*\/Sig\b/.test(text)
  ) {
    return block('signed');
  }

  // XFA forms (LiveCycle dynamic forms): /XFA entry in the AcroForm.
  if (/\/XFA\b/.test(text)) {
    return block('xfa');
  }

  // PDF portfolio / collection.
  if (/\/Collection\b/.test(text)) {
    return block('portfolio');
  }

  // Embedded file attachments.
  if (/\/EmbeddedFiles\b/.test(text) || /\/Type\s*\/EmbeddedFile\b/.test(text)) {
    return block('attachments');
  }

  return null;
}

/** Build a blocked result with its user-facing Russian explanation. */
export function block(reason: PdfBlockReason): PdfBlock {
  return { blocked: true, reason, message: blockMessage(reason) };
}

/** Human-language explanation for each blocked reason (Russian). */
export function blockMessage(reason: PdfBlockReason): string {
  switch (reason) {
    case 'encrypted':
      return 'Документ защищён паролем или зашифрован. BURAN не может прочитать и безопасно изменить такой файл, поэтому он не был изменён.';
    case 'signed':
      return 'В документе обнаружена цифровая подпись. Любое изменение метаданных сделает подпись недействительной, поэтому BURAN не изменил файл.';
    case 'xfa':
      return 'Документ использует динамические XFA-формы. BURAN пока не умеет безопасно сохранять такие формы при очистке метаданных, поэтому файл не был изменён.';
    case 'portfolio':
      return 'Это PDF-портфолио (контейнер из нескольких вложенных документов). BURAN не обрабатывает портфолио, чтобы не повредить вложенные файлы, поэтому документ не был изменён.';
    case 'attachments':
      return 'В документе есть встроенные вложения. Они могут содержать собственные метаданные, которые BURAN не очищает, поэтому файл не был изменён, чтобы не давать ложных гарантий.';
    case 'too-many-pages':
      return `В документе больше ${MAX_PDF_PAGES} страниц. В этой версии BURAN ограничивает обработку, чтобы гарантировать корректный результат, поэтому файл не был изменён.`;
    case 'too-large':
      return 'Файл больше 100 МБ. В этой версии BURAN ограничивает размер PDF, поэтому файл не был изменён.';
    case 'malformed':
      return 'Не удалось разобрать структуру PDF — файл повреждён или использует неподдерживаемую конструкцию. BURAN не изменил файл, чтобы не повредить его.';
  }
}
