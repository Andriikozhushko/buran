import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname || __dirname, '..', '..', 'src');
const PROHIBITED = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /navigator\.sendBeacon/];

describe('04A networking guard', () => {
  it('does not add runtime networking primitives', () => {
    const violations: string[] = [];
    for (const file of walk(SRC).filter((name) => /\.(ts|tsx)$/.test(name))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of PROHIBITED) {
        if (pattern.test(text)) violations.push(`${file} matched ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
