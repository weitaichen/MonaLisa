import { describe, expect, it, vi } from 'vitest';
import type { BodyDetections, BodyField, Face, Landmarks478, PersonMask, Tracker } from '../types';
import { bodiesUToO, faceOToU, fieldUToO, inverseQuarter, landmarksUToO, maskOToU, maskUToO, pointsOToU, poseOToU, poseUToO, upCanvas, upTracker } from './upFrame';
import { apply, quarterAffine, type Quarter } from './view';

const Q: Quarter[] = [0, 1, 2, 3];

describe('U ↔ O permutations (C §3.5, S §3.4)', () => {
  /** float32 storage: a round trip through 1 − x may move a value by one or two float32 ulps */
  const near = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.from(a).every((v, i) => Math.abs(v - b[i]) < 1e-6);

  it('points go O → U → O; landmarks keep z exactly', () => {
    const p = new Float32Array([0.1, 0.2, 0.33, 0.7, 0.4, -0.5]);
    for (const q of Q) {
      expect(near(landmarksUToO(pointsOToU(p, 3, q), q), p)).toBe(true);
      const u = pointsOToU(p, 3, q);
      expect(u[2]).toBe(p[2]);
      expect([u[0], u[1]]).toEqual(apply(quarterAffine(q), [p[0], p[1]]).map((v) => Math.fround(v)));
    }
    expect(inverseQuarter(1)).toBe(3);
    expect(landmarksUToO(p, 0)).toBe(p);
  });

  it('poses keep z and visibility', () => {
    const pose = { points: new Float32Array(33 * 4).map((_, i) => (i % 4 === 3 ? 0.9 : (i % 7) / 10)) };
    for (const q of Q) {
      const back = poseUToO(poseOToU(pose, q), q);
      expect(near(back.points, pose.points)).toBe(true);
      for (let i = 3; i < 132; i += 4) expect(back.points[i]).toBe(pose.points[i]);
    }
  });

  it('masks are exact texel permutations with swapped sides for odd quarters', () => {
    const m: PersonMask = { width: 3, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    const u1 = maskOToU(m, 1);
    expect([u1.width, u1.height]).toEqual([2, 3]);
    // R1 (x, y) → (1 − y, x): the O bottom-left texel (value 4) becomes the U top-left
    expect(Array.from(u1.data)).toEqual([4, 1, 5, 2, 6, 3]);
    for (const q of Q) expect(Array.from(maskUToO(maskOToU(m, q), q).data)).toEqual(Array.from(m.data));
  });

  it('a U field becomes the O field of the same backward map: o + D_O(o) = R⁻¹(u + D_U(u))', () => {
    const w = 4;
    const h = 3;
    const data = new Float32Array(w * h * 2);
    for (let i = 0; i < w * h; i++) {
      data[i * 2] = 0.01 * (i + 1);
      data[i * 2 + 1] = -0.02 * (i % 3);
    }
    const fu: BodyField = { width: w, height: h, data, version: 3 };
    for (const q of Q) {
      const fo = fieldUToO(fu, q);
      const toU = quarterAffine(q);
      const toO = quarterAffine(inverseQuarter(q));
      for (let y = 0; y < fo.height; y++)
        for (let x = 0; x < fo.width; x++) {
          const o: [number, number] = [(x + 0.5) / fo.width, (y + 0.5) / fo.height];
          const u = apply(toU, o);
          const ui = Math.round(u[0] * w - 0.5);
          const uj = Math.round(u[1] * h - 0.5);
          const du = [data[(uj * w + ui) * 2], data[(uj * w + ui) * 2 + 1]];
          const want = apply(toO, [u[0] + du[0], u[1] + du[1]]);
          const d = [fo.data[(y * fo.width + x) * 2], fo.data[(y * fo.width + x) * 2 + 1]];
          expect(o[0] + d[0]).toBeCloseTo(want[0], 6);
          expect(o[1] + d[1]).toBeCloseTo(want[1], 6);
        }
    }
  });

  it('a body detection run on the U image comes back to O: poses, masks and the reported size', () => {
    const pose = { points: new Float32Array(33 * 4).map((_, i) => (i % 4 === 3 ? 0.8 : ((i * 3) % 10) / 10)) };
    const mask: PersonMask = { width: 3, height: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    const o: BodyDetections = { bodies: [{ pose, mask, score: 0.4 }, { pose, mask: null, score: 0.2 }], width: 300, height: 200 };
    expect(bodiesUToO(o, 0)).toBe(o);
    for (const q of [1, 2, 3] as const) {
      const u: BodyDetections = {
        bodies: o.bodies.map((b) => ({ ...b, pose: poseOToU(b.pose, q), mask: b.mask && maskOToU(b.mask, q) })),
        width: q % 2 ? 200 : 300,
        height: q % 2 ? 300 : 200,
      };
      const back = bodiesUToO(u, q);
      expect([back.width, back.height]).toEqual([300, 200]);
      expect(near(back.bodies[0].pose.points, pose.points)).toBe(true);
      expect(Array.from(back.bodies[0].mask!.data)).toEqual(Array.from(mask.data));
      expect(back.bodies[1].mask).toBeNull();
      expect(back.bodies.map((b) => b.score)).toEqual([0.4, 0.2]);
    }
  });

  it('a face goes to U point by point (pts111, ext, oval, iris, lids); the yaw is kept', () => {
    const pairs = (n: number, x: number, y: number) => Float32Array.from({ length: n }, (_, i) => (i % 2 === 0 ? x : y));
    const f: Face = {
      pts111: new Float32Array(222).fill(0.25),
      ext: new Float32Array(16).fill(0.5),
      oval: new Float32Array(72).fill(0.75),
      yaw: 0.3,
      iris: pairs(20, 0.125, 0.375),
      lids: pairs(64, 0.625, 0.875),
    };
    expect(faceOToU(f, 0)).toBe(f);
    const u = faceOToU(f, 1);
    // R1 (x, y) → (1 − y, x)
    expect([u.pts111[0], u.pts111[1]]).toEqual([0.75, 0.25]);
    expect([u.oval[0], u.oval[1]]).toEqual([0.25, 0.75]);
    expect(Array.from(u.iris)).toEqual(Array.from(pairs(20, 0.625, 0.125)));
    expect(Array.from(u.lids)).toEqual(Array.from(pairs(64, 0.125, 0.625)));
    expect(f.iris[0]).toBe(0.125); // the O face is untouched
    expect(u.yaw).toBe(0.3);
    expect(f.pts111[0]).toBe(0.25); // the O face is untouched
  });
});

describe('the U image (DOM half, a recording 2D context)', () => {
  /** document.createElement('canvas') → a canvas whose 2D context records the transform drawImage ran under */
  function stubCanvas() {
    const rec: { t: number[] | null; drawn: unknown[]; canvases: { width: number; height: number }[] } = { t: null, drawn: [], canvases: [] };
    const ctx = {
      imageSmoothingEnabled: true,
      setTransform: (...t: number[]) => {
        rec.t = t;
      },
      drawImage: (img: unknown) => {
        rec.drawn.push(img);
      },
    };
    vi.stubGlobal('document', {
      createElement: () => {
        const c = { width: 0, height: 0, getContext: () => ctx };
        rec.canvases.push(c);
        return c;
      },
    });
    return { rec, ctx };
  }

  it('upCanvas puts every O texel where maskOToU (the exact permutation) puts it, smoothing off', () => {
    const { rec, ctx } = stubCanvas();
    try {
      const w = 3;
      const h = 2;
      const src = { width: w, height: h } as unknown as CanvasImageSource & { width: number; height: number };
      const ids: PersonMask = { width: w, height: h, data: Uint8Array.from({ length: w * h }, (_, i) => i) };
      for (const q of [1, 2, 3] as const) {
        rec.t = null;
        const c = upCanvas(src, q);
        expect([c.width, c.height]).toEqual(q % 2 ? [h, w] : [w, h]);
        expect(ctx.imageSmoothingEnabled).toBe(false);
        expect(rec.drawn.at(-1)).toBe(src);
        const [a, b, cc, d, e, f] = rec.t!;
        const m = maskOToU(ids, q);
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            // the destination texel centre of the source texel centre (x + ½, y + ½)
            const X = a * (x + 0.5) + cc * (y + 0.5) + e - 0.5;
            const Y = b * (x + 0.5) + d * (y + 0.5) + f - 0.5;
            expect(m.data[Math.round(Y) * m.width + Math.round(X)]).toBe(y * w + x);
          }
      }
      rec.t = null;
      upCanvas(src, 0);
      expect(rec.t).toBeNull(); // q = 0: a plain copy
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('upTracker detects on the U canvas, answers in O and releases the canvas; q = 0 is the tracker itself', () => {
    const { rec } = stubCanvas();
    try {
      const inU = new Float32Array(478 * 3).map((_, i) => (i % 3 === 2 ? -0.1 : ((i * 7) % 10) / 10));
      const seen: unknown[] = [];
      const t: Tracker = {
        delegate: 'CPU',
        photoDetector: 'short-range',
        detectVideo: () => null,
        detectImage: (image, opts) => {
          seen.push(image, opts.maxFaces);
          return [{ points: inU } satisfies Landmarks478];
        },
        detectView: () => null,
        warm() {},
        close: vi.fn(),
      };
      expect(upTracker(t, 0)).toBe(t);
      const u = upTracker(t, 3);
      const bitmap = { width: 300, height: 200 } as unknown as ImageBitmap;
      const out = u.detectImage(bitmap, { maxFaces: 4 });
      expect(seen[0]).toBe(rec.canvases[0]);
      expect(seen[1]).toBe(4);
      expect(rec.canvases[0]).toMatchObject({ width: 0, height: 0 }); // released after the detection
      expect(Array.from(out[0].points)).toEqual(Array.from(landmarksUToO(inU, 3)));
      expect(u.delegate).toBe('CPU');
      u.close();
      expect(t.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('upTracker forwards the detector choice (step-1 spec §6.5) and the photo detector, so a sideways scan retries like an upright one', () => {
    const { rec } = stubCanvas();
    try {
      const seen: unknown[] = [];
      const t: Tracker = {
        delegate: 'GPU',
        photoDetector: 'full-range',
        detectVideo: () => null,
        detectImage: (_image, opts) => {
          seen.push(opts);
          return [];
        },
        detectView: () => null,
        warm() {},
        close: vi.fn(),
      };
      const u = upTracker(t, 1);
      expect(u.photoDetector).toBe('full-range');
      u.detectImage({ width: 300, height: 200 } as unknown as ImageBitmap, { maxFaces: 12, detector: 'camera' });
      expect(seen).toEqual([{ maxFaces: 12, detector: 'camera' }]);
      expect(rec.canvases[0]).toMatchObject({ width: 0, height: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('upTracker forwards detectView and warm to the tracker as they are (the live path, which never runs sideways)', () => {
    const view = { width: 720, height: 720 } as unknown as OffscreenCanvas;
    const answer = [{ points: new Float32Array(478 * 3) } satisfies Landmarks478];
    const t: Tracker = {
      delegate: 'GPU',
      photoDetector: 'full-range',
      detectVideo: () => null,
      detectImage: () => [],
      detectView: vi.fn(() => answer),
      warm: vi.fn(),
      close: vi.fn(),
    };
    const u = upTracker(t, 2);
    expect(u.detectView(view, { maxFaces: 12, detector: 'photo' })).toBe(answer);
    expect(t.detectView).toHaveBeenCalledWith(view, { maxFaces: 12, detector: 'photo' });
    u.warm('IMAGE', 'photo');
    expect(t.warm).toHaveBeenCalledWith('IMAGE', 'photo');
  });
});
