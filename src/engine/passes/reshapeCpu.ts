// CPU port of RESHAPE_FS (reshape.ts): the backward map vUv → tc the P2 reshape pass samples the
// source at. v0.4 (S §4.4): the 美體 field is the outermost map; every listed face's chain (contour curveWarps, chin,
// forehead, the per-face 瘦臉 limit, nose, mouth, eye distance, big eyes) starts from the same tcB, a capped face's
// displacement is held within its cap budget, and the displacements are summed — one face without a cap is its own chain
// output, bit-exact with v0.3 (reshapeCpuV03.ts). Double precision throughout; the e2e reshape pins compare the GPU with
// this port within 0.05 px. Imported by the app only for the editor's fold safety net (src/edit/warpGuard.ts, on slider
// commits).
import type { BodyField, Face, FaceProtect, Rect } from '../../types';
import { fieldAt } from '../../body/cpuWarp';
import { attenuate, boxCentre, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from './faceCap';
import { faceWidthIso, NARROW, NOSE, PROTECT_RAMP, PROTECT_REACH, PROTECT_SLOPE, PROTECT_SMOOTH, reshapeGeometry, SLIM, V_JAW, type ReshapeUniforms, type ReshapeView } from './reshape';

/** output UV → source UV (backward) */
export type UvMap = (u: number, v: number) => [number, number];

type V2 = [number, number];

/** the engine uploads FaceProtect as R16F: what the shader reads back */
const f16 = (Math as { f16round?: (x: number) => number }).f16round ?? ((x: number) => x);

/** Bilinear, clamp-to-edge lookup of a FaceProtect at its grid's UV, like the shader's texture lookup (texel centres at +0.5). */
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

/** the 瘦臉 limit's budget (reshape.ts budgetScale): Ln / L, or 1 when the budget does not bind */
function budgetScale(L: number, t: number, l: number, slope: number, k: number): number {
  const x = t / Math.max(l, 1e-6);
  const B = t <= 0 ? 0 : t < l ? slope * l * x * x * x * (1 - 0.5 * x) : slope * (t - 0.5 * l);
  const h = Math.max(k - Math.abs(L - B), 0) / k;
  const Ln = Math.max(Math.min(L, B) - 0.25 * h * h * k, 0);
  return Ln >= L ? 1 : Ln / L;
}

/** one face's chain (reshape.ts faceChain), operation for operation */
function chainOf(face: Face, u: ReshapeUniforms, aspect: number, prot: FaceProtect | null, win: Rect): (tc: V2) => V2 {
  const g = reshapeGeometry(face, aspect, u);
  const P = face.pts111;
  const E = face.ext;
  const pt = (i: number): V2 => [P[i * 2], P[i * 2 + 1]];
  const ext = (i: number): V2 => [E[i * 2], E[i * 2 + 1]];
  const isoD = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
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
  const fw = faceWidthIso(face, aspect);
  const reach = PROTECT_REACH * fw;
  const kappa = PROTECT_SMOOTH * fw;
  const protectContour = (tc0: V2, tc: V2): V2 => {
    const gx: V2 = [tc[0] - tc0[0], tc[1] - tc0[1]];
    const L = Math.hypot(gx[0], gx[1] / aspect);
    const t = reach - protectAt(prot!, (tc0[0] - win.x) * (1 / win.w), (tc0[1] - win.y) * (1 / win.h));
    const s = budgetScale(L, t, PROTECT_RAMP * reach, PROTECT_SLOPE, kappa);
    return s >= 1 ? tc : [tc0[0] + gx[0] * s, tc0[1] + gx[1] * s];
  };
  return (tcIn) => {
    let tc = tcIn;
    const tc0 = tc;
    if (u.faceSlim !== 0) for (const [o, t] of SLIM) tc = curveWarp(tc, pt(o), pt(t), u.faceSlim);
    if (u.faceV !== 0) V_JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), [g.vTargets[k * 2], g.vTargets[k * 2 + 1]], u.faceV)));
    if (u.faceNarrow !== 0) NARROW.forEach((i, k) => (tc = curveWarp(tc, pt(i), [g.narrowTargets[k * 2], g.narrowTargets[k * 2 + 1]], u.faceNarrow)));
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

