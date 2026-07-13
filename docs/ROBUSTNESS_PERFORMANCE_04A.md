# BURAN 04A — Robustness, Cancellation & Performance

## Cancellation Architecture

BURAN treats each scan and clean operation as a single active request with an operation ID. Worker responses are accepted only when their response ID still matches the active operation ID. This prevents stale responses from a cancelled, timed-out, or replaced operation from reaching success UI.

The visible action is `Отменить обработку`. Cancellation clears pending scan/blocked results, drops input references, terminates the active worker, creates a fresh worker, and returns the user to this retry state:

`Обработка отменена. Файл не был изменён и не покидал ваше устройство.`

Cancelled operations never expose a clean download and never show `BURAN CLEAN VERIFIED`.

## Worker Lifecycle

- `scan.worker.ts` performs format detection and metadata scanning outside the main thread.
- `clean.worker.ts` performs sanitisation and independent verification outside the main thread.
- Cancellation and watchdog expiry terminate the relevant worker because PDF, Office, ZIP, and large image parsing cannot be interrupted safely in all code paths.
- Replacement files invalidate the previous operation ID before reading or posting new data.
- Large buffers are transferred where possible instead of copied; scan receives a transferred copy while the original is kept only until cleaning starts.

## Timeout And Size Limits

- Existing file-size limits remain: images up to 50 MB; PDF, Office, and ZIP up to 100 MB.
- Scan watchdog: 30 seconds. This bounds malformed parser stalls and very slow decompression.
- Clean/verify watchdog: 45 seconds. This covers full rewrite plus independent verification.
- Decoded image pixel limit: 40,000,000 pixels. This blocks images that may fit the byte limit but exceed practical browser memory once decoded or canvas-processed.

Timeouts are reported honestly:

`BURAN не завершил обработку в безопасное время. Файл не был загружен или изменён. Попробуйте файл меньшего размера.`

Timeouts never become verified results.

## Archive Safety Limits

ZIP processing keeps the 02C limits and enforces them before recursive sanitisation:

- input archive up to 100 MB;
- total uncompressed size up to 250 MB;
- up to 10,000 entries;
- compression ratio up to 200:1;
- one nested ZIP level;
- no absolute paths, path traversal, duplicate canonical paths, multi-volume archives, encrypted entries, or malformed central directories.

Nested supported files also keep their per-format byte limits. Unsupported files are preserved byte-for-byte and reported as unchanged; BURAN does not claim they are clean.

## Malformed-File Policy

Malformed input is blocked or reported as unsupported. BURAN does not rewrite unsupported data silently, does not expose a clean download for malformed processing, and does not set `verificationPassed: true` when parsing, sanitisation, or verification is incomplete.

Image parsers now stop safely on invalid segment/chunk lengths rather than reading outside the buffer. PDF, Office, and ZIP handlers continue to convert parser failures into blocked outcomes.

## Code-Splitting Strategy

Heavy format handlers are loaded only inside workers when the detected format needs them:

- PDF scan/sanitise/verify via dynamic import;
- Office scan/sanitise/verify via dynamic import;
- ZIP scan/sanitise/verify via dynamic import;
- certificate PDF generator, `pdf-lib`, `fontkit`, and embedded Roboto font data via dynamic import only when the certificate button is clicked.

The initial upload screen keeps image handlers and lightweight magic-byte detection available, but avoids eager certificate/PDF/Office/ZIP sanitisation code. Office validation imports only the lightweight container detector.

## Build Report

Production build after 04A code splitting:

- initial app JS: `dist/assets/index-Dvkkn01B.js` — 246.20 kB, gzip 75.71 kB;
- CSS: `dist/assets/index-R3kXc0ze.css` — 27.98 kB, gzip 6.25 kB;
- scan worker bootstrap: `dist/assets/scan.worker-DCg2hwj0.js` — 34.04 kB;
- clean worker bootstrap: `dist/assets/clean.worker-kfZWtF8r.js` — 31.19 kB;
- lazy PDF chunks: 432.09 kB and 435.24 kB;
- lazy Office chunks: 108.02 kB and 117.19 kB;
- lazy ZIP chunks: 9.58 kB and 15.75 kB;
- lazy demo-fixture generator: 98.76 kB;
- lazy certificate generator and embedded font data: 1,573.36 kB, gzip 801.85 kB;
- shared lazy PDF dependency chunk: 420.04 kB, gzip 175.58 kB.

The production build now splits certificate generation, demo PDF/ZIP generation, and worker format handlers into lazy chunks. The initial bundle still includes React UI, image handlers, validation, and worker bootstrap code because image upload is the primary first interaction.

Remaining unavoidable assets:

- image handlers for JPEG/PNG/WebP because basic image upload must work immediately;
- worker bootstrap modules because scan and clean workers are created on app startup;
- CSS and UI components required for the upload and progress screens.

## Main-Thread Paths

Most parse, sanitise, and verify work runs in workers. The known unavoidable main-thread path is JPEG orientation correction for EXIF orientation 2-8, which uses browser canvas APIs. This path remains bounded by byte-size, decoded-pixel, and clean watchdog limits and is disclosed as re-encoding in the UI and certificate.

## Privacy Implications

All processing remains local in the browser. Cancellation, timeout, malformed parsing, worker restart, and resource-limit states explicitly say that the file was not uploaded. BURAN does not add backend calls, telemetry, analytics, accounts, cloud processing, remote assets, or runtime remote imports.
