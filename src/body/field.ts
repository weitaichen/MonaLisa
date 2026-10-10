// OWNER: body-geometry agent. BodyMeasure + params → low-res backward displacement field (RG, UV units)
// (body research report §管線 / §參數). Pure TS, no DOM / GL.
//
// D(uv) = (0, g(y) − y) + L(x, g(y)): the full-width vertical bands g (長腿, 增高; bands.ts) are the outermost
// backward map and the local fields L (capsules, shoulder / hip shifts, head scale, neck lift; prims.ts) are
// defined on the source anatomy. det J = det J_L · g′ > 0 whenever both are. L is summed (相芯's 線性疊加), capped by
// a summed-k·a bound, each part multiplied by its own 背景保護 weight, its background re-solved as a screened membrane
// (relax.ts: the ring's stretch spread evenly, person texels untouched), and finally checked numerically
// (fieldMinJacobian) with the local part scaled back if anything still came out below MIN_DET.
import type { BeautyParams, BodyField, ParamId, PersonMask } from '../types';
import { neutralValue, paramsInGroup, signed } from '../engine/params';
import { backwardY, forwardY, heightBand, legsBand, type Band } from './bands';
import { clamp, dot, fieldSize, mid, mul, perp, segDist, smoothstep, sub, type V2 } from './geom';
import { distanceOutside, MaskSampler, maskOnGrid, protectWeights, sampleGrid } from './mask';
import {
  LIMB_REACH_T,
  TRUNK_DT,
  TRUNK_N,
  TRUNK_REACH_MAX,
  TRUNK_RHO,
  TRUNK_T0,
  type BodyMeasure,
  type HandMeasure,
  type LimbMeasure,
  type TrunkMeasure,
} from './measure';
import { relaxBackground, type RelaxOptions, type RelaxStats } from './relax';
import { bump, capsuleAt, ellipseWeight, kForWidth, makeCapsule, phi, widthForK, type Capsule } from './prims';

/** long edge of the displacement field in texels (report: ≈256, e.g. 192×256) */
export const BODY_FIELD_LONG_EDGE = 256;

/**
 * Slider-at-max targets (BR §參數, kept inside the commercial safe zone: widths ≤ ~15 %, stretch 5–15 %).
 * Width entries are the fractional change of the visible silhouette width at full strength.
 */
export const GAINS = {
  slimTrunk: 0.1,
  slimLimb: 0.07,
  waist: 0.14,
  /** 腰臀比: WHR change, split 60 % waist in / 40 % hips out (≈ −10 % / +7 % at max) */
  whr: 0.16,
  hip: 0.08,
  /** 提臀 for side / back views, × torso length */
  hipLift: 0.04,
  thigh: 0.12,
  calf: 0.09,
  upperArm: 0.15,
  forearm: 0.08,
  /** 直角肩 lift as a fraction of the measured neck → shoulder contour drop */
  shoulder: 0.65,
  /** 小頭 scale change */
  head: 0.12,
  /** 天鵝頸 head lift × face height */
  neck: 0.06,
} as const;

export const RHO_TRUNK = TRUNK_RHO;
export const RHO_LIMB = 1.7;
/** trunk k cap after the clipped-R conversion: a single trunk ring keeps det J ≥ 1 − 0.8·0.45 = 0.64 */
const TRUNK_K_MAX = 0.45;
/** keypoint-ratio widths (no mask) are guesses: stay conservative */
const NO_MASK_GAIN = 0.7;
/**
 * Summed k·a cap where capsules overlap. 1.25 is the fold bound for parallel compressions; 0.8 keeps even two
 * coinciding ring minima at det ≥ 1 − 0.8·0.8 = 0.36.
 */
const SUM_KA_MAX = 0.8;
/** numeric guard: the final field's min det J must stay above this (tests require > 0.3) */
export const MIN_DET = 0.35;
/** keepInFrame: share of the room to the frame edge an outward component may use (det J ≳ 1 − this at the edge) */
const EDGE_PIN_SLOPE = 0.5;
const EPS = 1e-4;
/**
 * Fold-guard bisection steps on the local part's scale λ: a full build resolves it to 2⁻¹², a draft (a drag
 * step's preview, rebuilt every frame) to 2⁻⁴. Either way the field shipped is one that passed the check.
 */
const GUARD_STEPS_FULL = 12;
const GUARD_STEPS_DRAFT = 4;

const BODY_DEFS = paramsInGroup('body');

/** true when any 美體 slider or the 增高 band would move pixels (with or without a measure). */
export function bodyActive(params: BeautyParams): boolean {
  for (const d of BODY_DEFS) if (Math.abs(params.values[d.id] - neutralValue(d)) > EPS) return true;
  const b = params.heightBand;
  return !!b && b.amount > EPS && b.bottom - b.top > EPS;
}

