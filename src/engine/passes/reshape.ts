/*
 * GPUPixel
 *
 * Created by PixPark on 2021/6/24.
 * Copyright © 2021 PixPark. All rights reserved.
 */
// Derived from GPUPixel src/filter/face_reshape_filter.cc (GLES variant, pixpark/gpupixel@ef552bf, Apache-2.0);
// modified: GLSL ES 3.00; the 111 points as vec2 pairs (a uniform array in v0.3, the face table in v0.4) instead of
// float facePoints[212]; curveWarp / enlargeEye kept, new scaleAround / shiftAround primitives and V-face, narrow,
// chin, forehead, nose, mouth and eye-distance warps (RB §2.4); big-eye radius from eye width instead of lid distance; yaw
// attenuation; uniform early-outs (zero deltas, face bounding box); 美體 backward displacement texture as
// the outermost map (body research report §管線); a person-distance budget on the contour warps (瘦臉 background
// limit, reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②); v0.4: up to MAX_RENDER_FACES faces read from one face table
// (texture or UBO), their displacements capped and summed, one 瘦臉 limit layer per face in an R16F array.
import { MAX_RENDER_FACES } from '../../config/limits';
import type { Face, FaceProtect, ParamId } from '../../types';
import { signed } from '../params';
import {
  bindTarget,
  bindTexture,
  bindTextureArray,
  createProgram,
  createTexture,
  createTextureArray,
  deleteTexture,
  drawFullscreen,
  FULLSCREEN_VS,
  setUnpackState,
} from '../gl/gl';
import type { Framebuffer, GL, Program, Texture } from '../gl/gl';
import { FACE_TEMPLATE } from './faceMesh';
import { FT } from './faceTable';
import { attenuate, boxCentre, ovalBox, packFaceTable, WHOLE, type TableFace } from './faceCap';

/** Engine-space deltas (already scaled per RB §2.4 table and multiplied by faceWeight). */
export interface ReshapeUniforms {
  faceSlim: number;
  faceV: number;
  faceNarrow: number;
  chin: number;
  forehead: number;
  noseSlim: number;
  mouthSize: number;
  eyeDistance: number;
  eyeEnlarge: number;
}

/** RB §2.4 "Delta" column. eyeDistance is a fraction of the inter-ocular distance (signed). */
export const RESHAPE_SCALE = {
  faceSlim: 0.1,
  faceV: 0.1,
  faceNarrow: 0.07,
  chin: 0.1,
  forehead: -0.1,
  noseSlim: 0.15,
  mouthSize: 0.3,
  eyeDistance: 0.08,
  eyeEnlarge: 0.2,
} as const satisfies ReshapeUniforms;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const clampS = (v: number) => Math.min(1, Math.max(-1, signed(clamp01(v))));

export function reshapeUniforms(values: Record<ParamId, number>, faceWeight: number): ReshapeUniforms {
  const w = clamp01(faceWeight);
  const one = (id: ParamId) => clamp01(values[id]) * w;
  const bi = (id: ParamId) => clampS(values[id]) * w;
  const k = RESHAPE_SCALE;
  return {
    faceSlim: k.faceSlim * one('shape.faceSlim'),
    faceV: k.faceV * one('shape.faceV'),
    faceNarrow: k.faceNarrow * one('shape.faceNarrow'),
    chin: k.chin * bi('shape.chin'),
    forehead: k.forehead * bi('shape.forehead'),
    noseSlim: k.noseSlim * one('shape.noseSlim'),
    mouthSize: k.mouthSize * bi('shape.mouthSize'),
    eyeDistance: k.eyeDistance * bi('shape.eyeDistance'),
    eyeEnlarge: k.eyeEnlarge * one('shape.eyeEnlarge'),
  };
}

export function reshapeActive(u: ReshapeUniforms): boolean {
  return (Object.keys(u) as (keyof ReshapeUniforms)[]).some((key) => Math.abs(u[key]) > 1e-4);
}

/** RB §2.4 yaw attenuation: full effect up to |yaw| 0.15, none beyond 0.35 (contour unreliable). */
export function yawAttenuation(yaw: number): number {
  const t = Math.min(1, Math.max(0, (Math.abs(yaw) - 0.35) / (0.15 - 0.35)));
  return Number.isFinite(t) ? t * t * (3 - 2 * t) : 0;
}

type V2 = [number, number];
const pt = (a: Float32Array, i: number): V2 => [a[i * 2], a[i * 2 + 1]];

