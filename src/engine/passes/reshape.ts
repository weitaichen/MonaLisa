/*
 * GPUPixel
 *
 * Created by PixPark on 2021/6/24.
 * Copyright © 2021 PixPark. All rights reserved.
 */
// Derived from GPUPixel src/filter/face_reshape_filter.cc (GLES variant, pixpark/gpupixel@ef552bf, Apache-2.0);
// modified: GLSL ES 3.00; vec2 uPts[111] instead of float facePoints[212]; curveWarp / enlargeEye kept,
// new scaleAround / shiftAround primitives and V-face, narrow, chin, forehead, nose, mouth and
// eye-distance warps (RB §2.4); big-eye radius from eye width instead of lid distance; yaw
// attenuation; uniform early-outs (zero deltas, face bounding box); 美體 backward displacement texture as
// the outermost map (body research report §管線); a person-distance budget on the contour warps (瘦臉 background
// limit, reports/美體修圖 背景扭曲 抑制技術.md stage 1 ②).
import type { Face, ParamId } from '../../types';
import { signed } from '../params';
import { createProgram, createTexture, deleteTexture, drawFullscreen, bindTarget, bindTexture, FULLSCREEN_VS } from '../gl/gl';
import type { Framebuffer, GL, Program, Texture } from '../gl/gl';
import { FACE_TEMPLATE } from './faceMesh';

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

/** texture unit of uBodyDisp (unit 0 = uSrc) */
export const BODY_UNIT = 1;
/** texture unit of uFaceProt */
export const PROTECT_UNIT = 2;

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

/** exported for the CPU port's sync check (reshapeCpu.test.ts) */
export const RESHAPE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uPts[111];
uniform vec2 uExt[8];   // MediaPipe-only anchors (types.ts Face.ext order)
uniform float uAspect;  // W/H
uniform vec4 uBox;      // UV bounds of all active warps
uniform float uSlim, uV, uNarrow, uChin, uForehead, uNose, uMouth, uEye;
uniform vec2 uVT[6];
uniform vec2 uNT[4];
uniform vec2 uChinT;
uniform float uMouthR;
uniform vec2 uEyeR;
uniform vec2 uEyeDisp;
uniform sampler2D uBodyDisp; // RG16F backward displacement in UV units, row 0 = image top
uniform float uBodyOn;
uniform sampler2D uFaceProt; // R16F signed distance to the person (iso units), row 0 = image top
uniform float uProtOn;
uniform vec4 uProt;          // reach R (iso), slope, ramp (× R), smooth-min width (iso): the contour budget (reshape.ts)
out vec4 outColor;

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

// 瘦臉 background limit: the contour chain moved tc0 to tc; keep |tc − tc0| within the person-distance budget.
vec2 protectContour(vec2 tc0, vec2 tc) {
  vec2 g = tc - tc0;
  float L = length(iso(g));
  float t = uProt.x - texture(uFaceProt, tc0).r;
  float l = uProt.z * uProt.x;
  float x = t / max(l, 1e-6);
  float B = t <= 0.0 ? 0.0 : (t < l ? uProt.y * l * x * x * x * (1.0 - 0.5 * x) : uProt.y * (t - 0.5 * l));
  float h = max(uProt.w - abs(L - B), 0.0) / uProt.w;
  float Ln = max(min(L, B) - 0.25 * h * h * uProt.w, 0.0);
  if (Ln >= L) return tc;
  return tc0 + g * (Ln / L);
}

const ivec2 SLIM[9] = ivec2[9](ivec2(3,44), ivec2(29,44), ivec2(7,45), ivec2(25,45),
                               ivec2(10,46), ivec2(22,46), ivec2(14,49), ivec2(18,49), ivec2(16,49));
const int V_JAW[6] = int[6](8, 10, 12, 24, 22, 20);
const int NARROW[4] = int[4](2, 4, 30, 28);
const ivec2 NOSE[4] = ivec2[4](ivec2(80,46), ivec2(81,46), ivec2(82,49), ivec2(83,49));

