// src/detect/cache.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Face, Landmarks478, Pose33 } from '../types';
import { addFaceScan, aspectFits, bodyBox, boxScore, buildCache, cachedFits, noFaceCache, normalizeDetect, personInfos, poseBox, rematchByIoU, withBodies, withFaces } from './cache';
import { EMPTY_PREPARED, prepareFaces } from './faces';
import { cacheBody, cacheFace, makeCache } from './testCaches';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const sample = fx('landmarks_sample_face.json') as { points: number[] };

/** the recorded sample face moved so its points' bbox is centred at (cx, cy) with width w (UV), same aspect */
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = sample.points;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const s = w / (x1 - x0);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    out[i * 3] = cx + (p[i * 3] - (x0 + x1) / 2) * s;
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * s;
    out[i * 3 + 2] = p[i * 3 + 2] * s;
  }
  return { points: out };
}

/** a pose whose face points sit on the face's own landmarks (a perfect pair); poseOn of persons.test.ts */
function poseOnFace(face: Face, vis = 0.99): Pose33 {
  const P = face.pts111;
  const points = new Float32Array(33 * 4);
  const set = (i: number, k: number) => {
    points[i * 4] = P[k * 2];
    points[i * 4 + 1] = P[k * 2 + 1];
    points[i * 4 + 3] = vis;
  };
  set(0, 46);
  set(2, 105); // the pose's left eye is the image right: matched by side, not by index
  set(5, 104);
  set(9, 90);
  set(10, 84);
  for (let i = 11; i < 33; i++) {
    points[i * 4] = P[46 * 2];
    points[i * 4 + 1] = P[46 * 2 + 1] + 0.05 + i * 0.01;
    points[i * 4 + 3] = vis;
  }
  return { points };
}

