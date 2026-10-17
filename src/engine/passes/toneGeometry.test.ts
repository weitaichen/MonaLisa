import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt, blankEyes } from '../../tracking/adapter111';
import type { Face } from '../../types';
import { rasterizeTone } from '../toneRaster.node';
import {
  centroid,
  crescentGeometry,
  dist,
  earOf,
  eyeGeometry,
  eyeOpen,
  faceFrame,
  farSide,
  foldChords,
  IDENTITY_WIN,
  isoPt,
  mouthGeometry,
  mouthGuards,
  mouthOpen,
  nasolabialGeometry,
  NEUTRAL_TONE,
  Q_CLEAR,
  R_CLEAR,
  resampleChain,
  sideFade,
  smoothstep,
  teethGate,
  toneDrawsQ,
  toneDrawsR,
  toneValuesOf,
  TONE_ZERO,
  warmRingWidth,
  type Rgba,
  type ToneDraw,
  type ToneFaceInput,
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
  // iris / lids: x → 1 − x with the two eyes' halves swapped
  const swapEyes = (a: Float32Array) => a.map((_, i) => (i % 2 === 0 ? 1 - a[(i + a.length / 2) % a.length] : a[(i + a.length / 2) % a.length]));
  return { pts111, ext, oval, yaw: -f.yaw, iris: swapEyes(f.iris), lids: swapEyes(f.lids) };
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

  it('a nasolabial band is at full strength over its inner half (±h/2) and falls to 0 at ±h (S §4.2)', () => {
    // the fold reference lifts only a valley across the band, so the band need not guess the fold line: a fold 0.3 h
    // off the centre row keeps the full strength
    const W = 1000;
    const H = Math.round(W / ASPECT);
    const r = rasterizeTone(toneDrawsR([{ face: FACE, values: { ...NEUTRAL_TONE, nasolabial: 1 }, weight: 1, cap: null }], ASPECT), W, H, IDENTITY_WIN, R_CLEAR);
    const f = faceFrame(FACE, ASPECT);
    for (const [side, i0, i1, o] of [['L', 82, 84, -1], ['R', 83, 90, 1]] as const) {
      const at = (i: number, a: number, y: number): V2 => {
        const p = isoPt(FACE, i, ASPECT);
        return [p[0] + o * f.xhat[0] * a * f.fw + f.yhat[0] * y * f.fw, p[1] + o * f.xhat[1] * a * f.fw + f.yhat[1] * y * f.fw];
      };
      const S = at(i0, 0.04, -0.01);
      const E = at(i1, 0.06, 0.05);
      const C: V2 = [(S[0] + E[0]) / 2 + o * f.xhat[0] * 0.035 * f.fw, (S[1] + E[1]) / 2 + o * f.xhat[1] * 0.035 * f.fw];
      // t = ½: the curve's point and its normal (the tangent there is E − S), h = 0.035 fw
      const p: V2 = [(S[0] + 2 * C[0] + E[0]) / 4, (S[1] + 2 * C[1] + E[1]) / 4];
      const l = dist(S, E);
      const n: V2 = [-(E[1] - S[1]) / l, (E[0] - S[0]) / l];
      const h = 0.035 * f.fw;
      const g = (s: number) => {
        const q: V2 = [p[0] + n[0] * s * h, p[1] + n[1] * s * h];
        return r[(Math.floor(q[1] * W) * W + Math.floor(q[0] * W)) * 4 + 1];
      };
      for (const s of [0, 0.3, -0.3, 0.45, -0.45]) expect(g(s), `${side} ${s}`).toBe(1);
      for (const s of [0.75, -0.75]) expect(Math.abs(g(s) - 0.5), `${side} ${s}`).toBeLessThan(0.1);
      for (const s of [1.1, -1.1]) expect(g(s), `${side} ${s}`).toBe(0);
    }
  });

  it('the mirrored face gives the mirrored geometry within 1e-6', () => {
    const m = mirrorFace(FACE);
    expect(sameMirroredVertices(crescentGeometry(FACE, 'L', ASPECT), crescentGeometry(m, 'R', ASPECT))).toBe(true);
    expect(sameMirroredVertices(crescentGeometry(FACE, 'R', ASPECT), crescentGeometry(m, 'L', ASPECT))).toBe(true);
    expect(sameMirroredVertices(nasolabialGeometry(FACE, 'L', ASPECT), nasolabialGeometry(m, 'R', ASPECT))).toBe(true);
  });

  it('a degenerate face (all points equal) gives finite, zero-area output', () => {
    const d: Face = { pts111: new Float32Array(222).fill(0.5), ext: new Float32Array(16).fill(0.5), oval: new Float32Array(72).fill(0.5), yaw: 0, ...blankEyes() };
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

const area2 = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function triangles(g: Float32Array): { a: V2; b: V2; c: V2; v: number[] }[] {
  const out: { a: V2; b: V2; c: V2; v: number[] }[] = [];
  for (let i = 0; i < g.length; i += 9) out.push({ a: iso(g[i], g[i + 1]), b: iso(g[i + 3], g[i + 4]), c: iso(g[i + 6], g[i + 7]), v: [g[i + 2], g[i + 5], g[i + 8]] });
  return out;
}
/** every triangle has a non-zero area and they all share one orientation (nothing folds) */
function noFold(g: Float32Array): boolean {
  const s = triangles(g).map((t) => area2(t.a, t.b, t.c));
  return s.every((x) => Math.abs(x) > 1e-14) && (s.every((x) => x > 0) || s.every((x) => x < 0));
}
/** the recorded face with the image-left eye squeezed to EAR `ear` and the inner lips closed to mouthOpen `open` */
function squint(ear: number, open: number): Face {
  const f = { ...FACE, pts111: new Float32Array(FACE.pts111) };
  const fr = faceFrame(FACE, ASPECT);
  const squeeze = (ids: number[], centre: V2, k: number) => {
    for (const i of ids) {
      const p = isoPt(FACE, i, ASPECT);
      const along = (p[0] - centre[0]) * fr.yhat[0] + (p[1] - centre[1]) * fr.yhat[1];
      f.pts111[i * 2] = p[0] - fr.yhat[0] * along * (1 - k);
      f.pts111[i * 2 + 1] = (p[1] - fr.yhat[1] * along * (1 - k)) * ASPECT;
    }
  };
  squeeze([53, 72, 54, 56, 73, 57], isoPt(FACE, 74, ASPECT), ear / earOf(FACE, 'L', ASPECT));
  const a = isoPt(FACE, 98, ASPECT);
  const b = isoPt(FACE, 102, ASPECT);
  squeeze([97, 98, 99, 101, 102, 103], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], open / mouthOpen(FACE, ASPECT));
  return f;
}

describe('mouth and eye fans', () => {
  it('the value-1 area of the mouth equals the inner-lip polygon within 1 %', () => {
    const poly = [96, 97, 98, 99, 100, 101, 102, 103].map((i) => isoPt(FACE, i, ASPECT));
    let shoelace = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      shoelace += p[0] * q[1] - q[0] * p[1];
    }
    const polyArea = Math.abs(shoelace) / 2;
    const fan = triangles(mouthGeometry(FACE, ASPECT)).filter((t) => t.v.every((v) => v === 1));
    const fanArea = fan.reduce((s, t) => s + Math.abs(area2(t.a, t.b, t.c)) / 2, 0);
    expect(Math.abs(fanArea - polyArea) / polyArea).toBeLessThan(0.01);
  });

  it('a squint (EAR 0.15) and an almost closed mouth (0.01) still give positive-area, unfolded triangles', () => {
    const f = squint(0.15, 0.01);
    expect(earOf(f, 'L', ASPECT)).toBeCloseTo(0.15, 2);
    expect(mouthOpen(f, ASPECT)).toBeCloseTo(0.01, 2);
    expect(noFold(eyeGeometry(f, 'L', ASPECT))).toBe(true);
    expect(noFold(mouthGeometry(f, ASPECT))).toBe(true);
    expect(noFold(eyeGeometry(FACE, 'R', ASPECT))).toBe(true);
  });

  it('the mirrored face gives the mirrored fans', () => {
    const m = mirrorFace(FACE);
    expect(sameMirroredVertices(eyeGeometry(FACE, 'L', ASPECT), eyeGeometry(m, 'R', ASPECT))).toBe(true);
    expect(sameMirroredVertices(mouthGeometry(FACE, ASPECT), mouthGeometry(m, ASPECT))).toBe(true);
  });
});

describe('膚色 ring width w_T', () => {
  const fw = faceFrame(FACE, ASPECT).fw;
  const ovalIso = (): V2[] => Array.from({ length: FACE.oval.length / 2 }, (_, i): V2 => [FACE.oval[i * 2], FACE.oval[i * 2 + 1] / ASPECT]);
  const boxCentre = (): V2 => {
    const xs = ovalIso().map((p) => p[0]);
    const ys = ovalIso().map((p) => p[1] * ASPECT);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  };

  it('is 0.30 fw for a lone face (no cap, or cap −1)', () => {
    expect(warmRingWidth(FACE, ASPECT, null)).toBeCloseTo(0.3 * fw, 12);
    expect(warmRingWidth(FACE, ASPECT, { c: [0.5, 0.5], r: -1 })).toBeCloseTo(0.3 * fw, 12);
  });

  it('shrinks toward 0.08 fw as a neighbour comes close, and never passes the midpoint when there is room', () => {
    const c = boxCentre();
    const cIso: V2 = [c[0], c[1] / ASPECT];
    const rOval = Math.max(...ovalIso().map((p) => dist(p, cIso)));
    let prev = Infinity;
    for (const gapFw of [3, 2.5, 2, 1.6, 1.3, 1.1]) {
      const cap = { c, r: (gapFw * fw) / 2 };
      const w = warmRingWidth(FACE, ASPECT, cap);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      expect(w).toBeGreaterThanOrEqual(0.08 * fw - 1e-12);
      if (cap.r - rOval >= 0.08 * fw) expect(rOval + w).toBeLessThanOrEqual(cap.r + 1e-12);
      prev = w;
    }
  });
});

/** the face moved by `dx` (uv) along the image x axis */
function shiftedFace(f: Face, dx: number): Face {
  const move = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? v + dx : v));
  return { pts111: move(f.pts111), ext: move(f.ext), oval: move(f.oval), yaw: f.yaw, iris: move(f.iris), lids: move(f.lids) };
}
const ovalOf = (f: Face): V2[] => Array.from({ length: f.oval.length / 2 }, (_, i) => iso(f.oval[i * 2], f.oval[i * 2 + 1]));
function inPolygon(p: V2, poly: readonly V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** iso distance from `p` to the closed polygon's outline */
function polygonDist(p: V2, poly: readonly V2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab: V2 = [b[0] - a[0], b[1] - a[1]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1];
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
    d = Math.min(d, dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
  }
  return d;
}
/**
 * What a draw list leaves at iso point `p`, from `clear`: every triangle that covers `p` blends its fragment
 * off + str · smoothstep(0, 1, value) into the masked channels, in ascending phase, then list order (as toneMask.ts).
 */
function drawsAt(draws: readonly ToneDraw[], p: V2, clear: Rgba): number[] {
  const acc = [...clear];
  const order = draws.map((d, i) => ({ d, i })).sort((a, b) => a.d.phase - b.d.phase || a.i - b.i);
  for (const { d } of order)
    for (const t of triangles(d.verts)) {
      const s = area2(t.a, t.b, t.c);
      if (Math.abs(s) < 1e-18) continue;
      const l = [area2(p, t.b, t.c) / s, area2(t.a, p, t.c) / s, area2(t.a, t.b, p) / s];
      if (l.some((x) => x < -1e-12)) continue;
      const m = smoothstep(0, 1, l[0] * t.v[0] + l[1] * t.v[1] + l[2] * t.v[2]);
      for (let ch = 0; ch < 4; ch++) {
        if (!d.mask[ch]) continue;
        const out = d.off[ch] + d.str[ch] * m;
        acc[ch] = d.blend === 'max' ? Math.max(acc[ch], out) : Math.min(acc[ch], out);
      }
    }
  return acc;
}

describe('R and Q draw lists', () => {
  const one = (values = NEUTRAL_TONE, face = FACE): ToneFaceInput[] => [{ face, values, weight: 1, cap: null }];

  it('neutral values draw nothing into R; Q always carries the skin coverage (G = 1)', () => {
    expect(toneDrawsR(one(), ASPECT)).toEqual([]);
    expect(toneDrawsQ(one(), ASPECT).map((d) => [d.phase, d.blend, d.str[1]])).toEqual([
      [0, 'max', 1],
      [1, 'min', 1],
      [2, 'max', 1],
      [3, 'min', 1],
    ]);
  });

  it("a neighbour's 勻膚 ring never lifts a neutral face's oval (C §4.1: its skin mask writes 0), in either list order", () => {
    const xs = Array.from({ length: FACE.oval.length / 2 }, (_, i) => FACE.oval[i * 2]);
    const fw = faceFrame(FACE, ASPECT).fw;
    const ovalA = ovalOf(FACE);
    const A: ToneFaceInput = { face: FACE, values: { ...NEUTRAL_TONE, even: 1 }, weight: 1, cap: null };
    const ringA = toneDrawsQ([A], ASPECT).filter((d) => d.phase === 0); // A's 8 % fw ring alone
    // B = the face moved by its oval width (the bounding boxes touch; the ovals come within ≈ 0.03 fw), then 0.03 fw further
    for (const [gap, reach] of [[0, 0.5], [0.03, 0.1]] as const) {
      const B = shiftedFace(FACE, Math.max(...xs) - Math.min(...xs) + gap * fw);
      const ovalB = ovalOf(B);
      const N: ToneFaceInput = { face: B, values: NEUTRAL_TONE, weight: 1, cap: null };
      const soloB = toneDrawsQ([N], ASPECT);
      // the points of B's oval within 0.08 fw of A's oval that A's ring lifts (and no hole of B's lowers)
      const near: V2[] = [];
      const x0 = Math.min(...ovalB.map((p) => p[0]));
      for (let x = x0; x <= x0 + 0.08 * fw; x += 0.002 * fw)
        for (let y = Math.min(...ovalB.map((p) => p[1])); y <= Math.max(...ovalB.map((p) => p[1])); y += 0.002 * fw) {
          const p: V2 = [x, y];
          if (!inPolygon(p, ovalB) || polygonDist(p, ovalA) >= 0.08 * fw) continue;
          if (drawsAt(ringA, p, Q_CLEAR)[0] > 0.02 && drawsAt(soloB, p, Q_CLEAR)[1] === 1) near.push(p);
        }
      expect(near.length).toBeGreaterThan(10);
      expect(Math.max(...near.map((p) => drawsAt(ringA, p, Q_CLEAR)[0]))).toBeGreaterThan(reach);
      for (const list of [[A, N], [N, A]]) {
        const draws = toneDrawsQ(list, ASPECT);
        for (const p of near) {
          const q = drawsAt(draws, p, Q_CLEAR);
          expect(q[0]).toBe(0);
          expect(q[1]).toBe(1);
        }
      }
    }
  });

  it('inside its own oval a face writes its own 勻膚 strength; where two ovals overlap the stronger face wins', () => {
    const xs = Array.from({ length: FACE.oval.length / 2 }, (_, i) => FACE.oval[i * 2]);
    const B = shiftedFace(FACE, 0.5 * (Math.max(...xs) - Math.min(...xs)));
    const fw = faceFrame(FACE, ASPECT).fw;
    const mid = centroid(ovalOf(FACE));
    // a point inside both ovals and 0.15 fw from every eye and lip point of both faces (no hole reaches it)
    const features = [FACE, B].flatMap((f) => [...Array.from({ length: 12 }, (_, i) => 52 + i), ...Array.from({ length: 20 }, (_, i) => 84 + i)].map((i) => isoPt(f, i, ASPECT)));
    let both: V2 | null = null;
    for (let x = mid[0] - fw; x <= mid[0] + 2 * fw && !both; x += 0.01 * fw)
      for (let y = mid[1] - fw; y <= mid[1] + fw && !both; y += 0.01 * fw) {
        const p: V2 = [x, y];
        if (inPolygon(p, ovalOf(FACE)) && inPolygon(p, ovalOf(B)) && Math.min(...features.map((q) => dist(p, q))) > 0.15 * fw) both = p;
      }
    if (!both) throw new Error('no point inside both ovals clear of the holes');
    const A: ToneFaceInput = { face: FACE, values: { ...NEUTRAL_TONE, even: 0.3 }, weight: 1, cap: null };
    const S: ToneFaceInput = { face: B, values: { ...NEUTRAL_TONE, even: 0.8 }, weight: 1, cap: null };
    for (const list of [[A, S], [S, A]]) {
      const draws = toneDrawsQ(list, ASPECT);
      expect(drawsAt(draws, both, Q_CLEAR)[0]).toBeCloseTo(0.8, 12);
      expect(drawsAt(draws, both, Q_CLEAR)[1]).toBe(1);
    }
    // a lone face: its strength inside, 0 well outside the ring
    const lone = toneDrawsQ([A], ASPECT);
    const p = centroid(ovalOf(FACE).slice(0, 4));
    expect(inPolygon(p, ovalOf(FACE))).toBe(true);
    expect(drawsAt(lone, p, Q_CLEAR)[0]).toBeCloseTo(0.3, 12);
    expect(drawsAt(lone, [mid[0] + 2, mid[1]], Q_CLEAR)).toEqual([...Q_CLEAR]);
  });

  it('each tool writes only its own R channel, scaled by its gates', () => {
    const v = { ...NEUTRAL_TONE, darkCircle: 1, nasolabial: 1, teeth: 1, eyeBright: 1 };
    const draws = toneDrawsR(one(v), ASPECT);
    for (const d of draws) {
      expect(d.blend).toBe('max');
      expect(d.str.filter((s) => s > 0)).toHaveLength(1);
    }
    expect(Math.max(...draws.map((d) => d.str[2]))).toBe(1); // 白牙: mouth open 0.042 → gate 1; |yaw| < 0.25 → no fade
    const closed = toneDrawsR(one(v, squint(0.1, 0.005)), ASPECT);
    expect(closed.some((d) => d.str[2] > 0)).toBe(false); // 白牙 off on a closed mouth
    expect(closed.filter((d) => d.str[3] > 0)).toHaveLength(1); // 亮眼 only on the open image-right eye
  });

  it("白牙's lip guard lists exactly the faces whose 白牙 region R draws: the inner-lip ring 96–103 (iso) and mouthW", () => {
    const v = { ...NEUTRAL_TONE, teeth: 0.6 };
    const g = mouthGuards(one(v), ASPECT);
    expect(g.aspect).toBe(ASPECT);
    expect(g.mouths).toHaveLength(1);
    expect(g.mouths[0].ring).toEqual([96, 97, 98, 99, 100, 101, 102, 103].map((i) => isoPt(FACE, i, ASPECT)));
    expect(g.mouths[0].mouthW).toBe(faceFrame(FACE, ASPECT).mouthW);
    // 白牙 0, a closed mouth (teethGate 0) or a weightless face: no R.B region, so no guard either
    expect(mouthGuards(one({ ...NEUTRAL_TONE, even: 1, eyeBright: 1 }), ASPECT).mouths).toEqual([]);
    expect(mouthGuards(one(v, squint(0.1, 0.005)), ASPECT).mouths).toEqual([]);
    expect(mouthGuards([{ face: FACE, values: v, weight: 0, cap: null }], ASPECT).mouths).toEqual([]);
    const two = [...one(v), { face: shiftedFace(FACE, 0.3), values: v, weight: 1, cap: null }];
    expect(mouthGuards(two, ASPECT).mouths).toHaveLength(toneDrawsR(two, ASPECT).filter((d) => d.str[2] > 0).length);
  });

  it("法令紋's fold reference lists exactly the bands R draws: each band's chord S → E (iso, S §4.2)", () => {
    const v = { ...NEUTRAL_TONE, nasolabial: 0.6 };
    const g = foldChords(one(v), ASPECT);
    const f = faceFrame(FACE, ASPECT);
    const at = (i: number, o: number, y: number): V2 => {
      const p = isoPt(FACE, i, ASPECT);
      const s = o * f.fw;
      return [p[0] + f.xhat[0] * s + f.yhat[0] * y * f.fw, p[1] + f.xhat[1] * s + f.yhat[1] * y * f.fw];
    };
    // image-left o = −x̂, image-right o = +x̂; S = P(82|83) + 0.04 fw·o − 0.01 fw·ŷ, E = P(84|90) + 0.06 fw·o + 0.05 fw·ŷ
    const want = [
      { s: at(82, -0.04, -0.01), e: at(84, -0.06, 0.05) },
      { s: at(83, 0.04, -0.01), e: at(90, 0.06, 0.05) },
    ];
    expect(g.chords).toHaveLength(2);
    g.chords.forEach((c, k) => {
      for (const [a, b] of [[c.s, want[k].s], [c.e, want[k].e]]) {
        expect(a[0]).toBeCloseTo(b[0], 12);
        expect(a[1]).toBeCloseTo(b[1], 12);
      }
    });
    // 法令紋 0, a weightless face or a fully faded far side: no R.G region, so no chord either
    expect(foldChords(one({ ...NEUTRAL_TONE, even: 1, darkCircle: 1 }), ASPECT).chords).toEqual([]);
    expect(foldChords([{ face: FACE, values: v, weight: 0, cap: null }], ASPECT).chords).toEqual([]);
    const turned = { ...FACE, yaw: -0.6 };
    expect(foldChords(one(v, turned), ASPECT).chords).toHaveLength(toneDrawsR(one(v, turned), ASPECT).filter((d) => d.str[1] > 0).length);
    expect(foldChords(one(v, turned), ASPECT).chords).toHaveLength(1);
    const two = [...one(v), { face: shiftedFace(FACE, 0.3), values: v, weight: 1, cap: null }];
    expect(foldChords(two, ASPECT).chords).toHaveLength(toneDrawsR(two, ASPECT).filter((d) => d.str[1] > 0).length);
  });

  it('膚色: a warm face draws MAX, then MIN holes into B around TONE_ZERO; a cool face the opposite', () => {
    const warm = toneDrawsQ(one({ ...NEUTRAL_TONE, warmth: 1 }), ASPECT).filter((d) => d.mask[2]);
    expect(warm.map((d) => [d.phase, d.blend, d.off[2], d.str[2]])).toEqual([
      [2, 'max', TONE_ZERO, 0.5],
      [3, 'min', TONE_ZERO, 0.5],
    ]);
    const cool = toneDrawsQ(one({ ...NEUTRAL_TONE, warmth: 0 }), ASPECT).filter((d) => d.mask[2]);
    expect(cool.map((d) => [d.blend, d.str[2]])).toEqual([
      ['min', -0.5],
      ['max', -0.5],
    ]);
  });

  it('reads PersonParams values, turning junk into neutral and clamping to 0..1', () => {
    expect(toneValuesOf({ 'tone.even': 0.4, 'tone.warmth': Number.NaN, 'tone.teeth': 7 })).toEqual({ ...NEUTRAL_TONE, even: 0.4, teeth: 1 });
  });
});
