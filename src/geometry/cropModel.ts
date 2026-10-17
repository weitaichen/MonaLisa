// Crop box gestures in 裁切 mode (S §2.1, §3.3): pure reducers from the geometry at gesture start and the finger delta in
// the plane (normalized to the E frame). Every result is valid: the limits are found by bisection, so the box stops
// (or slides, for a move and for a 自由 corner) where it would leave the straightened photo or the E frame, and never gets
// below minCrop. A gesture that the limits block returns `start` itself, so callers can compare by reference.
import type { Geometry, Rect, Size } from '../types';
import { cropFits, eSize, lockAspect, minCrop, type CropLock, type Vec2 } from './view';

export { lockAspect, transposeLock, type CropLock } from './view';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type Edge = 'top' | 'bottom' | 'left' | 'right';

const STEPS = 24;
/** float rounding allowed past the E frame in the bisection (cropFits's own 1e-9 is kept only for the turned photo) */
const SLACK = 1e-12;
/** a result this close to the start on every crop field is the start (a blocked gesture; bisection noise) */
const SAME = 1e-7;
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

/**
 * The bisection predicate: cropFits, but exact (up to SLACK) on the E frame, so a box pushed against the frame stops on
 * it instead of up to 1e-9 past it. An edge the start already has past the frame (−4e-17 from flipView's 1 − x − w, up
 * to 1e-9 from cropConstrain, both within cropFits's eps) may stay where it is, so ok(0) holds for every start that fits.
 */
function fitsFrom(start: Geometry, oSize: Size): (r: Rect) => boolean {
  const c = start.crop;
  const x0 = Math.min(0, c.x) - SLACK;
  const y0 = Math.min(0, c.y) - SLACK;
  const x1 = Math.max(1, c.x + c.w) + SLACK;
  const y1 = Math.max(1, c.y + c.h) + SLACK;
  return (r) => r.x >= x0 && r.y >= y0 && r.x + r.w <= x1 && r.y + r.h <= y1 && cropFits(withCrop(start, r), oSize);
}

function settle(start: Geometry, out: Geometry): Geometry {
  const a = start.crop;
  const b = out.crop;
  const same = Math.abs(a.x - b.x) < SAME && Math.abs(a.y - b.y) < SAME && Math.abs(a.w - b.w) < SAME && Math.abs(a.h - b.h) < SAME;
  return same ? start : out;
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
  const ok = fitsFrom(start, oSize);
  const box = (wt: number, ht: number): Rect => ({ x: right ? ax : ax - wt, y: bottom ? ay : ay - ht, w: wt, h: ht });
  const fits = (wt: number, ht: number) => ok(box(wt, ht));
  // the size moves from the start toward the target from the anchor and stops at the first limit
  const t = bisect((s) => fits(c.w + s * (w - c.w), c.h + s * (h - c.h)));
  let wt = c.w + t * (w - c.w);
  let ht = c.h + t * (h - c.h);
  if (a === null) {
    // 自由: a limit on one axis does not stop the other, which keeps following the finger (as a move slides). Each size
    // stays between the start and the target size, so the minimum size still holds.
    const w0 = wt;
    wt = w0 + bisect((s) => fits(w0 + s * (w - w0), ht)) * (w - w0);
    const h0 = ht;
    ht = h0 + bisect((s) => fits(wt, h0 + s * (h - h0))) * (h - h0);
  }
  return settle(start, withCrop(start, box(wt, ht)));
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
  const ok = fitsFrom(start, oSize);
  const t = bisect((s) => ok(rect(s)));
  return settle(start, withCrop(start, rect(t)));
}

/** one finger inside the box: the box moves over the fixed photo and slides along a limit (S D2) */
export function dragMove(start: Geometry, d: Vec2, oSize: Size): Geometry {
  if (!cropFits(start, oSize)) return start;
  const c = start.crop;
  const ok = fitsFrom(start, oSize);
  const at = (dx: number, dy: number): Rect => ({ ...c, x: c.x + dx, y: c.y + dy });
  const t = bisect((s) => ok(at(s * d[0], s * d[1])));
  let dx = t * d[0];
  let dy = t * d[1];
  const rx = d[0] - dx;
  const ry = d[1] - dy;
  dx += bisect((s) => ok(at(dx + s * rx, dy))) * rx;
  dy += bisect((s) => ok(at(dx, dy + s * ry))) * ry;
  return settle(start, withCrop(start, at(dx, dy)));
}
