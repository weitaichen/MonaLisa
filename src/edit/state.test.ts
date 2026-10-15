import { describe, expect, it } from 'vitest';
import { applyPreset, neutralValue, PARAM_DEFS, paramDef, SHADE_PARTS, SHADES, SPLIT_IDS } from '../engine/params';
import { cropConstrain, cropValid, IDENTITY_GEOMETRY, rotateLeft } from '../geometry/view';
import type { EditState, Geometry, ParamId, PersonParams, Stroke } from '../types';
import { legacyProjection } from './legacy';
import { lensFor, P0_INFO } from './lens';
import {
  assignPersons,
  cameraEdit,
  clearStrokes,
  defaultPhoto,
  editFlipView,
  editKey,
  editResetGeometry,
  editRotateLeft,
  editSetGeometry,
  emptyShades,
  isEditStateRecord,
  lookOf,
  naturalPerson,
  neutralPerson,
  PERSON_IDS,
  PHOTO_IDS,
  renamePersons,
  resetAll,
  sanitizeEditState,
  sanitizeGeometry,
  withPersons,
  withStrokes,
} from './state';

describe('scope table (RM §3.1, step-1 subset)', () => {
  it('every ParamId has exactly one scope and the layers do not overlap', () => {
    for (const d of PARAM_DEFS) expect(['photo', 'person']).toContain(d.scope);
    expect([...PHOTO_IDS].sort()).toEqual([
      'adjust.brightness', 'adjust.contrast', 'adjust.exposure', 'adjust.fade', 'adjust.grain', 'adjust.highlights',
      'adjust.saturation', 'adjust.shadows', 'adjust.temperature', 'adjust.tint', 'adjust.vibrance', 'adjust.vignette',
      'body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten',
    ]);
    expect(PHOTO_IDS.length + PERSON_IDS.length).toBe(PARAM_DEFS.length);
    expect(PHOTO_IDS.filter((id) => (PERSON_IDS as readonly string[]).includes(id))).toEqual([]);
    const person = PARAM_DEFS.filter((d) => d.scope === 'person').map((d) => d.id);
    expect(person).toEqual(expect.arrayContaining(['skin.smooth', 'skin.rosy', 'makeup.lip', 'makeup.blush']));
    expect(person).toEqual(
      expect.arrayContaining(['tone.even', 'tone.warmth', 'tone.darkCircle', 'tone.nasolabial', 'tone.teeth', 'tone.eyeBright']),
    );
    expect(person).toEqual(
      expect.arrayContaining([
        'shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight',
        'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
      ]),
    );
    expect(person.filter((id) => id.startsWith('shape.'))).toHaveLength(15);
    expect(person.filter((id) => id.startsWith('body.'))).toHaveLength(9);
    expect(person.filter((id) => id.startsWith('tone.'))).toHaveLength(6);
  });
  it('live: everything but 美體 and 膚質 is offered in the camera', () => {
    for (const d of PARAM_DEFS) expect(d.live, d.id).toBe(d.group !== 'body' && d.group !== 'tone');
  });
});

describe('constructors', () => {
  it('defaultPhoto is the 自然 photo part, linked to 自然 100', () => {
    const n = applyPreset('natural', 1);
    const p = defaultPhoto();
    for (const id of PHOTO_IDS) expect(p.values[id]).toBe(n.values[id]);
    expect(p).toMatchObject({ filterId: 'none', presetLink: { id: 'natural', amount: 1 }, bodyProtect: true, heightBand: null, legsAnchor: null });
  });
  it('naturalPerson is the 自然 person part; neutralPerson is 原圖', () => {
    const n = applyPreset('natural', 1);
    const np = naturalPerson();
    for (const id of PERSON_IDS) expect(np.values[id]).toBe(n.values[id]);
    expect(np.preset).toEqual({ id: 'natural', amount: 1 });
    expect(neutralPerson().preset).toEqual({ id: 'original', amount: 1 });
    expect(neutralPerson().values['shape.chin']).toBe(0.5);
    expect(neutralPerson().values['skin.smooth']).toBe(0);
    expect(neutralPerson().shades).toEqual({ ...emptyShades(), lip: null, blush: null });
  });
  it('cameraEdit / lookOf round-trip the camera look through the one person "live"', () => {
    const look = { photo: defaultPhoto(), person: naturalPerson() };
    const e = cameraEdit(look);
    expect(Object.keys(e.persons)).toEqual(['live']);
    expect(lookOf(e)).toEqual(look);
  });
  it('editKey does not depend on key order; withPersons shares untouched persons', () => {
    const a = { v: 2 as const, photo: defaultPhoto(), persons: { f0: naturalPerson(), f1: neutralPerson() }, template: neutralPerson(), primaryInit: null };
    const b = { ...a, persons: { f1: a.persons.f1, f0: a.persons.f0 } };
    expect(editKey(a)).toBe(editKey(b));
    const c = withPersons(a, ['f0'], (p) => ({ ...p, preset: 'custom' }));
    expect(c.persons.f1).toBe(a.persons.f1);
    expect(c.persons.f0).not.toBe(a.persons.f0);
    expect(c.photo).toBe(a.photo);
  });
});

