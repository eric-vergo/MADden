// The deliverable is a bundle a browser can load, so the build is part of the
// contract: if `vite build` breaks, the game is not shippable.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const root = process.cwd();

describe('bundle', () => {
  it('index.html boots the real main.ts', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain('src="/src/main.ts"');
    expect(html).toContain('id="game"');
    expect(html).toContain('id="ui"');

    const main = readFileSync(join(root, 'src/main.ts'), 'utf8');
    expect(main).toContain('new App(');
    expect(main).not.toContain('under construction');
  });

  it('vite build succeeds', () => {
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], {
      cwd: root,
      stdio: 'pipe',
      timeout: 180_000,
    });
    expect(existsSync(join(root, 'dist/index.html'))).toBe(true);
  }, 180_000);
});
