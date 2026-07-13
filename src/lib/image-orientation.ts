/**
 * JPEG orientation correction using browser Canvas API.
 *
 * When a JPEG has a non-default EXIF orientation (2-8), we must physically
 * rotate/mirror the pixels so the image displays correctly without relying
 * on the EXIF orientation tag (which we remove during cleaning).
 *
 * This runs on the main thread because it requires Canvas 2D API.
 *
 * EXIF orientation values:
 *   1 = Normal (no transform)
 *   2 = Flip horizontal
 *   3 = Rotate 180°
 *   4 = Flip vertical
 *   5 = Transpose (flip horizontal + rotate 270° CW)
 *   6 = Rotate 90° CW
 *   7 = Transverse (flip horizontal + rotate 90° CW)
 *   8 = Rotate 270° CW
 */

/**
 * Determine whether a given EXIF orientation requires swapping
 * width and height (i.e. a 90° or 270° rotation).
 */
export function orientationSwapsDimensions(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Compute the output dimensions after applying an orientation transform.
 */
export function orientedDimensions(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  if (orientationSwapsDimensions(orientation)) {
    return { width: height, height: width };
  }
  return { width, height };
}

/**
 * Whether an orientation value requires any physical transformation.
 * Orientation 1 (and absent/null) require none.
 */
export function orientationRequiresCorrection(orientation: number | null): boolean {
  return orientation !== null && orientation !== 1;
}

/**
 * Apply EXIF orientation correction to a JPEG image.
 *
 * Returns a new JPEG ArrayBuffer with correct visual orientation.
 * The output is re-encoded via canvas.toBlob() — pixel data is NOT byte-identical
 * to the original, but visual quality is preserved at maximum quality (1.0).
 *
 * @param buffer The original JPEG file as an ArrayBuffer
 * @param orientation EXIF orientation value (1-8, 1 = no transform needed)
 * @returns The orientation-corrected JPEG as a new ArrayBuffer
 */
export async function correctJpegOrientation(
  buffer: ArrayBuffer,
  orientation: number,
): Promise<ArrayBuffer> {
  // Orientation 1 (Normal) — no transformation needed
  if (orientation === 1) {
    return buffer;
  }

  // Create a blob URL from the buffer
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);

  try {
    // Decode the image
    const img = await loadImage(url);

    // Determine target canvas dimensions
    const swapDimensions = orientationSwapsDimensions(orientation);
    const canvasWidth = swapDimensions ? img.naturalHeight : img.naturalWidth;
    const canvasHeight = swapDimensions ? img.naturalWidth : img.naturalHeight;

    // Create canvas and apply transformation
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas 2D context');
    }

    // Apply the orientation transform
    applyOrientationTransform(ctx, img, orientation, canvasWidth, canvasHeight);

    // Export as JPEG at maximum quality
    const resultBlob = await canvasToBlob(canvas, 'image/jpeg', 1.0);

    // Convert blob to ArrayBuffer
    return await blobToArrayBuffer(resultBlob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for orientation correction'));
    img.src = url;
  });
}

function applyOrientationTransform(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  orientation: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  switch (orientation) {
    case 1:
      // Normal — no transform
      ctx.drawImage(img, 0, 0);
      break;
    case 2:
      // Flip horizontal
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      break;
    case 3:
      // Rotate 180°
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0);
      break;
    case 4:
      // Flip vertical
      ctx.translate(0, h);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);
      break;
    case 5:
      // Transpose: flip horizontal + rotate 270° CW
      // Final dimensions are swapped (w,h → h,w)
      ctx.translate(canvasWidth, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);
      break;
    case 6:
      // Rotate 90° CW
      ctx.translate(canvasWidth, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      break;
    case 7:
      // Transverse: flip horizontal + rotate 90° CW
      ctx.translate(0, canvasHeight);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);
      break;
    case 8:
      // Rotate 270° CW
      ctx.translate(0, canvasHeight);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      break;
    default:
      // Unknown orientation — draw as-is
      ctx.drawImage(img, 0, 0);
      break;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to export canvas to blob'));
        }
      },
      type,
      quality,
    );
  });
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/**
 * Extract the EXIF orientation value from a JPEG buffer.
 * Returns the orientation (1-8) or 1 if not found (default/normal).
 */
export function extractJpegOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  if (bytes.length < 4) return 1;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = (bytes[offset] << 8) | bytes[offset + 1];
    const markerByte = marker & 0xff;

    // SOS or EOI — stop searching
    if (markerByte === 0xda || markerByte === 0xd9) break;

    // Skip parameterless markers
    if (markerByte >= 0xd0 && markerByte <= 0xd7) {
      offset += 2;
      continue;
    }

    if (offset + 4 > bytes.length) break;
    offset += 2;
    const segLen = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    // APP1 (EXIF)
    if (marker === 0xffe1 && segLen >= 8) {
      const dataStart = offset;
      if (
        bytes[dataStart] === 0x45 && // E
        bytes[dataStart + 1] === 0x78 && // x
        bytes[dataStart + 2] === 0x69 && // i
        bytes[dataStart + 3] === 0x66 && // f
        bytes[dataStart + 4] === 0x00 &&
        bytes[dataStart + 5] === 0x00
      ) {
        const tiffStart = dataStart + 6;
        if (tiffStart + 8 <= bytes.length) {
          const byteOrder = view.getUint16(tiffStart);
          const littleEndian = byteOrder === 0x4949;
          const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
          const ifdStart = tiffStart + ifdOffset;
          if (ifdStart + 2 <= bytes.length) {
            const numEntries = view.getUint16(ifdStart, littleEndian);
            for (let i = 0; i < numEntries; i++) {
              const entryOffset = ifdStart + 2 + i * 12;
              if (entryOffset + 12 > bytes.length) break;
              const tagId = view.getUint16(entryOffset, littleEndian);
              if (tagId === 0x0112) {
                // Orientation tag
                const type = view.getUint16(entryOffset + 2, littleEndian);
                if (type === 3) {
                  return view.getUint16(entryOffset + 8, littleEndian);
                }
              }
            }
          }
        }
      }
    }

    offset += segLen - 2;
  }

  return 1; // Default/normal orientation
}
