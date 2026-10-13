// 調節 and 質感 maths (v0.4 step-2 spec §4.2–4.5): every tunable constant, the uniform builder of the composite's
// 調節 program, and the CPU reference of each stage (compositeCpu.ts, the gen-luts.mjs thumbnails, unit tests).
// Pure and `import type` only, so scripts/gen-luts.mjs can import this file under Node's type stripping.
// Original work: IEC 61966-2-1 sRGB transfer, Rec. 709 luma, the logistic sigmoid, Fritsch–Carlson (1980) monotone
// cubic tangents; the grain hash uses the lowbias32 constants of Chris Wellons' hash-prospector (public domain).
import type { AdjustId } from '../types';

/** strip order (step-2 spec §2.1) */
export const ADJUST_IDS = [
  'adjust.brightness',
  'adjust.exposure',
  'adjust.contrast',
  'adjust.highlights',
  'adjust.shadows',
  'adjust.temperature',
  'adjust.tint',
  'adjust.saturation',
  'adjust.vibrance',
  'adjust.fade',
  'adjust.grain',
  'adjust.vignette',
] as const satisfies readonly AdjustId[];

/** 0–100 items; every other adjust item is bidirectional (−50…+50, neutral 0.5) */
export const ADJUST_ONE_WAY: ReadonlySet<AdjustId> = new Set<AdjustId>(['adjust.fade', 'adjust.grain', 'adjust.vignette']);

/** Every tunable constant (S §4.1 "constants live in TypeScript"): the shader only receives derived uniforms. */
export const ADJUST_K = {
  /** 亮度: y = x^(2^(−bright·s)) — mid grey 0.5 → 0.653 at +50, 0.324 at −50 */
  bright: 0.7,
  /** 對比: logistic steepness for s > 0, and of the inverse curve for s < 0 (mid slope 1.66 / 0.76) */
  contrastUp: 6,
  contrastDown: 4,
  /** 高光／陰影: knot offset at full strength and the knot weights at x_i = i/8 */
  toneKnot: 0.12,
  shadowW: [0, 0.7, 0.75, 0.45, 0.2, 0.05, 0, 0, 0],
  highlightW: [0, 0, 0, 0.05, 0.2, 0.45, 0.75, 0.7, 0],
  /** 曝光: EV at full strength, shoulder knee in linear light */
  exposureEv: 1,
  knee: 0.75,
  /** 色溫／色調: log2 gains at full strength (+ = warmer / magenta) */
  tempGain: 0.3,
  tintGreen: 0.2,
  tintRB: 0.1,
  /** 鮮艷度 strength and skin guard; skin window: HSV hue (turns) centre and half-width ≈ 25°, S ramps, V ramp */
  vibrance: 0.7,
  skinGuard: 0.6,
  skinHue: [0.07, 0.07],
  skinSatIn: [0.08, 0.2],
  skinSatOut: [0.6, 0.8],
  skinVal: [0.15, 0.35],
  /** boosts (k > 1) taper off as S approaches the gamut edge (the gen-luts.mjs chroma() taper) */
  taper: [0.6, 0.95],
  /** 褪色 at 100: black lift (→ 41/255), white drop (→ 245/255), chroma loss */
  fadeLift: 0.16,
  fadeWhite: 0.04,
  fadeChroma: 0.1,
  /** 暗角 at 100: linear-light corner loss (gain 0.3), radial ramp, encoded-space exponent */
  vignette: 0.7,
  vigInner: 0.4,
  vigOuter: 1,
  vigGamma: 1 / 2.2,
  /** 顆粒 at 100: amplitude, midtone weighting base + mid·4Y(1 − Y), reference short edge of a 1 px cell */
  grainAmp: 0.08,
  grainBase: 0.3,
  grainMid: 0.7,
  grainRef: 1080,
  /** thumbnails: grain on the thumbnail's own pixel grid at this fraction of the amplitude */
  thumbGrain: 0.6,
} as const;

export const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** IEC 61966-2-1 sRGB; the branch tests match the shader's step() */
export const lin = (c: number) => (c < 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const enc = (x: number) => (x < 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
/** Rec. 709 luma of an encoded colour */
export const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ───────────── grain (step-2 spec §4.4) ─────────────

/** lowbias32 integer finalizer (hash-prospector constants, public domain): uint32 in, uint32 out */
export function lowbias32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** per-frame constant mixed into every row hash (computed once on the CPU, uniform uSeedMix) */
export function seedMix(seed: number): number {
  return lowbias32((seed + 0x9e3779b9) >>> 0);
}

/** lattice value in [−1, 1): a 24-bit integer times 2^−23, exact in float32, so GPU and CPU agree bit for bit */
export function latticeValue(ix: number, rowHash: number): number {
  return (lowbias32((ix >>> 0) ^ rowHash) >>> 8) / 8388608 - 1;
}

/**
 * Value noise at lattice coordinates (px, py): bilinear between the 4 surrounding lattice values, divided by the
 * blend's standard-deviation factor so every pixel has the same variance whatever the cell size and alignment.
 * The shader's adjGrain().
 */
export function grainAt(px: number, py: number, mix: number): number {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const r0 = lowbias32((y0 >>> 0) ^ mix);
  const r1 = lowbias32(((y0 + 1) >>> 0) ^ mix);
  const n00 = latticeValue(x0, r0);
  const n10 = latticeValue(x0 + 1, r0);
  const n01 = latticeValue(x0, r1);
  const n11 = latticeValue(x0 + 1, r1);
  const a = n00 + (n10 - n00) * fx;
  const b = n01 + (n11 - n01) * fx;
  const n = a + (b - a) * fy;
  const gx = (1 - fx) * (1 - fx) + fx * fx;
  const gy = (1 - fy) * (1 - fy) + fy * fy;
  return n / Math.sqrt(gx * gy);
}
