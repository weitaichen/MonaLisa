import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../../tracking/adapter111';
import { LID_STATIONS } from './eyeFrame';
import { eyeDebugPoints } from './overlay';

const lm = JSON.parse(readFileSync(new URL('../../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};

describe('eyeDebugPoints (face-detail spec §3.6 overlay)', () => {
  it('lists the lid stations, the brow-gap ends and 24 iris-circle points per eye, all on the image', () => {
    const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const pts = eyeDebugPoints(face, lm.width / lm.height);
    expect(pts.length).toBe(2 * 2 * (LID_STATIONS * 3 + 24));
    for (const v of pts) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
});
