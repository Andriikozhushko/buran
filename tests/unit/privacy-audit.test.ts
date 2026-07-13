import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname || __dirname, '..', '..', 'src');
const PROHIBITED = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /navigator\.sendBeacon/];

describe('privacy audit', () => {
  it('does not introduce prohibited networking primitives in src/', () => {
    const files = walk(ROOT).filter((name) => /\.(ts|tsx|js|jsx)$/.test(name));
    const violations: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/tests\//.test(file)) continue;
      if (/tests\/e2e\/smoke\.spec\.ts$/.test(file)) continue;
      for (const pattern of PROHIBITED) {
        const matches = text.match(pattern);
        if (matches) violations.push(`${file} matched ${pattern}`);
      }
    }

    expect(violations).toEqual([]);
  });
});

function walk(dir: string): string[] {
  const items: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) items.push(...walk(full));
    else items.push(full);
  }
  return items;
}
