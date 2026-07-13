import type { MetadataFinding, ScanResult, VerificationResult } from './formats/types';
import type { Strings } from '../i18n';

export type SupportState = 'supported' | 'partially-supported' | 'blocked';

export interface TrustSection {
  title: string;
  items: string[];
}

export interface TrustResultModel {
  fileType: string;
  fileSize: string;
  supportState: SupportState;
  summaryTitle: string;
  summaryText: string;
  found: TrustSection;
  removed: TrustSection;
  preserved: TrustSection;
  verified: TrustSection;
  concreteFindings: ConcreteFindingGroup[];
  technicalDetails: MetadataFinding[];
  limitations: string[];
}

/** A localized group of concrete metadata values actually present in the file. */
export interface ConcreteFindingGroup {
  label: string;
  severity: 'low' | 'medium' | 'high';
  values: string[];
}

const TECHNICAL_COLOUR_FIELDS = new Set(['PNG:iCCP', 'PNG:sRGB', 'PNG:gAMA', 'PNG:cHRM', 'WebP:ICCP']);

export function personalFindings(scan: ScanResult): MetadataFinding[] {
  return scan.findings.filter((f) => !TECHNICAL_COLOUR_FIELDS.has(f.field));
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

export function formatLabel(format: ScanResult['format']): string {
  if (format === 'jpeg') return 'JPEG';
  if (format === 'png') return 'PNG';
  if (format === 'webp') return 'WebP';
  if (format === 'heic') return 'HEIC / HEIF';
  return format.toUpperCase();
}

export function buildTrustResult(scan: ScanResult, t: Strings): TrustResultModel {
  const personal = personalFindings(scan);
  const supportState: SupportState = scan.format === 'zip' && (scan.zip?.unsupportedEntries.length ?? 0) > 0
    ? 'partially-supported'
    : 'supported';
  const whatFound = foundItems(scan, personal, t);

  return {
    fileType: formatLabel(scan.format),
    fileSize: formatFileSize(scan.fileSize),
    supportState,
    summaryTitle: personal.length > 0
      ? `${t.trustSummaryFoundPrefix} ${personal.length} ${traceWord(personal.length, t)} ${t.trustSummaryFoundSuffix}`
      : t.trustSummaryNoneFound,
    summaryText: personal.length > 0
      ? summaryRiskText(scan, t)
      : t.trustSummaryRescan,
    found: { title: t.trustFoundTitle, items: whatFound },
    removed: { title: t.trustRemovedTitle, items: removalItems(scan, t) },
    preserved: { title: t.trustPreservedTitle, items: preservedItems(scan, t) },
    verified: { title: t.trustVerifiedTitle, items: verificationItems(scan, t) },
    concreteFindings: concreteFindings(scan, t),
    technicalDetails: scan.findings,
    limitations: limitationItems(scan, t),
  };
}

const SEVERITY_RANK: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 };

/** Placeholder markers emitted by scanners when no concrete value exists. */
function isMeaningfulValue(value: string | null): value is string {
  if (!value) return false;
  const v = value.trim();
  if (v === '') return false;
  if (v.startsWith('[')) return false; // e.g. "[12 bytes]", "[data]", "[3 values]"
  if (v === 'Present' || v === 'Присутствует') return false; // "present" marker, not a value
  return true;
}

/** Localized, human-readable label for a finding, derived from its category. */
function concreteFindingLabel(finding: MetadataFinding, t: Strings): string {
  const c = finding.category;
  if (c.includes('geolocation')) return t.trustCatHumanGps;
  if (c.includes('author')) return t.trustCatHumanAuthor;
  if (c.includes('dates')) return t.trustCatHumanDates;
  if (c.includes('software') || c.includes('app')) return t.trustCatHumanApp;
  if (c.includes('device')) return t.trustCatHumanDevice;
  if (c.includes('title')) return t.scanCatTitle;
  if (c.includes('identifier')) return t.scanCatIdentifier;
  if (c.includes('custom')) return t.scanCatCustom;
  if (c.includes('thumbnail')) return t.scanCatThumbnail;
  if (c.includes('container') || c.includes('xmp')) return t.trustCatHumanContainers;
  if (finding.field.toLowerCase().includes('comment')) return t.scanCatComment;
  return t.scanCatOther;
}

/**
 * Concrete metadata values actually embedded in the file (the real GPS
 * coordinates, author name, dates, device, …), grouped by a localized label so
 * the user sees exactly what BURAN found — not just category names.
 */
