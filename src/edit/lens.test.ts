import { describe, expect, it } from 'vitest';
import { applyPreset, LIP_SHADES, setFilter, setParam, setShade, SPLIT_IDS } from '../engine/params';
import type { BeautyParams, EditState, PersonParams } from '../types';
import { editFromLegacy, legacyProjection, splitLegacy } from './legacy';
import { LIVE_PERSONS, lensFor, NO_BODY_NOTE, NO_FACE_NOTE, P0_INFO, type PersonInfo } from './lens';
import { splitOn } from './sides';
import { assignPersons, cameraEdit, defaultPhoto, emptyShades, LIVE, lookOf, naturalPerson, neutralPerson, personFromPreset } from './state';
import { TONE_COPY } from './toneCopy';

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

describe('the camera lens: one person, live (RM §3.7)', () => {
  it('writes the live person and the photo through lookOf; 長腿 never anchors (no body in the camera)', () => {
    const look = splitLegacy(applyPreset('glow', 0.5));
    const l = lensFor(cameraEdit(look), one(LIVE), LIVE_PERSONS, LIVE);
    expect(l.applies('shape.chin').ok).toBe(true);
    const e = lookOf(l.set('shape.chin', 0.7));
    expect(e.person.values['shape.chin']).toBe(0.7);
    expect(e.person.preset).toBe('custom');
    expect(e.photo).toBe(look.photo);
    expect(lookOf(l.set('skin.whiten', 1)).photo.values['skin.whiten']).toBe(1);
    expect(l.set('body.legs', 0.5).photo.legsAnchor).toBeNull();
  });
});

describe('step 4 tone items (skin-cleanup spec §3.1, §3.6)', () => {
  const persons = [
    { id: 'f0', face: true, body: false },
    { id: 'b0', face: false, body: true },
  ];
  const base = () => ({
    v: 2 as const,
    photo: { ...defaultPhoto(), spots: [{ x: 0.3, y: 0.3, r: 0.02, dx: 0, dy: 0, owner: 'f0' }] },
    persons: { f0: neutralPerson(), b0: neutralPerson() },
    template: neutralPerson(),
    primaryInit: null,
  });

  it('a tone edit writes the selected person, marks it 自訂 and never touches presetLink', () => {
    const e0 = base();
    const e1 = lensFor(e0, { kind: 'person', id: 'f0' }, persons, 'f0').set('tone.even', 0.6);
    expect(e1.persons.f0.values['tone.even']).toBe(0.6);
    expect(e1.persons.f0.preset).toBe('custom');
    expect(e1.photo.presetLink).toEqual(e0.photo.presetLink);
  });

  it('a person without a face refuses; under 全部 only face persons are written', () => {
    const lens = lensFor(base(), { kind: 'person', id: 'b0' }, persons, 'f0');
    expect(lens.applies('tone.darkCircle').ok).toBe(false);
    const all = lensFor(base(), { kind: 'all' }, persons, 'f0').set('tone.darkCircle', 0.8);
    expect(all.persons.f0.values['tone.darkCircle']).toBe(0.8);
    expect(all.persons.b0.values['tone.darkCircle']).toBe(0);
  });

  it('a photo without any face refuses every tone item with 未偵測到臉部，膚質工具不會套用; 磨皮 keeps its all-skin exception', () => {
    const e = { ...base(), persons: { p0: neutralPerson() } };
    const lens = lensFor(e, { kind: 'person', id: 'p0' }, [{ id: 'p0', face: false, body: false }], 'p0');
    for (const id of ['tone.even', 'tone.warmth', 'tone.darkCircle', 'tone.nasolabial', 'tone.teeth', 'tone.eyeBright'] as const) {
      expect(lens.applies(id)).toEqual({ ok: false, reason: TONE_COPY.noFace });
    }
    expect(lens.applies('skin.smooth').ok).toBe(true);
  });

  it('a beauty preset resets the tone items to neutral (§12 #31)', () => {
    const lens0 = lensFor(base(), { kind: 'person', id: 'f0' }, persons, 'f0');
    const e1 = lens0.set('tone.warmth', 0.9);
    const e2 = lensFor(e1, { kind: 'person', id: 'f0' }, persons, 'f0').applyPreset('natural', 1);
    expect(e2.persons.f0.values['tone.warmth']).toBe(0.5);
  });

  it('⊘ of the 美膚 strip resets the tone items too, and keeps the spots', () => {
    const e1 = lensFor(base(), { kind: 'person', id: 'f0' }, persons, 'f0').set('tone.teeth', 0.7);
    const e2 = lensFor(e1, { kind: 'person', id: 'f0' }, persons, 'f0').resetGroup('skin');
    expect(e2.persons.f0.values['tone.teeth']).toBe(0);
    expect(e2.photo.spots).toEqual(e1.photo.spots);
  });
});

