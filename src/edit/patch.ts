// 祛痘 patch (skin-cleanup spec §3.4 step 4): the square of half-side 5.6 r around the tap — the farthest donor ring after
// the largest snap (0.8 r + 3.2 r + 1.4 r = 5.4 r) plus a 0.2 r margin — read from the working bitmap through one reused
// 2D surface, scaled so r is 6–10 patch px and the side ≤ 112 px. It only steers the snap and the donor choice; the heal
// samples the GPU source, so a colour-management difference between 2D canvas and WebGL cannot misplace pixels.
import { createSurface, type Surface } from '../media/exporter';
import type { Rect } from '../types';
import type { Patch, V2 } from './spots';

export const PATCH_MAX_SIDE = 112;

export interface PatchPlan {
  /** source rectangle in working px */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** patch size in px */
  w: number;
  h: number;
  /** the O rectangle covered */
  rect: Rect;
  pxPerShort: number;
}

/** Which working pixels the patch reads and at what scale (pure). */
export function patchPlan(o: V2, r: number, work: { width: number; height: number }): PatchPlan {
  const short = Math.min(work.width, work.height);
  const rPx = Math.max(1e-6, r * short);
  const hs = 5.6 * rPx;
  const cx = o[0] * work.width;
  const cy = o[1] * work.height;
  const sx = Math.max(0, Math.round(cx - hs));
  const sy = Math.max(0, Math.round(cy - hs));
  const sw = Math.max(1, Math.min(work.width, Math.round(cx + hs)) - sx);
  const sh = Math.max(1, Math.min(work.height, Math.round(cy + hs)) - sy);
  const scale = Math.min(rPx < 6 ? 6 / rPx : rPx > 10 ? 10 / rPx : 1, PATCH_MAX_SIDE / sw, PATCH_MAX_SIDE / sh);
  const w = Math.max(1, Math.min(PATCH_MAX_SIDE, Math.round(sw * scale)));
  const h = Math.max(1, Math.min(PATCH_MAX_SIDE, Math.round(sh * scale)));
  return { sx, sy, sw, sh, w, h, rect: { x: sx / work.width, y: sy / work.height, w: sw / work.width, h: sh / work.height }, pxPerShort: (w / sw) * short };
}

let surface: Surface | null = null;

/** The patch pixels. DOM: OffscreenCanvas, else a detached <canvas>; throws when no 2D context exists. */
export function readPatch(bitmap: CanvasImageSource, plan: PatchPlan): Patch {
  // `type` is irrelevant: the patch is never encoded
  surface ??= createSurface(PATCH_MAX_SIDE, PATCH_MAX_SIDE, { type: 'image/png', alpha: false, willReadFrequently: true });
  const ctx = surface.ctx;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, PATCH_MAX_SIDE, PATCH_MAX_SIDE);
  ctx.drawImage(bitmap, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.w, plan.h);
  const img = ctx.getImageData(0, 0, plan.w, plan.h);
  return { data: img.data, w: plan.w, h: plan.h, rect: plan.rect, pxPerShort: plan.pxPerShort };
}
