import type { MetadataFinding } from '../types';
import type { ZipBlock, ZipScanData } from './types';
import { archiveComment, entryExtraFieldCount, entryHasExternalAttributes, extensionOf, loadZip, readEntryBytes, zipBlock } from './safety';
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
    if (entry.date) container.entryTimestamps++;
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
        findingsCount: nested.data.findings.length,
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
        findingsCount: nested.scan.findings.length,
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
  if (supportedEntries.length > 0) findings.push(finding('zip:supportedEntries', 'Supported files inside the archive', String(supportedEntries.length), 'medium', ''));
  if (unsupportedEntries.length > 0) findings.push(finding('zip:unsupportedEntries', 'Unsupported files', String(unsupportedEntries.length), 'low', ''));

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
