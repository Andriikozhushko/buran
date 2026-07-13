/**
 * PPTX-specific metadata scanning and sanitisation.
 *
 * Anonymises ordinary PowerPoint comment author names/initials and removes
 * comment timestamps, while preserving comment text, author/comment references
 * (ids), slides, notes, layouts, images, charts, animations, and links.
 *
 * Embedded objects, custom XML, unsupported media, signatures, and encryption
 * are blocked upstream in detect.ts.
 */

import type JSZip from 'jszip';
import type { MetadataFinding } from '../types';
import { ANON_AUTHOR, ANON_INITIALS } from './types';
import { mkFinding, removeAttr, replaceAttrValue, xmlDecode } from './shared';
import { readText } from './package';
import type { OfficePartScan } from './docx';

const AUTHORS_PART = 'ppt/commentAuthors.xml';

function commentParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((n) => /^ppt\/comments\/.*\.xml$/i.test(n));
}

function collectAttr(xml: string, attr: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${attr}="([^"]*)"`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(xmlDecode(m[1]));
  return out;
}

export async function scanPptx(zip: JSZip): Promise<OfficePartScan> {
  const findings: MetadataFinding[] = [];
  const raw: string[] = [];
  let hasComments = false;

  const authorsXml = await readText(zip, AUTHORS_PART);
  if (authorsXml) {
    const names = [...new Set(collectAttr(authorsXml, 'name'))].filter(Boolean);
    const initials = [...new Set(collectAttr(authorsXml, 'initials'))].filter(Boolean);
    if (names.length) {
      hasComments = true;
      for (const n of names) raw.push(n);
      findings.push(
        mkFinding('office-comment-authors', 'pptx:commentAuthor', 'Comment authors',
          names.join(', '), 'high', ''),
      );
    }
    for (const i of initials) raw.push(i);
  }

  // Comment timestamps.
  const dts = new Set<string>();
  for (const part of commentParts(zip)) {
    const xml = await readText(zip, part);
    if (!xml) continue;
    for (const dt of collectAttr(xml, 'dt')) dts.add(dt);
  }
  for (const dt of dts) raw.push(dt);

  return { findings, raw, hasComments, hasRevisions: false };
}

/**
 * Anonymise comment author names/initials and remove comment timestamps.
 * Author ids and comment references are preserved so PowerPoint still opens
 * the file with working comments.
 */
export async function sanitizePptx(zip: JSZip): Promise<Map<string, string>> {
  const replace = new Map<string, string>();

  const authorsXml = await readText(zip, AUTHORS_PART);
  if (authorsXml) {
    let out = replaceAttrValue(authorsXml, 'name', ANON_AUTHOR);
    out = replaceAttrValue(out, 'initials', ANON_INITIALS);
    if (out !== authorsXml) replace.set(AUTHORS_PART, out);
  }

  for (const part of commentParts(zip)) {
    const xml = await readText(zip, part);
    if (!xml) continue;
    const out = removeAttr(xml, 'dt');
    if (out !== xml) replace.set(part, out);
  }

  return replace;
}