const edit0 = (over: Partial<EditState> = {}): EditState => ({
  v: 2,
  photo: defaultPhoto(),
  persons: { p0: { ...naturalPerson(), values: { ...naturalPerson().values, 'shape.eyeEnlarge': 0.8 }, preset: 'custom' } },
  template: neutralPerson(),
  primaryInit: naturalPerson(),
  ...over,
});

describe('assignPersons (S §3.3 item 4)', () => {
  it('gives p0 (the look plus every edit made meanwhile) to the primary and the template to everyone else', () => {
    const e = assignPersons(edit0(), ['f0', 'f1', 'f2'], 'f1');
    expect(Object.keys(e.persons)).toEqual(['f0', 'f1', 'f2']);
    expect(e.persons.f1.values['shape.eyeEnlarge']).toBe(0.8);
    expect(e.persons.f0).toEqual(neutralPerson());
    expect(e.primaryInit).toBeNull();
  });
  it('keeps persons it already has and keeps p0 when nobody was found', () => {
    const known = assignPersons(edit0(), ['f0'], 'f0');
    const more = assignPersons(known, ['f0', 'b1'], 'f0');
    expect(more.persons.f0).toBe(known.persons.f0);
    expect(more.persons.b1).toEqual(neutralPerson());
    const none = assignPersons(edit0(), ['p0'], 'p0');
    expect(Object.keys(none.persons)).toEqual(['p0']);
    expect(none.persons.p0.values['shape.eyeEnlarge']).toBe(0.8);
  });
  it('a 長腿 anchor on p0 follows p0 to the primary; discardP0 starts everyone from the template', () => {
    const e = edit0({ photo: { ...defaultPhoto(), legsAnchor: 'p0' } });
    expect(assignPersons(e, ['f0', 'f1'], 'f1').photo.legsAnchor).toBe('f1');
    expect(assignPersons(e, ['f0', 'f1'], 'f1', { discardP0: true }).persons.f1).toEqual(neutralPerson());
  });
  it('without p0 the primary starts from primaryInit (a camera shot), else the template', () => {
    expect(assignPersons({ ...edit0(), persons: {} }, ['f0', 'f1'], 'f0').persons.f0).toEqual(naturalPerson());
  });
});

describe('renamePersons (S §5.3 dropped cache)', () => {
  it('renames, drops unmatched (null) and lets the 長腿 anchor follow', () => {
    const e = assignPersons(edit0({ photo: { ...defaultPhoto(), legsAnchor: 'f1' } }), ['f0', 'f1'], 'f1');
    const r = renamePersons(e, { f1: 'f0', f0: null });
    expect(Object.keys(r.persons)).toEqual(['f0']);
    expect(r.persons.f0.values['shape.eyeEnlarge']).toBe(0.8);
    expect(r.photo.legsAnchor).toBe('f0');
  });
});

describe('resetAll (重置)', () => {
  it('sets the 自然 photo part and every person to 自然; keeps the template', () => {
    const e = resetAll(assignPersons(edit0(), ['f0', 'f1'], 'f0'));
    expect(e.photo).toEqual(defaultPhoto());
    expect(e.persons.f0).toEqual(naturalPerson());
    expect(e.persons.f1).toEqual(naturalPerson());
    expect(e.template).toEqual(neutralPerson());
  });
});

