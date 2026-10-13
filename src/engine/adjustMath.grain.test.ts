// Grain (step-2 spec §4.4): the lowbias32 lattice must be bit-exact between this port and GLSL, and the
// value noise must have the same variance at every cell size and alignment.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { grainAt, latticeValue, lowbias32, seedMix } from './adjustMath';

/** independent reference: the same finalizer in BigInt arithmetic */
function lowbias32Big(x: number): number {
  const M = 0xffffffffn;
  let v = BigInt(x >>> 0);
  v ^= v >> 16n;
  v = (v * 0x7feb352dn) & M;
  v ^= v >> 15n;
  v = (v * 0x846ca68bn) & M;
  v ^= v >> 16n;
  return Number(v);
}

describe('lowbias32 (hash-prospector constants)', () => {
  it('matches known vectors, negative lattice indices included', () => {
    expect(lowbias32(0)).toBe(0);
    expect(lowbias32(1)).toBe(0x688990c0);
    expect(lowbias32(2)).toBe(0xd1132181);
    expect(lowbias32(0x9e3779b9)).toBe(0x01fce552);
    expect(lowbias32(0xffffffff)).toBe(0x6768824a);
    expect(lowbias32(-1)).toBe(0x6768824a);
    expect(lowbias32(-7)).toBe(0xa73d9bcb);
    expect(seedMix(0)).toBe(0x01fce552);
  });

  it('equals an independent BigInt reference over 10 000 inputs', () => {
    let x = 12345;
    for (let i = 0; i < 10_000; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      expect(lowbias32(x)).toBe(lowbias32Big(x));
    }
  });
});

describe('lattice and value noise', () => {
  it('lattice values are exact multiples of 2^−23 in [−1, 1) (so float32 GLSL gets the same numbers)', () => {
    for (let i = -50; i < 50; i++) {
      const v = latticeValue(i, lowbias32(i * 7));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
      expect(Number.isInteger((v + 1) * 8388608)).toBe(true);
      expect(Math.fround(v)).toBe(v);
    }
  });

  it('equals the lattice value on lattice points', () => {
    const mix = seedMix(3);
    for (const [x, y] of [[0, 0], [5, 9], [-3, 2], [-1, -1]]) expect(grainAt(x, y, mix)).toBe(latticeValue(x, lowbias32((y >>> 0) ^ mix)));
  });

  it('has mean ≈ 0 over 1024² pixels', () => {
    const mix = seedMix(0);
    let sum = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) sum += grainAt(x + 0.5, y + 0.5, mix);
    expect(Math.abs(sum / 1024 ** 2)).toBeLessThan(0.002);
  });

  it('has the same per-pixel std at cell sizes 1, 1.42 and 2.8 px, at every phase (variance normalization)', () => {
    const target = Math.sqrt(1 / 3);
    for (const cell of [1, 1.42, 2.8]) {
      for (let x = 0; x < 10; x++) {
        let s1 = 0;
        let s2 = 0;
        const N = 4000;
        for (let k = 0; k < N; k++) {
          const v = grainAt((x + 0.5) / cell, 7.3, seedMix(k));
          s1 += v;
          s2 += v * v;
        }
        const std = Math.sqrt(s2 / N - (s1 / N) ** 2);
        expect(Math.abs(std / target - 1), `cell ${cell} x ${x}`).toBeLessThan(0.05);
      }
    }
  });

  it('is deterministic per seed; another seed is uncorrelated', () => {
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 256 * 256; i++) {
      const x = (i % 256) + 0.5;
      const y = Math.floor(i / 256) + 0.5;
      a.push(grainAt(x, y, seedMix(0)));
      b.push(grainAt(x, y, seedMix(1)));
    }
    expect(grainAt(10.5, 20.5, seedMix(0))).toBe(a[20 * 256 + 10]);
    const mean = (v: number[]) => v.reduce((s, t) => s + t, 0) / v.length;
    const ma = mean(a);
    const mb = mean(b);
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < a.length; i++) {
      cov += (a[i] - ma) * (b[i] - mb);
      va += (a[i] - ma) ** 2;
      vb += (b[i] - mb) ** 2;
    }
    expect(Math.abs(cov / Math.sqrt(va * vb))).toBeLessThan(0.1);
  });

  it('has only type imports (scripts/gen-luts.mjs loads it under Node)', () => {
    const src = readFileSync(new URL('./adjustMath.ts', import.meta.url), 'utf8');
    for (const line of src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l))) expect(line).toMatch(/^\s*import type\s/);
    expect(src).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\s/m);
  });
});
