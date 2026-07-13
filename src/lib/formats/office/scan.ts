/**
 * Office package scanner (orchestrator).
 *
 * Runs detection/blocking, then inspects the common package property parts
 * (core/app/custom), the format-specific comment/revision metadata, the
 * embedded supported images, and the ZIP container metadata. Inspection only —
 * never mutates the package.
 */

import type JSZip from 'jszip';
import type { MetadataFinding } from '../types';
import { jpegHandler } from '../jpeg';
import { pngHandler } from '../png';
import { webpHandler } from '../webp';
import type { EmbeddedImage, OfficeBlock, OfficeFormat, OfficeScanData } from './types';
import {
  classifyOffice,
  collectEmbeddedImages,
  detectBlockedStructures,
  detectOfficeContainer,
} from './detect';
import { loadPackage, officeBlock, readBytes, readText, type LoadedPackage } from './package';
import { APP_PART, CORE_PART, CUSTOM_PART, mkFinding, readTagText, toArrayBuffer } from './shared';
import { scanDocx, type OfficePartScan } from './docx';
import { scanXlsx } from './xlsx';
import { scanPptx } from './pptx';

const imageHandlers = { jpeg: jpegHandler, png: pngHandler, webp: webpHandler };

/** Scan the common docProps parts. */
async function scanProps(
  zip: JSZip,
): Promise<{ findings: MetadataFinding[]; raw: string[]; hasCore: boolean; hasApp: boolean; hasCustom: boolean }> {
  const findings: MetadataFinding[] = [];
  const raw: string[] = [];

  const core = await readText(zip, CORE_PART);
  const hasCore = core !== null;
  if (core) {
    const fields: Array<[string, string, MetadataFinding['category'], MetadataFinding['severity'], string]> = [
      ['dc:creator', 'Document author', 'office-author', 'high', ''],
      ['cp:lastModifiedBy', 'Last modified by', 'office-author', 'high', ''],
      ['dc:title', 'Document title', 'office-custom', 'medium', ''],
      ['dc:subject', 'Document subject', 'office-custom', 'medium', ''],
      ['cp:keywords', 'Keywords', 'office-custom', 'medium', ''],
      ['dc:description', 'Description', 'office-custom', 'low', ''],
      ['cp:category', 'Category', 'office-custom', 'low', ''],
      ['cp:revision', 'Revision number', 'office-dates', 'low', ''],
      ['dcterms:created', 'Creation date', 'office-dates', 'low', ''],
      ['dcterms:modified', 'Modification date', 'office-dates', 'low', ''],
      ['cp:lastPrinted', 'Last printed date', 'office-dates', 'low', ''],
    ];
    for (const [tag, label, category, severity, desc] of fields) {
      const value = readTagText(core, tag);
      if (value) {
        findings.push(mkFinding(category, `core:${tag}`, label, value, severity, desc));
        raw.push(value);
      }
    }
  }

  const app = await readText(zip, APP_PART);
  const hasApp = app !== null;
  if (app) {
    const fields: Array<[string, string, MetadataFinding['category'], MetadataFinding['severity'], string]> = [
      ['Company', 'Company', 'office-app', 'high', ''],
      ['Manager', 'Manager', 'office-app', 'high', ''],
      ['Application', 'Application', 'office-app', 'medium', ''],
      ['AppVersion', 'Application version', 'office-app', 'low', ''],
      ['Template', 'Template', 'office-app', 'medium', ''],
    ];
    for (const [tag, label, category, severity, desc] of fields) {
      const value = readTagText(app, tag);
      if (value) {
        findings.push(mkFinding(category, `app:${tag}`, label, value, severity, desc));
        raw.push(value);
      }
    }
  }

  const custom = await readText(zip, CUSTOM_PART);
  const hasCustom = custom !== null;
  if (custom) {
    const re = /<property\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/property>/gi;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(custom))) {
      const name = m[1];
      const value = (readTagText(m[2], 'vt:lpwstr') ?? m[2].replace(/<[^>]+>/g, '').trim()) || null;
      count++;
      findings.push(
        mkFinding('office-custom', `custom:${name}`, `Property "${name}"`, value, 'medium', ''),
      );
      if (name) raw.push(name);
      if (value) raw.push(value);
    }
    if (count === 0) {
      findings.push(
        mkFinding('office-custom', 'custom:present', 'Custom properties', 'Present', 'medium', ''),
      );
    }
  }

  return { findings, raw, hasCore, hasApp, hasCustom };
}

