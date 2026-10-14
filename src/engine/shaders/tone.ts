// 膚質 shaders and their shared constants (skin-cleanup spec §4.3–4.4). The TONE table is baked into the GLSL text, so the
// hash pin in toneCpu.test.ts covers it; src/engine/toneCpu.ts mirrors every stage. Original work.
import { MAX_RENDER_FACES } from '../../config/limits';
import { TONE_ZERO } from '../passes/toneGeometry';

/**
 * Every tunable constant of the tone field and the retouch. The gains are calibrated on sample_face_tone.png by
 * toneCalibration.test.ts (plan Task 9): from the spec's starting values, 勻膚 even.chroma ×1.2, 膚色 warm and cool ×1.2,
 * 亮眼 eye.detint ×2 and eye.clarity ×1.1; the two gains above 1 act through an effective factor capped at 1, so they
 * steepen the region ramp but never push past neutral (step 4 follow-up). 白牙's tooth gate and lip guard are plan
 * Task 11's decision (b). 法令紋 reads a fold-relative reference, and its lift is ×1.5 (step 4 follow-up). Every other
 * entry is the spec's (S §4.3–4.4).
 */
export const TONE = {
  /** conf = smoothstep(conf0, conf1, L.a): how much skin the low-pass reference saw */
  conf: [0.15, 0.3],
  /** 勻膚 leaves mid-band luma steps beyond these alone (moles, brows, nostrils) */
  evenGuard: [0.06, 0.14],
  /** 黑眼圈 / 法令紋 leave darkness beyond these alone (lashes, frames) */
  darkGuard: [0.2, 0.3],
  /** chroma: the effective factor min(1, chroma · weight) never inverts bC (a gain above 1 only steepens the ramp) */
  even: { chroma: 1.08, lift: 0.45 },
  darkCircle: { lift: 0.85, chroma: 0.7 },
  /**
   * 法令紋 lifts the valley depth across its band, not the mid band against L: a fold often lies on a convex cheek
   * highlight that L, at σ_low, reads as brighter than its surroundings. The depth is the 8 × 8 box of base0 at the
   * texel (D8's footprint) minus the mean of the two boxes `reach`·σ_mid away along the band chord's normal; at the
   * mid-band scale (Mn8) a soft fold on a steep flank makes no minimum at all (S §4.3).
   */
  nasolabial: { lift: 1.2, chroma: 0.3, reach: 2 },
  /** 膚色 RGB gains per unit of s: warm (s > 0) and cool (s < 0) */
  warm: [0.072, 0.024, -0.084],
  cool: [-0.036, -0.024, 0.084],
  /** skin(c): soft box on Cb and Cr (Chai & Ngan 1999, 8-bit 77–127 and 133–173) */
  skinCb: [0.302, 0.498],
  skinCr: [0.522, 0.678],
  skinSoft: 0.03,
  /** Δ is clamped to ±deltaMax before the 8-bit encoding TONE_ZERO + 2Δ */
  deltaMax: 0.25,
  /**
   * 白牙: the luma gate passes shadowed teeth (sample_face.png's are at Y 0.15–0.25, the gap between them ≤ 0.13; the
   * spec's first gate [0.28, 0.42] passed none of them); `inset` (× mouthW, iso) is the lip guard's ramp inside the
   * inner-lip line, which keeps the lips still where the colour gates cannot tell them from teeth (Task 11 decision b)
   */
  teeth: { y: [0.12, 0.18], cr: [0.555, 0.6], cb: 0.75, crPull: 0.35, lift: 0.08, inset: 0.01 },
  eye: {
    scY: [0.32, 0.5],
    scCh: [0.1, 0.2],
    /** the effective factor min(1, detint · R.A · sc) never pushes the tint past neutral */
    detint: 1.2,
    scLift: 0.05,
    irCh: [0.05, 0.12],
    irY0: [0.06, 0.12],
    irY1: [0.45, 0.6],
    irLift: 0.04,
    clarity: 0.77,
    clamp: 0.12,
  },
} as const;

