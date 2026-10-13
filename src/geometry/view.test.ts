import { describe, expect, it } from 'vitest';
import type { Geometry, Rect, Size } from '../types';
import {
  apply,
  applyRatio,
  bandPlane,
  chipTransform,
  clampStraighten,
  cropAspectPx,
  cropConstrain,
  cropFits,
  cropModeLayout,
  cropValid,
  cssTurn,
  eSize,
  eToV,
  eYAt,
  flipView,
  glMat3,
  IDENTITY_GEOMETRY,
  invert,
  isIdentity,
  isMaxFit,
  lockAspect,
  lockFor,
  maxFit,
  minCrop,
  oToE,
  oToV,
  ovalViewBox,
  rotateLeft,
  setStraighten,
  snapCrop,
  transposeLock,
  upQuarter,
  viewSize,
  vToO,
  type Quarter,
  type Vec2,
} from './view';

const O = { width: 1600, height: 1200 };
const THETAS = [-45, -7.3, 0, 12, 45];
const QUARTERS: Quarter[] = [0, 1, 2, 3];

/** mulberry32: a deterministic PRNG for the fuzz cases */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGeometry(r: () => number, theta?: number): Geometry {
  const g: Geometry = {
    flipH: r() < 0.5,
    quarter: QUARTERS[Math.floor(r() * 4)],
    straighten: theta ?? clampStraighten(-45 + 90 * r()),
    crop: { x: r() * 0.5, y: r() * 0.5, w: 0.1 + r() * 0.8, h: 0.1 + r() * 0.8 },
  };
  return cropConstrain(g, O);
}

/** a valid crop exists iff the centred minimum box fits (the valid region is convex and symmetric about the centre) */
function centredMinimumFits(g: Geometry, size: Size): boolean {
  const m = minCrop(g, size);
  return cropFits({ ...g, crop: { x: 0.5 - m.w / 2, y: 0.5 - m.h / 2, w: m.w, h: m.h } }, size);
}

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
const closeG = (a: Geometry, b: Geometry, eps = 1e-9) =>
  a.flipH === b.flipH &&
  a.quarter === b.quarter &&
  Math.abs(a.straighten - b.straighten) <= eps &&
  close([a.crop.x, a.crop.y, a.crop.w, a.crop.h], [b.crop.x, b.crop.y, b.crop.w, b.crop.h], eps);

