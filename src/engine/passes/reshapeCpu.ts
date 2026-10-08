// Test / harness-only CPU port of RESHAPE_FS (reshape.ts): the backward map vUv → tc the P2 reshape pass samples
// the source at, i.e. the 美體 field as the outermost map followed by the face chain (contour curveWarps, chin,
// forehead, nose, mouth scaleAround, eye-distance shiftAround, big eyes; with a FaceProtect, the contour part limited by
// the person-distance budget, protectContour). Never imported by the app, so it stays out of
// the bundle. Keep it in step with the shader: reshapeCpu.test.ts pins RESHAPE_FS's text, and the e2e
// reshape.spec.ts renders the real shader on a coordinate texture and compares it with this port point by point.
import type { BodyField, Face, FaceProtect } from '../../types';
import { fieldAt } from '../../body/cpuWarp';
import {
  faceWidthIso,
  NARROW,
  NOSE,
  PROTECT_RAMP,
  PROTECT_REACH,
  PROTECT_SLOPE,
  PROTECT_SMOOTH,
  reshapeGeometry,
  SLIM,
  V_JAW,
  yawAttenuation,
  type ReshapeUniforms,
} from './reshape';

/** output UV → source UV (backward) */
export type UvMap = (u: number, v: number) => [number, number];

type V2 = [number, number];

/** the engine uploads FaceProtect as R16F: what the shader reads back */
const f16 = (Math as { f16round?: (x: number) => number }).f16round ?? ((x: number) => x);

