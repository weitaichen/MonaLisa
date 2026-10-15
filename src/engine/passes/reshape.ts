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
// (texture or UBO), their displacements capped and summed, one 瘦臉 limit layer per face in an R16F array; step 3: the
// V → O geometry, buffer tile and source window uniforms (uGeo, uTile, uWin) around the chain; step 5: 下頜線, 太陽穴,
// 髮際線, 鼻翼, 山根 and 嘴高 warps, new shiftEllipse / squeezeAxis primitives, per-side strengths (左右分開); step 6:
// the 推臉筆 RG16F field (uLiqDisp) sampled at O before the 美體 field.
import { MAX_RENDER_FACES } from '../../config/limits';
import { IDENTITY_MAT3 } from '../../geometry/view';
import type { Face, FaceProtect, ParamId, PersonParams, SplitParamId } from '../../types';
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

/** Engine-space deltas (already scaled per RB §2.4 / face-detail spec §4.2 and multiplied by the live weight). */
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
  /** 左右分開: GPUPixel-right strengths of the split items; equal to the left ones, bit for bit, while it is off */
  faceSlimR: number;
  faceVR: number;
  faceNarrowR: number;
  eyeEnlargeR: number;
  /** step 5 (face-detail spec §4.2) */
  jawline: number;
  jawlineR: number;
  temple: number;
  templeR: number;
  hairline: number;
  noseWing: number;
  noseBridge: number;
  mouthHeight: number;
}

type ScaleKey = Exclude<keyof ReshapeUniforms, 'faceSlimR' | 'faceVR' | 'faceNarrowR' | 'eyeEnlargeR' | 'jawlineR' | 'templeR'>;

/** RB §2.4 "Delta" column; the step-5 rows are face-detail spec §4.2's engine deltas. eyeDistance is a fraction of the inter-ocular distance (signed). */
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
  jawline: 0.12,
  temple: 0.22,
  hairline: 0.09,
  noseWing: 0.1,
  noseBridge: 0.3,
  mouthHeight: 0.18,
} as const satisfies Record<ScaleKey, number>;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const clampS = (v: number) => Math.min(1, Math.max(-1, signed(clamp01(v))));

/** the 美型 items: what the reshape uniforms read (a full Record<ParamId, number> and PersonParams.values both fit) */
type ShapeId = Extract<ParamId, `shape.${string}`>;

export function reshapeUniforms(values: Readonly<Record<ShapeId, number>>, faceWeight: number, right: PersonParams['right'] = null): ReshapeUniforms {
  const w = clamp01(faceWeight);
  const one = (id: ShapeId) => clamp01(values[id]) * w;
  const bi = (id: ShapeId) => clampS(values[id]) * w;
  /** the GPUPixel-right value of a split item: right[id] while 左右分開 is on, else the shared value (same float ops) */
  const rv = (id: SplitParamId) => {
    const r = right?.[id];
    return typeof r === 'number' ? r : values[id];
  };
  const oneR = (id: SplitParamId) => clamp01(rv(id)) * w;
  const biR = (id: SplitParamId) => clampS(rv(id)) * w;
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
    faceSlimR: k.faceSlim * oneR('shape.faceSlim'),
    faceVR: k.faceV * oneR('shape.faceV'),
    faceNarrowR: k.faceNarrow * oneR('shape.faceNarrow'),
    eyeEnlargeR: k.eyeEnlarge * oneR('shape.eyeEnlarge'),
    jawline: k.jawline * one('shape.jawline'),
    jawlineR: k.jawline * oneR('shape.jawline'),
    temple: k.temple * bi('shape.temple'),
    templeR: k.temple * biR('shape.temple'),
    hairline: k.hairline * bi('shape.hairline'),
    noseWing: k.noseWing * bi('shape.noseWing'),
    noseBridge: k.noseBridge * bi('shape.noseBridge'),
    mouthHeight: k.mouthHeight * bi('shape.mouthHeight'),
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
/** 下頜線 origins: contour L 6–14, R 26–18 (jaw angle → chin, chin 16 excluded; S5 §4.1) */
export const JAW = [6, 8, 10, 12, 14, 26, 24, 22, 20, 18] as const;
/** 太陽穴 anchors, Face.oval indices: GPUPixel-left MP 162, 21, 54 · right MP 389, 251, 284 (faceOval.ts:6-9) */
export const TEMPLE = [30, 31, 32, 6, 5, 4] as const;
export const TEMPLE_W = [0.6, 1, 0.6, 0.6, 1, 0.6] as const;
/** side of each split anchor: 0 GPUPixel-left, 1 right, 0.5 the midline p16 (S5 §4.3) */
export const SLIM_SIDE = [0, 1, 0, 1, 0, 1, 0, 1, 0.5] as const;
export const VJAW_SIDE = [0, 0, 0, 1, 1, 1] as const;
export const NARROW_SIDE = [0, 0, 1, 1] as const;
export const JAW_SIDE = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1] as const;
export const TEMPLE_SIDE = [0, 0, 0, 1, 1, 1] as const;
/** the strength of an anchor on `side`: exactly `dl` when dr === dl (左右分開 off), so v0.3 maps stay bit-identical */
export function sided(dl: number, dr: number, side: number): number {
  return dl + (dr - dl) * side;
}

