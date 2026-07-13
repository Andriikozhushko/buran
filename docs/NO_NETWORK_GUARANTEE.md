# No Network Guarantee

BURAN's privacy guarantee is not based only on UI copy. The codebase includes automated guards that make runtime networking an explicit test failure.

## Claim

During file scan, cleanup, verification, and download preparation, BURAN must not send file contents, extracted metadata, filenames, hashes, or processing results to a remote service.

The app may load its own static assets from the local development/preview server or static hosting provider. After the app is loaded, file processing is expected to run locally.

## Runtime Networking Prohibited

The source guard fails if application code introduces common browser networking primitives:

- `fetch(...)`
- `XMLHttpRequest`
- `WebSocket`
- `sendBeacon`
- `navigator.sendBeacon`

Test: `tests/unit/no-network-04a.test.ts`

Command:

```bash
npx vitest run tests/unit/no-network-04a.test.ts
```

## Browser Smoke Guard

Playwright smoke tests install runtime privacy guards before the app code runs. They override or capture networking primitives and fail if file processing attempts external network access.

Covered flows include:

- JPEG scan, clean, verify;
- PDF scan, clean, verify, certificate download;
- ZIP scan, clean, verify;
- HEIC/HEIF clean export;
- blocked malformed/unsupported inputs;
- cancellation flows;
- mobile viewport smoke coverage.

Test: `tests/e2e/smoke.spec.ts`

Command:

```bash
npm run test:e2e
```

## CI Enforcement

The CI pipeline runs:

- TypeScript typecheck;
- unit tests, including the static no-network guard;
- production build;
- Playwright smoke tests with runtime no-network assertions.

## What This Does Not Prove

- It does not prove the user's browser, extensions, OS, or hosting provider are trustworthy.
- It does not prevent the browser from downloading the app's own static assets.
- It does not inspect third-party browser extensions.
- It does not make unsupported formats safe.

## Engineering Rule

Any future feature that needs network access must be treated as a privacy-design change, documented explicitly, and covered by tests that prove file contents and metadata are not transmitted.