let versionCounter = 0;

/**
 * Build the field for these params. `measure` may be null (no detection yet / failed): then only the
 * manual 增高 band applies. Returns null when nothing would move. `aspect` = source W/H.
 * Reuses `prev`'s buffer when the size matches (the version still increments).
 * `longEdge` below BODY_FIELD_LONG_EDGE builds a draft (a drag step's preview: the field is in UV units, so any
 * size samples the same warp, only coarser), which also runs a coarser fold-guard bisection.
 */
export function buildBodyField(
  measure: BodyMeasure | null,
  params: BeautyParams,
  aspect: number,
  prev?: BodyField | null,
  longEdge: number = BODY_FIELD_LONG_EDGE,
): BodyField | null {
  if (!bodyActive(params)) return null;
  const edge = Number.isFinite(longEdge) ? Math.max(8, Math.round(longEdge)) : BODY_FIELD_LONG_EDGE;
  const [w, h] = fieldSize(aspect, edge);
  const A = measure?.aspect ?? (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
  const v = params.values;

  const bands: Band[] = [];
  const hb = params.heightBand ? heightBand(params.heightBand.top, params.heightBand.bottom, params.heightBand.amount) : null;
  if (hb) bands.push(hb);
  if (measure?.legs && v['body.legs'] > EPS) {
    const L = measure.legs;
    const lb = legsBand(L.hipY, L.kneeY, L.feetY, v['body.legs'] * L.vis, bands, L.ankleY);
    if (lb) bands.push(lb);
  }

  const local = measure ? localField(measure, params, w, h, bands) : null;
  if (!bands.length && !local) return null;

  const data = prev && prev.width === w && prev.height === h ? prev.data : new Float32Array(w * h * 2);
  const gy = new Float64Array(h);
  for (let y = 0; y < h; y++) gy[y] = backwardY(bands, (y + 0.5) / h);

  const assemble = (lambda: number) => {
    for (let y = 0; y < h; y++) {
      const yc = (y + 0.5) / h;
      const sy = gy[y];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 2;
        let lx = 0;
        let ly = 0;
        if (local && lambda > 0) {
          const u = (x + 0.5) / w;
          lx = bands.length ? sampleGrid(local.x, w, h, u, sy) : local.x[y * w + x];
          ly = bands.length ? sampleGrid(local.y, w, h, u, sy) : local.y[y * w + x];
        }
        data[i] = (lambda * lx) / A; // Q → UV: x is scaled by the aspect
        data[i + 1] = sy - yc + lambda * ly;
      }
    }
  };
  assemble(1);
  const field: BodyField = { width: w, height: h, data, version: ++versionCounter };
  if (local && fieldMinJacobian(field) < MIN_DET) {
    // should not happen within the slider range; scale the local part back rather than ship a fold
    let lo = 0;
    let hi = 1;
    const steps = edge < BODY_FIELD_LONG_EDGE ? GUARD_STEPS_DRAFT : GUARD_STEPS_FULL;
    for (let i = 0; i < steps; i++) {
      const m = (lo + hi) / 2;
      assemble(m);
      if (fieldMinJacobian(field) >= MIN_DET) lo = m;
      else hi = m;
    }
    assemble(lo);
  }
  let any = false;
  for (let i = 0; i < data.length && !any; i++) any = Math.abs(data[i]) > 1e-9;
  return any ? field : null;
}

/** Smallest Jacobian determinant of the backward map (debug / tests: must stay > 0.3, i.e. no fold-over). */
export function fieldMinJacobian(f: BodyField): number {
  const { width: w, height: h, data } = f;
  // the engine samples the field bilinearly, so per cell det J is bilinear in the cell and its extremes are at the
  // corners: evaluating the four corner combinations of the cell's edge vectors is exact for that map
  let min = Infinity;
  const mx = (x: number, y: number) => x + data[(y * w + x) * 2] * w;
  const my = (x: number, y: number) => y + data[(y * w + x) * 2 + 1] * h;
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const ax0 = mx(x + 1, y) - mx(x, y);
      const ay0 = my(x + 1, y) - my(x, y);
      const ax1 = mx(x + 1, y + 1) - mx(x, y + 1);
      const ay1 = my(x + 1, y + 1) - my(x, y + 1);
      const bx0 = mx(x, y + 1) - mx(x, y);
      const by0 = my(x, y + 1) - my(x, y);
      const bx1 = mx(x + 1, y + 1) - mx(x + 1, y);
      const by1 = my(x + 1, y + 1) - my(x + 1, y);
      const d00 = ax0 * by0 - ay0 * bx0;
      const d01 = ax0 * by1 - ay0 * bx1;
      const d10 = ax1 * by0 - ay1 * bx0;
      const d11 = ax1 * by1 - ay1 * bx1;
      min = Math.min(min, d00, d01, d10, d11);
    }
  }
  return w > 1 && h > 1 ? min : 1;
}

