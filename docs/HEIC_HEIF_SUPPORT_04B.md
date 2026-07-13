# HEIC / HEIF Support 04B

## Supported Scope

BURAN supports still-image HEIC/HEIF input as a clean export workflow. It accepts one primary image within the existing image byte limit and the 04A decoded-pixel limit.

BURAN does not rewrite the original HEIC container. It decodes the visible pixels locally and creates a new clean JPEG or PNG export.

Correct claim:

`BURAN creates a new clean image export from a supported HEIC/HEIF source and verifies the metadata of the exported file.`

## Browser-Local WASM Model

HEIC/HEIF decoding uses `libheif-js/wasm-bundle`, a statically bundled WebAssembly build of `libheif`. The decoder is dynamically imported only after HEIC/HEIF content is detected by ISO-BMFF `ftyp` compatible brands.

There is no runtime `.wasm` fetch, CDN import, backend fallback, upload route, telemetry, or cloud processing. The source file stays inside the browser worker.

## Detection And Preflight

Detection is content-based, not extension-based. BURAN reads the ISO-BMFF `ftyp` box and compatible brands such as `heic`, `heif`, `heix`, `hevc`, and `mif1`.

Preflight inspects container boxes before decode where practical:

- primary image marker;
- dimensions from image spatial extents;
- image/item count;
- metadata container markers (`Exif`, XML/XMP, MIME/URI metadata, ICC/NCLX colour markers);
- sequence/animation brands;
- auxiliary/depth markers;
- resource cost from decoded pixels.

## Output Semantics

Default output is `buran-clean.jpg`. BURAN uses PNG (`buran-clean.png`) when alpha/transparency is detected or the export path requires lossless output.

The export does not copy EXIF, XMP, IPTC, GPS, author, device, timestamps, source filename, comments, or BURAN branding into output metadata. Visual orientation is applied before export when orientation metadata is detected.

## Colour And Quality

HEIC pixels are decoded to browser RGBA and exported through browser image encoders. JPEG export uses a high-quality setting. BURAN does not claim original ICC or HDR/wide-gamut preservation unless it can prove it, so current UI says colour is normalised by the browser decoder.

## Blocked Structures

BURAN blocks with no output when it detects or cannot safely rule out:

- Live Photo/sequence/animation-style HEIF brands;
- multiple images where one primary still image cannot be guaranteed;
- auxiliary images;
- depth maps;
- unsupported colour/HDR configurations;
- malformed ISO-BMFF boxes;
- encrypted/protected or undecodable payloads;
- byte-size or decoded-pixel resource limits.

BURAN does not partially clean unsupported HEIC structures.

## Metadata Verification

HEIC metadata access varies by decoder/API. When exact metadata values are unavailable, BURAN reports container presence honestly:

`Обнаружен контейнер метаданных HEIC. BURAN создаст новую чистую экспорт-копию без переноса этих данных.`

After export, BURAN verifies the resulting JPEG/PNG with existing JPEG/PNG handlers. Verification confirms the output opens as the exported format, has zero supported personal metadata, does not contain collected source metadata sentinel strings, and preserves expected dimensions/orientation.

## Privacy Guarantees

- Source HEIC/HEIF bytes never leave the browser.
- HEIC/WASM code is bundled with the app and lazy-loaded locally.
- Source metadata values are not copied into the export.
- Output filename is generic.
- BURAN does not claim total anonymity or byte-preserving HEIC cleaning.
