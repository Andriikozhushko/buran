# BURAN UX & Trust Layer 03A

## Four-Section Trust Model

Every supported scan result follows the same order:

1. **Что найдено** — plain-language summary of supported metadata traces.
2. **Что будет удалено** — exact supported surfaces BURAN will remove or neutralise.
3. **Что сохранится** — visible content and technical fields intentionally preserved.
4. **Что проверит BURAN** — independent post-clean verification checks.

Technical labels, XML names, EXIF tags, ZIP headers, and binary details are moved into `Технические детали`.

## Wording Rules

- Say “поддерживаемые личные метаданные”, not “all metadata”.
- Never claim anonymity, “100% clean”, or “zero leakage”.
- “Личных метаданных осталось: 0” is only valid when supported metadata verification passes.
- If nothing is found, say BURAN will still verify the output after processing.
- For Office placeholders, use: `Исходные авторы удалены. В отдельных служебных полях формат Office требует нейтральный placeholder: Anonymous.`

## Supported, Unsupported, Blocked

- **Supported**: current format and all relevant supported surfaces can be cleaned and verified.
- **Partially supported**: ZIP archives containing unsupported files. Supported files are cleaned; unsupported files are preserved unchanged and not called safe.
- **Blocked**: encrypted, signed, malformed, unsafe, oversize, zip-bomb-like, or unverifiable inputs. No clean output is produced.

## Certificate Privacy Rules

The certificate PDF is generated locally in the browser. It may contain counts, output type, processing time, verification status, preserved technical fields, SHA-256 of the clean output, and limitations.

It must not contain original filename, GPS coordinates, author names, private metadata values, or source file hash.

The filename is deterministic: `buran-clean-certificate.pdf`.

## Archive Truthfulness

ZIP results distinguish verified supported files from unchanged unsupported files.

Required wording for unsupported archive entries:

`Сохранён без изменений — BURAN пока не анализирует метаданные этого формата.`

Do not call the whole archive anonymous or fully metadata-free when unsupported files remain.
