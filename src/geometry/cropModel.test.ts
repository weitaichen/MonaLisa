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
});
