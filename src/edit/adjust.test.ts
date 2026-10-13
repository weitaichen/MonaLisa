// 質感 and 調節 in the edit model (step-2 spec §3.3–3.4, §5; C §3.3–3.4).
import { describe, expect, it } from 'vitest';
import { applyPreset } from '../engine/params';
import type { AdjustId, EditState, PhotoParams } from '../types';
import { legacyProjection, splitLegacy } from './legacy';
import { lensFor } from './lens';
import {
  adjustIsNeutral,
  defaultPhoto,
  editKey,
  naturalPerson,
  neutralPerson,
  resetAdjust,
  sanitizeEditState,
  sanitizePhotoLook,
  setLook,
} from './state';

const ADJUST: AdjustId[] = [
  'adjust.brightness', 'adjust.exposure', 'adjust.contrast', 'adjust.highlights', 'adjust.shadows', 'adjust.temperature',
  'adjust.tint', 'adjust.saturation', 'adjust.vibrance', 'adjust.fade', 'adjust.grain', 'adjust.vignette',
];
const neutral = (id: AdjustId) => (id === 'adjust.fade' || id === 'adjust.grain' || id === 'adjust.vignette' ? 0 : 0.5);

const edit = (photo: Partial<PhotoParams> = {}, persons: Record<string, ReturnType<typeof naturalPerson>> = { p0: naturalPerson() }): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), ...photo },
  persons,
  template: neutralPerson(),
  primaryInit: null,
});
const withValues = (over: Partial<Record<AdjustId, number>>, look: PhotoParams['look'] = null): EditState => {
  const p = defaultPhoto();
  return edit({ values: { ...p.values, ...over }, look });
};

describe('defaultPhoto / setLook / resetAdjust', () => {
  it('defaultPhoto has neutral 調節 and no look', () => {
    const p = defaultPhoto();
    for (const id of ADJUST) expect(p.values[id], id).toBe(neutral(id));
    expect(p.look).toBeNull();
    expect(adjustIsNeutral(p)).toBe(true);
  });

  it('setLook sets, clamps the amount, returns the same object when equal, null clears; the rest is shared', () => {
    const e0 = edit();
    const e1 = setLook(e0, 'film', 0.8);
    expect(e1.photo.look).toEqual({ id: 'film', amount: 0.8 });
    expect(e1.persons).toBe(e0.persons);
    expect(e1.photo.values).toBe(e0.photo.values);
    expect(setLook(e1, 'film', 0.8)).toBe(e1);
    expect(setLook(e1, 'ccd', 7).photo.look).toEqual({ id: 'ccd', amount: 1 });
    expect(setLook(e1, 'ccd', Number.NaN).photo.look).toEqual({ id: 'ccd', amount: 0 });
    expect(setLook(e1, null, 0.8).photo.look).toBeNull();
    expect(setLook(e0, null, 0)).toBe(e0);
  });

  it('resetAdjust neutralizes the 12 values, keeps the look and every other field; a neutral photo is returned as is', () => {
    const e = withValues({ 'adjust.exposure': 0.8, 'adjust.grain': 0.4 }, { id: 'blue', amount: 0.5 });
    const r = resetAdjust(e);
    for (const id of ADJUST) expect(r.photo.values[id]).toBe(neutral(id));
    expect(r.photo.look).toEqual({ id: 'blue', amount: 0.5 });
    expect(r.photo.values['skin.whiten']).toBe(e.photo.values['skin.whiten']);
    expect(r.persons).toBe(e.persons);
    const n = edit();
    expect(resetAdjust(n)).toBe(n);
  });
});

describe('the lens routes 調節 and 質感 to the photo (C §3.3)', () => {
  const two = () =>
    edit({}, { f0: naturalPerson(), f1: { ...naturalPerson(), preset: 'custom' } });
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'f1', face: true, body: false },
  ];

  it('adjust ids write photo.values under a person selection and under 全部, persons untouched', () => {
    for (const sel of [{ kind: 'person', id: 'f1' } as const, { kind: 'all' } as const]) {
      const e = two();
      const l = lensFor(e, sel, persons, 'f0');
      const next = l.set('adjust.exposure', 0.7);
      expect(next.photo.values['adjust.exposure']).toBe(0.7);
      expect(next.persons).toBe(e.persons);
      expect(lensFor(next, sel, persons, 'f0').get('adjust.exposure')).toEqual({ value: 0.7, mixed: false });
    }
  });

  it('look() / setLook / resetGroup("adjust")', () => {
    const e = two();
    const l = lensFor(e, { kind: 'person', id: 'f0' }, persons, 'f0');
    expect(l.look()).toBeNull();
    const withLook = l.setLook('cinema', 0.6);
    expect(lensFor(withLook, { kind: 'all' }, persons, 'f0').look()).toEqual({ id: 'cinema', amount: 0.6 });
    const dirty = lensFor(withLook, { kind: 'all' }, persons, 'f0').set('adjust.vignette', 0.5);
    const reset = lensFor(dirty, { kind: 'all' }, persons, 'f0').resetGroup('adjust');
    expect(reset).toEqual(resetAdjust(dirty));
    expect(reset.photo.look).toEqual({ id: 'cinema', amount: 0.6 });
    // a person selection in a group photo (the editor's default): ⊘ still resets the whole 調節 tab (step-2 spec §3.4)
    const bySel = lensFor(dirty, { kind: 'person', id: 'f1' }, persons, 'f0').resetGroup('adjust');
    expect(bySel.photo.values['adjust.vignette']).toBe(0);
    expect(bySel).toEqual(resetAdjust(dirty));
    expect(bySel.photo.look).toEqual({ id: 'cinema', amount: 0.6 });
    // resetGroup('adjust') is resetAdjust itself: a neutral photo comes back as the same object
    const clean = two();
    expect(lensFor(clean, { kind: 'all' }, persons, 'f0').resetGroup('adjust')).toBe(clean);
  });

  it('a beauty preset never touches 調節 or the look (C §3.4)', () => {
    const e = withValues({ 'adjust.contrast': 0.9 }, { id: 'ccd', amount: 0.8 });
    const next = lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0').applyPreset('refined', 1);
    expect(next.photo.values['adjust.contrast']).toBe(0.9);
    expect(next.photo.look).toEqual({ id: 'ccd', amount: 0.8 });
  });

  it('the step-2 spec §3.3 table: 重置 clears both; 濾鏡, 調節 and 質感 edits leave each other and the preset link alone', () => {
    const styled = withValues({ 'adjust.exposure': 0.9, 'adjust.grain': 0.4 }, { id: 'film', amount: 0.8 });
    const l = lensFor(styled, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: true, body: false }], 'p0');
    const link = styled.photo.presetLink;
    expect(link).not.toBeNull(); // defaultPhoto() is linked to 自然 100
    // 重置 (RM §3.4): defaultPhoto() — no look, the 12 values neutral
    const reset = l.reset();
    expect(reset.photo.look).toBeNull();
    for (const id of ADJUST) expect(reset.photo.values[id], id).toBe(neutral(id));
    // picking a 濾鏡 keeps the look and the 調節 values
    const filtered = l.setFilter('warm');
    expect(filtered.photo.look).toEqual({ id: 'film', amount: 0.8 });
    expect(filtered.photo.values['adjust.exposure']).toBe(0.9);
    // a 調節 drag and a 質感 pick keep the preset link and every person's preset
    expect(l.set('adjust.contrast', 0.7).photo.presetLink).toEqual(link);
    const picked = setLook(styled, 'ccd', 0.5);
    expect(picked.photo.presetLink).toEqual(link);
    expect(picked.persons).toBe(styled.persons);
  });
});