/** the fold reference's band list holds this many chords: two per face the engine renders */
export const MAX_FOLDS = 2 * MAX_RENDER_FACES;

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

const T = TONE;
const E = TONE.eye;
const g = glf;
const v3 = (a: readonly number[]) => `vec3(${a.map(glf).join(', ')})`;

const COMMON = /* glsl */ `
const vec3 L709 = vec3(0.2126, 0.7152, 0.0722);
const float ZERO = ${g(TONE_ZERO)};
vec3 toYcc(vec3 c) {
  return vec3(dot(c, vec3(0.299, 0.587, 0.114)),
              0.5 - 0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
              0.5 + 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
vec3 toRgb(vec3 y) {
  return vec3(y.x + 1.402 * (y.z - 0.5), y.x - 0.344136 * (y.y - 0.5) - 0.714136 * (y.z - 0.5), y.x + 1.772 * (y.y - 0.5));
}`;

/** D8: the 8 × 8 box mean of base0 in 16 bilinear taps (each the mean of a 2 × 2 block) */
export const TONE_DOWN8_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
out vec4 outColor;
void main() {
  vec2 o = floor(gl_FragCoord.xy) * 8.0;
  vec4 s = vec4(0.0);
  for (int b = 0; b < 4; b++)
    for (int a = 0; a < 4; a++) s += texture(uSrc, (o + vec2(float(2 * a + 1), float(2 * b + 1))) / uSrcSize);
  outColor = s / 16.0;
}`;

/** one pass of the separable Gaussian, direct texel taps with CPU-made weights (gaussWeights) */
export const TONE_BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform ivec2 uDir;
uniform int uR;
uniform float uW[${MAX_BLUR_RADIUS + 1}];
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uSrc, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = uW[0] * texelFetch(uSrc, p, 0);
  for (int k = 1; k <= ${MAX_BLUR_RADIUS}; k++) {
    if (k > uR) break;
    s += uW[k] * (texelFetch(uSrc, clamp(p + uDir * k, ivec2(0), size - 1), 0) + texelFetch(uSrc, clamp(p - uDir * k, ivec2(0), size - 1), 0));
  }
  outColor = s;
}`;

