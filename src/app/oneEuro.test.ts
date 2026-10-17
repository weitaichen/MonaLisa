import { describe, expect, it } from 'vitest';
import { LandmarkSmoother, OneEuro } from './oneEuro';

describe('OneEuro (MediaPipe one_euro_filter.cc, S §3.4 T4)', () => {
  it('a constant input is returned unchanged from the first sample on', () => {
    const f = new OneEuro();
    // α·v + (1 − α)·v may round off v by an ulp: compare to 9 decimals
    for (let i = 0; i < 30; i++) expect(f.apply(123.5, i * 33, 1 / 200)).toBeCloseTo(123.5, 9);
  });
  it('a step converges', () => {
    const f = new OneEuro();
    f.apply(0, 0, 1 / 200);
    let y = 0;
    for (let i = 1; i <= 90; i++) y = f.apply(100, i * 33.3, 1 / 200);
    expect(y).toBeCloseTo(100, 2);
  });
  it('lags ≤ 10 ms at one face size per second (30 fps)', () => {
    const size = 200;
    const f = new OneEuro();
    let lagMs = Infinity;
    for (let i = 0; i <= 60; i++) {
      const t = i * 33.3;
      const x = (size * t) / 1000;
      const y = f.apply(x, t, 1 / size);
      lagMs = ((x - y) / size) * 1000;
    }
    expect(lagMs).toBeGreaterThanOrEqual(0);
    expect(lagMs).toBeLessThanOrEqual(10);
  });
  it('a repeated or older timestamp returns the value unfiltered and changes nothing', () => {
    const f = new OneEuro();
    f.apply(10, 100, 1);
    expect(f.apply(50, 100, 1)).toBe(50); // returned as is
    expect(f.apply(10, 133, 1)).toBeCloseTo(10, 9); // the 50 never entered the state
  });
});

describe('LandmarkSmoother', () => {
  const pts = (dx: number) => {
    const p = new Float32Array(478 * 3);
    for (let i = 0; i < 478; i++) {
      p[i * 3] = 0.4 + (0.2 * ((i * 37) % 100)) / 100 + dx;
      p[i * 3 + 1] = 0.4 + (0.2 * ((i * 53) % 100)) / 100;
      p[i * 3 + 2] = 0.01;
    }
    return p;
  };
  it('is scale invariant: the same normalized motion at twice the resolution gives the same output', () => {
    const a = new LandmarkSmoother();
    const b = new LandmarkSmoother();
    let oa = new Float32Array(0);
    let ob = new Float32Array(0);
    for (let i = 0; i < 20; i++) {
      oa = a.apply(pts(i * 0.002), 640, 480, i * 33);
      ob = b.apply(pts(i * 0.002), 1280, 960, i * 33);
    }
    for (let k = 0; k < oa.length; k++) expect(Math.abs(oa[k] - ob[k])).toBeLessThan(1e-6);
  });
  it('one filter per landmark coordinate: a still point stays put while another moves', () => {
    const s = new LandmarkSmoother();
    let out = new Float32Array(0);
    for (let i = 0; i < 20; i++) {
      const p = pts(0);
      p[5 * 3] += i * 0.01;
      out = s.apply(p, 640, 480, i * 33);
    }
    expect(out[7 * 3]).toBeCloseTo(pts(0)[7 * 3], 6);
    expect(out[5 * 3]).toBeGreaterThan(pts(0)[5 * 3] + 0.1);
  });
});