export function concreteFindings(scan: ScanResult, t: Strings): ConcreteFindingGroup[] {
  const groups = new Map<string, ConcreteFindingGroup>();
  for (const finding of personalFindings(scan)) {
    if (finding.severity === 'low') continue;
    if (finding.field === 'EXIF:Orientation') continue; // service rotation tag, not personal
    if (finding.category.includes('container')) continue; // IFD pointers / "present" markers, not concrete data
    if (!isMeaningfulValue(finding.value)) continue;

    const label = concreteFindingLabel(finding, t);
    const value = finding.value.length > 180 ? finding.value.slice(0, 180) + '…' : finding.value;
    const existing = groups.get(label);
    if (existing) {
      if (!existing.values.includes(value)) existing.values.push(value);
      if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) existing.severity = finding.severity;
    } else {
      groups.set(label, { label, severity: finding.severity, values: [value] });
    }
  }
  return Array.from(groups.values());
}

export function buildSuccessBeforeAfter(scan: ScanResult, verification: VerificationResult, t: Strings): { before: string[]; after: string[] } {
  const found = verification.metadataFoundBefore || personalFindings(scan).length;
  if (scan.format === 'zip' && scan.zip) {
    return {
      before: [`${scan.zip.totalFiles} ${t.trustBaFilesWord}`, `${found} ${t.trustBaMetadataTrace}`],
      after: [
        `${verification.zip?.supportedEntriesVerified ?? scan.zip.supportedEntries.length} ${t.trustBaZipCleaned}`,
        `${verification.zip?.unsupportedEntriesUnchanged ?? scan.zip.unsupportedEntries.length} ${t.trustBaZipUnchanged}`,
      ],
    };
  }
  return {
    before: [
      `${found} ${t.trustBaPersonalTraces}`,
      compactCategories(scan, t).join(' · ') || t.trustBaSupportedMetadata,
    ],
    after: [
      `${verification.metadataRemaining} ${t.trustBaRemainingTraces}`,
      preservedSuccessLine(scan, verification, t),
    ].filter(Boolean),
  };
}

export function successLimitations(scan: ScanResult, verification: VerificationResult, t: Strings): string[] {
  const items = [
    t.trustLimitVisible,
    t.trustLimitWatermark,
  ];
  if (scan.format === 'zip' && (scan.zip?.unsupportedEntries.length ?? 0) > 0) {
    items.push(t.trustLimitZipUnsupported);
  }
  if (verification.limitations.length > 0) items.push(...verification.limitations);
  return Array.from(new Set(items));
}

function traceWord(count: number, t: Strings): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return t.trustTraceWord1;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t.trustTraceWord2;
  return t.trustTraceWord5;
}

function categoryKeys(scan: ScanResult): string[] {
  const labels = new Set<string>();
  for (const f of personalFindings(scan)) {
    if (f.category.includes('author')) labels.add('author');
    else if (f.category.includes('dates')) labels.add('dates');
    else if (f.category.includes('software') || f.category.includes('app')) labels.add('app');
    else if (f.category.includes('geolocation')) labels.add('gps');
    else if (f.category.includes('device')) labels.add('device');
    else if (f.category.includes('container') || f.category.includes('xmp')) labels.add('containers');
  }
  return Array.from(labels).slice(0, 5);
}

function compactCategories(scan: ScanResult, t: Strings): string[] {
  return categoryKeys(scan).map((label) => compactCategoryLabel(label, t));
}

function compactCategoryLabel(label: string, t: Strings): string {
  const map: Record<string, string> = {
    author: t.trustCatAuthor,
    dates: t.trustCatDates,
    app: t.trustCatApp,
    gps: t.trustCatGps,
    device: t.trustCatDevice,
    containers: t.trustCatContainers,
  };
  return map[label] ?? label;
}

function summaryRiskText(scan: ScanResult, t: Strings): string {
  if (scan.format === 'zip') return t.trustRiskZip;
  if (scan.format === 'heic') return t.trustRiskHeic;
  if (scan.format === 'pdf') return t.trustRiskPdf;
  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') return t.trustRiskOffice;
  return t.trustRiskImage;
}

