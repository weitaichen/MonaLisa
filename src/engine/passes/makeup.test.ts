import { describe, expect, it } from 'vitest';
import { applyPreset, setParam, setShade } from '../params';
import { BLUSH_SEAM, blushFade, makeupActive, makeupUniforms } from './makeup';

describe('makeupUniforms', () => {
  it('no makeup in the natural preset', () => {
    const u = makeupUniforms(applyPreset('natural'), 1);
    expect(u.lip).toBe(0);
    expect(u.blush).toBe(0);
    expect(makeupActive(u)).toBe(false);
  });

  it('glow preset: bean lip + peach blush tints, intensities × faceWeight', () => {
    const p = applyPreset('glow');
    const u = makeupUniforms(p, 0.5);
    expect(u.lip).toBeCloseTo(0.15);
    expect(u.blush).toBeCloseTo(0.15);
    expect(u.lipColor).toEqual([0xc9 / 255, 0x76 / 255, 0x7a / 255]);
    expect(u.blushColor).toEqual([0xff / 255, 0x9e / 255, 0x8a / 255]);
    expect(makeupActive(u)).toBe(true);
    expect(makeupActive(makeupUniforms(p, 0))).toBe(false);
  });

  it('null shade = original GPUPixel texture colour', () => {
    let p = setParam(applyPreset('natural'), 'makeup.lip', 0.6);
    p = setShade(p, 'lip', null);
    const u = makeupUniforms(p, 1);
    expect(u.lipColor).toBeNull();
    expect(u.lip).toBeCloseTo(0.6);
  });

  it('unknown shade id falls back to the original colour; values clamped', () => {
    const base = applyPreset('natural');
    const p = {
      ...base,
      lipShade: 'nope',
      blushShade: 'rose',
      values: { ...base.values, 'makeup.lip': 3, 'makeup.blush': -1 },
    };
    const u = makeupUniforms(p, 1);
    expect(u.lipColor).toBeNull();
    expect(u.blushColor).toEqual([0xe7 / 255, 0x7a / 255, 0x93 / 255]);
    expect(u.lip).toBe(1);
    expect(u.blush).toBe(0);
  });
});

describe('blushFade', () => {
  it('is 0 on the cheek/nose seam only, mirrored left/right', () => {
    const w = blushFade();
    expect(w.length).toBe(111);
    expect(Array.from(w).filter((v) => v === 0).length).toBe(BLUSH_SEAM.length);
    // cheek centres keep full weight
    expect(w[109]).toBe(1);
    expect(w[110]).toBe(1);
    // GPUPixel mirror pairs: 55↔58, 56↔63, 78↔79, 80↔81, 82↔83
    for (const [l, r] of [[55, 58], [56, 63], [78, 79], [80, 81], [82, 83]]) expect(w[l]).toBe(w[r]);
  });
});
