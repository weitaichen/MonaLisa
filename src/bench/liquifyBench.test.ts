import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LiquifyModel } from '../edit/liquify';
import { strokesS30 } from '../edit/strokeFixtures';
import { adjustValuesNeutral } from '../engine/adjustMath';
import { MAKEUP_PARAM, neutralValue, paramDef, paramsInGroup } from '../engine/params';
import { adapt } from '../tracking/adapter111';
import type { Engine, PersonParamId, PhotoParamId } from '../types';
import { benchReplay, benchStamps, formatLiquifyReport, frameTimeMs, liquifyFrameInput } from './liquifyBench';

/** a clock that advances 1 ms per read: the rows are deterministic and positive */
const tick = () => {
  let t = 0;
  return () => (t += 1);
};

describe('liquify bench rows (push-brush spec §6.2)', () => {
  const frame = { width: 300, height: 400 };

  it('stamp rows: push, bisecting push and restore at 小／中／大, in ns per texel-stamp with the 80 ns budget', () => {
    const rows = benchStamps(frame, tick());
    expect(rows.map((r) => r.name)).toEqual([
      'liquify.stamp push 小',
      'liquify.stamp push bisecting 小',
      'liquify.stamp restore 小',
      'liquify.stamp push 中',
      'liquify.stamp push bisecting 中',
      'liquify.stamp restore 中',
      'liquify.stamp push 大',
      'liquify.stamp push bisecting 大',
      'liquify.stamp restore 大',
    ]);
    for (const r of rows) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.unit).toBe('ns/texel-stamp');
      expect(r.budget).toBe(80);
    }
  });

  it('replay rows (S30 only here: SCAP is the slow one) and the report', () => {
    const rows = benchReplay(frame, tick(), false);
    expect(rows.map((r) => r.name)).toEqual(['liquify.replay S30', 'liquify.bisected S30']);
    expect(rows[0].budget).toBe(100);
    const text = formatLiquifyReport(rows);
    expect(text).toContain('推臉筆');
    expect(text.split('\n').filter((l) => l.startsWith('liquify.'))).toHaveLength(2);
    expect(formatLiquifyReport([])).toBe('');
  });
});

describe('liquify.frame (push-brush spec §6.2: the editor frame at 2048 with strokes and every effect on)', () => {
  const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    points: number[];
  };
  const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
  const frame = { width: 1536, height: 2048 };
  const model = new LiquifyModel(frame, { syncWork: Infinity });
  model.sync(strokesS30(frame));
  const scene = { source: {} as TexImageSource, width: frame.width, height: frame.height, face };

  it('every effect: the face at 美型 max with every 美妝 part, 美膚 and 膚質; spots on it; 美體, 調節 ×12, the look and the strokes', () => {
    const input = liquifyFrameInput(scene, model.field, model.records, 'film');
    expect(input.faces).toHaveLength(1);
    const v = input.faces[0].person.values;
    for (const d of paramsInGroup('shape')) expect(v[d.id as PersonParamId], d.id).toBe(1);
    for (const id of Object.values(MAKEUP_PARAM)) expect(v[id], id).toBe(1);
    for (const id of ['skin.smooth', 'skin.rosy', 'tone.even', 'tone.darkCircle', 'tone.nasolabial', 'tone.teeth', 'tone.eyeBright'] as const) expect(v[id], id).toBeGreaterThan(0);
    expect(v['tone.warmth']).not.toBe(0.5);
    expect(input.photo.spots).toHaveLength(20);
    expect(input.body?.data.some((x) => x !== 0)).toBe(true);
    expect(input.liquify).toBe(model.field);
    expect(input.photo.strokes).toEqual(model.records);
    expect(input.photo.look).toEqual({ id: 'film', amount: 0.8 });
    expect(adjustValuesNeutral(input.photo.values)).toBe(false);
    expect(input.photo.values['skin.whiten']).toBeGreaterThan(0);
    expect(input.photo.values['skin.sharpen']).toBeGreaterThan(0);
  });

  it('strokes only: no face, every photo value neutral, no filter, look, body or spots', () => {
    const input = liquifyFrameInput(scene, model.field, model.records, 'film', false);
    expect(input.faces).toEqual([]);
    expect(input.photo.filterId).toBe('none');
    expect(input.photo.look).toBeNull();
    expect(input.photo.spots).toEqual([]);
    expect(input.body ?? null).toBeNull();
    for (const [id, x] of Object.entries(input.photo.values)) expect(x, id).toBe(neutralValue(paramDef(id as PhotoParamId)));
    expect(input.liquify).toBe(model.field);
  });

  it('frameTimeMs: still renders to the canvas, each fenced by a 1 × 1 readPixels (no frame readback); the median of the timed runs', () => {
    const reads: number[][] = [];
    const renders: unknown[] = [];
    const gl = { RGBA: 1, UNSIGNED_BYTE: 2, readPixels: (x: number, y: number, w: number, h: number) => reads.push([x, y, w, h]) };
    const engine = {
      canvas: { getContext: () => gl },
      render: (_: unknown, opts: unknown) => {
        renders.push(opts);
        return { cpuMs: 0, width: 1536, height: 2048, passes: ['reshape', 'liquify', 'composite'] };
      },
    } as unknown as Engine;
    // the clock: run 1 (a warm-up) reads it once; runs 2…10 read it before and after, taking these durations
    const took = [10, 1, 2, 4, 9, 2, 8, 1, 1];
    const clock = [0, ...took.flatMap((d, k) => [100 * (k + 1), 100 * (k + 1) + d])];
    let t = 0;
    const r = frameTimeMs(engine, liquifyFrameInput(scene, model.field, model.records, null), 9, 2, () => clock[t++]);
    expect(t).toBe(clock.length);
    expect(renders).toHaveLength(11);
    expect(renders.every((o) => (o as { still?: boolean }).still === true)).toBe(true);
    expect(reads).toHaveLength(11);
    expect(reads.every((a) => a[2] === 1 && a[3] === 1)).toBe(true);
    // sorted 1, 1, 1, 2, 2, 4, 8, 9, 10 → median 2
    expect(r).toEqual({ ms: 2, passes: ['reshape', 'liquify', 'composite'], width: 1536, height: 2048 });
  });
});
