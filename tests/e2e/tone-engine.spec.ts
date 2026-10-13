// 膚質 engine harness (skin-cleanup spec §8.2) on the dev server page tests/e2e/pages/tone.html: the GPU targets and
// passes against the CPU references (toneRaster.node.ts, toneCpu.ts, healCpu.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, type ToneFaceInput, type ToneValues } from '../../src/engine/passes/toneGeometry';
import { rasterizeTone } from '../../src/engine/toneRaster.node';
import { adapt } from '../../src/tracking/adapter111';
import { expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';
const lm = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/landmarks_sample_face.json'), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const ASPECT = lm.width / lm.height;
const FACE = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const allTools = (warmth: number): ToneValues => ({ ...NEUTRAL_TONE, even: 1, warmth, darkCircle: 1, nasolabial: 1, teeth: 1, eyeBright: 1 });
const one = (v: ToneValues): ToneFaceInput[] => [{ face: FACE, values: v, weight: 1, cap: null }];
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** mean |gpu − cpu| (0..255) and the share of channel values farther apart than 2/255 */
function compare(gpu: Uint8Array, cpu: Float32Array): { mean: number; over2: number } {
  let sum = 0;
  let over = 0;
  for (let i = 0; i < gpu.length; i++) {
    const d = Math.abs(gpu[i] - Math.round(cpu[i] * 255));
    sum += d;
    if (d > 2) over++;
  }
  return { mean: sum / gpu.length, over2: over / gpu.length };
}

async function openHarness(page: Page, fn: string): Promise<void> {
  await page.goto(`${DEV_URL}/tests/e2e/pages/tone.html`);
  await page.waitForFunction((name) => typeof (window as unknown as Record<string, unknown>)[name] === 'function', fn);
}

test('tone masks: the GPU R and Q targets equal the CPU raster of toneGeometry', async ({ page }) => {
  await openHarness(page, 'runToneMasks');
  const r = await page.evaluate(() => window.runToneMasks!());
  expect(r.err).toBe(0);
  const cases = [
    ['R', toneDrawsR(one(allTools(1)), ASPECT), R_CLEAR],
    ['Qwarm', toneDrawsQ(one(allTools(1)), ASPECT), Q_CLEAR],
    ['Qcool', toneDrawsQ(one(allTools(0)), ASPECT), Q_CLEAR],
  ] as const;
  for (const [name, draws, clear] of cases) {
    const c = compare(bytes(r[name]), rasterizeTone(draws, r.w, r.h, IDENTITY_WIN, clear));
    console.log(`${name}: mean ${c.mean.toFixed(3)}, > 2/255 ${(c.over2 * 100).toFixed(3)} %`);
    expect(c.mean, name).toBeLessThan(0.25);
    expect(c.over2, name).toBeLessThan(0.002);
  }
  const at = (s: string, x: number, y: number) => Array.from(bytes(s).subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4));
  // left cheek (between P6 and P82, ≈ (311, 714) px): coverage 1 and 勻膚 1; warm above / cool below neutral
  const cx = Math.round(311 / 4);
  const cy = Math.round(714 / 4);
  expect(at(r.Qwarm, cx, cy).slice(0, 2)).toEqual([255, 255]);
  expect(at(r.Qwarm, cx, cy)[2]).toBeGreaterThan(128 + 50);
  expect(at(r.Qcool, cx, cy)[2]).toBeLessThan(128 - 50);
  // far from the face: R empty, Q neutral
  expect(at(r.R, 5, 5)).toEqual([0, 0, 0, 0]);
  expect(at(r.Qwarm, 5, 5)).toEqual([0, 0, 128, 0]);
});