/** The map drawFaces renders with: `faces` exactly as packed (attenuated, × weight), `protects` indexed by layer. */
export function reshapeMapMulti(faces: readonly TableFace[], aspect: number, opts: { body?: BodyField | null; protects?: readonly FaceProtect[] } = {}): UvMap {
  const per = faces.map((t) => {
    if (!faceDrawn(t.u)) return null;
    const box = influenceBox(t, aspect);
    if (box[0] > box[2]) return null;
    const prot = t.layer >= 0 ? (opts.protects?.[t.layer] ?? null) : null;
    return { t, box, kappa: PROTECT_SMOOTH * faceWidthIso(t.face, aspect), chain: chainOf(t.face, t.u, aspect, prot, t.window) };
  });
  const body = opts.body ?? null;
  return (x, y) => {
    let tcB: V2 = [x, y];
    if (body) {
      const d = fieldAt(body, x, y);
      tcB = [x + d[0], y + d[1]];
    }
    let ax = 0;
    let ay = 0;
    let only = tcB;
    let hits = 0;
    let anyCap = false;
    for (const p of per) {
      if (!p) continue;
      const b = p.box;
      if (tcB[0] < b[0] || tcB[1] < b[1] || tcB[0] > b[2] || tcB[1] > b[3]) continue;
      const tc = p.chain(tcB);
      let dx = tc[0] - tcB[0];
      let dy = tc[1] - tcB[1];
      if (p.t.cap >= 0) {
        // the cap: the same budget as the 瘦臉 limit, centred on c_f, 0 beyond cap_f (S §4.4)
        const t = p.t.cap - Math.hypot(tcB[0] - p.t.centre[0], (tcB[1] - p.t.centre[1]) / aspect);
        const s = budgetScale(Math.hypot(dx, dy / aspect), t, PROTECT_RAMP * p.t.cap, PROTECT_SLOPE, p.kappa);
        dx *= s;
        dy *= s;
        anyCap = true;
      }
      ax += dx;
      ay += dy;
      only = tc;
      hits++;
    }
    // one face without a cap: its chain output itself, so the single-face map is bit-identical to v0.3
    return hits === 1 && !anyCap ? only : [tcB[0] + ax, tcB[1] + ay];
  };
}

/**
 * One face as ReshapePass.draw renders it (v0.3's signature, kept for the straightness ratchet, faceProtect.test.ts and the
 * harnesses): yaw attenuation applied here, no cap, the limit (when given) as layer 0 over its window.
 */
export function reshapeMapCpu(face: Face | null, uIn: ReshapeUniforms | null, aspect: number, body?: BodyField | null, protect?: FaceProtect | null): UvMap {
  if (!face || !uIn) return reshapeMapMulti([], aspect, { body });
  const t: TableFace = { face, u: attenuate(uIn, face.yaw), layer: protect ? 0 : -1, window: protect?.window ?? WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 };
  return reshapeMapMulti([t], aspect, { body, protects: protect ? [protect] : [] });
}

/**
 * The map P2 draws with a view (step 3): buffer uv → V (uTile) → O (uGeo, the float32 mat3 the shader gets) → `map`
 * (the O-space chain: body, faces) → src uv (uWin). With IDENTITY_VIEW it returns `map`'s result unchanged.
 */
export function withView(map: UvMap, view: ReshapeView): UvMap {
  const m = view.geo;
  const [tx, ty, tw, th] = view.tile;
  const [wx, wy, ww, wh] = view.win;
  return (x, y) => {
    const vx = tx + x * tw;
    const vy = ty + y * th;
    const t = map(m[0] * vx + m[3] * vy + m[6], m[1] * vx + m[4] * vy + m[7]);
    return [(t[0] - wx) / ww, (t[1] - wy) / wh];
  };
}

/** smallest forward-difference Jacobian determinant of `map` on an n × n grid over `box` (UV); −∞ on a non-finite value */
export function mapMinDet(map: UvMap, box: readonly [number, number, number, number], n = 65): number {
  let min = Infinity;
  const hx = (box[2] - box[0]) / (n - 1);
  const hy = (box[3] - box[1]) / (n - 1);
  for (let j = 0; j + 1 < n; j++) {
    for (let i = 0; i + 1 < n; i++) {
      const x = box[0] + i * hx;
      const y = box[1] + j * hy;
      const a = map(x, y);
      const bx = map(x + hx, y);
      const by = map(x, y + hy);
      if (![...a, ...bx, ...by].every(Number.isFinite)) return -Infinity;
      min = Math.min(min, ((bx[0] - a[0]) / hx) * ((by[1] - a[1]) / hy) - ((bx[1] - a[1]) / hx) * ((by[0] - a[0]) / hy));
    }
  }
  return min;
}