/** Anchors derived on the CPU once per frame (cheaper than per fragment). All in UV space unless marked iso. */
export interface ReshapeGeometry {
  vTargets: Float32Array; // 6 × vec2
  narrowTargets: Float32Array; // 4 × vec2
  chinTarget: V2;
  mouthR: number; // iso units
  eyeR: V2; // iso units, image-left / image-right eye
  eyeDisp: V2; // UV displacement of the image-left eye (right eye gets the negation)
  /** UV bounding box (minX, minY, maxX, maxY) of every active warp's influence region */
  box: [number, number, number, number];
  /** iso unit axes: r̂ (GPUPixel-left eye → right eye), m̂ (toward the chin) — S5 §4.1 */
  axes: [number, number, number, number];
  /** 下頜線 targets, 10 × vec2, JAW order */
  jawTargets: Float32Array;
  /** 太陽穴 anchors and targets, 6 × vec2 each, TEMPLE order */
  templeAnchors: Float32Array;
  templeTargets: Float32Array;
  /** 髮際線 at ext[0]: effective strength (0 on a degenerate face), radii (rx, ry↑, ry↓) iso, clamped disp UV */
  hairlineS: number;
  hairlineRadii: [number, number, number];
  hairlineDisp: V2;
  /** 嘴高 at p106: effective strength, radii (rx, ry↑, ry↓) iso, axis ay (iso, toward the chin side), clamped disp UV */
  mouthHS: number;
  mouthHRadii: [number, number, number];
  mouthHAxis: V2;
  mouthHDisp: V2;
  /** 鼻翼: effective strength, disc radius iso, clamped UV displacement of the left wing (the right gets −) */
  noseWingS: number;
  noseWingR: number;
  noseWingDisp: V2;
  /** 山根: band centre (UV), r− and r+ (iso); band half-height iso; clamped k (0 when the band is under 0.01 FW) */
  root: [number, number, number, number];
  rootRy: number;
  rootK: number;
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
  const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
  const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
  const unit = (a: V2): V2 => {
    const l = Math.hypot(a[0], a[1]);
    return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
  };
  /** a UV vector whose iso length is clamped to `maxIso` (S5 §4.2 fold-safety clamps) */
  const clampDisp = (d: V2, maxIso: number): V2 => {
    const l = Math.hypot(d[0], d[1] / aspect);
    return l > maxIso && l > 0 ? [(d[0] * maxIso) / l, (d[1] * maxIso) / l] : d;
  };

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

  // ── step 5 (face-detail spec §4.1–4.2) ──
  const fw = faceWidthIso(face, aspect);
  const mh = unit(md);
  const rh0: V2 = [-mh[1], mh[0]];
  const rh: V2 = dot(rh0, sub(iso(e1), iso(e0))) < 0 ? [-rh0[0], -rh0[1]] : rh0;
  const axes: [number, number, number, number] = [rh[0], rh[1], mh[0], mh[1]];

  // 下頜線: t_i = p_i + uv(0.22·FW·unit(n_i − 0.35·m̂)), n_i ⊥ (p_{i+1} − p_{i−1}) toward the nose tip p46
  const jawTargets = new Float32Array(20);
  JAW.forEach((i, k) => {
    const tg = sub(iso(p(i + 1)), iso(p(i - 1)));
    const n0 = unit([-tg[1], tg[0]]);
    const n = dot(n0, sub(iso(p(46)), iso(p(i)))) < 0 ? [-n0[0], -n0[1]] : n0;
    const dir = unit([n[0] - 0.35 * mh[0], n[1] - 0.35 * mh[1]]);
    const d = uv([dir[0] * 0.22 * fw, dir[1] * 0.22 * fw]);
    jawTargets[k * 2] = p(i)[0] + d[0];
    jawTargets[k * 2 + 1] = p(i)[1] + d[1];
  });

