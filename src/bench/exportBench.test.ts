import { describe, expect, it } from 'vitest';
import { faceBoundsFor } from '../media/exportPlan';
import { gridFaces, NOISE_AMP, NOISE_ROWS, noiseStrip } from './exportBench';

describe('export bench noise strip (S §6.4 rows 1 and 3: photo-like file sizes)', () => {
  it('opaque RGB in 128 ± NOISE_AMP, the whole span used, mean near 128, seeded', () => {
    const w = 512;
    const px = noiseStrip(w, NOISE_ROWS);
    expect(px).toHaveLength(w * NOISE_ROWS * 4);
    let lo = 255;
    let hi = 0;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      expect(px[i + 3]).toBe(255);
      for (let k = 0; k < 3; k++) {
        lo = Math.min(lo, px[i + k]);
        hi = Math.max(hi, px[i + k]);
        sum += px[i + k];
      }
    }
    expect(lo).toBe(128 - NOISE_AMP);
    expect(hi).toBe(128 + NOISE_AMP);
    expect(Math.abs(sum / (w * NOISE_ROWS * 3) - 128)).toBeLessThan(0.5);
    expect(noiseStrip(w, NOISE_ROWS)).toEqual(px);
    expect(noiseStrip(w, NOISE_ROWS, 7)).not.toEqual(px);
  });

  it('no two rows of a strip alike, and a strip spans more than the 32 KB deflate window, so a PNG cannot match a repeat', () => {
    const w = 2048;
    const px = noiseStrip(w, NOISE_ROWS);
    const rowBytes = w * 4;
    const rows = new Set<string>();
    for (let y = 0; y < NOISE_ROWS; y++) rows.add(px.subarray(y * rowBytes, (y + 1) * rowBytes).join(','));
    expect(rows.size).toBe(NOISE_ROWS);
    // the frame repeats the strip every NOISE_ROWS rows: that distance, even as 3-byte RGB at the smallest width, is > 32 KB
    expect(NOISE_ROWS * w * 3).toBeGreaterThan(32 * 1024);
  });
});

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
