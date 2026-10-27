import { describe, expect, it } from 'vitest';
import {
  AUTO_TIER,
  AutoTier,
  DetectCadence,
  FACE_EASE_MS,
  FaceWeightEaser,
  TimeEma,
  autoTierSample,
  cadenceSample,
  cameraFrameMs,
  detectEvery,
  effectiveEvery,
  frameCost,
  framesBlocked,
  lowerTier,
  nextLowerTier,
  shouldDetect,
  skippedFrames,
} from './liveCore';

describe('TimeEma', () => {
  it('initialises with the first sample', () => {
    const e = new TimeEma(300);
    expect(e.value).toBeNull();
    expect(e.update(42, 0)).toBe(42);
  });

  it('moves 1 − 1/e of the way after one time constant, independent of sample rate', () => {
    const fast = new TimeEma(300);
    const slow = new TimeEma(300);
    fast.update(0, 0);
    slow.update(0, 0);
    for (let t = 0; t < 300; t += 10) fast.update(100, 10); // 30 samples
    slow.update(100, 300); // 1 sample
    const expected = 100 * (1 - Math.exp(-1));
    expect(fast.value).toBeCloseTo(expected, 6);
    expect(slow.value).toBeCloseTo(expected, 6);
  });

  it('ignores non-finite samples and resets', () => {
    const e = new TimeEma(100);
    e.update(10, 0);
    e.update(Number.NaN, 50);
    expect(e.value).toBe(10);
    e.reset();
    expect(e.value).toBeNull();
  });
});

