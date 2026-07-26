/**
 * SVG metadata scanning and sanitisation.
 *
 * SVG is XML and therefore ACTIVE CONTENT, not just a picture. Before any
 * metadata work, a security gate refuses files with scripts, event handlers,
 * foreignObject, DTD entities, or external references — BURAN must never
 * produce a "cleaned" file that still executes or phones home.
 *
 * Metadata removed (and disclosed): XML comments, the <metadata> element
 * (RDF/Dublin Core), editor namespaces (Inkscape, Sodipodi, dc/cc/rdf),
 * <title>/<desc> text, and the DOCTYPE. Visible drawing content is never
 * touched. Workers have no DOMParser, so the surgery is deliberately
 * conservative regex removal over gated, well-formed-ish input.
 */

import type { FormatHandler, MetadataFinding, ScanResult, VerificationResult } from './types';

const decoder = new TextDecoder('utf-8', { fatal: false });
const encoder = new TextEncoder();

/** Active-content patterns that make an SVG unsafe to "clean". */
const ACTIVE_CONTENT: Array<[RegExp, string]> = [
  [/<script\b/i, 'скрипт (<script>)'],
  [/\bon[a-z]+\s*=/i, 'обработчики событий (onload/onclick…)'],
  [/javascript:/i, 'javascript:-ссылку'],
  [/<foreignObject\b/i, 'внедрённый HTML (<foreignObject>)'],
  [/<!ENTITY/i, 'DTD-сущности'],
  [/\b(?:href|src)\s*=\s*["'](?:https?|file|ftp):/i, 'внешние ссылки'],
  [/url\(\s*["']?(?:https?|file|ftp):/i, 'внешние ресурсы в стилях'],
  [/@import/i, 'внешние стили (@import)'],
];

function gate(text: string): void {
  for (const [pattern, label] of ACTIVE_CONTENT) {
    if (pattern.test(text)) {
      throw new Error(
        `SVG содержит активное содержимое (${label}). BURAN не изменяет такие файлы: очистка метаданных не сделала бы файл безопасным.`,
      );
    }
  }
}

function isSvgText(text: string): boolean {
  const head = text.slice(0, 4096);
  return /<svg[\s>]/i.test(head);
}

function extractTag(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]{0,300}?)</${tag}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() || null : null;
}

function readDimensions(text: string): { width: number; height: number } | null {
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const viewBox = svgTag.match(/viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (viewBox) {
    const width = Math.round(parseFloat(viewBox[1]));
    const height = Math.round(parseFloat(viewBox[2]));
    if (width > 0 && height > 0) return { width, height };
  }
  const w = svgTag.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const h = svgTag.match(/\bheight\s*=\s*["']([\d.]+)/i);
  if (w && h) {
    const width = Math.round(parseFloat(w[1]));
    const height = Math.round(parseFloat(h[1]));
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

export function scanSvg(buffer: ArrayBuffer): ScanResult {
  const text = decoder.decode(buffer);
  const findings: MetadataFinding[] = [];
  const valid = isSvgText(text);

  if (valid) {
    gate(text);

    const comments = text.match(/<!--[\s\S]*?-->/g) ?? [];
    if (comments.length > 0) {
      const first = (comments[0] ?? '').replace(/^<!--|-->$/g, '').trim().slice(0, 180);
      findings.push({
        category: 'other',
        field: 'SVG:Comments',
        label: `XML comments (${comments.length})`,
        value: first || null,
        severity: 'medium',
        description: '',
      });
    }

    if (/<metadata\b/i.test(text)) {
      const creator = text.match(/<dc:creator>[\s\S]*?<dc:title>|<dc:creator[^>]*>([\s\S]{0,200}?)<\/dc:creator>/i);
      const creatorText = creator?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
      findings.push({
        category: 'containers',
        field: 'SVG:Metadata',
        label: 'Metadata element (RDF/Dublin Core)',
        value: creatorText,
        severity: 'high',
        description: '',
      });
    }

    for (const ns of ['inkscape', 'sodipodi']) {
      const count = (text.match(new RegExp(`\\b${ns}:[\\w-]+`, 'gi')) ?? []).length;
      if (count > 0) {
        findings.push({
          category: 'software',
          field: `SVG:Editor:${ns}`,
          label: `Editor metadata (${ns})`,
          value: String(count),
          severity: 'medium',
          description: '',
        });
      }
    }

    const title = extractTag(text, 'title');
    if (title) {
      findings.push({ category: 'other', field: 'SVG:Title', label: 'Title', value: title, severity: 'medium', description: '' });
    }
    const desc = extractTag(text, 'desc');
    if (desc) {
      findings.push({ category: 'other', field: 'SVG:Desc', label: 'Description', value: desc, severity: 'medium', description: '' });
    }
    if (/<!DOCTYPE/i.test(text)) {
      findings.push({ category: 'other', field: 'SVG:Doctype', label: 'DOCTYPE declaration', value: 'Present', severity: 'low', description: '' });
    }
  }

  return {
    format: 'svg',
    findings,
    preservedInfo: {
      hasIccProfile: false,
      iccDescription: null,
      hasTransparency: true,
      dimensions: valid ? readDimensions(text) : null,
      colourChunks: [],
    },
    fileName: '',
    fileSize: buffer.byteLength,
    orientation: null,
  };
}

export function cleanSvg(buffer: ArrayBuffer): ArrayBuffer {
  const text = decoder.decode(buffer);
  if (!isSvgText(text)) throw new Error('Не удалось безопасно разобрать структуру SVG.');
  gate(text);

  let out = text;
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  out = out.replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '');
  out = out.replace(/<metadata\b[^>]*\/>/gi, '');
  out = out.replace(/<title\b[\s\S]*?<\/title>/gi, '');
  out = out.replace(/<desc\b[\s\S]*?<\/desc>/gi, '');
  out = out.replace(/<sodipodi:[\w-]+\b[\s\S]*?(?:\/>|<\/sodipodi:[\w-]+>)/gi, '');
  out = out.replace(/<inkscape:[\w-]+\b[\s\S]*?(?:\/>|<\/inkscape:[\w-]+>)/gi, '');
  // Editor/RDF attributes and their namespace declarations.
  out = out.replace(/\s+(?:inkscape|sodipodi|dc|cc|rdf):[\w-]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\s+(?:inkscape|sodipodi|dc|cc|rdf):[\w-]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\s+xmlns:(?:inkscape|sodipodi|dc|cc|rdf)\s*=\s*["'][^"']*["']/gi, '');

  if (!/<svg[\s>]/i.test(out)) throw new Error('Очистка SVG нарушила структуру файла — операция отменена.');
  return encoder.encode(out).buffer as ArrayBuffer;
}

export function verifySvg(original: ScanResult, cleanBuffer: ArrayBuffer): VerificationResult {
  const rescan = scanSvg(cleanBuffer);
  const metadataRemaining = rescan.findings.length;
  const text = decoder.decode(cleanBuffer);
  const structureIntact = /<svg[\s>]/i.test(text) && /<\/svg>/i.test(text);

  return {
    passed: metadataRemaining === 0 && structureIntact,
    metadataFoundBefore: original.findings.length,
    metadataRemaining,
    technicalDataPreserved: structureIntact ? ['SVG structure'] : [],
    cleanHash: '',
    processedLocally: true,
    limitations: [],
    orientationApplied: false,
    pixelDataReencoded: false,
    remainingUnsupportedMetadataRisk: null,
  };
}

export const svgHandler: FormatHandler = {
  format: 'svg',
  scan: scanSvg,
  clean: cleanSvg,
  verify: verifySvg,
};
