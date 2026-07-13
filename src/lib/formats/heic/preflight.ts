import { IMAGE_PIXEL_LIMIT } from '../../processing-limits';
import { readCompatibleBrands, readFourCC, readUint32 } from './detect';
import type { HeicBlock, HeicBlockReason, HeicPreflight } from './types';

const MAX_HEIC_BYTES = 50 * 1024 * 1024;
const BLOCK_ANIMATION_BRANDS = new Set(['msf1', 'heics', 'heifs', 'avis']);
const CONTAINER_BOXES = new Set(['meta', 'iprp', 'ipco', 'iinf', 'iref', 'trak', 'moov', 'mdia', 'minf', 'stbl']);
const METADATA_LABELS: Record<string, string> = {
  Exif: 'EXIF',
  mime: 'MIME metadata',
  xml: 'XML/XMP metadata',
  uri: 'URI metadata',
  'colr:nclx': 'NCLX colour profile',
  'colr:rICC': 'ICC colour profile',
  'colr:prof': 'ICC colour profile',
};

interface BoxInfo {
  type: string;
  start: number;
  headerSize: number;
  size: number;
  end: number;
}

export function heicBlock(reason: HeicBlockReason, message: string): HeicBlock {
  return { blocked: true, reason, message };
}

export function preflightHeic(buffer: ArrayBuffer): HeicPreflight | HeicBlock {
  if (buffer.byteLength > MAX_HEIC_BYTES) {
    return heicBlock('too-large', 'HEIC/HEIF файл больше 50 МБ. BURAN не декодирует такие изображения в браузере.');
  }

  const brands = readCompatibleBrands(buffer);
  if (brands.length === 0) {
    return heicBlock('malformed', 'Файл не похож на корректный HEIC/HEIF контейнер. Очищенная копия не создана.');
  }
  if (brands.some((brand) => BLOCK_ANIMATION_BRANDS.has(brand))) {
    return heicBlock('animation', 'HEIC/HEIF содержит последовательность или анимацию. BURAN поддерживает только одно статичное изображение.');
  }

  const bytes = new Uint8Array(buffer);
  const state = {
    dimensions: [] as Array<{ width: number; height: number }>,
    imageCount: 0,
    hasPrimary: false,
    metadataContainers: new Set<string>(),
    hasAlpha: false,
    hasAuxiliary: false,
    hasDepth: false,
    orientation: null as number | null,
    sentinels: new Set<string>(),
  };

  walkBoxes(bytes, 0, bytes.length, 0, (box) => {
    if (box.type === 'pitm') state.hasPrimary = true;
    if (box.type === 'infe') state.imageCount++;
    if (box.type === 'ispe' && box.end - box.start >= box.headerSize + 12) {
      const offset = box.start + box.headerSize + 4;
      const width = readUint32(bytes, offset);
      const height = readUint32(bytes, offset + 4);
      if (width > 0 && height > 0) state.dimensions.push({ width, height });
    }
    if (box.type === 'irot' && box.end > box.start + box.headerSize) {
      const value = bytes[box.start + box.headerSize] & 0x03;
      state.orientation = [1, 6, 3, 8][value] ?? 1;
    }
    if (box.type === 'Exif') state.metadataContainers.add('EXIF');
    if (box.type === 'mime') state.metadataContainers.add('MIME metadata');
    if (box.type === 'xml ') state.metadataContainers.add('XML/XMP metadata');
    if (box.type === 'uri ') state.metadataContainers.add('URI metadata');
    if (box.type === 'colr' && box.end >= box.start + box.headerSize + 4) {
      const profile = readFourCC(bytes, box.start + box.headerSize);
      state.metadataContainers.add(METADATA_LABELS[`colr:${profile}`] ?? 'Colour profile');
    }
    if (box.type === 'auxC' || box.type === 'auxl') state.hasAuxiliary = true;
    if (box.type === 'dimg') state.hasDepth = true;
    if (box.type === 'pixi') state.hasAlpha = true;
    collectSentinels(bytes, box, state.sentinels);
  });

  if (!state.hasPrimary) return heicBlock('no-primary-image', 'В HEIC/HEIF не найдено основное изображение. BURAN не создал экспорт.');
  if (state.hasDepth) return heicBlock('depth-map', 'HEIC/HEIF содержит depth map. BURAN не обрабатывает такие файлы, чтобы не дать ложную гарантию.');
  if (state.hasAuxiliary) return heicBlock('auxiliary-image', 'HEIC/HEIF содержит auxiliary image. BURAN поддерживает только одно основное статичное изображение.');
  if (state.imageCount > 1) return heicBlock('too-many-images', 'HEIC/HEIF содержит несколько изображений. BURAN поддерживает только один primary image.');

  const dimensions = largestDimensions(state.dimensions);
  if (!dimensions) return heicBlock('malformed', 'Не удалось безопасно определить размеры HEIC/HEIF до декодирования.');
  if (dimensions.width * dimensions.height > IMAGE_PIXEL_LIMIT) {
    return heicBlock('resource-limit', 'HEIC/HEIF превышает безопасный лимит декодированных пикселей для браузера.');
  }

  return {
    brands,
    dimensions,
    imageCount: Math.max(1, state.imageCount),
    metadataContainers: Array.from(state.metadataContainers),
    hasAlpha: state.hasAlpha,
    orientation: state.orientation,
    outputFormat: state.hasAlpha ? 'png' : 'jpeg',
    colourHandling: 'Декодируется в браузерное RGBA/sRGB-представление; исходный ICC не заявляется как сохранённый.',
    sourceMetadataSentinels: Array.from(state.sentinels).slice(0, 20),
  };
}

