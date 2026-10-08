import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ParamId } from '../../types';
import { applyPreset, setParam } from '../params';
import { adapt } from '../../tracking/adapter111';
import { RESHAPE_FS, reshapeGeometry, reshapeUniforms } from './reshape';
import { reshapeMapCpu } from './reshapeCpu';

/** FNV-1a 32 of the shader with whitespace collapsed */
function shaderHash(src: string): string {
  let h = 0x811c9dc5;
  for (const ch of src.replace(/\s+/g, ' ').trim()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const aspect = lm.width / lm.height;
// 原圖 base: every other face slider neutral
const params = (ids: ParamId[]) => ids.reduce((p, id) => setParam(p, id, 1), applyPreset('original', 1)).values;

describe('reshapeMapCpu (CPU port of RESHAPE_FS)', () => {
  it('is pinned to the shader text: a RESHAPE_FS edit must be mirrored in reshapeCpu.ts (then update this hash)', () => {
    // The e2e reshape.spec.ts compares the port with the real shader pixel by pixel; this is the cheap tripwire.
    expect(shaderHash(RESHAPE_FS)).toBe('ced9563c');
  });

  it('is the identity with no face / all deltas zero, and outside the influence box', () => {
    const u = reshapeUniforms(params(['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow']), 1);
    const map = reshapeMapCpu(face, u, aspect);
    const g = reshapeGeometry(face, aspect, u);
    for (const [x, y] of [
      [0.02, 0.02],
      [g.box[0] - 0.01, 0.5],
      [0.5, g.box[3] + 0.01],
    ])
      expect(map(x, y)).toEqual([x, y]);
    expect(reshapeMapCpu(face, reshapeUniforms(params([]), 1), aspect)(0.5, 0.5)).toEqual([0.5, 0.5]);
    expect(reshapeMapCpu(null, u, aspect)(0.5, 0.5)).toEqual([0.5, 0.5]);
  });

  it('瘦臉 pulls the cheek contour inward: the output samples the source farther out at the cheek', () => {
    const map = reshapeMapCpu(face, reshapeUniforms(params(['shape.faceSlim']), 1), aspect);
    const P = face.pts111;
    const c = [(P[0] + P[64]) / 2, (P[1] + P[65]) / 2];
    for (const i of [7, 25]) {
      const p: [number, number] = [P[i * 2], P[i * 2 + 1]];
      const s = map(p[0], p[1]);
      // backward map: the output pixel at the old contour now shows source farther from the face centre
      expect(Math.hypot(s[0] - c[0], s[1] - c[1])).toBeGreaterThan(Math.hypot(p[0] - c[0], p[1] - c[1]) + 0.005);
    }
  });

  it('applies the body field first (outermost backward map), like the shader', () => {
    const d = Math.fround(0.01);
    const body = { width: 2, height: 2, data: new Float32Array([d, 0, d, 0, d, 0, d, 0]), version: 1 };
    const u = reshapeUniforms(params(['shape.faceSlim']), 1);
    const both = reshapeMapCpu(face, u, aspect, body);
    const faceOnly = reshapeMapCpu(face, u, aspect);
    const a = both(0.5, 0.6);
    const b = faceOnly(0.5 + d, 0.6);
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(Math.abs(b[0] - (0.5 + d))).toBeGreaterThan(1e-4); // the face warp acts there
  });
});
