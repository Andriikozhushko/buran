# BURAN Format Roadmap

BURAN supports **30 formats**, all behind a single format registry
(`src/lib/formats/registry.ts`): one descriptor per format carrying its
identity, size limit, magic-byte detection, and scan/clean pipelines. Adding a
format is a new handler plus one registry entry. The canonical per-format
claims live in [`FORMAT_SUPPORT_MATRIX.md`](./FORMAT_SUPPORT_MATRIX.md).

## Implemented

### Image core (01A)

✅ **JPEG** — EXIF, GPS, XMP, IPTC, comments, thumbnails, orientation.
✅ **PNG** — eXIf, tEXt, zTXt, iTXt, tIME, metadata chunks.
✅ **WebP** — EXIF, XMP in VP8X containers.

### PDF (02A)

✅ **PDF (metadata-only)** — Info dictionary (incl. custom properties), XMP
`/Metadata` streams, `/PieceInfo`, annotation author/identity fields, trailer
`/ID` removal. Full rewrite via `pdf-lib`; independent re-parse + raw-byte
verification. See [`PDF_SUPPORT_02A.md`](./PDF_SUPPORT_02A.md).

### Office OOXML (02B)

✅ **DOCX / XLSX / PPTX (metadata-only)** — docProps, comment-author and
tracked-change identity, embedded image metadata, ZIP timestamps. Blocks
encrypted/signed/macro/OLE risk states. Legacy `.doc/.xls/.ppt` (OLE/CFB) is
honestly reported as unsupported legacy, not "encrypted". See
[`OFFICE_SUPPORT_02B.md`](./OFFICE_SUPPORT_02B.md).

### ZIP archives (02C)

✅ **ZIP** — comments, entry timestamps, host/extra metadata; recursive
cleaning of supported nested files (now including images, PDF, Office, audio,
and video) and one nested ZIP level. See
[`ZIP_SUPPORT_02C.md`](./ZIP_SUPPORT_02C.md).

### HEIC / HEIF (04B)

✅ **HEIC / HEIF (clean export)** — WebAssembly decode and verified JPEG/PNG
export. See [`HEIC_HEIF_SUPPORT_04B.md`](./HEIC_HEIF_SUPPORT_04B.md).

### Wave 1 — extended image formats

✅ **TIFF** — EXIF/GPS/XMP/IPTC/Photoshop, preview pages, private tags;
IFD-rebuild with pixel strips byte-identical. Refuses RAW (CR2/DNG).
✅ **GIF** — comment and application extensions; NETSCAPE loop + ICC kept.
✅ **BMP** — linked colour-profile path leak, trailing data.
✅ **AVIF** — Exif/XMP items removed in place with `free`-box padding.
✅ **ICO** — PNG-payload metadata via the PNG core.
✅ **SVG** — metadata/editor namespaces/comments, with an active-content
security gate (scripts, handlers, `foreignObject`, external refs → refused).

### Wave 2 — open document + ebook

✅ **ODT / ODS / ODP / ODG** — `meta.xml`, thumbnail, printer identity,
annotation identity, embedded images; classified from the package `mimetype`.
✅ **EPUB** — reader/library fingerprints (`calibre:*`, `dcterms:modified`)
removed while the book's bibliography is preserved. Blocks DRM.

### Wave 3 — audio

✅ **MP3** — ID3v2 (2.2/2.3/2.4), ID3v1, APEv2, Lyrics3.
✅ **FLAC** — VORBIS_COMMENT, PICTURE, APPLICATION.
✅ **WAV** — LIST-INFO, `bext`, `iXML`, `id3`, XMP, unknown chunks.
✅ **OGG / Opus** — comment packet emptied, page rebuilt with recomputed CRC-32.

### Wave 4 — video

✅ **MP4 / M4A / M4V / MOV** — `udta`/`meta`/`uuid` boxes and mvhd/tkhd/mdhd
timestamps, GPS `©xyz`; cleaned in place so `stco` offsets stay valid.
✅ **MKV / WebM** — Title/DateUTC/Tags/Attachments voided in place; app
elements zeroed.
✅ **AVI** — LIST-INFO and IDIT retyped to JUNK in place; `idx1` stays valid.

### Wave 5 — specialist documents

✅ **RTF** — `\info` group and `\*\generator`, brace-matched.
✅ **PSD** — 8BIM IPTC/EXIF/XMP/thumbnail/URL/version-info resources; ICC and
layers/pixels preserved.
✅ **EML** — Received relay chain, X-Originating-IP, X-Mailer/User-Agent,
Message-ID; message body and attachments preserved.

## Not yet supported

- **Legacy binary Office** (`.doc/.xls/.ppt`) and **`.msg`** — need a CFB
  reader/writer; currently an honest block. `SummaryInformation` /
  `DocumentSummaryInformation` streams are the target surface.
- **Camera RAW** (CR2, NEF, ARW, DNG, ORF, RW2) — TIFF-based, but maker notes
  are proprietary and unverifiable after modification; the honest default is a
  block or a verified clean export, never a silent partial strip.
- **Engine localisation** — block reasons, error messages, and finding
  descriptions emitted by handlers are still partly Russian; UI chrome is
  fully localised in 8 languages. Migration to message codes is in progress.

## Design Principles for New Format Handlers

1. **Parse only** — do not re-encode or re-compress content data.
2. **Preserve colour** — never strip ICC profiles or colour rendering data.
3. **Verify** — always re-scan the output and report honestly; a cleaned file
   must re-scan as clean.
4. **Detect by content** — never trust the filename extension.
5. **Don't pretend** — if a variant cannot be safely cleaned, block it.
6. **Document limits** — each handler must declare what it can and cannot do.
