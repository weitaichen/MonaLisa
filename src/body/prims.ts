// Local displacement primitives (Q space, backward: the output at q samples the source at q + D(q)).
//
// Capsule (BR §垂直於骨骼的位移場): for a bone A→B, t = along-bone parameter, v = signed distance across it,
// R = ρ·W, r = |v|/R, φ(r) = (1 − r²)². Backward map v_src = v·(1 + k·a(t)·φ(r)); D points along the normal only, so
// in the (along, across) frame J = [[1, 0], [∂D/∂t, 1 + ∂D/∂v]] and det J = 1 + k·a·(1 − r²)(1 − 5r²) ≥ 1 − 0.8·k·a:
// fold-free for k·a < 1.25 whatever a(t) and R(t) do along the bone. Negative k (widening) needs 1 + k > 0.
import { clamp, perp, smoothstep, sub, unit, dist, dot, type V2 } from './geom';

export const phi = (r: number): number => {
  if (r >= 1) return 0;
  const s = 1 - r * r;
  return s * s;
};

/** Per-capsule hard limit on |k·a| (BR §管線: ≤ 0.8). */
export const K_MAX = 0.8;

/**
 * Gain k that moves a silhouette edge at r_e = W/R to f·W (f < 1 slims, f > 1 widens): the output edge v_o = f·W
 * must sample the source edge W, i.e. f·W·(1 + k·φ(f·r_e)) = W.
 */
export function kForWidth(f: number, re: number): number {
  const p = phi(f * re);
  if (p <= 1e-6) return 0;
  return clamp((1 / f - 1) / p, -K_MAX, K_MAX);
}

/** Visible edge factor f produced by gain k (inverse of kForWidth, by bisection; for tests and tuning). */
export function widthForK(k: number, re: number): number {
  let lo = 0.2;
  let hi = 2;
  for (let i = 0; i < 60; i++) {
    const f = (lo + hi) / 2;
    // g(f) = f·(1 + k·φ(f·re)) − 1 is increasing in f wherever the map is fold-free
    if (f * (1 + k * phi(f * re)) - 1 > 0) hi = f;
    else lo = f;
  }
  return (lo + hi) / 2;
}

/** Normalised bump (1 − ((t − c)/σ)²)², 1 at c, 0 beyond ±σ (C¹). */
export function bump(t: number, c: number, sigma: number): number {
  const x = (t - c) / sigma;
  return Math.abs(x) >= 1 ? 0 : (1 - x * x) * (1 - x * x);
}

/** Along-bone window: fades in over [−e, e] at A and out over [tEnd − e, tEnd + e]. */
export function window(t: number, e: number, tEnd = 1): number {
  return smoothstep(-e, e, t) * (1 - smoothstep(tEnd - e, tEnd + e, t));
}

/** A straight capsule with constant radius, precomputed for fast evaluation. */
export interface Capsule {
  a: V2;
  u: V2;
  n: V2;
  length: number;
  w: number;
  R: number;
  k: number;
  e: number;
  tEnd: number;
  /** 0 two-sided; ±1 compress only the side along ±n */
  side: -1 | 0 | 1;
  /** optional per-side reach at stations reachT (see LimbMeasure); R = clamp(reach(t), w, ρ·w) */
  reachT?: readonly number[];
  reachP?: readonly number[];
  reachM?: readonly number[];
}

/** Piecewise-linear lookup, clamped at both ends. */
export function interp(ts: readonly number[], vs: readonly number[], t: number): number {
  if (t <= ts[0]) return vs[0];
  for (let i = 1; i < ts.length; i++) {
    if (t <= ts[i]) {
      const a = (t - ts[i - 1]) / (ts[i] - ts[i - 1]);
      const v0 = vs[i - 1];
      const v1 = vs[i];
      return Number.isFinite(v0) && Number.isFinite(v1) ? v0 + (v1 - v0) * a : Math.min(v0, v1);
    }
  }
  return vs[vs.length - 1];
}

export function makeCapsule(a: V2, b: V2, w: number, rho: number, k: number, e: number, tEnd: number, side: -1 | 0 | 1): Capsule {
  const u = unit(sub(b, a));
  return { a, u, n: perp(u), length: Math.max(dist(a, b), 1e-6), w, R: rho * w, k, e, tEnd, side };
}

/**
 * Signed across-bone displacement magnitude (to be applied along c.n) and the k·a it used (for the summed bound).
 * One-sided capsules blend in over ±¼W around the axis, so the field stays continuous across it.
 */
export function capsuleAt(c: Capsule, qx: number, qy: number): { d: number; ka: number } {
  const px = qx - c.a[0];
  const py = qy - c.a[1];
  const v = px * c.n[0] + py * c.n[1];
  const t = (px * c.u[0] + py * c.u[1]) / c.length;
  // per-side R (D = 0 on the axis, and R varying along t only shears): det J keeps its 1 − 0.8·k·a bound
  const reach = c.reachT ? interp(c.reachT, (v >= 0 ? c.reachP : c.reachM) ?? [], t) : Infinity;
  const R = Math.max(c.w, Math.min(c.R, reach));
  const r = Math.abs(v) / R;
  if (r >= 1) return ZERO;
  const along = window(t, c.e, c.tEnd);
  if (along <= 0) return ZERO;
  const side = c.side === 0 ? 1 : smoothstep(-0.25 * c.w, 0.25 * c.w, c.side * v);
  const ka = c.k * along;
  return { d: v * ka * phi(r) * side, ka: Math.abs(ka) * side };
}

const ZERO = { d: 0, ka: 0 } as const;

/**
 * Anisotropic shift (straight shoulders, hip lift): weight (1 − ρ²)² over an ellipse in the (out, up) frame with
 * separate radii on each side of the centre (C¹ across the axes). Returns the weight.
 */
export function ellipseWeight(q: V2, c: V2, up: V2, out: V2, rOut: number, rIn: number, rUp: number, rDown: number): number {
  const d = sub(q, c);
  const x = dot(d, out);
  const y = dot(d, up);
  const rx = x >= 0 ? rOut : rIn;
  const ry = y >= 0 ? rUp : rDown;
  const p2 = (x / rx) ** 2 + (y / ry) ** 2;
  return p2 >= 1 ? 0 : (1 - p2) * (1 - p2);
}
