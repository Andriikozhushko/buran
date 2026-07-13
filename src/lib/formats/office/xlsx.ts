/**
 * XLSX-specific metadata scanning and sanitisation.
 *
 * Anonymises ordinary (legacy) cell comments/notes by collapsing the author
 * list to a single neutral author and remapping every `authorId` to it, while
 * preserving comment text, positioning, formulas, values, sheets, and layout.
 *
 * Threaded comments / Persons metadata, custom XML, and embedded objects are
 * blocked upstream in detect.ts.
 */

import type JSZip from 'jszip';
import type { MetadataFinding } from '../types';
import { ANON_AUTHOR } from './types';
import { mkFinding, xmlDecode } from './shared';
import { readText } from './package';
import type { OfficePartScan } from './docx';

function commentParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((n) => /^xl\/comments\d*\.xml$/i.test(n));
}

function collectAuthors(xml: string): string[] {
  const block = xml.match(/<authors>([\s\S]*?)<\/authors>/i);
  if (!block) return [];
  const out: string[] = [];
  const re = /<author>([\s\S]*?)<\/author>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) out.push(xmlDecode(m[1].trim()));
  return out;
}

export async function scanXlsx(zip: JSZip): Promise<OfficePartScan> {
  const findings: MetadataFinding[] = [];
  const raw: string[] = [];
  let hasComments = false;

  const authors = new Set<string>();
  for (const part of commentParts(zip)) {
    const xml = await readText(zip, part);
    if (!xml) continue;
    for (const a of collectAuthors(xml)) {
      if (a) authors.add(a);
    }
  }
  if (authors.size > 0) {
    hasComments = true;
    for (const a of authors) raw.push(a);
    findings.push(
      mkFinding('office-comment-authors', 'xlsx:commentAuthor', 'Comment authors',
        [...authors].join(', '), 'high', ''),
    );
  }

  return { findings, raw, hasComments, hasRevisions: false };
}

/**
 * Collapse the author list to a single neutral author and remap all
 * `authorId` references to it. Comment text and positions are preserved.
 */
export async function sanitizeXlsx(zip: JSZip): Promise<Map<string, string>> {
  const replace = new Map<string, string>();
  for (const part of commentParts(zip)) {
    const xml = await readText(zip, part);
    if (!xml) continue;
    let out = xml;
    // Single neutral author.
    out = out.replace(
      /<authors>[\s\S]*?<\/authors>/i,
      `<authors><author>${ANON_AUTHOR}</author></authors>`,
    );
    // Every comment now references the single author at index 0.
    out = out.replace(/\bauthorId="[^"]*"/gi, 'authorId="0"');
    if (out !== xml) replace.set(part, out);
  }
  return replace;
}
