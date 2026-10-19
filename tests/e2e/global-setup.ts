// Runs once before the e2e workers launch Chromium: the fake camera needs tests/fixtures/face.y4m
// (gitignored, generated from sample_face.png) and the group camera tests/fixtures/group.y4m (from group_faces.png),
// the camera per-person projects their clips (spec §12.3: upright_row3 / upright_far10 / selfie_group.y4m from
// sample_face.png cells, group10.y4m from ten_faces.jpg, group_move.y4m from group_faces.png), the 膚質 specs need
// tests/fixtures/sample_face_tone.{png,json} (gitignored, generated from sample_face.png by
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

/** a clip laid out from gen-group-fixture.mjs's geometry: both generators and its source image */
const grouped = (src: string): string[] => ['scripts/gen-y4m.mjs', 'scripts/gen-group-fixture.mjs', src];

/** every clip gen-y4m.mjs makes: its output, the generator's arguments and the inputs that make it stale */
const CLIPS: { out: string; args: string[]; inputs: string[] }[] = [
  { out: 'tests/fixtures/face.y4m', args: [], inputs: ['scripts/gen-y4m.mjs', 'tests/fixtures/sample_face.png'] },
  {
    out: 'tests/fixtures/group.y4m',
    args: ['--src', 'tests/fixtures/group_faces.png', '--out', 'tests/fixtures/group.y4m'],
    inputs: grouped('tests/fixtures/group_faces.png'),
  },
  ...['upright_row3', 'upright_far10', 'selfie_group'].map((layout) => ({
    out: `tests/fixtures/${layout}.y4m`,
    args: ['--layout', layout],
    inputs: grouped('tests/fixtures/sample_face.png'),
  })),
  {
    out: 'tests/fixtures/group10.y4m',
    args: ['--src', 'tests/fixtures/ten_faces.jpg', '--out', 'tests/fixtures/group10.y4m'],
    inputs: grouped('tests/fixtures/ten_faces.jpg'),
  },
  { out: 'tests/fixtures/group_move.y4m', args: ['--move'], inputs: grouped('tests/fixtures/group_faces.png') },
];

export default function globalSetup(): void {
  const gen = resolve(root, 'scripts/gen-y4m.mjs');
  for (const c of CLIPS) {
    if (stale(resolve(root, c.out), ...c.inputs)) execFileSync(process.execPath, [gen, ...c.args], { cwd: root, stdio: 'inherit' });
  }
  const toneInputs = ['scripts/gen-tone-fixture.mjs', 'tests/fixtures/sample_face.png', 'tests/fixtures/landmarks_sample_face.json'];
  if (stale(resolve(root, 'tests/fixtures/sample_face_tone.png'), ...toneInputs) || stale(resolve(root, 'tests/fixtures/sample_face_tone.json'), ...toneInputs)) {
    execFileSync(process.execPath, [resolve(root, 'scripts/gen-tone-fixture.mjs')], { cwd: root, stdio: 'inherit' });
  }
  if (!existsSync(resolve(root, 'dist/index.html')) || !existsSync(resolve(root, 'dist/sw.js'))) {
    throw new Error('dist/ is missing: run `npm run build` first (`npm run test:e2e` builds automatically).');
  }
}
