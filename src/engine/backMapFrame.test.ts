import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultPhoto, neutralPerson } from '../edit/state';
import { apply, IDENTITY_GEOMETRY, vToO } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import { backMapCpu } from './backMapCpu';
import { backMapFrameOf } from './backMapFrame';
import { reshapeUniforms } from './passes/reshape';
import { reshapeMapCpu } from './passes/reshapeCpu';

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
