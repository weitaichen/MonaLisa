// P5's 質感 + 調節 stages: the CPU port is pinned to both composite variants (step-2 spec §4.7). The e2e
// composite.spec.ts compares the real shader with compositeCpu() pixel by pixel; these are the cheap tripwires.
import { describe, expect, it } from 'vitest';
import { adjustUniforms, frameFor } from './adjustMath';
import { compositeCpu, lut64Cpu } from './compositeCpu';
import { shaderHash } from './shaderHash';
import { ADJUST_GLSL } from './shaders/adjust';
import { COMPOSITE_FS, COMPOSITE_UNITS, compositeFs } from './shaders/composite';

/** the composite text step 1 left, recorded before step 2 touched composite.ts */
const STEP1_COMPOSITE_HASH = '0cc1e52b';

/** identity 512² LUT in the GPUImage 64³ layout */
function identityLut(): Uint8Array {
  const d = new Uint8Array(512 * 512 * 4);
  for (let b = 0; b < 64; b++)
    for (let g = 0; g < 64; g++)
      for (let r = 0; r < 64; r++) {
        const i = ((Math.floor(b / 8) * 64 + g) * 512 + (b % 8) * 64 + r) * 4;
        d[i] = Math.round((r * 255) / 63);
        d[i + 1] = Math.round((g * 255) / 63);
        d[i + 2] = Math.round((b * 255) / 63);
        d[i + 3] = 255;
      }
  return d;
}

describe('composite variants (step-2 spec §4.1, §4.7)', () => {
  it('the base variant is the step-1 composite, unchanged (parity by construction)', () => {
    expect(COMPOSITE_FS).toBe(compositeFs({ adjust: false }));
    expect(shaderHash(compositeFs({ adjust: false }))).toBe(STEP1_COMPOSITE_HASH);
  });

  it('the 調節 variant is pinned: an edit must be mirrored in compositeCpu.ts / adjustMath.ts (then update this hash)', () => {
    expect(shaderHash(compositeFs({ adjust: true }))).toBe('b97d3ac7');
  });

  it('splice: the 調節 program holds ADJUST_GLSL and calls adjustStage once, after the 濾鏡 and 質感 LUTs; the base holds neither', () => {
    const a = compositeFs({ adjust: true });
    expect(a).toContain(ADJUST_GLSL);
    expect(a.split('adjustStage(color, vUv)').length - 1).toBe(1);
    expect(a.indexOf('lut64(uLookLut')).toBeGreaterThan(a.indexOf('lut64(uFilterLut'));
    expect(a.indexOf('adjustStage(color, vUv)')).toBeGreaterThan(a.indexOf('lut64(uLookLut'));
    const base = compositeFs({ adjust: false });
    expect(base).not.toContain('uLookLut');
    expect(base).not.toContain('adjustStage');
    expect(COMPOSITE_UNITS.look).toBe(8);
  });

  it('every integer of the grain hash is highp (the composite has no default int precision; mediump may be 16-bit on iOS)', () => {
    // declarations only: `uint x`, `highp uint r0 =`, `ivec2 i =`; constructor calls such as `uint(i.y)` do not match
    const decls = [...ADJUST_GLSL.matchAll(/(\w+\s+)?\b(uint|uvec[234]|ivec[234])\s+[A-Za-z_]\w*\s*[=;,()]/g)];
    expect(decls.length).toBeGreaterThanOrEqual(10);
    for (const m of decls) expect(m[1]?.trim(), m[0]).toBe('highp');
  });
});

describe('compositeCpu', () => {
  const W = 32;
  const H = 16;
  const src = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    src[i * 4] = (i * 37) % 256;
    src[i * 4 + 1] = (i * 91) % 256;
    src[i * 4 + 2] = (i * 13) % 256;
    src[i * 4 + 3] = 255;
  }
  const frame = frameFor({ width: W, height: H });

  it('is the identity with neutral uniforms and no look', () => {
    expect(Array.from(compositeCpu(src, W, H, adjustUniforms({}, null, false, frame), null))).toEqual(Array.from(src));
  });

  it('lut64Cpu with an identity LUT returns the colour (GPUImage lookup math)', () => {
    const lut = identityLut();
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8], [0.73, 0.11, 0.42]]) {
      const o = lut64Cpu(lut, c[0], c[1], c[2]);
      for (let k = 0; k < 3; k++) expect(Math.abs(o[k] - c[k])).toBeLessThan(0.5 / 255);
    }
  });

  it('a look mixes its LUT by lookAmt, then the 調節 stages run, rounding once', () => {
    const lut = identityLut();
    for (let i = 0; i < lut.length; i += 4) lut[i] = 255 - lut[i]; // invert red
    const u = { ...adjustUniforms({}, null, false, frame), on: true, lookAmt: 0.5 };
    const out = compositeCpu(src, W, H, u, lut);
    // red becomes mix(r, 1 − r, 0.5) = 0.5 (± the LUT's 64-step quantization)
    for (let i = 0; i < W * H; i++) expect(Math.abs(out[i * 4] - 128)).toBeLessThanOrEqual(3);
    expect(out[3]).toBe(255);
  });
});