describe('affines', () => {
  it('vToO ∘ oToV = id within 1e-9 for every flip, quarter and θ, on random crops', () => {
    const r = rng(1);
    for (const flipH of [false, true])
      for (const quarter of QUARTERS)
        for (const theta of THETAS) {
          const g = cropConstrain({ flipH, quarter, straighten: theta, crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 } }, O);
          const fwd = oToV(g, O);
          const back = vToO(g, O);
          for (let i = 0; i < 20; i++) {
            const p = [r(), r()] as const;
            expect(close(apply(back, apply(fwd, p)), p)).toBe(true);
          }
        }
  });

  it('oToV is eToV after oToE', () => {
    const r = rng(2);
    for (let i = 0; i < 50; i++) {
      const g = randomGeometry(r);
      const p = [r(), r()] as const;
      expect(close(apply(oToV(g, O), p), apply(eToV(g, O), apply(oToE(g), p)))).toBe(true);
    }
  });

  it('O → E is the exact permutation of the spec (F, then R1 (1−y, x), R2 (1−x, 1−y), R3 (y, 1−x))', () => {
    const p = [0.2, 0.7] as const;
    expect(apply(oToE({ flipH: false, quarter: 1 }), p)).toEqual([1 - 0.7, 0.2]);
    expect(apply(oToE({ flipH: false, quarter: 2 }), p)).toEqual([1 - 0.2, 1 - 0.7]);
    expect(apply(oToE({ flipH: false, quarter: 3 }), p)).toEqual([0.7, 1 - 0.2]);
    expect(apply(oToE({ flipH: true, quarter: 0 }), p)).toEqual([1 - 0.2, 0.7]);
    expect(eSize({ quarter: 1 }, O)).toEqual({ width: 1200, height: 1600 });
  });

  it('a crop that fits never samples outside O, and a max-fit touches its edge (cropFits and maxFit agree with vToO, the uGeo map)', () => {
    const r = rng(8);
    const corners: Vec2[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    /** how far V's corners land inside O: < 0 is off the image */
    const margin = (g: Geometry) => Math.min(...corners.map((p) => apply(vToO(g, O), p)).map(([x, y]) => Math.min(x, y, 1 - x, 1 - y)));
    let fitting = 0;
    let worst = Infinity;
    for (const flipH of [false, true])
      for (const quarter of QUARTERS)
        for (const theta of [...THETAS, clampStraighten(-45 + 90 * r()), clampStraighten(-45 + 90 * r())]) {
          for (let i = 0; i < 40; i++) {
            const g: Geometry = { flipH, quarter, straighten: theta, crop: { x: r() * 0.6, y: r() * 0.6, w: 0.05 + r() * 0.6, h: 0.05 + r() * 0.6 } };
            if (!cropFits(g, O, 0)) continue;
            fitting++;
            worst = Math.min(worst, margin(g));
          }
          if (theta === 0) continue;
          // for aspects in [1/2, 2] the straightened image, not the E frame, bounds the max-fit at any θ ≠ 0
          const e = eSize({ quarter }, O);
          for (const a of [0.5, 0.75, 1, 4 / 3, 2]) {
            const tight = margin({ flipH, quarter, straighten: theta, crop: maxFit(theta, e.width, e.height, a) });
            expect(tight).toBeGreaterThanOrEqual(-1e-9);
            expect(tight).toBeLessThanOrEqual(1e-6);
          }
        }
    expect(fitting).toBeGreaterThan(500);
    expect(worst).toBeGreaterThanOrEqual(-1e-12);
    // the plane map in closed form: the rotation is in pixels about the E centre (rigid although W ≠ H)
    const full = { ...IDENTITY_GEOMETRY, straighten: 30 };
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    expect(close(apply(eToV(full, O), [0.5 + 100 / 1600, 0.5]), [0.5 + (100 * c) / 1600, 0.5 + (100 * s) / 1200], 1e-12)).toBe(true);
    expect(close(apply(eToV(full, O), [0.5, 0.5 + 100 / 1200]), [0.5 - (100 * s) / 1600, 0.5 + (100 * c) / 1200], 1e-12)).toBe(true);
  });

  it('positive θ turns the picture clockwise on a y-down screen', () => {
    const g: Geometry = { ...IDENTITY_GEOMETRY, straighten: 10 };
    // a content point right of the centre moves down in the view
    const v = apply(oToV(g, { width: 1000, height: 1000 }), [0.9, 0.5]);
    expect(v[1]).toBeGreaterThan(0.5);
  });

  it('identity geometry is the identity map, and glMat3 is column-major', () => {
    expect(isIdentity(IDENTITY_GEOMETRY)).toBe(true);
    expect(apply(vToO(IDENTITY_GEOMETRY, O), [0.3, 0.6])).toEqual([0.3, 0.6]);
    expect(Array.from(glMat3({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }))).toEqual([1, 2, 0, 3, 4, 0, 5, 6, 1]);
    const m = { a: 0.5, b: 0.25, c: -0.3, d: 2, e: 0.1, f: -0.4 };
    expect(close(apply(m, apply(invert(m), [0.4, 0.9])), [0.4, 0.9])).toBe(true);
  });
});

