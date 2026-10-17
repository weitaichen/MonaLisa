// 調節 and 質感 maths (v0.4 step-2 spec §4.2–4.5): every tunable constant, the uniform builder of the composite's
// 調節 program, and the CPU reference of each stage (compositeCpu.ts, the gen-luts.mjs thumbnails, unit tests).
// Pure and `import type` only, so scripts/gen-luts.mjs can import this file under Node's type stripping.
// Original work: IEC 61966-2-1 sRGB transfer, Rec. 709 luma, the logistic sigmoid, Fritsch–Carlson (1980) monotone
// cubic tangents; the grain hash uses the lowbias32 constants of Chris Wellons' hash-prospector (public domain).
import type { AdjustId, LookDef, ParamDef, Rect } from '../types';

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

/** effective shader-space values within this distance of neutral count as neutral */
const EPS = 1e-4;
const clampS = (v: number) => (v <= -1 ? -1 : v >= 1 ? 1 : v);
const fract = (x: number) => x - Math.floor(x);

export function neutralAdjust(id: AdjustId): number {
  return ADJUST_ONE_WAY.has(id) ? 0 : 0.5;
}

/** `v` is a shader-space value (s ∈ [−1, 1] bidirectional, v ∈ [0, 1] one-way) */
export function isNeutralAdjust(id: AdjustId, v: number): boolean {
  return ADJUST_ONE_WAY.has(id) ? !(v > EPS) : !(Math.abs(v) > EPS);
}

/**
 * One stored 調節 value (0..1; missing or non-finite → neutral) is drawn without a look: effectiveAdjust's expressions
 * with no look (its + 0 offset changes no value), then isNeutralAdjust. The single rule the engine, the item and tab
 * dots and the ⊘ no-op check share (step-2 spec §2.1), so display 1 (v = 0.01) draws, shows its dot and ⊘ clears it.
 */
export function adjustItemActive(id: AdjustId, raw: number | undefined): boolean {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
  const u = clamp01(raw);
  return !isNeutralAdjust(id, ADJUST_ONE_WAY.has(id) ? u : clampS((u - 0.5) * 2));
}

/**
 * Every stored value is neutral in shader space: effectiveAdjust(values, null, 0) gives isNeutralAdjust for all 12
 * items, without building the record (the engine's per-frame check before any 調節 work, step-2 spec §4.3).
 */
export function adjustValuesNeutral(values: AdjustValues): boolean {
  return !ADJUST_IDS.some((id) => adjustItemActive(id, values[id]));
}

// ───────────── tone curve: 亮度, 對比, 高光, 陰影 (step-2 spec §4.2) ─────────────

