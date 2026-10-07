import { describe, expect, it } from 'vitest';
import { applyPreset, setFilter, setParam } from './params';
import {
  maskBufferSize,
  meanBufferSize,
  meanScale,
  meanStep,
  meanTapPixels,
  MEAN_TAP_OFFSETS,
  MEAN_WEIGHTS,
  needsMean,
  presentScale,
  processingSize,
  sharpenTexel,
  skinUniforms,
} from './uniforms';

describe('processingSize', () => {
  it('caps the short edge per tier for a 1080p landscape video', () => {
    expect(processingSize(1920, 1080, 'H', false)).toEqual({ width: 1920, height: 1080 });
    expect(processingSize(1920, 1080, 'M', false)).toEqual({ width: 1280, height: 720 });
    expect(processingSize(1920, 1080, 'L', false)).toEqual({ width: 960, height: 540 });
  });

  it('handles portrait sources and never upscales', () => {
    expect(processingSize(1080, 1920, 'M', false)).toEqual({ width: 720, height: 1280 });
    expect(processingSize(640, 480, 'H', false)).toEqual({ width: 640, height: 480 });
    expect(processingSize(1000, 1500, 'L', false)).toEqual({ width: 540, height: 810 });
  });

  it('uses the exact source size for stills regardless of tier', () => {
    expect(processingSize(1001, 1501, 'L', true)).toEqual({ width: 1001, height: 1501 });
  });

  it('respects the GL size limit on the long edge', () => {
    expect(processingSize(8000, 4000, 'H', true, 4096)).toEqual({ width: 4096, height: 2048 });
  });
});

describe('buffer sizes', () => {
  it('halves the mean only when asked (tier L live)', () => {
    expect(meanBufferSize({ width: 960, height: 540 }, true)).toEqual({ width: 480, height: 270 });
    expect(meanBufferSize({ width: 960, height: 540 }, false)).toEqual({ width: 960, height: 540 });
  });

  it('mask is a quarter per axis, rounded up', () => {
    expect(maskBufferSize({ width: 1080, height: 1920 })).toEqual({ width: 270, height: 480 });
    expect(maskBufferSize({ width: 1001, height: 3 })).toEqual({ width: 251, height: 1 });
  });
});

describe('mean kernel', () => {
  it('matches GPUPixel radius-4 box weights (sum to 1)', () => {
    expect(MEAN_TAP_OFFSETS).toEqual([1.5, 3.5]);
    expect(MEAN_WEIGHTS.center + 4 * MEAN_WEIGHTS.side).toBeCloseTo(1, 12);
  });

  it('is {0, ±6, ±14} px at the 720 reference and scales with the short edge', () => {
    expect(meanTapPixels({ width: 1280, height: 720 })).toEqual([0, 6, -6, 14, -14]);
    expect(meanTapPixels({ width: 1080, height: 1920 })).toEqual([0, 9, -9, 21, -21]);
    expect(meanScale({ width: 960, height: 540 })).toBeCloseTo(0.75, 12);
  });

  it('steps in UV of the processing size along one axis', () => {
    const [hx, hy] = meanStep({ width: 1280, height: 720 }, 'h');
    expect(hx).toBeCloseTo(4 / 1280, 12);
    expect(hy).toBe(0);
    const [vx, vy] = meanStep({ width: 1280, height: 720 }, 'v');
    expect(vx).toBe(0);
    expect(vy).toBeCloseTo(4 / 720, 12);
    // tier L: same image footprint (4·0.75 px per unit at 540 short edge)
    expect(meanStep({ width: 960, height: 540 }, 'h')[0]).toBeCloseTo(3 / 960, 12);
  });
});

describe('sharpen taps', () => {
  it("are GPUPixel's 1 px at the 720 reference", () => {
    const [x, y] = sharpenTexel({ width: 1280, height: 720 });
    expect(x).toBeCloseTo(1 / 1280, 12);
    expect(y).toBeCloseTo(1 / 720, 12);
  });

  it('cover the same image footprint at every tier and at full-res capture (landscape and portrait)', () => {
    for (const sizes of [
      [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 960, height: 540 }],
      [{ width: 1080, height: 1920 }, { width: 720, height: 1280 }, { width: 540, height: 960 }],
    ]) {
      const [ref, ...rest] = sizes.map(sharpenTexel);
      for (const t of rest) {
        expect(t[0]).toBeCloseTo(ref[0], 12);
        expect(t[1]).toBeCloseTo(ref[1], 12);
      }
    }
    // no clamp: a 640×480 fallback camera gets sub-pixel taps, like the mean
    expect(sharpenTexel({ width: 640, height: 480 })[0] * 640).toBeCloseTo(480 / 720, 12);
  });
});

describe('skinUniforms (RB §5 engine mapping)', () => {
  it('maps the 自然 preset', () => {
    const u = skinUniforms(applyPreset('natural'), true);
    expect(u.smooth).toBeCloseTo(0.55, 12);
    expect(u.whiten).toBeCloseTo(0.125, 12); // 0.5·v
    expect(u.sharpen).toBeCloseTo(0.4, 12); // 2·v
    expect(u.rosy).toBeCloseTo(0.35 * 0.25, 12);
    expect(u.filterAmount).toBe(0); // filterId 'none'
  });

  it('原圖 is all-zero (identity composite)', () => {
    const u = skinUniforms(applyPreset('original'), true);
    expect(u).toEqual({ smooth: 0, sharpen: 0, whiten: 0, rosy: 0, filterAmount: 0 });
    expect(needsMean(u)).toBe(false);
  });

  it('applies the filter amount only when the LUT is available', () => {
    const p = setFilter(applyPreset('natural'), 'warm');
    expect(skinUniforms(p, true).filterAmount).toBeCloseTo(0.5, 12);
    expect(skinUniforms(p, false).filterAmount).toBe(0);
  });

  it('caps at the documented maxima', () => {
    let p = applyPreset('original');
    for (const id of ['skin.smooth', 'skin.whiten', 'skin.rosy', 'skin.sharpen'] as const) p = setParam(p, id, 1);
    expect(skinUniforms(p, true)).toMatchObject({ smooth: 1, whiten: 0.5, sharpen: 2, rosy: 0.35 });
  });

  it('needs the mean for smoothing or rosy only', () => {
    expect(needsMean({ smooth: 0, sharpen: 1, whiten: 0.5, rosy: 0, filterAmount: 1 })).toBe(false);
    expect(needsMean({ smooth: 0, sharpen: 0, whiten: 0, rosy: 0.1, filterAmount: 0 })).toBe(true);
  });
});

describe('presentScale', () => {
  it('flips Y for the canvas and mirrors X on request', () => {
    expect(presentScale(true, false)).toEqual([1, -1]);
    expect(presentScale(true, true)).toEqual([-1, -1]);
    expect(presentScale(false, true)).toEqual([-1, 1]);
  });
});
