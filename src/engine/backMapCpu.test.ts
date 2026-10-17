import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, glMat3, IDENTITY_GEOMETRY, rotateLeft, setStraighten, vToO } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import type { ParamId } from '../types';
import { backMapCpu, backMapperCpu } from './backMapCpu';
import { PARAM_DEFS } from './params';
import { reshapeUniforms } from './passes/reshape';
import { liquifyAt, reshapeMapCpu, withView } from './passes/reshapeCpu';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const oSize = { width: lm.width, height: lm.height };
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const values = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
values['shape.faceSlim'] = 1;
values['shape.eyeEnlarge'] = 1;
const oMap = reshapeMapCpu(face, reshapeUniforms(values, 1), lm.width / lm.height);

describe('backMapCpu (the CPU copy of P2, S §4.6)', () => {
  it('with an identity O map it is vToO', () => {
    const g = setStraighten(rotateLeft(IDENTITY_GEOMETRY), 12, oSize);
    const id = (x: number, y: number): [number, number] => [x, y];
    expect(backMapCpu([0.3, 0.6], { geometry: g, oSize, oMap: id })).toEqual(apply(vToO(g, oSize), [0.3, 0.6]));
  });

  it('applies Geo⁻¹ first, then the O-space chain, like the shader (withView with the float32 mat3)', () => {
    const g = setStraighten(IDENTITY_GEOMETRY, -7.3, oSize);
    const frame = { geometry: g, oSize, oMap };
    const gpuForm = withView(oMap, { geo: glMat3(vToO(g, oSize)), tile: [0, 0, 1, 1], win: [0, 0, 1, 1] });
    const many = backMapperCpu(frame);
    for (const v of [[0.4, 0.3], [0.5, 0.45], [0.62, 0.38]] as const) {
      const a = backMapCpu(v, frame);
      const b = gpuForm(v[0], v[1]);
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[1]).toBeCloseTo(b[1], 6);
      expect(many(v)).toEqual(a);
    }
  });
});

describe('backMapCpu with a 推臉筆 field (push-brush spec §4.4, §4.5)', () => {
  const liquify = { width: 4, height: 4, data: new Float32Array(32).map((_, i) => (i % 2 === 0 ? 0.02 : -0.01)), version: 1 };

  it('an oMap built with the liquify field applies it first (f16 texels, like the GPU)', () => {
    const aspect = oSize.width / oSize.height;
    const oMap = reshapeMapCpu(null, null, aspect, null, null, liquify);
    const v: [number, number] = [0.4, 0.6];
    const got = backMapCpu(v, { geometry: IDENTITY_GEOMETRY, oSize, oMap });
    const d = liquifyAt(liquify, v[0], v[1]);
    expect(got[0]).toBeCloseTo(v[0] + d[0], 12);
    expect(got[1]).toBeCloseTo(v[1] + d[1], 12);
  });

  it('then the face chain runs at the liquified point', () => {
    const u = reshapeUniforms(values, 1);
    const aspect = oSize.width / oSize.height;
    const both = reshapeMapCpu(face, u, aspect, null, null, liquify);
    const faceOnly = reshapeMapCpu(face, u, aspect);
    const v: [number, number] = [0.45, 0.5];
    const d = liquifyAt(liquify, v[0], v[1]);
    const a = backMapCpu(v, { geometry: IDENTITY_GEOMETRY, oSize, oMap: both });
    const b = faceOnly(v[0] + d[0], v[1] + d[1]);
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
  });
});
