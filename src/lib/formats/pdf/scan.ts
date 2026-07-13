/**
 * PDF metadata scanner.
 *
 * Loads the document with pdf-lib and reports every supported metadata surface
 * grouped into human-language categories:
 *   - Info dictionary (Title, Author, Subject, Keywords, Creator, Producer,
 *     dates, and custom keys)
 *   - XMP /Metadata stream (Dublin Core, XMP producer/creator tool, dates,
 *     custom namespaces, author/company-like values)
 *   - Document trailer /ID
 *   - Annotation author/title identity fields (/T, /M, /NM) — never the body text
 *   - PieceInfo / application-private metadata structures
 *
 * This module performs inspection only; it never mutates the document.
 */

import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFString,
  PDFHexString,
  PDFRawStream,
} from 'pdf-lib';
import type { MetadataFinding, MetadataCategory } from '../types';
import type { PdfBlock, PdfDocumentInfo, PdfScanData } from './types';
import { rawSecurityScan, block, MAX_PDF_BYTES, MAX_PDF_PAGES } from './detect';

/** Standard Info dictionary keys (anything else is a custom property). */
const STANDARD_INFO_KEYS = new Set([
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
]);

function mkFinding(
  category: MetadataCategory,
  field: string,
  label: string,
  value: string | null,
  severity: MetadataFinding['severity'],
  description: string,
): MetadataFinding {
  return { category, field, label, value, severity, description };
}

/** Decode a PDF string/hex-string object to readable text, or null. */
function pdfText(obj: unknown): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    try {
      return obj.decodeText();
    } catch {
      return obj.asString();
    }
  }
  if (obj instanceof PDFName) return obj.decodeText();
  return null;
}

/** Best-effort decode of a /Metadata stream's bytes to text. */
function decodeStreamText(stream: PDFRawStream): string {
  try {
    const bytes = stream.getContents();
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Extract human-relevant values from an XMP packet using tolerant regex.
 * We deliberately do not parse the whole RDF graph — we only surface the
 * identifying fields and flag the presence of custom namespaces.
 */
function scanXmp(xmp: string, findings: MetadataFinding[], raw: string[]): void {
  const push = (
    field: string,
    label: string,
    value: string | null,
    severity: MetadataFinding['severity'],
    description: string,
  ) => {
    findings.push(mkFinding('pdf-xmp', field, label, value, severity, description));
    if (value) raw.push(value);
  };

  const grab = (re: RegExp): string | null => {
    const m = xmp.match(re);
    return m ? m[1].replace(/<[^>]+>/g, '').trim() || null : null;
  };

  const dcCreator = grab(/<dc:creator>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i) ??
    grab(/<dc:creator>([\s\S]*?)<\/dc:creator>/i);
  if (dcCreator) {
    push('XMP:dc:creator', 'XMP author (Dublin Core)', dcCreator, 'high', '');
  }

  const dcTitle = grab(/<dc:title>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i) ??
    grab(/<dc:title>([\s\S]*?)<\/dc:title>/i);
  if (dcTitle) {
    push('XMP:dc:title', 'XMP title', dcTitle, 'medium', '');
  }

  const dcDesc = grab(/<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i) ??
    grab(/<dc:description>([\s\S]*?)<\/dc:description>/i);
  if (dcDesc) {
    push('XMP:dc:description', 'XMP description', dcDesc, 'medium', '');
  }

  const dcRights = grab(/<dc:rights>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i) ??
    grab(/<dc:rights>([\s\S]*?)<\/dc:rights>/i);
  if (dcRights) {
    push('XMP:dc:rights', 'XMP rights (copyright)', dcRights, 'medium', '');
  }

  const creatorTool = grab(/<xmp:CreatorTool>([\s\S]*?)<\/xmp:CreatorTool>/i) ??
    grab(/xmp:CreatorTool="([^"]*)"/i);
  if (creatorTool) {
    push('XMP:xmp:CreatorTool', 'XMP creator tool', creatorTool, 'medium', '');
  }

  const producer = grab(/<pdf:Producer>([\s\S]*?)<\/pdf:Producer>/i) ??
    grab(/pdf:Producer="([^"]*)"/i);
  if (producer) {
    push('XMP:pdf:Producer', 'XMP PDF producer', producer, 'low', '');
  }

  for (const [field, label, re] of [
    ['XMP:xmp:CreateDate', 'XMP create date', /<xmp:CreateDate>([\s\S]*?)<\/xmp:CreateDate>/i],
    ['XMP:xmp:ModifyDate', 'XMP modify date', /<xmp:ModifyDate>([\s\S]*?)<\/xmp:ModifyDate>/i],
    ['XMP:xmp:MetadataDate', 'XMP metadata date', /<xmp:MetadataDate>([\s\S]*?)<\/xmp:MetadataDate>/i],
  ] as const) {
    const v = grab(re as RegExp);
    if (v) push(field, label, v, 'low', 'Дата из XMP. Может раскрыть историю работы с документом.');
  }

  // Company-like fields (e.g. photoshop:AuthorsPosition, xmpMM, custom).
  const company = grab(/<[\w]+:Company>([\s\S]*?)<\/[\w]+:Company>/i);
  if (company) {
    push('XMP:Company', 'XMP company', company, 'high',
      'Название организации в XMP. Может раскрыть вашего работодателя или клиента.');
  }

  // Document/instance IDs in XMP MM namespace.
  const docId = grab(/<xmpMM:DocumentID>([\s\S]*?)<\/xmpMM:DocumentID>/i);
  if (docId) {
    push('XMP:xmpMM:DocumentID', 'XMP document ID', docId, 'low',
      'Постоянный идентификатор документа в XMP. Может связать версии файла между собой.');
  }

  // Detect custom (non-standard) namespaces beyond the well-known ones.
  const knownNs = new Set([
    'dc', 'xmp', 'pdf', 'xmpMM', 'rdf', 'x', 'xml', 'xmpTPg', 'stEvt', 'stRef', 'photoshop',
  ]);
  const nsMatches = xmp.matchAll(/<(\w+):[\w-]+/g);
  const customNs = new Set<string>();
  for (const m of nsMatches) {
    if (!knownNs.has(m[1])) customNs.add(m[1]);
  }
  if (customNs.size > 0) {
    findings.push(
      mkFinding('pdf-xmp', 'XMP:custom-namespaces', 'XMP custom namespaces',
        Array.from(customNs).join(', '), 'medium',
        'Нестандартные XMP-поля. Могут содержать произвольные сведения о вас или организации.'),
    );
  }
}

