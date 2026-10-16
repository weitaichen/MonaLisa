// Calibration of the TONE gains on sample_face_tone.png (skin-cleanup spec §8.2 "Calibration and thresholds"): each tool
// at 100 through toneGeometry → CPU raster → toneCpu must recover its target share of the defect made for it and keep
// every "keeps" bound. A failing check means: tune TONE in ./shaders/tone.ts (plan Task 9, Step 4).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { Face } from '../types';
import { NEUTRAL_TONE } from './passes/toneGeometry';
import { renderToneCpu, TOOL_VALUES, toolChecks, type Check, type Rgba8, type ToneFixture, type ToolName } from './toneStats.node';

const root = resolve(import.meta.dirname, '../..');
let fix: Rgba8;
let orig: Rgba8;
let fx: ToneFixture;
let face: Face;

beforeAll(async () => {
  const gen = (await import(pathToFileURL(resolve(root, 'scripts/gen-tone-fixture.mjs')).href)) as {
    generateToneFixture(): { png: Buffer; json: ToneFixture };
  };
  const g = gen.generateToneFixture();
  const p = PNG.sync.read(g.png);
  fix = { width: p.width, height: p.height, data: p.data };
  const o = PNG.sync.read(readFileSync(resolve(root, 'tests/fixtures/sample_face.png')));
  orig = { width: o.width, height: o.height, data: o.data };
  fx = g.json;
  const lm = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
  face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
}, 60_000);

describe('TONE calibration on sample_face_tone.png', () => {
  for (const tool of Object.keys(TOOL_VALUES) as ToolName[]) {
    it(`${tool} at 100 reaches its target and keeps every bound`, () => {
      const out = renderToneCpu(fix, face, TOOL_VALUES[tool]);
      const checks = toolChecks(tool, out, fix, orig, fx, face, 1);
      console.log(`${tool}\n${checks.map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name} = ${c.value.toFixed(4)} (${c.bound})`).join('\n')}`);
      expect(checks.filter((c) => !c.ok).map((c) => `${c.name} = ${c.value.toFixed(4)} (${c.bound})`)).toEqual([]);
    }, 60_000);
  }
});

// 勻膚's region covers the crescents and the bands, so the tools overlap there (S §4.3). They used to add (lift 0.45 + 0.85
// under the eyes): 勻膚 + 黑眼圈 then cut the left lash line to 0.792 of its contrast, below the 0.8 keep. Now 勻膚 and
// 黑眼圈 combine as if one ran after the other and 法令紋 takes the larger lift, so every tool's own checks still hold
// together and each still adds to the other (no dead slider).
describe('overlapping tools at 100 on sample_face_tone.png', () => {
  const failed = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => `${c.name} = ${c.value.toFixed(4)} (${c.bound})`);
  const recoveries = (checks: Check[]) => checks.filter((c) => c.name.includes('recovery')).map((c) => c.value);

  it('勻膚 + 黑眼圈 + 法令紋 keep every bound of each tool, and each tool recovers at least what it does alone', () => {
    const all = renderToneCpu(fix, face, { ...NEUTRAL_TONE, even: 1, darkCircle: 1, nasolabial: 1 });
    const report: string[] = [];
    for (const tool of ['even', 'darkCircle', 'nasolabial'] as const) {
      const together = toolChecks(tool, all, fix, orig, fx, face, 1);
      const alone = toolChecks(tool, renderToneCpu(fix, face, TOOL_VALUES[tool]), fix, orig, fx, face, 1);
      report.push(`${tool}: ${together.map((c) => `${c.name} = ${c.value.toFixed(4)}`).join('; ')}`);
      expect(failed(together), tool).toEqual([]);
      recoveries(together).forEach((v, i) => expect(v, `${tool} recovery ${i}`).toBeGreaterThanOrEqual(recoveries(alone)[i] - 1e-9));
    }
    console.log(report.join('\n'));
  }, 120_000);
});