/**
 * Big-eye radius = EYE_RADIUS_K × eye width (corner to corner). GPUPixel uses 5 × |p74 − p72|
 * (centre to upper lid), which pulses on blinks; κ is calibrated so both agree on the template.
 */
export const EYE_RADIUS_K = (() => {
  const d = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const t = (i: number) => pt(FACE_TEMPLATE, i);
  const left = (5 * d(t(74), t(72))) / d(t(52), t(55));
  const right = (5 * d(t(77), t(75))) / d(t(58), t(61));
  return (left + right) / 2;
})();

/** contour / nose warp tables, shared with the GLSL below and the CPU port (reshapeCpu.ts) */
export const SLIM: readonly (readonly [number, number])[] = [
  [3, 44], [29, 44], [7, 45], [25, 45], [10, 46], [22, 46], [14, 49], [18, 49], [16, 49],
];
export const V_JAW = [8, 10, 12, 24, 22, 20] as const;
export const NARROW = [2, 4, 30, 28] as const;
export const NOSE: readonly (readonly [number, number])[] = [[80, 46], [81, 46], [82, 49], [83, 49]];

/** Anchors derived on the CPU once per frame (cheaper than per fragment). All in UV space. */
export interface ReshapeGeometry {
  vTargets: Float32Array; // 6 × vec2
  narrowTargets: Float32Array; // 4 × vec2
  chinTarget: V2;
  mouthR: number; // iso units
  eyeR: V2; // iso units, image-left / image-right eye
  eyeDisp: V2; // UV displacement of the image-left eye (right eye gets the negation)
  /** UV bounding box (minX, minY, maxX, maxY) of every active warp's influence disc */
  box: [number, number, number, number];
}

/** Compute warp anchors for `face` at aspect W/H. Exported for unit tests and the harness. */
export function reshapeGeometry(face: Face, aspect: number, u: ReshapeUniforms): ReshapeGeometry {
  const P = face.pts111;
  const iso = (p: V2): V2 => [p[0], p[1] / aspect];
  const uv = (q: V2): V2 => [q[0], q[1] * aspect];
  const dist = (a: V2, b: V2) => {
    const ia = iso(a);
    const ib = iso(b);
    return Math.hypot(ia[0] - ib[0], ia[1] - ib[1]);
  };
  const p = (i: number) => pt(P, i);

  // Projection on the face midline p43 → p16, done in iso space so it is a true perpendicular.
  const m0 = iso(p(43));
  const m1 = iso(p(16));
  const md: V2 = [m1[0] - m0[0], m1[1] - m0[1]];
  const mlen2 = md[0] * md[0] + md[1] * md[1] || 1e-12;
  const project = (i: number): V2 => {
    const q = iso(p(i));
    const t = ((q[0] - m0[0]) * md[0] + (q[1] - m0[1]) * md[1]) / mlen2;
    return uv([m0[0] + md[0] * t, m0[1] + md[1] * t]);
  };

  const vTargets = new Float32Array(12);
  V_JAW.forEach((i, k) => vTargets.set(project(i), k * 2));
  const narrowTargets = new Float32Array(8);
  NARROW.forEach((i, k) => narrowTargets.set(project(i), k * 2));

  const p16 = p(16);
  const p49 = p(49);
  const chinTarget: V2 = [2 * p16[0] - p49[0], 2 * p16[1] - p49[1]];
  const mouthR = 0.7 * dist(p(84), p(90));
  const eyeR: V2 = [EYE_RADIUS_K * dist(p(52), p(55)), EYE_RADIUS_K * dist(p(58), p(61))];

  // disp = −eyeDistance·IOD·û with û = unit(p77 − p74), i.e. −eyeDistance·(p77 − p74); + moves eyes apart.
  const e0 = p(74);
  const e1 = p(77);
  const eyeDisp: V2 = [-u.eyeDistance * (e1[0] - e0[0]), -u.eyeDistance * (e1[1] - e0[1])];

  // Union of influence discs (iso radius r around o) → UV box. Warps outside every disc are identity,
  // and a coordinate outside all discs is never moved, so skipping it is exact.
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const disc = (o: V2, r: number) => {
    box[0] = Math.min(box[0], o[0] - r);
    box[1] = Math.min(box[1], o[1] - r * aspect);
    box[2] = Math.max(box[2], o[0] + r);
    box[3] = Math.max(box[3], o[1] + r * aspect);
  };
  const curve = (o: V2, t: V2) => disc(o, dist(o, t));
  if (u.faceSlim) for (const [o, t] of SLIM) curve(p(o), p(t));
  if (u.faceV) V_JAW.forEach((i, k) => curve(p(i), [vTargets[k * 2], vTargets[k * 2 + 1]]));
  if (u.faceNarrow) NARROW.forEach((i, k) => curve(p(i), [narrowTargets[k * 2], narrowTargets[k * 2 + 1]]));
  if (u.chin) curve(p16, chinTarget);
  if (u.forehead) curve(pt(face.ext, 0), pt(face.ext, 3));
  if (u.noseSlim) for (const [o, t] of NOSE) curve(p(o), p(t));
  if (u.mouthSize) disc(p(106), mouthR);
  if (u.eyeDistance || u.eyeEnlarge) {
    disc(p(74), eyeR[0]);
    disc(p(77), eyeR[1]);
  }
  const pad = 2 / 1024;
  box[0] -= pad;
  box[1] -= pad;
  box[2] += pad;
  box[3] += pad;
  return { vTargets, narrowTargets, chinTarget, mouthR, eyeR, eyeDisp, box };
}

