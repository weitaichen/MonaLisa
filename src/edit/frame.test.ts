import { describe, expect, it } from 'vitest';
import { applyPreset } from '../engine/params';
import { makeFace } from '../app/testFakes';
import type { EditState, FaceProtect } from '../types';
import { buildFrame, legacyFrame } from './frame';
import { splitLegacy } from './legacy';
import { defaultPhoto, editRotateLeft, naturalPerson, neutralPerson } from './state';

const prot: FaceProtect = { width: 1, height: 1, data: new Float32Array(1), version: 1 };
const edit: EditState = { v: 2, photo: defaultPhoto(), persons: { f0: naturalPerson(), b1: naturalPerson() }, template: neutralPerson(), primaryInit: null };

describe('buildFrame (S §4.1)', () => {
  it('every face in cache order at weight 1 with its person (a face without a person: neutral), obstacles as centres', () => {
    const f = buildFrame(edit, [{ id: 'f0', face: makeFace(0, 0.3), person: 'f0' }, { id: 'f1', face: makeFace(1, 0.7), person: null }], [{ box: { x: 0.9, y: 0.1, w: 0.02, h: 0.02 }, oval: new Float32Array(72) }], new Map([['f0', prot]]), 'f0');
    expect(f.faces.map((x) => [x.weight, x.protect])).toEqual([[1, prot], [1, null]]);
    expect(f.faces[1].person).toEqual(neutralPerson());
    expect(f.obstacles).toHaveLength(1);
    expect(f.obstacles![0][0]).toBeCloseTo(0.91, 9);
    expect(f.obstacles![0][1]).toBeCloseTo(0.11, 9);
    expect(f.globalSkin).toBeNull();
    expect(f.photo).toBe(edit.photo);
  });
  it('no face: all-skin 磨皮／紅潤 from the primary person', () => {
    const f = buildFrame(edit, [], [], new Map(), 'b1');
    expect(f.globalSkin).toEqual({ smooth: 0.55, rosy: 0.25, weight: 1 });
  });
  it('the frame carries the photo geometry (the engine reads RenderInput.geometry, step 3)', () => {
    const edit = editRotateLeft({ v: 2, photo: defaultPhoto(), persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null });
    const frame = buildFrame(edit, [], [], new Map(), 'p0');
    expect(frame.geometry).toBe(edit.photo.geometry);
  });
});

describe('legacyFrame (one face from v1 params: tests, harnesses, the v0.3 camera)', () => {
  it('a face at weight w fades the global skin to 1 − w; no face: weight 1, no faces', () => {
    const p = applyPreset('natural', 1);
    const f = legacyFrame(p, makeFace(), 0.25);
    expect(f.faces[0].weight).toBe(0.25);
    expect(f.globalSkin).toEqual({ smooth: 0.55, rosy: 0.25, weight: 0.75 });
    expect(f.photo).toEqual(splitLegacy(p).photo);
    expect(legacyFrame(p, null, 1).faces).toEqual([]);
    expect(legacyFrame(p, null, 1).globalSkin?.weight).toBe(1);
  });
});
