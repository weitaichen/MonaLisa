import { describe, expect, it } from 'vitest';
import { applyPreset, BLUSH_SHADES, defaultParams, FILTERS, LIP_SHADES, neutralValue, PARAM_DEFS, paramsInGroup, PRESETS, sanitizeParams } from '../engine/params';
import type { BeautyParams } from '../types';
import { editFromLegacy, legacyProjection, mergeLegacy, splitLegacy } from './legacy';
import { defaultPhoto, editRotateLeft, emptyShades, neutralPerson } from './state';

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
        values: Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.group === 'tone' ? neutralValue(d) : r()])),
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
    expect(Object.keys(photo.values).sort()).toEqual([
      'adjust.brightness', 'adjust.contrast', 'adjust.exposure', 'adjust.fade', 'adjust.grain', 'adjust.highlights',
      'adjust.saturation', 'adjust.shadows', 'adjust.temperature', 'adjust.tint', 'adjust.vibrance', 'adjust.vignette',
      'body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten',
    ]);
    expect('skin.whiten' in person.values).toBe(false);
    expect(person.shades).toEqual({ ...emptyShades(), lip: 'bean', blush: 'peach' });
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

describe('step 4: the legacy projection drops tone values and spots (§5 rollback)', () => {
  it('writes every tone.* value neutral into BeautyParams, and no spots', () => {
    const p = neutralPerson();
    const e = {
      v: 2 as const,
      photo: { ...defaultPhoto(), spots: [{ x: 0.5, y: 0.5, r: 0.02, dx: 0, dy: 0, owner: null }] },
      persons: { f0: { ...p, values: { ...p.values, 'tone.even': 0.7, 'tone.warmth': 0.9 } } },
      template: neutralPerson(),
      primaryInit: null,
    };
    const legacy = legacyProjection(e, 'f0');
    for (const d of paramsInGroup('tone')) expect(legacy.values[d.id], d.id).toBe(neutralValue(d));
    expect('spots' in legacy).toBe(false);
  });
});

describe('mergeLegacy: 0.3 edited a v2 entry after a rollback (S §5.3)', () => {
  it('takes only what the stored record holds; a link or preset the merged values no longer match is dropped', () => {
    const e0 = editFromLegacy(applyPreset('glow', 1));
    const e = { ...e0, photo: { ...e0.photo, values: { ...e0.photo.values, 'adjust.tint': 0.8 }, legsAnchor: 'p0' } };
    // 0.3 picked 精緻, but its record holds no readable 美白: the v2 value stays, so the 精緻 link no longer holds
    const stored = PARAM_DEFS.map((d) => d.id).filter((id) => id !== 'skin.whiten' && !id.startsWith('adjust.') && !id.startsWith('tone.'));
    const refined = applyPreset('refined', 1);
    const m = mergeLegacy(e, refined, 'p0', stored);
    expect(m.photo.values['skin.whiten']).toBe(e.photo.values['skin.whiten']);
    expect(m.photo.values['skin.sharpen']).toBe(refined.values['skin.sharpen']);
    expect(m.photo.values['adjust.tint']).toBe(0.8);
    expect(m.photo.filterId).toBe('soft');
    expect(m.photo.presetLink).toBeNull();
    expect(m.photo.legsAnchor).toBe('p0');
    expect(m.persons.p0).toEqual(splitLegacy(refined).person);
    // a 膚質 value 0.3 cannot see stays, so the person is no longer 精緻 (the no-cache paths open this unsanitized)
    const toned = { ...e, persons: { p0: { ...e.persons.p0, values: { ...e.persons.p0.values, 'tone.even': 0.6 } } } };
    const t = mergeLegacy(toned, refined, 'p0', stored);
    expect(t.persons.p0.values['tone.even']).toBe(0.6);
    expect(t.persons.p0.preset).toBe('custom');
  });
  it('the 增高 band: 0.3 draws it in O rows, so one it changed under a quarter turn is dropped; an unchanged one stays', () => {
    const all = PARAM_DEFS.map((d) => d.id);
    const band = { top: 0.5, bottom: 0.8, amount: 0.4 };
    const moved = { top: 0.2, bottom: 0.4, amount: 0.4 };
    const e = editFromLegacy({ ...defaultParams(), heightBand: band });
    const by03 = (b: typeof band) => ({ ...legacyProjection(e, 'p0'), heightBand: b });
    expect(mergeLegacy(e, by03(moved), 'p0', all).photo.heightBand).toEqual(moved);
    const turned = { ...editRotateLeft(e), photo: { ...editRotateLeft(e).photo, heightBand: band } };
    expect(mergeLegacy(turned, by03(band), 'p0', all).photo.heightBand).toEqual(band);
    expect(mergeLegacy(turned, by03(moved), 'p0', all).photo.heightBand).toBeNull();
    expect(mergeLegacy(turned, by03(moved), 'p0', all).photo.geometry).toEqual(turned.photo.geometry);
  });
  it('step 5: keeps right and the four new shades, which 0.3 can neither show nor write', () => {
    const e0 = editFromLegacy(applyPreset('glow', 1));
    const p0 = { ...e0.persons.p0, right: { 'shape.faceSlim': 0.9 }, shades: { ...e0.persons.p0.shades, brow: 'mocha', lens: 'blue' } };
    const m = mergeLegacy({ ...e0, persons: { p0 } }, applyPreset('refined', 1), 'p0', PARAM_DEFS.map((d) => d.id));
    expect(m.persons.p0.right).toEqual({ 'shape.faceSlim': 0.9 });
    expect(m.persons.p0.shades).toEqual({ ...emptyShades(), brow: 'mocha', lens: 'blue' });
  });
});
