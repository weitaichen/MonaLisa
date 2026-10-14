// 膚質 engine harness (skin-cleanup spec §8.2) on the dev server page tests/e2e/pages/tone.html: the GPU targets and
// passes against the CPU references (toneRaster.node.ts, toneCpu.ts, healCpu.ts).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, type ToneFaceInput, type ToneValues } from '../../src/engine/passes/toneGeometry';
import { fromRgba8, makeImg, retouchCpu, toneFieldCpu, toRgba8, type Img } from '../../src/engine/toneCpu';
import { rasterizeTone } from '../../src/engine/toneRaster.node';
import { TOOL_VALUES, toolChecks, type Rgba8, type ToneFixture, type ToolName } from '../../src/engine/toneStats.node';
import { adapt } from '../../src/tracking/adapter111';
import { decodeDataUrl, expect, test } from './fixtures';

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

const FIXTURE_PNG = resolve(import.meta.dirname, '../fixtures/sample_face_tone.png');
const loadFx = () => JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/sample_face_tone.json'), 'utf8')) as ToneFixture;
const fixturePixels = (): Rgba8 => {
  const p = PNG.sync.read(readFileSync(FIXTURE_PNG));
  return { width: p.width, height: p.height, data: p.data };
};
const imgOf = (w: number, h: number, s: string): Img => fromRgba8(w, h, bytes(s));

test('tone field + retouch: the GPU equals toneCpu (max 2/255, mean 0.25/255) on six crops', async ({ page }) => {
  await openHarness(page, 'runToneField');
  const r = await page.evaluate(() => window.runToneField!());
  expect(r.err).toBe(0);
  const fx = loadFx();
  const src = fixturePixels();
  const base = fromRgba8(src.width, src.height, src.data);
  const centre = (name: string) => fx.defects.find((d) => d.name === name)!.center;
  const crops: [string, [number, number]][] = [
    ['cheek', [fx.regions.cheek[0] + 24, fx.regions.cheek[1] + 24]],
    ['crescent L', centre('darkL')],
    ['crescent R', centre('darkR')],
    ['band', centre('foldL')],
    ['mouth', centre('teeth')],
    ['eye', centre('scleraL')],
  ];
  for (const lv of r.levels) {
    const R = imgOf(r.qw, r.qh, lv.R);
    const Q = imgOf(r.qw, r.qh, lv.Q);
    const cpu = toRgba8(retouchCpu(base, toneFieldCpu(base, Q, R, r.sigmaLowPx, true), R, true));
    const gpu = bytes(lv.out);
    for (const [name, [cx, cy]] of crops) {
      let max = 0;
      let sum = 0;
      let n = 0;
      for (let y = Math.round(cy) - 32; y < Math.round(cy) + 32; y++)
        for (let x = Math.round(cx) - 32; x < Math.round(cx) + 32; x++)
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(gpu[(y * r.w + x) * 4 + c] - cpu[(y * r.w + x) * 4 + c]);
            max = Math.max(max, d);
            sum += d;
            n++;
          }
      console.log(`level ${lv.level} ${name}: max ${max}, mean ${(sum / n).toFixed(3)}`);
      expect(max, `${lv.level} ${name}`).toBeLessThanOrEqual(2);
      expect(sum / n, `${lv.level} ${name}`).toBeLessThanOrEqual(0.25);
    }
  }
});

test('tone engine: each tool changes only its region (⅔ of the calibrated targets), passes, cache, context loss', async ({ page }) => {
  await openHarness(page, 'runToneEngine');
  const r = await page.evaluate(() => window.runToneEngine!());
  const fx = loadFx();
  const orig = (() => {
    const p = PNG.sync.read(readFileSync(resolve(import.meta.dirname, '../fixtures/sample_face.png')));
    return { width: p.width, height: p.height, data: p.data };
  })();
  const base = decodeDataUrl(r.png.base);
  for (const tool of Object.keys(TOOL_VALUES) as ToolName[]) {
    // a zero target (法令紋, 白牙 after Task 9) asks for no regression within a 0.5/255 bias, never a bare ⅔·0 (toolChecks)
    const checks = toolChecks(tool, decodeDataUrl(r.png[tool]), base, orig, fx, FACE, 2 / 3);
    console.log(`${tool}: ${checks.map((c) => `${c.ok ? '' : '✗ '}${c.name} ${c.value.toFixed(4)} (${c.bound})`).join(' · ')}`);
    expect(checks.filter((c) => !c.ok).map((c) => `${c.name} = ${c.value.toFixed(4)} (${c.bound})`), tool).toEqual([]);
  }
  const step4 = (p: string[]) => p.filter((x) => x === 'heal' || x === 'toneField' || x === 'retouch');
  expect(step4(r.passes.base)).toEqual([]);
  expect(step4(r.passes.even)).toEqual(['toneField', 'retouch']);
  expect(step4(r.passes.teeth)).toEqual(['retouch']);
  expect(step4(r.passes.eyeBright)).toEqual(['toneField', 'retouch']);
  console.log(`built ${JSON.stringify(r.built)}, context loss max diff ${r.lossMaxDiff}`);
  expect(r.built).toEqual([true, false, false, true]);
  expect(r.lossMaxDiff).toBeLessThanOrEqual(1);
  console.log(`after releaseBuffers: rebuilt ${r.releaseBuilt}, max diff ${r.releaseMaxDiff}`);
  expect([r.releaseBuilt, r.releaseMaxDiff]).toEqual([false, 0]);
});

test('retouch colour gates: the GPU equals retouchCpu on a sweep through the 白牙 and 亮眼 gates, with and without Mn8', async ({ page }) => {
  await openHarness(page, 'runToneRetouch');
  const r = await page.evaluate(() => window.runToneRetouch!());
  expect(r.err).toBe(0);
  const base = imgOf(r.w, r.h, r.base);
  const R = imgOf(r.qw, r.qh, r.R);
  const field = toneFieldCpu(base, makeImg(r.qw, r.qh), R, 0, false);
  const src = bytes(r.base);
  const cases: [string, string, Uint8ClampedArray][] = [
    ['with Mn8', r.out, toRgba8(retouchCpu(base, field, R, false))],
    ['without Mn8', r.outNoMn, toRgba8(retouchCpu(base, null, R, false))],
  ];
  for (const [name, out, cpu] of cases) {
    const gpu = bytes(out);
    let max = 0;
    let sum = 0;
    let n = 0;
    let moved = 0;
    for (let i = 0; i < gpu.length; i += 4) {
      let m = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(gpu[i + c] - cpu[i + c]);
        max = Math.max(max, d);
        sum += d;
        n++;
        m = Math.max(m, Math.abs(gpu[i + c] - src[i + c]));
      }
      if (m > 2) moved++;
    }
    console.log(`${name}: max ${max}, mean ${(sum / n).toFixed(3)}, pixels moved > 2/255: ${moved}`);
    // the sweep reaches the gates: a large share of it is retouched
    expect(moved, name).toBeGreaterThan(5000);
    expect(max, name).toBeLessThanOrEqual(2);
    expect(sum / n, name).toBeLessThanOrEqual(0.25);
  }
});
