// Runs once before the e2e workers launch Chromium: the fake camera needs tests/fixtures/face.y4m
// (gitignored, generated from sample_face.png) and the group camera tests/fixtures/group.y4m (from group_faces.png),
// the 膚質 specs need tests/fixtures/sample_face_tone.{png,json} (gitignored, generated from sample_face.png by
// scripts/gen-tone-fixture.mjs), and `vite preview` needs a production build.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

/** A generated clip is rebuilt when it is missing or older than its generator or source (a layout change). */
function stale(out: string, ...inputs: string[]): boolean {
  if (!existsSync(out)) return true;
  const t = statSync(out).mtimeMs;
  return inputs.some((i) => statSync(resolve(root, i)).mtimeMs > t);
}

export default function globalSetup(): void {
  const gen = resolve(root, 'scripts/gen-y4m.mjs');
  if (stale(resolve(root, 'tests/fixtures/face.y4m'), 'scripts/gen-y4m.mjs', 'tests/fixtures/sample_face.png')) {
    execFileSync(process.execPath, [gen], { cwd: root, stdio: 'inherit' });
  }
  const groupInputs = ['scripts/gen-y4m.mjs', 'scripts/gen-group-fixture.mjs', 'tests/fixtures/group_faces.png'];
  if (stale(resolve(root, 'tests/fixtures/group.y4m'), ...groupInputs)) {
    execFileSync(process.execPath, [gen, '--src', 'tests/fixtures/group_faces.png', '--out', 'tests/fixtures/group.y4m'], { cwd: root, stdio: 'inherit' });
  }
  const toneInputs = ['scripts/gen-tone-fixture.mjs', 'tests/fixtures/sample_face.png', 'tests/fixtures/landmarks_sample_face.json'];
  if (stale(resolve(root, 'tests/fixtures/sample_face_tone.png'), ...toneInputs) || stale(resolve(root, 'tests/fixtures/sample_face_tone.json'), ...toneInputs)) {
    execFileSync(process.execPath, [resolve(root, 'scripts/gen-tone-fixture.mjs')], { cwd: root, stdio: 'inherit' });
  }
  if (!existsSync(resolve(root, 'dist/index.html')) || !existsSync(resolve(root, 'dist/sw.js'))) {
    throw new Error('dist/ is missing: run `npm run build` first (`npm run test:e2e` builds automatically).');
  }
}
