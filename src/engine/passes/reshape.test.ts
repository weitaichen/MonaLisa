import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Face, ParamId, PersonParams } from '../../types';
import { applyPreset, defaultParams, neutralValue, PARAM_DEFS, paramDef, SPLIT_IDS } from '../params';
import { adapt, blankEyes } from '../../tracking/adapter111';
import { uMaxBox } from './faceCap';
import { FACE_TEMPLATE } from './faceMesh';
import { reshapeMapCpu } from './reshapeCpu';
import {
  displacementBound,
  EYE_RADIUS_K,
  faceWidthIso,
  JAW,
  JAW_SIDE,
  NARROW,
  NARROW_SIDE,
  packFaceDetail,
  RESHAPE_SCALE,
  reshapeActive,
  reshapeGeometry,
  reshapeUniforms,
  sided,
  SLIM,
  SLIM_SIDE,
  TEMPLE,
  TEMPLE_SIDE,
  TEMPLE_W,
  V_JAW,
  VJAW_SIDE,
  yawAttenuation,
} from './reshape';
import type { ReshapeUniforms } from './reshape';

const neutral = () => applyPreset('original').values;
const withV = (over: Partial<Record<ParamId, number>>) => ({ ...neutral(), ...over });
const T = (i: number): [number, number] => [FACE_TEMPLATE[i * 2], FACE_TEMPLATE[i * 2 + 1]];

function templateFace(): Face {
  const ext = new Float32Array([0.5, 0.2, 0.5, 0.26, 0.5, 0.33, 0.5, 0.4, 0.5, 0.71, 0.5, 0.68, 0.3, 0.45, 0.7, 0.45]);
  return { pts111: new Float32Array(FACE_TEMPLATE), ext, oval: new Float32Array(72), yaw: 0, ...blankEyes() };
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

describe('displacementBound (step 3, S §4.4 D7)', () => {
  const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    points: number[];
  };
  const aspect = lm.width / lm.height;
  const mirrored = lm.points.map((v, i) => (i % 3 === 0 ? 1 - v : v));
  const faces = [adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height), adapt({ points: new Float32Array(mirrored) }, lm.width, lm.height)];
  const SHAPE = PARAM_DEFS.filter((d) => d.group === 'shape').map((d) => d.id);
  const neutral = () => Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), seed / 4294967296);

  it("bounds the CPU port's largest move on a 257 × 257 grid, fuzzed over faces and slider values", () => {
    for (let i = 0; i < 24; i++) {
      const face = faces[i % 2];
      const values = neutral();
      for (const id of SHAPE) if (rnd() < 0.7) values[id] = rnd();
      const u = reshapeUniforms(values, 1);
      const bound = displacementBound(face, aspect, u);
      const map = reshapeMapCpu(face, u, aspect);
      let max = 0;
      for (let y = 0; y <= 256; y++)
        for (let x = 0; x <= 256; x++) {
          const t = map(x / 256, y / 256);
          max = Math.max(max, Math.hypot(t[0] - x / 256, (t[1] - y / 256) / aspect));
        }
      expect(max).toBeLessThanOrEqual(bound + 1e-9);
      if (reshapeActive(u)) expect(bound).toBeGreaterThan(0);
    }
  });

  it('is 0 with every face slider neutral', () => {
    expect(displacementBound(faces[0], aspect, reshapeUniforms(neutral(), 1))).toBe(0);
    expect(paramDef('shape.chin').bidirectional).toBe(true);
  });
});

const fx = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
  mirrored: number[];
};
const FA = fx.width / fx.height;
const fixture = adapt({ points: new Float32Array(fx.points) }, fx.width, fx.height);
const mirrored = adapt({ points: new Float32Array(fx.mirrored) }, fx.width, fx.height);
const NEUTRAL = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
const U5 = (over: Partial<Record<ParamId, number>> = {}, right: PersonParams['right'] = null) =>
  reshapeUniforms({ ...NEUTRAL, ...over }, 1, right);
const NEW_AT_MAX = {
  'shape.jawline': 1, 'shape.temple': 1, 'shape.hairline': 1, 'shape.noseWing': 1, 'shape.noseBridge': 1, 'shape.mouthHeight': 1,
} as const;
const V03_AT_MAX = {
  'shape.eyeEnlarge': 1, 'shape.faceSlim': 1, 'shape.faceV': 1, 'shape.faceNarrow': 1, 'shape.chin': 1, 'shape.forehead': 1,
  'shape.noseSlim': 1, 'shape.mouthSize': 1, 'shape.eyeDistance': 1,
} as const;
const isoOf = (p: readonly number[] | Float32Array, i: number): [number, number] => [p[i * 2], p[i * 2 + 1] / FA];
const len = (x: number, y: number) => Math.hypot(x, y);
const inBox = (b: readonly number[], x: number, y: number) => x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3];
const boxIn = (a: readonly number[], b: readonly number[]) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

