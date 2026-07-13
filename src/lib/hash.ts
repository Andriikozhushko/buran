/**
 * Compute SHA-256 hash of an ArrayBuffer using the Web Crypto API.
 * Returns a hex-encoded string.
 */
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return arrayBufferToHex(hashArray);
}

/**
 * Convert an ArrayBuffer or Uint8Array to a hex string.
 */
export function arrayBufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return parts.join('');
}

/**
 * Shorten a hash for display purposes.
 */
export function shortHash(hash: string, length: number = 16): string {
  if (hash.length <= length) return hash;
  return hash.substring(0, length) + '…';
}
