import { describe, expect, it } from 'vitest';
import { SPLIT_IDS } from '../engine/params';
import { apply, oToV } from '../geometry/view';
import { blankEyes } from '../tracking/adapter111';
import type { CameraLook, Face, Geometry, PersonParams } from '../types';
import { defaultPhoto, naturalPerson } from './state';
import { cameraScreenSwap, handOverLook, isSplitId, mirrorSides, readSide, sanitizeRight, screenLeftIsGpLeft, slotFor, splitOff, splitOn, writeSide } from './sides';

const eyes = (l: [number, number], r: [number, number]): Face => {
  const pts111 = new Float32Array(222);
  pts111.set(l, 74 * 2);
  pts111.set(r, 77 * 2);
  return { pts111, ext: new Float32Array(16), oval: new Float32Array(72), yaw: 0, ...blankEyes() };
};
const G = (over: Partial<Geometry>): Geometry => ({ flipH: false, quarter: 0, straighten: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, ...over });
const O_SIZE = { width: 1000, height: 1500 };
const through = (g: Geometry) => {
  const m = oToV(g, O_SIZE);
  return (p: [number, number]) => apply(m, [p[0], p[1]]);
};
const person = (over: Partial<PersonParams> = {}): PersonParams => ({ ...naturalPerson(), ...over });

describe('screenLeftIsGpLeft (S5 §2.2, §3.4)', () => {
  const upright = eyes([0.4, 0.4], [0.6, 0.4]);
  it('upright and unmirrored: the GPUPixel-left half shows on the screen left', () => {
    expect(screenLeftIsGpLeft(upright, (p) => p)).toBe(true);
  });
  it('the front-camera preview mirror swaps it', () => {
    expect(screenLeftIsGpLeft(upright, (p) => [1 - p[0], p[1]])).toBe(false);
  });
  it('翻轉 swaps it, a half turn swaps it, both together restore it (step 3 view module)', () => {
    expect(screenLeftIsGpLeft(upright, through(G({})))).toBe(true);
    expect(screenLeftIsGpLeft(upright, through(G({ flipH: true })))).toBe(false);
    expect(screenLeftIsGpLeft(upright, through(G({ quarter: 2 })))).toBe(false);
    expect(screenLeftIsGpLeft(upright, through(G({ quarter: 2, flipH: true })))).toBe(true);
  });
  it('an upside-down face reads by its own eyes', () => {
    expect(screenLeftIsGpLeft(eyes([0.6, 0.6], [0.4, 0.6]), (p) => p)).toBe(false);
  });
  it('a face lying sideways in O, read through a quarter turn (旋轉: clockwise quarters, RM §3.2)', () => {
    // GPUPixel-left eye below the right one in O; a clockwise quarter turn maps (x, y) → (1 − y, x)
    const lying = eyes([0.41, 0.6], [0.39, 0.4]);
    expect(screenLeftIsGpLeft(lying, through(G({})))).toBe(false);
    expect(screenLeftIsGpLeft(lying, through(G({ quarter: 1 })))).toBe(true);
    expect(screenLeftIsGpLeft(lying, through(G({ quarter: 3 })))).toBe(false);
  });
});

describe('slots (S5 §3.4)', () => {
  it('slotFor maps the on-screen side to the stored half', () => {
    expect([slotFor(false, 'L'), slotFor(false, 'R'), slotFor(true, 'L'), slotFor(true, 'R')]).toEqual(['values', 'right', 'right', 'values']);
  });
  it('readSide / writeSide: while right is null both halves read and write values; right is never created', () => {
    const p = person();
    expect(readSide(p, 'shape.faceSlim', 'right')).toBe(p.values['shape.faceSlim']);
    const q = writeSide(p, 'shape.faceSlim', 0.9, 'right');
    expect(q.right).toBeNull();
    expect(q.values['shape.faceSlim']).toBe(0.9);
  });
  it('readSide / writeSide with 左右分開 on', () => {
    const p = splitOn(person());
    const q = writeSide(p, 'shape.temple', 0.8, 'right');
    expect(q.right?.['shape.temple']).toBe(0.8);
    expect(q.values['shape.temple']).toBe(p.values['shape.temple']);
    expect(readSide(q, 'shape.temple', 'right')).toBe(0.8);
    expect(readSide(q, 'shape.temple', 'values')).toBe(0.5);
    expect(isSplitId('shape.temple')).toBe(true);
    expect(isSplitId('shape.chin')).toBe(false);
  });
  it('splitOn copies the six values (nothing moves); splitOff keeps the given side', () => {
    const p = person({ values: { ...naturalPerson().values, 'shape.faceSlim': 0.3 } });
    const on = splitOn(p);
    expect(Object.keys(on.right ?? {}).sort()).toEqual([...SPLIT_IDS].sort());
    for (const id of SPLIT_IDS) expect(on.right?.[id]).toBe(p.values[id]);
    expect(splitOn(on)).toBe(on);
    const edited = writeSide(on, 'shape.faceSlim', 0.9, 'right');
    expect(splitOff(edited, 'right').values['shape.faceSlim']).toBe(0.9);
    expect(splitOff(edited, 'values').values['shape.faceSlim']).toBe(0.3);
    expect(splitOff(edited, 'values').right).toBeNull();
  });
  it('mirrorSides swaps exactly the six split ids and is an involution', () => {
    const base = writeSide(splitOn(person()), 'shape.jawline', 0.7, 'right');
    const on = { ...base, values: { ...base.values, 'shape.chin': 0.9 } };
    const m = mirrorSides(on);
    expect(m.values['shape.jawline']).toBe(0.7);
    expect(m.right?.['shape.jawline']).toBe(on.values['shape.jawline']);
    expect(m.values['shape.chin']).toBe(0.9);
    expect(mirrorSides(m)).toEqual(on);
    const off = person();
    expect(mirrorSides(off)).toBe(off);
  });
  it('sanitizeRight keeps finite split keys clamped to 0..1; nothing left → null', () => {
    expect(sanitizeRight({ 'shape.faceSlim': 2, 'shape.chin': 0.4, 'shape.temple': Number.NaN, 'shape.jawline': 0.25 })).toEqual({
      'shape.faceSlim': 1,
      'shape.jawline': 0.25,
    });
    expect(sanitizeRight({ 'shape.chin': 0.4 })).toBeNull();
    expect(sanitizeRight({})).toBeNull();
    expect(sanitizeRight([0.5])).toBeNull();
    expect(sanitizeRight('x')).toBeNull();
  });
});

describe('camera → 編輯 hand-over (face-detail spec §3.4)', () => {
  it('a shot saved mirrored swaps the split halves so each value stays on the same cheek', () => {
    const p = writeSide(splitOn(naturalPerson()), 'shape.faceSlim', 0.9, 'right');
    const look: CameraLook = { photo: defaultPhoto(), person: p };
    const handed = handOverLook(look, true).person;
    expect(handed.values['shape.faceSlim']).toBe(0.9);
    expect(handed.right?.['shape.faceSlim']).toBe(p.values['shape.faceSlim']);
    expect(handOverLook(look, false)).toBe(look);
    const plain: CameraLook = { photo: defaultPhoto(), person: naturalPerson() };
    expect(handOverLook(plain, true).person).toBe(plain.person);
  });
  it('the camera preview mirrors the front camera only', () => {
    expect(cameraScreenSwap('user')).toBe(true);
    expect(cameraScreenSwap('environment')).toBe(false);
  });
});