describe('sanitizeEditState (RM §3.4)', () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const KEYS = ['v', 'photo', 'persons', 'template', 'primaryInit', 'values', 'shades', 'preset', 'lip', 'blush', 'f0', 'p0', 'zz', 'id', 'amount', 'skin.smooth', 'skin.whiten', 'filterId', 'presetLink', 'legsAnchor', 'heightBand'];
  const junk = (r: () => number, depth = 0): unknown => {
    const k = Math.floor(r() * 9);
    if (depth > 3 || k < 3) return [NaN, Infinity, -1, 2, 0.5, 'x', null, true][Math.floor(r() * 8)];
    if (k < 5) return Array.from({ length: Math.floor(r() * 3) }, () => junk(r, depth + 1));
    return Object.fromEntries(Array.from({ length: 1 + Math.floor(r() * 5) }, () => [KEYS[Math.floor(r() * KEYS.length)], junk(r, depth + 1)]));
  };
  it('turns 2000 random records into valid, idempotent states', () => {
    const r = rng(9);
    for (let i = 0; i < 2000; i++) {
      const s = sanitizeEditState(junk(r), r() < 0.5 ? null : ['f0', 'p0']);
      for (const p of [s.template, ...Object.values(s.persons)]) for (const v of Object.values(p.values)) expect(v >= 0 && v <= 1).toBe(true);
      for (const v of Object.values(s.photo.values)) expect(v >= 0 && v <= 1).toBe(true);
      for (const id of Object.keys(s.persons)) expect(/^(f[0-5]|b[0-3]|p0|live)$/.test(id)).toBe(true);
      expect(sanitizeEditState(s, Object.keys(s.persons))).toEqual(s);
    }
  });
  it('drops persons not in the list, adds missing ones from the template, keeps all with null', () => {
    const e = assignPersons(edit0(), ['f0', 'f1'], 'f0');
    expect(Object.keys(sanitizeEditState(e, ['f1', 'b0']).persons).sort()).toEqual(['b0', 'f1']);
    expect(sanitizeEditState(e, ['f1', 'b0']).persons.b0).toEqual(e.template);
    expect(Object.keys(sanitizeEditState(e, null).persons).sort()).toEqual(['f0', 'f1']);
  });
  it('keeps a preset id only while the values still match it', () => {
    const p = naturalPerson();
    const off = { ...p, values: { ...p.values, 'shape.chin': 0.9 } };
    const s = sanitizeEditState({ ...edit0(), persons: { f0: p, f1: off } }, null);
    expect(s.persons.f0.preset).toEqual({ id: 'natural', amount: 1 });
    expect(s.persons.f1.preset).toBe('custom');
  });
  it('clamps out-of-range values and drops unknown filter, shade and preset ids', () => {
    const s = sanitizeEditState(
      {
        v: 2,
        photo: { values: { 'skin.whiten': 2, 'skin.sharpen': -1 }, filterId: 'nope', presetLink: { id: 'nope', amount: 1 } },
        persons: { f0: { values: { 'skin.smooth': -1, 'shape.chin': 2 }, shades: { lip: 'coral', blush: 'nope' }, preset: { id: 'nope', amount: 1 } } },
        template: { values: { 'skin.rosy': 5 } },
        primaryInit: { values: { 'skin.smooth': Infinity, 'makeup.lip': -3 } },
      },
      null,
    );
    expect(s.photo.values['skin.whiten']).toBe(1);
    expect(s.photo.values['skin.sharpen']).toBe(0);
    expect(s.photo).toMatchObject({ filterId: 'none', presetLink: null });
    expect(s.persons.f0.values['skin.smooth']).toBe(0);
    expect(s.persons.f0.values['shape.chin']).toBe(1);
    expect(s.persons.f0.shades).toEqual({ ...emptyShades(), lip: 'coral', blush: null });
    expect(s.persons.f0.preset).toBe('custom');
    expect(s.template.values['skin.rosy']).toBe(1);
    expect(s.primaryInit?.values['skin.smooth']).toBe(0);
    expect(s.primaryInit?.values['makeup.lip']).toBe(0);
  });
  it('fills a partial record from an intermediate dev build (Review Focus #5)', () => {
    const s = sanitizeEditState({ v: 2, photo: {}, persons: { p0: { values: { 'skin.smooth': 0.4 } } } }, null);
    expect(s.template).toEqual(neutralPerson());
    expect(s.primaryInit).toBeNull();
    expect(s.persons.p0.values['skin.smooth']).toBe(0.4);
    expect(s.persons.p0.values['shape.chin']).toBe(0.5);
    expect(s.persons.p0.shades).toEqual({ ...emptyShades(), lip: null, blush: null });
    expect(s.photo.filterId).toBe('none');
    expect(isEditStateRecord({ v: 1, photo: {}, persons: {} })).toBe(false);
    expect(isEditStateRecord({ v: 2, photo: {}, persons: {} })).toBe(true);
  });
});