describe('FaceWeightEaser', () => {
  it('reaches 1 after ~150 ms of face, smoothstep-shaped', () => {
    const f = new FaceWeightEaser();
    expect(f.value).toBe(0);
    expect(f.update(true, FACE_EASE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(f.update(true, FACE_EASE_MS / 4)).toBeCloseTo(0.84375, 6); // t = .75
    expect(f.update(true, FACE_EASE_MS / 4)).toBe(1);
    expect(f.update(true, 1000)).toBe(1);
  });

  it('fades out over the same duration and stays continuous on reversal', () => {
    const f = new FaceWeightEaser(150, 1);
    const a = f.update(false, 50);
    expect(a).toBeLessThan(1);
    const b = f.update(true, 0);
    expect(b).toBeCloseTo(a, 9);
    f.update(false, 1000);
    expect(f.value).toBe(0);
  });

  it('is monotonic at 30 fps and never leaves [0,1]', () => {
    const f = new FaceWeightEaser();
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      const v = f.update(true, 33.3);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(prev).toBe(1);
    expect(f.update(true, -50)).toBe(1); // negative dt ignored
  });
});

describe('AutoTier', () => {
  const run = (a: AutoTier, from: number, to: number, cost: number, step = 33) => {
    const hits: number[] = [];
    for (let t = from; t < to; t += step) if (a.sample(t, cost, step)) hits.push(t);
    return hits;
  };

  it('never decides during the 3 s warm-up', () => {
    const a = new AutoTier();
    expect(run(a, 0, AUTO_TIER.warmupMs - 1, 80)).toEqual([]);
  });

  it('steps down after slow frames persist 1.5 s past warm-up', () => {
    const a = new AutoTier();
    const hits = run(a, 0, 6000, 60);
    expect(hits.length).toBeGreaterThan(0);
    const first = hits[0];
    expect(first).toBeGreaterThanOrEqual(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs);
    expect(first).toBeLessThan(AUTO_TIER.warmupMs + AUTO_TIER.sustainMs + 100);
  });

  it('does not step down at or under budget', () => {
    const a = new AutoTier();
    expect(run(a, 0, 20000, 33)).toEqual([]);
    expect(run(a, 20000, 30000, AUTO_TIER.budgetMs)).toEqual([]);
  });

  it('a recovery resets the sustain timer', () => {
    const a = new AutoTier();
    run(a, 0, 3000, 20);
    expect(run(a, 3000, 4200, 70)).toEqual([]); // 1.2 s slow
    expect(run(a, 4200, 5200, 20)).toEqual([]); // EMA recovers
    const hits = run(a, 5200, 8000, 70);
    expect(hits[0]).toBeGreaterThanOrEqual(5200 + AUTO_TIER.sustainMs);
  });

  it('restart() opens a new warm-up window', () => {
    const a = new AutoTier();
    const hits = run(a, 0, 6000, 60);
    expect(hits.length).toBeGreaterThan(0);
    a.restart();
    expect(run(a, 6000, 6000 + AUTO_TIER.warmupMs - 1, 60)).toEqual([]);
    expect(run(a, 9000, 12000, 60).length).toBeGreaterThan(0);
  });

  it('smooths isolated spikes away', () => {
    const a = new AutoTier();
    const hits: number[] = [];
    for (let t = 0, i = 0; t < 15000; t += 33, i++) if (a.sample(t, i % 10 === 0 ? 90 : 25, 33)) hits.push(t);
    expect(hits).toEqual([]);
  });
});

describe('frame scheduling decisions', () => {
  it('nextLowerTier walks H → M → L and stops', () => {
    expect(nextLowerTier('H')).toBe('M');
    expect(nextLowerTier('M')).toBe('L');
    expect(nextLowerTier('L')).toBeNull();
  });

  it('shouldDetect: every frame on H/M, every second frame on L', () => {
    expect(shouldDetect('H', true)).toBe(true);
    expect(shouldDetect('M', true)).toBe(true);
    let last = false;
    const seq: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      last = shouldDetect('L', last);
      seq.push(last);
    }
    expect(seq).toEqual([true, false, true, false, true, false]);
  });

  it('skippedFrames from presentedFrames deltas', () => {
    expect(skippedFrames(null, 5)).toBe(0);
    expect(skippedFrames(6, null)).toBe(0);
    expect(skippedFrames(6, 5)).toBe(0);
    expect(skippedFrames(8, 5)).toBe(2);
    expect(skippedFrames(5, 9)).toBe(0); // counter reset on a new stream
  });

  it('cameraFrameMs: the frames’ own timestamps over the frames presented (§6.4’s T, round-1 review C16)', () => {
    expect(cameraFrameMs(1.055, 1, 11, 10)).toBeCloseTo(55, 9); // a low-light camera, one frame
    expect(cameraFrameMs(1.1, 1, 13, 10)).toBeCloseTo(33.33, 2); // a detection blocked two callbacks: still one frame's
    expect(cameraFrameMs(null, 1, 11, 10)).toBeNull(); // the rAF fallback
    expect(cameraFrameMs(1.03, 1, null, 10)).toBeNull();
    expect(cameraFrameMs(1, 1, 11, 10)).toBeNull(); // timestamps that do not advance
    expect(cameraFrameMs(1.03, 1, 10, 10)).toBeNull(); // no frame presented
    expect(cameraFrameMs(1.03, 1, 3, 10)).toBeNull(); // a counter reset
    expect(cameraFrameMs(3, 1, 11, 10)).toBeNull(); // a jump (a seek, a new stream)
  });

  it('frameCost charges work, or the interval once frames were dropped', () => {
    expect(frameCost(20, 66, 0)).toBe(20); // slow camera, fast pipeline → not our problem
    expect(frameCost(36, 66, 1)).toBe(66); // we missed a frame
    expect(frameCost(50, 33, 1)).toBe(50);
    expect(frameCost(12, null, 3)).toBe(12);
  });
});

describe('detection cadence (camera per-person spec §6.4, K6)', () => {
  const T = 1000 / 30;
  it('detectEvery: k = clamp(⌈(D + R − T) / (T_min − T)⌉, 1, 6), T_min = max(1000 / 24, 1.25 T)', () => {
    expect(detectEvery(30, 5, T)).toBe(1);   // front, 3 faces
    expect(detectEvery(64, 5, T)).toBe(5);   // back, 10 faces, GPU
    expect(detectEvery(82, 5, T)).toBe(6);   // CPU (7, clamped)
    expect(detectEvery(5, 3, T)).toBe(1);
    expect(detectEvery(64, 5, 66.7)).toBe(1);  // a 15 fps camera: T_min = 1.25 T
    expect(detectEvery(120, 5, 66.7)).toBe(4);
  });
  it('DetectCadence: a rising k applies after 500 ms, a falling one after 1500 ms; reset → 1', () => {
    const c = new DetectCadence();
    expect(c.update(0, 64, 5, T)).toBe(1);
    expect(c.update(499, 64, 5, T)).toBe(1);
    expect(c.update(500, 64, 5, T)).toBe(5);
    expect(c.update(600, 20, 5, T)).toBe(5);
    expect(c.update(2099, 20, 5, T)).toBe(5);
    expect(c.update(2100, 20, 5, T)).toBe(1);
    expect(c.update(2200, null, null, T)).toBe(1);
    c.update(2300, 64, 5, T);
    c.update(2800, 64, 5, T);
    c.reset();
    expect(c.k).toBe(1);
  });
  it('effectiveEvery: one face or none → every frame (tier L: every second, as v0.5); ≥ 2 faces → max(k, tier L ? 2 : 1)', () => {
    expect([effectiveEvery(4, 'H', 1), effectiveEvery(4, 'H', 0), effectiveEvery(4, 'L', 1)]).toEqual([1, 1, 2]);
    expect([effectiveEvery(5, 'L', 2), effectiveEvery(1, 'L', 2), effectiveEvery(1, 'M', 3)]).toEqual([5, 2, 1]);
  });
  it('the auto-tier sample of a detecting frame at k > 1 is R + D / k', () => {
    expect(cadenceSample(5, 64, 5)).toBeCloseTo(17.8, 6);
    expect(cadenceSample(5, 64, 1)).toBe(69);
  });
  it('framesBlocked: the frames presented in the span the detection added to its callback, from the frame’s own presentation (C3, round-2 review D3)', () => {
    // a callback on its frame's presentation, a 45 ms detection and a 1 ms render: the frame at 33 ms passes, not 67
    expect(framesBlocked(45, 46, T)).toBe(1);
    // the same callback 25 ms after its frame's presentation (a device's latency): 67 ms passes too
    expect(framesBlocked(45, 71, T)).toBe(2);
    expect(framesBlocked(111, 112, T)).toBe(3);
    expect(framesBlocked(111, 136, T)).toBe(4);
    // a 40 ms render passes a frame by itself, which is the render's (frameCost charges it), not the detection's
    expect(framesBlocked(30, 75, T)).toBe(1);
    // no presentation time, or one after the detection began (another clock): the most any latency gives, ⌈D / T⌉
    expect([framesBlocked(45, null, T), framesBlocked(111, null, T), framesBlocked(45, 30, T), framesBlocked(45, Number.NaN, T)]).toEqual([2, 4, 2, 2]);
    // whatever the latency, ⌊D / T⌋ or ⌈D / T⌉: never more than the round-1 bound
    for (let e = 111; e < 111 + 3 * T; e += 0.7) expect([3, 4]).toContain(framesBlocked(111, e, T));
    expect([framesBlocked(0, 46, T), framesBlocked(50, 60, 0), framesBlocked(Number.NaN, 46, T)]).toEqual([0, 0, 0]);
  });
  it('autoTierSample: the frames the last amortized detection blocked are forgiven and taken out of the interval and its weight; every other drop is charged (D3)', () => {
    const t = 33;
    // nothing blocked: frameCost on the interval, weighted by it (a detecting frame's own drops came before it ran)
    expect(autoTierSample(1, 33, 0, 0, t)).toEqual({ cost: 1, dtMs: 33 });
    expect(autoTierSample(23.5, 66, 1, 0, t)).toEqual({ cost: 66, dtMs: 66 });
    // the frame after a detection that blocked 3: dropped 3, nothing charged, weighted by its own frame only (C3)
    expect(autoTierSample(1, 132, 3, 3, t)).toEqual({ cost: 1, dtMs: 33 });
    // one frame more (GPU back-pressure): charged as any frame that dropped one (round-2 review D3)
    expect(autoTierSample(1, 165, 4, 3, t)).toEqual({ cost: 66, dtMs: 66 });
    // rVFC's own order, the callback after the work on the newest frame presented during it: dropped fewer than blocked
    expect(autoTierSample(1, 99, 2, 3, t)).toEqual({ cost: 1, dtMs: 33 });
    expect(autoTierSample(1, 20, 2, 2, t)).toEqual({ cost: 1, dtMs: 0 });
  });
  it('lowerTier: L < M < H', () => {
    expect([lowerTier('H', 'M'), lowerTier('M', 'H'), lowerTier('L', 'M'), lowerTier('M', 'L'), lowerTier('H', 'H')]).toEqual(['M', 'M', 'L', 'L', 'H']);
  });
});