function foundItems(scan: ScanResult, personal: MetadataFinding[], t: Strings): string[] {
  if (scan.format === 'zip' && scan.zip) {
    const items = [
      `${t.trustFoundZipArchiveMeta} ${scan.zip.containerMetadata.entryTimestamps} ${t.trustFoundZipTimestamps}${scan.zip.containerMetadata.archiveCommentFound ? t.trustFoundZipCommentFound : ''}`,
      `${t.trustFoundZipSupported} ${scan.zip.supportedEntries.length}`,
    ];
    if (scan.zip.unsupportedEntries.length > 0) items.push(`${t.trustFoundZipUnsupported} ${scan.zip.unsupportedEntries.length}`);
    if (scan.zip.nestedArchiveCount > 0) items.push(`${t.trustFoundZipNested} ${scan.zip.nestedArchiveCount}`);
    return items;
  }
  if (scan.format === 'heic' && scan.heic) {
    const items = [t.trustFoundHeicSupported];
    if (scan.heic.metadataContainers.length > 0) items.push(`${t.trustFoundHeicContainers} ${scan.heic.metadataContainers.join(', ')}`);
    items.push(`${t.trustFoundHeicExportPrefix} ${scan.heic.outputFormat === 'png' ? 'PNG' : 'JPEG'}${t.trustFoundHeicExportSuffix}`);
    return items;
  }
  if (personal.length === 0) return [t.trustFoundNoPersonal];
  return categoryHumanItems(scan, t);
}

function categoryHumanItems(scan: ScanResult, t: Strings): string[] {
  const map: Record<string, string> = {
    gps: t.trustCatHumanGps,
    device: t.trustCatHumanDevice,
    author: t.trustCatHumanAuthor,
    dates: t.trustCatHumanDates,
    app: t.trustCatHumanApp,
    containers: t.trustCatHumanContainers,
  };
  return categoryKeys(scan).map((label) => map[label] ?? label);
}

function removalItems(scan: ScanResult, t: Strings): string[] {
  if (scan.format === 'zip') return [t.trustRemoveZip1, t.trustRemoveZip2, t.trustRemoveZip3];
  if (scan.format === 'heic') return [t.trustRemoveHeic1, t.trustRemoveHeic2, t.trustRemoveHeic3];
  if (scan.format === 'pdf') return [t.trustRemovePdf1, t.trustRemovePdf2, t.trustRemovePdf3];
  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') return [t.trustRemoveOffice1, t.trustRemoveOffice2, t.trustRemoveOffice3, t.trustRemoveOffice4];
  return [t.trustRemoveImage1, t.trustRemoveImage2, t.trustRemoveImage3];
}

function preservedItems(scan: ScanResult, t: Strings): string[] {
  if (scan.format === 'zip') return [t.trustPreserveZip1, t.trustPreserveZip2, t.trustPreserveZip3];
  if (scan.format === 'heic') return [t.trustPreserveHeic1, t.trustPreserveHeic2, t.trustPreserveHeic3];
  if (scan.format === 'pdf') return [t.trustPreservePdf1, t.trustPreservePdf2];
  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') return [t.trustPreserveOffice1, t.trustPreserveOffice2];
  const items = [t.trustPreserveImage1, t.trustPreserveImage2, t.trustPreserveImage3];
  if (scan.preservedInfo.hasTransparency) items.push(t.trustPreserveImageTransparency);
  items.push(t.trustPreserveImageOrientation);
  return items;
}

function verificationItems(scan: ScanResult, t: Strings): string[] {
  if (scan.format === 'zip') return [t.trustVerifyZip1, t.trustVerifyZip2, t.trustVerifyZip3, t.trustVerifyZip4];
  if (scan.format === 'heic') return [t.trustVerifyHeic1, t.trustVerifyHeic2, t.trustVerifyHeic3];
  if (scan.format === 'pdf') return [t.trustVerifyPdf1, t.trustVerifyPdf2, t.trustVerifyPdf3];
  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') return [t.trustVerifyOffice1, t.trustVerifyOffice2, t.trustVerifyOffice3, t.trustVerifyOffice4];
  return [t.trustVerifyImage1, t.trustVerifyImage2, t.trustVerifyImage3];
}

function limitationItems(scan: ScanResult, t: Strings): string[] {
  const items = [t.trustLimitItemBase];
  if (scan.format === 'zip' && (scan.zip?.unsupportedEntries.length ?? 0) > 0) items.push(t.trustLimitItemZip);
  if (scan.format === 'heic') items.push(t.trustLimitItemHeic);
  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') items.push(t.trustLimitItemOffice);
  return items;
}

function preservedSuccessLine(scan: ScanResult, verification: VerificationResult, t: Strings): string {
  if (verification.orientationApplied) return t.trustPreservedLineOrientation;
  if (scan.format === 'heic') return `${verification.heic?.exportedFormat === 'png' ? 'PNG' : 'JPEG'} ${t.trustPreservedLineHeicVerified}`;
  if (scan.preservedInfo.iccDescription) return t.trustPreservedLineIcc;
  if (scan.format === 'pdf') return t.trustPreservedLinePdf;
  if (scan.format === 'docx' || scan.format === 'xlsx' || scan.format === 'pptx') return t.trustPreservedLineOffice;
  return t.trustPreservedLineTechnical;
}
