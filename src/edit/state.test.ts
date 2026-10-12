import { describe, expect, it } from 'vitest';
import { applyPreset, PARAM_DEFS } from '../engine/params';
import { cameraEdit, defaultPhoto, editKey, lookOf, naturalPerson, neutralPerson, PERSON_IDS, PHOTO_IDS, withPersons } from './state';

describe('scope table (RM §3.1, step-1 subset)', () => {
  it('every ParamId has exactly one scope and the layers do not overlap', () => {
    for (const d of PARAM_DEFS) expect(['photo', 'person']).toContain(d.scope);
    expect([...PHOTO_IDS].sort()).toEqual(['body.legs', 'filter.amount', 'skin.sharpen', 'skin.whiten']);
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
