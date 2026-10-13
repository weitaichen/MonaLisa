import { describe, expect, it } from 'vitest';
import { centerCropRect, normalizedCropRect } from './imaging';

describe('normalizedCropRect: the camera picture frame (step-2 spec §4.5)', () => {
  it('is centerCropRect in source UV for each ratio and stream shape', () => {
    for (const ratio of [3 / 4, 1, 9 / 16])
      for (const [w, h] of [
        [1280, 720],
        [1080, 1920],
        [1920, 1080],
      ]) {
        const r = centerCropRect(w, h, ratio);
        expect(normalizedCropRect(w, h, ratio)).toEqual({ x: r.x / w, y: r.y / h, w: r.width / w, h: r.height / h });
      }
  });

  it('is the whole frame before the first video frame (0 × 0)', () => {
    expect(normalizedCropRect(0, 0, 3 / 4)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
