# Format Support Matrix

This matrix describes what BURAN currently claims for each supported format. It is intentionally conservative: if a format cannot be safely cleaned and verified, BURAN should block or describe the limitation instead of claiming full anonymity.

BURAN supports **30 formats**. Every format is content-detected from its magic bytes (never the filename) via the format registry (`src/lib/formats/registry.ts`), and every successful clean is independently re-verified. A file BURAN has just cleaned re-scans as clean.

## Images

| Format | Scan | Clean | Verify | Main metadata removed | Preserved | Important limits |
|---|---:|---:|---:|---|---|---|
| JPEG | Yes | Yes | Yes | EXIF, GPS, XMP, IPTC, comments, thumbnails, camera info, timestamps, author/copyright, orientation tag | Pixel data where possible, ICC/color profile, visual orientation | Non-default orientation may require canvas re-encoding. |
| PNG | Yes | Yes | Yes | eXIf, tEXt, zTXt, iTXt, tIME, miscellaneous metadata chunks | IDAT pixels, ICC/color chunks, transparency | Does not remove visible pixels or hidden image content. |
| WebP | Yes | Yes | Yes | EXIF and XMP chunks | ICC profile, VP8/VP8L payload | Animated or unusual variants may have limited support. |
| HEIC / HEIF | Yes | Clean export | Yes | Source EXIF/XMP/metadata containers are not transferred | Visible decoded image, dimensions/orientation; PNG export preserves alpha when required | Exports to JPEG/PNG rather than rewriting HEIC bytes. Blocks sequences, auxiliary/depth images, and unsupported containers. |
| TIFF | Yes | Yes | Yes | EXIF/GPS IFDs, XMP, IPTC, Photoshop IRB, DateTime, Artist, Software, document/host name, reduced-resolution preview pages, private/unknown tags | Pixel strips/tiles byte-for-byte, ICC profile, structural tags, page geometry | Rebuilds the container from a structural keep-list. Refuses camera RAW (CR2/DNG) in a TIFF wrapper. |
| GIF | Yes | Yes | Yes | Comment extensions, XMP and unknown application extensions | Frames, palettes, animation timing, NETSCAPE loop extension, ICC extension | No pixel re-encoding. |
| BMP | Yes | Yes | Yes | Linked colour-profile file path, trailing data after pixel data | Pixels, embedded ICC profile, dimensions | V5 linked-profile references are neutralised to sRGB. |
| AVIF | Yes | Yes | Yes | Exif and XMP metadata items | Primary image, colour properties, pixel data byte-for-byte | Cleaned in place with `free`-box padding; no decode/re-encode. |
| ICO | Yes | Yes | Yes | PNG-payload metadata (tEXt/eXIf…), trailing data | Icon images, directory structure | PNG payloads cleaned through the PNG core; DIB payloads copied verbatim. |
| SVG | Yes | Yes | Yes | XML comments, `<metadata>` (RDF/Dublin Core), editor namespaces (Inkscape/Sodipodi), `<title>`/`<desc>`, DOCTYPE | Visible drawing content | Active-content gate: refuses SVGs with scripts, event handlers, `foreignObject`, DTD entities, or external references (a "cleaned" but executable SVG would not be safe). |
| PSD | Yes | Yes | Yes | 8BIM resources: IPTC, EXIF, XMP, thumbnails, URLs, version-info (writer) | ICC profile, structural resources, layers and pixels byte-for-byte | Metadata-resource removal only; does not flatten or alter layers. |

## Documents

| Format | Scan | Clean | Verify | Main metadata removed | Preserved | Important limits |
|---|---:|---:|---:|---|---|---|
| PDF | Yes | Yes | Yes | Info dictionary, XMP metadata, PieceInfo, annotation identity fields, trailer ID | Pages, geometry, text, images, links, outlines, forms, annotation content/appearance | Metadata-only. Not a redactor, flattener, rasterizer, or signature-preserving editor. |
| DOCX | Yes | Yes | Yes | docProps, author/company/app metadata, comment author identities, revision author/date/rsid fields, embedded image metadata, ZIP timestamps | Text, layout, links, comment bodies, tracked content | Blocks encrypted, signed, macro-enabled, OLE/ActiveX/threaded-comment risk states. Legacy `.doc` (OLE/CFB) is honestly reported as unsupported legacy, not "encrypted". |
| XLSX | Yes | Yes | Yes | docProps, author/company/app metadata, custom properties, embedded image metadata, ZIP timestamps | Sheets, formulas, charts, tables, links, layout | Same Office package risk model as DOCX. |
| PPTX | Yes | Yes | Yes | docProps, author/company/app metadata, custom properties, embedded image metadata, ZIP timestamps | Slides, notes, images, charts, links, layout | Same Office package risk model as DOCX. |
| ODT / ODS / ODP / ODG | Yes | Yes | Yes | `meta.xml` (author, dates, generator, keywords, user fields, statistics), document thumbnail, printer identity in `settings.xml`, annotation author/date, embedded image metadata, ZIP timestamps | Visible document, annotation bodies, embedded images | Classified from the package `mimetype` entry. Blocks encrypted and macro/script-bearing documents. |
| RTF | Yes | Yes | Yes | `\info` group (author, operator, company, manager, title, dates, editing time), `\*\generator` | Visible document text and formatting | Brace-matched group removal. |
| EPUB | Yes | Yes | Yes | Reader/library fingerprints: `calibre:*` fields, `dcterms:modified`, producer contributor, embedded image metadata, ZIP timestamps | The book's own bibliography (title, author, identifier), content, structure | Classified from the `application/epub+zip` mimetype. Blocks DRM-protected books (`encryption.xml`). |
| EML | Yes | Yes | Yes | Received relay chain (relay IPs), X-Originating-IP, X-Mailer/User-Agent, Message-ID | From/To/Subject/Date, MIME structure, body, attachments byte-for-byte | Header surgery only. `.msg` (OLE/CFB) is not yet supported. |

