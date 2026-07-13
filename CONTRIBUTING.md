# Contributing

## Setup

```bash
npm install
npm run dev
```

## Quality Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Privacy Constraints

BURAN must remain browser-only. Do not add uploads, telemetry, analytics, tracking pixels, accounts, databases, API calls, remote fonts, CDN runtime assets, or backend fallbacks.

## Fixtures

Only synthetic metadata and non-private files are allowed in fixtures. Do not commit real personal photos, documents, archives, GPS values, author names, or private metadata.

## Format Handlers

New or changed format handlers must include scanning, sanitisation, independent verification, honest blocked states, and tests that prove supported metadata is removed while visible content is preserved.
