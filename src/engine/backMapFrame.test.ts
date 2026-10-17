import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultPhoto, neutralPerson } from '../edit/state';
import { apply, IDENTITY_GEOMETRY, vToO } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import { backMapCpu } from './backMapCpu';
import { backMapFrameOf } from './backMapFrame';
import { reshapeUniforms } from './passes/reshape';
import { liquifyAt, reshapeMapCpu } from './passes/reshapeCpu';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const FACE = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const O_SIZE = { width: lm.width, height: lm.height };

describe('backMapFrameOf: the editor tap back-map (skin-cleanup spec §3.4)', () => {
  it('no face and no body: only Geo⁻¹', () => {
    const g = defaultPhoto().geometry;
    const f = backMapFrameOf({ faces: [], geometry: g }, O_SIZE);
    expect(backMapCpu([0.3, 0.6], f)).toEqual(apply(vToO(g, O_SIZE), [0.3, 0.6]));
  });

  it('one face: the engine face chain, as the single-face CPU port computes it', () => {
    const person = neutralPerson();
    const values = { ...person.values, 'shape.faceSlim': 0.6, 'shape.eyeEnlarge': 0.5 };
    const f = backMapFrameOf({ faces: [{ face: FACE, weight: 1, person: { ...person, values }, protect: null }], geometry: IDENTITY_GEOMETRY }, O_SIZE);
    const ref = reshapeMapCpu(FACE, reshapeUniforms(values, 1), O_SIZE.width / O_SIZE.height);
    let moved = 0;
    for (let y = 0.2; y <= 0.8; y += 0.05)
      for (let x = 0.2; x <= 0.8; x += 0.05) {
        const a = backMapCpu([x, y], f);
        const b = ref(x, y);
        expect(a[0]).toBeCloseTo(b[0], 6);
        expect(a[1]).toBeCloseTo(b[1], 6);
        moved = Math.max(moved, Math.hypot(b[0] - x, b[1] - y));
      }
    expect(moved).toBeGreaterThan(1e-3);
  });

  it('λ_f (RenderFace.warpScale) scales the face warp as the engine does: 0 leaves only Geo⁻¹', () => {
    const person = neutralPerson();
    const values = { ...person.values, 'shape.faceSlim': 0.6, 'shape.eyeEnlarge': 0.5 };
    const f = backMapFrameOf({ faces: [{ face: FACE, weight: 1, person: { ...person, values }, protect: null, warpScale: 0 }], geometry: IDENTITY_GEOMETRY }, O_SIZE);
    for (let y = 0.2; y <= 0.8; y += 0.1)
      for (let x = 0.2; x <= 0.8; x += 0.1) {
        const a = backMapCpu([x, y], f);
        expect(a[0]).toBeCloseTo(x, 9);
        expect(a[1]).toBeCloseTo(y, 9);
      }
  });
});

describe('backMapFrameOf with the 推臉筆 field (push-brush spec §4.5: a 祛痘 tap lands on what the finger touched)', () => {
  const liquify = { width: 4, height: 4, data: new Float32Array(32).map((_, i) => (i % 2 === 0 ? 0.02 : -0.01)), version: 1 };

  it('applies the strokes first, then the face chain at the liquified point', () => {
    const person = neutralPerson();
    const values = { ...person.values, 'shape.faceSlim': 0.6 };
    const faces = [{ face: FACE, weight: 1, person: { ...person, values }, protect: null }];
    const withStrokes = backMapFrameOf({ faces, geometry: IDENTITY_GEOMETRY, liquify }, O_SIZE);
    const without = backMapFrameOf({ faces, geometry: IDENTITY_GEOMETRY }, O_SIZE);
    for (const v of [[0.4, 0.6], [0.45, 0.5], [0.7, 0.3]] as [number, number][]) {
      const d = liquifyAt(liquify, v[0], v[1]);
      const a = backMapCpu(v, withStrokes);
      const b = backMapCpu([v[0] + d[0], v[1] + d[1]], without);
      expect(a[0]).toBeCloseTo(b[0], 12);
      expect(a[1]).toBeCloseTo(b[1], 12);
    }
    // no field (or null) is today's back-map exactly
    expect(backMapCpu([0.4, 0.6], backMapFrameOf({ faces, geometry: IDENTITY_GEOMETRY, liquify: null }, O_SIZE))).toEqual(backMapCpu([0.4, 0.6], without));
  });
});
