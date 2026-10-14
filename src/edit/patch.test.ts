import { describe, expect, it } from 'vitest';
import { PATCH_MAX_SIDE, patchPlan } from './patch';

describe('patchPlan (skin-cleanup spec §3.4 step 4)', () => {
  const work = { width: 1000, height: 1500 };
  it('reads the square of half-side 5.6 r around the tap, r at 6–10 patch px, side ≤ 112', () => {
    for (const r of [0.003, 0.008, 0.0177, 0.04]) {
      const p = patchPlan([0.4, 0.5], r, work);
      const rPatch = r * p.pxPerShort;
      expect(rPatch).toBeGreaterThanOrEqual(6 - 0.2);
      expect(rPatch).toBeLessThanOrEqual(10 + 0.2);
      expect(Math.max(p.w, p.h)).toBeLessThanOrEqual(PATCH_MAX_SIDE);
      expect(p.sw).toBeCloseTo(11.2 * r * 1000, -1);
    }
  });
  it('clips at the photo edge', () => {
    const p = patchPlan([0.001, 0.999], 0.02, work);
    expect(p.sx).toBe(0);
    expect(p.sy + p.sh).toBe(1500);
    expect(p.rect.x).toBe(0);
  });
});