/** Scan embedded supported images and summarise their metadata. */
function scanEmbeddedImages(
  images: EmbeddedImage[],
  bytesByPath: Map<string, Uint8Array>,
): { findings: MetadataFinding[]; raw: string[] } {
  const findings: MetadataFinding[] = [];
  const raw: string[] = [];
  let withMeta = 0;
  for (const img of images) {
    const bytes = bytesByPath.get(img.path);
    if (!bytes) continue;
    try {
      const ab = toArrayBuffer(bytes);
      const scan = imageHandlers[img.format].scan(ab);
      const personal = scan.findings.filter(
        (f) => !['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM', 'WebP:ICCP'].includes(f.field),
      );
      if (personal.length > 0) withMeta++;
      for (const f of personal) if (f.value) raw.push(f.value);
    } catch {
      // Unreadable embedded image — leave for the block path / verification.
    }
  }
  if (images.length > 0) {
    findings.push(
      mkFinding('office-embedded-images', 'office:embeddedImages', 'Embedded images with metadata',
        `${withMeta} of ${images.length}`, withMeta > 0 ? 'medium' : 'low', ''),
    );
  }
  return { findings, raw };
}

export async function scanOffice(buffer: ArrayBuffer): Promise<OfficeBlock | { data: OfficeScanData }> {
  const container = detectOfficeContainer(buffer);
  if (container === 'cfb') {
    return officeBlock(
      'encrypted',
      'Документ защищён паролем или зашифрован (формат OLE/CFB). BURAN не может прочитать и безопасно изменить такой файл, поэтому он не был изменён.',
    );
  }
  if (container !== 'zip') {
    return officeBlock(
      'unsupported-package',
      'Файл не является поддерживаемым Office-документом (DOCX/XLSX/PPTX). BURAN не изменил файл.',
    );
  }

  const loaded = await loadPackage(buffer);
  if ('blocked' in loaded) return loaded;

  const format = classifyOffice(loaded.entryNames);
  if (!format) {
    return officeBlock(
      'unsupported-package',
      'Не удалось определить тип Office-документа. Поддерживаются только DOCX, XLSX и PPTX.',
    );
  }

  const structuralBlock = detectBlockedStructures(loaded);
  if (structuralBlock) return structuralBlock;

  return { data: await buildScanData(loaded, format) };
}

async function buildScanData(loaded: LoadedPackage, format: OfficeFormat): Promise<OfficeScanData> {
  const { zip } = loaded;
  const props = await scanProps(zip);

  let formatScan: OfficePartScan;
  if (format === 'docx') formatScan = await scanDocx(zip);
  else if (format === 'xlsx') formatScan = await scanXlsx(zip);
  else formatScan = await scanPptx(zip);

  const images = collectEmbeddedImages(loaded.entryNames);
  const bytesByPath = new Map<string, Uint8Array>();
  for (const img of images) {
    const b = await readBytes(zip, img.path);
    if (b) bytesByPath.set(img.path, b);
  }
  const imageScan = scanEmbeddedImages(images, bytesByPath);

  const findings: MetadataFinding[] = [...props.findings, ...formatScan.findings, ...imageScan.findings];
  findings.push(
    mkFinding('office-container', 'office:zipTimestamps', 'ZIP container timestamps', 'Present', 'low', ''),
  );

  const raw = [...props.raw, ...formatScan.raw, ...imageScan.raw].filter((s) => s && s.trim().length >= 3);

  return {
    format,
    findings,
    rawMetadataValues: raw,
    embeddedImages: images,
    hasCoreProps: props.hasCore,
    hasAppProps: props.hasApp,
    hasCustomProps: props.hasCustom,
    hasComments: formatScan.hasComments,
    hasRevisions: formatScan.hasRevisions,
    entryCount: loaded.entryCount,
    uncompressedSize: loaded.uncompressedSize,
    unsupportedMetadataRisk: [],
  };
}
