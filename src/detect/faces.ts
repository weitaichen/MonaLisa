// Detected faces → the faces a photo keeps (S §3.4 T3): adapt, box, dedupe, size filter, cap, order, ids, obstacles.
// Pure. The ids are persisted in the cache and never recomputed, so a different result order on another decode or
// delegate cannot swap identities.
import { MAX_EDIT_FACES, MAX_OBSTACLES, MIN_FACE_FRAC } from '../config/limits';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import type { CachedFace, CachedObstacle, Face, Landmarks478, Rect } from '../types';

export interface PreparedFace {
  id: string;
  face: Face;
  box: Rect;
  /** the raw 478×3 landmarks (cached, so a later adapter change needs no re-detection) */
  lm: Float32Array;
}
export interface PreparedFaces {
  faces: PreparedFace[];
  obstacles: CachedObstacle[];
  dropped: { tooSmall: number; overCap: number };
}
export const EMPTY_PREPARED: PreparedFaces = { faces: [], obstacles: [], dropped: { tooSmall: 0, overCap: 0 } };

export function boxIoU(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** a cached face as the engine needs it (adapt at this decode's size: normalized, so any size works) */
export function adaptCached(c: CachedFace, width: number, height: number): Face {
  return adapt({ points: c.lm }, width, height);
}

export function prepareFaces(lms: readonly Landmarks478[], width: number, height: number, cap = MAX_EDIT_FACES): PreparedFaces {
  // (1) adapt, (2) box; a non-finite or collapsed face never gets an id (Review Focus #1)
  const all: { face: Face; box: Rect; lm: Float32Array; area: number }[] = [];
  for (const l of lms) {
    if (l.points.length < 478 * 3) continue;
    const lm = l.points.slice(0, 478 * 3);
    if (!lm.every(Number.isFinite)) continue;
    const face = adapt({ points: lm }, width, height);
    const box = ovalBox(face);
    if (!(box.w > 0 && box.h > 0)) continue;
    all.push({ face, box, lm, area: box.w * box.h });
  }
  // (3) a duplicate (IoU > 0.6) is the same face: keep the larger, drop the other entirely
  all.sort((a, b) => b.area - a.area);
  const unique: typeof all = [];
  for (const f of all) if (!unique.some((u) => boxIoU(u.box, f.box) > 0.6)) unique.push(f);
  // (4) the size filter, (5) the cap (largest first: `unique` is sorted by area)
  const short = Math.min(width, height);
  const obstacles: CachedObstacle[] = [];
  const big: typeof all = [];
  let tooSmall = 0;
  for (const f of unique) {
    if (f.box.w * width < MIN_FACE_FRAC * short) {
      tooSmall++;
      obstacles.push({ box: f.box, oval: f.face.oval });
    } else big.push(f);
  }
  const kept = big.slice(0, cap);
  for (const f of big.slice(cap)) obstacles.push({ box: f.box, oval: f.face.oval });
  // (6) display order: box centre x, y breaking ties within 0.01; (7) ids in that order
  const cx = (b: Rect) => b.x + b.w / 2;
  const cy = (b: Rect) => b.y + b.h / 2;
  kept.sort((a, b) => (Math.abs(cx(a.box) - cx(b.box)) > 0.01 ? cx(a.box) - cx(b.box) : cy(a.box) - cy(b.box)));
  return {
    faces: kept.map((f, i) => ({ id: `f${i}`, face: f.face, box: f.box, lm: f.lm })),
    obstacles: obstacles.slice(0, MAX_OBSTACLES),
    dropped: { tooSmall, overCap: Math.max(0, big.length - cap) },
  };
}
