// 調節 stages of P5 (v0.4 step-2 spec §4.1–4.4), spliced into compositeFs({adjust: true}) after the 質感 LUT.
// Original work for this project (no GPUPixel code): IEC 61966-2-1 sRGB transfer, Rec. 709 luma, a monotone cubic
// luma curve whose knots and tangents come from src/engine/adjustMath.ts, and the lowbias32 integer hash (constants
// from Chris Wellons' hash-prospector, public domain). Every tunable constant arrives as a uniform built by
// adjustUniforms(), so tuning never changes this text (the pins in compositeCpu.test.ts). CPU port: adjustRgb().

/**
 * lowbias32 + lattice value; also used by the bench's bit-exact probe (src/bench/adjustBench.ts). Every integer is
 * declared `highp`: the composite declares no default int precision, so a bare `uint` would be mediump, which a GPU
 * may run in 16 bits (GLSL ES 3.00 §4.5.2) — only highp uint is a 32-bit wrapping integer on every device.
 */
export const GRAIN_HASH_GLSL = /* glsl */ `
highp uint lowbias32(highp uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float latticeValue(highp uint ix, highp uint rowHash) {
  return float(lowbias32(ix ^ rowHash) >> 8u) * (1.0 / 8388608.0) - 1.0;
}`;

export const ADJUST_GLSL = /* glsl */ `
uniform float uAdjustOn;
uniform vec4 uExp;
uniform float uCurveOn;
uniform vec2 uCurve[9];
uniform float uWbOn;
uniform vec3 uWb;
uniform vec4 uSat;
uniform vec4 uSkinA;
uniform vec4 uSkinB;
uniform vec2 uTaper;
uniform vec3 uFade;
uniform vec4 uVig;
uniform float uVAspect;
uniform vec4 uVMap;
uniform vec4 uGrain;
uniform vec2 uGrainScale;
uniform highp uint uSeedMix;

const vec3 ADJ_L709 = vec3(0.2126, 0.7152, 0.0722);
${GRAIN_HASH_GLSL}

vec3 adjLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 adjEnc(vec3 x) {
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), x));
}

float adjCurve(float Y) {
  float t = clamp(Y, 0.0, 1.0) * 8.0;
  int i = min(int(floor(t)), 7);
  float f = t - float(i);
  float f2 = f * f;
  float f3 = f2 * f;
  vec2 a = uCurve[i];
  vec2 b = uCurve[i + 1];
  float v = (2.0 * f3 - 3.0 * f2 + 1.0) * a.x + (f3 - 2.0 * f2 + f) * a.y + (-2.0 * f3 + 3.0 * f2) * b.x + (f3 - f2) * b.y;
  return clamp(v, 0.0, 1.0);
}

vec3 adjToLuma(vec3 c, float Y, float Yn) {
  return Yn <= Y ? c * (Yn / max(Y, 1e-5)) : 1.0 - (1.0 - c) * ((1.0 - Yn) / max(1.0 - Y, 1e-5));
}

float adjGrain(vec2 P) {
  vec2 p0 = floor(P);
  vec2 f = P - p0;
  highp ivec2 i = ivec2(p0);
  highp uint r0 = lowbias32(uint(i.y) ^ uSeedMix);
  highp uint r1 = lowbias32(uint(i.y + 1) ^ uSeedMix);
  highp uint x0 = uint(i.x);
  highp uint x1 = uint(i.x + 1);
  float n = mix(mix(latticeValue(x0, r0), latticeValue(x1, r0), f.x), mix(latticeValue(x0, r1), latticeValue(x1, r1), f.x), f.y);
  vec2 g = (1.0 - f) * (1.0 - f) + f * f;
  return n * inversesqrt(g.x * g.y);
}

vec3 adjustStage(vec3 c, vec2 uv) {
  c = clamp(c, 0.0, 1.0);
  // 曝光: linear-light gain, shoulder back to white when brightening
  if (uExp.x != 1.0) {
    vec3 x = adjLin(c) * uExp.x;
    if (uExp.z > 0.0) {
      vec3 t = clamp((x - uExp.y) / (uExp.z - uExp.y), 0.0, 1.0);
      vec3 sh = uExp.y + (1.0 - uExp.y) * (1.0 - pow(1.0 - t, vec3(uExp.w)));
      x = mix(x, sh, step(vec3(uExp.y), x));
    }
    c = adjEnc(clamp(x, 0.0, 1.0));
  }
  // 亮度／對比／高光／陰影: one monotone curve on encoded luma, hue kept
  if (uCurveOn > 0.0) {
    float Y = dot(c, ADJ_L709);
    c = adjToLuma(c, Y, adjCurve(Y));
  }
  // 色溫／色調: linear-light white balance
  if (uWbOn > 0.0) c = adjEnc(clamp(adjLin(c) * uWb, 0.0, 1.0));
  // 飽和／鮮艷度: chroma about luma, vibrance weighted by (1 − S) with a skin guard, boosts tapered near the gamut
  if (uSat.w > 0.0) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    float S = d / max(mx, 1e-5);
    float h = 0.0;
    if (d > 1e-5) {
      if (mx == c.r) h = (c.g - c.b) / d;
      else if (mx == c.g) h = 2.0 + (c.b - c.r) / d;
      else h = 4.0 + (c.r - c.g) / d;
      h = fract(h / 6.0);
    }
    float dh = abs(fract(h - uSkinA.x + 0.5) - 0.5);
    float win = dh >= uSkinA.y ? 0.0 : 0.5 * (1.0 + cos(3.14159265 * dh / uSkinA.y));
    float skin = win * smoothstep(uSkinA.z, uSkinA.w, S) * (1.0 - smoothstep(uSkinB.x, uSkinB.y, S)) * smoothstep(uSkinB.z, uSkinB.w, mx);
    float wv = (uSat.y > 0.0 ? 1.0 - S : 1.0) * (1.0 - uSat.z * skin);
    float k = uSat.x * (1.0 + uSat.y * wv);
    if (k > 1.0) k = 1.0 + (k - 1.0) * (1.0 - smoothstep(uTaper.x, uTaper.y, S));
    float Y = dot(c, ADJ_L709);
    c = clamp(Y + (c - Y) * k, 0.0, 1.0);
  }
  // 褪色: black lift, white drop, chroma loss
  if (uFade.x > 0.0) {
    c = uFade.x + c * uFade.y;
    float Yf = dot(c, ADJ_L709);
    c = Yf + (c - Yf) * uFade.z;
  }
  vec2 V = uv * uVMap.xy + uVMap.zw;
  // 暗角: radial gain in V, aspect-corrected, applied in encoded space
  if (uVig.x > 0.0) {
    float r = length((V - 0.5) * vec2(uVAspect, 1.0)) / length(vec2(0.5 * uVAspect, 0.5));
    c *= pow(1.0 - uVig.x * smoothstep(uVig.y, uVig.z, r), uVig.w);
  }
  // 顆粒: monochrome value noise on the global V lattice, strongest in the midtones
  if (uGrain.x > 0.0) {
    float n = adjGrain(V * uGrainScale);
    float Y = dot(c, ADJ_L709);
    c = clamp(c + n * uGrain.x * (uGrain.y + uGrain.z * 4.0 * Y * (1.0 - Y)), 0.0, 1.0);
  }
  return clamp(c, 0.0, 1.0);
}`;