// ───────────────────────── local fields ─────────────────────────

interface LocalGrid {
  /** Q-space displacement on the w×h grid of source texel centres */
  x: Float32Array;
  y: Float32Array;
}

/** A local primitive at q, added into `out`; `capped` terms (the capsules) scale linearly with the SUM_KA cap. */
type Eval = ((q: V2, capScale: number, out: { x: number; y: number; ka: number }) => void) & { capped?: boolean };

const capped = (f: Eval): Eval => Object.assign(f, { capped: true });

/**
 * 背景保護 band of each part (term), from its own silhouette displacement Δ: 1 on the person dilated by Δ, falling
 * to 0 over 4Δ (BR: keeps that part's ring stretch ≤ 25 % before the relaxation). Per part rather than one band from
 * the figure's largest Δ, so a slimmed waist no longer widens the band around the arms and legs.
 */
const PROTECT_DILATE = 1;
const PROTECT_FEATHER = 4;

/**
 * Background relaxation (relax.ts) with 背景保護 on: the ring may grow by `margin`, but never past `maxReach` from the
 * person (the far background stays bit-identical). α 0.05 per texel² ≈ a 4.5-texel (≈ 70 px at 4032) screening
 * length. Narrow gaps up to 0.03 (≈ 120 px at 4032) keep the original field.
 */
const RELAX_PROTECT: Readonly<RelaxOptions> = {
  alpha: 0.05,
  margin: 0.03,
  moveEps: 0.25 / 4032,
  maxReach: 0.07,
  gapMax: 0.03,
  repairFloor: 0.7,
  repairFactor: 8,
  repairRounds: 4,
  tol: 1e-5,
  maxIter: 400,
};
/** 背景保護 off: no band, and the relaxation may spread further (a wider, gentler ring) */
const RELAX_FREE: Readonly<RelaxOptions> = { ...RELAX_PROTECT, margin: 0.08, maxReach: 0.12 };

/** One term's non-zero displacements in texel order (sparse: most parts touch a small share of the grid). */
class TermBuf {
  idx = new Int32Array(1024);
  xy = new Float32Array(2048);
  n = 0;
  push(i: number, x: number, y: number): void {
    if (this.n === this.idx.length) {
      const idx = new Int32Array(2 * this.n);
      idx.set(this.idx);
      this.idx = idx;
      const xy = new Float32Array(4 * this.n);
      xy.set(this.xy);
      this.xy = xy;
    }
    this.idx[this.n] = i;
    this.xy[2 * this.n] = x;
    this.xy[2 * this.n + 1] = y;
    this.n++;
  }
}
/** reused across builds (a drag rebuilds the field every frame) */
const termBufs: TermBuf[] = [];

function localField(m: BodyMeasure, params: BeautyParams, w: number, h: number, bands: readonly Band[]): LocalGrid | null {
  const terms = localTerms(m, params);
  const handBand = bands.length ? handsRigidInBands(m.hands, bands) : null;
  if (handBand) terms.push(handBand);
  if (!terms.length) return null;
  const A = m.aspect;
  const N = w * h;
  const T = terms.length;
  const grid = m.mask ? maskGrid(m, m.mask, w, h) : null;
  const protect = params.bodyProtect && grid;
  // every term separately (背景保護 bands each part by its own Δ = its largest displacement on the silhouette)
  while (termBufs.length < T) termBufs.push(new TermBuf());
  const own = termBufs.slice(0, T);
  for (const b of own) b.n = 0;
  const delta = new Float64Array(T);
  const edge = protect ? grid.edge : null;
  const acc = { x: 0, y: 0, ka: 0 };
  let maxKa = 0;
  for (let y = 0; y < h; y++) {
    const qy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const q: V2 = [((x + 0.5) / w) * A, qy];
      const i = y * w + x;
      let ka = 0;
      for (let t = 0; t < T; t++) {
        acc.x = 0;
        acc.y = 0;
        acc.ka = 0;
        terms[t](q, 1, acc);
        ka += acc.ka;
        if (acc.x === 0 && acc.y === 0) continue;
        own[t].push(i, acc.x, acc.y);
        if (edge?.[i]) delta[t] = Math.max(delta[t], Math.hypot(acc.x, acc.y));
      }
      if (ka > maxKa) maxKa = ka;
    }
  }
  // the summed-k·a cap: the capsule terms are linear in their capScale
  const capScale = maxKa > SUM_KA_MAX ? SUM_KA_MAX / maxKa : 1;

  const gx = new Float32Array(N);
  const gyy = new Float32Array(N);
  const texel = 1 / h;
  for (let t = 0; t < T; t++) {
    const s = terms[t].capped ? capScale : 1;
    const d = delta[t] * s;
    const M = protect ? grid.weights(Math.max(PROTECT_DILATE * d, 2 * texel), Math.max(PROTECT_FEATHER * d, 3 * texel)) : null;
    const { idx, xy, n } = own[t];
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const f = M ? M[i] * s : s;
      gx[i] += f * xy[2 * k];
      gyy[i] += f * xy[2 * k + 1];
    }
  }
  if (grid) {
    // the draft grid is coarser: α per texel² scales with the texel area, so both solve the same continuous problem
    const alphaScale = (BODY_FIELD_LONG_EDGE / Math.max(w, h)) ** 2;
    bodyFieldCacheStats.relax = relaxBackground(gx, gyy, grid.inside, grid.dist(), w, h, texel, protect ? RELAX_PROTECT : RELAX_FREE, alphaScale);
  }
  keepInFrame(gx, gyy, w, h, A);
  let any = false;
  for (let i = 0; i < N && !any; i++) any = Math.abs(gx[i]) > 1e-9 || Math.abs(gyy[i]) > 1e-9;
  return any ? { x: gx, y: gyy } : null;
}

