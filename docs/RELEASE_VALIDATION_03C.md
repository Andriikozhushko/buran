# BURAN Release Validation 03C

Date: 2026-06-26

## Environment And Tool Availability

| Tool | Availability | Result |
|---|---:|---|
| Playwright Chromium | Available | Used for production browser E2E. |
| Playwright mobile Chromium profile | Available | Used for mobile viewport E2E. |
| Chrome / `chrome` CLI | Not found via `Get-Command` / `where.exe` | Manual Chrome desktop validation remains open. |
| Microsoft Edge / `msedge` CLI | Not found | Manual Edge validation remains open. |
| LibreOffice / `soffice` / `libreoffice` | Not found | Desktop Office compatibility validation not performed. |
| Microsoft Word / Excel / PowerPoint CLI | Not found | Microsoft Office compatibility validation not performed. |
| `pdftoppm` | Not found | PDF raster/render validation not performed with Poppler. |
| `mutool` | Not found | PDF raster/render validation not performed with MuPDF. |
| `qpdf` | Not found | External PDF structural validation not performed. |

## Commands Actually Run

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npx playwright screenshot "file:///C:/Users/Andrii/OneDrive/Documents/buran/test-artifacts/certificate-03c.pdf" "test-artifacts/certificate-03c-chromium.png" --browser chromium --timeout 15000
```

## Automated Unit / Integration Results

| Check | Result |
|---|---|
| ESLint | Passed. |
| TypeScript | Passed. |
| Vitest suite | Passed: 13 test files, 128 tests. |
| Production build | Passed. Vite reports expected large chunk warning because local Roboto font data is bundled for Cyrillic certificate PDFs. |

## Production Browser E2E Results

Playwright was configured to run against production preview on `127.0.0.1:5274` using:

```bash
npm run build && npm run preview -- --host 127.0.0.1 --port 5274 --strictPort
```

| Flow | Desktop Chromium | Mobile Chromium | Result |
|---|---:|---:|---|
| JPEG demo with fake GPS/device/author metadata | Passed | Passed | Scan, clean, verification, download CTA. |
| PDF demo | Passed | Passed | Scan, clean, verification, certificate PDF download. |
| ZIP mixed demo | Passed | Passed | Supported entries cleanable, unsupported entry unchanged, no anonymous wording. |
| Unsupported file | Passed | Passed | Unsupported state, no clean download. |
| Blocked malformed PDF | Passed | Passed | Explicit blocked state, no clean download. |
| DOCX synthetic fixture | Passed | Passed | Scan, clean, verification, output download CTA. |
| XLSX synthetic fixture | Passed | Passed | Scan, clean, verification, output download CTA. |
| PPTX synthetic fixture | Passed | Passed | Scan, clean, verification, output download CTA. |
| Mobile overflow / CTA | Not applicable | Passed | No horizontal document overflow; primary CTA reachable. |

## Network Validation

Browser-level assertions start after initial static app load and before file/demo processing begins. During scan, clean, verify, and certificate generation:

- No `fetch` calls were observed.
- No `XMLHttpRequest` calls were observed.
- No product `WebSocket` calls were observed.
- No `sendBeacon` calls were observed.
- No post-start HTTP(S) requests were observed during production preview processing.
- Initial local static asset loading is excluded by design; it is not file processing.

Static source-level privacy audit also passed and rejects prohibited runtime networking primitives under `src/`, with narrow exceptions for static SVG/XMP namespace strings.

## Certificate PDF Validation

Certificate implementation was upgraded to a locally generated PDF using `pdf-lib`, `@pdf-lib/fontkit`, and bundled local Roboto font data from `pdfmake/build/vfs_fonts`.

Automated checks passed:

- Valid `%PDF-` header.
- Embedded Roboto font marker present.
- `/ToUnicode` mapping present.
- Safe Russian certificate subject is parsed by `pdf-lib`: `Сертификат локальной очистки метаданных`.
- No private sentinel strings such as `DEMO_FAKE_AUTHOR` appear in generated PDF bytes.
- No original filename such as `buran-demo.pdf` appears in generated PDF bytes.
- Download filename is `buran-clean-certificate.pdf`.

Browser download validation passed in Playwright Chromium. A non-private PDF artifact was saved locally at:

```text
test-artifacts/certificate-03c.pdf
```

Viewer/raster validation status:

- Attempted Chromium screenshot render via `npx playwright screenshot file:///.../certificate-03c.pdf`.
- Chromium treated the PDF URL as a download and did not render a screenshot.
- No `pdftoppm`, `mutool`, `qpdf`, Acrobat, Edge, or external PDF viewer was available.
- Therefore visual Cyrillic rendering in a PDF viewer was **not** claimed as validated and remains a manual release check.

## Office Desktop Validation

LibreOffice, Microsoft Office CLI tools, and headless Office-compatible converters were not available in this environment.

Performed:

- Browser pipeline validation for DOCX, XLSX, PPTX using bundled synthetic fixtures.
- Existing unit verification confirms metadata removal and package-level structure checks.

Not performed:

- Opening cleaned DOCX/XLSX/PPTX in LibreOffice.
- Opening cleaned DOCX/XLSX/PPTX in Microsoft Office.
- Headless conversion/export compatibility checks.

Office/LibreOffice compatibility remains a manual release task.

## Remaining Manual Checks

| Check | Why it remains |
|---|---|
| Visual review of premium certificate in Chrome/Edge/Acrobat or another PDF viewer | No viewer/rendering tool available; Chromium CLI downloaded instead of rendering. |
| Firefox desktop browser flow | Playwright Firefox was not installed/run in this milestone. |
| Chrome desktop manual DevTools Network panel | Automated Chromium network assertions passed; manual visual DevTools confirmation remains optional release evidence. |
| LibreOffice / Microsoft Office compatibility | Desktop tools not installed. |
| Human visual review of certificate typography and seal | Automated tests verify structure and safe data, not visual taste. |

## Pass / Fail Summary

- Automated unit/integration: passed.
- Production browser E2E: passed for Chromium desktop and mobile viewport.
- Network validation: passed in automated production E2E scope.
- PDF byte/Unicode/font validation: passed.
- PDF visual render validation: not performed; tool unavailable.
- Desktop Office compatibility validation: not performed; tool unavailable.
