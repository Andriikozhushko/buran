# BURAN Engineering Plan

Goal: remove metadata from the widest possible set of file formats, in the
browser, without ever claiming a guarantee BURAN cannot verify.

This document records the audit that produced the plan, the two blockers that
must be cleared before format coverage can grow, and the ordered waves of format
work behind them.

Status date: 2026-07-26. Baseline: 9 supported formats, 8 locales, 176 tests.

**Progress update (same day):** Blocker A (format registry) is DONE — descriptors
in `src/lib/formats/registry.ts`, workers are dispatch loops, detection is
content-based. D1 (legacy Office vs encrypted), D3 (extension-based OOXML
detection) and most of D4 (TIFF/GIF/BMP embedded media no longer block Office)
are fixed. **Wave 1 is DONE**: TIFF, GIF, BMP, AVIF, ICO, SVG handlers shipped
with per-format tests, nested-in-ZIP and embedded-in-Office support, and the
honest-rescan guarantee (a cleaned file re-scans as clean). **Wave 2 is also
DONE**: ODT/ODS/ODP/ODG and EPUB, classified from the package `mimetype`
entry, sanitised via the shared package-rebuild machinery (STORED mimetype
first, neutral timestamps, cleaned embedded images); encrypted/macro/DRM
documents are refused. EPUB keeps the book's own bibliography (title, author,
identifier) and removes only reader/library fingerprints. Startup media was
also cut 12× (hero video 6.2 MB → 515 KB @720p/no-audio, logo 1.6 MB → 84 KB,
poster frame added) for slow connections. **Wave 3 and the core of Wave 4 are
DONE**: MP3 (ID3v2.2/3/4, ID3v1, APEv2, Lyrics3 stripped; audio frames
byte-identical), FLAC (VORBIS_COMMENT/PICTURE/APPLICATION dropped, STREAMINFO/
SEEKTABLE/CUESHEET kept), WAV (chunk keep-list; LIST-INFO/bext/iXML/id3/XMP
dropped with disclosure), and MP4/M4A/M4V/MOV via in-place cleaning: udta/
meta/uuid boxes retyped to `free` and zeroed (sizes unchanged → stco/co64
offsets stay valid, no moov rewrite), mvhd/tkhd/mdhd timestamps zeroed, `©xyz`
GPS reported and destroyed. **Waves 4 and 5 are DONE**: MKV/WebM (EBML
Title/DateUTC/Tags/Attachments voided in place with spec-blessed Void
elements, MuxingApp/WritingApp zeroed — SeekHead/Cues positions untouched),
AVI (LIST-INFO and IDIT retyped to JUNK and zeroed in place — idx1 offsets
untouched), OGG/Opus (comment packet emptied, page re-laced, OGG CRC-32
recomputed; cross-page comment packets refused), RTF (brace-matched removal
of the \info group and \*\generator), PSD (IPTC/EXIF/XMP/thumbnail/URL/
version-info 8BIM resources dropped, ICC and structural resources kept,
layers/pixels byte-identical), and EML (Received relay chain with IPs,
X-Originating-IP, X-Mailer/User-Agent, Message-ID removed; From/To/Subject/
Date/body/attachments preserved). Legacy binary Office and camera RAW remain
honest blocks by design. **30 supported formats, 230 tests.**
Remaining from this plan: Blocker B (engine i18n), D5–D8.

---

## 1. Audit findings

### 1.1 Fixed in this pass

