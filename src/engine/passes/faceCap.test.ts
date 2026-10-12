import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { adapt } from '../../tracking/adapter111';
import { applyPreset, setParam } from '../params';
import { EMPTY_BOX, reshapeGeometry, reshapeUniforms } from './reshape';
import { attenuate, capBox, capsFor, FT, influenceBox, ovalBox, boxCentre, packFaceTable, uMaxBox, WHOLE } from './faceCap';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8'));
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
const max = reshapeUniforms(['shape.faceSlim', 'shape.eyeEnlarge'].reduce((p, id) => setParam(p, id as never, 1), applyPreset('original', 1)).values, 1);

describe('capsFor (S §4.1)', () => {
  it('half the iso distance to the nearest other face or obstacle; −1 without a neighbour', () => {
    expect(capsFor([[0.5, 0.5]], [], 1)).toEqual([-1]);
    // (0.6 − 0.2 is 0.39999999999999997 in doubles: compare closely, never exactly)
    const two = capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1);
    expect(two).toHaveLength(2);
    for (const c of two) expect(c).toBeCloseTo(0.2, 12);
    expect(capsFor([[0.2, 0.5]], [[0.3, 0.5]], 1)[0]).toBeCloseTo(0.05);
  });
  it('presence divides a neighbour’s distance; presence 0 ignores it', () => {
    expect(capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1, [1, 0.5])[0]).toBeCloseTo(0.4);
    expect(capsFor([[0.2, 0.5], [0.6, 0.5]], [], 1, [1, 0])[0]).toBe(-1);
  });
  it('iso units: a 3:1 panorama and a 1:3 screenshot (Review Focus #5)', () => {
    expect(capsFor([[0.1, 0.5], [0.2, 0.5]], [], 3)[0]).toBeCloseTo(0.05);
    expect(capsFor([[0.5, 0.1], [0.5, 0.4]], [], 3)[0]).toBeCloseTo(0.05); // dy 0.3 UV = 0.1 iso
    expect(capsFor([[0.5, 0.1], [0.5, 0.4]], [], 1 / 3)[0]).toBeCloseTo(0.45);
    // the iso disc of radius 0.1 is 0.1 wide in u and 0.1 · 3 tall in v
    const b = capBox([0.05, 0.5], 0.1, 3);
    [0.05 - 0.1, 0.5 - 0.3, 0.05 + 0.1, 0.5 + 0.3].forEach((want, i) => expect(b[i]).toBeCloseTo(want, 12));
  });
});

describe('face table packing (S §4.4)', () => {
  const t = { face, u: attenuate(max, face.yaw), layer: 0, window: WHOLE, centre: boxCentre(ovalBox(face)), cap: -1 };
  it('rows of 96 texels: pts111, ext, targets, strengths, radii, protect, box, cap, window', () => {
    const out = new Float32Array(FT.ROW * 4 * 2);
    packFaceTable([t, { ...t, u: reshapeUniforms(applyPreset('original', 1).values, 1), cap: 0.1 }], aspect, out);
    expect(Array.from(out.subarray(0, 222))).toEqual(Array.from(face.pts111));
    expect(Array.from(out.subarray(FT.EXT * 4, FT.EXT * 4 + 16))).toEqual(Array.from(face.ext));
    const g = reshapeGeometry(face, aspect, t.u);
    expect(out[FT.S1 * 4]).toBe(Math.fround(t.u.faceSlim));
    expect(out[FT.S2 * 4 + 3]).toBe(Math.fround(t.u.eyeEnlarge));
    expect(out[FT.RADII * 4 + 3]).toBe(0);
    expect(Array.from(out.subarray(FT.BOX * 4, FT.BOX * 4 + 4))).toEqual(g.box.map(Math.fround));
    expect(out[FT.CAP * 4 + 2]).toBe(-1);
    expect(Array.from(out.subarray(FT.WIN * 4, FT.WIN * 4 + 4))).toEqual([0, 0, 1, 1]);
    const row = FT.ROW * 4;
    expect(Array.from(out.subarray(row + FT.BOX * 4, row + FT.BOX * 4 + 4))).toEqual(EMPTY_BOX.map(Math.fround)); // not drawn
    expect(out[row + FT.CAP * 4 + 2]).toBe(Math.fround(0.1));
  });
  it('a capped face’s influence box is clipped to its cap disc; uMaxBox covers every item at its maximum', () => {
    const capped = influenceBox({ ...t, cap: 0.02 }, aspect);
    const c = t.centre;
    expect(capped[0]).toBeGreaterThanOrEqual(c[0] - 0.02 - 1e-9);
    expect(capped[2]).toBeLessThanOrEqual(c[0] + 0.02 + 1e-9);
    const um = uMaxBox(face, aspect);
    const g = reshapeGeometry(face, aspect, t.u).box;
    expect(um[0]).toBeLessThanOrEqual(g[0]);
    expect(um[3]).toBeGreaterThanOrEqual(g[3]);
  });
});