  // 太陽穴: t_k = o_k + uv(0.12·FW·n_out), n_out ⊥ (oval[k+1] − oval[k−1]) away from the oval centroid
  const ov = (k: number): V2 => {
    const j = ((k % 36) + 36) % 36;
    return [face.oval[j * 2], face.oval[j * 2 + 1]];
  };
  const cen: V2 = [0, 0];
  for (let k = 0; k < 36; k++) {
    const q = iso(ov(k));
    cen[0] += q[0] / 36;
    cen[1] += q[1] / 36;
  }
  const templeAnchors = new Float32Array(12);
  const templeTargets = new Float32Array(12);
  TEMPLE.forEach((j, k) => {
    const o = ov(j);
    const tg = sub(iso(ov(j + 1)), iso(ov(j - 1)));
    const n0 = unit([-tg[1], tg[0]]);
    const n = dot(n0, sub(iso(o), cen)) < 0 ? [-n0[0], -n0[1]] : n0;
    const d = uv([n[0] * 0.12 * fw, n[1] * 0.12 * fw]);
    templeAnchors.set(o, k * 2);
    templeTargets.set([o[0] + d[0], o[1] + d[1]], k * 2);
  });

  // 髮際線: shiftEllipse at ext[0], axes r̂ / m̂, radii (0.40 FW, 0.50 FH, 0.55 FH); disp = uv(0.09·s·FH·m̂), + moves down
  const ext0 = pt(face.ext, 0);
  const fh = dist(ext0, pt(face.ext, 2));
  const hairlineRadii: [number, number, number] = [0.4 * fw, 0.5 * fh, 0.55 * fh];
  const hairOk = fh > 1e-6 && fw > 1e-6;
  const hairlineDisp = hairOk ? clampDisp(uv([u.hairline * fh * mh[0], u.hairline * fh * mh[1]]), 0.2 * hairlineRadii[1]) : ([0, 0] as V2);
  const hairlineS = hairOk ? u.hairline : 0;

  // 嘴高: shiftEllipse at p106, ay = unit(p106 − p49), rx = 2·max corner offset along ax, ry = (L, 1.6·L); disp = uv(−0.18·s·L·ay)
  const L = dist(p(106), p49);
  const ay = unit(sub(iso(p(106)), iso(p49)));
  const axm: V2 = [-ay[1], ay[0]];
  const rxM = 2 * Math.max(Math.abs(dot(axm, sub(iso(p(84)), iso(p(106))))), Math.abs(dot(axm, sub(iso(p(90)), iso(p(106))))));
  const mouthHRadii: [number, number, number] = [rxM, L, 1.6 * L];
  const mouthOk = L > 1e-6 && rxM > 1e-6;
  const mouthHDisp = mouthOk ? clampDisp(uv([-u.mouthHeight * L * ay[0], -u.mouthHeight * L * ay[1]]), 0.2 * L) : ([0, 0] as V2);
  const mouthHS = mouthOk ? u.mouthHeight : 0;

  // 鼻翼: opposed shiftArounds at p80 / p81, R = 0.55·|p81 − p80|, disp_L = −0.10·s·(p81 − p80)
  const noseWingR = 0.55 * dist(p(81), p(80));
  const wingOk = noseWingR > 1e-6;
  const noseWingDisp = wingOk ? clampDisp([-u.noseWing * (p(81)[0] - p(80)[0]), -u.noseWing * (p(81)[1] - p(80)[1])], 0.32 * noseWingR) : ([0, 0] as V2);
  const noseWingS = wingOk ? u.noseWing : 0;

  // 山根: squeezeAxis across the band between the inner eye corners p55 / p58, centred on mid(p78, p79)
  const rc: V2 = [(p(78)[0] + p(79)[0]) / 2, (p(78)[1] + p(79)[1]) / 2];
  const rMinus = dot(rh, sub(iso(rc), iso(p(55))));
  const rPlus = dot(rh, sub(iso(p(58)), iso(rc)));
  const rootRy = dist(p(45), p(43));
  const rootOk = rMinus >= 0.01 * fw && rPlus >= 0.01 * fw && rootRy > 1e-6;
  const rootK = rootOk ? Math.min(0.5, Math.max(-0.5, u.noseBridge)) : 0;
  const root: [number, number, number, number] = [rc[0], rc[1], rMinus, rPlus];