| Finding | Impact |
|---|---|
| `App.tsx` overwrote `orientationApplied` / `pixelDataReencoded` with `false` after the worker returned them | The HEIC pipeline re-encodes pixels and the verifier reported it, but the success screen and the certificate silently dropped the disclosure. A trust tool under-reporting what it did to the file is the worst class of bug it can have. |
| Office custom-XML feature was half-built: hardcoded Russian in `ScanReport.tsx` | The app ships 8 locales and defaults to Ukrainian. Seven of eight users saw untranslated Russian in a new UI block and button. |
| Custom-XML risk text claimed "safe cleaning of this document is unavailable" while the same screen offered two cleaning modes | Self-contradictory copy in the exact place where the user decides whether to trust the tool. |
| `verifyOffice` discarded *all* scan risks when extended cleaning was selected | Only the custom-XML risk is resolved by that pass. Any future risk would have been silently dropped. |
| 10 unreachable modules + the dead HTML-certificate path (~700 lines) | `registry.ts` exported a `FormatHandler` interface with synchronous `scan`/`clean`/`verify` that no real handler implements, and `getSupportedFormats()` hardcoded three formats. It was the wrong shape to build on and nothing used it. |

Added: `src/lib/formats/messages.ts` (engine message codes) and
`tests/unit/i18n.test.ts` (locale parity + code-resolution guards).

### 1.2 Open defects

| # | Defect | Where |
|---|---|---|
| D1 | Every unencrypted legacy `.doc` / `.xls` / `.ppt` is reported to the user as **"password-protected or encrypted"**. OLE/CFB is the container for *both* encrypted OOXML and plain legacy Office; the code does not distinguish them. | `office/scan.ts:155` |
| D2 | 135 user-facing strings are hardcoded Russian inside `src/lib` and `src/workers`. Block reasons, error messages, finding descriptions, and preserved-data labels bypass i18n entirely. | see §2.2 |
| D3 | Office packages are only recognised when the **filename extension** is `.docx`/`.xlsx`/`.pptx`. A renamed OOXML file falls through to the generic ZIP handler and is cleaned as an archive. | `validation.ts:80`, `scan.worker.ts:87` |
| D4 | An embedded TIFF/GIF/BMP/HEIC blocks the **whole** Office document (`unsupported-media`). Wave 1 below removes most of this class. | `office/detect.ts:137` |
| D5 | ZIP recursion hardcodes its handler list and one nesting level, so nested formats do not follow the registry. | `zip/recursive.ts` |
| D6 | `image-orientation.ts` (281 lines of canvas re-encoding) is reachable only from its own test. The last four commits deliberately moved JPEG *away* from canvas re-encode, so it is either obsolete or an unfinished path. Needs an explicit decision. | `lib/image-orientation.ts` |
| D7 | `scan.worker` and `clean.worker` each bundle their own copy of the PDF, Office and ZIP chunks (~1 MB duplicated in `dist/`). | `vite.config.ts`, workers |
| D8 | Both workers receive a `locale` field in every message and neither reads it. Dead payload from an abandoned i18n attempt. | `App.tsx:224,318` |

---

## 2. Blockers before format expansion

### 2.1 Blocker A — adding a format touches ten files

A new format currently requires edits in **77 branch sites across 14 files**:

```
trust-result.ts       31    detector.ts            9    clean.worker.ts        8
certificate.ts         5    zip/recursive.ts       5    scan.worker.ts         3
ScanReport.tsx         3    SuccessResult.tsx      3    App.tsx                2
office/*               5    zip/scan.ts            2    validation.ts          1
```

`detector.ts` alone carries four parallel switch statements (MIME, extension,
display name, magic bytes) that must stay in sync by hand. This is why the
roadmap stalled at nine formats: the marginal cost of format ten is the same as
format two, and the risk of an inconsistent partial registration grows with each
one.

**Fix — a real format registry.** One descriptor per format, one file:

```ts
export interface FormatDescriptor<Scan, Verify> {
  id: SupportedFormat;
  displayName: string;              // "TIFF"
  extensions: readonly string[];    // ['tif', 'tiff']
  mimeType: string;
  /** Content sniff. Never the extension — that is user-controlled input. */
  detect(head: Uint8Array, buffer: ArrayBuffer): boolean;
  maxBytes: number;
  scan(buffer: ArrayBuffer): Promise<Blocked | { data: Scan }>;
  sanitize(buffer: ArrayBuffer, opts): Promise<Blocked | ArrayBuffer>;
  verify(original: Scan, clean: ArrayBuffer): Promise<Verify>;
  /** Message codes for the trust copy: what is removed / preserved / verified. */
  trustCopy: TrustCopyCodes;
  /** Declared limits, rendered as the honest "what BURAN cannot do" list. */
  limits: readonly EngineMessageCode[];
}
```

