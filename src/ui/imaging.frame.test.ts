import { describe, expect, it } from 'vitest';
import { mirrorSides, splitOn, writeSide } from '../edit/sides';
import { naturalPerson } from '../edit/state';
import { centerCropRect, normalizedCropRect, shotBox, shotPersons } from './imaging';

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

describe('the hand-over boxes: video UV → the saved picture (camera per-person spec §3.8, §5.3)', () => {
  it('shotBox: video UV → the saved 3:4 crop of 1280 × 720 (x 370, 540 wide), mirrored as saved, not clamped', () => {
    const b = { x: 0.5, y: 0.25, w: 0.1, h: 0.2 };
    expect(shotBox(b, 1280, 720, 3 / 4, false)).toEqual({ x: 0.5, y: 0.25, w: expect.closeTo(128 / 540, 9), h: 0.2 });
    expect(shotBox(b, 1280, 720, 3 / 4, true).x).toBeCloseTo(1 - 0.5 - 128 / 540, 9);
    expect(shotBox({ x: 0, y: 0.25, w: 0.1, h: 0.2 }, 1280, 720, 3 / 4, false).x).toBeCloseTo(-370 / 540, 9);
  });
  it('Review Focus #5: a mirrored shot hands over mirrored boxes and swapped sides; a person outside the picture is not handed over', () => {
    const split = writeSide(splitOn(naturalPerson()), 'shape.faceSlim', 0.9, 'right');
    const out = shotPersons(
      [{ rawBox: { x: 0.45, y: 0.3, w: 0.1, h: 0.2 }, params: split }, { rawBox: { x: 0.05, y: 0.3, w: 0.08, h: 0.15 }, params: naturalPerson() }],
      1280, 720, 3 / 4, true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].params).toEqual(mirrorSides(split));
    expect(out[0].box.x).toBeCloseTo(1 - (0.45 * 1280 - 370) / 540 - 128 / 540, 9);
  });
});
