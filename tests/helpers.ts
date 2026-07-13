import { readFileSync } from 'node:fs';

/**
 * Read a file as an ArrayBuffer.
 * Handles Node.js Buffer pooling — ensures the ArrayBuffer has
 * exactly the right byteLength.
 */
export function readFixture(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
