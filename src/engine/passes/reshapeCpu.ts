// CPU port of RESHAPE_FS (reshape.ts): the backward map vUv → tc the P2 reshape pass samples the
// source at. v0.4 (S §4.4): the 美體 field is the outermost map; every listed face's chain (contour curveWarps, chin,
// forehead, the per-face 瘦臉 limit, nose, mouth, eye distance, big eyes) starts from the same tcB, a capped face's
// displacement is held within its cap budget, and the displacements are summed — one face without a cap is its own chain
// output, bit-exact with v0.3 (reshapeCpuV03.ts). Step 5 (face-detail spec §4.5): 下頜線 / 太陽穴 / 髮際線 in the contour
// part, 鼻翼 / 山根 after the nose, 嘴高 before 嘴型, and the split items' per-side strengths (左右分開; with right = null
// every side equals the left value exactly, so the map stays bit-exact). Double precision throughout; the e2e reshape
// pins compare the GPU with this port within 0.05 px. Step 6 (push-brush spec §4.4): the 推臉筆 field, read f16-rounded
// like its RG16F upload, is applied before the 美體 field, which is then sampled at the liquified point; with no
// liquify field the map is unchanged. Imported by the app only for the editor's fold safety net
// (src/edit/warpGuard.ts, on slider commits).
import type { BodyField, Face, FaceProtect, LiquifyField, Rect } from '../../types';
import { fieldAt } from '../../body/cpuWarp';
import { attenuate, boxCentre, faceDrawn, influenceBox, ovalBox, WHOLE, type TableFace } from './faceCap';
import {
  faceDetailOn,
  faceWidthIso,
  JAW,
  JAW_SIDE,
  NARROW,
  NARROW_SIDE,
  NOSE,
  PROTECT_RAMP,
  PROTECT_REACH,
  PROTECT_SLOPE,
  PROTECT_SMOOTH,
  reshapeGeometry,
  sided,
  SLIM,
  SLIM_SIDE,
  TEMPLE,
  TEMPLE_SIDE,
  TEMPLE_W,
  V_JAW,
  VJAW_SIDE,
  type ReshapeUniforms,
  type ReshapeView,
} from './reshape';

/** output UV → source UV (backward) */
export type UvMap = (u: number, v: number) => [number, number];

type V2 = [number, number];

/** RESHAPE_FS shiftEllipse, operation for operation (face-detail spec §4.2): r = (rx, ry toward −ay, ry toward +ay) iso */
export function shiftEllipseUv(tc: V2, c: V2, ax: V2, ay: V2, r: readonly [number, number, number], disp: V2, aspect: number): V2 {
  const d: V2 = [tc[0] - c[0], tc[1] / aspect - c[1] / aspect];
  const qy = d[0] * ay[0] + d[1] * ay[1];
  const qx = (d[0] * ax[0] + d[1] * ax[1]) / r[0];
  const qyn = qy / (qy < 0 ? r[1] : r[2]);
  const w2 = qx * qx + qyn * qyn;
  if (w2 >= 1) return tc;
  const k = 1 - w2 * w2;
  return [tc[0] - disp[0] * k * k, tc[1] - disp[1] * k * k];
}

/** RESHAPE_FS squeezeAxis: r = (r−, r+, ry) iso; the move is along ax only */
export function squeezeAxisUv(tc: V2, c: V2, ax: V2, ay: V2, r: readonly [number, number, number], k: number, aspect: number): V2 {
  const d: V2 = [tc[0] - c[0], tc[1] / aspect - c[1] / aspect];
  const a = d[0] * ax[0] + d[1] * ax[1];
  const t = a / (a < 0 ? r[0] : r[1]);
  const v = (d[0] * ay[0] + d[1] * ay[1]) / r[2];
  if (t * t >= 1 || v * v >= 1) return tc;
  const h = (1 - t * t) * (1 - v * v);
  const s = k * a * h * h;
  return [tc[0] + ax[0] * s, tc[1] + ax[1] * s * aspect];
}

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

/**
 * Bilinear, clamp-to-edge lookup of the 推臉筆 field at UV with every texel rounded to f16 first: what the shader
 * reads back from the RG16F upload (push-brush spec §4.4), like protectAt.
 */
