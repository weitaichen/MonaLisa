import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../../tracking/adapter111';
import type { Face } from '../../types';
import {
  crescentGeometry,
  dist,
  earOf,
  eyeOpen,
  faceFrame,
  farSide,
  isoPt,
  mouthOpen,
  nasolabialGeometry,
  resampleChain,
  sideFade,
  teethGate,
  type V2,
} from './toneGeometry';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const ASPECT = lm.width / lm.height;
const FACE = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);

/**
 * The same face seen in a mirror: x → 1 − x, with the image-left and image-right GPUPixel indices swapped (only the
 * indices toneGeometry and buildMaskGeometry read) and the yaw negated.
 */
function mirrorFace(f: Face): Face {
  const pairs: [number, number][] = [
    [52, 61], [53, 60], [54, 59], [55, 58], [56, 63], [57, 62], [72, 75], [73, 76], [74, 77], [82, 83],
    [84, 90], [85, 89], [86, 88], [91, 95], [92, 94], [96, 100], [97, 99], [101, 103], [104, 105],
  ];
  const map = Array.from({ length: 111 }, (_, i) => i);
  for (let i = 0; i <= 32; i++) map[i] = 32 - i;
  for (const [a, b] of pairs) {
    map[a] = b;
    map[b] = a;
  }
  const pts111 = new Float32Array(222);
  for (let i = 0; i < 111; i++) {
    pts111[i * 2] = 1 - f.pts111[map[i] * 2];
    pts111[i * 2 + 1] = f.pts111[map[i] * 2 + 1];
  }
  const ext = new Float32Array(16);
  const extMap = [0, 1, 2, 3, 4, 5, 7, 6];
  for (let i = 0; i < 8; i++) {
    ext[i * 2] = 1 - f.ext[extMap[i] * 2];
    ext[i * 2 + 1] = f.ext[extMap[i] * 2 + 1];
  }
  const n = f.oval.length / 2;
  const oval = new Float32Array(f.oval.length);
  for (let i = 0; i < n; i++) {
    oval[i * 2] = 1 - f.oval[(n - 1 - i) * 2];
    oval[i * 2 + 1] = f.oval[(n - 1 - i) * 2 + 1];
  }
  return { pts111, ext, oval, yaw: -f.yaw };
}

/** every vertex of `a`, mirrored (x → 1 − x), matches a distinct vertex of `b` within `tol` (position and value) */
function sameMirroredVertices(a: Float32Array, b: Float32Array, tol = 1e-6): boolean {
  if (a.length !== b.length) return false;
  const used = new Uint8Array(b.length / 3);
  for (let i = 0; i < a.length; i += 3) {
    const x = 1 - a[i];
    let found = -1;
    for (let j = 0; j < b.length; j += 3) {
      if (used[j / 3]) continue;
      if (Math.abs(b[j] - x) <= tol && Math.abs(b[j + 1] - a[i + 1]) <= tol && Math.abs(b[j + 2] - a[i + 2]) <= tol) {
        found = j / 3;
        break;
      }
    }
    if (found < 0) return false;
    used[found] = 1;
  }
  return true;
}

const iso = (x: number, y: number): V2 => [x, y / ASPECT];
function verts(g: Float32Array): { p: V2; v: number }[] {
  const out: { p: V2; v: number }[] = [];
  for (let i = 0; i < g.length; i += 3) out.push({ p: iso(g[i], g[i + 1]), v: g[i + 2] });
  return out;
}

/** the recorded face with the image-left eye's upper-mid point P72 placed so that EAR_L = `ear` */
function withEar(ear: number): Face {
  const f = { ...FACE, pts111: new Float32Array(FACE.pts111) };
  const fr = faceFrame(FACE, ASPECT);
  const p73 = isoPt(FACE, 73, ASPECT);
  const w = fr.eyeW.L;
  f.pts111[72 * 2] = p73[0] - fr.yhat[0] * ear * w;
  f.pts111[72 * 2 + 1] = (p73[1] - fr.yhat[1] * ear * w) * ASPECT;
  return f;
}

