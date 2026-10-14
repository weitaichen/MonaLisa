import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapt } from '../tracking/adapter111';
import type { Spot } from '../types';
import { mouthGuards, NEUTRAL_TONE, type ToneCap } from './passes/toneGeometry';
import { buildToneJob, objectId, type ToneJobFace } from './toneJob';

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const work = { width: 1000, height: 1500 };
const f = (values: Record<string, number>, cap: ToneCap | null = null): ToneJobFace[] => [{ face, weight: 1, values, cap }];
const job = (values: Record<string, number>, spots: Spot[] = [], src: object = work, cap: ToneCap | null = null) =>
  buildToneJob({ faces: f(values, cap), spots, aspect: 1000 / 1500, work, sourceId: objectId(src) });

describe('buildToneJob (skin-cleanup spec §4.1, §4.3 cache)', () => {
  it('neutral tone and no spots: no job, so the frame equals step 3', () => {
    expect(job({ 'tone.warmth': 0.5, 'shape.faceSlim': 0.6 })).toBeNull();
  });

  it('decides the passes per tool', () => {
    expect(job({ 'tone.even': 0.5 })).toMatchObject({ fieldOn: true, mn8On: true, retouchOn: true });
    expect(job({ 'tone.warmth': 0.3 })).toMatchObject({ fieldOn: true, mn8On: true, retouchOn: true });
    expect(job({ 'tone.teeth': 0.5 })).toMatchObject({ fieldOn: false, mn8On: false, retouchOn: true });
    expect(job({ 'tone.eyeBright': 0.5 })).toMatchObject({ fieldOn: false, mn8On: true, retouchOn: true });
    expect(job({}, [{ x: 0.5, y: 0.5, r: 0.02, dx: 0, dy: 0, owner: null }])).toMatchObject({ fieldOn: false, retouchOn: false });
  });

  it("carries 白牙's lip guard for the retouch: the faces with 白牙 on, in O's aspect", () => {
    expect(job({ 'tone.teeth': 0.5 })!.mouths).toEqual(mouthGuards([{ face, values: { ...NEUTRAL_TONE, teeth: 0.5 }, weight: 1, cap: null }], 1000 / 1500));
    expect(job({ 'tone.teeth': 0.5 })!.mouths.mouths).toHaveLength(1);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3 })!.mouths.mouths).toEqual([]);
  });

  it('a 瘦臉, 白牙 or 亮眼-amount change keeps the key; a 勻膚 or 黑眼圈 change or a new spot rebuilds', () => {
    const k = job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3 })!.key;
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3, 'shape.faceSlim': 1 })!.key).toBe(k);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.9, 'tone.teeth': 1 })!.key).toBe(k);
    expect(job({ 'tone.even': 0.51, 'tone.eyeBright': 0.3 })!.key).not.toBe(k);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3, 'tone.darkCircle': 0.2 })!.key).not.toBe(k);
    expect(job({ 'tone.even': 0.5, 'tone.eyeBright': 0.3 }, [{ x: 0.3, y: 0.3, r: 0.02, dx: 0.05, dy: 0, owner: null }])!.key).not.toBe(k);
  });

  it('a 膚色 face whose cap changes rebuilds: the cap sets the wide ring w_T that Q.B, and so Δ8, is drawn with', () => {
    const v = { 'tone.warmth': 0.8 };
    const k = job(v)!.key;
    expect(job(v, [], work, null)!.key).toBe(k);
    expect(job(v, [], work, { c: [0.5, 0.4], r: 0.35 })!.key).not.toBe(k);
    expect(job(v, [], work, { c: [0.5, 0.4], r: 0.35 })!.key).toBe(job(v, [], work, { c: [0.5, 0.4], r: 0.35 })!.key);
  });

  it('two photos of the same size never share a field (Review Focus 5)', () => {
    const a = { name: 'bitmap a' };
    const b = { name: 'bitmap b' };
    expect(job({ 'tone.even': 0.5 }, [], a)!.key).not.toBe(job({ 'tone.even': 0.5 }, [], b)!.key);
    expect(job({ 'tone.even': 0.5 }, [], a)!.key).toBe(job({ 'tone.even': 0.5 }, [], a)!.key);
  });

  it('σ_low follows the largest edited face', () => {
    expect(job({ 'tone.even': 1 })!.sigmaLowPx).toBeCloseTo(0.08 * 588.8, 0);
  });
});