export function liquifyAt(f: LiquifyField, u: number, v: number): [number, number] {
  const { width: w, height: h, data } = f;
  const x = Math.max(0, Math.min(w - 1, u * w - 0.5));
  const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out: [number, number] = [0, 0];
  for (let c = 0; c < 2; c++) {
    const t = (i: number) => f16(data[i * 2 + c]);
    const a = t(y0 * w + x0) * (1 - fx) + t(y0 * w + x1) * fx;
    const b = t(y1 * w + x0) * (1 - fx) + t(y1 * w + x1) * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
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
  // RESHAPE_FS's uDetail bit (detailMask): without step-5 work the right side takes the left strengths and the step-5
  // strengths are 0, the values the shader substitutes for the texels it then skips (the same values: the map is unchanged)
  const detail = faceDetailOn(u, g);
  const slimR = detail ? u.faceSlimR : u.faceSlim;
  const vR = detail ? u.faceVR : u.faceV;
  const narrowR = detail ? u.faceNarrowR : u.faceNarrow;
  const eyeR = detail ? u.eyeEnlargeR : u.eyeEnlarge;
  const jaw = detail ? u.jawline : 0;
  const jawR = detail ? u.jawlineR : 0;
  const temple = detail ? u.temple : 0;
  const templeR = detail ? u.templeR : 0;
  const hairline = detail ? g.hairlineS : 0;
  const noseWing = detail ? g.noseWingS : 0;
  const rootK = detail ? g.rootK : 0;
  const mouthH = detail ? g.mouthHS : 0;
  // r̂ / m̂ (texel 88): the shader reads them only inside the 髮際線 and 山根 branches
  const rh: V2 = [g.axes[0], g.axes[1]];
  const mh: V2 = [g.axes[2], g.axes[3]];
  return (tcIn) => {
    let tc = tcIn;
    const tc0 = tc;
    const at = (a: Float32Array, k: number): V2 => [a[k * 2], a[k * 2 + 1]];
    // contour: each split anchor takes its side's strength (S5 §4.3)
    if (u.faceSlim !== 0 || slimR !== 0) SLIM.forEach(([o, t], i) => (tc = curveWarp(tc, pt(o), pt(t), sided(u.faceSlim, slimR, SLIM_SIDE[i]))));
    if (u.faceV !== 0 || vR !== 0) V_JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), at(g.vTargets, k), sided(u.faceV, vR, VJAW_SIDE[k]))));
    if (u.faceNarrow !== 0 || narrowR !== 0)
      NARROW.forEach((i, k) => (tc = curveWarp(tc, pt(i), at(g.narrowTargets, k), sided(u.faceNarrow, narrowR, NARROW_SIDE[k]))));
    if (jaw !== 0 || jawR !== 0) JAW.forEach((i, k) => (tc = curveWarp(tc, pt(i), at(g.jawTargets, k), sided(jaw, jawR, JAW_SIDE[k]))));
    if (temple !== 0 || templeR !== 0)
      TEMPLE.forEach((_, k) => (tc = curveWarp(tc, at(g.templeAnchors, k), at(g.templeTargets, k), sided(temple, templeR, TEMPLE_SIDE[k]) * TEMPLE_W[k])));
    if (u.chin !== 0) tc = curveWarp(tc, pt(16), g.chinTarget, u.chin);
    if (u.forehead !== 0) tc = curveWarp(tc, ext(0), ext(3), u.forehead);
    if (hairline !== 0) tc = shiftEllipseUv(tc, ext(0), rh, mh, g.hairlineRadii, g.hairlineDisp, aspect);
    if (prot) tc = protectContour(tc0, tc);
    // nose
    if (u.noseSlim !== 0) for (const [o, t] of NOSE) tc = curveWarp(tc, pt(o), pt(t), u.noseSlim);
    if (noseWing !== 0) {
      tc = shiftAround(tc, pt(80), g.noseWingR, g.noseWingDisp);
      tc = shiftAround(tc, pt(81), g.noseWingR, [-g.noseWingDisp[0], -g.noseWingDisp[1]]);
    }
    if (rootK !== 0) tc = squeezeAxisUv(tc, [g.root[0], g.root[1]], rh, mh, [g.root[2], g.root[3], g.rootRy], rootK, aspect);
    // mouth: 嘴高, then 嘴型 (backward order: forward, 嘴型 scales about the true p106, then 嘴高 moves it)
    if (mouthH !== 0) tc = shiftEllipseUv(tc, pt(106), [-g.mouthHAxis[1], g.mouthHAxis[0]], g.mouthHAxis, g.mouthHRadii, g.mouthHDisp, aspect);
    if (u.mouthSize !== 0) tc = scaleAround(tc, pt(106), g.mouthR, u.mouthSize);
    // eyes: 眼距, then 大眼 per side
    if (g.eyeDisp[0] !== 0 || g.eyeDisp[1] !== 0) {
      tc = shiftAround(tc, pt(74), g.eyeR[0], g.eyeDisp);
      tc = shiftAround(tc, pt(77), g.eyeR[1], [-g.eyeDisp[0], -g.eyeDisp[1]]);
    }
    if (u.eyeEnlarge !== 0) tc = enlargeEye(tc, pt(74), g.eyeR[0], u.eyeEnlarge);
    if (eyeR !== 0) tc = enlargeEye(tc, pt(77), g.eyeR[1], eyeR);
    return tc;
  };
}