const OSIZE = { width: 1536, height: 2048 };
const base = (): EditState => ({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });

describe('geometry in the edit state (step 3)', () => {
  it('defaultPhoto carries the identity geometry, so 重置 resets crop and rotation', () => {
    expect(defaultPhoto().geometry).toEqual(IDENTITY_GEOMETRY);
  });

  it('旋轉 clears the 增高 band in the same state; ↶ to the previous state brings both back (Review Focus 2)', () => {
    const banded: EditState = { ...base(), photo: { ...base().photo, heightBand: { top: 0.5, bottom: 0.9, amount: 0.6 } } };
    const turned = editRotateLeft(banded);
    expect(turned.photo.heightBand).toBeNull();
    expect(turned.photo.geometry.quarter).toBe(3);
    // one new state: the previous one is untouched, so one undo step restores geometry and band together
    expect(banded.photo.heightBand).toEqual({ top: 0.5, bottom: 0.9, amount: 0.6 });
    expect(banded.photo.geometry).toEqual(IDENTITY_GEOMETRY);
    expect(turned.persons).toBe(banded.persons);
  });

  it('翻轉 keeps the band; 還原 is one state and a no-op at identity; geometry changes the edit key', () => {
    const banded: EditState = { ...base(), photo: { ...base().photo, heightBand: { top: 0.5, bottom: 0.9, amount: 0.6 } } };
    const flipped = editFlipView(banded);
    expect(flipped.photo.heightBand).toEqual(banded.photo.heightBand);
    expect(flipped.photo.geometry.flipH).toBe(true);
    expect(editKey(flipped)).not.toBe(editKey(banded));
    const reset = editResetGeometry(flipped);
    expect(reset.photo.geometry).toEqual(IDENTITY_GEOMETRY);
    expect(editResetGeometry(reset)).toBe(reset);
    const g: Geometry = rotateLeft(IDENTITY_GEOMETRY);
    const e = editSetGeometry(base(), g);
    expect(editSetGeometry(e, g)).toBe(e);
  });

  it('sanitizeGeometry: identity without oSize; mistyped fields reset; float noise constrained; a far crop resets all', () => {
    const ok: Geometry = cropConstrain({ flipH: true, quarter: 1, straighten: 12.3, crop: { x: 0.1, y: 0.1, w: 0.7, h: 0.6 } }, OSIZE);
    expect(sanitizeGeometry(ok)).toEqual(IDENTITY_GEOMETRY);
    expect(sanitizeGeometry(ok, OSIZE)).toEqual(ok);
    const small: Geometry = { flipH: false, quarter: 0, straighten: 99, crop: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } };
    expect(sanitizeGeometry(small, OSIZE).straighten).toBe(45);
    expect(sanitizeGeometry({ ...ok, quarter: 7, flipH: 'yes' }, OSIZE)).toMatchObject({ quarter: 0, flipH: false });
    // a crop on the valid region's edge, nudged 5e-5 past it: invalid as stored, so only the ≤ 1e-4 rule keeps it (S §5)
    const edge = cropConstrain({ flipH: false, quarter: 0, straighten: 10, crop: { x: 0, y: 0, w: 1, h: 1 } }, OSIZE);
    const noisy = { ...edge, crop: { ...edge.crop, w: edge.crop.w + 5e-5 } };
    expect(cropValid(noisy, OSIZE)).toBe(false);
    const fixed = sanitizeGeometry(noisy, OSIZE);
    expect(fixed).not.toEqual(IDENTITY_GEOMETRY);
    expect(cropValid(fixed, OSIZE)).toBe(true);
    expect(fixed.straighten).toBe(10);
    expect(fixed.crop.w).toBeLessThanOrEqual(noisy.crop.w);
    expect(sanitizeGeometry({ ...ok, crop: { x: 0.6, y: 0.6, w: 0.9, h: 0.9 } }, OSIZE)).toEqual(IDENTITY_GEOMETRY);
    expect(sanitizeGeometry({ ...ok, crop: { x: Number.NaN, y: 0, w: 1, h: 1 } }, OSIZE)).toEqual(IDENTITY_GEOMETRY);
    expect(sanitizeGeometry('garbage', OSIZE)).toEqual(IDENTITY_GEOMETRY);
  });

  it('sanitizeEditState threads oSize to the geometry (S D13); the camera look (no oSize) is always identity', () => {
    const raw = { ...base(), photo: { ...base().photo, geometry: rotateLeft(IDENTITY_GEOMETRY) } };
    expect(sanitizeEditState(raw, null, OSIZE).photo.geometry.quarter).toBe(3);
    expect(sanitizeEditState(raw, null).photo.geometry).toEqual(IDENTITY_GEOMETRY);
  });
});

