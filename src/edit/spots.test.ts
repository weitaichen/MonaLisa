import { describe, expect, it } from 'vitest';
import { SPOT_CAP } from '../config/limits';
import type { EditState, Spot } from '../types';
import { defaultPhoto, neutralPerson } from './state';
import { addSpot, clearScope, clearSpots, remapSpotOwners, sanitizeSpot, sanitizeSpots, spotsInScope } from './spots';

const spot = (x: number, owner: string | null = null): Spot => ({ x, y: 0.5, r: 0.01, dx: 0.03, dy: 0, owner });
const edit = (spots: Spot[] = []): EditState => ({
  v: 2,
  photo: { ...defaultPhoto(), spots },
  persons: { f0: neutralPerson(), f1: neutralPerson() },
  template: neutralPerson(),
  primaryInit: null,
});

describe('addSpot / clearSpots (skin-cleanup spec §3.3)', () => {
  it('appends immutably and refuses the 101st spot by returning the same state', () => {
    const e0 = edit();
    const e1 = addSpot(e0, spot(0.1));
    expect(e1.photo.spots).toEqual([spot(0.1)]);
    expect(e0.photo.spots).toEqual([]);
    const full = edit(Array.from({ length: SPOT_CAP }, (_, i) => spot(i / SPOT_CAP)));
    expect(addSpot(full, spot(0.5))).toBe(full);
  });

  it('clears every spot, or only one owner’s; a clear that removes nothing is the same state (no undo step)', () => {
    const e = edit([spot(0.1, 'f0'), spot(0.2, 'f1'), spot(0.3, null), spot(0.4, 'f0')]);
    expect(clearSpots(e, 'all').photo.spots).toEqual([]);
    expect(clearSpots(e, 'f0').photo.spots).toEqual([spot(0.2, 'f1'), spot(0.3, null)]);
    expect(clearSpots(e, 'b0')).toBe(e);
    expect(spotsInScope(e, 'f0')).toBe(2);
    expect(spotsInScope(e, 'all')).toBe(4);
  });

  it('清除此人 only with one person of a group photo selected (§2.3)', () => {
    expect(clearScope({ kind: 'person', id: 'f1' }, 3)).toBe('f1');
    expect(clearScope({ kind: 'person', id: 'f0' }, 1)).toBe('all');
    expect(clearScope({ kind: 'all' }, 3)).toBe('all');
  });

  it('remaps owners through a rename; an unmatched owner becomes null (§5)', () => {
    const map = new Map([['f0', 'f2']]);
    expect(remapSpotOwners([spot(0.1, 'f0'), spot(0.2, 'f1'), spot(0.3, null)], (id) => map.get(id) ?? null)).toEqual([
      spot(0.1, 'f2'),
      spot(0.2, null),
      spot(0.3, null),
    ]);
  });
});

describe('sanitizeSpot / sanitizeSpots (§5)', () => {
  const ids = new Set(['f0', 'f1']);

  it('drops non-finite and far-outside spots, clamps the rest, nulls unknown owners, drops long donors', () => {
    expect(sanitizeSpot({ x: NaN, y: 0.5, r: 0.01, dx: 0, dy: 0, owner: null }, ids)).toBeNull();
    expect(sanitizeSpot({ x: 0.5, y: 0.5, r: Infinity, dx: 0, dy: 0, owner: null }, ids)).toBeNull();
    expect(sanitizeSpot({ x: 1.02, y: 0.5, r: 0.01, dx: 0, dy: 0, owner: null }, ids)).toBeNull();
    expect(sanitizeSpot({ x: 1.005, y: -0.005, r: 0.5, dx: 0.3, dy: 0, owner: 'b7' }, ids)).toEqual({ x: 1, y: 0, r: 0.04, dx: 0, dy: 0, owner: null });
    expect(sanitizeSpot({ x: 0.2, y: 0.3, r: 0.0001, dx: 0.01, dy: -0.02, owner: 'f1' }, ids)).toEqual({ x: 0.2, y: 0.3, r: 0.0005, dx: 0.01, dy: -0.02, owner: 'f1' });
    // the detection cache was dropped (null): owners are kept for the rematch
    expect(sanitizeSpot({ x: 0.2, y: 0.3, r: 0.01, dx: 0, dy: 0, owner: 'f5' }, null)?.owner).toBe('f5');
  });

  it('fuzz: every kept spot satisfies the invariants', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 3 - 1;
    const pick = (): unknown => [rnd(), rnd() * 0.05, NaN, Infinity, '0.3', null, undefined][Math.floor(Math.abs(rnd()) * 2.33) % 7];
    for (let i = 0; i < 2000; i++) {
      const s = sanitizeSpot({ x: pick(), y: pick(), r: pick(), dx: pick(), dy: pick(), owner: i % 3 ? 'f0' : 7 }, ids);
      if (!s) continue;
      for (const v of [s.x, s.y, s.r, s.dx, s.dy]) expect(Number.isFinite(v)).toBe(true);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(s.r).toBeGreaterThanOrEqual(0.0005);
      expect(s.r).toBeLessThanOrEqual(0.04);
      expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(0.2);
      expect(s.owner === null || ids.has(s.owner)).toBe(true);
    }
  });

  it('keeps the first 100 valid spots, and none without an O size (the camera look, C §3.2)', () => {
    const raw = [{ x: NaN }, ...Array.from({ length: 105 }, (_, i) => spot(i / 105))];
    expect(sanitizeSpots(raw, ids, true)).toHaveLength(SPOT_CAP);
    expect(sanitizeSpots(raw, ids, true)[0]).toEqual(spot(0));
    expect(sanitizeSpots(raw, ids, false)).toEqual([]);
    expect(sanitizeSpots('nope', ids, true)).toEqual([]);
  });
});
