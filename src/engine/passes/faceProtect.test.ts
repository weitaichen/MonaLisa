// 瘦臉 background limit (reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②, acceptance) measured on the CPU port of the reshape
// shader (reshapeCpu.ts, pinned to the GPU by tests/e2e/faceProtect.spec.ts): with 瘦臉 + V臉 + 窄臉 at max, on the
// synthetic cheek-against-a-wall portrait and on sample_face with its recorded person mask,
//  - the displacement reaches at most about 0.6× as far outside the person as today (the report's 15 % FW target is not
//    reachable at full strength without folding or a 2.5x stretch: see reshape.ts PROTECT_REACH);
//  - the map stays fold-free with the wall stretched no more than PROTECT_SLOPE allows, the wall lines get no crease
//    sharper than today's warp already makes, and the cheek line still moves (almost) as far as today;
//  - the eyes / nose / mouth sample exactly what they sample today;
//  - with the contour sliders neutral the limit changes nothing at all.
import { describe, expect, it } from 'vitest';
import { MIN_DET } from '../../body/field';
import { type FaceScene, portraitScene, sampleFaceScene, sampleWallScene } from '../../body/faceScenes.node';
import { distanceOutside } from '../../body/mask';
import { analysisGrid, forwardMap, REF_EDGE, segmentBend } from '../../body/straightness';
import { syntheticPortrait } from '../../body/synthetic';
import type { Face, ParamId } from '../../types';
import { applyPreset, defaultParams, setParam } from '../params';
import { PROTECT_SLOPE, reshapeUniforms } from './reshape';
import { reshapeMapCpu, type UvMap } from './reshapeCpu';

const CONTOUR: ParamId[] = ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'];
const FEATURES: ParamId[] = ['shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance', 'shape.eyeEnlarge'];
const at = (ids: ParamId[], base = applyPreset('original', 1)) => ids.reduce((p, id) => setParam(p, id, 1), base).values;

/** shared with the straightness ratchet (body/straightness.test.ts), so both measure the same faces, masks and protects */
const SCENES = [portraitScene(), sampleFaceScene(), sampleWallScene()];

function fwPx(s: FaceScene): number {
  const P = s.face.pts111;
  return Math.hypot((P[0] - P[64]) * s.width, (P[1] - P[65]) * s.height);
}

/** eyes, nose and mouth outlines (GPUPixel 111) */
function featurePolys(face: Face): [number, number][][] {
  const P = face.pts111;
  const poly = (ids: number[]) => ids.map((i): [number, number] => [P[i * 2], P[i * 2 + 1]]);
  return [
    poly([52, 72, 53, 54, 55, 56, 73, 57]),
    poly([58, 59, 75, 60, 61, 62, 76, 63]),
    poly([43, 78, 80, 82, 47, 48, 49, 50, 51, 83, 81, 79]),
    poly([84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95]),
  ];
}
function inPoly(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

interface Measure {
  /** farthest point outside the person displaced by > 0.5 % FW, from the person, % FW */
  reachPctFW: number;
  /** smallest Jacobian determinant of the backward map (forward differences on the grid) */
  minDet: number;
  /** largest background magnification 1/σ_min − 1 outside the person, % */
  stretchPct: number;
}

/** on a half-resolution grid of the photo */
function measure(s: FaceScene, map: UvMap): Measure {
  const W = Math.round(s.width / 2);
  const H = Math.round(s.height / 2);
  const ins = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ins[y * W + x] = s.inside((x + 0.5) / W, (y + 0.5) / H) >= 0.5 ? 1 : 0;
  const dist = distanceOutside(ins, W, H);
  const FW = fwPx(s);
  let reach = 0;
  let minDet = Infinity;
  let stretch = 0;
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      const a = map(u, v);
      if (dist[y * W + x] > 0 && Math.hypot((a[0] - u) * s.width, (a[1] - v) * s.height) > 0.005 * FW) {
        reach = Math.max(reach, (dist[y * W + x] * s.width) / W);
      }
      const b = map(u + 1 / W, v);
      const c = map(u, v + 1 / H);
      // Jacobian in pixel units (both axes)
      const j00 = (b[0] - a[0]) * W;
      const j10 = ((b[1] - a[1]) * W * s.height) / s.width;
      const j01 = ((c[0] - a[0]) * H * s.width) / s.height;
      const j11 = (c[1] - a[1]) * H;
      const det = j00 * j11 - j01 * j10;
      minDet = Math.min(minDet, det);
      if (dist[y * W + x] > 0) {
        const S = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
        const smin = Math.sqrt(Math.max(0, (S - Math.sqrt(Math.max(0, S * S - 4 * det * det))) / 2));
        stretch = Math.max(stretch, smin > 1e-6 ? 1 / smin - 1 : 99);
      }
    }
  return { reachPctFW: +((100 * reach) / FW).toFixed(1), minDet: +minDet.toFixed(3), stretchPct: Math.round(100 * stretch) };
}

