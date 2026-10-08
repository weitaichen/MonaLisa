import { describe, expect, it } from 'vitest';
import { distanceOutside } from './mask';
import { cellDet, markGaps, relaxBackground, type RelaxOptions } from './relax';
import { sampleGrid } from './mask';

const OPTS: RelaxOptions = {
  alpha: 0.05,
  margin: 0.03,
  moveEps: 1e-6,
  maxReach: 0.07,
  gapMax: 0.03,
  repairFloor: 0.7,
  repairFactor: 8,
  repairRounds: 4,
  tol: 1e-5,
  maxIter: 400,
};

/**
 * A disc "person" (radius rP) slimmed by a capsule-like ring: the output at radius r samples the source at
 * r·(1 + k·φ(r/R)), φ = (1 − x²)² (prims.ts), i.e. a radial displacement r·k·φ that dies out at R.
 */
function disc(n: number, rP = 0.2, R = 0.3, k = 0.2) {
  const gx = new Float32Array(n * n);
  const gy = new Float32Array(n * n);
  const inside = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.hypot(dx, dy);
      const i = y * n + x;
      inside[i] = r <= rP ? 1 : 0;
      const s = r < R ? 1 - (r / R) ** 2 : 0;
      gx[i] = dx * k * s * s;
      gy[i] = dy * k * s * s;
    }
  return { gx, gy, inside, dist: distanceOutside(inside, n, n) };
}

/**
 * The person fills x < 0.4 and moves by c; the background beside it falls off as c·φ((x − 0.4)/L), the primitives'
 * profile: flat at the silhouette, steepest (1.54·c/L) inside the ring.
 */
function slab(n: number, c = 0.01, L = 0.04) {
  const gx = new Float32Array(n * n);
  const gy = new Float32Array(n * n);
  const inside = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5) / n;
      const i = y * n + x;
      inside[i] = u < 0.4 ? 1 : 0;
      const s = Math.min(1, Math.max(0, (u - 0.4) / L));
      gx[i] = c * (1 - s * s) ** 2;
    }
  return { gx, gy, inside, dist: distanceOutside(inside, n, n) };
}

/** largest background magnification along a row: 1/(∂(x + D_x)/∂x) − 1 */
function rowStretch(gx: Float32Array, n: number): number {
  const y = n >> 1;
  let worst = 0;
  for (let x = Math.ceil(0.4 * n); x + 1 < n; x++) worst = Math.max(worst, 1 / (1 + (gx[y * n + x + 1] - gx[y * n + x]) * n) - 1);
  return worst;
}

function minCellDet(gx: Float32Array, gy: Float32Array, n: number): number {
  let m = Infinity;
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) m = Math.min(m, cellDet(gx, gy, n, y * n + x, n));
  return m;
}

