# BURAN Privacy & Guarantees

## Processing Model

BURAN processes files **entirely inside your browser**. At no point is file data transmitted to any server. The application is a static website with no backend, no API endpoints, no authentication, and no database.

## What BURAN Removes (JPEG / PNG / WebP)

### Location Data
- GPS coordinates (latitude, longitude, altitude)
- GPS timestamps and measurement metadata
- Location references in EXIF, XMP, and IPTC

### Device & Camera Information
- Camera make and model
- Lens model and serial number
- Camera serial number
- Firmware version
- Unique image ID

### Author & Ownership
- Artist/author name
- Copyright strings
- Owner name
- Creator contact information

### Dates & History
- Original date/time of capture
- Digitisation date/time
- Modification timestamps
- Software processing history

### Embedded Data
- EXIF thumbnails
- XMP metadata packets
- IPTC metadata blocks
- JPEG comment segments
- PNG text chunks (tEXt, zTXt, iTXt)
- PNG modification time (tIME)
- PNG EXIF (eXIf)

## What BURAN Preserves

### Colour & Rendering
- ICC colour profiles (iCCP in PNG, ICC_PROFILE in JPEG, ICCP in WebP)
- sRGB rendering intent
- Gamma correction (gAMA)
- Chromaticity (cHRM)
- White point

### Image Structure
- Pixel data (IDAT in PNG, entropy-coded data in JPEG, VP8/VP8L in WebP)
- Image dimensions
- Transparency/alpha channel
- Valid file structure and headers

### Visual Orientation
- BURAN **physically applies** EXIF orientation to JPEG pixels when a non-default orientation (2–8) is detected.
- The EXIF orientation tag is then removed along with all other privacy metadata.
- This re-encodes the image data via the browser's Canvas API at maximum quality. The resulting file is visually correct but not byte-identical to the original.
- This is disclosed honestly in both the UI and the certificate as "Ориентация: физически применена" and "Метод обработки: пересобрана чистая JPEG-копия."
- For JPEGs with normal orientation (1), pixel data is preserved directly from the original — only metadata segments are stripped.

### Honest Limitations
- If a format variant cannot be safely cleaned, BURAN reports it as unsupported rather than producing a misleading result.
- If processing is cancelled, times out, hits a browser resource limit, or cannot fully parse the file, BURAN does not produce an output and does not show a verified-clean claim.
- BURAN never claims "all metadata removed" if technical colour data remains.
- BURAN never claims "100% anonymous" or "zero possible data leakage."
- The verification pass re-scans for known metadata patterns; it cannot detect novel or unknown metadata formats.
- **JPEG re-encoding**: When orientation correction is applied, the pixel data is re-encoded. While visually lossless at maximum quality, this is not a byte-preserving operation. This is explicitly disclosed in the UI and certificate.

## What BURAN Removes (PDF — Milestone 02A)

PDF support is **metadata-only**. See [`PDF_SUPPORT_02A.md`](./PDF_SUPPORT_02A.md)
for the full specification.

### Removed
- **Info dictionary**: Title, Author, Subject, Keywords, Creator, Producer,
  CreationDate, ModDate, and **all custom Info properties** (the dictionary is
  removed entirely, not blanked).
- **XMP `/Metadata` streams** (document-level and on any object): Dublin Core
  creator/title/description/rights, `xmp:CreatorTool`, `pdf:Producer`, XMP
  dates, company fields, `xmpMM:DocumentID`, and custom namespaces.
- **`/PieceInfo`** application-private metadata.
- **Annotation identity fields**: `/T` (author), `/M` (mod date), `/NM` (id).
- The trailer **`/ID`** is regenerated to a fresh random value.

### Preserved (PDF)
- Page count and page geometry (dimensions/orientation).
- Visible page content and content streams: text, images, links.
- Outlines/bookmarks and form fields where `pdf-lib` can round-trip them.
- Annotation **content and appearance** (`/Contents`, `/AP`) — only the author
  identity is removed; comment text stays visible.
- A fresh, fully-rewritten PDF with **no BURAN/pdf-lib fingerprint** and no
  original filename.

### Blocked (PDF — no output produced)
Encrypted/password-protected, digitally signed, XFA forms, portfolios, embedded
attachments, > 100 MB, > 500 pages, and malformed PDFs. BURAN explains the exact
reason and **does not modify the file**.

### Out of scope for PDF
- **Visible/embedded-document content**: text, images, and vector content drawn
  on the page are preserved, not cleaned. BURAN does not redact them.
- **Embedded files / attachments**: their own metadata is not cleaned — such
  documents are blocked instead.
- BURAN does **not** claim a PDF is anonymous, and does **not** claim "all
  metadata removed" unless the verification pass proves the supported containers
  are absent.

## What BURAN Removes (Office — Milestone 02B)

Office support (DOCX/XLSX/PPTX) is **metadata-only**. See
[`OFFICE_SUPPORT_02B.md`](./OFFICE_SUPPORT_02B.md) for the full specification.

### Removed
- **Package properties** (`docProps/core.xml`, `app.xml`, `custom.xml`, removed
  entirely): creator, lastModifiedBy, title, subject, keywords, category,
  description, company, manager, application + version, template, created/
  modified/lastPrinted dates, revision number, and all custom properties.