export interface CurveKnots {
  /** y at x_i = i/8, i = 0…8 */
  y: number[];
  /** dy/dx at the knots (Fritsch–Carlson) */
  m: number[];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
/** normalized logistic S-curve through (0, 0), (½, ½), (1, 1) */
function sCurve(y: number, k: number): number {
  const lo = sigmoid(-k / 2);
  const hi = sigmoid(k / 2);
  return (sigmoid(k * (y - 0.5)) - lo) / (hi - lo);
}
function sCurveInv(y: number, k: number): number {
  const lo = sigmoid(-k / 2);
  const hi = sigmoid(k / 2);
  const t = Math.min(1 - 1e-12, Math.max(1e-12, lo + y * (hi - lo)));
  return 0.5 + Math.log(t / (1 - t)) / k;
}

/** Fritsch–Carlson monotone tangents: the algorithm of scripts/gen-luts.mjs curve(), ported */
function fritschCarlson(y: readonly number[], h: number): number[] {
  const n = y.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / h);
  const m = new Array<number>(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return m;
}

/** The 9 knots of the luma curve for shader-space 亮度 sb, 對比 sc, 高光 sh, 陰影 ss (each −1…1). */
export function curveKnots(sb: number, sc: number, sh: number, ss: number): CurveKnots {
  const k = ADJUST_K;
  const y: number[] = [];
  for (let i = 0; i < 9; i++) {
    let v = (i / 8) ** (2 ** (-k.bright * sb));
    if (sc > 1e-3) v = sCurve(v, k.contrastUp * sc);
    else if (sc < -1e-3) v = sCurveInv(v, k.contrastDown * -sc);
    v += k.toneKnot * (ss * k.shadowW[i] + sh * k.highlightW[i]);
    y.push(clamp01(v));
  }
  // black and white stay fixed (曝光 is the item that moves white)
  y[0] = 0;
  y[8] = 1;
  for (let i = 1; i < 9; i++) y[i] = Math.max(y[i], y[i - 1]);
  return { y, m: fritschCarlson(y, 1 / 8) };
}

/** Cubic Hermite through the knots: the shader's adjCurve(). */
export function curveAt(k: CurveKnots, Y: number): number {
  const t = clamp01(Y) * 8;
  const i = Math.min(Math.floor(t), 7);
  const f = t - i;
  const f2 = f * f;
  const f3 = f2 * f;
  const v =
    (2 * f3 - 3 * f2 + 1) * k.y[i] + (f3 - 2 * f2 + f) * (k.m[i] / 8) + (-2 * f3 + 3 * f2) * k.y[i + 1] + (f3 - f2) * (k.m[i + 1] / 8);
  return clamp01(v);
}

// ───────────── effective values and uniforms (step-2 spec §4.3, §4.5) ─────────────

/** What the user stored for the 12 items, 0..1 (missing or non-finite → neutral). */
export type AdjustValues = Readonly<Partial<Record<AdjustId, number>>>;

/**
 * A display-unit offset (a look's, LookDef.offsets) in shader space: −50…+50 → −1…1 for a bidirectional item, 0–100 →
 * 0…1 for a one-way one (step-2 spec §4.3). effectiveAdjust adds the looks' offsets through it.
 */
export function offsetToShader(def: Pick<ParamDef, 'bidirectional'>, d: number): number {
  return def.bidirectional ? d / 50 : d / 100;
}

/**
 * Shader-space values with the look's offsets added: s ∈ [−1, 1] for bidirectional items, v ∈ [0, 1] for one-way
 * items. `amount` is the look's 程度; `look` null (or not drawn) adds nothing.
 */
export function effectiveAdjust(values: AdjustValues, look: LookDef | null, amount: number): Record<AdjustId, number> {
  const out = {} as Record<AdjustId, number>;
  const a = look ? clamp01(Number.isFinite(amount) ? amount : 0) : 0;
  for (const id of ADJUST_IDS) {
    const raw = values[id];
    const u = typeof raw === 'number' && Number.isFinite(raw) ? clamp01(raw) : neutralAdjust(id);
    const oneWay = ADJUST_ONE_WAY.has(id);
    const o = offsetToShader({ bidirectional: !oneWay }, a * (look?.offsets[id] ?? 0));
    out[id] = oneWay ? clamp01(u + o) : clampS((u - 0.5) * 2 + o);
  }
  return out;
}

/** The picture V that vignette and grain treat as "the photo" (step-2 spec §4.5). */
export interface AdjustFrame {
  /** V = vUv·(vMap[0], vMap[1]) + (vMap[2], vMap[3]) */
  vMap: readonly [number, number, number, number];
  /** V width and height in output pixels */
  vSize: readonly [number, number];
  /** short edge of the photo O in output pixels: one grain cell = fullShortEdge / 1080 px */
  fullShortEdge: number;
  seed: number;
  /** thumbnails: 1 px cells at ADJUST_K.thumbGrain amplitude */
  thumb?: boolean;
}

const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** The frame of a render of `size` whose picture is `pictureFrame` (source UV); invalid or absent → the whole source. */
export function frameFor(size: { width: number; height: number }, pictureFrame?: Rect | null, seed = 0): AdjustFrame {
  const pf = pictureFrame;
  const ok = !!pf && [pf.x, pf.y, pf.w, pf.h].every((v) => Number.isFinite(v)) && pf.w > 0 && pf.h > 0;
  const r = ok ? pf : WHOLE;
  const W = Math.max(1, size.width);
  const H = Math.max(1, size.height);
  return {
    // + 0 turns −0 into 0 (stable keys and equality)
    vMap: [1 / r.w, 1 / r.h, -r.x / r.w + 0, -r.y / r.h + 0],
    vSize: [r.w * W, r.h * H],
    fullShortEdge: Math.min(W, H),
    seed: Number.isFinite(seed) ? seed >>> 0 : 0,
  };
}

/** The uniforms of the composite's 調節 program (shaders/adjust.ts), and the input of adjustRgb(). */
export interface AdjustUniforms {
  /** the 調節 program draws this frame: any effective value non-neutral, or a drawable look */
  on: boolean;
  /** uAdjustOn: run adjustStage() */
  adjustOn: boolean;
  /** uLookAmt: 質感 LUT mix (0 = not drawn) */
  lookAmt: number;
  /** uExp: gain 2^s (1 = off), knee, shoulder white Lw (0 = no shoulder), shoulder exponent */
  exp: [number, number, number, number];
  /** uCurveOn, uCurve[9] as 18 floats: (y_i, m_i / 8) */
  curveOn: boolean;
  curve: number[];
  /** uWbOn, uWb: linear-light gains, normalized so grey keeps its luminance */
  wbOn: boolean;
  wb: [number, number, number];
  /** uSat: (1 + s_σ, vibrance·s_ν, skin guard, on) */
  sat: [number, number, number, number];
  /** uSkinA: (hue centre, hue half-width, S-in lo, S-in hi); uSkinB: (S-out lo, S-out hi, V lo, V hi); uTaper */
  skinA: [number, number, number, number];
  skinB: [number, number, number, number];
  taper: [number, number];
  /** uFade: (lift, scale, chroma); lift 0 = off */
  fade: [number, number, number];
  /** uVig: (strength, inner, outer, exponent); strength 0 = off */
  vig: [number, number, number, number];
  /** uVAspect: V width / height */
  vAspect: number;
  vMap: [number, number, number, number];
  /** uGrain: (amplitude, base, mid, 0); amplitude 0 = off */
  grain: [number, number, number, number];
  /** uGrainScale: lattice cells per V unit */
  grainScale: [number, number];
  /** uSeedMix (uint) */
  seedMix: number;
}

/** uCurve[9] as 18 floats: (y_i, m_i / 8) */
function curveUniform(knots: CurveKnots): number[] {
  const curve: number[] = [];
  for (let i = 0; i < 9; i++) curve.push(knots.y[i], knots.m[i] / 8);
  return curve;
}

let identity: readonly number[] | null = null;
/** the curve uniform while uCurveOn is 0 (the shader skips the curve): curveKnots(0, 0, 0, 0), built once */
function identityCurve(): readonly number[] {
  identity ??= curveUniform(curveKnots(0, 0, 0, 0));
  return identity;
}

/** Uniforms of one frame. `lookReady` false → the look is drawn neither in part nor in full (spec §1.4). */
export function adjustUniforms(
  values: AdjustValues,
  look: { def: LookDef; amount: number } | null,
  lookReady: boolean,
  frame: AdjustFrame,
): AdjustUniforms {
  const k = ADJUST_K;
  const draw = look !== null && lookReady;
  const e = effectiveAdjust(values, draw ? look.def : null, draw ? look.amount : 0);
  const lookAmt = draw ? clamp01(Number.isFinite(look.amount) ? look.amount : 0) : 0;
  const adjustOn = ADJUST_IDS.some((id) => !isNeutralAdjust(id, e[id]));

  const se = e['adjust.exposure'];
  const gain = Math.abs(se) > EPS ? 2 ** (k.exposureEv * se) : 1;
  const shoulder = gain > 1;
  const exp: AdjustUniforms['exp'] = [gain, k.knee, shoulder ? gain : 0, shoulder ? (gain - k.knee) / (1 - k.knee) : 1];

  const sb = e['adjust.brightness'];
  const sc = e['adjust.contrast'];
  const sh = e['adjust.highlights'];
  const ss = e['adjust.shadows'];
  const curveOn = [sb, sc, sh, ss].some((v) => Math.abs(v) > EPS);
  const curve = curveOn ? curveUniform(curveKnots(sb, sc, sh, ss)) : [...identityCurve()];

  const st = e['adjust.temperature'];
  const sn = e['adjust.tint'];
  const wbOn = Math.abs(st) > EPS || Math.abs(sn) > EPS;
  const gr = 2 ** (k.tempGain * st + k.tintRB * sn);
  const gg = 2 ** (-k.tintGreen * sn);
  const gb = 2 ** (-k.tempGain * st + k.tintRB * sn);
  const norm = luma([gr, gg, gb]);
  const wb: AdjustUniforms['wb'] = wbOn ? [gr / norm, gg / norm, gb / norm] : [1, 1, 1];

  const sSat = e['adjust.saturation'];
  const sVib = e['adjust.vibrance'];
  const satOn = Math.abs(sSat) > EPS || Math.abs(sVib) > EPS;

  const vf = e['adjust.fade'];
  const vg = e['adjust.vignette'];
  const vn = e['adjust.grain'];
  const cellPx = frame.thumb ? 1 : frame.fullShortEdge / k.grainRef;
  const amp = vn > EPS ? k.grainAmp * vn * Math.min(1, cellPx) * (frame.thumb ? k.thumbGrain : 1) : 0;

  return {
    on: adjustOn || lookAmt > 0,
    adjustOn,
    lookAmt,
    exp,
    curveOn,
    curve,
    wbOn,
    wb,
    sat: [1 + sSat, k.vibrance * sVib, k.skinGuard, satOn ? 1 : 0],
    skinA: [k.skinHue[0], k.skinHue[1], k.skinSatIn[0], k.skinSatIn[1]],
    skinB: [k.skinSatOut[0], k.skinSatOut[1], k.skinVal[0], k.skinVal[1]],
    taper: [k.taper[0], k.taper[1]],
    fade: vf > EPS ? [k.fadeLift * vf, 1 - (k.fadeLift + k.fadeWhite) * vf, 1 - k.fadeChroma * vf] : [0, 1, 1],
    vig: [vg > EPS ? k.vignette * vg : 0, k.vigInner, k.vigOuter, k.vigGamma],
    vAspect: frame.vSize[0] / frame.vSize[1],
    vMap: [frame.vMap[0], frame.vMap[1], frame.vMap[2], frame.vMap[3]],
    grain: [amp, k.grainBase, k.grainMid, 0],
    grainScale: [frame.vSize[0] / cellPx, frame.vSize[1] / cellPx],
    seedMix: seedMix(frame.seed),
  };
}

// ───────────── per-pixel reference: the shader's adjustStage() ─────────────

/** hue-safe luma change Y → Yn without leaving the gamut (step-2 spec §4.2) */
function toLuma(c: number[], Y: number, Yn: number): void {
  if (Yn <= Y) {
    const s = Yn / Math.max(Y, 1e-5);
    for (let i = 0; i < 3; i++) c[i] *= s;
  } else {
    const s = (1 - Yn) / Math.max(1 - Y, 1e-5);
    for (let i = 0; i < 3; i++) c[i] = 1 - (1 - c[i]) * s;
  }
}

/**
 * adjustStage() on one encoded colour (0..1) at source uv. Returns a new clamped colour; with `u.adjustOn` false it
 * returns the clamped input, exactly as the composite skips the stage.
 */
export function adjustRgb(rgb: readonly number[], u: AdjustUniforms, uv: readonly [number, number]): [number, number, number] {
  const c = [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  if (!u.adjustOn) return [c[0], c[1], c[2]];
  // 曝光: linear-light gain with a shoulder back to white when brightening
  if (u.exp[0] !== 1) {
    const [g, knee, lw, a] = u.exp;
    for (let i = 0; i < 3; i++) {
      let x = lin(c[i]) * g;
      if (lw > 0 && x >= knee) {
        const t = clamp01((x - knee) / (lw - knee));
        x = knee + (1 - knee) * (1 - (1 - t) ** a);
      }
      c[i] = enc(clamp01(x));
    }
  }
  // 亮度／對比／高光／陰影: one monotone curve on encoded luma, hue kept
  if (u.curveOn) {
    const knots: CurveKnots = { y: [], m: [] };
    for (let i = 0; i < 9; i++) {
      knots.y.push(u.curve[i * 2]);
      knots.m.push(u.curve[i * 2 + 1] * 8);
    }
    const Y = luma(c);
    toLuma(c, Y, curveAt(knots, Y));
  }
  // 色溫／色調: linear-light white balance
  if (u.wbOn) for (let i = 0; i < 3; i++) c[i] = enc(clamp01(lin(c[i]) * u.wb[i]));
  // 飽和／鮮艷度: chroma about luma; vibrance weighted by (1 − S) with a skin guard; boosts tapered near the gamut
  if (u.sat[3] > 0) {
    const mx = Math.max(c[0], c[1], c[2]);
    const mn = Math.min(c[0], c[1], c[2]);
    const d = mx - mn;
    const S = d / Math.max(mx, 1e-5);
    let h = 0;
    if (d > 1e-5) {
      if (mx === c[0]) h = (c[1] - c[2]) / d;
      else if (mx === c[1]) h = 2 + (c[2] - c[0]) / d;
      else h = 4 + (c[0] - c[1]) / d;
      h = fract(h / 6);
    }
    const dh = Math.abs(fract(h - u.skinA[0] + 0.5) - 0.5);
    const win = dh >= u.skinA[1] ? 0 : 0.5 * (1 + Math.cos((Math.PI * dh) / u.skinA[1]));
    const skin =
      win * smoothstep(u.skinA[2], u.skinA[3], S) * (1 - smoothstep(u.skinB[0], u.skinB[1], S)) * smoothstep(u.skinB[2], u.skinB[3], mx);
    const wv = (u.sat[1] > 0 ? 1 - S : 1) * (1 - u.sat[2] * skin);
    let kk = u.sat[0] * (1 + u.sat[1] * wv);
    if (kk > 1) kk = 1 + (kk - 1) * (1 - smoothstep(u.taper[0], u.taper[1], S));
    const Y = luma(c);
    for (let i = 0; i < 3; i++) c[i] = clamp01(Y + (c[i] - Y) * kk);
  }
  // 褪色: black lift, white drop, chroma loss
  if (u.fade[0] > 0) {
    for (let i = 0; i < 3; i++) c[i] = u.fade[0] + c[i] * u.fade[1];
    const Yf = luma(c);
    for (let i = 0; i < 3; i++) c[i] = Yf + (c[i] - Yf) * u.fade[2];
  }
  const Vx = uv[0] * u.vMap[0] + u.vMap[2];
  const Vy = uv[1] * u.vMap[1] + u.vMap[3];
  // 暗角: radial gain in V, aspect-corrected, applied in encoded space
  if (u.vig[0] > 0) {
    const r = Math.hypot((Vx - 0.5) * u.vAspect, Vy - 0.5) / Math.hypot(0.5 * u.vAspect, 0.5);
    const m = (1 - u.vig[0] * smoothstep(u.vig[1], u.vig[2], r)) ** u.vig[3];
    for (let i = 0; i < 3; i++) c[i] *= m;
  }
  // 顆粒: monochrome value noise on the global V lattice, strongest in the midtones
  if (u.grain[0] > 0) {
    const n = grainAt(Vx * u.grainScale[0], Vy * u.grainScale[1], u.seedMix);
    const Y = luma(c);
    const a = n * u.grain[0] * (u.grain[1] + u.grain[2] * 4 * Y * (1 - Y));
    for (let i = 0; i < 3; i++) c[i] = clamp01(c[i] + a);
  }
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/** The photo asks for the 調節 program: a non-neutral user value, or a look (whether or not its LUT is resident). */
export function adjustWanted(values: AdjustValues, look: { id: string } | null): boolean {
  if (look !== null) return true;
  return ADJUST_IDS.some((id) => {
    const v = values[id];
    return typeof v === 'number' && Number.isFinite(v) && Math.abs(v - neutralAdjust(id)) > EPS;
  });
}
