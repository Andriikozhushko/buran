import type { MetadataFinding } from '../types';
import { personalFindingCount } from '../types';
import type { ZipBlock, ZipScanData } from './types';
import { archiveComment, entryExtraFieldCount, entryHasExternalAttributes, extensionOf, isNeutralDate, loadZip, readEntryBytes, zipBlock } from './safety';
import { detectNestedFormat, scanNestedSupported, toArrayBuffer } from './recursive';

function finding(field: string, label: string, value: string | null, severity: MetadataFinding['severity'], description: string): MetadataFinding {
  return { category: 'zip-container', field, label, value, severity, description };
}

export async function scanZip(buffer: ArrayBuffer, depth = 0): Promise<ZipBlock | { data: ZipScanData }> {
  const loaded = await loadZip(buffer);
  if ('blocked' in loaded) return loaded;

  const container = {
    entryTimestamps: 0,
    unixPermissionFields: 0,
    externalAttributeFields: 0,
    extraFields: 0,
    archiveCommentFound: archiveComment(loaded.zip).length > 0,
    hostPlatformFields: 0,
  };
  const findings: MetadataFinding[] = [];
  const supportedEntries: ZipScanData['supportedEntries'] = [];
  const unsupportedEntries: ZipScanData['unsupportedEntries'] = [];
  const rawMetadataValues: string[] = [];
  let nestedArchiveCount = 0;

  for (const name of loaded.entryNames) {
    const entry = loaded.zip.files[name];
    // JSZip always materialises a date, so count only timestamps that differ
    // from the neutral value — a cleaned archive re-scanned must show zero.
    if (!isNeutralDate(entry.date)) container.entryTimestamps++;
    if (entryExtraFieldCount(entry) > 0) container.extraFields += entryExtraFieldCount(entry);
    if (entryHasExternalAttributes(entry)) {
      container.externalAttributeFields++;
      container.unixPermissionFields++;
    }
    if (entry.dir) continue;

    const bytes = await readEntryBytes(loaded.zip, name);
    if ('blocked' in bytes) return bytes;
    const ab = toArrayBuffer(bytes);
    const detected = detectNestedFormat(ab, name);
    if (detected === 'zip') {
      nestedArchiveCount++;
      if (depth >= 1) {
        return zipBlock('too-deep', `Архив ${name} вложен глубже одного уровня. BURAN не обрабатывает такие архивы.`, name);
      }
      const nested = await scanZip(ab, depth + 1);
      if ('blocked' in nested) return nested;
      supportedEntries.push({
        path: name,
        format: 'zip',
        size: bytes.byteLength,
        findingsCount: personalFindingCount(nested.data.findings),
        status: 'ready',
        preserved: 'Имена, структура и поддерживаемое содержимое вложенного ZIP сохраняются.',
        nestedDepth: depth,
        rawMetadataValues: nested.data.rawMetadataValues,
      });
      rawMetadataValues.push(...nested.data.rawMetadataValues);
      continue;
    }
    if (detected) {
      const nested = await scanNestedSupported(ab, name, bytes.byteLength);
      if ('blocked' in nested) return nested;
      supportedEntries.push({
        path: name,
        format: nested.scan.format,
        size: bytes.byteLength,
        findingsCount: personalFindingCount(nested.scan.findings),
        status: 'ready',
        preserved: preservedText(nested.scan.format),
        nestedDepth: depth,
        rawMetadataValues: nested.rawMetadataValues,
      });
      rawMetadataValues.push(...nested.rawMetadataValues);
    } else {
      unsupportedEntries.push({
        path: name,
        extension: extensionOf(name) || 'unknown',
        size: bytes.byteLength,
        status: 'unchanged',
        message: 'Файл сохранён без изменений: формат пока не поддерживает очистку метаданных.',
        nestedDepth: depth,
      });
    }
  }

  if (container.entryTimestamps > 0) findings.push(finding('zip:timestamps', 'ZIP entry timestamps', String(container.entryTimestamps), 'low', ''));
  if (container.archiveCommentFound) findings.push(finding('zip:comment', 'ZIP comment', 'Present', 'medium', ''));
  if (container.externalAttributeFields > 0) findings.push(finding('zip:externalAttributes', 'ZIP external attributes', String(container.externalAttributeFields), 'low', ''));
  if (container.extraFields > 0) findings.push(finding('zip:extraFields', 'ZIP extra fields', String(container.extraFields), 'medium', ''));
  // Entry counts are structure, not removable metadata — the archive tree and
  // the limitations section already disclose them. Findings list only what
  // cleaning will actually remove, so a cleaned archive re-scans as clean.
  const nestedTraceCount = supportedEntries.reduce((sum, e) => sum + e.findingsCount, 0);
  if (nestedTraceCount > 0) findings.push(finding('zip:nestedFindings', 'Metadata traces in archived files', String(nestedTraceCount), 'medium', ''));

  return {
    data: {
      findings,
      totalEntries: loaded.entryCount,
      totalFiles: loaded.fileNames.length,
      uncompressedSize: loaded.uncompressedSize,
      supportedEntries,
      unsupportedEntries,
      nestedArchiveCount,
      containerMetadata: container,
      rawMetadataValues: rawMetadataValues.filter((s) => s.length >= 3),
      unsupportedMetadataRisk: unsupportedEntries.length > 0
        ? [`Неподдерживаемые файлы сохранены без изменений: ${unsupportedEntries.length}.`]
        : [],
    },
  };
}

function preservedText(format: string): string {
  if (format === 'pdf') return 'Страницы, текст, изображения, ссылки и структура PDF сохраняются.';
  if (format === 'docx' || format === 'xlsx' || format === 'pptx') return 'Видимый документ, таблицы, формулы, слайды, изображения и комментарии сохраняются.';
  return 'Видимые пиксели и технические цветовые данные сохраняются.';
}
