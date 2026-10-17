import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyShades, neutralPerson } from '../../edit/state';
import { adapt } from '../../tracking/adapter111';
import type { Face, PersonParams, RenderFace } from '../../types';
import { eyeFrames } from './eyeFrame';
import {
  buildMakeupGeometry,
  FLOATS_PER_VERTEX,
  geometryVertexCount,
  KIND,
  LAYER_ORDER,
  MAX_PMAKEUP_VERTS_PER_FACE,
  oAspectOf,
  procMakeupWanted,
  StripWriter,
  type MakeupGeometry,
  type MakeupLayer,
} from './makeupProc';
import { faceWidthIso, yawAttenuation } from './reshape';
import { closeEye, scaleFace } from './syntheticFaces';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const aspect = lm.width / lm.height;
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const ALL8 = {
  'makeup.brow': 1, 'makeup.eyeshadow': 1, 'makeup.liner': 1, 'makeup.lashes': 1,
  'makeup.aegyo': 1, 'makeup.contour': 1, 'makeup.highlight': 1, 'makeup.lens': 1,
};
const person = (values: Record<string, number> = ALL8, shades: Partial<PersonParams['shades']> = { brow: 'black', eyeshadow: 'earth', lens: 'blue' }): PersonParams => ({
  ...neutralPerson(),
  values: { ...neutralPerson().values, ...values },
  shades: { ...emptyShades(), ...shades },
});
const rf = (f: Face = face, p: PersonParams = person(), weight = 1): RenderFace => ({ face: f, weight, person: p, protect: null });
type Vtx = { pos: [number, number]; loc: [number, number]; aux: [number, number]; a: number; kind: number };
const verts = (g: MakeupGeometry, layer: MakeupLayer): Vtx[] => {
  const [first, count] = g.ranges[layer];
  return Array.from({ length: count }, (_, i) => {
    const o = (first + i) * FLOATS_PER_VERTEX;
    const d = g.data;
    return { pos: [d[o], d[o + 1]], loc: [d[o + 2], d[o + 3]], aux: [d[o + 4], d[o + 5]], a: d[o + 9], kind: d[o + 10] };
  });
};

describe('StripWriter (face-detail spec §4.6)', () => {
  it('joins pieces with degenerate vertices, starts every piece on an even index and grows its buffer', () => {
    const w = new StripWriter(new Float32Array(0));
    const v = (x: number) => w.vertex([x, 0], [0, 0], [0, 0], [0, 0, 0, 1], 0);
    w.beginLayer();
    w.beginPiece();
    [1, 2, 3].forEach(v);
    w.beginPiece();
    [4, 5, 6, 7].forEach(v);
    w.beginPiece();
    [8, 9].forEach(v);
    const [first, count] = w.range();
    const xs = Array.from({ length: count }, (_, i) => w.data[(first + i) * FLOATS_PER_VERTEX]);
    expect(xs).toEqual([1, 2, 3, 3, 4, 4, 4, 5, 6, 7, 7, 8, 8, 9]);
    w.beginLayer();
    w.beginPiece();
    v(10);
    expect(w.range()).toEqual([14, 1]);
  });
});