/** how far the cheek line (contour points 2..30, forward-mapped) moves with `map` relative to `free`: mean and min */
function cheekMove(s: FaceScene, map: UvMap, free: UvMap): { mean: number; min: number } {
  const P = s.face.pts111;
  const r: number[] = [];
  for (let i = 2; i <= 30; i++) {
    const f0 = forwardMap(free, P[i * 2], P[i * 2 + 1]);
    const f1 = forwardMap(map, P[i * 2], P[i * 2 + 1]);
    if (!f0 || !f1) continue;
    const m0 = Math.hypot((f0[0] - P[i * 2]) * s.width, (f0[1] - P[i * 2 + 1]) * s.height);
    const m1 = Math.hypot((f1[0] - P[i * 2]) * s.width, (f1[1] - P[i * 2 + 1]) * s.height);
    if (m0 > 0.01 * fwPx(s)) r.push(m1 / m0);
  }
  return { mean: +(r.reduce((a, b) => a + b, 0) / r.length).toFixed(3), min: +Math.min(...r).toFixed(3) };
}

/**
 * The sharpest turn (degrees) of a straight wall line, forward-mapped and walked in steps of 1 % FW: a crease shows as
 * a large turn within one step, a smooth bend as small ones. Vertical lines 0.02 … 0.4 FW outside both cheeks.
 */
function sharpestTurn(s: FaceScene, map: UvMap): number {
  const P = s.face.pts111;
  const FW = fwPx(s);
  const an = analysisGrid(s.inside, s.width, s.height);
  let worst = 0;
  for (const k of [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4])
    for (const [cx, sign] of [
      [P[14], -1],
      [P[50], 1],
    ]) {
      const u = cx + (sign * k * FW) / s.width;
      if (u <= 0 || u >= 1) continue;
      const n = Math.floor((0.96 * s.height) / (0.01 * FW));
      const pts: ([number, number] | null)[] = [];
      for (let i = 0; i <= n; i++) {
        const v = 0.02 + (0.96 * i) / n;
        const d = an.dist[Math.min(an.h - 1, Math.floor(v * an.h)) * an.w + Math.min(an.w - 1, Math.floor(u * an.w))];
        const f = d > 2 ? forwardMap(map, u, v) : null;
        pts.push(f ? [f[0] * s.width, f[1] * s.height] : null);
      }
      for (let i = 1; i + 1 < pts.length; i++) {
        const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
        if (!a || !b || !c) continue;
        let t = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]));
        if (t > Math.PI) t = 2 * Math.PI - t;
        worst = Math.max(worst, (t * 180) / Math.PI);
      }
    }
  return +worst.toFixed(1);
}

