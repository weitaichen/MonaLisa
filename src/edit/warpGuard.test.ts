import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { Face, StillFrame } from '../types';
import { defaultPhoto, personFromPreset } from './state';
import { warpGuard } from './warpGuard';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
/** the fixture face shrunk by k about its oval centre and moved by dx */
const at = (k: number, dx: number): Face => {
  const b = ovalBox(base);
  const c = [b.x + b.w / 2, b.y + b.h / 2];
  const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
  return { pts111: m(base.pts111), ext: m(base.ext), oval: m(base.oval), yaw: base.yaw };
};
const strong = (() => {
  const p = personFromPreset('original', 1);
  return { ...p, values: { ...p.values, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.eyeEnlarge': 1 } };
})();
const frameOf = (faces: Face[], warpScale: number[] = []): StillFrame => ({
  faces: faces.map((face, i) => ({ face, weight: 1, person: strong, protect: null, warpScale: warpScale[i] ?? 1 })),
  obstacles: [],
  globalSkin: null,
  photo: defaultPhoto(),
});

describe('warpGuard (S §4.4 editor safety net)', () => {
  const pair = [at(0.45, -0.2), at(0.45, 0.2)];
  it('never acts at MIN_DET: two capped faces with every contour item and 大眼 at max keep λ = 1', () => {
    expect(warpGuard(frameOf(pair), aspect)).toEqual([1, 1]);
  });
  it('one face (no cap) is never guarded', () => {
    expect(warpGuard(frameOf([pair[0]]), aspect, { minDet: 0.99 })).toEqual([1]);
  });
  it('a stricter bound bisects λ_f per capped face, and the guarded table meets it', () => {
    const l = warpGuard(frameOf(pair), aspect, { minDet: 0.97 });
    expect(l.some((x) => x < 1)).toBe(true);
    for (const x of l) expect(x >= 0 && x <= 1).toBe(true);
    expect(warpGuard(frameOf(pair, l), aspect, { minDet: 0.97 })).toEqual([1, 1]);
  });
});
