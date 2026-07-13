# Dependency & Privacy Audit 03B

## Runtime Dependencies

- `@pdf-lib/fontkit` — local font embedding for certificate PDFs. No network behavior.
- `jszip` — local ZIP parsing and generation. No network behavior.
- `pdf-lib` — local PDF parsing, sanitisation, verification, and certificate generation. No network behavior.
- `pdfmake` — bundled Roboto virtual font source used locally for Cyrillic-capable certificate PDFs. No runtime network fetch.
- `react` / `react-dom` — UI runtime. No network behavior by itself.

## Development Dependencies

Build, lint, test, Tailwind/Vite, TypeScript, Vitest, and Playwright tooling are development-only. Playwright browser downloads occur only during test setup, not normal app operation.

## Network Policy

Normal BURAN operation requires no remote URL after the static app assets are loaded. File scanning, sanitisation, verification, demo fixtures, ZIP processing, and certificate PDF generation run locally in the browser.

The static privacy audit test fails if `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or direct HTTP(S) runtime URLs are introduced under `src/`, except static metadata namespace strings such as SVG and XMP identifiers.

## Offline Build Note

The production build can run offline after initial static asset load. Certificate PDF Cyrillic support is bundled in the JavaScript output via local font data, which increases bundle size but avoids remote font requests.