/** L's first stage: the uK × uK box of (Mn8 · q, q), q = Q.G at each Mn8 texel centre */
export const TONE_LBOX_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uMn8;
uniform sampler2D uQ;
uniform int uK;
out vec4 outColor;
void main() {
  ivec2 size = textureSize(uMn8, 0);
  ivec2 o = ivec2(gl_FragCoord.xy) * uK;
  vec4 s = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    if (j >= uK) break;
    for (int i = 0; i < 4; i++) {
      if (i >= uK) break;
      ivec2 t = min(o + ivec2(i, j), size - 1);
      float q = texture(uQ, (vec2(t) + 0.5) / vec2(size)).g;
      s += vec4(texelFetch(uMn8, t, 0).rgb * q, q);
    }
  }
  outColor = s / float(uK * uK);
}`;

/**
 * Δ8 = ZERO + 2·clamp(Δ): 勻膚 and 黑眼圈 on the mid band, 法令紋 on the valley depth across its band, then 膚色 (S §4.3).
 * 法令紋 reads base0 (uBase, working px) and the band chords (uFold: S.xy, E.xy in working px, uFolds of them); with
 * none listed it does nothing (foldBand in toneCpu.ts).
 */
export const TONE_FIELD_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D uMn8;
uniform sampler2D uL;
uniform sampler2D uQ;
uniform sampler2D uR;
uniform sampler2D uBase;
uniform vec2 uBaseSize;
uniform int uFolds;
uniform vec4 uFold[${MAX_FOLDS}];
uniform float uFoldK;
out vec4 outColor;
float box(float x, float lo, float hi, float e) { return smoothstep(lo - e, lo, x) * (1.0 - smoothstep(hi, hi + e, x)); }
vec3 box8(vec2 c) {
  vec3 s = vec3(0.0);
  for (int b = 0; b < 4; b++)
    for (int a = 0; a < 4; a++) s += texture(uBase, (c + vec2(float(2 * a - 3), float(2 * b - 3))) / uBaseSize).rgb;
  return s / 16.0;
}
float skinGate(vec3 c) {
  vec3 y = toYcc(c);
  return box(y.y, ${g(T.skinCb[0])}, ${g(T.skinCb[1])}, ${g(T.skinSoft)}) * box(y.z, ${g(T.skinCr[0])}, ${g(T.skinCr[1])}, ${g(T.skinSoft)});
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(p) + 0.5) / vec2(textureSize(uMn8, 0));
  vec3 m = texelFetch(uMn8, p, 0).rgb;
  vec4 L = texture(uL, uv);
  vec3 b = m - L.rgb / max(L.a, 1.0 / 255.0);
  float conf = smoothstep(${g(T.conf[0])}, ${g(T.conf[1])}, L.a);
  float bY = dot(b, L709);
  vec3 bC = b - vec3(bY);
  float lift = -min(bY, 0.0);
  float gE = 1.0 - smoothstep(${g(T.evenGuard[0])}, ${g(T.evenGuard[1])}, abs(bY));
  float gD = 1.0 - smoothstep(${g(T.darkGuard[0])}, ${g(T.darkGuard[1])}, -bY);
  vec4 q = texture(uQ, uv);
  vec4 r = texture(uR, uv);
  float wE = q.r * conf * gE;
  vec3 d = -min(1.0, ${g(T.even.chroma)} * wE) * bC + ${g(T.even.lift)} * wE * lift
         + r.r * conf * gD * (${g(T.darkCircle.lift)} * lift - ${g(T.darkCircle.chroma)} * bC);
  if (r.g > 0.0 && uFolds > 0) {
    vec2 c = (vec2(p) + 0.5) * 8.0;
    float best = 1e30;
    vec2 n = vec2(0.0);
    for (int f = 0; f < ${MAX_FOLDS}; f++) {
      if (f >= uFolds) break;
      vec2 a = uFold[f].xy;
      vec2 ab = uFold[f].zw - a;
      float t = clamp(dot(c - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float dist = length(c - a - t * ab);
      if (dist < best) {
        best = dist;
        n = vec2(-ab.y, ab.x) / max(length(ab), 1e-6);
      }
    }
    vec3 bn = box8(c) - 0.5 * (box8(c + uFoldK * n) + box8(c - uFoldK * n));
    float bnY = dot(bn, L709);
    float gN = 1.0 - smoothstep(${g(T.darkGuard[0])}, ${g(T.darkGuard[1])}, -bnY);
    d += r.g * conf * gN * (${g(T.nasolabial.lift)} * -min(bnY, 0.0) - ${g(T.nasolabial.chroma)} * (bn - vec3(bnY)));
  }
  float s = clamp(2.0 * (q.b - ZERO), -1.0, 1.0);
  if (abs(s) > 0.5 / 255.0) {
    vec3 c0 = m + d;
    vec3 k = s >= 0.0 ? ${v3(T.warm)} : ${v3(T.cool)};
    vec3 c1 = c0 * (1.0 + abs(s) * k);
    c1 *= dot(c0, L709) / max(dot(c1, L709), 1e-4);
    d += (c1 - c0) * skinGate(c0);
  }
  outColor = vec4(ZERO + 2.0 * clamp(d, -${g(T.deltaMax)}, ${g(T.deltaMax)}), 1.0);
}`;

/** the lip guard's uniform arrays hold this many faces (the engine renders at most MAX_RENDER_FACES) */
export const MAX_MOUTHS = MAX_RENDER_FACES;