describe('face frame and gates (skin-cleanup spec §4.2 notation)', () => {
  it('measures the recorded face: fw ≈ 589 px, mouth open 0.042, yaw −0.15 → image-left is the far side', () => {
    const f = faceFrame(FACE, ASPECT);
    expect(f.fw * lm.width).toBeCloseTo(588.8, 0);
    expect(mouthOpen(FACE, ASPECT)).toBeCloseTo(0.0424, 3);
    expect(farSide(FACE)).toBe('L');
    expect(f.yhat[1]).toBeGreaterThan(0.9); // ŷ points to the chin (down)
    expect(Math.abs(f.xhat[0] * f.yhat[0] + f.xhat[1] * f.yhat[1])).toBeLessThan(1e-12);
  });

  it('eyeOpen, teethGate and the far-side fade are monotonic with the stated thresholds', () => {
    const opens = [0, 0.05, 0.1, 0.12, 0.15, 0.18, 0.3].map((e) => eyeOpen(withEar(e), 'L', ASPECT));
    for (let i = 1; i < opens.length; i++) expect(opens[i]).toBeGreaterThanOrEqual(opens[i - 1]);
    expect(eyeOpen(withEar(0.12), 'L', ASPECT)).toBeCloseTo(0, 6);
    expect(eyeOpen(withEar(0.18), 'L', ASPECT)).toBeCloseTo(1, 5);
    expect(earOf(withEar(0.15), 'L', ASPECT)).toBeCloseTo(0.15, 5);
    expect(teethGate(FACE, ASPECT)).toBe(1); // 0.042 > 0.03
    const fades = [0, 0.2, 0.25, 0.3, 0.4, 0.5, 0.8].map((y) => sideFade({ ...FACE, yaw: y }, 'R'));
    for (let i = 1; i < fades.length; i++) expect(fades[i]).toBeLessThanOrEqual(fades[i - 1]);
    expect(sideFade({ ...FACE, yaw: 0.5 }, 'R')).toBe(0);
    expect(sideFade({ ...FACE, yaw: 0.5 }, 'L')).toBe(1); // the near side is never faded
  });

  it('resamples a chain by arc length, endpoints included', () => {
    expect(resampleChain([[0, 0], [1, 0], [1, 2]], 4)).toEqual([[0, 0], [1, 0], [1, 1], [1, 2]]);
  });
});

describe('crescents and nasolabial bands', () => {
  it('crescent rows lie below the lower lid along ŷ, the top row ≥ 0.05 eyeW from the lid', () => {
    const fr = faceFrame(FACE, ASPECT);
    const t = (q: V2) => q[0] * fr.xhat[0] + q[1] * fr.xhat[1];
    for (const [side, chain] of [['L', [52, 57, 73, 56, 55]], ['R', [61, 62, 76, 63, 58]]] as const) {
      const lid = chain.map((i) => isoPt(FACE, i, ASPECT));
      const w = fr.eyeW[side];
      let checked = 0;
      for (const { p } of verts(crescentGeometry(FACE, side, ASPECT))) {
        const tp = t(p);
        for (let i = 0; i + 1 < lid.length; i++) {
          const a = lid[i];
          const b = lid[i + 1];
          if (tp < Math.min(t(a), t(b)) - 1e-12 || tp > Math.max(t(a), t(b)) + 1e-12 || t(a) === t(b)) continue;
          const f = (tp - t(a)) / (t(b) - t(a));
          const q: V2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
          expect((p[0] - q[0]) * fr.yhat[0] + (p[1] - q[1]) * fr.yhat[1]).toBeGreaterThanOrEqual(0.05 * w);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(30);
    }
  });

  it('each nasolabial band lies inside the box of P(82|83) and P(84|90) grown by 0.1 fw', () => {
    const fw = faceFrame(FACE, ASPECT).fw;
    for (const [side, a, b] of [['L', 82, 84], ['R', 83, 90]] as const) {
      const pa = isoPt(FACE, a, ASPECT);
      const pb = isoPt(FACE, b, ASPECT);
      for (const { p } of verts(nasolabialGeometry(FACE, side, ASPECT))) {
        expect(p[0]).toBeGreaterThanOrEqual(Math.min(pa[0], pb[0]) - 0.1 * fw);
        expect(p[0]).toBeLessThanOrEqual(Math.max(pa[0], pb[0]) + 0.1 * fw);
        expect(p[1]).toBeGreaterThanOrEqual(Math.min(pa[1], pb[1]) - 0.1 * fw);
        expect(p[1]).toBeLessThanOrEqual(Math.max(pa[1], pb[1]) + 0.1 * fw);
      }
    }
  });

  it('the mirrored face gives the mirrored geometry within 1e-6', () => {
    const m = mirrorFace(FACE);
    expect(sameMirroredVertices(crescentGeometry(FACE, 'L', ASPECT), crescentGeometry(m, 'R', ASPECT))).toBe(true);
    expect(sameMirroredVertices(crescentGeometry(FACE, 'R', ASPECT), crescentGeometry(m, 'L', ASPECT))).toBe(true);
    expect(sameMirroredVertices(nasolabialGeometry(FACE, 'L', ASPECT), nasolabialGeometry(m, 'R', ASPECT))).toBe(true);
  });

  it('a degenerate face (all points equal) gives finite, zero-area output', () => {
    const d: Face = { pts111: new Float32Array(222).fill(0.5), ext: new Float32Array(16).fill(0.5), oval: new Float32Array(72).fill(0.5), yaw: 0 };
    for (const g of [crescentGeometry(d, 'L', ASPECT), nasolabialGeometry(d, 'R', ASPECT)]) {
      for (const v of g) expect(Number.isFinite(v)).toBe(true);
      const vs = verts(g);
      for (let i = 0; i < vs.length; i += 3) {
        const [a, b, c] = [vs[i].p, vs[i + 1].p, vs[i + 2].p];
        expect(Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))).toBeLessThan(1e-12);
      }
    }
    expect(eyeOpen(d, 'L', ASPECT)).toBe(0);
    expect(dist([0, 0], [3, 4])).toBe(5);
  });
});
