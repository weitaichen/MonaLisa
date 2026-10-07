import { describe, expect, it } from 'vitest';
import type { Face, ParamId } from '../../types';
import { applyPreset, defaultParams } from '../params';
import { FACE_TEMPLATE } from './faceMesh';
import {
  EYE_RADIUS_K,
  RESHAPE_SCALE,
  reshapeActive,
  reshapeGeometry,
  reshapeUniforms,
  yawAttenuation,
} from './reshape';
import type { ReshapeUniforms } from './reshape';

const neutral = () => applyPreset('original').values;
const withV = (over: Partial<Record<ParamId, number>>) => ({ ...neutral(), ...over });
const T = (i: number): [number, number] => [FACE_TEMPLATE[i * 2], FACE_TEMPLATE[i * 2 + 1]];

function templateFace(): Face {
  const ext = new Float32Array([0.5, 0.2, 0.5, 0.26, 0.5, 0.33, 0.5, 0.4, 0.5, 0.71, 0.5, 0.68, 0.3, 0.45, 0.7, 0.45]);
  return { pts111: new Float32Array(FACE_TEMPLATE), ext, oval: new Float32Array(72), yaw: 0 };
}

describe('reshapeUniforms', () => {
  it('neutral params → all zero, inactive', () => {
    const u = reshapeUniforms(neutral(), 1);
    expect(Object.values(u).every((v) => v === 0)).toBe(true);
    expect(reshapeActive(u)).toBe(false);
  });

  it('one-way params scale by the RB §2.4 delta column', () => {
    const u = reshapeUniforms(
      withV({
        'shape.faceSlim': 1,
        'shape.eyeEnlarge': 0.5,
        'shape.faceV': 1,
        'shape.faceNarrow': 1,
        'shape.noseSlim': 1,
      }),
      1,
    );
    expect(u.faceSlim).toBeCloseTo(0.1);
    expect(u.eyeEnlarge).toBeCloseTo(0.1);
    // V / narrow / nose are tuned constants (RB marks them "tune"); slim and big-eye are GPUPixel's.
    expect(u.faceV).toBeCloseTo(RESHAPE_SCALE.faceV);
    expect(u.faceNarrow).toBeCloseTo(RESHAPE_SCALE.faceNarrow);
    expect(u.noseSlim).toBeCloseTo(RESHAPE_SCALE.noseSlim);
    expect(RESHAPE_SCALE.faceSlim).toBe(0.1);
    expect(RESHAPE_SCALE.eyeEnlarge).toBe(0.2);
    // overlapping curveWarps add up: every curveWarp delta stays well below the fold limit of 1
    for (const k of ['faceSlim', 'faceV', 'faceNarrow', 'chin', 'forehead', 'noseSlim'] as const) {
      expect(Math.abs(RESHAPE_SCALE[k])).toBeLessThanOrEqual(0.15);
    }
    expect(reshapeActive(u)).toBe(true);
  });

  it('bidirectional params go both ways through signed()', () => {
    const hi = reshapeUniforms(
      withV({ 'shape.chin': 1, 'shape.forehead': 1, 'shape.mouthSize': 1, 'shape.eyeDistance': 1 }),
      1,
    );
    const lo = reshapeUniforms(
      withV({ 'shape.chin': 0, 'shape.forehead': 0, 'shape.mouthSize': 0, 'shape.eyeDistance': 0 }),
      1,
    );
    expect(hi.chin).toBeCloseTo(0.1);
    expect(lo.chin).toBeCloseTo(-0.1);
    expect(hi.forehead).toBeCloseTo(-0.1); // − delta pushes content away from the nasion → taller
    expect(lo.forehead).toBeCloseTo(0.1);
    expect(hi.mouthSize).toBeCloseTo(0.3);
    expect(lo.mouthSize).toBeCloseTo(-0.3);
    expect(hi.eyeDistance).toBeCloseTo(0.08);
    expect(lo.eyeDistance).toBeCloseTo(-0.08);
    // scaleAround is fold-free only for |d| ≤ 0.5
    expect(Math.abs(lo.mouthSize)).toBeLessThanOrEqual(0.5);
    // 0.75 → s = 0.5
    expect(reshapeUniforms(withV({ 'shape.chin': 0.75 }), 1).chin).toBeCloseTo(0.05);
  });

  it('multiplies everything by faceWeight and clamps junk', () => {
    const v = defaultParams().values;
    const full = reshapeUniforms(v, 1);
    const half = reshapeUniforms(v, 0.5);
    for (const k of Object.keys(full) as (keyof ReshapeUniforms)[]) expect(half[k]).toBeCloseTo(full[k] / 2);
    expect(reshapeActive(reshapeUniforms(v, 0))).toBe(false);
    const junk = reshapeUniforms(withV({ 'shape.faceSlim': 5, 'shape.chin': Number.NaN }), 2);
    expect(junk.faceSlim).toBeCloseTo(0.1);
    expect(junk.chin).toBeCloseTo(-0.1); // NaN → 0 → s = −1
  });

  it('reshapeActive threshold is 1e-4', () => {
    const u = reshapeUniforms(neutral(), 1);
    expect(reshapeActive({ ...u, eyeEnlarge: 5e-5 })).toBe(false);
    expect(reshapeActive({ ...u, chin: -2e-4 })).toBe(true);
  });
});