describe('actions', () => {
  it('rotateLeft four times and flipView twice are the identity', () => {
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
      const g = randomGeometry(r);
      expect(closeG(rotateLeft(rotateLeft(rotateLeft(rotateLeft(g)))), g)).toBe(true);
      expect(closeG(flipView(flipView(g)), g)).toBe(true);
    }
  });

  it('flipView ∘ rotateLeft = rotateLeft⁻¹ ∘ flipView', () => {
    const r = rng(4);
    for (let i = 0; i < 100; i++) {
      const g = randomGeometry(r);
      expect(closeG(flipView(rotateLeft(g)), rotateLeft(rotateLeft(rotateLeft(flipView(g)))))).toBe(true);
    }
  });

  it('the view turns 90° counter-clockwise under rotateLeft and mirrors under flipView, content kept inside the crop', () => {
    const r = rng(5);
    for (let i = 0; i < 100; i++) {
      const g = randomGeometry(r);
      const o = apply(vToO(g, O), [0.2 + 0.6 * r(), 0.2 + 0.6 * r()]);
      const v = apply(oToV(g, O), o);
      const vr = apply(oToV(rotateLeft(g), O), o);
      const vf = apply(oToV(flipView(g), O), o);
      expect(close(vr, [v[1], 1 - v[0]], 1e-9)).toBe(true);
      expect(close(vf, [1 - v[0], v[1]], 1e-9)).toBe(true);
      for (const p of [vr, vf]) for (const c of p) expect(c >= 0 && c <= 1).toBe(true);
    }
  });

  it('upQuarter is invariant under flipView and moves by one under rotateLeft', () => {
    for (const flipH of [false, true])
      for (const quarter of QUARTERS) {
        const g = { ...IDENTITY_GEOMETRY, flipH, quarter };
        expect(upQuarter(flipView(g))).toBe(upQuarter(g));
        const d = (upQuarter(rotateLeft(g)) - upQuarter(g) + 4) % 4;
        expect(d === 1 || d === 3).toBe(true);
      }
  });

  it('clampStraighten clamps to ±45, rounds to 0.1 and never returns −0 or NaN', () => {
    expect(clampStraighten(50)).toBe(45);
    expect(clampStraighten(-3.46)).toBe(-3.5);
    expect(Object.is(clampStraighten(-0.04), 0)).toBe(true);
    expect(clampStraighten(Number.NaN)).toBe(0);
  });
});

