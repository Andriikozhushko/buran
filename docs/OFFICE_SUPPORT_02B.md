# Office Metadata Sanitisation (Milestone 02B)

BURAN inspects, sanitises, and verifies **Office (OOXML) metadata** for `.docx`,
`.xlsx`, and `.pptx` entirely inside the browser. This milestone is
**metadata-only**: BURAN never alters visible text, tables, formulas, charts,
images, slides, notes, links, layout, or comment content. It is not a converter,
flattener, redactor, or editor.

All processing is local. No uploads, backend, telemetry, or network calls. The
app stays deployable as a static frontend.

---

## Browser-only technical approach

- OOXML packages are ZIP containers. BURAN uses **JSZip** (MIT) to read and
  rebuild them, and surgical string/regex edits on the metadata XML parts (no
  full re-serialisation, so document content stays byte-for-byte intact).
- ZIP inspection, sanitisation, and image cleaning run in the existing scan /
  clean **Web Workers**.
- Detection uses **magic bytes + package content**, never the extension alone:
  ZIP (`PK`) vs encrypted OLE/CFB (`D0 CF 11 E0…`), then classification from the
  parts (`word/document.xml`, `xl/workbook.xml`, `ppt/presentation.xml`).

### Limits

| Limit | Value |
|-------|-------|
| Compressed input | 100 MB |
| Uncompressed total | 250 MB |
| Entry count | 10,000 |
| Compression ratio | 200× (zip-bomb guard) |

One file at a time.

---

## Supported metadata surfaces removed

### Package property parts (all formats) — removed entirely

`docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml` (and any
`docProps/thumbnail.*`) are **removed, not blanked**, and detached from
`[Content_Types].xml` and `_rels/.rels`. This removes:

creator, lastModifiedBy, title, subject, keywords, category, description,
company, manager, application, application version, template, created/modified/
lastPrinted dates, revision number, and all custom document properties.

### ZIP container metadata

The package is **rebuilt fresh**. Original entry timestamps are normalised to a
neutral fixed value (1980-01-01); original filesystem permissions / extra fields
are not carried over. The download filename is generic:
`buran-clean.docx` / `.xlsx` / `.pptx`. The original filename is never embedded.

### Embedded images (`*/media/`)

Embedded **JPEG / PNG / WebP** are cleaned with BURAN's existing image core
(personal metadata removed, ICC/colour data preserved) and each is independently
re-verified. An unsupported, potentially metadata-bearing image format
(TIFF/BMP/GIF/HEIC/…) causes the document to be **blocked** rather than cleaned.

### DOCX

- **Standard comments** (`word/comments.xml`): author anonymised to `Anonymous`,
  `w:initials` and `w:date` removed; **comment body and markers preserved**.
- **Tracked changes / revisions** (all `word/*.xml`): `w:author` anonymised to
  `Anonymous`; `w:date` / `w:dateUtc` removed; revision session ids
  (`w:rsid*`) removed; `<w:rsids>` history removed. **Inserted/deleted content
  and tracked-change structure are preserved.**

> Validity note: OOXML requires `w:author` on revisions/comments, so BURAN
> replaces the value with `Anonymous` rather than deleting the attribute. The
> original author string is gone; the document stays valid.

### XLSX

- **Legacy comments/notes** (`xl/comments*.xml`): the author list is collapsed
  to a single neutral `Anonymous` author and every `authorId` is remapped to it.
  Comment text and positioning are preserved.
- Formulas, values, sheets, charts, pivot tables, named ranges, external links,
  formatting, and layout are untouched.

### PPTX

- **Comments** (`ppt/commentAuthors.xml`, `ppt/comments/comment*.xml`): author
  names/initials anonymised; comment timestamps (`dt`) removed; author/comment
  references (ids) preserved so PowerPoint opens the file with working comments.
- Slides, notes, layouts, images, charts, animations, and links are untouched.

---

## Exact preserved features

Text, tables, formulas, cell values, charts, pivot tables, named ranges,
external links, slides, speaker notes, layouts, animations, images, hyperlinks,
form/field content, document layout, **and the textual content of all
comments**. The required core content part (`word/document.xml` /
`xl/workbook.xml` / `ppt/presentation.xml`) is confirmed present after rebuild.

