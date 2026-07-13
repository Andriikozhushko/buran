/**
 * Shared OOXML helpers: package-part constants, targeted XML mutation, and
 * finding builders.
 *
 * BURAN edits the metadata XML parts with surgical string operations rather
 * than a full parse/re-serialise. This keeps the rest of each part byte-for-byte
 * intact, avoiding any risk of altering document content or breaking OOXML
 * through re-serialisation differences.
 */

import type { MetadataCategory, MetadataFinding } from '../types';

/** Package-level property parts removed entirely by sanitisation. */
export const CORE_PART = 'docProps/core.xml';
export const APP_PART = 'docProps/app.xml';
export const CUSTOM_PART = 'docProps/custom.xml';

/** Copy a Uint8Array into a fresh, plain ArrayBuffer (never SharedArrayBuffer). */
export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

export function mkFinding(
  category: MetadataCategory,
  field: string,
  label: string,
  value: string | null,
  severity: MetadataFinding['severity'],
  description: string,
): MetadataFinding {
  return { category, field, label, value, severity, description };
}

/** Decode the handful of XML entities that appear in metadata text values. */
export function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Escape a string for safe insertion into an XML attribute/text value. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Read the text content of the first `<tag>...</tag>` (namespace-agnostic). */
export function readTagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${escapeRe(tag)}[^>]*>([\\s\\S]*?)</${escapeRe(tag)}>`, 'i');
  const m = xml.match(re);
  return m ? xmlDecode(m[1].trim()) : null;
}

/** Read an attribute value from the first element that carries it. */
export function readAttr(xml: string, attr: string): string | null {
  const m = xml.match(new RegExp(`\\b${escapeRe(attr)}="([^"]*)"`, 'i'));
  return m ? xmlDecode(m[1]) : null;
}

/** Remove every occurrence of a given attribute (`attr="..."`). */
export function removeAttr(xml: string, attr: string): string {
  return xml.replace(new RegExp(`\\s+${escapeRe(attr)}="[^"]*"`, 'gi'), '');
}

/** Set every occurrence of an attribute to a fixed value. */
export function replaceAttrValue(xml: string, attr: string, value: string): string {
  return xml.replace(
    new RegExp(`(\\b${escapeRe(attr)}=")[^"]*(")`, 'gi'),
    `$1${value}$2`,
  );
}

/** Remove every `<tag ...>...</tag>` block and self-closing `<tag .../>`. */
export function removeElement(xml: string, tag: string): string {
  const t = escapeRe(tag);
  return xml
    .replace(new RegExp(`<${t}(\\s[^>]*)?>[\\s\\S]*?</${t}>`, 'gi'), '')
    .replace(new RegExp(`<${t}(\\s[^>]*)?/>`, 'gi'), '');
}

/** Remove a `<Override PartName="/path" .../>` entry from [Content_Types].xml. */
export function removeContentTypeOverride(contentTypes: string, partName: string): string {
  const path = partName.startsWith('/') ? partName : `/${partName}`;
  return contentTypes.replace(
    new RegExp(`<Override\\s+PartName="${escapeRe(path)}"[^>]*/>\\s*`, 'gi'),
    '',
  );
}

/** Remove `<Relationship ... Target="...target..." .../>` entries by target. */
export function removeRelationshipsByTarget(rels: string, targets: string[]): string {
  let out = rels;
  for (const target of targets) {
    out = out.replace(
      new RegExp(`<Relationship\\b[^>]*\\bTarget="[^"]*${escapeRe(target)}"[^>]*/>\\s*`, 'gi'),
      '',
    );
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
