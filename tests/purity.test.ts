// Mechanical enforcement of the determinism boundary: no wall-clock, ambient
// randomness, or DOM access inside src/sim, src/data, src/meta.
// (tsconfig.pure.json already blocks DOM types; this catches the untyped
// escapes like Math.random and Date.now.)

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const PURE_DIRS = ['src/sim', 'src/data', 'src/meta'];

const FORBIDDEN: Array<[RegExp, string]> = [
  [/Math\.random/g, 'Math.random'],
  [/\bDate\.now\b/g, 'Date.now'],
  [/\bnew Date\b/g, 'new Date'],
  [/\bperformance\./g, 'performance.*'],
  [/\brequestAnimationFrame\b/g, 'requestAnimationFrame'],
  [/\bsetTimeout\b/g, 'setTimeout'],
  [/\bsetInterval\b/g, 'setInterval'],
  [/\bdocument\./g, 'document.*'],
  [/\bwindow\./g, 'window.*'],
  [/\blocalStorage\b/g, 'localStorage'],
  [/\bnavigator\./g, 'navigator.*'],
  [/\bfetch\s*\(/g, 'fetch('],
];

function collectTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // directory may not exist yet in early phases
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('sim/data/meta purity', () => {
  const root = process.cwd();
  const files = PURE_DIRS.flatMap((d) => collectTsFiles(join(root, d)));

  it('found pure-layer files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const [pattern, label] of FORBIDDEN) {
    it(`contains no ${label}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        // Strip line comments to allow mentions in docs.
        const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        pattern.lastIndex = 0;
        if (pattern.test(code)) offenders.push(file);
      }
      expect(offenders, `${label} found in: ${offenders.join(', ')}`).toEqual([]);
    });
  }
});
