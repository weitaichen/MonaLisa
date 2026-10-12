import { describe, expect, it } from 'vitest';
import { applyPreset, LIP_SHADES, setFilter, setParam, setShade } from '../engine/params';
import type { BeautyParams, EditState } from '../types';
import { editFromLegacy, legacyProjection } from './legacy';
import { lensFor, NO_BODY_NOTE, NO_FACE_NOTE, P0_INFO, type PersonInfo } from './lens';
import { assignPersons, defaultPhoto, naturalPerson, neutralPerson, personFromPreset } from './state';

const three: PersonInfo[] = [
  { id: 'f0', face: true, body: true },
  { id: 'f1', face: true, body: false },
  { id: 'b0', face: false, body: true },
];
function group(): EditState {
  const e: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
  return assignPersons(e, ['f0', 'f1', 'b0'], 'f0');
}
const one = (id: string) => ({ kind: 'person' as const, id });
const all = { kind: 'all' as const };

describe('lens routing (RM §3.3)', () => {
  it('photo items write the photo whatever the selection; 美白 breaks the preset link only', () => {
    const e = lensFor(group(), one('f1'), three, 'f0').set('skin.whiten', 0.9);
    expect(e.photo.values['skin.whiten']).toBe(0.9);
    expect(e.photo.presetLink).toBeNull();
    expect(e.persons.f1.preset).toEqual({ id: 'original', amount: 1 });
  });
  it('a person item writes the selected person only, and marks its preset custom', () => {
    const e0 = group();
    const e = lensFor(e0, one('f1'), three, 'f0').set('shape.eyeEnlarge', 0.7);
    expect(e.persons.f1.values['shape.eyeEnlarge']).toBe(0.7);
    expect(e.persons.f1.preset).toBe('custom');
    expect(e.persons.f0).toBe(e0.persons.f0);
  });
  it('refuses face items for a body-only person and local body items for a face-only person, with the notes', () => {
    const l = lensFor(group(), one('b0'), three, 'f0');
    expect(l.set('shape.eyeEnlarge', 0.7)).toBe(l.edit);
    expect(l.applies('skin.smooth')).toEqual({ ok: false, reason: NO_FACE_NOTE });
    expect(lensFor(group(), one('f1'), three, 'f0').applies('body.waist')).toEqual({ ok: false, reason: NO_BODY_NOTE });
    expect(lensFor(group(), one('f1'), three, 'f0').applies('body.legs').ok).toBe(true);
  });
  it('全部 writes every applicable person and reads the primary; mixed compares display values', () => {
    const e = lensFor(group(), all, three, 'f0').set('shape.faceSlim', 0.6);
    expect([e.persons.f0, e.persons.f1].map((p) => p.values['shape.faceSlim'])).toEqual([0.6, 0.6]);
    expect(e.persons.b0.values['shape.faceSlim']).toBe(0);
    const near = lensFor(e, one('f1'), three, 'f0').set('shape.faceSlim', 0.6049);
    expect(lensFor(near, all, three, 'f0').get('shape.faceSlim')).toEqual({ value: 0.6, mixed: false });
    const far = lensFor(e, one('f1'), three, 'f0').set('shape.faceSlim', 0.3451);
    expect(lensFor(far, all, three, 'f0').get('shape.faceSlim').mixed).toBe(true);
  });
  it('under 全部, a primary that does not apply reads the first applicable person', () => {
    const e = lensFor(group(), one('b0'), three, 'f0').set('body.waist', 0.4);
    expect(lensFor(e, all, three, 'f1').get('body.waist').value).toBe(0);
    expect(lensFor(e, all, [three[1], three[2]], 'f1').get('body.waist').value).toBe(0.4);
  });
  it('a photo with no face: 磨皮 and 紅潤 read and write the primary (all skin); 美型 is refused', () => {
    const p0: PersonInfo[] = [{ id: 'p0', face: false, body: false }];
    const e: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const l = lensFor(e, one('p0'), p0, 'p0');
    expect(l.noFace).toBe(true);
    expect(l.set('skin.smooth', 0.9).persons.p0.values['skin.smooth']).toBe(0.9);
    expect(l.applies('shape.chin').ok).toBe(false);
  });
  it('長腿 records the anchor: the selected body person, null under 全部 or for a person without a body', () => {
    expect(lensFor(group(), one('f0'), three, 'f0').set('body.legs', 0.5).photo.legsAnchor).toBe('f0');
    expect(lensFor(group(), one('f1'), three, 'f0').set('body.legs', 0.5).photo.legsAnchor).toBeNull();
    expect(lensFor(group(), all, three, 'f0').set('body.legs', 0.5).photo.legsAnchor).toBeNull();
  });
});