function readDocumentInfo(doc: PDFDocument): PdfDocumentInfo {
  const pages = doc.getPages();
  const pageGeometry = pages.map((p) => {
    const { width, height } = p.getSize();
    return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
  });
  let hasAnnotations = false;
  for (const p of pages) {
    const annots = p.node.Annots();
    if (annots && annots.size() > 0) {
      hasAnnotations = true;
      break;
    }
  }
  const hasOutlines = doc.catalog.has(PDFName.of('Outlines'));
  const hasAcroForm = doc.catalog.has(PDFName.of('AcroForm'));
  return {
    pageCount: pages.length,
    pageGeometry,
    hasAnnotations,
    hasOutlines,
    hasAcroForm,
  };
}

/**
 * Scan a PDF buffer. Returns either a {@link PdfBlock} (do not sanitise) or the
 * full {@link PdfScanData} for a supported document.
 */
export async function scanPdf(buffer: ArrayBuffer): Promise<PdfBlock | { data: PdfScanData }> {
  if (buffer.byteLength > MAX_PDF_BYTES) {
    return block('too-large');
  }

  // Conservative raw structural gating before any structured parse.
  const securityBlock = rawSecurityScan(buffer);
  if (securityBlock) return securityBlock;

  let doc: PDFDocument;
  try {
    // Do not pass ignoreEncryption — an encrypted doc must throw and be blocked.
    doc = await PDFDocument.load(buffer, { updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg)) return block('encrypted');
    return block('malformed');
  }

  if (doc.getPageCount() > MAX_PDF_PAGES) {
    return block('too-many-pages');
  }

  const findings: MetadataFinding[] = [];
  const raw: string[] = [];
  const unsupportedMetadataRisk: string[] = [];

  // --- Info dictionary ---
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookupMaybe(infoRef, PDFDict) : undefined;
  if (info) {
    for (const [keyName, valObj] of info.entries()) {
      const key = keyName.decodeText();
      const value = pdfText(valObj);
      if (key === 'Trapped') continue; // not personal
      if (STANDARD_INFO_KEYS.has(key)) {
        const meta = INFO_KEY_META[key];
        if (meta) {
          findings.push(mkFinding(meta.category, `Info:${key}`, meta.label, value, meta.severity, meta.description));
          if (value) raw.push(value);
        }
      } else {
        // Custom Info dictionary property.
        findings.push(
          mkFinding('pdf-custom', `Info:${key}`, `Property "${key}"`, value, 'medium', ''),
        );
        if (value) raw.push(value);
        if (key) raw.push(key);
      }
    }
  }

  // --- XMP metadata stream ---
  const metaRef = doc.catalog.get(PDFName.of('Metadata'));
  const metaObj = metaRef ? doc.context.lookup(metaRef) : undefined;
  const metaStream = metaObj instanceof PDFRawStream ? metaObj : undefined;
  if (metaStream) {
    const xmp = decodeStreamText(metaStream);
    if (xmp && /<\?xpacket|xmpmeta|rdf:RDF/i.test(xmp)) {
      scanXmp(xmp, findings, raw);
      // If we found an XMP packet but extracted no fields, still record presence.
      if (!findings.some((f) => f.category === 'pdf-xmp')) {
        findings.push(
          mkFinding('pdf-xmp', 'XMP:present', 'XMP metadata', 'Present', 'medium', ''),
        );
      }
    }
  }

  // --- Document trailer /ID ---
  if (doc.context.trailerInfo.ID) {
    findings.push(
      mkFinding('pdf-identifiers', 'Trailer:ID', 'Document identifier (trailer /ID)', 'Present', 'low', ''),
    );
  }

  // --- PieceInfo / application-private metadata ---
  if (doc.catalog.has(PDFName.of('PieceInfo'))) {
    findings.push(
      mkFinding('pdf-custom', 'PieceInfo', 'Private application data (PieceInfo)', 'Present', 'medium', ''),
    );
  }

  // --- Annotation author/title identity fields ---
  let annotAuthorCount = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookupMaybe(i, PDFDict);
      if (!a) continue;
      const t = a.get(PDFName.of('T'));
      const author = pdfText(t);
      if (author) {
        annotAuthorCount++;
        raw.push(author);
      }
    }
  }
  if (annotAuthorCount > 0) {
    findings.push(
      mkFinding('pdf-annotations', 'Annot:T', 'Comment authors', `${annotAuthorCount}`, 'high', ''),
    );
  }

  return {
    data: {
      findings,
      info: readDocumentInfo(doc),
      rawMetadataValues: raw.filter((s) => s && s.trim().length >= 2),
      unsupportedMetadataRisk,
    },
  };
}

/** Per-key presentation metadata for standard Info dictionary entries. */
const INFO_KEY_META: Record<
  string,
  { category: MetadataCategory; label: string; severity: MetadataFinding['severity']; description: string }
> = {
  Title: {
    category: 'pdf-title',
    label: 'Document title',
    severity: 'medium',
    description: '',
  },
  Author: {
    category: 'pdf-author',
    label: 'Document author',
    severity: 'high',
    description: '',
  },
  Subject: {
    category: 'pdf-title',
    label: 'Document subject',
    severity: 'medium',
    description: '',
  },
  Keywords: {
    category: 'pdf-title',
    label: 'Keywords',
    severity: 'medium',
    description: '',
  },
  Creator: {
    category: 'pdf-software',
    label: 'Creator application',
    severity: 'medium',
    description: '',
  },
  Producer: {
    category: 'pdf-software',
    label: 'PDF producer',
    severity: 'low',
    description: '',
  },
  CreationDate: {
    category: 'pdf-dates',
    label: 'Creation date',
    severity: 'low',
    description: '',
  },
  ModDate: {
    category: 'pdf-dates',
    label: 'Modification date',
    severity: 'low',
    description: '',
  },
};