/** Bilinear, clamp-to-edge lookup of a FaceProtect at UV, like texture(uFaceProt, uv) (texel centres at +0.5). */
export function protectAt(p: FaceProtect, u: number, v: number): number {
  const { width: w, height: h, data } = p;
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const t = (i: number) => f16(data[i]);
  const a = t(y0 * w + x0) * (1 - fx) + t(y0 * w + x1) * fx;
  const b = t(y1 * w + x0) * (1 - fx) + t(y1 * w + x1) * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * The map draw() renders with: `face` / `u` / `body` / `protect` exactly as passed to ReshapePass.draw (yaw attenuation
 * applied here like there), `aspect` = W/H of the processing size.
 */
export function reshapeMapCpu(
  face: Face | null,
  uIn: ReshapeUniforms | null,
  aspect: number,
  body?: BodyField | null,
  protect?: FaceProtect | null,
): UvMap {
  let u: ReshapeUniforms | null = null;
  if (face && uIn) {
    const att = yawAttenuation(face.yaw);
    const k = { ...uIn };
    for (const key of Object.keys(k) as (keyof ReshapeUniforms)[]) k[key] *= att;
    if (Object.values(k).some((x) => x !== 0)) u = k;
  }
  const g = face && u ? reshapeGeometry(face, aspect, u) : null;
  const P = face?.pts111;
  const E = face?.ext;
  const pt = (i: number): V2 => [P![i * 2], P![i * 2 + 1]];
  const ext = (i: number): V2 => [E![i * 2], E![i * 2 + 1]];
  const isoD = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);

  // GLSL curveWarp / enlargeEye / scaleAround / shiftAround, operation for operation
  const curveWarp = (tc: V2, o: V2, t: V2, d: number): V2 => {
    const dir: V2 = [(t[0] - o[0]) * d, (t[1] - o[1]) * d];
    const r = Math.max(isoD(t, o), 1e-6);
    const k = Math.min(1, Math.max(0, 1 - isoD(tc, o) / r));
    return [tc[0] - dir[0] * k, tc[1] - dir[1] * k];
  };
  const enlargeEye = (tc: V2, c: V2, R: number, d: number): V2 => {
    let w = isoD(tc, c) / Math.max(R, 1e-6);
    w = Math.min(1, Math.max(0, 1 - (1 - w * w) * d));
    return [c[0] + (tc[0] - c[0]) * w, c[1] + (tc[1] - c[1]) * w];
  };
  const scaleAround = (tc: V2, c: V2, R: number, d: number): V2 => {
    const w = isoD(tc, c) / Math.max(R, 1e-6);
    if (w >= 1) return tc;
    const s = 1 - (1 - w * w) * d;
    return [c[0] + (tc[0] - c[0]) * s, c[1] + (tc[1] - c[1]) * s];
  };
  const shiftAround = (tc: V2, c: V2, R: number, disp: V2): V2 => {
    const w = isoD(tc, c) / Math.max(R, 1e-6);
    const k = Math.min(1, Math.max(0, 1 - w * w));
    return [tc[0] - disp[0] * k * k, tc[1] - disp[1] * k * k];
  };
  const prot = face && protect ? protect : null;
  const fw = face ? faceWidthIso(face, aspect) : 0;
  const reach = PROTECT_REACH * fw;
  const kappa = PROTECT_SMOOTH * fw;
  const protectContour = (tc0: V2, tc: V2): V2 => {
    const g: V2 = [tc[0] - tc0[0], tc[1] - tc0[1]];
    const L = Math.hypot(g[0], g[1] / aspect);
    // the shader's float math, operation for operation (B: smooth ramp, then slope; Ln: polynomial smooth minimum)
    const t = reach - protectAt(prot!, tc0[0], tc0[1]);
    const l = PROTECT_RAMP * reach;
    const x = t / Math.max(l, 1e-6);
    const B = t <= 0 ? 0 : t < l ? PROTECT_SLOPE * l * x * x * x * (1 - 0.5 * x) : PROTECT_SLOPE * (t - 0.5 * l);
    const h = Math.max(kappa - Math.abs(L - B), 0) / kappa;
    const Ln = Math.max(Math.min(L, B) - 0.25 * h * h * kappa, 0);
    if (Ln >= L) return tc;
    return [tc0[0] + g[0] * (Ln / L), tc0[1] + g[1] * (Ln / L)];
  };

  return (x, y) => {
    let tc: V2 = [x, y];
    if (body) {
      const d = fieldAt(body, x, y);
      tc = [x + d[0], y + d[1]];
    }
    if (!g || !u) return tc;
    const box = g.box;
    if (!(tc[0] >= box[0] && tc[1] >= box[1] && tc[0] <= box[2] && tc[1] <= box[3])) return tc;
    const tc0 = tc;
    if (u.faceSlim !== 0) for (const [o, t] of SLIM) tc = curveWarp(tc, pt(o), pt(t), u.faceSlim);
    if (u.faceV !== 0) V_JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), [g.vTargets[k * 2], g.vTargets[k * 2 + 1]], u!.faceV)));
    if (u.faceNarrow !== 0) NARROW.forEach((i, k) => (tc = curveWarp(tc, pt(i), [g.narrowTargets[k * 2], g.narrowTargets[k * 2 + 1]], u!.faceNarrow)));
    if (u.chin !== 0) tc = curveWarp(tc, pt(16), g.chinTarget, u.chin);
    if (u.forehead !== 0) tc = curveWarp(tc, ext(0), ext(3), u.forehead);
    if (prot) tc = protectContour(tc0, tc);
    if (u.noseSlim !== 0) for (const [o, t] of NOSE) tc = curveWarp(tc, pt(o), pt(t), u.noseSlim);
    if (u.mouthSize !== 0) tc = scaleAround(tc, pt(106), g.mouthR, u.mouthSize);
    if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) {
      tc = shiftAround(tc, pt(74), g.eyeR[0], g.eyeDisp);
      tc = shiftAround(tc, pt(77), g.eyeR[1], [-g.eyeDisp[0], -g.eyeDisp[1]]);
    }
    if (u.eyeEnlarge !== 0) {
      tc = enlargeEye(tc, pt(74), g.eyeR[0], u.eyeEnlarge);
      tc = enlargeEye(tc, pt(77), g.eyeR[1], u.eyeEnlarge);
    }
    return tc;
  };
}
