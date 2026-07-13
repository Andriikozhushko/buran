/**
 * DOCX-specific metadata scanning and sanitisation.
 *
 * Anonymises standard Word comments and strips tracked-change / revision
 * identity and session metadata, while preserving comment bodies, tracked
 * content, and document structure.
 *
 * Threaded comments / People metadata, custom XML, and embedded objects are
 * blocked upstream in detect.ts — this module only runs on safe packages.
 */

import type JSZip from 'jszip';
import type { MetadataFinding } from '../types';
import { ANON_AUTHOR } from './types';
import { mkFinding, removeAttr, removeElement, replaceAttrValue, xmlDecode } from './shared';
import { readText } from './package';

export interface OfficePartScan {
  findings: MetadataFinding[];
  raw: string[];
  hasComments: boolean;
  hasRevisions: boolean;
}

/** Collect every value of `attr="..."` in an XML string. */
function collectAttr(xml: string, attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${attr}="([^"]*)"`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(xmlDecode(m[1]));
  return out;
}

/** Word XML parts that may carry comment/revision identity metadata. */
function wordXmlParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter(
    (n) => /^word\/.*\.xml$/i.test(n) && !/\.rels$/i.test(n),
  );
}

export async function scanDocx(zip: JSZip): Promise<OfficePartScan> {
  const findings: MetadataFinding[] = [];
  const raw: string[] = [];
  let hasComments = false;
  let hasRevisions = false;

  // Standard comments.
  const comments = await readText(zip, 'word/comments.xml');
  if (comments) {
    const authors = [...new Set(collectAttr(comments, 'w:author'))];
    const initials = [...new Set(collectAttr(comments, 'w:initials'))];
    const dates = [...new Set(collectAttr(comments, 'w:date'))];
    if (authors.length) {
      hasComments = true;
      for (const a of authors) raw.push(a);
      findings.push(
        mkFinding('office-comment-authors', 'docx:commentAuthor', 'Comment author',
          authors.join(', '), 'high', ''),
      );
    }
    for (const i of initials) raw.push(i);
    for (const d of dates) raw.push(d);
  }

  // Tracked changes / revision identity across Word parts.
  const revAuthors = new Set<string>();
  const revDates = new Set<string>();
  let rsidCount = 0;
  for (const part of wordXmlParts(zip)) {
    if (part === 'word/comments.xml') continue;
    const xml = await readText(zip, part);
    if (!xml) continue;
    for (const a of collectAttr(xml, 'w:author')) revAuthors.add(a);
    for (const d of collectAttr(xml, 'w:date')) revDates.add(d);
    rsidCount += (xml.match(/\bw:rsid\w*="[^"]*"/gi) || []).length;
    rsidCount += (xml.match(/<w:rsids>/i) || []).length;
  }
  if (revAuthors.size > 0) {
    hasRevisions = true;
    for (const a of revAuthors) raw.push(a);
    findings.push(
      mkFinding('office-revisions', 'docx:revisionAuthor', 'Revision author (tracked changes)',
        [...revAuthors].join(', '), 'high', ''),
    );
  }
  for (const d of revDates) raw.push(d);
  if (rsidCount > 0) {
    hasRevisions = true;
    findings.push(
      mkFinding('office-revisions', 'docx:rsid', 'Edit session IDs (rsid)',
        `${rsidCount}`, 'medium', ''),
    );
  }

  return { findings, raw, hasComments, hasRevisions };
}

/**
 * Anonymise/strip identity metadata in every Word XML part. Comment bodies and
 * tracked-change content are untouched (only attributes are modified, and the
 * `<w:rsids>` session-history element is removed).
 */
export async function sanitizeDocx(zip: JSZip): Promise<Map<string, string>> {
  const replace = new Map<string, string>();
  for (const part of wordXmlParts(zip)) {
    const xml = await readText(zip, part);
    if (!xml) continue;
    let out = xml;
    // Anonymise the required author attribute; remove optional identity/date ones.
    out = replaceAttrValue(out, 'w:author', ANON_AUTHOR);
    out = removeAttr(out, 'w:initials');
    out = removeAttr(out, 'w:date');
    out = removeAttr(out, 'w:dateUtc');
    // Remove revision session identifiers.
    out = removeAttr(out, 'w:rsid');
    out = removeAttr(out, 'w:rsidR');
    out = removeAttr(out, 'w:rsidRPr');
    out = removeAttr(out, 'w:rsidP');
    out = removeAttr(out, 'w:rsidRDefault');
    out = removeAttr(out, 'w:rsidTr');
    out = removeAttr(out, 'w:rsidDel');
    out = removeAttr(out, 'w:rsidSect');
    out = removeElement(out, 'w:rsids');
    if (out !== xml) replace.set(part, out);
  }
  return replace;
}
