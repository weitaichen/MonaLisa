import { describe, expect, it } from 'vitest';
import { shaderHash } from '../shaderHash'; // step 2 moved the FNV-1a pin helper here from reshapeCpu.test.ts
import { KIND, PMAKEUP_FS } from './makeupProc';
import { blend, fragment, luma, skinGate, type FragIn } from './makeupProcCpu';

const base = (over: Partial<FragIn>): FragIn => ({
  kind: 0,
  loc: [0.5, 0],
  aux: [0, 0],
  col: [0.6, 0.3, 0.2, 1],
  src: [0.8, 0.6, 0.5],
  lash: 0,
  fwD: 0.001,
  fwU: 0.01,
  ...over,
});

describe('PMAKEUP_FS CPU port (face-detail spec §8.2)', () => {
  it('is pinned to the shader text: a PMAKEUP_FS edit must be mirrored in makeupProcCpu.ts (then update this hash)', () => {
    expect(shaderHash(PMAKEUP_FS)).toBe('f76b819e');
  });

  it('skinGate: ≥ 0.9 on deep skin in shadow and light skin; ≤ 0.1 on black hair, mid grey and a blue background', () => {
    const g = (r: number, gg: number, b: number) => skinGate(r / 255, gg / 255, b / 255);
    expect(g(52, 35, 28)).toBeGreaterThanOrEqual(0.9);
    expect(g(235, 190, 170)).toBeGreaterThanOrEqual(0.9);
    expect(g(25, 24, 26)).toBeLessThanOrEqual(0.1);
    expect(g(128, 128, 128)).toBeLessThanOrEqual(0.1);
    expect(g(90, 120, 170)).toBeLessThanOrEqual(0.1);
    expect(luma(1, 1, 1)).toBeCloseTo(1, 12);
  });

  it('blend: multiply darkens by mix(1, tint, α); screen lightens; over composites; outputs clamp first', () => {
    const dst: [number, number, number] = [0.5, 0.5, 0.5];
    expect(blend(0, dst, { rgb: [0.4, 1, 0], a: 0.5 })).toEqual([0.5 * 0.7, 0.5, 0.25]);
    expect(blend(1, dst, { rgb: [1, 0.5, 0], a: 0.5 })).toEqual([0.5 + 0.5 * 0.5, 0.25 + 0.5 * 0.75, 0.5]);
    expect(blend(2, dst, { rgb: [1, 0, 2], a: 0.25 })).toEqual([0.25 + 0.375, 0.375, 0.25 + 0.375]);
  });

  it('眼線: seals 0.006 into the aperture, reaches T, fades after u = 0.85', () => {
    const at = (d: number, u = 0.5) => fragment(base({ kind: KIND.liner, loc: [u, d], aux: [0.03, 0] })).a;
    expect(at(-0.02)).toBe(0);
    expect(at(0.015)).toBeCloseTo(1, 6);
    expect(at(0.05)).toBe(0);
    expect(at(0.015, 1)).toBe(0);
  });

  it('美瞳: zero outside the disc, on closed lids and on the catchlight; 原色 darkens only the ring', () => {
    const lens = (loc: [number, number], aux: [number, number], src: [number, number, number] = [0.3, 0.25, 0.2], kind: number = KIND.lens) =>
      fragment(base({ kind, loc, aux, src }));
    expect(lens([0.6, 0], [0.1, 0.1]).a).toBeGreaterThan(0.9);
    expect(lens([1.2, 0], [0.1, 0.1]).a).toBe(0);
    expect(lens([0.6, 0], [0, 0.1]).a).toBe(0);
    expect(lens([0.6, 0], [0.1, 0.1], [0.95, 0.95, 0.95]).a).toBe(0);
    expect(lens([0.1, 0], [0.1, 0.1]).a).toBe(0);
    expect(lens([0.5, 0], [0.1, 0.1], undefined, KIND.lensOrig).a).toBe(0);
    const ring = lens([0.95, 0], [0.1, 0.1], undefined, KIND.lensOrig);
    expect(ring.a).toBeGreaterThan(0.9);
    expect(ring.rgb).toEqual([0.3 * 0.55, 0.25 * 0.55, 0.2 * 0.55]);
    expect(Number.isFinite(lens([0, 0], [0.1, 0.1]).rgb[0])).toBe(true);
  });

  it('睫毛 passes the texture through; 修容 / 高光 vanish on hair; the brow strokes fade when too fine to show', () => {
    expect(fragment(base({ kind: KIND.lashes, lash: 0.4, col: [0.08, 0.07, 0.07, 0.5] })).a).toBeCloseTo(0.2, 12);
    expect(fragment(base({ kind: KIND.contourEllipse, loc: [0, 0], src: [25 / 255, 24 / 255, 26 / 255] })).a).toBe(0);
    expect(fragment(base({ kind: KIND.highlightEllipse, loc: [0, 0], aux: [0.3, 0] })).a).toBeCloseTo(0.3, 6);
    const fine = fragment(base({ kind: KIND.brow, loc: [0.3, 0.5], fwU: 1 })).a;
    const coarse = fragment(base({ kind: KIND.brow, loc: [0.3, 0.5], fwU: 0.01 })).a;
    expect(fine).toBeCloseTo(0.89, 6);
    expect(coarse).toBeGreaterThan(0.77);
    expect(coarse).toBeLessThanOrEqual(1);
  });
});
