// Per-face geometry shared by the detection cache, the face table and the caps (S §4.1, §4.4).
import type { Face, ParamId, Rect } from '../../types';
import { neutralValue, PARAM_DEFS, paramsInGroup } from '../params';
import {
  EMPTY_BOX,
  faceWidthIso,
  packFaceDetail,
  PROTECT_RAMP,
  PROTECT_REACH,
  PROTECT_SLOPE,
  PROTECT_SMOOTH,
  reshapeGeometry,
  reshapeUniforms,
  yawAttenuation,
  type ReshapeGeometry,
  type ReshapeUniforms,
} from './reshape';
import { FT } from './faceTable';

/** FACE_OVAL bbox clipped to [0,1] (the box maskCoversFace uses, faceProtectModel.ts:63-72) */
export function ovalBox(face: Face): Rect {
  const o = face.oval;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < o.length; i += 2) {
    x0 = Math.min(x0, o[i]);
    x1 = Math.max(x1, o[i]);
    y0 = Math.min(y0, o[i + 1]);
    y1 = Math.max(y1, o[i + 1]);
  }
  const cx0 = Math.max(0, Math.min(1, x0));
  const cy0 = Math.max(0, Math.min(1, y0));
  const cx1 = Math.max(0, Math.min(1, x1));
  const cy1 = Math.max(0, Math.min(1, y1));
  return Number.isFinite(cx0 + cy0 + cx1 + cy1) ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : { x: 0, y: 0, w: 0, h: 0 };
}

export const boxCentre = (b: Rect): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];

export { FT } from './faceTable';
export const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** one face as the face table (and the CPU port) sees it (S §4.4) */
export interface TableFace {
  face: Face;
  /** what the shader applies: × weight and yaw-attenuated (attenuate() below) */
  u: ReshapeUniforms;
  /** protect layer, −1 = none */
  layer: number;
  /** the UV rect the layer covers (WHOLE for the photo grid) */
  window: Rect;
  /** oval-bbox centre (UV) */
  centre: [number, number];
  /** iso; −1 = no cap */
  cap: number;
}

/** RB §2.4 yaw attenuation of every delta (what ReshapePass.draw did, reshape.ts:360-362) */
export function attenuate(u: ReshapeUniforms, yaw: number): ReshapeUniforms {
  const att = yawAttenuation(yaw);
  const k = { ...u };
  for (const key of Object.keys(k) as (keyof ReshapeUniforms)[]) k[key] *= att;
  return k;
}

/** any non-zero delta (not reshapeActive's 1e-4): the face chain runs, as today (reshape.ts:363-365) */
export function faceDrawn(u: ReshapeUniforms): boolean {
  return Object.values(u).some((v) => v !== 0);
}

/**
 * cap_f = ½ · min over the other listed faces (weight 0 included) and every obstacle of isoDist(c_f, c_g) / p_g, with
 * p_g a neighbour track's presence in the camera (clamped below at 1e-3; 0 = not there) and 1 otherwise (S §4.1).
 * −1: no neighbour, so one face warps exactly as v0.3. 0 (coincident centres) is a valid cap with zero influence.
 */
export function capsFor(
  centres: readonly (readonly [number, number])[],
  obstacles: readonly (readonly [number, number])[],
  aspect: number,
  presence?: readonly number[],
): number[] {
  const iso = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / aspect);
  return centres.map((c, f) => {
    let best = Infinity;
    centres.forEach((g, j) => {
      if (j === f) return;
      const p = presence ? presence[j] : 1;
      if (!(p > 0)) return;
      best = Math.min(best, iso(c, g) / Math.max(p, 1e-3));
    });
    for (const o of obstacles) best = Math.min(best, iso(c, o));
    return Number.isFinite(best) ? best / 2 : -1;
  });
}

/** UV AABB of the iso disc (centre, cap) */
export function capBox(centre: readonly [number, number], cap: number, aspect: number): [number, number, number, number] {
  return [centre[0] - cap, centre[1] - cap * aspect, centre[0] + cap, centre[1] + cap * aspect];
}

/** the box the shader tests (texel 72): the warp discs' box, clipped to the cap disc's AABB; EMPTY_BOX when nothing moves */
export function influenceBox(t: TableFace, aspect: number): [number, number, number, number] {
  if (!faceDrawn(t.u)) return [...EMPTY_BOX];
  const b = reshapeGeometry(t.face, aspect, t.u).box;
  if (t.cap < 0) return b;
  const c = capBox(t.centre, t.cap, aspect);
  const out: [number, number, number, number] = [Math.max(b[0], c[0]), Math.max(b[1], c[1]), Math.min(b[2], c[2]), Math.min(b[3], c[3])];
  return out[0] <= out[2] && out[1] <= out[3] ? out : [...EMPTY_BOX];
}

/** the box every 美型 item at its maximum (both ends of the bidirectional ones) could reach: sizes the protect window (A3) */
export function uMaxBox(face: Face, aspect: number): ReshapeGeometry['box'] {
  const neutral = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, neutralValue(d)])) as Record<ParamId, number>;
  const at = (bi: number) => {
    const v = { ...neutral };
    for (const d of paramsInGroup('shape')) v[d.id] = d.bidirectional ? bi : 1;
    return reshapeGeometry(face, aspect, reshapeUniforms(v, 1)).box;
  };
  const a = at(1);
  const b = at(0);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Pack the face table (S §4.4) for MAX_RENDER_FACES rows; `out` holds faces.length × 96 × 4 floats or more. */
export function packFaceTable(faces: readonly TableFace[], aspect: number, out: Float32Array): void {
  out.fill(0);
  faces.forEach((t, f) => {
    const o = f * FT.ROW * 4;
    const at = (texel: number, a: number, b: number, c: number, d: number) => out.set([a, b, c, d], o + texel * 4);
    out.set(t.face.pts111, o + FT.PTS * 4);
    out.set(t.face.ext, o + FT.EXT * 4);
    const u = t.u;
    const g = reshapeGeometry(t.face, aspect, u);
    out.set(g.vTargets, o + FT.VT * 4);
    out.set(g.narrowTargets, o + FT.NT * 4);
    at(FT.CHIN_EYE, g.chinTarget[0], g.chinTarget[1], g.eyeDisp[0], g.eyeDisp[1]);
    at(FT.S1, u.faceSlim, u.faceV, u.faceNarrow, u.chin);
    at(FT.S2, u.forehead, u.noseSlim, u.mouthSize, u.eyeEnlarge);
    at(FT.RADII, g.eyeR[0], g.eyeR[1], g.mouthR, t.layer);
    const fw = faceWidthIso(t.face, aspect);
    at(FT.PROT, PROTECT_REACH * fw, PROTECT_SLOPE, PROTECT_RAMP, PROTECT_SMOOTH * fw);
    const box = influenceBox(t, aspect);
    at(FT.BOX, box[0], box[1], box[2], box[3]);
    at(FT.CAP, t.centre[0], t.centre[1], t.cap, PROTECT_SMOOTH * fw);
    at(FT.WIN, t.window.x, t.window.y, 1 / t.window.w, 1 / t.window.h);
    packFaceDetail(out.subarray(o, o + FT.ROW * 4), u, g);
  });
}