/**
 * P0d: c = base0 + Δ8, then 白牙 (R.B) and 亮眼 (R.A); base0 and R cover the buffer, Δ8 and Mn8 the whole O (S §4.4).
 * Without Mn8 (uMnOn 0: a tile whose field was not prepared) 亮眼's clarity reads base0 itself, so it adds nothing, as
 * retouchCpu does with no field. 白牙 acts only inside an inner-lip polygon (uMouth, iso, 8 points per face), ramping in
 * over TONE.teeth.inset·mouthW of true distance from the lip line: the lip guard (lipGuard in toneCpu.ts).
 */
export const RETOUCH_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D uBase;
uniform sampler2D uDelta;
uniform sampler2D uMn8;
uniform sampler2D uR;
uniform vec4 uWin;
uniform float uFieldOn;
uniform float uMnOn;
uniform int uMouths;
uniform vec2 uMouth[${MAX_MOUTHS * 8}];
uniform float uMouthW[${MAX_MOUTHS}];
uniform float uAspect;
out vec4 outColor;
float lipGuard(vec2 o) {
  vec2 p = vec2(o.x, o.y / uAspect);
  float gd = 0.0;
  for (int f = 0; f < ${MAX_MOUTHS}; f++) {
    if (f >= uMouths) break;
    bool inside = false;
    float d = 1e9;
    for (int i = 0; i < 8; i++) {
      vec2 a = uMouth[f * 8 + i];
      vec2 b = uMouth[f * 8 + (i + 1) % 8];
      if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      vec2 ab = b - a;
      float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
      d = min(d, length(p - a - t * ab));
    }
    if (inside) gd = max(gd, smoothstep(0.0, ${g(T.teeth.inset)} * uMouthW[f], d));
  }
  return gd;
}
void main() {
  vec2 o = uWin.xy + vUv * uWin.zw;
  vec3 b0 = texture(uBase, vUv).rgb;
  vec3 c = b0;
  if (uFieldOn > 0.5) c += (texture(uDelta, o).rgb - ZERO) * 0.5;
  vec4 r = texture(uR, vUv);
  float kB = r.b > 0.0 ? r.b * lipGuard(o) : 0.0;
  if (kB > 0.0) {
    vec3 y = toYcc(c);
    float k = kB * (smoothstep(${g(T.teeth.y[0])}, ${g(T.teeth.y[1])}, y.x) * (1.0 - smoothstep(${g(T.teeth.cr[0])}, ${g(T.teeth.cr[1])}, y.z)));
    y.y += max(0.0, 0.5 - y.y) * ${g(T.teeth.cb)} * k;
    y.z += (0.5 - y.z) * ${g(T.teeth.crPull)} * k;
    y.x += ${g(T.teeth.lift)} * k * (1.0 - y.x);
    c = toRgb(y);
  }
  if (r.a > 0.0) {
    vec3 y = toYcc(c);
    float ch = 2.0 * length(y.yz - 0.5);
    float sc = smoothstep(${g(E.scY[0])}, ${g(E.scY[1])}, y.x) * (1.0 - smoothstep(${g(E.scCh[0])}, ${g(E.scCh[1])}, ch));
    y.yz += (0.5 - y.yz) * min(1.0, ${g(E.detint)} * r.a * sc);
    y.x += ${g(E.scLift)} * r.a * sc * (1.0 - y.x);
    float ir = smoothstep(${g(E.irCh[0])}, ${g(E.irCh[1])}, ch) * smoothstep(${g(E.irY0[0])}, ${g(E.irY0[1])}, y.x) * (1.0 - smoothstep(${g(E.irY1[0])}, ${g(E.irY1[1])}, y.x));
    y.x += ${g(E.irLift)} * r.a * ir;
    c = toRgb(y);
    vec3 mn = uMnOn > 0.5 ? texture(uMn8, o).rgb : b0;
    c += ${g(E.clarity)} * r.a * (1.0 - sc) * clamp(b0 - mn, -${g(E.clamp)}, ${g(E.clamp)});
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