/** The measure-only part of 背景保護 on one field grid: depends on the measure's mask and the grid size alone. */
interface MaskGrid {
  /** the person mask on the grid (maskOnGrid) */
  inside: Uint8Array;
  /** 1 on person texels with a background 4-neighbour (the silhouette), excluding the grid's outer ring */
  edge: Uint8Array;
  /** protectWeights for (dilate, feather), memoised for the last few pairs asked (one per part) */
  weights(dilate: number, feather: number): Float32Array;
  /** distanceOutside(inside), in texels */
  dist(): Float32Array;
}

/**
 * Per measure (a new detection is a new object, so stale entries go with it) and grid size: a slider drag
 * rebuilds the field every frame, and resampling the mask plus its distance transform was a fixed share of each
 * build. The returned arrays are shared: read-only for callers.
 */
const maskGrids = new WeakMap<BodyMeasure, Map<string, MaskGrid>>();
/** grids per measure kept (a draft and a full size, plus slack for an aspect change) */
const MASK_GRIDS_PER_MEASURE = 4;
/** protect weights kept per grid: one per part of the last build */
const WEIGHTS_PER_GRID = 16;

/** Debug / tests: how many mask grids were built (cache misses), and the last background relaxation's size. */
export const bodyFieldCacheStats: { maskGrids: number; relax: RelaxStats } = { maskGrids: 0, relax: { unknowns: 0, iters: 0, rounds: 0 } };

function maskGrid(m: BodyMeasure, mask: PersonMask, w: number, h: number): MaskGrid {
  let bySize = maskGrids.get(m);
  if (!bySize) maskGrids.set(m, (bySize = new Map()));
  const key = `${w}x${h}`;
  const hit = bySize.get(key);
  if (hit) return hit;
  bodyFieldCacheStats.maskGrids++;
  const inside = maskOnGrid(new MaskSampler(mask, m.aspect), w, h, m.aspect);
  const edge = new Uint8Array(w * h);
  for (let y = 1; y + 1 < h; y++)
    for (let x = 1; x + 1 < w; x++) {
      const i = y * w + x;
      if (inside[i] && !(inside[i - 1] && inside[i + 1] && inside[i - w] && inside[i + w])) edge[i] = 1;
    }
  let dist: Float32Array | null = null;
  const memo = new Map<string, Float32Array>();
  const grid: MaskGrid = {
    inside,
    edge,
    weights(dilate, feather) {
      const k = `${dilate}/${feather}`;
      let M = memo.get(k);
      if (M) return M;
      M = protectWeights(inside, w, h, dilate, feather, grid.dist());
      if (memo.size >= WEIGHTS_PER_GRID) memo.delete(memo.keys().next().value!);
      memo.set(k, M);
      return M;
    },
    dist: () => (dist ??= distanceOutside(inside, w, h)),
  };
  if (bySize.size >= MASK_GRIDS_PER_MEASURE) bySize.delete(bySize.keys().next().value!);
  bySize.set(key, grid);
  return grid;
}