describe('step-5 uniforms (face-detail spec §4.2, §4.3)', () => {
  it('scale by the engine deltas: 下頜線 0.12·v, 太陽穴 0.22·s, 髮際線 0.09·s, 鼻翼 0.10·s, 山根 0.30·s, 嘴高 0.18·s', () => {
    const hi = U5(NEW_AT_MAX);
    const lo = U5({ 'shape.temple': 0, 'shape.hairline': 0, 'shape.noseWing': 0, 'shape.noseBridge': 0, 'shape.mouthHeight': 0 });
    expect([hi.jawline, hi.temple, hi.hairline, hi.noseWing, hi.noseBridge, hi.mouthHeight].map((v) => +v.toFixed(9))).toEqual([0.12, 0.22, 0.09, 0.1, 0.3, 0.18]);
    expect([lo.temple, lo.hairline, lo.noseWing, lo.noseBridge, lo.mouthHeight].map((v) => +v.toFixed(9))).toEqual([-0.22, -0.09, -0.1, -0.3, -0.18]);
    expect(reshapeActive(U5())).toBe(false);
  });

  it('right-side strengths equal the left ones bit for bit while right is null; right overrides per id', () => {
    const v = { 'shape.faceSlim': 0.37, 'shape.faceV': 0.21, 'shape.faceNarrow': 0.6, 'shape.eyeEnlarge': 0.33, 'shape.jawline': 0.7, 'shape.temple': 0.81 };
    const a = U5(v);
    for (const [l, r] of [
      ['faceSlim', 'faceSlimR'],
      ['faceV', 'faceVR'],
      ['faceNarrow', 'faceNarrowR'],
      ['eyeEnlarge', 'eyeEnlargeR'],
      ['jawline', 'jawlineR'],
      ['temple', 'templeR'],
    ] as const)
      expect(Object.is(a[l], a[r])).toBe(true);
    const b = U5(v, { 'shape.faceSlim': 0.9, 'shape.temple': 0 });
    expect(b.faceSlimR).toBeCloseTo(0.1 * 0.9, 12);
    expect(b.templeR).toBeCloseTo(-0.22, 12);
    expect(Object.is(b.faceVR, b.faceV)).toBe(true);
  });

  it('side tables follow the GPUPixel halves (contour 0–15 left, 17–32 right, p16 the mean)', () => {
    const side = (i: number) => (i < 16 ? 0 : i > 16 ? 1 : 0.5);
    SLIM.forEach(([o], k) => expect(SLIM_SIDE[k]).toBe(side(o)));
    V_JAW.forEach((o, k) => expect(VJAW_SIDE[k]).toBe(side(o)));
    NARROW.forEach((o, k) => expect(NARROW_SIDE[k]).toBe(side(o)));
    JAW.forEach((o, k) => expect(JAW_SIDE[k]).toBe(side(o)));
    // temple anchors are oval points: the GPUPixel-left ones lie left of the face midline on an upright face
    const mid = (fixture.pts111[0] + fixture.pts111[64]) / 2;
    TEMPLE.forEach((j, k) => expect(TEMPLE_SIDE[k]).toBe(fixture.oval[j * 2] < mid ? 0 : 1));
    expect(TEMPLE_W).toEqual([0.6, 1, 0.6, 0.6, 1, 0.6]);
    for (const s of [0, 0.5, 1]) expect(Object.is(sided(0.123, 0.123, s), 0.123)).toBe(true);
    expect(sided(0.1, 0.3, 0.5)).toBeCloseTo(0.2, 12);
  });
});

