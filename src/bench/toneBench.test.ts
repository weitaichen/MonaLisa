import { describe, expect, it } from 'vitest';
import { formatToneBench, median, spotGrid, withDeltas } from './toneBench';

describe('toneBench helpers', () => {
  it('median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('spotGrid: n spots inside the box, each with a donor of 3 radii to the right', () => {
    const s = spotGrid(20, { x: 0.3, y: 0.4, w: 0.4, h: 0.2 });
    expect(s).toHaveLength(20);
    for (const p of s) {
      expect(p.x).toBeGreaterThanOrEqual(0.3);
      expect(p.x).toBeLessThanOrEqual(0.7);
      expect(p.y).toBeGreaterThanOrEqual(0.4);
      expect(p.y).toBeLessThanOrEqual(0.6);
      expect(p.dx).toBeCloseTo(3 * p.r, 12);
      expect(p.owner).toBeNull();
    }
  });

  it('deltas against the base row, and a TSV report', () => {
    const rows = withDeltas([{ row: 'base', ms: 10 }, { row: '+ tone', ms: 12.5 }], 'base');
    expect(rows).toEqual([
      { row: 'base', ms: 10, delta: null },
      { row: '+ tone', ms: 12.5, delta: 2.5 },
    ]);
    expect(formatToneBench(rows)).toBe('row\tms\tΔ ms\nbase\t10.00\t\n+ tone\t12.50\t2.50');
  });
});