describe('maxFit and cropConstrain', () => {
  it('maxFit equals the closed form and a brute-force search', () => {
    const r = rng(6);
    for (let i = 0; i < 60; i++) {
      const theta = -45 + 90 * r();
      const a = 0.3 + 3 * r();
      const W = 800 + 1200 * r();
      const H = 800 + 1200 * r();
      const m = maxFit(theta, W, H, a);
      const g: Geometry = { flipH: false, quarter: 0, straighten: theta, crop: m };
      expect(cropFits(g, { width: W, height: H }, 1e-7)).toBe(true);
      expect((m.w * W) / (m.h * H)).toBeCloseTo(a, 6);
      // 0.5 % larger does not fit
      const big = { x: 0.5 - m.w * 0.5025, y: 0.5 - m.h * 0.5025, w: m.w * 1.005, h: m.h * 1.005 };
      expect(cropFits({ ...g, crop: big }, { width: W, height: H })).toBe(false);
    }
  });

  it('maxFit at θ = 0 with the frame aspect is the full frame, exactly', () => {
    expect(maxFit(0, 1600, 1200, 1600 / 1200)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cropConstrain (fuzzed): valid, keeps a feasible aspect, idempotent, and leaves a valid input untouched', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const g: Geometry = {
        flipH: r() < 0.5,
        quarter: QUARTERS[Math.floor(r() * 4)],
        straighten: clampStraighten(-45 + 90 * r()),
        crop: { x: -0.3 + 1.2 * r(), y: -0.3 + 1.2 * r(), w: 0.01 + 1.2 * r(), h: 0.01 + 1.2 * r() },
      };
      const out = cropConstrain(g, O);
      expect(cropValid(out, O, 1e-7)).toBe(true);
      // every aspect in [1/4, 4] has a valid crop in 1600 × 1200 at any θ, so it is kept; a sliver (w = 0.02, h = 1.1:
      // about 1:41) cannot also be 5 % wide and fit, so it falls back to the E frame's own aspect (still valid)
      const a = cropAspectPx(g, O);
      if (a >= 0.25 && a <= 4) expect(cropAspectPx(out, O)).toBeCloseTo(a, 6);
      expect(cropConstrain(out, O)).toBe(out);
    }
    const sliver = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.4, y: 0, w: 0.02, h: 1 } }, O);
    expect(cropValid(sliver, O, 1e-7)).toBe(true);
    const valid = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }, O);
    expect(cropConstrain(valid, O)).toBe(valid);
  });

  it('minimum size: 5 % and 64 working px; a photo under 64 px keeps its full frame', () => {
    expect(minCrop(IDENTITY_GEOMETRY, O)).toEqual({ w: 0.05, h: 64 / 1200 });
    expect(minCrop(IDENTITY_GEOMETRY, { width: 4000, height: 3000 })).toEqual({ w: 0.05, h: 0.05 });
    expect(minCrop(IDENTITY_GEOMETRY, { width: 40, height: 3000 }).w).toBe(1);
    const tiny = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.4, y: 0.4, w: 0.001, h: 0.001 } }, O);
    expect(tiny.crop.w * 1600).toBeGreaterThanOrEqual(64 - 1e-6);
  });

  it('extreme aspects stay finite and valid (Review Focus 4)', () => {
    const panoramas: Size[] = [
      { width: 2048, height: 512 },
      { width: 2048, height: 292 },
      { width: 2048, height: 200 },
      { width: 2048, height: 150 },
    ];
    // no crop is valid: the minimum is the full height (2048 × 1) or the full frame (50 × 40), which cannot fit at θ ≠ 0
    const infeasible: Size[] = [
      { width: 2048, height: 1 },
      { width: 50, height: 40 },
    ];
    for (const size of [...panoramas, ...infeasible]) {
      for (const theta of [0, 10, 20, 30, 45, -45]) {
        const constrained = cropConstrain({ ...IDENTITY_GEOMETRY, straighten: theta, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } }, size);
        const straightened = setStraighten(IDENTITY_GEOMETRY, theta, size);
        for (const g of [constrained, straightened]) {
          for (const v of [g.crop.x, g.crop.y, g.crop.w, g.crop.h]) expect(Number.isFinite(v)).toBe(true);
          expect(g.crop.w).toBeGreaterThan(0);
          expect(g.crop.h).toBeGreaterThan(0);
          expect(cropFits(g, size, 1e-7)).toBe(true);
          expect(centredMinimumFits(g, size)).toBe(panoramas.includes(size) || theta === 0);
          if (centredMinimumFits(g, size)) expect(cropValid(g, size, 1e-7)).toBe(true);
        }
      }
    }
  });

  it('cropConstrain on wide panoramas (fuzzed): valid and idempotent wherever a valid crop exists', () => {
    const r = rng(9);
    for (const size of [{ width: 2048, height: 292 }, { width: 2048, height: 256 }, { width: 2048, height: 200 }, { width: 2048, height: 150 }]) {
      let checked = 0;
      for (let i = 0; i < 500; i++) {
        const g: Geometry = {
          flipH: r() < 0.5,
          quarter: QUARTERS[Math.floor(r() * 4)],
          straighten: clampStraighten(-45 + 90 * r()),
          crop: { x: -0.3 + 1.2 * r(), y: -0.3 + 1.2 * r(), w: 0.01 + 1.2 * r(), h: 0.01 + 1.2 * r() },
        };
        if (!centredMinimumFits(g, size)) continue;
        checked++;
        const out = cropConstrain(g, size);
        expect(cropValid(out, size, 1e-7)).toBe(true);
        expect(cropConstrain(out, size)).toBe(out);
        const turned = setStraighten(out, clampStraighten(-45 + 90 * r()), size);
        expect(cropValid(turned, size, 1e-7)).toBe(true);
      }
      expect(checked).toBeGreaterThan(400);
    }
  });

  it('a wide panorama turned far keeps the widest valid aspect; a ratio no valid crop can have changes nothing', () => {
    const size = { width: 2048, height: 292 };
    // the frame aspect's max-fit at 45° is 51.5 px tall, under the 64 px minimum
    expect(cropValid({ ...IDENTITY_GEOMETRY, straighten: 45, crop: maxFit(45, 2048, 292, 2048 / 292) }, size)).toBe(false);
    const s = setStraighten(IDENTITY_GEOMETRY, 45, size);
    expect(cropValid(s, size, 1e-7)).toBe(true);
    expect(isMaxFit(s, size)).toBe(true);
    expect(s.crop.h * 292).toBeCloseTo(64, 3);
    const a = cropAspectPx(s, size);
    expect(a).toBeLessThan(2048 / 292);
    expect(cropValid({ ...s, crop: maxFit(45, 2048, 292, a * 1.001) }, size)).toBe(false);

    const pano = { width: 2048, height: 150 };
    // 9:16 is at most 84 px wide here (the minimum is 102.4 px)
    expect(applyRatio(IDENTITY_GEOMETRY, '9:16', pano)).toBe(IDENTITY_GEOMETRY);
    for (const theta of [0, 20, 45])
      for (const lock of ['original', '1:1', '3:4', '4:3', '9:16', '16:9'] as const) {
        const g = setStraighten(IDENTITY_GEOMETRY, theta, pano);
        expect(cropValid(applyRatio(g, lock, pano), pano, 1e-7)).toBe(true);
      }
  });

  it('setStraighten: a max-fit crop re-expands at 0°; a hand-shaped crop only shrinks', () => {
    const start = IDENTITY_GEOMETRY;
    expect(isMaxFit(start, O)).toBe(true);
    const tilted = setStraighten(start, 12, O);
    expect(tilted.crop.w).toBeLessThan(1);
    expect(setStraighten(tilted, 0, O).crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(setStraighten(start, 0, O)).toBe(start);

    const hand: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.3, y: 0.3, w: 0.3, h: 0.3 } };
    expect(isMaxFit(hand, O)).toBe(false);
    expect(setStraighten(hand, 5, O).crop).toEqual(hand.crop); // still fits: unchanged
    const far: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0, y: 0, w: 0.6, h: 0.6 } };
    const s = setStraighten(far, 20, O);
    expect(s.crop.w).toBeLessThan(0.6);
    expect(cropValid(s, O, 1e-7)).toBe(true);
  });

  it('拉直 back to 0° from any max-fit tilt is exactly the identity (parity: P2 stays skipped)', () => {
    for (let i = 1; i <= 450; i++) {
      const tilted = setStraighten(IDENTITY_GEOMETRY, i / 10, O);
      expect(isIdentity(setStraighten(tilted, 0, O))).toBe(true);
    }
  });

  it('cropConstrain moves an outside centre along the segment toward the E centre, not onto it (S §3.3 step 1)', () => {
    const out = cropConstrain({ ...IDENTITY_GEOMETRY, crop: { x: 0.9, y: 0.1, w: 0.3, h: 0.2 } }, O);
    const cx = out.crop.x + out.crop.w / 2;
    const cy = out.crop.y + out.crop.h / 2;
    // on the line from the input centre (1.05, 0.2) to the E centre (0.5, 0.5), and still near the input side
    expect((cx - 0.5) * (0.2 - 0.5) - (cy - 0.5) * (1.05 - 0.5)).toBeCloseTo(0, 9);
    expect(cx).toBeGreaterThan(0.8);
    expect(cropValid(out, O, 1e-7)).toBe(true);
  });
});