describe('yawAttenuation', () => {
  it('is 1 up to 0.15, 0 from 0.35, smooth and symmetric in between', () => {
    expect(yawAttenuation(0)).toBe(1);
    expect(yawAttenuation(0.15)).toBe(1);
    expect(yawAttenuation(-0.1)).toBe(1);
    expect(yawAttenuation(0.35)).toBe(0);
    expect(yawAttenuation(-0.9)).toBe(0);
    expect(yawAttenuation(0.25)).toBeCloseTo(0.5);
    expect(yawAttenuation(0.3)).toBeCloseTo(yawAttenuation(-0.3));
    expect(yawAttenuation(Number.NaN)).toBe(0);
  });
});

describe('reshapeGeometry', () => {
  const dist = (a: number, b: number) => Math.hypot(T(a)[0] - T(b)[0], T(a)[1] - T(b)[1]);

  it('eye radius κ·eyeWidth reproduces GPUPixel 5·|p74 − p72| on the template', () => {
    const g = reshapeGeometry(templateFace(), 1, reshapeUniforms(withV({ 'shape.eyeEnlarge': 1 }), 1));
    expect(g.eyeR[0]).toBeCloseTo(5 * dist(74, 72), 4);
    expect(g.eyeR[1]).toBeCloseTo(5 * dist(77, 75), 4);
    expect(EYE_RADIUS_K).toBeGreaterThan(0.9);
    expect(EYE_RADIUS_K).toBeLessThan(1);
  });

  it('V / narrow targets lie on the vertical template midline at the source height', () => {
    const g = reshapeGeometry(templateFace(), 1, reshapeUniforms(withV({ 'shape.faceV': 1, 'shape.faceNarrow': 1 }), 1));
    [8, 10, 12, 24, 22, 20].forEach((i, k) => {
      expect(g.vTargets[k * 2]).toBeCloseTo(0.5, 5);
      expect(g.vTargets[k * 2 + 1]).toBeCloseTo(T(i)[1], 5);
    });
    [2, 4, 30, 28].forEach((i, k) => {
      expect(g.narrowTargets[k * 2]).toBeCloseTo(0.5, 5);
      expect(g.narrowTargets[k * 2 + 1]).toBeCloseTo(T(i)[1], 5);
    });
  });

  it('projection is perpendicular in iso space for non-square frames', () => {
    // Tilt the face: rotate the template 20° about its centre, then view it in a 3:4 frame.
    const aspect = 3 / 4;
    const a = (20 * Math.PI) / 180;
    const f = templateFace();
    for (let i = 0; i < 111; i++) {
      const x = T(i)[0] - 0.5;
      const y = T(i)[1] - 0.5;
      f.pts111[i * 2] = 0.5 + x * Math.cos(a) - y * Math.sin(a);
      f.pts111[i * 2 + 1] = 0.5 + (x * Math.sin(a) + y * Math.cos(a)) * aspect;
    }
    const g = reshapeGeometry(f, aspect, reshapeUniforms(withV({ 'shape.faceV': 1 }), 1));
    const iso = (x: number, y: number) => [x, y / aspect];
    const m0 = iso(f.pts111[86], f.pts111[87]);
    const m1 = iso(f.pts111[32], f.pts111[33]);
    [8, 10, 12, 24, 22, 20].forEach((i, k) => {
      const q = iso(f.pts111[i * 2], f.pts111[i * 2 + 1]);
      const t = iso(g.vTargets[k * 2], g.vTargets[k * 2 + 1]);
      const dot = (q[0] - t[0]) * (m1[0] - m0[0]) + (q[1] - t[1]) * (m1[1] - m0[1]);
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    });
  });

  it('chin target mirrors p49 through p16; eye-distance + pushes the image-left eye left', () => {
    const g = reshapeGeometry(templateFace(), 1, reshapeUniforms(withV({ 'shape.eyeDistance': 1 }), 1));
    expect(g.chinTarget[1]).toBeCloseTo(2 * T(16)[1] - T(49)[1], 5);
    expect(g.eyeDisp[0]).toBeLessThan(0);
    expect(g.eyeDisp[1]).toBeCloseTo(0, 6);
    expect(-g.eyeDisp[0]).toBeCloseTo(0.08 * (T(77)[0] - T(74)[0]), 6);
    // displacement stays well inside the fold-free bound |disp| < R / 1.54 of shiftAround
    expect(-g.eyeDisp[0]).toBeLessThan(g.eyeR[0] / 1.54);
  });

  it('bounding box covers the eye discs for big-eye and is empty when idle', () => {
    const f = templateFace();
    const g = reshapeGeometry(f, 1, reshapeUniforms(withV({ 'shape.eyeEnlarge': 1 }), 1));
    expect(g.box[0]).toBeLessThan(T(74)[0] - g.eyeR[0]);
    expect(g.box[2]).toBeGreaterThan(T(77)[0] + g.eyeR[1]);
    const idle = reshapeGeometry(f, 1, reshapeUniforms(neutral(), 1));
    expect(idle.box[0]).toBeGreaterThan(idle.box[2]);
  });
});