/**
 * The backward map must never read outside the photo: the sampler clamps to the edge row / column, which smears
 * it into streaks (小頭 on a head touching the top edge, a slimmed limb at a side edge). Each component pointing
 * out of the frame is soft-limited to a fraction of the room left before that edge, f = s·m·tanh(|d| / (s·m)):
 * unchanged while |d| ≪ m, never past the edge, C¹ (slope 1 at d = 0 on both sides). The edge itself is pinned, so
 * content there stretches instead. The room is measured from half a texel inside the edge: the field is constant
 * beyond the outer texel centres, so those output pixels stay inside too.
 *
 * Fold-safe by construction: along the edge normal the limited map's slope loses ∂f/∂m = s·(tanh x − x·sech²x) ∈
 * [0, s) (and f ≤ s·m bounds the step off the pinned edge row), while ∂f/∂|d| = sech²x ≤ 1 only scales the term's
 * own slope. With s = 1 the outer rows all collapsed onto the edge row once |d| ≫ m (det J → 0), which tripped the
 * global fold guard and weakened every other slider; s = EDGE_PIN_SLOPE keeps det J ≳ 1 − s there.
 */
function keepInFrame(gx: Float32Array, gy: Float32Array, w: number, h: number, A: number): void {
  const hx = (0.5 * A) / w;
  const hy = 0.5 / h;
  const limit = (d: number, roomNeg: number, roomPos: number): number => {
    const m = EDGE_PIN_SLOPE * Math.max(0, d < 0 ? roomNeg : roomPos);
    if (d === 0 || m === 0) return 0;
    return Math.sign(d) * m * Math.tanh(Math.abs(d) / m);
  };
  for (let y = 0; y < h; y++) {
    const qy = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const qx = ((x + 0.5) / w) * A;
      const i = y * w + x;
      if (gx[i] !== 0) gx[i] = limit(gx[i], qx - hx, A - hx - qx);
      if (gy[i] !== 0) gy[i] = limit(gy[i], qy - hy, 1 - hy - qy);
    }
  }
}

