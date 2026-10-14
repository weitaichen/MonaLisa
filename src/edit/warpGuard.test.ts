import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ovalBox } from '../engine/passes/faceCap';
import { mapMinDet } from '../engine/passes/reshapeCpu';
import { adapt } from '../tracking/adapter111';
import type { Face, FaceProtect, StillFrame } from '../types';
import { defaultPhoto, personFromPreset } from './state';
import { createWarpGuard, warpGuard } from './warpGuard';

// a pass-through spy: counts the CPU map checks, so a memo hit can be told from a recomputation
vi.mock('../engine/passes/reshapeCpu', async (importOriginal) => {
  const m = await importOriginal<typeof import('../engine/passes/reshapeCpu')>();
  return { ...m, mapMinDet: vi.fn(m.mapMinDet) };
});
const checks = vi.mocked(mapMinDet);

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
/** the fixture face shrunk by k about its oval centre and moved by dx */
const at = (k: number, dx: number): Face => {
  const b = ovalBox(base);
  const c = [b.x + b.w / 2, b.y + b.h / 2];
  const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? c[0] + (v - c[0]) * k + dx : c[1] + (v - c[1]) * k));
  return { pts111: m(base.pts111), ext: m(base.ext), oval: m(base.oval), yaw: base.yaw, iris: m(base.iris), lids: m(base.lids) };
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

describe('createWarpGuard (S §6.1: a commit that changes no face warp skips the CPU map)', () => {
  const pair = [at(0.45, -0.2), at(0.45, 0.2)];
  // a block body: a function returned from beforeEach would run as its teardown
  beforeEach(() => {
    checks.mockClear();
  });
  const withValues = (frame: StillFrame, values: Record<string, number>, over: Partial<StillFrame> = {}): StillFrame => ({
    ...frame,
    ...over,
    faces: frame.faces.map((f) => ({ ...f, person: { ...f.person, values: { ...f.person.values, ...values } } })),
  });

  it('the same table again (filter, 磨皮, 紅潤, 口紅, 瘦身 changed): the previous λ, no map', () => {
    const guard = createWarpGuard();
    const f0 = frameOf(pair);
    expect(guard(f0, aspect)).toEqual(warpGuard(f0, aspect));
    checks.mockClear();
    const photo = { ...defaultPhoto(), filterId: 'film' };
    const f1 = withValues(f0, { 'skin.smooth': 0.9, 'skin.rosy': 0.6, 'makeup.lip': 0.8, 'body.slim': 0.6 }, { photo, globalSkin: null });
    expect(guard(f1, aspect)).toEqual([1, 1]);
    expect(checks).not.toHaveBeenCalled();
  });

  it('a stricter bound that acts: the memo returns the same λ the plain guard bisects, and a copy each time', () => {
    const guard = createWarpGuard();
    const want = warpGuard(frameOf(pair), aspect, { minDet: 0.97 });
    expect(want.some((x) => x < 1)).toBe(true);
    const a = guard(frameOf(pair), aspect, { minDet: 0.97 });
    expect(a).toEqual(want);
    a[0] = 123;
    checks.mockClear();
    expect(guard(withValues(frameOf(pair), { 'skin.smooth': 0.1 }), aspect, { minDet: 0.97 })).toEqual(want);
    expect(checks).not.toHaveBeenCalled();
  });

  it('recomputes when what the map reads changes: a shape value, a face, the aspect, the options, a limit or its version', () => {
    const guard = createWarpGuard();
    const f0 = frameOf(pair);
    guard(f0, aspect);
    const recomputes = (frame: StillFrame, a = aspect, opts = {}) => {
      checks.mockClear();
      guard(frame, a, opts);
      return checks.mock.calls.length > 0;
    };
    expect(recomputes(withValues(f0, { 'shape.faceSlim': 0.5 }))).toBe(true);
    expect(recomputes(withValues(f0, { 'shape.faceSlim': 0.5 }))).toBe(false);
    expect(recomputes(frameOf([pair[0], at(0.45, 0.21)]))).toBe(true);
    expect(recomputes(frameOf([pair[0], at(0.45, 0.21)]), aspect * 1.01)).toBe(true);
    expect(recomputes(frameOf([pair[0], at(0.45, 0.21)]), aspect * 1.01, { grid: 33 })).toBe(true);
    const protect: FaceProtect = { width: 4, height: 4, data: new Float32Array(16).fill(1), version: 1 };
    const limited = (): StillFrame => ({ ...frameOf(pair), faces: frameOf(pair).faces.map((f) => ({ ...f, protect })) });
    expect(recomputes(limited())).toBe(true);
    expect(recomputes(limited())).toBe(false);
    protect.version++;
    expect(recomputes(limited())).toBe(true);
    expect(recomputes(limited())).toBe(false);
  });
});
