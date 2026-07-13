# BURAN Threat Model and Security Model

BURAN is a local-first browser application for inspecting, removing, and verifying supported personal metadata in files. The core security claim is intentionally narrow: supported metadata is processed on the user's device, without a backend upload path.

## Security Goals

- Keep file contents on the user's device during scan, cleanup, and verification.
- Remove supported personal metadata from supported formats.
- Verify cleaned output before presenting it as clean.
- Preserve visible/document content where the format handler claims preservation.
- Fail closed: blocked, malformed, timed out, cancelled, encrypted, signed, or unsupported inputs must not produce a verified-clean download.
- Avoid runtime dependencies on external services, CDNs, analytics, payments, or tracking scripts.

## Non-Goals

- Guarantee anonymity.
- Remove visible information such as faces, text, license plates, QR codes, document content, or screenshots.
- Detect or remove watermarks, steganography, hidden pixels, or secrets embedded in visible content.
- Fully inspect unsupported formats or unsupported nested files inside archives.
- Preserve cryptographic signatures after metadata changes.
- Protect the user from a compromised browser, device, extension, operating system, or hosting provider.

## Assets Protected

- Original file bytes selected by the user.
- Extracted metadata values such as author, GPS, timestamps, application names, device identifiers, comments, and document properties.
- Cleaned output bytes before the user downloads them.
- Verification result and clean-file hash.

## Trust Boundaries

| Boundary | What crosses it | Security expectation |
|---|---|---|
| User device -> browser runtime | User-selected file bytes | The file is exposed to the local browser tab only. |
| Main thread -> Web Worker | ArrayBuffer copies/transfers | Heavy parsing and sanitisation run off the UI thread. |
| Browser memory -> download | Clean output Blob | Only verified output is offered for download. |
| Browser -> network | Static app assets during load | File contents and metadata must not be sent over the network. |

## Data Flow

1. The user selects or drops a file.
2. Validation checks size and format constraints.
3. A scan Worker parses supported metadata locally.
4. The UI reports concrete findings and limitations.
5. A clean Worker sanitises supported metadata.
6. A verification pass re-parses the clean output.
7. BURAN offers a download only if verification reaches a safe state.

## Failure Model

BURAN prefers a visible blocked state over a misleading output. The app does not create a clean download when it cannot make the relevant preservation and verification claims for the selected format.

Examples of fail-closed inputs:

- encrypted or password-protected documents;
- digitally signed PDFs or Office packages;
- malformed files;
- resource-limit or timeout failures;
- ZIP path traversal or zip-bomb indicators;
- unsupported HEIC/HEIF sequences or auxiliary images;
- Office macro-enabled or embedded-object packages.

## Verification Model

Verification is format-specific. It is not a generic string replacement pass.

- JPEG, PNG, and WebP outputs are scanned for supported metadata containers after cleanup.
- PDF outputs are re-parsed and checked for supported document metadata surfaces.
- Office outputs are re-opened as OOXML packages and checked for supported metadata parts and identity fields.
- ZIP outputs verify archive metadata, supported nested files, and unchanged unsupported entries.
- HEIC/HEIF cleanup exports a new JPEG/PNG and verifies that source metadata was not transferred.

## Residual Risks

- The browser may keep temporary memory, cache, or download history outside BURAN's control.
- Browser extensions can observe pages or downloads if the user has granted them access.
- Unsupported metadata surfaces may remain in formats BURAN does not parse yet.
- Visible content can still identify a person or source even after metadata cleanup.
- Static hosting access logs can record that the app was loaded, but not the contents of local files.

## Security Invariants

- No verified-clean claim without a verification result.
- No clean download on cancellation, timeout, malformed input, or blocked format state.
- No original filename embedded into certificates or cleaned outputs where BURAN controls output metadata.
- No analytics, telemetry, accounts, databases, or backend upload API.
