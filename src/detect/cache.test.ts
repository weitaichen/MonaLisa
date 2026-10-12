// src/detect/cache.test.ts
import { describe, expect, it } from 'vitest';
import { aspectFits, boxScore, cachedFits, noFaceCache, normalizeDetect, personInfos, poseBox } from './cache';
import { cacheBody, cacheFace, makeCache } from './testCaches';

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
