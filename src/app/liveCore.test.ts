import { describe, expect, it } from 'vitest';
import {
  AUTO_TIER,
  AutoTier,
  FACE_EASE_MS,
  FaceWeightEaser,
  TimeEma,
  frameCost,
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

  it('frameCost charges work, or the interval once frames were dropped', () => {
    expect(frameCost(20, 66, 0)).toBe(20); // slow camera, fast pipeline → not our problem
    expect(frameCost(36, 66, 1)).toBe(66); // we missed a frame
    expect(frameCost(50, 33, 1)).toBe(50);
    expect(frameCost(12, null, 3)).toBe(12);
  });
});