const P = (over: Partial<PersonParams> = {}): PersonParams => ({ ...naturalPerson(), ...over });
const E = (persons: Record<string, PersonParams>): EditState => ({ v: 2, photo: defaultPhoto(), persons, template: neutralPerson(), primaryInit: null });
const onePerson = (swap = false): PersonInfo[] => [{ id: 'f0', face: true, body: false, screenSwap: swap }];
const twoPersons = (swap0 = false, swap1 = false): PersonInfo[] => [
  { id: 'f0', face: true, body: false, screenSwap: swap0 },
  { id: 'f1', face: true, body: false, screenSwap: swap1 },
];
const SEL0 = { kind: 'person', id: 'f0' } as const;
const ALL = { kind: 'all' } as const;

describe('lens: sides and 左右分開 (face-detail spec §3.4)', () => {
  it('setSplit on copies the six values and marks the person 自訂; off keeps the active side', () => {
    const e0 = E({ f0: P() });
    const on = lensFor(e0, SEL0, onePerson(), 'f0').setSplit(true, 'L');
    expect(on.persons.f0.right).toEqual(Object.fromEntries(SPLIT_IDS.map((id) => [id, e0.persons.f0.values[id]])));
    expect(on.persons.f0.preset).toBe('custom');
    const edited = lensFor(on, SEL0, onePerson(), 'f0').set('shape.faceSlim', 0.9, 'R');
    expect(edited.persons.f0.right?.['shape.faceSlim']).toBe(0.9);
    expect(lensFor(edited, SEL0, onePerson(), 'f0').setSplit(false, 'R').persons.f0.values['shape.faceSlim']).toBe(0.9);
    const offL = lensFor(edited, SEL0, onePerson(), 'f0').setSplit(false, 'L').persons.f0;
    expect(offL.values['shape.faceSlim']).toBe(e0.persons.f0.values['shape.faceSlim']);
    expect(offL.right).toBeNull();
  });

  it('side writes and reads follow screenSwap', () => {
    const on = lensFor(E({ f0: P() }), SEL0, onePerson(), 'f0').setSplit(true, 'L');
    const a = lensFor(on, SEL0, onePerson(false), 'f0').set('shape.jawline', 0.6, 'L').persons.f0;
    expect([a.values['shape.jawline'], a.right?.['shape.jawline']]).toEqual([0.6, 0]);
    const b = lensFor(on, SEL0, onePerson(true), 'f0').set('shape.jawline', 0.6, 'L').persons.f0;
    expect([b.values['shape.jawline'], b.right?.['shape.jawline']]).toEqual([0, 0.6]);
    const lb = lensFor({ ...on, persons: { f0: b } }, SEL0, onePerson(true), 'f0');
    expect([lb.get('shape.jawline', 'L').value, lb.get('shape.jawline', 'R').value]).toEqual([0.6, 0]);
  });

  it('without a side, for a non-split item, or while right is null: values only, right never created', () => {
    const e0 = E({ f0: P() });
    const a = lensFor(e0, SEL0, onePerson(), 'f0').set('shape.faceSlim', 0.4, 'R').persons.f0;
    expect(a.right).toBeNull();
    expect(a.values['shape.faceSlim']).toBe(0.4);
    const on = lensFor(e0, SEL0, onePerson(), 'f0').setSplit(true, 'L');
    const b = lensFor(on, SEL0, onePerson(), 'f0').set('shape.faceSlim', 0.7).persons.f0;
    expect(b.values['shape.faceSlim']).toBe(0.7);
    expect(b.right?.['shape.faceSlim']).toBe(on.persons.f0.right?.['shape.faceSlim']);
    expect(lensFor(on, SEL0, onePerson(), 'f0').get('shape.chin', 'R').value).toBe(on.persons.f0.values['shape.chin']);
  });

  it('全部: the reference person decides the switch, a tap sets everyone to the opposite, existing right is kept', () => {
    const f1 = splitOn(P({ values: { ...naturalPerson().values, 'shape.faceSlim': 0.3 } }));
    const e = E({ f0: P(), f1: { ...f1, right: { ...f1.right, 'shape.faceSlim': 0.8 } } });
    const lens = lensFor(e, ALL, twoPersons(), 'f0');
    expect(lens.split()).toBe(false);
    const on = lens.setSplit(true, 'L');
    expect(on.persons.f0.right).not.toBeNull();
    expect(on.persons.f1.right?.['shape.faceSlim']).toBe(0.8);
    expect(lensFor(on, ALL, twoPersons(), 'f0').split()).toBe(true);
    const off = lensFor(on, ALL, twoPersons(), 'f0').setSplit(false, 'R');
    expect([off.persons.f0.right, off.persons.f1.right]).toEqual([null, null]);
    expect(off.persons.f1.values['shape.faceSlim']).toBe(0.8);
  });

  it('全部: mixed compares the requested side; each face maps its own screen side', () => {
    const f0 = splitOn(P());
    const f1 = splitOn(P());
    const e = E({ f0, f1: { ...f1, right: { ...f1.right, 'shape.temple': 0.9 } } });
    const lens = lensFor(e, ALL, twoPersons(false, false), 'f0');
    expect(lens.get('shape.temple', 'L').mixed).toBe(false);
    expect(lens.get('shape.temple', 'R').mixed).toBe(true);
    const w = lensFor(e, ALL, twoPersons(false, true), 'f0').set('shape.temple', 0.2, 'L');
    expect(w.persons.f0.values['shape.temple']).toBe(0.2);
    expect(w.persons.f1.right?.['shape.temple']).toBe(0.2);
    expect(w.persons.f1.values['shape.temple']).toBe(0.5);
  });

  it('a side write leaves the persons it does not write as they were (same objects)', () => {
    // f0 is not selected, but its 左 is its `right` (screenSwap), and its `right` lacks the item (a sanitized entry)
    const e = E({ f0: { ...P(), right: { 'shape.faceSlim': 0.3 } }, f1: splitOn(P()) });
    const w = lensFor(e, { kind: 'person', id: 'f1' }, twoPersons(true, false), 'f0').set('shape.temple', 0.2, 'L');
    expect(w.persons.f1.values['shape.temple']).toBe(0.2);
    expect(w.persons.f0).toBe(e.persons.f0);
  });

  it('⊘ on 美型 clears right; resetGroup("makeup") clears every part and all six shades', () => {
    const on = lensFor(E({ f0: P() }), SEL0, onePerson(), 'f0').setSplit(true, 'L');
    expect(lensFor(on, SEL0, onePerson(), 'f0').resetGroup('shape').persons.f0.right).toBeNull();
    const made = E({
      f0: P({
        values: { ...naturalPerson().values, 'makeup.liner': 0.6, 'makeup.lens': 0.5 },
        shades: { ...emptyShades(), liner: 'wine', lens: 'blue', lip: 'rose' },
      }),
    });
    const out = lensFor(made, SEL0, onePerson(), 'f0').resetGroup('makeup').persons.f0;
    expect(out.shades).toEqual(emptyShades());
    expect([out.values['makeup.liner'], out.values['makeup.lens']]).toEqual([0, 0]);
  });

  it('ensureOn only where the part is off; clearMakeup zeroes one part (any of the ten) and its shade', () => {
    const e = E({ f0: P() });
    const a = lensFor(e, SEL0, onePerson(), 'f0').ensureOn('makeup.lashes', 0.55);
    expect(a.persons.f0.values['makeup.lashes']).toBe(0.55);
    expect(a.persons.f0.preset).toBe('custom');
    expect(lensFor(a, SEL0, onePerson(), 'f0').ensureOn('makeup.lashes', 0.9)).toBe(a);
    const b = E({ f0: P({ values: { ...naturalPerson().values, 'makeup.liner': 0.6, 'makeup.blush': 0.4 }, shades: { ...emptyShades(), liner: 'navy' } }) });
    const c = lensFor(b, SEL0, onePerson(), 'f0').clearMakeup('liner').persons.f0;
    expect([c.values['makeup.liner'], c.shades.liner, c.values['makeup.blush']]).toEqual([0, null, 0.4]);
    expect(lensFor(a, SEL0, onePerson(), 'f0').clearMakeup('lashes').persons.f0.values['makeup.lashes']).toBe(0);
    expect(lensFor(e, SEL0, onePerson(), 'f0').clearMakeup('aegyo')).toBe(e);
  });

  it('shade / setShade read each part’s own value (step 1’s makeupKey knew lip and blush only)', () => {
    const e = E({ f0: P({ values: { ...naturalPerson().values, 'makeup.blush': 0.4 } }) });
    const lens = lensFor(e, SEL0, onePerson(), 'f0');
    expect(lens.shade('lens').on).toBe(false);
    const s = lens.setShade('lens', 'blue').persons.f0;
    expect([s.values['makeup.lens'], s.shades.lens, s.values['makeup.blush']]).toEqual([0.6, 'blue', 0.4]);
    expect(lensFor({ ...e, persons: { f0: s } }, SEL0, onePerson(), 'f0').shade('lens')).toMatchObject({ shade: 'blue', on: true });
  });
});