  // Union of influence regions → UV box. Warps outside every region are identity, and a coordinate outside all of
  // them is never moved, so skipping it is exact.
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const disc = (o: V2, r: number) => {
    box[0] = Math.min(box[0], o[0] - r);
    box[1] = Math.min(box[1], o[1] - r * aspect);
    box[2] = Math.max(box[2], o[0] + r);
    box[3] = Math.max(box[3], o[1] + r * aspect);
  };
  /** bounding box of a rotated ellipse: semi-axes rx along ax and ry along ay (iso), S5 §4.4 */
  const ellipse = (c: V2, ax: V2, ayy: V2, rx: number, ry: number) => {
    const hx = Math.hypot(rx * ax[0], ry * ayy[0]);
    const hy = Math.hypot(rx * ax[1], ry * ayy[1]) * aspect;
    box[0] = Math.min(box[0], c[0] - hx);
    box[1] = Math.min(box[1], c[1] - hy);
    box[2] = Math.max(box[2], c[0] + hx);
    box[3] = Math.max(box[3], c[1] + hy);
  };
  const curve = (o: V2, t: V2) => disc(o, dist(o, t));
  const at2 = (a: Float32Array, k: number): V2 => [a[k * 2], a[k * 2 + 1]];
  if (u.faceSlim || u.faceSlimR) for (const [o, t] of SLIM) curve(p(o), p(t));
  if (u.faceV || u.faceVR) V_JAW.forEach((i, k) => curve(p(i), at2(vTargets, k)));
  if (u.faceNarrow || u.faceNarrowR) NARROW.forEach((i, k) => curve(p(i), at2(narrowTargets, k)));
  if (u.jawline || u.jawlineR) JAW.forEach((i, k) => curve(p(i), at2(jawTargets, k)));
  if (u.temple || u.templeR) TEMPLE.forEach((_, k) => curve(at2(templeAnchors, k), at2(templeTargets, k)));
  if (u.chin) curve(p16, chinTarget);
  if (u.forehead) curve(pt(face.ext, 0), pt(face.ext, 3));
  if (hairlineS) ellipse(ext0, rh, mh, hairlineRadii[0], Math.max(hairlineRadii[1], hairlineRadii[2]));
  if (u.noseSlim) for (const [o, t] of NOSE) curve(p(o), p(t));
  if (noseWingS) {
    disc(p(80), noseWingR);
    disc(p(81), noseWingR);
  }
  // the band is the rectangle |a| ≤ r±, |v| ≤ ry around rc: its circumscribed disc (S5 §4.4's max(r−, r+, ry) misses
  // the corners, where the squeeze still moves content by up to 0.09 px on the fixture: a seam at the box edge)
  if (rootK) disc(rc, Math.hypot(Math.max(rMinus, rPlus), rootRy));
  if (mouthHS) ellipse(p(106), axm, ay, mouthHRadii[0], mouthHRadii[2]);
  if (u.mouthSize) disc(p(106), mouthR);
  if (u.eyeDistance || u.eyeEnlarge || u.eyeEnlargeR) {
    disc(p(74), eyeR[0]);
    disc(p(77), eyeR[1]);
  }
  const pad = 2 / 1024;
  box[0] -= pad;
  box[1] -= pad;
  box[2] += pad;
  box[3] += pad;
  return {
    vTargets,
    narrowTargets,
    chinTarget,
    mouthR,
    eyeR,
    eyeDisp,
    box,
    axes,
    jawTargets,
    templeAnchors,
    templeTargets,
    hairlineS,
    hairlineRadii,
    hairlineDisp,
    mouthHS,
    mouthHRadii,
    mouthHAxis: ay,
    mouthHDisp,
    noseWingS,
    noseWingR,
    noseWingDisp,
    root,
    rootRy,
    rootK,
  };
}

/**
 * Upper bound of how far the face chain moves any coordinate, in iso units (fractions of the image width): the sum of
 * each active warp's largest move (S §4.4 D7): curveWarp |t − o|·|d|, enlargeEye / scaleAround R·|d|, shiftAround |disp|
 * (two eyes). The yaw attenuation, the 瘦臉 limit and the influence cap only scale moves down, so they are ignored.
 * The tile planner grows each tile's source window by it. Step 5: a split item counts its stronger side, and
 * faceDetailMoves adds the new warps.
 */
export function displacementBound(face: Face, aspect: number, u: ReshapeUniforms): number {
  const g = reshapeGeometry(face, aspect, u);
  const p = (i: number) => pt(face.pts111, i);
  const isoLen = (dx: number, dy: number) => Math.hypot(dx, dy / aspect);
  const curve = (o: V2, t: V2, d: number) => isoLen(t[0] - o[0], t[1] - o[1]) * Math.abs(d);
  const slim = Math.max(Math.abs(u.faceSlim), Math.abs(u.faceSlimR));
  const v = Math.max(Math.abs(u.faceV), Math.abs(u.faceVR));
  const narrow = Math.max(Math.abs(u.faceNarrow), Math.abs(u.faceNarrowR));
  let b = 0;
  if (slim) for (const [o, t] of SLIM) b += curve(p(o), p(t), slim);
  if (v) V_JAW.forEach((i, k) => (b += curve(p(i), [g.vTargets[k * 2], g.vTargets[k * 2 + 1]], v)));
  if (narrow) NARROW.forEach((i, k) => (b += curve(p(i), [g.narrowTargets[k * 2], g.narrowTargets[k * 2 + 1]], narrow)));
  if (u.chin) b += curve(p(16), g.chinTarget, u.chin);
  if (u.forehead) b += curve(pt(face.ext, 0), pt(face.ext, 3), u.forehead);
  if (u.noseSlim) for (const [o, t] of NOSE) b += curve(p(o), p(t), u.noseSlim);
  if (u.mouthSize) b += g.mouthR * Math.abs(u.mouthSize);
  if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) b += 2 * isoLen(g.eyeDisp[0], g.eyeDisp[1]);
  // 大眼 per side: p74 takes the left strength, p77 the right one
  if (u.eyeEnlarge || u.eyeEnlargeR) b += g.eyeR[0] * Math.abs(u.eyeEnlarge) + g.eyeR[1] * Math.abs(u.eyeEnlargeR);
  const m = faceDetailMoves(g, u, face);
  for (const d of m.uv) b += isoLen(d[0], d[1]);
  for (const l of m.iso) b += l;
  return b;
}

