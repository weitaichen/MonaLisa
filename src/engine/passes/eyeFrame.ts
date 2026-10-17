// Eye frames for the procedural eye makeup (face-detail spec §4.7, §4.9): eye-local coordinates, lid stations from
// MediaPipe's dense lid contour (Face.lids), brow gaps, EAR, the iris and the gates. Pure.
//
// Eye-local coordinates: x = (q − o)·ex / w, y = (q − o)·ey / w in iso units (iso(p) = (p.x, p.y / aspect)), with
// o the outer corner, x = 1 at the inner corner and y positive toward the chin, for both eyes.
import type { Face } from '../../types';

export type V2 = [number, number];
export const LID_STATIONS = 17;
/** x_k = k / 16 */
export const STATION_XS: readonly number[] = Array.from({ length: LID_STATIONS }, (_, k) => k / 16);

export interface EyeFrame {
  /** outer corner, iso */
  o: V2;
  /** iso unit axes: x outer → inner corner, y toward the chin (orthogonalized) */
  ex: V2;
  ey: V2;
  /** eye width (corner to corner), iso */
  w: number;
  /** lid y in eye units at the stations x_k, piecewise-linear through Face.lids */
  upper: Float32Array;
  lower: Float32Array;
  /** the 9 upper / 9 lower lid points (corners included) in eye units, x made non-decreasing (running maximum) */
  upperPts: Float32Array;
  lowerPts: Float32Array;
  /** brow-lower polyline (pts111 64–67 / 71–68) in eye units, 4 × (x, y) */
  brow: Float32Array;
  /** distance (eye units) from each upper station to the brow-lower polyline, extended flat past its ends */
  browGap: Float32Array;
  /** |iso(p72) − iso(p73)| / w (left), |iso(p75) − iso(p76)| / w (right) */
  ear: number;
  /** iso centre and radius of the detected iris; null when implausible (then irisFallback) */
  iris: { c: V2; r: number } | null;
  /** p104 / p105 and 0.21·w */
  irisFallback: { c: V2; r: number };
}

const EYES = [
  { outer: 52, inner: 55, up: 72, lo: 73, pupil: 104, lid: 0, iris: 0, brow: [64, 65, 66, 67] },
  { outer: 61, inner: 58, up: 75, lo: 76, pupil: 105, lid: 16, iris: 10, brow: [71, 70, 69, 68] },
] as const;

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** y of a polyline with non-decreasing x at `x`; the end segments extend linearly outside */
export function polyY(pts: Float32Array, x: number): number {
  const n = pts.length / 2;
  let j = 1;
  if (x > pts[0]) while (j < n - 1 && pts[j * 2] < x) j++;
  const x0 = pts[(j - 1) * 2];
  const y0 = pts[(j - 1) * 2 + 1];
  const x1 = pts[j * 2];
  const y1 = pts[j * 2 + 1];
  const dx = x1 - x0;
  return dx > 1e-9 ? y0 + ((x - x0) / dx) * (y1 - y0) : y1;
}

/** nearest point of the brow polyline, extended flat (constant y) past its leftmost and rightmost points */
function nearestOnBrow(brow: Float32Array, q: V2): { d: number; p: V2 } {
  let best = { d: Infinity, p: [0, 0] as V2 };
  const n = brow.length / 2;
  for (let j = 0; j < n - 1; j++) {
    const ax = brow[j * 2];
    const ay = brow[j * 2 + 1];
    const abx = brow[j * 2 + 2] - ax;
    const aby = brow[j * 2 + 3] - ay;
    const l2 = abx * abx + aby * aby || 1e-12;
    const t = Math.min(1, Math.max(0, ((q[0] - ax) * abx + (q[1] - ay) * aby) / l2));
    const p: V2 = [ax + abx * t, ay + aby * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, p };
  }
  let lo = 0;
  let hi = 0;
  for (let j = 1; j < n; j++) {
    if (brow[j * 2] < brow[lo * 2]) lo = j;
    if (brow[j * 2] > brow[hi * 2]) hi = j;
  }
  for (const [end, past] of [
    [lo, q[0] < brow[lo * 2]],
    [hi, q[0] > brow[hi * 2]],
  ] as const) {
    if (!past) continue;
    const d = Math.abs(q[1] - brow[end * 2 + 1]);
    if (d < best.d) best = { d, p: [q[0], brow[end * 2 + 1]] };
  }
  return best;
}