describe('ratio locks', () => {
  it('applyRatio is the centred max-fit of the lock aspect; 自由 and a matching aspect change nothing', () => {
    const one = applyRatio(IDENTITY_GEOMETRY, '1:1', O);
    expect(cropAspectPx(one, O)).toBeCloseTo(1, 9);
    expect(one.crop.x + one.crop.w / 2).toBeCloseTo(0.5, 12);
    expect(applyRatio(one, '1:1', O)).toBe(one);
    expect(applyRatio(one, 'free', O)).toBe(one);
    expect(applyRatio(IDENTITY_GEOMETRY, 'original', O)).toBe(IDENTITY_GEOMETRY);
  });

  it('lockFor: 自由 uncropped, the matching ratio within 0.5 %, else 自由', () => {
    expect(lockFor(IDENTITY_GEOMETRY, O)).toBe('free');
    expect(lockFor(applyRatio(IDENTITY_GEOMETRY, '9:16', O), O)).toBe('9:16');
    expect(lockFor({ ...IDENTITY_GEOMETRY, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }, O)).toBe('original');
    expect(lockFor({ ...IDENTITY_GEOMETRY, crop: { x: 0, y: 0, w: 0.5, h: 0.31 } }, O)).toBe('free');
  });

  it('transposeLock swaps 3:4 ↔ 4:3 and 9:16 ↔ 16:9 only; original follows the E aspect', () => {
    expect(transposeLock('3:4')).toBe('4:3');
    expect(transposeLock('16:9')).toBe('9:16');
    expect(transposeLock('1:1')).toBe('1:1');
    expect(transposeLock('free')).toBe('free');
    expect(lockAspect('original', { ...IDENTITY_GEOMETRY, quarter: 1 }, O)).toBeCloseTo(1200 / 1600, 12);
  });
});