describe('buildMakeupGeometry (face-detail spec §4.6–4.9)', () => {
  it('is finite, ≤ MAX_PMAKEUP_VERTS_PER_FACE with every part on, empty with every part at 0', () => {
    const g = buildMakeupGeometry([rf()], aspect);
    const n = geometryVertexCount(g);
    expect(n).toBeGreaterThan(500);
    expect(n).toBeLessThanOrEqual(MAX_PMAKEUP_VERTS_PER_FACE);
    for (let i = 0; i < n * FLOATS_PER_VERTEX; i++) expect(Number.isFinite(g.data[i])).toBe(true);
    expect(geometryVertexCount(buildMakeupGeometry([rf(face, person({}))], aspect))).toBe(0);
    expect(geometryVertexCount(buildMakeupGeometry([rf(face, person(), 0)], aspect))).toBe(0);
    for (const l of LAYER_ORDER) expect(g.ranges[l][1]).toBeGreaterThan(0);
  });

  it('lays the layers out contiguously in LAYER_ORDER', () => {
    const g = buildMakeupGeometry([rf()], aspect);
    let next = 0;
    for (const l of LAYER_ORDER) {
      expect(g.ranges[l][0]).toBe(next);
      next += g.ranges[l][1];
    }
  });

  it('修容 stays inside the face contour (pts111 0–32 closed through ext[0]) grown by 0.02 FW', () => {
    const P = face.pts111;
    const poly: [number, number][] = [];
    for (let i = 0; i <= 32; i++) poly.push([P[i * 2], P[i * 2 + 1] / aspect]);
    poly.push([face.ext[0], face.ext[1] / aspect]);
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const distToPoly = (x: number, y: number) => {
      let best = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [ax, ay] = poly[j];
        const [bx, by] = poly[i];
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, ay + (by - ay) * t - y));
      }
      return best;
    };
    const fw = faceWidthIso(face, aspect);
    for (const v of verts(buildMakeupGeometry([rf()], aspect), 'contour')) {
      const [x, y] = [v.pos[0], v.pos[1] / aspect];
      if (!inside(x, y)) expect(distToPoly(x, y)).toBeLessThanOrEqual(0.02 * fw);
    }
  });

  it('eye ribbons keep their §4.8 station and offset ranges', () => {
    const g = buildMakeupGeometry([rf()], aspect);
    const e = 1e-6;
    const within = (v: number, lo: number, hi: number) => v >= lo - e && v <= hi + e;
    for (const v of verts(g, 'shadow')) {
      // upper piece: d from −0.02 to H = 0.65·max(browGap, 0.25), carried in aAux.x
      if (v.kind === KIND.shadowUpper) expect(within(v.loc[0], -0.22, 1) && within(v.loc[1], -0.02, v.aux[0]) && v.aux[0] >= 0.65 * 0.25 - e).toBe(true);
      else expect(within(v.loc[0], -0.15, 0.55) && within(v.loc[1], -0.03, 0.1)).toBe(true);
    }
    for (const v of verts(g, 'liner')) expect(within(v.loc[0], 0, 1) && within(v.loc[1], -0.03, 0.045 + 0.02)).toBe(true);
    for (const v of verts(g, 'lashes')) {
      expect(within(v.loc[0], (-0.22 + 0.2) / 1.2, 1)).toBe(true);
      expect([0, 1]).toContain(v.loc[1]);
    }
    for (const l of ['aegyoLight', 'aegyoShade'] as const) for (const v of verts(g, l)) expect(within(v.loc[0], 0.05, 1) && within(v.loc[1], 0, 0.16)).toBe(true);
  });

  it('a closed eye draws no 美瞳 and no 睫毛 but keeps 眼影, 眼線 and 臥蠶; a wink keeps both on the open eye', () => {
    const closed = buildMakeupGeometry([rf(closeEye(closeEye(face, 0), 1))], aspect);
    expect(closed.ranges.lens[1]).toBe(0);
    expect(closed.ranges.lashes[1]).toBe(0);
    for (const l of ['shadow', 'liner', 'aegyoLight', 'aegyoShade'] as const) expect(closed.ranges[l][1]).toBeGreaterThan(0);
    const wink = buildMakeupGeometry([rf(closeEye(face, 0))], aspect);
    const [left, right] = eyeFrames(face, aspect);
    for (const l of ['lens', 'lashes'] as const) {
      const vs = verts(wink, l);
      expect(vs.length).toBeGreaterThan(0);
      for (const v of vs) expect(Math.abs(v.pos[0] - right.o[0])).toBeLessThan(Math.abs(v.pos[0] - left.o[0]));
    }
  });

  it('gates scale α_max: live weight, the yaw far side, the 睫毛 size gate', () => {
    const full = verts(buildMakeupGeometry([rf()], aspect), 'brow');
    const half = verts(buildMakeupGeometry([rf(face, person(), 0.5)], aspect), 'brow');
    expect(half.map((v) => v.a)).toEqual(full.map((v) => Math.fround(v.a * 0.5)));
    const turned = { ...face, yaw: 0.25 };
    const att = yawAttenuation(0.25);
    const mid = (face.pts111[0] + face.pts111[64]) / 2;
    for (const v of verts(buildMakeupGeometry([rf(turned)], aspect), 'contour')) {
      if (v.pos[0] > mid + 0.1) expect(v.a).toBeCloseTo(att, 6);
      if (v.pos[0] < mid - 0.1) expect(v.a).toBeCloseTo(1, 6);
    }
    const tiny = buildMakeupGeometry([rf(scaleFace(face, 0.07, [0.5, 0.5]))], aspect);
    expect(tiny.ranges.lashes[1]).toBe(0);
    expect(tiny.ranges.liner[1]).toBeGreaterThan(0);
    for (let i = 0; i < geometryVertexCount(tiny) * FLOATS_PER_VERTEX; i++) expect(Number.isFinite(tiny.data[i])).toBe(true);
  });

  it('two faces give disjoint geometry and share every layer strip', () => {
    const a = scaleFace(face, 0.5, [0, 0.5]);
    const b = scaleFace(face, 0.5, [1, 0.5]);
    const one = buildMakeupGeometry([rf(a)], aspect);
    const two = buildMakeupGeometry([rf(a), rf(b)], aspect);
    expect(geometryVertexCount(two)).toBeLessThanOrEqual(2 * MAX_PMAKEUP_VERTS_PER_FACE);
    for (const l of LAYER_ORDER) {
      const xs = verts(two, l).map((v) => v.pos[0]);
      expect(xs.some((x) => x < 0.5)).toBe(true);
      expect(xs.some((x) => x > 0.5)).toBe(true);
      expect(two.ranges[l][1]).toBeGreaterThanOrEqual(2 * one.ranges[l][1]);
      expect(two.ranges[l][1]).toBeLessThanOrEqual(2 * one.ranges[l][1] + 3);
    }
  });

  it('procMakeupWanted and oAspectOf', () => {
    expect(procMakeupWanted([rf(face, person({}))])).toBe(false);
    expect(procMakeupWanted([rf(face, person({ 'makeup.lip': 1 }))])).toBe(false);
    expect(procMakeupWanted([rf(face, person({ 'makeup.highlight': 0.2 }))])).toBe(true);
    expect(procMakeupWanted([rf(face, person({ 'makeup.highlight': 0.2 }), 0)])).toBe(false);
    expect(oAspectOf({ width: 500, height: 750, sourceWindow: { x: 0.5, y: 0, w: 0.5, h: 0.5 } })).toBeCloseTo(1000 / 1500, 12);
    expect(oAspectOf({ width: 1000, height: 1500 })).toBeCloseTo(1000 / 1500, 12);
    expect(oAspectOf({ width: 500, height: 750, sourceWindow: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, oAspect: 0.6667 })).toBe(0.6667);
  });
});
