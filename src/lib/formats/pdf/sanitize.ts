/**
 * PDF metadata-only sanitiser.
 *
 * Produces a fresh PDF (full rewrite, not an incremental update appended to the
 * original) with supported personal/identifying metadata removed and the
 * visible/functional document content preserved.
 *
 * Removed: Info dictionary (and custom properties), document-level and
 * object-level XMP /Metadata streams, PieceInfo/application-private metadata,
 * annotation author/title identity fields (/T, /M, /NM). The trailer /ID is
 * regenerated to a fresh random value.
 *
 * Preserved: pages, page geometry, content streams, text, images, links,
 * outlines, forms, and annotation content/appearance (/Contents, /AP).
 *
 * BURAN never writes its own name, the original filename, or any fingerprint
 * into the output.
 */

import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRef,
  PDFHexString,
} from 'pdf-lib';

const METADATA = PDFName.of('Metadata');
const PIECE_INFO = PDFName.of('PieceInfo');

/** 16 random bytes as an uppercase hex string, via the platform CSPRNG. */
function randomIdHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Sanitise a PDF buffer and return a fresh, cleaned buffer.
 * Assumes the document has already passed detection gating (not encrypted,
 * signed, XFA, portfolio, or carrying attachments).
 */
export async function sanitizePdf(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });

  // --- Remove the Info dictionary entirely (not blanked field-by-field) ---
  const infoRef = doc.context.trailerInfo.Info;
  if (infoRef instanceof PDFRef) {
    doc.context.delete(infoRef);
  }
  doc.context.trailerInfo.Info = undefined;

  // --- Remove XMP /Metadata and PieceInfo wherever they appear ---
  // Removing only the catalog reference would leave the orphan stream in the
  // file, so we both unregister the indirect object and drop the reference.
  const refsToDelete: PDFRef[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;

    const meta = obj.get(METADATA);
    if (meta) {
      if (meta instanceof PDFRef) refsToDelete.push(meta);
      obj.delete(METADATA);
    }

    if (obj.get(PIECE_INFO)) {
      const pi = obj.get(PIECE_INFO);
      if (pi instanceof PDFRef) refsToDelete.push(pi);
      obj.delete(PIECE_INFO);
    }
  }
  doc.catalog.delete(METADATA);
  doc.catalog.delete(PIECE_INFO);
  for (const ref of refsToDelete) doc.context.delete(ref);

  // --- Strip annotation author/title identity fields, keep content/appearance ---
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      a.delete(PDFName.of('T')); // author / title label
      a.delete(PDFName.of('M')); // modification date
      a.delete(PDFName.of('NM')); // unique annotation name/id
    }
  }

  // --- Regenerate the document /ID (defeats cross-copy correlation) ---
  const idHex = randomIdHex();
  doc.context.trailerInfo.ID = doc.context.obj([
    PDFHexString.of(idHex),
    PDFHexString.of(idHex),
  ]);

  // Fresh, fully-rewritten output. We removed the Info dictionary entirely, so
  // pdf-lib has nothing to re-stamp — the output carries no Producer/Creator
  // fingerprint. `useObjectStreams: false` keeps metadata uncompressed so the
  // independent verification pass can scan the raw bytes meaningfully.
  const out = await doc.save({ useObjectStreams: false });

  // Copy into a clean ArrayBuffer (detached, transferable to the main thread).
  const copy = new Uint8Array(out.length);
  copy.set(out);
  return copy.buffer;
}