---

## Blocked / unsupported structures (no output produced)

| Category | Trigger |
|----------|---------|
| Encrypted / password-protected | OLE/CFB container (`D0CF11E0`) |
| Digitally signed | `_xmlsignatures/` part |
| Macro-enabled (DOCM/XLSM/PPTM) | `vbaProject.bin` / `vbaData.xml` |
| Embedded OLE / ActiveX / packages | `*/embeddings/`, `oleObject*.bin`, `*/activeX/` |
| Custom XML parts | `customXml/` |
| Word threaded comments / People | `word/commentsExtended.xml`, `word/people.xml`, `word/commentsIds.xml` |
| Excel threaded comments / Persons | `xl/threadedComments/`, `xl/persons/` |
| Unsupported embedded image | TIFF/BMP/GIF/HEIC/HEIF/JP2 in `*/media/` |
| Oversize / too many entries / zip-bomb | exceeds the limits above |
| Malformed | unparseable ZIP/XML |
| Unsupported package | ZIP that is not a DOCX/XLSX/PPTX |

Each blocked file shows a specific Russian explanation and produces **no
download**. Example:

> В документе обнаружены встроенные OLE-объекты. Они могут содержать собственные
> метаданные, которые BURAN пока не умеет проверять без риска изменить
> содержимое. Файл не был изменён.

---

## Verification strategy

After sanitisation BURAN runs a **fully independent** pass over the generated
bytes (it does not trust the sanitiser):

1. Re-loads the cleaned package with JSZip (must open as valid ZIP/OOXML).
2. Confirms `core.xml`/`app.xml`/`custom.xml` are absent **and** their
   `[Content_Types].xml` overrides and `_rels/.rels` relationships are gone.
3. Scans the **decompressed** content of every XML/rels part and the embedded
   media for the original metadata sentinels (a raw ZIP-byte scan is meaningless
   because DEFLATE would hide residual metadata).
4. Confirms comment authors are anonymised and (DOCX) revision author/date/rsid
   metadata is gone.
5. Re-scans each embedded image and counts those with zero personal metadata.
6. Confirms every ZIP entry timestamp equals the neutral fixed value.
7. Confirms the required core content part is still present.

```ts
type OfficeVerification = {
  format: 'docx' | 'xlsx' | 'pptx';
  metadataFoundBefore: number;
  personalMetadataRemaining: number;   // 0 only when no sentinel survives
  corePropertiesRemoved: boolean;
  appPropertiesRemoved: boolean;
  customPropertiesRemoved: boolean;
  commentAuthorsAnonymised: boolean;
  revisionMetadataRemoved: boolean;
  embeddedImagesVerified: number;
  zipTimestampsNormalised: boolean;
  verificationPassed: boolean;
  remainingUnsupportedMetadataRisk: string[];
};
```

**«Личных метаданных осталось: 0»** is shown only when every check passes.
Neutral ZIP timestamps and preserved document content are never counted as
personal metadata.

---

## Module layout

```
src/lib/formats/office/
  types.ts      // OfficeBlock, OfficeVerification, OfficeScanData, …
  detect.ts     // magic + content classification + conservative block detection
  package.ts    // JSZip load, limits/zip-bomb guard, normalised rebuild
  shared.ts     // part constants, targeted XML mutation, finding builders
  docx.ts       // Word comments + revision/rsid anonymisation
  xlsx.ts       // Excel comment author collapse + authorId remap
  pptx.ts       // PowerPoint comment author/timestamp anonymisation
  scan.ts       // orchestrator: detect → block → props + format + images
  sanitize.ts   // orchestrator: drop props, fix CT/rels, anonymise, clean images
  verify.ts     // independent re-parse + decompressed sentinel pass
  index.ts      // public surface
```

Office processing is asynchronous and has a blocked outcome, so it does not
implement the synchronous image `FormatHandler`; the workers route Office
packages through these functions directly.

---

## What BURAN does **not** claim

- It does **not** make the document anonymous.
- It does **not** scan or remove visible content, or arbitrary data embedded in
  the document body or in embedded files/objects (those are blocked instead).
- It does **not** claim "all metadata removed" unless verification proves the
  supported surfaces are clean.
