# PDF Metadata Sanitisation (Milestone 02A)

BURAN can inspect, sanitise, and verify **PDF metadata** entirely inside the
browser. This milestone is **metadata-only**. BURAN is **not** a PDF flattener,
rasteriser, converter, watermark remover, content redactor, annotation remover,
form remover, or document editor.

All PDF processing happens locally. No uploads, no backend, no network calls.

---

## Supported scope

Ordinary, non-encrypted, unsigned PDFs **without** portfolios, XFA forms, or
embedded attachments, up to **100 MB** and **500 pages**.

PDF parsing and rewriting use [`pdf-lib`](https://github.com/Hopding/pdf-lib)
(MIT, pure-JS, browser-compatible). Heavy work runs inside Web Workers
(`scan.worker`, `clean.worker`) to keep the UI responsive.

---

## Metadata surfaces inspected and removed

### Document Information dictionary (`/Info`)

| Field | Action |
|-------|--------|
| Title | Removed |
| Author | Removed |
| Subject | Removed |
| Keywords | Removed |
| Creator | Removed |
| Producer | Removed |
| CreationDate | Removed |
| ModDate | Removed |
| **Custom Info keys/values** | Removed |

The Info dictionary is **removed in its entirety** (object deleted from the
document and unlinked from the trailer), not blanked field-by-field.

### XMP metadata (`/Metadata` streams)

Detected and removed wherever they appear (document catalog **and** any other
object that carries a `/Metadata` stream):

- Dublin Core: `dc:creator`, `dc:title`, `dc:description`, `dc:rights`
- XMP: `xmp:CreatorTool`, `pdf:Producer`
- XMP dates: `xmp:CreateDate`, `xmp:ModifyDate`, `xmp:MetadataDate`
- Company / organisation fields
- `xmpMM:DocumentID`
- Custom (non-standard) XMP namespaces are detected and flagged

The XMP stream object is unregistered from the document context (not merely
dereferenced), so no orphan packet remains in the output bytes.

### Document identifiers

- The trailer `/ID` is **regenerated** to a fresh random value (16 bytes from
  the platform CSPRNG), defeating cross-copy correlation.

### Application-private metadata

- `/PieceInfo` structures (e.g. left by Illustrator/Acrobat) are removed at the
  catalog and page levels.

### Annotation identity fields

For every annotation:

- `/T` (author / title label) — removed
- `/M` (modification date) — removed
- `/NM` (unique annotation name/id) — removed

The annotation's **content and appearance are preserved**: `/Contents`, `/AP`,
`/Rect`, `/Subtype`. The comment text stays visible; only the author identity is
stripped. Annotation body text is never treated as metadata.

---

## Exact preservation promise

BURAN preserves, as far as `pdf-lib` round-tripping allows:

- Page count
- Page dimensions / orientation (MediaBox geometry)
- Visible page content and content streams
- Text, images, links
- Bookmarks / outlines
- Form fields (AcroForm)
- Annotations and their visible content/appearance

BURAN produces a **fresh, fully-rewritten PDF** (not an incremental update
appended to the original). The output carries **no BURAN/pdf-lib fingerprint**
(no author, creator, producer, comment, watermark) and never embeds the original
filename.

> Edge-case honesty: preservation is guaranteed only to the extent `pdf-lib` can
> faithfully re-serialise the document. If a structure cannot be preserved
> safely, BURAN blocks the file rather than degrading it.

---

## Unsupported / blocked structures

For these, BURAN shows an honest blocked state and **produces no output**:

| Category | Why blocked |
|----------|-------------|
| Password-protected / encrypted | Cannot read/modify safely |
| Digitally signed | Any change invalidates the signature |
| XFA forms | Cannot safely preserve dynamic forms |
| PDF portfolios (`/Collection`) | Multiple nested documents |
| Embedded attachments (`/EmbeddedFiles`) | Attachments carry their own metadata BURAN does not clean |
| > 500 pages | Milestone processing limit |
| > 100 MB | Milestone size limit |
| Malformed / unparseable | Cannot guarantee a safe result |

Detection is **conservative** and runs on the raw bytes **before** any
structured parse, so unsafe documents are never modified. When in doubt, BURAN
blocks.

---

## Verification strategy

After sanitisation, BURAN runs a **fully independent second pass** over the
output that does not trust the sanitiser:

1. Re-parses the cleaned bytes from scratch with `pdf-lib`.
2. Re-runs the scanner over the output.
3. Scans the **raw output bytes** for the original metadata sentinels and for
   any residual XMP packet markers (`<?xpacket`, `<x:xmpmeta`, `rdf:RDF`).

The status model (`PdfVerification`):

```ts
type PdfVerification = {
  metadataFoundBefore: number;
  personalMetadataRemaining: number;          // regenerated random /ID excluded
  infoDictionaryRemoved: boolean;
  xmpRemoved: boolean;
  annotationAuthorFieldsRemoved: boolean;
  documentIdRegeneratedOrRemoved: boolean;
  pageCountPreserved: boolean;
  pageGeometryPreserved: boolean;
  verificationPassed: boolean;
  remainingUnsupportedMetadataRisk: string[];
};
```

`verificationPassed` (and the UI line **«Личных метаданных осталось: 0»**) is
only reported when **every** supported surface is proven absent:

- no Info personal properties remain;
- no XMP stream remains (catalog, any object, or raw bytes);
- no custom metadata values remain;
- no original sentinel strings remain in the raw output;
- the document still parses;
- page count and page geometry are preserved;
- the document `/ID` was regenerated.

---

## Module layout

```
src/lib/formats/pdf/
  types.ts      // PdfBlock, PdfVerification, PdfScanData, …
  detect.ts     // magic bytes + conservative raw-byte safety gating
  scan.ts       // structured metadata inspection (Info, XMP, ID, annotations)
  sanitize.ts   // fresh-output, metadata-only removal
  verify.ts     // independent re-parse + raw-byte sentinel pass
  index.ts      // public surface
```

PDF processing is asynchronous and has a blocked outcome, so it does not
implement the synchronous image `FormatHandler`; the workers route PDFs through
these functions directly.

---

## What BURAN does **not** claim

- It does **not** make the document anonymous.
- It does **not** remove visible content, watermarks, steganography, or secrets
  embedded in the document body or in embedded files.
- It does **not** claim "all metadata removed" unless verification proves the
  supported containers are absent.
