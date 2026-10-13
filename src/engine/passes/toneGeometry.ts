// 膚質 region geometry (skin-cleanup spec §4.2): O-space triangle lists (x, y, value) for the ¼-res targets R and Q,
// built from one adapted face, plus the gates folded into each region's strength. Pure, no GL; toneMask.ts draws them.
// Every distance is iso (fractions of the image width on both axes, as mask.ts:70): the iso point of a uv is
// (x, y / aspect). pts111 indices follow src/tracking/adapter111.ts; image-left = GPUPixel left. Original work.
import type { Face } from '../../types';

export type V2 = [number, number];
/** image-left / image-right half of the face */
export type Side = 'L' | 'R';
export const SIDES: readonly Side[] = ['L', 'R'];

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
export const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
function unit(a: V2): V2 {
  const l = Math.hypot(a[0], a[1]);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
}
export function centroid(ps: readonly V2[]): V2 {
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p[0];
    y += p[1];
  }
  return ps.length ? [x / ps.length, y / ps.length] : [0, 0];
}

export function isoPt(face: Face, i: number, aspect: number): V2 {
  return [face.pts111[i * 2], face.pts111[i * 2 + 1] / aspect];
}

export interface FaceFrame {
  /** iso face width |P(0) − P(32)| (mask.ts:94) */
  fw: number;
  /** unit vector between the eye centres, P(74) → P(77) */
  xhat: V2;
  /** x̂ turned +90°, negated when needed so it points to the chin (ext[4], the menton) */
  yhat: V2;
  /** |P(52) − P(55)|, |P(58) − P(61)| */
  eyeW: Record<Side, number>;
  /** |P(84) − P(90)| */
  mouthW: number;
}

export function faceFrame(face: Face, aspect: number): FaceFrame {
  const P = (i: number) => isoPt(face, i, aspect);
  const xhat = unit(sub(P(77), P(74)));
  let yhat: V2 = [-xhat[1], xhat[0]];
  const menton: V2 = [face.ext[8], face.ext[9] / aspect];
  if (dot(yhat, sub(menton, P(46))) < 0) yhat = [-yhat[0], -yhat[1]];
  return { fw: dist(P(0), P(32)), xhat, yhat, eyeW: { L: dist(P(52), P(55)), R: dist(P(58), P(61)) }, mouthW: dist(P(84), P(90)) };
}

/** eye aspect ratio: |P72 − P73| / eyeW_L (image-right: P75, P76, eyeW_R) */
export function earOf(face: Face, side: Side, aspect: number): number {
  const w = faceFrame(face, aspect).eyeW[side];
  const [a, b] = side === 'L' ? [72, 73] : [75, 76];
  return w > 1e-12 ? dist(isoPt(face, a, aspect), isoPt(face, b, aspect)) / w : 0;
}

/** 亮眼's per-eye gate (step 5's blink gate reuses it, C §4.4) */
export function eyeOpen(face: Face, side: Side, aspect: number): number {
  return smoothstep(0.12, 0.18, earOf(face, side, aspect));
}

/** |P98 − P102| / mouthW */
export function mouthOpen(face: Face, aspect: number): number {
  const w = faceFrame(face, aspect).mouthW;
  return w > 1e-12 ? dist(isoPt(face, 98, aspect), isoPt(face, 102, aspect)) / w : 0;
}

/** 白牙's gate: smoothstep(0.01, 0.03, mouthOpen) */
export function teethGate(face: Face, aspect: number): number {
  return smoothstep(0.01, 0.03, mouthOpen(face, aspect));
}

/** the side whose eye is nearer to the nose tip: image-right when yaw > 0 (adapter111.ts:92-103) */
export function farSide(face: Face): Side | null {
  return face.yaw > 0 ? 'R' : face.yaw < 0 ? 'L' : null;
}

/** far-side regions × (1 − smoothstep(0.25, 0.50, |yaw|)); the near side is never faded */
export function sideFade(face: Face, side: Side): number {
  return farSide(face) === side ? 1 - smoothstep(0.25, 0.5, Math.abs(face.yaw)) : 1;
}

/** `n` points along the polyline, equally spaced by arc length, endpoints included */
export function resampleChain(pts: readonly V2[], n: number): V2[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  const total = cum[cum.length - 1];
  const out: V2[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const t = n > 1 ? (total * k) / (n - 1) : 0;
    while (seg < pts.length - 2 && cum[seg + 1] < t) seg++;
    const l = cum[seg + 1] - cum[seg];
    const f = l > 0 ? Math.min(1, Math.max(0, (t - cum[seg]) / l)) : 0;
    out.push(add(pts[seg], mul(sub(pts[seg + 1], pts[seg]), f)));
  }
  return out;
}