describe('presets and 程度 (RM §3.4)', () => {
  it('apply: the person part to the targets, the photo part to the photo with the link', () => {
    const e = lensFor(group(), one('f1'), three, 'f0').applyPreset('refined', 0.6);
    expect(e.persons.f1.preset).toEqual({ id: 'refined', amount: 0.6 });
    expect(e.persons.f0.preset).toEqual({ id: 'natural', amount: 1 });
    expect(e.photo.filterId).toBe('soft');
    expect(e.photo.presetLink).toEqual({ id: 'refined', amount: 0.6 });
    expect(e.persons.f1.values['shape.eyeEnlarge']).toBeCloseTo(personFromPreset('refined', 0.6).values['shape.eyeEnlarge']);
  });
  it('a body-only person: presets change the photo part only', () => {
    const e0 = group();
    const e = lensFor(e0, one('b0'), three, 'f0').applyPreset('glow', 1);
    expect(e.persons).toBe(e0.persons);
    expect(e.photo.presetLink).toEqual({ id: 'glow', amount: 1 });
  });
  it('程度 rescales the person part; the photo part only while the link holds', () => {
    const l = lensFor(lensFor(group(), all, three, 'f0').applyPreset('refined', 1), all, three, 'f0');
    const half = l.setPresetAmount(0.5);
    expect(half.persons.f0.preset).toEqual({ id: 'refined', amount: 0.5 });
    expect(half.photo.values['skin.whiten']).toBeCloseTo(0.15);
    const unlinked = lensFor(l.set('skin.whiten', 0.9), all, three, 'f0').setPresetAmount(0.5);
    expect(unlinked.photo.values['skin.whiten']).toBe(0.9);
  });
  it('under 全部: 自然 reaches a person already at 精緻 although the primary is 自然; preset() is mixed', () => {
    const e = lensFor(group(), one('f1'), three, 'f0').applyPreset('refined', 1);
    const l = lensFor(e, all, three, 'f0');
    expect(l.preset().mixed).toBe(true);
    expect(l.applyPreset('natural', 1).persons.f1.preset).toEqual({ id: 'natural', amount: 1 });
  });
  it('shades under 全部: mixed until every face person matches', () => {
    const e = lensFor(group(), one('f0'), three, 'f0').setShade('lip', LIP_SHADES[0].id);
    const l = lensFor(e, all, three, 'f0');
    expect(l.shade('lip')).toMatchObject({ shade: LIP_SHADES[0].id, on: true, mixed: true });
    expect(lensFor(l.setShade('lip', LIP_SHADES[0].id), all, three, 'f0').shade('lip').mixed).toBe(false);
  });
});

describe('⊘ and 重置 (RM §2.1 notes)', () => {
  it('⊘ 美膚 on one person of a group leaves 美白 / 銳化 and the other persons', () => {
    const e0 = group();
    const e = lensFor(e0, one('f1'), three, 'f0').resetGroup('skin');
    expect(e.photo).toBe(e0.photo);
    expect(e.persons.f1.values['skin.smooth']).toBe(0);
    expect(e.persons.f0).toBe(e0.persons.f0);
  });
  it('⊘ under 全部, or with one person, also resets the photo items (v0.3 behaviour)', () => {
    expect(lensFor(group(), all, three, 'f0').resetGroup('skin').photo.values['skin.whiten']).toBe(0);
    const single: EditState = { v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const r = lensFor(single, one('p0'), P0_INFO, 'p0').resetGroup('skin');
    expect(r.photo.values['skin.whiten']).toBe(0);
    expect(legacyProjection(r, 'p0').presetId).toBe('custom');
  });
  it('⊘ 美體 no-op check tests exactly its targets', () => {
    const e = lensFor(group(), one('b0'), three, 'f0').set('body.waist', 0.5);
    expect(lensFor(e, one('f0'), three, 'f0').groupNeutral('body')).toBe(true);
    expect(lensFor(e, one('b0'), three, 'f0').groupNeutral('body')).toBe(false);
  });
  it('重置 is every person 自然 and the 自然 photo part', () => {
    const e = lensFor(group(), all, three, 'f0').reset();
    expect(e.persons.f1).toEqual(naturalPerson());
    expect(e.photo).toEqual(defaultPhoto());
  });
});

describe('one person p0 is v0.3 (parity of every op through the projection)', () => {
  it('preset hop keeps 程度 and the body edits like applyPreset(id, amount, keep)', () => {
    const v1 = setParam(applyPreset('natural', 0.6), 'body.waist', 0.4);
    const e = editFromLegacy(v1);
    const l = lensFor(e, one('p0'), P0_INFO, 'p0');
    expect(legacyProjection(e, 'p0')).toEqual(v1);
    expect(legacyProjection(l.applyPreset('refined', 0.6), 'p0')).toEqual(applyPreset('refined', 0.6, v1));
    // presetAmount is dead data while custom: compare it canonicalized (legacy.test.ts)
    const canon = (p: BeautyParams): BeautyParams => (p.presetId === 'custom' ? { ...p, presetAmount: 1 } : p);
    expect(legacyProjection(l.set('shape.chin', 0.7), 'p0')).toEqual(canon(setParam(v1, 'shape.chin', 0.7)));
    expect(legacyProjection(l.set('body.hip', 0.7), 'p0')).toEqual(setParam(v1, 'body.hip', 0.7));
    expect(legacyProjection(l.setFilter('mono'), 'p0')).toEqual(canon(setFilter(v1, 'mono')));
    expect(legacyProjection(l.setShade('blush', 'peach'), 'p0')).toEqual(canon(setShade(v1, 'blush', 'peach')));
  });
});
