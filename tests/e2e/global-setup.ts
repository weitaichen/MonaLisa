// Runs once before the e2e workers launch Chromium: the fake camera needs tests/fixtures/face.y4m
// (gitignored, generated from sample_face.png), and `vite preview` needs a production build.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export default function globalSetup(): void {
  if (!existsSync(resolve(root, 'tests/fixtures/face.y4m'))) {
    execFileSync(process.execPath, [resolve(root, 'scripts/gen-y4m.mjs')], { cwd: root, stdio: 'inherit' });
  }
  if (!existsSync(resolve(root, 'dist/index.html')) || !existsSync(resolve(root, 'dist/sw.js'))) {
    throw new Error('dist/ is missing: run `npm run build` first (`npm run test:e2e` builds automatically).');
  }
}