function walkBoxes(bytes: Uint8Array, start: number, end: number, depth: number, visit: (box: BoxInfo) => void): void {
  if (depth > 8) return;
  let offset = start;
  while (offset + 8 <= end) {
    const box = readBox(bytes, offset, end);
    if (!box) return;
    visit(box);
    if (CONTAINER_BOXES.has(box.type)) {
      const childStart = box.type === 'meta' ? box.start + box.headerSize + 4 : box.start + box.headerSize;
      if (childStart < box.end) walkBoxes(bytes, childStart, box.end, depth + 1, visit);
    }
    offset = box.end;
  }
}

function readBox(bytes: Uint8Array, offset: number, limit: number): BoxInfo | null {
  const size32 = readUint32(bytes, offset);
  const type = readFourCC(bytes, offset + 4);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > limit) return null;
    const high = readUint32(bytes, offset + 8);
    const low = readUint32(bytes, offset + 12);
    if (high !== 0) return null;
    size = low;
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - offset;
  }
  if (size < headerSize || offset + size > limit) return null;
  return { type, start: offset, headerSize, size, end: offset + size };
}

function largestDimensions(items: Array<{ width: number; height: number }>): { width: number; height: number } | null {
  if (items.length === 0) return null;
  return items.reduce((best, item) => item.width * item.height > best.width * best.height ? item : best, items[0]);
}

function collectSentinels(bytes: Uint8Array, box: BoxInfo, sentinels: Set<string>): void {
  if (!['Exif', 'mime', 'xml ', 'uri '].includes(box.type)) return;
  const max = Math.min(box.end, box.start + box.headerSize + 1024);
  const text = new TextDecoder('latin1').decode(bytes.slice(box.start + box.headerSize, max));
  for (const match of text.matchAll(/[A-Z0-9_ -]{8,80}/g)) {
    const value = match[0].trim();
    if (/DEMO|AUTHOR|GPS|CAMERA|COPYRIGHT|PRIVATE|BURAN/i.test(value)) sentinels.add(value);
  }
}

export function readHeicOrientationFromExif(buffer: ArrayBuffer): number | null {
  const bytes = new Uint8Array(buffer);
  let orientation: number | null = null;
  walkBoxes(bytes, 0, bytes.length, 0, (box) => {
    if (orientation !== null || box.type !== 'Exif') return;
    const start = box.start + box.headerSize;
    const end = box.end;
    for (let offset = start; offset + 12 < end; offset++) {
      if (bytes[offset] === 0x49 && bytes[offset + 1] === 0x49 && bytes[offset + 2] === 0x2a) {
        orientation = parseTiffOrientation(bytes, offset, true, end);
        return;
      }
      if (bytes[offset] === 0x4d && bytes[offset + 1] === 0x4d && bytes[offset + 3] === 0x2a) {
        orientation = parseTiffOrientation(bytes, offset, false, end);
        return;
      }
    }
  });
  return orientation;
}

function parseTiffOrientation(bytes: Uint8Array, tiffStart: number, little: boolean, limit: number): number | null {
  const read16 = (offset: number) => little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
  const read32 = (offset: number) => little ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24) : readUint32(bytes, offset);
  const ifd = tiffStart + read32(tiffStart + 4);
  if (ifd + 2 > limit) return null;
  const count = read16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > limit) return null;
    if (read16(entry) === 0x0112 && read16(entry + 2) === 3) return read16(entry + 8);
  }
  return null;
}
