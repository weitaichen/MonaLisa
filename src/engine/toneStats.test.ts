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
import { toolChecks, type Rgba8, type ToneFixture } from './toneStats.node';

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
