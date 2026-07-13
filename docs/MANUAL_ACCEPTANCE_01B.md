# BURAN 01B — Manual Acceptance Kit

## Purpose

This document provides a structured manual testing checklist for validating the BURAN 01B image-core pipeline in real browsers. Every item should be verified in both Chrome and Firefox before marking the milestone approved.

---

## Test Fixtures Reference

All fixtures are in `tests/fixtures/`. They are synthetic — no real personal data is present.

| Fixture | Description | Key Properties |
|---------|-------------|----------------|
| `sample.jpg` | JPEG with EXIF, GPS, author, XMP, ICC, IPTC, comment | GPS coords, camera model, copyright, ICC profile |
| `sample.png` | PNG with eXIf, text chunks, colour chunks | tEXt, zTXt, iTXt, tIME, iCCP, sRGB, gAMA, cHRM |
| `sample.webp` | WebP with EXIF, XMP, ICC | VP8X container, sub-chunks |
| `orientation-1.jpg` | JPEG with EXIF orientation 1 (Normal) | No rotation needed |
| `orientation-3.jpg` | JPEG with EXIF orientation 3 (180°) | 180° rotation |
| `orientation-5.jpg` | JPEG with EXIF orientation 5 (Transpose) | Mirrored variant |
| `orientation-6.jpg` | JPEG with EXIF orientation 6 (90° CW) | 90° rotation + dimension swap |
| `orientation-8.jpg` | JPEG with EXIF orientation 8 (270° CW) | 270° rotation + dimension swap |
| `unsupported.txt` | Plain text file | Unsupported format |
| (generate) | Any PDF or DOCX | Unsupported format test |

---

## Test Checklist

### 1. JPEG with GPS, author, camera, XMP, and non-default orientation

**Fixture:** `orientation-6.jpg` (has orientation 6, 90° CW)

- [ ] **Scan:** Drag-and-drop the file. Confirm scan report shows:
  - "Ориентация изображения" with severity medium
  - Description mentions that BURAN will preserve correct display
- [ ] **Clean:** Click "Удалить метаданные"
- [ ] **Success:** Confirm:
  - "Ориентация исправлена" appears in the results
  - "Пиксельные данные пересобраны" message is shown
  - Verification shows "Пройдена"
- [ ] **Download:** Download the clean file. Open it — image should display with correct orientation (not sideways).
- [ ] **Certificate:** Print certificate. Confirm it shows:
  - "Ориентация: Физически применена"
  - "Метод обработки: Пересобрана чистая JPEG-копия"
- [ ] **Network:** Open DevTools Network tab. Confirm no requests were made during processing.

### 2. JPEG with ICC profile and normal orientation

**Fixture:** `orientation-1.jpg` (or `sample.jpg`)

- [ ] **Scan:** Confirm ICC appears in "Что Буран сохранит"
- [ ] **Clean:** Confirm success message shows ICC preserved
- [ ] **Success:** Confirm:
  - "Пиксельные данные сохранены без повторного кодирования" is shown
  - NO "Ориентация исправлена" block appears
- [ ] **Verification:** Confirm metadata count decreases, metadata remaining = 0

### 3. PNG with metadata and colour chunks

**Fixture:** `sample.png`

- [ ] **Scan:** Confirm eXIf, tEXt (Author, Software, Comment), zTXt (Copyright), iTXt (Description), tIME chunks detected
- [ ] **Scan:** Confirm iCCP, sRGB, gAMA in preserved info
- [ ] **Clean:** Click "Удалить метаданные"
- [ ] **Success:** All personal metadata removed, colour chunks preserved
- [ ] **Download:** Open file — image decodes correctly

### 4. WebP with EXIF/XMP/ICC

**Fixture:** `sample.webp`

- [ ] **Scan:** EXIF and XMP detected in scan report
- [ ] **Scan:** ICC detected in preserved info
- [ ] **Clean:** After cleaning, EXIF and XMP removed
- [ ] **Verification:** ICC preserved after clean
- [ ] **Download:** Open file — valid WebP

### 5. Unsupported PDF and DOCX

**Fixture:** Any PDF or `.docx` file

- [ ] **UI:** Unsupported state shown with clear explanation
- [ ] **Message:** Explains that format support is added carefully
- [ ] **No fake scan:** Does NOT show a scan report or clean button
- [ ] **Roadmap:** Mentions planned formats

### 6. Oversized file

**Fixture:** Any file > 50 MB

- [ ] **UI:** Error message about file size limit
- [ ] **No processing:** Does not attempt to scan or clean

### 7. Drag-and-drop vs file picker

- [ ] **D&D:** Drag a valid JPEG onto the drop zone — file is accepted
- [ ] **Click:** Click the drop zone, select a file — file is accepted
- [ ] **Reject:** Drag a `.txt` file — unsupported state shown
- [ ] **Visual:** Drop zone highlights on drag-over

### 8. Network tab verification

- [ ] Open DevTools → Network tab
- [ ] Drop a file, scan, clean, download
- [ ] **Confirm:** Zero network requests appear during the entire flow

### 9. Download filename

- [ ] Download a clean file
- [ ] **Confirm:** Filename is `buran-clean.<ext>` — generic, not the original filename

### 10. Certificate does not disclose private metadata

- [ ] Process `sample.jpg` (which has GPS, author, etc.)
- [ ] Print/download certificate
- [ ] **Confirm:** Certificate does NOT contain:
  - GPS coordinates
  - Original author name
  - Original filename
  - Camera serial number
- [ ] **Confirm:** Certificate DOES contain:
  - File type (JPEG)
  - Scan date/time
  - Metadata counts
  - SHA-256 hash
  - Scope disclaimer

---

## Browser Compatibility

| Test | Chrome | Firefox |
|------|--------|---------|
| JPEG scan | ☐ | ☐ |
| JPEG clean | ☐ | ☐ |
| JPEG orientation 6 | ☐ | ☐ |
| PNG scan | ☐ | ☐ |
| PNG clean | ☐ | ☐ |
| WebP scan | ☐ | ☐ |
| WebP clean | ☐ | ☐ |
| Drag-and-drop | ☐ | ☐ |
| File picker | ☐ | ☐ |
| Certificate print | ☐ | ☐ |
| Network tab clean | ☐ | ☐ |

---

## Pre-flight Checklist (Before Starting Browser Tests)

- [ ] `npm run build` — production build succeeds
- [ ] `npm test` — all 77 tests pass
- [ ] `npm run typecheck` — TypeScript clean
- [ ] No `fetch`, `XMLHttpRequest`, or `navigator.sendBeacon` in `src/` (confirmed by grep and ESLint rule)

---

## Sign-off

- [ ] All checklist items verified in Chrome
- [ ] All checklist items verified in Firefox
- [ ] No regressions from 01A milestone
- [ ] Commit tagged: `snapshot/after-buran-01b-image-integrity-approved`
