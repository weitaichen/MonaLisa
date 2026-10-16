// The region bounds of toolChecks (toneStats.node.ts), which the CPU calibration and the GPU harness share: 白牙's
// "outside" is the inner lip grown by 0.06·mouthW (skin-cleanup spec §8.2 case 2) in true distance, so a change next
// to the lip, where the tool's own R.B ramp reaches, is not counted, and one past the margin is.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { Face } from '../types';
import { faceFrame } from './passes/toneGeometry';
import { inPoly, innerLipPx, maxDiff, renderToneCpu, ringOutside, TARGETS, TOOL_VALUES, toolChecks, ycc, type Rgba8, type ToneFixture } from './toneStats.node';

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

describe('toolChecks: the 白牙 region', () => {
  it('ignores a change within 0.06·mouthW of the inner lip and counts one past it', () => {
    const W = fix.width;
    const H = fix.height;
    const fr = faceFrame(face, W / H);
    const d = 0.06 * fr.mouthW * W;
    // the inner lip's upper (97–99) and lower (101–103) points, moved k px up or down along the face's y axis
    const offLip = (k: number): [number, number][] =>
      [97, 98, 99, 101, 102, 103].map((i) => {
        const s = i < 100 ? -k : k;
        return [Math.floor(face.pts111[i * 2] * W + fr.yhat[0] * s), Math.floor(face.pts111[i * 2 + 1] * H + fr.yhat[1] * s)];
      });
    const bumped = (pixels: [number, number][]): Rgba8 => {
      const data = Uint8ClampedArray.from(fix.data);
      for (const [x, y] of pixels) {
        const i = (y * W + x) * 4;
        data[i] = data[i] > 127 ? data[i] - 20 : data[i] + 20;
      }
      return { width: W, height: H, data };
    };
    const outside = (out: Rgba8) => toolChecks('teeth', out, fix, orig, fx, face, 1).find((c) => c.name === 'max diff outside mouth + 0.06 mouthW')!;
    const near = outside(bumped(offLip(0.5 * d)));
    expect([near.value, near.ok]).toEqual([0, true]);
    const far = outside(bumped(offLip(d + 3)));
    expect([far.value, far.ok]).toEqual([20, false]);
  });
});

describe('toolChecks: a zero target on the GPU', () => {
  const recoveryChecks = (tool: 'nasolabial' | 'teeth', out: Rgba8, scale: number) => toolChecks(tool, out, fix, orig, fx, face, scale).filter((c) => c.name.includes('recovery'));
  // no TARGETS entry is 0 since 法令紋's fold reference (step 4 follow-up); the rule stays for a calibration that falls
  // back to 0 (plan Task 9), so these cases zero an entry for their duration
  const zeroed = <T>(tool: 'nasolabial' | 'teeth', f: () => T): T => {
    const saved = TARGETS[tool];
    TARGETS[tool] = 0;
    try {
      return f();
    } finally {
      TARGETS[tool] = saved;
    }
  };
  const bound = (b: string) => Number(b.replace('≥', '').trim());
  /** fix with every channel of the given defect pixels moved by k (8-bit) */
  const shifted = (kind: 'fold' | 'teeth', k: number): Rgba8 => {
    const data = Uint8ClampedArray.from(fix.data);
    for (const d of fx.defects.filter((e) => e.kind === kind))
      for (const [x, y] of d.pixels) for (let c = 0; c < 3; c++) data[(y * fix.width + x) * 4 + c] += k;
    return { width: fix.width, height: fix.height, data };
  };

  it('asks only that the tool does not regress the defect, tolerating a 0.5/255 bias in the mean (never a bare ⅔·0 = "≥ 0")', () => {
    const folds = zeroed('nasolabial', () => recoveryChecks('nasolabial', fix, 2 / 3));
    expect(folds.map((c) => c.name)).toEqual(['foldL Y recovery (core) (no regression)', 'foldR Y recovery (core) (no regression)']);
    // 0.5/255 over the defect's own shift: foldL 19.5/255, foldR 12.8/255
    expect(bound(folds[0].bound)).toBeCloseTo(-0.026, 2);
    expect(bound(folds[1].bound)).toBeCloseTo(-0.039, 2);
    expect(folds.every((c) => c.ok && c.value === 0)).toBe(true);
  });

  it('fails a tool that deepens the defect by 2/255', () => {
    expect(zeroed('nasolabial', () => recoveryChecks('nasolabial', shifted('fold', -2), 2 / 3)).map((c) => c.ok)).toEqual([false, false]);
    // the teeth defect is Cb − 0.05: more yellow is Cb lower, i.e. less blue
    const data = Uint8ClampedArray.from(fix.data);
    for (const d of fx.defects.filter((e) => e.kind === 'teeth')) for (const [x, y] of d.pixels) data[(y * fix.width + x) * 4 + 2] -= 4;
    expect(zeroed('teeth', () => recoveryChecks('teeth', { width: fix.width, height: fix.height, data }, 2 / 3)).map((c) => c.ok)).toEqual([false]);
  });

  it('every tool has a real target: a fixture the tool left untouched (a deleted tool) fails its recovery checks on the CPU and on the GPU', () => {
    expect(Object.values(TARGETS).every((t) => t > 0)).toBe(true);
    // 法令紋 has its spec target since the fold reference (S §4.3): 0.5 on the CPU, ⅔ · 0.5 on the GPU
    expect(recoveryChecks('nasolabial', fix, 1).map((c) => [c.name, c.bound, c.ok])).toEqual([
      ['foldL Y recovery (core)', '≥ 0.500', false],
      ['foldR Y recovery (core)', '≥ 0.500', false],
    ]);
    expect(recoveryChecks('nasolabial', fix, 2 / 3).map((c) => [c.name, c.bound, c.ok])).toEqual([
      ['foldL Y recovery (core)', '≥ 0.333', false],
      ['foldR Y recovery (core)', '≥ 0.333', false],
    ]);
    const dark = toolChecks('darkCircle', fix, fix, orig, fx, face, 2 / 3).filter((c) => c.name.includes('recovery'));
    expect(dark.map((c) => c.bound)).toEqual(['≥ 0.300', '≥ 0.300']);
    // 白牙 has its spec target again (Task 11 decision b): ⅔ · 0.45 on the GPU, a real bound an untouched mouth fails
    expect(recoveryChecks('teeth', fix, 2 / 3).map((c) => [c.name, c.bound, c.ok])).toEqual([['teeth Cb recovery', '≥ 0.300', false]]);
    expect(recoveryChecks('teeth', fix, 1).map((c) => c.bound)).toEqual(['≥ 0.450']);
  });

  it('the bounds are the ones S §8.2 states: TARGETS on the CPU, ⅔ of them on the GPU (case 2)', () => {
    const bounds = (scale: number) =>
      Object.fromEntries(
        (['even', 'darkCircle', 'nasolabial', 'teeth', 'eyeBright'] as const).map((tool) => [
          tool,
          [...new Set(toolChecks(tool, fix, fix, orig, fx, face, scale).filter((c) => c.name.includes('recovery')).map((c) => c.bound))],
        ]),
      );
    expect(bounds(1)).toEqual({ even: ['≥ 0.450'], darkCircle: ['≥ 0.450'], nasolabial: ['≥ 0.500'], teeth: ['≥ 0.450'], eyeBright: ['≥ 0.250'] });
    expect(bounds(2 / 3)).toEqual({ even: ['≥ 0.300'], darkCircle: ['≥ 0.300'], nasolabial: ['≥ 0.333'], teeth: ['≥ 0.300'], eyeBright: ['≥ 0.167'] });
  });
});

