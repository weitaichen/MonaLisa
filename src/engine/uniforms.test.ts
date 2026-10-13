import { describe, expect, it } from 'vitest';
import { splitLegacy } from '../edit/legacy';
import { frameFor } from './adjustMath';
import { applyPreset, setFilter, setParam } from './params';
import {
  adjustFrameFor,
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
  skinMaxima,
  skinUniformsFor,
  type SkinUniforms,
} from './uniforms';
import type { BeautyParams } from '../types';

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
      // a lambda, not map(sharpenTexel): map's index would land in the optional fullShortEdge (step 3)
      const [ref, ...rest] = sizes.map((s) => sharpenTexel(s));
      for (const t of rest) {
        expect(t[0]).toBeCloseTo(ref[0], 12);
        expect(t[1]).toBeCloseTo(ref[1], 12);
      }
    }
    // no clamp: a 640×480 fallback camera gets sub-pixel taps, like the mean
    expect(sharpenTexel({ width: 640, height: 480 })[0] * 640).toBeCloseTo(480 / 720, 12);
  });
});

/** the composite uniforms of one face drawn with `p` (its person and photo parts), as engine/index.ts job() builds them */
function oneFace(p: BeautyParams, filterAvailable: boolean): SkinUniforms {
  const { photo, person } = splitLegacy(p);
  const m = skinMaxima([{ weight: 1, smooth: person.values['skin.smooth'], rosy: person.values['skin.rosy'] }], null);
  return skinUniformsFor(photo, m.S, m.R, filterAvailable);
}

describe('skin uniforms of one face (RB §5 engine mapping: skinMaxima → skinUniformsFor)', () => {
  it('maps the 自然 preset', () => {
    const u = oneFace(applyPreset('natural'), true);
    expect(u.smooth).toBeCloseTo(0.55, 12);
    expect(u.whiten).toBeCloseTo(0.125, 12); // 0.5·v
    expect(u.sharpen).toBeCloseTo(0.4, 12); // 2·v
    expect(u.rosy).toBeCloseTo(0.35 * 0.25, 12);
    expect(u.filterAmount).toBe(0); // filterId 'none'
  });

  it('原圖 is all-zero (identity composite)', () => {
    const u = oneFace(applyPreset('original'), true);
    expect(u).toEqual({ smooth: 0, sharpen: 0, whiten: 0, rosy: 0, filterAmount: 0 });
    expect(needsMean(u)).toBe(false);
  });

  it('applies the filter amount only when the LUT is available', () => {
    const p = setFilter(applyPreset('natural'), 'warm');
    expect(oneFace(p, true).filterAmount).toBeCloseTo(0.5, 12);
    expect(oneFace(p, false).filterAmount).toBe(0);
  });

  it('caps at the documented maxima', () => {
    let p = applyPreset('original');
    for (const id of ['skin.smooth', 'skin.whiten', 'skin.rosy', 'skin.sharpen'] as const) p = setParam(p, id, 1);
    expect(oneFace(p, true)).toMatchObject({ smooth: 1, whiten: 0.5, sharpen: 2, rosy: 0.35 });
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

describe('skinMaxima (S §4.1 item 2, §4.2 clear)', () => {
  it('one editor face: S, R = its own; k = 1; clear 0 (bit-equal to v0.3)', () => {
    expect(skinMaxima([{ weight: 1, smooth: 0.55, rosy: 0.25 }], null)).toEqual({ S: 0.55, R: 0.35 * 0.25, k: [[1, 1]], clear: [0, 0] });
  });
  it('a camera fade: the global skin (same person) clears to 1 − w, the face writes w', () => {
    const m = skinMaxima([{ weight: 0.3, smooth: 0.6, rosy: 0.4 }], { smooth: 0.6, rosy: 0.4, weight: 0.7 });
    expect(m.k).toEqual([[1, 1]]);
    expect(m.clear[0]).toBeCloseTo(0.7);
    expect(m.clear[1]).toBeCloseTo(0.7);
  });
  it('two faces: the maxima and relative strengths; a weight-0 face is listed but sets no maximum', () => {
    const m = skinMaxima([{ weight: 1, smooth: 0.8, rosy: 0 }, { weight: 1, smooth: 0.4, rosy: 0.5 }, { weight: 0, smooth: 1, rosy: 1 }], null);
    expect(m.S).toBe(0.8);
    expect(m.k[1]).toEqual([0.5, 1]);
    expect(m.k[0][1]).toBe(0);
  });
});

describe('kernels scale with fullShortEdge (step 3)', () => {
  it("equal today's values when fullShortEdge = min(size)", () => {
    for (const s of [{ width: 2048, height: 1536 }, { width: 1001, height: 1501 }, { width: 720, height: 1280 }]) {
      const m = Math.min(s.width, s.height);
      expect(meanStep(s, 'h', m)).toEqual(meanStep(s, 'h'));
      expect(meanStep(s, 'v', m)).toEqual(meanStep(s, 'v'));
      expect(sharpenTexel(s, m)).toEqual(sharpenTexel(s));
    }
  });

  it('a tile buffer uses the O short edge in output pixels, not its own size', () => {
    const tile = { width: 1088, height: 1152 };
    const [ux] = meanStep(tile, 'h', 3072);
    const [, uy] = meanStep(tile, 'v', 3072);
    expect(ux * tile.width).toBeCloseTo((4 * 3072) / 720, 9);
    expect(uy * tile.height).toBeCloseTo((4 * 3072) / 720, 9);
    const [kx, ky] = sharpenTexel(tile, 3072);
    expect(kx * tile.width).toBeCloseTo(3072 / 720, 9);
    expect(ky * tile.height).toBeCloseTo(3072 / 720, 9);
  });
});

describe('adjustFrameFor (the composite V frame of 暗角 and 顆粒, S §4.2 P5)', () => {
  it('without a tile it is step 2 frameFor, with the O short edge of the photo', () => {
    expect(adjustFrameFor({}, { width: 2048, height: 1536 }, 1536)).toEqual(frameFor({ width: 2048, height: 1536 }));
    // a crop preview: V buffer 1024 × 1536 at working density, the photo's short edge stays 1536
    expect(adjustFrameFor({}, { width: 1024, height: 1536 }, 1536)).toEqual({ ...frameFor({ width: 1024, height: 1536 }), fullShortEdge: 1536 });
    const cam = { x: 0.2, y: 0, w: 0.6, h: 1 };
    expect(adjustFrameFor({ pictureFrame: cam, grainSeed: 9 }, { width: 1280, height: 720 }, 720)).toEqual(frameFor({ width: 1280, height: 720 }, cam, 9));
  });

  it('a tile maps buffer uv into the whole V; vSize is the whole V in output pixels', () => {
    const f = adjustFrameFor({ output: { tile: { x: 0.25, y: 0.5, w: 0.25, h: 0.25 }, pixelSize: { width: 1024, height: 768 }, fullShortEdge: 3072 } }, { width: 1024, height: 768 }, 3072);
    expect(f).toEqual({ vMap: [0.25, 0.25, 0.25, 0.5], vSize: [4096, 3072], fullShortEdge: 3072, seed: 0 });
  });
});
