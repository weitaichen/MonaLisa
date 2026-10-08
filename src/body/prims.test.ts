import { describe, expect, it } from 'vitest';
import { capsuleAt, kForWidth, makeCapsule, phi, widthForK } from './prims';

describe('capsule field', () => {
  it('k from a target width reproduces that width (report: k = 0.25, ρ = 2 → about −14 %)', () => {
    expect(widthForK(0.25, 0.5)).toBeCloseTo(0.857, 2);
    for (const f of [0.86, 0.9, 0.95, 1.04, 1.08]) expect(widthForK(kForWidth(f, 0.5), 0.5)).toBeCloseTo(f, 6);
  });

  it('det J = 1 + k·(1 − r²)(1 − 5r²) has its minimum 1 − 0.8k at r² = 0.6', () => {
    const k = 0.5;
    let min = Infinity;
    for (let r = 0; r < 1; r += 1e-4) {
      const h = 1e-6;
      const f = (x: number) => x * (1 + k * phi(x));
      min = Math.min(min, (f(r + h) - f(r - h)) / (2 * h));
    }
    expect(min).toBeCloseTo(1 - 0.8 * k, 4);
  });

  it('is zero outside R and on the axis, and acts along the normal only', () => {
    const c = makeCapsule([0, 0], [0, 1], 0.1, 2, 0.3, 0.15, 1, 0);
    expect(capsuleAt(c, 0.25, 0.5).d).toBe(0); // r > 1
    expect(capsuleAt(c, 0, 0.5).d).toBe(0);
    expect(Math.abs(capsuleAt(c, 0.1, 0.5).d)).toBeCloseTo(0.1 * 0.3 * phi(0.5), 9);
    expect(capsuleAt(c, 0.1, -0.3).d).toBe(0); // past the joint fade
  });

  it('one-sided capsules leave the closed side alone', () => {
    const c = makeCapsule([0, 0], [0, 1], 0.1, 2, 0.3, 0.15, 1, 1);
    expect(capsuleAt(c, -c.n[0] * 0.1, 0.5).d).toBeCloseTo(0, 12);
    expect(Math.abs(capsuleAt(c, c.n[0] * 0.1, 0.5).d)).toBeGreaterThan(0);
  });
});