/** texture units of P2 (S §4.8): src 0, body 1, protect array 2, face table 3 (texture carrier), liquify 4 (step 6) */
export const BODY_UNIT = 1;
export const PROTECT_UNIT = 2;
export const FACE_TABLE_UNIT = 3;
/** texture unit of uLiqDisp: after BODY_UNIT 1, PROTECT_UNIT 2 and the face table on 3 (push-brush spec §4.4, C §4.3: 5 units in P2) */
export const LIQUIFY_UNIT = 4;
/** the std140 block binding of the UBO carrier */
export const FACE_UBO_BINDING = 0;

/**
 * 瘦臉 background limit (stage 1 ②). The contour warps' displacement g (瘦臉 / V臉 / 窄臉 / 下巴 / 額頭 together; step 5:
 * 下頜線 / 太陽穴 / 髮際線 too, which run before the limit, face-detail spec §4.5) is held
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

/**
 * The step-5 block of one face row of the face table (face-detail spec §4.4; S1 §4.4 keeps 72–74). `row` is the face's
 * 96-texel slice; texels 70–71 and 75–95, all other texels untouched.
 */
export function packFaceDetail(row: Float32Array, u: ReshapeUniforms, g: ReshapeGeometry): void {
  const set = (t: number, a: number, b: number, c: number, d: number) => row.set([a, b, c, d], t * 4);
  set(70, u.faceSlimR, u.faceVR, u.faceNarrowR, u.eyeEnlargeR);
  set(71, u.jawlineR, u.templeR, 0, 0);
  set(75, u.jawline, u.temple, g.hairlineS, g.noseWingS);
  set(76, g.rootK, g.mouthHS, 0, 0);
  row.set(g.jawTargets, 77 * 4);
  row.set(g.templeAnchors, 82 * 4);
  row.set(g.templeTargets, 85 * 4);
  set(88, g.axes[0], g.axes[1], g.axes[2], g.axes[3]);
  set(89, g.hairlineRadii[0], g.hairlineRadii[1], g.hairlineRadii[2], 0);
  set(90, g.hairlineDisp[0], g.hairlineDisp[1], g.mouthHDisp[0], g.mouthHDisp[1]);
  set(91, g.mouthHRadii[0], g.mouthHRadii[1], g.mouthHRadii[2], 0);
  set(92, g.mouthHAxis[0], g.mouthHAxis[1], 0, 0);
  set(93, g.noseWingR, g.noseWingDisp[0], g.noseWingDisp[1], 0);
  set(94, g.root[0], g.root[1], g.root[2], g.root[3]);
  set(95, g.rootRy, 0, 0, 0);
}

/**
 * The largest move of every active step-5 warp, for step 3's displacementBound (S3 §4.4): UV vectors (count
 * hypot(dx·W, dy·H) px) and iso lengths (count iso·W px). Two 鼻翼 discs may overlap, so the wing counts twice.
 */
export function faceDetailMoves(g: ReshapeGeometry, u: ReshapeUniforms, face: Face): { uv: V2[]; iso: number[] } {
  const P = face.pts111;
  const uvs: V2[] = [];
  const jd = Math.max(Math.abs(u.jawline), Math.abs(u.jawlineR));
  if (jd) JAW.forEach((i, k) => uvs.push([(g.jawTargets[k * 2] - P[i * 2]) * jd, (g.jawTargets[k * 2 + 1] - P[i * 2 + 1]) * jd]));
  const td = Math.max(Math.abs(u.temple), Math.abs(u.templeR));
  if (td)
    TEMPLE.forEach((_, k) =>
      uvs.push([
        (g.templeTargets[k * 2] - g.templeAnchors[k * 2]) * td * TEMPLE_W[k],
        (g.templeTargets[k * 2 + 1] - g.templeAnchors[k * 2 + 1]) * td * TEMPLE_W[k],
      ]),
    );
  if (g.hairlineS) uvs.push(g.hairlineDisp);
  if (g.noseWingS) uvs.push(g.noseWingDisp, g.noseWingDisp);
  if (g.mouthHS) uvs.push(g.mouthHDisp);
  return { uv: uvs, iso: g.rootK ? [Math.abs(g.rootK) * Math.max(g.root[2], g.root[3])] : [] };
}

const glslFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
/** a GLSL constant array from a TS table (the GPU and the CPU port share one definition, like PROTECT_RAMP) */
const glslFloats = (name: string, xs: readonly number[]) =>
  `const float ${name}[${xs.length}] = float[${xs.length}](${xs.map((x) => glslFloat(x)).join(', ')});`;
const glslInts = (name: string, xs: readonly number[]) => `const int ${name}[${xs.length}] = int[${xs.length}](${xs.join(', ')});`;

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
uniform sampler2D uLiqDisp; // RG16F 推臉筆 backward displacement in O UV units, row 0 = image top (LIQUIFY_UNIT)
uniform float uLiqOn;
uniform mediump sampler2DArray uProtArr; // R16F signed distance (iso units) per face layer, row 0 = window top
uniform int uCount;
uniform float uAspect;  // W/H
uniform mat3 uGeo;   // V → O, normalized (step 3); the exact identity mat3 when the geometry is identity
uniform vec4 uTile;  // buffer uv → V: V = uTile.xy + vUv · uTile.zw; (0, 0, 1, 1) outside a tile
uniform vec4 uWin;   // O → src uv: (o − uWin.xy) / uWin.zw; (0, 0, 1, 1) when src is the whole O
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
${glslFloats('SLIM_SIDE', SLIM_SIDE)}
${glslFloats('VJAW_SIDE', VJAW_SIDE)}
${glslFloats('NARROW_SIDE', NARROW_SIDE)}
${glslInts('JAW', JAW)}
${glslFloats('JAW_SIDE', JAW_SIDE)}
${glslFloats('TEMPLE_SIDE', TEMPLE_SIDE)}
${glslFloats('TEMPLE_W', TEMPLE_W)}
float sided(float dl, float dr, float side) { return dl + (dr - dl) * side; } // == dl exactly when dr == dl
vec2 JT(int f, int k) { return pairOf(F(f, 77 + (k >> 1)), k); } // 下頜線 targets (step 5, texels 77–81)
vec2 TA(int f, int k) { return pairOf(F(f, 82 + (k >> 1)), k); } // 太陽穴 anchors (82–84)
vec2 TT(int f, int k) { return pairOf(F(f, 85 + (k >> 1)), k); } // 太陽穴 targets (85–87)

// Elliptical local translate with a flat top (face-detail spec §4.2): content near c moves by disp. ax / ay = unit iso
// axes; r = (rx, ry toward −ay, ry toward +ay) iso. Profile (1 − w⁴)²: k ≥ 0.88 for w ≤ 0.5, C¹, max |dk/dw| 2.42.
vec2 shiftEllipse(vec2 tc, vec2 c, vec2 ax, vec2 ay, vec3 r, vec2 disp) {
  vec2 d = iso(tc) - iso(c);
  float qy = dot(d, ay);
  vec2 q = vec2(dot(d, ax) / r.x, qy / (qy < 0.0 ? r.y : r.z));
  float w2 = dot(q, q);
  if (w2 >= 1.0) return tc;
  float k = 1.0 - w2 * w2;
  return tc - disp * k * k;
}

// Squeeze toward the axis through c along ay: content at signed distance a = (q − c)·ax moves toward the axis by
// k·a·(1 − t²)²·(1 − v²)², t = a / r− or a / r+, v = (q − c)·ay / ry; zero at |t| = 1 and |v| = 1, C¹.
vec2 squeezeAxis(vec2 tc, vec2 c, vec2 ax, vec2 ay, vec3 r, float k) {
  vec2 d = iso(tc) - iso(c);
  float a = dot(d, ax);
  float t = a / (a < 0.0 ? r.x : r.y);
  float v = dot(d, ay) / r.z;
  if (t * t >= 1.0 || v * v >= 1.0) return tc;
  float h = (1.0 - t * t) * (1.0 - v * v);
  vec2 s = ax * (k * a * h * h);              // iso
  return tc + vec2(s.x, s.y * uAspect);        // iso → UV
}

