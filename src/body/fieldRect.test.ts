import { describe, expect, it } from 'vitest';
import type { BodyField } from '../types';
import { fieldMinJacobian, fieldMinJacobianRect } from './field';

/** v0.3's fieldMinJacobian, frozen: the refactor must not change a single result */
function referenceMinJacobian(f: BodyField): number {
  const { width: w, height: h, data } = f;
  let min = Infinity;
  const mx = (x: number, y: number) => x + data[(y * w + x) * 2] * w;
  const my = (x: number, y: number) => y + data[(y * w + x) * 2 + 1] * h;
  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const ax0 = mx(x + 1, y) - mx(x, y);
      const ay0 = my(x + 1, y) - my(x, y);
      const ax1 = mx(x + 1, y + 1) - mx(x, y + 1);
      const ay1 = my(x + 1, y + 1) - my(x, y + 1);
      const bx0 = mx(x, y + 1) - mx(x, y);
      const by0 = my(x, y + 1) - my(x, y);
      const bx1 = mx(x + 1, y + 1) - mx(x + 1, y);
      const by1 = my(x + 1, y + 1) - my(x + 1, y);
      min = Math.min(min, ax0 * by0 - ay0 * bx0, ax0 * by1 - ay0 * bx1, ax1 * by0 - ay1 * bx0, ax1 * by1 - ay1 * bx1);
    }
  }
  return w > 1 && h > 1 ? min : 1;
}

/** smooth random fields, one with a fold at (fx, fy) */
function field(w: number, h: number, seed: number, fold?: [number, number]): BodyField {
  const data = new Float32Array(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2;
      data[i] = 0.02 * Math.sin(x * 0.3 + seed) * Math.cos(y * 0.2);
      data[i + 1] = 0.015 * Math.cos(x * 0.25 - seed) * Math.sin(y * 0.35);
    }
  if (fold) data[(fold[1] * w + fold[0]) * 2] += 3 / w; // one texel pushed past its right neighbour
  return { width: w, height: h, data, version: 1 };
}

describe('fieldMinJacobianRect (push-brush spec §4.3)', () => {
  it('over the full rect equals v0.3 fieldMinJacobian on every test field', () => {
    for (const f of [field(24, 36, 1), field(64, 48, 2), field(40, 40, 3, [20, 20]), field(1, 5, 4), field(5, 1, 5)]) {
      expect(fieldMinJacobian(f)).toBe(referenceMinJacobian(f));
      if (f.width > 1 && f.height > 1) expect(fieldMinJacobianRect(f, 0, 0, f.width - 1, f.height - 1)).toBe(referenceMinJacobian(f));
    }
  });

  it('sees only the cells of its rect: a fold outside is ignored, inside is found', () => {
    const f = field(40, 40, 3, [20, 20]);
    expect(fieldMinJacobianRect(f, 0, 0, 10, 10)).toBeGreaterThan(0.5);
    expect(fieldMinJacobianRect(f, 18, 18, 23, 23)).toBeLessThan(0);
    // clipped to the grid; an empty rect has no cell
    expect(fieldMinJacobianRect(f, -5, -5, 100, 100)).toBe(fieldMinJacobian(f));
    expect(fieldMinJacobianRect(f, 10, 10, 10, 30)).toBe(Infinity);
  });
});
