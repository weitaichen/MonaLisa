import { describe, expect, it } from 'vitest';
import { bandToDisplay, displayToBand } from '../ui/components/HeightBandOverlay';
import {
  backwardY,
  bandIntegral,
  forwardSlope,
  forwardY,
  heightBand,
  heightBandStretch,
  HEIGHT_MAX_CROP,
  legsBand,
  FEET_MARGIN,
  type Band,
} from './bands';

const legs: Band = { a: 0.5, b: Infinity, r: 0.04, S: 1.12 };

describe('vertical bands', () => {
  it('backward map inverts the forward map', () => {
    const bands = [legs, { a: 0.2, b: 0.35, r: 0.03, S: 1.1 }];
    for (let y = 0; y <= 1; y += 0.01) expect(forwardY(bands, backwardY(bands, y))).toBeCloseTo(y, 9);
  });

  it('is identity above the band and pure scaling about the hip line below it (the report legBand)', () => {
    for (const y of [0, 0.2, 0.45]) expect(backwardY([legs], y)).toBeCloseTo(y, 12);
    for (const y of [0.6, 0.8, 1]) expect(backwardY([legs], y)).toBeCloseTo(0.5 + (y - 0.5) / 1.12, 9);
  });

  it('is monotonic and C¹: slope moves smoothly between 1 and 1/S', () => {
    const n = 4000;
    let prev = backwardY([legs], 0);
    let prevSlope = 1;
    for (let i = 1; i <= n; i++) {
      const y = i / n;
      const g = backwardY([legs], y);
      const slope = (g - prev) * n;
      expect(slope).toBeGreaterThan(0);
      expect(slope).toBeGreaterThanOrEqual(1 / 1.12 - 1e-6);
      expect(slope).toBeLessThanOrEqual(1 + 1e-6);
      // no kink: neighbouring slopes differ by O(1/n)
      expect(Math.abs(slope - prevSlope)).toBeLessThan(0.01);
      prev = g;
      prevSlope = slope;
    }
    expect(forwardSlope([legs], 0.3)).toBe(1);
    expect(forwardSlope([legs], 0.9)).toBeCloseTo(1.12, 12);
  });

  it('manual 增高: 1 + 0.15·amount inside the band, bottom crop ≤ 8 %', () => {
    const b = heightBand(0.4, 0.6, 1)!;
    expect(b.S).toBeCloseTo(1.15, 12);
    expect(bandIntegral(b, 2)).toBeCloseTo(0.2, 12); // content below shifts down by (S − 1)·length
    expect(1 - backwardY([b], 1)).toBeLessThanOrEqual(HEIGHT_MAX_CROP + 1e-9);
    const tall = heightBand(0.05, 0.95, 1)!;
    expect((tall.S - 1) * (tall.b - tall.a)).toBeLessThanOrEqual(HEIGHT_MAX_CROP + 1e-9);
    expect(backwardY([tall], 0)).toBeCloseTo(0, 9); // the image top stays the image top
    expect(heightBand(0.4, 0.6, 0)).toBeNull();
  });

  it('長腿 S is clamped so the feet stay inside the frame', () => {
    const b = legsBand(0.5, 0.7, 0.95, 1, [])!;
    expect(b.S).toBeLessThan(1.12);
    expect(forwardY([b], 0.95)).toBeCloseTo(1 - FEET_MARGIN, 6);
    const roomy = legsBand(0.45, 0.62, 0.8, 1, [])!;
    expect(roomy.S).toBeCloseTo(1.12, 12);
    expect(legsBand(0.5, 0.7, 0.99, 1, [])).toBeNull(); // feet already at the edge: nothing to stretch
    // with a manual band above, the legs get only what is left
    const hb = heightBand(0.1, 0.3, 1)!;
    const withBand = legsBand(0.45, 0.62, 0.8, 1, [hb])!;
    expect(forwardY([hb, withBand], 0.8)).toBeLessThanOrEqual(1 - FEET_MARGIN + 1e-9);
  });

  it('heightBandStretch matches the band builder, and the overlay lines sit where the stretched rows end', () => {
    for (const [top, bottom, amount] of [
      [0.3, 0.6, 1], // uncapped: 1.15
      [0.2, 0.9, 1], // capped by the 8 % crop limit
      [0.4, 0.7, 0.4],
    ] as const) {
      const S = heightBandStretch({ top, bottom, amount });
      expect(S).toBeCloseTo(heightBand(top, bottom, amount)!.S, 12);
      const shown = bandToDisplay({ top, bottom, amount }, heightBandStretch);
      // the output row of the source band's lower edge (ramps make it a little short of the linear figure)
      expect(Math.abs(forwardY([heightBand(top, bottom, amount)!], bottom) - shown.bottom)).toBeLessThan(0.01);
      const back = displayToBand(shown.top, shown.bottom, amount, heightBandStretch);
      expect(back.bottom).toBeCloseTo(bottom, 6);
    }
    expect(heightBandStretch({ top: 0.2, bottom: 0.9, amount: 1 })).toBeCloseTo(1 + HEIGHT_MAX_CROP / 0.7, 12);
    expect(heightBandStretch({ top: 0.5, bottom: 0.4, amount: 1 })).toBe(1);
    expect(heightBandStretch({ top: 0.4, bottom: 0.5, amount: 0 })).toBe(1);
  });
});
