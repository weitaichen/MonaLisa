import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_RENDER_FACES } from '../config/limits';
import { ovalBox } from '../engine/passes/faceCap';
import { faceWidthIso } from '../engine/passes/reshape';
import { adapt } from '../tracking/adapter111';
import { placeBenchFace, reshapeBenchLayouts } from './reshapeLayouts';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const fw1 = faceWidthIso(base, 1);

describe('row R layouts (step-1 spec §6.2, §6.7)', () => {
  const layouts = reshapeBenchLayouts(fw1);

  it('spread 1…MAX_RENDER_FACES (10), rows of 6, 8 and 10 at 1.2 FW, 2 × 3, 2 × 4 and 2 × 5 grids at 1.3 FW', () => {
    expect(MAX_RENDER_FACES).toBe(10);
    expect(Object.keys(layouts)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `spread ${i + 1}`),
      'row 6 @1.2FW',
      'grid 2×3 @1.3FW',
      'row 8 @1.2FW',
      'grid 2×4 @1.3FW',
      'row 10 @1.2FW (FW 0.081)',
      'grid 2×5 @1.3FW',
    ]);
    for (let n = 1; n <= 10; n++) expect(layouts[`spread ${n}`].centres).toHaveLength(n);
    const counts = Object.fromEntries(Object.entries(layouts).filter(([name]) => !name.startsWith('spread')).map(([name, l]) => [name, l.centres.length]));
    expect(counts).toEqual({ 'row 6 @1.2FW': 6, 'grid 2×3 @1.3FW': 6, 'row 8 @1.2FW': 8, 'grid 2×4 @1.3FW': 8, 'row 10 @1.2FW (FW 0.081)': 10, 'grid 2×5 @1.3FW': 10 });
  });

  it('the clustered layouts keep their names: FW 0.1 (0.081 for the row of ten), 1.2 FW and 1.3 FW apart, centred', () => {
    const fwOf = (name: string) => faceWidthIso(placeBenchFace(base, 0.5, 0.5, layouts[name].k), 1);
    for (const name of ['row 6 @1.2FW', 'row 8 @1.2FW', 'grid 2×3 @1.3FW', 'grid 2×4 @1.3FW', 'grid 2×5 @1.3FW']) expect(fwOf(name), name).toBeCloseTo(0.1, 6);
    const row10 = 'row 10 @1.2FW (FW 0.081)';
    const fw10 = fwOf(row10);
    expect(fw10).toBeCloseTo(0.95 / (1.2 * 9 + 1), 6);
    const xs = layouts[row10].centres.map((c) => c[0]);
    // (fw10 is measured on the Float32Array landmarks: equal to about 1e-8)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(1.2 * fw10, 6);
    expect((xs[0] + xs[9]) / 2).toBeCloseTo(0.5, 9);
    // the 2026-10-12 / 2026-10-18 rows' spacing at FW 0.1
    const row8 = layouts['row 8 @1.2FW'].centres.map((c) => c[0]);
    expect(row8[1] - row8[0]).toBeCloseTo(0.12, 12);
    const g5 = layouts['grid 2×5 @1.3FW'].centres;
    expect(g5[1][0] - g5[0][0]).toBeCloseTo(0.13, 12);
    expect(g5[5][1] - g5[0][1]).toBeCloseTo(0.13, 12);
  });

  it('every face of every layout lies inside the square bench frame', () => {
    for (const [name, { centres, k }] of Object.entries(layouts))
      for (const [x, y] of centres) {
        const b = ovalBox(placeBenchFace(base, x, y, k));
        expect(b.x, name).toBeGreaterThanOrEqual(0);
        expect(b.y, name).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w, name).toBeLessThanOrEqual(1);
        expect(b.y + b.h, name).toBeLessThanOrEqual(1);
      }
  });
});