describe('step 4: spots in the photo params', () => {
  it('defaultPhoto has no spots (重置 clears them, C §3.4)', () => {
    expect(defaultPhoto().spots).toEqual([]);
  });
});

describe('step 4: sanitizeEditState keeps valid spots', () => {
  it('sanitizes spots with the O size and drops them without it', () => {
    const raw = {
      v: 2,
      photo: {
        ...defaultPhoto(),
        spots: [
          { x: 0.3, y: 0.4, r: 0.02, dx: 0.05, dy: 0, owner: 'f0' },
          { x: NaN, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: null },
          { x: 0.6, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: 'f9' },
        ],
      },
      persons: { f0: neutralPerson() },
      template: neutralPerson(),
      primaryInit: null,
    };
    const withSize = sanitizeEditState(raw, ['f0'], { width: 1000, height: 1500 });
    expect(withSize.photo.spots).toEqual([
      { x: 0.3, y: 0.4, r: 0.02, dx: 0.05, dy: 0, owner: 'f0' },
      { x: 0.6, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: null },
    ]);
    expect(sanitizeEditState(raw, ['f0']).photo.spots).toEqual([]);
  });

  it('spots are part of the output key, a detection rebase keeps them, 重置 clears them (S §5, §8.1, C §3.4)', () => {
    const e = { v: 2 as const, photo: { ...defaultPhoto(), spots: [] }, persons: { p0: neutralPerson() }, template: neutralPerson(), primaryInit: null };
    const withSpot = { ...e, photo: { ...e.photo, spots: [{ x: 0.3, y: 0.4, r: 0.02, dx: 0.05, dy: 0, owner: null }] } };
    expect(editKey(withSpot)).not.toBe(editKey(e));
    const next = assignPersons(withSpot, ['f0'], 'f0');
    expect(next.photo.spots).toEqual(withSpot.photo.spots);
    expect(resetAll(withSpot).photo.spots).toEqual([]);
  });
});

describe('step 4: renamePersons remaps spot owners (C §5.2)', () => {
  it('renames each owner through the map, nulls a dropped one, keeps an unmapped one', () => {
    const e = {
      v: 2 as const,
      photo: {
        ...defaultPhoto(),
        spots: [
          { x: 0.1, y: 0.1, r: 0.01, dx: 0, dy: 0, owner: 'f0' },
          { x: 0.2, y: 0.2, r: 0.01, dx: 0, dy: 0, owner: 'f1' },
          { x: 0.3, y: 0.3, r: 0.01, dx: 0, dy: 0, owner: null },
        ],
      },
      persons: { f0: neutralPerson(), f1: neutralPerson() },
      template: neutralPerson(),
      primaryInit: null,
    };
    const next = renamePersons(e, { f0: 'f3', f1: null });
    expect(next.photo.spots.map((s) => s.owner)).toEqual(['f3', null, null]);
    expect(next.photo.spots.map((s) => s.x)).toEqual([0.1, 0.2, 0.3]);
    const kept = renamePersons(e, { f1: 'f2' });
    expect(kept.photo.spots.map((s) => s.owner)).toEqual(['f0', 'f2', null]);
  });
});

const STEP5_IDS: ParamId[] = [
  'shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight',
  'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens',
];
const editOf = (f0: PersonParams): EditState => ({ v: 2, photo: defaultPhoto(), persons: { f0 }, template: neutralPerson(), primaryInit: null });