/** The active local primitives as closures over precomputed geometry. */
function localTerms(m: BodyMeasure, params: BeautyParams): Eval[] {
  const v = params.values;
  const s = (id: ParamId) => clamp(v[id], 0, 1);
  const slim = s('body.slim');
  const waist = s('body.waist');
  const whr = m.mask ? s('body.whr') : 0;
  const hip = signed(clamp(v['body.hip'], 0, 1));
  const legSlim = s('body.legSlim');
  const arms = s('body.arms');
  const shoulder = s('body.shoulder');
  const neck = s('body.neck');
  const headS = s('body.head');
  const widthGain = m.mask ? 1 : NO_MASK_GAIN;
  const terms: Eval[] = [];

  const wHand = (q: V2): number => {
    let e = 0;
    for (const hd of m.hands) e = Math.max(e, 1 - smoothstep(0.5 * hd.w, 1.2 * hd.w, segDist(q, hd.a, hd.b)));
    return e;
  };
  const trunk = m.trunk;
  const wCore = (q: V2): number => (trunk ? torsoCore(trunk, q) : 0);

  // ── trunk: 瘦身 / 細腰 / 腰臀比 / 美臀 on one capsule S→H with the measured half-width profile ──
  if (trunk && (slim > EPS || waist > EPS || whr > EPS || Math.abs(hip) > EPS)) {
    const g = trunk.vis * widthGain;
    const re = 1 / RHO_TRUNK;
    const kS = kForWidth(1 - GAINS.slimTrunk * slim * g, re);
    const kW = kForWidth(1 - GAINS.waist * waist * g, re);
    const ratio = 1 - GAINS.whr * whr * g;
    const kWW = kForWidth(ratio ** 0.6, re);
    const kWH = kForWidth(ratio ** -0.4, re);
    const kH = kForWidth(1 + GAINS.hip * hip * g, re);
    // every term must be 0 before the profile ends, or the cut at tMax would tear the field
    const tMax = TRUNK_T0 + (TRUNK_N - 1) * TRUNK_DT;
    // 美臀 / the hip part of 腰臀比: a short symmetric bump reads as a lump on the jeans that snaps back at the crotch.
    // The hip rises from the waist and blends down the outer thigh to about mid-thigh (less when the legs splay
    // away from the trunk axis: then the ring would only push the inner thighs apart).
    const hipUp = Math.min(0.3, Math.max(0.15, trunk.hipT - trunk.waistT - 0.05));
    const hipDown = Math.min(hipTail(m, trunk), tMax - 0.02 - trunk.hipT);
    const K = (t: number) =>
      kS * smoothstep(0, 0.2, t) * (1 - smoothstep(1.0, 1.25, t)) +
      (kW + kWW) * bump(t, trunk.waistT, 0.3) +
      (kWH + kH) * bump2(t, trunk.hipT, hipUp, hipDown);
    // K(t) is written for R = ρ·W (edge at r = 1/ρ). Where an arm's gap clips R, the same visible edge change
    // needs a larger k: convert per station and side (capped so det J ≥ 1 − 0.8·TRUNK_K_MAX on its own).
    const kSide = [trunk.halfP, trunk.halfM].map((half, side) => {
      const reachS = side === 0 ? trunk.reachP : trunk.reachM;
      const out = new Float32Array(TRUNK_N);
      for (let i = 0; i < TRUNK_N; i++) {
        const Kt = K(TRUNK_T0 + i * TRUNK_DT);
        if (Kt === 0) continue;
        const R = trunkRadius(half[i], reachS[i]);
        out[i] = clamp(kForWidth(widthForK(Kt, 1 / RHO_TRUNK), half[i] / R), -0.3, TRUNK_K_MAX);
      }
      return out;
    });
    /** displacement along n at q (capScale 1) and the k it used */
    const trunkAt = (q: V2): { dd: number; k: number } => {
      const d = sub(q, trunk.s);
      const t = dot(d, trunk.u) / trunk.len;
      if (t <= TRUNK_T0 || t >= tMax) return NONE;
      const across = dot(d, trunk.n);
      // per side: R = ρ·W, the half-gap to a separate part, or wide enough to carry an arm lying against the torso
      // (measure.ts trunkReach). Varying R along t (or between sides, where D = 0 on the axis) does not change
      // det J, so this part handling is fold-free, unlike multiplying D by (1 − w_arm), whose gradient term D·∇w
      // folds the narrow torso–arm gap.
      const W = profileAt(across >= 0 ? trunk.halfP : trunk.halfM, t);
      const R = trunkRadius(W, profileAt(across >= 0 ? trunk.reachP : trunk.reachM, t));
      const r = Math.abs(across) / R;
      if (r >= 1) return NONE;
      const k = profileAt(kSide[across >= 0 ? 0 : 1], t);
      if (k === 0) return NONE;
      return { dd: across * k * phi(r), k };
    };
    // A hand inside the torso ring (resting on the belly, or hanging beside the hip and carried with it) would be
    // squeezed or sheared with it: inside the hand the displacement is frozen to its value at the hand centre (a
    // rigid shift), blended out around it. In the (along, across) frame det J = 1 + ∂D/∂v + (D(c) − D(q))·∂w/∂v:
    // along-bone changes of D (the bumps fading out) cost nothing, and across it, where the ring compresses
    // (r < 0.45, a hand on the belly) both factors of the last term have the same sign, so it adds to det J; a
    // carried hand sits near r ≈ 0.45 where D barely varies across (measure.ts trunkReach).
    const rigid = m.hands.map((hd) => ({ hd, d: trunkAt(handCentre(hd)).dd }));
    terms.push(capped((q, capScale, out) => {
      const { dd: d0, k } = trunkAt(q);
      let dd = d0;
      for (const { hd, d } of rigid) {
        const wr = handWeight(hd, q, 1.2);
        if (wr > 0) dd += wr * (d - dd);
      }
      if (dd === 0) return;
      dd *= capScale;
      out.x += trunk.n[0] * dd;
      out.y += trunk.n[1] * dd;
      out.ka += Math.abs(k) * capScale;
    }));
    // 提臀: only for side / back views (a frontal photo shows no buttocks to lift)
    if (hip > EPS && m.facing !== 'front') {
      const lift = GAINS.hipLift * hip * trunk.len * g;
      const up = mul(trunk.u, -1);
      for (const sgn of [-1, 1]) {
        const c: V2 = [
          trunk.h[0] + trunk.n[0] * sgn * 0.5 * trunk.hipW + trunk.u[0] * 0.15 * trunk.len,
          trunk.h[1] + trunk.n[1] * sgn * 0.5 * trunk.hipW + trunk.u[1] * 0.15 * trunk.len,
        ];
        const out = mul(trunk.n, sgn);
        const rx = 0.75 * trunk.hipW;
        const ry = 0.35 * trunk.len;
        terms.push((q, _c, o) => {
          const wt = ellipseWeight(q, c, up, out, rx, rx, ry, ry) * lift;
          o.x -= up[0] * wt;
          o.y -= up[1] * wt;
        });
      }
    }
  }

  // ── limbs: 瘦手臂 / 瘦腿 and the limb share of 瘦身 ──
  for (const l of m.limbs) {
    const caps = limbCapsule(l, { slim, legSlim, arms }, l.vis * widthGain);
    if (!caps) continue;
    const isArm = l.kind === 'upperArm' || l.kind === 'forearm';
    terms.push(capped((q, capScale, out) => {
      const { d, ka } = capsuleAt(caps, q[0], q[1]);
      if (d === 0) return;
      const ex = isArm ? 1 - wCore(q) : 1 - wHand(q);
      const dd = d * capScale * ex;
      out.x += caps.n[0] * dd;
      out.y += caps.n[1] * dd;
      out.ka += ka * capScale;
    }));
  }

  // ── 直角肩: lift the outer shoulder contour so the neck → shoulder slope flattens ──
  const sh = m.shoulders;
  if (sh && shoulder > EPS) {
    const lift = GAINS.shoulder * shoulder * sh.drop * sh.vis;
    const centre = mid(sh.tops[0], sh.tops[1]);
    sh.tops.forEach((c, side) => {
      const liftC = sh.found[side] ? lift * sh.hang[side] : 0;
      if (liftC <= 0) return;
      let out = perp(sh.up);
      if (dot(out, sub(c, centre)) < 0) out = mul(out, -1);
      const H = sh.half;
      terms.push((q, _c, o) => {
        // long outward falloff: a raised arm only tilts gently instead of growing a hump at the shoulder
        const wt = ellipseWeight(q, c, sh.up, out, 1.0 * H, 0.6 * H, 0.45 * H, 0.5 * H) * liftC;
        o.x -= sh.up[0] * wt;
        o.y -= sh.up[1] * wt;
      });
    });
  }

  // ── 小頭 / 天鵝頸 (need the face for chin and forehead) ──
  const hd = m.regions.head.ok ? m.head : null;
  if (hd && headS > EPS) {
    const F = hd.faceH;
    const c: V2 = [hd.chin[0] + hd.up[0] * 0.7 * F, hd.chin[1] + hd.up[1] * 0.7 * F];
    const d = GAINS.head * headS * hd.vis;
    // flat core (rigid, uniform shrink of head + hair) inside 0.8·F, smooth falloff to 1.6·F; faded out below the
    // chin so the shoulders are not pulled up
    terms.push((q, _c, o) => {
      const dx = q[0] - c[0];
      const dy = q[1] - c[1];
      const rr = Math.hypot(dx, dy);
      if (rr >= 1.6 * F) return;
      const eta = (q[0] - hd.chin[0]) * hd.up[0] + (q[1] - hd.chin[1]) * hd.up[1];
      const wt = d * (1 - smoothstep(0.8 * F, 1.6 * F, rr)) * (1 - smoothstep(0.1 * F, 0.6 * F, -eta));
      // below the chin keep the neck's width: the horizontal part fades out quickly (a shear, so det J is unaffected)
      const wx = 1 - smoothstep(0, 0.3 * F, -eta);
      o.x += dx * wt * wx;
      o.y += dy * wt;
    });
  }
  if (hd && neck > EPS) {
    const F = hd.faceH;
    const lift = GAINS.neck * neck * F * hd.vis;
    const side = perp(hd.up);
    terms.push((q, _c, o) => {
      const rel = sub(q, hd.chin);
      const eta = dot(rel, hd.up);
      const xi = Math.abs(dot(rel, side));
      const wv = smoothstep(hd.shoulderEta, 0, eta) * (1 - smoothstep(1.4 * F, 2.0 * F, eta));
      const wx = 1 - smoothstep(0.75 * F, 1.3 * F, xi);
      const wt = lift * wv * wx;
      // content moves up: the output samples below it
      o.x -= hd.up[0] * wt;
      o.y -= hd.up[1] * wt;
    });
  }
  return terms;
}

