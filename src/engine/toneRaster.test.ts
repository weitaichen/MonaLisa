import { describe, expect, it } from 'vitest';
import type { ToneDraw } from './passes/toneGeometry';
import { rasterizeTone } from './toneRaster.node';

const draw = (p: Partial<ToneDraw>): ToneDraw => ({
  phase: 0,
  blend: 'max',
  mask: [true, true, true, true],
  off: [0, 0, 0, 0],
  str: [1, 0, 0, 0],
  verts: Float32Array.of(0, 0, 1, 1, 0, 1, 0, 1, 1),
  ...p,
});

describe('rasterizeTone (CPU stand-in for toneMask.ts)', () => {
  it('covers the pixel centres inside the triangle with off + str · smoothstep(value), in 1/255 steps', () => {
    const out = rasterizeTone([draw({ str: [0.5, 0, 0, 0] })], 4, 4, [0, 0, 1, 1], [0, 0, 0, 0]);
    expect(out[0]).toBe(Math.fround(Math.round(0.5 * 255) / 255)); // a Float32Array holds the 1/255 step exactly as float32
    expect(out[(3 * 4 + 3) * 4]).toBe(0);
  });

  it('MAX keeps the stronger value, MIN lowers, the channel mask protects the other channels, phases order the draws', () => {
    const a = draw({ str: [0.8, 0.8, 0, 0] });
    const b = draw({ phase: 1, blend: 'min', mask: [false, true, false, false], str: [0, 0.2, 0, 0] });
    const out = rasterizeTone([b, a], 4, 4, [0, 0, 1, 1], [0, 0, 0, 0]);
    expect(out[0]).toBe(Math.fround(204 / 255));
    expect(out[1]).toBe(Math.fround(51 / 255));
  });

  it('maps through the window', () => {
    const whole = rasterizeTone([draw({})], 4, 4, [0, 0, 1, 1], [0, 0, 0, 0]);
    const half = rasterizeTone([draw({})], 4, 4, [0, 0, 2, 2], [0, 0, 0, 0]);
    // the triangle (0,0)-(1,0)-(0,1) covers px centres with x + y ≤ 4 on the whole target, x + y ≤ 2 through [0, 0, 2, 2]
    expect(whole[(0 * 4 + 2) * 4]).toBeGreaterThan(0); // (2.5, 0.5)
    expect(half[(0 * 4 + 2) * 4]).toBe(0);
    expect(half[0]).toBeGreaterThan(0); // (0.5, 0.5)
  });
});
