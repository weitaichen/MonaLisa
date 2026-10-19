// src/detect/persons.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { BodyField, PersonMask, Pose33 } from '../types';
import { prepareFaces } from './faces';
import { hitPerson, matchHandOver, pairCost, pairPersons, primaryOf, seedPrimary } from './persons';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../tests/fixtures/${n}`, import.meta.url), 'utf8'));
const group = fx('group_faces.landmarks.json') as { width: number; height: number; faces: number[][] };
const poses = fx('group_faces.pose.json') as { poses: { points: number[] }[] };
const prepared = prepareFaces(group.faces.map((f) => ({ points: new Float32Array(f) })), group.width, group.height);
const aspect = group.width / group.height;

/** a pose whose face points sit on the face's own landmarks (a perfect pair) */
function poseOn(face: ReturnType<typeof adapt>, vis = 0.99): Pose33 {
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

describe('pairPersons (S §3.4 P4)', () => {
  it('pairs each recorded face with the pose built on it, 1:1, eyes matched by image side (B is mirrored)', () => {
    const bodies = prepared.faces.map((f, i) => ({ id: `b${i}`, pose: poseOn(f.face), mask: null }));
    expect(pairPersons(prepared.faces, bodies.slice().reverse(), aspect).sort()).toEqual(prepared.faces.map((f, i) => [f.id, `b${i}`]));
  });
  it('fewer than 3 visible points: no pair', () => {
    const f = prepared.faces[0];
    const pose = poseOn(f.face);
    for (const i of [0, 2, 5]) pose.points[i * 4 + 3] = 0.1;
    expect(pairCost(f.face, pose, aspect)).toBeNull();
  });
  it('one face and one pose whose nose lies in the face box padded by 25 % pair whatever the cost (A14)', () => {
    const f = prepared.faces[0];
    const pose = poseOn(f.face);
    // far off: four of the five points 0.5 face widths away ≈ 0.4 FW mean ≈ 0.9 IOD (pupils ≈ 0.45 FW apart): cost > 0.5
    for (const i of [2, 5, 9, 10]) pose.points[i * 4] += f.box.w * 0.5;
    expect(pairCost(f.face, pose, aspect)!).toBeGreaterThan(0.5);
    expect(pairPersons([f], [{ id: 'b0', pose, mask: null }], aspect)).toEqual([[f.id, 'b0']]);
    expect(pairPersons([f, prepared.faces[1]], [{ id: 'b0', pose, mask: null }], aspect)).toEqual([]);
  });
  it('the recorded group poses pair with A and B when MediaPipe found their bodies', () => {
    const bodies = poses.poses.map((p, i) => ({ id: `b${i}`, pose: { points: new Float32Array(p.points) }, mask: null }));
    const pairs = pairPersons(prepared.faces, bodies, aspect);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    expect(new Set(pairs.map(([f]) => f)).size).toBe(pairs.length);
  });
});

describe('primaryOf, seedPrimary', () => {
  it('the primary is A (largest × most central, selectPerson’s score)', () => {
    const persons = prepared.faces.map((f) => ({ id: f.id, face: f.id, body: null }));
    expect(primaryOf(persons, prepared.faces, [])).toBe('f0');
  });
  it('without faces the body box decides', () => {
    const body = (cx: number) => ({ points: new Float32Array(33 * 4).map((_, k) => (k % 4 === 0 ? cx + ((k / 4) % 2) * 0.1 : k % 4 === 1 ? 0.1 + (k / 4) * 0.02 : 1)) });
    expect(primaryOf([{ id: 'b0', face: null, body: 'b0' }, { id: 'b1', face: null, body: 'b1' }], [], [{ id: 'b0', pose: body(0.05) }, { id: 'b1', pose: body(0.45) }])).toBe('b1');
  });
  it('seedPrimary: padded-box containment, the nearest centre among several, null for none', () => {
    const faces = [
      { id: 'f0', box: { x: 0.1, y: 0.4, w: 0.2, h: 0.2 } },
      { id: 'f1', box: { x: 0.32, y: 0.4, w: 0.2, h: 0.2 } },
    ];
    expect(seedPrimary({ x: 0.2, y: 0.5 }, faces)).toBe('f0');
    expect(seedPrimary({ x: 0.3, y: 0.5 }, faces)).toBe('f0'); // inside both padded boxes (f1's starts at 0.27), nearer f0's centre
    expect(seedPrimary({ x: 0.34, y: 0.5 }, faces)).toBe('f1'); // inside both, nearer f1's centre
    expect(seedPrimary({ x: 0.9, y: 0.1 }, faces)).toBeNull();
  });
});

describe('hitPerson (S §2.3)', () => {
  const ctx = {
    faces: [
      { person: 'f0', box: { x: 0.1, y: 0.3, w: 0.2, h: 0.2 } },
      { person: 'f1', box: { x: 0.5, y: 0.3, w: 0.02, h: 0.02 } },
    ],
    minW: 0.1,
    minH: 0.1,
  };
  it('faces first: the padded box, expanded to 44 pt at this zoom', () => {
    expect(hitPerson([0.2, 0.4], ctx)).toBe('f0');
    expect(hitPerson([0.54, 0.31], ctx)).toBe('f1'); // a tiny face is hit within its 44 pt
    expect(hitPerson([0.54, 0.31], { ...ctx, minW: 0.01, minH: 0.01 })).toBeNull(); // zoomed in 10×
  });
  it('maps display → source through the body field first', () => {
    const d = Math.fround(0.3);
    const field: BodyField = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    expect(hitPerson([-0.1 + 0.001, 0.4], { ...ctx, field })).toBe('f0');
  });
  it('bodies (美體 only, when no face was hit): the highest mask value, equal values → the smaller mask', () => {
    const full = (v: number): PersonMask => ({ width: 4, height: 4, data: new Uint8Array(16).fill(v) });
    const half: PersonMask = { width: 4, height: 4, data: new Uint8Array(16).map((_, i) => (i % 4 < 2 ? 200 : 0)) };
    const bodies = [
      { person: 'b0', mask: full(200), box: { x: 0, y: 0, w: 1, h: 1 } },
      { person: 'b1', mask: half, box: { x: 0, y: 0, w: 0.5, h: 1 } },
    ];
    expect(hitPerson([0.1, 0.9], { ...ctx, bodies })).toBe('b1');
    expect(hitPerson([0.9, 0.9], { ...ctx, bodies })).toBe('b0');
    expect(hitPerson([0.9, 0.9], { ...ctx, bodies: [{ person: 'b2', mask: null, box: { x: 0.8, y: 0.8, w: 0.15, h: 0.15 } }] })).toBe('b2');
  });
});

describe('matchHandOver (camera per-person spec §5.4, K14)', () => {
  const f = (id: string, x: number) => ({ id, box: { x, y: 0.3, w: 0.1, h: 0.12 } });
  const faces = [f('f0', 0.1), f('f1', 0.4), f('f2', 0.7)];
  it('pairs by IoU ≥ 0.3 (best first), then by the padded centre (nearest first), one to one; the rest are missed', () => {
    const r = matchHandOver([{ x: 0.11, y: 0.3, w: 0.1, h: 0.12 }, { x: 0.43, y: 0.33, w: 0.04, h: 0.05 }, { x: 0.9, y: 0.3, w: 0.05, h: 0.06 }], faces);
    expect(r).toEqual({ pairs: [[0, 'f0'], [1, 'f1']], missed: 1 });
  });
  it('two camera persons on one face: the better IoU takes it, the other is missed, never given another face', () => {
    const r = matchHandOver([{ x: 0.42, y: 0.3, w: 0.1, h: 0.12 }, { x: 0.4, y: 0.3, w: 0.1, h: 0.12 }], faces);
    expect(r).toEqual({ pairs: [[1, 'f1']], missed: 1 });
  });
  it('ties keep the input order (boxes, then faces)', () => {
    const r = matchHandOver([{ x: 0.1, y: 0.3, w: 0.1, h: 0.12 }], [f('a', 0.1), f('b', 0.1)]);
    expect(r.pairs).toEqual([[0, 'a']]);
  });
});
