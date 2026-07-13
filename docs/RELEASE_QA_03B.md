# BURAN Release QA 03B

| Area | Expected result | Actual result | Pass/Fail | Manual? |
|---|---|---|---|---|
| Automated unit tests | `npm test` passes, including privacy audit and certificate tests |  |  | No |
| Browser E2E | Playwright smoke flows pass for demo JPEG/PDF/ZIP, unsupported, blocked, privacy, mobile |  |  | Browser automated |
| Chrome desktop | Scan, clean, verify, download, certificate work without network upload |  |  | Yes |
| Firefox desktop | Same as Chrome desktop |  |  | Yes |
| Chrome Android / mobile viewport | No horizontal overflow; CTA and sections readable |  |  | Yes |
| JPEG | GPS/device/author findings shown; clean verifies; orientation disclosure only when applicable |  |  | Yes |
| PNG | Text metadata cleaned; colour/rendering data honestly preserved |  |  | Yes |
| WebP | EXIF/XMP cleaned; ICC preservation wording is honest |  |  | Yes |
| PDF | Metadata cleaned; pages/text/images/main structure preserved; blocked PDFs produce no output |  |  | Yes |
| DOCX | Properties/comment identities/revision metadata handled; `Anonymous` placeholder wording visible |  |  | Yes |
| XLSX | Same Office checks for workbook fixture |  |  | Yes |
| PPTX | Same Office checks for presentation fixture |  |  | Yes |
| ZIP | Supported files cleanable; unsupported files explicitly unchanged, not safe |  |  | Yes |
| Nested ZIP | One nested level cleans; deeper nesting blocks |  |  | Yes |
| Unsupported file | Unsupported state clear; no clean output offered |  |  | Browser automated + manual |
| Blocked encrypted/signed/malformed | Exact blocked reason; no clean output offered |  |  | Browser automated + manual |
| Certificate download | Downloads `buran-clean-certificate.pdf`; opens in PDF viewer; Cyrillic renders correctly |  |  | Yes |
| DevTools Network | No upload/external processing request during scan, clean, verify, download, certificate |  |  | Yes |
| Office/LibreOffice compatibility | Cleaned DOCX/XLSX/PPTX open correctly in target office suites |  |  | Manual outside automated tests |

Do not use real private files during QA. Use synthetic fixtures only.