Both workers then become a dispatch loop over `registry.get(id)`, `detector.ts`
collapses to a sniff loop, and `trust-result.ts` reads `trustCopy` instead of
branching on the format. Adding a format becomes: write the handler, register
the descriptor, add its message codes. **Target: 77 branch sites → under 10.**

Do this *before* Wave 1. Retrofitting nine formats is a day; retrofitting thirty
is a rewrite.

### 2.2 Blocker B — the engine cannot speak the user's language

Workers have no locale, so handlers emit Russian prose. The default locale is
Ukrainian. Today an English, German, French, Spanish, Polish or Armenian user
who hits a blocked file sees a **localized title above a Russian paragraph**.
For a tool whose entire product promise is "we tell you honestly what we did and
did not do", this is the single largest credibility defect in the codebase.

`src/lib/formats/messages.ts` establishes the pattern and the Office
custom-XML risks are migrated. Remaining, by surface:

| Surface | Strings | Rendered by |
|---|---:|---|
| Block reasons (PDF / Office / ZIP / HEIC) | ~55 | `BlockedState` |
| Worker + validation + timeout errors | ~20 | `ErrorState` |
| Finding descriptions (PNG / WebP / JPEG / PDF) | ~25 | `ScanItem` |
| `technicalDataPreserved` and risk notes | ~35 | `SuccessResult`, certificate |

Codes carry a `buran:` prefix precisely so a missed migration shows up as a
visible marker instead of being silently mislabelled. `tests/unit/i18n.test.ts`
already asserts that every registered code resolves in all 8 locales; extend it
with a source scan that fails the build on new Cyrillic outside `src/i18n`.

Cost: ~135 keys × 8 locales. Mechanical, but it is the gate on being a
trustworthy multilingual security tool rather than a Russian one with a
translated shell.

---

## 3. Format expansion waves

Ordered by (privacy value × user reach) ÷ implementation risk. Every wave keeps
the existing rules: parse, never re-encode; preserve colour; verify the output
independently; block instead of guessing.

### Wave 1 — the image formats that already block other work

| Format | Metadata surface | Why first |
|---|---|---|
| **TIFF** | EXIF/GPS IFDs, XMP (tag 700), IPTC (33723), Photoshop IRB (34377), `DateTime`, `Artist`, `Software` | Unblocks D4, and the TIFF IFD parser is the foundation for every RAW format |
| **GIF** | Comment Extension `0xFE`, Application Extension `0xFF` (incl. XMP-in-GIF) | ~80 lines of block walking; no re-encode possible or needed |
| **BMP** | V5 header ICC profile only | Near-trivial; completes the "common raster" set |
| **AVIF** | Same ISO-BMFF `Exif`/`XMP` item boxes as HEIC | The HEIC box parser generalizes; unlike HEIC it can be cleaned in place with no decode |
| **ICO** | Wrapped PNG/BMP payloads | Delegates to the PNG/BMP handlers |
| **SVG** | `<metadata>`, RDF/Dublin Core, `inkscape:`/`sodipodi:`/Illustrator namespaces, XML comments, `<title>`/`<desc>` | Also a **security** surface: `<script>`, `<foreignObject>`, external `xlink:href`. Must be handled as active content, not as a picture |

After Wave 1 the Office `unsupported-media` block only fires for embedded HEIC.

### Wave 2 — OpenDocument, on the machinery that already exists

**ODT / ODS / ODP / ODG.** ZIP + XML, structurally a sibling of OOXML: strip
`meta.xml`, `Thumbnails/thumbnail.png`, and the identifying half of
`settings.xml`; clean embedded images through the image core; normalise ZIP
timestamps; rebuild. The DOCX pipeline is reusable almost end to end.

