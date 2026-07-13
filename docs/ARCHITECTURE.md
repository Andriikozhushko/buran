# BURAN Architecture

## Overview

BURAN is a **browser-only** single-page application (SPA) built with Vite, React, TypeScript, and Tailwind CSS. It has no backend, no API endpoints, and no external service dependencies.

All file processing — format detection, metadata scanning, sanitisation, and verification — runs locally in the browser using Web Workers to keep the UI responsive.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Build tool | Vite 8 |
| UI Framework | React 19 |
| Language | TypeScript 6 |
| Styling | Tailwind CSS 4 |
| Testing | Vitest 4 |
| Crypto | Web Crypto API (SHA-256) |
| Workers | Web Workers (ES modules via Vite) |

## Directory Structure

```
src/
  lib/
    formats/          # Format handler system
      types.ts        # Core TypeScript interfaces
      registry.ts     # Format handler registry
      detector.ts     # Magic-byte format detection
      categories.ts   # Metadata category definitions
      jpeg.ts         # JPEG handler (scan, clean, verify)
      png.ts          # PNG handler (scan, clean, verify)
      webp.ts         # WebP handler (scan, clean, verify)
      verification.ts # Post-clean verification pass
    hash.ts           # SHA-256 via Web Crypto API
    certificate.ts    # Certificate HTML generation
    validation.ts     # File size and type validation
  workers/
    scan.worker.ts    # Web Worker: metadata scanning
    clean.worker.ts   # Web Worker: sanitisation
  components/         # React UI components
  hooks/              # React hooks for processing orchestration
  i18n/               # Localisation strings (RU)
```

## Format Handler System

### Handler Interface

Each format implements the `FormatHandler` interface:

```typescript
interface FormatHandler {
  readonly format: SupportedFormat;
  scan(buffer: ArrayBuffer): ScanResult;
  clean(buffer: ArrayBuffer): ArrayBuffer;
  verify(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult;
}
```

### Registry

Handlers register themselves in the `FormatRegistry`:

```typescript
registerFormatHandler(jpegHandler);
registerFormatHandler(pngHandler);
registerFormatHandler(webpHandler);
```

To add a new format:
1. Implement `FormatHandler` for the format.
2. Register it in the registry.
3. Add the format to the `SupportedFormat` union type.
4. Add magic-byte detection in `detector.ts`.

### Processing Flow

```
File → validateFile() → detectFormat() → FormatHandler.scan() → ScanResult
ScanResult → FormatHandler.clean() → ArrayBuffer → FormatHandler.verify() → VerificationResult
```

#### JPEG: Two Processing Paths

BURAN has two distinct JPEG cleaning paths:

**Path A — Direct metadata-segment stripping (default)**
- Used for JPEGs with EXIF Orientation = 1 or no EXIF orientation.
- JPEG markers are analysed; privacy-relevant segments (EXIF APP1, XMP APP1, IPTC APP13, COM) are removed.
- Essential structural markers (DQT, DHT, SOF, SOS, DRI) and ICC profiles (APP2) are preserved.
- Pixel data is **not re-encoded** — the entropy-coded scan data is copied byte-for-byte from the original.

**Path B — Orientation-correction re-encode**
- Used for JPEGs with EXIF Orientation 2–8.
- The image is decoded by the browser, physically rotated/mirrored via Canvas 2D API, and re-encoded as JPEG at maximum quality.
- The re-encoded output is then passed through the clean worker to strip any residual metadata.
- The verification result explicitly sets `orientationApplied: true` and `pixelDataReencoded: true`.
- The UI and certificate disclose this honestly: "Ориентация: физически применена" / "Метод обработки: пересобрана чистая JPEG-копия."

The path choice is made in `App.tsx` based on `scanResult.orientation`.

## Web Workers

BURAN uses two Web Workers to keep binary parsing off the main thread:

### Scan Worker
- Receives `{ id, buffer, fileName, fileSize }`
- Runs format detection and metadata scanning
- Returns `{ id, result: ScanResult }` or `{ id, error }`

### Clean Worker
- Receives `{ id, buffer, scanResult }`
- Runs sanitisation and verification
- Returns `{ id, cleanBuffer, verification }` or `{ id, error }`

Workers use `postMessage` with `transfer` for zero-copy buffer transfer where possible.

## State Machine

The app uses a union-type state machine:

```
idle → scanning → scan-done → cleaning → success
  ↓        ↓          ↓          ↓          ↓
  └─ unsupported ←── error ──────────────→ (reset to idle)
```

## Verification Pass

After sanitisation, the output is re-scanned by the same format handler to confirm:
1. Privacy-relevant metadata has been removed.
2. Technical colour data has been preserved.
3. The file remains a valid, decodable image of the target format.

The verification result is honest: if metadata remains or if something was lost, it reports what happened.

## Certificate

The certificate is generated as an HTML document and printed via `window.print()`. The certificate:
- Uses `@media print` CSS for clean output.
- Contains the SHA-256 hash of the clean file for integrity verification.
- Does not contain any original file metadata.
- Is generated entirely in the browser.

## Security & Threat Model

### Trust Boundaries
- **Input**: Untrusted files from the user's filesystem.
- **Processing**: Sandboxed within the browser's JavaScript runtime and Web Workers.
- **Output**: Clean files downloaded by the user; no network transmission.

### Attack Surface
- **Malformed files**: Format handlers use defensive parsing (bounds checking, try/catch on binary reads) to handle malformed or fuzzed inputs.
- **Oversized files**: Rejected at the validation layer (>50 MB).
- **Side channels**: No network access. The ESLint config forbids `fetch`, `XMLHttpRequest`, and `navigator.sendBeacon`.
- **Supply chain**: Zero external runtime dependencies beyond React and ReactDOM. Tailwind is compile-time only.

### What BURAN is NOT
- Not a sandbox or antivirus — it does not protect against malicious code embedded in files.
- Not a steganography detector — it does not analyse pixel data for hidden content.
- Not a forensic tool — it reports metadata it can find, but does not guarantee completeness.

## Deploying

BURAN builds to a static `dist/` directory:

```bash
npm run build
```

Deploy `dist/` to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3, Nginx, etc.). No server-side processing required.
