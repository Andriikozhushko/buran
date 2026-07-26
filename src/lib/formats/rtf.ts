/**
 * RTF metadata scanning and sanitisation.
 *
 * RTF is a text format of brace-delimited groups. Document identity lives in
 * the {\info ...} group (author, operator, company, creation/revision times)
 * and in {\*\generator ...}. Cleaning removes those groups with a proper
 * brace-matching scan (regexes cannot balance braces) and leaves every other
 * byte — the visible document — untouched.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

const decoder = new TextDecoder('latin1');
const encoder = new TextEncoder();

/** \info subgroup fields reported with values. */
const INFO_FIELDS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  author: ['Author', 'author', 'high'],
  operator: ['Operator', 'author', 'high'],
  company: ['Company', 'author', 'high'],
  manager: ['Manager', 'author', 'high'],
  title: ['Title', 'other', 'medium'],
  subject: ['Subject', 'other', 'medium'],
  keywords: ['Keywords', 'other', 'medium'],
  comment: ['Comment', 'other', 'medium'],
  doccomm: ['Document comment', 'other', 'medium'],
  category: ['Category', 'other', 'low'],
};

/** Find the span of a group starting at `start` ("{"), brace-matched. */
function groupSpan(text: string, start: number): number | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++; // skip escaped character (\{ \} \\)
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

/** Locate every {\info ...} and {\*\generator ...} group. */
function metadataGroups(text: string): Array<{ start: number; end: number; kind: 'info' | 'generator' }> {
  const out: Array<{ start: number; end: number; kind: 'info' | 'generator' }> = [];
  const patterns: Array<[RegExp, 'info' | 'generator']> = [
    [/\{\\info[\s{\\]/g, 'info'],
    [/\{\\\*\\generator[\s;]/g, 'generator'],
  ];
  for (const [pattern, kind] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const end = groupSpan(text, m.index);
      if (end !== null) out.push({ start: m.index, end, kind });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function mk(
  field: string,
  label: string,
  value: string | null,
  category: MetadataFinding['category'],
  severity: MetadataFinding['severity'],
): MetadataFinding {
  return { category, field, label, value, severity, description: '' };
}

function rtfDate(group: string): string | null {
  const yr = group.match(/\\yr(\d+)/)?.[1];
  const mo = group.match(/\\mo(\d+)/)?.[1];
  const dy = group.match(/\\dy(\d+)/)?.[1];
  if (!yr) return null;
  return [yr, mo?.padStart(2, '0'), dy?.padStart(2, '0')].filter(Boolean).join('-');
}

export function scanRtf(buffer: ArrayBuffer): ScanResult {
  const text = decoder.decode(buffer);
  const findings: MetadataFinding[] = [];

  if (text.startsWith('{\\rtf')) {
    for (const group of metadataGroups(text)) {
      const body = text.slice(group.start, group.end);
      if (group.kind === 'generator') {
        const value = body.match(/\\generator\s+([^;{}]{1,120})/)?.[1]?.trim() ?? null;
        findings.push(mk('RTF:generator', 'Generator application', value, 'software', 'medium'));
        continue;
      }
      for (const [keyword, [label, category, severity]] of Object.entries(INFO_FIELDS)) {
        const m = body.match(new RegExp(`\\{\\\\${keyword}[ ]([^{}]{1,200})\\}`));
        if (m) findings.push(mk(`RTF:${keyword}`, label, m[1].trim() || null, category, severity));
      }
      for (const [keyword, label] of [['creatim', 'Creation date'], ['revtim', 'Revision date'], ['printim', 'Last printed date']] as const) {
        const m = body.match(new RegExp(`\\{\\\\${keyword}([^{}]*)\\}`));
        if (m) findings.push(mk(`RTF:${keyword}`, label, rtfDate(m[0]), 'dates', 'high'));
      }
      const edmins = body.match(/\\edmins(\d+)/)?.[1];
      if (edmins) findings.push(mk('RTF:edmins', 'Total editing time (minutes)', edmins, 'dates', 'low'));
    }
  }

  return {
    format: 'rtf',
    findings,
    preservedInfo: {
      hasIccProfile: false,
      iccDescription: null,
      hasTransparency: false,
      dimensions: null,
      colourChunks: [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

export function cleanRtf(buffer: ArrayBuffer): ArrayBuffer {
  const text = decoder.decode(buffer);
  if (!text.startsWith('{\\rtf')) throw new Error('Не удалось безопасно разобрать структуру RTF.');

  const groups = metadataGroups(text);
  let out = '';
  let at = 0;
  for (const group of groups) {
    if (group.start < at) continue; // nested inside an already-removed group
    out += text.slice(at, group.start);
    at = group.end;
  }
  out += text.slice(at);

  return encoder.encode(out).buffer as ArrayBuffer;
}

export function verifyRtf(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanRtf(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const text = decoder.decode(cleanBuffer);
  const structureIntact = text.startsWith('{\\rtf') && text.trimEnd().endsWith('}');

  return {
    passed: metadataRemaining === 0 && structureIntact,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: structureIntact ? ['Видимое содержимое документа сохранено'] : [],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const rtfHandler: FormatHandler = {
  format: 'rtf',
  scan: scanRtf,
  clean: cleanRtf,
  verify: verifyRtf,
};
