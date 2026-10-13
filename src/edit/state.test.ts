import { describe, expect, it } from 'vitest';
import { applyPreset, PARAM_DEFS } from '../engine/params';
import type { EditState } from '../types';
import {
  assignPersons,
  cameraEdit,
  defaultPhoto,
  editKey,
  isEditStateRecord,
  lookOf,
  naturalPerson,
  neutralPerson,
  PERSON_IDS,
  PHOTO_IDS,
  renamePersons,
  resetAll,
  sanitizeEditState,
  withPersons,
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
    expect(person.filter((id) => id.startsWith('shape.'))).toHaveLength(9);
    expect(person.filter((id) => id.startsWith('body.'))).toHaveLength(9);
  });
  it('live: everything but 美體 is offered in the camera', () => {
    for (const d of PARAM_DEFS) expect(d.live, d.id).toBe(d.group !== 'body');
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
    expect(neutralPerson().shades).toEqual({ lip: null, blush: null });
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
    expect(s.persons.f0.shades).toEqual({ lip: 'coral', blush: null });
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
    expect(s.persons.p0.shades).toEqual({ lip: null, blush: null });
    expect(s.photo.filterId).toBe('none');
    expect(isEditStateRecord({ v: 1, photo: {}, persons: {} })).toBe(false);
    expect(isEditStateRecord({ v: 2, photo: {}, persons: {} })).toBe(true);
  });
});