/** The map drawFaces renders with: `faces` exactly as packed (attenuated, × weight), `protects` indexed by layer. */
export function reshapeMapMulti(
  faces: readonly TableFace[],
  aspect: number,
  opts: { body?: BodyField | null; protects?: readonly FaceProtect[]; liquify?: LiquifyField | null } = {},
): UvMap {
  const per = faces.map((t) => {
    if (!faceDrawn(t.u)) return null;
    const box = influenceBox(t, aspect);
    if (box[0] > box[2]) return null;
    const prot = t.layer >= 0 ? (opts.protects?.[t.layer] ?? null) : null;
    return { t, box, kappa: PROTECT_SMOOTH * faceWidthIso(t.face, aspect), chain: chainOf(t.face, t.u, aspect, prot, t.window) };
  });
  const body = opts.body ?? null;
  const liquify = opts.liquify ?? null;
  return (x, y) => {
    let tcB: V2 = [x, y];
    // 推臉筆 first (the outermost map), then the 美體 field sampled at the liquified point (push-brush spec §4.1)
    if (liquify) {
      const d = liquifyAt(liquify, tcB[0], tcB[1]);
      tcB = [tcB[0] + d[0], tcB[1] + d[1]];
    }
    if (body) {
      const d = fieldAt(body, tcB[0], tcB[1]);
      tcB = [tcB[0] + d[0], tcB[1] + d[1]];
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
export function reshapeMapCpu(
  face: Face | null,
  uIn: ReshapeUniforms | null,
  aspect: number,
  body?: BodyField | null,
  protect?: FaceProtect | null,
  liquify?: LiquifyField | null,
): UvMap {
  if (!face || !uIn) return reshapeMapMulti([], aspect, { body, liquify });
  const t: TableFace = { face, u: attenuate(uIn, face.yaw), layer: protect ? 0 : -1, window: protect?.window ?? WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 };
  return reshapeMapMulti([t], aspect, { body, protects: protect ? [protect] : [], liquify });
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

/**
 * smallest forward-difference Jacobian determinant of `map` on an n × n grid over `box` (UV); −∞ on a non-finite value.
 * Each grid point is mapped once (n² calls, not 3 per cell): a row of the grid is kept for the next row's cells.
 */
export function mapMinDet(map: UvMap, box: readonly [number, number, number, number], n = 65): number {
  let min = Infinity;
  const hx = (box[2] - box[0]) / (n - 1);
  const hy = (box[3] - box[1]) / (n - 1);
  let prev = new Float64Array(2 * n);
  let row = new Float64Array(2 * n);
  for (let j = 0; j < n; j++) {
    const y = box[1] + j * hy;
    for (let i = 0; i < n; i++) {
      const s = map(box[0] + i * hx, y);
      if (!Number.isFinite(s[0]) || !Number.isFinite(s[1])) return -Infinity;
      row[2 * i] = s[0];
      row[2 * i + 1] = s[1];
    }
    if (j > 0)
      for (let i = 0; i + 1 < n; i++) {
        // the cell at (i, j − 1): a = prev[i], +x = prev[i + 1], +y = row[i]
        const ax = prev[2 * i];
        const ay = prev[2 * i + 1];
        min = Math.min(min, ((prev[2 * i + 2] - ax) / hx) * ((row[2 * i + 1] - ay) / hy) - ((prev[2 * i + 3] - ay) / hx) * ((row[2 * i] - ax) / hy));
      }
    [prev, row] = [row, prev];
  }
  return min;
}