/** texture units of P2 (S §4.8): src 0, body 1, protect array 2, face table 3 (texture carrier) */
export const BODY_UNIT = 1;
export const PROTECT_UNIT = 2;
export const FACE_TABLE_UNIT = 3;
/** the std140 block binding of the UBO carrier */
export const FACE_UBO_BINDING = 0;

/**
 * 瘦臉 background limit (stage 1 ②). The contour warps' displacement g (瘦臉 / V臉 / 窄臉 / 下巴 / 額頭 together) is held
 * within a budget B(sd) that depends on the signed distance sd to the person (FaceProtect, sampled where the face chain
 * samples: after the body map) and is 0 from R = PROTECT_REACH face widths outside the person on: so nothing farther out
 * moves. B rises inward at slope PROTECT_SLOPE, which bounds what the limit adds to the map's Jacobian (stretch ≤
 * 1/(1 − slope) where it binds; a short fall-off folds the background next to a cheek moved by more than its length),
 * and it starts with a smooth ramp over the outer PROTECT_RAMP·R (its slope eases in from 0, C²), so the wall lines get
 * no crease where the budget begins. |g| is replaced by a polynomial smooth minimum of |g| and B (width PROTECT_SMOOTH
 * face widths, C¹), so there is no crease where the budget starts to bind either; where |g| ≤ B − PROTECT_SMOOTH (the face
 * interior: B grows inward) the warp is today's exactly (eyes / nose / mouth: faceProtect.test.ts and the e2e).
 * In the tc = tc₀ + (tc_face − tc₀)·P form of the report, P = smin(|g|, B)/|g|, read where the face chain samples (tc₀,
 * after the body map: the landmarks and the person mask are both in source space), which is vUv without a body field.
 * The trade (measured at 瘦臉 + V臉 + 窄臉 max, faceProtect.test.ts): with a full-strength cheek moved by Δ, a fold-free,
 * bounded-stretch fall-off needs R ≳ Δ/slope, so the reach is about 0.6× today's (27–30 % FW) rather than the 15 % FW
 * the report estimated: a 15 % budget stretches the wall beside the cheek 2.5× (or folds it) and weakens the V臉 jaw.
 * The eye / nose / mouth warps run after the limit and are never limited; the live camera passes no FaceProtect.
 * v0.4 (S §4.4): the same budget, centred on a face's box centre with cap_f as its reach, is the multi-face cap.
 */
export const PROTECT_REACH = 0.3;
export const PROTECT_SLOPE = 0.45;
export const PROTECT_RAMP = 0.3;
export const PROTECT_SMOOTH = 0.025;

/** face width (contour 0 → 32) in iso units (fractions of the image width) */
export function faceWidthIso(face: Face, aspect: number): number {
  const P = face.pts111;
  return Math.hypot(P[0] - P[64], (P[1] - P[65]) / aspect);
}

const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The N-face reshape (S §4.4): the body field is the outermost backward map; every listed face's chain starts from the
 * same tcB (detected-landmark coordinates); a capped face's displacement is held within its cap budget (the 瘦臉 limit's
 * construction centred on c_f, 0 beyond cap_f); displacements are summed, and one face without a cap is its own chain
 * output, so a single face is bit-identical to v0.3. ONE resample of the source. The face table (96 texels per face,
 * faceTable.ts FT) rides in an RGBA32F NEAREST texture or a std140 UBO (FACE_TABLE_CARRIER). reshapeCpu.ts is the CPU
 * port; reshapeCpu.test.ts pins this text.
 */