function profileAt(prof: Float32Array, t: number): number {
  const f = clamp((t - TRUNK_T0) / TRUNK_DT, 0, TRUNK_N - 1);
  const i = Math.min(TRUNK_N - 2, Math.floor(f));
  const a = f - i;
  return prof[i] * (1 - a) + prof[i + 1] * a;
}

/** Weight of the torso interior (keeps arm fields off the torso when an arm lies in front of it). */
function torsoCore(tr: TrunkMeasure, q: V2): number {
  const d = sub(q, tr.s);
  const t = dot(d, tr.u) / tr.len;
  if (t <= 0 || t >= 1.12) return 0;
  const W = profileAt(tr.half, t);
  return (1 - smoothstep(0.55 * W, W, Math.abs(dot(d, tr.n)))) * smoothstep(0, 0.12, t) * (1 - smoothstep(1.0, 1.12, t));
}

function limbCapsule(l: LimbMeasure, s: { slim: number; legSlim: number; arms: number }, g: number): Capsule | null {
  let f: number;
  let e: number;
  let tEnd = 1;
  switch (l.kind) {
    case 'upperArm':
      f = (1 - GAINS.upperArm * s.arms * g) * (1 - GAINS.slimLimb * s.slim * g);
      // a long fade-in over the deltoid: a short one leaves a notch where the shoulder cap meets the slimmed arm
      e = 0.25;
      break;
    case 'forearm':
      // fades out before the wrist: hands are never slimmed
      f = (1 - GAINS.forearm * s.arms * g) * (1 - GAINS.slimLimb * s.slim * g);
      e = 0.15;
      tEnd = 0.85;
      break;
    case 'thigh':
      f = (1 - GAINS.thigh * s.legSlim * g) * (1 - GAINS.slimLimb * s.slim * g);
      // e ≈ 0.12 keeps the knee from being pinched between the thigh and calf capsules
      e = 0.12;
      break;
    case 'calf':
      f = (1 - GAINS.calf * s.legSlim * g) * (1 - GAINS.slimLimb * s.slim * g);
      e = 0.12;
      break;
  }
  if (1 - f < 1e-5) return null;
  // one-sided (the limb touches a neighbour on the other side): the open edge carries the whole width change, or
  // the limb would read only half as slimmed
  if (l.side !== 0) f = 1 - 2 * (1 - f);
  const k = kForWidth(f, 1 / RHO_LIMB);
  return { ...makeCapsule(l.a, l.b, l.w, RHO_LIMB, k, e, tEnd, l.side), reachT: LIMB_REACH_T, reachP: l.reachP, reachM: l.reachM };
}

