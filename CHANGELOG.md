# Changelog

## 1.0.1 — 30 formats, format registry, honest re-scan guarantee

- **Format registry** (`src/lib/formats/registry.ts`): one descriptor per format (identity, size limit, magic-byte detection, scan/clean pipelines). Both workers are now thin dispatch loops; adding a format is a handler plus one registry entry.
- **21 new formats** (9 → 30):
  - Images: TIFF, GIF, BMP, AVIF, ICO, SVG (with an active-content security gate), PSD.
  - Documents: ODT/ODS/ODP/ODG, EPUB, RTF, EML.
  - Audio: MP3, FLAC, WAV, OGG/Opus.
  - Video: MP4/M4A/M4V/MOV, MKV/WebM, AVI — cleaned in place (metadata boxes/chunks/elements neutralised without moving a byte; GPS destroyed, timestamps zeroed).
- **Content-based detection everywhere**: renamed OOXML/ODF/EPUB packages are classified from package content, never the filename. Legacy binary Office (`.doc/.xls/.ppt`) is honestly reported as legacy instead of falsely "encrypted".
- **Honest re-scan guarantee**: a file BURAN just cleaned re-scans as clean (neutral ZIP timestamps, `Anonymous` placeholders, removed PDF `/ID` and informational findings are no longer reported as removable metadata). Enforced by `tests/unit/rescan-clean.test.ts`.
- **Embedded/nested cleaning**: the new raster formats clean inside Office/ODF/EPUB packages and inside ZIP archives; audio/video clean inside archives.
- **Performance**: startup media cut ~12× (hero video 6.2 MB → 515 KB, logo 1.6 MB → 84 KB, poster frame added) for slow connections. Clickable logo returns home; favicon generated from the logo emblem.
- **Automated deploy**: GitHub Pages workflow builds, tests, and publishes on push to `main`.
- Tests: 176 → 230 unit tests, plus the Playwright e2e suite.
- Honest blocks (by design, not gaps): legacy binary Office and `.msg`, camera RAW, and encrypted/DRM/macro-bearing documents.

## 0.1.0 — Initial public release

- Browser-only metadata inspection, sanitisation, and verification.
- Supported formats: JPEG/JPG, PNG, WebP, PDF, DOCX, XLSX, PPTX, and ordinary ZIP archives with one nested ZIP level.
- Local-only processing: no uploads, telemetry, analytics, backend, accounts, or API calls.
- Independent post-clean verification before reporting a clean result.
- ZIP archives preserve folder structure and unsupported files byte-for-byte while clearly reporting unsupported metadata risk.
- Known limitations: BURAN does not remove visible content, watermarks, steganography, QR codes, faces, text in images, or secrets embedded in document content. Unsupported files inside archives remain unchanged.