export function reshapeFs(carrier: 'texture' | 'ubo'): string {
  return `#version 300 es
${carrier === 'ubo' ? '#define FACE_TABLE_UBO\n' : ''}precision highp float;
precision highp int;
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBodyDisp; // RG16F backward displacement in UV units, row 0 = image top
uniform float uBodyOn;
uniform mediump sampler2DArray uProtArr; // R16F signed distance (iso units) per face layer, row 0 = window top
uniform int uCount;
uniform float uAspect;  // W/H
out vec4 outColor;

const int MAX_RENDER_FACES = ${MAX_RENDER_FACES};
const float PROTECT_RAMP = ${glslFloat(PROTECT_RAMP)};
const float PROTECT_SLOPE = ${glslFloat(PROTECT_SLOPE)};
#ifdef FACE_TABLE_UBO
layout(std140) uniform FaceTab { vec4 uFaceTab[${FT.ROW * MAX_RENDER_FACES}]; };
vec4 F(int f, int i) { return uFaceTab[f * ${FT.ROW} + i]; }
#else
uniform highp sampler2D uFaces; // RGBA32F, NEAREST: one ${FT.ROW}-texel row per face
vec4 F(int f, int i) { return texelFetch(uFaces, ivec2(i, f), 0); }
#endif
vec2 pairOf(vec4 t, int k) { return (k & 1) == 0 ? t.xy : t.zw; }
vec2 P(int f, int k) { return pairOf(F(f, k >> 1), k); }
vec2 EXT(int f, int k) { return pairOf(F(f, ${FT.EXT} + (k >> 1)), k); }
vec2 VT(int f, int k) { return pairOf(F(f, ${FT.VT} + (k >> 1)), k); }
vec2 NT(int f, int k) { return pairOf(F(f, ${FT.NT} + (k >> 1)), k); }

vec2 iso(vec2 p) { return vec2(p.x, p.y / uAspect); }

// GPUPixel curveWarp: content within |t − o| of o moves toward t by up to d·(t − o).
vec2 curveWarp(vec2 tc, vec2 o, vec2 t, float d) {
  vec2 dir = (t - o) * d;
  float r = max(distance(iso(t), iso(o)), 1e-6);
  float k = clamp(1.0 - distance(iso(tc), iso(o)) / r, 0.0, 1.0);
  return tc - dir * k;
}

// GPUPixel enlargeEye: magnify only (weight clamped to [0,1]).
vec2 enlargeEye(vec2 tc, vec2 c, float R, float d) {
  float w = distance(iso(tc), iso(c)) / max(R, 1e-6);
  w = clamp(1.0 - (1.0 - w * w) * d, 0.0, 1.0);
  return c + (tc - c) * w;
}

// Bidirectional scale; monotonic (no fold) for |d| <= 0.5.
vec2 scaleAround(vec2 tc, vec2 c, float R, float d) {
  float w = distance(iso(tc), iso(c)) / max(R, 1e-6);
  return w >= 1.0 ? tc : c + (tc - c) * (1.0 - (1.0 - w * w) * d);
}

// Local translate: content near c moves by disp, smoothly fading to 0 at R.
vec2 shiftAround(vec2 tc, vec2 c, float R, vec2 disp) {
  float w = distance(iso(tc), iso(c)) / max(R, 1e-6);
  float k = clamp(1.0 - w * w, 0.0, 1.0);
  return tc - disp * k * k;
}

// The 瘦臉 limit's budget and smooth minimum (v0.3 protectContour), factored out: Ln / L, or 1.0 when it does not bind.
float budgetScale(float L, float t, float l, float slope, float k) {
  float x = t / max(l, 1e-6);
  float B = t <= 0.0 ? 0.0 : (t < l ? slope * l * x * x * x * (1.0 - 0.5 * x) : slope * (t - 0.5 * l));
  float h = max(k - abs(L - B), 0.0) / k;
  float Ln = max(min(L, B) - 0.25 * h * h * k, 0.0);
  return Ln >= L ? 1.0 : Ln / L;
}

// 瘦臉 background limit of face f: keep |tc − tc0| within the person-distance budget of its layer (window: texel ${FT.WIN}).
vec2 protectContour(int f, vec2 tc0, vec2 tc, float layer) {
  vec4 pr = F(f, ${FT.PROT});
  vec4 win = F(f, ${FT.WIN});
  vec2 g = tc - tc0;
  float L = length(iso(g));
  // textureLod: non-uniform control flow (after a per-fragment continue), where implicit derivatives are undefined
  float sd = textureLod(uProtArr, vec3((tc0 - win.xy) * win.zw, layer), 0.0).r;
  float s = budgetScale(L, pr.x - sd, pr.z * pr.x, pr.y, pr.w);
  return s >= 1.0 ? tc : tc0 + g * s;
}

const ivec2 SLIM[9] = ivec2[9](ivec2(3,44), ivec2(29,44), ivec2(7,45), ivec2(25,45),
                               ivec2(10,46), ivec2(22,46), ivec2(14,49), ivec2(18,49), ivec2(16,49));
const int V_JAW[6] = int[6](8, 10, 12, 24, 22, 20);
const int NARROW[4] = int[4](2, 4, 30, 28);
const ivec2 NOSE[4] = ivec2[4](ivec2(80,46), ivec2(81,46), ivec2(82,49), ivec2(83,49));

vec2 faceChain(int f, vec2 tc) {
  vec2 tc0 = tc;
  vec4 s1 = F(f, ${FT.S1});        // slim, v, narrow, chin
  vec4 s2 = F(f, ${FT.S2});        // forehead, nose, mouth, eye
  vec4 r = F(f, ${FT.RADII});      // eyeR.x, eyeR.y, mouthR, protect layer (−1 = none)
  vec4 ce = F(f, ${FT.CHIN_EYE});  // chinTarget, eyeDisp
  if (s1.x != 0.0) {
    for (int i = 0; i < 9; i++) tc = curveWarp(tc, P(f, SLIM[i].x), P(f, SLIM[i].y), s1.x);
  }
  if (s1.y != 0.0) {
    for (int i = 0; i < 6; i++) tc = curveWarp(tc, P(f, V_JAW[i]), VT(f, i), s1.y);
  }
  if (s1.z != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NARROW[i]), NT(f, i), s1.z);
  }
  if (s1.w != 0.0) tc = curveWarp(tc, P(f, 16), ce.xy, s1.w);
  if (s2.x != 0.0) tc = curveWarp(tc, EXT(f, 0), EXT(f, 3), s2.x);
  if (r.w >= 0.0) tc = protectContour(f, tc0, tc, r.w);
  if (s2.y != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NOSE[i].x), P(f, NOSE[i].y), s2.y);
  }
  if (s2.z != 0.0) tc = scaleAround(tc, P(f, 106), r.z, s2.z);
  if (ce.zw != vec2(0.0)) {
    tc = shiftAround(tc, P(f, 74), r.x, ce.zw);
    tc = shiftAround(tc, P(f, 77), r.y, -ce.zw);
  }
  if (s2.w != 0.0) {
    tc = enlargeEye(tc, P(f, 74), r.x, s2.w);
    tc = enlargeEye(tc, P(f, 77), r.y, s2.w);
  }
  return tc;
}

void main() {
  vec2 tcB = vUv;
  // Body first as a backward map = face first in forward terms: the face chains still see detected-landmark coordinates.
  if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, vUv).xy;
  vec2 acc = vec2(0.0);
  vec2 only = tcB;
  int hits = 0;
  bool anyCap = false;
  for (int f = 0; f < MAX_RENDER_FACES; f++) {
    if (f >= uCount) break;
    vec4 box = F(f, ${FT.BOX});
    if (any(lessThan(tcB, box.xy)) || any(greaterThan(tcB, box.zw))) continue;
    vec2 tc = faceChain(f, tcB);
    vec2 d = tc - tcB;
    vec4 cap = F(f, ${FT.CAP});
    if (cap.z >= 0.0) {
      // the cap: the same budget as the 瘦臉 limit, centred on c_f, 0 beyond cap_f
      d *= budgetScale(length(iso(d)), cap.z - distance(iso(tcB), iso(cap.xy)), PROTECT_RAMP * cap.z, PROTECT_SLOPE, cap.w);
      anyCap = true;
    }
    acc += d;
    only = tc;
    hits++;
  }
  // one face without a cap: its chain output itself, so the single-face map is bit-identical to v0.3
  vec2 tc = (hits == 1 && !anyCap) ? only : tcB + acc;
  outColor = texture(uSrc, tc);
}`;
}

