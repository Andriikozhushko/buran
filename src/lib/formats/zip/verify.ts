import JSZip from 'jszip';
import type { ZipScanData, ZipVerification } from './types';
import { archiveComment, entryExtraFieldCount, entryHasExternalAttributes, loadZip, NEUTRAL_DATE, readEntryBytes } from './safety';
import { detectNestedFormat, scanNestedSupported, toArrayBuffer } from './recursive';
import { scanZip } from './scan';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

export async function verifyZip(
  originalBuffer: ArrayBuffer,
  originalScan: ZipScanData,
  cleanBuffer: ArrayBuffer,
): Promise<ZipVerification> {
  const risk = [...originalScan.unsupportedMetadataRisk];
  const original = await loadZip(originalBuffer);
  const clean = await loadZip(cleanBuffer);
  if ('blocked' in original || 'blocked' in clean) return fail(originalScan, risk.concat('Очищенный ZIP не удалось разобрать.'));

  const originalNames = original.entryNames;
  const cleanNames = clean.entryNames;
  const structurePreserved = originalNames.length === cleanNames.length && originalNames.every((n, i) => n === cleanNames[i]);
  if (!structurePreserved) risk.push('Структура или порядок элементов архива изменились.');

  const archiveCommentRemoved = archiveComment(clean.zip).length === 0;
  const neutral = NEUTRAL_DATE.getTime();
  const timestampsNormalised = Object.values(clean.zip.files).every((f) => Math.abs((f.date?.getTime() ?? 0) - neutral) < 2500);
  const extraFieldsNeutralised = Object.values(clean.zip.files).every((f) => entryExtraFieldCount(f) === 0);
  const externalAttributesNeutralised = Object.values(clean.zip.files).every((f) => !entryHasExternalAttributes(f));

  const supportedPaths = new Set(originalScan.supportedEntries.map((e) => e.path));
  let supportedEntriesVerified = 0;
  let supportedEntriesFailed = 0;
  let unsupportedEntriesUnchanged = 0;
  let nestedArchivesVerified = 0;

  for (const name of original.fileNames) {
    const originalBytes = await readEntryBytes(original.zip, name);
    const cleanBytes = await readEntryBytes(clean.zip, name);
    if ('blocked' in originalBytes || 'blocked' in cleanBytes) {
      supportedEntriesFailed++;
      continue;
    }
    if (!supportedPaths.has(name)) {
      if (bytesEqual(originalBytes, cleanBytes)) unsupportedEntriesUnchanged++;
      else risk.push(`Неподдерживаемый файл изменился: ${name}`);
      continue;
    }

    const cleanAb = toArrayBuffer(cleanBytes);
    const detected = detectNestedFormat(cleanAb, name);
    if (detected === 'zip') {
      const nestedOriginal = toArrayBuffer(originalBytes);
      const nestedScan = await scanZip(nestedOriginal, 1);
      if ('blocked' in nestedScan) {
        supportedEntriesFailed++;
        continue;
      }
      const nestedVerification = await verifyZip(nestedOriginal, nestedScan.data, cleanAb);
      if (nestedVerification.verificationPassed) {
        supportedEntriesVerified++;
        nestedArchivesVerified++;
      } else {
        supportedEntriesFailed++;
        risk.push(`Вложенный ZIP не прошёл проверку: ${name}`);
      }
      continue;
    }

    const nestedScan = await scanNestedSupported(cleanAb, name, cleanBytes.byteLength);
    if ('blocked' in nestedScan) {
      supportedEntriesFailed++;
      risk.push(`Очищенный вложенный файл не читается: ${name}`);
      continue;
    }
    if (nestedScan.scan.findings.length > 0) {
      supportedEntriesFailed++;
      risk.push(`В очищенном вложенном файле остались поддерживаемые метаданные: ${name}`);
    } else {
      supportedEntriesVerified++;
    }
  }

  const cleanText = await decompressedText(clean.zip, clean.fileNames);
  const leaked = originalScan.rawMetadataValues.filter((v) => v.length >= 4 && cleanText.includes(v));
  if (leaked.length > 0) risk.push('В очищенном архиве остались исходные значения поддерживаемых метаданных.');

  const verificationPassed =
    archiveCommentRemoved &&
    timestampsNormalised &&
    extraFieldsNeutralised &&
    externalAttributesNeutralised &&
    structurePreserved &&
    supportedEntriesFailed === 0 &&
    unsupportedEntriesUnchanged === originalScan.unsupportedEntries.length &&
    leaked.length === 0;

  return {
    archiveCommentRemoved,
    timestampsNormalised,
    extraFieldsNeutralised,
    externalAttributesNeutralised,
    structurePreserved,
    supportedEntriesVerified,
    supportedEntriesFailed,
    unsupportedEntriesUnchanged,
    nestedArchivesVerified,
    verificationPassed,
    remainingUnsupportedMetadataRisk: risk,
  };
}

async function decompressedText(zip: JSZip, names: string[]): Promise<string> {
  let text = '';
  for (const name of names) {
    const bytes = await zip.files[name].async('uint8array');
    text += new TextDecoder('latin1').decode(bytes) + '\n';
  }
  return text;
}

function fail(original: ZipScanData, risk: string[]): ZipVerification {
  return {
    archiveCommentRemoved: false,
    timestampsNormalised: false,
    extraFieldsNeutralised: false,
    externalAttributesNeutralised: false,
    structurePreserved: false,
    supportedEntriesVerified: 0,
    supportedEntriesFailed: original.supportedEntries.length,
    unsupportedEntriesUnchanged: 0,
    nestedArchivesVerified: 0,
    verificationPassed: false,
    remainingUnsupportedMetadataRisk: risk,
  };
}
