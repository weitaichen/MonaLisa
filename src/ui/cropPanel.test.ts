import { describe, expect, it } from 'vitest';
import { defaultPhoto, naturalPerson, neutralPerson } from '../edit/state';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft } from '../geometry/view';
import type { EditState, Geometry } from '../types';
import { cropActivate, cropItems, ROTATE_BAND_TOAST, StraightenGesture, straightenView } from './cropPanel';

const O = { width: 1536, height: 2048 };
const edit = (g: Geometry = IDENTITY_GEOMETRY, band = false): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), geometry: g, heightBand: band ? { top: 0.5, bottom: 0.9, amount: 0.5 } : null },
  persons: { p0: naturalPerson() },
  template: neutralPerson(),
  primaryInit: null,
});

describe('cropItems (S §2.1)', () => {
  it('自由 · 原比例 · 1:1 · 3:4 · 4:3 · 9:16 · 16:9 │ 旋轉 · 翻轉 · 還原', () => {
    const items = cropItems(IDENTITY_GEOMETRY, 'free', O);
    expect(items.map((i) => i.label)).toEqual(['自由', '原比例', '1:1', '3:4', '4:3', '9:16', '16:9', '旋轉', '翻轉', '還原']);
    expect(items.filter((i) => i.selected).map((i) => i.label)).toEqual(['自由']);
    expect(items[7].divider).toBe('before');
    expect(items[0].visual).toEqual({ kind: 'ratio', aspect: null });
    expect(items[2].visual).toEqual({ kind: 'ratio', aspect: 1 });
    expect(items[1].visual).toEqual({ kind: 'ratio', aspect: 1536 / 2048 });
  });

  it('還原 is dimmed at identity only', () => {
    expect(cropItems(IDENTITY_GEOMETRY, 'free', O).at(-1)!.disabled).toBe(true);
    expect(cropItems(rotateLeft(IDENTITY_GEOMETRY), 'free', O).at(-1)!.disabled).toBe(false);
  });
});

describe('cropActivate', () => {
  it('a ratio replaces the crop with its centred max-fit and selects the lock; the same aspect changes nothing', () => {
    const r = cropActivate(edit(), { type: 'ratio', lock: '1:1' }, 'free', O);
    expect(r.changed).toBe(true);
    expect(r.lock).toBe('1:1');
    expect(r.edit.photo.geometry).toEqual(applyRatio(IDENTITY_GEOMETRY, '1:1', O));
    const again = cropActivate(r.edit, { type: 'ratio', lock: '1:1' }, '1:1', O);
    expect(again.changed).toBe(false);
    const free = cropActivate(r.edit, { type: 'ratio', lock: 'free' }, '1:1', O);
    expect([free.changed, free.lock]).toEqual([false, 'free']);
  });

  it('旋轉 turns counter-clockwise, transposes the lock and removes the 增高 band with a toast', () => {
    const r = cropActivate(edit(applyRatio(IDENTITY_GEOMETRY, '3:4', O), true), { type: 'rotate' }, '3:4', O);
    expect(r.edit.photo.geometry.quarter).toBe(3);
    expect(r.lock).toBe('4:3');
    expect(r.edit.photo.heightBand).toBeNull();
    expect(r.toast).toBe(ROTATE_BAND_TOAST);
    expect(cropActivate(edit(), { type: 'rotate' }, 'free', O).toast).toBeNull();
  });

  it('翻轉 keeps the band; 還原 resets to identity and 自由, a no-op at identity', () => {
    const f = cropActivate(edit(IDENTITY_GEOMETRY, true), { type: 'flip' }, 'free', O);
    expect(f.edit.photo.geometry.flipH).toBe(true);
    expect(f.edit.photo.heightBand).not.toBeNull();
    const back = cropActivate(f.edit, { type: 'geoReset' }, '1:1', O);
    expect([back.changed, back.lock, back.edit.photo.geometry]).toEqual([true, 'free', IDENTITY_GEOMETRY]);
    expect(cropActivate(edit(), { type: 'geoReset' }, 'free', O).changed).toBe(false);
  });
});

describe('拉直', () => {
  it('the slider shows θ on −45…+45 with 0.1° steps and a ° suffix', () => {
    const v = straightenView({ ...IDENTITY_GEOMETRY, straighten: 9 });
    expect(v.value).toBeCloseTo(0.6, 12);
    expect(v.defaultValue).toBe(0.5);
    expect(v.scale).toEqual({ min: -45, max: 45, step: 0.1, snap: 0.5, suffix: '°' });
    expect(v.label).toBe('拉直');
  });

  it('every drag step starts from the gesture start; the commit ends the gesture', () => {
    const s = new StraightenGesture();
    const g0 = IDENTITY_GEOMETRY;
    const g1 = s.step(g0, 0.6, O, false);
    expect(g1.straighten).toBe(9);
    const g2 = s.step(g1, 0.5, O, false);
    expect(g2).toBe(g0); // back at the start angle: the start geometry itself
    const g3 = s.step(g2, 0.7, O, true);
    expect(g3.straighten).toBe(18);
    expect(s.step(g3, 0.7, O, false)).toBe(g3); // a new gesture starts from g3
  });

  it('reset forgets the gesture start (leaving 裁切 mid-drag)', () => {
    const s = new StraightenGesture();
    s.step(IDENTITY_GEOMETRY, 0.6, O, false);
    s.reset();
    const other = rotateLeft(IDENTITY_GEOMETRY);
    expect(s.step(other, 0.5, O, true)).toBe(other);
  });
});