/** exported for the CPU port's sync check (reshapeCpu.test.ts) */
export const RESHAPE_FS = reshapeFs('texture');

/** uBox that no coordinate falls in: the face chain is skipped entirely (no face / all face deltas 0). */
export const EMPTY_BOX = [1e9, 1e9, -1e9, -1e9] as const;

/** a protect layer's edge bound (pipeline.ts MAX_BODY_FIELD_EDGE): keeps texImage3D within every device's limits */
const MAX_PROTECT_EDGE = 2048;

/** true when `p` has an uploadable shape (pipeline.ts faceProtectValid); its data's finiteness is checked on upload */
function protectShapeValid(p: FaceProtect): boolean {
  const { width: w, height: h, data } = p;
  return (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w > 0 &&
    h > 0 &&
    w <= MAX_PROTECT_EDGE &&
    h <= MAX_PROTECT_EDGE &&
    data instanceof Float32Array &&
    data.length >= w * h
  );
}

export interface ReshapePass {
  /**
   * Sample `src` (any size, by UV) and write the warped image into `dst`. `faces` exactly as packed (yaw-attenuated,
   * × weight; faceCap.ts TableFace), at most MAX_RENDER_FACES; `protects[layer]` are their 瘦臉 limits (all the same
   * size: the photo grid for one face, PROTECT_WINDOW² windows for ≥ 2; a malformed or mismatched layer is ignored and
   * its face drawn unlimited); `aspect` defaults to dst's (pass the image's for the ¼-res mask); `body` = RG16F
   * backward displacement texture (UV units), applied before the face chains; null = none.
   */
  drawFaces(src: Texture, dst: Framebuffer, faces: readonly TableFace[], opts?: { aspect?: number; body?: Texture | null; protects?: readonly FaceProtect[] }): void;
  /**
   * One face with v0.3's signature (harnesses, pins, the pipeline until RenderInput v0.4): yaw attenuation applied
   * here, no cap; `face` / `u` null = no face warp (body only); `protect` = the 瘦臉 limit's data (uploaded by the pass).
   */
  draw(src: Texture, dst: Framebuffer, face: Face | null, u: ReshapeUniforms | null, aspect?: number, body?: Texture | null, protect?: FaceProtect | null): void;
  dispose(): void;
}

