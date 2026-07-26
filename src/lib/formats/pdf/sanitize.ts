/**
 * PDF metadata-only sanitiser.
 *
 * Produces a fresh PDF (full rewrite, not an incremental update appended to the
 * original) with supported personal/identifying metadata removed and the
 * visible/functional document content preserved.
 *
 * Removed: Info dictionary (and custom properties), document-level and
 * object-level XMP /Metadata streams, PieceInfo/application-private metadata,
 * annotation author/title identity fields (/T, /M, /NM), and the trailer /ID
 * (optional per spec; removing it defeats cross-copy correlation and lets a
 * re-scan of the cleaned file honestly report nothing to remove).
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
} from 'pdf-lib';

const METADATA = PDFName.of('Metadata');
const PIECE_INFO = PDFName.of('PieceInfo');

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

  // --- Remove the document /ID entirely ---
  // /ID is optional (required only for encrypted documents, which are blocked
  // upstream). A regenerated random ID would be indistinguishable from a real
  // one on re-scan, so removal is both the stronger anti-correlation measure
  // and the only honest one.
  delete doc.context.trailerInfo.ID;

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