/** a triangle list collected in iso space and emitted as O-normalized (x, y, value) triplets */
export class Tris {
  private readonly v: number[] = [];
  tri(a: V2, av: number, b: V2, bv: number, c: V2, cv: number): void {
    this.v.push(a[0], a[1], av, b[0], b[1], bv, c[0], c[1], cv);
  }
  /** a, b, c, d in order around the quad */
  quad(a: V2, av: number, b: V2, bv: number, c: V2, cv: number, d: V2, dv: number): void {
    this.tri(a, av, b, bv, c, cv);
    this.tri(a, av, c, cv, d, dv);
  }
  uv(aspect: number): Float32Array {
    const out = new Float32Array(this.v);
    for (let i = 1; i < out.length; i += 3) out[i] *= aspect;
    return out;
  }
}

const LOWER_LID: Record<Side, readonly number[]> = { L: [52, 57, 73, 56, 55], R: [61, 62, 76, 63, 58] };

/**
 * 黑眼圈 crescent (R.R): the lower-lid chain resampled to 7 points (t = 0…1, τ = sin πt) and three rows along ŷ at
 * 0.06·eyeW (value 0), (0.06 + 0.12τ)·eyeW (value τ) and (0.06 + 0.40τ)·eyeW (value 0): it tapers to nothing at the eye
 * corners and leaves the lashes alone.
 */
export function crescentGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const chain = resampleChain(LOWER_LID[side].map((i) => isoPt(face, i, aspect)), 7);
  const w = f.eyeW[side];
  const r0: V2[] = [];
  const r1: V2[] = [];
  const r2: V2[] = [];
  const val: number[] = [];
  for (let i = 0; i < 7; i++) {
    const tau = Math.sin((Math.PI * i) / 6);
    r0.push(add(chain[i], mul(f.yhat, 0.06 * w)));
    r1.push(add(chain[i], mul(f.yhat, (0.06 + 0.12 * tau) * w)));
    r2.push(add(chain[i], mul(f.yhat, (0.06 + 0.4 * tau) * w)));
    val.push(tau);
  }
  const t = new Tris();
  for (let i = 0; i < 6; i++) {
    t.quad(r0[i], 0, r0[i + 1], 0, r1[i + 1], val[i + 1], r1[i], val[i]);
    t.quad(r1[i], val[i], r1[i + 1], val[i + 1], r2[i + 1], 0, r2[i], 0);
  }
  return t.uv(aspect);
}

/**
 * 法令紋 band (R.G), per side with o = −x̂ (image-left) or +x̂: S = P(82|83) + 0.04fw·o − 0.01fw·ŷ,
 * E = P(84|90) + 0.06fw·o + 0.05fw·ŷ, control C = (S + E)/2 + 0.035fw·o; a quadratic Bézier with 9 samples, half-width
 * h(t) = 0.035fw·(0.6 + 0.4 sin πt), rows −h (0), centre (1 × smoothstep over the first and last 15 %), +h (0).
 */
export function nasolabialGeometry(face: Face, side: Side, aspect: number): Float32Array {
  const f = faceFrame(face, aspect);
  const P = (i: number) => isoPt(face, i, aspect);
  const o: V2 = side === 'L' ? mul(f.xhat, -1) : f.xhat;
  const [ia, ib] = side === 'L' ? [82, 84] : [83, 90];
  const S = add(add(P(ia), mul(o, 0.04 * f.fw)), mul(f.yhat, -0.01 * f.fw));
  const E = add(add(P(ib), mul(o, 0.06 * f.fw)), mul(f.yhat, 0.05 * f.fw));
  const C = add(mul(add(S, E), 0.5), mul(o, 0.035 * f.fw));
  const lo: V2[] = [];
  const mid: V2[] = [];
  const hi: V2[] = [];
  const val: number[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    const p = add(add(mul(S, u * u), mul(C, 2 * u * t)), mul(E, t * t));
    const tan = add(mul(sub(C, S), 2 * u), mul(sub(E, C), 2 * t));
    // turned the opposite way on the image-right side, so the +h row is o's row on both sides and a mirrored face
    // gives the mirrored triangle list (the same quad diagonals), not just the mirrored outline
    const n = unit(side === 'L' ? [-tan[1], tan[0]] : [tan[1], -tan[0]]);
    const h = 0.035 * f.fw * (0.6 + 0.4 * Math.sin(Math.PI * t));
    lo.push(add(p, mul(n, -h)));
    mid.push(p);
    hi.push(add(p, mul(n, h)));
    val.push(smoothstep(0, 0.15, t) * (1 - smoothstep(0.85, 1, t)));
  }
  const tr = new Tris();
  for (let i = 0; i < 8; i++) {
    tr.quad(lo[i], 0, lo[i + 1], 0, mid[i + 1], val[i + 1], mid[i], val[i]);
    tr.quad(mid[i], val[i], mid[i + 1], val[i + 1], hi[i + 1], 0, hi[i], 0);
  }
  return tr.uv(aspect);
}
