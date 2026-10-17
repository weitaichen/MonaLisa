import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paramsInGroup, SPLIT_IDS } from '../engine/params';
import { adapt } from '../tracking/adapter111';
import type { PersonParamId } from '../types';
import { benchFaces, makeupBenchPerson, medianMs, warpBenchPerson } from './faceDetailBench';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);

describe('step-5 bench inputs (face-detail spec §6.2)', () => {
  it('row 1: every 美型 item at its extreme, the six split items at the opposite extreme on the right', () => {
    const hi = warpBenchPerson(1);
    for (const d of paramsInGroup('shape')) expect(hi.values[d.id as PersonParamId]).toBe(1);
    const lo = warpBenchPerson(0);
    for (const d of paramsInGroup('shape')) expect(lo.values[d.id as PersonParamId]).toBe(d.bidirectional ? 0 : 1);
    expect(Object.keys(hi.right ?? {}).sort()).toEqual([...SPLIT_IDS].sort());
    for (const id of SPLIT_IDS) expect(hi.right?.[id]).toBe(0);
  });

  it('row 2: every makeup part at 100, with a shade where the part has shades', () => {
    const p = makeupBenchPerson();
    for (const id of ['makeup.lip', 'makeup.blush', 'makeup.brow', 'makeup.eyeshadow', 'makeup.liner', 'makeup.lashes', 'makeup.aegyo', 'makeup.contour', 'makeup.highlight', 'makeup.lens'] as const)
      expect(p.values[id]).toBe(1);
    expect(p.shades).toMatchObject({ lip: 'rose', blush: 'peach', brow: 'black', eyeshadow: 'earth', liner: 'black', lens: 'blue' });
  });

  it('N faces fit in the frame without overlapping', () => {
    for (const n of [1, 3, 6]) {
      const fs = benchFaces(face, n, warpBenchPerson(1));
      expect(fs).toHaveLength(n);
      const boxes = fs.map((f) => {
        const xs = Array.from(f.face.oval).filter((_, i) => i % 2 === 0);
        const ys = Array.from(f.face.oval).filter((_, i) => i % 2 === 1);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      });
      for (const b of boxes) {
        expect(b[0]).toBeGreaterThanOrEqual(0);
        expect(b[1]).toBeGreaterThanOrEqual(0);
        expect(b[2]).toBeLessThanOrEqual(1);
        expect(b[3]).toBeLessThanOrEqual(1);
      }
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          expect(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]).toBe(true);
        }
    }
  });

  it('medianMs', () => {
    expect(medianMs([5, 1, 3])).toBe(3);
    expect(medianMs([4, 1, 3, 2])).toBe(2.5);
  });
});