describe('sanitize, keys and legacy (step-2 spec §5)', () => {
  it('sanitizePhotoLook keeps a valid look (amount clamped) and drops everything else', () => {
    expect(sanitizePhotoLook({ id: 'film', amount: 0.8 })).toEqual({ id: 'film', amount: 0.8 });
    expect(sanitizePhotoLook({ id: 'film', amount: 4 })).toEqual({ id: 'film', amount: 1 });
    expect(sanitizePhotoLook({ id: 'portra', amount: 0.8 })).toBeNull();
    expect(sanitizePhotoLook({ id: 'film', amount: Number.NaN })).toBeNull();
    expect(sanitizePhotoLook({ id: 'film' })).toBeNull();
    expect(sanitizePhotoLook('film')).toBeNull();
    expect(sanitizePhotoLook(undefined)).toBeNull();
  });

  it('sanitizeEditState: junk adjust values → neutral, values clamped, a missing look (a step-1 record) → null', () => {
    const raw = JSON.parse(JSON.stringify(withValues({ 'adjust.exposure': 0.75 }))) as { photo: Record<string, unknown> };
    (raw.photo.values as Record<string, unknown>)['adjust.grain'] = 'lots';
    (raw.photo.values as Record<string, unknown>)['adjust.fade'] = 3;
    delete (raw.photo.values as Record<string, unknown>)['adjust.tint'];
    delete raw.photo.look;
    const s = sanitizeEditState(raw, null);
    expect(s.photo.values['adjust.exposure']).toBe(0.75);
    expect(s.photo.values['adjust.grain']).toBe(0);
    expect(s.photo.values['adjust.fade']).toBe(1);
    expect(s.photo.values['adjust.tint']).toBe(0.5);
    expect(s.photo.look).toBeNull();
    (raw.photo as Record<string, unknown>).look = { id: 'nope', amount: 0.5 };
    expect(sanitizeEditState(raw, null).photo.look).toBeNull();
    (raw.photo as Record<string, unknown>).look = { id: 'flash', amount: -2 };
    expect(sanitizeEditState(raw, null).photo.look).toEqual({ id: 'flash', amount: 0 });
  });

  it('editKey changes with every adjust value and with the look id and amount', () => {
    const base = edit();
    const k0 = editKey(base);
    for (const id of ADJUST) expect(editKey(withValues({ [id]: neutral(id) === 0 ? 0.3 : 0.7 })), id).not.toBe(k0);
    const a = editKey(setLook(base, 'film', 0.8));
    expect(a).not.toBe(k0);
    expect(editKey(setLook(base, 'film', 0.7))).not.toBe(a);
    expect(editKey(setLook(base, 'ccd', 0.8))).not.toBe(a);
  });

  it('a v1 BeautyParams splits into neutral 調節 and no look; the legacy projection keeps every v0.3 field', () => {
    const { photo } = splitLegacy(applyPreset('glow', 1));
    for (const id of ADJUST) expect(photo.values[id]).toBe(neutral(id));
    expect(photo.look).toBeNull();
    const plain = edit();
    const styled = setLook(withValues({ 'adjust.exposure': 0.9 }), 'film', 0.8);
    // a 0.3 build reads only the v0.3 fields of the projection (C §5.1): 調節 and 質感 must not change them
    const v03 = (p: ReturnType<typeof legacyProjection>) => ({
      ...p,
      values: Object.fromEntries(Object.entries(p.values).filter(([k]) => !k.startsWith('adjust.'))),
    });
    expect(v03(legacyProjection(styled, 'p0'))).toEqual(v03(legacyProjection(plain, 'p0')));
  });
});
