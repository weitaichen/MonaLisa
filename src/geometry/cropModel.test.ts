import { describe, expect, it } from 'vitest';
import type { Geometry } from '../types';
import { dragCorner, dragEdge, dragMove, type Corner, type Edge } from './cropModel';
import { applyRatio, clampStraighten, cropAspectPx, cropConstrain, cropValid, IDENTITY_GEOMETRY, lockAspect, minCrop, type CropLock, type Quarter } from './view';

const O = { width: 2048, height: 1536 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];
const EDGES: Edge[] = ['top', 'bottom', 'left', 'right'];
const LOCKS: CropLock[] = ['free', 'original', '1:1', '3:4', '4:3', '9:16', '16:9'];

function start(r: () => number, lock: CropLock): Geometry {
  const base: Geometry = {
    flipH: r() < 0.5,
    quarter: Math.floor(r() * 4) as Quarter,
    straighten: clampStraighten(-30 + 60 * r()),
    crop: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
  };
  const fitted = applyRatio(cropConstrain(base, O), lock, O);
  return cropConstrain(fitted, O);
}

describe('crop gestures (fuzzed)', () => {
  it('every corner, edge and move result is valid; a lock keeps its aspect; the minimum size holds', () => {
    const r = rng(11);
    for (let i = 0; i < 600; i++) {
      const lock = LOCKS[Math.floor(r() * LOCKS.length)];
      const g = start(r, lock);
      const d = [-0.6 + 1.2 * r(), -0.6 + 1.2 * r()] as const;
      const m = minCrop(g, O);
      const corner = dragCorner(g, CORNERS[Math.floor(r() * 4)], d, lock, O);
      expect(cropValid(corner, O, 1e-7)).toBe(true);
      const a = lockAspect(lock, g, O);
      // a start that already has the lock's aspect keeps it exactly through the gesture
      if (a !== null && corner !== g && Math.abs(cropAspectPx(g, O) / a - 1) < 1e-9) expect(cropAspectPx(corner, O)).toBeCloseTo(a, 5);
      const edge = dragEdge(g, EDGES[Math.floor(r() * 4)], d, O);
      expect(cropValid(edge, O, 1e-7)).toBe(true);
      const move = dragMove(g, d, O);
      expect(cropValid(move, O, 1e-7)).toBe(true);
      expect(move.crop.w).toBeCloseTo(g.crop.w, 12);
      for (const out of [corner, edge, move]) {
        expect(out.crop.w).toBeGreaterThanOrEqual(m.w - 1e-7);
        expect(out.crop.h).toBeGreaterThanOrEqual(m.h - 1e-7);
      }
    }
  });

  it('a corner drag keeps the opposite corner fixed', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
    const out = dragCorner(g, 'br', [-0.1, -0.05], 'free', O);
    expect(out.crop.x).toBe(0.2);
    expect(out.crop.y).toBe(0.2);
    expect(out.crop.w).toBeCloseTo(0.4, 12);
    expect(out.crop.h).toBeCloseTo(0.45, 12);
  });

  it('with a lock the dominant axis (in pixels) drives the size', () => {
    const g = applyRatio(IDENTITY_GEOMETRY, '1:1', O);
    const out = dragCorner(g, 'tl', [0.1, 0.01], '1:1', O);
    expect(out.crop.w * O.width).toBeCloseTo(g.crop.w * O.width - 0.1 * O.width, 6);
    expect(cropAspectPx(out, O)).toBeCloseTo(1, 9);
  });

  it('a move slides along a limit instead of stopping', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.5, y: 0.2, w: 0.5, h: 0.3 } };
    const out = dragMove(g, [0.2, 0.1], O);
    expect(out.crop.x).toBeCloseTo(0.5, 12); // already at the right edge
    expect(out.crop.y).toBeCloseTo(0.3, 6); // still moved down
  });

  it('an edge drag stops at the minimum size', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
    const out = dragEdge(g, 'right', [-0.9, 0], O);
    expect(out.crop.w).toBeCloseTo(minCrop(g, O).w, 6);
    expect(out.crop.x).toBe(0.2);
  });

  it('自由: a limit on one axis does not stop the other axis following the finger', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } };
    for (const dx of [0.3, 0.6, 1.2]) {
      const out = dragCorner(g, 'br', [dx, 0.2], 'free', O);
      expect(out.crop.w).toBeCloseTo(0.8, 6);
      expect(out.crop.h).toBeCloseTo(0.7, 6);
    }
    // from the full frame, a sideways drag that drifts outward still narrows the box, and the blocked axis stays full
    const f = dragCorner(IDENTITY_GEOMETRY, 'br', [-0.1, 0.0005], 'free', O);
    expect(f.crop.w).toBeCloseTo(0.9, 6);
    expect(f.crop.h).toBeCloseTo(1, 9);
  });

  it('a gesture the limits block returns the start itself', () => {
    expect(dragMove(IDENTITY_GEOMETRY, [0.002, 0.001], O)).toBe(IDENTITY_GEOMETRY);
    expect(dragEdge(IDENTITY_GEOMETRY, 'right', [0.001, 0], O)).toBe(IDENTITY_GEOMETRY);
    expect(dragCorner(IDENTITY_GEOMETRY, 'br', [0.001, 0.0005], 'free', O)).toBe(IDENTITY_GEOMETRY);
    for (const c of CORNERS) expect(dragCorner(IDENTITY_GEOMETRY, c, [c.endsWith('l') ? -0.01 : 0.01, c.startsWith('t') ? -0.01 : 0.01], 'free', O)).toBe(IDENTITY_GEOMETRY);
  });

  it('a start just past the frame (within cropFits eps) still follows the finger on its other edges', () => {
    // flipView's 1 − x − w of a box on the right edge, and a cropConstrain result, can sit a hair outside [0,1]
    for (const crop of [
      { x: -4e-17, y: 0.2, w: 0.5, h: 0.5 },
      { x: 0.2, y: 0.2, w: 0.8 + 5e-10, h: 0.5 },
    ]) {
      const g: Geometry = { ...IDENTITY_GEOMETRY, crop };
      expect(dragEdge(g, 'bottom', [0, 0.1], O).crop.h).toBeCloseTo(0.6, 6);
      expect(dragEdge(g, 'top', [0, -0.1], O).crop.y).toBeCloseTo(0.1, 6);
      expect(dragMove(g, [0, 0.1], O).crop.y).toBeCloseTo(0.3, 6);
      for (const c of CORNERS) {
        const out = dragCorner(g, c, [0, c.startsWith('t') ? -0.1 : 0.1], 'free', O);
        expect(out.crop.h).toBeCloseTo(0.6, 6);
        expect(cropValid(out, O)).toBe(true);
      }
    }
  });
});
