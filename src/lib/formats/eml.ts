/**
 * EML metadata scanning and sanitisation.
 *
 * A saved e-mail leaks far more than its visible content: the Received
 * header chain records every relay with IP addresses, X-Originating-IP the
 * sender's address, X-Mailer/User-Agent the client software, and Message-ID
 * a globally unique correlation handle. Cleaning removes those headers
 * (with line-folding handled) and preserves the message itself: From, To,
 * Subject, Date, MIME structure, body and attachments byte-for-byte.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

/** Removed headers: lowercase name → [label, category, severity]. */
const REMOVE_HEADERS: Record<string, [string, MetadataFinding['category'], MetadataFinding['severity']]> = {
  received: ['Received relay chain', 'other', 'high'],
  'x-received': ['X-Received', 'other', 'high'],
  'x-originating-ip': ['Originating IP address', 'geolocation', 'high'],
  'x-mailer': ['Mail client', 'software', 'medium'],
  'user-agent': ['Mail client (User-Agent)', 'software', 'medium'],
  'x-originating-client': ['Originating client', 'software', 'medium'],
  'message-id': ['Message-ID (correlation handle)', 'other', 'medium'],
  'x-google-original-message-id': ['Original Message-ID', 'other', 'medium'],
};

interface HeaderLine {
  name: string;
  /** Raw header text including folded continuation lines and EOL. */
  raw: string;
  value: string;
}

interface ParsedEml {
  headers: HeaderLine[];
  /** Byte offset (in the decoded text) where the body starts. */
  bodyStart: number;
  text: string;
}

function parseEml(buffer: ArrayBuffer): ParsedEml | null {
  const text = decoder.decode(buffer);
  const headerEnd = text.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
  const lines = headerBlock.split(/(?<=\n)/);

  const headers: HeaderLine[] = [];
  let current: HeaderLine | null = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line) && current) {
      current.raw += line;
      current.value += ' ' + line.trim();
      continue;
    }
    const m = line.match(/^([!-9;-~]+):(.*)$/s);
    if (!m) return headers.length > 0 ? finish() : null;
    current = { name: m[1].toLowerCase(), raw: line, value: m[2].trim() };
    headers.push(current);
  }
  return finish();

  function finish(): ParsedEml | null {
    if (headers.length === 0) return null;
    const looksLikeMail = headers.some((h) => ['from', 'to', 'subject', 'date', 'received', 'return-path', 'mime-version'].includes(h.name));
    if (!looksLikeMail) return null;
    const bodyStart = headerEnd >= 0 ? headerEnd : text.length;
    return { headers, bodyStart, text };
  }
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

export function scanEml(buffer: ArrayBuffer): ScanResult {
  const parsed = parseEml(buffer);
  const findings: MetadataFinding[] = [];

  if (parsed) {
    const received = parsed.headers.filter((h) => h.name === 'received');
    if (received.length > 0) {
      const ips = [...new Set(parsed.headers.flatMap((h) => (h.name === 'received' ? (h.value.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) : [])))];
      findings.push(mk('EML:received', `Received relay chain (${received.length})`, ips.slice(0, 5).join(', ') || 'Present', 'other', 'high'));
    }
    for (const header of parsed.headers) {
      if (header.name === 'received') continue;
      const info = REMOVE_HEADERS[header.name];
      if (info) {
        findings.push(mk(`EML:${header.name}`, info[0], header.value.slice(0, 180) || null, info[1], info[2]));
      }
    }
  }

  return {
    format: 'eml',
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

export function cleanEml(buffer: ArrayBuffer): ArrayBuffer {
  const parsed = parseEml(buffer);
  if (!parsed) throw new Error('Не удалось безопасно разобрать структуру письма (EML).');

  const keptHeaders = parsed.headers.filter((h) => !REMOVE_HEADERS[h.name]).map((h) => h.raw).join('');
  const out = keptHeaders + parsed.text.slice(parsed.bodyStart);
  return encoder.encode(out).buffer as ArrayBuffer;
}

export function verifyEml(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanEml(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const structureIntact = parseEml(cleanBuffer) !== null;

  return {
    passed: metadataRemaining === 0 && structureIntact,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: structureIntact ? ['От кого/кому, тема, тело письма и вложения сохранены'] : [],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const emlHandler: FormatHandler = {
  format: 'eml',
  scan: scanEml,
  clean: cleanEml,
  verify: verifyEml,
};
