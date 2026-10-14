import { describe, expect, it } from 'vitest';
import { HEAL_RING_SAMPLES } from '../config/limits';
import type { Spot } from '../types';
import { healCpu, membrane, robustWeights } from './healCpu';
import { TONE_ZERO } from './passes/toneGeometry';
import { shaderHash } from './shaderHash';
import { HEAL_FS, HEAL_RING_FS } from './shaders/heal';
import { makeImg, q8, type Img } from './toneCpu';

const N = HEAL_RING_SAMPLES;
const ones = () => new Float64Array(N).fill(1);
/** encoded ring values (non-fill): ZERO + Δ_k, all channels f(θ_k) */
const ring = (f: (th: number) => number) => {
  const e = new Float64Array(N * 3);
  for (let k = 0; k < N; k++) e.fill(TONE_ZERO + f((2 * Math.PI * k) / N), k * 3, k * 3 + 3);
  return e;
};
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};
function field(w: number, h: number, f: (x: number, y: number) => number): Img {
  const o = makeImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.d.set([q8(f(x, y)), q8(f(x, y) * 0.8), q8(f(x, y) * 0.7), 1], (y * w + x) * 4);
  return o;
}
const Y = (a: Img, x: number, y: number) => 0.2126 * a.d[(y * a.w + x) * 4] + 0.7152 * a.d[(y * a.w + x) * 4 + 1] + 0.0722 * a.d[(y * a.w + x) * 4 + 2];
function stats(a: Img, cx: number, cy: number, r0: number, r1: number) {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = Math.floor(cy - r1); y <= Math.ceil(cy + r1); y++)
    for (let x = Math.floor(cx - r1); x <= Math.ceil(cx + r1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r0 || d > r1) continue;
      const v = Y(a, x, y);
      s += v;
      s2 += v * v;
      n++;
    }
  return { mean: s / n, sd: Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) };
}

describe('the Poisson membrane (skin-cleanup spec §4.5)', () => {
  it('a constant ring gives a constant disc exactly', () => {
    for (const [rp, phi] of [[0, 0], [0.3, 1], [0.84, -2.5]]) for (const v of membrane(rp, phi, ring(() => 0.1), ones(), false)) expect(v).toBeCloseTo(0.1, 9);
  });

  it('a linear ring gives a linear disc within 1e-3', () => {
    for (const [rp, phi] of [[0.2, 0.4], [0.5, 2], [0.77, -1.1]]) {
      const m = membrane(rp, phi, ring((th) => 0.2 * Math.cos(th) + 0.05), ones(), false);
      expect(Math.abs(m[0] - (0.2 * rp * Math.cos(phi) + 0.05))).toBeLessThan(1e-3);
    }
  });

  it('matches the ring at ρ′ → 1 (donor + membrane meets the surroundings without a seam)', () => {
    const th = (2 * Math.PI * 3) / N;
    const m = membrane(0.999, th, ring((t) => 0.2 * Math.sin(3 * t)), ones(), false);
    expect(Math.abs(m[0] - 0.2 * Math.sin(3 * th))).toBeLessThan(0.01);
  });

  it('robust weights shrink an outlier', () => {
    const y = new Float64Array(N).fill(0.01);
    y[5] = 0.3;
    const o = robustWeights(y);
    expect(o[5]).toBeLessThan(0.05);
    expect(o[0]).toBeGreaterThan(0.9);
  });
});

describe('healCpu', () => {
  const S = 128;
  const spot = (x: number, y: number, r: number, dx: number, dy = 0): Spot => ({ x: x / S, y: y / S, r: r / S, dx: dx / S, dy: dy / S, owner: null });
  const skin = (x: number, y: number) => 0.7 + 0.03 * hash(x, y);

  it('a dark dot on textured skin: the disc keeps the skin’s texture (sd within 15 %) and tone (mean within 1 %)', () => {
    const dot = (x: number, y: number) => skin(x, y) * (1 - 0.25 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 18));
    const out = healCpu(field(S, S, dot), [spot(64.5, 64.5, 8, 26)]);
    const disc = stats(out, 64.5, 64.5, 0, 3.6);
    const around = stats(out, 64.5, 64.5, 12, 16);
    expect(Math.abs(disc.sd - around.sd) / around.sd).toBeLessThan(0.15);
    expect(Math.abs(disc.mean - around.mean) / around.mean).toBeLessThan(0.01);
  });

  it('fill mode (no donor) interpolates the surroundings smoothly', () => {
    const ramp = (x: number) => 0.4 + x / 400;
    const img = field(S, S, (x, y) => ramp(x) - 0.2 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 18));
    const out = healCpu(img, [spot(64.5, 64.5, 8, 0)]);
    for (const [x, y] of [[64, 64], [61, 66], [67, 62]]) expect(Math.abs(out.d[(y * S + x) * 4] - q8(ramp(x))) * 255).toBeLessThanOrEqual(2);
  });

  it('a 2 px dark line crossing only the spot’s ring adds < 2/255 on average inside the disc (robust weights)', () => {
    const flat = (x: number, y: number) => 0.6 - 0.2 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 18);
    // a hair across the spot: it crosses the ring radially at θ ≈ ±90° (about 2 of the 32 samples on each side) and
    // misses the donor's ring; inside ρ 0.8 (α = 1) its own pixels are replaced, so the measure sees only the ring.
    // Without the robust weights this case gives ≈ 5/255. (A line running along the ring, at ρ 1.25–1.375, fills 7 of
    // the 32 samples: that is past what the S §4.5 weights reject, ≈ 4/255 with them.)
    const lined = (x: number, y: number) => (x === 64 || x === 65 ? 0.3 : flat(x, y));
    const a = healCpu(field(S, S, flat), [spot(64.5, 64.5, 8, 30)]);
    const b = healCpu(field(S, S, lined), [spot(64.5, 64.5, 8, 30)]);
    let sum = 0;
    let n = 0;
    for (let y = 56; y <= 73; y++)
      for (let x = 56; x <= 73; x++) {
        if (Math.hypot(x + 0.5 - 64.5, y + 0.5 - 64.5) > 0.8 * 8) continue;
        sum += Math.abs(a.d[(y * S + x) * 4] - b.d[(y * S + x) * 4]) * 255;
        n++;
      }
    expect(sum / n).toBeLessThan(2);
  });

  it('two overlapping spots compose: far from the second, the first is healed as alone', () => {
    const img = field(S, S, skin);
    const one = healCpu(img, [spot(50.5, 64.5, 8, 0, 26)]);
    const two = healCpu(img, [spot(50.5, 64.5, 8, 0, 26), spot(57, 64.5, 8, 0, -26)]);
    for (const [x, y] of [[44, 64], [45, 60], [46, 69]]) {
      if (Math.hypot(x + 0.5 - 57, y + 0.5 - 64.5) <= 8.8) continue;
      expect(Math.abs(one.d[(y * S + x) * 4] - two.d[(y * S + x) * 4]) * 255).toBeLessThanOrEqual(1);
    }
    for (const v of two.d) expect(Number.isFinite(v)).toBe(true);
  });

  it('is pinned to the heal shaders: a change must be mirrored here (then update this hash)', () => {
    expect(shaderHash([HEAL_RING_FS, HEAL_FS].join('\n'))).toBe('ee5b9650');
  });
});
