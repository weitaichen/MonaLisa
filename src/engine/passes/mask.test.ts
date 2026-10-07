import { describe, expect, it } from 'vitest';
import type { Face } from '../../types';
import { FACE_TEMPLATE } from './faceMesh';
import { MASK_MAX_FLOATS, buildMaskGeometry } from './mask';

function face(): Face {
  const oval = new Float32Array(72);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    oval[i * 2] = 0.5 + 0.21 * Math.sin(a);
    oval[i * 2 + 1] = 0.47 - 0.26 * Math.cos(a);
  }
  return { pts111: new Float32Array(FACE_TEMPLATE), ext: new Float32Array(16), oval, yaw: 0 };
}

describe('buildMaskGeometry', () => {
  it('fills exactly the preallocated buffer and splits base / holes', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [count, base] = buildMaskGeometry(face(), 1, out);
    expect(count * 3).toBe(MASK_MAX_FLOATS);
    expect(base).toBe(36 * 9);
    for (let i = 0; i < count * 3; i++) expect(Number.isFinite(out[i])).toBe(true);
  });

  it('base: 1 on the oval, 0 on the outer ring; holes: 0 inside, 1 on their rim', () => {
    const out = new Float32Array(MASK_MAX_FLOATS);
    const [count, base] = buildMaskGeometry(face(), 1, out);
    const vals = (from: number, to: number) => {
      const s = new Set<number>();
      for (let v = from; v < to; v++) s.add(out[v * 3 + 2]);
      return s;
    };
    expect(vals(0, base)).toEqual(new Set([0, 1]));
    expect(vals(base, count)).toEqual(new Set([0, 1]));
    let maxOval = 0;
    let minRing = Infinity;
    for (let v = 0; v < base; v++) {
      const d = Math.hypot(out[v * 3] - 0.5, out[v * 3 + 1] - 0.47);
      if (out[v * 3 + 2] === 1) maxOval = Math.max(maxOval, d);
      else minRing = Math.min(minRing, d);
    }
    // ring vertices sit 8% of the face width outside the oval
    const faceW = FACE_TEMPLATE[64] - FACE_TEMPLATE[0];
    expect(minRing).toBeGreaterThan(0.21 + 0.08 * faceW * 0.99);
    expect(maxOval).toBeCloseTo(0.26, 5);
  });
});
