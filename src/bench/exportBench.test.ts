import { describe, expect, it } from 'vitest';
import { faceBoundsFor } from '../media/exportPlan';
import { gridFaces } from './exportBench';

describe('export bench frame (S §6.4 row 2)', () => {
  it('six template faces inside the frame, each with an active warp, so every tile window that meets one grows', () => {
    const faces = gridFaces();
    expect(faces).toHaveLength(6);
    for (const f of faces) {
      expect(f.face.pts111).toHaveLength(222);
      expect(f.face.ext).toHaveLength(16);
      expect(f.face.oval).toHaveLength(72);
      expect(Math.min(...f.face.pts111)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...f.face.pts111)).toBeLessThanOrEqual(1);
      expect(f.weight).toBe(1);
    }
    const bounds = faceBoundsFor(faces, 4096 / 3072);
    expect(bounds).toHaveLength(6);
    for (const b of bounds) expect(b.bound).toBeGreaterThan(0);
  });
});
