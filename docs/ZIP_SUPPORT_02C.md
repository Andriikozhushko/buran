# ZIP Support 02C

BURAN supports ordinary, non-encrypted ZIP archives entirely in the browser. The goal is metadata sanitisation, not archive management or anonymity claims.

## Metadata Surfaces

BURAN inspects and neutralises supported ZIP container metadata:

- ZIP archive comment.
- Per-entry modification timestamps and DOS date/time fields, normalised to `1980-01-01 00:00:00 UTC`.
- Extra fields that can carry timestamps, UID/GID, NTFS timestamps, Unix metadata, or host identifiers, by rebuilding a fresh archive and not carrying original extra fields forward.
- Unix permission / host-platform attributes where exposed by JSZip.

JSZip may expose non-identifying DOS archive/directory bits on fresh output. BURAN treats DOS date/time as the timestamp surface and verifies it separately.

## Recursive Processing Model

For every file entry, BURAN detects supported formats by content, not only by extension:

- JPEG / JPG
- PNG
- WebP
- PDF
- DOCX
- XLSX
- PPTX
- ZIP, one nested level only

Supported nested files are scanned with the existing format handler, sanitised with that same handler, and independently verified. The original entry is replaced only after verification passes. If any supported nested file cannot be safely sanitised or verified, the entire archive operation is blocked and no clean ZIP is produced.

Nested ZIP archives are scanned, cleaned, rebuilt with neutral container metadata, and independently verified. ZIP nesting deeper than one nested level is blocked.

## Safety Limits

Before extraction or recursive processing, BURAN blocks:

- encrypted/password-protected ZIP;
- multi-volume or split ZIP markers;
- malformed ZIP;
- archive input larger than 100 MB;
- total uncompressed size larger than 250 MB;
- more than 10,000 entries;
- compression ratio above the conservative zip-bomb threshold;
- archive nesting depth above one nested ZIP level;
- individual nested file larger than its format-specific limit;
- path traversal names such as `../` or absolute paths;
- duplicate/conflicting canonical paths.

Blocked archives are not partially processed and do not produce an output file.

## Preservation Policy

BURAN preserves:

- folder structure;
- original entry names;
- entry ordering where practical;
- unsupported file bytes byte-for-byte;
- cleaned bytes for supported nested files;
- supported files' visible/document content according to each existing handler.

BURAN does not rename archive entries, flatten documents, change visible content, add archive comments, add BURAN branding, add timestamps, add creator values, or embed the original filename.

The output archive filename is always `buran-clean.zip`.

## Verification Model

After rebuilding, BURAN runs an independent verification pass. Verification confirms:

- the cleaned ZIP parses successfully;
- archive comment is absent;
- every entry timestamp equals the neutral fixed timestamp;
- identifying extra fields and Unix/host attributes are neutralised according to the implementation policy;
- filenames and folder structure are preserved;
- every supported nested file marked for cleaning is present and has zero supported personal metadata after a fresh scan;
- unsupported nested files remain byte-identical;
- original sentinel metadata values do not remain in archive container metadata or supported cleaned nested file bytes;
- entry count is unchanged;
- no unsupported high-risk structure was silently ignored.

Only when these checks pass may the UI show `Личных метаданных осталось: 0` for supported archive metadata and supported nested files.

## Unsupported Files

Unsupported files are not inspected deeply and are not modified. They are reported as:

`Файл сохранён без изменений: формат пока не поддерживает очистку метаданных.`

If unsupported files remain, BURAN uses precise wording:

`Поддерживаемые файлы очищены и проверены.`

`Неподдерживаемые файлы сохранены без изменений: N.`

This is not a claim that the archive is fully metadata-free or anonymous.