describe('瘦臉 background limit (FaceProtect) on the reshape map', () => {
  for (const s of SCENES) {
    const aspect = s.width / s.height;
    const u = reshapeUniforms(at(CONTOUR), 1);
    const free = reshapeMapCpu(s.face, u, aspect);
    const lim = reshapeMapCpu(s.face, u, aspect, null, s.protect);

    it(`${s.name}: 瘦臉 + V臉 + 窄臉 at max: about 0.6× today's reach, fold-free, bounded stretch, no creases, full cheek`, () => {
      const a = measure(s, free);
      const b = measure(s, lim);
      const cheek = cheekMove(s, lim, free);
      const turnFree = sharpestTurn(s, free);
      const turnLim = sharpestTurn(s, lim);
      console.log(
        `${s.name}: reach outside the person ${a.reachPctFW} → ${b.reachPctFW} % FW, min det ${a.minDet} → ${b.minDet}, ` +
          `wall stretch ${a.stretchPct} → ${b.stretchPct} %, sharpest wall-line turn ${turnFree} → ${turnLim}°, ` +
          `cheek line moves ${cheek.mean} (min ${cheek.min}) of today`,
      );
      // (sample_face's hair is person: its wall starts well outside the cheek and was never reached far)
      expect(b.reachPctFW).toBeLessThanOrEqual(a.reachPctFW > 30 ? Math.min(30, 0.6 * a.reachPctFW + 0.5) : a.reachPctFW);
      expect(b.minDet).toBeGreaterThanOrEqual(Math.max(MIN_DET, 1 - PROTECT_SLOPE - 0.02));
      expect(b.stretchPct).toBeLessThanOrEqual(Math.max(a.stretchPct, Math.round(100 * (1 / (1 - PROTECT_SLOPE) - 1))) + 3);
      // smooth budget + smooth minimum: no crease sharper than the unlimited warp's own (a linear budget with a tanh
      // knee made 24–30° turns per 1 % FW here)
      expect(turnLim).toBeLessThanOrEqual(turnFree + 1);
      expect(cheek.mean).toBeGreaterThan(0.9);
      if (s.name !== 'sample_face') expect(a.reachPctFW).toBeGreaterThan(40); // nothing shields the wall today
      // a turned face's far jaw, right against the wall, keeps the most of its V臉 the budget allows
      if (s.name === 'sample_wall') expect(cheek.min).toBeGreaterThan(0.7);
      if (s.name === 'portrait') {
        expect(cheek.min).toBeGreaterThan(0.95);
      }
    });

    it(`${s.name}: eyes / nose / mouth keep today's warp exactly; the limit only ever shortens the displacement`, () => {
      const polys = featurePolys(s.face);
      let feat = 0;
      let grew = 0;
      let turned = 0;
      const n = 240;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const uu = (x + 0.5) / n;
          const vv = (y + 0.5) / n;
          const f = free(uu, vv);
          const l = lim(uu, vv);
          if (polys.some((p) => inPoly(p, uu, vv))) {
            feat++;
            expect(l, `feature pixel ${uu},${vv}`).toEqual(f);
          }
          const gf = Math.hypot(f[0] - uu, (f[1] - vv) / aspect);
          const gl = Math.hypot(l[0] - uu, (l[1] - vv) / aspect);
          if (gl > gf + 1e-12) grew++;
          // same direction (or none at all): a turn either way (|cross|) or a reversal (dot < 0) counts
          const fx = f[0] - uu;
          const fy = (f[1] - vv) / aspect;
          const lx = l[0] - uu;
          const ly = (l[1] - vv) / aspect;
          const cross = fx * ly - fy * lx;
          const dot = fx * lx + fy * ly;
          if (gl > 1e-9 && (Math.abs(cross) > 1e-6 * gf * gl + 1e-15 || dot < 0)) turned++;
        }
      expect(feat).toBeGreaterThan(300);
      expect(grew).toBe(0);
      expect(turned).toBe(0);
    });

    it(`${s.name}: neutral contour sliders → the limit changes nothing (every other face warp at max)`, () => {
      const uf = reshapeUniforms(at(FEATURES), 1);
      const a = reshapeMapCpu(s.face, uf, aspect);
      const b = reshapeMapCpu(s.face, uf, aspect, null, s.protect);
      for (let y = 0; y < 100; y++)
        for (let x = 0; x < 100; x++) {
          const uu = (x + 0.5) / 100;
          const vv = (y + 0.5) / 100;
          expect(b(uu, vv)).toEqual(a(uu, vv));
        }
    });

    it(`${s.name}: the default preset (自然: light 瘦臉 / V臉 + eyes) keeps its features exactly and stays fold-free`, () => {
      const ud = reshapeUniforms(defaultParams().values, 1);
      const a = reshapeMapCpu(s.face, ud, aspect);
      const b = reshapeMapCpu(s.face, ud, aspect, null, s.protect);
      const polys = featurePolys(s.face);
      for (let y = 0; y < 200; y++)
        for (let x = 0; x < 200; x++) {
          const uu = (x + 0.5) / 200;
          const vv = (y + 0.5) / 200;
          if (polys.some((p) => inPoly(p, uu, vv))) expect(b(uu, vv)).toEqual(a(uu, vv));
        }
      expect(measure(s, b).minDet).toBeGreaterThanOrEqual(MIN_DET);
    });
  }

  // The limit shortens how far the cheek's displacement reaches, not how much it is: a wall line right at the cheek
  // still bends by about the cheek's own Δ⊥ (report: 臉頰旁的直線彎曲仍受同樣的 Δ⊥ 限制), now over a shorter run.
  it('the wall beside the cheek (portrait): far lines stay straight, nearer ones bend about as much as today', () => {
    const pr = syntheticPortrait();
    const s = SCENES[0];
    const an = analysisGrid(pr.inside, pr.width, pr.height);
    const u = reshapeUniforms(at(CONTOUR), 1);
    const aspect = pr.width / pr.height;
    const free = reshapeMapCpu(pr.face, u, aspect);
    const lim = reshapeMapCpu(pr.face, u, aspect, null, s.protect);
    const bend = (map: UvMap, tag: string) => +Math.max(...pr.lines.filter((l) => l.tag.startsWith(tag)).map((l) => segmentBend(an, map, l.a, l.b))).toFixed(1);
    const rows = [0.02, 0.05, 0.1, 0.2, 0.4].map((k) => [k, bend(free, `wall+${k}FW`), bend(lim, `wall+${k}FW`)] as const);
    console.log(`portrait wall-line bends @ ${REF_EDGE} (FW out: today → limited): ${rows.map(([k, a, b]) => `${k}: ${a} → ${b}`).join(', ')}`);
    for (const [k, a, b] of rows) {
      if (k < 0.1) expect(b, `line ${k} FW`).toBeLessThanOrEqual(1.1 * a);
      else expect(b, `line ${k} FW`).toBeLessThan(a);
    }
    expect(rows[3][2], 'line 0.2 FW').toBeLessThan(0.9 * rows[3][1]);
    // past the reach the wall does not move (the lines run down past the jaw and neck, which come closer)
    expect(rows[4][2], 'line 0.4 FW').toBeLessThan(0.05 * rows[4][1]);
  });
});