**EPUB** follows for free: ZIP + OPF `<dc:*>` + `calibre:` fields.

Highest coverage-per-hour in the whole plan.

### Wave 3 — audio

| Format | Surface | Notes |
|---|---|---|
| **MP3** | ID3v2.2/3/4 frames, ID3v1 trailer, APEv2, Lyrics3 | Cover art carries its own EXIF — must be cleaned through the image core, not just dropped |
| **FLAC** | Vorbis comment block, `PICTURE` block | Metadata blocks are explicitly delimited; the safest format in this plan |
| **WAV** | `LIST/INFO`, `iXML`, `id3 ` chunks | Reuses the RIFF walker already written for WebP |
| **M4A** | `moov/udta/meta/ilst` | Shares the Wave 4 atom work |
| **OGG / Opus** | Vorbis comment header packet | Requires page rewrite and CRC32 recompute — schedule last |

### Wave 4 — video (the highest-value, highest-effort wave)

Phone video is the richest privacy leak most users own: GPS in the `©xyz` atom,
device model, and creation timestamps in three separate headers.

| Format | Surface | Approach |
|---|---|---|
| **MP4 / M4V / MOV** | `moov/udta`, `meta/ilst`, `©xyz` GPS, `mvhd`/`tkhd`/`mdhd` timestamps, Apple `keys`, XMP in `uuid` | Rewrite `moov` only. If its size changes, `stco`/`co64` chunk offsets must be adjusted — this is the whole difficulty, and it is well understood |
| **MKV / WebM** | EBML `Info` (Title, MuxingApp, WritingApp, DateUTC), `Tags`, `Attachments` | Variable-length EBML sizes; rewrite in place where possible |
| **AVI** | RIFF `INFO` list | Cheap once the RIFF walker is shared |

Constraint: files are large and processing must stay in a worker with the
existing resource limits. Block rather than partially process.

### Wave 5 — legacy and specialist

- **Legacy OLE/CFB Office (`.doc`/`.xls`/`.ppt`)** — `SummaryInformation` and
  `DocumentSummaryInformation` streams. Requires a CFB reader. Fixing D1 (an
  honest "legacy format, not yet supported" instead of a false "encrypted") is a
  small change that should not wait for the full handler.
- **RTF** — `\info` group: `\author`, `\company`, `\creatim`, `{\*\generator}`.
- **PSD** — 8BIM Image Resource Blocks (IPTC, EXIF, XMP).
- **EML** — `Received`, `X-Originating-IP`, `Message-ID`, `User-Agent`.
  **MSG** needs the CFB reader from the legacy-Office work.
- **RAW (DNG / CR2 / NEF / ARW / ORF / RW2)** — TIFF-based, so the Wave 1 IFD
  parser carries most of it. Maker notes are proprietary and partly undocumented:
  the honest default is a verified **clean export**, or a block, never a silent
  partial strip.

### Not in scope

Container formats whose payload BURAN cannot verify after modification, and any
format where "cleaned" could not be independently re-checked. That rule is what
separates this project from the tools it exists to replace.

---

## 4. Suggested order

1. **Blocker A** — format registry. Everything else gets cheaper behind it.
2. **D1 + D3** — two small correctness fixes (false "encrypted", extension-based
   Office detection). Both are content-sniffing changes that the registry makes
   natural.
3. **Wave 1** — TIFF, GIF, BMP, AVIF, ICO, SVG. First real proof the registry
   works; clears D4.
4. **Blocker B** — engine i18n migration, done format-by-format as Wave 1 lands
   so new handlers are never written in prose.
5. **Wave 2** — OpenDocument + EPUB.
6. **Waves 3–5** — audio, video, legacy.

D6 (`image-orientation.ts`) and D7 (duplicated worker chunks) can be settled at
any point; neither blocks anything.