- **Comment author identities** (DOCX/XLSX/PPTX) — anonymised to `Anonymous`;
  comment **text is preserved**.
- **Word tracked-change/revision metadata** — `w:author` anonymised, `w:date`/
  `w:dateUtc` removed, `w:rsid*` and `<w:rsids>` removed; tracked content kept.
- **Embedded JPEG/PNG/WebP metadata** — cleaned via the image core (colour data
  preserved) and independently verified.
- **ZIP container metadata** — entry timestamps normalised to a neutral value;
  original permissions/extra fields dropped; generic output filename.

### Preserved (Office)
Text, tables, formulas, values, charts, pivot tables, named ranges, external
links, slides, notes, layouts, animations, images, hyperlinks, document layout,
and **comment bodies**.

### Blocked (Office — no output produced)
Encrypted, signed, macro-enabled (DOCM/XLSM/PPTM), embedded OLE/ActiveX/package
objects, custom XML parts, Word/Excel threaded comments & People/Persons
metadata, unsupported embedded image formats, oversize/zip-bomb, and malformed
packages.

### Out of scope for Office
- **Visible/document content** is preserved, not scanned or cleaned. BURAN does
  not redact text, numbers, or images on the page.
- **Arbitrary embedded data** (OLE objects, embedded files, custom XML) is not
  scanned for metadata — such documents are blocked instead.
- BURAN does **not** claim an Office document is anonymous, and does **not**
  claim "all metadata removed" unless verification proves the supported surfaces
  are clean.

## What BURAN Removes (ZIP — Milestone 02C)

ZIP support covers ordinary, non-encrypted archives. See [`ZIP_SUPPORT_02C.md`](./ZIP_SUPPORT_02C.md) for the full specification.

### Removed / Neutralised

- ZIP archive comments.
- Per-entry timestamps and DOS date/time fields, normalised to `1980-01-01 00:00:00 UTC`.
- Identifying extra fields and Unix/host attributes where exposed by the browser ZIP library, by rebuilding a fresh archive.
- Supported metadata inside nested JPEG/PNG/WebP/PDF/DOCX/XLSX/PPTX files, using the existing handlers and independent verification.

### Preserved (ZIP)

Folder structure, original entry names, supported files' visible/document content, and unsupported files byte-for-byte.

### Exact ZIP Result Wording

Correct product claim:

`BURAN removed supported archive metadata and sanitised supported files inside the archive locally on your device.`

If unsupported files remain:

`Поддерживаемые файлы очищены и проверены.`

`Неподдерживаемые файлы сохранены без изменений: N.`

Unsupported files are retained without inspection or metadata removal. Their unknown metadata risk is separate from the verified supported content.

### Blocked (ZIP — no output produced)

Encrypted/password-protected ZIP, multi-volume ZIP, malformed ZIP, input > 100 MB, total uncompressed size > 250 MB, more than 10,000 entries, zip-bomb-like compression ratio, path traversal, duplicate/conflicting paths, nesting deeper than one ZIP level, and any supported nested file that cannot be safely cleaned and verified.

## What BURAN Cannot Guarantee

### Out of Scope
BURAN is a **metadata** sanitisation tool. It does not and cannot address:

1. **Visible content**: Faces, license plates, document numbers, visible text, QR codes, barcodes, and any information embedded in the image pixels themselves.
2. **Watermarks**: Visible or invisible digital watermarks embedded in pixel data.
3. **Steganography**: Data hidden within pixel values or compression artefacts.
4. **Content secrets**: Secrets or sensitive data intentionally embedded in document content (e.g., hidden text in DOCX, layers in PDF).
5. **Non-metadata tracking**: The file's visual content itself can still be identified, matched, or fingerprinted.
6. **File system metadata**: File creation/modification dates on disk, file names, folder structures (BURAN only cleans metadata inside the file).

### Honest Limitations
- If a format variant cannot be safely cleaned, BURAN reports it as unsupported rather than producing a misleading result.
- BURAN never claims "all metadata removed" if technical colour data remains.
- BURAN never claims "100% anonymous" or "zero possible data leakage."
- BURAN never claims archive anonymity. ZIP results distinguish verified supported files from unchanged unsupported files.
- BURAN never turns cancellation, timeout, malformed parsing, or incomplete verification into a success state.
- The verification pass re-scans for known metadata patterns; it cannot detect novel or unknown metadata formats.

## Certificate

The clean certificate is generated locally in your browser and contains:
- File type, scan date/time, metadata counts, verification result, SHA-256 hash, and scope disclaimer.
- The certificate does NOT contain any private metadata from the original file.
- Download as PDF or print directly from the browser.

## Recommendations for High-Risk Use Cases

If you are handling files with extreme sensitivity:
1. Review the cleaned file manually before sharing.
2. Be aware that metadata formats evolve — BURAN supports current standards but may not handle proprietary vendor extensions.
3. Consider multiple layers of sanitisation for critical use cases.
4. Do not rely solely on metadata removal if the visible content itself is sensitive.
