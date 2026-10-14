import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SPOT_CAP } from '../config/limits';
import { adapt } from '../tracking/adapter111';
import type { EditState, Face, Spot } from '../types';
import { defaultPhoto, neutralPerson } from './state';
import {
  addSpot,
  clearScope,
  clearSpots,
  ownerAt,
  ownerCtxOf,
  planSpot,
  regionAt,
  remapSpotOwners,
  sanitizeSpot,
  sanitizeSpots,
  SPOT_K,
  spotRadius,
  spotsInScope,
  type Patch,
  type SpotFace,
  type V2,
} from './spots';

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

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const FACE: Face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const ASPECT = lm.width / lm.height;
const FACES: SpotFace[] = [{ id: 'f0', face: FACE }];
const WORK = { width: 1000, height: 1500 };
const P = (i: number): [number, number] => [FACE.pts111[i * 2], FACE.pts111[i * 2 + 1]];
const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s) - 0.5;
};
/** a patch covering the whole (square) O of `n` px, filled from luma(x, y) on a skin tint */
function patch(n: number, luma: (x: number, y: number) => number, rect = { x: 0, y: 0, w: 1, h: 1 }): Patch {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = luma(x + 0.5, y + 0.5);
      data.set([Math.round(255 * Math.min(1, v * 1.15)), Math.round(255 * v * 0.92), Math.round(255 * v * 0.8), 255], (y * n + x) * 4);
    }
  return { data, w: n, h: n, rect, pxPerShort: n / rect.w };
}
/** the patch a tap reads (S §3.4): 112 px over the half-side 5.6 rr around `o`, so r = 10 patch px; luma from the O point */
function patchAround(o: V2, rr: number, luma: (q: V2, x: number, y: number) => number): Patch {
  const half = 5.6 * rr;
  const rect = { x: o[0] - half, y: o[1] - half * ASPECT, w: 2 * half, h: 2 * half * ASPECT };
  return patch(112, (x, y) => luma([rect.x + (x / 112) * rect.w, rect.y + (y / 112) * rect.h], x, y), rect);
}
/** distance between two O points in short-edge units (the fixture is portrait: the width) */
const isoDist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], (a[1] - b[1]) / ASPECT);
/** the O point k·rr from `o` at j × 45° (y down): planSpot's donor candidates for an unsnapped spot */
const cand = (o: V2, rr: number, k: number, j: number): V2 => [o[0] + k * rr * Math.cos((j * Math.PI) / 4), o[1] + k * rr * Math.sin((j * Math.PI) / 4) * ASPECT];
const donorOf = (s: Spot): V2 => [s.x + s.dx, s.y + s.dy * ASPECT];
/** the regions of the 8 rim points (1.1 r) of a donor centred on `d` */
const rimKinds = (d: V2, rr: number, faces: readonly SpotFace[]) => Array.from({ length: 8 }, (_, m) => regionAt(cand(d, rr, 1.1, m), faces, ASPECT).kind);
/** `f` moved right by `dx` (a second face of a group photo) */
const shifted = (f: Face, dx: number): Face => {
  const sh = (a: Float32Array) => a.map((v, i) => (i % 2 ? v : v + dx));
  return { ...f, pts111: sh(f.pts111), ext: sh(f.ext), oval: sh(f.oval) };
};

