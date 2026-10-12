import { describe, expect, it } from 'vitest';
import { applyPreset, BLUSH_SHADES, defaultParams, FILTERS, LIP_SHADES, PARAM_DEFS, PRESETS, sanitizeParams } from '../engine/params';
import type { BeautyParams } from '../types';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';

/** presetAmount is dead data while custom (setPresetAmount ignores it, a preset tap overwrites it) */
const canon = (p: BeautyParams): BeautyParams => (p.presetId === 'custom' ? { ...p, presetAmount: 1 } : p);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('splitLegacy / legacyProjection (RM §3.2)', () => {
  it('round-trips every preset at several 程度', () => {
    for (const p of PRESETS) {
      for (const a of [0, 0.35, 1]) {
        const v1 = applyPreset(p.id, a);
        expect(legacyProjection(editFromLegacy(v1), 'p0')).toEqual(canon(v1));
      }
    }
    expect(legacyProjection(editFromLegacy(defaultParams()), 'p0')).toEqual(defaultParams());
  });
  it('round-trips 500 random sanitized v1 params', () => {
    const r = rng(42);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < 500; i++) {
      const raw = {
        values: Object.fromEntries(PARAM_DEFS.map((d) => [d.id, r()])),
        filterId: pick(FILTERS).id,
        lipShade: pick([null, ...LIP_SHADES.map((s) => s.id)]),
        blushShade: pick([null, ...BLUSH_SHADES.map((s) => s.id)]),
        presetId: pick([...PRESETS.map((p) => p.id), 'custom']),
        presetAmount: r(),
        bodyProtect: r() < 0.5,
        heightBand: r() < 0.5 ? null : { top: 0.2, bottom: 0.6, amount: r() },
      };
      const p = sanitizeParams(raw);
      expect(legacyProjection(editFromLegacy(p), 'p0')).toEqual(canon(p));
    }
  });
  it('splits photo items to the photo and the rest to the person', () => {
    const { photo, person } = splitLegacy(applyPreset('glow', 1));
    expect(Object.keys(photo.values).sort()).toEqual(['body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten']);
    expect('skin.whiten' in person.values).toBe(false);
    expect(person.shades).toEqual({ lip: 'bean', blush: 'peach' });
    expect(person.preset).toEqual({ id: 'glow', amount: 1 });
    expect(photo.presetLink).toEqual({ id: 'glow', amount: 1 });
  });
  it('the projection is custom when the photo link and the person preset disagree', () => {
    const e = editFromLegacy(defaultParams());
    expect(legacyProjection({ ...e, photo: { ...e.photo, presetLink: null } }, 'p0').presetId).toBe('custom');
  });
  it('editFromLegacy keeps the look as primaryInit for v1 entries', () => {
    const e = editFromLegacy(applyPreset('refined', 1), { primaryInit: true });
    expect(e.primaryInit).toBe(e.persons.p0);
    expect(e.template.preset).toEqual({ id: 'original', amount: 1 });
  });
});
