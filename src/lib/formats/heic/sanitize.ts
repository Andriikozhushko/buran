import type { HeicScanData, HeicBlock } from './types';
import { heicBlock } from './preflight';

interface LibHeifImage {
  get_width(): number;
  get_height(): number;
  display(imageData: ImageData, callback: (displayData: ImageData | null) => void): void;
}

interface LibHeifModule {
  HeifDecoder: new () => { decode(input: Uint8Array): LibHeifImage[] };
}

export interface HeicCleanOutput {
  buffer: ArrayBuffer;
  exportedFormat: 'jpeg' | 'png';
  width: number;
  height: number;
}

export async function sanitizeHeic(buffer: ArrayBuffer, scan: HeicScanData): Promise<HeicCleanOutput | HeicBlock> {
  if (typeof OffscreenCanvas === 'undefined') {
    return heicBlock('decode-failed', 'Браузер не поддерживает безопасный Worker-export для HEIC/HEIF. Файл не изменён.');
  }

  try {
    const libheif = await loadLibHeif();
    const images = new libheif.HeifDecoder().decode(new Uint8Array(buffer));
    const image = images.find((candidate) => candidate.get_width() === scan.dimensions.width && candidate.get_height() === scan.dimensions.height) ?? images[0];
    if (!image) return heicBlock('decode-failed', 'HEIC/HEIF не содержит декодируемого основного изображения. Экспорт не создан.');
    const width = image.get_width();
    const height = image.get_height();
    if (width !== scan.dimensions.width || height !== scan.dimensions.height) {
      return heicBlock('malformed', 'Размеры HEIC/HEIF после декодирования не совпали с preflight. Экспорт не создан.');
    }

    const imageData = new ImageData(width, height);
    const displayed = await new Promise<ImageData>((resolve, reject) => {
      image.display(imageData, (data) => data ? resolve(data) : reject(new Error('HEIC decode failed')));
    });

    const oriented = applyOrientation(displayed, scan.orientation);
    const hasAlpha = scan.hasAlpha || hasNonOpaqueAlpha(oriented.data);
    const exportedFormat = hasAlpha ? 'png' : scan.outputFormat;
    const canvas = new OffscreenCanvas(oriented.width, oriented.height);
    const context = canvas.getContext('2d');
    if (!context) return heicBlock('decode-failed', 'Не удалось создать canvas для HEIC/HEIF экспорта.');
    context.putImageData(oriented, 0, 0);
    const blob = await canvas.convertToBlob({ type: exportedFormat === 'png' ? 'image/png' : 'image/jpeg', quality: 0.92 });
    return { buffer: await blob.arrayBuffer(), exportedFormat, width: oriented.width, height: oriented.height };
  } catch {
    return heicBlock('decode-failed', 'Не удалось декодировать HEIC/HEIF локально. Файл не был изменён.');
  }
}

async function loadLibHeif(): Promise<LibHeifModule> {
  const module = await import('libheif-js/wasm-bundle');
  return (module.default ?? module) as LibHeifModule;
}

function hasNonOpaqueAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

function applyOrientation(data: ImageData, orientation: number | null): ImageData {
  if (!orientation || orientation === 1) return data;
  if (![3, 6, 8].includes(orientation)) return data;
  const width = orientation === 6 || orientation === 8 ? data.height : data.width;
  const height = orientation === 6 || orientation === 8 ? data.width : data.height;
  const output = new ImageData(width, height);
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      let targetX = x;
      let targetY = y;
      if (orientation === 3) {
        targetX = data.width - 1 - x;
        targetY = data.height - 1 - y;
      } else if (orientation === 6) {
        targetX = data.height - 1 - y;
        targetY = x;
      } else if (orientation === 8) {
        targetX = y;
        targetY = data.width - 1 - x;
      }
      const source = (y * data.width + x) * 4;
      const target = (targetY * width + targetX) * 4;
      output.data[target] = data.data[source];
      output.data[target + 1] = data.data[source + 1];
      output.data[target + 2] = data.data[source + 2];
      output.data[target + 3] = data.data[source + 3];
    }
  }
  return output;
}
