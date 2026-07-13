# Format Support Matrix

This matrix describes what BURAN currently claims for each supported format. It is intentionally conservative: if a format cannot be safely cleaned and verified, BURAN should block or describe the limitation instead of claiming full anonymity.

| Format | Scan | Clean | Verify | Main metadata removed | Preserved | Important limits |
|---|---:|---:|---:|---|---|---|
| JPEG | Yes | Yes | Yes | EXIF, GPS, XMP, IPTC, comments, thumbnails, camera info, timestamps, author/copyright, orientation tag | Pixel data where possible, ICC/color profile, visual orientation | Non-default orientation may require canvas re-encoding. |
| PNG | Yes | Yes | Yes | eXIf, tEXt, zTXt, iTXt, tIME, miscellaneous metadata chunks | IDAT pixels, ICC/color chunks, transparency | Does not remove visible pixels or hidden image content. |
| WebP | Yes | Yes | Yes | EXIF and XMP chunks | ICC profile, VP8/VP8L payload | Animated or unusual variants may have limited support. |
| HEIC / HEIF | Yes | Clean export | Yes | Source EXIF/XMP/metadata containers are not transferred | Visible decoded image, dimensions/orientation; PNG export preserves alpha when required | Exports to JPEG/PNG rather than rewriting HEIC bytes. Blocks sequences, auxiliary/depth images, and unsupported containers. |
| PDF | Yes | Yes | Yes | Info dictionary, XMP metadata, PieceInfo, annotation identity fields, trailer ID | Pages, geometry, text, images, links, outlines, forms, annotation content/appearance | Metadata-only. Not a redactor, flattener, rasterizer, or signature-preserving editor. |
| DOCX | Yes | Yes | Yes | docProps, author/company/app metadata, comment author identities, revision author/date/rsid fields, embedded image metadata, ZIP timestamps | Text, layout, links, comments bodies, tracked content | Blocks encrypted, signed, macro-enabled, OLE/ActiveX/custom XML/threaded-comment risk states. |
| XLSX | Yes | Yes | Yes | docProps, author/company/app metadata, custom properties, embedded image metadata, ZIP timestamps | Sheets, formulas, charts, tables, links, layout | Same Office package risk model as DOCX. |
| PPTX | Yes | Yes | Yes | docProps, author/company/app metadata, custom properties, embedded image metadata, ZIP timestamps | Slides, notes, images, charts, links, layout | Same Office package risk model as DOCX. |
| ZIP | Yes | Partial | Yes | ZIP comment, entry timestamps, exposed host/extra metadata, supported nested file metadata | Folder structure, entry names, unsupported files byte-for-byte, supported files' visible content | Unsupported files are preserved unchanged and reported as not inspected/cleaned. One nested ZIP level. |

## Support Levels

| Level | Meaning |
|---|---|
| Yes | BURAN has a scanner/cleaner/verifier for the claimed metadata surfaces. |
| Clean export | BURAN creates a new clean file in another format instead of rewriting the original container. |
| Partial | BURAN cleans the supported surfaces but may preserve unsupported entries unchanged with an explicit limitation. |

## Verification Requirement

Every successful clean result must pass a format-specific verification pass before the UI presents it as verified. If verification fails, BURAN must not claim success.

## Out of Scope for All Formats

- Visible faces, text, numbers, documents, screenshots, or QR codes.
- Watermarks and steganography.
- Secrets embedded in document content.
- Unsupported file formats or unsupported nested files.
- Browser, OS, extension, or device compromise.