const NONE = { dd: 0, k: 0 } as const;

/** Trunk ring radius from the local half-width and the measured reach (no mask: ρ·W). */
function trunkRadius(W: number, reach: number): number {
  return Math.max(W, Number.isFinite(reach) ? Math.min(reach, TRUNK_REACH_MAX * W) : RHO_TRUNK * W);
}

/** Two-sided bump: (1 − x²)² with x = (t − c)/σ₋ above c and (t − c)/σ₊ below it (C¹ at c). */
function bump2(t: number, c: number, sUp: number, sDown: number): number {
  return t < c ? bump(t, c, sUp) : bump(t, c, sDown);
}

/** How far (in torso lengths) the hip term tails down the thighs: to the lower thigh for legs under the hips. */
function hipTail(m: BodyMeasure, tr: TrunkMeasure): number {
  const thighs = m.limbs.filter((l) => l.kind === 'thigh');
  if (!thighs.length) return 0.3;
  let reach = 0;
  let align = 1;
  for (const l of thighs) {
    const v = sub(l.b, l.a);
    const len = Math.hypot(v[0], v[1]);
    reach += (0.8 * dot(v, tr.u)) / tr.len / thighs.length;
    align = Math.min(align, len > 1e-9 ? dot(v, tr.u) / len : 1);
  }
  const down = 1 + reach - tr.hipT;
  // splayed legs (wide stance, ≳ 20° off the axis): back to a short tail
  return 0.22 + Math.max(0, down - 0.22) * smoothstep(0.9, 0.96, align);
}

/** The hand as a segment wrist → fingertips (HandMeasure's b stops at about the knuckles). */
function handTip(hd: HandMeasure): V2 {
  return [hd.a[0] + 1.6 * (hd.b[0] - hd.a[0]), hd.a[1] + 1.6 * (hd.b[1] - hd.a[1])];
}

function handCentre(hd: HandMeasure): V2 {
  return mid(hd.a, handTip(hd));
}

/** 1 over the hand, fading out to 0 at `fade` × the hand radius. */
function handWeight(hd: HandMeasure, q: V2, fade: number): number {
  return 1 - smoothstep(0.55 * hd.w, fade * hd.w, segDist(q, hd.a, handTip(hd)));
}

/**
 * 長腿 / 增高 stretch every row of their band, an outstretched hand included (fingers ~15 % longer). Over the hands
 * the local field undoes that: with F the forward band map and s a source row, L_y(s) = (F(s) − s) − (F(s_c) − s_c)
 * shows the hand shifted by its centre's offset but unscaled. Along a column the backward map is then
 * s ↦ s + w·(F(s) − s − C) with slope 1 + w·(F′ − 1) + ∂w/∂s·(F(s) − s − C): the stretch the hand gives up moves
 * into the blend ring around it, which is kept wide (fade to 1.5 × the hand radius) so that slope stays ≳ 0.4.
 */
function handsRigidInBands(hands: readonly HandMeasure[], bands: readonly Band[]): Eval | null {
  if (!hands.length) return null;
  const off = (y: number) => forwardY(bands, y) - y;
  const rigid = hands.map((hd) => ({ hd, c: off(handCentre(hd)[1]) }));
  return (q, _c, o) => {
    let dy = 0;
    for (const { hd, c } of rigid) {
      const wr = handWeight(hd, q, 1.5);
      if (wr > 0) dy += wr * (off(q[1]) - c);
    }
    o.y += dy;
  };
}