vec2 faceChain(int f, vec2 tc) {
  vec2 tc0 = tc;
  vec4 s1 = F(f, ${FT.S1});        // slim, v, narrow, chin (GPUPixel-left)
  vec4 s2 = F(f, ${FT.S2});        // forehead, nose, mouth, eye (GPUPixel-left)
  vec4 r = F(f, ${FT.RADII});      // eyeR.x, eyeR.y, mouthR, protect layer (−1 = none)
  vec4 ce = F(f, ${FT.CHIN_EYE});  // chinTarget, eyeDisp
  vec4 sR = F(f, ${FT.RIGHT});     // step 5: slimR, vR, narrowR, eyeR (GPUPixel-right; == s1/s2 while 左右分開 is off)
  vec4 sR2 = F(f, ${FT.RIGHT} + 1); // jawR, templeR
  vec4 s5 = F(f, 75);              // jawL, templeL, hairline, noseWing
  vec4 s6 = F(f, 76);              // 山根 k, mouthHeight
  vec4 axes = F(f, 88);            // r̂ (iso), m̂ (iso)
  if (s1.x != 0.0 || sR.x != 0.0) {
    for (int i = 0; i < 9; i++) tc = curveWarp(tc, P(f, SLIM[i].x), P(f, SLIM[i].y), sided(s1.x, sR.x, SLIM_SIDE[i]));
  }
  if (s1.y != 0.0 || sR.y != 0.0) {
    for (int i = 0; i < 6; i++) tc = curveWarp(tc, P(f, V_JAW[i]), VT(f, i), sided(s1.y, sR.y, VJAW_SIDE[i]));
  }
  if (s1.z != 0.0 || sR.z != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NARROW[i]), NT(f, i), sided(s1.z, sR.z, NARROW_SIDE[i]));
  }
  if (s5.x != 0.0 || sR2.x != 0.0) {
    for (int i = 0; i < 10; i++) tc = curveWarp(tc, P(f, JAW[i]), JT(f, i), sided(s5.x, sR2.x, JAW_SIDE[i]));
  }
  if (s5.y != 0.0 || sR2.y != 0.0) {
    for (int i = 0; i < 6; i++) tc = curveWarp(tc, TA(f, i), TT(f, i), sided(s5.y, sR2.y, TEMPLE_SIDE[i]) * TEMPLE_W[i]);
  }
  if (s1.w != 0.0) tc = curveWarp(tc, P(f, 16), ce.xy, s1.w);
  if (s2.x != 0.0) tc = curveWarp(tc, EXT(f, 0), EXT(f, 3), s2.x);
  if (s5.z != 0.0) tc = shiftEllipse(tc, EXT(f, 0), axes.xy, axes.zw, F(f, 89).xyz, F(f, 90).xy); // 髮際線
  if (r.w >= 0.0) tc = protectContour(f, tc0, tc, r.w);
  if (s2.y != 0.0) {
    for (int i = 0; i < 4; i++) tc = curveWarp(tc, P(f, NOSE[i].x), P(f, NOSE[i].y), s2.y);
  }
  if (s5.w != 0.0) { // 鼻翼
    vec4 nw = F(f, 93);
    tc = shiftAround(tc, P(f, 80), nw.x, nw.yz);
    tc = shiftAround(tc, P(f, 81), nw.x, -nw.yz);
  }
  if (s6.x != 0.0) { // 山根
    vec4 rt = F(f, 94);
    tc = squeezeAxis(tc, rt.xy, axes.xy, axes.zw, vec3(rt.z, rt.w, F(f, 95).x), s6.x);
  }
  if (s6.y != 0.0) { // 嘴高, then 嘴型 (backward order: forward, 嘴型 scales about the true p106, then 嘴高 moves it)
    vec2 ay = F(f, 92).xy;
    tc = shiftEllipse(tc, P(f, 106), vec2(-ay.y, ay.x), ay, F(f, 91).xyz, F(f, 90).zw);
  }
  if (s2.z != 0.0) tc = scaleAround(tc, P(f, 106), r.z, s2.z);
  if (ce.zw != vec2(0.0)) {
    tc = shiftAround(tc, P(f, 74), r.x, ce.zw);
    tc = shiftAround(tc, P(f, 77), r.y, -ce.zw);
  }
  if (s2.w != 0.0) tc = enlargeEye(tc, P(f, 74), r.x, s2.w);  // 大眼 per side: p74 left, p77 right
  if (sR.w != 0.0) tc = enlargeEye(tc, P(f, 77), r.y, sR.w);
  return tc;
}