// 白牙's lip checks ran on the fixture only, and their 0/255 read the lip line from the same inner-lip polygon as the lip
// guard. The ring 1–4 px outside that line is the lip where its colour passes the tooth gate and R.B's ramp still reaches
// (S §4.4), and it is checked on the real photo too: with lipGuard forced to 1 it reads 24/255 on sample_face.png and on
// the fixture (the outer-lip check 28/255). Like the guard, it trusts the inner-lip landmarks (S §9).
describe('白牙: the lip ring 1–4 px outside the inner lip', () => {
  const ringName = 'lip ring 1–4 px outside the inner lip, max diff';
  it('counts a change 2–3 px outside the inner lip and none 7 px out (the check reads its ring)', () => {
    const W = fix.width;
    const H = fix.height;
    const fr = faceFrame(face, W / H);
    // the inner lip's upper (97–99) and lower (101–103) points, moved k px up or down along the face's y axis
    const offLip = (k: number): [number, number][] =>
      [97, 98, 99, 101, 102, 103].map((i) => {
        const s = i < 100 ? -k : k;
        return [Math.floor(face.pts111[i * 2] * W + fr.yhat[0] * s), Math.floor(face.pts111[i * 2 + 1] * H + fr.yhat[1] * s)];
      });
    const bumped = (pixels: [number, number][]): Rgba8 => {
      const data = Uint8ClampedArray.from(fix.data);
      for (const [x, y] of pixels) {
        const i = (y * W + x) * 4;
        data[i] = data[i] > 127 ? data[i] - 20 : data[i] + 20;
      }
      return { width: W, height: H, data };
    };
    const ring = (out: Rgba8) => toolChecks('teeth', out, fix, orig, fx, face, 1).find((c) => c.name === ringName)!;
    expect([ring(bumped(offLip(2.5))).value, ring(bumped(offLip(2.5))).ok]).toEqual([20, false]);
    expect(ring(bumped(offLip(7))).value).toBe(0);
  });

  it('on sample_face.png at 100 the ring moves ≤ 2/255 while the teeth inside the inner lip whiten', () => {
    const W = orig.width;
    const H = orig.height;
    const out = renderToneCpu(orig, face, TOOL_VALUES.teeth);
    const inner = innerLipPx(face, W, H);
    const ring = maxDiff(out, orig, ringOutside(inner, 1, 4));
    // the effect is real: inside the inner lip many pixels gain luma (shadowed teeth, S §4.4)
    let lifted = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (inPoly([x + 0.5, y + 0.5], inner) && ycc(out, x, y)[0] - ycc(orig, x, y)[0] >= 4 / 255) lifted++;
    console.log(`sample_face.png 白牙 100: lip ring max ${ring}/255, ${lifted} pixels inside the inner lip gain ≥ 4/255 luma`);
    expect(ring).toBeLessThanOrEqual(2);
    expect(lifted).toBeGreaterThan(200);
  }, 60_000);
});
