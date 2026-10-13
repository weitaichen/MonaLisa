// Crop box gestures in 裁切 mode (S §2.1, §3.3): pure reducers from the geometry at gesture start and the finger delta in
// the plane (normalized to the E frame). Every result is valid: the limits are found by bisection, so the box stops
// (or slides, for a move) where it would leave the straightened photo or the E frame, and never gets below minCrop.
import type { Geometry, Rect, Size } from '../types';
import { cropFits, eSize, lockAspect, minCrop, type CropLock, type Vec2 } from './view';

export { lockAspect, transposeLock, type CropLock } from './view';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Edge = 'top' | 'bottom' | 'left' | 'right';

const STEPS = 24;
const withCrop = (g: Geometry, crop: Rect): Geometry => ({ ...g, crop });

/** the largest t in [0, 1] with ok(t), given ok(0) */
function bisect(ok: (t: number) => boolean): number {
  if (ok(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < STEPS; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

export function dragCorner(start: Geometry, corner: Corner, d: Vec2, lock: CropLock, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const right = corner === 'tr' || corner === 'br';
  const bottom = corner === 'bl' || corner === 'br';
  const ax = right ? c.x : c.x + c.w;
  const ay = bottom ? c.y : c.y + c.h;
  const e = eSize(start, oSize);
  const m = minCrop(start, oSize);
  let w = c.w + (right ? d[0] : -d[0]);
  let h = c.h + (bottom ? d[1] : -d[1]);
  const a = lockAspect(lock, start, oSize);
  if (a !== null) {
    if (Math.abs(d[0] * e.width) >= Math.abs(d[1] * e.height)) h = (w * e.width) / (a * e.height);
    else w = (a * h * e.height) / e.width;
    if (!(w >= m.w && h >= m.h)) {
      h = Math.max(m.h, (m.w * e.width) / (a * e.height));
      w = (a * h * e.height) / e.width;
    }
  } else {
    w = Math.max(w, m.w);
    h = Math.max(h, m.h);
  }
  const rect = (t: number): Rect => {
    const wt = c.w + t * (w - c.w);
    const ht = c.h + t * (h - c.h);
    return { x: right ? ax : ax - wt, y: bottom ? ay : ay - ht, w: wt, h: ht };
  };
  const t = bisect((s) => cropFits(withCrop(start, rect(s)), oSize));
  return t === 0 ? start : withCrop(start, rect(t));
}

/** 自由 only (the strip shows edge handles only then) */
export function dragEdge(start: Geometry, edge: Edge, d: Vec2, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const m = minCrop(start, oSize);
  let rect: (t: number) => Rect;
  switch (edge) {
    case 'left': {
      const x1 = c.x + c.w;
      const nx = Math.min(c.x + d[0], x1 - m.w);
      rect = (t) => {
        const x = c.x + t * (nx - c.x);
        return { x, y: c.y, w: x1 - x, h: c.h };
      };
      break;
    }
    case 'right': {
      const nw = Math.max(c.w + d[0], m.w);
      rect = (t) => ({ ...c, w: c.w + t * (nw - c.w) });
      break;
    }
    case 'top': {
      const y1 = c.y + c.h;
      const ny = Math.min(c.y + d[1], y1 - m.h);
      rect = (t) => {
        const y = c.y + t * (ny - c.y);
        return { x: c.x, y, w: c.w, h: y1 - y };
      };
      break;
    }
    case 'bottom': {
      const nh = Math.max(c.h + d[1], m.h);
      rect = (t) => ({ ...c, h: c.h + t * (nh - c.h) });
      break;
    }
  }
  const t = bisect((s) => cropFits(withCrop(start, rect(s)), oSize));
  return t === 0 ? start : withCrop(start, rect(t));
}

/** one finger inside the box: the box moves over the fixed photo and slides along a limit (S D2) */
export function dragMove(start: Geometry, d: Vec2, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const at = (dx: number, dy: number) => withCrop(start, { ...c, x: c.x + dx, y: c.y + dy });
  const t = bisect((s) => cropFits(at(s * d[0], s * d[1]), oSize));
  let dx = t * d[0];
  let dy = t * d[1];
  const rx = d[0] - dx;
  const ry = d[1] - dy;
  dx += bisect((s) => cropFits(at(dx + s * rx, dy), oSize)) * rx;
  dy += bisect((s) => cropFits(at(dx, dy + s * ry), oSize)) * ry;
  return dx === 0 && dy === 0 ? start : at(dx, dy);
}