## Audio

| Format | Scan | Clean | Verify | Main metadata removed | Preserved | Important limits |
|---|---:|---:|---:|---|---|---|
| MP3 | Yes | Yes | Yes | ID3v2 (2.2/2.3/2.4) frames incl. cover art, ID3v1 trailer, APEv2, Lyrics3 | Audio frames byte-for-byte | No re-encoding; tag blocks are stripped. |
| FLAC | Yes | Yes | Yes | VORBIS_COMMENT (tags + vendor), PICTURE cover art, APPLICATION data | STREAMINFO, SEEKTABLE, CUESHEET, audio frames byte-for-byte | Metadata blocks are explicitly delimited. |
| WAV | Yes | Yes | Yes | LIST-INFO (artist, software, dates), `bext` broadcast metadata, `iXML`, `id3`, XMP, unknown chunks | `fmt`/`data` and functional chunks, audio samples byte-for-byte | Structural keep-list; unknown chunks removed with disclosure. |
| OGG / Opus | Yes | Yes | Yes | Vorbis/OpusTags comment packet (tags + vendor) | Audio packets byte-for-byte | Page rebuilt with recomputed OGG CRC-32. Refuses comment packets spanning multiple pages. |

## Video

| Format | Scan | Clean | Verify | Main metadata removed | Preserved | Important limits |
|---|---:|---:|---:|---|---|---|
| MP4 / M4A / M4V / MOV | Yes | Yes | Yes | `udta`/`meta`/`ilst`/`uuid` boxes (GPS `©xyz`, device make/model, title, tool), `mvhd`/`tkhd`/`mdhd` timestamps | Media bitstream (`mdat`) byte-for-byte, track structure | Cleaned in place: metadata boxes retyped to `free` and zeroed, sizes unchanged, so `stco`/`co64` offsets stay valid. No `moov` rewrite. |
| MKV / WebM | Yes | Yes | Yes | Title, DateUTC, Tags, Attachments, MuxingApp/WritingApp | Media clusters byte-for-byte, SeekHead/Cues positions | Metadata elements voided in place (spec Void element); mandatory app elements zeroed. |
| AVI | Yes | Yes | Yes | LIST-INFO (artist, software, dates), IDIT capture date | `movi` media chunks byte-for-byte, `idx1` index | Metadata chunks retyped to JUNK and zeroed in place; index offsets stay valid. |

## Archives

| Format | Scan | Clean | Verify | Main metadata removed | Preserved | Important limits |
|---|---:|---:|---:|---|---|---|
| ZIP | Yes | Partial | Yes | ZIP comment, entry timestamps, exposed host/extra metadata, supported nested file metadata | Folder structure, entry names, unsupported files byte-for-byte, supported files' visible content | Recursively cleans supported nested files (images, PDF, Office, audio, video). Unsupported files are preserved unchanged and reported. One nested ZIP level. |

## Honest blocks (by design, not gaps)

- **Legacy binary Office** (`.doc` / `.xls` / `.ppt`, OLE/CFB) — reported as unsupported legacy format with a suggestion to re-save as OOXML. Rewriting a CFB container safely is out of scope.
- **Camera RAW** (CR2, DNG, …) — refused rather than partially stripped, because maker-note layouts are proprietary and cannot be verified after modification.
- **Encrypted / DRM / macro-bearing** documents — refused with an honest explanation and no output.

## Support Levels

| Level | Meaning |
|---|---|
| Yes | BURAN has a scanner/cleaner/verifier for the claimed metadata surfaces. |
| Clean export | BURAN creates a new clean file in another format instead of rewriting the original container. |
| Partial | BURAN cleans the supported surfaces but may preserve unsupported entries unchanged with an explicit limitation. |

## Verification Requirement

Every successful clean result must pass a format-specific verification pass before the UI presents it as verified. If verification fails, BURAN must not claim success. In addition, a cleaned file re-scanned from scratch must report zero personal metadata — this "honest re-scan" property is enforced by `tests/unit/rescan-clean.test.ts`.

## Out of Scope for All Formats

- Visible faces, text, numbers, documents, screenshots, or QR codes.
- Watermarks and steganography.
- Secrets embedded in document content.
- Unsupported file formats or unsupported nested files.
- Browser, OS, extension, or device compromise.
