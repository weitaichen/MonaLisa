// 祛痘 heal shaders (skin-cleanup spec §4.5): the robust ring pass and the Poisson-membrane spot quads. Original work;
// mirrored by src/engine/healCpu.ts (hash-pinned in healCpu.test.ts). Spots arrive per instance in O units (centre
// normalized, radius and donor as fractions of the O short edge) and are mapped into the src through uWin / uSrcPx.
import { HEAL_RING_SAMPLES } from '../../config/limits';
import { TONE_ZERO } from '../passes/toneGeometry';
import { glf } from './tone';

const COMMON = /* glsl */ `
const int N = ${HEAL_RING_SAMPLES};
const float ZERO = ${glf(TONE_ZERO)};
const vec3 L709 = vec3(0.2126, 0.7152, 0.0722);
const float TAU = 6.283185307179586;`;

/** one instanced quad per spot covering row gl_InstanceID of the RING target (N × spots) */
export const HEAL_RING_VS = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec4 aSpot;   // x, y (O uv), r (short-edge fraction), fill (1 = no donor)
in vec2 aDonor;  // dx, dy (short-edge fractions)
uniform float uRows;
flat out vec4 vSpot;
flat out vec2 vDonor;
void main() {
  vSpot = aSpot;
  vDonor = aDonor;
  vec2 p = vec2(aCorner.x, (float(gl_InstanceID) + aCorner.y) / uRows);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** RING (k, s): ZERO + Δ_k (fill: T_k) and the robust weight o_k of spot s */
export const HEAL_RING_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
flat in vec4 vSpot;
flat in vec2 vDonor;
uniform sampler2D uSrc;
uniform vec4 uWin;
uniform vec2 uSrcPx;
out vec4 outColor;
vec3 tap(vec2 px) { return texture(uSrc, px / uSrcPx).rgb; }
vec3 ringMean(vec2 c, vec2 u, float r) { return (tap(c + 1.2 * r * u) + tap(c + 1.3 * r * u) + tap(c + 1.4 * r * u)) / 3.0; }
void main() {
  vec2 oPx = uSrcPx / uWin.zw;
  float s = min(oPx.x, oPx.y);
  vec2 c = (vSpot.xy - uWin.xy) * oPx;
  float r = vSpot.z * s;
  vec2 d = vDonor * s;
  bool fill = vSpot.w > 0.5;
  vec3 dl[N];
  float y[N];
  float mu = 0.0;
  for (int k = 0; k < N; k++) {
    float th = TAU * float(k) / float(N);
    vec2 u = vec2(cos(th), sin(th));
    vec3 T = ringMean(c, u, r);
    dl[k] = fill ? T : T - ringMean(c + d, u, r);
    y[k] = dot(dl[k], L709);
    mu += y[k];
  }
  mu /= float(N);
  float v = 0.0;
  for (int k = 0; k < N; k++) v += (y[k] - mu) * (y[k] - mu);
  float sig = sqrt(v / float(N)) + 0.01;
  float sw = 0.0;
  float swy = 0.0;
  for (int k = 0; k < N; k++) {
    float e = (y[k] - mu) / (2.0 * sig);
    float o = 1.0 / (1.0 + e * e);
    sw += o;
    swy += o * y[k];
  }
  float mu1 = swy / sw;
  float sv = 0.0;
  for (int k = 0; k < N; k++) {
    float e = (y[k] - mu) / (2.0 * sig);
    sv += (y[k] - mu1) * (y[k] - mu1) / (1.0 + e * e);
  }
  float sig1 = sqrt(sv / sw) + 0.01;
  int k0 = int(gl_FragCoord.x);
  float e1 = (y[k0] - mu1) / (2.0 * sig1);
  outColor = vec4(fill ? dl[k0] : vec3(ZERO) + dl[k0], 1.0 / (1.0 + e1 * e1));
}`;

/** one instanced quad per spot, half-side 1.1 r, in src px */
export const HEAL_VS = /* glsl */ `#version 300 es
in vec2 aCorner;
in vec4 aSpot;
in vec2 aDonor;
uniform vec4 uWin;
uniform vec2 uSrcPx;
flat out vec4 vSpot;   // centre (px), r (px), fill
flat out vec2 vDonor;  // px
flat out int vRow;
void main() {
  vec2 oPx = uSrcPx / uWin.zw;
  float s = min(oPx.x, oPx.y);
  vec2 c = (aSpot.xy - uWin.xy) * oPx;
  float r = aSpot.z * s;
  vSpot = vec4(c, r, aSpot.w);
  vDonor = aDonor * s;
  vRow = gl_InstanceID;
  vec2 p = c + (aCorner * 2.0 - 1.0) * 1.1 * r;
  gl_Position = vec4(p / uSrcPx * 2.0 - 1.0, 0.0, 1.0);
}`;

/** donor + harmonic membrane (the healing brush), feathered over ρ 0.8 … 1.1; premultiplied output */
export const HEAL_FS = /* glsl */ `#version 300 es
precision highp float;
${COMMON}
flat in vec4 vSpot;
flat in vec2 vDonor;
flat in int vRow;
uniform sampler2D uSrc;
uniform sampler2D uRing;
uniform vec2 uSrcPx;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 dp = p - vSpot.xy;
  float rr = length(dp);
  float rho = rr / vSpot.z;
  if (rho > 1.1) discard;
  float rp = rr / (1.3 * vSpot.z);
  float phi = rr > 1e-6 ? atan(dp.y, dp.x) : 0.0;
  bool fill = vSpot.w > 0.5;
  vec3 num = vec3(0.0);
  float den = 0.0;
  for (int k = 0; k < N; k++) {
    vec4 ring = texelFetch(uRing, ivec2(k, vRow), 0);
    float P = (1.0 - rp * rp) / (1.0 - 2.0 * rp * cos(phi - TAU * float(k) / float(N)) + rp * rp);
    float w = ring.a * P;
    num += w * (fill ? ring.rgb : ring.rgb - vec3(ZERO));
    den += w;
  }
  vec3 M = num / max(den, 1e-6);
  vec3 healed = fill ? M : texture(uSrc, (p + vDonor) / uSrcPx).rgb + M;
  float a = 1.0 - smoothstep(0.8, 1.1, rho);
  outColor = vec4(clamp(healed, 0.0, 1.0) * a, a);
}`;
