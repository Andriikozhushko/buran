# BURAN Release QA 03A

## Manual Checklist

### JPEG With GPS And Orientation

- Scan a JPEG with fake GPS/device/author metadata.
- Confirm four sections appear in order.
- Clean and verify.
- Confirm orientation disclosure appears only after processing when applicable.
- Download clean file and certificate PDF.

### PNG / WebP

- Scan PNG/WebP fixtures with text/XMP metadata.
- Confirm colour/ICC preservation is stated separately from personal metadata removal.
- Clean, verify, download.

### PDF

- Scan PDF with fake author/XMP metadata.
- Confirm preservation text says pages, text, images, and main structure.
- Confirm blocked PDFs show exact reason and no clean download.

### DOCX / XLSX / PPTX

- Scan Office fixtures with fake author/company/comment metadata.
- Confirm Anonymous placeholder wording is visible where comment identities are neutralised.
- Confirm visible document content and comment bodies are described as preserved.

### ZIP Mixed Archive

- Scan ZIP with supported and unsupported nested files.
- Confirm ZIP tree shows cleanable supported files and unchanged unsupported files.
- Confirm unsupported files are not described as safe.
- Clean and verify byte-identical unsupported files.

### Nested ZIP

- Scan and clean one nested ZIP level.
- Confirm deeper nesting is blocked with no output.

### Blocked Inputs

- Test encrypted/signed/malformed PDF/Office and malformed/unsafe ZIP fixtures.
- Confirm exact blocked reason and no clean output.

### Mobile Browser

- Test 390px viewport.
- Confirm no horizontal scrolling, readable ZIP tree, stacked sections, and large tap targets.

### Network Check

- Open Chrome DevTools Network.
- Scan, clean, verify, download clean file, and download certificate.
- Confirm no upload or external processing request occurs.

### Certificate Download

- Click `Скачать сертификат PDF`.
- Confirm filename is `buran-clean-certificate.pdf`.
- Confirm certificate contains no original filename or private metadata values.

### Demo Flows

- Run JPEG, PDF, and ZIP demos.
- Confirm banner says demo data is synthetic.
- Confirm real scan, clean, verify, and certificate flow works.