describe('relaxBackground (stage-1 background membrane)', () => {
  it('keeps every person texel and the far background bit-identical, and spreads the ring stretch', () => {
    const n = 256;
    const d = disc(n);
    const ex = Float32Array.from(d.gx);
    const ey = Float32Array.from(d.gy);
    const st = relaxBackground(ex, ey, d.inside, d.dist, n, n, 1 / n, OPTS, 1);
    expect(st.unknowns).toBeGreaterThan(1000);
    let farMoved = 0;
    for (let i = 0; i < n * n; i++) {
      if (d.inside[i]) {
        expect(ex[i]).toBe(d.gx[i]);
        expect(ey[i]).toBe(d.gy[i]);
      }
      // the original ring ends at r = 0.3, the margin may add 0.03, maxReach caps it 0.07 past the person (r = 0.27)
      if (d.dist[i] / n > OPTS.maxReach + 1e-9 && d.gx[i] === 0 && d.gy[i] === 0 && (ex[i] !== 0 || ey[i] !== 0)) farMoved++;
    }
    expect(farMoved).toBe(0);
    // the repair never leaves a cell below min(its det in D, the floor)
    for (let y = 0; y + 1 < n; y++)
      for (let x = 0; x + 1 < n; x++) {
        const i = y * n + x;
        expect(cellDet(ex, ey, n, i, n)).toBeGreaterThanOrEqual(Math.min(cellDet(d.gx, d.gy, n, i, n), OPTS.repairFloor) - 0.01);
      }
    expect(minCellDet(ex, ey, n)).toBeGreaterThanOrEqual(minCellDet(d.gx, d.gy, n) - 0.01);
  });

  it('spreads the silhouette displacement evenly over the ring instead of in the profile’s steepest part', () => {
    const n = 256;
    const d = slab(n);
    const before = rowStretch(d.gx, n);
    relaxBackground(d.gx, d.gy, d.inside, d.dist, n, n, 1 / n, OPTS, 1);
    const after = rowStretch(d.gx, n);
    // φ peaks at 1.54× the mean slope; a linear ramp over the ring plus the margin is the even spread
    expect(before).toBeCloseTo(1 / (1 - (1.54 * 0.01) / 0.04) - 1, 1);
    expect(after).toBeLessThan(0.6 * before);
    expect(after).toBeGreaterThan(1 / (1 - 0.01 / (0.04 + OPTS.margin)) - 1 - 0.02);
  });

  it('a draft grid (α scaled by the texel area) solves the same continuous problem', () => {
    const fine = disc(256);
    const coarse = disc(128);
    relaxBackground(fine.gx, fine.gy, fine.inside, fine.dist, 256, 256, 1 / 256, OPTS, 1);
    relaxBackground(coarse.gx, coarse.gy, coarse.inside, coarse.dist, 128, 128, 1 / 128, OPTS, 4);
    let worst = 0;
    for (let v = 0.0025; v < 1; v += 0.005)
      for (let u = 0.0025; u < 1; u += 0.005) {
        const e = Math.hypot(sampleGrid(fine.gx, 256, 256, u, v) - sampleGrid(coarse.gx, 128, 128, u, v), sampleGrid(fine.gy, 256, 256, u, v) - sampleGrid(coarse.gy, 128, 128, u, v));
        worst = Math.max(worst, e);
      }
    // within half a draft texel: the two grids' silhouette staircases differ by up to that much
    expect(worst).toBeLessThan(0.5 / 128);
  });

  it('a person near the frame edge: the border keeps D (keepInFrame pins it later), so the ring is not carried out to the edge', () => {
    // the person fills x < n − 6 (6 background texels to the right edge, well inside maxReach), moving by c; D dies out
    // 2 texels before the edge. Mirrored: the same next to the bottom edge (transposed: x ↔ y).
    const n = 128;
    const c = 0.01;
    const L = 4 / n;
    for (const axis of ['x', 'y'] as const) {
      const gx = new Float32Array(n * n);
      const gy = new Float32Array(n * n);
      const inside = new Uint8Array(n * n);
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = ((axis === 'x' ? x : y) + 0.5) / n;
          const edge = (n - 6) / n;
          const i = y * n + x;
          inside[i] = u < edge ? 1 : 0;
          const s = Math.min(1, Math.max(0, (u - edge) / L));
          (axis === 'x' ? gx : gy)[i] = c * (1 - s * s) ** 2;
        }
      const d = { gx: Float32Array.from(gx), gy: Float32Array.from(gy) };
      const st = relaxBackground(gx, gy, inside, distanceOutside(inside, n, n), n, n, 1 / n, OPTS, 1);
      expect(st.unknowns, axis).toBeGreaterThan(0);
      let changed = 0;
      for (let k = 0; k < n; k++)
        for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1]) {
          expect(gx[i], `${axis} border ${i}`).toBe(d.gx[i]);
          expect(gy[i], `${axis} border ${i}`).toBe(d.gy[i]);
        }
      // the strip between the person and the edge is still relaxed (not simply left at D)
      for (let i = 0; i < n * n; i++) if (gx[i] !== d.gx[i] || gy[i] !== d.gy[i]) changed++;
      expect(changed, axis).toBeGreaterThan(n);
    }
  });

  it('nothing moves when nothing moved', () => {
    const n = 64;
    const gx = new Float32Array(n * n);
    const gy = new Float32Array(n * n);
    const inside = new Uint8Array(n * n);
    expect(relaxBackground(gx, gy, inside, distanceOutside(inside, n, n), n, n, 1 / n, OPTS, 1).unknowns).toBe(0);
    expect(gx.every((v) => v === 0) && gy.every((v) => v === 0)).toBe(true);
  });
});

describe('markGaps', () => {
  it('marks background runs bounded by the person on both ends, up to the length limit', () => {
    // one row: person | 3 background | person | 10 background | person | 4 background to the edge
    const row = '1000100000000001' + '0000';
    const w = row.length;
    const inside = Uint8Array.from(row, (c) => +c);
    const out = new Uint8Array(w);
    markGaps(inside, w, 1, 5, out);
    expect(Array.from(out).join('')).toBe('0111000000000000' + '0000');
    // a column works the same way
    const col = new Uint8Array(w);
    markGaps(inside, 1, w, 5, col);
    expect(Array.from(col)).toEqual(Array.from(out));
  });
});
