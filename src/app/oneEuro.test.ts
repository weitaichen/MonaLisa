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
  it('is one OneEuro per coordinate, to the bit (round-2 review D11: the state in typed arrays changes no output)', () => {
    // the reference: the smoother as it was, 478 × 3 OneEuro filters, each fed its coordinate in source px
    const ref = Array.from({ length: 478 * 3 }, () => new OneEuro());
    const refApply = (p: Float32Array, w: number, h: number, ts: number) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 478; i++) {
        x0 = Math.min(x0, p[i * 3] * w); x1 = Math.max(x1, p[i * 3] * w);
        y0 = Math.min(y0, p[i * 3 + 1] * h); y1 = Math.max(y1, p[i * 3 + 1] * h);
      }
      const size = (x1 - x0 + (y1 - y0)) / 2;
      const scale = size > 0 && Number.isFinite(size) ? 1 / size : 1;
      const out = new Float32Array(p.length);
      for (let i = 0; i < 478; i++) {
        out[i * 3] = ref[i * 3].apply(p[i * 3] * w, ts, scale) / w;
        out[i * 3 + 1] = ref[i * 3 + 1].apply(p[i * 3 + 1] * h, ts, scale) / h;
        out[i * 3 + 2] = ref[i * 3 + 2].apply(p[i * 3 + 2] * w, ts, scale) / w;
      }
      return out;
    };
    const s = new LandmarkSmoother();
    // motion, a jump, uneven frame times, a repeated and an older timestamp, a resolution change
    const frames: [number, number, number, number][] = [];
    let ts = 1000;
    for (let i = 0; i < 60; i++) {
      ts += i === 20 ? 0 : i === 21 ? -40 : [33, 16, 50, 34][i % 4];
      const res = i < 40 ? [1280, 720] : [720, 1280];
      frames.push([i < 30 ? i * 0.003 : 0.2 + Math.sin(i) * 0.01, res[0], res[1], ts]);
    }
    let differ = 0;
    for (const [dx, w, h, t] of frames) {
      const p = pts(dx);
      const a = s.apply(p, w, h, t);
      const b = refApply(p, w, h, t);
      for (let k = 0; k < a.length; k++) if (!Object.is(a[k], b[k])) differ++;
    }
    expect(differ).toBe(0);
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