describe('step-5 fields in the edit state (S5 §3.5)', () => {
  it('every beauty preset resets the new items, their shades and 左右分開 (RM §11 Q7 default)', () => {
    for (const id of ['original', 'natural', 'refined', 'glow'] as const) {
      const p: PersonParams = {
        ...naturalPerson(),
        values: { ...naturalPerson().values, 'shape.jawline': 0.7, 'shape.temple': 0.9, 'makeup.lens': 0.6 },
        right: { 'shape.faceSlim': 0.9 },
        shades: { ...emptyShades(), brow: 'mocha', eyeshadow: 'earth', liner: 'wine', lens: 'blue' },
      };
      const out = lensFor(editOf(p), { kind: 'person', id: 'f0' }, [{ id: 'f0', face: true, body: false }], 'f0').applyPreset(id, 1).persons.f0;
      expect(out.right).toBeNull();
      for (const k of STEP5_IDS) expect(out.values[k as keyof typeof out.values]).toBe(neutralValue(paramDef(k)));
      expect([out.shades.brow, out.shades.eyeshadow, out.shades.liner, out.shades.lens]).toEqual([null, null, null, null]);
    }
  });

  it('a preset id stands only while right is null (matchesPersonPreset)', () => {
    const split = { ...naturalPerson(), right: { 'shape.faceSlim': naturalPerson().values['shape.faceSlim'] } };
    expect(sanitizeEditState(editOf(split), ['f0']).persons.f0.preset).toBe('custom');
    expect(sanitizeEditState(editOf(naturalPerson()), ['f0']).persons.f0.preset).toEqual(naturalPerson().preset);
  });

  it('fills what step-1…4 builds did not write: neutral new values, null new shades, right = null', () => {
    const p = naturalPerson();
    const values: Record<string, unknown> = { ...p.values };
    for (const k of STEP5_IDS) delete values[k];
    const old = { values, shades: { lip: 'rose', blush: null }, preset: p.preset };
    const out = sanitizeEditState({ v: 2, photo: defaultPhoto(), persons: { f0: old }, template: neutralPerson(), primaryInit: null }, ['f0']).persons.f0;
    expect(out.right).toBeNull();
    expect(out.shades).toEqual({ ...emptyShades(), lip: 'rose' });
    for (const k of STEP5_IDS) expect(out.values[k as keyof typeof out.values]).toBe(neutralValue(paramDef(k)));
  });

  it('keeps valid new-part shades and a valid right through sanitize (a saved entry reopens as it was)', () => {
    const p: PersonParams = {
      ...naturalPerson(),
      right: { 'shape.faceSlim': 0.4, 'shape.temple': 0.7 },
      shades: { ...emptyShades(), lip: 'rose', brow: 'mocha', eyeshadow: 'earth', liner: 'wine', lens: 'black' },
    };
    const out = sanitizeEditState(JSON.parse(JSON.stringify(editOf(p))), ['f0']).persons.f0;
    expect(out.right).toEqual({ 'shape.faceSlim': 0.4, 'shape.temple': 0.7 });
    expect(out.shades).toEqual(p.shades);
    expect(out.preset).toBe('custom');
  });

  it('drops unknown shade ids and bad right entries (fuzzed)', () => {
    let s = 7;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const junk = (): unknown => [Number.NaN, Number.POSITIVE_INFINITY, -2, 3, 'x', null, {}, 0.3][Math.floor(rnd() * 8)];
    for (let n = 0; n < 200; n++) {
      const right: Record<string, unknown> = {};
      for (const id of [...SPLIT_IDS, 'shape.chin', 'makeup.lens']) if (rnd() < 0.5) right[id] = junk();
      const shades: Record<string, unknown> = {};
      for (const part of SHADE_PARTS) shades[part] = rnd() < 0.5 ? SHADES[part][Math.floor(rnd() * SHADES[part].length)].id : junk();
      const raw = { v: 2, photo: defaultPhoto(), persons: { f0: { ...naturalPerson(), right, shades } }, template: neutralPerson(), primaryInit: null };
      const out = sanitizeEditState(raw, ['f0']).persons.f0;
      if (out.right !== null) {
        expect(Object.keys(out.right).length).toBeGreaterThan(0);
        for (const [k, v] of Object.entries(out.right)) {
          expect(SPLIT_IDS).toContain(k);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      expect(Object.keys(out.shades).sort()).toEqual([...SHADE_PARTS].sort());
      for (const part of SHADE_PARTS) {
        const v = out.shades[part];
        if (v !== null) expect(SHADES[part].map((x) => x.id)).toContain(v);
      }
    }
  });

  it('legacyProjection writes the GPUPixel-left (values) side of a split item', () => {
    const p = { ...naturalPerson(), values: { ...naturalPerson().values, 'shape.faceSlim': 0.3 }, right: { 'shape.faceSlim': 0.9 } };
    expect(legacyProjection(editOf(p), 'f0').values['shape.faceSlim']).toBe(0.3);
  });
});

describe('strokes in EditState (push-brush spec §3.4, §5)', () => {
  const rec = (id: string, x = 0.3): Stroke => ({ id, kind: 'push', radius: 0.05, strength: 0.75, points: Float32Array.of(x, 0.3, x + 0.0125, 0.3) });
  const SIZE = { width: 1536, height: 2048 };

  it('defaultPhoto has no strokes; withStrokes appends and shares the records already there', () => {
    expect(defaultPhoto().strokes).toEqual([]);
    const e0 = base();
    expect(withStrokes(e0, [])).toBe(e0);
    const a = rec('a');
    const e1 = withStrokes(e0, [a]);
    const e2 = withStrokes(e1, [rec('b'), rec('c')]);
    expect(e2.photo.strokes.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(e2.photo.strokes[0]).toBe(a); // shared, never copied
    expect(e0.photo.strokes).toEqual([]); // immutable
  });

  it('clearStrokes empties the list and returns the same object when there is nothing to clear', () => {
    const e0 = base();
    expect(clearStrokes(e0)).toBe(e0);
    const e1 = clearStrokes(withStrokes(e0, [rec('a')]));
    expect(e1.photo.strokes).toEqual([]);
    expect(editKey(e1)).toBe(editKey(e0));
  });

  it('editKey compares strokes by id: equal for the same ids with other points, different for other ids', () => {
    const e0 = base();
    const a1 = withStrokes(e0, [rec('a', 0.3)]);
    const a2 = withStrokes(e0, [rec('a', 0.6)]);
    const b = withStrokes(e0, [rec('b', 0.3)]);
    expect(editKey(a1)).toBe(editKey(a2));
    expect(editKey(a1)).not.toBe(editKey(b));
    expect(editKey(a1)).not.toBe(editKey(e0));
    expect(editKey(a1)).not.toContain('0.30000001'); // no point is ever serialized
  });

  it('sanitizeEditState keeps valid strokes with the O size and drops them without one (the camera look)', () => {
    const raw = withStrokes(base(), [rec('ok'), { ...rec('bad'), kind: 'twirl' } as unknown as Stroke]);
    const withSize = sanitizeEditState(structuredClone(raw), ['p0'], SIZE);
    expect(withSize.photo.strokes.map((s) => s.id)).toEqual(['ok']);
    expect(withSize.photo.strokes[0].points).toBeInstanceOf(Float32Array);
    expect(sanitizeEditState(structuredClone(raw), ['p0']).photo.strokes).toEqual([]);
    // an entry written before step 6 has no `strokes` field at all
    const old = structuredClone(base()) as unknown as { photo: Record<string, unknown> };
    delete old.photo.strokes;
    expect(sanitizeEditState(old, ['p0'], SIZE).photo.strokes).toEqual([]);
  });

  it('presets and ⊘ never touch strokes (C §3.4); 重置 clears them (defaultPhoto has none)', () => {
    const e = withStrokes(base(), [rec('a')]);
    const lens = lensFor(e, { kind: 'person', id: 'p0' }, P0_INFO, 'p0');
    expect(lens.applyPreset('refined', 1).photo.strokes).toBe(e.photo.strokes);
    expect(lens.applyPreset('original', 1).photo.strokes).toBe(e.photo.strokes);
    expect(lens.resetGroup('shape').photo.strokes).toBe(e.photo.strokes);
    expect(lens.resetGroup('body').photo.strokes).toBe(e.photo.strokes);
    expect(defaultPhoto().strokes).toHaveLength(0);
    expect(resetAll(e).photo.strokes).toEqual([]); // 重置 is one undo step that removes every stroke
  });
});
