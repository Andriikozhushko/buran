# Changelog

## 0.1.0 — Initial public release

- Browser-only metadata inspection, sanitisation, and verification.
- Supported formats: JPEG/JPG, PNG, WebP, PDF, DOCX, XLSX, PPTX, and ordinary ZIP archives with one nested ZIP level.
- Local-only processing: no uploads, telemetry, analytics, backend, accounts, or API calls.
- Independent post-clean verification before reporting a clean result.
- ZIP archives preserve folder structure and unsupported files byte-for-byte while clearly reporting unsupported metadata risk.
- Known limitations: BURAN does not remove visible content, watermarks, steganography, QR codes, faces, text in images, or secrets embedded in document content. Unsupported files inside archives remain unchanged.