void main() {
  vec2 v = uTile.xy + vUv * uTile.zw;
  vec2 o = (uGeo * vec3(v, 1.0)).xy;
  // 推臉筆 first (the outermost backward map, push-brush spec §4.1), then the body (C §4.2 D_body) sampled at the
  // liquified point (at O when uLiqOn = 0) = face first in forward terms: the face chains still see detected-landmark
  // coordinates (O-space).
  vec2 tcB = o;
  if (uLiqOn != 0.0) tcB += texture(uLiqDisp, o).xy;
  if (uBodyOn != 0.0) tcB += uBodyOn * texture(uBodyDisp, tcB).xy;
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
  outColor = texture(uSrc, (tc - uWin.xy) / uWin.zw);   // ONE resample of the source window
}`;
}

/** exported for the CPU port's sync check (reshapeCpu.test.ts) */
export const RESHAPE_FS = reshapeFs('texture');

/** uBox that no coordinate falls in: the face chain is skipped entirely (no face / all face deltas 0). */
export const EMPTY_BOX = [1e9, 1e9, -1e9, -1e9] as const;

/** where P2 reads and writes (step 3): V → O, buffer uv → V, O → src uv */
export interface ReshapeView {
  /** column-major mat3 of vToO (glMat3); IDENTITY_MAT3 at identity geometry */
  geo: Float32Array;
  /** (x, y, w, h): the V rectangle the destination buffer covers */
  tile: readonly [number, number, number, number];
  /** (x, y, w, h): the O rectangle the source texture covers */
  win: readonly [number, number, number, number];
}

export const IDENTITY_VIEW: ReshapeView = { geo: IDENTITY_MAT3, tile: [0, 0, 1, 1], win: [0, 0, 1, 1] };

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
   * backward displacement texture (UV units), applied before the face chains; null = none. `view` = geometry / tile /
   * window (step 3, ReshapeView); omitted = identity. `liquify` = RG16F 推臉筆 field (O UV units), the outermost map;
   * null = none (push-brush spec §4.4).
   */
  drawFaces(
    src: Texture,
    dst: Framebuffer,
    faces: readonly TableFace[],
    opts?: { aspect?: number; body?: Texture | null; protects?: readonly FaceProtect[]; view?: ReshapeView; liquify?: Texture | null },
  ): void;
  /**
   * One face with v0.3's signature (harnesses, pins, the pipeline until RenderInput v0.4): yaw attenuation applied
   * here, no cap; `face` / `u` null = no face warp (body only); `protect` = the 瘦臉 limit's data (uploaded by the pass);
   * `view` is drawFaces' view (step 3), omitted = identity; `liquify` is drawFaces' 推臉筆 field, omitted = none.
   */
  draw(
    src: Texture,
    dst: Framebuffer,
    face: Face | null,
    u: ReshapeUniforms | null,
    aspect?: number,
    body?: Texture | null,
    protect?: FaceProtect | null,
    view?: ReshapeView,
    liquify?: Texture | null,
  ): void;
  dispose(): void;
}

export function createReshapePass(gl: GL, opts: { carrier?: 'texture' | 'ubo' } = {}): ReshapePass {
  const carrier = opts.carrier ?? 'texture';
  const prog: Program = createProgram(gl, FULLSCREEN_VS, reshapeFs(carrier), 'reshape');
  prog.use();
  gl.uniform1i(prog.u('uSrc'), 0);
  gl.uniform1i(prog.u('uBodyDisp'), BODY_UNIT);
  gl.uniform1i(prog.u('uProtArr'), PROTECT_UNIT);
  gl.uniform1i(prog.u('uLiqDisp'), LIQUIFY_UNIT);
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
  // Bound on the body / liquify / protect units when there is no field / no limit, so a sampler never reads an empty unit.
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
    const vw = o.view ?? IDENTITY_VIEW;
    gl.uniformMatrix3fv(prog.u('uGeo'), false, vw.geo);
    gl.uniform4f(prog.u('uTile'), vw.tile[0], vw.tile[1], vw.tile[2], vw.tile[3]);
    gl.uniform4f(prog.u('uWin'), vw.win[0], vw.win[1], vw.win[2], vw.win[3]);
    bindTexture(gl, 0, src);
    bindTexture(gl, BODY_UNIT, o.body ?? zero);
    gl.uniform1f(prog.u('uBodyOn'), o.body ? 1 : 0);
    bindTexture(gl, LIQUIFY_UNIT, o.liquify ?? zero);
    gl.uniform1f(prog.u('uLiqOn'), o.liquify ? 1 : 0);
    bindTextureArray(gl, PROTECT_UNIT, protArr && ok.includes(true) ? protArr.tex : zeroArr.tex);
    if (tableTex) bindTexture(gl, FACE_TABLE_UNIT, tableTex);
    else gl.bindBufferBase(gl.UNIFORM_BUFFER, FACE_UBO_BINDING, ubo);
    gl.uniform1i(prog.u('uCount'), faces.length);
    gl.uniform1f(prog.u('uAspect'), aspect);
    drawFullscreen(gl);
    bindTexture(gl, BODY_UNIT, null);
    bindTexture(gl, LIQUIFY_UNIT, null);
    bindTextureArray(gl, PROTECT_UNIT, null);
    if (tableTex) bindTexture(gl, FACE_TABLE_UNIT, null);
    else gl.bindBufferBase(gl.UNIFORM_BUFFER, FACE_UBO_BINDING, null);
    gl.activeTexture(gl.TEXTURE0);
  };

  return {
    drawFaces,
    draw(src, dst, face, u, aspectIn, body, protect, view, liquify) {
      const faces: TableFace[] = face && u ? [{ face, u: attenuate(u, face.yaw), layer: protect ? 0 : -1, window: protect?.window ?? WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 }] : [];
      drawFaces(src, dst, faces, { aspect: aspectIn, body, protects: protect ? [protect] : [], view, liquify });
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
