// src/detect/cache.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_OBSTACLES, MAX_RENDER_FACES } from '../config/limits';
import type { Face, Landmarks478, Pose33 } from '../types';
import { addFaceScan, aspectFits, bodyBox, boxScore, buildCache, cachedFits, noFaceCache, normalizeDetect, personInfos, poseBox, rematchByIoU, withBodies, withFaces, withMoreFaces } from './cache';
import { boxIoU, EMPTY_PREPARED, prepareFaces } from './faces';
import { cacheBody, cacheFace, makeCache } from './testCaches';
import { retake, ringHolds, sampleFaceAt } from './testMeshes';

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
    const obstacles = Array.from({ length: MAX_OBSTACLES + 2 }, () => ({ box: { x: 0.1, y: 0.1, w: 0.01, h: 0.01 }, oval: new Float32Array(72).fill(0.1) }));
    const r = normalizeDetect(makeCache({ faces, persons, obstacles }));
    expect(r.cache?.faces).toHaveLength(6);
    expect(r.cache?.obstacles).toHaveLength(MAX_OBSTACLES);
    // S §6.7: a cache holds every obstacle one detection can leave (12); an older build's 8 read back whole
    expect(MAX_OBSTACLES).toBe(12);
    expect(normalizeDetect(makeCache({ faces, persons, obstacles: obstacles.slice(0, 8) })).cache?.obstacles).toHaveLength(8);
  });
  it('a cache at the face cap (MAX_RENDER_FACES = 10, ids f0…f9) is kept whole: faces, persons, nothing lost (S §6.7)', () => {
    const ids = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'];
    expect(MAX_RENDER_FACES).toBe(ids.length);
    const faces = ids.map((id, i) => cacheFace(id, 0.05 + i * 0.1, 0.07));
    const persons = faces.map((f) => ({ id: f.id, face: f.id, body: null }));
    const r = normalizeDetect(makeCache({ faces, persons, primary: 'f9' }));
    expect(r.lost).toBe(false);
    expect(r.cache?.faces.map((f) => f.id)).toEqual(ids);
    expect(r.cache?.persons.map((p) => p.id)).toEqual(ids);
    expect(r.cache?.primary).toBe('f9');
    // one past the bound: an eleventh face (f10 is no valid id: ids are one digit) is dropped with its person, and the
    // cache-dropped flag is set
    const eleven = normalizeDetect(makeCache({ faces: [...faces, cacheFace('f10', 0.5, 0.04)], persons: [...persons, { id: 'f10', face: 'f10', body: null }], primary: 'f0' }));
    expect(eleven.cache?.faces).toHaveLength(MAX_RENDER_FACES);
    expect(eleven.cache?.persons.map((p) => p.id)).not.toContain('f10');
    expect(eleven.lost).toBe(true);
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
    // f9 is the tenth face's id (S §6.7); f10 is no id
    const r = normalizeDetect({ ...basic, rematch: { f0: box, b1: box, p0: box, f9: box, f10: box, f1: { x: 'a' }, b0: box } });
    expect(r.cache?.rematch).toEqual({ f0: box, f9: box, b0: box });
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
  it('normalizeDetect keeps the short-range mark (D3), and only that value', () => {
    const owed = [{ quarter: 0 as const, flipH: false, detector: 'short-range' as const }];
    const c = { ...buildCache(size, two, null, { faceScans: owed }), photoDetector: 'short-range' as const };
    expect(normalizeDetect(structuredClone(c)).cache).toEqual(c);
    expect(normalizeDetect({ ...structuredClone(c), photoDetector: 'full-range' }).cache).not.toHaveProperty('photoDetector');
    const none = { ...noFaceCache(1000, 1000, owed), photoDetector: 'short-range' as const };
    expect(normalizeDetect(structuredClone(none)).cache).toEqual(none);
  });
  it('normalizeDetect: a scan record keeps its short-range flag only on a marked cache; a marked one that flags none owes every record (round 4)', () => {
    const turned = [
      { quarter: 0 as const, flipH: false },
      { quarter: 1 as const, flipH: false, detector: 'short-range' as const },
    ];
    // the turned up-frame owed, the upright one answered full-range: both read back as they are
    const mixed = { ...noFaceCache(1000, 1000, turned), photoDetector: 'short-range' as const };
    expect(normalizeDetect(structuredClone(mixed)).cache?.faceScans).toEqual(turned);
    // no mark, nothing owed: a stray flag is dropped
    expect(normalizeDetect(structuredClone(noFaceCache(1000, 1000, turned))).cache?.faceScans).toEqual([
      { quarter: 0, flipH: false },
      { quarter: 1, flipH: false },
    ]);
    // a mark over records that carry no flag (written before they did): every one is owed, as the mark said then
    const old = { ...noFaceCache(1000, 1000, [{ quarter: 0, flipH: false }, { quarter: 1, flipH: false }]), photoDetector: 'short-range' as const };
    expect(normalizeDetect(structuredClone(old)).cache?.faceScans).toEqual([
      { quarter: 0, flipH: false, detector: 'short-range' },
      { quarter: 1, flipH: false, detector: 'short-range' },
    ]);
    // any other value is no flag
    const odd = { ...mixed, faceScans: [{ quarter: 0, flipH: false, detector: 'full-range' }, { quarter: 1, flipH: false, detector: 'short-range' }] };
    expect(normalizeDetect(structuredClone(odd)).cache?.faceScans).toEqual(turned);
  });
  it('withMoreFaces (D3): the faces full-range adds to a short-range cache; every cached face, person and link stays as it was', () => {
    // short-range found A and C of four; full-range finds all four, A and C boxed a little differently
    const short = { ...buildCache(size, prepareFaces([lmAt(0.2, 0.4, 0.12), lmAt(0.6, 0.4, 0.12)], 1000, 1000), null, { faceScans: scans }), primary: 'f1', photoDetector: 'short-range' as const };
    const full = prepareFaces([lmAt(0.205, 0.4, 0.12), lmAt(0.4, 0.4, 0.1), lmAt(0.6, 0.402, 0.12), lmAt(0.8, 0.4, 0.1)], 1000, 1000);
    const r = withMoreFaces(short, full);
    expect(r.added).toEqual(['f2', 'f3']);
    // display order, the cached faces under their ids and with their own landmarks (the same arrays)
    expect(r.cache.faces.map((f) => f.id)).toEqual(['f0', 'f2', 'f1', 'f3']);
    expect(r.cache.faces[0].lm).toBe(short.faces[0].lm);
    expect(r.cache.faces[2]).toBe(short.faces[1]);
    expect(r.cache.persons).toEqual([...short.persons, { id: 'f2', face: 'f2', body: null }, { id: 'f3', face: 'f3', body: null }]);
    expect(r.cache.primary).toBe('f1');
    expect(r.cache).not.toHaveProperty('photoDetector');
    expect(r.cache.faceScans).toEqual(scans);
    expect(normalizeDetect(structuredClone(r.cache))).toMatchObject({ lost: false });
    // nothing new: the same faces and persons, the mark cleared
    const same = withMoreFaces(short, prepareFaces([lmAt(0.2, 0.4, 0.12), lmAt(0.6, 0.4, 0.12)], 1000, 1000));
    expect(same.added).toEqual([]);
    expect(same.cache).toEqual({ ...short, photoDetector: undefined, dropped: same.cache.dropped });
    expect(same.cache).not.toHaveProperty('photoDetector');
  });
  it('withMoreFaces: a found face on a cached face\'s head is that face, though boxed apart (IoU ≤ 0.6: its landmarks on the cached ones, sameHead); a neighbour is new', () => {
    const head = lmAt(0.5, 0.4, 0.2);
    const short = { ...buildCache(size, prepareFaces([head], 1000, 1000), null, { faceScans: scans }), photoDetector: 'short-range' as const };
    // full-range meshes the cached head 1.3× larger about its nose, and finds a neighbour cheek to cheek
    const full = prepareFaces([retake(head, { scale: 1.3 }), lmAt(0.32, 0.4, 0.14)], 1000, 1000);
    expect(full.faces).toHaveLength(2);
    expect(boxIoU(full.faces[1].box, short.faces[0].box)).toBeLessThan(0.6);
    const r = withMoreFaces(short, full);
    expect(r.added).toEqual(['f1']);
    expect(r.cache.faces.map((f) => [f.id, +(f.box.x + f.box.w / 2).toFixed(2)])).toEqual([['f1', 0.32], ['f0', 0.5]]);
    expect(r.cache.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
  });
  it("withMoreFaces (real face ovals): a smaller friend whose face shows beside the cached face's jaw is new; the cached head meshed 1.3× larger is not (round 4)", () => {
    const a = sampleFaceAt(0.5, 0.5, 0.4);
    const short = { ...buildCache(size, prepareFaces([a], 1000, 1000), null, { faceScans: scans }), photoDetector: 'short-range' as const };
    // B: about a quarter of it behind A's jaw, its centre outside A's face oval (IoU 0.17)
    const r = withMoreFaces(short, prepareFaces([a, sampleFaceAt(0.344, 0.604, 0.2)], 1000, 1000));
    expect(r.added).toEqual(['f1']);
    expect(r.cache.faces.map((f) => [f.id, +(f.box.x + f.box.w / 2).toFixed(2)])).toEqual([['f1', 0.34], ['f0', 0.5]]);
    expect(r.cache.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
    // full-range meshes A's head 1.3× larger about its nose (IoU under 0.6): nobody new, no obstacle
    const larger = prepareFaces([retake(a, { scale: 1.3 })], 1000, 1000);
    expect(boxIoU(larger.faces[0].box, short.faces[0].box)).toBeLessThan(0.6);
    const e1 = withMoreFaces(short, larger);
    expect(e1.added).toEqual([]);
    expect(e1.cache.faces).toEqual(short.faces);
    expect(e1.cache.obstacles).toEqual([]);
    // a mesh 0.4× A's size inside its oval is a smaller person (round 3's E1 premise, which no real pair showed)
    expect(withMoreFaces(short, prepareFaces([sampleFaceAt(0.64, 0.5, 0.16)], 1000, 1000)).added).toEqual(['f1']);
  });
  it('withMoreFaces keeps a cached obstacle that is no face: a tiny face beside the cached face\'s jaw stays, unless a new face is it, boxed as it (IoU > 0.6: an obstacle has no landmarks; round 4 F2)', () => {
    const a = sampleFaceAt(0.5, 0.5, 0.4);
    const o = sampleFaceAt(0.344, 0.604, 0.028);
    const first = prepareFaces([a, o], 1000, 1000);
    // O is under MIN_FACE_FRAC: an obstacle, its nose outside A's face oval
    expect(first.faces).toHaveLength(1);
    expect(first.obstacles).toHaveLength(1);
    expect(ringHolds(first.faces[0].face.oval, [o.points[3], o.points[4]])).toBe(false);
    const short = { ...buildCache(size, first, null, { faceScans: scans }), photoDetector: 'short-range' as const };
    const cached = short.obstacles[0];
    // full-range finds A, O and C: C is added, O stays, the cached copy
    const withC = withMoreFaces(short, prepareFaces([a, o, sampleFaceAt(0.85, 0.3, 0.1)], 1000, 1000));
    expect(withC.added).toEqual(['f1']);
    expect(withC.cache.obstacles).toHaveLength(1);
    expect(withC.cache.obstacles[0]).toBe(cached);
    // nothing new (full-range boxes O a hair apart): the obstacles as they were
    const same = withMoreFaces(short, prepareFaces([a, sampleFaceAt(0.3445, 0.6045, 0.028)], 1000, 1000));
    expect(same.added).toEqual([]);
    expect(same.cache.obstacles).toEqual(short.obstacles);
    expect(same.cache.obstacles[0]).toBe(cached);
    // full-range meshes O a little larger, over the size filter: a new face, which takes the obstacle's place
    const grown = withMoreFaces(short, prepareFaces([a, sampleFaceAt(0.344, 0.604, 0.031)], 1000, 1000));
    expect(grown.added).toEqual(['f1']);
    expect(grown.cache.obstacles).toEqual([]);
    // a face twice O's size there is not boxed as O (IoU 0.25), which no mesh of one head is: O stays
    const twice = withMoreFaces(short, prepareFaces([a, sampleFaceAt(0.344, 0.604, 0.056)], 1000, 1000));
    expect(twice.added).toEqual(['f1']);
    expect(twice.cache.obstacles).toEqual([cached]);
  });
  it('withMoreFaces fills up to MAX_EDIT_FACES (largest first, ids f0…f9); the rest are obstacles and count as over the cap', () => {
    const xs = [0.05, 0.14, 0.23, 0.32, 0.41, 0.5, 0.59, 0.68, 0.77];
    const short = { ...buildCache(size, prepareFaces(xs.map((x) => lmAt(x, 0.3, 0.06)), 1000, 1000), null, { faceScans: scans }), photoDetector: 'short-range' as const };
    expect(short.faces).toHaveLength(9);
    // full-range: six of the nine (it misses three) and four more in a row below, the second one the largest
    const more = [lmAt(0.2, 0.7, 0.07), lmAt(0.4, 0.7, 0.08), lmAt(0.6, 0.7, 0.065), lmAt(0.8, 0.7, 0.05)];
    const full = prepareFaces([...xs.slice(0, 6).map((x) => lmAt(x, 0.3, 0.06)), ...more], 1000, 1000);
    expect(full.faces).toHaveLength(10);
    const r = withMoreFaces(short, full);
    expect(r.cache.faces).toHaveLength(MAX_RENDER_FACES);
    expect(r.added).toEqual(['f9']);
    const added = r.cache.faces.find((f) => f.id === 'f9')!;
    expect(added.box.x + added.box.w / 2).toBeCloseTo(0.4, 2);
    // the three full-range missed stay, the three new ones without room are obstacles
    for (const f of short.faces) expect(r.cache.faces).toContain(f);
    expect(r.cache.obstacles.map((o) => +(o.box.x + o.box.w / 2).toFixed(2)).sort()).toEqual([0.2, 0.6, 0.8]);
    expect(r.cache.dropped.overCap).toBe(3);
    expect(r.cache.persons.map((p) => p.id)).toEqual([...short.persons.map((p) => p.id), 'f9']);
  });
  it('withMoreFaces: a new face pairs with a body-only person, which keeps its id (A15); an obstacle at a new face goes', () => {
    const ab = prepareFaces([lmAt(0.3, 0.4, 0.12), lmAt(0.7, 0.4, 0.12)], 1000, 1000);
    const onB = { pose: poseOnFace(ab.faces[1].face), mask: null, score: 0.2 };
    const short = withBodies(buildCache(size, prepareFaces([lmAt(0.3, 0.4, 0.12)], 1000, 1000), null, { faceScans: scans }), [onB], () => null).cache;
    const marked = { ...short, obstacles: [{ box: ab.faces[1].box, oval: ab.faces[1].face.oval }], photoDetector: 'short-range' as const };
    expect(marked.persons).toEqual([{ id: 'f0', face: 'f0', body: null }, { id: 'b0', face: null, body: 'b0' }]);
    const r = withMoreFaces(marked, ab);
    expect(r.added).toEqual(['f1']);
    expect(r.cache.persons).toEqual([{ id: 'f0', face: 'f0', body: null }, { id: 'b0', face: 'f1', body: 'b0' }]);
    expect(r.cache.obstacles).toEqual([]);
    expect(r.cache.bodies).toBe(marked.bodies);
  });
  it('addFaceScan records a quarter once, as flipH false', () => {
    const s0: { quarter: 0 | 1 | 2 | 3; flipH: boolean }[] = [{ quarter: 0, flipH: false }];
    expect(addFaceScan(s0, 3)).toEqual([{ quarter: 0, flipH: false }, { quarter: 3, flipH: false }]);
    expect(addFaceScan(s0, 0)).toEqual(s0);
    expect(addFaceScan(s0, 0)).not.toBe(s0);
    expect(addFaceScan([], 0)).toEqual([{ quarter: 0, flipH: false }]);
  });
  it('addFaceScan flags a short-range answer; a full-range one for a recorded up-frame replaces its record, moved last (round 4)', () => {
    const short = addFaceScan([], 0, 'short-range');
    expect(short).toEqual([{ quarter: 0, flipH: false, detector: 'short-range' }]);
    const turned = addFaceScan(short, 1, 'full-range');
    expect(turned).toEqual([{ quarter: 0, flipH: false, detector: 'short-range' }, { quarter: 1, flipH: false }]);
    // the completion's upright answer: the owed record goes, the new one is the last (the newest answer)
    expect(addFaceScan(turned, 0, 'full-range')).toEqual([{ quarter: 1, flipH: false }, { quarter: 0, flipH: false }]);
    // no detector named: the record stays as it is
    expect(addFaceScan(turned, 0)).toEqual(turned);
    expect(addFaceScan(turned, 0, null)).toEqual(turned);
  });
  it('rematchByIoU maps old persons to the new ones by face box (≥ 0.5), the rest to null', () => {
    const c = buildCache(size, two, null, { faceScans: scans });
    const map = rematchByIoU({ old1: two.faces[1].box, old9: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } }, c);
    expect(map).toEqual({ old1: 'f1', old9: null });
  });
});