describe('normalizeDetect (S §5.4)', () => {
  it('keeps a valid cache as it is', () => {
    const c = makeCache({ bodies: [cacheBody('b0', 0.3)], persons: [{ id: 'f0', face: 'f0', body: 'b0' }, { id: 'f1', face: 'f1', body: null }] });
    const r = normalizeDetect(structuredClone(c));
    expect(r.cache).toEqual(c);
    expect(r).toMatchObject({ stale: null, lost: false });
  });
  it('a corrupt face drops only that face, its link and a person left with nothing (lost)', () => {
    const c = makeCache();
    const raw = structuredClone(c) as unknown as { faces: { lm: Float32Array }[] };
    raw.faces[1].lm = new Float32Array(10);
    const r = normalizeDetect(raw);
    expect(r.cache?.faces.map((f) => f.id)).toEqual(['f0']);
    expect(r.cache?.persons.map((p) => p.id)).toEqual(['f0']);
    expect(r.lost).toBe(true);
  });
  it('person links to missing faces are removed (Review Focus #5)', () => {
    const c = makeCache({ persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f9', body: null }] });
    const r = normalizeDetect(c);
    expect(r.cache?.persons).toEqual([{ id: 'f0', face: 'f0', body: null }]);
    expect(r.lost).toBe(true);
  });
  it('the no-face cache with p0 is valid; p0 elsewhere is not', () => {
    const none = noFaceCache(1000, 800, [{ quarter: 0, flipH: false }]);
    expect(normalizeDetect(none).cache).toEqual(none);
    const bad = makeCache({ persons: [{ id: 'p0', face: null, body: null }, { id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }] });
    expect(normalizeDetect(bad).cache?.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
  });
  it('a cache with more faces than this tier allows is not truncated, but obstacles beyond MAX_OBSTACLES are', () => {
    const faces = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((x, i) => cacheFace(`f${i}`, x, 0.1));
    const persons = faces.map((f) => ({ id: f.id, face: f.id, body: null }));
    const obstacles = Array.from({ length: 10 }, () => ({ box: { x: 0.1, y: 0.1, w: 0.01, h: 0.01 }, oval: new Float32Array(72).fill(0.1) }));
    const r = normalizeDetect(makeCache({ faces, persons, obstacles }));
    expect(r.cache?.faces).toHaveLength(6);
    expect(r.cache?.obstacles).toHaveLength(8);
  });
  it('an unusable cache is dropped with the readable face boxes of its persons', () => {
    const c = makeCache();
    const r = normalizeDetect({ ...c, v: 7 });
    expect(r.cache).toBeNull();
    expect(r.stale).toEqual({ f0: c.faces[0].box, f1: c.faces[1].box });
    expect(normalizeDetect(undefined)).toEqual({ cache: null, stale: null, lost: false });
  });
  it('a cache whose faces or bodies were all corrupt is dropped, not read as "nobody here" (p0 only in the stored no-face form)', () => {
    const c = makeCache();
    const both = structuredClone(c) as unknown as { faces: { lm: Float32Array }[] };
    both.faces[0].lm = new Float32Array(10);
    both.faces[1].lm = new Float32Array(10);
    expect(normalizeDetect(both)).toEqual({ cache: null, stale: { f0: c.faces[0].box, f1: c.faces[1].box }, lost: true });
    const one = makeCache({ faces: [cacheFace('f0', 0.5)], persons: [{ id: 'f0', face: 'f0', body: null }] });
    const oneRaw = structuredClone(one) as unknown as { faces: { lm: Float32Array }[] };
    oneRaw.faces[0].lm = new Float32Array(10);
    expect(normalizeDetect(oneRaw)).toEqual({ cache: null, stale: { f0: one.faces[0].box }, lost: true });
    const badBody = { ...cacheBody('b0', 0.5), pose: { points: new Float32Array(10) } };
    const bodyOnly = makeCache({ faces: [], bodies: [badBody], persons: [{ id: 'b0', face: null, body: 'b0' }], primary: 'b0' });
    expect(normalizeDetect(bodyOnly)).toEqual({ cache: null, stale: {}, lost: true });
    const noFaces = { ...noFaceCache(1000, 800, [{ quarter: 0, flipH: false }]), faces: undefined };
    expect(normalizeDetect(noFaces).cache).toBeNull();
    const bodiesEmpty = { ...noFaceCache(1000, 800, [{ quarter: 0, flipH: false }]), bodies: [] };
    expect(normalizeDetect(bodiesEmpty)).toEqual({ cache: bodiesEmpty, stale: null, lost: false });
  });
  it('bodyScans is kept only as distinct quarters 0–3', () => {
    // makeCache() (./testCaches, imported already) = the valid cache the step-1 normalizeDetect tests use;
    // normalizeDetect answers { cache, stale, lost }
    expect(normalizeDetect({ ...makeCache(), bodyScans: [0, 3] }).cache?.bodyScans).toEqual([0, 3]);
    expect(normalizeDetect({ ...makeCache(), bodyScans: [0, 0] }).cache?.bodyScans).toBeUndefined();
    expect(normalizeDetect({ ...makeCache(), bodyScans: [5] }).cache?.bodyScans).toBeUndefined();
    expect(normalizeDetect({ ...makeCache(), bodyScans: 'x' }).cache?.bodyScans).toBeUndefined();
    // the no-face form keeps it too (a sideways photo where 美體 found nobody upright)
    const none = { ...noFaceCache(1000, 800, [{ quarter: 0 as const, flipH: false }]), bodies: [], bodyScans: [0, 1] };
    expect(normalizeDetect(none).cache?.bodyScans).toEqual([0, 1]);
  });
  it('a pending rematch (a dropped cache’s persons a 美體 cache carries, S §7) keeps its readable boxes, never under p0 or an id the persons use', () => {
    const box = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
    const basic = { ...noFaceCache(1000, 800, []), bodies: [cacheBody('b1', 0.5)], persons: [{ id: 'b1', face: null, body: 'b1' }], primary: 'b1' };
    const r = normalizeDetect({ ...basic, rematch: { f0: box, b1: box, p0: box, f9: box, f1: { x: 'a' }, b0: box } });
    expect(r.cache?.rematch).toEqual({ f0: box, b0: box });
    expect(r.lost).toBe(false);
    expect(normalizeDetect({ ...basic, rematch: 'x' }).cache?.rematch).toBeUndefined();
    expect(normalizeDetect(basic).cache).toEqual(basic);
    // the nobody form carries it too; a cache that cannot be used hands it on with its own persons' boxes
    expect(normalizeDetect({ ...noFaceCache(1000, 800, []), bodies: [], rematch: { f0: box } }).cache?.rematch).toEqual({ f0: box });
    expect(normalizeDetect({ ...basic, v: 7, rematch: { f0: box } }).stale).toEqual({ f0: box });
  });
  it('an empty pending rematch stays (S §5.4 R3): a dropped cache without a readable face box still owes the reset toast', () => {
    const box = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
    const basic = { ...noFaceCache(1000, 800, []), bodies: [cacheBody('b1', 0.5)], persons: [{ id: 'b1', face: null, body: 'b1' }], primary: 'b1' };
    expect(normalizeDetect({ ...basic, rematch: {} })).toMatchObject({ cache: { rematch: {} }, lost: false });
    // nothing readable left in it, or only an id the cache's own persons use: still pending
    expect(normalizeDetect({ ...basic, rematch: { p0: box, f1: { x: 'a' }, b1: box } }).cache?.rematch).toEqual({});
    expect(normalizeDetect({ ...noFaceCache(1000, 800, []), bodies: [], rematch: {} }).cache?.rematch).toEqual({});
    // not a record: no rematch at all
    expect(normalizeDetect({ ...basic, rematch: [] }).cache).not.toHaveProperty('rematch');
  });
});

describe('cache helpers', () => {
  it('cachedFits checks the aspect within 1 %', () => {
    const c = makeCache();
    expect(cachedFits(c, 2048, 1536)).toBe(true);
    expect(cachedFits(c, 1440, 1080)).toBe(true);
    expect(cachedFits(c, 1536, 2048)).toBe(false);
    expect(cachedFits(c, 0, 0)).toBe(false);
  });
  it('aspectFits: within 1 %, never for an empty photo', () => {
    expect(aspectFits(2048, 1536, 1440, 1080)).toBe(true);
    expect(aspectFits(2048, 1536, 2048, 1556)).toBe(false);
    expect(aspectFits(1536, 2048, 2048, 1536)).toBe(false);
    expect(aspectFits(2048, 1536, 0, 1536)).toBe(false);
  });
  it('personInfos: cache links, or the implicit person before any cache', () => {
    expect(personInfos(makeCache({ bodies: [cacheBody('b0', 0.3)], persons: [{ id: 'f0', face: 'f0', body: 'b0' }] }))).toEqual([{ id: 'f0', face: true, body: true }]);
    expect(personInfos(null)).toEqual([{ id: 'p0', face: true, body: true }]);
    expect(personInfos(noFaceCache(10, 10, []))).toEqual([{ id: 'p0', face: false, body: false }]);
  });
  it('boxScore is selectPerson’s area × centrality; poseBox clips to the frame', () => {
    expect(boxScore({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toBeCloseTo(0.25);
    expect(boxScore({ x: 0, y: 0, w: 0.5, h: 0.5 })).toBeLessThan(boxScore({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }));
    const b = poseBox(cacheBody('b0', 0.98).pose.points);
    expect(b.x + b.w).toBeLessThanOrEqual(1);
  });
});

describe('building the cache (S §3.3, §5.3)', () => {
  const size = { width: 1000, height: 1000 };
  const two = prepareFaces([lmAt(0.3, 0.4, 0.2), lmAt(0.7, 0.4, 0.2)], 1000, 1000);
  const scans = [{ quarter: 0 as const, flipH: false }];
  it('faces become persons left to right with their face ids; nobody → the p0 form', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    expect(c.persons).toEqual([{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: null }]);
    expect(c.bodies).toBeNull();
    expect(buildCache(size, EMPTY_PREPARED, null, { faceScans: scans }).persons).toEqual([{ id: 'p0', face: null, body: null }]);
  });
  it('withBodies: ids by centre x, pairs link face persons (ids unchanged), body-only persons are appended', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const faceOf = (id: string) => two.faces.find((f) => f.id === id)!.face;
    const onF1 = { pose: poseOnFace(two.faces[1].face), mask: null, score: 0.2 };
    const lone = { pose: cacheBody('x', 0.95).pose, mask: null, score: 0.1 };
    const r = withBodies(c, [lone, onF1], faceOf);
    expect(r.cache.bodies!.map((b) => b.id)).toEqual(['b0', 'b1']);
    expect(r.cache.persons).toEqual([
      { id: 'f0', face: 'f0', body: null },
      { id: 'f1', face: 'f1', body: 'b0' },
      { id: 'b1', face: null, body: 'b1' },
    ]);
    expect(r.cache.primary).toBe(c.primary);
  });
  it('withBodies on the no-face cache drops p0; the primary is the best body', () => {
    const r = withBodies(buildCache(size, EMPTY_PREPARED, null, { faceScans: scans }), [{ pose: cacheBody('x', 0.5).pose, mask: null, score: 0.3 }], () => null);
    expect(r.cache.persons).toEqual([{ id: 'b0', face: null, body: 'b0' }]);
    expect(r.cache.primary).toBe('b0');
  });
  it('withBodies finding nobody on a no-face photo keeps p0 (no person is known, S §3.3)', () => {
    const r = withBodies(buildCache(size, EMPTY_PREPARED, null, { faceScans: scans }), [], () => null);
    expect(r.cache.bodies).toEqual([]);
    expect(r.cache.persons).toEqual([{ id: 'p0', face: null, body: null }]);
    expect(r.cache.primary).toBe('p0');
  });
  it('withBodies on a v1 people ≥ 2 cache: the matched old pose keeps b0 and its person, the others are appended (S §5.3)', () => {
    const v1 = makeCache({ faces: [], bodies: [cacheBody('b0', 0.7)], bodiesComplete: false, persons: [{ id: 'b0', face: null, body: 'b0' }], primary: 'b0' });
    const r = withBodies(v1, [{ pose: cacheBody('x', 0.2).pose, mask: null, score: 0.1 }, { pose: cacheBody('x', 0.7).pose, mask: null, score: 0.2 }], () => null);
    expect(r.cache.bodies!.map((b) => [b.id, Math.round((bodyBox(b).x + bodyBox(b).w / 2) * 10) / 10])).toEqual([['b1', 0.2], ['b0', 0.7]]);
    expect(r.cache.persons).toEqual([{ id: 'b0', face: null, body: 'b0' }, { id: 'b1', face: null, body: 'b1' }]);
    expect(r.cache).toMatchObject({ primary: 'b0', bodiesComplete: true });
    expect(r.renamed).toEqual({});
  });
  it('withBodies: an unmatched old b0 is not reused; its face person loses only the link and re-pairs, a body-only one hands over to the primary', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const faceOf = (id: string) => two.faces.find((f) => f.id === id)!.face;
    // v0.3 edited a body that is gone now; the person f1 owned it
    const v1 = { ...c, bodies: [cacheBody('b0', 0.1)], bodiesComplete: false, persons: [{ id: 'f0', face: 'f0', body: null }, { id: 'f1', face: 'f1', body: 'b0' }], primary: 'f1' };
    const onF0 = { pose: poseOnFace(two.faces[0].face), mask: null, score: 0.2 };
    const onF1 = { pose: poseOnFace(two.faces[1].face), mask: null, score: 0.2 };
    const r = withBodies(v1, [onF0, onF1], faceOf);
    expect(r.cache.bodies!.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(r.cache.persons).toEqual([{ id: 'f0', face: 'f0', body: 'b1' }, { id: 'f1', face: 'f1', body: 'b2' }]);
    expect(r.renamed).toEqual({});
    const bodyOnly = makeCache({ faces: [], bodies: [cacheBody('b0', 0.7)], bodiesComplete: false, persons: [{ id: 'b0', face: null, body: 'b0' }], primary: 'b0' });
    const r2 = withBodies(bodyOnly, [{ pose: cacheBody('x', 0.2).pose, mask: null, score: 0.1 }], () => null);
    expect(r2.cache.persons).toEqual([{ id: 'b1', face: null, body: 'b1' }]);
    expect(r2.cache.primary).toBe('b1');
    expect(r2.renamed).toEqual({ b0: 'b1' });
  });
  it('withBodies: an unmatched body-only old b0 that is not the primary (the A13 split) hands over to the best new body-only person, never to a person holding params (S §7)', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const faceOf = (id: string) => two.faces.find((f) => f.id === id)!.face;
    // v0.3 edited the body b0, which paired with no face: its person holds v0.3's local 美體 values; f0 / f1 the face part
    const split = { ...c, bodies: [cacheBody('b0', 0.92)], bodiesComplete: false, persons: [...c.persons, { id: 'b0', face: null, body: 'b0' }] };
    // re-detected (people ≥ 2): no pose matches b0 any more; one body pairs with f0, two stand alone
    const onF0 = { pose: poseOnFace(two.faces[0].face), mask: null, score: 0.9 };
    const edge = { pose: cacheBody('x', 0.08).pose, mask: null, score: 0.2 };
    const central = { pose: cacheBody('x', 0.5).pose, mask: null, score: 0.1 };
    const r = withBodies(split, [onF0, edge, central], faceOf);
    expect(r.cache.bodies!.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(r.cache.persons).toEqual([
      { id: 'f0', face: 'f0', body: 'b2' },
      { id: 'f1', face: 'f1', body: null },
      { id: 'b1', face: null, body: 'b1' },
      { id: 'b3', face: null, body: 'b3' },
    ]);
    expect(r.cache.primary).toBe(c.primary);
    // the new primary body person: selectPerson's score (area × centrality) among the body-only persons this detection
    // added; f0's body scores no better here, and f0 holds params of its own anyway
    expect(boxScore(poseBox(central.pose.points))).toBeGreaterThan(boxScore(poseBox(edge.pose.points)));
    expect(r.renamed).toEqual({ b0: 'b3' });
    // every new body paired with a face (each such person already holds params): nobody can take b0's values
    const r2 = withBodies(split, [onF0], faceOf);
    expect(r2.cache.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
    expect(r2.renamed).toEqual({ b0: null });
  });
  it('withBodies gives out no id a pending rematch names, and keeps the rematch for the face answer', () => {
    const box = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
    const pre = { ...noFaceCache(1000, 1000, []), rematch: { b0: box, f0: box } };
    const r = withBodies(pre, [cacheBody('x', 0.3), cacheBody('x', 0.7)].map((b) => ({ pose: b.pose, mask: null, score: 0.2 })), () => null);
    expect(r.cache.persons.map((p) => p.id)).toEqual(['b1', 'b2']);
    expect(r.cache.rematch).toEqual(pre.rematch);
  });
  it('withBodies never gives out a reserved id, not even to stay within b0…b3: the lowest-scoring extra bodies are dropped (S §5.3 R1)', () => {
    const box = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
    const pre = { ...noFaceCache(1000, 1000, []), rematch: { b0: box, b2: box, f1: box } };
    const found = [
      { x: 0.1, score: 0.3 },
      { x: 0.3, score: 0.05 },
      { x: 0.5, score: 0.2 },
      { x: 0.7, score: 0.4 },
    ].map(({ x, score }) => ({ pose: cacheBody('x', x).pose, mask: null, score }));
    const r = withBodies(pre, found, () => null);
    // two free ids (b1, b3): the two best scores keep their bodies, numbered by centre x
    expect(r.cache.bodies!.map((b) => [b.id, b.score])).toEqual([['b1', 0.3], ['b3', 0.4]]);
    expect(r.cache.persons.map((p) => p.id)).toEqual(['b1', 'b3']);
    expect(r.cache.rematch).toEqual(pre.rematch);
    expect(normalizeDetect(r.cache)).toMatchObject({ lost: false, cache: { rematch: pre.rematch } });
    // an unmatched old body's id is reused before a body is dropped, a reserved one never
    const old = { ...makeCache({ faces: [], bodies: [cacheBody('b3', 0.9)], bodiesComplete: false, persons: [{ id: 'b3', face: null, body: 'b3' }], primary: 'b3' }), rematch: { b0: box } };
    const r2 = withBodies(old, found, () => null);
    expect(r2.cache.bodies!.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(r2.cache.bodies!.map((b) => b.score)).toEqual([0.3, 0.2, 0.4]);
  });
  it('withBodies keeps body ids within b0…b3 when every new id would be taken by an unmatched old body', () => {
    const old = makeCache({ faces: [], bodies: [cacheBody('b0', 0.9)], bodiesComplete: false, persons: [{ id: 'b0', face: null, body: 'b0' }], primary: 'b0' });
    const found = [0.1, 0.3, 0.5, 0.7].map((x) => ({ pose: cacheBody('x', x).pose, mask: null, score: 0.1 }));
    const r = withBodies(old, found, () => null);
    expect(r.cache.bodies!.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b0']);
    expect(normalizeDetect(r.cache)).toMatchObject({ lost: false });
    expect(r.cache.persons.map((p) => p.id)).toEqual(['b1', 'b2', 'b3', 'b0']);
    expect(r.renamed).toEqual({ b0: r.cache.primary });
  });
  it('withFaces merges faces into a 基本模式 cache and keeps the body persons and their ids (A15)', () => {
    const basic = withBodies(buildCache(size, EMPTY_PREPARED, null, { faceScans: [] }), [{ pose: poseOnFace(two.faces[0].face), mask: null, score: 0.3 }], () => null).cache;
    const merged = withFaces(basic, two, scans);
    expect(merged.persons).toEqual([{ id: 'b0', face: 'f0', body: 'b0' }, { id: 'f1', face: 'f1', body: null }]);
    expect(merged.faceScans).toEqual(scans);
  });
  it('withFaces keeps the cache bodyScans on both paths (rebuilt without bodies, merged with bodies)', () => {
    const none = { ...buildCache(size, EMPTY_PREPARED, [], { faceScans: [{ quarter: 0, flipH: false }] }), bodyScans: [0, 3] as (0 | 3)[] };
    expect(withFaces(none, two, scans).bodyScans).toEqual([0, 3]);
    const basic = withBodies(buildCache(size, EMPTY_PREPARED, null, { faceScans: [] }), [{ pose: poseOnFace(two.faces[0].face), mask: null, score: 0.3 }], () => null).cache;
    expect(withFaces({ ...basic, bodyScans: [0, 1] }, two, scans).bodyScans).toEqual([0, 1]);
    expect(withFaces(basic, two, scans).bodyScans).toBeUndefined();
  });
  it('addFaceScan records a quarter once, as flipH false', () => {
    const s0: { quarter: 0 | 1 | 2 | 3; flipH: boolean }[] = [{ quarter: 0, flipH: false }];
    expect(addFaceScan(s0, 3)).toEqual([{ quarter: 0, flipH: false }, { quarter: 3, flipH: false }]);
    expect(addFaceScan(s0, 0)).toEqual(s0);
    expect(addFaceScan(s0, 0)).not.toBe(s0);
    expect(addFaceScan([], 0)).toEqual([{ quarter: 0, flipH: false }]);
  });
  it('rematchByIoU maps old persons to the new ones by face box (≥ 0.5), the rest to null', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const map = rematchByIoU({ old1: two.faces[1].box, old9: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } }, c);
    expect(map).toEqual({ old1: 'f1', old9: null });
  });
});
