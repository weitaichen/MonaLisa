// 膚質 shaders and their shared constants (skin-cleanup spec §4.3–4.4). The TONE table is baked into the GLSL text, so the
// hash pin in toneCpu.test.ts covers it; src/engine/toneCpu.ts mirrors every stage. Original work.

/** Every tunable constant of the tone field and the retouch. Task 9 calibrates the gains on the fixture. */
export const TONE = {
  /** conf = smoothstep(conf0, conf1, L.a): how much skin the low-pass reference saw */
  conf: [0.15, 0.3],
  /** 勻膚 leaves mid-band luma steps beyond these alone (moles, brows, nostrils) */
  evenGuard: [0.06, 0.14],
  /** 黑眼圈 / 法令紋 leave darkness beyond these alone (lashes, frames) */
  darkGuard: [0.2, 0.3],
  even: { chroma: 0.9, lift: 0.45 },
  darkCircle: { lift: 0.85, chroma: 0.7 },
  nasolabial: { lift: 0.8, chroma: 0.3 },
  /** 膚色 RGB gains per unit of s: warm (s > 0) and cool (s < 0) */
  warm: [0.06, 0.02, -0.07],
  cool: [-0.03, -0.02, 0.07],
  /** skin(c): soft box on Cb and Cr (Chai & Ngan 1999, 8-bit 77–127 and 133–173) */
  skinCb: [0.302, 0.498],
  skinCr: [0.522, 0.678],
  skinSoft: 0.03,
  /** Δ is clamped to ±deltaMax before the 8-bit encoding TONE_ZERO + 2Δ */
  deltaMax: 0.25,
  teeth: { y: [0.28, 0.42], cr: [0.555, 0.6], cb: 0.75, crPull: 0.35, lift: 0.08 },
  eye: {
    scY: [0.32, 0.5],
    scCh: [0.1, 0.2],
    detint: 0.6,
    scLift: 0.05,
    irCh: [0.05, 0.12],
    irY0: [0.06, 0.12],
    irY1: [0.45, 0.6],
    irLift: 0.04,
    clarity: 0.7,
    clamp: 0.12,
  },
} as const;

/** σ_mid = 0.0141·SE: the effective σ of the P3/P4 sparse mean (uniforms.ts:42-61), so 勻膚's mid band is 磨皮's */
export const sigmaMid = (se: number): number => 0.0141 * se;

/** σ_low = clamp(0.08·fw_max, 3σ_mid, 0.12·SE), in working px (fw_max: the largest edited face, S §4.3) */
export function sigmaLow(fwMaxPx: number, se: number): number {
  return Math.min(0.12 * se, Math.max(3 * sigmaMid(se), 0.08 * fwMaxPx));
}

/** L is built at 1/16 of the working size when σ_low ≤ 96 working px, else at 1/32 */
export const lFactor = (sigmaLowPx: number): 16 | 32 => (sigmaLowPx <= 96 ? 16 : 32);

export const MAX_BLUR_RADIUS = 31;

/** one-sided Gaussian weights w[0..R], R = min(31, ⌈3σ⌉), normalized so w0 + 2·Σ w_k = 1; σ ≤ 0 → [1] */
export function gaussWeights(sigma: number): Float32Array {
  if (!(sigma > 0)) return Float32Array.of(1);
  const R = Math.min(MAX_BLUR_RADIUS, Math.ceil(3 * sigma));
  const w = new Float64Array(R + 1);
  let s = 0;
  for (let k = 0; k <= R; k++) {
    w[k] = Math.exp(-(k * k) / (2 * sigma * sigma));
    s += k === 0 ? w[k] : 2 * w[k];
  }
  return Float32Array.from(w, (v) => v / s);
}

export interface FieldSizes {
  d8: { w: number; h: number };
  fL: 16 | 32;
  l: { w: number; h: number };
}
export function fieldSizes(w: number, h: number, sigmaLowPx: number): FieldSizes {
  const d8 = { w: Math.ceil(w / 8), h: Math.ceil(h / 8) };
  const fL = lFactor(sigmaLowPx);
  const k = fL / 8;
  return { d8, fL, l: { w: Math.ceil(d8.w / k), h: Math.ceil(d8.h / k) } };
}

/** a GLSL float literal of `v` (the table goes into the shader text) */
export function glf(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}