describe('regionAt / spotRadius / ownerAt (skin-cleanup spec §2.3, §3.3)', () => {
  it('tells the eyes, the open mouth, the lips, the skin and the rest apart', () => {
    expect(regionAt(P(74), FACES, ASPECT)).toEqual({ kind: 'eye', face: 'f0' });
    expect(regionAt(mid(P(98), P(102)), FACES, ASPECT)).toEqual({ kind: 'mouth', face: 'f0' });
    expect(regionAt(mid(P(87), P(98)), FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
    expect(regionAt(mid(P(6), P(82)), FACES, ASPECT)).toEqual({ kind: 'skin', face: 'f0' });
    expect(regionAt([0.03, 0.03], FACES, ASPECT)).toEqual({ kind: 'other' });
  });

  it('sizes the spot by the reference face: own oval, a padded box, the median width, else 0.35 of the short edge', () => {
    const fwShort = 0.5888; // 588.8 px on a 1000 px short edge
    expect(spotRadius(mid(P(6), P(82)), 'M', FACES, WORK)).toBeCloseTo(SPOT_K.M * fwShort, 3);
    expect(spotRadius([P(0)[0] - 0.02, P(0)[1]], 'S', FACES, WORK)).toBeCloseTo(SPOT_K.S * fwShort, 3); // just outside the oval, inside the box ×1.5
    expect(spotRadius([0.02, 0.98], 'L', FACES, WORK)).toBeCloseTo(SPOT_K.L * fwShort, 3); // outside every grown box: the median face
    expect(spotRadius([0.5, 0.5], 'M', [], WORK)).toBeCloseTo(0.03 * 0.35, 6);
    expect(spotRadius([0.5, 0.5], 'S', [], { width: 100, height: 100 })).toBeCloseTo(0.03, 6); // 3 working px floor
    expect(spotRadius([0.5, 0.5], 'L', [{ id: 'f0', face: { ...FACE, pts111: FACE.pts111.map((v, i) => (i % 2 ? v : v * 3 - 1)) } }], WORK)).toBeLessThanOrEqual(0.04);
  });

  it('owner: the face region first, else the highest body mask ≥ 0.5 (the smaller mask on a tie), else null', () => {
    const mask = (fill: (x: number, y: number) => number) => {
      const data = new Uint8Array(64 * 96);
      for (let y = 0; y < 96; y++) for (let x = 0; x < 64; x++) data[y * 64 + x] = fill(x, y);
      return { width: 64, height: 96, data };
    };
    const ctx = {
      faces: [{ person: 'f0', face: FACE }],
      bodies: [
        { person: 'b0', mask: mask((x) => (x < 32 ? 200 : 0)) },
        { person: 'b1', mask: mask((x, y) => (x < 32 && y > 48 ? 250 : 0)) },
      ],
      aspect: ASPECT,
    };
    expect(ownerAt(mid(P(6), P(82)), ctx)).toBe('f0');
    expect(ownerAt([0.1, 0.9], ctx)).toBe('b1');
    expect(ownerAt([0.1, 0.2], ctx)).toBe('b0');
    expect(ownerAt([0.9, 0.95], ctx)).toBeNull();
    // a tie at the point: the smaller mask wins, in either list order
    const big = mask((x) => (x < 48 ? 255 : 0));
    const small = mask((x) => (x < 16 ? 255 : 0));
    const tie = (bodies: { person: string; mask: typeof big }[]) => ownerAt([0.1, 0.9], { faces: [], bodies, aspect: ASPECT });
    expect(tie([{ person: 'b0', mask: big }, { person: 'b1', mask: small }])).toBe('b1');
    expect(tie([{ person: 'b1', mask: small }, { person: 'b0', mask: big }])).toBe('b1');
  });

  it('ownerCtxOf links cached faces and body masks to their persons; unlinked ones and null masks are left out', () => {
    const m = { width: 2, height: 2, data: new Uint8Array([255, 255, 255, 255]) };
    const body = (id: string, mask: typeof m | null) => ({ id, pose: { points: new Float32Array(132) }, mask, score: 1 });
    const detect = {
      persons: [
        { id: 'f0', face: 'f0', body: 'b0' },
        { id: 'b1', face: null, body: 'b1' },
        { id: 'b2', face: null, body: 'b2' },
      ],
      bodies: [body('b0', m), body('b1', null), body('b2', m), body('b9', m)],
    };
    const faces: SpotFace[] = [{ id: 'f0', face: FACE }, { id: 'f9', face: FACE }];
    const ctx = ownerCtxOf(detect, faces, ASPECT);
    expect(ctx.faces).toEqual([{ person: 'f0', face: FACE }]);
    expect(ctx.bodies).toEqual([{ person: 'f0', mask: m }, { person: 'b2', mask: m }]);
    expect(ctx.aspect).toBe(ASPECT);
    expect(ownerCtxOf(null, faces, ASPECT)).toEqual({ faces: [], bodies: [], aspect: ASPECT });
    expect(ownerCtxOf({ persons: detect.persons, bodies: null }, faces, ASPECT).bodies).toEqual([]);
  });
});

describe('planSpot (§3.5)', () => {
  const r = 10 / 200; // 10 patch px on a 200 px patch
  const dot = (cx: number, cy: number) => (x: number, y: number) => 0.62 + 0.02 * hash(x, y) - 0.2 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 3.5 ** 2));

  it('snaps to a blemish within 1 px when the tap is within 0.8 r, and keeps the tap on clean skin', () => {
    const s = planSpot(patch(200, dot(100, 100)), [106 / 200, 103 / 200], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect(Math.hypot(s.x * 200 - 100, s.y * 200 - 100)).toBeLessThanOrEqual(1);
    const flat = planSpot(patch(200, (x, y) => 0.62 + 0.02 * hash(x, y)), [0.4, 0.6], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect([flat.x, flat.y]).toEqual([0.4, 0.6]);
  });

  it('prefers a donor whose ring differs by a constant over a closer-toned one with a mismatched texture', () => {
    // spot at (100,100) with fine texture T; at +32 px the same texture 0.05 brighter; at −32 px the same tone, coarse noise
    const T = (x: number, y: number) => 0.02 * hash(Math.floor(x), Math.floor(y));
    const img = (x: number, y: number) => {
      const near = (cx: number) => Math.hypot(x - cx, y - 100) <= 16;
      if (near(100)) return 0.6 + T(x - 100, y - 100);
      if (near(132)) return 0.65 + T(x - 132, y - 100);
      if (near(68)) return 0.6 + 0.08 * hash(x * 3.1, y * 1.7);
      return 0.6 + 0.1 * hash(x * 0.37, y * 5.3);
    };
    const s = planSpot(patch(200, img), [100 / 200, 100 / 200], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect([Math.round(s.dx * 200), Math.round(s.dy * 200)]).toEqual([32, 0]);
  });

  // The region tests below lure the planner: the image is flat around the spot and around one forbidden donor, and noise
  // elsewhere, so the forbidden donor is the cheapest by far and only the region rules keep it out.
  const lure = (calm: (q: V2) => boolean) => (q: V2, x: number, y: number) => (calm(q) ? 0.6 : 0.6 + 0.1 * hash(x, y));

  it('keeps a lip spot’s donor on the lip of the same face, even when the skin below matches best (never lip-to-skin)', () => {
    const rr = 0.006; // 6 px on the 1000 px short edge; the lower lip is ≈ 57 px (9.5 r) thick on the fixture
    const o: V2 = [P(93)[0] + 0.1 * (P(102)[0] - P(93)[0]), P(93)[1] + 0.1 * (P(102)[1] - P(93)[1])]; // ≈ 1 r above the lip's lower edge
    expect(regionAt(o, FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
    expect(regionAt(cand(o, rr, 3.2, 2), FACES, ASPECT)).toEqual({ kind: 'skin', face: 'f0' }); // the donor straight down is skin
    // flat skin and a flat ring around the spot; the rest of the lip is noise
    const img = lure((q) => regionAt(q, FACES, ASPECT).kind !== 'lip' || isoDist(q, o) <= 1.6 * rr);
    const s = planSpot(patchAround(o, rr, img), o, rr, { faces: FACES, aspect: ASPECT, existing: [] }) as Spot;
    expect(regionAt([s.x, s.y], FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
    expect([s.dx, s.dy]).not.toEqual([0, 0]);
    expect(regionAt(donorOf(s), FACES, ASPECT)).toEqual({ kind: 'lip', face: 'f0' });
  });

  it('respects the image edge and existing spots; fill mode when nothing fits; deterministic', () => {
    const img = (x: number, y: number) => 0.62 + 0.02 * hash(x, y);
    const near = planSpot(patch(200, img), [14 / 200, 100 / 200], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect(near.x * 200 + near.dx * 200 - 1.4 * 10).toBeGreaterThanOrEqual(0);
    const first = planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: [] }) as Spot;
    const blocker = { x: first.x + first.dx, y: first.y + first.dy, r, dx: 0, dy: 0, owner: null };
    const second = planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: [blocker] }) as Spot;
    expect(Math.hypot((second.x + second.dx - blocker.x) * 200, (second.y + second.dy - blocker.y) * 200)).toBeGreaterThanOrEqual(1.1 * 20 - 1e-9);
    const tiny = planSpot(patch(40, img), [0.5, 0.5], 10 / 40, { faces: [], aspect: 1, existing: [] }) as Spot;
    expect([tiny.dx, tiny.dy]).toEqual([0, 0]);
    expect(planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: [] })).toEqual(first);
  });

  it('never takes a donor whose rim reaches an eye or the open mouth, even when it matches best', () => {
    const below = mid(P(73), P(57));
    const cases: { o: V2; rr: number; kind: 'skin' | 'lip'; rim: 'eye' | 'mouth' }[] = [
      { o: [below[0], below[1] + 0.03], rr: 0.012, kind: 'skin', rim: 'eye' }, // skin under an eye
      { o: [P(102)[0] + 0.3 * (P(93)[0] - P(102)[0]), P(102)[1] + 0.3 * (P(93)[1] - P(102)[1])], rr: 0.006, kind: 'lip', rim: 'mouth' }, // the lower lip, ≈ 3 r under the open mouth
    ];
    for (const { o, rr, kind, rim } of cases) {
      const up = cand(o, rr, 2.4, 6); // 2.4 r straight up: the centre on the spot's own region, the rim in the eye or the mouth
      expect(regionAt(up, FACES, ASPECT)).toEqual({ kind, face: 'f0' });
      expect(rimKinds(up, rr, FACES)).toContain(rim);
      const img = lure((q) => isoDist(q, o) <= 1.7 * rr || isoDist(q, up) <= 1.7 * rr);
      const s = planSpot(patchAround(o, rr, img), o, rr, { faces: FACES, aspect: ASPECT, existing: [] }) as Spot;
      expect([s.x, s.y]).toEqual(o); // no snap: the candidates are where `cand` puts them
      expect([s.dx, s.dy]).not.toEqual([0, 0]);
      const donor = donorOf(s);
      expect(isoDist(donor, up)).toBeGreaterThan(rr);
      expect(regionAt(donor, FACES, ASPECT)).toEqual({ kind, face: 'f0' });
      for (const k of rimKinds(donor, rr, FACES)) expect(['eye', 'mouth']).not.toContain(k);
    }
  });

  it('never takes a donor from another face, even when its skin matches best', () => {
    const xs = Array.from(FACE.oval).filter((_, i) => i % 2 === 0);
    // a second face one oval width to the right: the two ovals nearly touch (≈ 0.014 apart at y = 0.32)
    const faces: SpotFace[] = [{ id: 'f0', face: FACE }, { id: 'f1', face: shifted(FACE, Math.max(...xs) - Math.min(...xs)) }];
    const rr = 0.018; // ≈ 祛痘 M on this face
    const o: V2 = [0.788, 0.32]; // ≈ 1 r inside the first face's right edge
    const right = cand(o, rr, 3.2, 0);
    expect(regionAt(o, faces, ASPECT)).toEqual({ kind: 'skin', face: 'f0' });
    expect(regionAt(right, faces, ASPECT)).toEqual({ kind: 'skin', face: 'f1' });
    expect(rimKinds(right, rr, faces).filter((k) => k === 'eye' || k === 'mouth')).toEqual([]); // only the face rule can refuse it
    const img = lure((q) => isoDist(q, o) <= 1.7 * rr || isoDist(q, right) <= 1.7 * rr);
    const s = planSpot(patchAround(o, rr, img), o, rr, { faces, aspect: ASPECT, existing: [] }) as Spot;
    expect([s.dx, s.dy]).not.toEqual([0, 0]);
    expect(regionAt(donorOf(s), faces, ASPECT)).toEqual({ kind: 'skin', face: 'f0' });
  });

  it('refuses eyes, the open mouth and a full list', () => {
    const img = (x: number, y: number) => 0.62 + 0.02 * hash(x, y);
    expect(planSpot(patch(200, img), P(74), r, { faces: FACES, aspect: ASPECT, existing: [] })).toEqual({ refused: 'eye' });
    expect(planSpot(patch(200, img), mid(P(98), P(102)), r, { faces: FACES, aspect: ASPECT, existing: [] })).toEqual({ refused: 'mouth' });
    const full = Array.from({ length: SPOT_CAP }, (_, i) => ({ x: i / 100, y: 0.1, r, dx: 0, dy: 0, owner: null }));
    expect(planSpot(patch(200, img), [0.5, 0.5], r, { faces: [], aspect: 1, existing: full })).toEqual({ refused: 'cap' });
  });
});