export function createReshapePass(gl: GL, opts: { carrier?: 'texture' | 'ubo' } = {}): ReshapePass {
  const carrier = opts.carrier ?? 'texture';
  const prog: Program = createProgram(gl, FULLSCREEN_VS, reshapeFs(carrier), 'reshape');
  prog.use();
  gl.uniform1i(prog.u('uSrc'), 0);
  gl.uniform1i(prog.u('uBodyDisp'), BODY_UNIT);
  gl.uniform1i(prog.u('uProtArr'), PROTECT_UNIT);
  const table = new Float32Array(FT.ROW * MAX_RENDER_FACES * 4);
  /** what the carrier holds (the packed rows of the last upload); null = nothing uploaded yet */
  let uploaded: Float32Array | null = null;
  let tableTex: Texture | null = null;
  let ubo: WebGLBuffer | null = null;
  if (carrier === 'texture') {
    gl.uniform1i(prog.u('uFaces'), FACE_TABLE_UNIT);
    tableTex = createTexture(gl, FT.ROW, MAX_RENDER_FACES, { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST });
  } else {
    gl.uniformBlockBinding(prog.program, gl.getUniformBlockIndex(prog.program, 'FaceTab'), FACE_UBO_BINDING);
    ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, table.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }
  // Bound on the body / protect units when there is no field / no limit, so a sampler never reads an empty unit.
  const zero = createTexture(gl, 1, 1);
  const zeroArr = createTextureArray(gl, 1, 1, 1, gl.R16F);
  let protArr: (Texture & { layers: number }) | null = null;
  /**
   * what each layer holds: re-uploaded only when its object, data or version changes; `finite` false = the data held a
   * non-finite value and nothing was uploaded (a NaN would turn the sample coordinate into garbage)
   */
  let layerKeys: { p: FaceProtect; data: Float32Array; version: number; finite: boolean }[] = [];
  let warned = false;

  /** upload the layers that changed; returns which layers are usable (the rest are ignored, their faces unlimited) */
  const uploadProtects = (protects: readonly FaceProtect[]): boolean[] => {
    if (!protects.length) return [];
    const valid = protects.map(protectShapeValid);
    const first = protects.find((_, i) => valid[i]);
    const ok = protects.map((p, i) => valid[i] && !!first && p.width === first.width && p.height === first.height);
    if (first) {
      const { width: w, height: h } = first;
      if (!protArr || protArr.width !== w || protArr.height !== h || protArr.layers < protects.length) {
        if (protArr) gl.deleteTexture(protArr.tex);
        protArr = createTextureArray(gl, w, h, protects.length, gl.R16F);
        layerKeys = [];
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, protArr.tex);
      setUnpackState(gl);
      protects.forEach((p, i) => {
        if (!ok[i]) return;
        const k = layerKeys[i];
        if (k && k.p === p && k.data === p.data && k.version === p.version) {
          ok[i] = k.finite;
          return;
        }
        const data = p.data.subarray(0, w * h);
        const finite = data.every(Number.isFinite);
        // R16F from FLOAT data: core WebGL2, filterable (LINEAR) without extensions
        if (finite) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RED, gl.FLOAT, data);
        layerKeys[i] = { p, data: p.data, version: p.version, finite };
        ok[i] = finite;
      });
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }
    if (ok.includes(false) && !warned) {
      warned = true;
      console.warn('[engine] ignoring a malformed, non-finite or mismatched face limit layer', protects.map((p) => [p.width, p.height]));
    }
    return ok;
  };

  const drawFaces: ReshapePass['drawFaces'] = (src, dst, facesIn, o = {}) => {
    const aspect = o.aspect ?? dst.width / dst.height;
    const protects = o.protects ?? [];
    const ok = uploadProtects(protects);
    const faces = facesIn.slice(0, MAX_RENDER_FACES).map((t) => (t.layer >= 0 && !ok[t.layer] ? { ...t, layer: -1 } : t));
    packFaceTable(faces, aspect, table);
    const n = faces.length * FT.ROW * 4;
    const changed = !uploaded || uploaded.length !== n || uploaded.some((v, i) => v !== table[i]);
    if (changed) {
      if (tableTex) {
        gl.bindTexture(gl.TEXTURE_2D, tableTex.tex);
        setUnpackState(gl);
        if (faces.length) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FT.ROW, faces.length, gl.RGBA, gl.FLOAT, table.subarray(0, n));
      } else {
        gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, table);
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
      }
      uploaded = table.slice(0, n);
    }
    bindTarget(gl, dst);
    gl.disable(gl.BLEND);
    prog.use();
    bindTexture(gl, 0, src);
    bindTexture(gl, BODY_UNIT, o.body ?? zero);
    gl.uniform1f(prog.u('uBodyOn'), o.body ? 1 : 0);
    bindTextureArray(gl, PROTECT_UNIT, protArr && ok.includes(true) ? protArr.tex : zeroArr.tex);
    if (tableTex) bindTexture(gl, FACE_TABLE_UNIT, tableTex);
    else gl.bindBufferBase(gl.UNIFORM_BUFFER, FACE_UBO_BINDING, ubo);
    gl.uniform1i(prog.u('uCount'), faces.length);
    gl.uniform1f(prog.u('uAspect'), aspect);
    drawFullscreen(gl);
    bindTexture(gl, BODY_UNIT, null);
    bindTextureArray(gl, PROTECT_UNIT, null);
    if (tableTex) bindTexture(gl, FACE_TABLE_UNIT, null);
    else gl.bindBufferBase(gl.UNIFORM_BUFFER, FACE_UBO_BINDING, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  return {
    drawFaces,
    draw(src, dst, face, u, aspectIn, body, protect) {
      const faces: TableFace[] = face && u ? [{ face, u: attenuate(u, face.yaw), layer: protect ? 0 : -1, window: protect?.window ?? WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 }] : [];
      drawFaces(src, dst, faces, { aspect: aspectIn, body, protects: protect ? [protect] : [] });
    },
    dispose() {
      prog.dispose();
      deleteTexture(gl, zero);
      gl.deleteTexture(zeroArr.tex);
      if (protArr) gl.deleteTexture(protArr.tex);
      deleteTexture(gl, tableTex);
      if (ubo) gl.deleteBuffer(ubo);
      protArr = null;
      layerKeys = [];
      uploaded = null;
    },
  };
}