describe('sizes', () => {
  it('viewSize rounds the crop at that density; snapCrop at θ = 0 gives whole-pixel edges', () => {
    const g: Geometry = { flipH: false, quarter: 1, straighten: 0, crop: { x: 0.1234, y: 0.2345, w: 0.5111, h: 0.4222 } };
    const s = snapCrop(g, O);
    const e = eSize(s, O);
    for (const v of [s.crop.x * e.width, s.crop.y * e.height, (s.crop.x + s.crop.w) * e.width, (s.crop.y + s.crop.h) * e.height]) {
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9);
    }
    expect(viewSize(s, O)).toEqual({ width: Math.round(s.crop.w * 1200), height: Math.round(s.crop.h * 1600) });
    const tilted = { ...g, straighten: 3 };
    expect(snapCrop(tilted, O)).toBe(tilted);
    expect(viewSize(IDENTITY_GEOMETRY, O)).toEqual(O);
  });
});

describe('crop-mode layout and overlays', () => {
  it('odd quarters swap the E box; the canvas box keeps the O aspect, centred on the E box', () => {
    const stage = { width: 393, height: 500 };
    const l = cropModeLayout(stage, O, { ...IDENTITY_GEOMETRY, quarter: 1 });
    expect(l.eBox.w / l.eBox.h).toBeCloseTo(1200 / 1600, 9);
    expect(l.canvas.w / l.canvas.h).toBeCloseTo(1600 / 1200, 9);
    expect(l.canvas.x + l.canvas.w / 2).toBeCloseTo(l.eBox.x + l.eBox.w / 2, 9);
    expect(l.eBox.x).toBeGreaterThanOrEqual(24 - 1e-9);
    expect(cssTurn(l)).toBe('scaleX(1) rotate(90deg)');
    expect(l.cropBox).toEqual(l.eBox);
  });

  it('the turn is unwrapped toward the previous angle, and a flip is a pure mirror', () => {
    const stage = { width: 400, height: 400 };
    const g3 = { ...IDENTITY_GEOMETRY, quarter: 3 as Quarter };
    const prev = cropModeLayout(stage, O, g3, 24, 270);
    const next = cropModeLayout(stage, O, rotateLeft(g3), 24, prev.angle);
    expect(next.angle).toBe(180); // 270 → 180: a 90° counter-clockwise turn, not +270
    const f = cropModeLayout(stage, O, flipView(g3), 24, prev.angle);
    expect(f.sx).toBe(-1);
    expect(f.angle).toBe(prev.angle);
  });

  it('ovalViewBox maps O points to the V bounding box; chips and the band plane follow the geometry', () => {
    const pts = new Float32Array([0.2, 0.2, 0.4, 0.2, 0.4, 0.5, 0.2, 0.5]);
    const box = ovalViewBox(pts, { ...IDENTITY_GEOMETRY, quarter: 1 }, O);
    expect(close([box.x, box.y, box.w, box.h], [0.5, 0.2, 0.3, 0.2], 1e-6)).toBe(true);
    expect(chipTransform({ ...IDENTITY_GEOMETRY, quarter: 3, flipH: true })).toBe('rotate(270deg) scaleX(-1)');
    expect(bandPlane(IDENTITY_GEOMETRY)).toEqual({ left: 0, top: 0, width: 100, height: 100, rotate: 0 });
    const crop: Rect = { x: 0.25, y: 0, w: 0.5, h: 1 };
    expect(bandPlane({ ...IDENTITY_GEOMETRY, straighten: 5, crop })).toEqual({ left: -50, top: 0, width: 200, height: 100, rotate: 5 });
    expect(eYAt(IDENTITY_GEOMETRY, O, [0.3, 0.7])).toBeCloseTo(0.7, 12);
  });
});
