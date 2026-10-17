// Test doubles for detection caches (never imported by app code).
import type { CachedBody, CachedFace, DetectionCache } from '../types';

/** a face whose 478 points lie on a circle (radius w/2) around (cx, 0.5); box = its bbox */
export function cacheFace(id: string, cx: number, w = 0.2): CachedFace {
  const lm = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    const a = (i / 478) * Math.PI * 2;
    lm[i * 3] = cx + (w / 2) * Math.cos(a);
    lm[i * 3 + 1] = 0.5 + (w / 2) * Math.sin(a);
  }
  return { id, lm, box: { x: cx - w / 2, y: 0.5 - w / 2, w, h: w } };
}

/** a standing pose centred at cx (all visible), no mask */
export function cacheBody(id: string, cx: number): CachedBody {
  const points = new Float32Array(33 * 4);
  for (let i = 0; i < 33; i++) {
    points[i * 4] = cx + (i % 2 ? 0.05 : -0.05);
    points[i * 4 + 1] = 0.1 + (0.8 * i) / 32;
    points[i * 4 + 3] = 0.99;
  }
  return { id, pose: { points }, mask: null, score: 0.1 };
}

/** two faces (f0 left, f1 right), no bodies yet, scanned upright */
export function makeCache(over: Partial<DetectionCache> = {}): DetectionCache {
  return {
    v: 1,
    width: 1600,
    height: 1200,
    faceScans: [{ quarter: 0, flipH: false }],
    faces: [cacheFace('f0', 0.3), cacheFace('f1', 0.7)],
    obstacles: [],
    bodies: null,
    bodiesComplete: true,
    persons: [
      { id: 'f0', face: 'f0', body: null },
      { id: 'f1', face: 'f1', body: null },
    ],
    primary: 'f0',
    dropped: { tooSmall: 0, overCap: 0 },
    ...over,
  };
}