describe('step-5 geometry (face-detail spec §4.1, §4.2, §4.4)', () => {
  for (const [name, face] of [
    ['fixture', fixture],
    ['mirrored', mirrored],
  ] as const) {
    const fw = faceWidthIso(face, FA);
    const g = reshapeGeometry(face, FA, U5(NEW_AT_MAX));
    const P = face.pts111;

    it(`${name}: face axes are orthonormal, m̂ toward the chin, r̂ from the GPUPixel-left eye to the right eye`, () => {
      const [rx, ry, mx, my] = g.axes;
      expect(len(rx, ry)).toBeCloseTo(1, 12);
      expect(len(mx, my)).toBeCloseTo(1, 12);
      expect(rx * mx + ry * my).toBeCloseTo(0, 12);
      const [ax, ay] = isoOf(P, 74);
      const [bx, by] = isoOf(P, 77);
      expect(rx * (bx - ax) + ry * (by - ay)).toBeGreaterThan(0);
      expect(my).toBeGreaterThan(0.9);
    });

    it(`${name}: jaw targets 0.22 FW from the contour, inward; temple targets 0.12 FW, outward`, () => {
      JAW.forEach((i, k) => {
        const [px, py] = isoOf(P, i);
        const [tx, ty] = isoOf(g.jawTargets, k);
        expect(len(tx - px, ty - py)).toBeCloseTo(0.22 * fw, 6);
        const [nx, ny] = isoOf(P, 46);
        expect((tx - px) * (nx - px) + (ty - py) * (ny - py)).toBeGreaterThan(0);
      });
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < 36; k++) {
        cx += face.oval[k * 2] / 36;
        cy += face.oval[k * 2 + 1] / FA / 36;
      }
      TEMPLE.forEach((_, k) => {
        const [ox, oy] = isoOf(g.templeAnchors, k);
        const [tx, ty] = isoOf(g.templeTargets, k);
        expect(len(tx - ox, ty - oy)).toBeCloseTo(0.12 * fw, 6);
        expect(len(tx - cx, ty - cy)).toBeGreaterThan(len(ox - cx, oy - cy));
      });
    });

    it(`${name}: 髮際線 moves down by 0.09·FH, 嘴高 up by 0.18·L, 鼻翼 −0.10·s·(p81 − p80), 山根 k = 0.3`, () => {
      const fh = len(face.ext[0] - face.ext[4], (face.ext[1] - face.ext[5]) / FA);
      expect(len(g.hairlineDisp[0], g.hairlineDisp[1] / FA)).toBeCloseTo(0.09 * fh, 9);
      expect(g.hairlineDisp[1]).toBeGreaterThan(0);
      expect(g.hairlineRadii.map((r) => r / fh)).toEqual([expect.closeTo((0.4 * fw) / fh, 9), expect.closeTo(0.5, 9), expect.closeTo(0.55, 9)]);
      const L = len(P[212] - P[98], (P[213] - P[99]) / FA);
      expect(len(g.mouthHDisp[0], g.mouthHDisp[1] / FA)).toBeCloseTo(0.18 * L, 9);
      expect(g.mouthHDisp[1]).toBeLessThan(0);
      expect(g.mouthHRadii[1]).toBeCloseTo(L, 12);
      expect(g.mouthHRadii[2]).toBeCloseTo(1.6 * L, 12);
      expect(g.noseWingDisp[0]).toBeCloseTo(-0.1 * (P[162] - P[160]), 9);
      expect(g.noseWingR).toBeCloseTo(0.55 * len(P[162] - P[160], (P[163] - P[161]) / FA), 12);
      expect(g.rootK).toBeCloseTo(0.3, 12);
      expect(g.root[2]).toBeGreaterThan(0.01 * fw);
      expect(g.root[3]).toBeGreaterThan(0.01 * fw);
      expect([g.hairlineS, g.mouthHS, g.noseWingS].map((v) => +v.toFixed(9))).toEqual([0.09, 0.18, 0.1]);
    });

    it(`${name}: the influence box holds every new anchor, and is unchanged while the new items are neutral`, () => {
      for (let k = 0; k < 10; k++) expect(inBox(g.box, g.jawTargets[k * 2], g.jawTargets[k * 2 + 1])).toBe(true);
      for (let k = 0; k < 6; k++) expect(inBox(g.box, g.templeAnchors[k * 2], g.templeAnchors[k * 2 + 1])).toBe(true);
      for (const i of [80, 81, 106]) expect(inBox(g.box, P[i * 2], P[i * 2 + 1])).toBe(true);
      expect(inBox(g.box, face.ext[0], face.ext[1])).toBe(true);
      expect(inBox(g.box, g.root[0], g.root[1])).toBe(true);
      // 左右分開 on with equal sides keeps the box (the R strengths only widen it when they differ)
      const same = Object.fromEntries(SPLIT_IDS.map((id) => [id, { ...NEUTRAL, ...V03_AT_MAX }[id]]));
      expect(reshapeGeometry(face, FA, U5(V03_AT_MAX, same)).box).toEqual(reshapeGeometry(face, FA, U5(V03_AT_MAX)).box);
      const idle = reshapeGeometry(face, FA, U5());
      expect(idle.box[0]).toBeGreaterThan(idle.box[2]);
    });

    it(`${name}: every new warp's box lies inside the v0.3 U_MAX box and inside uMaxBox (S5 §4.4)`, () => {
      const v03 = reshapeGeometry(face, FA, U5(V03_AT_MAX)).box;
      const umax = uMaxBox(face, FA);
      for (const id of Object.keys(NEW_AT_MAX) as (keyof typeof NEW_AT_MAX)[]) {
        for (const v of id === 'shape.jawline' ? [1] : [0, 1]) {
          const b = reshapeGeometry(face, FA, U5({ [id]: v })).box;
          expect(boxIn(b, v03), `${id}=${v}`).toBe(true);
          expect(boxIn(b, umax), `${id}=${v}`).toBe(true);
        }
      }
    });
  }

  it('degenerate faces switch the item off instead of producing NaN (thin 山根 band, p106 on p49, ext[0] on ext[2])', () => {
    const f = { ...fixture, pts111: fixture.pts111.slice(), ext: fixture.ext.slice() };
    for (const i of [78, 79, 55, 58]) f.pts111.set([0.45, 0.35], i * 2);
    f.pts111.set([f.pts111[98], f.pts111[99]], 106 * 2);
    f.ext.set([f.ext[4], f.ext[5]], 0);
    const g = reshapeGeometry(f, FA, U5(NEW_AT_MAX));
    expect([g.rootK, g.mouthHS, g.hairlineS]).toEqual([0, 0, 0]);
    const all = [...g.axes, ...g.jawTargets, ...g.templeAnchors, ...g.templeTargets, ...g.hairlineDisp, ...g.mouthHDisp, ...g.mouthHAxis, ...g.noseWingDisp, ...g.root, g.rootRy, g.noseWingR, ...g.hairlineRadii, ...g.mouthHRadii];
    for (const v of all) expect(Number.isFinite(v)).toBe(true);
  });

  it('packFaceDetail fills texels 70–71 and 75–95 and leaves 0–69 and 72–74 alone', () => {
    const u = U5({ ...NEW_AT_MAX, 'shape.faceSlim': 0.5 }, { 'shape.faceSlim': 0.8, 'shape.jawline': 0.4 });
    const g = reshapeGeometry(fixture, FA, u);
    const row = new Float32Array(96 * 4).fill(7);
    packFaceDetail(row, u, g);
    const t = (i: number) => Array.from(row.subarray(i * 4, i * 4 + 4));
    for (let i = 0; i < 70; i++) expect(t(i)).toEqual([7, 7, 7, 7]);
    for (const i of [72, 73, 74]) expect(t(i)).toEqual([7, 7, 7, 7]);
    const f32 = (xs: number[]) => xs.map((x) => Math.fround(x));
    expect(t(70)).toEqual(f32([u.faceSlimR, u.faceVR, u.faceNarrowR, u.eyeEnlargeR]));
    expect(t(71)).toEqual(f32([u.jawlineR, u.templeR, 0, 0]));
    expect(t(75)).toEqual(f32([u.jawline, u.temple, g.hairlineS, g.noseWingS]));
    expect(t(76)).toEqual(f32([g.rootK, g.mouthHS, 0, 0]));
    expect(Array.from(row.subarray(77 * 4, 82 * 4))).toEqual(Array.from(g.jawTargets));
    expect(Array.from(row.subarray(82 * 4, 85 * 4))).toEqual(Array.from(g.templeAnchors));
    expect(Array.from(row.subarray(85 * 4, 88 * 4))).toEqual(Array.from(g.templeTargets));
    expect(t(88)).toEqual(f32(g.axes));
    expect(t(89)).toEqual(f32([...g.hairlineRadii, 0]));
    expect(t(90)).toEqual(f32([...g.hairlineDisp, ...g.mouthHDisp]));
    expect(t(91)).toEqual(f32([...g.mouthHRadii, 0]));
    expect(t(92)).toEqual(f32([...g.mouthHAxis, 0, 0]));
    expect(t(93)).toEqual(f32([g.noseWingR, ...g.noseWingDisp, 0]));
    expect(t(94)).toEqual(f32(g.root));
    expect(t(95)).toEqual(f32([g.rootRy, 0, 0, 0]));
  });
});
