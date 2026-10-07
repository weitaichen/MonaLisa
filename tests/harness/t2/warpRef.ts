// Double-precision JS mirror of the reshape fragment shader (src/engine/passes/reshape.ts), used by
// the T2 harness to cross-check the GPU map and to measure fold-overs (Jacobian determinant).
import type { Face } from '../../../src/types';
import type { ReshapeGeometry, ReshapeUniforms } from '../../../src/engine/passes/reshape';

type V2 = [number, number];

const SLIM: readonly [number, number][] = [
  [3, 44], [29, 44], [7, 45], [25, 45], [10, 46], [22, 46], [14, 49], [18, 49], [16, 49],
];
const V_JAW = [8, 10, 12, 24, 22, 20];
const NARROW = [2, 4, 30, 28];
const NOSE: readonly [number, number][] = [[80, 46], [81, 46], [82, 49], [83, 49]];

export function warpRef(tc0: V2, face: Face, u: ReshapeUniforms, g: ReshapeGeometry, aspect: number): V2 {
  const P = (i: number): V2 => [face.pts111[i * 2], face.pts111[i * 2 + 1]];
  const E = (i: number): V2 => [face.ext[i * 2], face.ext[i * 2 + 1]];
  const isoD = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
  const curve = (tc: V2, o: V2, t: V2, d: number): V2 => {
    const r = Math.max(isoD(t, o), 1e-6);
    const k = Math.min(1, Math.max(0, 1 - isoD(tc, o) / r));
    return [tc[0] - (t[0] - o[0]) * d * k, tc[1] - (t[1] - o[1]) * d * k];
  };
  const enlarge = (tc: V2, c: V2, R: number, d: number): V2 => {
    let w = isoD(tc, c) / Math.max(R, 1e-6);
    w = Math.min(1, Math.max(0, 1 - (1 - w * w) * d));
    return [c[0] + (tc[0] - c[0]) * w, c[1] + (tc[1] - c[1]) * w];
  };
  const scale = (tc: V2, c: V2, R: number, d: number): V2 => {
    const w = isoD(tc, c) / Math.max(R, 1e-6);
    if (w >= 1) return tc;
    const s = 1 - (1 - w * w) * d;
    return [c[0] + (tc[0] - c[0]) * s, c[1] + (tc[1] - c[1]) * s];
  };
  const shift = (tc: V2, c: V2, R: number, disp: V2): V2 => {
    const w = isoD(tc, c) / Math.max(R, 1e-6);
    const k = Math.min(1, Math.max(0, 1 - w * w));
    return [tc[0] - disp[0] * k * k, tc[1] - disp[1] * k * k];
  };

  let tc: V2 = [tc0[0], tc0[1]];
  if (tc[0] < g.box[0] || tc[1] < g.box[1] || tc[0] > g.box[2] || tc[1] > g.box[3]) return tc;
  if (u.faceSlim) for (const [o, t] of SLIM) tc = curve(tc, P(o), P(t), u.faceSlim);
  if (u.faceV) V_JAW.forEach((i, k) => (tc = curve(tc, P(i), [g.vTargets[k * 2], g.vTargets[k * 2 + 1]], u.faceV)));
  if (u.faceNarrow)
    NARROW.forEach((i, k) => (tc = curve(tc, P(i), [g.narrowTargets[k * 2], g.narrowTargets[k * 2 + 1]], u.faceNarrow)));
  if (u.chin) tc = curve(tc, P(16), g.chinTarget, u.chin);
  if (u.forehead) tc = curve(tc, E(0), E(3), u.forehead);
  if (u.noseSlim) for (const [o, t] of NOSE) tc = curve(tc, P(o), P(t), u.noseSlim);
  if (u.mouthSize) tc = scale(tc, P(106), g.mouthR, u.mouthSize);
  if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) {
    tc = shift(tc, P(74), g.eyeR[0], g.eyeDisp);
    tc = shift(tc, P(77), g.eyeR[1], [-g.eyeDisp[0], -g.eyeDisp[1]]);
  }
  if (u.eyeEnlarge) {
    tc = enlarge(tc, P(74), g.eyeR[0], u.eyeEnlarge);
    tc = enlarge(tc, P(77), g.eyeR[1], u.eyeEnlarge);
  }
  return tc;
}

/** Minimum Jacobian determinant of the backward map over a W×H pixel grid (step in pixels). */
export function minJacobian(
  face: Face,
  u: ReshapeUniforms,
  g: ReshapeGeometry,
  W: number,
  H: number,
  step = 1,
): { min: number; at: V2 } {
  const aspect = W / H;
  const h = 0.25 / W;
  const hv = 0.25 / H;
  let min = Infinity;
  let at: V2 = [0, 0];
  for (let y = g.box[1] * H; y <= g.box[3] * H; y += step) {
    for (let x = g.box[0] * W; x <= g.box[2] * W; x += step) {
      const p: V2 = [x / W, y / H];
      const ax = warpRef([p[0] + h, p[1]], face, u, g, aspect);
      const bx = warpRef([p[0] - h, p[1]], face, u, g, aspect);
      const ay = warpRef([p[0], p[1] + hv], face, u, g, aspect);
      const by = warpRef([p[0], p[1] - hv], face, u, g, aspect);
      const j00 = (ax[0] - bx[0]) / (2 * h);
      const j10 = (ax[1] - bx[1]) / (2 * h);
      const j01 = (ay[0] - by[0]) / (2 * hv);
      const j11 = (ay[1] - by[1]) / (2 * hv);
      const det = j00 * j11 - j01 * j10;
      if (det < min) {
        min = det;
        at = p;
      }
    }
  }
  return { min, at };
}