void main() {
  vec2 tc = vUv;
  // Body first as a backward map = face first in forward terms: the face chain below still sees
  // detected-landmark coordinates, and it is the identity outside uBox, so pose anchors are untouched.
  if (uBodyOn != 0.0) tc += uBodyOn * texture(uBodyDisp, vUv).xy;
  if (all(greaterThanEqual(tc, uBox.xy)) && all(lessThanEqual(tc, uBox.zw))) {
    vec2 tc0 = tc;
    if (uSlim != 0.0) {
      for (int i = 0; i < 9; i++) tc = curveWarp(tc, uPts[SLIM[i].x], uPts[SLIM[i].y], uSlim);
    }
    if (uV != 0.0) {
      for (int i = 0; i < 6; i++) tc = curveWarp(tc, uPts[V_JAW[i]], uVT[i], uV);
    }
    if (uNarrow != 0.0) {
      for (int i = 0; i < 4; i++) tc = curveWarp(tc, uPts[NARROW[i]], uNT[i], uNarrow);
    }
    if (uChin != 0.0) tc = curveWarp(tc, uPts[16], uChinT, uChin);
    if (uForehead != 0.0) tc = curveWarp(tc, uExt[0], uExt[3], uForehead);
    if (uProtOn != 0.0) tc = protectContour(tc0, tc);
    if (uNose != 0.0) {
      for (int i = 0; i < 4; i++) tc = curveWarp(tc, uPts[NOSE[i].x], uPts[NOSE[i].y], uNose);
    }
    if (uMouth != 0.0) tc = scaleAround(tc, uPts[106], uMouthR, uMouth);
    if (uEyeDisp != vec2(0.0)) {
      tc = shiftAround(tc, uPts[74], uEyeR.x, uEyeDisp);
      tc = shiftAround(tc, uPts[77], uEyeR.y, -uEyeDisp);
    }
    if (uEye != 0.0) {
      tc = enlargeEye(tc, uPts[74], uEyeR.x, uEye);
      tc = enlargeEye(tc, uPts[77], uEyeR.y, uEye);
    }
  }
  outColor = texture(uSrc, tc);
}`;

/** uBox that no coordinate falls in: the face chain is skipped entirely (no face / all face deltas 0). */
export const EMPTY_BOX = [1e9, 1e9, -1e9, -1e9] as const;

export interface ReshapePass {
  /**
   * Sample `src` (any size, by UV) and write the warped image into `dst` (processing size).
   * `aspect` (W/H of the processing size) defaults to dst's; pass it when dst is a scaled buffer
   * (the ¼-res mask) so the map is exactly the image's.
   * `face` / `u` null = no face warp (body only). `body` = RG16F backward displacement texture (UV
   * units), applied before the face chain; null = none. Yaw attenuation scales the face deltas only.
   * `protect` = R16F FaceProtect distance texture: limits the contour warps (PROTECT_REACH); null = unlimited.
   */
  draw(
    src: Texture,
    dst: Framebuffer,
    face: Face | null,
    u: ReshapeUniforms | null,
    aspect?: number,
    body?: Texture | null,
    protect?: Texture | null,
  ): void;
  dispose(): void;
}

export function createReshapePass(gl: GL): ReshapePass {
  const prog: Program = createProgram(gl, FULLSCREEN_VS, RESHAPE_FS, 'reshape');
  prog.use();
  gl.uniform1i(prog.u('uSrc'), 0);
  gl.uniform1i(prog.u('uBodyDisp'), BODY_UNIT);
  gl.uniform1i(prog.u('uFaceProt'), PROTECT_UNIT);
  // Bound on the body / protect units when there is no texture, so a sampler never reads an empty unit.
  const zero = createTexture(gl, 1, 1);

  return {
    draw(src, dst, faceIn, uIn, aspectIn, body, protect) {
      const aspect = aspectIn ?? dst.width / dst.height;
      let face: Face | null = null;
      let u: ReshapeUniforms | null = null;
      if (faceIn && uIn) {
        const att = yawAttenuation(faceIn.yaw);
        u = { ...uIn };
        for (const key of Object.keys(u) as (keyof ReshapeUniforms)[]) u[key] *= att;
        // Any non-zero delta (not reshapeActive's 1e-4): keeps the face-only output bit-identical to
        // the pre-body pass, which warped whenever it ran.
        if (Object.values(u).some((v) => v !== 0)) face = faceIn;
      }

      bindTarget(gl, dst);
      gl.disable(gl.BLEND);
      prog.use();
      bindTexture(gl, 0, src);
      bindTexture(gl, BODY_UNIT, body ?? zero);
      gl.uniform1f(prog.u('uBodyOn'), body ? 1 : 0);
      const prot = face && protect ? protect : null;
      bindTexture(gl, PROTECT_UNIT, prot ?? zero);
      gl.uniform1f(prog.u('uProtOn'), prot ? 1 : 0);
      gl.uniform1f(prog.u('uAspect'), aspect);
      if (face && u) {
        const g = reshapeGeometry(face, aspect, u);
        gl.uniform2fv(prog.u('uPts'), face.pts111);
        gl.uniform2fv(prog.u('uExt'), face.ext);
        gl.uniform4f(prog.u('uBox'), g.box[0], g.box[1], g.box[2], g.box[3]);
        gl.uniform1f(prog.u('uSlim'), u.faceSlim);
        gl.uniform1f(prog.u('uV'), u.faceV);
        gl.uniform1f(prog.u('uNarrow'), u.faceNarrow);
        gl.uniform1f(prog.u('uChin'), u.chin);
        gl.uniform1f(prog.u('uForehead'), u.forehead);
        gl.uniform1f(prog.u('uNose'), u.noseSlim);
        gl.uniform1f(prog.u('uMouth'), u.mouthSize);
        gl.uniform1f(prog.u('uEye'), u.eyeEnlarge);
        gl.uniform2fv(prog.u('uVT'), g.vTargets);
        gl.uniform2fv(prog.u('uNT'), g.narrowTargets);
        gl.uniform2f(prog.u('uChinT'), g.chinTarget[0], g.chinTarget[1]);
        gl.uniform1f(prog.u('uMouthR'), g.mouthR);
        gl.uniform2f(prog.u('uEyeR'), g.eyeR[0], g.eyeR[1]);
        gl.uniform2f(prog.u('uEyeDisp'), g.eyeDisp[0], g.eyeDisp[1]);
        const fw = faceWidthIso(face, aspect);
        gl.uniform4f(prog.u('uProt'), PROTECT_REACH * fw, PROTECT_SLOPE, PROTECT_RAMP, PROTECT_SMOOTH * fw);
      } else {
        gl.uniform4f(prog.u('uBox'), EMPTY_BOX[0], EMPTY_BOX[1], EMPTY_BOX[2], EMPTY_BOX[3]);
      }
      drawFullscreen(gl);
      bindTexture(gl, BODY_UNIT, null);
      bindTexture(gl, PROTECT_UNIT, null);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose() {
      prog.dispose();
      deleteTexture(gl, zero);
    },
  };
}