/** distance (eye units) from the eye point (x, y) to the brow-lower polyline */
export function browGapAt(f: EyeFrame, x: number, y: number): number {
  return nearestOnBrow(f.brow, [x, y]).d;
}

/** the brow end of the gap from (x, y): the nearest brow-lower point, eye units (debug overlay) */
export function browGapEnd(f: EyeFrame, x: number, y: number): V2 {
  return nearestOnBrow(f.brow, [x, y]).p;
}

/** [GPUPixel-left, GPUPixel-right] eye frames of `face` at image aspect W/H */
export function eyeFrames(face: Face, aspect: number): readonly [EyeFrame, EyeFrame] {
  const P = face.pts111;
  const iso = (x: number, y: number): V2 => [x, y / aspect];
  const pt = (i: number): V2 => iso(P[i * 2], P[i * 2 + 1]);
  const m0 = pt(43);
  const m1 = pt(16);
  const ml = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) || 1e-12;
  const mh: V2 = [(m1[0] - m0[0]) / ml, (m1[1] - m0[1]) / ml];
  const frame = (e: (typeof EYES)[number]): EyeFrame => {
    const o = pt(e.outer);
    const inn = pt(e.inner);
    const w = Math.hypot(inn[0] - o[0], inn[1] - o[1]) || 1e-12;
    const ex: V2 = [(inn[0] - o[0]) / w, (inn[1] - o[1]) / w];
    const k = mh[0] * ex[0] + mh[1] * ex[1];
    const eyRaw: V2 = [mh[0] - k * ex[0], mh[1] - k * ex[1]];
    const el = Math.hypot(eyRaw[0], eyRaw[1]) || 1e-12;
    const ey: V2 = [eyRaw[0] / el, eyRaw[1] / el];
    const toEye = (q: V2): V2 => {
      const dx = q[0] - o[0];
      const dy = q[1] - o[1];
      return [(dx * ex[0] + dy * ex[1]) / w, (dx * ey[0] + dy * ey[1]) / w];
    };
    const lidPt = (j: number): V2 => toEye(iso(face.lids[(e.lid + j) * 2], face.lids[(e.lid + j) * 2 + 1]));
    const chain = (idx: readonly number[]): Float32Array => {
      const out = new Float32Array(idx.length * 2);
      let xmax = -Infinity;
      idx.forEach((j, i) => {
        const q = lidPt(j);
        xmax = Math.max(xmax, q[0]);
        out[i * 2] = xmax;
        out[i * 2 + 1] = q[1];
      });
      return out;
    };
    const upperPts = chain([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const lowerPts = chain([0, 9, 10, 11, 12, 13, 14, 15, 8]);
    const upper = new Float32Array(LID_STATIONS);
    const lower = new Float32Array(LID_STATIONS);
    STATION_XS.forEach((x, s) => {
      upper[s] = polyY(upperPts, x);
      lower[s] = polyY(lowerPts, x);
    });
    const brow = new Float32Array(8);
    e.brow.forEach((i, j) => brow.set(toEye(pt(i)), j * 2));
    const browGap = new Float32Array(LID_STATIONS);
    STATION_XS.forEach((x, s) => (browGap[s] = nearestOnBrow(brow, [x, upper[s]]).d));
    const up = pt(e.up);
    const lo = pt(e.lo);
    const ear = Math.hypot(up[0] - lo[0], up[1] - lo[1]) / w;
    const I = face.iris;
    const ic = iso(I[e.iris], I[e.iris + 1]);
    let r = 0;
    for (let b = 1; b <= 4; b++) r += Math.hypot(I[e.iris + b * 2] - ic[0], I[e.iris + b * 2 + 1] / aspect - ic[1]) / 4;
    const ce = toEye(ic);
    const rw = r / w;
    const valid =
      rw >= 0.12 &&
      rw <= 0.32 &&
      ce[0] >= 0.1 &&
      ce[0] <= 0.9 &&
      ce[1] >= polyY(upperPts, ce[0]) - 0.5 * rw &&
      ce[1] <= polyY(lowerPts, ce[0]) + 0.5 * rw;
    return {
      o,
      ex,
      ey,
      w,
      upper,
      lower,
      upperPts,
      lowerPts,
      brow,
      browGap,
      ear,
      iris: valid ? { c: ic, r } : null,
      irisFallback: { c: pt(e.pupil), r: 0.21 * w },
    };
  };
  return [frame(EYES[0]), frame(EYES[1])];
}

/** eye-local (x, y) → image UV */
export function eyeToUv(f: EyeFrame, x: number, y: number, aspect: number): V2 {
  const ix = f.o[0] + f.w * (x * f.ex[0] + y * f.ey[0]);
  const iy = f.o[1] + f.w * (x * f.ex[1] + y * f.ey[1]);
  return [ix, iy * aspect];
}

/** 美瞳 fades with EAR exactly at RM's threshold (EAR < 0.15 → 0) */
export const lensBlinkGate = (ear: number): number => smoothstep(0.15, 0.2, ear);
/** 睫毛 stays on half-closed eyes and fades only near closure */
export const lashBlinkGate = (ear: number): number => smoothstep(0.08, 0.14, ear);
/** 睫毛 size gate: eye width over the short edge, both iso, so preview, tiles and export agree */
export const lashSizeGate = (f: EyeFrame, aspect: number): number => smoothstep(0.01, 0.016, f.w / Math.min(1, 1 / aspect));

/** inputs of the 美妝 strip notes for one face (face-detail spec §2.4): both eyes below 0.5 of their gate */
export function eyeNoteInfo(face: Face, aspect: number): { lensClosed: boolean; lashesClosed: boolean; lashesSmall: boolean } {
  const [l, r] = eyeFrames(face, aspect);
  return {
    lensClosed: lensBlinkGate(l.ear) < 0.5 && lensBlinkGate(r.ear) < 0.5,
    lashesClosed: lashBlinkGate(l.ear) < 0.5 && lashBlinkGate(r.ear) < 0.5,
    lashesSmall: lashSizeGate(l, aspect) < 0.5 && lashSizeGate(r, aspect) < 0.5,
  };
}

/** a lid station: eye-local point and the lid's outward unit normal (away from the aperture) */
export interface Station {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/**
 * The lid sampled at ascending `xs`, with normals pointing up (upper lid) or down (lower lid). Samples at x ≥ 0 lie on
 * the lid, with normals from central differences over those samples only. Samples at x < 0 are the S5 §4.7 overhang:
 * they continue from the outer corner along the corner line (y = the lid's y at x = 0) and carry the normal of the
 * first sample at x ≥ 0, so the overhang never changes the lid stations and a ribbon over it cannot fold at the corner.
 * (Extending the end chord instead ran the upper overhang down toward the cheek: the dense contour's first chord is
 * short and steep.)
 */
export function lidStations(f: EyeFrame, lid: 'upper' | 'lower', xs: readonly number[]): Station[] {
  const pts = lid === 'upper' ? f.upperPts : f.lowerPts;
  const y0 = polyY(pts, 0);
  const ys = xs.map((x) => (x < 0 ? y0 : polyY(pts, x)));
  const lo = Math.max(0, xs.findIndex((x) => x >= 0));
  const normal = (i: number): V2 => {
    const a = Math.max(lo, i - 1);
    const b = Math.min(xs.length - 1, i + 1);
    const tx = xs[b] - xs[a];
    const ty = ys[b] - ys[a];
    const l = Math.hypot(tx, ty) || 1e-12;
    const nx = ty / l;
    const ny = -tx / l;
    return (lid === 'upper' && ny > 0) || (lid === 'lower' && ny < 0) ? [-nx, -ny] : [nx, ny];
  };
  return xs.map((x, i) => {
    const [nx, ny] = normal(Math.max(lo, i));
    return { x, y: ys[i], nx, ny };
  });
}
