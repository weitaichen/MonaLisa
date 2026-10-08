// Small 2-D helpers for the body geometry. Everything in src/body works in "Q space": q = (u·aspect, v) for a
// texture coordinate (u, v), i.e. isotropic units of the image HEIGHT, y down (the reshape shader's iso space
// rescaled so lengths read as "fraction of the image height", which is how the gating thresholds are written).
export type V2 = readonly [number, number];

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V2, s: number): V2 => [a[0] * s, a[1] * s];
export const dot = (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1];
export const len = (a: V2): number => Math.hypot(a[0], a[1]);
export const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function unit(a: V2): V2 {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 1];
}

/** Left-hand normal (rotate +90° in a y-down frame). */
export const perp = (a: V2): V2 => [-a[1], a[0]];

/** Distance from p to segment a–b. */
export function segDist(p: V2, a: V2, b: V2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 1e-12 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return dist(p, add(a, mul(ab, t)));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Field texture size for a source aspect W/H: long edge `longEdge`, the other edge rounded to match. */
export function fieldSize(aspect: number, longEdge: number): [number, number] {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return a >= 1
    ? [longEdge, Math.max(8, Math.round(longEdge / a))]
    : [Math.max(8, Math.round(longEdge * a)), longEdge];
}
