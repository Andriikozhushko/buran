# BURAN Format Roadmap

## Current Milestone (01A — Image Core)

✅ **JPEG** — EXIF, GPS, XMP, IPTC, comments, thumbnails, orientation.
✅ **PNG** — eXIf, tEXt, zTXt, iTXt, tIME, metadata chunks.
✅ **WebP** — EXIF, XMP in VP8X containers.

## Milestone 02A — PDF Metadata (Implemented)

✅ **PDF (metadata-only)** — Info dictionary (incl. custom properties), XMP
`/Metadata` streams, `/PieceInfo`, annotation author/identity fields (`/T`,
`/M`, `/NM`), and trailer `/ID` regeneration.
- Approach: fresh full rewrite via `pdf-lib` (no incremental patch); independent
  re-parse + raw-byte sentinel verification pass.
- Preserves pages, geometry, text, images, links, outlines, forms, and
  annotation content/appearance. No flattening, no rasterising, no OCR.
- Blocks encrypted, signed, XFA, portfolio, attachment-bearing, oversize
  (>100 MB / >500 pages), and malformed PDFs with an honest explanation and no
  output.
- See [`PDF_SUPPORT_02A.md`](./PDF_SUPPORT_02A.md).

## Milestone 02B — Office Metadata (Implemented)

✅ **DOCX / XLSX / PPTX (metadata-only)** — OOXML document-property cleaning.
- Removes `docProps/core.xml`, `app.xml`, `custom.xml` (incl. custom properties)
  and detaches their `[Content_Types].xml` overrides + relationships.
- Anonymises comment authors (DOCX/XLSX/PPTX) and strips Word tracked-change
  author/date/rsid metadata, preserving comment bodies and tracked content.
- Cleans embedded JPEG/PNG/WebP via the image core; normalises ZIP timestamps;
  rebuilds a fresh package with no BURAN/filename fingerprint.
- Blocks encrypted, signed, macro-enabled, OLE/ActiveX, custom-XML,
  threaded-comment, unsupported-media, oversize, zip-bomb, and malformed
  packages with honest explanations and no output.
- Independent verification re-parses the package and scans decompressed parts.
- See [`OFFICE_SUPPORT_02B.md`](./OFFICE_SUPPORT_02B.md).

## Milestone 02C — ZIP Archive Metadata (Implemented)

✅ **ZIP** — Browser-only archive metadata cleanup and recursive supported-file sanitisation.
- Removes ZIP comments, normalises per-entry timestamps to `1980-01-01 00:00:00 UTC`, and rebuilds a fresh archive without carrying identifying extra fields or Unix permissions where exposed by JSZip.
- Recursively cleans supported nested JPEG/PNG/WebP/PDF/DOCX/XLSX/PPTX files and one nested ZIP level using the existing handlers.
- Preserves folder structure, original entry names, and unsupported files byte-for-byte.
- Blocks encrypted, multi-volume, malformed, oversize, zip-bomb-like, path traversal, duplicate-path, too-deep nested, and unverifiable supported nested files with honest explanations and no output.
- See [`ZIP_SUPPORT_02C.md`](./ZIP_SUPPORT_02C.md).

## Milestone 04B — HEIC / HEIF Clean Export (Implemented)

✅ **HEIC / HEIF (clean export)** — browser-local WebAssembly decode and verified JPEG/PNG export.
- Detects ISO-BMFF HEIC/HEIF by `ftyp` compatible brands, not extension alone.
- Preflights primary image, dimensions, metadata container presence, sequence/animation indicators, auxiliary/depth markers, and decoded-pixel resource cost.
- Creates a new `buran-clean.jpg` or `buran-clean.png` without copying source metadata or filename.
- Verifies the exported JPEG/PNG with the existing image handlers.
- Blocks Live Photos/sequences, multiple images, auxiliary/depth images, malformed/protected files, unsupported colour configurations, and resource-limit cases with no output.
- See [`HEIC_HEIF_SUPPORT_04B.md`](./HEIC_HEIF_SUPPORT_04B.md).

## Next Milestones

### Milestone 04 — Extended Image Formats

**TIFF** — Similar EXIF/GPS/XMP handling to JPEG, but TIFF-native.
**GIF** — Comment extensions, application extensions.
**SVG** — XML-based metadata elements, RDF/DC metadata.

### Milestone 05 — Open Document Formats

**ODT / ODS / ODP** — Similar to OOXML approach: unzip, strip metadata XML, rezip.

### Later

- Video metadata (MOV, MP4, AVI)
- Audio metadata (MP3, FLAC, WAV)
- RAW camera formats (CR2, NEF, ARW, DNG)
- Email (EML, MSG)

## Design Principles for New Format Handlers

1. **Parse only** — do not re-encode or re-compress content data.
2. **Preserve colour** — never strip ICC profiles or colour rendering data.
3. **Verify** — always re-scan the output and report honestly.
4. **Don't pretend** — if a variant cannot be safely cleaned, report it as unsupported.
5. **Document limits** — each handler must declare what it can and cannot do.
