const HEIC_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs',
  'mif1', 'msf1', 'heif', 'avif', 'avis',
]);

export function detectHeic(buffer: ArrayBuffer): boolean {
  const brands = readCompatibleBrands(buffer);
  return brands.some((brand) => HEIC_BRANDS.has(brand));
}

export function readCompatibleBrands(buffer: ArrayBuffer): string[] {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 16) return [];
  const size = readUint32(bytes, 0);
  if (readFourCC(bytes, 4) !== 'ftyp' || size < 16 || size > bytes.length) return [];
  const brands = [readFourCC(bytes, 8)];
  for (let offset = 16; offset + 4 <= size; offset += 4) {
    brands.push(readFourCC(bytes, offset));
  }
  return brands.filter((brand) => /^[\x20-\x7e]{4}$/.test(brand));
}

export function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

export function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

export function readInt16(bytes: Uint8Array, offset: number): number {
  const value = (bytes[offset] << 8) | bytes[offset + 1];
  return value & 0x8000 ? value - 0x10000 : value;
}
